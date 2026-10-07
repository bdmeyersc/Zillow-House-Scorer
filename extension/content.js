(() => {
  if (window.__houseScorerLoaded) return;
  window.__houseScorerLoaded = true;

  const S = window.HouseScorer;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = (msg) => chrome.runtime.sendMessage(msg);
  const isListing = () => /\/homedetails\//.test(location.pathname);
  const zpidOf = (url) => ((url || '').match(/(\d+)_zpid/) || [])[1];
  const CACHE_HOURS = 24;

  const isBlocked = () => !!document.querySelector('#px-captcha') || /Press & Hold|Access to this page has been denied/.test(document.body ? document.body.innerText.slice(0, 3000) : '');

  function factsReady() {
    const lines = S.textLines(document.body);
    for (let i = 0; i < lines.length - 1; i++) if (lines[i] === 'Facts & features' && lines[i + 1] === 'Interior') return true;
    return false;
  }

  async function waitForFacts(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (isBlocked()) return 'blocked';
      if (factsReady()) return 'ok';
      await sleep(1000);
    }
    return 'timeout';
  }

  async function scoreThisPage() {
    const { cfg } = await window.HouseFilters.load();
    const r = S.scoreDocument(document, location.href.split(/[?#]/)[0], cfg);
    if (!r.zpid || r.zpid === r.address) r.zpid = zpidOf(location.href) || r.address;
    return r;
  }

  async function saveScore(r) {
    const { scores = {} } = await chrome.storage.local.get('scores');
    scores[r.zpid] = { ...r, scoredAt: Date.now() };
    await chrome.storage.local.set({ scores });
  }

  // ---- background "scan tab" mode: opened by a search-page scan, scores itself and reports back ----
  async function runAsScanTab(tabId) {
    const status = await waitForFacts(40000);
    const zpid = zpidOf(location.href);
    if (status === 'ok') {
      await sleep(1500);
      const r = await scoreThisPage();
      await saveScore(r);
      await chrome.storage.local.set({ scanResult: { zpid, status: 'ok', at: Date.now(), tabId } });
    } else {
      await chrome.storage.local.set({ scanResult: { zpid, status, at: Date.now(), tabId } });
    }
  }

  // ---- panel ----
  let scanning = false;
  let stopRequested = false;
  let blockedTab = null;

  const panel = document.createElement('div');
  panel.id = 'house-scorer-panel';
  panel.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;background:#fff;border:2px solid #2a3f6b;border-radius:10px;padding:12px 14px;font:15px "Segoe UI",Arial,sans-serif;color:#1d2433;box-shadow:0 4px 16px rgba(0,0,0,.25);width:290px;max-height:80vh;overflow-y:auto';
  panel.innerHTML = '<div style="font-weight:700;font-size:16px;margin-bottom:6px">House Scorer<span id="hs-min" title="Minimize" style="float:right;cursor:pointer;padding:0 4px">&#8211;</span></div><div id="hs-body"><div id="hs-status" style="margin-bottom:8px"></div><div id="hs-buttons"></div></div>';
  const $ = (id) => panel.querySelector('#' + id);

  function setStatus(html) { $('hs-status').innerHTML = html; }

  function button(label, onClick, primary = true) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `display:block;width:100%;margin-top:6px;padding:8px;font:600 15px "Segoe UI",Arial,sans-serif;border-radius:6px;cursor:pointer;border:1px solid #2a3f6b;${primary ? 'background:#0b5ad6;color:#fff' : 'background:#fff;color:#2a3f6b'}`;
    b.onclick = onClick;
    return b;
  }

  function renderButtons() {
    const box = $('hs-buttons');
    box.innerHTML = '';
    if (scanning) {
      box.appendChild(button('Stop', () => { stopRequested = true; setStatus('Stopping after this house…'); }, false));
      return;
    }
    if (blockedTab) {
      box.appendChild(button('Resume scoring', () => { const t = blockedTab; blockedTab = null; send({ type: 'closeTab', tabId: t }); scoreSearch(); }));
    }
    if (isListing()) box.appendChild(button('Score this house', scoreListingNow));
    else box.appendChild(button('Score all houses in this search', () => scoreSearch()));
    box.appendChild(button('Open report', () => send({ type: 'openReport' }), false));
    box.appendChild(button('See / change filters', () => send({ type: 'openFilters' }), false));
  }

  // Score from the report, re-scored with the filter in use, plus the user's KEEP/NO mark and note.
  async function savedText(zpid) {
    const [{ scores = {}, marks = {} }, filters] = await Promise.all([chrome.storage.local.get(['scores', 'marks']), window.HouseFilters.load()]);
    if (!scores[zpid]) return null;
    const m = marks[zpid] || {};
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const mark = m.mark ? `<div style="margin-top:4px;font-weight:700;color:${m.mark === 'keep' ? '#13692a' : '#a11'}">You marked it ${m.mark === 'keep' ? 'KEEP' : 'NO'}</div>` : '';
    const note = m.comment ? `<div style="font-size:13px;white-space:pre-wrap;margin-top:2px">Note: ${esc(m.comment)}</div>` : '';
    return verdictText(S.rescore(scores[zpid], filters.cfg), filters.active) + mark + note;
  }

  function filterLine(name) {
    return name ? `<div style="font-size:13px;color:#555;margin-bottom:2px">Filter: <b>${String(name).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</b></div>` : '';
  }

  const escHtml = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

  function verdictText(r, filterName) {
    const color = r.verdict === 'Match' ? '#13692a' : r.verdict === 'Check' ? '#7a5600' : '#a11';
    const notes = r.musts.filter((m) => m.status !== 'pass').map((m) => `<div style="font-size:13px;color:${m.status === 'fail' ? '#a11' : '#7a5600'}">${m.status === 'fail' ? 'No' : 'Check'}: ${escHtml(m.name)}: ${escHtml(m.detail)}</div>`).join('');
    const wants = r.wants.map((w) => `<div style="font-size:13px">${escHtml(w.name)}: <b>${({ yes: 'Yes', partial: 'Partly', unknown: '?', no: 'No' })[w.state]}</b> (${w.points > 0 ? '+' : ''}${w.points})</div>`).join('');
    return `${filterLine(filterName)}<div style="font-size:22px;font-weight:700">Score ${r.score} <span style="font-size:15px;color:${color}">${r.verdict}</span></div>${notes}<div style="margin-top:4px">${wants}</div>`;
  }

  async function scoreListingNow() {
    setStatus('Reading this listing…');
    const st = await waitForFacts(15000);
    if (st !== 'ok') { setStatus(st === 'blocked' ? 'Zillow is asking you to prove you are human. Do the "Press & Hold", then try again.' : "Couldn't find the Facts & features section on this page."); return; }
    const r = await scoreThisPage();
    await saveScore(r);
    setStatus((await savedText(r.zpid) || verdictText(r)) + '<div style="font-size:13px;margin-top:4px;color:#555">Saved to the report.</div>');
  }

  function scrollableAncestor(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 50) return n;
    }
    return document.scrollingElement;
  }

  async function collectSearchUrls() {
    const urls = new Set(S.searchListingUrls(document));
    const first = document.querySelector('a[href*="/homedetails/"]');
    if (first) {
      const sc = scrollableAncestor(first);
      const start = sc.scrollTop;
      for (let i = 0; i < 60 && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 5; i++) {
        sc.scrollTop += Math.max(300, sc.clientHeight * 0.8);
        await sleep(400);
        S.searchListingUrls(document).forEach((u) => urls.add(u));
      }
      sc.scrollTop = start;
    }
    return [...urls];
  }

  function waitForScan(zpid, ms) {
    return new Promise((resolve) => {
      const listener = (ch, area) => {
        const v = area === 'local' && ch.scanResult && ch.scanResult.newValue;
        if (v && v.zpid === zpid) { clearTimeout(timer); chrome.storage.onChanged.removeListener(listener); resolve(v); }
      };
      const timer = setTimeout(() => { chrome.storage.onChanged.removeListener(listener); resolve({ status: 'timeout' }); }, ms);
      chrome.storage.onChanged.addListener(listener);
    });
  }

  async function scoreSearch() {
    scanning = true; stopRequested = false;
    renderButtons();
    setStatus('Finding houses in these results…');
    const urls = await collectSearchUrls();
    const { scores = {} } = await chrome.storage.local.get('scores');
    const fresh = (u) => { const s = scores[zpidOf(u)]; return s && s.facts && Date.now() - s.scoredAt < CACHE_HOURS * 3600e3; };
    const todo = urls.filter((u) => !fresh(u));
    let done = 0, failed = 0;
    for (const url of todo) {
      if (stopRequested) break;
      setStatus(`Scoring house ${done + failed + 1} of ${todo.length}<div style="font-size:13px;color:#555">(${urls.length - todo.length} already scored today). A tab opens and closes for each house; please leave them alone.</div>`);
      const { tabId } = await send({ type: 'openScan', url });
      const res = await waitForScan(zpidOf(url), 60000);
      if (res.status === 'blocked') {
        blockedTab = tabId;
        await send({ type: 'releaseTab', tabId });
        scanning = false;
        setStatus('Zillow wants to check you are human. In the tab that just opened, do the "Press & Hold", then come back here and click <b>Resume scoring</b>.');
        renderButtons();
        return;
      }
      await send({ type: 'closeTab', tabId });
      if (res.status === 'ok') done++; else failed++;
      await sleep(3000 + Math.random() * 4000);
    }
    scanning = false;
    const next = document.querySelector('a[title="Next page"]:not([aria-disabled="true"]), a[rel="next"]');
    setStatus(`Finished: ${done} scored${failed ? `, ${failed} couldn't be read` : ''}${urls.length - todo.length ? `, ${urls.length - todo.length} already scored` : ''}.` +
      (next ? '<div style="margin-top:4px">There are more pages: click <b>Next page</b> at the bottom of the list, then click the button again.</div>' : ''));
    renderButtons();
    if (done) send({ type: 'openReport' });
  }

  async function init() {
    const me = await send({ type: 'amIScan' });
    if (me && me.scan) return runAsScanTab(me.tabId);

    document.body.appendChild(panel);
    $('hs-min').onclick = () => { const b = $('hs-body'); b.style.display = b.style.display === 'none' ? '' : 'none'; };
    let lastUrl = '';
    const onUrl = async () => {
      if (location.href === lastUrl || scanning) return;
      lastUrl = location.href;
      renderButtons();
      if (isListing()) {
        const text = await savedText(zpidOf(location.href));
        if (text) setStatus(text + '<div style="font-size:13px;margin-top:4px;color:#555">From the report. Click "Score this house" to re-read it.</div>');
        else scoreListingNow();
      } else if (!blockedTab) {
        setStatus('Set your Zillow filters, then click below.');
      }
    };
    onUrl();
    setInterval(onUrl, 1000);
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && (window.HouseFilters.isFilterChange(ch) || ch.marks) && isListing() && !scanning) { lastUrl = ''; onUrl(); }
    });
  }

  init();
})();
