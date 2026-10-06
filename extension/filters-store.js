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
    if (replaceName && replaceName !== name) delete sets[replaceName];
    await chrome.storage.local.set({ filterSets: sets, activeFilter: name });
  });

  const setActive = (name) => chrome.storage.local.set({ activeFilter: name });

  const deleteSet = (name) => withLock(async () => {
    const { sets, active } = await load();
    delete sets[name];
    const names = Object.keys(sets);
    if (!names.length) return false;
    await chrome.storage.local.set({ filterSets: sets, activeFilter: active === name ? names[0] : active });
    return true;
  });

  const isFilterChange = (ch) => !!(ch.filterSets || ch.activeFilter);

  root.HouseFilters = { DEFAULT_NAME, load, saveSet, setActive, deleteSet, isFilterChange, withLock };
})(typeof self !== 'undefined' ? self : this);
