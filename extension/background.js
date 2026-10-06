const reportUrl = () => chrome.runtime.getURL('results.html');

chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: reportUrl() }));

async function scanTabs() {
  const { scanTabs = {} } = await chrome.storage.session.get('scanTabs');
  return scanTabs;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    const tabs = await scanTabs();
    switch (msg.type) {
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
