// Tests the Google Drive copy with Chrome and the Drive API faked. Run: node drive-test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { JSDOM } = require('jsdom');
const EXT = path.join(__dirname, '..', 'extension');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 20; i++) await tick(); };

// A fake Drive that only holds this extension's files (like the drive.file scope).
function fakeDrive() {
  const d = { files: [], calls: [], offline: false, expireNext: false, failStatus: 0, nextId: 1 };
  d.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.hostname === 'geocoding.geo.census.gov') {
      const a = u.searchParams.get('address');
      let h = 0; for (const c of a) h = (h * 31 + c.charCodeAt(0)) % 1000;
      return json({ result: { addressMatches: [{ coordinates: { y: 33.9 + h / 10000, x: -80.3 - h / 10000 } }] } });
    }
    if (u.hostname === 'oauth2.googleapis.com') { d.calls.push('REVOKE'); return json({}); }
    if (d.offline) throw new TypeError('Failed to fetch');
    if (d.expireNext) { d.expireNext = false; d.calls.push('401'); return json({ error: { message: 'Invalid Credentials' } }, 401); }
    if (d.failStatus) { d.calls.push(String(d.failStatus)); return json({ error: { message: 'Backend Error' } }, d.failStatus); }
    assert.strictEqual(opts.headers.Authorization, 'Bearer tok-1');
    const m = opts.method;
    if (m === 'GET' && u.pathname === '/drive/v3/files') {
      const name = /name = '(.*)' and trashed = false/.exec(u.searchParams.get('q'))[1].replace(/\\'/g, "'");
      d.calls.push('LIST');
      return json({ files: d.files.filter((f) => f.name === name).map(({ id, name }) => ({ id, name })) });
    }
    if (m === 'POST' && u.pathname === '/upload/drive/v3/files') {
      const body = Buffer.from(await opts.body.arrayBuffer()).toString('latin1');
      const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/.exec(body)[1]);
      const pdf = body.slice(body.indexOf('%PDF'), body.lastIndexOf('%%EOF') + 5);
      const f = { id: 'file-' + d.nextId++, name: meta.name, mimeType: meta.mimeType, bytes: Buffer.from(pdf, 'latin1') };
      d.files.push(f);
      d.calls.push('CREATE');
      return json({ id: f.id, name: f.name });
    }
    const up = /^\/upload\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
    if (m === 'PATCH' && up && u.searchParams.get('uploadType') === 'media') {
      const f = d.files.find((x) => x.id === decodeURIComponent(up[1]));
      if (!f) return json({ error: { message: 'File not found' } }, 404);
      f.bytes = Buffer.from(opts.body);
      d.calls.push('UPDATE');
      return json({ id: f.id, name: f.name });
    }
    throw new Error(`unexpected ${m} ${url}`);
  };
  return d;
}
const json = (o, status = 200) => ({ ok: status < 400, status, json: async () => o, text: async () => JSON.stringify(o) });

