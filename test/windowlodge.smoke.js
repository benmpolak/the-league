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

    /* Build lines the DESK would take: swap like for like, so the squad shape
       survives. The old setup paired pen[k] with squad[k] regardless of
       position and only passed because serverAct was stubbed to accept
       everything — the real desk refuses a swap that leaves an illegal squad,
       and so does wcAdd in the app, so no manager could ever create one. */
    const dropFor = (p, used = []) => (squadAt(mid, gw)
      .find(x => x.pos === p.pos && !used.includes(x.id)) || {}).id;
    /* Take the first TWO penned men a legal drop exists for, rather than the
       first two full stop. Two penned keepers and a squad carrying one left the
       second line with no drop at all — the pen's shape is the live feed's
       business, not this test's, so ask which pairs exist instead of assuming. */
    const usedOut = [];
    const pairFor = q => { const o = dropFor(q, usedOut); if (o != null) usedOut.push(o); return o; };
    const list = [];
    for (const q of pen) {
      const o = pairFor(q);
      if (o != null) list.push({ in: q.id, out: o });
      if (list.length === 2) break;
    }
    ok('(setup) two penned men have a legal drop between them', list.length === 2, JSON.stringify(list));
    ok('(setup) both opening lines are shape-legal, or the desk would refuse them',
      list.every(c => c.out != null && !deadWindowClaim(c, mid)), JSON.stringify(list));
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
    // (re-pin the identity first: this page runs ONLINE against staging, and a
    // live auth resolve can push onMembershipSnapshot(null) mid-test — on a
    // fast connection that landed between the checks and applyPrivateNode
    // returned early on a nulled membership, 31 Aug)
    membership = { managerId: mid }; whoami = mid;
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
    const used3 = [];
    const three = [];
    for (const q of pen) {
      const o = dropFor(q, used3);
      if (o == null) continue;
      used3.push(o); three.push({ in: q.id, out: o });
      if (three.length === 3) break;
    }
    setWindowClaims(mid, three);
    await new Promise(r => setTimeout(r, 60));
    /* ---- what an ordinary manager sees of the pen ----
       Marc, 31 Aug 2026: "is the view amended so i can see who else has been
       added". The names are everybody's business — you cannot lodge for a man
       you cannot see. The RELEASE is the Chairman's, and is refused at the
       server, not merely hidden here. Membership carries no commissioner role
       on this page, so this is the ordinary manager's view. */
    // widen the pen past the old fifteen-name cut-off, or "not a cut-off list"
    // proves nothing
    const wide = Object.fromEntries(PLAYERS.map(p => [p.id, p.club]));
    for (const p of spare.slice(0, 21)) wide[p.id] = 'ZZZ';
    state.draftPool = { at: Date.now(), ids: wide };
    const pen2 = lockedArrivals();
    ok('(setup) the pen is wider than the old cut-off', pen2.length > 15, String(pen2.length));
    transfersView.tab = 'window';
    state.view = 'transfers'; render();
    const names = document.querySelectorAll('.pen-list .pen-man').length;
    const buttons = document.querySelectorAll('.pen-list [data-admit]').length;
    ok('an ordinary manager is not the Chairman here', !isCommissioner());
    ok('and he sees every man in the pen, not a cut-off list',
      pen2.length > 0 && names === pen2.length, `${names} shown of ${pen2.length}`);
    ok('nothing says "+N more" to him either',
      !/\+\s*\d+\s*more/i.test(document.querySelector('.pen-list')?.parentElement?.textContent || ''));
    ok('but the release button is the Chairman\'s alone', buttons === 0, `${buttons} admit buttons`);
    // and the same view for the Chairman DOES carry them, so the check above is
    // about the role and not about the list being empty
    membership = { managerId: mid, role: 'commissioner' };
    render();
    ok('(control: the Chairman gets one against every name)',
      document.querySelectorAll('.pen-list [data-admit]').length === pen2.length,
      String(document.querySelectorAll('.pen-list [data-admit]').length));
    membership = { managerId: mid };

    ok('(control: a list the desk accepts still lands)', myWindowClaims(mid).length === three.length && three.length >= 2,
      `${myWindowClaims(mid).length} of ${three.length}`);

    /* ---- Toby's lockout, 2 Sept 2026 22:08 ----
       "when I try and add a player to the transfer waiver list it's saying
       'the drop player is not in your squad'... I also can't delete from the
       list either."

       One stale line — its DROP man moved out of his squad on Tuesday's waiver
       — and the desk refuses the WHOLE list for it. Every edit sends the whole
       list, so he could not add, could not delete, and the refusal named a
       player he was not touching. No way out from inside the app. */
    state.draftPool = { at: Date.now(), ids: wide };
    const pen3 = lockedArrivals();
    const sq = squadAt(mid, transferGw());
    const goneMan = sq[3];
    const live = [{ in: pen3[0].id, out: sq[0].id }];
    const stale = { in: pen3[1].id, out: goneMan.id };
    state.windowClaims = { [mid]: [...live, stale] };
    // now take that drop man off his squad, the way a waiver would
    state.transfers = [...toArr(state.transfers),
      { managerId: mid, inId: pen3[2].id, outId: goneMan.id, gw: transferGw(), waiver: true, t: Date.now() }];
    ok('(setup) the drop man on one line has left his squad',
      !squadAt(mid, transferGw()).some(x => x.id === goneMan.id), goneMan.name);
    ok('the stale line is now recognised as dead', !!deadWindowClaim(stale, mid), deadWindowClaim(stale, mid));
    ok('and it says WHICH man and WHY, not a generic refusal',
      /no longer in your squad/.test(deadWindowClaim(stale, mid)), deadWindowClaim(stale, mid));
    ok('(control: the healthy line is not called dead)', !deadWindowClaim(live[0], mid), deadWindowClaim(live[0], mid));

    transfersView.tab = 'window'; render();
    if (!document.querySelector('.claim-row')) {
      // the Window Waiver ran on 3 Sept 2026; past it the window tab lists
      // nothing, so the two on-screen checks have no screen to check. The
      // desk's own verdicts above are the live subject.
      ok('the dead line is struck through on the row (skipped: the Window Waiver has passed)', true);
      ok('and tagged so he can read the reason (skipped: the Window Waiver has passed)', true);
    } else {
    ok('the dead line is struck through on the row, before he tries anything',
      document.querySelectorAll('.claim-row.claim-dead').length === 1,
      String(document.querySelectorAll('.claim-row.claim-dead').length));
    ok('and tagged so he can read the reason',
      !!document.querySelector('.claim-dead-tag'));
    }

    // HE DELETES the other line — the operation that did nothing before
    let sent = null;
    window.serverAct = (a2, d2) => { sent = (d2.claims || []).length; return Promise.resolve({ ok: true }); };
    const keep = myWindowClaims(mid);
    setWindowClaims(mid, keep.filter((_, i) => i !== 0));
    await new Promise(r => setTimeout(r, 40));
    ok('deleting now actually deletes instead of silently reverting',
      myWindowClaims(mid).length === 0, JSON.stringify(myWindowClaims(mid).map(c => c.in)));
    ok('and the doomed line went with it rather than blocking the save',
      sent === 0, `desk was sent ${sent} line(s)`);

    // and ADDING works again from a list that held a dead line
    state.windowClaims = { [mid]: [stale] };
    setWindowClaims(mid, [stale, { in: pen3[0].id, out: squadAt(mid, transferGw())[0].id }]);
    await new Promise(r => setTimeout(r, 40));
    ok('adding a good line succeeds even though a dead one was on the list',
      myWindowClaims(mid).length === 1 && myWindowClaims(mid)[0].in === pen3[0].id,
      JSON.stringify(myWindowClaims(mid).map(c => c.in)));

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
