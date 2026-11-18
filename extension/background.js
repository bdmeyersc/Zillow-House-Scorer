importScripts('scorer.js', 'filters-store.js', 'report.js', 'route.js', 'keeplist.js', 'pdf.js', 'drive.js');

const reportUrl = () => chrome.runtime.getURL('results.html');

// Today's KEEP driving list as a PDF, the same content as the printed "All towns" list.
async function buildKeepPdf(date) {
  const K = HouseKeepList;
  const [{ scores = {}, marks = {} }, filters] = await Promise.all([chrome.storage.local.get(['scores', 'marks']), HouseFilters.load()]);
  const { keep, gone } = K.keptHouses(scores, marks, filters.cfg);
  const start = await K.locateStart(K.HOME);
  const found = await K.locateAll(keep);
  const { stops, total } = K.order(keep, found, start);
  const items = K.textReport({ town: 'All towns', stops, total, start, startText: K.HOME, gone, filterName: filters.active, marks });
  const made = date.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
  const text = JSON.stringify(items);
  const withTime = [items[0], { kind: 'sub', text: `Made ${made} (Eastern time)` }, ...items.slice(1)];
  return { text, bytes: HousePdf.make(withTime, { title: HouseDrive.fileName(date).replace(/\.pdf$/, '') }) };
}

const drive = HouseDrive.create({ chrome, fetch: (...a) => fetch(...a), build: buildKeepPdf });
drive.startup(false);
chrome.runtime.onStartup.addListener(() => drive.startup(true));
chrome.runtime.onInstalled.addListener(() => drive.startup(true));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === drive.ALARM) drive.save(); });
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && drive.isWatched(ch)) drive.changed(); });

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: reportUrl() }));

async function scanTabs() {
  const { scanTabs = {} } = await chrome.storage.session.get('scanTabs');
  return scanTabs;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const tabs = await scanTabs();
    switch (msg.type) {
      case 'driveSaveNow':
        return reply(await drive.save({ interactive: true }));
      case 'driveDisconnect':
        return reply(await drive.disconnect());
      case 'openReport':
        await chrome.tabs.create({ url: reportUrl() });
        return reply({});
      case 'openFilters':
        await chrome.tabs.create({ url: chrome.runtime.getURL('filters.html') });
        return reply({});
      case 'openScan': {
        const t = await chrome.tabs.create({ url: msg.url, active: false, index: sender.tab.index + 1 });
        tabs[t.id] = sender.tab.id;
        await chrome.storage.session.set({ scanTabs: tabs });
        return reply({ tabId: t.id });
      }
      case 'amIScan':
        return reply({ scan: !!(sender.tab && tabs[sender.tab.id]), tabId: sender.tab && sender.tab.id });
      case 'closeTab':
        delete tabs[msg.tabId];
        await chrome.storage.session.set({ scanTabs: tabs });
        try { await chrome.tabs.remove(msg.tabId); } catch (e) { /* already closed */ }
        return reply({});
      case 'releaseTab':
        delete tabs[msg.tabId];
        await chrome.storage.session.set({ scanTabs: tabs });
        try { await chrome.tabs.update(msg.tabId, { active: true }); } catch (e) { /* closed */ }
        return reply({});
      default:
        return reply({});
    }
  })();
  return true;
});
