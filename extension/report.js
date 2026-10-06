(function (root) {
  const S = typeof module !== 'undefined' && module.exports ? require('./scorer.js') : root.HouseScorer;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n) => (n == null ? '?' : '$' + Math.round(n).toLocaleString('en-US'));
  const STATE_LABEL = { yes: 'Yes', partial: 'Partly', unknown: '?', no: 'No' };

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
  tr.kept td{background:#eefaf0}
  tr.excluded td{background:#f3f3f3;color:#666}
  td.mine{width:210px}
  .mk{font:700 15px Segoe UI,Arial,sans-serif;padding:5px 12px;border-radius:6px;cursor:pointer;border:2px solid #999;background:#fff;color:#555;margin:0 4px 6px 0}
  .mk.keep.on{background:#13692a;border-color:#13692a;color:#fff}
  .mk.no.on{background:#a11;border-color:#a11;color:#fff}
  .mk.keep:hover{border-color:#13692a}.mk.no:hover{border-color:#a11}
  textarea.cmt{width:100%;box-sizing:border-box;min-height:58px;font:14px Segoe UI,Arial,sans-serif;padding:5px;border:1px solid #c5cad6;border-radius:5px;resize:vertical}
  .markbadge{display:inline-block;font-weight:700;font-size:14px;padding:2px 8px;border-radius:5px;color:#fff}
  .markbadge.keep{background:#13692a}.markbadge.no{background:#a11}
  .cmttext{font-size:14px;white-space:pre-wrap;margin-top:4px}
  .old{font-size:13px;color:#a11}
  `;

  function wantCell(r, key) {
    const w = r.wants.find((x) => x.key === key);
    if (!w) return '<td></td>';
    const pts = w.points > 0 ? `+${w.points}` : `${w.points}`;
    return `<td><span class="st ${w.state}">${STATE_LABEL[w.state]} (${pts})</span><span class="why">${esc(w.why)}</span></td>`;
  }

  function mineCell(r, m, interactive) {
    if (interactive) {
      return `<td class="mine" data-zpid="${esc(r.zpid)}">
        <button class="mk keep${m.mark === 'keep' ? ' on' : ''}" data-act="keep" title="Mark as a house to keep">KEEP</button><button class="mk no${m.mark === 'no' ? ' on' : ''}" data-act="no" title="Move to Manually Excluded">NO</button>
        <textarea class="cmt" placeholder="Your notes: why keep it or rule it out">${esc(m.comment)}</textarea></td>`;
    }
    const badge = m.mark ? `<span class="markbadge ${m.mark}">${m.mark === 'keep' ? 'KEEP' : 'NO'}</span>` : '';
    return `<td class="mine">${badge}${m.comment ? `<div class="cmttext">${esc(m.comment)}</div>` : ''}</td>`;
  }

  function row(r, rank, ctx) {
    const m = ctx.marks[r.zpid] || {};
    const notes = r.musts.filter((x) => x.status !== 'pass')
      .map((x) => `<div class="${x.status === 'fail' ? 'fail' : ''}">${x.status === 'fail' ? 'No: ' : 'Check: '}${esc(x.name)}: ${esc(x.detail)}</div>`).join('');
    const up = r.upstairs.value === 'yes' ? 'Yes' : r.upstairs.value === 'no' ? 'No' : '?';
    const cls = m.mark === 'keep' ? 'kept' : m.mark === 'no' ? 'excluded' : '';
    return `<tr class="${cls}">
      <td>${rank}</td>
      <td class="score">${r.score}</td>
      <td><span class="tag ${r.verdict}">${r.verdict}</span></td>
      ${mineCell(r, m, ctx.interactive)}
      <td><a href="${esc(r.url)}" target="_blank">${esc(r.address || r.url)}</a><div>${money(r.price)} · ${r.beds ?? '?'} bd / ${r.baths ?? '?'} ba · ${r.sqft ? r.sqft.toLocaleString() : '?'} sq ft · upstairs room: ${up}</div><div class="notes">${notes}</div>${r.legacy ? '<div class="old">Scored by the old version with the original filter. Rescan to apply your current filter.</div>' : ''}</td>
      ${ctx.wantCols.map((w) => wantCell(r, w.key)).join('')}
    </tr>`;
  }

  function table(rows, ctx) {
    return `<table><thead><tr><th>#</th><th>Score<small>max ${ctx.max}</small></th><th>Status</th><th>Keep / No<small>and your notes</small></th><th>House</th>
      ${ctx.wantCols.map((w) => `<th>${w.short}<small>${ctx.cfg.wants[w.key].yes} pts</small></th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => row(r, i + 1, ctx)).join('')}</tbody></table>`;
  }

  function sortResults(results) {
    return results.slice().sort((a, b) => b.score - a.score || a.unknowns - b.unknowns || (a.price || 0) - (b.price || 0));
  }

  // results must already be scored with opts.cfg (see HouseScorer.rescore).
  function renderBody(results, generatedAt, opts = {}) {
    const cfg = S.normalizeConfig(opts.cfg);
    const marks = opts.marks || {};
    const ctx = { cfg, marks, interactive: !!opts.interactive, max: S.maxScore(cfg), wantCols: S.WANTS.filter((w) => cfg.wants[w.key].on) };
    const isNo = (r) => (marks[r.zpid] || {}).mark === 'no';
    const keep = sortResults(results.filter((r) => r.verdict !== 'Rejected' && !isNo(r)));
    const rejected = sortResults(results.filter((r) => r.verdict === 'Rejected' && !isNo(r)));
    const excluded = sortResults(results.filter(isNo));
    const musts = S.describeMusts(cfg);
    return `<h1>House Scorer: ${keep.length} possible, ${rejected.length} ruled out, ${excluded.length} manually excluded</h1>
      <div class="sub">${results.length} listings scored${opts.filterName ? ` · filter: <b>${esc(opts.filterName)}</b>` : ''}${generatedAt ? ' · ' + esc(generatedAt) : ''}</div>
      <div class="legend"><span class="tag Match">Match</span> meets every must-have &nbsp; <span class="tag Check">Check</span> a must-have isn't in the listing (call the agent or look at photos) &nbsp; <span class="tag Rejected">Rejected</span> fails a must-have<br>
      "?" means the listing doesn't say, which is worth 0 points. Must-haves: ${musts.length ? esc(musts.join(', ')) : 'none'}.${ctx.interactive ? '<br>Click <b>NO</b> to move a house to Manually Excluded (click it again to undo). Notes save as you type.' : ''}</div>
      ${keep.length ? table(keep, ctx) : '<p>No houses passed yet.</p>'}
      ${rejected.length ? `<h2>Ruled out (${rejected.length})</h2>${table(rejected, ctx)}` : ''}
      ${excluded.length ? `<h2>Manually Excluded (${excluded.length})</h2>${table(excluded, ctx)}` : ''}`;
  }

  function renderPage(results, generatedAt, opts) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>House Scorer report</title><style>${STYLE}</style></head><body>${renderBody(results, generatedAt, opts)}</body></html>`;
  }

  const api = { STYLE, renderBody, renderPage, sortResults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HouseReport = api;
})(typeof self !== 'undefined' ? self : this);
