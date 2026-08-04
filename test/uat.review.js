/* Adversarial pins for the 4 Aug UAT field fixes that were explicitly handed
 * over without branch coverage: mounted-mock transfer GW, round-done auto-subs
 * and My Team's next-unsettled default. */
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
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(baseUrl + '?nosync&uat-review=1', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers?.length === 12);

  const audit = await page.evaluate(() => {
    syncNow = async () => {};
    const byPos = { GK: [], DF: [], MF: [], FW: [] };
    for (const p of PLAYERS) byPos[p.pos].push(p);
    const need = { GK: 2, DF: 5, MF: 4, FW: 3 };
    state = freshState(); state.phase = 'season'; state.draft.order = state.managers.map(m => m.id);
    state.draft.picks = []; state.transfers = []; state.lineups = {}; state.benchOrders = {};
    let n = 1;
    state.managers.forEach((m, k) => {
      for (const pos of Object.keys(need)) for (let j = 0; j < need[pos]; j++) {
        state.draft.picks.push({ managerId: m.id, playerId: byPos[pos][k * need[pos] + j].id, n: n++ });
      }
    });
    const mid = state.managers[0].id;
    whoami = mid;
    Date.now = () => new Date(GAMEWEEKS[0].from).getTime() - 60 * 60e3;

    // Reproduce the corrupting field state exactly: mock at full time and its
    // waiver run already later than mock.t. Mounted must still win.
    const mt = Date.now() - 10 * 60e3;
    state.mock = { gw: 0, phase: 'final', seed: 7, t: mt };
    state.waiverMeta = { lastRun: new Date(mt + 60e3).toISOString(), control: 'open' };
    const mountedTransferGw = transferGw();
    state.mock = null;
    const offTransferGw = transferGw();

    // A non-appearing starter and an appearing, same-position bench player.
    const xi = lineupFor(mid, 0);
    const bench = benchFor(mid, 0);
    const out = xi.map(id => PLAYER_BY_ID[id]).find(p => bench.some(b => b.pos === p.pos));
    const inn = bench.find(p => p.pos === out.pos);
    const ps = {};
    for (const pid of xi) if (pid !== out.id) ps[pid] = { min: 90, st: 1 };
    ps[inn.id] = { min: 30, sub: 1 };
    state.matchStats = { gw1: { gw: 0, label: 'GW1', final: false, playerStats: ps } };
    // a FULL round — every club paired — since the all-finished path now
    // demands complete club coverage (the fix for this suite's own P2)
    state.fixtures = TEAMS.reduce((acc, t, i) => {
      if (i % 2 === 0 && TEAMS[i + 1]) acc.push({ id: 99101 + i, gw: 1, date: i === 2 ? GAMEWEEKS[0].to : GAMEWEEKS[0].from, home: t.name, away: TEAMS[i + 1].name, started: i !== 2, finished: i !== 2 });
      return acc;
    }, []);
    const midRound = effectiveXI(mid, 0);
    state.fixtures[1].finished = true;
    const allFinished = effectiveXI(mid, 0);
    state.fixtures[1].finished = false;
    state.matchStats.gw1.final = true;
    const feedFinal = effectiveXI(mid, 0);

    // Default should skip a final GW1 and stop at unsettled GW2.
    teamView = { mid, gw: null, transferOut: null, pitchSel: null, showOpp: true };
    state.view = 'team'; render();
    const defaultGw = teamView.gw;

    const ratingEngine = Engine.make({
      players: PLAYERS, gameweeks: GAMEWEEKS, fixtures: state.fixtures,
      lastSeasonByCode: (typeof LAST_SEASON !== 'undefined' && LAST_SEASON.byCode) || {},
      now: () => Date.now(),
    });
    const ratingDiffs = PLAYERS.filter(p => rating(p) !== ratingEngine.rating(p)).map(p => p.id);
    const thin = [
      { id: -91001, code: -91001, pos: 'MF', price: undefined, mp: 0, pts: 0, g: 0, a: 0, cs: 0 },
      { id: -91002, code: -91002, pos: 'MF', price: 0, mp: 0, pts: 0, g: 0, a: 0, cs: 0 },
    ];
    const thinApp = thin.map(p => rating(p));
    const thinEngine = thin.map(p => ratingEngine.rating(p));
    return {
      mountedTransferGw, offTransferGw,
      midSubs: midRound.subs, allFinishedSubs: allFinished.subs, feedFinalSubs: feedFinal.subs,
      expectedPair: { out: out.id, in: inn.id }, defaultGw,
      ratingDiffs, thinApp, thinEngine,
    };
  });

  chk('client clamps transfers to mock GW+1 after full time and a completed run', audit.mountedTransferGw === 1, JSON.stringify(audit));
  chk('client releases the clamp when mock is actually unmounted', audit.offTransferGw === 0, JSON.stringify(audit));
  chk('auto-subs do not land while one fixture in the round is unfinished', audit.midSubs.length === 0, JSON.stringify(audit));
  chk('auto-subs land once every fixture is finished', audit.allFinishedSubs.some(s => s.out === audit.expectedPair.out && s.in === audit.expectedPair.in), JSON.stringify(audit));
  chk('feed-final also settles auto-subs', audit.feedFinalSubs.some(s => s.out === audit.expectedPair.out && s.in === audit.expectedPair.in), JSON.stringify(audit));
  chk('My Team skips a final round and defaults to the next unsettled GW', audit.defaultGw === 1, JSON.stringify(audit));
  chk('league-currency rating is byte-identical across the full client/server pool', audit.ratingDiffs.length === 0, JSON.stringify(audit.ratingDiffs.slice(0, 10)));
  chk('missing and zero price degenerate inputs stay finite and match the engine',
    audit.thinApp.every(Number.isFinite) && JSON.stringify(audit.thinApp) === JSON.stringify(audit.thinEngine),
    JSON.stringify({ app: audit.thinApp, engine: audit.thinEngine }));
  chk('UAT regression page has no uncaught errors', errors.length === 0, errors.join(' | '));
  console.log(`\n[uat-review] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
