const style = document.createElement('style');
style.textContent = HouseReport.STYLE;
document.head.appendChild(style);

async function render() {
  const { scores = {} } = await chrome.storage.local.get('scores');
  const results = Object.values(scores);
  const el = document.getElementById('report');
  if (!results.length) {
    el.innerHTML = '<h1>No houses scored yet</h1><p>Open a Zillow search and click <b>Score all houses in this search</b> in the House Scorer box at the bottom-left of the page.</p>';
    return;
  }
  const newest = Math.max(...results.map((r) => r.scoredAt || 0));
  el.innerHTML = HouseReport.renderBody(results, 'last updated ' + new Date(newest).toLocaleString());
}

document.getElementById('refresh').onclick = render;
document.getElementById('clear').onclick = async () => {
  if (!confirm('Remove all scored houses from the report?')) return;
  await chrome.storage.local.set({ scores: {} });
  render();
};
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.scores) render(); });
render();
