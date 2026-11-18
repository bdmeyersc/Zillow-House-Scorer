// A small PDF writer: Letter pages of wrapped Helvetica text. The text stays real, selectable text.
(function (root) {
  // Helvetica character widths (1/1000 em) for ASCII 32-126.
  const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
    278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611,
    722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  // WinAnsi codes for the few non-Latin-1 characters the report uses.
  const WIN = { '€': 128, '‚': 130, '„': 132, '…': 133, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '™': 153 };
  const SWAP = { '→': '->', '−': '-', '≈': '~', '\u00a0': ' ' };

  // Text as WinAnsi bytes (one char per byte); anything else becomes '?'.
  function winAnsi(s) {
    let out = '';
    for (const ch of String(s ?? '').replace(/[\t\r\n]+/g, ' ')) {
      const c = ch.codePointAt(0);
      if (SWAP[ch]) out += SWAP[ch];
      else if (c >= 32 && c < 127 || c >= 160 && c < 256) out += ch;
      else if (WIN[ch]) out += String.fromCharCode(WIN[ch]);
      else out += '?';
    }
    return out;
  }

  const width = (s, size, bold) => {
    let w = 0;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); w += c >= 32 && c < 127 ? W[c - 32] : 556; }
    return w / 1000 * size * (bold ? 1.1 : 1); // bold runs a little wider
  };

  function wrap(s, size, bold, max) {
    const lines = [];
    let cur = '';
    for (const word of s.split(' ')) {
      const next = cur ? cur + ' ' + word : word;
      if (width(next, size, bold) <= max) { cur = next; continue; }
      if (cur) lines.push(cur);
      cur = word;
      while (width(cur, size, bold) > max) { // a word too long for one line (a URL)
        let k = cur.length - 1;
        while (k > 1 && width(cur.slice(0, k), size, bold) > max) k--;
        lines.push(cur.slice(0, k));
        cur = cur.slice(k);
      }
    }
    if (cur || !lines.length) lines.push(cur);
    return lines;
  }

  const pdfString = (s) => '(' + s.replace(/[\\()]/g, (c) => '\\' + c) + ')';

  const STYLE = {
    title: { size: 18, bold: true, before: 0, after: 6 },
    sub: { size: 10, bold: false, before: 0, after: 2 },
    head: { size: 13, bold: true, before: 12, after: 2 },
    line: { size: 10.5, bold: false, before: 0, after: 1 },
    note: { size: 10, bold: false, before: 0, after: 1, indent: 10 },
    link: { size: 8, bold: false, before: 0, after: 1 },
  };

  // items: [{ text, kind, url? }] (kinds in STYLE); an item with a url is a clickable link. Returns the PDF file as a Uint8Array.
  function make(items, { title = '' } = {}) {
    const PW = 612, PH = 792, M = 54;
    const pages = [];
    let ops = [], links = [], y = PH - M;
    const newPage = () => { pages.push({ ops, links }); ops = []; links = []; y = PH - M; };
    for (const it of items) {
      const st = STYLE[it.kind] || STYLE.line;
      const x = M + (st.indent || 0);
      const lead = st.size * 1.25;
      const lines = wrap(winAnsi(it.text), st.size, st.bold, PW - M - x);
      if (y - st.before - lead * Math.min(lines.length, 2) < M) newPage();
      else y -= st.before;
      for (const ln of lines) {
        if (y - lead < M) newPage();
        y -= lead;
        ops.push(`BT /${st.bold ? 'F2' : 'F1'} ${st.size} Tf ${x} ${y.toFixed(2)} Td ${pdfString(ln)} Tj ET`);
        if (it.url) links.push({ url: winAnsi(it.url), rect: [x, y - st.size * 0.25, x + width(ln, st.size, st.bold), y + st.size * 0.9].map((v) => v.toFixed(2)) });
      }
      y -= st.after;
    }
    pages.push({ ops, links });

    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add(null); // page tree, filled in below
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = pages.map((p) => {
      const stream = p.ops.join('\n');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const annots = p.links.map((l) => add(`<< /Type /Annot /Subtype /Link /Rect [${l.rect.join(' ')}] /Border [0 0 0] /A << /S /URI /URI ${pdfString(l.url)} >> >>`));
      const annotRef = annots.length ? ` /Annots [${annots.map((a) => a + ' 0 R').join(' ')}]` : '';
      return add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R${annotRef} >>`);
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title ${pdfString(winAnsi(title))} /Producer (House Scorer for Zillow) >>`);

    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets = objs.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }

  root.HousePdf = { make, winAnsi, wrap };
})(typeof self !== 'undefined' ? self : this);
