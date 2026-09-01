// Engine ↔ app.js parity. The engine is a deliberate copy of the game law so
// Cloud Functions can enforce what the client renders; this suite is the tripwire
// that catches the two drifting apart. Runs against the demo season (full
// fictional results) plus a synthetic mid-draft state.
// Usage: python3 -m http.server 8125 &   node test/engine.parity.test.js
'use strict';
const puppeteer = require('puppeteer-core');
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  if (ok) pass++;
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
  if (ok && process.env.VERBOSE) console.log(`PASS  ${name}`);
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
  });
  const p = await browser.newPage();
  p.on('pageerror', e => { fail++; console.log('PAGEERROR', e.message.split('\n')[0]); });
  await p.goto(baseUrl + '?nosync', { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => typeof Engine !== 'undefined' && typeof PLAYERS !== 'undefined');

  // ---- demo season: full fictional results, real player pool ----
  await p.evaluate(() => enterDemo());
  await p.waitForFunction(() => state && state.phase === 'season' && Object.keys(state.matchStats).length > 0);

  const season = await p.evaluate(() => {
    // pin the demo to the gameweek the wall clock is actually in (see the
    // clock note below) — the fictional results cover gws 0-5 either way
    demoGwOverride = null;
    demoGwOverride = currentGwIndex();
    const eng = Engine.make({
      players: PLAYERS,
      gameweeks: GAMEWEEKS,
      // both sides must see the same fixture list: the whistle test (fp
      // flags, 24 Aug) settles rounds from fixtures, so an engine built
      // without them would disagree with the app about auto-subs
      fixtures: state.fixtures,
      lastSeasonByCode: (typeof LAST_SEASON !== 'undefined' && LAST_SEASON.byCode) || {},
      // ONE clock and ONE gameweek for both sides, and both the REAL ones.
      // The app in demo mode is mixed-clock: currentGwIndex honours the demo
      // override, but gwIsOver/roundBlown read the wall clock and the real
      // fixtures' whistle flags. So freezing the ENGINE to the demo window
      // (the 28 Aug fix) only held until the wall calendar next rolled — it
      // went red again on 1 Sept when GW2 settled overnight: the app called
      // GW2 blown on the real clock while the engine, frozen back in GW1's
      // window, refused, skewing standingsBefore(3,5) and the waiver queue.
      // Pinning the demo override to the real current gameweek and running
      // the engine on Date.now() gives the two sides identical inputs on any
      // date, which is what a PARITY suite is for. The engine still has no
      // demo override, and should not: it is server law.
      now: () => Date.now(),
    });
    const mids = state.managers.map(m => m.id);
    const gws = [0, 1, 2, 3, 4, 5];
    const diffs = [];
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const mid of mids) {
      for (const g of gws) {
        if (!eq(squadAt(mid, g).map(x => x.id).sort(), eng.squadAt(state, mid, g).map(x => x.id).sort()))
          diffs.push(`squadAt ${mid}/${g}`);
        if (!eq(lineupFor(mid, g), eng.lineupFor(state, mid, g))) diffs.push(`lineupFor ${mid}/${g}`);
        if (!eq(effectiveXI(mid, g), eng.effectiveXI(state, mid, g))) diffs.push(`effectiveXI ${mid}/${g}`);
        if (gwManagerPoints(mid, g) !== eng.gwManagerPoints(state, mid, g)) diffs.push(`gwManagerPoints ${mid}/${g}`);
        if (!eq(benchFor(mid, g).map(x => x.id), eng.benchFor(state, mid, g).map(x => x.id))) diffs.push(`benchFor ${mid}/${g}`);
      }
    }
    for (const g of [1, 3, 5]) {
      if (!eq(standingsBefore(g), eng.standingsBefore(state, g))) diffs.push(`standingsBefore ${g}`);
      if (!eq(waiverOrder(g), eng.waiverOrder(state, g))) diffs.push(`waiverOrder ${g}`);
      if (!eq(pairingsFor(g), eng.pairingsFor(state, g))) diffs.push(`pairingsFor ${g}`);
    }
    // scoring kernel over every fictional stat line
    let statDiffs = 0, statChecked = 0;
    for (const [k, ev] of Object.entries(state.matchStats)) {
      for (const [pid, s] of Object.entries(ev.playerStats || {})) {
        const pl = PLAYER_BY_ID[pid];
        if (!pl) continue;
        statChecked++;
        if (statPoints(pl, s) !== eng.statPoints(state.settings.scoring, pl, s)) statDiffs++;
      }
    }
    // crafted rows so every scoring shape is compared even pre-season, when
    // the feed has no stats: starts/subs, the 60-min clean-sheet gate, cards,
    // keeper arithmetic and double-gameweek fx rows
    const crafted = [
      { min: 90, st: 1, g: 1, a: 1, cs: 1 },
      { min: 30, st: 1 }, { min: 70, st: 0, sub: 1 },
      { min: 59, st: 1, cs: 1 }, { min: 60, st: 1, cs: 1 },
      { min: 90, st: 1, gc: 5, sv: 7, ps: 1 },
      { min: 90, st: 1, og: 1, pm: 1, yc: 1 }, { min: 12, st: 0, sub: 1, rc: 1 },
      { min: 154, st: 2, fx: [{ min: 90, g: 1 }, { min: 64, gc: 2 }] },
      { min: 110, st: 1, fx: [{ min: 20 }, { min: 90, cs: 1 }] },
    ];
    for (const pl of [PLAYERS.find(x => x.pos === 'GK'), PLAYERS.find(x => x.pos === 'DF'), PLAYERS.find(x => x.pos === 'MF'), PLAYERS.find(x => x.pos === 'FW')]) {
      for (const s of crafted) {
        statChecked++;
        if (statPoints(pl, s) !== eng.statPoints(state.settings.scoring, pl, s)) statDiffs++;
      }
    }
    // shape validators across every stored lineup
    let xiDiffs = 0;
    for (const mid of mids) for (const g of [0, 1, 2]) {
      const xi = lineupFor(mid, g);
      if (xiValid(xi) !== eng.xiValid(xi)) xiDiffs++;
    }
    return { diffs, statDiffs, statChecked, xiDiffs };
  });
  chk('season: roster/lineup/scoring parity', season.diffs.length === 0, season.diffs.slice(0, 5).join(', '));
  // floor = the 40 crafted shape rows, which guarantee every scoring shape is
  // compared whatever the feed holds. The old >=200 floor assumed a full
  // fictional feed and expired mid-GW1 (22 Aug: one real fixture played = 31
  // feed lines) — the calendar-bound class HANDOFF-GW1 warns about. Feed
  // lines still join the comparison whenever they exist; the floor just no
  // longer pretends to know how many there are.
  chk(`season: statPoints parity over ${season.statChecked} stat lines`, season.statDiffs === 0 && season.statChecked >= 40, `${season.statDiffs} diffs`);
  chk('season: xiValid parity', season.xiDiffs === 0);

  // ---- waiver resolution parity: engine resolveWaivers vs client processWaivers ----
  const waiv = await p.evaluate(() => {
    const eng = Engine.make({
      players: PLAYERS, gameweeks: GAMEWEEKS,
      lastSeasonByCode: (typeof LAST_SEASON !== 'undefined' && LAST_SEASON.byCode) || {},
      now: () => Date.now(),
    });
    // craft claims: three managers chase the same free agent, plus a private second choice
    const owned = ownedIdsAt(currentGwIndex());
    const free = PLAYERS.filter(pl => !owned.has(pl.id) && !arrivalLocked(pl));
    const mids = state.managers.map(m => m.id).slice(0, 3);
    const target = free.find(pl => mids.every(mid => {
      const sq = squadAt(mid, transferGw());
      const out = sq.find(x => x.pos === pl.pos);
      return out && squadShapeOk([...sq.filter(x => x.id !== out.id), pl]);
    }));
    if (!target) return { skip: true };
    const claims = {};
    const cur = currentGwIndex();
    claims[cur] = {};
    for (const mid of mids) {
      const out = squadAt(mid, transferGw()).find(x => x.pos === target.pos);
      claims[cur][mid] = [{ in: target.id, out: out.id }];
    }
    state.claims = claims;
    const runStart = Date.now() - 1;
    const res = eng.resolveWaivers(state, runStart);
    // exactly one winner for the contested player; the first claimant in the
    // queue wins. The engine runs on the real clock (the demo's GW override is
    // client display only), so the expectation must use the engine's own cur.
    const order = eng.waiverOrder(state, eng.currentGwIndex());
    const firstClaimant = order.find(mid => mids.includes(mid));
    const winner = res.executed.find(e => e.in === target.id);
    return {
      skip: false,
      oneWinner: res.executed.filter(e => e.in === target.id).length === 1,
      rightWinner: winner && winner.mid === firstClaimant,
      bucketsSwept: res.buckets.includes(cur),
      stamped: !!res.stampedMeta.lastRun,
    };
  });
  if (waiv.skip) chk('waivers: (skipped — no suitable free agent in demo pool)', true);
  else {
    chk('waivers: contested player has exactly one winner', waiv.oneWinner);
    chk('waivers: winner is first in reverse-standings order', waiv.rightWinner);
    chk('waivers: claim bucket swept + run stamped', waiv.bucketsSwept && waiv.stamped);
  }

  // ---- synthetic mid-draft state: turn order, pick legality, autopick determinism ----
  await p.evaluate(() => exitDemo());
  const draft = await p.evaluate(() => {
    const eng = Engine.make({
      players: PLAYERS, gameweeks: GAMEWEEKS,
      lastSeasonByCode: (typeof LAST_SEASON !== 'undefined' && LAST_SEASON.byCode) || {},
      now: () => Date.now(),
    });
    const saved = state;
    try {
      const s = freshState();
      s.phase = 'draft';
      s.draft.order = s.managers.map(m => m.id);
      // simulate 30 picks by always taking the app's own autopick choice
      const diffs = [];
      for (let i = 0; i < 30; i++) {
        state = s;
        const appMid = currentManagerId();
        const engMid = eng.currentManagerId(s);
        if (appMid !== engMid) { diffs.push(`turn ${i}: ${appMid} vs ${engMid}`); break; }
        const choice = eng.autoPickChoice(s, appMid);
        if (choice == null) { diffs.push(`no choice at ${i}`); break; }
        if (!canPick(appMid, PLAYER_BY_ID[choice]) || !eng.canPick(s, appMid, PLAYER_BY_ID[choice]))
          diffs.push(`canPick disagree at ${i} for ${choice}`);
        s.draft.picks.push({ managerId: appMid, playerId: choice, n: i + 1 });
      }
      // canPick parity over a sample of the pool at the resulting position
      state = s;
      const mid = currentManagerId();
      let cpDiffs = 0;
      for (const pl of PLAYERS.slice(0, 400)) {
        if (canPick(mid, pl) !== eng.canPick(s, mid, pl)) cpDiffs++;
      }
      return { diffs, cpDiffs };
    } finally {
      state = saved;
    }
  });
  chk('draft: snake turn order parity over 30 picks', draft.diffs.length === 0, draft.diffs.join('; '));
  chk('draft: canPick parity over 400-player sample', draft.cpDiffs === 0, `${draft.cpDiffs} diffs`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
