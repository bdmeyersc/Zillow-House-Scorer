const style = document.createElement('style');
style.textContent = HouseReport.STYLE;
document.head.appendChild(style);

const el = document.getElementById('report');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const markSig = (marks) => JSON.stringify(Object.entries(marks || {}).map(([z, m]) => [z, m.mark || '']).sort());
let lastMarkSig = '';

async function render() {
  const [{ scores = {}, marks = {} }, filters] = await Promise.all([chrome.storage.local.get(['scores', 'marks']), HouseFilters.load()]);
  const sel = document.getElementById('filter');
  sel.innerHTML = Object.keys(filters.sets).map((n) => `<option>${esc(n)}</option>`).join('');
  sel.value = filters.active;
  lastMarkSig = markSig(marks);
  const results = Object.values(scores).map((r) => HouseScorer.rescore(r, filters.cfg));
  const towns = HouseReport.townList(results);
  const tsel = document.getElementById('town');
  const town = localStorage.townView || 'all';
  tsel.innerHTML = `<option value="all">All towns (${results.length})</option>` + towns.map((t) => `<option value="${esc(t.name)}">${esc(t.name)} (${t.count})</option>`).join('');
  tsel.value = towns.some((t) => t.name === town) ? town : 'all';
  const grp = document.getElementById('group');
  grp.checked = localStorage.groupByTown !== 'no';
  grp.disabled = tsel.value !== 'all';
  if (!results.length) {
    el.innerHTML = '<h1>No houses scored yet</h1><p>Open a Zillow search and click <b>Score all houses in this search</b> in the House Scorer box at the bottom-left of the page.</p>';
    return;
  }
  const newest = Math.max(...results.map((r) => r.scoredAt || 0));
  const y = window.scrollY;
  el.innerHTML = HouseReport.renderBody(results, 'last updated ' + new Date(newest).toLocaleString(),
    { cfg: filters.cfg, marks, interactive: true, filterName: filters.active, town: tsel.value, groupByTown: grp.checked });
  window.scrollTo(0, y);
}

const updateMark = (zpid, change) => HouseFilters.withLock(async () => {
  const { marks = {} } = await chrome.storage.local.get('marks');
  const m = { ...(marks[zpid] || {}), ...change, updatedAt: Date.now() };
  marks[zpid] = m; // cleared marks are kept (with updatedAt) so loading an older backup doesn't bring them back
  await chrome.storage.local.set({ marks });
});

// Show notes typed in another report tab without rebuilding the rows.
function syncNotes(marks) {
  el.querySelectorAll('[data-zpid] textarea.cmt').forEach((ta) => {
    const c = ((marks || {})[ta.closest('[data-zpid]').dataset.zpid] || {}).comment || '';
    if (ta !== document.activeElement && ta.value !== c) ta.value = c;
  });
}

el.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const zpid = b.closest('[data-zpid]').dataset.zpid;
  updateMark(zpid, { mark: b.classList.contains('on') ? '' : b.dataset.act });
});

const commentTimers = {};
el.addEventListener('input', (e) => {
  if (!e.target.matches('textarea.cmt')) return;
  const ta = e.target;
  const zpid = ta.closest('[data-zpid]').dataset.zpid;
  clearTimeout(commentTimers[zpid]);
  commentTimers[zpid] = setTimeout(() => updateMark(zpid, { comment: ta.value }), 400);
});

document.getElementById('town').onchange = (e) => { localStorage.townView = e.target.value; render(); };
document.getElementById('group').onchange = (e) => { localStorage.groupByTown = e.target.checked ? 'yes' : 'no'; render(); };
document.getElementById('filter').onchange = (e) => HouseFilters.setActive(e.target.value);
document.getElementById('edit').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('filters.html') });
document.getElementById('refresh').onclick = render;
document.getElementById('clear').onclick = async () => {
  if (!confirm('Remove all scored houses from the report? (Your KEEP / NO marks and notes are kept and come back if you rescan a house.)')) return;
  await chrome.storage.local.set({ scores: {} });
  render();
};
const say = (text) => { const b = document.getElementById('backupMsg'); b.textContent = text; };
document.getElementById('backup').onclick = async () => {
  const text = JSON.stringify(await HouseFilters.backupData());
  const name = `house-scorer-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (window.showSaveFilePicker) {
    let handle;
    try {
      handle = await showSaveFilePicker({ suggestedName: name, id: 'house-scorer-backup', types: [{ description: 'House Scorer backup', accept: { 'application/json': ['.json'] } }] });
    } catch (e) { return; } // cancelled
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    say(`Backup saved as ${handle.name}.`);
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    say(`Backup saved to your Downloads folder as ${name}.`);
  }
};
document.getElementById('restore').onclick = () => document.getElementById('restoreFile').click();
document.getElementById('restoreFile').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const c = await HouseFilters.mergeBackup(JSON.parse(await file.text()));
    say(`Loaded ${file.name}: ${c.housesAdded} new houses, ${c.housesUpdated} houses updated, ${c.marks} KEEP/NO marks or notes updated, ${c.filters} filters updated. Nothing on this PC was deleted.`);
  } catch (err) {
    say(`Couldn't load ${file.name}: ${err.message.includes('JSON') ? 'this file is not a House Scorer backup.' : err.message}`);
  }
};
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  // Comment edits don't re-render, so typing isn't interrupted.
  if (ch.scores || HouseFilters.isFilterChange(ch) || (ch.marks && markSig(ch.marks.newValue) !== lastMarkSig)) render();
  else if (ch.marks) syncNotes(ch.marks.newValue);
});
render();
