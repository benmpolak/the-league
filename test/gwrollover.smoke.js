/* Closing a gameweek and opening the next one.
 *
 * Marc, 26 Aug 2026: "there are some things in there that show that the game
 * doesnt realise gameweek 1 is over... broadly there needs to be closing of the
 * gameweek and an opening of the next one."
 *
 * The trap is that a round's CALENDAR window runs until the next deadline, so
 * for the four days between GW1's last kickoff and GW2's deadline, the plain
 * currentGwIndex() still says GW1 — correct for settlement and locks, wrong for
 * anything asking "what do I plan for next".
 *
 * Three notions, deliberately distinct:
 *   currentGwIndex   the calendar. Settlement, locks, claims.
 *   planningGwIndex  the first round not yet settled. My Team, fixtures, FDR.
 *   leagueGwIndex    the front page, which waits for the post-round waiver run
 *                    (Ben, 25 Aug) so the league turns over together.
 *
 * Usage: python3 -m http.server 8125 (repo root) then node test/gwrollover.smoke.js
 */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const log = await page.evaluate(() => {
    const log = [];
    const t = (name, ok, detail = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

    /* Marc's exact situation: GW1 played out and settled, GW2's deadline still
       ahead, and NO waiver run recorded against it. */
    function afterRoundOne() {
      state = buildDemoState();
      const g0 = GAMEWEEKS[0], g1 = GAMEWEEKS[1];
      // GW1 kicked off five days ago and its window runs to GW2's deadline
      g0.finished = false;
      g0.from = new Date(Date.now() - 5 * 864e5).toISOString();
      g0.to = new Date(Date.now() + 2 * 864e5).toISOString();
      g1.from = new Date(Date.now() + 2 * 864e5).toISOString();
      g1.to = new Date(Date.now() + 9 * 864e5).toISOString();
      state.fixtures = [];
      for (let k = 0; k + 1 < TEAMS.length; k += 2) {
        // every GW1 fixture played out four days ago; GW2's are still to come
        state.fixtures.push({ gw: g0.n, home: TEAMS[k].name, away: TEAMS[k + 1].name,
          date: new Date(Date.now() - 4 * 864e5).toISOString(), started: true, minutes: 90, finished: true });
        state.fixtures.push({ gw: g1.n, home: TEAMS[k + 1].name, away: TEAMS[k].name,
          date: new Date(Date.now() + 3 * 864e5).toISOString(), started: false, minutes: 0, finished: false });
      }
      const ev = state.matchStats['gw' + g0.n];
      ev.final = true;
      ev.playerStats = ev.playerStats || {};
      for (const m of state.managers) {
        state.lineups[m.id] = { 0: autoXI(squadAt(m.id, 0)) };
        for (const id of state.lineups[m.id][0])
          ev.playerStats[id] = { min: 90, st: 1, sub: 0, g: 0, a: 0, cs: 0, gc: 0, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0 };
      }
      state.waiverMeta = {};       // the post-round run has NOT been recorded
      teamView.gw = null; fxView.gw = null; fdrView = fdrView || {};
    }

    afterRoundOne();
    t('the round really is settled (the test is not vacuous)',
      gwStatus(0) === 'final' && gwStatus(1) === 'upcoming',
      `gw1 ${gwStatus(0)}, gw2 ${gwStatus(1)}`);
    t('the calendar still says GW1 — correct, its window runs to the next deadline',
      currentGwIndex() === 0, String(currentGwIndex()));
    t('but the round you plan for is GW2',
      planningGwIndex() === 1, String(planningGwIndex()));

    /* ----- the surfaces that were still looking backwards ----- */
    t('My Team opens on GW2, not the round already played',
      (() => { teamView.gw = null; viewTeam(); return teamView.gw; })() === 1,
      String(teamView.gw));

    t('the real-fixtures page opens on GW2',
      (() => { fxView.gw = null; viewFixtures(); return fxView.gw; })() === GAMEWEEKS[1].n,
      `${fxView.gw} (want ${GAMEWEEKS[1].n})`);
    t('and it labels GW2 as the current one, not GW1',
      /GW2[^<]*\(current\)/.test((() => { fxView.gw = null; return viewFixtures(); })()),
      'no "(current)" against GW2');

    // the Data Room's fixture-difficulty table is the one Marc named
    const fdr = fixtureMatrixCard();
    t('the Data Room fixture table starts at GW2, not week one',
      fdr.includes(`GW${GAMEWEEKS[1].n}`) && !new RegExp(`>GW${GAMEWEEKS[0].n}<`).test(fdr),
      (fdr.match(/GW\d+/g) || []).slice(0, 6).join(' '));

    /* ----- what must NOT move ----- */
    t('a transfer still lands in GW2, exactly as before',
      transferGw() === 1, String(transferGw()));
    t('the settled round keeps its result — nothing is rescored',
      gwStatus(0) === 'final' && gwManagerPoints(state.managers[0].id, 0) > 0,
      String(gwManagerPoints(state.managers[0].id, 0)));
    t('the front page still waits for the waiver run, by design (Ben, 25 Aug)',
      leagueGwIndex() === 0, `${leagueGwIndex()} with no run recorded`);

    // ...and turns over once that run lands
    (() => {
      // the exact slot that clears the round, rather than a guess at it: the
      // runs are Tue/Fri, so "two days after the last kickoff" lands before or
      // after the slot depending on the weekday the test happens to run
      const clears = gwClearAt(0);
      state.waiverMeta = { lastRun: new Date(clears - 60e3).toISOString() };
      t('a run just BEFORE the clearing slot does not turn the page',
        leagueGwIndex() === 0, `${leagueGwIndex()} (run 1 min early)`);
      state.waiverMeta = { lastRun: new Date(clears).toISOString() };
      t('once the post-round run is recorded, the front page turns too',
        leagueGwIndex() === 1, `${leagueGwIndex()} (run at the clearing slot)`);
    })();

    /* ----- mid-round, nothing should have moved at all ----- */
    (() => {
      state = buildDemoState();
      const g0 = GAMEWEEKS[0];
      g0.finished = false;
      g0.from = new Date(Date.now() - 36e5).toISOString();
      g0.to = new Date(Date.now() + 6 * 864e5).toISOString();
      state.fixtures = [];
      for (let k = 0; k + 1 < TEAMS.length; k += 2)
        state.fixtures.push({ gw: g0.n, home: TEAMS[k].name, away: TEAMS[k + 1].name,
          date: new Date().toISOString(), started: true, minutes: 45, finished: false });
      state.matchStats['gw' + g0.n].final = false;
      t('while the round is still being played, planning stays on it',
        planningGwIndex() === 0 && currentGwIndex() === 0,
        `${planningGwIndex()} / ${currentGwIndex()}`);
    })();

    return log;
  });

  for (const line of log) { console.log(line); if (line.startsWith('PASS')) pass++; else fail++; }
  console.log(`${pageErrors.length === 0 ? 'PASS' : 'FAIL'}  no page errors${pageErrors.length ? ' — ' + pageErrors.join(' | ') : ''}`);
  if (pageErrors.length === 0) pass++; else fail++;

  await browser.close();
  console.log(`\n[gw-rollover] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
