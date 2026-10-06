const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const S = require('../extension/scorer.js'), R = require('../extension/report.js');
const ROOT = require('path').join(__dirname, '..');
const dir = ROOT + '/samples/html';
const urls = {};
for (const f of fs.readdirSync(ROOT + '/samples')) {
  if (!f.endsWith('.mhtml')) continue;
  const m = fs.readFileSync(ROOT + '/samples/' + f, 'latin1').match(/Snapshot-Content-Location: (\S+)/);
  urls[f.split(' _ ')[0]] = m && m[1];
}
const results = [];
for (const f of fs.readdirSync(dir)) {
  const name = f.replace(/\.html$/, '');
  const dom = new JSDOM(fs.readFileSync(path.join(dir, f), 'utf8'));
  const r = S.scoreDocument(dom.window.document, urls[name] || '');
  if (!r.address) r.address = name;
  results.push(r);
}
for (const r of R.sortResults(results)) {
  console.log(`\n${r.score}\t${r.verdict}\t${r.address}\t$${r.price} ${r.beds}bd ${r.baths}ba ${r.sqft}sqft up=${r.upstairs.value} (${r.upstairs.why})`);
  r.musts.filter(m => m.status !== 'pass').forEach(m => console.log(`   MUST ${m.status}: ${m.name}: ${m.detail}`));
  r.wants.forEach(w => console.log(`   ${w.name}: ${w.state} ${w.points} | ${w.why}`));
}
fs.writeFileSync(ROOT + '/samples/sample_report.html', R.renderPage(results, 'Sample run on saved listings'));