// The background service worker with fake chrome.* APIs.
function boot({ clientId = '1234-test.apps.googleusercontent.com', data = {}, drive = fakeDrive(), clock = { t: Date.parse('2026-11-17T15:00:00Z') } } = {}) {
  const store = JSON.parse(JSON.stringify(data));
  const listeners = { changed: [], alarm: [], startup: [], installed: [], message: [] };
  const alarms = {};
  const identity = { signedIn: true, removed: [], asked: [] };
  const ev = (list) => ({ addListener: (f) => list.push(f) });
  const chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const ks = keys == null ? Object.keys(store) : [].concat(keys);
          const out = {};
          for (const k of ks) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
          return out;
        },
        set: async (o) => {
          const ch = {};
          for (const [k, v] of Object.entries(o)) { ch[k] = { oldValue: store[k], newValue: v }; store[k] = JSON.parse(JSON.stringify(v)); }
          setImmediate(() => listeners.changed.forEach((f) => f(ch, 'local')));
        },
      },
      session: { get: async () => ({}), set: async () => {} },
      onChanged: ev(listeners.changed),
    },
    alarms: {
      create: async (name, info) => { alarms[name] = info.when; },
      clear: async (name) => { const had = name in alarms; delete alarms[name]; return had; },
      onAlarm: ev(listeners.alarm),
    },
    identity: {
      getAuthToken: async ({ interactive, scopes }) => {
        identity.asked.push({ interactive, scopes });
        if (!identity.signedIn && !interactive) throw new Error('OAuth2 not granted or revoked.');
        identity.signedIn = true;
        return { token: 'tok-1' };
      },
      removeCachedAuthToken: async ({ token }) => { identity.removed.push(token); },
    },
    runtime: {
      getManifest: () => ({ ...MANIFEST, oauth2: { ...MANIFEST.oauth2, client_id: clientId } }),
      getURL: (p) => 'chrome-extension://x/' + p,
      onMessage: ev(listeners.message), onStartup: ev(listeners.startup), onInstalled: ev(listeners.installed),
    },
    action: { onClicked: ev([]) },
    tabs: { create: async () => ({}) },
  };
  let chain = Promise.resolve();
  const ctx = {
    chrome, console, URL, Blob, TextEncoder, Intl, setTimeout, clearTimeout,
    fetch: (...a) => drive.fetch(...a),
    navigator: { locks: { request: (n, fn) => (chain = chain.then(fn, fn)) } },
  };
  ctx.self = ctx;
  const RealDate = Date;
  ctx.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [clock.t])); } static now() { return clock.t; } };
  vm.createContext(ctx);
  ctx.importScripts = (...files) => files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), ctx, { filename: f }));
  vm.runInContext(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  const send = (msg) => new Promise((reply) => listeners.message.forEach((f) => f(msg, {}, reply)));
  // Moves the clock on and fires any alarm that has come due.
  const advance = async (ms) => {
    await settle();
    clock.t += ms;
    for (const [name, when] of Object.entries(alarms)) {
      if (when <= clock.t) { delete alarms[name]; listeners.alarm.forEach((f) => f({ name })); }
    }
    await settle();
  };
  return { ctx, store, alarms, identity, drive, clock, listeners, send, advance, set: (o) => chrome.storage.local.set(o) };
}

async function pdfText(bytes) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, verbosity: 0 }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str + (x.hasEOL ? '\n' : ' ')).join('') + '\n';
  return out;
}

