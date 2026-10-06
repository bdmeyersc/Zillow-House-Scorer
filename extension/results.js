const style = document.createElement('style');
style.textContent = HouseReport.STYLE;
document.head.appendChild(style);

const el = document.getElementById('report');
const markSig = (marks) => JSON.stringify(Object.entries(marks || {}).map(([z, m]) => [z, m.mark || '']).sort());
let lastMarkSig = '';

async function render() {
  const [{ scores = {}, marks = {} }, filters] = await Promise.all([chrome.storage.local.get(['scores', 'marks']), HouseFilters.load()]);
  const sel = document.getElementById('filter');
  sel.innerHTML = Object.keys(filters.sets).map((n) => `<option>${n.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</option>`).join('');
  sel.value = filters.active;
  lastMarkSig = markSig(marks);
  const results = Object.values(scores).map((r) => HouseScorer.rescore(r, filters.cfg));
  if (!results.length) {
    el.innerHTML = '<h1>No houses scored yet</h1><p>Open a Zillow search and click <b>Score all houses in this search</b> in the House Scorer box at the bottom-left of the page.</p>';
    return;
  }
  const newest = Math.max(...results.map((r) => r.scoredAt || 0));
  const y = window.scrollY;
  el.innerHTML = HouseReport.renderBody(results, 'last updated ' + new Date(newest).toLocaleString(),
    { cfg: filters.cfg, marks, interactive: true, filterName: filters.active });
  window.scrollTo(0, y);
}

async function updateMark(zpid, change) {
  const { marks = {} } = await chrome.storage.local.get('marks');
  const m = { ...(marks[zpid] || {}), ...change, updatedAt: Date.now() };
  if (!m.mark && !m.comment) delete marks[zpid]; else marks[zpid] = m;
  await chrome.storage.local.set({ marks });
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

document.getElementById('filter').onchange = (e) => HouseFilters.setActive(e.target.value);
document.getElementById('edit').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('filters.html') });
document.getElementById('refresh').onclick = render;
document.getElementById('clear').onclick = async () => {
  if (!confirm('Remove all scored houses from the report? (Your KEEP / NO marks and notes are kept and come back if you rescan a house.)')) return;
  await chrome.storage.local.set({ scores: {} });
  render();
};
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  // Comment edits don't re-render, so typing isn't interrupted.
  if (ch.scores || HouseFilters.isFilterChange(ch) || (ch.marks && markSig(ch.marks.newValue) !== lastMarkSig)) render();
});
render();
