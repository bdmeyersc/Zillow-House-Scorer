const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ROOT = require('path').join(__dirname, '..');
  const ext = ROOT + '/extension';
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    userDataDir: '/tmp/hs-profile-' + Date.now(),
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP www.zillow.com:443 127.0.0.1:8443', '--ignore-certificate-errors', '--no-sandbox', '--window-size=1400,1000'],
    defaultViewport: { width: 1400, height: 1000 },
  });
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[page]', m.text()));
  await page.goto('https://www.zillow.com/sumter-sc/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#house-scorer-panel', { timeout: 15000 });
  await page.screenshot({ path: ROOT + '/samples/shot_search_panel.png' });
  await page.evaluate(() => [...document.querySelectorAll('#house-scorer-panel button')].find((b) => /Score all/.test(b.textContent)).click());
  let text = '';
  for (let i = 0; i < 120; i++) {
    await sleep(3000);
    text = await page.$eval('#hs-status', (e) => e.innerText);
    if (i % 5 === 0) console.log('status:', text.replace(/\n/g, ' '), '| tabs:', (await browser.pages()).length);
    if (/Finished|Zillow wants/.test(text)) break;
  }
  console.log('FINAL:', text);
  await page.screenshot({ path: ROOT + '/samples/shot_search_done.png' });
  await sleep(2000);
  const pages = await browser.pages();
  const report = pages.find((p) => p.url().startsWith('chrome-extension://'));
  if (report) {
    await report.bringToFront();
    await sleep(1500);
    await report.screenshot({ path: ROOT + '/samples/shot_report.png', fullPage: true });
    console.log('report h1:', await report.$eval('h1', (e) => e.innerText));
    // KEEP / NO marks and notes
    const clickMark = (section, idx, act) => report.evaluate((section, idx, act) => {
      const tables = document.querySelectorAll('#report table');
      tables[section].querySelectorAll('tbody tr')[idx].querySelector(`button[data-act="${act}"]`).click();
    }, section, idx, act);
    await clickMark(0, 0, 'no');
    await sleep(800);
    await clickMark(0, 0, 'keep');
    await sleep(800);
    await report.type('#report table tbody tr.kept textarea.cmt', 'Nice yard, ask about the porch');
    await sleep(1200);
    // simultaneous writes for two houses must both survive
    await report.evaluate(() => {
      const rows = document.querySelectorAll('#report table')[1].querySelectorAll('tbody tr');
      rows[0].querySelector('button[data-act="keep"]').click();
      const ta = rows[1].querySelector('textarea.cmt');
      ta.value = 'Carport only';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      rows[1].querySelector('button[data-act="keep"]').click();
    });
    await sleep(1500);
    const { marks } = await report.evaluate(() => chrome.storage.local.get('marks'));
    console.log('concurrent marks:', JSON.stringify(Object.values(marks).map((m) => [m.mark, m.comment || ''])));
    await report.reload();
    await sleep(1500);
    console.log('after marks h1:', await report.$eval('h1', (e) => e.innerText));
    console.log('sections:', await report.$$eval('#report h2', (els) => els.map((e) => e.innerText)));
    console.log('saved note:', await report.$eval('tr.kept textarea.cmt', (e) => e.value));
    await report.screenshot({ path: ROOT + '/samples/shot_report_marks.png', fullPage: true });

    // Filters page: edit, save under a new name (answering the name prompt)
    const fp = await browser.newPage();
    await fp.goto(report.url().replace('results.html', 'filters.html'));
    await sleep(1000);
    await fp.screenshot({ path: ROOT + '/samples/shot_filters.png', fullPage: true });
    await fp.$eval('[data-path="price.min"]', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await fp.click('#save');
    await sleep(500);
    console.log('blank field save:', await fp.$eval('#msg', (e) => e.innerText));
    await fp.$eval('[data-path="price.min"]', (e) => { e.value = '250000'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await fp.$eval('[data-path="sqft.maxNoUpstairs"]', (e) => { e.value = '2100'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await fp.$eval('[data-path="wants.sprinkler.on"]', (e) => { e.click(); });
    fp.once('dialog', (d) => { console.log('prompt:', d.message()); d.accept('Inside'); });
    await fp.click('#saveAs');
    await sleep(1000);
    console.log('filters msg:', await fp.$eval('#msg', (e) => e.innerText), '| options:', await fp.$$eval('#sets option', (o) => o.map((x) => x.textContent)));
    await fp.screenshot({ path: ROOT + '/samples/shot_filters_saved.png', fullPage: true });
    await report.bringToFront();
    await sleep(1000);
    console.log('report with Inside:', await report.$eval('h1', (e) => e.innerText), '| sub:', await report.$eval('.sub', (e) => e.innerText));
    console.log('columns:', await report.$$eval('#report table:first-of-type th', (t) => t.map((x) => x.innerText.split('\n')[0]).join(', ')));
    await report.screenshot({ path: ROOT + '/samples/shot_report_inside.png', fullPage: true });
    await report.select('#filter', 'Original checklist');
    await sleep(1000);
    console.log('report with Original:', await report.$eval('h1', (e) => e.innerText));
  } else console.log('no report tab; urls:', pages.map((p) => p.url()));
  const lp = await browser.newPage();
  await lp.goto('https://www.zillow.com/homedetails/1296-Winyah-St-Sumter-SC-29150/116199395_zpid/', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  console.log('listing panel:', (await lp.$eval('#hs-status', (e) => e.innerText)).replace(/\n/g, ' | '));
  await lp.screenshot({ path: ROOT + '/samples/shot_listing_panel.png' });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
