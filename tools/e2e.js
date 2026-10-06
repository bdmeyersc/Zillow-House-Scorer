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
  } else console.log('no report tab; urls:', pages.map((p) => p.url()));
  const lp = await browser.newPage();
  await lp.goto('https://www.zillow.com/homedetails/1296-Winyah-St-Sumter-SC-29150/116199395_zpid/', { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  console.log('listing panel:', (await lp.$eval('#hs-status', (e) => e.innerText)).replace(/\n/g, ' | '));
  await lp.screenshot({ path: ROOT + '/samples/shot_listing_panel.png' });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