// Real scored houses from the saved Zillow pages, all marked KEEP with notes.
function sampleData() {
  const S = require('../extension/scorer.js');
  const dir = path.join(__dirname, '..', 'samples', 'html');
  const scores = {}, marks = {};
  fs.readdirSync(dir).forEach((f, i) => {
    const r = S.scoreDocument(new JSDOM(fs.readFileSync(path.join(dir, f), 'utf8')).window.document, `https://www.zillow.com/homedetails/${i}_zpid/`);
    r.zpid = String(1000 + i);
    if (!r.address) r.address = f.replace(/\.html$/, '').replace(/-/g, ' ') + ', Sumter, SC 29150';
    if (r.facts) { delete r.facts.lat; delete r.facts.lng; }
    scores[r.zpid] = r;
    marks[r.zpid] = { mark: i % 3 === 2 ? 'no' : 'keep', comment: i === 0 ? 'Big oak (front) & "nice" porch \\ check roof' : '', updatedAt: 1 };
  });
  return { scores, marks };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const MIN = 60 * 1000;

test('file name uses the date in America/New_York', () => {
  const D = require('../extension/drive.js');
  assert.strictEqual(D.fileName(new Date('2026-11-18T03:30:00Z')), 'KEEP houses - All towns - 2026-11-17.pdf'); // 10:30pm Eastern
  assert.strictEqual(D.fileName(new Date('2026-11-18T05:30:00Z')), 'KEEP houses - All towns - 2026-11-18.pdf');
  assert.strictEqual(D.fileName(new Date('2026-07-04T03:59:00Z')), 'KEEP houses - All towns - 2026-07-03.pdf'); // daylight time
  assert.deepStrictEqual(MANIFEST.oauth2.scopes, ['https://www.googleapis.com/auth/drive.file']);
});

test('debounce: a burst of changes gives one upload, 60 s after the last change', async () => {
  const b = boot({ data: sampleData() });
  await settle();
  for (let i = 0; i < 5; i++) {
    await b.set({ marks: { ...b.store.marks, 1000: { ...b.store.marks[1000], comment: 'edit ' + i } } });
    await b.advance(10 * 1000);
  }
  assert.deepStrictEqual(b.drive.calls, [], 'nothing uploaded during the burst');
  assert.strictEqual(b.alarms.driveSave, b.clock.t - 10 * 1000 + MIN, 'alarm is 60 s after the last change');
  assert.ok(b.store.driveSync.dirty);
  await b.advance(40 * 1000);
  assert.deepStrictEqual(b.drive.calls, [], 'still waiting at 50 s');
  await b.advance(10 * 1000);
  assert.deepStrictEqual(b.drive.calls, ['LIST', 'CREATE']);
  assert.strictEqual(b.drive.files.length, 1);
  assert.match(await pdfText(b.drive.files[0].bytes), /Your note: edit 4/);
  const s = b.store.driveSync;
  assert.ok(!s.dirty && !s.saving && !s.error && s.lastOkAt === b.clock.t);
  assert.strictEqual(s.lastName, 'KEEP houses - All towns - 2026-11-17.pdf');
  await b.advance(10 * MIN);
  assert.strictEqual(b.drive.calls.length, 2, 'no more uploads without changes');
});

test('every report change schedules a save: KEEP/NO, scoring, notes, clearing, filter', async () => {
  const b = boot({ data: sampleData() });
  await settle();
  const changes = [{ marks: {} }, { scores: {} }, { activeFilter: 'Other' }, { filterSets: {} }];
  for (const c of changes) {
    await b.ctx.chrome.alarms.clear('driveSave');
    await b.set(c);
    await settle();
    assert.ok(b.alarms.driveSave, 'scheduled after ' + Object.keys(c));
  }
  await b.ctx.chrome.alarms.clear('driveSave');
  await b.set({ geo: {}, searches: {}, scanQueue: [] });
  await settle();
  assert.ok(!b.alarms.driveSave, 'map lookups and scan bookkeeping do not schedule a save');
});

test('create vs update: one file per day, updated in place', async () => {
  const b = boot({ data: sampleData() });
  await settle();
  await b.send({ type: 'driveSaveNow' });
  assert.deepStrictEqual(b.drive.calls, ['LIST', 'CREATE']);
  const id = b.drive.files[0].id;

  await b.set({ marks: { ...b.store.marks, 1000: { ...b.store.marks[1000], comment: 'second visit' } } });
  await b.advance(MIN);
  assert.deepStrictEqual(b.drive.calls.slice(2), ['LIST', 'UPDATE']);
  assert.strictEqual(b.drive.files.length, 1);
  assert.strictEqual(b.store.driveSync.fileId, id);
  assert.match(await pdfText(b.drive.files[0].bytes), /Your note: second visit/);

  // The extension forgot the file (new PC, cleared data): it still finds today's file by name and updates it.
  await b.set({ driveSync: {} });
  await b.send({ type: 'driveSaveNow' });
  assert.deepStrictEqual(b.drive.calls.slice(4), ['LIST', 'UPDATE']);
  assert.strictEqual(b.drive.files.length, 1);

  // An automatic save with nothing new in the report doesn't upload again.
  await b.set({ scores: b.store.scores });
  await b.advance(MIN);
  assert.strictEqual(b.drive.calls.length, 6);

  // Next day (Eastern): a new file.
  b.clock.t = Date.parse('2026-11-18T12:00:00Z');
  await b.set({ marks: { ...b.store.marks, 1001: { mark: 'keep', comment: 'day two', updatedAt: 2 } } });
  await b.advance(MIN);
  assert.deepStrictEqual(b.drive.calls.slice(6), ['LIST', 'CREATE']);
  assert.deepStrictEqual(b.drive.files.map((f) => f.name), ['KEEP houses - All towns - 2026-11-17.pdf', 'KEEP houses - All towns - 2026-11-18.pdf']);
});

test('failure and retry: offline, then the next change catches up; local data is untouched', async () => {
  const b = boot({ data: sampleData() });
  await settle();
  await b.send({ type: 'driveSaveNow' });
  b.drive.offline = true;
  const marks = { ...b.store.marks, 1000: { ...b.store.marks[1000], comment: 'offline edit' } };
  await b.set({ marks });
  await b.advance(MIN);
  let s = b.store.driveSync;
  assert.ok(s.dirty && !s.saving);
  assert.match(s.error, /Couldn't reach Google Drive/);
  assert.strictEqual(s.errorAt, b.clock.t);
  assert.strictEqual(b.store.marks[1000].comment, 'offline edit', 'the saved note is still there');
  assert.ok(!b.alarms.driveSave, 'no retry loop while offline');

  // Scoring keeps working while offline.
  const scores = { ...b.store.scores, 9999: { ...b.store.scores[1000], zpid: '9999', address: '1 New Rd, Sumter, SC' } };
  await b.set({ scores, marks: { ...b.store.marks, 9999: { mark: 'keep', comment: 'new one', updatedAt: 3 } } });
  b.drive.offline = false;
  await b.advance(MIN);
  s = b.store.driveSync;
  assert.ok(!s.dirty && !s.error && s.lastOkAt === b.clock.t);
  assert.deepStrictEqual(b.drive.calls.filter((c) => c === 'CREATE').length, 1, 'still one file');
  const text = await pdfText(b.drive.files[0].bytes);
  assert.match(text, /Your note: offline edit/);
  assert.match(text, /1 New Rd, Sumter, SC/);
});

test('failure and retry: a queued save runs again when Chrome starts', async () => {
  const b = boot({ data: sampleData() });
  await settle();
  b.drive.failStatus = 503;
  await b.send({ type: 'driveSaveNow' });
  assert.match(b.store.driveSync.error, /Google Drive said no \(503: Backend Error\)/);

  // Chrome restarts: a new service worker with the same storage.
  b.drive.failStatus = 0;
  const b2 = boot({ data: b.store, drive: b.drive, clock: b.clock });
  b2.listeners.startup.forEach((f) => f());
  await settle();
  assert.ok(b2.alarms.driveSave <= b.clock.t + 5000, 'retry scheduled at start-up');
  await b2.advance(5000);
  assert.ok(!b2.store.driveSync.error && !b2.store.driveSync.dirty);
  assert.strictEqual(b.drive.files.length, 1);
});

test('expired token: drops it, gets a fresh one, and finishes the save', async () => {
  const b = boot({ data: sampleData() });
  await settle();
  b.drive.expireNext = true;
  await b.send({ type: 'driveSaveNow' });
  assert.deepStrictEqual(b.identity.removed, ['tok-1']);
  assert.deepStrictEqual(b.drive.calls, ['401', 'LIST', 'CREATE']);
  assert.ok(!b.store.driveSync.error);
});

test('sign-in: automatic saves never pop up sign-in; the button does', async () => {
  const b = boot({ data: sampleData() });
  b.identity.signedIn = false;
  await settle();
  await b.set({ marks: {} });
  await b.advance(MIN);
  assert.match(b.store.driveSync.error, /Not signed in to Google Drive/);
  assert.ok(b.identity.asked.every((a) => !a.interactive));
  assert.strictEqual(JSON.stringify(b.identity.asked[0].scopes), '["https://www.googleapis.com/auth/drive.file"]');
  await b.send({ type: 'driveSaveNow' });
  assert.ok(b.identity.asked.at(-1).interactive);
  assert.ok(!b.store.driveSync.error && b.drive.files.length === 1);
});

test('disconnect: stops automatic saves until "Save to Drive now"', async () => {
  const b = boot({ data: sampleData() });
  await settle();
  await b.send({ type: 'driveSaveNow' });
  await b.send({ type: 'driveDisconnect' });
  assert.ok(b.store.driveSync.disconnected);
  assert.deepStrictEqual(b.identity.removed, ['tok-1']);
  assert.ok(b.drive.calls.includes('REVOKE'));
  const before = b.drive.calls.length;
  await b.set({ marks: {} });
  await b.advance(MIN);
  assert.strictEqual(b.drive.calls.length, before, 'no upload while disconnected');
  assert.match(b.store.driveSync.error, /disconnected/);
  await b.send({ type: 'driveSaveNow' });
  assert.ok(!b.store.driveSync.disconnected && !b.store.driveSync.error);
  assert.deepStrictEqual(b.drive.calls.slice(-2), ['LIST', 'UPDATE']);
});

test('disconnect while a save is uploading: stays disconnected', async () => {
  const b = boot({ data: sampleData() });
  await settle();
  await b.send({ type: 'driveSaveNow' });
  await b.set({ marks: {} });
  let release;
  const realFetch = b.drive.fetch;
  b.drive.fetch = async (...a) => { await new Promise((r) => { release = r; }); b.drive.fetch = realFetch; return realFetch(...a); };
  await b.advance(MIN); // the automatic save starts and waits on Drive
  const off = b.send({ type: 'driveDisconnect' });
  await settle();
  release();
  await off;
  await settle();
  assert.ok(b.store.driveSync.disconnected, 'still disconnected after the save finished');
  const before = b.drive.calls.length;
  await b.set({ marks: { 1000: { mark: 'keep', updatedAt: 9 } } });
  await b.advance(MIN);
  assert.strictEqual(b.drive.calls.length, before);
});

test('not set up: the placeholder client ID gives a clear message and no upload', async () => {
  const b = boot({ data: sampleData(), clientId: MANIFEST.oauth2.client_id });
  await settle();
  await b.send({ type: 'driveSaveNow' });
  assert.match(b.store.driveSync.error, /not set up yet/);
  assert.deepStrictEqual(b.drive.calls, []);
  assert.deepStrictEqual(b.identity.asked, []);
});

test('the PDF has the printed list as real text, in driving order from 2911 Waverly Rd', async () => {
  const data = sampleData();
  const b = boot({ data });
  await settle();
  await b.send({ type: 'driveSaveNow' });
  const f = b.drive.files[0];
  assert.strictEqual(f.mimeType, 'application/pdf');
  const text = await pdfText(f.bytes);
  const S = require('../extension/scorer.js');
  const kept = Object.values(data.scores).filter((r) => data.marks[r.zpid].mark === 'keep');
  assert.match(text, new RegExp(`KEEP houses: All towns \\(${kept.length} houses\\)`));
  assert.match(text, /Starting from 2911 Waverly Rd, Sumter, SC\./);
  assert.match(text, /Made Nov 17, 2026, 10:00 AM \(Eastern time\)/);
  assert.match(text, /Your note: Big oak \(front\) & "nice" porch \\ check roof/);
  for (const r of kept) {
    const h = S.houseInfo(r);
    assert.ok(text.includes(r.address), r.address);
    if (h.price != null) assert.ok(text.includes('$' + Math.round(h.price).toLocaleString('en-US')), 'price ' + r.address);
    if (h.yearBuilt != null) assert.ok(text.includes('Built ' + h.yearBuilt), 'year ' + r.address);
  }
  for (const r of Object.values(data.scores).filter((r) => data.marks[r.zpid].mark === 'no')) assert.ok(!text.includes(r.address), 'NO house left out');
  assert.strictEqual((text.match(/^Score -?\d+ \w+/gm) || []).length, kept.length, 'a score for every house');
  assert.match(text, /Has: /);
  assert.match(text, /mi from the start/);
  // Same order as the print view: HouseKeepList.order from the same start.
  const nums = [...text.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => m[1]);
  assert.deepStrictEqual(nums, kept.map((_, i) => String(i + 1)));
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('ok   ' + t.name); } catch (e) { failed++; console.log('FAIL ' + t.name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); }
  }
  console.log(failed ? `${failed} failed` : `all ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
