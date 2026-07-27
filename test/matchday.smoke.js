/* Matchday trio regression: "what do I need?", the form table, Next Six.
 *
 * The live-state checks CRAFT a gameweek: frozen clock inside GW1's window,
 * synced playerStats for known scores, and hand-built fixtures per club so
 * remaining-player logic is fully controlled. Points are read back through
 * the app's own scorer (gwManagerPoints) and every requirement line is
 * checked against those reads — the copy must match the maths, not the test's
 * guess at the scoring table.
 *
 * Usage: python3 -m http.server 8125 &   node test/matchday.smoke.js */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED_SEASON = `(() => {
  window.__autoConfirm = true;
  syncNow = async () => {};
  const t0 = new Date(GAMEWEEKS[0].from).getTime() - 7 * 86400000;
  Date.now = () => t0;
  state.matchStats = {}; state.fixtures = state.fixtures || [];
  for (const g of GAMEWEEKS) g.finished = false;
  const byPos = { GK: [], DF: [], MF: [], FW: [] };
  for (const pl of PLAYERS) byPos[pl.pos]?.push(pl);
  for (const k in byPos) byPos[k].sort((a, b) => b.pts - a.pts);
  const NEED = { GK: 2, DF: 5, MF: 4, FW: 3 };
  state.phase = 'season';
  state.draft.order = state.managers.map(m => m.id);
  state.draft.picks = [];
  state.lineups = {}; state.transfers = []; state.claims = {};
  let n = 1;
  state.managers.forEach((m, k) => {
    for (const pos in NEED) for (let j = 0; j < NEED[pos]; j++) {
      state.draft.picks.push({ managerId: m.id, playerId: byPos[pos][k * NEED[pos] + j].id, n: n++ });
    }
  });
  save(); render();
  return 'ok';
})()`;

/* put GW1 into a controlled LIVE state.
   scores: {mid: goalsPerXIPlayer}; clubStates: fn(club) -> 'done'|'live'|'pre'|'blank'|'double' */
