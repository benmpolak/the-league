/* Live-match fast lane, proven against the emulators (HANDOFF-GW1 item 0).
 *
 * liveTick (Layer 1): writes public/liveStats while a fixture is live, clears
 * the node when nothing is, is idempotent, touches NOTHING else under public/
 * (the display-only safety property), and fails loudly when FPL errors.
 * liveRefresh (Layer 3): refuses the unauthenticated and non-members, works
 * for a manager, and its per-uid AND global rate limits actually bite.
 *
 * The FPL API is stubbed on 127.0.0.1:8127 (FPL_API_URL — set for both this
 * process and the emulator runtime by the test:emu script), with mutable
 * scenario state so one run walks live → finished → quiet. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const T = require('./testenv.js');
const Functions = require('../functions/index.js'); // onSchedule exposes .run

const LG = 'the-league-2627';
const FPL_PORT = 8128; // 8127 belongs to emaillink's mail stub — stay clear

/* ---- mutable FPL stub ---- */
const fpl = {
  hits: 0,
  fixtures: [{ id: 21, event: 2, started: true, finished: false, finished_provisional: false }],
  live: { elements: [] },
};
function serveFpl() {
  const server = http.createServer((req, res) => {
    fpl.hits++;
    const u = new URL(req.url, 'http://x');
    let body = null;
    if (u.pathname === '/fixtures/') body = fpl.fixtures.filter(f => !u.searchParams.get('event') || String(f.event) === u.searchParams.get('event'));
    else if (/^\/event\/\d+\/live\/$/.test(u.pathname)) body = fpl.live;
    if (fpl.fail) { res.writeHead(500); res.end('boom'); return; }
    if (!body) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise(resolve => server.listen(FPL_PORT, '127.0.0.1', () => resolve(server)));
}

const el = (id, stats, explain) => ({ id, stats, ...(explain ? { explain } : {}) });

(async () => {
  const run = T.makeRunner('livetick');
  const { chk } = run;
  T.genTestData(); // synthetic calendar: GW2 live (kicked off 90 min ago)
  const fixtureDir = path.join(__dirname, 'fixtures', 'testdata');
  const dataServer = await T.serveTestData(fixtureDir);
  const fplServer = await serveFpl();
  await T.wipe();

  const members = await T.provision(LG, [
    { managerId: 1, email: 'chair@lt.local', role: 'commissioner' },
    { managerId: 2, email: 'two@lt.local' },
    { managerId: 3, email: 'three@lt.local' },
  ]);
  const tok2 = await T.idTokenFor(members[2].uid);
  const tok3 = await T.idTokenFor(members[3].uid);
  const db = T.initAdmin().database();
  const node = () => db.ref(`v2/leagues/${LG}/public/liveStats`).get().then(s => s.val());

  // seed some unrelated public state so "nothing else changed" means something
  await db.ref(`v2/leagues/${LG}/public/settings`).set({ squadSize: 14 });
  await db.ref(`v2/leagues/${LG}/public/waiverMeta`).set({ lastRun: null, control: 'auto' });
  const publicExceptLive = async () => {
    const v = (await db.ref(`v2/leagues/${LG}/public`).get()).val() || {};
    delete v.liveStats;
    return JSON.stringify(v);
  };

  /* ---------------- liveRefresh (HTTP → emulator runtime) ----------------
   * These run FIRST, while the served fixtures.json still shows GW2 live —
   * the runtime process caches fixtures per-instance. */
  fpl.live.elements = [el(101, { minutes: 67, starts: 1, goals_scored: 1, assists: 0, clean_sheets: 0, goals_conceded: 0, own_goals: 0, penalties_saved: 0, penalties_missed: 0, yellow_cards: 0, red_cards: 0, saves: 0 })];

  const anon = await T.call('liveRefresh', {}, null);
  chk('liveRefresh: unauthenticated refused', anon.error?.status === 'UNAUTHENTICATED', JSON.stringify(anon.error));
  const outsider = await T.initAdmin().auth().createUser({ email: 'stranger@lt.local' });
  const tokOut = await T.idTokenFor(outsider.uid);
  const outRes = await T.call('liveRefresh', {}, tokOut);
  chk('liveRefresh: signed-in non-member refused', outRes.error?.status === 'PERMISSION_DENIED', JSON.stringify(outRes.error));

  const r1 = await T.call('liveRefresh', {}, tok2);
  chk('liveRefresh: member call succeeds and reports live', !r1.error && r1.result?.ok === true && r1.result?.live === true, JSON.stringify(r1));
  const afterRefresh = await node();
  chk('liveRefresh: wrote the overlay', afterRefresh?.n === 2 && afterRefresh?.playerStats?.[101]?.g === 1, JSON.stringify(afterRefresh));

  // global limit: {60s, max 2} — call 2 passes, call 3 (ANY uid) is limited
  const r2 = await T.call('liveRefresh', {}, tok2);
  chk('liveRefresh: second call within the window still allowed', !r2.error && r2.result?.ok === true, JSON.stringify(r2));
  const r3 = await T.call('liveRefresh', {}, tok3);
  chk('liveRefresh: GLOBAL limit bites a different uid', !r3.error && r3.result?.limited === true, JSON.stringify(r3));

  // per-uid limit: {10min, max 3} — clear only the global bucket so the uid
  // bucket is what refuses the 4th call from the same manager
  await db.ref('v2/mailGuard/lrAll').set(null);
  const r4 = await T.call('liveRefresh', {}, tok2); // uid2's 3rd
  chk('liveRefresh: third call for one uid allowed once global is quiet', !r4.error && r4.result?.ok === true && !r4.result?.limited, JSON.stringify(r4));
  await db.ref('v2/mailGuard/lrAll').set(null);
  const r5 = await T.call('liveRefresh', {}, tok2); // uid2's 4th
  chk('liveRefresh: PER-UID limit bites the fourth call', !r5.error && r5.result?.limited === true, JSON.stringify(r5));
  await db.ref('v2/mailGuard/lrAll').set(null);
  const r6 = await T.call('liveRefresh', {}, tok3); // uid3's 2nd overall
  chk('liveRefresh: an unthrottled uid still gets through', !r6.error && r6.result?.ok === true && !r6.result?.limited, JSON.stringify(r6));

  /* ---------------- liveTick (in-process .run) ---------------- */
  await db.ref(`v2/leagues/${LG}/public/liveStats`).set(null);
  Functions._liveTest.reset();
  fpl.live.elements = [
    el(101, { minutes: 67, starts: 1, goals_scored: 1, assists: 0, clean_sheets: 0, goals_conceded: 0, own_goals: 0, penalties_saved: 0, penalties_missed: 0, yellow_cards: 0, red_cards: 0, saves: 0 }),
    el(102, { minutes: 20, starts: 0, goals_scored: 0, assists: 1, clean_sheets: 0, goals_conceded: 1, own_goals: 0, penalties_saved: 0, penalties_missed: 0, yellow_cards: 0, red_cards: 0, saves: 3 }),
    el(103, { minutes: 0, starts: 0, goals_scored: 0, assists: 0, clean_sheets: 0, goals_conceded: 0, own_goals: 0, penalties_saved: 0, penalties_missed: 0, yellow_cards: 0, red_cards: 0, saves: 0 }),
    el(104, { minutes: 0, starts: 0, goals_scored: 0, assists: 0, clean_sheets: 0, goals_conceded: 0, own_goals: 0, penalties_saved: 0, penalties_missed: 0, yellow_cards: 1, red_cards: 0, saves: 0 }),
  ];
  const beforePublic = await publicExceptLive();
  await Functions.liveTick.run({});
  let v = await node();
  chk('liveTick: writes {n, t, playerStats}', v && v.n === 2 && typeof v.t === 'number' && Date.now() - v.t < 60e3, JSON.stringify(v && { n: v.n, t: v.t }));
  chk('liveTick: starter row mapped like fetch_fpl.py', v?.playerStats?.[101]?.min === 67 && v.playerStats[101].st === 1 && v.playerStats[101].sub === 0 && v.playerStats[101].g === 1, JSON.stringify(v?.playerStats?.[101]));
  chk('liveTick: sub row mapped (st 0, sub 1, sv carried)', v?.playerStats?.[102]?.st === 0 && v.playerStats[102].sub === 1 && v.playerStats[102].sv === 3 && v.playerStats[102].gc === 1, JSON.stringify(v?.playerStats?.[102]));
  chk('liveTick: zero-minute player excluded', v?.playerStats?.[103] === undefined);
  chk('liveTick: zero-minute BOOKED player included', v?.playerStats?.[104]?.yc === 1, JSON.stringify(v?.playerStats?.[104]));
  chk('liveTick: DISPLAY-ONLY — nothing else under public/ changed', (await publicExceptLive()) === beforePublic);

  // idempotent: run again, stats coherent, stamp advances
  const t1 = v.t;
  await new Promise(r => setTimeout(r, 20));
  await Functions.liveTick.run({});
  v = await node();
  chk('liveTick: idempotent re-run (same rows, newer stamp)', v?.t > t1 && v.playerStats[101].g === 1 && v.playerStats[103] === undefined, JSON.stringify(v && { t: v.t, t1 }));

  // double gameweek: two explain entries → per-fixture fx rows
  fpl.live.elements = [el(105, { minutes: 135, starts: 2, goals_scored: 2, assists: 0, clean_sheets: 1, goals_conceded: 1, own_goals: 0, penalties_saved: 0, penalties_missed: 0, yellow_cards: 0, red_cards: 0, saves: 0 }, [
    { stats: [{ identifier: 'minutes', value: 90 }, { identifier: 'goals_scored', value: 2 }, { identifier: 'goals_conceded', value: 1 }] },
    { stats: [{ identifier: 'minutes', value: 45 }, { identifier: 'clean_sheets', value: 1 }] },
  ])];
  await Functions.liveTick.run({});
  v = await node();
  chk('liveTick: DGW explain becomes per-fixture fx rows', Array.isArray(v?.playerStats?.[105]?.fx) && v.playerStats[105].fx.length === 2 && v.playerStats[105].fx[0].g === 2 && v.playerStats[105].fx[1].min === 45, JSON.stringify(v?.playerStats?.[105]));

  // FPL erroring must fail LOUDLY (scheduler retries) and corrupt nothing
  fpl.fail = true;
  let threw = false;
  await Functions.liveTick.run({}).catch(() => { threw = true; });
  chk('liveTick: FPL failure throws (no silent success)', threw);
  chk('liveTick: failed pass left the last good overlay intact', (await node())?.playerStats?.[105]?.g === 2);
  fpl.fail = false;

  // full-time: FPL says finished → the overlay is cleared, exactly once
  fpl.fixtures[0].finished_provisional = true;
  fpl.fixtures[0].finished = true;
  await Functions.liveTick.run({});
  chk('liveTick: clears the overlay when nothing is live', (await node()) === null);
  await Functions.liveTick.run({});
  chk('liveTick: idle re-run stays clean (no crash, node stays null)', (await node()) === null);

  // quiet path: site fixtures show no kickoff window → FPL is never touched
  const fxPath = path.join(fixtureDir, 'data', 'fixtures.json');
  const fxOriginal = fs.readFileSync(fxPath, 'utf8');
  const siteFx = JSON.parse(fxOriginal).map(f => ({ ...f, finished: f.gw <= 2 || f.finished }));
  fs.writeFileSync(fxPath, JSON.stringify(siteFx));
  Functions._liveTest.reset();
  fpl.hits = 0;
  await Functions.liveTick.run({});
  chk('liveTick: quiet path never calls FPL', fpl.hits === 0, `hits=${fpl.hits}`);
  chk('liveTick: quiet path leaves the node clear', (await node()) === null);
  fs.writeFileSync(fxPath, fxOriginal); // later suites read this file — restore it

  dataServer.close();
  fplServer.close();
  run.done();
})().catch(e => { console.error(e); process.exit(1); });
