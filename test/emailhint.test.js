/* Ben, 4 Nov: optional email hints must not break successful authentication.
 * Executes the real sync.js body in a VM with every Firebase import stubbed.
 * No SDK, browser, emulator or network is used; network primitives reject.
 * Firebase itself remains covered by emaillink.client.smoke.js in test:emu. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'sync.js'), 'utf8');
const body = source.replace(/^import\s[\s\S]*?from\s+(['"])[^'"]+\1;\n/gm, '');
assert.ok(!/^import\s/m.test(body), 'all SDK imports must be stubbed');
const EMAIL_KEY = 'tl-auth-email';
const EMAIL = 'manager@example.test';
const LINK = 'https://league.example.test/?mode=signIn&oobCode=synthetic';
const authError = code => Object.assign(new Error(code), { code });
const blocked = () => { throw new Error('External calls are blocked in emailhint.test.js'); };

async function fixture({ saved = null, fail = [], promptAnswers = [], sendError, signInError, storageGetterFails = false } = {}) {
  const stored = new Map(saved ? [[EMAIL_KEY, saved]] : []);
  const calls = { sent: [], signedIn: [], prompted: [] };
  const auth = { currentUser: null };
  const storage = {
    getItem(key) { if (fail.includes('get')) throw new Error('storage blocked'); return stored.get(key) ?? null; },
    setItem(key, value) { if (fail.includes('set')) throw new Error('storage blocked'); stored.set(key, value); },
    removeItem(key) { if (fail.includes('remove')) throw new Error('storage blocked'); stored.delete(key); },
  };
  const ctx = {
    URLSearchParams, crypto: { randomUUID: () => 'synthetic-request-id' },
    location: new URL('https://league.example.test/'),
    console: { warn: () => {} },
    history: { replaceState(_state, _title, url) { ctx.location = new URL(url, ctx.location); } },
    prompt(message) { calls.prompted.push(message); return promptAnswers.shift() ?? null; },
    fetch: blocked, XMLHttpRequest: blocked, WebSocket: blocked, setTimeout: blocked,
    initializeApp: () => ({}), getDatabase: () => ({}), getAuth: () => auth, getFunctions: () => ({}),
    connectDatabaseEmulator: blocked, connectAuthEmulator: blocked, connectFunctionsEmulator: blocked,
    ref: (_db, key) => key, onValue: () => () => {},
    onAuthStateChanged(_auth, callback) { queueMicrotask(() => callback(auth.currentUser)); return () => {}; },
    signOut: async () => { auth.currentUser = null; },
    isSignInWithEmailLink: (_auth, href) => new URL(href).searchParams.get('mode') === 'signIn',
    signInWithEmailLink: async (_auth, email) => {
      calls.signedIn.push(email);
      if (signInError) throw signInError;
      if (email !== EMAIL) throw authError('auth/invalid-email');
      auth.currentUser = { uid: 'synthetic-manager', email };
    },
    httpsCallable: (_functions, name) => async data => {
      assert.equal(name, 'requestSignInLink', 'only the stubbed sign-in request may run');
      calls.sent.push(data);
      if (sendError) throw sendError;
      return { data: { ok: true } };
    },
  };
  if (storageGetterFails) Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('storage blocked'); } });
  else ctx.localStorage = storage;
  ctx.window = ctx;
  vm.runInNewContext(body, ctx, { filename: 'js/sync.js', timeout: 1000 });
  await Promise.resolve(); // initial auth callbacks, as the real SDK resolves asynchronously
  return { ctx, calls, stored, api: ctx.WCSync.auth, openLink: () => { ctx.location = new URL(LINK); } };
}

let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
(async () => {
  await check('a failed hint write does not fail sending or reuse an older saved email', async () => {
    const f = await fixture({ saved: 'wrong@example.test', fail: ['set'] });
    await f.api.sendLink(EMAIL);
    assert.equal(f.calls.sent.length, 1);
    f.openLink();
    assert.equal(await f.api.completeLink(), true);
    assert.deepEqual(f.calls.signedIn, [EMAIL]);
    assert.equal(f.calls.prompted.length, 0);
    assert.equal(f.ctx.location.search, '');
  });
  await check('blocked localStorage access leaves a successful request usable on this page', async () => {
    const f = await fixture({ storageGetterFails: true });
    await f.api.sendLink(EMAIL);
    f.openLink();
    assert.equal(await f.api.completeLink(), true);
    assert.deepEqual(f.calls.signedIn, [EMAIL]);
    assert.equal(f.calls.prompted.length, 0);
    assert.equal(f.ctx.location.search, '');
  });
  await check('a link opened with unavailable storage asks for the address and completes', async () => {
    const f = await fixture({ fail: ['get', 'remove'], promptAnswers: [EMAIL] });
    f.openLink();
    assert.equal(await f.api.completeLink(), true);
    assert.deepEqual(f.calls.signedIn, [EMAIL]);
    assert.equal(f.calls.prompted.length, 1);
    assert.equal(f.ctx.location.search, '');
  });
  await check('a failed cleanup cannot fail completed sign-in or reuse the hint afterwards', async () => {
    const f = await fixture({ saved: EMAIL, fail: ['remove'] });
    f.openLink();
    assert.equal(await f.api.completeLink(), true);
    assert.equal(f.ctx.location.search, '');
    await f.api.signOut();
    assert.equal(await f.api.completeLink(LINK), false); // user cancels confirmation
    assert.deepEqual(f.calls.signedIn, [EMAIL]);
    assert.equal(f.calls.prompted.length, 1);
  });
  await check('a wrong saved email is not retried after its deletion fails and the user cancels', async () => {
    const f = await fixture({ saved: 'wrong@example.test', fail: ['remove'], promptAnswers: [null, EMAIL] });
    f.openLink();
    assert.equal(await f.api.completeLink(), false);
    assert.equal(f.ctx.location.search, new URL(LINK).search);
    assert.equal(await f.api.completeLink(), true);
    assert.deepEqual(f.calls.signedIn, ['wrong@example.test', EMAIL]);
    assert.equal(f.calls.prompted.length, 2);
    assert.equal(f.ctx.location.search, '');
  });
  await check('a genuine send failure still rejects without saving the unsent address', async () => {
    const error = authError('functions/unavailable');
    const f = await fixture({ sendError: error });
    await assert.rejects(f.api.sendLink(EMAIL), e => e === error);
    assert.equal(f.stored.has(EMAIL_KEY), false);
    f.openLink();
    assert.equal(await f.api.completeLink(), false);
    assert.equal(f.calls.prompted.length, 1);
    assert.deepEqual(f.calls.signedIn, []);
  });
  await check('a network failure still rejects and preserves the pending email hint', async () => {
    const error = authError('auth/network-request-failed');
    const f = await fixture({ saved: EMAIL, signInError: error });
    f.openLink();
    await assert.rejects(f.api.completeLink(), e => e === error);
    assert.equal(f.stored.get(EMAIL_KEY), EMAIL);
    assert.equal(f.calls.prompted.length, 0);
    assert.equal(f.ctx.location.search, new URL(LINK).search);
  });
  console.log(`[emailhint] ${passed} passed; all Firebase calls stubbed, external calls blocked`);
})().catch(error => { console.error(error); process.exitCode = 1; });
