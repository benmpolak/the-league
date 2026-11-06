/* Ben, 4 Sept: regressions for the audit's private-plan leak and same-manager
 * signing race. Real transactions/rules, synthetic league, emulators only. */
'use strict';
if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run through npm run test:emu; emulators are required');
}
const T = require('./testenv.js');
const Engine = require('../js/engine.js');
const Functions = require('../functions/index.js');

(async () => {
  const run = T.makeRunner('reliability');
  const { chk } = run;
  const { players, gws, dir } = T.genTestData();
  const server = await T.serveTestData(dir);
  await T.wipe();
  const league = 'the-league-2627';
  const base = `v2/leagues/${league}`;
  const members = await T.provision(league, [
    { managerId: 1, email: 'chair@reliability.local', role: 'commissioner' },
    { managerId: 2, email: 'two@reliability.local' },
    { managerId: 3, email: 'three@reliability.local' },
  ]);
  const chair = await T.idTokenFor(members[1].uid);
  const manager = await T.idTokenFor(members[2].uid);
  const db = T.initAdmin().database();
  const seed = T.buildSeedState(players, 3);
  seed.waiverMeta.control = 'open';
  const eng = Engine.make({ players, gameweeks: gws.map(g => ({ ...g, from: g.deadline })), now: () => Date.now() });
  const owned = new Set(seed.draft.picks.map(p => p.playerId));
  const mine = eng.squadAt(seed, 2, 2);
  const free = pos => players.filter(p => p.pos === pos && !owned.has(p.id));
  const drop = pos => mine.find(p => p.pos === pos).id;
  const moves = [
    { inId: free('DF')[0].id, outId: drop('GK') },
    { inId: free('DF')[1].id, outId: drop('FW') },
  ];
  const reset = () => db.ref(`${base}/public`).set(seed);
  const stateNow = async () => {
    const state = (await db.ref(`${base}/public`).get()).val();
    state.transfers = Object.values(state.transfers || {});
    return state;
  };
  const record = m => ({ ...m, managerId: 2, gw: 2, t: Date.now() });

  await reset();
  const sequential = [];
  for (const move of moves) sequential.push(await T.mutate(league, 'troughSign', move, manager));
  chk('sequential control: second move is illegal', !sequential[0].error && sequential[1].error?.status === 'FAILED_PRECONDITION');

  // Both calls have already loaded/validated the old state before either
  // commits. Deliberately retain that snapshot for the second commit: this
  // reproduces the interleaving every time, without a timing lottery.
  await reset();
  const append = Functions._transferTest.appendTransfers;
  chk('both moves individually fit the original squad', moves.every(m =>
    eng.squadShapeOk(seed, eng.squadAt({ ...seed, transfers: [record(m)] }, 2, 2))));
  await append(league, seed, eng, [record(moves[0])], 2);
  const staleSecond = await append(league, seed, eng, [record(moves[1])], 2).then(() => null, e => e);
  chk('second stale request is rejected by the transaction', staleSecond?.code === 'aborted');
  const afterStale = await stateNow();
  chk('ledger and squad remain legal after stale request', afterStale.transfers.length === 1 && eng.squadShapeOk(afterStale, eng.squadAt(afterStale, 2, 2)));

  await reset();
  const legalMoves = [
    { inId: free('GK')[0].id, outId: drop('GK') },
    { inId: free('FW')[0].id, outId: drop('FW') },
  ];
  const legalCalls = await Promise.all(legalMoves.map(m => append(league, seed, eng, [record(m)], 2)));
  const afterLegal = await stateNow();
  chk('two compatible same-manager moves both commit', legalCalls.length === 2 && afterLegal.transfers.length === 2 && eng.squadShapeOk(afterLegal, eng.squadAt(afterLegal, 2, 2)));
  const oldLineup = mine.slice(0, 11).map(p => p.id);
  oldLineup.push(drop('FW'));
  const oldState = { ...seed, lineups: { 2: { 2: oldLineup } } };
  await db.ref(`${base}/public/lineups/2/2`).set(oldLineup);
  await Promise.all(legalMoves.map(m => Functions._transferTest.stripLineup(league, oldState, 2, 2, m.outId)));
  const stripped = Object.values((await db.ref(`${base}/public/lineups/2/2`).get()).val() || {});
  chk('compatible signings remove both outgoing players from the current lineup',
    legalMoves.every(m => !stripped.includes(m.outId)) && stripped.length === oldLineup.length - 2);

  for (let i = 0; i < 8; i++) {
    await reset();
    const calls = await Promise.all(moves.map(m => T.mutate(league, 'troughSign', m, manager)));
    const state = await stateNow();
    chk(`concurrent callable pair ${i + 1}: one winner, legal squad`,
      calls.filter(c => !c.error).length === 1 && state.transfers.length === 1 && eng.squadShapeOk(state, eng.squadAt(state, 2, 2)));
  }

  await reset();
  const pair = { in: free('DF')[0].id, out: drop('DF') };
  for (const gwIndex of [1, 2]) {
    const lodged = await T.mutate(league, 'claimSet', { gwIndex, claims: [pair] }, manager);
    chk(`manager lodges private bucket ${gwIndex}`, !lodged.error);
  }
  const id = 'manual-private-plan';
  const crashed = await T.mutate(league, 'waiverRunNow', { runId: 'private-plan', __failpoint: 'waivers:afterPlan' }, chair);
  chk('crash probe stopped after writing a durable plan', !!crashed.error);
  const plan = (await db.ref(`${base}/server/waiverRuns/${id}/plan`).get()).val();
  chk('recovery plan retains adjudicated claims but excludes next-week claims', !!plan?.consumed?.[1]?.[2] && !plan?.consumed?.[2]);
  const forbidden = r => [401, 403].includes(r.status);
  for (const [label, token] of [['anonymous', null], ['other manager', chair]]) {
    chk(`${label} cannot read private claims`, forbidden(await T.rest('GET', `${base}/private/${members[2].uid}/claims`, { token })));
    chk(`${label} cannot read the pending recovery plan`, forbidden(await T.rest('GET', `${base}/server/waiverRuns/${id}/plan/consumed`, { token })));
  }
  const replay = await T.mutate(league, 'waiverRunNow', { runId: 'private-plan' }, chair);
  chk('private plan still replays the winning transfer', !replay.error && replay.result?.executed?.some(e => e.in === pair.in));
  chk('next-week claim survives replay', !!(await db.ref(`${base}/private/${members[2].uid}/claims/2`).get()).val());
  chk('completed plan stays private too', forbidden(await T.rest('GET', `${base}/server/waiverRuns/${id}`)));

  // a replay stamps lastRun field by field: shutting the Trough while a
  // failed run waits must survive it (Fable review, 6 Nov 2026 — the stamp
  // used to rewrite the whole node from the plan-time copy)
  await reset();
  await db.ref(`${base}/private/${members[2].uid}/claims`).set(null);
  await T.mutate(league, 'claimSet', { gwIndex: 1, claims: [pair] }, manager);
  await T.mutate(league, 'waiverRunNow', { runId: 'control-kept', __failpoint: 'waivers:afterPlan' }, chair);
  const shut = await T.mutate(league, 'waiverControl', { mode: 'closed' }, chair);
  const kept = await T.mutate(league, 'waiverRunNow', { runId: 'control-kept' }, chair);
  const keptMeta = (await db.ref(`${base}/public/waiverMeta`).get()).val();
  chk('replay stamps lastRun and keeps the control set while it waited',
    !shut.error && !kept.error && keptMeta?.control === 'closed' && !!keptMeta?.lastRun, JSON.stringify({ keptMeta, err: kept.error }));

  // Fable review, 6 Nov 2026: a run that crashes after planning and is still
  // failing when the next deadline passes must not replay into the gameweek
  // now being played (squadAt would rescore that round on post-waiver
  // squads). Crash it for real in the emulator, then replay in-process on a
  // clock moved 36h on: GW3's synthetic deadline (now + 1 day) has passed, so
  // the planned tgw (index 2) is no longer where transfers land.
  await reset();
  await db.ref(`${base}/private/${members[2].uid}/claims`).set(null);
  const relodged = await T.mutate(league, 'claimSet', { gwIndex: 1, claims: [pair] }, manager);
  chk('manager lodges the claim the stale plan will hold', !relodged.error);
  const staleId = 'manual-stale-plan';
  const staleCrash = await T.mutate(league, 'waiverRunNow', { runId: 'stale-plan', __failpoint: 'waivers:afterPlan' }, chair);
  const stalePlan = (await db.ref(`${base}/server/waiverRuns/${staleId}/plan`).get()).val();
  chk('crash probe left a plan for the current transfer gameweek', !!staleCrash.error && stalePlan?.tgw === 2, JSON.stringify(stalePlan?.tgw));
  const realNow = Date.now;
  Date.now = () => realNow() + 36 * 3600e3;
  try {
    const runNow = runId => Functions.mutate.run({ auth: { uid: members[1].uid }, data: { league, action: 'waiverRunNow', data: { runId } } });
    const refused = await runNow('stale-plan').then(() => null, e => e);
    chk('replay past the deadline is refused', refused?.code === 'failed-precondition' && /stale plan/.test(refused.message), String(refused?.message));
    const staleRun = (await db.ref(`${base}/server/waiverRuns/${staleId}`).get()).val();
    chk('stale run is marked stale with its plan dropped', staleRun?.status === 'stale' && !staleRun.plan && staleRun.staleTgw === 2,
      JSON.stringify(staleRun && { ...staleRun, plan: !!staleRun.plan }));
    const afterRefusal = await stateNow();
    chk('refused replay lands no transfer and stamps no run', afterRefusal.transfers.length === 0 && !afterRefusal.waiverMeta?.lastRun);
    chk('refused replay leaves the claim lodged', !!(await db.ref(`${base}/private/${members[2].uid}/claims/1`).get()).val());
    const rerun = await runNow('stale-plan');
    const landed = (await stateNow()).transfers.filter(t => t.inId === pair.in);
    chk('the claim rolls to the next real run, planned afresh', rerun?.executed?.some(e => e.in === pair.in) && landed.length === 1, JSON.stringify(rerun));
    chk('it lands in the next gameweek, never the one being played', landed[0]?.gw === 3, JSON.stringify(landed));

    // the Window Waiver replays the same way: a crashed run's plan for GW3,
    // seeded in the ledger, must be refused rather than land in GW3 now
    await reset();
    const winIn = free('MF')[0].id, winOut = drop('MF');
    await db.ref(`${base}/server/waiverRuns/window-stale`).set({
      status: 'failed', attempt: 1, startedAt: realNow(), finishedAt: realNow(),
      plan: { records: [{ managerId: 2, outId: winOut, inId: winIn, gw: 2, t: realNow(), windowDraft: true, runId: 'window-stale' }],
        executed: [{ mid: 2, in: winIn, out: winOut }], tgw: 2 },
    });
    const winRefused = await Functions._waiverTest.runWindowWaiver(league, 'window-stale', 'manual:test').then(() => null, e => e);
    const winRun = (await db.ref(`${base}/server/waiverRuns/window-stale`).get()).val();
    chk('window waiver replay past the deadline is refused', winRefused?.code === 'failed-precondition' && winRun?.status === 'stale' && !winRun.plan,
      JSON.stringify({ err: winRefused?.message, status: winRun?.status }));
    chk('refused window replay lands nothing', (await stateNow()).transfers.length === 0);
  } finally { Date.now = realNow; }
  server.close();
  run.done();
})().catch(e => { console.error(e); process.exit(1); });
