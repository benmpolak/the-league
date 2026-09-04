/* The sub you can see coming, before he has kicked a ball.
 *
 * Marc, 28 Aug 2026, looking at a locked GW2 side: "why isnt it identifying
 * that neto will come on".
 *
 * His exact position: Mateta in the XI, injured until 11 October, Palace played
 * on the Friday and he never appeared. Neto on the bench, fit, Chelsea to play
 * on the Sunday. pendingSubs will not touch it — it banks points that are
 * certain but unawarded, so the incoming man must already have played. Correct,
 * and it left the projection carrying Mateta at zero with nobody promoted: a
 * side projecting as ten men.
 *
 * The line this suite defends is the one that matters: a FORECAST may move the
 * projection and must never move a settled number.
 *
 * Usage: python3 -m http.server 8125 (repo root) then node test/forecastsubs.smoke.js
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
    const GW = 0;
    const played = () => ({ min: 90, st: 1, sub: 0, g: 0, a: 0, cs: 0, gc: 0, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0 });

    /* Marc's shape: one club has played, the rest are still to come. */
    function setUp() {
      state = buildDemoState();
      state.phase = 'season';
      // the real feed carries a dozen genuinely injured men, and an earlier one
      // in the XI would be forecast out ahead of ours — which is correct, and
      // makes the test non-deterministic. Start from a fit league.
      for (const p of Object.values(PLAYER_BY_ID)) { p.status = 'a'; p.chance = null; }
      const g = GAMEWEEKS[GW];
      g.finished = false;
      g.from = new Date(Date.now() - 6 * 36e5).toISOString();
      g.to = new Date(Date.now() + 6 * 864e5).toISOString();
      const ev = state.matchStats['gw' + g.n];
      ev.final = false;
      ev.playerStats = {};
      state.adjustments = {};
      const mid = state.managers[0].id;
      const xi = lineupFor(mid, GW).map(id => PLAYER_BY_ID[id]);
      const bench = benchFor(mid, GW);
      // The man who cannot play must come from a position with SLACK. The demo
      // XI is 1-4-5-1, so pulling its only striker and putting a midfielder in
      // would leave FW at 0 against a minimum of 1 — the forecast refuses that,
      // correctly, and picking him would have tested nothing. Marc's own side
      // is 4-3-3, where losing a forward still leaves two.
      const cnt = xiCounts(lineupFor(mid, GW));
      const slack = ['FW', 'MF', 'DF'].find(pos => cnt[pos] > XI_RULES[pos][0]);
      const out = xi.find(p => p.pos === slack) || xi[10];
      // every fixture still to come...
      state.fixtures = [];
      for (let k = 0; k + 1 < TEAMS.length; k += 2)
        state.fixtures.push({ id: 500 + k, gw: g.n, home: TEAMS[k].name, away: TEAMS[k + 1].name,
          date: new Date(Date.now() + 2 * 864e5).toISOString(), started: false, minutes: 0, finished: false });
      // ...except the one the injured man's club has already played
      for (const f of state.fixtures)
        if (f.home === out.team || f.away === out.team) {
          f.date = new Date(Date.now() - 5 * 36e5).toISOString();
          f.started = true; f.minutes = 90; f.finished = true;
        }
      /* The replacement's club must still be TO PLAY, and "not a club-mate" was
         not enough: finishing the injured man's fixture finishes it for his
         OPPONENT too, so a bench man from the other side of that one game was
         just as done. The 30 Aug fix caught the club-mate and missed the
         opponent; it stayed green until the feed dealt an opponent's man onto
         the bench (Allan, Man City, 3 Sept).

         So choose him AFTER the fixtures are set, by the only question that
         matters — is his round over? — instead of guessing at which clubs that
         will be true for. */
      const inc = bench.find(p => p.id !== out.id && !clubRoundOver(p, g.n))
        || bench.find(p => p.id !== out.id) || bench[0];
      // he is injured and never appeared; the replacement is fit and to come
      out.status = 'i'; out.chance = 0;
      inc.status = 'a'; inc.chance = null;
      return { mid, out, inc, xi, bench };
    }

    const { mid, out, inc } = setUp();
    t('the setup is Marc\'s: a flagged starter whose club has already played',
      out.status === 'i' && !appearedInGw(out.id, GW) && clubRoundOver(out, GAMEWEEKS[GW].n),
      `${out.name} ${out.club}`);
    t('and a fit bench man whose club is still to play',
      startChance(inc, GW) > 0 && !clubRoundOver(inc, GAMEWEEKS[GW].n), `${inc.name} ${inc.club}`);

    /* ----- pendingSubs must still refuse: he has not kicked a ball ----- */
    t('pendingSubs says nothing — nothing is bankable yet',
      pendingSubs(mid, GW).length === 0, JSON.stringify(pendingSubs(mid, GW)));
    t('and the live score is unmoved by a man who has not played',
      pendingSubPoints(mid, GW) === 0, String(pendingSubPoints(mid, GW)));

    /* ----- but the forecast names him ----- */
    (() => {
      const fc = forecastSubs(mid, GW);
      const mine = fc.find(s => s.out === out.id);
      t('the forecast identifies a replacement for the man who cannot play',
        !!mine && benchFor(mid, GW).some(b => b.id === mine.in),
        fc.map(s => `${PLAYER_BY_ID[s.out].name}->${PLAYER_BY_ID[s.in].name}`).join(', ') || 'none');
      const rep = mine && PLAYER_BY_ID[mine.in];
      t('and the man it names is one who can still play',
        rep && startChance(rep, GW) > 0 && !clubRoundOver(rep, GAMEWEEKS[GW].n),
        rep ? `${rep.name} ${rep.club}` : 'none');
      const lx = liveXI(mid, GW);
      t('the projected XI swaps him in',
        rep && lx.xi.includes(rep.id) && !lx.xi.includes(out.id),
        `in=${rep && lx.xi.includes(rep.id)} out=${lx.xi.includes(out.id)}`);
      t('and keeps a legal shape',
        ['GK', 'DF', 'MF', 'FW'].every(pos => {
          const c = xiCounts(lx.xi);
          return c[pos] >= XI_RULES[pos][0] && c[pos] <= XI_RULES[pos][1];
        }), JSON.stringify(xiCounts(lx.xi)));
      t('the forecast is kept separate from the certain subs',
        lx.subs.length === 0 && lx.forecast.length >= 1,
        `subs=${lx.subs.length} forecast=${lx.forecast.length}`);
    })();

    /* ----- the projection gains what the ten-man side was losing ----- */
    (() => {
      const withFc = teamOutlook(mid, GW).exp;
      // silence the forecast by ruling out every man who could come on, so the
      // only difference between the two numbers is the forecast itself
      const bench = benchFor(mid, GW);
      const keep = bench.map(p => ({ p, status: p.status, chance: p.chance }));
      for (const p of bench) { p.status = 'i'; p.chance = 0; }
      const without = teamOutlook(mid, GW).exp;
      for (const k of keep) { k.p.status = k.status; k.p.chance = k.chance; }
      t('the projection is higher with the forecast than without it',
        withFc > without, `${withFc.toFixed(1)} vs ${without.toFixed(1)}`);
      t('and the injured starter contributes nothing either way',
        startChance(out, GW) === 0, String(startChance(out, GW)));
    })();

    /* ----- THE LINE: a forecast must never move a settled number ----- */
    (() => {
      const settledXi = effectiveXI(mid, GW).xi;
      t('the settlement XI is untouched — the injured man is still in it',
        settledXi.includes(out.id) && !settledXi.includes(inc.id),
        `out in settled XI=${settledXi.includes(out.id)}`);
      const before = gwManagerPoints(mid, GW);
      forecastSubs(mid, GW); liveXI(mid, GW); teamOutlook(mid, GW);
      t('and the score does not move when the forecast is computed',
        gwManagerPoints(mid, GW) === before, `${gwManagerPoints(mid, GW)} vs ${before}`);
    })();

    /* ----- it must not invent a sub out of a man who simply has not played yet ----- */
    (() => {
      setUp();
      const m2 = state.managers[1].id;
      // nobody flagged, nobody's club finished: a normal pre-kickoff side
      for (const pid of lineupFor(m2, GW)) { PLAYER_BY_ID[pid].status = 'a'; PLAYER_BY_ID[pid].chance = null; }
      for (const f of state.fixtures) { f.started = false; f.finished = false; f.minutes = 0; f.date = new Date(Date.now() + 2 * 864e5).toISOString(); }
      t('a side with nobody ruled out forecasts no subs at all',
        forecastSubs(m2, GW).length === 0,
        forecastSubs(m2, GW).map(s => PLAYER_BY_ID[s.out].name).join(', '));
    })();

    /* ----- it will not wreck the shape to make the swap -----
       Found the hard way writing this suite: the demo XI is 1-4-5-1, and its
       lone striker cannot be replaced by a midfielder without leaving FW at
       zero. The forecast refuses, and should. */
    (() => {
      const s = setUp();
      const m = s.mid;
      const cnt = xiCounts(lineupFor(m, GW));
      const tight = ['GK', 'FW', 'DF', 'MF'].find(pos => cnt[pos] === XI_RULES[pos][0]);
      const lone = s.xi.find(p => p.pos === tight);
      if (!lone) { t('a position sitting on its minimum exists to test with', false, JSON.stringify(cnt)); return; }
      // rule him out, and make sure nobody on the bench shares his position
      for (const p of s.xi) { p.status = 'a'; p.chance = null; }
      lone.status = 'i'; lone.chance = 0;
      for (const f of state.fixtures)
        if (f.home === lone.team || f.away === lone.team) { f.started = true; f.finished = true; f.minutes = 90; }
      const sameOnBench = benchFor(m, GW).some(b => b.pos === lone.pos && startChance(b, GW) > 0);
      t(`a lone ${tight} who cannot play is not replaced by the wrong position`,
        sameOnBench || !forecastSubs(m, GW).some(x => x.out === lone.id),
        sameOnBench ? '(bench has a like-for-like, so a swap is legal here)'
                    : 'the shape was broken to force a sub');
      const after = liveXI(m, GW).xi;
      const c = xiCounts(after);
      t('and the projected XI is legal whatever it decided',
        ['GK', 'DF', 'MF', 'FW'].every(pos => c[pos] >= XI_RULES[pos][0] && c[pos] <= XI_RULES[pos][1]),
        JSON.stringify(c));
    })();

    /* ----- a blank gameweek is not evidence of anything ----- */
    (() => {
      const s = setUp();
      // his club plays no fixture at all this week; he is fit
      s.out.status = 'a'; s.out.chance = null;
      state.fixtures = state.fixtures.filter(f => f.home !== s.out.team && f.away !== s.out.team);
      t('a man whose club has no fixture is not written off',
        !forecastSubs(s.mid, GW).some(x => x.out === s.out.id),
        'he was replaced on the evidence of a match nobody played');
    })();

    /* ----- once he has actually played, the forecast stops guessing ----- */
    (() => {
      const s = setUp();
      const ev = state.matchStats['gw' + GAMEWEEKS[GW].n];
      ev.playerStats[s.out.id] = played();
      t('a man who appeared is never forecast out, flagged or not',
        !forecastSubs(s.mid, GW).some(x => x.out === s.out.id),
        'he played and was still replaced');
    })();

    /* ----- and it shows on the pitch, as a forecast rather than a fact ----- */
    (() => {
      const s = setUp();
      const fc = forecastSubs(s.mid, GW).find(x => x.out === s.out.id);
      const rep = fc && PLAYER_BY_ID[fc.in];
      const marks = subMarks(s.mid, GW);
      t('the man who cannot play is marked on the pitch',
        /sub-arrow out fc/.test(marks[s.out.id] || ''), marks[s.out.id] || 'no mark');
      t('and the replacement is marked on the bench',
        rep && /sub-arrow in fc/.test(marks[rep.id] || ''), (rep && marks[rep.id]) || 'no mark');
      t('the forecast is drawn hollow, not as a solid completed sub',
        /&#9663;|&#9653;/.test((marks[s.out.id] || '') + (rep ? marks[rep.id] || '' : '')) &&
        !/&#9660;|&#9650;/.test((marks[s.out.id] || '') + (rep ? marks[rep.id] || '' : '')),
        (marks[s.out.id] || '') + ' | ' + (rep ? marks[rep.id] || '' : ''));
      t('and it names who it expects to come on',
        rep && (marks[s.out.id] || '').includes(rep.name), marks[s.out.id] || '');
      const mini = document.createElement('div');
      const score = gwManagerPoints(s.mid, GW);
      mini.innerHTML = dashMiniPitch(s.mid, GW);
      t('dashboard shows named forecast arrows on the starter and replacement',
        rep && mini.querySelector(`.pitch [data-pcard="${s.out.id}"] .sub-arrow.out.fc .sub-for`)?.textContent === rep.name &&
        mini.querySelector(`.bench-strip [data-pcard="${rep.id}"] .sub-arrow.in.fc .sub-for`)?.textContent === s.out.name);
      t('dashboard forecasts leave shirts and awarded points unchanged',
        rep && !mini.querySelector(`.pitch [data-pcard="${rep.id}"]`) && gwManagerPoints(s.mid, GW) === score);
    })();

    /* ----- Toby's case (29 Aug): the bench man ahead has ALREADY played -----
       Amad ruled out, Munoz first on the bench with 6 points already, and
       the forecast named the SECOND bench man because it only considered men
       who had not yet appeared. A man who has played can come on — he is the
       surest sub there is — and bench order decides. */
    (() => {
      const s = setUp();
      const before = forecastSubs(s.mid, GW).find(x => x.out === s.out.id);
      const rep = before && PLAYER_BY_ID[before.in];
      t('(setup) the forecast names someone before anyone on the bench has played', !!rep, 'no forecast');
      if (rep) {
        const ev = state.matchStats['gw' + GAMEWEEKS[GW].n];
        ev.playerStats[rep.id] = { ...played(), g: 1 }; // he has been on, and scored
        for (const f of state.fixtures) if (f.gw === GAMEWEEKS[GW].n && (f.home === rep.team || f.away === rep.team)) { f.started = true; f.fp = true; }
        const subsAfter = forecastSubs(s.mid, GW);
        const after = subsAfter.find(x => x.out === s.out.id);
        // Finishing his club's fixture finishes it for his OPPONENT too, and
        // with today's feed the demo XI carries a man from that side — so the
        // forecast, walking the XI in order, may spend him on THAT slot before
        // it reaches ours and name the next bench man for us. He is still the
        // man the forecast names; just not necessarily for this hole.
        const usedAnywhere = subsAfter.some(x => x.in === rep.id) || effectiveXI(s.mid, GW).xi.includes(rep.id);
        t('a bench man who has already played is still the one the forecast names',
          usedAnywhere,
          after ? `named ${PLAYER_BY_ID[after.in].name}, expected ${rep.name}` : 'no forecast at all');
        t('and the projected XI carries him',
          liveXI(s.mid, GW).xi.includes(rep.id));
      }
    })();

    return log;
  });

  for (const line of log) { console.log(line); if (line.startsWith('PASS')) pass++; else fail++; }
  console.log(`${pageErrors.length === 0 ? 'PASS' : 'FAIL'}  no page errors${pageErrors.length ? ' — ' + pageErrors.join(' | ') : ''}`);
  if (pageErrors.length === 0) pass++; else fail++;

  await browser.close();
  console.log(`\n[forecast-subs] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
