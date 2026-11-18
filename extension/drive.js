// Keeps today's KEEP houses PDF current in Google Drive. Runs in the background service worker.
// State lives in chrome.storage.local.driveSync so the report page can show it:
//   { dirty, dueAt, saving, lastOkAt, lastName, lastHash, fileId, error, errorAt, disconnected }
(function (root) {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const DELAY = 60 * 1000;
  const ALARM = 'driveSave';
  const ZONE = 'America/New_York';
  // Storage keys behind the KEEP report. A change to any of them schedules an upload.
  const WATCHED = ['scores', 'marks', 'filterSets', 'activeFilter'];

  const dayOf = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  const fileName = (t) => `KEEP houses - All towns - ${dayOf(t)}.pdf`;

  class DriveError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  // FNV-1a, enough to tell whether the report changed since the last upload.
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16);
  }

  // deps: { chrome, fetch, now, build } where build(date) -> { text, bytes } (bytes is the PDF).
  function create({ chrome, fetch, now = Date.now, build }) {
    const store = chrome.storage.local;
    const state = async () => (await store.get('driveSync')).driveSync || {};
    const setState = async (change) => {
      const s = { ...(await state()), ...change };
      await store.set({ driveSync: s });
      return s;
    };

    const schedule = async (delay = DELAY) => {
      const dueAt = now() + delay;
      await chrome.alarms.create(ALARM, { when: dueAt });
      return dueAt;
    };

    // Something behind the report changed: save about a minute after the last change.
    async function changed() {
      const at = now();
      const dueAt = await schedule();
      await setState({ dirty: true, dirtyAt: at, dueAt });
    }

    const isWatched = (changes) => WATCHED.some((k) => k in changes);

    function clientId() {
      const id = ((chrome.runtime.getManifest().oauth2 || {}).client_id || '').trim();
      return id && !/PASTE_YOUR_CLIENT_ID/i.test(id) ? id : '';
    }

    async function token(interactive) {
      if (!clientId()) throw new DriveError('setup', 'Google Drive is not set up yet. Follow the SETUP steps in the README.');
      let res;
      try {
        res = await chrome.identity.getAuthToken({ interactive, scopes: [SCOPE] });
      } catch (e) {
        throw new DriveError('signin', interactive ? `Google sign-in didn't finish: ${e.message || e}` : 'Not signed in to Google Drive. Click "Save to Drive now" to sign in.');
      }
      const t = typeof res === 'string' ? res : res && res.token;
      if (!t) throw new DriveError('signin', 'Not signed in to Google Drive. Click "Save to Drive now" to sign in.');
      return t;
    }

    async function call(tok, method, url, body, type) {
      let res;
      try {
        res = await fetch(url, { method, headers: { Authorization: `Bearer ${tok}`, ...(type ? { 'Content-Type': type } : {}) }, body });
      } catch (e) {
        throw new DriveError('offline', "Couldn't reach Google Drive. Are you offline?");
      }
      if (res.status === 401) throw new DriveError('auth', 'Google sign-in expired.');
      if (!res.ok) {
        let why = '';
        try { why = ((await res.json()).error || {}).message || ''; } catch (e) { /* no details */ }
        throw new DriveError('http', `Google Drive said no (${res.status}${why ? ': ' + why : ''}).`);
      }
      return res.json();
    }

    // Update today's file if Drive already has it (only files this extension made are visible), else create it.
    async function put(tok, name, bytes) {
      const q = `name = '${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and trashed = false`;
      const found = await call(tok, 'GET', `${API}/files?q=${encodeURIComponent(q)}&orderBy=createdTime&fields=files(id,name)&spaces=drive`);
      const file = (found.files || [])[0];
      if (file) return call(tok, 'PATCH', `${UPLOAD}/files/${encodeURIComponent(file.id)}?uploadType=media&fields=id,name`, bytes, 'application/pdf');
      const boundary = 'house-scorer-' + now().toString(36);
      const meta = JSON.stringify({ name, mimeType: 'application/pdf' });
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`, bytes, `\r\n--${boundary}--\r\n`]);
      return call(tok, 'POST', `${UPLOAD}/files?uploadType=multipart&fields=id,name`, body, `multipart/related; boundary=${boundary}`);
    }

    let running = null;
    // One save at a time; a save asked for while one runs waits for it, then runs.
    function save(opts = {}) {
      const run = (running || Promise.resolve()).then(() => saveOnce(opts));
      running = run.catch(() => {});
      return run;
    }

    async function saveOnce({ interactive = false } = {}) {
      const s0 = await state();
      if (s0.disconnected && !interactive) {
        return setState({ dirty: true, error: 'Google Drive is disconnected. Click "Save to Drive now" to connect again.', errorAt: now() });
      }
      if (!clientId()) return setState({ saving: false, dirty: true, dueAt: null, error: 'Google Drive is not set up yet. Follow the SETUP steps in the README.', errorCode: 'setup', errorAt: now() });
      const startedAt = now();
      await chrome.alarms.clear(ALARM);
      await setState({ saving: true, savingSince: startedAt });
      try {
        const date = new Date(startedAt);
        const name = fileName(date);
        const { text, bytes } = await build(date);
        const h = hash(text);
        let file = { id: s0.fileId };
        if (interactive || s0.lastName !== name || s0.lastHash !== h || s0.error) {
          let tok = await token(interactive);
          try {
            file = await put(tok, name, bytes);
          } catch (e) {
            if (e.code !== 'auth') throw e;
            await chrome.identity.removeCachedAuthToken({ token: tok });
            tok = await token(interactive);
            file = await put(tok, name, bytes);
          }
        }
        const s = await state();
        const again = (s.dirtyAt || 0) > startedAt;
        const out = await setState({ saving: false, dirty: again, lastOkAt: now(), lastName: name, lastHash: h, fileId: file.id, error: null, errorAt: null, disconnected: false });
        if (again) await setState({ dueAt: await schedule() });
        return out;
      } catch (e) {
        // Keep the change queued; the next change or the next browser start tries again.
        return setState({ saving: false, dirty: true, dueAt: null, error: e.message || String(e), errorCode: e.code || '', errorAt: now() });
      }
    }

    async function disconnect() {
      let tok = null;
      try { tok = await token(false); } catch (e) { /* not signed in */ }
      if (tok) {
        await chrome.identity.removeCachedAuthToken({ token: tok });
        try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: 'POST' }); } catch (e) { /* offline: the token still expires */ }
      }
      await chrome.alarms.clear(ALARM);
      return setState({ disconnected: true, saving: false, dueAt: null, error: null });
    }

    // The service worker (re)started. A save cut off when it last stopped goes back in the queue.
    // On a browser or extension start (fresh = true), also retry a queued save and make today's file if there isn't one yet.
    async function startup(fresh) {
      const s = await state();
      if (s.saving && !running) await setState({ saving: false, dirty: true });
      if (s.disconnected || !clientId()) return;
      if (s.saving && !running || fresh && (s.dirty || s.lastName !== fileName(new Date(now())))) {
        const dueAt = await schedule(5000);
        await setState({ dirty: true, dueAt });
      }
    }

    return { changed, isWatched, save, disconnect, startup, state, ALARM };
  }

  const api = { create, fileName, dayOf, hash, DELAY, SCOPE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HouseDrive = api;
})(typeof self !== 'undefined' ? self : this);
