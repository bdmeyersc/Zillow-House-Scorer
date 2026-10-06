const S = HouseScorer;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const MUSTS = [
  { key: 'price', label: 'Price', parts: ['from $', ['min', 10000], 'to $', ['max', 10000]] },
  { key: 'beds', label: 'Bedrooms', parts: ['from', ['min', 1], 'to', ['max', 1]] },
  { key: 'baths', label: 'Full bathrooms', parts: ['at least', ['minFull', 1], '(half baths don\'t count, so 3/2.5 passes at 2)'] },
  { key: 'sqft', label: 'Square feet', parts: ['at least', ['min', 50], '; at most', ['maxNoUpstairs', 50], 'with no upstairs room, or', ['maxUpstairs', 50], 'with one'] },
  { key: 'garage', label: 'Garage', parts: ['at least', ['min', 1], 'cars'] },
];
const STATE_LABEL = { yes: 'Has it', partial: 'Partly', no: 'Clearly missing' };

let state; // { sets, active, cfg }
let dirty = false;

function msg(text, warn) { $('msg').textContent = text; $('msg').className = warn ? 'warn' : ''; }

function buildTables() {
  $('musts').innerHTML = '<tr><th>Use</th><th>Must-have</th><th>Setting</th></tr>' + MUSTS.map((m) =>
    `<tr data-row="${m.key}"><td><input type="checkbox" data-path="${m.key}.on"></td><td><b>${m.label}</b></td><td>${m.parts.map((p) =>
      typeof p === 'string' ? esc(p) : `<input type="number" step="${p[1]}" data-path="${m.key}.${p[0]}">`).join(' ')}</td></tr>`).join('');
  $('wants').innerHTML = '<tr><th>Use</th><th>Feature</th>' + ['yes', 'partial', 'no'].map((s) => `<th>${STATE_LABEL[s]}</th>`).join('') + '</tr>' +
    S.WANTS.map((w) => `<tr data-row="wants.${w.key}"><td><input type="checkbox" data-path="wants.${w.key}.on"></td><td><b>${w.name}</b></td>${['yes', 'partial', 'no'].map((s) =>
      `<td>${w.states.includes(s) ? `<input type="number" step="5" data-path="wants.${w.key}.${s}">` : '<span class="hint">n/a</span>'}</td>`).join('')}</tr>`).join('');
}

const getPath = (o, p) => p.split('.').reduce((a, k) => a[k], o);
function setPath(o, p, v) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; }

function fill(cfg) {
  document.querySelectorAll('[data-path]').forEach((i) => {
    const v = getPath(cfg, i.dataset.path);
    if (i.type === 'checkbox') i.checked = v; else i.value = v;
  });
  refreshLooks();
}

function readForm() {
  const cfg = S.normalizeConfig(state.cfg);
  document.querySelectorAll('[data-path]').forEach((i) => {
    setPath(cfg, i.dataset.path, i.type === 'checkbox' ? i.checked : i.value === '' ? NaN : Number(i.value));
  });
  return S.normalizeConfig(cfg);
}

function refreshLooks() {
  document.querySelectorAll('tr[data-row]').forEach((tr) => {
    tr.classList.toggle('off', !tr.querySelector('input[type=checkbox]').checked);
  });
  $('max').textContent = S.maxScore(readForm());
  $('delete').disabled = Object.keys(state.sets).length < 2;
}

function problems(cfg) {
  const p = [];
  const blank = [...document.querySelectorAll('input[type=number][data-path]')]
    .filter((i) => i.closest('tr').querySelector('input[type=checkbox]').checked && (i.value.trim() === '' || !Number.isFinite(Number(i.value))));
  if (blank.length) p.push(`${blank.length === 1 ? 'a number box is' : blank.length + ' number boxes are'} empty (${[...new Set(blank.map((i) => i.closest('tr').querySelector('b').textContent))].join(', ')})`);
  if (cfg.price.on && cfg.price.min > cfg.price.max) p.push('lowest price is above the highest price');
  if (cfg.beds.on && cfg.beds.min > cfg.beds.max) p.push('bedrooms "from" is above "to"');
  if (cfg.sqft.on && cfg.sqft.min > Math.max(cfg.sqft.maxNoUpstairs, cfg.sqft.maxUpstairs)) p.push('minimum square feet is above both maximums');
  return p;
}

async function load(note) {
  state = await HouseFilters.load();
  $('sets').innerHTML = Object.keys(state.sets).map((n) => `<option>${esc(n)}</option>`).join('');
  $('sets').value = state.active;
  fill(state.cfg);
  dirty = false;
  msg(note || '');
}

function askName(question, initial) {
  const name = (prompt(question, initial || '') || '').trim();
  if (!name) return null;
  if (state.sets[name] && name !== initial && !confirm(`There is already a filter named "${name}". Replace it?`)) return null;
  return name;
}

function checked(cfg) {
  const p = problems(cfg);
  if (p.length) { msg('Not saved: ' + p.join('; ') + '.', true); return false; }
  return true;
}

document.addEventListener('input', (e) => { if (e.target.dataset.path) { dirty = true; refreshLooks(); msg('Unsaved changes.', true); } });

$('sets').onchange = async (e) => {
  if (dirty && !confirm(`You have unsaved changes to "${state.active}". Throw them away?`)) { e.target.value = state.active; return; }
  await HouseFilters.setActive(e.target.value);
  await load(`Now using "${e.target.value}".`);
};

$('save').onclick = async () => {
  const cfg = readForm();
  if (!checked(cfg)) return;
  await HouseFilters.saveSet(state.active, cfg);
  await load(`Saved "${state.active}".`);
};

$('saveAs').onclick = async () => {
  const cfg = readForm();
  if (!checked(cfg)) return;
  const name = askName('What do you want to name this filter? (for example "Outside" or "Inside")');
  if (!name) return;
  await HouseFilters.saveSet(name, cfg);
  await load(`Saved as "${name}" and now using it.`);
};

$('rename').onclick = async () => {
  const old = state.active;
  const name = askName(`New name for "${old}":`, old);
  if (!name || name === old) return;
  const cfg = dirty ? readForm() : state.cfg;
  if (!checked(cfg)) return;
  await HouseFilters.saveSet(name, cfg, old);
  await load(`Renamed to "${name}".`);
};

$('delete').onclick = async () => {
  if (!confirm(`Delete the filter "${state.active}"?`)) return;
  const name = state.active;
  if (await HouseFilters.deleteSet(name)) await load(`Deleted "${name}".`);
};

$('original').onclick = () => { fill(S.DEFAULT_CONFIG); dirty = true; msg('Original values filled in. Click Save changes to keep them.', true); };
$('report').onclick = () => chrome.runtime.sendMessage({ type: 'openReport' });

chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && HouseFilters.isFilterChange(ch) && !dirty) load($('msg').textContent); });
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

buildTables();
load();
