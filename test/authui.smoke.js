/* Auth-mode client smoke: with a stubbed WCSync (no real Firebase), prove that
 * (a) the sign-in overlay renders the email form instead of the old team grid,
 * (b) membership arrival grants identity and clears the overlay,
 * (c) an old localStorage whoami grants nothing,
 * (d) mutations dispatch through WCSync.call, not local state writes.
 * Usage: python3 -m http.server 8125 &   node test/authui.smoke.js */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  if (ok) pass++; else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
// page.click() resolves an element handle, then scrolls it into view, then
// clicks it. render() replaces nodes wholesale, so a re-render landing between
// those steps detaches the handle and the suite dies on "Node is detached from
// document" — at random, and far more often on CI's slower runners than here
// (Marc, 9 Aug: three red builds in an evening, none of them a real fault).
// Re-query inside the page instead, the way the #clubCancel step already does.
const tap = async (pg, sel) => { await pg.waitForSelector(sel); await pg.$eval(sel, el => el.click()); };
// The sync.js block below only holds while requests reach puppeteer. Once
// the first page has registered sw.js, the service worker controls every
// later page in this browser and fetches sync.js itself, out of sight of
// request interception: the real sync.js then loaded, read the live league,
// and its season snapshot overwrote the stubbed setup one about 400ms in.
// That was the "waiting room renders without a forced overlay" flake (Ben,
// 15 Oct 2026: 7 runs in 10 failed). Every page bypasses the worker.
const noLiveFirebase = pg => pg.evaluate(() => !performance.getEntriesByType('resource').some(e => /gstatic\.com\/firebasejs/.test(e.name)));
const localRequestOnly = req => {
  const url = new URL(req.url());
  if (url.origin !== new URL(baseUrl).origin || url.pathname === '/js/sync.js' || req.method() !== 'GET') return req.abort();
  return req.continue();
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const p = await browser.newPage();
  await p.setBypassServiceWorker(true);
  p.on('pageerror', e => { fail++; console.log('PAGEERROR', e.message.split('\n')[0]); });

  // Exact field repro: an installed app carries an old local identity, while
  // the live manager array now begins with Toby because it is in draft order.
  // app.js renders synchronously; Firebase Auth + membership arrive later.
  await p.evaluateOnNewDocument(() => {
    localStorage.setItem('tl2627-whoami', '2');
    localStorage.setItem('tl-last-email', 'remembered@example.com');
    localStorage.setItem('tl-auth-email', 'completion-hint@example.com');
    window.__persistRequests = 0;
    Object.defineProperty(navigator, 'storage', { configurable: true, value: {
      persist: () => {
        window.__persistRequests++;
        return new Promise((resolve, reject) => {
          window.__resolvePersist = resolve;
          window.__rejectPersist = reject;
        });
      },
    } });
  });

  // block the real sync.js; we inject a stub after app.js boots
  await p.setRequestInterception(true);
  p.on('request', localRequestOnly);

  await p.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined');

  // bring the stub online while Auth is still unresolved
  await p.evaluate(() => {
    const calls = [];
    window._calls = calls;
    window.WCSync = {
      league: 'the-league-2627',
      call: (action, data) => { calls.push({ action, data }); return Promise.resolve({ ok: true, total: 1, tgw: 2 }); },
      auth: {
        user: () => null,
        sendLink: email => { calls.push({ action: '_sendLink', data: { email } }); return Promise.resolve(); },
        completeLink: () => Promise.resolve(false),
        signOut: () => { calls.push({ action: '_signOut' }); return Promise.resolve(); },
      },
    };
    window.onSyncConnection(true); // connected — mutations are allowed to dispatch
    // a season-phase public snapshot, no pins/claims/autolists (v2 shape)
    const s = freshState();
    s.phase = 'season';
    s.managers = [s.managers.find(m => m.id === 2), ...s.managers.filter(m => m.id !== 2)];
    s.draft.order = s.managers.map(m => m.id);
    delete s.pins;
    window.onSharedSnapshot(JSON.parse(JSON.stringify({
      phase: s.phase, managers: s.managers, settings: s.settings, draft: s.draft,
      lineups: {}, transfers: [], trades: [], covenants: [], waiverMeta: s.waiverMeta,
      adjustments: {}, shirtNums: {}, draftPool: null, windowDraft: null,
      tradeBlock: {}, benchOrders: {}, lobus: {}, hamCup: null,
    })));
  });
  await new Promise(r => setTimeout(r, 300)); // deferred snapshot apply

  chk('stale localStorage identity grants nothing', await p.evaluate(() => whoami === null));
  chk('unresolved startup shows no first-manager dashboard or table highlight', await p.evaluate(() =>
    document.querySelector('#main')?.textContent.includes('Finding your club')
    && !document.querySelector('#main')?.textContent.includes('Your Matchup')
    && ![...document.querySelectorAll('#main tbody tr')].some(tr => tr.getAttribute('style')?.includes('background'))));

  // Firebase says this device is signed out: loading yields to the real sign-in UI.
  await p.evaluate(() => window.onAuthChanged(null));
  await new Promise(r => setTimeout(r, 100));
  chk('sign-in overlay shows the email form', await p.evaluate(() =>
    !!document.querySelector('#whoOverlay #whoEmail') && !document.querySelector('#whoOverlay [data-who="5"]')));
  chk('last successful address is editable prefill, not an authentication hint', await p.evaluate(() =>
    document.querySelector('#whoEmail').value === 'remembered@example.com'
    && localStorage.getItem('tl-auth-email') === 'completion-hint@example.com'
    && whoami === null));
  chk('opening sign-in does not ask for persistent storage', await p.evaluate(() => window.__persistRequests === 0));
  await p.setViewport({ width: 390, height: 844 });
  await p.evaluate(() => { document.querySelector('#whoKeepData').closest('details').open = true; });
  chk('sign-in and storage help fit a phone screen', await p.evaluate(() => {
    const box = document.querySelector('#whoOverlay .card').getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
      && document.querySelector('#whoOverlay').scrollWidth <= innerWidth;
  }));
  if (process.env.AUTH_SCREENSHOT) await p.screenshot({ path: process.env.AUTH_SCREENSHOT });
  await p.evaluate(() => { document.querySelector('#whoKeepData').closest('details').open = false; });
  await p.setViewport({ width: 1280, height: 900 });
  await p.evaluate(() => {
    document.querySelector('#whoEmail').value = '';
    renderIdentity();
  });
  chk('deliberately cleared email stays empty through a redraw', await p.$eval('#whoEmail', el => el.value === ''));

  // A storage answer must not replace either field while the user types.
  await p.evaluate(() => {
    document.querySelector('#whoEmail').value = 'draft@example.com';
    document.querySelector('#whoPaste').value = 'https://example.com/synthetic-link';
    window.__emailNode = document.querySelector('#whoEmail');
    document.querySelector('#whoKeepData').click();
    requestSignInStorage(); // duplicate click while awaiting the browser
  });
  chk('only an explicit request asks for storage and concurrent clicks are suppressed', await p.evaluate(() =>
    window.__persistRequests === 1 && document.querySelector('#whoKeepData').disabled));
  await p.evaluate(() => window.__resolvePersist(false));
  await p.waitForFunction(() => !document.querySelector('#whoKeepData').disabled);
  chk('storage refusal preserves typed email and rescue link without claiming a login fault', await p.evaluate(() =>
    document.querySelector('#whoEmail') === window.__emailNode
    && document.querySelector('#whoEmail').value === 'draft@example.com'
    && document.querySelector('#whoPaste').value === 'https://example.com/synthetic-link'
    && document.querySelector('#whoStorageStatus').textContent.includes('You can still sign in')));
  await p.evaluate(() => document.querySelector('#whoKeepData').click());
  await p.evaluate(() => window.__rejectPersist(new Error('storage unavailable')));
  await p.waitForFunction(() => !document.querySelector('#whoKeepData').disabled);
  chk('storage rejection leaves both sign-in forms usable', await p.evaluate(() =>
    document.querySelector('#whoEmail') === window.__emailNode
    && !document.querySelector('#whoEmailForm button').disabled
    && !document.querySelector('#whoPasteForm button').disabled
    && document.querySelector('#whoStorageStatus').textContent.includes('sign in normally')));
  await p.evaluate(() => document.querySelector('#whoKeepData').click());
  await p.evaluate(() => window.__resolvePersist(true));
  await p.waitForFunction(() => document.querySelector('#whoKeepData').textContent === 'Site data protected');
  chk('storage grant reports its limits and preserves the form', await p.evaluate(() =>
    document.querySelector('#whoEmail') === window.__emailNode
    && document.querySelector('#whoKeepData').disabled
    && document.querySelector('#whoStorageStatus').textContent.includes('can still require another link')));
  await p.evaluate(() => {
    delete navigator.storage.persist;
    renderIdentity();
  });
  chk('unsupported storage API does not block email sign-in', await p.evaluate(() =>
    !document.querySelector('#whoKeepData') && !!document.querySelector('#whoEmailForm')
    && document.querySelector('#whoEmail').value === 'draft@example.com'));

  // Tom, 21 Oct: a callable failure used to surface only "internal". Keep
  // the address, suppress duplicate submits even across redraws, and allow
  // one deliberate retry without ever showing a failed request as sent.
  await p.evaluate(() => {
    window.__originalSendLink = window.WCSync.auth.sendLink;
    window.__linkRequests = 0;
    window.WCSync.auth.sendLink = () => {
      window.__linkRequests++;
      return new Promise((resolve, reject) => { window.__rejectLink = reject; });
    };
    document.querySelector('#whoEmail').value = 'tom@example.com';
    document.querySelector('#whoEmailForm').dispatchEvent(new Event('submit'));
    document.querySelector('#whoEmailForm').dispatchEvent(new Event('submit'));
    renderIdentity(); // public snapshots redraw the overlay during the request
    document.querySelector('#whoEmailForm').dispatchEvent(new Event('submit'));
  });
  chk('pending sign-in request keeps the email and blocks duplicate sends across redraws', await p.evaluate(() =>
    window.__linkRequests === 1 && linkSentTo === null
    && document.querySelector('#whoEmail')?.value === 'tom@example.com'
    && document.querySelector('#whoEmail')?.disabled
    && document.querySelector('#whoEmailForm button')?.disabled));
  await p.evaluate(() => window.__rejectLink(Object.assign(new Error('internal'), { code: 'functions/internal' })));
  await p.waitForFunction(() => !document.querySelector('#whoEmailForm button')?.disabled);
  chk('failed request shows a useful service error instead of internal', await p.evaluate(() =>
    document.querySelector('#toast')?.textContent === 'The sign-in service isn’t responding. Please try again shortly.'));
  chk('failed request keeps the address, restores retry and never claims the link was sent', await p.evaluate(() =>
    document.querySelector('#whoEmail')?.value === 'tom@example.com'
    && !document.querySelector('#whoEmail')?.disabled
    && !document.querySelector('#whoEmailForm button')?.disabled
    && linkSentTo === null && !document.querySelector('#whoOverlay')?.textContent.includes('Link sent to')
    && window.__linkRequests === 1));
  chk('failed request does not replace the remembered address', await p.evaluate(() =>
    localStorage.getItem('tl-last-email') === 'remembered@example.com'));

  // a deliberate retry uses the existing successful send-link flow
  await p.evaluate(() => {
    window.WCSync.auth.sendLink = window.__originalSendLink;
    document.querySelector('#whoEmail').value = 'ben@example.com';
    document.querySelector('#whoEmailForm').dispatchEvent(new Event('submit'));
  });
  await new Promise(r => setTimeout(r, 200));
  chk('email link requested through WCSync.auth', await p.evaluate(() =>
    window._calls.some(c => c.action === '_sendLink' && c.data.email === 'ben@example.com')));
  chk('link-sent state renders', await p.evaluate(() =>
    document.querySelector('#whoOverlay')?.textContent.includes('ben@example.com')));
  chk('successful send remembers only the editable address', await p.evaluate(() =>
    localStorage.getItem('tl-last-email') === 'ben@example.com'
    && localStorage.getItem('tl-auth-email') === 'completion-hint@example.com'));

  // membership arrives → identity granted, overlay clears
  await p.evaluate(() => {
    teamView.mid = 2; // a lens opened during startup must not remain Toby
    window.onAuthChanged({ uid: 'u-test', email: 'ben@example.com' });
    window.onMembershipSnapshot({ managerId: 1, role: 'commissioner' });
  });
  await new Promise(r => setTimeout(r, 200));
  chk('membership grants identity', await p.evaluate(() => whoami === 1 && isCommissioner()));
  chk('membership replaces a startup first-manager team lens', await p.evaluate(() => teamView.mid === 1));
  chk('overlay clears once signed in', await p.evaluate(() => !document.querySelector('#whoOverlay')));

  // private snapshot feeds own claims/autolist
  await p.evaluate(() => window.onPrivateSnapshot({ autolist: [10, 20], claims: { 2: [{ in: 30, out: 40 }] } }));
  chk('private node populates own autolist/claims', await p.evaluate(() =>
    JSON.stringify(state.autolists[1]) === '[10,20]' && state.claims[2]?.[1]?.length === 1));

  // a mutation dispatches through the callable, not a local write
  const before = await p.evaluate(() => window._calls.length);
  await p.evaluate(() => setAutolist(1, [99]));
  chk('mutation goes through WCSync.call', await p.evaluate(b =>
    window._calls.slice(b).some(c => c.action === 'autolistSet' && c.data.pids[0] === 99), before));
  await p.evaluate(() => setClaims(1, [{ in: 1, out: 2 }]));
  chk('claims go through WCSync.call', await p.evaluate(() =>
    window._calls.some(c => c.action === 'claimSet')));

  // sign-out control present in the sync area
  chk('sync area shows the signed-in name', await p.evaluate(() =>
    document.querySelector('#whoBtn')?.textContent.includes('Ben')));

  /* sol club-office P1.2: the pre-draft waiting room — the header "Sign in"
     button must summon the overlay (render used to return before
     renderIdentity on the setup branch, leaving the button dead) */
  const p2 = await browser.newPage();
  await p2.setBypassServiceWorker(true);
  p2.on('pageerror', e => { fail++; console.log('PAGEERROR', e.message.split('\n')[0]); });
  await p2.setRequestInterception(true);
  p2.on('request', localRequestOnly);
  await p2.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => typeof state !== 'undefined');
  await p2.evaluate(() => {
    window.WCSync = {
      league: 'the-league-2627',
      call: () => Promise.resolve({ ok: true }),
      auth: { user: () => null, sendLink: () => Promise.resolve(), completeLink: () => Promise.resolve(false), signOut: () => Promise.resolve() },
    };
    window.onAuthChanged(null); // the blocked sync module would deliver this
    window.onSyncConnection(true);
    const s = freshState();
    window.onSharedSnapshot(JSON.parse(JSON.stringify({
      phase: 'setup', managers: s.managers, settings: s.settings, draft: s.draft,
      lineups: {}, transfers: [], trades: [], covenants: [], waiverMeta: s.waiverMeta,
      adjustments: {}, shirtNums: {}, draftPool: null, windowDraft: null,
      tradeBlock: {}, benchOrders: {}, lobus: {}, hamCup: null,
    })));
  });
  await new Promise(r => setTimeout(r, 300));
  chk('setup: waiting room renders without a forced overlay', await p2.evaluate(() =>
    !document.querySelector('#whoOverlay') && !!document.querySelector('#whoBtn')));
  await tap(p2, '#whoBtn');
  await new Promise(r => setTimeout(r, 200));
  chk('setup: header Sign in summons the email overlay (sol P1.2)', await p2.evaluate(() =>
    !!document.querySelector('#whoOverlay #whoEmail')));
  chk('a new page remembers the successful email without silently signing in', await p2.evaluate(() =>
    document.querySelector('#whoEmail').value === 'ben@example.com' && whoami === null));

  // Browser storage can be denied independently of the auth stub: the email
  // request still succeeds, and unavailable convenience storage is harmless.
  await p2.evaluate(() => {
    const getItem = Storage.prototype.getItem, setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function(k) { if (k === LAST_EMAIL_KEY) throw new Error('denied'); return getItem.call(this, k); };
    Storage.prototype.setItem = function(k, v) { if (k === LAST_EMAIL_KEY) throw new Error('denied'); return setItem.call(this, k, v); };
    window.__restoreStorage = () => { Storage.prototype.getItem = getItem; Storage.prototype.setItem = setItem; };
    window.__blockedRead = lastSignInEmail();
    document.querySelector('#whoEmail').value = 'storage-blocked@example.com';
    document.querySelector('#whoEmailForm').dispatchEvent(new Event('submit'));
  });
  await p2.waitForFunction(() => linkSentTo === 'storage-blocked@example.com');
  chk('unavailable email storage does not turn a successful request into failure', await p2.evaluate(() =>
    window.__blockedRead === '' && document.querySelector('#whoOverlay').textContent.includes('Link sent to')));
  await p2.evaluate(() => window.__restoreStorage());

  /* the club-office save contract (sol r2): a rejected save keeps the form,
     Cancel goes dead while a save is in flight, success closes + marks founded */
  await p2.evaluate(() => {
    forceIdentity = false;
    window.onAuthChanged({ uid: 'u-two', email: 'two@example.com' });
    window.onMembershipSnapshot({ managerId: 2, role: 'manager' });
    let mode = 'reject', release = null;
    window.__saveMode = m => { mode = m; };
    window.__releaseSave = () => release && release();
    window.WCSync.call = () => {
      if (mode === 'reject') return Promise.reject(new Error('the Committee refused'));
      if (mode === 'hang') return new Promise(res => { release = () => res({ ok: true }); });
      return Promise.resolve({ ok: true });
    };
  });
  await new Promise(r => setTimeout(r, 200));
  await p2.evaluate(() => { state.view = 'club'; render(); });
  await tap(p2, '#clubEdit');
  chk('office opens with keyboard focus inside', await p2.evaluate(() => document.activeElement?.id === 'clubName'));
  await tap(p2, '#clubSave');
  await new Promise(r => setTimeout(r, 250));
  chk('rejected save keeps the office open, Save re-enabled, not marked founded (sol P2.1)', await p2.evaluate(() =>
    !!document.querySelector('.club-office') && !document.querySelector('#clubSave').disabled
    && !localStorage.getItem('tl2627-founded-2')));
  await p2.evaluate(() => window.__saveMode('hang'));
  await tap(p2, '#clubSave');
  await new Promise(r => setTimeout(r, 100));
  chk('Cancel is dead while the save is in flight (sol r2 P3)', await p2.evaluate(() => {
    document.querySelector('#clubCancel').click();
    return !!document.querySelector('.club-office') && document.querySelector('#clubCancel').disabled;
  }));
  await p2.evaluate(() => window.__releaseSave());
  await new Promise(r => setTimeout(r, 250));
  chk('successful save closes the office and marks founded', await p2.evaluate(() =>
    !document.querySelector('.club-office') && localStorage.getItem('tl2627-founded-2') === '1'));

  chk('no page loaded the live Firebase SDK', await noLiveFirebase(p) && await noLiveFirebase(p2));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
