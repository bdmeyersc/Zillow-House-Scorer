(function (root) {
  const DEFAULT_CONFIG = {
    price: { on: true, min: 250000, max: 360000 },
    beds: { on: true, min: 3, max: 3 },
    baths: { on: true, minFull: 2 },
    sqft: { on: true, min: 1600, maxNoUpstairs: 2000, maxUpstairs: 2350 },
    garage: { on: true, min: 2 },
    wants: {
      screened: { on: true, yes: 30, partial: 15, no: -30 },
      fence: { on: true, yes: 25, partial: 10, no: -25 },
      patio: { on: true, yes: 20, partial: 10, no: -20 },
      shed: { on: true, yes: 15, partial: 0, no: 0 },
      sprinkler: { on: true, yes: 10, partial: 0, no: 0 },
      well: { on: true, yes: 5, partial: 0, no: 0 },
      dock: { on: true, yes: 10, partial: 5, no: 0 },
      slip: { on: true, yes: 10, partial: 0, no: 0 },
      hoa: { on: true, yes: 0, partial: 0, no: 0 },
      pool: { on: true, yes: 10, partial: 0, no: 0 },
      communityPool: { on: true, yes: 5, partial: 0, no: 0 },
      clubhouse: { on: true, yes: 5, partial: 0, no: 0 },
    },
  };

  // states: which outcomes the scorer can produce for each want; hint explains them on the Filters page.
  const WANTS = [
    { key: 'screened', name: 'Screened porch on back', short: 'Screened back porch', states: ['yes', 'partial', 'no'] },
    { key: 'fence', name: 'Fenced backyard', short: 'Fenced backyard', states: ['yes', 'partial', 'no'] },
    { key: 'patio', name: 'Patio for grilling', short: 'Patio for grill', states: ['yes', 'partial', 'no'] },
    { key: 'shed', name: 'Shed / workshop', short: 'Shed / workshop', states: ['yes'] },
    { key: 'sprinkler', name: 'Sprinkler system', short: 'Sprinklers', states: ['yes'] },
    { key: 'well', name: 'Well', short: 'Well', states: ['yes', 'no'], hint: 'Has it = well water or an irrigation well; Clearly missing = city water only' },
    { key: 'dock', name: 'Dock', short: 'Dock', states: ['yes', 'partial'], hint: 'Partly = a shared or community dock' },
    { key: 'slip', name: 'Boat slip', short: 'Boat slip', states: ['yes'] },
    { key: 'hoa', name: 'HOA', short: 'HOA', states: ['yes', 'no'], hint: 'Has it = there is an HOA (the fee is shown in the report); Clearly missing = no HOA. Use a negative number to count against it.' },
    { key: 'pool', name: 'Pool (at the house)', short: 'Pool', states: ['yes'], hint: 'The house has its own pool' },
    { key: 'communityPool', name: 'Community pool', short: 'Community pool', states: ['yes'], hint: 'A neighborhood, HOA or community pool' },
    { key: 'clubhouse', name: 'Clubhouse', short: 'Clubhouse', states: ['yes'] },
  ];

  // Fills in anything missing or invalid from DEFAULT_CONFIG.
  function normalizeConfig(c) {
    const fix = (def, v) => {
      if (typeof def === 'boolean') return typeof v === 'boolean' ? v : def;
      if (typeof def === 'number') { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) ? n : def; }
      const out = {};
      for (const k in def) out[k] = fix(def[k], v && typeof v === 'object' ? v[k] : undefined);
      return out;
    };
    return fix(DEFAULT_CONFIG, c);
  }

  const maxScore = (cfg) => WANTS.reduce((s, w) => s + (cfg.wants[w.key].on ? Math.max(0, ...w.states.map((st) => cfg.wants[w.key][st])) : 0), 0);

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
    const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : v);
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
      ['Water source', j(f.waterSource)], ['Has HOA', yn(f.hasAssociation)], ['HOA fee', f.associationFee],
      ['Amenities included', j(f.associationAmenities)], ['Community features', j(f.communityFeatures)],
      ['Pool features', j(f.poolFeatures)], ['Private pool', yn(f.hasPrivatePool)], ['Waterfront features', j(f.waterfrontFeatures)],
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
  const n = (x) => Number(x).toLocaleString('en-US');
  const range = (a, b) => (a === b ? `${a}` : `${a}–${b}`);
  const GARAGE_WORDS = { one: 1, single: 1, two: 2, double: 2, three: 3, triple: 3, four: 4 };

  // Plain-language summary of the must-haves in a config, for the report legend.
  function describeMusts(cfg) {
    const out = [];
    if (cfg.price.on) out.push(`${money(cfg.price.min)}–${money(cfg.price.max)}`);
    if (cfg.beds.on) out.push(`${range(cfg.beds.min, cfg.beds.max)} bedrooms`);
    if (cfg.baths.on) out.push(`${cfg.baths.minFull}+ full baths`);
    if (cfg.sqft.on) out.push(`${n(cfg.sqft.min)}–${n(cfg.sqft.maxNoUpstairs)} sq ft (up to ${n(cfg.sqft.maxUpstairs)} with an upstairs room)`);
    if (cfg.garage.on) out.push(`${cfg.garage.min}-car garage`);
    return out;
  }

  function mustHaves(f, upstairs, cfg) {
    const out = [];
    const add = (name, status, detail) => out.push({ name, status, detail });

    if (cfg.price.on) {
      const C = cfg.price;
      if (f.price == null) add('Price', 'verify', 'price not found');
      else if (f.price < C.min || f.price > C.max) add('Price', 'fail', `${money(f.price)} is outside ${money(C.min)}–${money(C.max)}`);
      else add('Price', 'pass', money(f.price));
    }

    if (cfg.beds.on) {
      const C = cfg.beds;
      if (f.beds == null) add('Bedrooms', 'verify', 'bedrooms not found');
      else if (f.beds < C.min || f.beds > C.max) add('Bedrooms', 'fail', `${f.beds} bedrooms (need ${range(C.min, C.max)})`);
      else add('Bedrooms', 'pass', `${f.beds} bedrooms`);
    }

    if (cfg.baths.on) {
      const min = cfg.baths.minFull;
      const realBaths = f.fullBaths != null ? f.fullBaths + f.threeQBaths : null;
      const bathText = f.fullBaths != null
        ? `${f.fullBaths} full` + (f.threeQBaths ? ` + ${f.threeQBaths} three-quarter` : '') + (f.halfBaths ? ` + ${f.halfBaths} half` : '')
        : `${f.bathsTotal} baths`;
      if (realBaths != null && realBaths >= min) add('Bathrooms', 'pass', bathText);
      else if (realBaths != null && f.bathsTotal != null && f.bathsTotal >= min && f.bathsTotal > realBaths + f.halfBaths) add('Bathrooms', 'verify', `${bathText} (total says ${f.bathsTotal}; check bath types)`);
      else if (realBaths != null) add('Bathrooms', 'fail', `${bathText} (need ${min} full)`);
      else if (f.bathsTotal == null) add('Bathrooms', 'verify', 'bathrooms not found');
      else if (f.bathsTotal >= min) add('Bathrooms', 'pass', bathText);
      else add('Bathrooms', 'fail', `${bathText} (need ${min})`);
    }

    if (cfg.sqft.on) {
      const C = cfg.sqft;
      const lo = Math.min(C.maxNoUpstairs, C.maxUpstairs), hi = Math.max(C.maxNoUpstairs, C.maxUpstairs);
      if (f.sqft == null) add('Square feet', 'verify', 'square feet not found');
      else if (f.sqft < C.min) add('Square feet', 'fail', `${n(f.sqft)} sq ft is under ${n(C.min)}`);
      else if (f.sqft > hi) add('Square feet', 'fail', `${n(f.sqft)} sq ft is over ${n(hi)}`);
      else if (f.sqft > lo) {
        const needUp = C.maxUpstairs > C.maxNoUpstairs;
        if (upstairs.value === (needUp ? 'yes' : 'no')) add('Square feet', 'pass', `${n(f.sqft)} sq ft (OK, ${needUp ? 'has' : 'no'} upstairs room)`);
        else if (upstairs.value !== 'unknown') add('Square feet', 'fail', `${n(f.sqft)} sq ft is over ${n(lo)} ${needUp ? 'with no' : 'with an'} upstairs room`);
        else add('Square feet', 'verify', `${n(f.sqft)} sq ft: OK only if there's ${needUp ? 'an' : 'no'} upstairs room`);
      } else add('Square feet', 'pass', `${n(f.sqft)} sq ft`);
    }

    if (cfg.garage.on) {
      const min = cfg.garage.min;
      const label = `${min}-car garage`;
      const att = num(f.attachedGarage), det = num(f.detachedGarage), gs = num(f.garageSpaces);
      const spaces = gs != null ? gs : (att != null || det != null ? (att || 0) + (det || 0) : null);
      const dm = f.description.match(/\b(\d|one|single|two|double|three|triple|four)[- ]car garage|\b(double|two|2) garage/i);
      const dSpaces = dm ? (dm[1] ? (GARAGE_WORDS[dm[1].toLowerCase()] || Number(dm[1])) : 2) : null;
      if (spaces != null && spaces >= min) add(label, 'pass', `${spaces}-car garage`);
      else if (spaces != null && spaces > 0) add(label, 'fail', `${spaces}-car garage`);
      else if (dSpaces != null && dSpaces >= min) add(label, 'pass', `description mentions "${dm[0]}"`);
      else if (dSpaces != null) add(label, 'fail', `description says "${dm[0]}"`);
      else if (f.parking && !/garage/i.test(f.parking) && /carport/i.test(f.parking)) add(label, 'fail', `carport, no garage (${f.parking})`);
      else add(label, 'verify', f.parking ? `garage size not listed (Parking: ${f.parking})` : 'garage not listed');
    }
    return out;
  }

  function wants(f, cfg) {
    const d = f.description;
    const P = f.patio;
    const out = [];
    const add = (key, name, state, why) => { if (cfg.wants[key].on) out.push({ key, name, state, points: state === 'unknown' ? 0 : cfg.wants[key][state], why }); };

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

    // Fact lines whose label matches keyRe and whose value matches valRe.
    const facts = (f.allFacts || '').split('\n');
    const fact = (keyRe, valRe = /./) => facts.find((l) => { const i = l.indexOf(':'); return i > 0 && keyRe.test(l.slice(0, i)) && valRe.test(l.slice(i + 1)); });
    const quote = (m) => `description: "${m[0].trim()}"`;

    {
      const w = fact(/^(water|water source|water information|irrigation|irrigation water)$/i, /\bwells?\b/i);
      const pub = fact(/^(water|water source|water information)$/i, /public|city|municipal|county|community|utility/i);
      const dm = d.match(/[^.]{0,25}\b(private well|well water|irrigation well|wells? for irrigation|on a well|deep well|shallow well)\b[^.]{0,20}/i);
      if (w) add('well', 'Well', 'yes', w);
      else if (dm) add('well', 'Well', 'yes', quote(dm));
      else if (pub) add('well', 'Well', 'no', pub);
      else add('well', 'Well', 'unknown', 'water source not listed');
    }

    {
      const dockRe = /\bdocks?\b(?!ing)/i;
      const shared = /community|shared|neighborhood|association|amenit/i;
      const fl = fact(/./, dockRe);
      const dm = d.match(/[^.]{0,30}\bdocks?\b(?!ing)[^.]{0,30}/i);
      if (fl && !shared.test(fl)) add('dock', 'Dock', 'yes', fl);
      else if (dm && !shared.test(dm[0])) add('dock', 'Dock', 'yes', quote(dm));
      else if (fl || dm) add('dock', 'Dock', 'partial', fl || quote(dm));
      else add('dock', 'Dock', 'unknown', 'none listed');
    }

    {
      const slipRe = /(?<!non[- ])\bslips?\b(?![- ]?resist)/i;
      const fl = fact(/./, slipRe);
      const dm = d.match(/[^.]{0,30}\b(boat|deeded|private|marina|wet|dry) slips?\b[^.]{0,30}/i);
      if (fl) add('slip', 'Boat slip', 'yes', fl);
      else if (dm) add('slip', 'Boat slip', 'yes', quote(dm));
      else add('slip', 'Boat slip', 'unknown', 'none listed');
    }

    {
      const fee = fact(/^(hoa fee|hoa|association fee|association fees?)$/i, /\$\s*[1-9]/);
      const has = fact(/^(has hoa|has association|association|hoa)$/i);
      const noDesc = d.match(/\bno (hoa|homeowners?'? association)\b/i);
      const dm = d.match(/[^.]{0,25}\b(hoa|homeowners?'? association)\b[^.]{0,25}/i);
      if (fee) add('hoa', 'HOA', 'yes', fee);
      else if (has && /^[^:]*:\s*(no|none)\b/i.test(has)) add('hoa', 'HOA', 'no', has);
      else if (has && /^[^:]*:\s*yes\b/i.test(has)) add('hoa', 'HOA', 'yes', has + ' (fee not listed)');
      else if (noDesc) add('hoa', 'HOA', 'no', quote(noDesc));
      else if (dm) add('hoa', 'HOA', 'yes', quote(dm));
      else add('hoa', 'HOA', 'unknown', 'HOA not listed');
    }

    {
      const poolRe = /(?<!car ?)\bpools?\b(?! table)/i;
      const shared = /community|neighborhood|association|amenit|shared|subdivision|resort|hoa/i;
      const own = fact(/^(private pool|has private pool|pool features|pool)$/i, /^(?!\s*(no|none)\b)(?!.*(community|association|neighborhood|shared))/i);
      const commFact = fact(/amenit|community|association|hoa/i, poolRe) || fact(/pool/i, shared);
      const dms = [...d.matchAll(/[^.]{0,30}(?<!car ?)\bpools?\b(?! table)[^.]{0,30}/gi)].map((m) => m[0].trim());
      const ownDesc = dms.find((t) => !shared.test(t) && /in-?ground|above-?ground|private|own|backyard|heated|saltwater|salt water|screened/i.test(t));
      const commDesc = dms.find((t) => shared.test(t));
      const vague = dms.find((t) => t !== ownDesc && t !== commDesc);
      if (own) add('pool', 'Pool (at the house)', 'yes', own);
      else if (ownDesc) add('pool', 'Pool (at the house)', 'yes', `description: "${ownDesc}"`);
      else add('pool', 'Pool (at the house)', 'unknown', vague && !commFact && !commDesc ? `description: "${vague}" (check whether it is private)` : 'none listed');
      if (commFact) add('communityPool', 'Community pool', 'yes', commFact);
      else if (commDesc) add('communityPool', 'Community pool', 'yes', `description: "${commDesc}"`);
      else if (vague && !own && !ownDesc) add('communityPool', 'Community pool', 'yes', `description: "${vague}" (check whether it is shared)`);
      else add('communityPool', 'Community pool', 'unknown', 'none listed');
    }

    {
      const re = /\bclub ?houses?\b/i;
      const fl = fact(/./, re);
      const dm = d.match(/[^.]{0,30}\bclub ?houses?\b[^.]{0,30}/i);
      if (fl) add('clubhouse', 'Clubhouse', 'yes', fl);
      else if (dm) add('clubhouse', 'Clubhouse', 'yes', quote(dm));
      else add('clubhouse', 'Clubhouse', 'unknown', 'none listed');
    }
    return out;
  }

  // "123 Main St, Little River, SC 29566" -> "Little River"
  function townOf(address) {
    const parts = String(address || '').split(',').map((x) => x.trim()).filter(Boolean);
    return parts.length >= 3 ? parts[parts.length - 2] : '';
  }

  function scoreListing(f, config) {
    const cfg = normalizeConfig(config);
    const upstairs = detectUpstairs(f);
    const musts = mustHaves(f, upstairs, cfg);
    const ws = wants(f, cfg);
    const score = ws.reduce((s, w) => s + w.points, 0);
    const unknowns = ws.filter((w) => w.state === 'unknown' && cfg.wants[w.key].no !== 0).length + musts.filter((m) => m.status === 'verify').length;
    const verdict = musts.some((m) => m.status === 'fail') ? 'Rejected' : musts.some((m) => m.status === 'verify') ? 'Check' : 'Match';
    return {
      zpid: f.zpid, address: f.address, town: townOf(f.address), url: f.url, price: f.price, beds: f.beds,
      baths: f.fullBaths != null ? f.fullBaths + f.threeQBaths + 0.5 * f.halfBaths : f.bathsTotal,
      sqft: f.sqft, upstairs, musts, wants: ws, score, unknowns, verdict,
      description: f.description,
    };
  }

  function scoreDocument(doc, url, config) {
    const extras = jsonExtras(doc);
    const facts = parseListing(textLines(doc.body), { title: doc.title, url }, extras);
    return { ...scoreListing(facts, config), facts };
  }

  // Re-scores a saved result with another filter. Results saved before v1.1 have no facts and are returned as-is.
  function rescore(saved, config) {
    if (!saved.facts) return { ...saved, town: townOf(saved.address), legacy: true };
    const r = scoreListing(saved.facts, config);
    const address = saved.address || r.address;
    return { ...saved, ...r, zpid: saved.zpid, address, town: townOf(address), url: saved.url || r.url };
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

  const api = { DEFAULT_CONFIG, WANTS, normalizeConfig, townOf, maxScore, describeMusts, rescore, textLines, parseListing, scoreListing, scoreDocument, searchListingUrls, jsonExtras };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HouseScorer = api;
})(typeof self !== 'undefined' ? self : this);
