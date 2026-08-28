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
      // ...and somebody comes on for him. This used to assert the drop was his
      // whole contribution, which quietly assumed a ruled-out starter is simply
      // lost — the ten-man projection Marc caught on 28 Aug 2026 ("why isnt it
      // identifying that neto will come on"). The auto-sub replaces him, so the
      // side loses what he carried LESS what his replacement brings. With no
      // replacement available `gained` is 0 and this is the old assertion.
      const rep = forecastSubs(mid, GW).find(x => x.out === victim.id);
      const inc = rep && PLAYER_BY_ID[rep.in];
      const gained = inc ? playerXp(inc) * startChance(inc, GW) : 0;
      const after = teamOutlook(mid, GW).exp;
      t('ruling a man out costs what he carried, less whatever comes on for him',
        near(before - after, was - gained, 0.02),
        `dropped ${(before - after).toFixed(2)}; he carried ${was.toFixed(2)}, `
        + `${inc ? `${inc.name} brings ${gained.toFixed(2)}` : 'nobody could replace him'}`);
      t('and the projection did not go up', after < before, `${after.toFixed(2)} vs ${before.toFixed(2)}`);
      victim.status = 'a';
    })();

    /* ----- the uncertainty model -----
       The old flat ±4 said a nailed-on starter and a coin-flip were equally
       unpredictable. They are not, and that is what shortchanged Marc's 89%. */
    t('a ruled-out man carries no uncertainty at all', playerVariance(4, 0) === 0);
    t('a nailed-on man is tighter than the old flat figure',
      playerVariance(4, 1) < 16, String(playerVariance(4, 1).toFixed(2)));
    // for anyone you would actually field, not knowing whether he plays is
    // worse than knowing he does
    for (const xp of [3, 4, 6, 9]) {
      t(`at ${xp} expected, a coin-flip is less predictable than a certainty`,
        playerVariance(xp, 0.5) > playerVariance(xp, 1),
        `${playerVariance(xp, 0.5).toFixed(2)} v ${playerVariance(xp, 1).toFixed(2)}`);
    }
    // Below that the ordering genuinely inverts, and it is not a fault: a
    // fringe man worth 2 who only half-plays has a mean so small that his
    // whole spread collapses with it. Pinned so nobody "fixes" it later.
    t('a fringe man is the one exception, and it is the mixture behaving',
      playerVariance(1, 0.5) < playerVariance(1, 1),
      `${playerVariance(1, 0.5).toFixed(2)} v ${playerVariance(1, 1).toFixed(2)}`);
    // the real property: certainty is never the most uncertain state
    t('peak doubt sits in the middle of the range, not at nailed-on',
      [3, 5, 8].every(xp => Math.max(...[0.25, 0.5, 0.75].map(s => playerVariance(xp, s))) > playerVariance(xp, 1)));
    t('a premium man swings harder than a modest one',
      playerVariance(9, 1) > playerVariance(3, 1),
      `${playerVariance(9, 1).toFixed(2)} v ${playerVariance(3, 1).toFixed(2)}`);
    t('uncertainty never goes negative on a daft expectation',
      playerVariance(0, 1) > 0 && playerVariance(-5, 1) >= 0,
      `${playerVariance(0, 1)} / ${playerVariance(-5, 1)}`);

    // Marc's GW1: level on banked points, two nailed-on men still to come
    // against an opponent who is finished. The old model said 89%.
    (() => {
      const xp = 4, sc = 0.95;
      const sigma = Math.sqrt(2 * playerVariance(xp, sc));
      const gap = 2 * xp * sc - 1; // a point behind once the certain subs land
      t('two nailed-on men against nobody is now a rout, not a 9-in-10',
        gap / sigma > 1.9, `${(gap / sigma).toFixed(2)} sigmas clear`);
      const oldSigma = Math.sqrt(2 * 16);
      t('and the old flat model was materially more timid about it',
        gap / sigma > (gap / oldSigma) * 1.3,
        `${(gap / sigma).toFixed(2)} v ${(gap / oldSigma).toFixed(2)} sigmas`);
    })();

    /* ----- the invariants the win bar has always held ----- */
    (() => {
      const ev = baseline();
      const [a, b] = pairingsFor(GW)[0];
      // two identical squads, nothing played: dead level, whoever is listed
      for (const m of [a, b]) state.lineups[m] = { [GW]: autoXI(squadAt(m, GW)) };
      // the Φ approximation is out by ~4e-5 at dead level — it always has been,
      // and 50.004% displays as 50%. The invariant is what the reader sees.
      t('a tie between two sides projecting the same shows 50:50',
        Math.round(liveWinProb(a, a, GW) * 100) === 50, String(liveWinProb(a, a, GW)));
      // everyone played, everything whistled: no doubt left anywhere
      for (const m of [a, b]) for (const id of lineupFor(m, GW)) ev.playerStats[id] = played();
      state.fixtures.forEach(f => { f.finished = true; f.minutes = 90; });
      const pa = gwManagerPoints(a, GW), pb = gwManagerPoints(b, GW);
      const w = liveWinProb(a, b, GW);
      t('a finished gameweek admits no doubt — the winner is on 100%',
        pa === pb ? w === 0.5 : (pa > pb ? w === 1 : w === 0),
        `${pa} v ${pb} → ${w}`);
      t('and nobody is left to play', teamOutlook(a, GW).toPlay === 0 && teamOutlook(a, GW).varsum === 0);
    })();

    /* ----- somebody else's predicted XI (Marc, 24 Aug 2026) -----
       Scout's judgement outranks our arithmetic where it is FRESH, and counts
       for nothing where it is not. Stale is worse than silent: last week's
       team sheet says nothing about this week's. */
    const withScout = (clubs) => {
      const ev = baseline();
      const q = subject();
      state.lineupsFeed = { clubs };
      return { ev, q };
    };
    const yday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    (() => {
      const { q } = withScout({});
      t('no predicted XI at all leaves the old model untouched',
        near(startChance(q, GW), 0.5), String(startChance(q, GW)));

      state.lineupsFeed = { clubs: { [q.club]: { xi: [q.id], updatedOn: yday } } };
      t('named in a fresh XI, he is all but nailed on',
        startChance(q, GW) > 0.85, String(startChance(q, GW)));

      state.lineupsFeed = { clubs: { [q.club]: { xi: [-1, -2, -3], updatedOn: yday } } };
      t('left out of a fresh XI, he drops well below his own record',
        startChance(q, GW) < 0.3 && startChance(q, GW) > 0, String(startChance(q, GW)));
    })();

    // THE rule: an XI last touched before the previous round is not a
    // prediction for this one, and must not be read as one
    (() => {
      // GW2, so there IS a previous round for a stamp to predate. Testing this
      // at GW1 quietly passes without exercising the rule at all.
      const LATER = 1;
      baseline();
      const q = subject();
      const opened = String(gwFrom(LATER - 1)).slice(0, 10);
      const older = new Date(Date.parse(opened) - 7 * 864e5).toISOString().slice(0, 10);
      const newer = new Date(Date.parse(opened) + 864e5).toISOString().slice(0, 10);

      state.lineupsFeed = { clubs: { [q.club]: { xi: [-1, -2], updatedOn: older } } };
      const stale = startChance(q, LATER);
      t('an XI last touched before the previous round is ignored, not obeyed',
        near(stale, 0.5), `${stale} (stamp ${older}, round opened ${opened})`);

      // THE boundary that went live wrong: their stamp is a date with no time,
      // so one written the morning of the deadline is indistinguishable from
      // one written after it. Same day as the previous deadline = last round's
      // team sheet, and it fed GW1's XIs into GW2 before this was tightened.
      state.lineupsFeed = { clubs: { [q.club]: { xi: [-1, -2], updatedOn: opened } } };
      const sameDay = startChance(q, LATER);
      t('an XI stamped ON the previous deadline\'s date is stale too',
        near(sameDay, 0.5), `${sameDay} (stamp ${opened} = deadline date ${opened})`);

      // the same XI, stamped after that round opened, IS obeyed — otherwise
      // the check above would pass for the wrong reason
      state.lineupsFeed = { clubs: { [q.club]: { xi: [-1, -2], updatedOn: newer } } };
      const fresh = startChance(q, LATER);
      t('the same XI stamped a day later is obeyed',
        fresh < 0.3, `${fresh} (stamp ${newer})`);
      t('so the staleness rule is the thing making the difference, not the XI',
        Math.abs(stale - fresh) > 0.2, `${stale} stale vs ${fresh} fresh`);

      // ...and one with no readable date at all is likewise not trusted
      state.lineupsFeed = { clubs: { [q.club]: { xi: [-1, -2], updatedOn: null } } };
      t('an XI whose date would not parse is not trusted either',
        near(startChance(q, LATER), 0.5), String(startChance(q, LATER)));
    })();

    // availability still outranks anybody's opinion
    (() => {
      const { q } = withScout({});
      state.lineupsFeed = { clubs: { [q.club]: { xi: [q.id], updatedOn: yday } } };
      q.status = 'i';
      t('a predicted starter who is injured is still a nought',
        startChance(q, GW) === 0, String(startChance(q, GW)));
      q.status = 'd'; q.chance = 25;
      t('and a 25% doubt still caps him, however confident they are',
        near(startChance(q, GW), 0.92 * 0.25, 0.02), String(startChance(q, GW)));
      q.status = 'a'; q.chance = null;
      // a man already on the pitch is past predicting
      const ev2 = state.matchStats['gw' + GAMEWEEKS[GW].n];
      ev2.playerStats[q.id] = played();
      state.lineupsFeed = { clubs: { [q.club]: { xi: [-1], updatedOn: yday } } };
      t('a man already playing beats any prediction that left him out',
        startChance(q, GW) === 1, String(startChance(q, GW)));
      delete ev2.playerStats[q.id];
    })();

    (() => {
      // a club they do not cover falls back cleanly rather than to nothing
      const { q } = withScout({ ZZZ: { xi: [1, 2, 3], updatedOn: yday } });
      t('a club absent from their page falls back to our own model',
        near(startChance(q, GW), 0.5), String(startChance(q, GW)));
      state.lineupsFeed = { clubs: { [q.club]: { xi: [], updatedOn: yday } } };
      t('an empty XI is treated as no opinion, not as leaving everyone out',
        near(startChance(q, GW), 0.5), String(startChance(q, GW)));
      state.lineupsFeed = null;
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
