// Saved filter presets in chrome.storage.local: filterSets {name: config}, activeFilter name.
(function (root) {
  const S = root.HouseScorer;
  const DEFAULT_NAME = 'Original checklist';

  async function load() {
    const { filterSets, activeFilter } = await chrome.storage.local.get(['filterSets', 'activeFilter']);
    const sets = filterSets && Object.keys(filterSets).length ? filterSets : { [DEFAULT_NAME]: S.DEFAULT_CONFIG };
    const active = sets[activeFilter] ? activeFilter : Object.keys(sets)[0];
    return { sets, active, cfg: S.normalizeConfig(sets[active]) };
  }

  // Read-modify-write of shared storage keys, serialized across all open extension pages.
  const withLock = (fn) => navigator.locks.request('house-scorer-storage', fn);

  const saveSet = (name, cfg, replaceName) => withLock(async () => {
    const { sets } = await load();
    sets[name] = S.normalizeConfig(cfg);
    const { filterTimes = {} } = await chrome.storage.local.get('filterTimes');
    filterTimes[name] = Date.now();
    if (replaceName && replaceName !== name) { delete sets[replaceName]; delete filterTimes[replaceName]; }
    await chrome.storage.local.set({ filterSets: sets, activeFilter: name, filterTimes });
  });

  const setActive = (name) => chrome.storage.local.set({ activeFilter: name });

  const deleteSet = (name) => withLock(async () => {
    const { sets, active } = await load();
    delete sets[name];
    const names = Object.keys(sets);
    if (!names.length) return false;
    const { filterTimes = {} } = await chrome.storage.local.get('filterTimes');
    delete filterTimes[name];
    await chrome.storage.local.set({ filterSets: sets, activeFilter: active === name ? names[0] : active, filterTimes });
    return true;
  });

  const isFilterChange = (ch) => !!(ch.filterSets || ch.activeFilter);

  const BACKUP_KEYS = ['scores', 'marks', 'filterSets', 'activeFilter', 'filterTimes'];

  async function backupData() {
    return { app: 'house-scorer', version: 1, savedAt: Date.now(), data: await chrome.storage.local.get(BACKUP_KEYS) };
  }

  // Merges a backup into this PC's data: per house and per filter, the newer copy wins; nothing here is deleted.
  const mergeBackup = (backup) => withLock(async () => {
    if (!backup || backup.app !== 'house-scorer' || !backup.data) throw new Error('This file is not a House Scorer backup.');
    const b = backup.data;
    const cur = await chrome.storage.local.get(BACKUP_KEYS);
    const count = { housesAdded: 0, housesUpdated: 0, marks: 0, filters: 0 };
    const scores = cur.scores || {};
    for (const [z, r] of Object.entries(b.scores || {})) {
      if (!scores[z]) { scores[z] = r; count.housesAdded++; }
      else if ((r.scoredAt || 0) > (scores[z].scoredAt || 0)) { scores[z] = r; count.housesUpdated++; }
    }
    const marks = cur.marks || {};
    for (const [z, m] of Object.entries(b.marks || {})) {
      if (!marks[z] || (m.updatedAt || 0) > (marks[z].updatedAt || 0)) { marks[z] = m; count.marks++; }
    }
    const curSets = cur.filterSets && Object.keys(cur.filterSets).length ? cur.filterSets : null;
    const sets = curSets || {};
    const times = cur.filterTimes || {};
    for (const [n, c] of Object.entries(b.filterSets || {})) {
      const bt = (b.filterTimes || {})[n] || 0;
      if (!sets[n] || bt > (times[n] || 0)) {
        if (JSON.stringify(sets[n]) !== JSON.stringify(S.normalizeConfig(c))) count.filters++;
        sets[n] = S.normalizeConfig(c);
        times[n] = bt;
      }
    }
    const out = { scores, marks, filterTimes: times };
    if (Object.keys(sets).length) {
      out.filterSets = sets;
      if (!curSets && b.activeFilter && sets[b.activeFilter]) out.activeFilter = b.activeFilter;
    }
    await chrome.storage.local.set(out);
    return count;
  });

  root.HouseFilters = { DEFAULT_NAME, load, saveSet, setActive, deleteSet, isFilterChange, withLock, backupData, mergeBackup };
})(typeof self !== 'undefined' ? self : this);
