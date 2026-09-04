/* Auto-subs the projection can already be sure of (Marc, 23 Aug 2026:
 * "i know mateta will come on for sarr already meaning that i will get 2 more
 * points so the projection is slightly off").
 *
 * The rules being pinned here:
 *   - a sub is CERTAIN only when the starter's club is finished for the week
 *     and he never got on, and a bench man who HAS played can legally replace him
 *   - the settlement number (gwManagerPoints) does not move an inch until the
 *     final whistle of the last game — Ben's UAT ruling stands
 *   - once the round IS done, effectiveXI makes the swap for real and the
 *     pending list empties, so nothing is ever counted twice
 *
 * Usage: python3 -m http.server 8125 (repo root) then node test/pendingsubs.smoke.js
 */
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

    // A gameweek that is under way but NOT over: the clock says mid-round and
    // no fixture has been whistled, so effectiveXI holds its fire.
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
      for (let k = 0; k + 1 < TEAMS.length; k += 2) {
        state.fixtures.push({ gw: g.n, home: TEAMS[k].name, away: TEAMS[k + 1].name, started: true, minutes: 45, finished: false });
      }
      return ev;
    }
    const fxOf = club => state.fixtures.filter(f => f.home === club || f.away === club);
    const whistle = club => fxOf(club).forEach(f => { f.finished = true; f.minutes = 90; });

    /* ----- the scenario: Sarr starts and never gets on, Mateta plays ----- */
    // returns { mid, dead, sub, ev } — dead is the ghost starter, sub the bench
    // man who has actually played. Everyone else in the XI is on the pitch.
    function scene() {
      const ev = baseline();
      const mid = state.managers[0].id;
      const squad = squadAt(mid, GW);
      const xi = autoXI(squad);
      state.lineups[mid] = { [GW]: xi };
      const bench = squad.filter(p => !xi.includes(p.id));
      // pick a starter who has a same-position replacement on the bench, so the
      // XI shape can't be the reason a sub does or doesn't happen
      let dead = null, sub = null;
      for (const p of xi.map(id => PLAYER_BY_ID[id])) {
        const m = bench.find(b => b.pos === p.pos && b.team !== p.team);
        if (m) { dead = p; sub = m; break; }
      }
      state.benchOrders[mid] = { [GW]: [sub.id, ...bench.filter(b => b.id !== sub.id).map(b => b.id)] };
      // every starter but the ghost played; of the bench, only our man played
      for (const id of xi) if (id !== dead.id) ev.playerStats[id] = played();
      ev.playerStats[sub.id] = played();
      whistle(dead.team);
      whistle(sub.team);
      return { mid, dead, sub, ev, xi, bench };
    }

    const S = scene();
    const subs = pendingSubs(S.mid, GW);
    t('a finished club plus a ghost starter plus a bench man who played = one certain sub',
      subs.length === 1 && subs[0].out === S.dead.id && subs[0].in === S.sub.id,
      JSON.stringify(subs));
    t('the certain sub is worth exactly what the bench man has banked',
      pendingSubPoints(S.mid, GW) === gwPlayerPoints(S.sub.id, GW) && gwPlayerPoints(S.sub.id, GW) === 2,
      `pending ${pendingSubPoints(S.mid, GW)}, ${S.sub.name} on ${gwPlayerPoints(S.sub.id, GW)}`);
    t('liveXI fields the bench man and drops the ghost',
      liveXI(S.mid, GW).xi.includes(S.sub.id) && !liveXI(S.mid, GW).xi.includes(S.dead.id));
    t('liveXI is still eleven men', liveXI(S.mid, GW).xi.length === 11, String(liveXI(S.mid, GW).xi.length));

    // THE line in the sand: settlement waits for the final whistle
    const settled = gwManagerPoints(S.mid, GW);
    const banked = lineupFor(S.mid, GW).reduce((n, id) => n + gwPlayerPoints(id, GW), 0);
    t('gwManagerPoints does NOT move — the sub is projected, not awarded',
      settled === banked && settled === 20, `settled ${settled}, banked XI ${banked}`);
    t('effectiveXI has made no swap of its own', effectiveXI(S.mid, GW).subs.length === 0);

    /* ----- the projection actually uses it ----- */
    const before = teamOutlook(S.mid, GW).exp;
    S.ev.playerStats[S.sub.id] = { ...played(), g: 1 }; // a midfield goal is +5
    const after = teamOutlook(S.mid, GW).exp;
    const gained = Math.round((after - before) * 100) / 100;
    const goalWorth = gwPlayerPoints(S.sub.id, GW) - 2;
    t('the bench man\'s points feed the projection (teamOutlook reads liveXI)',
      gained === goalWorth && goalWorth > 0, `exp moved ${gained}, his goal was worth ${goalWorth}`);
    S.ev.playerStats[S.sub.id] = played();

    const needs = matchNeeds(S.mid, pairingsFor(GW).find(p => p.includes(S.mid)).find(x => x !== S.mid), GW, S.mid);
    t('the requirement sheet declares the unawarded points',
      needs.left.pending === 2 && needs.lines.some(l => l.includes('Auto-subs still to be awarded')),
      JSON.stringify(needs.lines));
    t('the requirement sheet still quotes the settled score, not the projected one',
      needs.left.current === settled, `${needs.left.current} vs ${settled}`);

    /* ----- when it is NOT certain ----- */
    let X = scene();
    fxOf(X.dead.team).forEach(f => { f.finished = false; f.minutes = 60; });
    t('a starter whose club is still playing is not written off yet',
      pendingSubs(X.mid, GW).length === 0, JSON.stringify(pendingSubs(X.mid, GW)));

    X = scene();
    delete X.ev.playerStats[X.sub.id];
    t('a bench man who has not played yet cannot be the certain replacement',
      pendingSubs(X.mid, GW).length === 0, JSON.stringify(pendingSubs(X.mid, GW)));

    X = scene();
    state.fixtures = state.fixtures.filter(f => f.home !== X.dead.team && f.away !== X.dead.team);
    t('a blank gameweek proves nothing — no fixture, no auto-sub',
      pendingSubs(X.mid, GW).length === 0, JSON.stringify(pendingSubs(X.mid, GW)));

    // the provisional whistle counts, exactly as it does everywhere else
    X = scene();
    fxOf(X.dead.team).forEach(f => { f.finished = false; f.fp = true; });
    t('fp (the provisional whistle) ends the match here too',
      pendingSubs(X.mid, GW).length === 1, JSON.stringify(pendingSubs(X.mid, GW)));

    /* ----- shape: a keeper can only be replaced by a keeper ----- */
    (() => {
      const ev = baseline();
      const mid = state.managers[0].id;
      // demo squads carry one keeper, so hand this manager a reserve — the test
      // must actually reach the second half of it, not skip past
      const owned = ownedIdsAt(GW);
      const spare = PLAYERS.find(p => p.pos === 'GK' && !owned.has(p.id));
      state.draft.picks.push({ managerId: mid, playerId: spare.id, round: 99, overall: 999 });
      const squad = squadAt(mid, GW);
      const gk = squad.find(p => p.pos === 'GK' && p.id !== spare.id);
      const xi = autoXI(squad.filter(p => p.id !== spare.id));
      state.lineups[mid] = { [GW]: xi };
      const bench = squad.filter(p => !xi.includes(p.id));
      const outfield = bench.find(p => p.pos !== 'GK');
      for (const id of xi) if (id !== gk.id) ev.playerStats[id] = played();
      ev.playerStats[outfield.id] = played();       // he played; the reserve keeper didn't
      whistle(gk.team); whistle(outfield.team);
      t('an outfielder cannot take the goalkeeper\'s shirt',
        pendingSubs(mid, GW).length === 0, JSON.stringify(pendingSubs(mid, GW)));
      ev.playerStats[spare.id] = played();
      whistle(spare.team);
      const got = pendingSubs(mid, GW);
      t('a reserve keeper who played does take it',
        got.length === 1 && got[0].out === gk.id && got[0].in === spare.id, JSON.stringify(got));
    })();

    /* ----- the final whistle: hand over cleanly, count nothing twice ----- */
    const F = scene();
    state.fixtures.forEach(f => { f.finished = true; f.minutes = 90; });
    const real = effectiveXI(F.mid, GW);
    t('at the final whistle effectiveXI makes the swap for real',
      real.subs.length === 1 && real.subs[0].in === F.sub.id, JSON.stringify(real.subs));
    t('and the pending list empties — no double count',
      pendingSubs(F.mid, GW).length === 0 && pendingSubPoints(F.mid, GW) === 0);
    t('the settled score now includes the sub, once and only once',
      gwManagerPoints(F.mid, GW) === settled + 2, `${gwManagerPoints(F.mid, GW)} vs ${settled} + 2`);
    t('liveXI and effectiveXI agree once the round is done',
      liveXI(F.mid, GW).xi.join() === real.xi.join());

    /* ----- a league with nothing pending is charged with nothing ----- */
    (() => {
      const ev = baseline();
      const mid = state.managers[0].id;
      const xi = autoXI(squadAt(mid, GW));
      state.lineups[mid] = { [GW]: xi };
      for (const id of xi) ev.playerStats[id] = played();
      state.fixtures.forEach(f => { f.finished = true; f.minutes = 90; });
      t('an XI that all turned up has no pending subs and no phantom points',
        pendingSubs(mid, GW).length === 0 && pendingSubPoints(mid, GW) === 0);
      t('liveScoreHtml prints a bare number when nothing is owed',
        liveScoreHtml(mid, GW) === String(gwManagerPoints(mid, GW)), liveScoreHtml(mid, GW));
    })();

    /* ----- the arrows name the partner, at BOTH ends ----- */
    const A = scene();
    const am = subMarks(A.mid, GW);
    t('the man coming off is marked, and the mark names who replaces him',
      /sub-arrow out pend/.test(am[A.dead.id] || '') && (am[A.dead.id] || '').includes(A.sub.name),
      am[A.dead.id]);
    t('the man coming on is marked, and the mark names who he comes on for',
      /sub-arrow in pend/.test(am[A.sub.id] || '') && (am[A.sub.id] || '').includes(A.dead.name),
      am[A.sub.id]);
    t('nobody else on the pitch is marked',
      Object.keys(am).length === 2, JSON.stringify(Object.keys(am)));

    // once it is settled the marks stay, at both ends, minus the pulse
    state.fixtures.forEach(f => { f.finished = true; f.minutes = 90; });
    const sm = subMarks(A.mid, GW);
    t('at full time both ends are still marked, and no longer pending',
      (sm[A.sub.id] || '').includes('sub-arrow in') && !/pend/.test(sm[A.sub.id] || '') &&
      (sm[A.dead.id] || '').includes('sub-arrow out') && !/pend/.test(sm[A.dead.id] || ''),
      JSON.stringify([sm[A.dead.id], sm[A.sub.id]]));
    t('the settled marks still name the partner at both ends',
      (sm[A.dead.id] || '').includes(A.sub.name) && (sm[A.sub.id] || '').includes(A.dead.name));

    // a squad that all turned up carries no marks at all
    (() => {
      const ev = baseline();
      const mid = state.managers[0].id;
      const xi = autoXI(squadAt(mid, GW));
      state.lineups[mid] = { [GW]: xi };
      for (const id of xi) ev.playerStats[id] = played();
      state.fixtures.forEach(f => { f.finished = true; f.minutes = 90; });
      t('an XI that all turned up carries no arrows', Object.keys(subMarks(mid, GW)).length === 0);
    })();

    // and the markup when something IS owed
    const M = scene();
    t('liveScoreHtml shows the settled score with the owed points beside it',
      liveScoreHtml(M.mid, GW) === `${gwManagerPoints(M.mid, GW)} <span class="pend-pts" title="Auto-subs already certain — awarded at the final whistle of the last game">+2</span>`,
      liveScoreHtml(M.mid, GW));

    // The dashboard must expose the same substitution truth as the matchup.
    const mini = document.createElement('div');
    mini.innerHTML = dashMiniPitch(M.mid, GW);
    t('dashboard names the pending replacement on both starter and bench chips',
      mini.querySelector(`.pitch [data-pcard="${M.dead.id}"] .sub-arrow.out.pend .sub-for`)?.textContent === M.sub.name &&
      mini.querySelector(`.bench-strip [data-pcard="${M.sub.id}"] .sub-arrow.in.pend .sub-for`)?.textContent === M.dead.name);
    t('pending dashboard shirts stay put and rendering never awards points',
      !mini.querySelector(`.pitch [data-pcard="${M.sub.id}"]`) && gwManagerPoints(M.mid, GW) === 20);
    state.fixtures.forEach(f => { f.finished = true; f.minutes = 90; });
    M.ev.final = true;
    mini.innerHTML = dashMiniPitch(M.mid, GW);
    t('settled dashboard moves the replacement onto the pitch with a solid arrow',
      !!mini.querySelector(`.pitch [data-pcard="${M.sub.id}"] .sub-arrow.in:not(.pend):not(.fc)`) &&
      !mini.querySelector(`.pitch [data-pcard="${M.dead.id}"]`));
    t('settled dashboard shows the outgoing man below and never duplicates the incoming man',
      !!mini.querySelector(`.bench-strip [data-pcard="${M.dead.id}"] .sub-arrow.out`) &&
      mini.querySelectorAll(`[data-pcard="${M.sub.id}"]`).length === 1 &&
      mini.querySelectorAll('.pitch .pitch-chip').length === 11);

    /* ----- nobody else's numbers moved ----- */
    (() => {
      const ev = baseline();
      for (const m of state.managers) {
        const xi = autoXI(squadAt(m.id, GW));
        state.lineups[m.id] = { [GW]: xi };
        for (const id of xi) ev.playerStats[id] = played();
      }
      const anyPending = state.managers.some(m => pendingSubs(m.id, GW).length > 0);
      t('a full round of eleven-out-of-eleven leaves the whole league with nothing pending', !anyPending);
    })();

    return log;
  });

  for (const line of log) { console.log(line); if (line.startsWith('PASS')) pass++; else fail++; }
  chk('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
