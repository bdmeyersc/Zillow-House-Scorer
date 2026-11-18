const S = HouseScorer, R = HouseReport, K = HouseKeepList;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (id) => document.getElementById(id);
const unticked = new Set();
let keep = [], gone = 0, marks = {}, filterName = '';

async function load() {
  const [{ scores = {}, marks: m = {} }, filters] = await Promise.all([chrome.storage.local.get(['scores', 'marks']), HouseFilters.load()]);
  marks = m;
  filterName = filters.active;
  ({ keep, gone } = K.keptHouses(scores, marks, filters.cfg));
  const towns = R.townList(keep).filter((t) => t.count);
  const sel = $('town');
  const prev = sel.value || new URLSearchParams(location.search).get('town');
  sel.innerHTML = `<option value="all">All towns (${keep.length})</option>` + towns.map((t) => `<option value="${esc(t.name)}">${esc(t.name)} (${t.count})</option>`).join('');
  sel.value = towns.some((t) => t.name === prev) ? prev : towns.length === 1 ? towns[0].name : 'all';
  renderList();
}

const shown = () => R.sortResults($('town').value === 'all' ? keep : keep.filter((r) => R.townName(r) === $('town').value));

const sizeText = K.sizeText;

const goneNote = () => {
  if (gone) $('list').insertAdjacentHTML('afterbegin', `<p class="gonenote">${esc(K.goneText(gone))} See the bottom of the report.</p>`);
};

function renderList() {
  const rs = shown();
  if (!rs.length) {
    $('list').innerHTML = keep.length ? '<p>No KEEP houses in this town.</p>' : '<p>You haven\'t marked any houses KEEP yet. Click <b>KEEP</b> next to a house in the report first.</p>';
    $('make').disabled = true;
    goneNote();
    return;
  }
  $('make').disabled = false;
  $('list').innerHTML = `<table class="pick"><thead><tr><th>Print?</th><th>House</th><th>Score</th><th>Your notes</th></tr></thead><tbody>${rs.map((r) => {
    const id = 'cb-' + r.zpid;
    return `<tr><td><input type="checkbox" id="${esc(id)}" data-zpid="${esc(r.zpid)}"${unticked.has(r.zpid) ? '' : ' checked'}></td>
      <td><label for="${esc(id)}"><b>${esc(r.address || r.url)}</b><br>${esc(sizeText(S.houseInfo(r)))}</label></td>
      <td>${r.score} ${esc(r.verdict)}</td><td>${esc((marks[r.zpid] || {}).comment || '')}</td></tr>`;
  }).join('')}</tbody></table>`;
  goneNote();
}

// ---- the printed list ----
function mapsLinks(start, stops) {
  const links = K.mapsUrls(start, stops).map((m) => `<a href="${esc(m.url)}" target="_blank">${esc(m.label)}</a>`);
  return links.length ? `<div class="maps">Directions in Google Maps: ${links.join('')}</div>` : '';
}

function stopCard(s, i, prevLabel) {
  const r = s.r;
  const m = marks[r.zpid] || {};
  const f = K.facts(r);
  const [has, missing, issues] = [f.has, f.missing, f.issues].map((l) => l.map(esc));
  const leg = esc(K.legText(s, prevLabel));
  const warn = K.mapWarning(s);
  return `<div class="stop"><div class="num">${i + 1}</div>
    <div class="addr"><a href="${esc(r.url)}" target="_blank">${esc(r.address || r.url)}</a></div>
    ${leg ? `<div class="leg">${leg}</div>` : ''}
    ${warn ? `<div class="warn">${esc(warn)}</div>` : ''}
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
  const start = await K.locateStart(startText);
  const found = await K.locateAll(rs, say);
  say('Working out the shortest drive by road…');
  const route = await K.routeByRoad(rs, found, start);
  const order = route.stops;
  const town = $('town').value === 'all' ? 'All towns' : $('town').value;
  const today = new Date();
  document.title = `KEEP houses - ${town} - ${today.toISOString().slice(0, 10)}`;
  const startNote = esc(K.startNote(startText, start));
  $('sheet').innerHTML = `<div class="sheet"><h1>KEEP houses: ${esc(town)} (${order.length} ${order.length === 1 ? 'house' : 'houses'})</h1>
    <div class="sub">${startNote}. ${esc(K.distanceText(route))} Made ${esc(today.toLocaleDateString())} · filter: ${esc(filterName)}</div>
    ${mapsLinks(start, order)}
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
$('start').value = localStorage.routeStart ?? K.HOME;
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.scores || ch.marks) && $('out').style.display === 'none') load(); });
load();
