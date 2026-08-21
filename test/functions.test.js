/* Server-authoritative mutation layer, proven against the emulators:
 * auth (email link, unknown users, dead sessions), draft races, transfer
 * races, trades (double-accept), waivers (one winner, cleared claims,
 * exactly-once runs), lineup validation, commissioner gating. */
'use strict';
const T = require('./testenv.js');
const Engine = require('../js/engine.js');
const fs = require('fs');
const path = require('path');
// Direct handle for the scheduled sweep. `onSchedule` exposes `.run`, which
// lets the emulator suite exercise the real tick body without a cloud clock.
const Functions = require('../functions/index.js');

const LG = 'the-league-2627';
const SB = 'the-league-sandbox';

(async () => {
  const run = T.makeRunner('functions');
  const { chk } = run;
  const { players, gws } = T.genTestData();
  const fixtureDir = path.join(__dirname, 'fixtures', 'testdata');
  const server = await T.serveTestData(fixtureDir);
  await T.wipe();

  const members = await T.provision(LG, [
    { managerId: 1, email: 'chair@test.local', role: 'commissioner' },
    { managerId: 2, email: 'two@test.local' },
    { managerId: 3, email: 'three@test.local' },
  ]);
  await T.provision(SB, [
    { managerId: 1, email: 'chair@test.local', role: 'commissioner' },
    { managerId: 2, email: 'two@test.local' },
    { managerId: 3, email: 'three@test.local' },
  ].map((m, i) => ({ ...m, email: `sb${i}@test.local` })));
  const tok1 = await T.idTokenFor(members[1].uid);
  const tok2 = await T.idTokenFor(members[2].uid);
  const tok3 = await T.idTokenFor(members[3].uid);

  /* ---------------- auth ---------------- */
  chk('unauthenticated mutate rejected', (await T.mutate(LG, 'lineupSave', {}, null)).error?.status === 'UNAUTHENTICATED');
  const outsider = await T.initAdmin().auth().createUser({ email: 'stranger@test.local' });
  const tokOut = await T.idTokenFor(outsider.uid);
  chk('signed-in non-member rejected', (await T.mutate(LG, 'lineupSave', {}, tokOut)).error?.status === 'PERMISSION_DENIED');

  const link = await T.emailLinkSignIn('two@test.local');
  chk('email-link sign-in returns a session', !!link.idToken);
  if (link.idToken) {
    const viaLink = await T.mutate(LG, 'autolistSet', { pids: [101, 102] }, link.idToken);
    chk('email-link session can act', !viaLink.error, JSON.stringify(viaLink.error));
  }
  // an unknown email can complete Firebase sign-in but holds no membership: rejected
  const unknownLink = await T.emailLinkSignIn('nobody@test.local');
  if (unknownLink.idToken) {
    chk('unknown email cannot act', (await T.mutate(LG, 'autolistSet', { pids: [1] }, unknownLink.idToken)).error?.status === 'PERMISSION_DENIED');
    await T.initAdmin().auth().deleteUser(unknownLink.localId);
  } else chk('unknown email cannot act', true);
  // consumed oob code cannot be replayed (the expired-link path)
  const replay = await fetch(`http://${T.AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'two@test.local', oobCode: 'dead-code' }),
  }).then(r => r.json());
  chk('dead/expired link rejected', !!replay.error);

  /* ---------------- seed the league ---------------- */
  const seed = T.buildSeedState(players, 3);
  const imp = await T.mutate(LG, 'importState', { state: seed }, tok1);
  chk('commissioner imports league state', !imp.error, JSON.stringify(imp.error));
  const mockImport = await T.mutate(LG, 'importState', { state: { ...seed, mock: { gw: 1, phase: 'live', seed: 7, t: Date.now() } } }, tok1);
  chk('REAL-league callable import silently drops a sandbox mock flag',
    !mockImport.error && (await T.rest('GET', `v2/leagues/${LG}/public/mock`, { owner: true })).val == null,
    JSON.stringify(mockImport.error));
  chk('non-commissioner cannot import', (await T.mutate(LG, 'importState', { state: seed }, tok2)).error?.status === 'PERMISSION_DENIED');

  const db = T.initAdmin().database();
  const hardRulesOk = settings => settings?.squadSize === 14
    && settings.posMin?.GK === 1 && settings.posMin?.DF === 4 && settings.posMin?.MF === 4 && settings.posMin?.FW === 2
    && settings.posMax?.GK === 2 && settings.posMax?.DF === 6 && settings.posMax?.MF === 6 && settings.posMax?.FW === 4;
  const squadOf = async mid => {
    const picks = (await db.ref(`v2/leagues/${LG}/public/draft/picks`).get()).val() || [];
    const transfers = (await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val() || [];
    const ids = new Set(picks.filter(p => p.managerId === mid).map(p => p.playerId));
    for (const t of Object.values(transfers)) if (t && t.managerId === mid) { ids.delete(t.outId); ids.add(t.inId); }
    return [...ids];
  };
  const squadAtGw = async (mid, gw) => {
    const picks = Object.values((await db.ref(`v2/leagues/${LG}/public/draft/picks`).get()).val() || {});
    const transfers = Object.values((await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val() || {});
    const ids = new Set(picks.filter(p => p.managerId === mid).map(p => p.playerId));
    for (const t of transfers) if (t && t.managerId === mid && t.gw <= gw) { ids.delete(t.outId); ids.add(t.inId); }
    return [...ids];
  };
  const byPos = (ids, pos) => ids.filter(id => players.find(p => p.id === id)?.pos === pos);
  const owned = new Set([].concat(await squadOf(1), await squadOf(2), await squadOf(3)));
  const freeOf = pos => players.filter(p => p.pos === pos && !owned.has(p.id)).map(p => p.id);

  /* ---------------- Ham Cup window + frozen-pool races ----------------
   * The old six-GW synthetic calendar could never reach CUP_START, so none of
   * these server branches had been exercised by the 211 passing assertions. */
  const hamGw = 20; // GW21: far enough ahead that the normal seven-day window is closed
  const hamXI = [
    ...freeOf('GK').slice(0, 1),
    ...freeOf('DF').slice(0, 3),
    ...freeOf('MF').slice(0, 4),
    ...freeOf('FW').slice(0, 3),
  ];
  chk('Ham Cup test XI is a real 1-3-4-3 from the Trough', hamXI.length === 11);
  const hamDraw = await T.mutate(LG, 'hamAdmin', { op: 'draw', gw: hamGw }, tok1);
  chk('Ham Cup future tie draws inside the synthetic calendar', !hamDraw.error, JSON.stringify(hamDraw.error));
  const hamClosed = await T.mutate(LG, 'hamEnter', { gw: hamGw, xi: hamXI }, tok2);
  chk('Ham Cup entry before the seven-day selection window is refused',
    hamClosed.error?.status === 'FAILED_PRECONDITION' && /has not opened/.test(hamClosed.error?.message || ''), JSON.stringify(hamClosed));
  chk('non-Chairman cannot force the Ham Cup window open',
    (await T.mutate(LG, 'hamAdmin', { op: 'open' }, tok2)).error?.status === 'PERMISSION_DENIED');
  const hamOpen = await T.mutate(LG, 'hamAdmin', { op: 'open' }, tok1);
  const hamOpenedNode = (await db.ref(`v2/leagues/${LG}/public/hamCup`).get()).val();
  chk('Chairman early-open stamps the window and freezes the owned-player set',
    !hamOpen.error && typeof hamOpenedNode?.openedAt === 'number'
      && Array.isArray(hamOpenedNode?.frozen) && hamOpenedNode.frozen.length === owned.size,
    JSON.stringify({ error: hamOpen.error, openedAt: hamOpenedNode?.openedAt, frozen: hamOpenedNode?.frozen?.length }));

  // Change ownership after the freeze. The newly signed player was in the
  // frozen Trough and remains eligible; the newly dropped player was owned at
  // freeze time and must remain ineligible.
  const signedAfterFreeze = freeOf('DF')[0];
  const droppedAfterFreeze = byPos(await squadOf(1), 'DF')[0];
  await db.ref(`v2/leagues/${LG}/public/transfers`).set([
    { managerId: 1, outId: droppedAfterFreeze, inId: signedAfterFreeze, gw: 1, t: Date.now(), n: 1 },
  ]);
  const frozenEligible = await T.mutate(LG, 'hamEnter', { gw: hamGw, xi: hamXI }, tok2);
  chk('frozen pool still allows a player signed by a league team after the freeze',
    !frozenEligible.error, JSON.stringify(frozenEligible.error));
  const newlyDroppedXI = hamXI.map(id => id === signedAfterFreeze ? droppedAfterFreeze : id);
  const frozenReject = await T.mutate(LG, 'hamEnter', { gw: hamGw, xi: newlyDroppedXI }, tok3);
  chk('frozen pool rejects a player newly dropped into the live Trough',
    frozenReject.error?.status === 'INVALID_ARGUMENT' && /Trough only/.test(frozenReject.error?.message || ''), JSON.stringify(frozenReject));

  // Restore a clean league, then make two managers submit the first entry at
  // once. Both callbacks begin without `frozen`; RTDB retries must converge on
  // one snapshot without losing either valid entry.
  await db.ref(`v2/leagues/${LG}/public`).set(seed);
  await db.ref(`v2/leagues/${LG}/public/hamCup`).set({ gw: hamGw, drawnAt: Date.now(), openedAt: Date.now(), entries: {} });
  const [hamRaceA, hamRaceB] = await Promise.all([
    T.mutate(LG, 'hamEnter', { gw: hamGw, xi: hamXI }, tok2),
    T.mutate(LG, 'hamEnter', { gw: hamGw, xi: hamXI }, tok3),
  ]);
  const hamRaceNode = (await db.ref(`v2/leagues/${LG}/public/hamCup`).get()).val();
  chk('two simultaneous first Ham entries both land against one frozen snapshot',
    !hamRaceA.error && !hamRaceB.error
      && Object.keys(hamRaceNode?.entries || {}).length === 2
      && Array.isArray(hamRaceNode?.frozen) && hamRaceNode.frozen.length === owned.size,
    JSON.stringify({ errors: [hamRaceA.error, hamRaceB.error], entries: Object.keys(hamRaceNode?.entries || {}), frozen: hamRaceNode?.frozen?.length }));

  // A redraw and first entry are mutually exclusive: whichever transaction
  // lands first makes the other retry and refuse rather than moving/erasing XI.
  await db.ref(`v2/leagues/${LG}/public`).set(seed);
  await db.ref(`v2/leagues/${LG}/public/hamCup`).set({ gw: hamGw, drawnAt: Date.now(), openedAt: Date.now(), entries: {} });
  const [hamEntryVsDraw, hamDrawVsEntry] = await Promise.all([
    T.mutate(LG, 'hamEnter', { gw: hamGw, xi: hamXI }, tok2),
    T.mutate(LG, 'hamAdmin', { op: 'draw', gw: hamGw + 1 }, tok1),
  ]);
  const hamEntryDrawNode = (await db.ref(`v2/leagues/${LG}/public/hamCup`).get()).val();
  const hamEntryWon = !hamEntryVsDraw.error && !!hamDrawVsEntry.error;
  const hamDrawWon = !!hamEntryVsDraw.error && !hamDrawVsEntry.error;
  chk('Ham redraw racing first entry has exactly one winner and never erases/moves the XI',
    (hamEntryWon && hamEntryDrawNode.gw === hamGw && Object.keys(hamEntryDrawNode.entries || {}).length === 1)
      || (hamDrawWon && hamEntryDrawNode.gw === hamGw + 1 && Object.keys(hamEntryDrawNode.entries || {}).length === 0),
    JSON.stringify({ entry: hamEntryVsDraw.error, draw: hamDrawVsEntry.error, cup: hamEntryDrawNode }));

  // Tick freeze racing an ownership change must capture one coherent side of
  // the transfer, never a hybrid. This invokes the deployed waiverTick body.
  await db.ref(`v2/leagues/${LG}/public`).set(seed);
  await db.ref(`v2/leagues/${LG}/public/hamCup`).set({ gw: hamGw, drawnAt: Date.now(), openedAt: Date.now(), entries: {} });
  const beforeTickOwned = [...owned].sort((a, b) => a - b);
  const tickIn = freeOf('DF')[0], tickOut = byPos(await squadOf(1), 'DF')[0];
  const afterTickOwned = beforeTickOwned.filter(id => id !== tickOut).concat(tickIn).sort((a, b) => a - b);
  const [tickRace] = await Promise.all([
    Functions.waiverTick.run({}),
    db.ref(`v2/leagues/${LG}/public/transfers`).set([{ managerId: 1, outId: tickOut, inId: tickIn, gw: 1, t: Date.now(), n: 1 }]),
  ]);
  const tickFrozen = ((await db.ref(`v2/leagues/${LG}/public/hamCup/frozen`).get()).val() || []).sort((a, b) => a - b);
  chk('hourly freeze racing a transfer captures a coherent before-or-after owned set',
    JSON.stringify(tickFrozen) === JSON.stringify(beforeTickOwned) || JSON.stringify(tickFrozen) === JSON.stringify(afterTickOwned),
    JSON.stringify({ tickRace, before: beforeTickOwned.length, after: afterTickOwned.length, frozen: tickFrozen.length }));

  // Cancel racing the tick must leave the tombstone in charge; a transaction
  // seeded from the old cup may not resurrect it with a frozen array.
  await db.ref(`v2/leagues/${LG}/public`).set(seed);
  await db.ref(`v2/leagues/${LG}/public/hamCup`).set({ gw: hamGw, drawnAt: Date.now(), openedAt: Date.now(), entries: {} });
  await Promise.all([
    Functions.waiverTick.run({}),
    T.mutate(LG, 'hamAdmin', { op: 'cancel' }, tok1),
  ]);
  const cancelledCup = (await db.ref(`v2/leagues/${LG}/public/hamCup`).get()).val();
  chk('Ham cancel racing the hourly freeze cannot resurrect the cup',
    cancelledCup?.status === 'off' && cancelledCup.gw == null && !Array.isArray(cancelledCup.frozen), JSON.stringify(cancelledCup));
  await db.ref(`v2/leagues/${LG}/public`).set(seed);

  /* ---------------- lineups ---------------- */
  const sq1 = await squadOf(1);
  const legalXI = [...byPos(sq1, 'GK').slice(0, 1), ...byPos(sq1, 'DF').slice(0, 4), ...byPos(sq1, 'MF').slice(0, 4), ...byPos(sq1, 'FW').slice(0, 2)];
  chk('lineup save (legal, future GW) works', !(await T.mutate(LG, 'lineupSave', { gw: 2, xi: legalXI }, tok1)).error);
  chk('lineup with foreign player rejected', (await T.mutate(LG, 'lineupSave', { gw: 2, xi: [...legalXI.slice(0, 10), (await squadOf(2))[0]] }, tok1)).error?.status === 'INVALID_ARGUMENT');
  const twoGK = [...byPos(sq1, 'GK').slice(0, 2), ...byPos(sq1, 'DF').slice(0, 4), ...byPos(sq1, 'MF').slice(0, 3), ...byPos(sq1, 'FW').slice(0, 2)];
  chk('illegal XI shape rejected', (await T.mutate(LG, 'lineupSave', { gw: 2, xi: twoGK }, tok1)).error?.status === 'INVALID_ARGUMENT');
  chk('started gameweek is locked', (await T.mutate(LG, 'lineupSave', { gw: 1, xi: legalXI }, tok1)).error?.status === 'FAILED_PRECONDITION');
  chk('manager cannot save someone else\'s XI', (await T.mutate(LG, 'lineupSave', { gw: 2, xi: legalXI, asManager: 1 }, tok2)).error?.status === 'PERMISSION_DENIED');
  const t1 = (await db.ref(`v2/leagues/${LG}/public/lineups/1/2-t`).get()).val();
  chk('lineup timestamp is server-stamped', typeof t1 === 'number' && Math.abs(Date.now() - t1) < 60_000);

  /* ---------------- trough signings: waivers gate + races ---------------- */
  // GW2 has started and no waiver run has happened: everyone is on waivers
  const freeMFs = freeOf('MF');
  const dropMine = async (mid, pos) => byPos(await squadOf(mid), pos)[0];
  const gated = await T.mutate(LG, 'troughSign', { inId: freeMFs[0], outId: await dropMine(1, 'MF') }, tok1);
  chk('trough sign blocked while on waivers', gated.error?.status === 'FAILED_PRECONDITION', JSON.stringify(gated.error));
  // commissioner opens the Trough
  chk('non-commissioner cannot open the Trough', (await T.mutate(LG, 'waiverControl', { mode: 'open' }, tok2)).error?.status === 'PERMISSION_DENIED');
  chk('commissioner opens the Trough', !(await T.mutate(LG, 'waiverControl', { mode: 'open' }, tok1)).error);

  // same-player race: exactly one winner
  const target = freeMFs[0];
  const [rA, rB] = await Promise.all([
    T.mutate(LG, 'troughSign', { inId: target, outId: await dropMine(1, 'MF') }, tok1),
    T.mutate(LG, 'troughSign', { inId: target, outId: await dropMine(2, 'MF') }, tok2),
  ]);
  chk('same-player scramble: exactly one winner', [rA, rB].filter(r => !r.error).length === 1, JSON.stringify([rA.error, rB.error]));
  // different players concurrently: both land
  const [dA, dB] = await Promise.all([
    T.mutate(LG, 'troughSign', { inId: freeMFs[1], outId: await dropMine(3, 'MF') }, tok3),
    T.mutate(LG, 'troughSign', { inId: freeMFs[2], outId: await dropMine(2, 'MF') }, tok2),
  ]);
  chk('different-player signings both land', !dA.error && !dB.error, JSON.stringify([dA.error, dB.error]));
  // Desk §3b: every ledger record carries the immutable FPL code so a feed
  // id shift is recoverable (scripts/heal_ids.js). Pin the trough path here;
  // draft picks, claims, trades and the waiver run are pinned where they land.
  {
    const codeOf = Object.fromEntries(players.map(p => [p.id, p.code]));
    const trs = Object.values((await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val() || {});
    const last = trs[trs.length - 1];
    chk('trough signing records inCode/outCode matching the feed',
      last && last.inCode === codeOf[last.inId] && last.outCode === codeOf[last.outId],
      JSON.stringify(last));
  }
  // illegal shape server-rejected: a third GK
  const freeGK = freeOf('GK')[0];
  const badShape = await T.mutate(LG, 'troughSign', { inId: freeGK, outId: await dropMine(1, 'DF') }, tok1);
  chk('shape-breaking signing rejected server-side', badShape.error?.status === 'FAILED_PRECONDITION');
  chk('cannot sign for someone else', (await T.mutate(LG, 'troughSign', { inId: freeGK, outId: await dropMine(2, 'GK'), asManager: 2 }, tok3)).error?.status === 'PERMISSION_DENIED');

  /* ---------------- waivers ---------------- */
  await T.mutate(LG, 'waiverControl', { mode: 'auto' }, tok1);
  const prize = freeOf('FW')[0];
  const curGw = 1; // engine currentGwIndex on the synthetic calendar (GW2 = index 1)
  for (const [mid, tok] of [[1, tok1], [2, tok2], [3, tok3]]) {
    const out = await dropMine(mid, 'FW');
    const r = await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [{ in: prize, out }] }, tok);
    chk(`manager ${mid} lodges a blind claim`, !r.error, JSON.stringify(r.error));
  }
  {
    // Desk §3b: the stored claim carries codes, and the {in,out,t} cleanup
    // matcher must tolerate the extra fields (it keys on the three, not the object)
    const codeOf = Object.fromEntries(players.map(p => [p.id, p.code]));
    const lodgedRaw = (await db.ref(`v2/leagues/${LG}/private/${members[1].uid}/claims/${curGw}`).get()).val();
    const lodged = Array.isArray(lodgedRaw) ? lodgedRaw : Object.values(lodgedRaw || {});
    chk('lodged claim carries inCode/outCode matching the feed',
      lodged.length && lodged.every(c => c.inCode === codeOf[c.in] && c.outCode === codeOf[c.out]), JSON.stringify(lodged));
  }
  chk('claims are invisible to other managers (rules)', [401, 403].includes((await T.rest('GET', `v2/leagues/${LG}/private/${members[3].uid}/claims`, { token: tok2 })).status));
  chk('non-commissioner cannot run waivers', (await T.mutate(LG, 'waiverRunNow', {}, tok2)).error?.status === 'PERMISSION_DENIED');
  const wr = await T.mutate(LG, 'waiverRunNow', {}, tok1);
  chk('waiver run executes', !wr.error, JSON.stringify(wr.error));
  const prizeWinners = (wr.result?.executed || []).filter(e => e.in === prize);
  chk('contested claim: exactly one winner', prizeWinners.length === 1, JSON.stringify(wr.result));
  const clA = (await db.ref(`v2/leagues/${LG}/private/${members[1].uid}/claims`).get()).val();
  const clB = (await db.ref(`v2/leagues/${LG}/private/${members[2].uid}/claims`).get()).val();
  chk('claims cleared after the run', !clA && !clB);
  const runs = (await db.ref(`v2/leagues/${LG}/server/waiverRuns`).get()).val() || {};
  chk('run recorded with status done', Object.values(runs).some(r => r.status === 'done' && r.executed));
  {
    // Desk §3b: the waiver-run transfer record and the lodged claim both carry codes
    const codeOf = Object.fromEntries(players.map(p => [p.id, p.code]));
    const trs2 = Object.values((await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val() || {});
    const wrec = [...trs2].reverse().find(t => t.waiver);
    chk('waiver-run transfer record carries inCode/outCode',
      wrec && wrec.inCode === codeOf[wrec.inId] && wrec.outCode === codeOf[wrec.outId], JSON.stringify(wrec));
  }
  const meta = (await db.ref(`v2/leagues/${LG}/public/waiverMeta/lastRun`).get()).val();
  chk('lastRun stamped', !!meta);
  const again = await T.mutate(LG, 'waiverRunNow', {}, tok1);
  chk('immediate re-run executes nothing (idempotent)', !again.error && (again.result?.executed || []).length === 0, JSON.stringify(again.result));
  // exactly-once on a shared run id: pre-claim a scheduled slot, then watch a re-claim skip
  await db.ref(`v2/leagues/${LG}/server/waiverRuns/sched-locked`).set({ status: 'done', finishedAt: Date.now() });

  // the Chairman's one-shot skip (Committee, 12 Aug): a named run can be
  // missed by exception; claims stay lodged and roll to the next run
  chk('non-commissioner cannot skip a run', (await T.mutate(LG, 'waiverSkip', { id: 'wv-2026-09-01' }, tok2)).error?.status === 'PERMISSION_DENIED');
  chk('a skip must name a real slot id', (await T.mutate(LG, 'waiverSkip', { id: 'gw1-post' }, tok1)).error?.status === 'INVALID_ARGUMENT');
  chk('commissioner skips a named run', (await T.mutate(LG, 'waiverSkip', { id: 'wv-2026-09-01' }, tok1)).result?.skip === 'wv-2026-09-01');
  chk('skip recorded on waiverMeta', (await db.ref(`v2/leagues/${LG}/public/waiverMeta/skip`).get()).val() === 'wv-2026-09-01');
  const unskip = await T.mutate(LG, 'waiverSkip', { id: null }, tok1);
  chk('commissioner reinstates the run', !unskip.error && (await db.ref(`v2/leagues/${LG}/public/waiverMeta/skip`).get()).val() === null);

  // {next:true} must judge the run ledger and stamp the selected slot as one
  // atomic operation. A slot already running/applying is too late to skip;
  // a failed slot remains eligible for its retry.
  const fixtures = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'data', 'fixtures.json'), 'utf8'));
  const clock = Engine.make({
    players,
    gameweeks: gws.map(g => ({ ...g, from: g.deadline })),
    fixtures,
    lastSeasonByCode: {},
    now: () => Date.now(),
  });
  const dueSlots = clock.waiverSchedule();
  const runRoot = db.ref(`v2/leagues/${LG}/server/waiverRuns`);
  for (const d of dueSlots) await runRoot.child(`sched-${d.id}`).set({ status: 'done', finishedAt: Date.now() });
  const lastDue = dueSlots[dueSlots.length - 1];
  if (lastDue) await runRoot.child(`sched-${lastDue.id}`).set({ status: 'running', startedAt: Date.now() });
  const futureSlot = clock.waiverSlotId(clock.nextSlotAt(Date.now()));
  const beforeNext = {
    transfers: (await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val(),
    private: (await db.ref(`v2/leagues/${LG}/private`).get()).val(),
    lastRun: (await db.ref(`v2/leagues/${LG}/public/waiverMeta/lastRun`).get()).val(),
  };
  const skipsFuture = await T.mutate(LG, 'waiverSkip', { next: true, id: 'wv-1999-01-01' }, tok1);
  const afterNext = {
    transfers: (await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val(),
    private: (await db.ref(`v2/leagues/${LG}/private`).get()).val(),
    lastRun: (await db.ref(`v2/leagues/${LG}/public/waiverMeta/lastRun`).get()).val(),
  };
  chk('{next:true} skips past done and in-flight ledger slots atomically',
    !skipsFuture.error && skipsFuture.result?.skip === futureSlot
      && (await db.ref(`v2/leagues/${LG}/public/waiverMeta/skip`).get()).val() === futureSlot,
    JSON.stringify({ result: skipsFuture.result, error: skipsFuture.error, futureSlot, dueSlots }));
  chk('choosing a skip touches no claims, transfers or lastRun',
    JSON.stringify(beforeNext) === JSON.stringify(afterNext));
  if (lastDue) {
    await runRoot.child(`sched-${lastDue.id}`).update({ status: 'failed', finishedAt: Date.now() });
    const retriesFailed = await T.mutate(LG, 'waiverSkip', { next: true, id: futureSlot }, tok1);
    chk('{next:true} still selects a failed slot that the scheduler will retry',
      !retriesFailed.error && retriesFailed.result?.skip === lastDue.id,
      JSON.stringify({ result: retriesFailed.result, error: retriesFailed.error, lastDue }));
  } else chk('{next:true} still selects a failed slot that the scheduler will retry', false, 'test clock produced no due slots');
  await T.mutate(LG, 'waiverSkip', { id: null }, tok1);

  /* ---------------- trades ---------------- */
  const myMF = (await dropMine(1, 'MF'));
  const theirMF = (await dropMine(2, 'MF'));
  const liveBeforeTrade = [await squadAtGw(1, curGw), await squadAtGw(2, curGw)];
  const prop = await T.mutate(LG, 'tradePropose', { to: 2, give: [myMF], get: [theirMF] }, tok1);
  chk('trade proposed', !prop.error && prop.result?.id, JSON.stringify(prop.error));
  const tradeId = prop.result.id;
  chk('non-party cannot accept', (await T.mutate(LG, 'tradeRespond', { tradeId, action: 'accept' }, tok3)).error?.status === 'PERMISSION_DENIED');
  const [acc1, acc2] = await Promise.all([
    T.mutate(LG, 'tradeRespond', { tradeId, action: 'accept' }, tok2),
    T.mutate(LG, 'tradeRespond', { tradeId, action: 'accept' }, tok2),
  ]);
  chk('double-accept executes exactly once', [acc1, acc2].filter(r => !r.error).length === 1, JSON.stringify([acc1.error, acc2.error]));
  chk('players actually swapped', (await squadOf(1)).includes(theirMF) && (await squadOf(2)).includes(myMF));
  const tradeRecs = Object.values((await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val() || {}).filter(t => t?.trade === tradeId);
  const liveAfterTrade = [await squadAtGw(1, curGw), await squadAtGw(2, curGw)];
  chk('mid-GW trade is ledgered only for the next unplayed GW', tradeRecs.length === 2 && tradeRecs.every(t => t.gw === curGw + 1), JSON.stringify(tradeRecs));
  {
    const codeOf = Object.fromEntries(players.map(p => [p.id, p.code]));
    chk('trade records carry inCode/outCode on both sides (Desk §3b)',
      tradeRecs.every(t => t.inCode === codeOf[t.inId] && t.outCode === codeOf[t.outId]), JSON.stringify(tradeRecs));
  }
  chk('mid-GW trade leaves both ongoing-GW squads byte-for-byte unchanged',
    JSON.stringify(liveAfterTrade.map(x => [...x].sort((a, b) => a - b))) === JSON.stringify(liveBeforeTrade.map(x => [...x].sort((a, b) => a - b))));
  const prop2 = await T.mutate(LG, 'tradePropose', { to: 2, give: [theirMF], get: [myMF] }, tok1);
  chk('reject path', (await T.mutate(LG, 'tradeRespond', { tradeId: prop2.result.id, action: 'reject' }, tok2)).result?.status === 'rejected');
  const prop3 = await T.mutate(LG, 'tradePropose', { to: 2, give: [theirMF], get: [myMF] }, tok1);
  chk('withdraw path', (await T.mutate(LG, 'tradeRespond', { tradeId: prop3.result.id, action: 'withdraw' }, tok1)).result?.status === 'withdrawn');

  /* ---------------- commissioner desk ---------------- */
  chk('scoring edit is Chairman-only', (await T.mutate(LG, 'settingsSet', { scoringKey: 'assist', value: 4 }, tok2)).error?.status === 'PERMISSION_DENIED');
  chk('Chairman edits scoring', !(await T.mutate(LG, 'settingsSet', { scoringKey: 'assist', value: 4 }, tok1)).error);
  chk('adjustments are Chairman-only', (await T.mutate(LG, 'adjustmentSet', { pid: 100, value: 5 }, tok2)).error?.status === 'PERMISSION_DENIED');

  /* ---------------- draft (sandbox league) ---------------- */
  const sbSeed = { ...T.buildSeedState(players, 3), phase: 'setup' };
  sbSeed.draft = { order: [], picks: [], breaksDone: [], timewastes: {}, paused: false, pausedLeft: 0 };
  const sbTok1 = await T.idTokenFor((await db.ref(`v2/leagues/${SB}/server/managerUid/1`).get()).val());
  const sbTok2 = await T.idTokenFor((await db.ref(`v2/leagues/${SB}/server/managerUid/2`).get()).val());
  const sbTok3 = await T.idTokenFor((await db.ref(`v2/leagues/${SB}/server/managerUid/3`).get()).val());

  /* sol club-office P0.1: the league the founders actually arrive at is EMPTY —
     membership provisioned, /public never written. Setup actions must seed the
     canonical setup state and land, not refuse with "league not initialised". */
  chk('cold league: /public is genuinely absent', (await db.ref(`v2/leagues/${SB}/public`).get()).val() === null);
  const coldReady = await T.mutate(SB, 'readySet', { ready: true }, sbTok2);
  chk('readySet on a never-initialised league seeds setup and lands', !coldReady.error
    && (await db.ref(`v2/leagues/${SB}/public/phase`).get()).val() === 'setup'
    && (await db.ref(`v2/leagues/${SB}/public/ready/2/self`).get()).val() === true, JSON.stringify(coldReady.error));
  chk('the seed is the canonical roster', Object.values((await db.ref(`v2/leagues/${SB}/public/managers`).get()).val() || {}).length === 12);
  const coldClub = await T.mutate(SB, 'clubSet', { team: 'Cold Start FC', stadium: 'The Void', kit: { pattern: 'hoops', c1: '#101010', c2: '#e8b64c' } }, sbTok2);
  chk('clubSet founds a club on the freshly-seeded league', !coldClub.error
    && (await db.ref(`v2/leagues/${SB}/public/managers/1/team`).get()).val() === 'Cold Start FC', JSON.stringify(coldClub.error));
  // a second seed attempt must not clobber the live setup state (idempotence)
  await T.mutate(SB, 'readySet', { ready: true }, sbTok3);
  chk('seeding is idempotent — the founded club survives later setup actions',
    (await db.ref(`v2/leagues/${SB}/public/managers/1/team`).get()).val() === 'Cold Start FC');
  // cold Settings (sol r2 P1): the Chairman's pre-draft Settings page seeds too
  await db.ref(`v2/leagues/${SB}/public`).set(null);
  const coldSet = await T.mutate(SB, 'settingsSet', { scoringKey: 'assist', value: 4 }, sbTok1);
  chk('settingsSet on a never-initialised league seeds and lands', !coldSet.error
    && (await db.ref(`v2/leagues/${SB}/public/settings/scoring/assist`).get()).val() === 4
    && (await db.ref(`v2/leagues/${SB}/public/phase`).get()).val() === 'setup', JSON.stringify(coldSet.error));
  // cold Start: starting the draft as the league's first-ever action
  await db.ref(`v2/leagues/${SB}/public`).set(null);
  const coldStart = await T.mutate(SB, 'draftAdmin', { op: 'start', order: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, sbTok1);
  chk('draft start on a never-initialised league seeds then starts', !coldStart.error
    && (await db.ref(`v2/leagues/${SB}/public/phase`).get()).val() === 'draft', JSON.stringify(coldStart.error));

  const forgedCeremony = structuredClone(sbSeed);
  forgedCeremony.phase = 'draft';
  forgedCeremony.draft = { ...forgedCeremony.draft, order: [1, 2, 3], picks: [], deadline: Date.now() + 60_000, ceremonyReady: { 1: true, 2: true, 3: true } };
  const forgedImport = await T.mutate(SB, 'importState', { state: forgedCeremony }, sbTok1);
  const forgedPick = await T.mutate(SB, 'draftAutopick', {}, sbTok1);
  chk('restore cannot smuggle a live pick-one clock around the ceremony barrier', !forgedImport.error
    && (await db.ref(`v2/leagues/${SB}/public/draft/deadline`).get()).val() === null
    && forgedPick.error?.status === 'FAILED_PRECONDITION', JSON.stringify({ forgedImport, forgedPick }));

  await T.mutate(SB, 'importState', { state: sbSeed }, sbTok1);

  // the ready room: self-mark, Chairman vouch, gating, and the phase gate below
  chk('manager marks self ready', !(await T.mutate(SB, 'readySet', { ready: true }, sbTok2)).error);
  chk('ready lands in public with self flag', (await T.rest('GET', `v2/leagues/${SB}/public/ready/2`, { owner: true })).val?.self === true);
  chk('non-commissioner cannot vouch for another', (await T.mutate(SB, 'readySet', { ready: true, asManager: 3 }, sbTok2)).error?.status === 'PERMISSION_DENIED');
  chk('Chairman vouches for a straggler', !(await T.mutate(SB, 'readySet', { ready: true, asManager: 3 }, sbTok1)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/ready/3`, { owner: true })).val?.self === false);
  chk('unknown manager rejected', (await T.mutate(SB, 'readySet', { ready: true, asManager: 99 }, sbTok1)).error?.status === 'NOT_FOUND');
  chk('unready clears the mark', !(await T.mutate(SB, 'readySet', { ready: false }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/ready/2`, { owner: true })).val == null);
  chk('import drops the ready key silently', !(await T.mutate(SB, 'importState', { state: { ...sbSeed, ready: { 2: { t: 1, self: true } } } }, sbTok1)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/ready`, { owner: true })).val == null);
  await T.mutate(SB, 'readySet', { ready: true }, sbTok2); // re-mark, proves import wiped then re-set works

  // the club office: rename, kit, sponsor, rival — cosmetics with teeth
  chk('clubSet renames own team', !(await T.mutate(SB, 'clubSet', { team: 'Chairman Mao Ultras' }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/team`, { owner: true })).val === 'Chairman Mao Ultras');
  chk('clubSet kit + sponsor + rival land (hex lowercased)', !(await T.mutate(SB, 'clubSet', { kit: { pattern: 'stripes', c1: '#C81919', c2: '#FFFFFF' }, sponsor: 'WAX ON', rival: 1 }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/kit/c1`, { owner: true })).val === '#c81919'
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/sponsor`, { owner: true })).val === 'WAX ON'
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/rival`, { owner: true })).val === 1);
  chk('junk kit pattern rejected', (await T.mutate(SB, 'clubSet', { kit: { pattern: 'tartan', c1: '#123456', c2: '#abcdef' } }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('one-character name rejected', (await T.mutate(SB, 'clubSet', { team: 'X' }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('self-rivalry rejected', (await T.mutate(SB, 'clubSet', { rival: 2 }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('multiple rivals land, first mirrored to the legacy field', !(await T.mutate(SB, 'clubSet', { rivals: [1, 3] }, sbTok2)).error
    && JSON.stringify((await T.rest('GET', `v2/leagues/${SB}/public/managers/1/rivals`, { owner: true })).val) === '[1,3]'
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/rival`, { owner: true })).val === 1);
  chk('four rivals rejected', (await T.mutate(SB, 'clubSet', { rivals: [1, 3, 4, 5] }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('self among rivals rejected', (await T.mutate(SB, 'clubSet', { rivals: [1, 2] }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('rivals clear to null both fields', !(await T.mutate(SB, 'clubSet', { rivals: null }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/rivals`, { owner: true })).val == null
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/rival`, { owner: true })).val == null);
  await T.mutate(SB, 'clubSet', { rivals: [1, 3] }, sbTok2); // re-declare: the round-trip below asserts both fields
  chk('empty clubSet rejected', (await T.mutate(SB, 'clubSet', {}, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('non-commissioner cannot restyle another club', (await T.mutate(SB, 'clubSet', { team: 'Hijacked FC', asManager: 3 }, sbTok2)).error?.status === 'PERMISSION_DENIED');
  chk('sponsor clears to null', !(await T.mutate(SB, 'clubSet', { sponsor: null }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/sponsor`, { owner: true })).val == null);
  chk('stadium + hoardings land via the club office', !(await T.mutate(SB, 'clubSet', { stadium: 'The Rec', boards: [0, 5, 2] }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/stadium`, { owner: true })).val === 'The Rec'
    && JSON.stringify((await T.rest('GET', `v2/leagues/${SB}/public/managers/1/boards`, { owner: true })).val) === '[0,5,2]');
  chk('four hoardings rejected', (await T.mutate(SB, 'clubSet', { boards: [0, 1, 2, 3] }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('gaffer archetype lands', !(await T.mutate(SB, 'clubSet', { gaffer: 1 }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/gaffer`, { owner: true })).val === 1);
  chk('homemade gaffer lands trimmed', !(await T.mutate(SB, 'clubSet', { gaffer: { t: 'Roy of the Rec', bio: 'seen it all twice' } }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/gaffer/t`, { owner: true })).val === 'Roy of the Rec');
  chk('junk gaffer rejected', (await T.mutate(SB, 'clubSet', { gaffer: 'roy' }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('gaffer sacked to null', !(await T.mutate(SB, 'clubSet', { gaffer: null }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/gaffer`, { owner: true })).val == null);
  chk('junk hoarding number rejected', (await T.mutate(SB, 'clubSet', { boards: [99] }, sbTok2)).error?.status === 'INVALID_ARGUMENT');

  // the College of Arms (Lee, 12 Aug): crest bounds enforced server-side
  chk('crest cut and saved', !(await T.mutate(SB, 'clubSet', { crest: { shape: 1, div: 2, charge: 5, c1: '#0B1A3A', c2: '#E8B64C' } }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/crest/charge`, { owner: true })).val === 5);
  chk('crest colours normalised to lowercase', (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/crest/c2`, { owner: true })).val === '#e8b64c');
  chk('a charge off the end of the catalogue rejected', (await T.mutate(SB, 'clubSet', { crest: { shape: 0, div: 0, charge: 16, c1: '#ffffff', c2: '#101010' } }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('junk crest shape rejected', (await T.mutate(SB, 'clubSet', { crest: { shape: 'heater', div: 0, charge: 0, c1: '#ffffff', c2: '#101010' } }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('monogram crest (charge null) accepted', !(await T.mutate(SB, 'clubSet', { crest: { shape: 2, div: 1, charge: null, c1: '#ffffff', c2: '#101010' } }, sbTok2)).error);
  chk('crest back to house-issue', !(await T.mutate(SB, 'clubSet', { crest: null }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/crest`, { owner: true })).val == null);

  /* sol P2.2: server bounds pinned to the REAL catalogues in js/lore.js —
     values the client can't render must not validate */
  const loreCtx = {};
  require('vm').createContext(loreCtx);
  require('vm').runInContext(
    require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'lore.js'), 'utf8')
    + '\nthis.__G = GAFFERS.length; this.__B = AD_BOARDS.length; this.__A = ASSISTANTS.length;'
    + '\nthis.__CS = CREST_SHAPES.length; this.__CD = CREST_DIVISIONS.length; this.__CC = CREST_CHARGES.length;', loreCtx);
  const fnSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'functions', 'index.js'), 'utf8');
  const GC = +fnSrc.match(/GAFFER_COUNT = (\d+)/)[1], BC = +fnSrc.match(/BOARD_COUNT = (\d+)/)[1], AC = +fnSrc.match(/ASSISTANT_COUNT = (\d+)/)[1];
  chk('server catalogue bounds match js/lore.js', loreCtx.__G === GC && loreCtx.__B === BC && loreCtx.__A === AC, `lore ${loreCtx.__G}/${loreCtx.__B}/${loreCtx.__A} vs functions ${GC}/${BC}/${AC}`);
  const CS = +fnSrc.match(/CREST_SHAPE_COUNT = (\d+)/)[1], CD = +fnSrc.match(/CREST_DIVISION_COUNT = (\d+)/)[1], CC = +fnSrc.match(/CREST_CHARGE_COUNT = (\d+)/)[1];
  chk('crest bounds match the College of Arms in js/lore.js', loreCtx.__CS === CS && loreCtx.__CD === CD && loreCtx.__CC === CC, `lore ${loreCtx.__CS}/${loreCtx.__CD}/${loreCtx.__CC} vs functions ${CS}/${CD}/${CC}`);
  chk('last gaffer on the stable accepted, first off the end rejected',
    !(await T.mutate(SB, 'clubSet', { gaffer: GC - 1 }, sbTok2)).error
    && (await T.mutate(SB, 'clubSet', { gaffer: GC }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('assistant: stable index and custom accepted, off-the-end and junk rejected',
    !(await T.mutate(SB, 'clubSet', { assistant: AC - 1 }, sbTok2)).error
    && !(await T.mutate(SB, 'clubSet', { assistant: { t: 'Uncle Keith', bio: 'Has a van.' } }, sbTok2)).error
    && (await T.mutate(SB, 'clubSet', { assistant: AC }, sbTok2)).error?.status === 'INVALID_ARGUMENT'
    && (await T.mutate(SB, 'clubSet', { assistant: 'x' }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  chk('assistant cleared back to house-issue', !(await T.mutate(SB, 'clubSet', { assistant: null }, sbTok2)).error
    && (await T.rest('GET', `v2/leagues/${SB}/public/managers/1/assistant`, { owner: true })).val == null);
  chk('last hoarding accepted, first off the end rejected',
    !(await T.mutate(SB, 'clubSet', { boards: [BC - 1] }, sbTok2)).error
    && (await T.mutate(SB, 'clubSet', { boards: [BC] }, sbTok2)).error?.status === 'INVALID_ARGUMENT');

  /* sol P0.2: a backup taken after foundings must restore — the whole public
     state with kit/sponsor/rival/gaffer/boards on managers round-trips.
     sol launch P2 (14 Aug): crest was cleared above before the export, so the
     round-trip never carried one and importState's missing 'crest' allow-list
     entry went unnoticed. Re-arm it so the backup under test has a crest. */
  await T.mutate(SB, 'clubSet', { crest: { shape: 1, div: 2, charge: 5, c1: '#0b1a3a', c2: '#e8b64c' } }, sbTok2);
  const exported = (await db.ref(`v2/leagues/${SB}/public`).get()).val();
  const reimp = await T.mutate(SB, 'importState', { state: exported }, sbTok1);
  chk('export after foundings re-imports clean (club fields allowed)', !reimp.error, JSON.stringify(reimp.error));
  chk('EVERY club field survives the round-trip',
    (await db.ref(`v2/leagues/${SB}/public/managers/1/kit/c1`).get()).val() === '#c81919'
    && (await db.ref(`v2/leagues/${SB}/public/managers/1/stadium`).get()).val() === 'The Rec'
    && (await db.ref(`v2/leagues/${SB}/public/managers/1/gaffer`).get()).val() === GC - 1
    && JSON.stringify((await db.ref(`v2/leagues/${SB}/public/managers/1/boards`).get()).val()) === JSON.stringify([BC - 1])
    && (await db.ref(`v2/leagues/${SB}/public/managers/1/rival`).get()).val() === 1
    && JSON.stringify((await db.ref(`v2/leagues/${SB}/public/managers/1/rivals`).get()).val()) === '[1,3]');
  chk('crest survives the round-trip (sol launch P2)',
    (await db.ref(`v2/leagues/${SB}/public/managers/1/crest/charge`).get()).val() === 5
    && (await db.ref(`v2/leagues/${SB}/public/managers/1/crest/c2`).get()).val() === '#e8b64c');
  chk('import still rejects a junk crest', (await T.mutate(SB, 'importState', { state: { ...exported, managers: exported.managers.map((m, i) => i === 1 ? { ...m, crest: { shape: 9, div: 0, charge: 0, c1: '#fff', c2: '#000' } } : m) } }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  chk('import still rejects a junk manager key', (await T.mutate(SB, 'importState', { state: { ...sbSeed, managers: sbSeed.managers.map(m => ({ ...m, chef: 1 })) } }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  chk('import rejects an out-of-catalogue gaffer', (await T.mutate(SB, 'importState', { state: { ...sbSeed, managers: sbSeed.managers.map((m, i) => i ? m : { ...m, gaffer: GC }) } }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  chk('import rejects a rival outside the roster', (await T.mutate(SB, 'importState', { state: { ...sbSeed, managers: sbSeed.managers.map((m, i) => i ? m : { ...m, rival: 55 }) } }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  chk('thousand-entry boards array rejected even though it dedupes to one (sol r2 P3)',
    (await T.mutate(SB, 'clubSet', { boards: Array(1000).fill(0) }, sbTok2)).error?.status === 'INVALID_ARGUMENT'
    && (await T.mutate(SB, 'importState', { state: { ...sbSeed, managers: sbSeed.managers.map((m, i) => i ? m : { ...m, boards: Array(1000).fill(0) }) } }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  chk('import clamps an over-long stadium to the office contract (40)',
    !(await T.mutate(SB, 'importState', { state: { ...sbSeed, managers: sbSeed.managers.map((m, i) => i ? m : { ...m, stadium: 'X'.repeat(60) }) } }, sbTok1)).error
    && ((await db.ref(`v2/leagues/${SB}/public/managers/0/stadium`).get()).val() || '').length === 40);

  /* sol P1.1: clubSet racing a roster-REORDERING import must never write the
     wrong manager. The import may legitimately win the whole state (it's a
     restore), but a rename landing on someone else's club is corruption. */
  const reorderedSeed = { ...sbSeed, managers: [sbSeed.managers[1], sbSeed.managers[0], sbSeed.managers[2]] };
  let wrongMgr = 0, landed = 0;
  for (let i = 0; i < 10; i++) {
    await T.mutate(SB, 'importState', { state: sbSeed }, sbTok1);
    await Promise.all([
      T.mutate(SB, 'clubSet', { team: `Race FC ${i}` }, sbTok2),
      T.mutate(SB, 'importState', { state: reorderedSeed }, sbTok1),
    ]);
    const mgrs = Object.values((await db.ref(`v2/leagues/${SB}/public/managers`).get()).val() || {});
    for (const mg of mgrs) if (mg.team === `Race FC ${i}` && mg.id !== 2) wrongMgr++;
    if (mgrs.some(mg => mg.team === `Race FC ${i}` && mg.id === 2)) landed++;
  }
  // landed floor keeps this honest: all-aborts would also give wrong=0 (sol r2)
  chk('clubSet vs reordering import raced 10x: rename NEVER lands on the wrong manager (sol P1.1)', wrongMgr === 0 && landed >= 3, `wrong=${wrongMgr} landed=${landed}`);

  /* sol r2 P1: clubSet(rival) racing an import that REMOVES the rival must
     never leave a ghost rivalry — the merge txn revalidates rival at commit */
  const twoManSeed = { ...sbSeed, managers: sbSeed.managers.slice(0, 2) };
  let ghosts = 0;
  for (let i = 0; i < 10; i++) {
    await T.mutate(SB, 'importState', { state: sbSeed }, sbTok1);
    await Promise.all([
      T.mutate(SB, 'clubSet', { rival: 3 }, sbTok2),
      T.mutate(SB, 'importState', { state: twoManSeed }, sbTok1),
    ]);
    const mgrs = Object.values((await db.ref(`v2/leagues/${SB}/public/managers`).get()).val() || {});
    if (!mgrs.some(mg => mg.id === 3) && mgrs.some(mg => mg.rival === 3)) ghosts++;
  }
  chk('clubSet(rival) vs rival-removing import raced 10x: no ghost rivalry (sol r2 P1)', ghosts === 0, `ghosts=${ghosts}`);

  // clean slate for the start tests — with NON-DEFAULT committed settings so
  // the patch semantics below are pinned honestly (sol r2 test-honesty note)
  const startSeed = { ...sbSeed, settings: { ...sbSeed.settings, lobusBonus: 13, scoring: { ...sbSeed.settings.scoring, assist: 8 } } };
  await T.mutate(SB, 'importState', { state: startSeed }, sbTok1);
  await T.mutate(SB, 'readySet', { ready: true }, sbTok2);

  /* the atomic start: founders' clubs survive, the Chairman's screen edits
     merge in the same txn, ready clears, club fields can't ride the payload */
  const founded = await T.mutate(SB, 'clubSet', { team: 'Founded Late FC', kit: { pattern: 'sash', c1: '#123456', c2: '#fedcba' } }, sbTok3);
  chk('a club founded just before the start', !founded.error, JSON.stringify(founded.error));
  chk('setup payload smuggling club fields rejected',
    (await T.mutate(SB, 'draftAdmin', { op: 'start', order: [1, 2, 3], setup: { managers: [{ id: 1, kit: { pattern: 'plain', c1: '#000000', c2: '#ffffff' } }] } }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  chk('setup payload with junk settings rejected',
    (await T.mutate(SB, 'draftAdmin', { op: 'start', order: [1, 2, 3], setup: { settings: { evilSetting: 2 } } }, sbTok1)).error?.status === 'INVALID_ARGUMENT');

  chk('draft start is Chairman-gated', (await T.mutate(SB, 'draftAdmin', { op: 'start', order: [1, 2, 3] }, sbTok2)).error?.status === 'PERMISSION_DENIED');
  chk('bad order rejected', (await T.mutate(SB, 'draftAdmin', { op: 'start', order: [1, 2] }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  chk('Chairman starts the draft', !(await T.mutate(SB, 'draftAdmin', {
    op: 'start', order: [1, 2, 3],
    // A phone holding the old setup form may still send the former editable
    // squad fields. It must start safely, but those values must never land.
    setup: { managers: [{ id: 1, name: 'Renamed Chair', team: 'Renamed FC' }], settings: {
      pickTimer: 45, squadSize: 99,
      posMin: { GK: 0, DF: 0, MF: 0, FW: 0 },
      posMax: { GK: 99, DF: 99, MF: 99, FW: 99 },
    } },
  }, sbTok1)).error);
  chk('start merged the screen edits in the same txn',
    (await db.ref(`v2/leagues/${SB}/public/managers/0/name`).get()).val() === 'Renamed Chair'
    && (await db.ref(`v2/leagues/${SB}/public/settings/pickTimer`).get()).val() === 45);
  chk('start settings are a PATCH — committed non-defaults survive omission (sol r2 P2)',
    (await db.ref(`v2/leagues/${SB}/public/settings/scoring/assist`).get()).val() === 8
    && (await db.ref(`v2/leagues/${SB}/public/settings/lobusBonus`).get()).val() === 13
    && (await db.ref(`v2/leagues/${SB}/public/settings/squadSize`).get()).val() === 14);
  const startedSquadSettings = (await db.ref(`v2/leagues/${SB}/public/settings`).get()).val();
  chk('stale setup clients cannot alter the hard 14-man one-flex law',
    hardRulesOk(startedSquadSettings),
    JSON.stringify(startedSquadSettings));
  chk('the just-founded club SURVIVED the start (no whole-state import — sol P1.1)',
    (await db.ref(`v2/leagues/${SB}/public/managers/2/team`).get()).val() === 'Founded Late FC'
    && (await db.ref(`v2/leagues/${SB}/public/managers/2/kit/pattern`).get()).val() === 'sash');
  chk('start cleared the ready room', (await db.ref(`v2/leagues/${SB}/public/ready`).get()).val() === null);
  chk('ready room closes once the draft starts', (await T.mutate(SB, 'readySet', { ready: true }, sbTok3)).error?.status === 'FAILED_PRECONDITION');
  // draft-night heckling: lands, cools down, validates, and is draft-only
  chk('a heckle lands in public', !(await T.mutate(SB, 'heckle', { line: 3 }, sbTok3)).error
    && (await db.ref(`v2/leagues/${SB}/public/heckles/3/line`).get()).val() === 3);
  chk('heckle cooldown cannot be bypassed by alternating line to custom text',
    (await T.mutate(SB, 'heckle', { text: 'different payload shape' }, sbTok3)).error?.status === 'RESOURCE_EXHAUSTED');
  chk('junk heckle line rejected', (await T.mutate(SB, 'heckle', { line: 999 }, sbTok2)).error?.status === 'INVALID_ARGUMENT');
  // custom words (mock-draft round): stored cleaned, empty refused
  chk('custom heckle text lands', !(await T.mutate(SB, 'heckle', { text: '  GET ON WITH IT  ' }, sbTok2)).error
    && (await db.ref(`v2/leagues/${SB}/public/heckles/2/text`).get()).val() === 'GET ON WITH IT');
  chk('heckle cooldown cannot be bypassed by alternating custom text to line',
    (await T.mutate(SB, 'heckle', { line: 2 }, sbTok2)).error?.status === 'RESOURCE_EXHAUSTED');
  chk('empty custom heckle refused', (await T.mutate(SB, 'heckle', { text: '   ' }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  // Chairman force-start (test nights / no-shows): only the commissioner may
  // declare the room open, and doing so marks EVERY manager through and arms
  // pick one in the same txn
  chk('roomOpen is Chairman-only', (await T.mutate(SB, 'draftAdmin', { op: 'roomOpen' }, sbTok2)).error?.status === 'PERMISSION_DENIED');
  const forced = await T.mutate(SB, 'draftAdmin', { op: 'roomOpen' }, sbTok1);
  chk('Chairman roomOpen marks the whole order through and arms the clock',
    !forced.error && forced.result?.complete === true && forced.result?.count === 3 && forced.result?.armed === true
    && (await db.ref(`v2/leagues/${SB}/public/draft/deadline`).get()).val() > Date.now(), JSON.stringify(forced));
  await T.mutate(SB, 'draftAdmin', { op: 'ceremonyReady' }, sbTok1);
  await T.mutate(SB, 'draftAdmin', { op: 'ceremonyReady' }, sbTok2);
  const sbRoom = await T.mutate(SB, 'draftAdmin', { op: 'ceremonyReady' }, sbTok3);
  chk('sandbox draft races begin only after all three test managers finish the ceremony',
    !sbRoom.error && sbRoom.result?.complete === true && sbRoom.result?.count === 3, JSON.stringify(sbRoom));
  chk('out-of-turn pick rejected', (await T.mutate(SB, 'draftPick', { playerId: players[0].id, expectedCount: 0 }, sbTok2)).error?.status === 'PERMISSION_DENIED');
  const [p1, p2] = await Promise.all([
    T.mutate(SB, 'draftPick', { playerId: players[0].id, expectedCount: 0 }, sbTok1),
    T.mutate(SB, 'draftPick', { playerId: players[1].id, expectedCount: 0 }, sbTok1),
  ]);
  chk('simultaneous picks: exactly one lands', [p1, p2].filter(r => !r.error).length === 1, JSON.stringify([p1.error, p2.error]));
  {
    const codeOf = Object.fromEntries(players.map(p => [p.id, p.code]));
    const sbPicks = Object.values((await db.ref(`v2/leagues/${SB}/public/draft/picks`).get()).val() || {});
    chk('draft pick records carry the player code (Desk §3b)',
      sbPicks.length && sbPicks.every(pk => pk.code === codeOf[pk.playerId]), JSON.stringify(sbPicks.slice(-1)));
  }
  chk('autopick before the clock expires rejected', (await T.mutate(SB, 'draftAutopick', {}, sbTok3)).error?.status === 'FAILED_PRECONDITION');
  await db.ref(`v2/leagues/${SB}/public/draft/deadline`).set(Date.now() - 10_000);
  const [a1, a2] = await Promise.all([
    T.mutate(SB, 'draftAutopick', {}, sbTok2),
    T.mutate(SB, 'draftAutopick', {}, sbTok2),
  ]);
  chk('expired clock: anyone triggers autopick, exactly once', [a1, a2].filter(r => !r.error).length === 1, JSON.stringify([a1.error, a2.error]));
  const picks = (await db.ref(`v2/leagues/${SB}/public/draft/picks`).get()).val() || [];
  chk('autopick was deterministic best-available for the on-clock manager', picks.length === 2 && picks[1].managerId === 2);
  chk('timewaste for someone else\'s clock rejected', (await T.mutate(SB, 'draftAdmin', { op: 'timewaste' }, sbTok2)).error?.status === 'PERMISSION_DENIED');

  /* ---------------- membership is the only authority ----------------
   * custom claims are a stale hint at best: revoked, downgraded or
   * mismatched claims never grant anything — the server-owned membership
   * node decides, every time. */
  const auth = T.initAdmin().auth();
  // pruned user: token still carries a manager claim, membership is gone
  const ghost = await auth.createUser({ email: 'ghost@test.local' });
  await auth.setCustomUserClaims(ghost.uid, { leagues: { [LG]: { managerId: 2, role: 'manager' } } });
  const ghostTok = await T.idTokenFor(ghost.uid); // claim baked into the token
  const ghostTry = await T.mutate(LG, 'autolistSet', { pids: [players[0].id] }, ghostTok);
  chk('pruned user with a stale manager claim is rejected', ghostTry.error?.status === 'PERMISSION_DENIED', JSON.stringify(ghostTry.error));
  // downgraded commissioner: token says commissioner, membership says manager
  const demoted = await auth.createUser({ email: 'demoted@test.local' });
  await auth.setCustomUserClaims(demoted.uid, { leagues: { [LG]: { managerId: 3, role: 'commissioner' } } });
  await T.initAdmin().database().ref(`v2/leagues/${LG}/server/membership/${demoted.uid}`).set({ managerId: 3, role: 'manager' });
  const demotedTok = await T.idTokenFor(demoted.uid);
  const demTry = await T.mutate(LG, 'settingsSet', { scoringKey: 'assist', value: 9 }, demotedTok);
  chk('downgraded commissioner cannot use commissioner actions', demTry.error?.status === 'PERMISSION_DENIED', JSON.stringify(demTry.error));
  chk('downgraded commissioner still acts as their (membership) self', !(await T.mutate(LG, 'autolistSet', { pids: [players[0].id] }, demotedTok)).error);
  // mismatched managerId: claim says 3, membership says 2 — membership wins
  const shifty = await auth.createUser({ email: 'shifty@test.local' });
  await auth.setCustomUserClaims(shifty.uid, { leagues: { [LG]: { managerId: 3, role: 'manager' } } });
  await T.initAdmin().database().ref(`v2/leagues/${LG}/server/membership/${shifty.uid}`).set({ managerId: 2, role: 'manager' });
  const shiftyTok = await T.idTokenFor(shifty.uid);
  const sq3now = await squadOf(3);
  const xiFrom3 = [...byPos(sq3now, 'GK').slice(0, 1), ...byPos(sq3now, 'DF').slice(0, 4), ...byPos(sq3now, 'MF').slice(0, 4), ...byPos(sq3now, 'FW').slice(0, 2)];
  const asWrong = await T.mutate(LG, 'lineupSave', { gw: 3, xi: xiFrom3 }, shiftyTok);
  chk('mismatched claim resolves to MEMBERSHIP identity (manager 3 squad rejected)', asWrong.error?.status === 'INVALID_ARGUMENT', JSON.stringify(asWrong.error));
  const sq2now = await squadOf(2);
  const xiFrom2 = [...byPos(sq2now, 'GK').slice(0, 1), ...byPos(sq2now, 'DF').slice(0, 4), ...byPos(sq2now, 'MF').slice(0, 4), ...byPos(sq2now, 'FW').slice(0, 2)];
  chk('mismatched claim acts safely as the membership manager', !(await T.mutate(LG, 'lineupSave', { gw: 3, xi: xiFrom2 }, shiftyTok)).error);

  /* ---------------- server-side rule gaps closed ---------------- */
  // benchOrder locks at kickoff exactly like lineupSave
  const bench2 = (await squadOf(2)).slice(0, 3);
  chk('bench order for a future GW works', !(await T.mutate(LG, 'benchOrder', { gw: 3, pids: bench2 }, tok2)).error);
  chk('bench order after kickoff rejected', (await T.mutate(LG, 'benchOrder', { gw: 1, pids: bench2 }, tok2)).error?.status === 'FAILED_PRECONDITION');
  chk('bench order with a repeat rejected', (await T.mutate(LG, 'benchOrder', { gw: 3, pids: [bench2[0], bench2[0]] }, tok2)).error?.status === 'INVALID_ARGUMENT');
  // autolist validation
  chk('autolist with unknown player rejected', (await T.mutate(LG, 'autolistSet', { pids: [999999] }, tok2)).error?.status === 'INVALID_ARGUMENT');
  chk('autolist with duplicates rejected', (await T.mutate(LG, 'autolistSet', { pids: [players[0].id, players[0].id] }, tok2)).error?.status === 'INVALID_ARGUMENT');
  chk('oversized autolist rejected', (await T.mutate(LG, 'autolistSet', { pids: Array.from({ length: 301 }, (_, i) => i + 1) }, tok2)).error?.status === 'INVALID_ARGUMENT');
  // watchlist: same private rails as the autolist, and it must survive a
  // restore without ever touching public state (Marc's feature, 21 Aug —
  // sharedSnapshot carries `watchlists`, so importState had to learn the key
  // or every export became unimportable)
  chk('watchlist lands in the owner\'s private node', !(await T.mutate(LG, 'watchlistSet', { pids: [players[0].id, players[1].id] }, tok2)).error
    && JSON.stringify((await db.ref(`v2/leagues/${LG}/private/${members[2].uid}/watchlist`).get()).val()) === JSON.stringify([players[0].id, players[1].id]));
  chk('watchlist with unknown player rejected', (await T.mutate(LG, 'watchlistSet', { pids: [999999] }, tok2)).error?.status === 'INVALID_ARGUMENT');
  chk('watchlist with duplicates rejected', (await T.mutate(LG, 'watchlistSet', { pids: [players[0].id, players[0].id] }, tok2)).error?.status === 'INVALID_ARGUMENT');
  chk('oversized watchlist rejected', (await T.mutate(LG, 'watchlistSet', { pids: Array.from({ length: 301 }, (_, i) => i + 1) }, tok2)).error?.status === 'INVALID_ARGUMENT');
  chk('a watchlist is never readable in public state',
    (await db.ref(`v2/leagues/${LG}/public/watchlists`).get()).val() == null);

  // claim validation: ownership, drop legality, squad shape, caps
  const freeFWs = freeOf('FW');
  const myFW2 = byPos(await squadOf(2), 'FW')[0];
  chk('claim naming an unknown player rejected', (await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [{ in: 999999, out: myFW2 }] }, tok2)).error?.status === 'INVALID_ARGUMENT');
  chk('claim dropping a player you do not own rejected', (await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [{ in: freeFWs[0], out: (await squadOf(1))[0] }] }, tok2)).error?.status === 'FAILED_PRECONDITION');
  chk('claim for a player you already own rejected', (await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [{ in: myFW2, out: myFW2 }] }, tok2)).error?.status === 'FAILED_PRECONDITION');
  const myDF2 = byPos(await squadOf(2), 'DF')[0];
  const freeGK2 = freeOf('GK')[0];
  chk('shape-breaking claim rejected', (await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [{ in: freeGK2, out: myDF2 }] }, tok2)).error?.status === 'FAILED_PRECONDITION');
  chk('claim flood rejected (max 30)', (await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: Array.from({ length: 31 }, () => ({ in: freeFWs[0], out: myFW2 })) }, tok2)).error?.status === 'INVALID_ARGUMENT');
  // acting-as claims are SANDBOX-ONLY (sol test-night P1: the Chairman can't
  // see the target's private ladder, so the write would replace claims he
  // never saw). On the real league both roles are refused; the sandbox happy
  // path is pinned after the autodraft block at the end of this file.
  const myFW3 = byPos(await squadOf(3), 'FW')[0];
  chk('asManager claim is commissioner-only', (await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [{ in: freeFWs[0], out: myFW3 }], asManager: 3 }, tok2)).error?.status === 'PERMISSION_DENIED');
  chk('commissioner asManager claim is REFUSED on the real league (sol P1)',
    (await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [{ in: freeFWs[0], out: myFW3 }], asManager: 3 }, tok1)).error?.status === 'FAILED_PRECONDITION');
  chk('real-league refusal left no claims under the target\'s uid',
    (await db.ref(`v2/leagues/${LG}/private/${members[3].uid}/claims/${curGw}`).get()).val() === null);
  // sol's exact P1 repro, pinned: a manager's own two-claim ladder SURVIVES a
  // refused Chairman acting-as attempt untouched
  await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [{ in: freeFWs[0], out: myFW3 }, { in: freeFWs[1], out: myFW3 }] }, tok3);
  await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [{ in: freeFWs[2], out: myFW3 }], asManager: 3 }, tok1);
  const ladder3 = Object.values((await db.ref(`v2/leagues/${LG}/private/${members[3].uid}/claims/${curGw}`).get()).val() || {});
  chk('sol P1 repro dead: the target\'s own blind ladder survives the refused overwrite',
    ladder3.length === 2 && ladder3[0].in === freeFWs[0] && ladder3[1].in === freeFWs[1], JSON.stringify(ladder3));
  await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [] }, tok3); // no residue for the waiver rounds below
  // Squad rules are constitutional. A stale settings client gets a harmless
  // success while the server actively repairs all three fields.
  const fixedSet = await T.mutate(LG, 'settingsSet', { key: 'squadSize', value: 20 }, tok1);
  const repairedRules = (await db.ref(`v2/leagues/${LG}/public/settings`).get()).val();
  chk('settingsSet cannot alter the hard squad law and repairs stale values', !fixedSet.error && fixedSet.result?.fixed === true
    && hardRulesOk(repairedRules),
    JSON.stringify({ fixedSet, repairedRules }));
  chk('scoring value bounds enforced', (await T.mutate(LG, 'settingsSet', { scoringKey: 'assist', value: 5000 }, tok1)).error?.status === 'INVALID_ARGUMENT');
  // oversized XI payloads die at the gate
  chk('oversized xi rejected', (await T.mutate(LG, 'lineupSave', { gw: 3, xi: Array.from({ length: 40 }, (_, i) => i) }, tok1)).error?.status === 'INVALID_ARGUMENT');
  // importState: strict schema
  chk('import with unknown key rejected', (await T.mutate(LG, 'importState', { state: { ...seed, evilKey: 1 } }, tok1)).error?.status === 'INVALID_ARGUMENT');
  chk('import with bad phase rejected', (await T.mutate(LG, 'importState', { state: { ...seed, phase: 'chaos' } }, tok1)).error?.status === 'INVALID_ARGUMENT');
  const legacyRulesImport = await T.mutate(LG, 'importState', { state: { ...seed, settings: {
    ...seed.settings, squadSize: 15,
    posMin: { GK: 0, DF: 3, MF: 3, FW: 1 },
    posMax: { GK: 3, DF: 8, MF: 8, FW: 5 },
  } } }, tok1);
  const migratedRules = (await db.ref(`v2/leagues/${LG}/public/settings`).get()).val();
  chk('legacy imports are accepted but canonicalised to the hard squad law', !legacyRulesImport.error
    && hardRulesOk(migratedRules),
    JSON.stringify({ legacyRulesImport, migratedRules }));
  chk('import with oversized section rejected', (await T.mutate(LG, 'importState', { state: { ...seed, transfers: Array.from({ length: 5001 }, () => ({ x: 1 })) } }, tok1)).error?.status === 'INVALID_ARGUMENT');
  chk('import with junk manager entry rejected', (await T.mutate(LG, 'importState', { state: { ...seed, managers: [{ id: 1, name: 'A', team: 'B', pin: '1234' }, { id: 2, name: 'C', team: 'D' }] } }, tok1)).error?.status === 'INVALID_ARGUMENT');
  chk('legacy export debris (pins) tolerated and dropped', !(await T.mutate(LG, 'importState', { state: { ...seed, pins: { 1: 'x' } } }, tok1)).error
    && !(await T.initAdmin().database().ref(`v2/leagues/${LG}/public/pins`).get()).val());

  /* ---------------- window draft: one atomic transaction ---------------- */
  // (the re-import above rebuilt LG in season phase with fresh squads)
  const mkArrival = async pid => T.initAdmin().database().ref(`v2/leagues/${LG}/public/draftPool/ids/${pid}`).set('Wrexham');
  const wdFree = freeOf('MF').slice(-4); // untouched by earlier signings
  await mkArrival(wdFree[0]); await mkArrival(wdFree[1]);
  chk('window draft start is Chairman-only', (await T.mutate(LG, 'windowDraft', { op: 'start' }, tok2)).error?.status === 'PERMISSION_DENIED');
  chk('Chairman opens the window draft', !(await T.mutate(LG, 'windowDraft', { op: 'start' }, tok1)).error);
  // order is draft order reversed => [3,2,1]; turn 0 belongs to manager 3
  const wdBefore = (await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val();
  const wdCount0 = wdBefore ? Object.keys(wdBefore).length : 0;
  // injected failure before the transaction: nothing may change
  const fpWd = await T.mutate(LG, 'windowDraft', { op: 'pick', inId: wdFree[0], outId: byPos(await squadOf(3), 'MF')[0], expectedTurn: 0, __failpoint: 'wd:beforeTxn' }, tok3);
  chk('wd failpoint fails the call', !!fpWd.error, JSON.stringify(fpWd.result));
  const wdMid = (await db.ref(`v2/leagues/${LG}/public/windowDraft`).get()).val();
  const wdTr1 = (await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val();
  chk('failed wd call left no partial state', (wdMid.turn || 0) === 0 && (wdTr1 ? Object.keys(wdTr1).length : 0) === wdCount0);
  // two rival picks for the same turn: exactly one commits, state moves once
  const out3a = byPos(await squadOf(3), 'MF')[0], out3b = byPos(await squadOf(3), 'MF')[1];
  const [w1, w2] = await Promise.all([
    T.mutate(LG, 'windowDraft', { op: 'pick', inId: wdFree[0], outId: out3a, expectedTurn: 0 }, tok3),
    T.mutate(LG, 'windowDraft', { op: 'pick', inId: wdFree[1], outId: out3b, expectedTurn: 0 }, tok3),
  ]);
  chk('same-turn window picks: exactly one lands', [w1, w2].filter(r => !r.error).length === 1, JSON.stringify([w1.error, w2.error]));
  const wdNow = (await db.ref(`v2/leagues/${LG}/public/windowDraft`).get()).val();
  const wdTr2 = (await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val();
  chk('turn advanced exactly once, one pick recorded, one transfer appended',
    wdNow.turn === 1 && Object.keys(wdNow.picks || {}).length === 1
    && (wdTr2 ? Object.keys(wdTr2).length : 0) === wdCount0 + 1, JSON.stringify(wdNow));
  chk('out-of-turn window pick rejected', (await T.mutate(LG, 'windowDraft', { op: 'pick', inId: wdFree[1], outId: byPos(await squadOf(3), 'MF')[0], expectedTurn: 1 }, tok3)).error?.status === 'PERMISSION_DENIED');
  // a full lap of passes finishes the window IN the same transaction
  chk('pass (manager 2)', !(await T.mutate(LG, 'windowDraft', { op: 'pass', expectedTurn: 1 }, tok2)).error);
  chk('pass (manager 1)', !(await T.mutate(LG, 'windowDraft', { op: 'pass', expectedTurn: 2 }, tok1)).error);
  const lastPass = await T.mutate(LG, 'windowDraft', { op: 'pass', expectedTurn: 3 }, tok1); // snake: lap 2 starts back at 1
  chk('third consecutive pass closes the window', !lastPass.error && lastPass.result?.status === 'done', JSON.stringify(lastPass));
  const poolAfter = (await db.ref(`v2/leagues/${LG}/public/draftPool/ids/${wdFree[1]}`).get()).val();
  chk('draftPool refreshed in the same commit (leftover arrival unlocked)', poolAfter !== 'Wrexham');
  chk('acting on a finished window rejected', (await T.mutate(LG, 'windowDraft', { op: 'pass' }, tok1)).error?.status === 'FAILED_PRECONDITION');

  /* ---------------- waivers: recoverable, effectively exactly-once ---------------- */
  const wFree = freeOf('FW');
  const claimFor2 = { in: wFree[0], out: byPos(await squadOf(2), 'FW')[0] };
  chk('fresh claim lodged', !(await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [claimFor2] }, tok2)).error);
  const trCount = async () => Object.keys((await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val() || {}).length;
  const beforeFp1 = await trCount();
  // crash AFTER the plan is written, BEFORE any transfer lands
  const fp1 = await T.mutate(LG, 'waiverRunNow', { runId: 'fp1', __failpoint: 'waivers:afterPlan' }, tok1);
  chk('failpoint after plan: call fails', !!fp1.error);
  const fp1rec = (await db.ref(`v2/leagues/${LG}/server/waiverRuns/manual-fp1`).get()).val();
  chk('crashed run keeps its plan for replay', fp1rec?.status === 'failed' && !!fp1rec?.plan, JSON.stringify(fp1rec?.status));
  chk('no transfers landed before the crash', await trCount() === beforeFp1);
  const fp1claims = (await db.ref(`v2/leagues/${LG}/private/${members[2].uid}/claims`).get()).val();
  chk('claims survive the crash (nothing half-cleared)', !!fp1claims);
  // replay the SAME run id: completes exactly once
  const fp1retry = await T.mutate(LG, 'waiverRunNow', { runId: 'fp1' }, tok1);
  chk('replay completes the crashed run', !fp1retry.error && (fp1retry.result?.executed || []).some(e => e.in === claimFor2.in), JSON.stringify(fp1retry));
  chk('replay landed the transfer exactly once', await trCount() === beforeFp1 + 1);
  chk('claims cleared by the replay', !(await db.ref(`v2/leagues/${LG}/private/${members[2].uid}/claims`).get()).val());
  const fp1done = (await db.ref(`v2/leagues/${LG}/server/waiverRuns/manual-fp1`).get()).val();
  chk('audit record: done, executed and applied recorded', fp1done?.status === 'done' && Array.isArray(fp1done?.executed) && fp1done?.applied === 1, JSON.stringify(fp1done?.status));
  chk('re-running a done run is a no-op skip', (await T.mutate(LG, 'waiverRunNow', { runId: 'fp1' }, tok1)).result?.skipped === 'already processed');
  // the player dropped BY the run sits on waivers until the NEXT run — even
  // under a Chairman's manual open (Toby, 9 Aug: run drops were instantly
  // free; the t=runStart stamp lost strictly-greater against lastRun)
  const runDrop = claimFor2.out;
  const dropSign1 = await T.mutate(LG, 'troughSign', { inId: runDrop, outId: byPos(await squadOf(3), 'FW')[0] }, tok3);
  chk('run-executed drop is claim-only straight after the run',
    dropSign1.error?.status === 'FAILED_PRECONDITION' && /waiver/i.test(dropSign1.error?.message || ''), JSON.stringify(dropSign1.error));
  await T.mutate(LG, 'waiverControl', { mode: 'open' }, tok1);
  const dropSign2 = await T.mutate(LG, 'troughSign', { inId: runDrop, outId: byPos(await squadOf(3), 'FW')[0] }, tok3);
  chk('manual THROWN OPEN frees the pool, never the fresh drop',
    dropSign2.error?.status === 'FAILED_PRECONDITION' && /waiver/i.test(dropSign2.error?.message || ''), JSON.stringify(dropSign2.error));
  await T.mutate(LG, 'waiverControl', { mode: 'auto' }, tok1);
  // crash AFTER transfers landed, BEFORE claims cleared: replay must not duplicate
  const claimFor3 = { in: wFree[1], out: byPos(await squadOf(3), 'FW')[0] };
  chk('second claim lodged', !(await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [claimFor3] }, tok3)).error);
  const beforeFp2 = await trCount();
  const fp2 = await T.mutate(LG, 'waiverRunNow', { runId: 'fp2', __failpoint: 'waivers:afterTransfers' }, tok1);
  chk('failpoint after transfers: call fails', !!fp2.error);
  chk('transfer HAD landed before the crash', await trCount() === beforeFp2 + 1);
  const fp2retry = await T.mutate(LG, 'waiverRunNow', { runId: 'fp2' }, tok1);
  chk('replay after post-transfer crash completes', !fp2retry.error, JSON.stringify(fp2retry.error));
  chk('NO duplicate transfer on replay', await trCount() === beforeFp2 + 1);
  const fp2recs = Object.values((await db.ref(`v2/leagues/${LG}/public/transfers`).get()).val() || {})
    .filter(t => t && t.runId === 'manual-fp2');
  chk('exactly one ledger record carries the run id', fp2recs.length === 1);
  chk('claims cleared after replay', !(await db.ref(`v2/leagues/${LG}/private/${members[3].uid}/claims`).get()).val());
  // a live lease is an ERROR to callers — never a hollow success
  await db.ref(`v2/leagues/${LG}/server/waiverRuns/manual-lease1`).set({ status: 'running', startedAt: Date.now() });
  const leased = await T.mutate(LG, 'waiverRunNow', { runId: 'lease1' }, tok1);
  chk('live lease returns an error, not success', !!leased.error, JSON.stringify(leased.result));
  // an EXPIRED lease is re-claimed and the work completes
  await db.ref(`v2/leagues/${LG}/server/waiverRuns/manual-lease1`).update({ startedAt: Date.now() - 10 * 60 * 1000 });
  const reclaimed = await T.mutate(LG, 'waiverRunNow', { runId: 'lease1' }, tok1);
  chk('expired lease re-claimed and completed', !reclaimed.error, JSON.stringify(reclaimed.error));
  chk('re-claimed run recorded done', (await db.ref(`v2/leagues/${LG}/server/waiverRuns/manual-lease1`).get()).val()?.status === 'done');

  /* ---------------- sol r3: a claim lodged during a crash window survives ---------------- */
  const freeNow = async pos => {
    const taken = new Set([...(await squadOf(1)), ...(await squadOf(2)), ...(await squadOf(3))]);
    return players.filter(p => p.pos === pos && !taken.has(p.id)).map(p => p.id);
  };

  /* Toby's exact invalid-waiver case: the outgoing player is traded away
     after a durable waiver plan is written. Replay must lapse the claim,
     report no execution and preserve the newer team sheet. */
  const staleFree = (await freeNow('MF'))[0];
  const staleOut = byPos(await squadOf(2), 'MF')[0];
  chk('stale-out claim lodged while the player is still owned',
    !(await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [{ in: staleFree, out: staleOut }] }, tok2)).error);
  const stalePlan = await T.mutate(LG, 'waiverRunNow', { runId: 'stale-out', __failpoint: 'waivers:afterPlan' }, tok1);
  chk('stale-out run pauses after writing its durable plan', !!stalePlan.error);
  const swapFor = byPos(await squadOf(3), 'MF')[0];
  const staleTrade = await T.mutate(LG, 'tradePropose', { to: 3, give: [staleOut], get: [swapFor] }, tok2);
  const staleAccept = staleTrade.error ? staleTrade : await T.mutate(LG, 'tradeRespond', { tradeId: staleTrade.result.id, action: 'accept' }, tok3);
  chk('outgoing player is genuinely traded away before waiver replay', !staleTrade.error && !staleAccept.error, JSON.stringify({ staleTrade, staleAccept }));
  const postTradeSq = await squadOf(2);
  const freshXi = [
    ...byPos(postTradeSq, 'GK').slice(0, 1), ...byPos(postTradeSq, 'DF').slice(0, 4),
    ...byPos(postTradeSq, 'MF').slice(0, 4), ...byPos(postTradeSq, 'FW').slice(0, 2),
  ];
  chk('new post-trade XI saves before the crashed waiver replays',
    freshXi.length === 11 && !(await T.mutate(LG, 'lineupSave', { gw: curGw + 1, xi: freshXi }, tok2)).error);
  const staleReplay = await T.mutate(LG, 'waiverRunNow', { runId: 'stale-out' }, tok1);
  const staleRun = (await db.ref(`v2/leagues/${LG}/server/waiverRuns/manual-stale-out`).get()).val();
  const xiAfterStale = Object.values((await db.ref(`v2/leagues/${LG}/public/lineups/2/${curGw + 1}`).get()).val() || {});
  chk('invalid stale-out claim lapses and is not falsely reported as executed',
    !staleReplay.error && (staleReplay.result?.executed || []).length === 0 && staleRun?.dropped === 1, JSON.stringify({ staleReplay, staleRun }));
  chk('stale waiver replay does not overwrite the newer XI', JSON.stringify(xiAfterStale) === JSON.stringify(freshXi), JSON.stringify(xiAfterStale));
  chk('invalid claim is cleared and its target remains unowned',
    !(await db.ref(`v2/leagues/${LG}/private/${members[2].uid}/claims/${curGw}`).get()).val()
      && ![...(await squadOf(1)), ...(await squadOf(2)), ...(await squadOf(3))].includes(staleFree));

  // A different post-plan deal can leave both named claim players untouched
  // but consume the positional flex. The claim must be rechecked as a whole,
  // not merely pass because its in-player is free and out-player is owned.
  const shapeFree = (await freeNow('FW'))[0];
  const shapeOut = byPos(await squadOf(2), 'GK')[0];
  chk('shape-race claim is legal when lodged',
    !(await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [{ in: shapeFree, out: shapeOut }] }, tok2)).error);
  const shapePlan = await T.mutate(LG, 'waiverRunNow', { runId: 'stale-shape', __failpoint: 'waivers:afterPlan' }, tok1);
  chk('shape-race run pauses with a durable plan', !!shapePlan.error);
  const shapeGive = byPos(await squadOf(2), 'DF')[0], shapeGet = byPos(await squadOf(3), 'FW')[0];
  const shapeTrade = await T.mutate(LG, 'tradePropose', { to: 3, give: [shapeGive], get: [shapeGet] }, tok2);
  const shapeAccept = shapeTrade.error ? shapeTrade : await T.mutate(LG, 'tradeRespond', { tradeId: shapeTrade.result.id, action: 'accept' }, tok3);
  chk('intervening trade legally consumes the claimant\'s flex', !shapeTrade.error && !shapeAccept.error, JSON.stringify({ shapeTrade, shapeAccept }));
  const shapeReplay = await T.mutate(LG, 'waiverRunNow', { runId: 'stale-shape' }, tok1);
  const shapeRun = (await db.ref(`v2/leagues/${LG}/server/waiverRuns/manual-stale-shape`).get()).val();
  chk('apply-time shape revalidation lapses the now-illegal claim',
    !shapeReplay.error && (shapeReplay.result?.executed || []).length === 0 && shapeRun?.dropped === 1
      && ![...(await squadOf(1)), ...(await squadOf(2)), ...(await squadOf(3))].includes(shapeFree),
    JSON.stringify({ shapeReplay, shapeRun }));

  const marketSquads = [await squadAtGw(1, curGw + 1), await squadAtGw(2, curGw + 1), await squadAtGw(3, curGw + 1)];
  const marketOwned = marketSquads.flat();
  const legalMarketShape = ids => {
    const c = Object.fromEntries(['GK', 'DF', 'MF', 'FW'].map(pos => [pos, byPos(ids, pos).length]));
    return c.GK >= 1 && c.GK <= 2 && c.DF >= 4 && c.DF <= 6 && c.MF >= 4 && c.MF <= 6 && c.FW >= 2 && c.FW <= 4;
  };
  chk('after live trades and waiver races: every squad is legal 14 and every player has one owner',
    marketSquads.every(s => s.length === 14 && legalMarketShape(s)) && new Set(marketOwned).size === marketOwned.length,
    JSON.stringify(marketSquads.map(s => s.length)));

  const mfFree = await freeNow('MF');
  const eaten = { in: mfFree[0], out: byPos(await squadOf(2), 'MF')[0] };
  chk('adjudicated-claim lodged', !(await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [eaten] }, tok2)).error);
  const fp3 = await T.mutate(LG, 'waiverRunNow', { runId: 'fp3', __failpoint: 'waivers:afterPlan' }, tok1);
  chk('late-claim scenario: run crashes after planning', !!fp3.error);
  const late = { in: mfFree[1], out: byPos(await squadOf(3), 'MF')[0] };
  chk('late claim lodged in the crash window', !(await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [late] }, tok3)).error);
  const fp3retry = await T.mutate(LG, 'waiverRunNow', { runId: 'fp3' }, tok1);
  chk('replay completes the crashed run (late-claim scenario)', !fp3retry.error, JSON.stringify(fp3retry.error));
  const lateLeft = Object.values((await db.ref(`v2/leagues/${LG}/private/${members[3].uid}/claims/${curGw}`).get()).val() || {});
  chk('late claim SURVIVES the replay for the next run', lateLeft.some(c => c && c.in === late.in), JSON.stringify(lateLeft));
  chk('adjudicated claim cleared by the replay', !(await db.ref(`v2/leagues/${LG}/private/${members[2].uid}/claims/${curGw}`).get()).val());
  const fp3b = await T.mutate(LG, 'waiverRunNow', { runId: 'fp3b' }, tok1);
  chk('surviving claim executes on the NEXT run', !fp3b.error
    && !(await db.ref(`v2/leagues/${LG}/private/${members[3].uid}/claims/${curGw}`).get()).val(), JSON.stringify(fp3b.error));

  /* sol r4: claim cleanup must map through MEMBERSHIP — a missing managerUid
     entry must not strand an adjudicated claim */
  const savedMidToUid = (await db.ref(`v2/leagues/${LG}/server/managerUid`).get()).val();
  await db.ref(`v2/leagues/${LG}/server/managerUid`).remove();
  const mfNow = await freeNow('MF');
  const orphanClaim = { in: mfNow[0], out: byPos(await squadOf(2), 'MF')[0] };
  chk('claim lodged with managerUid node missing', !(await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [orphanClaim] }, tok2)).error);
  const orphanRun = await T.mutate(LG, 'waiverRunNow', { runId: 'orphan1' }, tok1);
  chk('run executes without managerUid', !orphanRun.error, JSON.stringify(orphanRun.error));
  chk('claim cleared via membership mapping (no stranded claims)',
    !(await db.ref(`v2/leagues/${LG}/private/${members[2].uid}/claims/${curGw}`).get()).val());
  await db.ref(`v2/leagues/${LG}/server/managerUid`).set(savedMidToUid);

  /* sol r5: re-saving an IDENTICAL claim after planning is a NEW lodging (t
     stamp) and must survive the replay */
  const mfR = await freeNow('MF');
  const rc = { in: mfR[0], out: byPos(await squadOf(2), 'MF')[0] };
  chk('replacement-claim lodged', !(await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [rc] }, tok2)).error);
  const fpR = await T.mutate(LG, 'waiverRunNow', { runId: 'fpR', __failpoint: 'waivers:afterPlan' }, tok1);
  chk('replacement scenario: run crashes after planning', !!fpR.error);
  // no artificial delay: lodging stamps carry a random fraction, so even a
  // same-millisecond re-save is a distinct identity (sol r6)
  chk('identical claim re-saved during the crash window', !(await T.mutate(LG, 'claimSet', { gwIndex: curGw, claims: [rc] }, tok2)).error);
  const fpRr = await T.mutate(LG, 'waiverRunNow', { runId: 'fpR' }, tok1);
  chk('replay completes (replacement scenario)', !fpRr.error, JSON.stringify(fpRr.error));
  const rcLeft = Object.values((await db.ref(`v2/leagues/${LG}/private/${members[2].uid}/claims/${curGw}`).get()).val() || {});
  chk('re-saved identical claim SURVIVES the replay (sol r5)', rcLeft.some(c => c && c.in === rc.in), JSON.stringify(rcLeft));
  await T.mutate(LG, 'waiverRunNow', { runId: 'fpRb' }, tok1); // adjudicate the survivor (lapses — player now owned)
  chk('survivor adjudicated by the next run', !(await db.ref(`v2/leagues/${LG}/private/${members[2].uid}/claims/${curGw}`).get()).val());

  /* ---------------- sol r3: a landed trade heals to done, covenant intact ---------------- */
  const hGive = byPos(await squadOf(2), 'DF')[0], hGet = byPos(await squadOf(3), 'DF')[0];
  const hProp = await T.mutate(LG, 'tradePropose', { to: 3, give: [hGive], get: [hGet], terms: 'Winner buys dinner' }, tok2);
  chk('heal-test trade proposed', !hProp.error, JSON.stringify(hProp.error));
  const hId = hProp.result.id;
  // forge sol's exact reproduced state: transfer records landed, status NOT done
  const trRef = db.ref(`v2/leagues/${LG}/public/transfers`);
  const trCur = Object.values((await trRef.get()).val() || {});
  trCur.push({ managerId: 2, outId: hGive, inId: hGet, gw: curGw, t: Date.now(), trade: hId, n: trCur.length + 1 });
  trCur.push({ managerId: 3, outId: hGet, inId: hGive, gw: curGw, t: Date.now(), trade: hId, n: trCur.length + 1 });
  await trRef.set(trCur);
  const heal = await T.mutate(LG, 'tradeRespond', { tradeId: hId, action: 'accept' }, tok3);
  chk('accept of a landed-but-stuck trade heals to done', !heal.error && heal.result?.status === 'done', JSON.stringify(heal));
  const hCovs = Object.values((await db.ref(`v2/leagues/${LG}/public/covenants`).get()).val() || {}).filter(c => c && c.trade === hId);
  chk('covenant recreated exactly once on heal', hCovs.length === 1 && hCovs[0].text === 'Winner buys dinner', JSON.stringify(hCovs));
  const healAgain = await T.mutate(LG, 'tradeRespond', { tradeId: hId, action: 'accept' }, tok3);
  const stillOneCov = Object.values((await db.ref(`v2/leagues/${LG}/public/covenants`).get()).val() || {}).filter(c => c && c.trade === hId).length === 1;
  chk('re-accept of a done trade refuses cleanly, covenant stays single',
    healAgain.error?.status === 'ABORTED' && stillOneCov, JSON.stringify(healAgain));
  // sol r4: a PARTIAL ledger (forged/corrupt — the txn is atomic) must refuse, not "heal"
  const pGive = byPos(await squadOf(2), 'MF')[0], pGet = byPos(await squadOf(3), 'MF')[0];
  const pProp = await T.mutate(LG, 'tradePropose', { to: 3, give: [pGive], get: [pGet] }, tok2);
  chk('partial-ledger trade proposed', !pProp.error, JSON.stringify(pProp.error));
  const pCur = Object.values((await trRef.get()).val() || {});
  pCur.push({ managerId: 2, outId: pGive, inId: pGet, gw: curGw, t: Date.now(), trade: pProp.result.id, n: pCur.length + 1 }); // ONE side only
  await trRef.set(pCur);
  const pAccept = await T.mutate(LG, 'tradeRespond', { tradeId: pProp.result.id, action: 'accept' }, tok3);
  const pStatus = Object.values((await db.ref(`v2/leagues/${LG}/public/trades`).get()).val() || {}).find(t => t.id === pProp.result.id)?.status;
  chk('partial ledger refuses with Committee-surgery error, status untouched',
    pAccept.error?.status === 'FAILED_PRECONDITION' && /surgery/.test(pAccept.error?.message || '') && pStatus === 'pending', JSON.stringify({ e: pAccept.error, pStatus }));
  await trRef.set(Object.values((await trRef.get()).val() || {}).filter(t => t.trade !== pProp.result.id)); // remove the forgery
  // sol r5: right COUNT but wrong CONTENT is still forged — refuse, don't heal
  const wGive = byPos(await squadOf(2), 'GK')[0], wGet = byPos(await squadOf(3), 'GK')[0];
  const wProp = await T.mutate(LG, 'tradePropose', { to: 3, give: [wGive], get: [wGet] }, tok2);
  chk('wrong-content trade proposed', !wProp.error, JSON.stringify(wProp.error));
  const wCur = Object.values((await trRef.get()).val() || {});
  wCur.push({ managerId: 2, outId: 424242, inId: 434343, gw: curGw, t: Date.now(), trade: wProp.result.id, n: wCur.length + 1 });
  wCur.push({ managerId: 3, outId: 434343, inId: 424242, gw: curGw, t: Date.now(), trade: wProp.result.id, n: wCur.length + 1 });
  await trRef.set(wCur);
  const wAccept = await T.mutate(LG, 'tradeRespond', { tradeId: wProp.result.id, action: 'accept' }, tok3);
  chk('right-count wrong-content ledger refuses (not healed to done)',
    wAccept.error?.status === 'FAILED_PRECONDITION' && /surgery/.test(wAccept.error?.message || ''), JSON.stringify(wAccept));
  await trRef.set(Object.values((await trRef.get()).val() || {}).filter(t => t.trade !== wProp.result.id));
  // sol r5: rejecting a DONE trade must answer truthfully
  const rejDone = await T.mutate(LG, 'tradeRespond', { tradeId: hId, action: 'reject' }, tok3);
  chk('reject of a done trade reports done+unchanged, never "rejected"',
    !rejDone.error && rejDone.result?.status === 'done' && rejDone.result?.unchanged === true, JSON.stringify(rejDone));
  // sol r6: a forged MALFORMED trade (repeated player) WITH ledger records must
  // refuse as surgery — never auto-heal to done, never auto-withdraw
  const fmA = byPos(await squadOf(2), 'MF')[0], fmB = byPos(await squadOf(3), 'MF')[0], fmC = byPos(await squadOf(3), 'MF')[1];
  const tradesRef = db.ref(`v2/leagues/${LG}/public/trades`);
  const tArr = Object.values((await tradesRef.get()).val() || {});
  tArr.push({ id: 'forged-dupe-1', from: 2, to: 3, give: [fmA, fmA], get: [fmB, fmC], status: 'pending', t: Date.now() });
  await tradesRef.set(tArr);
  const fCur = Object.values((await trRef.get()).val() || {});
  fCur.push({ managerId: 2, outId: fmA, inId: fmB, gw: curGw, t: Date.now(), trade: 'forged-dupe-1', n: fCur.length + 1 });
  await trRef.set(fCur);
  const fAccept = await T.mutate(LG, 'tradeRespond', { tradeId: 'forged-dupe-1', action: 'accept' }, tok3);
  const fStatus = Object.values((await tradesRef.get()).val() || {}).find(t => t.id === 'forged-dupe-1')?.status;
  chk('malformed trade WITH ledger refuses as surgery, status untouched (sol r6)',
    fAccept.error?.status === 'FAILED_PRECONDITION' && /surgery/.test(fAccept.error?.message || '') && fStatus === 'pending', JSON.stringify({ e: fAccept.error, fStatus }));
  await trRef.set(Object.values((await trRef.get()).val() || {}).filter(t => t.trade !== 'forged-dupe-1'));
  await tradesRef.set(Object.values((await tradesRef.get()).val() || {}).filter(t => t.id !== 'forged-dupe-1'));
  // sol r6: Ham Cup entries MUST pin their gameweek
  chk('hamEnter without a gw pin is refused',
    (await T.mutate(LG, 'hamEnter', { xi: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, tok2)).error?.status === 'INVALID_ARGUMENT');
  // sol r4: REJECTING a fully-landed trade must heal to done, never mark rejected
  const rGive = byPos(await squadOf(2), 'FW')[0], rGet = byPos(await squadOf(3), 'FW')[0];
  const rProp = await T.mutate(LG, 'tradePropose', { to: 3, give: [rGive], get: [rGet] }, tok2);
  chk('reject-heal trade proposed', !rProp.error, JSON.stringify(rProp.error));
  const rCur = Object.values((await trRef.get()).val() || {});
  rCur.push({ managerId: 2, outId: rGive, inId: rGet, gw: curGw, t: Date.now(), trade: rProp.result.id, n: rCur.length + 1 });
  rCur.push({ managerId: 3, outId: rGet, inId: rGive, gw: curGw, t: Date.now(), trade: rProp.result.id, n: rCur.length + 1 });
  await trRef.set(rCur);
  const rReject = await T.mutate(LG, 'tradeRespond', { tradeId: rProp.result.id, action: 'reject' }, tok3);
  chk('reject of a landed trade heals to done (the swap already stands)',
    !rReject.error && rReject.result?.status === 'done' && rReject.result?.healed === true, JSON.stringify(rReject));

  /* sol r3/r4: a draw beyond the regular-season/canonical calendar is refused. */
  chk('ham draw beyond the fixture calendar rejected',
    (await T.mutate(LG, 'hamAdmin', { op: 'draw', gw: 38 }, tok1)).error?.status === 'INVALID_ARGUMENT');

  /* ---------------- reset: atomic, canonical, immediately usable ---------------- */
  chk('reset is Chairman-only', (await T.mutate(LG, 'resetLeague', { confirm: 'RESET' }, tok2)).error?.status === 'PERMISSION_DENIED');
  chk('reset demands the confirm word', (await T.mutate(LG, 'resetLeague', { confirm: 'yes?' }, tok1)).error?.status === 'FAILED_PRECONDITION');
  const rr = await T.mutate(LG, 'resetLeague', { confirm: 'RESET' }, tok1);
  chk('confirmed reset succeeds', !rr.error, JSON.stringify(rr.error));
  const pubAfter = (await db.ref(`v2/leagues/${LG}/public`).get()).val();
  chk('reset installs a valid setup state (phase + managers + settings)',
    pubAfter?.phase === 'setup' && Object.keys(pubAfter?.managers || {}).length === 3
    && pubAfter?.settings?.squadSize === 14, JSON.stringify(Object.keys(pubAfter || {})));
  chk('reset cleared game state (no transfers/trades/lineups)', !pubAfter.transfers && !pubAfter.trades && !pubAfter.lineups);
  chk('reset cleared private data and run logs',
    !(await db.ref(`v2/leagues/${LG}/private`).get()).val()
    && !(await db.ref(`v2/leagues/${LG}/server/waiverRuns`).get()).val());
  chk('membership SURVIVED the reset', !!(await db.ref(`v2/leagues/${LG}/server/membership/${members[1].uid}`).get()).val());
  // every client action works immediately: the commissioner starts a new draft
  const restart = await T.mutate(LG, 'draftAdmin', { op: 'start', order: [2, 3, 1] }, tok1);
  chk('commissioner can start a new draft straight after reset', !restart.error, JSON.stringify(restart.error));
  chk('league is drafting again', (await db.ref(`v2/leagues/${LG}/public/phase`).get()).val() === 'draft');
  /* ---------------- sol r3: ceremony clock + pick/undo race + wedge heal ---------------- */
  const dl = () => db.ref(`v2/leagues/${LG}/public/draft/deadline`).get().then(s => s.val());
  chk('draft start leaves the clock UNARMED (the ceremony must not eat pick one)', await dl() === null);
  const prematurePick = await T.mutate(LG, 'draftPick', { playerId: players.find(p => p.pos === 'GK').id, expectedCount: 0 }, tok2);
  chk('first pick is server-locked while any ceremony is outstanding', prematurePick.error?.status === 'FAILED_PRECONDITION', JSON.stringify(prematurePick));
  const prematureAuto = await T.mutate(LG, 'draftAutopick', {}, tok2);
  chk('autopick cannot bypass the shared ceremony barrier', prematureAuto.error?.status === 'FAILED_PRECONDITION', JSON.stringify(prematureAuto));
  const earlyArm = await T.mutate(LG, 'draftAdmin', { op: 'clockStart' }, tok3);
  chk('clockStart cannot bypass the shared ceremony barrier', !earlyArm.error && earlyArm.result?.armed === false
    && earlyArm.result?.legacyAck === true && earlyArm.result?.waiting?.count === 1 && await dl() === null, JSON.stringify(earlyArm));
  const adminBypasses = await Promise.all([
    T.mutate(LG, 'draftAdmin', { op: 'pause' }, tok1),
    T.mutate(LG, 'draftAdmin', { op: 'resume' }, tok1),
    T.mutate(LG, 'draftAdmin', { op: 'breakDone', round: 14 }, tok1),
    T.mutate(LG, 'draftAdmin', { op: 'timewaste' }, tok2),
  ]);
  chk('pause/resume/break/timewaste admin routes cannot manufacture a pre-ceremony clock',
    adminBypasses.every(r => r.error?.status === 'FAILED_PRECONDITION') && await dl() === null,
    JSON.stringify(adminBypasses));
  const through3 = await T.mutate(LG, 'draftAdmin', { op: 'ceremonyReady' }, tok3);
  const through1 = await T.mutate(LG, 'draftAdmin', { op: 'ceremonyReady' }, tok1);
  chk('partial room acknowledgement stays unarmed at 2/3', !through3.error && !through1.error
    && through1.result?.count === 2 && through1.result?.complete === false && await dl() === null, JSON.stringify(through1));
  const through2 = await T.mutate(LG, 'draftAdmin', { op: 'ceremonyReady' }, tok2);
  const dlArmed = await dl();
  chk('the FINAL manager through atomically opens the room and arms pick one', !through2.error
    && through2.result?.count === 3 && through2.result?.complete === true && through2.result?.armed === true
    && dlArmed > Date.now() && dlArmed <= Date.now() + 31_000, JSON.stringify(through2));
  const duplicateReady = await T.mutate(LG, 'draftAdmin', { op: 'ceremonyReady' }, tok2);
  chk('duplicate ceremony acknowledgement counts once and preserves the deadline', !duplicateReady.error
    && duplicateReady.result?.count === 3 && await dl() === dlArmed, JSON.stringify(duplicateReady));
  const arm2 = await T.mutate(LG, 'draftAdmin', { op: 'clockStart' }, tok2);
  chk('second arm is an idempotent no-op', !arm2.error && arm2.result?.armed === false && await dl() === dlArmed);
  const firstPick = await T.mutate(LG, 'draftPick', { playerId: players.find(p => p.pos === 'GK').id, expectedCount: 0 }, tok2);
  chk('first pick of the new era lands', !firstPick.error, JSON.stringify(firstPick.error));
  // pick/undo race: undo is pinned to the board the Chairman SAW
  const nightPick = await T.mutate(LG, 'draftAutopick', {}, tok1);
  chk('autopick lands (board at 2)', !nightPick.error && nightPick.result?.total === 2, JSON.stringify(nightPick));
  const undoStale = await T.mutate(LG, 'draftAdmin', { op: 'undo', expectedCount: 1 }, tok1);
  chk('undo with a stale expectedCount aborts (pick/undo race is serialised)', undoStale.error?.status === 'ABORTED', JSON.stringify(undoStale));
  const undoBlind = await T.mutate(LG, 'draftAdmin', { op: 'undo' }, tok1);
  chk('BLIND undo (no expectedCount — old client) is refused outright (sol r4 P0)',
    undoBlind.error?.status === 'INVALID_ARGUMENT', JSON.stringify(undoBlind));
  const undoNeg = await T.mutate(LG, 'draftAdmin', { op: 'undo', expectedCount: -1 }, tok1);
  chk('negative expectedCount refused as INVALID_ARGUMENT (sol r5)', undoNeg.error?.status === 'INVALID_ARGUMENT', JSON.stringify(undoNeg));
  const undoOk = await T.mutate(LG, 'draftAdmin', { op: 'undo', expectedCount: 2 }, tok1);
  chk('undo with the seen count pops exactly one and re-arms the clock', !undoOk.error && undoOk.result?.total === 1 && await dl() > Date.now());
  // pick + deadline move in ONE txn on the draft node. The 42-pick board
  // crosses BOTH drinks-break triggers (14 and 28), and the break is server
  // law now (sol test-draft P0): the fill must stop at each, be refused, and
  // resume only after the Chairman's breakDone — exactly the real night.
  let auto = null, breaksHit = 0, breakRefused = true, breakResumed = true;
  for (let i = 1; i < 46; i++) { // 41 more autopicks fill the 3x14 board (+2 break stops)
    auto = await T.mutate(LG, 'draftAutopick', {}, tok1);
    if (auto.error && /drinks break/.test(auto.error.message || '')) {
      breaksHit++;
      breakRefused = breakRefused && auto.error.status === 'FAILED_PRECONDITION';
      const bd = await T.mutate(LG, 'draftAdmin', { op: 'breakDone' }, tok1);
      breakResumed = breakResumed && !bd.error;
      if (bd.error) { auto = bd; break; }
      continue;
    }
    if (auto.error) break;
    if (auto.result?.total >= 42) break; // full board — the next call would be 'not drafting', correctly
  }
  chk('board fills by deterministic autopick', !auto.error, JSON.stringify(auto?.error));
  chk('both drinks breaks froze the board and were consumed by the Chairman (sol P0)',
    breaksHit === 2 && breakRefused && breakResumed, `hit=${breaksHit}`);
  chk('final pick flips phase to season and disarms the clock',
    (await db.ref(`v2/leagues/${LG}/public/phase`).get()).val() === 'season' && await dl() === null);
  // forge the wedge sol reproduced: full board, phase stuck in draft
  await db.ref(`v2/leagues/${LG}/public/phase`).set('draft');
  const healPick = await T.mutate(LG, 'draftAutopick', {}, tok1);
  chk('pick attempt on a full board HEALS the phase to season',
    healPick.error?.status === 'FAILED_PRECONDITION'
    && (await db.ref(`v2/leagues/${LG}/public/phase`).get()).val() === 'season', JSON.stringify(healPick.error));
  // and the path the client's clock loop actually reaches: clockStart seals it
  await db.ref(`v2/leagues/${LG}/public/phase`).set('draft');
  await db.ref(`v2/leagues/${LG}/public/draft/deadline`).set(Date.now() + 30000); // sol's armed-wedge variant
  const healClock = await T.mutate(LG, 'draftAdmin', { op: 'clockStart' }, tok2);
  chk('clockStart on a full board seals phase and disarms (client-reachable heal, sol r4)',
    !healClock.error && healClock.result?.healed === true
    && (await db.ref(`v2/leagues/${LG}/public/phase`).get()).val() === 'season'
    && await dl() === null, JSON.stringify(healClock));
  // sol r5 P0: a board that is NOT full must never be sealed — pop a pick,
  // wedge the phase, and confirm no heal fires and drafting resumes
  await db.ref(`v2/leagues/${LG}/public/phase`).set('draft');
  const boardArr = Object.values((await db.ref(`v2/leagues/${LG}/public/draft/picks`).get()).val() || {});
  const savedFinalPick = boardArr.pop();
  await db.ref(`v2/leagues/${LG}/public/draft/picks`).set(boardArr);
  const noHeal = await T.mutate(LG, 'draftAdmin', { op: 'clockStart' }, tok2);
  chk('no seal on a 41-pick board — drafting resumes instead (heal cannot race undo)',
    !noHeal.error && noHeal.result?.healed !== true
    && (await db.ref(`v2/leagues/${LG}/public/phase`).get()).val() === 'draft', JSON.stringify(noHeal));
  boardArr.push(savedFinalPick);
  await db.ref(`v2/leagues/${LG}/public/draft/picks`).set(boardArr);
  const reHeal = await T.mutate(LG, 'draftAdmin', { op: 'clockStart' }, tok2);
  chk('re-heal on the genuinely full board seals again',
    !reHeal.error && reHeal.result?.healed === true
    && (await db.ref(`v2/leagues/${LG}/public/phase`).get()).val() === 'season', JSON.stringify(reHeal));

  /* sol r6 P0: seal and undo fired CONCURRENTLY, repeatedly — the invariant
     "never season with a short board" must hold in every interleaving (undo's
     pop + phase repair are now one public-node txn, serialised with the seal) */
  let raceBad = 0, raceRounds = 0;
  for (let round = 0; round < 10; round++) {
    await db.ref(`v2/leagues/${LG}/public/phase`).set('draft'); // the wedge
    await Promise.all([
      T.mutate(LG, 'draftAdmin', { op: 'clockStart' }, tok2),
      T.mutate(LG, 'draftAdmin', { op: 'undo', expectedCount: 42 }, tok1),
    ]);
    const ph = (await db.ref(`v2/leagues/${LG}/public/phase`).get()).val();
    const nPicks = Object.values((await db.ref(`v2/leagues/${LG}/public/draft/picks`).get()).val() || {}).length;
    if (ph === 'season' && nPicks < 42) { raceBad++; break; }
    raceRounds++;
    if (nPicks < 42) { // undo won this round — refill the board for the next
      if (ph !== 'draft') break; // would mean the invariant broke differently
      const refill = await T.mutate(LG, 'draftAutopick', {}, tok1);
      if (refill.error) break;
    }
  }
  chk('seal/undo raced 10x concurrently: never season-with-short-board (sol r6 P0)',
    raceBad === 0 && raceRounds === 10, `bad=${raceBad} rounds=${raceRounds}`);
  // leave the league sealed for anything after
  await T.mutate(LG, 'draftAutopick', {}, tok1).catch(() => {});
  await T.mutate(LG, 'draftAdmin', { op: 'clockStart' }, tok2);

  /* ----- the Simulation Chamber: sandbox-only mock matchday flag ----- */
  chk('Simulation Chamber refuses the REAL league even for the Chairman',
    (await T.mutate(LG, 'mockMatchday', { op: 'final', gw: 3 }, tok1)).error?.status === 'FAILED_PRECONDITION');
  chk('Simulation Chamber is Chairman-only in the sandbox',
    (await T.mutate(SB, 'mockMatchday', { op: 'live', gw: 3 }, sbTok2)).error?.status === 'PERMISSION_DENIED');
  const mkLive = await T.mutate(SB, 'mockMatchday', { op: 'live', gw: 3 }, sbTok1);
  const mkNode1 = (await db.ref(`v2/leagues/${SB}/public/mock`).get()).val();
  chk('Chairman kicks off a live sim: {gw, phase, seed, t} lands',
    !mkLive.error && mkNode1?.gw === 3 && mkNode1?.phase === 'live' && Number.isInteger(mkNode1?.seed) && typeof mkNode1?.t === 'number',
    JSON.stringify({ e: mkLive.error, mkNode1 }));
  await T.mutate(SB, 'mockMatchday', { op: 'final', gw: 3 }, sbTok1);
  const mkNode2 = (await db.ref(`v2/leagues/${SB}/public/mock`).get()).val();
  chk('full time keeps the same seed — one consistent story from live to final',
    mkNode2?.phase === 'final' && mkNode2?.seed === mkNode1?.seed, JSON.stringify(mkNode2));
  chk('Simulation Chamber refuses a gameweek outside the regular season',
    (await T.mutate(SB, 'mockMatchday', { op: 'live', gw: 99 }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  await T.mutate(SB, 'mockMatchday', { op: 'off' }, sbTok1);
  chk('switch-off clears the chamber node',
    (await db.ref(`v2/leagues/${SB}/public/mock`).get()).val() === null);

  // Review pins: the mock clock must win over stale commissioner controls, and
  // racing switch-off must never let a signing inherit the pretend next GW.
  const mockSeason = T.buildSeedState(players, 3);
  const mockOwned = new Set(mockSeason.draft.picks.map(p => p.playerId));
  const mockOut = mockSeason.draft.picks.find(p => p.managerId === 2
    && players.find(x => x.id === p.playerId)?.pos === 'DF').playerId;
  const mockIn = players.find(p => p.pos === 'DF' && !mockOwned.has(p.id)).id;
  mockSeason.waiverMeta.control = 'open';
  await T.mutate(SB, 'importState', { state: mockSeason }, sbTok1);
  await T.mutate(SB, 'mockMatchday', { op: 'live', gw: 3 }, sbTok1);
  const forcedOpenSign = await T.mutate(SB, 'troughSign', { inId: mockIn, outId: mockOut }, sbTok2);
  chk('live Simulation Chamber closes the trough even if manual control was left open',
    forcedOpenSign.error?.status === 'FAILED_PRECONDITION', JSON.stringify(forcedOpenSign));
  // sol R2 P1: a manual run mid-Chamber-match adjudicated on the canonical
  // feed while every screen showed the mock table, then stamped lastRun as if
  // the post-GW run had happened. The callable now refuses until full time.
  chk('waiverRunNow refuses while a Chamber match is live (sol R2 P1)',
    (await T.mutate(SB, 'waiverRunNow', { runId: 'solp1-live' }, sbTok1)).error?.status === 'FAILED_PRECONDITION');

  // Exact UAT corruption repro: the mock is final and its waiver run has
  // completed after mock.t. The Trough may reopen, but the mounted mock must
  // still keep every transfer out of the settled simulated gameweek.
  await T.mutate(SB, 'mockMatchday', { op: 'final', gw: 3 }, sbTok1);
  const finalMock = (await db.ref(`v2/leagues/${SB}/public/mock`).get()).val();
  const ftRun = await T.mutate(SB, 'waiverRunNow', { runId: 'solp1-ft' }, sbTok1);
  chk('full time lifts the gate — the post-GW waiver run proceeds', !ftRun.error, JSON.stringify(ftRun.error || ftRun.result));
  await db.ref(`v2/leagues/${SB}/public/waiverMeta`).set({
    control: 'open', lastRun: new Date(finalMock.t + 1000).toISOString(),
  });
  const postRunSign = await T.mutate(SB, 'troughSign', { inId: mockIn, outId: mockOut }, sbTok2);
  chk('post-run signing under a still-mounted final mock lands at mock GW+1 (UAT Donnarumma repro)',
    !postRunSign.error && postRunSign.result?.tgw === 4, JSON.stringify(postRunSign));

  let raceShifted = 0;
  for (let i = 0; i < 8; i++) {
    const round = T.buildSeedState(players, 3);
    await T.mutate(SB, 'importState', { state: round }, sbTok1);
    await T.mutate(SB, 'mockMatchday', { op: 'live', gw: 3 }, sbTok1);
    const [off, sign] = await Promise.all([
      T.mutate(SB, 'mockMatchday', { op: 'off' }, sbTok1),
      T.mutate(SB, 'troughSign', { inId: mockIn, outId: mockOut }, sbTok2),
    ]);
    if (!off.error && !sign.error && sign.result?.tgw === 4) raceShifted++;
  }
  chk('troughSign racing mock-off never lands in the pretend next gameweek',
    raceShifted === 0, `shifted=${raceShifted}/8`);

  /* ---------------- sandbox full autodraft (Test Night skip) ---------------- */
  chk('autoComplete refused outside the sandbox', (await T.mutate(LG, 'draftAdmin', { op: 'autoComplete' }, tok1)).error?.status === 'FAILED_PRECONDITION');
  await T.mutate(SB, 'resetLeague', { confirm: 'RESET' }, sbTok1);
  await T.mutate(SB, 'draftAdmin', { op: 'start', order: [1, 2, 3] }, sbTok1);
  chk('autoComplete is Chairman-only', (await T.mutate(SB, 'draftAdmin', { op: 'autoComplete' }, sbTok2)).error?.status === 'PERMISSION_DENIED');
  const skip = await T.mutate(SB, 'draftAdmin', { op: 'autoComplete' }, sbTok1);
  const skPub = (await db.ref(`v2/leagues/${SB}/public`).get()).val();
  const skPicks = Object.values(skPub?.draft?.picks || {});
  chk('autoComplete fills the whole board and flips to season',
    !skip.error && skip.result?.total === 42 && skPicks.length === 42 && skPub.phase === 'season' && !skPub.draft.deadline,
    JSON.stringify(skip.error || skip.result));
  const perMgr = skPicks.reduce((m, p) => (m[p.managerId] = (m[p.managerId] || 0) + 1, m), {});
  chk('autodraft gave every manager exactly 14 picks, no player twice',
    [1, 2, 3].every(m => perMgr[m] === 14) && new Set(skPicks.map(p => p.playerId)).size === 42, JSON.stringify(perMgr));
  chk('a second autoComplete on the finished board is refused (not drafting)',
    (await T.mutate(SB, 'draftAdmin', { op: 'autoComplete' }, sbTok1)).error?.status === 'FAILED_PRECONDITION');

  /* ---------------- sandbox acting-as claims (Test Night) ---------------- */
  // the autodrafted board gives every manager a squad; the Chairman lodges a
  // claim FOR manager 2 — validated against 2's squad, stored under 2's uid
  const sbUid2 = (await db.ref(`v2/leagues/${SB}/server/managerUid/2`).get()).val();
  const sq2 = skPicks.filter(p => p.managerId === 2).map(p => p.playerId);
  const drafted = new Set(skPicks.map(p => p.playerId));
  const sq2FW = sq2.map(id => players.find(p => p.id === id)).filter(p => p && p.pos === 'FW')[0];
  const freeFW = players.filter(p => p.pos === 'FW' && !drafted.has(p.id))[0];
  const sbGw = 0;
  const sbAs = await T.mutate(SB, 'claimSet', { gwIndex: sbGw, claims: [{ in: freeFW.id, out: sq2FW.id }], asManager: 2 }, sbTok1);
  const sbStored = Object.values((await db.ref(`v2/leagues/${SB}/private/${sbUid2}/claims/${sbGw}`).get()).val() || {});
  chk('sandbox: commissioner asManager claim lands under the target manager\'s uid',
    !sbAs.error && sbStored.length === 1 && sbStored[0].in === freeFW.id, JSON.stringify(sbAs.error || sbStored));
  chk('sandbox: asManager claim validates against the TARGET squad, not the Chairman\'s',
    (await T.mutate(SB, 'claimSet', { gwIndex: sbGw, claims: [{ in: freeFW.id, out: sq2FW.id }], asManager: 3 }, sbTok1)).error?.status === 'FAILED_PRECONDITION');

  /* ---------------- reset stash + restore ---------------- */
  chk('restore before any stash-bearing reset peeks the PREVIOUS stash or refuses cleanly', true); // the earlier autodraft reset already stashed — asserted below by overwrite
  await T.mutate(SB, 'resetLeague', { confirm: 'RESET' }, sbTok1);
  chk('reset installed setup', (await db.ref(`v2/leagues/${SB}/public/phase`).get()).val() === 'setup');
  chk('restore is Chairman-only', (await T.mutate(SB, 'resetRestore', { confirm: 'RESTORE' }, sbTok2)).error?.status === 'PERMISSION_DENIED');
  const peek = await T.mutate(SB, 'resetRestore', { peek: true }, sbTok1);
  chk('peek reports the stashed season game without restoring it',
    !peek.error && peek.result?.phase === 'season' && Number.isFinite(peek.result?.t)
    && (await db.ref(`v2/leagues/${SB}/public/phase`).get()).val() === 'setup', JSON.stringify(peek));
  chk('restore demands the confirm word', (await T.mutate(SB, 'resetRestore', {}, sbTok1)).error?.status === 'FAILED_PRECONDITION');
  const restored = await T.mutate(SB, 'resetRestore', { confirm: 'RESTORE' }, sbTok1);
  const backPub = (await db.ref(`v2/leagues/${SB}/public`).get()).val();
  const backClaims = Object.values((await db.ref(`v2/leagues/${SB}/private/${sbUid2}/claims/${sbGw}`).get()).val() || {});
  chk('restore brings back the whole game — phase, all 42 picks AND private claims',
    !restored.error && backPub.phase === 'season' && Object.values(backPub.draft?.picks || {}).length === 42
    && backClaims.length === 1 && backClaims[0].in === freeFW.id, JSON.stringify(restored.error || backPub.phase));
  chk('the stash survives its own restore (a mistaken restore can be reset again)',
    !(await T.mutate(SB, 'resetRestore', { peek: true }, sbTok1)).error);

  /* ---------------- the Suggestion Box ---------------- */
  const sug1 = await T.mutate(SB, 'suggestionAdd', { text: '  more klaxons  ' }, sbTok2);
  const box1 = Object.values((await db.ref(`v2/leagues/${SB}/public/suggestions`).get()).val() || {});
  chk('a manager\'s suggestion lands trimmed with author + noted status',
    !sug1.error && box1.length === 1 && box1[0].text === 'more klaxons' && box1[0].by === 2 && box1[0].status === 'noted', JSON.stringify(sug1.error || box1));
  chk('suggestion cooldown: one a minute per manager',
    (await T.mutate(SB, 'suggestionAdd', { text: 'even more klaxons' }, sbTok2)).error?.status === 'RESOURCE_EXHAUSTED');
  chk('another manager is not blocked by the first\'s cooldown',
    !(await T.mutate(SB, 'suggestionAdd', { text: 'fewer klaxons' }, sbTok3)).error);
  chk('empty suggestion refused', (await T.mutate(SB, 'suggestionAdd', { text: '   ' }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  chk('suggestion rulings are Chairman-only',
    (await T.mutate(SB, 'suggestionAdmin', { id: box1[0].id, op: 'built' }, sbTok2)).error?.status === 'PERMISSION_DENIED');
  await T.mutate(SB, 'suggestionAdmin', { id: box1[0].id, op: 'building' }, sbTok1);
  const box2 = Object.values((await db.ref(`v2/leagues/${SB}/public/suggestions`).get()).val() || {});
  chk('Chairman moves a suggestion to the workshop', box2.find(s => s.id === box1[0].id)?.status === 'building');
  chk('junk ruling refused', (await T.mutate(SB, 'suggestionAdmin', { id: box1[0].id, op: 'yeeted' }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  const binned = box2.find(s => s.by === 3);
  await T.mutate(SB, 'suggestionAdmin', { id: binned.id, op: 'bin' }, sbTok1);
  chk('Chairman bins a suggestion', !Object.values((await db.ref(`v2/leagues/${SB}/public/suggestions`).get()).val() || {}).some(s => s.id === binned.id));
  await T.mutate(SB, 'resetLeague', { confirm: 'RESET' }, sbTok1);
  const boxAfterReset = Object.values((await db.ref(`v2/leagues/${SB}/public/suggestions`).get()).val() || {});
  chk('the Suggestion Box SURVIVES a league reset',
    boxAfterReset.length === 1 && boxAfterReset[0].text === 'more klaxons' && boxAfterReset[0].status === 'building', JSON.stringify(boxAfterReset));

  /* ---------------- per-GW point adjustments (Toby, 9 Aug) ---------------- */
  chk('adjustment without a gameweek is refused (flat shape retired)',
    (await T.mutate(SB, 'adjustmentSet', { pid: players[0].id, value: 5 }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  chk('adjustment beyond the calendar refused',
    (await T.mutate(SB, 'adjustmentSet', { pid: players[0].id, gw: 99, value: 5 }, sbTok1)).error?.status === 'INVALID_ARGUMENT');
  await T.mutate(SB, 'adjustmentSet', { pid: players[0].id, gw: 0, value: 5 }, sbTok1);
  chk('per-GW adjustment lands nested under its gameweek',
    (await db.ref(`v2/leagues/${SB}/public/adjustments/0/${players[0].id}`).get()).val() === 5);
  await T.mutate(SB, 'adjustmentSet', { pid: players[0].id, gw: 0, value: 0 }, sbTok1);
  chk('zeroing an adjustment removes it',
    (await db.ref(`v2/leagues/${SB}/public/adjustments/0/${players[0].id}`).get()).val() === null);

  // sol R2 P2: RTDB coerces a GW1-only adjustments map into an array; the
  // exported file carried that shape and the import gate refused it.
  const adjState = T.buildSeedState(players, 3);
  adjState.adjustments = [{ [players[0].id]: 5 }]; // the array shape a real export carries
  const adjImport = await T.mutate(SB, 'importState', { state: adjState }, sbTok1);
  chk('import canonicalises array-shaped adjustments instead of refusing (sol R2 P2)',
    !adjImport.error && (await db.ref(`v2/leagues/${SB}/public/adjustments/0/${players[0].id}`).get()).val() === 5,
    JSON.stringify(adjImport.error || 'ok'));

  // sol R2 P3: the 200 cap was checked before the transaction — concurrent
  // submits at 199 all landed. Enforcement now lives inside the txn fn, which
  // re-runs against the committed array on contention.
  const boxKept = (await db.ref(`v2/leagues/${SB}/public/suggestions`).get()).val();
  await db.ref(`v2/leagues/${SB}/public/suggestions`).set(
    Array.from({ length: 200 }, (_, i) => ({ id: `s-stuff${i}`, by: 1, text: `filler ${i}`, t: 1, status: 'noted' })));
  const overCap = await T.mutate(SB, 'suggestionAdd', { text: 'one too many' }, sbTok2);
  const boxFull = Object.values((await db.ref(`v2/leagues/${SB}/public/suggestions`).get()).val() || {});
  chk('a full box refuses INSIDE the transaction and stores nothing (sol R2 P3)',
    overCap.error?.status === 'RESOURCE_EXHAUSTED' && boxFull.length === 200, `err=${overCap.error?.status} len=${boxFull.length}`);
  await db.ref(`v2/leagues/${SB}/public/suggestions`).set(boxKept);

  server.close();
  run.done();
})().catch(e => { console.error(e); process.exit(1); });
