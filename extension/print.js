const S = HouseScorer, R = HouseReport;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = (x) => Number(x).toLocaleString('en-US');
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unticked = new Set();
let keep = [], marks = {}, filterName = '';

async function load() {
  const [{ scores = {}, marks: m = {} }, filters] = await Promise.all([chrome.storage.local.get(['scores', 'marks']), HouseFilters.load()]);
  marks = m;
  filterName = filters.active;
  keep = Object.values(scores).filter((r) => (marks[r.zpid] || {}).mark === 'keep').map((r) => S.rescore(r, filters.cfg));
  const towns = R.townList(keep).filter((t) => t.count);
  const sel = $('town');
  const prev = sel.value || new URLSearchParams(location.search).get('town');
  sel.innerHTML = `<option value="all">All towns (${keep.length})</option>` + towns.map((t) => `<option value="${esc(t.name)}">${esc(t.name)} (${t.count})</option>`).join('');
  sel.value = towns.some((t) => t.name === prev) ? prev : towns.length === 1 ? towns[0].name : 'all';
  renderList();
}

const shown = () => R.sortResults($('town').value === 'all' ? keep : keep.filter((r) => R.townName(r) === $('town').value));

function sizeText(h) {
  return [h.price != null && `$${n(Math.round(h.price))}`, h.sqft != null && `${n(h.sqft)} sq ft`, h.beds != null && `${h.beds} bd`, h.baths != null && `${h.baths} ba`,
    h.perSqft != null && `$${n(h.perSqft)}/sq ft`, h.yearBuilt != null && `Built ${h.yearBuilt}`].filter(Boolean).join(' · ');
}