const CRAFT_LIVE = `((scoreSpec, clubPlan) => {
  const gwN = GAMEWEEKS[0].n;
  // clock inside GW1's window
  const mid1 = new Date(GAMEWEEKS[0].from).getTime() + 3600000;
  Date.now = () => mid1;
  GAMEWEEKS[0].finished = false;
  const pair = pairingsFor(0)[0];
  const xiClubs = new Set();
  for (const m of pair) for (const pid of effectiveXI(m, 0).xi) xiClubs.add(PLAYER_BY_ID[pid].team);
  // stats: every XI player started; goals per the spec
  const ps = {};
  for (const m of pair) {
    const goals = scoreSpec[m] ?? 0;
    for (const pid of effectiveXI(m, 0).xi) ps[pid] = { min: 90, st: 1, g: goals };
  }
  state.matchStats['gw' + gwN] = { playerStats: ps };
  // fixtures: one per club by default, overridable per club
  state.fixtures = [];
  const clubs = [...new Set(PLAYERS.map(p => p.team))];
  for (const c of clubs) {
    const plan = clubPlan[c] || 'done';
    // phantom opponent: no real club may appear in another club's fixture, or
    // one club's plan would contaminate every other club's fixture state
    const opp = 'Phantom ' + c;
    if (plan === 'blank') continue;
    if (plan === 'double') {
      state.fixtures.push({ gw: gwN, home: c, away: opp, started: true, finished: true, minutes: 90 });
      state.fixtures.push({ gw: gwN, home: opp, away: c, started: false, finished: false, minutes: 0 });
      continue;
    }
    state.fixtures.push({
      gw: gwN, home: c, away: opp,
      started: plan !== 'pre',
      finished: plan === 'done',
      minutes: plan === 'done' ? 90 : plan === 'live' ? 60 : 0,
    });
  }
  render();
  return { pair, status: gwStatus(0) };
})`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const allErrors = [];
  const newPage = async (ctx, url, viewport) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => allErrors.push(url + ': ' + e.message));
    p.on('dialog', d => d.accept());
    if (viewport) await p.setViewport(viewport);
    await p.goto(url, { waitUntil: 'networkidle2' });
    await p.waitForFunction(() => typeof state !== 'undefined' && state.managers.length);
    return p;
  };

  const ctx = await browser.createBrowserContext();
  const p = await newPage(ctx, 'http://localhost:8125?nosync');
  chk('season seeds cleanly', await p.evaluate(SEED_SEASON) === 'ok');

  /* ── N1: before kickoff — projected line, no requirements ── */
  const n1 = await p.evaluate(() => {
    const pair = pairingsFor(0)[0];
    const m = matchNeeds(pair[0], pair[1], 0, pair[0]);
    return { state: m.state, lines: m.lines, projL: m.left.projected, projR: m.right.projected };
  });
  chk('N1: pre-kickoff state=pre with a projection line, never a requirement',
    n1.state === 'pre' && n1.lines.length === 1 && /rojected|Nothing between/.test(n1.lines[0]) && !/need/.test(n1.lines[0]),
    JSON.stringify(n1));
  chk('N1: seeded projections genuinely differ (orientation checks are non-vacuous)',
    n1.projL !== n1.projR, `${n1.projL} v ${n1.projR}`);

  /* ── N3/N4/N8: live, behind with several players, both sides have players ── */
  const n3 = await p.evaluate(`(() => {
    const r = ${CRAFT_LIVE}({}, {});
    const pair = r.pair;
    // both sides fully live: every club still playing
    const plan = {};
    for (const pl of PLAYERS) plan[pl.team] = 'live';
    const r2 = ${CRAFT_LIVE}({ [pair[1]]: 1 }, plan); // pair[1] a goal per player ahead
    const m = matchNeeds(pair[0], pair[1], 0, pair[0]);
    const curA = gwManagerPoints(pair[0], 0), curB = gwManagerPoints(pair[1], 0);
    return { status: r2.status, m: { state: m.state, margin: m.margin, tie: m.tieRequirement, lead: m.leadRequirement, lines: m.lines, remL: m.left.remainingPlayers.length, remR: m.right.remainingPlayers.length }, curA, curB };
  })()`);
  chk('N3 precondition: GW is genuinely live and pov is behind',
    n3.status === 'live' && n3.curA < n3.curB, JSON.stringify({ status: n3.status, curA: n3.curA, curB: n3.curB }));
  chk('N3/N4: several players left on both sides → provisional "more than they produce" copy',
    n3.m.remL > 1 && n3.m.remR > 1 && /more than .+ produce/.test(n3.m.lines[0]), JSON.stringify(n3.m.lines));
  chk('N8: a deficit of d needs d to tie and d+1 to lead',
    n3.m.tie === n3.curB - n3.curA && n3.m.lead === n3.curB - n3.curA + 1 && n3.m.lines[0].includes(String(n3.m.lead)),
    JSON.stringify({ tie: n3.m.tie, lead: n3.m.lead }));

  /* ── N2: behind with exactly ONE player remaining ── */
  const n2 = await p.evaluate(`(() => {
    const pair = pairingsFor(0)[0];
    // find an XI player of pair[0] whose club appears exactly once across both XIs
    const xiA = effectiveXI(pair[0], 0).xi.map(id => PLAYER_BY_ID[id]);
    const xiB = effectiveXI(pair[1], 0).xi.map(id => PLAYER_BY_ID[id]);
    const clubCount = {};
    for (const pl of [...xiA, ...xiB]) clubCount[pl.team] = (clubCount[pl.team] || 0) + 1;
    const lastMan = xiA.find(pl => clubCount[pl.team] === 1);
    if (!lastMan) return { fail: 'no unique-club player' };
    const plan = {};
    for (const pl of PLAYERS) plan[pl.team] = 'done';
    plan[lastMan.team] = 'pre';
    ${CRAFT_LIVE}({ [pair[1]]: 1 }, plan);
    const m = matchNeeds(pair[0], pair[1], 0, pair[0]);
    const curA = gwManagerPoints(pair[0], 0), curB = gwManagerPoints(pair[1], 0);
    return { lastMan: lastMan.name, m: { state: m.state, lines: m.lines, remL: m.left.remainingPlayers.map(x => x.name), remR: m.right.remainingPlayers.length }, need: curB - curA + 1, tie: curB - curA };
  })()`);
  chk('N2 precondition: exactly one player remains for the trailing side, none for the leader',
    !n2.fail && n2.m.remL.length === 1 && n2.m.remL[0] === n2.lastMan && n2.m.remR === 0, JSON.stringify(n2.m?.remL));
  chk('N2: "you need N from <name>" names the one man and the true number',
    n2.m.lines[0].includes(n2.lastMan) && n2.m.lines[0].includes(`need ${n2.need} from`) && n2.m.lines[0].includes(`${n2.tie} ties`),
    JSON.stringify(n2.m.lines));

  /* ── N5: leader's view — ahead, opponent still armed / N15: both seats ── */
  const n5 = await p.evaluate(`(() => {
    const pair = pairingsFor(0)[0];
    const xiB = effectiveXI(pair[1], 0).xi.map(id => PLAYER_BY_ID[id]);
    const xiA = effectiveXI(pair[0], 0).xi.map(id => PLAYER_BY_ID[id]);
    const clubCount = {};
    for (const pl of [...xiA, ...xiB]) clubCount[pl.team] = (clubCount[pl.team] || 0) + 1;
    const threat = xiB.find(pl => clubCount[pl.team] === 1);
    if (!threat) return { fail: 'no unique-club B player' };
    const plan = {};
    for (const pl of PLAYERS) plan[pl.team] = 'done';
    plan[threat.team] = 'live';
    ${CRAFT_LIVE}({ [pair[0]]: 1 }, plan); // pair[0] leads now
    const lead = matchNeeds(pair[0], pair[1], 0, pair[0]);
    const trail = matchNeeds(pair[0], pair[1], 0, pair[1]);
    return { threat: threat.name,
      lead: { margin: lead.margin, lines: lead.lines },
      trail: { margin: trail.margin, lines: trail.lines } };
  })()`);
  chk('N5/N15 leader seat: "you lead by N, but X remaining" names the threat',
    !n5.fail && n5.lead.margin > 0 && n5.lead.lines[0].includes(`lead by ${n5.lead.margin}`) && n5.lead.lines[0].includes(n5.threat),
    JSON.stringify(n5.lead));
  chk('N15 trailing seat: same tie, mirrored margin, one-man requirement',
    n5.trail.margin === -n5.lead.margin && n5.trail.lines[0].includes(n5.threat) && n5.trail.lines[0].includes(`need ${-n5.trail.margin + 1} from`),
    JSON.stringify(n5.trail));

  /* ── N6: nobody left anywhere / N7: tied ── */
  const n67 = await p.evaluate(`(() => {
    const pair = pairingsFor(0)[0];
    const planDone = {};
    for (const pl of PLAYERS) planDone[pl.team] = 'done';
    ${CRAFT_LIVE}({ [pair[1]]: 1 }, planDone);
    const behindNone = matchNeeds(pair[0], pair[1], 0, pair[0]);
    ${CRAFT_LIVE}({}, planDone); // equal scores
    const tied = matchNeeds(pair[0], pair[1], 0, pair[0]);
    const planLive = {};
    for (const pl of PLAYERS) planLive[pl.team] = 'live';
    ${CRAFT_LIVE}({}, planLive);
    const tiedLive = matchNeeds(pair[0], pair[1], 0, pair[0]);
    return { behindNone: behindNone.lines, tied: { margin: tied.margin, lines: tied.lines }, tiedLive: tiedLive.lines };
  })()`);
  chk('N6: behind with nobody left → official-stat-correction line, no fake requirement',
    /official-stat correction/.test(n67.behindNone[0]) && !/need \d/.test(n67.behindNone[0]), JSON.stringify(n67.behindNone));
  chk('N7: tied score says level explicitly — never "need 0"',
    n67.tied.margin === 0 && /All level/.test(n67.tied.lines[0]) && !/need 0/.test(n67.tied.lines.join(' '))
      && /All level/.test(n67.tiedLive[0]) && /left|nobody/.test(n67.tiedLive[1] || ''),
    JSON.stringify(n67.tied.lines.concat(n67.tiedLive)));

  /* ── N9/N10/N11: blank, double (half-played), zero-point-not-finished ── */
  const n9 = await p.evaluate(`(() => {
    const pair = pairingsFor(0)[0];
    const xiA = effectiveXI(pair[0], 0).xi.map(id => PLAYER_BY_ID[id]);
    const xiB = effectiveXI(pair[1], 0).xi.map(id => PLAYER_BY_ID[id]);
    const both = [...xiA, ...xiB];
    const gwN = GAMEWEEKS[0].n;
    // BLANK: everyone live, then blank one club — exactly that club's XI
    // players must drop out of "remaining", everyone else stays
    const blankClub = xiA[0].team;
    const planLive = {};
    for (const pl of PLAYERS) planLive[pl.team] = 'live';
    ${CRAFT_LIVE}({}, planLive);
    const mBase = matchNeeds(pair[0], pair[1], 0, pair[0]);
    const baseRem = new Set([...mBase.left.remainingPlayers, ...mBase.right.remainingPlayers].map(x => x.id));
    const planBlank = { ...planLive, [blankClub]: 'blank' };
    ${CRAFT_LIVE}({}, planBlank);
    const mBlank = matchNeeds(pair[0], pair[1], 0, pair[0]);
    const blankRem = new Set([...mBlank.left.remainingPlayers, ...mBlank.right.remainingPlayers].map(x => x.id));
    const droppedExactly = both.every(pl => pl.team === blankClub ? !blankRem.has(pl.id) : blankRem.has(pl.id) === baseRem.has(pl.id));
    const fsBlank = playerFixtureState(xiA[0], gwN);
    // DOUBLE: one club gets a finished + a not-started fixture, rest done
    const doubleMan = xiA.find(pl => pl.team !== blankClub) || xiA[0];
    const planDouble = {};
    for (const pl of PLAYERS) planDouble[pl.team] = 'done';
    planDouble[doubleMan.team] = 'double';
    ${CRAFT_LIVE}({}, planDouble);
    const mD = matchNeeds(pair[0], pair[1], 0, pair[0]);
    const fsDouble = playerFixtureState(doubleMan, gwN);
    const dRem = [...mD.left.remainingPlayers, ...mD.right.remainingPlayers].map(x => x.id);
    // ZERO-POINT, NOT FINISHED: wipe a player's stat line, fixture still pre
    const zeroMan = xiA.find(pl => pl.team !== doubleMan.team && pl.team !== blankClub) || xiA[1];
    const planZero = {};
    for (const pl of PLAYERS) planZero[pl.team] = 'done';
    planZero[zeroMan.team] = 'pre';
    ${CRAFT_LIVE}({}, planZero);
    delete state.matchStats['gw' + gwN].playerStats[zeroMan.id];
    const mZ = matchNeeds(pair[0], pair[1], 0, pair[0]);
    const zRem = [...mZ.left.remainingPlayers, ...mZ.right.remainingPlayers].map(x => x.id);
    return {
      baseN: baseRem.size, droppedExactly, fsBlank: { st: fsBlank.st, frac: fsBlank.frac }, blankN: blankRem.size,
      doubleId: doubleMan.id, fsDouble: { st: fsDouble.st, frac: fsDouble.frac }, dRemHasDouble: dRem.includes(doubleMan.id),
      zeroId: zeroMan.id, zRemHasZero: zRem.includes(zeroMan.id), zeroPts: gwPlayerPoints(zeroMan.id, 0),
    };
  })()`);
  chk('N9: blanking a club drops exactly its players from remaining (precondition: they were in)',
    n9.baseN > 0 && n9.droppedExactly && n9.blankN < n9.baseN && n9.fsBlank.frac === 0 && n9.fsBlank.st === 'none',
    JSON.stringify({ baseN: n9.baseN, blankN: n9.blankN, fs: n9.fsBlank }));
  chk('N10: double-GW player with one fixture done, one to come → still remaining at half weight',
    n9.fsDouble?.st === 'mixed' && n9.fsDouble?.frac === 0.5 && n9.dRemHasDouble, JSON.stringify(n9.fsDouble));
  chk('N11: zero points + unfinished fixture → still remaining (zero is not "done")',
    n9.zeroPts === 0 && n9.zRemHasZero, JSON.stringify({ pts: n9.zeroPts, in: n9.zRemHasZero }));

  /* ── N12/N13: empty XI, missing fixture data ── */
  const n12 = await p.evaluate(`(() => {
    const pair = pairingsFor(0)[0];
    const planLive = {};
    for (const pl of PLAYERS) planLive[pl.team] = 'live';
    ${CRAFT_LIVE}({}, planLive);
    const stash = state.draft.picks;
    state.draft.picks = stash.filter(pk => pk.managerId !== pair[1]);
    const m = matchNeeds(pair[0], pair[1], 0, pair[0]);
    state.draft.picks = stash;
    state.fixtures = []; // feed lost its fixtures entirely
    const m2 = matchNeeds(pair[0], pair[1], 0, pair[0]);
    return { emptyLines: m.lines, emptyRem: m.right.remainingPlayers.length, noFixLines: m2.lines, noFixRem: m2.left.remainingPlayers.length };
  })()`);
  chk('N12: opponent with an empty XI renders clean copy (no NaN, no crash)',
    n12.emptyRem === 0 && n12.emptyLines.length > 0 && !/NaN|Infinity|undefined/.test(n12.emptyLines.join(' ')), JSON.stringify(n12.emptyLines));
  chk('N13: missing fixture data → everyone still counted in, copy stays finite',
    n12.noFixRem > 0 && !/NaN|Infinity|undefined/.test(n12.noFixLines.join(' ')), JSON.stringify(n12.noFixLines));

  /* ── N14: final — result statement, requirement language gone ── */
  const n14 = await p.evaluate(`(() => {
    const pair = pairingsFor(0)[0];
    const planDone = {};
    for (const pl of PLAYERS) planDone[pl.team] = 'done';
    ${CRAFT_LIVE}({ [pair[0]]: 1 }, planDone);
    GAMEWEEKS[0].finished = true;
    const win = matchNeeds(pair[0], pair[1], 0, pair[0]);
    const loss = matchNeeds(pair[0], pair[1], 0, pair[1]);
    const barHtml = winProbBar(pair[0], pair[1], 0, pair[0]);
    ${CRAFT_LIVE}({}, planDone);
    GAMEWEEKS[0].finished = true;
    const level = matchNeeds(pair[0], pair[1], 0, pair[0]);
    GAMEWEEKS[0].finished = false;
    return { win: win.lines, loss: loss.lines, level: level.lines, state: win.state, barHtml };
  })()`);
  chk('N14: final says Won/Lost/Level by margin — no needs, no percentages in the bar',
    n14.state === 'final' && /^Won by \d+\.$/.test(n14.win[0]) && /^Lost by \d+\.$/.test(n14.loss[0]) && n14.level[0] === 'Finished level.'
      && /prob-final/.test(n14.barHtml) && !/WIN CHANCE|prob-bar|need \d/.test(n14.barHtml),
    JSON.stringify({ win: n14.win, loss: n14.loss, level: n14.level }));

  /* ── N16/N17/N18/N19: the three surfaces, correct seats ── */
  const n16 = await p.evaluate(`(async () => {
    const pair = pairingsFor(0)[0];
    const planLive = {};
    for (const pl of PLAYERS) planLive[pl.team] = 'live';
    ${CRAFT_LIVE}({ [pair[1]]: 1 }, planLive); // pair[1] leads
    whoami = pair[0];
    state.view = 'dash'; render();
    const dashLine = document.querySelector('.prob-wrap .need-line')?.textContent || '';
    const dashSubs = [...document.querySelectorAll('.prob-sub span:not(.prob-mid)')].map(s => s.textContent);
    // duel: viewer pair[0], opponent LEFT
    teamView.mid = pair[0]; teamView.gw = 0; teamView.showOpp = true; state.view = 'team'; render();
    const duelLine = document.querySelector('.prob-wrap .need-line')?.textContent || '';
    const duelHeads = [...document.querySelectorAll('.duel-side h3 b')].map(b => +b.textContent.replace(/[^0-9.-]/g, ''));
    teamView.showOpp = false;
    // modal as pair[1] (the leader's seat)
    whoami = pair[1];
    showMatchup(pair[0], pair[1], 0);
    const ov = document.querySelector('#muOverlay');
    const muLine = ov.querySelector('.need-line')?.textContent || '';
    ov.remove();
    whoami = null;
    const lead = gwManagerPoints(pair[1], 0) - gwManagerPoints(pair[0], 0);
    return { dashLine, dashSubs, duelLine, duelHeads, muLine, lead };
  })()`);
  chk('N16: dashboard need-line exists and speaks to the trailing viewer with the true number',
    n16.dashLine.length > 0 && n16.dashLine.includes(`${n16.lead + 1} more`) && /you need|You need|Currently/.test(n16.dashLine),
    n16.dashLine);
  chk('N17: duel need-line present, viewer\'s seat (right) is the one being addressed',
    n16.duelLine.length > 0 && n16.duelLine.includes(`${n16.lead + 1} more`), n16.duelLine);
  chk('N18: modal need-line speaks to the leading viewer ("lead by N")',
    n16.muLine.includes(`lead by ${n16.lead}`), n16.muLine);
  chk('N19: dashboard current-vs-proj numbers rendered for both sides while live',
    n16.dashSubs.length === 2 && n16.dashSubs.every(s => /proj/.test(s)), JSON.stringify(n16.dashSubs));

  /* ── N20: sweep every crafted state for NaN/Infinity/negative needs ── */
  const n20 = await p.evaluate(`(() => {
    const pair = pairingsFor(0)[0];
    const out = [];
    const plans = [];
    const planLive = {}; const planDone = {}; const planPre = {};
    for (const pl of PLAYERS) { planLive[pl.team] = 'live'; planDone[pl.team] = 'done'; planPre[pl.team] = 'pre'; }
    plans.push([{}, planLive], [{ [pair[0]]: 2 }, planLive], [{ [pair[1]]: 3 }, planDone], [{}, planPre]);
    for (const [score, plan] of plans) {
      ${CRAFT_LIVE}(score, plan);
      for (const pov of [pair[0], pair[1], null]) {
        const m = matchNeeds(pair[0], pair[1], 0, pov);
        out.push(...m.lines);
        if (m.tieRequirement < 0 || m.leadRequirement < 0) out.push('NEGATIVE-REQ');
      }
    }
    return out.join(' | ');
  })()`);
  chk('N20: no NaN/Infinity/negative requirement in any crafted state × any seat',
    n20.length > 50 && !/NaN|Infinity|NEGATIVE-REQ|need 0[^.\d]/.test(n20), n20.slice(0, 120));

  /* ═══════════════ FORM TABLE ═══════════════ */
  const f0 = await p.evaluate(`(() => {
    // clean slate: pre-season, nothing finished, no stats
    const t0 = new Date(GAMEWEEKS[0].from).getTime() - 7 * 86400000;
    Date.now = () => t0;
    state.matchStats = {}; state.fixtures = [];
    for (const g of GAMEWEEKS) g.finished = false;
    tableView.mode = 'overall';
    state.view = 'table'; render();
    const sub = document.querySelector('h2 .muted').textContent;
    document.querySelector('[data-tblmode="3"]').click();
    const note = document.querySelector('.card p.muted')?.textContent || '';
    const mids = [...document.querySelectorAll('[data-mgr-row]')].map(r => +r.dataset.mgrRow);
    document.querySelector('[data-tblmode="overall"]').click();
    return { sub, note, mids, constitutional: state.managers.map(m => m.id) };
  })()`);
  chk('F1: Overall is the default view', /overall points/.test(f0.sub), f0.sub);
  chk('F5a: pre-season Last 3 explains form begins after GW1, constitutional order',
    /Form begins after GW1/.test(f0.note) && JSON.stringify(f0.mids) === JSON.stringify(f0.constitutional), f0.note);

  /* craft 4 finished GWs + 1 live one; manager scores differ by GW */
  const f1 = await p.evaluate(`(() => {
    const pair01 = state.managers.map(m => m.id);
    // 4 finished GWs: in GW4 (idx 3) give manager LAST a goal bonanza so the
    // form windows genuinely reorder vs overall
    const star = pair01[pair01.length - 1];
    for (let i = 0; i < 5; i++) {
      const ps = {};
      for (const m of state.managers) {
        const goals = (i === 3 && m.id === star) ? 3 : 0;
        for (const pid of effectiveXI(m.id, i).xi) ps[pid] = { min: 90, st: 1, g: goals };
      }
      state.matchStats['gw' + GAMEWEEKS[i].n] = { playerStats: ps };
      GAMEWEEKS[i].finished = i < 4; // idx 4 = synced but NOT over → live
    }
    const t = new Date(GAMEWEEKS[4].from).getTime() + 3600000;
    Date.now = () => t;
    state.fixtures = [];
    render();
    const finals = finishedGwIdxs();
    return { finals, status4: gwStatus(4), star };
  })()`);
  chk('F precondition: 4 finished GWs and a live 5th', JSON.stringify(f1.finals) === '[0,1,2,3]' && f1.status4 === 'live', JSON.stringify(f1));
  const f2 = await p.evaluate(`(() => {
    document.querySelector('[data-tblmode="3"]')?.click?.();
    tableView.mode = 3; render();
    const idxs3 = finishedGwIdxs().slice(-3);
    const rows = [...document.querySelectorAll('[data-mgr-row]')];
    const top = +rows[0].dataset.mgrRow;
    const shown = +rows[0].querySelector('.act b').textContent;
    const manual = idxs3.reduce((t, i) => t + gwManagerPoints(top, i), 0);
    const gwsCol = rows[0].querySelectorAll('td')[2].textContent.trim();
    // live GW4 (idx 4) must be excluded: manually add its points and prove the shown number ignores them
    const withLive = manual + gwManagerPoints(top, 4);
    tableView.mode = 5; render();
    const rows5 = [...document.querySelectorAll('[data-mgr-row]')];
    const top5 = +rows5[0].dataset.mgrRow;
    const shown5 = +rows5[0].querySelector('.act b').textContent;
    const manual5 = finishedGwIdxs().slice(-5).reduce((t, i) => t + gwManagerPoints(top5, i), 0);
    const gws5 = rows5[0].querySelectorAll('td')[2].textContent.trim();
    return { top, shown, manual, withLive, gwsCol, shown5, manual5, gws5, count5: finishedGwIdxs().slice(-5).length };
  })()`);
  chk('F2: Last 3 sums exactly the latest three finished GWs', f2.shown === f2.manual && f2.gwsCol === '3', JSON.stringify(f2));
  chk('F4: the live gameweek is excluded (including it would change the number)',
    f2.withLive !== f2.manual && f2.shown === f2.manual, `${f2.manual} vs with-live ${f2.withLive}`);
  chk('F3: Last 5 with only 4 finished uses the 4 that exist, labelled honestly',
    f2.shown5 === f2.manual5 && f2.gws5 === '4' && f2.count5 === 4, JSON.stringify({ shown5: f2.shown5, manual5: f2.manual5, gws5: f2.gws5 }));

  /* F6: stable ties — equal windows fall back to overall, then constitution */
  const f6 = await p.evaluate(`(() => {
    const fs = formStandings(3);
    // managers with identical window+overall must appear in constitutional order
    const groups = {};
    fs.rows.forEach((r, i) => { const k = r.win + ':' + r.overall; (groups[k] = groups[k] || []).push({ id: r.id, pos: i }); });
    const constitution = state.managers.map(m => m.id);
    let stable = true, tiedGroupSize = 0;
    for (const k in groups) {
      const g = groups[k];
      if (g.length < 2) continue;
      tiedGroupSize = Math.max(tiedGroupSize, g.length);
      const consOrder = g.map(x => constitution.indexOf(x.id));
      for (let i = 1; i < consOrder.length; i++) if (consOrder[i] < consOrder[i - 1]) stable = false;
    }
    return { stable, tiedGroupSize };
  })()`);
  chk('F6: tied form rows (precondition: a tie group exists) keep constitutional order',
    f6.tiedGroupSize >= 2 && f6.stable, JSON.stringify(f6));

  /* F7: switching views mutates nothing official */
  const f7 = await p.evaluate(`(() => {
    const before = JSON.stringify({ t: state.transfers, l: state.lineups, h: h2hStandings(false).map(r => r.id), pts: state.managers.map(m => managerPoints(m.id)) });
    tableView.mode = 3; render();
    tableView.mode = 5; render();
    tableView.mode = 'overall'; render();
    const after = JSON.stringify({ t: state.transfers, l: state.lineups, h: h2hStandings(false).map(r => r.id), pts: state.managers.map(m => managerPoints(m.id)) });
    return before === after;
  })()`);
  chk('F7: toggling form views leaves official state untouched', f7 === true);

  /* F8/F9: expansion + pitch button still behave in a form view */
  const f8 = await p.evaluate(`(() => {
    tableView.mode = 3; render();
    const row = document.querySelector('[data-mgr-row]');
    const mid = +row.dataset.mgrRow;
    let rowFired = 0;
    const orig = row.onclick;
    row.onclick = e => { rowFired++; return orig.call(row, e); };
    row.querySelector('[data-pitchview]').click();
    const pitchNav = { view: state.view, teamMid: teamView.mid, rowFired };
    state.view = 'table'; render();
    const row2 = document.querySelector('[data-mgr-row]');
    row2.click();
    const bd = document.querySelector('#bd-' + row2.dataset.mgrRow);
    const expanded = bd && bd.style.display !== 'none';
    const bdHasMood = expanded && /Supporters|mood|DREAMLAND|optimism|concerned|Grumbling|confidence|PROTEST/i.test(bd.textContent) || /./.test(bd.textContent);
    const bdMood = expanded ? bd.textContent.slice(0, 60) : '';
    tableView.mode = 'overall';
    return { pitchNav, expanded, bdMood, mid };
  })()`);
  chk('F9: pitch button navigates from a form view without toggling the row',
    f8.pitchNav.view === 'team' && f8.pitchNav.teamMid === f8.mid && f8.pitchNav.rowFired === 0, JSON.stringify(f8.pitchNav));
  chk('F8: row expansion in a form view opens the breakdown with real content',
    f8.expanded && f8.bdMood.length > 10, f8.bdMood);

  /* F10: hostile club text stays literal in form mode */
  const f10 = await p.evaluate(`(() => {
    const m = state.managers[3];
    const old = m.team;
    m.team = '<img src=x onerror=window.__ftx=1>';
    tableView.mode = 3; state.view = 'table'; render();
    const row = document.querySelector('[data-mgr-row="' + m.id + '"]');
    const out = { literal: row.textContent.includes('<img src=x'), injected: !!row.querySelector('img'), xss: !!window.__ftx };
    m.team = old; tableView.mode = 'overall'; render();
    return out;
  })()`);
  chk('F10: hostile club name renders literally in the form table', f10.literal && !f10.injected && !f10.xss, JSON.stringify(f10));

  /* F11: 320px form toggles */
  const f320 = await newPage(ctx, 'http://localhost:8125?demo', { width: 320, height: 650 });
  const f11 = await f320.evaluate(() => {
    state.view = 'table'; render();
    document.querySelector('[data-tblmode="3"]').click();
    const btns = [...document.querySelectorAll('[data-tblmode]')];
    return { btns: btns.length, allVisible: btns.every(b => b.offsetParent !== null), scrollW: document.documentElement.scrollWidth, mode3: !!document.querySelector('[data-tblmode="3"]:not(.ghost)') };
  });
  chk('F11: 320px — three toggles visible, form view active, no horizontal overflow',
    f11.btns === 3 && f11.allVisible && f11.mode3 && f11.scrollW <= 320, JSON.stringify(f11));
  await f320.close();

  /* ═══════════════ NEXT SIX ═══════════════ */
  const x = await newPage(ctx, 'http://localhost:8125?demo');
  await x.evaluate(() => { window.__wc2 = []; window.WCSync = { call: (...a) => { window.__wc2.push(a); return Promise.resolve({}); } }; });
  const x1 = await x.evaluate(() => {
    state.view = 'team'; render();
    const n6 = document.getElementById('next6');
    if (!n6) return { fail: 'no next6' };
    const rows = [...n6.querySelectorAll('tbody tr')];
    const rowPids = rows.map(r => +r.querySelector('[data-pcard]').dataset.pcard).sort((a, b) => a - b);
    const squadPids = squadAt(teamView.mid, currentGwIndex()).map(p => p.id).sort((a, b) => a - b);
    const gwHeads = [...n6.querySelectorAll('thead th')].slice(1).map(t => t.textContent);
    // H/A truth for the first non-blank cell of row 0
    const p0 = PLAYER_BY_ID[+rows[0].querySelector('[data-pcard]').dataset.pcard];
    const gws = GAMEWEEKS.slice(currentGwIndex(), currentGwIndex() + 6);
    let haOk = null, checked = null;
    for (let c = 0; c < gws.length; c++) {
      const fx = teamFixturesInGw(p0.team, gws[c].n);
      if (!fx.length) continue;
      const cellTxt = rows[0].querySelectorAll('td')[c + 1].textContent;
      const wantHome = fx[0].home === p0.team;
      checked = { cellTxt, wantHome, opp: wantHome ? fx[0].away : fx[0].home };
      haOk = cellTxt.includes(wantHome ? '(H)' : '(A)') && cellTxt.includes(TEAM_BY_NAME[checked.opp]?.short || checked.opp);
      break;
    }
    return { rowsN: rows.length, squadN: squadPids.length, exact: JSON.stringify(rowPids) === JSON.stringify(squadPids), gwHeads, haOk, checked };
  });
  chk('X1: exactly the current squad, one row each', !x1.fail && x1.exact && x1.rowsN === x1.squadN && x1.rowsN === 14, JSON.stringify({ rowsN: x1.rowsN, exact: x1.exact }));
  chk('X2: six GW columns render', x1.gwHeads.length === 6 && x1.gwHeads.every(h => /^GW\d+$/.test(h)), JSON.stringify(x1.gwHeads));
  chk('X3: home/away read straight off the fixture (precondition: a fixture was found)', x1.checked !== null && x1.haOk === true, JSON.stringify(x1.checked));

  /* X4/X5: blank and double render distinctly */
  const x45 = await x.evaluate(() => {
    const n6row = document.querySelector('#next6 tbody tr');
    const p0 = PLAYER_BY_ID[+n6row.querySelector('[data-pcard]').dataset.pcard];
    const gws = GAMEWEEKS.slice(currentGwIndex(), currentGwIndex() + 6);
    const targetGw = gws[1].n;
    const stash = state.fixtures;
    // blank: remove the club's fixtures that GW
    state.fixtures = stash.filter(f => !(f.gw === targetGw && (f.home === p0.team || f.away === p0.team)));
    render();
    const blankCell = document.querySelector('#next6 tbody tr').querySelectorAll('td')[2];
    const blank = { txt: blankCell.textContent.trim(), cls: blankCell.className };
    // double: two fixtures that GW
    state.fixtures = [...stash, { gw: targetGw, home: p0.team, away: state.fixtures.find(f => f.gw === targetGw && f.home !== p0.team && f.away !== p0.team)?.home || 'Arsenal', started: false, finished: false, minutes: 0 }];
    render();
    const dblCell = document.querySelector('#next6 tbody tr').querySelectorAll('td')[2];
    const dbl = { chips: dblCell.querySelectorAll('.n6-fx').length, cls: dblCell.className };
    state.fixtures = stash; render();
    return { blank, dbl };
  });
  chk('X4: a blank renders the explicit dash cell', x45.blank.txt === '—' && /n6-blank/.test(x45.blank.cls), JSON.stringify(x45.blank));
  chk('X5: a double renders both fixtures in one cell', x45.dbl.chips === 2 && /n6-double/.test(x45.dbl.cls), JSON.stringify(x45.dbl));

  /* X6: tapping a name opens the player card */
  const x6 = await x.evaluate(() => {
    document.querySelector('#next6 [data-pcard]').click();
    const open = !!document.getElementById('pcardOverlay');
    document.getElementById('pcardOverlay')?.remove();
    return open;
  });
  chk('X6: player name in the grid opens the stats card', x6 === true);

  /* X7/X8: 320px — grid scrolls inside its container, document doesn't */
  const x320 = await newPage(ctx, 'http://localhost:8125?demo', { width: 320, height: 650 });
  const x78 = await x320.evaluate(() => {
    localStorage.removeItem(`${LS_NS}-next6-open`);
    state.view = 'team'; render();
    const n6 = document.getElementById('next6');
    const defaultClosed = !n6.open;
    n6.open = true;
    const wrap = n6.querySelector('[style*="overflow-x"]');
    const table = n6.querySelector('.n6-table');
    const stickyName = getComputedStyle(n6.querySelector('.n6-name')).position;
    return {
      defaultClosed,
      gridScrolls: wrap.scrollWidth > wrap.clientWidth && table.offsetWidth > 300,
      docW: document.documentElement.scrollWidth,
      stickyName,
    };
  });
  chk('X7: 320px — grid overflows its own container only, player name frozen',
    x78.gridScrolls && x78.docW <= 320 && x78.stickyName === 'sticky', JSON.stringify(x78));
  chk('X8: small screens default the section closed', x78.defaultClosed === true, '');
  await x320.close();

  /* X9: zero WCSync calls, zero non-photo external requests from Next Six */
  const x9 = await x.evaluate(() => window.__wc2.length);
  chk('X9: Next Six triggered zero WCSync calls', x9 === 0, `${x9}`);

  chk('N21: no uncaught page errors across all pages', allErrors.length === 0, allErrors.join(' | ').slice(0, 200));

  await browser.close();
  console.log(`\nmatchday.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
