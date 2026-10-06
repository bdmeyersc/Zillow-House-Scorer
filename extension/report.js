(function (root) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n) => (n == null ? '?' : '$' + Math.round(n).toLocaleString('en-US'));
  const STATE_LABEL = { yes: 'Yes', partial: 'Partly', unknown: '?', no: 'No' };
  const WANT_KEYS = [
    ['screened', 'Screened back porch', 30],
    ['fence', 'Fenced backyard', 25],
    ['patio', 'Patio for grill', 20],
    ['shed', 'Shed / workshop', 15],
    ['sprinkler', 'Sprinklers', 10],
  ];

  const STYLE = `
  body{font-family:Segoe UI,Arial,sans-serif;font-size:17px;margin:20px;color:#1d2433;background:#f6f7fb}
  h1{font-size:28px;margin:0 0 4px} h2{font-size:22px;margin:28px 0 8px}
  .sub{color:#555;margin-bottom:14px}
  table{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 1px 3px #0002}
  th,td{border-bottom:1px solid #e3e6ee;padding:10px 8px;text-align:left;vertical-align:top}
  th{background:#2a3f6b;color:#fff;font-weight:600;position:sticky;top:0}
  th small{display:block;font-weight:400;opacity:.8}
  td.score{font-size:26px;font-weight:700;text-align:center}
  a{color:#0b5ad6;font-weight:600;text-decoration:none} a:hover{text-decoration:underline}
  .tag{display:inline-block;padding:3px 10px;border-radius:12px;font-weight:700;font-size:15px}
  .Match{background:#d8f5dd;color:#13692a}.Check{background:#fff1c9;color:#7a5600}.Rejected{background:#fde0e0;color:#a11}
  .st{font-weight:700} .yes{color:#13692a}.partial{color:#9a6a00}.unknown{color:#777}.no{color:#c02020}
  .why{display:block;font-size:13px;color:#666;max-width:220px}
  .notes{font-size:14px;color:#7a5600}.fail{color:#a11}
  .legend{font-size:15px;color:#444;margin:10px 0 18px}
  `;

  function wantCell(r, key) {
    const w = r.wants.find((x) => x.key === key);
    if (!w) return '<td></td>';
    const pts = w.points > 0 ? `+${w.points}` : `${w.points}`;
    return `<td><span class="st ${w.state}">${STATE_LABEL[w.state]} (${pts})</span><span class="why">${esc(w.why)}</span></td>`;
  }

  function row(r, rank) {
    const notes = r.musts.filter((m) => m.status !== 'pass')
      .map((m) => `<div class="${m.status === 'fail' ? 'fail' : ''}">${m.status === 'fail' ? 'No: ' : 'Check: '}${esc(m.name)}: ${esc(m.detail)}</div>`).join('');
    const up = r.upstairs.value === 'yes' ? 'Yes' : r.upstairs.value === 'no' ? 'No' : '?';
    return `<tr>
      <td>${rank}</td>
      <td class="score">${r.score}</td>
      <td><span class="tag ${r.verdict}">${r.verdict === 'Check' ? 'Check' : r.verdict}</span></td>
      <td><a href="${esc(r.url)}" target="_blank">${esc(r.address || r.url)}</a><div>${money(r.price)} · ${r.beds ?? '?'} bd / ${r.baths ?? '?'} ba · ${r.sqft ? r.sqft.toLocaleString() : '?'} sq ft · upstairs room: ${up}</div><div class="notes">${notes}</div></td>
      ${WANT_KEYS.map(([k]) => wantCell(r, k)).join('')}
    </tr>`;
  }

  function table(rows, start) {
    return `<table><thead><tr><th>#</th><th>Score<small>max 100</small></th><th>Status</th><th>House</th>
      ${WANT_KEYS.map(([, n, p]) => `<th>${n}<small>${p} pts</small></th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => row(r, start + i)).join('')}</tbody></table>`;
  }

  function sortResults(results) {
    return results.slice().sort((a, b) => b.score - a.score || a.unknowns - b.unknowns || (a.price || 0) - (b.price || 0));
  }

  function renderBody(results, generatedAt) {
    const keep = sortResults(results.filter((r) => r.verdict !== 'Rejected'));
    const rejected = sortResults(results.filter((r) => r.verdict === 'Rejected'));
    return `<h1>House Scorer: ${keep.length} possible, ${rejected.length} ruled out</h1>
      <div class="sub">${results.length} listings scored${generatedAt ? ' · ' + esc(generatedAt) : ''}</div>
      <div class="legend"><span class="tag Match">Match</span> meets every must-have &nbsp; <span class="tag Check">Check</span> a must-have isn't in the listing (call the agent or look at photos) &nbsp; <span class="tag Rejected">Rejected</span> fails a must-have<br>
      "?" means the listing doesn't say, which is worth 0 points. Must-haves: $250K–$360K, 3 bedrooms, 2+ full baths, 1,600–2,000 sq ft (up to 2,350 with an upstairs room), 2-car garage.</div>
      ${keep.length ? table(keep, 1) : '<p>No houses passed yet.</p>'}
      ${rejected.length ? `<h2>Ruled out (${rejected.length})</h2>${table(rejected, 1)}` : ''}`;
  }

  function renderPage(results, generatedAt) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>House Scorer report</title><style>${STYLE}</style></head><body>${renderBody(results, generatedAt)}</body></html>`;
  }

  const api = { STYLE, renderBody, renderPage, sortResults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HouseReport = api;
})(typeof self !== 'undefined' ? self : this);
