// The KEEP driving list, shared by the print page and the Google Drive copy.
(function (root) {
  const S = root.HouseScorer, R = root.HouseReport, Route = root.HouseRoute;
  const HOME = '2911 Waverly Rd, Sumter, SC';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const n = (x) => Number(x).toLocaleString('en-US');

  function sizeText(h) {
    return [h.price != null && `$${n(Math.round(h.price))}`, h.sqft != null && `${n(h.sqft)} sq ft`, h.beds != null && `${h.beds} bd`, h.baths != null && `${h.baths} ba`,
      h.perSqft != null && `$${n(h.perSqft)}/sq ft`, h.yearBuilt != null && `Built ${h.yearBuilt}`].filter(Boolean).join(' · ');
  }

  // What a house has, lacks and fails, as plain text.
  function facts(r) {
    const label = { yes: '', partial: ' (partly)' };
    const wants = S.statedWants(r);
    return {
      has: wants.filter((w) => w.state !== 'no').map((w) => w.name + label[w.state] + (S.feeText(w) ? ` (${S.feeText(w)})` : '')),
      missing: wants.filter((w) => w.state === 'no').map((w) => w.name),
      issues: r.musts.filter((x) => x.status !== 'pass').map((x) => `${x.status === 'fail' ? 'No' : 'Check'}: ${x.name}: ${x.detail}`),
    };
  }

  // KEEP houses still for sale, scored with the filter in use, best first; gone = KEEP houses no longer for sale.
  function keptHouses(scores, marks, cfg) {
    const kept = Object.values(scores || {}).filter((r) => (marks[r.zpid] || {}).mark === 'keep');
    const keep = kept.filter((r) => !S.goneStatus(r)).map((r) => S.rescore(r, cfg));
    return { keep: R.sortResults(keep), gone: kept.length - keep.length };
  }

  // ---- finding houses on the map ----
  async function census(addr) {
    const u = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(addr);
    const j = await (await fetch(u)).json();
    const m = j.result && j.result.addressMatches && j.result.addressMatches[0];
    return m ? { lat: m.coordinates.y, lng: m.coordinates.x } : null;
  }

  let lastOsm = 0;
  async function osm(q) {
    await sleep(Math.max(0, lastOsm + 1100 - Date.now())); // OpenStreetMap allows one lookup per second
    lastOsm = Date.now();
    const j = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(q))).json();
    return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
  }

  const tryGeo = async (fn, q) => { try { return await fn(q); } catch (e) { return null; } };

  // Street address first; if that isn't found, the town (marked approximate).
  async function geocode(addr) {
    const exact = (await tryGeo(census, addr)) || (await tryGeo(osm, addr));
    if (exact) return { ...exact, approx: false };
    const town = String(addr).split(',').slice(1).join(',').trim();
    const rough = town && (await tryGeo(osm, town));
    return rough ? { ...rough, approx: true } : null;
  }

  async function locateAll(rs, say = () => {}) {
    const { geo = {} } = await chrome.storage.local.get('geo');
    const found = {};
    let i = 0;
    for (const r of rs) {
      say(`Finding houses on the map: ${++i} of ${rs.length}…`);
      const h = S.houseInfo(r);
      const g = geo[r.zpid];
      if (h.lat != null && h.lng != null) found[r.zpid] = { lat: h.lat, lng: h.lng, approx: false };
      else if (g && g.address === r.address && !g.approx) found[r.zpid] = g;
      else {
        const res = await geocode(r.address);
        if (res) found[r.zpid] = { ...res, address: r.address };
        else if (g && g.address === r.address) found[r.zpid] = g;
      }
    }
    const fresh = Object.entries(found).filter(([z, g]) => g.address && geo[z] !== g);
    if (fresh.length) {
      await root.HouseFilters.withLock(async () => {
        const { geo: cur = {} } = await chrome.storage.local.get('geo');
        for (const [z, g] of fresh) cur[z] = g;
        await chrome.storage.local.set({ geo: cur });
      });
    }
    return found;
  }

  async function locateStart(addr) {
    if (!addr) return null;
    const { startGeo = {} } = await chrome.storage.local.get('startGeo');
    if (startGeo[addr]) return { ...startGeo[addr], address: addr };
    const g = await geocode(addr);
    if (g) {
      startGeo[addr] = g;
      await chrome.storage.local.set({ startGeo });
    }
    return g ? { ...g, address: addr } : null;
  }

  // Road miles and minutes between every pair of points, from the free OSRM route service; null if it can't answer.
  const OSRM = 'https://router.project-osrm.org/table/v1/driving/';
  async function roadTable(pts) {
    if (pts.length < 2 || pts.length > 100) return null;
    let timer;
    try {
      const ctl = new AbortController();
      timer = setTimeout(() => ctl.abort(), 20000);
      const coords = pts.map((p) => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`).join(';');
      const res = await fetch(`${OSRM}${coords}?annotations=distance,duration`, { signal: ctl.signal });
      const j = await res.json();
      const full = (m) => Array.isArray(m) && m.length === pts.length && m.every((row) => row.length === pts.length && row.every((v) => typeof v === 'number'));
      return j.code === 'Ok' && full(j.distances) && full(j.durations) ? { meters: j.distances, seconds: j.durations } : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Like order(), but by road miles when the route service answers (road: true); otherwise straight lines (road: false).
  // Road stops also get minutes of driving from the one before.
  async function routeByRoad(rs, found, start) {
    const located = rs.filter((r) => found[r.zpid]).map((r) => ({ r, loc: found[r.zpid], lat: found[r.zpid].lat, lng: found[r.zpid].lng }));
    const pts = (start ? [start] : []).concat(located);
    const tab = await roadTable(pts);
    if (!tab) return { ...order(rs, found, start), road: false };
    const ix = new Map(pts.map((p, i) => [p, i]));
    const d = (a, b) => tab.meters[ix.get(a)][ix.get(b)];
    const stops = Route.orderStops(located, start, d).concat(rs.filter((r) => !found[r.zpid]).map((r) => ({ r, loc: null })));
    let total = 0, minutes = 0;
    stops.forEach((s, i) => {
      const prev = i ? stops[i - 1] : start;
      const known = s.loc && prev && ix.has(prev);
      s.miles = known ? d(prev, s) / 1609.344 : null;
      s.minutes = known ? tab.seconds[ix.get(prev)][ix.get(s)] / 60 : null;
      if (known) { total += s.miles; minutes += s.minutes; }
    });
    return { stops, total, minutes, road: true };
  }

  // Stops in driving order from start; houses not found on the map go last. Each stop gets miles from the one before.
  function order(rs, found, start) {
    const located = rs.filter((r) => found[r.zpid]).map((r) => ({ r, loc: found[r.zpid], lat: found[r.zpid].lat, lng: found[r.zpid].lng }));
    const stops = Route.orderStops(located, start).concat(rs.filter((r) => !found[r.zpid]).map((r) => ({ r, loc: null })));
    let total = 0;
    stops.forEach((s, i) => {
      const prev = i ? stops[i - 1] : start;
      s.miles = s.loc && prev && prev.lat != null ? Route.miles(prev, s) : null;
      if (s.miles != null) total += s.miles;
    });
    return { stops, total };
  }

  const minText = (m) => (m < 59.5 ? `${Math.max(1, Math.round(m))} min` : `${Math.floor(Math.round(m) / 60)} hr ${Math.round(m) % 60} min`);
  const legText = (s, prevLabel) => (s.miles == null ? ''
    : s.minutes != null ? `${s.miles < 0.1 ? 'next door to' : `${s.miles.toFixed(1)} mi, ${minText(s.minutes)} by road from`} ${prevLabel}`
      : `${s.miles < 0.1 ? 'next door to' : `${s.miles.toFixed(1)} mi from`} ${prevLabel} (straight line)`);
  const distanceText = ({ total, minutes, road }) => (road
    ? `About ${total.toFixed(1)} miles and ${minText(minutes)} of driving between stops, by road (time at each house not included).`
    : `About ${total.toFixed(1)} miles in straight lines between stops (the roads will be longer; road distances weren't available).`);

  // Google Maps driving directions through the stops in order, 10 points per link (Google's limit).
  function mapsUrls(start, stops) {
    const pts = (start ? [{ label: 'start', address: start.address }] : []).concat(stops.filter((s) => s.loc).map((s, i) => ({ label: String(i + 1), address: s.r.address })));
    const enc = encodeURIComponent, out = [];
    for (let i = 0; i < pts.length - 1; i += 9) {
      const part = pts.slice(i, i + 10);
      const url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${enc(part[0].address)}&destination=${enc(part[part.length - 1].address)}` +
        (part.length > 2 ? '&waypoints=' + part.slice(1, -1).map((p) => enc(p.address)).join('%7C') : '');
      out.push({ label: `${part[0].label === 'start' ? 'Start' : 'Stop ' + part[0].label} to stop ${part[part.length - 1].label}`, url });
    }
    return out;
  }
  const mapWarning = (s) => (!s.loc ? "Couldn't find this address on the map, so it's listed last. Fit it in where it makes sense."
    : s.loc.approx ? 'Exact address not found on the map; placed by town.' : '');
  const startNote = (startText, start) => (startText ? (start ? `Starting from ${startText}` : `Couldn't find "${startText}" on the map, so the order starts from the best first house`) : 'Ordered to keep the drive short');
  const goneText = (gone) => (gone ? `${gone} KEEP house${gone > 1 ? 's are' : ' is'} no longer for sale (pending, sold or off market) and ${gone > 1 ? 'are' : 'is'} left out.` : '');

  // The whole list as lines of text: [{ text, kind }] where kind is title, sub, head, line, note or link.
  function textReport({ town, stops, total, minutes, road, start, startText, gone, filterName, marks }) {
    const out = [{ kind: 'title', text: `KEEP houses: ${town} (${stops.length} ${stops.length === 1 ? 'house' : 'houses'})` },
      { kind: 'sub', text: `${startNote(startText, start)}. ${distanceText({ total, minutes, road })} Filter: ${filterName}` }];
    if (gone) out.push({ kind: 'sub', text: goneText(gone) });
    const maps = mapsUrls(start, stops);
    if (maps.length) out.push({ kind: 'head', text: 'Directions in Google Maps' });
    maps.forEach((m) => out.push({ kind: 'line', text: `${m.label}:`, url: m.url }, { kind: 'link', text: m.url, url: m.url }));
    if (!stops.length) out.push({ kind: 'line', text: "You haven't marked any houses KEEP that are still for sale." });
    stops.forEach((s, i) => {
      const r = s.r, f = facts(r), m = marks[r.zpid] || {};
      out.push({ kind: 'head', text: `${i + 1}. ${r.address || r.url}` });
      const leg = legText(s, i ? `stop ${i}` : 'the start');
      if (leg) out.push({ kind: 'line', text: leg });
      if (mapWarning(s)) out.push({ kind: 'note', text: mapWarning(s) });
      out.push({ kind: 'line', text: sizeText(S.houseInfo(r)) });
      out.push({ kind: 'line', text: `Score ${r.score} ${r.verdict}` });
      if (f.has.length) out.push({ kind: 'line', text: `Has: ${f.has.join(', ')}` });
      if (f.missing.length) out.push({ kind: 'line', text: `Missing: ${f.missing.join(', ')}` });
      f.issues.forEach((t) => out.push({ kind: 'note', text: t }));
      if (m.comment) out.push({ kind: 'line', text: `Your note: ${m.comment}` });
      if (r.url) out.push({ kind: 'link', text: r.url, url: r.url });
    });
    return out;
  }

  root.HouseKeepList = { HOME, sizeText, facts, keptHouses, geocode, locateAll, locateStart, roadTable, routeByRoad, order, mapsUrls, legText, distanceText, mapWarning, startNote, goneText, textReport };
})(typeof self !== 'undefined' ? self : this);
