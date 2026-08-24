/* How likely is he to start, and what that does to the projection.
 *
 * Marc, 24 Aug 2026, asked whether we could weight projections off Fantasy
 * Football Scout's predicted line-ups. Their team news is paid, so this is
 * built from what we already fetch: FPL's `status` and `chance`, plus our own
 * record of who has actually started.
 *
 * The rules being pinned here:
 *   - injured / banned / departed is a hard nought
 *   - `chance` is a CEILING, never a floor
 *   - a man already on the pitch is certain, whatever the paperwork says
 *   - the season's own start record outweighs the prior as it accumulates
 *   - none of it touches a banked point — only what is still to come
 *
 * Usage: python3 -m http.server 8125 (repo root) then node test/startchance.smoke.js
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
    const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

    const GW = 0;
    const played = () => ({ min: 90, st: 1, sub: 0, g: 0, a: 0, cs: 0, gc: 0, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0 });

    // a gameweek under way, nothing whistled, nobody's stats in yet
    function baseline() {
      state = buildDemoState();
      const g = GAMEWEEKS[GW];
      g.finished = false;
      g.from = new Date(Date.now() - 36e5).toISOString();
      g.to = new Date(Date.now() + 6 * 864e5).toISOString();
      const ev = state.matchStats['gw' + g.n];
      ev.final = false;
      ev.playerStats = {};
      state.adjustments = {};
      state.fixtures = [];
      for (let k = 0; k + 1 < TEAMS.length; k += 2)
        state.fixtures.push({ gw: g.n, home: TEAMS[k].name, away: TEAMS[k + 1].name, started: false, minutes: 0, finished: false });
      return ev;
    }

    // a clean subject: no flags, no history, no last season — pure prior
    const subject = () => {
      const p = PLAYER_BY_ID[state.draft.picks[0].playerId];
      p.status = 'a';
      p.chance = null;
      delete LS_BY_CODE[p.code];
      return p;
    };

    /* ----- the ceiling ----- */
    baseline();
    let p = subject();
    t('no news and no history sits on the prior, not on certainty',
      near(startChance(p, GW), 0.5), String(startChance(p, GW)));

    p.status = 'i';
    t('an injured man is a hard nought', startChance(p, GW) === 0, String(startChance(p, GW)));
    p.status = 's';
    t('a suspended man is a hard nought', startChance(p, GW) === 0, String(startChance(p, GW)));
    p.status = 'u';
    t('a departed man is a hard nought', startChance(p, GW) === 0, String(startChance(p, GW)));

    p.status = 'd'; p.chance = 25;
    t('a 25% doubt is capped at a quarter of his prior',
      near(startChance(p, GW), 0.5 * 0.25), String(startChance(p, GW)));
    p.chance = 0;
    t('a 0% chance is a nought however good his record', startChance(p, GW) === 0, String(startChance(p, GW)));

    // the cap must never LIFT anyone — 100% availability is not 100% selection
    p.status = 'a'; p.chance = 100;
    t('100% available does not promote him past his own record',
      near(startChance(p, GW), 0.5), String(startChance(p, GW)));

    /* ----- already on the pitch beats any paperwork ----- */
    (() => {
      const ev = baseline();
      const q = subject();
      q.status = 'd'; q.chance = 25;
      ev.playerStats[q.id] = played();
      t('a man who is already playing is certain, whatever his flag said',
        startChance(q, GW) === 1, String(startChance(q, GW)));
    })();

    /* ----- our own start record ----- */
    // five finished gameweeks in which his club played: started all five
    const withHistory = (starts, of) => {
      baseline();
      const q = subject();
      for (let i = 0; i < of; i++) {
        const g = GAMEWEEKS[i];
        g.finished = true;
        g.from = new Date(Date.now() - (of - i + 1) * 864e5).toISOString();
        g.to = new Date(Date.now() - (of - i) * 864e5).toISOString();
        state.matchStats['gw' + g.n] = state.matchStats['gw' + g.n] || { playerStats: {} };
        const ev = state.matchStats['gw' + g.n];
        ev.final = true;
        ev.playerStats = ev.playerStats || {};
        ev.playerStats[q.id] = i < starts ? played() : { min: 0, st: 0, sub: 0 };
        // his club has to have played for the week to count
        if (!state.fixtures.some(f => f.gw === g.n && (f.home === q.team || f.away === q.team)))
          state.fixtures.push({ gw: g.n, home: q.team, away: TEAMS.find(x => x.name !== q.team).name, finished: true, minutes: 90 });
      }
      return { q, sc: startChance(q, GW + of) };
    };

    const ever = withHistory(5, 5);
    t('started all five: the record has fully displaced the prior',
      near(ever.sc, 1), String(ever.sc));
    const never = withHistory(0, 5);
    t('started none of five: likewise, and it is nearly nothing',
      near(never.sc, 0), String(never.sc));
    const half = withHistory(2, 4);
    // 4 of 5 weight on a 0.5 record, 1 of 5 on a 0.5 prior — both 0.5
    t('a rotation risk lands mid-table', near(half.sc, 0.5, 0.02), String(half.sc));
    const oneWeek = withHistory(1, 1);
    // one week is 1/5 of the evidence: 0.2 * 1.0 + 0.8 * 0.5
    t('one week of evidence moves the needle without owning it',
      near(oneWeek.sc, 0.2 * 1 + 0.8 * 0.5), String(oneWeek.sc));

    /* ----- what it does to the projection ----- */
    (() => {
      const ev = baseline();
      const mid = state.managers[0].id;
      const xi = autoXI(squadAt(mid, GW));
      state.lineups[mid] = { [GW]: xi };
      for (const id of xi) { const q = PLAYER_BY_ID[id]; q.status = 'a'; q.chance = null; }
      const before = teamOutlook(mid, GW).exp;
      // rule one man out entirely. He was never carrying his FULL expected
      // points — his own start chance already discounted him — so the drop is
      // exactly what he was contributing, and nothing else moves.
      const victim = PLAYER_BY_ID[xi[5]];
      const was = playerXp(victim) * startChance(victim, GW);
      t('an unflagged man is discounted before he is ruled out at all',
        was > 0 && was < playerXp(victim),
        `carrying ${was.toFixed(2)} of a possible ${playerXp(victim).toFixed(2)}`);
      victim.status = 'i';
      const after = teamOutlook(mid, GW).exp;
      t('ruling a man out removes exactly what he was contributing, no more',
        near(before - after, was, 0.01), `dropped ${(before - after).toFixed(2)}, he was carrying ${was.toFixed(2)}`);
      t('and the projection did not go up', after < before, `${after.toFixed(2)} vs ${before.toFixed(2)}`);
      victim.status = 'a';
    })();

    /* ----- it must never touch a banked point ----- */
    (() => {
      const ev = baseline();
      const mid = state.managers[0].id;
      const xi = autoXI(squadAt(mid, GW));
      state.lineups[mid] = { [GW]: xi };
      for (const id of xi) ev.playerStats[id] = played();
      state.fixtures.forEach(f => { f.finished = true; f.minutes = 90; });
      const settled = gwManagerPoints(mid, GW);
      // flag every last one of them: they have already played, so nothing moves
      for (const id of xi) { PLAYER_BY_ID[id].status = 'i'; PLAYER_BY_ID[id].chance = 0; }
      t('flagging a squad that has already played changes no settled score',
        gwManagerPoints(mid, GW) === settled, `${gwManagerPoints(mid, GW)} vs ${settled}`);
      t('and a finished gameweek projects exactly what it scored',
        Math.round(teamOutlook(mid, GW).exp) === settled,
        `${Math.round(teamOutlook(mid, GW).exp)} vs ${settled}`);
      for (const id of xi) { PLAYER_BY_ID[id].status = 'a'; PLAYER_BY_ID[id].chance = null; }
    })();

    return log;
  });

  for (const line of log) { console.log(line); if (line.startsWith('PASS')) pass++; else fail++; }
  console.log(`${pageErrors.length === 0 ? 'PASS' : 'FAIL'}  no page errors${pageErrors.length ? ' — ' + pageErrors.join(' | ') : ''}`);
  if (pageErrors.length === 0) pass++; else fail++;

  await browser.close();
  console.log(`\n[start-chance] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
