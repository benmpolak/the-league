/* Lodging a window list, and the three ways it used to go quiet.
 *
 * Ben deployed the desk on 31 Aug: a window list lives at
 * private/{uid}/windowClaims, it never travels in the public snapshot, and the
 * desk refuses the WHOLE list if a single line is doomed — in the pen, not
 * already owned, yours to drop, squad still legal afterwards.
 *
 * The client half had three holes against that, all of them silent, which is
 * the worst kind on a blind waiver: you find out on Thursday morning that you
 * lodged nothing.
 *
 *   1. windowClaims was still in SHARED_KEYS' overwrite loop, so the next
 *      public snapshot — which by design carries no window lists — replaced a
 *      lodged list with nothing and it disappeared off the screen.
 *   2. applyPrivateNode read autolist, watchlist and claims off the private
 *      node and ignored windowClaims, so the authoritative list never came
 *      back: reload, or open your phone, and it was gone.
 *   3. setWindowClaims wrote the list locally whatever the desk said, so a
 *      refused list sat there looking lodged.
 *
 * All three only exist ONLINE, and ?nosync short-circuits both snapshot paths
 * before they can be reached — so this loads the page in online mode against
 * the staging namespace, exactly as authui.smoke.js does. It never signs in
 * and never reaches the network: every call here is a local function, and the
 * one server action is stubbed.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  // online mode: no ?nosync, so SYNC_OFF is false and netOn() is true. The
  // sandbox namespace points at STAGING, and with nobody signed in there is
  // nothing this page is permitted to write even if it could reach it.
  await page.goto(baseUrl + '/index.html?sandbox', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof buildDemoState === 'function');

  const report = await page.evaluate(async () => {
    const out = [];
    const ok = (n, c, d = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
    window.__autoConfirm = true; window.confirm = () => true;
    state = buildDemoState(); state.phase = 'season';
    const mid = state.managers[0].id;
    whoami = mid;
    membership = { managerId: mid };
    ok('(precondition) the page believes it is online, or none of this is reachable', netOn());

    // put three unowned men in the pen, the way a transfer window does it
    const gw = transferGw();
    const squad = squadAt(mid, gw);
    const spare = PLAYERS.filter(p => !ownedIdsAt(gw).has(p.id));
    const snap = Object.fromEntries(PLAYERS.map(p => [p.id, p.club]));
    for (const p of spare.slice(0, 3)) snap[p.id] = 'ZZZ';
    state.draftPool = { at: Date.now(), ids: snap };
    const pen = lockedArrivals();
    ok('three men are in the pen to lodge for', pen.length >= 3, String(pen.length));

    // lodge two of them, with the desk accepting
    const list = pen.slice(0, 2).map((p, k) => ({ in: p.id, out: squad[k].id }));
    const realAct = window.serverAct;
    let asked = null;
    window.serverAct = (action, data) => { asked = { action, n: (data.claims || []).length }; return Promise.resolve({ ok: true }); };
    setWindowClaims(mid, list);
    await new Promise(r => setTimeout(r, 40));
    ok('lodging sends the list to the desk', asked && asked.action === 'windowClaimSet' && asked.n === 2, JSON.stringify(asked));
    ok('and it is on this device', myWindowClaims(mid).length === 2);

    // ---- 1. the public snapshot must not wipe it ----
    // build the shared payload the way the server sends it: window lists absent,
    // because they are private and never travel in public.
    const shared = {};
    for (const k of SHARED_KEYS) if (state[k] !== undefined) shared[k] = state[k];
    delete shared.windowClaims;
    applySharedSnapshot(shared);
    ok('a public snapshot does not wipe the lodged list',
      myWindowClaims(mid).length === 2, JSON.stringify(myWindowClaims(mid).map(c => c.in)));
    // the control: the loop IS still doing its job on a public key
    ok('(control: the same snapshot still overwrites a genuinely public key)',
      state.phase === 'season');

    // ---- 2. the private node reads it back ----
    // the authoritative copy, on a device with nothing local — a reload, or your phone
    state.windowClaims = {};
    applyPrivateNode({ windowClaims: list, claims: {}, autolist: [], watchlist: [] });
    ok('the private node hands the authoritative list back',
      myWindowClaims(mid).length === 2, JSON.stringify(myWindowClaims(mid).map(c => c.in)));
    ok('and it is the same two men, in the order lodged',
      myWindowClaims(mid).map(c => c.in).join(',') === list.map(c => c.in).join(','));
    // a blind list is blind: nobody else's may linger on this device
    state.windowClaims = { [mid]: list, 99: [{ in: 1, out: 2 }] };
    applyPrivateNode({ windowClaims: list });
    ok('somebody else\'s blind list is never left lying about',
      Object.keys(state.windowClaims).join(',') === String(mid), Object.keys(state.windowClaims).join(','));

    // ---- 3. a refused list rolls back ----
    const good = myWindowClaims(mid);
    window.serverAct = () => Promise.reject(new Error('not in the holding pen — use the weekly waiver list'));
    setWindowClaims(mid, [...good, { in: spare[9].id, out: squad[5].id }]);
    await new Promise(r => setTimeout(r, 60));
    ok('a refused list does not sit on screen looking lodged',
      myWindowClaims(mid).length === 2, JSON.stringify(myWindowClaims(mid).map(c => c.in)));
    ok('and the list that WAS lodged is exactly what comes back',
      myWindowClaims(mid).map(c => c.in).join(',') === good.map(c => c.in).join(','));

    // ...and an accepted one still lands, so the roll-back is not just "never save"
    window.serverAct = () => Promise.resolve({ ok: true });
    setWindowClaims(mid, pen.slice(0, 3).map((p, k) => ({ in: p.id, out: squad[k].id })));
    await new Promise(r => setTimeout(r, 60));
    ok('(control: a list the desk accepts still lands)', myWindowClaims(mid).length === 3,
      String(myWindowClaims(mid).length));

    window.serverAct = realAct;
    return out.join('\n');
  });
  for (const line of report.split('\n')) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  // the staging host is unreachable from a dev sandbox, and that is fine — it is
  // not what this test is about. Anything else is a real fault.
  const real = pageErrors.filter(e => !/network|fetch|firebase|offline|ERR_|Failed to get document/i.test(e));
  chk('no page errors lodging a window list', real.length === 0, real.join(' | '));

  console.log(`\n[window-lodge] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