function renderList() {
  const rs = shown();
  if (!rs.length) {
    $('list').innerHTML = keep.length ? '<p>No KEEP houses in this town.</p>' : '<p>You haven\'t marked any houses KEEP yet. Click <b>KEEP</b> next to a house in the report first.</p>';
    $('make').disabled = true;
    return;
  }
  $('make').disabled = false;
  $('list').innerHTML = `<table class="pick"><thead><tr><th>Print?</th><th>House</th><th>Score</th><th>Your notes</th></tr></thead><tbody>${rs.map((r) => {
    const id = 'cb-' + r.zpid;
    return `<tr><td><input type="checkbox" id="${esc(id)}" data-zpid="${esc(r.zpid)}"${unticked.has(r.zpid) ? '' : ' checked'}></td>
      <td><label for="${esc(id)}"><b>${esc(r.address || r.url)}</b><br>${esc(sizeText(S.houseInfo(r)))}</label></td>
      <td>${r.score} ${esc(r.verdict)}</td><td>${esc((marks[r.zpid] || {}).comment || '')}</td></tr>`;
  }).join('')}</tbody></table>`;
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

async function locateAll(rs, say) {
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
  await HouseFilters.withLock(async () => {
    const { geo: cur = {} } = await chrome.storage.local.get('geo');
    for (const [z, g] of Object.entries(found)) if (g.address) cur[z] = g;
    await chrome.storage.local.set({ geo: cur });
  });
  return found;
}

async function locateStart(addr) {
  if (!addr) return null;
  try {
    const c = JSON.parse(localStorage.routeStartGeo || 'null');
    if (c && c.address === addr) return c;
  } catch (e) { /* re-find */ }
  const g = await geocode(addr);
  if (g) localStorage.routeStartGeo = JSON.stringify({ ...g, address: addr });
  return g ? { ...g, address: addr } : null;
}

// ---- the printed list ----
function mapsLinks(start, stops) {
  const pts = (start ? [{ label: 'start', address: start.address }] : []).concat(stops.map((s, i) => ({ label: String(i + 1), address: s.r.address })));
  if (pts.length < 2) return '';
  const enc = (a) => encodeURIComponent(a);
  const links = [];
  for (let i = 0; i < pts.length - 1; i += 9) {
    const part = pts.slice(i, i + 10);
    const url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${enc(part[0].address)}&destination=${enc(part[part.length - 1].address)}` +
      (part.length > 2 ? '&waypoints=' + part.slice(1, -1).map((p) => enc(p.address)).join('%7C') : '');
    const from = part[0].label === 'start' ? 'Start' : 'Stop ' + part[0].label;
    links.push(`<a href="${esc(url)}" target="_blank">${from} to stop ${part[part.length - 1].label}</a>`);
  }
  return `<div class="maps">Directions in Google Maps: ${links.join('')}</div>`;
}

function stopCard(s, i, prevLabel) {
  const r = s.r;
  const m = marks[r.zpid] || {};
  const label = { yes: '', partial: ' (partly)' };
  const has = S.statedWants(r).filter((w) => w.state !== 'no').map((w) => esc(w.name) + label[w.state]);
  const missing = S.statedWants(r).filter((w) => w.state === 'no').map((w) => esc(w.name));
  const issues = r.musts.filter((x) => x.status !== 'pass').map((x) => `${x.status === 'fail' ? 'No' : 'Check'}: ${esc(x.name)}: ${esc(x.detail)}`);
  const leg = s.miles != null ? `${s.miles < 0.1 ? 'next door to' : `${s.miles.toFixed(1)} mi from`} ${prevLabel}` : '';
  return `<div class="stop"><div class="num">${i + 1}</div>
    <div class="addr"><a href="${esc(r.url)}" target="_blank">${esc(r.address || r.url)}</a></div>
    ${leg ? `<div class="leg">${leg} (straight line)</div>` : ''}
    ${!s.loc ? '<div class="warn">Couldn\'t find this address on the map, so it\'s listed last. Fit it in where it makes sense.</div>' : s.loc.approx ? '<div class="warn">Exact address not found on the map; placed by town.</div>' : ''}
    <div class="facts">${esc(sizeText(S.houseInfo(r)))}</div>
    <div class="facts"><span class="score ${esc(r.verdict)}">Score ${r.score} ${esc(r.verdict)}</span></div>
    ${has.length ? `<div class="wants">Has: ${has.join(', ')}</div>` : ''}
    ${missing.length ? `<div class="wants">Missing: ${missing.join(', ')}</div>` : ''}
    ${issues.length ? `<div class="notes">${issues.join('<br>')}</div>` : ''}
    ${m.comment ? `<div class="mine">Your note: ${esc(m.comment)}</div>` : ''}
    <div class="lines">Notes from the drive:<div></div><div></div></div></div>`;
}

async function make() {
  const ids = new Set([...document.querySelectorAll('#list input[type=checkbox]:checked')].map((c) => c.dataset.zpid));
  const rs = shown().filter((r) => ids.has(r.zpid));
  const say = (t) => { $('msg').textContent = t; };
  if (!rs.length) return say('Tick at least one house.');
  $('make').disabled = true;
  const startText = $('start').value.trim();
  localStorage.routeStart = startText;
  say('Finding your starting point…');
  const start = await locateStart(startText);
  const found = await locateAll(rs, say);
  const located = rs.filter((r) => found[r.zpid]).map((r) => ({ r, loc: found[r.zpid], lat: found[r.zpid].lat, lng: found[r.zpid].lng }));
  const order = HouseRoute.orderStops(located, start).concat(rs.filter((r) => !found[r.zpid]).map((r) => ({ r, loc: null })));
  let total = 0;
  order.forEach((s, i) => {
    const prev = i ? order[i - 1] : start;
    s.miles = s.loc && prev && (prev.lat != null) ? HouseRoute.miles(prev, s) : null;
    if (s.miles != null) total += s.miles;
  });
  const town = $('town').value === 'all' ? 'All towns' : $('town').value;
  const today = new Date();
  document.title = `KEEP houses - ${town} - ${today.toISOString().slice(0, 10)}`;
  const startNote = startText ? (start ? `Starting from ${esc(startText)}` : `Couldn't find "${esc(startText)}" on the map, so the order starts from the best first house`) : 'Ordered to keep the drive short';
  $('sheet').innerHTML = `<div class="sheet"><h1>KEEP houses: ${esc(town)} (${order.length} ${order.length === 1 ? 'house' : 'houses'})</h1>
    <div class="sub">${startNote}. About ${total.toFixed(1)} miles in straight lines between stops (the roads will be longer). Made ${esc(today.toLocaleDateString())} · filter: ${esc(filterName)}</div>
    ${mapsLinks(start, order.filter((s) => s.loc))}
    ${order.map((s, i) => stopCard(s, i, i ? `stop ${i}` : 'the start')).join('')}</div>`;
  say('');
  $('make').disabled = false;
  $('pick').style.display = 'none';
  $('out').style.display = '';
  window.scrollTo(0, 0);
}

$('town').onchange = renderList;
$('list').addEventListener('change', (e) => {
  if (!e.target.matches('input[type=checkbox]')) return;
  if (e.target.checked) unticked.delete(e.target.dataset.zpid); else unticked.add(e.target.dataset.zpid);
});
$('all').onclick = () => { shown().forEach((r) => unticked.delete(r.zpid)); renderList(); };
$('none').onclick = () => { shown().forEach((r) => unticked.add(r.zpid)); renderList(); };
$('make').onclick = make;
$('back').onclick = () => { $('out').style.display = 'none'; $('pick').style.display = ''; document.title = 'Print KEEP houses'; };
$('doPrint').onclick = () => window.print();
$('saveHtml').onclick = async () => {
  const css = await (await fetch('print.css')).text();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(document.title)}</title><style>${css}</style></head><body>${$('sheet').outerHTML}</body></html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = document.title.replace(/[^\w -]+/g, '') + '.html';
  a.click();
};
$('start').value = localStorage.routeStart || '';
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.scores || ch.marks) && $('out').style.display === 'none') load(); });
load();
