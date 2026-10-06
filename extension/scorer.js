(function (root) {
  const CRITERIA = {
    priceMin: 250000, priceMax: 360000,
    beds: 3, minBaths: 2,
    sqftMin: 1600, sqftMaxNoUpstairs: 2000, sqftMaxUpstairs: 2350,
    minGarage: 2,
  };

  const POINTS = {
    screened: { yes: 30, partial: 15, unknown: 0, no: -30 },
    fence: { yes: 25, partial: 10, unknown: 0, no: -25 },
    patio: { yes: 20, partial: 10, unknown: 0, no: -20 },
    shed: { yes: 15, partial: 0, unknown: 0, no: 0 },
    sprinkler: { yes: 10, partial: 0, unknown: 0, no: 0 },
  };

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'SVG', 'NOSCRIPT', 'TEMPLATE']);

  // Visible text of a DOM node as lines; adjacent text nodes in one element are joined
  // (React server HTML splits "Bedrooms: <!-- -->3").
  function textLines(node) {
    const out = [];
    const walk = (n) => {
      let buf = '';
      const flush = () => {
        const t = buf.replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
        buf = '';
      };
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) buf += c.nodeValue;
        else if (c.nodeType === 8) continue;
        else if (c.nodeType === 1) {
          flush();
          if (!SKIP_TAGS.has(c.tagName.toUpperCase())) walk(c);
        }
      }
      flush();
    };
    if (node) walk(node);
    return out;
  }

  function findObjects(value, pred, found = [], depth = 0) {
    if (depth > 40 || value == null) return found;
    if (typeof value === 'string') {
      if (value.length > 50 && (value[0] === '{' || value[0] === '[') && /resoFacts|detailUrl/.test(value)) {
        try { findObjects(JSON.parse(value), pred, found, depth + 1); } catch (e) { /* not JSON */ }
      }
      return found;
    }
    if (typeof value !== 'object') return found;
    if (!Array.isArray(value) && pred(value)) found.push(value);
    for (const k in value) findObjects(value[k], pred, found, depth + 1);
    return found;
  }

  function pageJson(doc) {
    const out = [];
    doc.querySelectorAll('script').forEach((s) => {
      const t = s.textContent || '';
      if (!/resoFacts|detailUrl/.test(t)) return;
      const start = t.indexOf('{');
      if (start < 0) return;
      try { out.push(JSON.parse(t.slice(start, t.lastIndexOf('}') + 1))); } catch (e) { /* ignore */ }
    });
    return out;
  }

  // Best-effort fallback from Zillow's embedded page data, when present.
  function jsonExtras(doc) {
    const props = findObjects(pageJson(doc), (o) => o.resoFacts && typeof o.resoFacts === 'object');
    if (!props.length) return null;
    const p = props[0];
    const f = p.resoFacts;
    const j = (v) => (Array.isArray(v) ? v.join(', ') : v);
    const pairs = [
      ['Bedrooms', f.bedrooms ?? p.bedrooms], ['Bathrooms', f.bathrooms ?? p.bathrooms],
      ['Full bathrooms', f.bathroomsFull], ['1/2 bathrooms', f.bathroomsHalf],
      ['3/4 bathrooms', f.bathroomsThreeQuarter],
      ['Total interior livable area', p.livingArea ?? f.livingArea],
      ['Garage spaces', f.garageParkingCapacity], ['Parking features', j(f.parkingFeatures)],
      ['Levels', f.levels], ['Stories', f.stories],
      ['Patio & porch', j(f.patioAndPorchFeatures)], ['Fencing', f.fencing],
      ['Exterior features', j(f.exteriorFeatures)], ['Additional structures', j(f.otherStructures)],
      ['Lot features', j(f.lotFeatures)],
    ];
    return {
      lines: pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`),
      description: p.description || '',
      price: typeof p.price === 'number' ? p.price : null,
    };
  }

  const num = (s) => {
    if (s == null) return null;
    const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };

  function parseListing(rawLines, meta = {}, extras = null) {
    const L = [];
    for (let i = 0; i < rawLines.length; i++) {
      let l = rawLines[i];
      if (/:$/.test(l) && l.length < 60 && i + 1 < rawLines.length && !/:$/.test(rawLines[i + 1])) {
        l = l + ' ' + rawLines[++i];
      }
      L.push(l);
    }

    let fStart = -1;
    for (let i = 0; i < L.length - 1; i++) {
      if (L[i] === 'Facts & features' && L[i + 1] === 'Interior') { fStart = i; break; }
    }
    let fEnd = L.length;
    if (fStart >= 0) {
      for (let i = fStart; i < L.length; i++) {
        if (/^(Price per square foot|Services availability)\b/.test(L[i])) { fEnd = i + 1; break; }
      }
    }
    const factLines = fStart >= 0 ? L.slice(fStart, fEnd) : L;

    const kv = {};
    const addKv = (line) => {
      const m = line.match(/^([A-Za-z0-9/&'(). -]{2,50}):\s*(.+)$/);
      if (!m) return;
      const k = m[1].trim().toLowerCase();
      (kv[k] = kv[k] || []).push(m[2].trim());
    };
    factLines.forEach(addKv);
    if (extras) extras.lines.forEach((l) => { const k = l.split(':')[0].toLowerCase(); if (!kv[k]) addKv(l); });
    const get = (...keys) => {
      const v = keys.flatMap((k) => kv[k] || []);
      return v.length ? v.join(', ') : null;
    };

    const address = (meta.title || '').split('|')[0].trim() || meta.address || '';
    let head = fStart >= 0 ? L.slice(0, fStart) : L;
    // When a listing opens over the search page, the page text also has search cards; anchor on the address line.
    const addrIdx = address ? head.lastIndexOf(address) : -1;
    if (addrIdx >= 0) head = head.slice(Math.max(0, addrIdx - 12));
    let price = null;
    const pl = head.find((l) => /^\$\d{1,3}(,\d{3})+$/.test(l));
    if (pl) price = num(pl);
    if (price == null && extras && extras.price) price = extras.price;
    if (price == null) {
      const lp = get('list price');
      if (lp) price = num(lp) * (/k/i.test(lp) ? 1000 : /m/i.test(lp) ? 1e6 : 1);
    }

    let description = '';
    const ws = L.indexOf("What's special", Math.max(0, addrIdx));
    const pool = ws >= 0 ? L.slice(ws) : head;
    description = pool.find((l) => l.length >= 200) || '';
    if (!description && extras) description = extras.description;

    const headerNum = (label) => {
      const i = head.findIndex((l, idx) => idx > 0 && new RegExp('^' + label + '$', 'i').test(l) && /^[\d,.]+$/.test(head[idx - 1]));
      return i > 0 ? num(head[i - 1]) : null;
    };

    const sqft = num(get('total interior livable area')) ?? headerNum('sqft');
    const beds = num(get('bedrooms')) ?? headerNum('beds?');
    const bathsTotal = num(get('bathrooms')) ?? headerNum('baths?');
    const fullBaths = num(get('full bathrooms'));
    const halfBaths = num(get('1/2 bathrooms')) || 0;
    const threeQBaths = num(get('3/4 bathrooms')) || 0;

    const zpid = ((meta.url || '').match(/(\d+)_zpid/) || [])[1] || address;

    return {
      zpid, address, url: meta.url || '', price, beds, bathsTotal, fullBaths, halfBaths, threeQBaths, sqft,
      description,
      levels: get('levels'), stories: get('stories'),
      roomLevels: get('level'),
      garageSpaces: get('garage spaces'),
      attachedGarage: get('attached garage spaces'), detachedGarage: get('detached garage spaces'),
      parking: get('parking features'),
      patio: get('patio & porch'),
      fencing: get('fencing'),
      structures: get('additional structures', 'other structures'),
      exterior: get('exterior features'),
      allFacts: factLines.concat(extras ? extras.lines : []).join('\n'),
    };
  }

  const has = (s, re) => !!s && re.test(s);

  function detectUpstairs(f) {
    const d = f.description;
    const m = d.match(/\b(upstairs|bonus room|loft|second floor|2nd floor|upper level|second story|frog|room over (the )?garage)\b/i);
    if (m) return { value: 'yes', why: `description mentions "${m[0]}"` };
    if (has(f.roomLevels, /upper|second|2nd/i)) return { value: 'yes', why: 'a room is listed on the upper level' };
    if (f.levels) {
      if (/half|two|three|multi|split|tri|[23]|1\.5/i.test(f.levels)) return { value: 'yes', why: `Levels: ${f.levels}` };
      if (/one|single|\b1\b/i.test(f.levels)) return { value: 'no', why: `Levels: ${f.levels}` };
    }
    const st = num(f.stories);
    if (st != null) return st > 1 ? { value: 'yes', why: `Stories: ${f.stories}` } : { value: 'no', why: `Stories: ${f.stories}` };
    return { value: 'unknown', why: 'number of floors not listed' };
  }

  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

  function mustHaves(f, upstairs) {
    const C = CRITERIA;
    const out = [];
    const add = (name, status, detail) => out.push({ name, status, detail });

    if (f.price == null) add('Price', 'verify', 'price not found');
    else if (f.price < C.priceMin || f.price > C.priceMax) add('Price', 'fail', `${money(f.price)} is outside $250,000–$360,000`);
    else add('Price', 'pass', money(f.price));

    if (f.beds == null) add('Bedrooms', 'verify', 'bedrooms not found');
    else if (f.beds !== C.beds) add('Bedrooms', 'fail', `${f.beds} bedrooms (need 3)`);
    else add('Bedrooms', 'pass', '3 bedrooms');

    const realBaths = f.fullBaths != null ? f.fullBaths + f.threeQBaths : null;
    const bathText = f.fullBaths != null
      ? `${f.fullBaths} full` + (f.threeQBaths ? ` + ${f.threeQBaths} three-quarter` : '') + (f.halfBaths ? ` + ${f.halfBaths} half` : '')
      : `${f.bathsTotal} baths`;
    if (realBaths != null && realBaths >= C.minBaths) add('Bathrooms', 'pass', bathText);
    else if (realBaths != null && f.bathsTotal != null && f.bathsTotal >= C.minBaths && f.bathsTotal > realBaths + f.halfBaths) add('Bathrooms', 'verify', `${bathText} (total says ${f.bathsTotal}; check bath types)`);
    else if (realBaths != null) add('Bathrooms', 'fail', `${bathText} (need 2 full)`);
    else if (f.bathsTotal == null) add('Bathrooms', 'verify', 'bathrooms not found');
    else if (f.bathsTotal >= C.minBaths) add('Bathrooms', 'pass', bathText);
    else add('Bathrooms', 'fail', `${bathText} (need 2)`);

    if (f.sqft == null) add('Square feet', 'verify', 'square feet not found');
    else if (f.sqft < C.sqftMin) add('Square feet', 'fail', `${f.sqft.toLocaleString()} sq ft is under 1,600`);
    else if (f.sqft > C.sqftMaxUpstairs) add('Square feet', 'fail', `${f.sqft.toLocaleString()} sq ft is over 2,350`);
    else if (f.sqft > C.sqftMaxNoUpstairs) {
      if (upstairs.value === 'yes') add('Square feet', 'pass', `${f.sqft.toLocaleString()} sq ft (OK, has upstairs room)`);
      else if (upstairs.value === 'no') add('Square feet', 'fail', `${f.sqft.toLocaleString()} sq ft is over 2,000 with no upstairs room`);
      else add('Square feet', 'verify', `${f.sqft.toLocaleString()} sq ft: OK only if there's an upstairs room`);
    } else add('Square feet', 'pass', `${f.sqft.toLocaleString()} sq ft`);

    const att = num(f.attachedGarage), det = num(f.detachedGarage), gs = num(f.garageSpaces);
    const spaces = gs != null ? gs : (att != null || det != null ? (att || 0) + (det || 0) : null);
    const d = f.description;
    if (spaces != null && spaces >= C.minGarage) add('2-car garage', 'pass', `${spaces}-car garage`);
    else if (spaces != null && spaces > 0) add('2-car garage', 'fail', `${spaces}-car garage`);
    else if (/\b(2|two|double|3|three)[- ]car garage|\b(double|two|2) garage/i.test(d)) add('2-car garage', 'pass', 'description mentions a 2-car garage');
    else if (/\b(1|one|single)[- ]car garage/i.test(d)) add('2-car garage', 'fail', 'description says 1-car garage');
    else if (f.parking && !/garage/i.test(f.parking) && /carport/i.test(f.parking)) add('2-car garage', 'fail', `carport, no garage (${f.parking})`);
    else add('2-car garage', 'verify', f.parking ? `garage size not listed (Parking: ${f.parking})` : 'garage not listed');
    return out;
  }

  function wants(f) {
    const d = f.description;
    const P = f.patio;
    const out = [];
    const add = (key, name, state, why) => out.push({ key, name, state, points: POINTS[key][state], why });

    {
      const backInDesc = d.match(/screen(ed)?[- ]?(in )?(back|rear) (porch|patio|room)|(back|rear) screen(ed)?[- ]?(in )?(porch|patio|room)|screen(ed)?[- ]?(in )?(porch|patio|room|lanai)[^.]{0,60}\b(back ?yard|rear|back)\b/i);
      const anyInDesc = d.match(/screen(ed)?[- ]?(in )?(porch|patio|room|lanai|sun ?room)/i);
      const inField = has(P, /screen/i);
      if (backInDesc) add('screened', 'Screened porch on back', 'yes', `description: "${backInDesc[0]}"`);
      else if (inField && has(P, /rear|back/i)) add('screened', 'Screened porch on back', 'yes', `Patio & porch: ${P}`);
      else if (inField || anyInDesc) add('screened', 'Screened porch on back', 'partial', inField ? `Patio & porch: ${P} (location not stated)` : `description: "${anyInDesc[0]}" (location not stated)`);
      else if (P) add('screened', 'Screened porch on back', 'no', `Patio & porch: ${P}`);
      else add('screened', 'Screened porch on back', 'unknown', 'porch details not listed');
    }

    {
      const F = f.fencing;
      const fullDesc = d.match(/(fully |privacy |completely )?fenced[- ]?(in )?(back ?yard|rear yard|yard|back)|(back ?yard|yard) (is )?(fully )?fenced/i);
      const partDesc = d.match(/partial(ly)? fenced/i);
      if (fullDesc && !partDesc) add('fence', 'Fenced backyard', 'yes', `description: "${fullDesc[0]}"`);
      else if (F && /^(none|no)\b/i.test(F)) add('fence', 'Fenced backyard', partDesc ? 'partial' : 'no', `Fencing: ${F}`);
      else if (F && /partial|front/i.test(F)) add('fence', 'Fenced backyard', 'partial', `Fencing: ${F}`);
      else if (F) add('fence', 'Fenced backyard', 'yes', `Fencing: ${F}`);
      else if (partDesc) add('fence', 'Fenced backyard', 'partial', `description: "${partDesc[0]}"`);
      else add('fence', 'Fenced backyard', 'unknown', 'fencing not listed');
    }

    {
      const pDesc = d.match(/[^.]{0,30}\bpatio\b[^.]{0,30}/i);
      const deckDesc = d.match(/[^.]{0,30}\bdeck\b[^.]{0,30}/i);
      if (has(P, /patio/i)) add('patio', 'Patio for grilling', 'yes', `Patio & porch: ${P}`);
      else if (pDesc) add('patio', 'Patio for grilling', 'yes', `description: "${pDesc[0].trim()}"`);
      else if (has(P, /deck/i) || deckDesc) add('patio', 'Patio for grilling', 'partial', P && /deck/i.test(P) ? `deck only (Patio & porch: ${P})` : `deck only: "${deckDesc[0].trim()}"`);
      else if (P) add('patio', 'Patio for grilling', 'no', `Patio & porch: ${P}`);
      else add('patio', 'Patio for grilling', 'unknown', 'patio not listed');
    }

    {
      const S = [f.structures, f.exterior].filter(Boolean).join(', ');
      const sm = S.match(/shed|workshop|storage|outbuilding|barn|work ?shop/i);
      const dm = d.match(/\b(shed|workshop|work shop|storage building|outbuilding|barn)\b/i);
      if (sm) add('shed', 'Shed / workshop', 'yes', f.structures && /shed|workshop|outbuilding|barn/i.test(f.structures) ? `Additional structures: ${f.structures}` : `${S} (check it's a shed)`);
      else if (dm) add('shed', 'Shed / workshop', 'yes', `description mentions "${dm[0]}"`);
      else add('shed', 'Shed / workshop', 'unknown', 'none listed');
    }

    {
      const all = (f.allFacts + '\n' + d).replace(/fire sprinkler\w*/gi, '');
      const m = all.match(/[^\n,.]*\b(sprinkler|irrigation)[^\n,.]*/i);
      if (m) add('sprinkler', 'Sprinkler system', 'yes', m[0].trim());
      else add('sprinkler', 'Sprinkler system', 'unknown', 'none listed');
    }
    return out;
  }

  function scoreListing(f) {
    const upstairs = detectUpstairs(f);
    const musts = mustHaves(f, upstairs);
    const ws = wants(f);
    const score = ws.reduce((s, w) => s + w.points, 0);
    const unknowns = ws.filter((w) => w.state === 'unknown' && POINTS[w.key].no !== 0).length + musts.filter((m) => m.status === 'verify').length;
    const verdict = musts.some((m) => m.status === 'fail') ? 'Rejected' : musts.some((m) => m.status === 'verify') ? 'Check' : 'Match';
    return {
      zpid: f.zpid, address: f.address, url: f.url, price: f.price, beds: f.beds,
      baths: f.fullBaths != null ? f.fullBaths + f.threeQBaths + 0.5 * f.halfBaths : f.bathsTotal,
      sqft: f.sqft, upstairs, musts, wants: ws, score, unknowns, verdict,
      description: f.description,
    };
  }

  function scoreDocument(doc, url) {
    const extras = jsonExtras(doc);
    return scoreListing(parseListing(textLines(doc.body), { title: doc.title, url }, extras));
  }

  function searchListingUrls(doc) {
    const urls = new Map();
    const add = (href) => {
      const m = href && href.match(/\/homedetails\/[^?#]*?(\d+)_zpid/);
      if (m) urls.set(m[1], new URL(href, 'https://www.zillow.com').href.split(/[?#]/)[0]);
    };
    doc.querySelectorAll('a[href*="/homedetails/"]').forEach((a) => add(a.getAttribute('href')));
    findObjects(pageJson(doc), (o) => typeof o.detailUrl === 'string').forEach((o) => add(o.detailUrl));
    return [...urls.values()];
  }

  const api = { CRITERIA, POINTS, textLines, parseListing, scoreListing, scoreDocument, searchListingUrls, jsonExtras };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HouseScorer = api;
})(typeof self !== 'undefined' ? self : this);
