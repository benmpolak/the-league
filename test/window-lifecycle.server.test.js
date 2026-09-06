'use strict';
// Real emulator DB transactions with a controlled application clock.
const T = require('./testenv.js');
const Engine = require('../js/engine.js');
const F = require('../functions/index.js');
const path = require('path');
(async () => {
  const run = T.makeRunner('window-lifecycle-server'), { chk } = run;
  const { players, gws } = T.genTestData();
  const server = await T.serveTestData(path.join(__dirname, 'fixtures', 'testdata'));
  const realNow = Date.now;
  try {
    await T.wipe();
    const league = 'the-league-2627';
    const members = await T.provision(league, [
      { managerId: 1, email: 'window-chair@test.local', role: 'commissioner' },
      { managerId: 2, email: 'window-two@test.local' },
      { managerId: 3, email: 'window-three@test.local' },
    ]);
    const db = T.initAdmin().database(), base = `v2/leagues/${league}`;
    const state = T.buildSeedState(players, 3);
    const free = players.filter(p => p.pos === 'MF' && !state.draft.picks.some(k => k.playerId === p.id));
    const drop = mid => state.draft.picks.find(k => k.managerId === mid && players.find(p => p.id === k.playerId).pos === 'MF').playerId;
    state.draftPool = { at: Date.parse('2026-12-31T23:07:00Z'), window: 'between', closed: true,
      ids: Object.fromEntries(players.filter(p => !free.some(f => f.id === p.id)).map(p => [p.id, p.club])) };
    state.waiverMeta = { control: 'closed', lastRun: '2026-12-31T10:00:00Z' };
    await db.ref(`${base}/public`).set(state);
    Date.now = () => Date.parse('2027-01-01T00:07:00Z');
    const call = (mid, action, data = {}) => F.mutate.run({ auth: { uid: members[mid].uid }, data: { league, action, data } });
    const refused = async (fn, code) => { try { await fn(); return false; } catch (e) { return e.code === code; } };
    await F.waiverTick.run({});
    let pool = (await db.ref(`${base}/public/draftPool`).get()).val();
    chk('January tick opens the baseline without admitting January additions', pool.window === 'january-2027' && pool.closed === false && !pool.ids[free[0].id]);
    chk('undated January tick executes no window run', !(await db.ref(`${base}/server/waiverRuns/window-january-2027`).get()).exists());
    chk('ordinary manager cannot date the run', await refused(() => call(2, 'windowScheduleSet', { runAt: Date.parse('2027-02-03T20:00:00Z') }), 'permission-denied'));
    chk('date must be in February', await refused(() => call(1, 'windowScheduleSet', { runAt: Date.parse('2027-01-25T20:00:00Z') }), 'invalid-argument'));
    await call(1, 'windowScheduleSet', { runAt: Date.parse('2027-02-03T20:00:00Z') });
    chk('February date persisted', (await db.ref(`${base}/public/draftPool/runAt`).get()).val() === Date.parse('2027-02-03T20:00:00Z'));
    chk('manual January run refused before due time', await refused(() => call(1, 'windowWaiverRun'), 'failed-precondition'));
    await call(2, 'windowClaimSet', { claims: [{ in: free[0].id, out: drop(2) }] });
    await call(3, 'windowClaimSet', { claims: [{ in: free[0].id, out: drop(3) }] });
    chk('both January lists saved privately', (await db.ref(`${base}/private/${members[2].uid}/windowClaims`).get()).exists() && !(await db.ref(`${base}/public/windowClaims`).get()).exists());
    Date.now = () => Date.parse('2027-02-03T20:07:00Z');
    chk('late January list edit refused', await refused(() => call(2, 'windowClaimSet', { claims: [] }), 'failed-precondition'));
    chk('due date cannot be shifted once processing may have begun', await refused(() => call(1, 'windowScheduleSet', { runAt: Date.parse('2027-02-04T20:00:00Z') }), 'failed-precondition'));
    const weeklyBefore = JSON.stringify((await db.ref(`${base}/public/waiverMeta`).get()).val());
    const e = Engine.make({ players, gameweeks: gws.map(g => ({ ...g, from: g.deadline })), now: () => Date.now() });
    // Seeded state has its own completed GW stats loaded by the function;
    // obtain the expected ranking from the same served feed.
    const stats = require('./fixtures/testdata/data/stats.json');
    state.matchStats = Object.fromEntries(Object.entries(stats.gws).map(([n, g]) => [`gw${n}`, { gw: +n - 1, final: g.finished, playerStats: g.stats }]));
    const first = e.waiverBase(state).find(mid => mid === 2 || mid === 3);
    const results = await Promise.allSettled([call(1, 'windowWaiverRun'), F.waiverTick.run({})]);
    chk('at least one overlapping trigger completes', results.some(r => r.status === 'fulfilled'));
    const records = Object.values((await db.ref(`${base}/public/transfers`).get()).val() || {}).filter(t => t.runId === 'window-january-2027');
    chk('manual and scheduled overlap signs the contested man exactly once', records.length === 1 && records[0].inId === free[0].id);
    chk('bottom-up table priority wins the contested man', records[0]?.managerId === first, JSON.stringify({ expected: first, got: records[0]?.managerId }));
    chk('January signings do not spend weekly takes', records.every(t => t.windowDraft && !t.waiver));
    chk('ordinary waiver clock survives unchanged', JSON.stringify((await db.ref(`${base}/public/waiverMeta`).get()).val()) === weeklyBefore);
    pool = (await db.ref(`${base}/public/draftPool`).get()).val();
    chk('January completes with a closed pool', pool.closed && pool.window === 'january-2027');
    chk('leftover January lists consumed', !(await db.ref(`${base}/private/${members[2].uid}/windowClaims`).get()).exists());
    chk('retry does not execute a second run', (await call(1, 'windowWaiverRun')).skipped === 'already processed');
  } finally { Date.now = realNow; server.close(); }
  run.done();
})().catch(e => { console.error(e); process.exit(1); });
