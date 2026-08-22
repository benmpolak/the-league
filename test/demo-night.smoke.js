/* Demo-night regressions that were previously covered only by a scratchpad.
 * Run against any side-port server with TEST_BASE_URL=http://127.0.0.1:8135.
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

  const seeded = await page.evaluate(() => {
    window.__autoConfirm = true;
    syncNow = async () => {};
    const byPos = { GK: [], DF: [], MF: [], FW: [] };
    for (const p of PLAYERS) byPos[p.pos].push(p);
    for (const pos of Object.keys(byPos)) byPos[pos].sort((a, b) => rating(b) - rating(a));
    const need = { GK: 2, DF: 5, MF: 4, FW: 3 };
    if (byPos.GK.length < 24 || byPos.DF.length < 60 || byPos.MF.length < 48 || byPos.FW.length < 36) return 'feed too small';
    state.phase = 'season';
    state.draft.order = state.managers.map(m => m.id);
    state.draft.picks = [];
    state.lineups = {}; state.benchOrders = {}; state.transfers = []; state.trades = [];
    state.matchStats = {}; state.fixtures = []; state.claims = {}; state.hamCup = null;
    let n = 1;
    state.managers.forEach((m, k) => {
      for (const pos of Object.keys(need)) for (let j = 0; j < need[pos]; j++) {
        state.draft.picks.push({ managerId: m.id, playerId: byPos[pos][k * need[pos] + j].id, n: n++ });
      }
    });
    whoami = state.managers[0].id;
    demoMode = false;
    teamView = { mid: whoami, gw: 0, transferOut: null, pitchSel: null, showOpp: true };
    Date.now = () => new Date(GAMEWEEKS[0].from).getTime() - 3600000;
    state.view = 'team';
    render();
    return 'ok';
  });
  chk('season fixture seeds cleanly', seeded === 'ok', seeded);

  /* My Team: pre-deadline fixture chips, duel symmetry, nested tap surface. */
  const pre = await page.evaluate(() => {
    const ownXI = lineupFor(whoami, 0);
    const ownBench = benchFor(whoami, 0);
    const starter = ownXI.map(id => PLAYER_BY_ID[id]).find(p => ownBench.some(b => b.pos === p.pos));
    const bench = ownBench.find(p => p.pos === starter?.pos);
    const sides = [...document.querySelectorAll('.duel-side')];
    const benchCounts = sides.map(s => s.querySelectorAll('.bench-strip .pitch-chip').length);
    const orderTags = sides.map(s => [...s.querySelectorAll('.bench-strip .pitch-chip > .tag')].map(t => t.textContent.trim()));
    return {
      starter: starter?.id, bench: bench?.id, originalXI: ownXI,
      sides: sides.length,
      benchStrips: document.querySelectorAll('.duel-side .bench-strip').length,
      benchCounts, orderTags,
      ownFixtures: document.querySelectorAll('.duel-side:last-child [data-pitch] .pitch-vs').length,
      oppFixtures: document.querySelectorAll('.duel-side:first-child [data-pcard] .pitch-vs').length,
      pointBadges: document.querySelectorAll('.duel-grid .mu-pts').length,
      oppBenchCards: document.querySelectorAll('.duel-side:first-child .bench-strip [data-pcard]').length,
    };
  });
  chk('duel benches use the same strip/chip structure and 1–3 ordering',
    pre.sides === 2 && pre.benchStrips === 2 && pre.benchCounts.length === 2
      && pre.benchCounts[0] === pre.benchCounts[1] && pre.benchCounts[0] === 3
      && pre.orderTags.every(x => JSON.stringify(x) === JSON.stringify(['1', '2', '3'])), JSON.stringify(pre));
  // 14 per side since UAT night: the bench carries fixture chips too (Ben)
  chk('pre-deadline duel shows fixture chips everywhere (XI + bench) and no live bench points',
    pre.ownFixtures === 14 && pre.oppFixtures === 14 && pre.pointBadges === 0 && pre.oppBenchCards === 3, JSON.stringify(pre));
  chk('swap test found a same-position starter and substitute', !!pre.starter && !!pre.bench, JSON.stringify(pre));

  await page.click(`[data-pitch="${pre.starter}"] .pitch-vs`);
  chk('tap on the nested fixture span selects the pitch chip pre-deadline',
    await page.evaluate(id => teamView.pitchSel === id, pre.starter));
  await page.click(`[data-pitch="${pre.bench}"]`);
  const preSwap = await page.evaluate(({ starter, bench }) => ({
    xi: lineupFor(whoami, 0), selected: teamView.pitchSel,
    swapped: lineupFor(whoami, 0).includes(bench) && !lineupFor(whoami, 0).includes(starter),
  }), { starter: pre.starter, bench: pre.bench });
  chk('pre-deadline tap-to-swap still commits from the nested chip surface', preSwap.swapped && preSwap.selected == null, JSON.stringify(preSwap));

  /* Live points: the points span itself must bubble to selection/swap. Demo
   * mode deliberately permits live-GW lineup rehearsal; production remains locked. */
  const liveSetup = await page.evaluate(({ xi, starter, bench }) => {
    state.lineups[whoami] = { 0: xi };
    teamView.pitchSel = null;
    demoMode = true;
    Date.now = () => new Date(GAMEWEEKS[0].from).getTime() + 3600000;
    const ps = {};
    for (const p of squadAt(whoami, 0)) ps[p.id] = { min: 90, st: 1, g: p.id === starter ? 1 : 0 };
    const pair = pairingsFor(0).find(x => x.includes(whoami));
    const opp = pair[0] === whoami ? pair[1] : pair[0];
    for (const p of squadAt(opp, 0)) ps[p.id] = { min: 90, st: 1 };
    state.matchStats['gw' + GAMEWEEKS[0].n] = { final: false, playerStats: ps };
    render();
    return {
      ownXIpts: document.querySelectorAll('.duel-side:last-child [data-pitch] .pitch-vs').length,
      ownBenchPts: document.querySelectorAll('.duel-side:last-child .bench-strip [data-pitch] .mu-pts').length,
      oppXIpts: document.querySelectorAll('.duel-side:first-child [data-pcard] .pitch-vs').length,
      oppBenchPts: document.querySelectorAll('.duel-side:first-child .bench-strip [data-pcard] .mu-pts').length,
      starter, bench,
    };
  }, { xi: pre.originalXI, starter: pre.starter, bench: pre.bench });
  chk('live GW shows points on both XIs and both benches',
    liveSetup.ownXIpts === 11 && liveSetup.oppXIpts === 11 && liveSetup.ownBenchPts === 3 && liveSetup.oppBenchPts === 3,
    JSON.stringify(liveSetup));
  await page.click(`[data-pitch="${pre.starter}"] .pitch-vs`);
  chk('tap on the live points span selects the player', await page.evaluate(id => teamView.pitchSel === id, pre.starter));
  await page.click(`[data-pitch="${pre.bench}"] .mu-pts`);
  chk('live-GW demo swap commits when the second tap lands on its points span',
    await page.evaluate(({ starter, bench }) => lineupFor(whoami, 0).includes(bench) && !lineupFor(whoami, 0).includes(starter),
      { starter: pre.starter, bench: pre.bench }));

  const oppPid = await page.evaluate(() => +document.querySelector('.duel-side:first-child .pitch .pitch-vs').parentElement.dataset.pcard);
  await page.click(`.duel-side:first-child [data-pcard="${oppPid}"] .pitch-vs`);
  chk('opponent live-points tap still opens the player card', await page.evaluate(() => !!document.querySelector('#pcardOverlay')));
  await page.evaluate(() => document.querySelector('#pcardOverlay')?.remove());
  const locked = await page.evaluate(({ xi, starter }) => {
    state.lineups[whoami] = { 0: xi };
    teamView.pitchSel = null;
    demoMode = false;
    render();
    document.querySelector(`[data-pitch="${starter}"] .pitch-vs`).click();
    return { selected: teamView.pitchSel, toast: document.querySelector('#toast')?.textContent || '' };
  }, { xi: pre.originalXI, starter: pre.starter });
  chk('production live-GW points tap reaches the lock guard instead of becoming a dead tap',
    locked.selected == null && /locked/.test(locked.toast), JSON.stringify(locked));

  /* Awards, Data Room consolidation, Treatment Room filters. */
  const dataAudit = await page.evaluate(() => {
    Date.now = () => new Date(GAMEWEEKS[32].to).getTime() + 1000;
    state.matchStats = {};
    for (let i = 0; i < 33; i++) {
      state.matchStats['gw' + GAMEWEEKS[i].n] = { final: true, playerStats: { 999999: { min: 1 } } };
    }
    for (const p of PLAYERS) { p.status = 'a'; p.news = ''; p.chance = null; }
    const flagged = PLAYERS.slice(0, 12);
    flagged.forEach((p, i) => {
      p.status = i % 3 === 0 ? 'd' : i % 3 === 1 ? 's' : 'i';
      p.chance = p.status === 'd' ? 25 : null;
      p.news = p.status === 'i' ? 'Unknown return date' : p.status === 's' ? 'Suspended' : '75% chance of playing';
    });
    trmView = { pos: '', club: '', sev: '' }; trmShowAll = false;
    const weeklyKeys = Object.keys(weeklyAwards(0)).sort();
    // the charge must not move between renders, must name a real manager, and
    // must be reached on evidence rather than the draw in a season this busy
    const cotwA = weeklyAwards(0).cotw, cotwB = weeklyAwards(0).cotw;
    const cotwAll = [];
    for (let g = 0; g < REGULAR_GWS; g++) if (gwStatus(g) === 'final') cotwAll.push(weeklyAwards(g).cotw);
    const twoFinalState = { ...state.matchStats };
    state.matchStats = Object.fromEntries(Object.entries(state.matchStats).slice(0, 2));
    const two = seasonAwards();
    state.matchStats = twoFinalState;
    const full = seasonAwards();
    const minutes = committeeMinutes(0);
    state.view = 'data'; render();
    const dataText = document.querySelector('#main').innerText;
    const filterCount = document.querySelectorAll('[data-trmpos]').length;
    const showAll = document.querySelector('#trmMore')?.textContent || '';
    state.view = 'table'; render();
    const tableText = document.querySelector('#main').innerText;
    state.view = 'dash'; render();
    const around = [...document.querySelectorAll('#main .card')].find(c => c.querySelector('h2')?.textContent.includes('The Table'));
    // the dashboard table is a real pool-table now (Ben: DF-style W/D/L)
    const dashRows = around ? [...around.querySelectorAll('tbody tr')] : [];
    return {
      weeklyKeys, twoKeys: two && Object.keys(two).sort(), fullKeys: full && Object.keys(full).sort(),
      cotwStable: !!cotwA && cotwA.id === cotwB.id && cotwA.why === cotwB.why,
      cotwReal: cotwAll.length > 0 && cotwAll.every(c => c && state.managers.some(m => m.id === c.id) && !!c.why),
      cotwProven: cotwAll.filter(c => c && c.proven).length,
      cotwWeeks: cotwAll.length,
      noBenchTwo: two?.bench === null, noBenchFull: full?.bench === null,
      minutes,
      dataHasAll: ['The Committee\'s Awards', 'Trough Activity', 'The Season Ledger', 'The Treatment Room'].every(s => dataText.includes(s)),
      tableConsolidated: !tableText.includes('Trough Activity') && !tableText.includes('Top players'),
      dashTable: {
        rows: dashRows.length,
        eighth: dashRows[7]?.className || '',
        ownHighlighted: dashRows.some(r => (r.getAttribute('style') || '').includes('background')),
        fullButton: !!around?.querySelector('[data-goto="table"]'),
      },
      filterCount, showAll,
    };
  });
  const awardKeys = JSON.stringify(['bench', 'hi', 'hiding', 'jammy', 'lo', 'robbed']);
  // the weekly set carries the rebuilt six plus cotw, which is drawn not earned
  const weeklyKeys = JSON.stringify(['bench', 'cotw', 'hi', 'hiding', 'jammy', 'lo', 'robbed']);
  chk('weekly and season award calculators expose exactly the rebuilt six (weekly plus the draw) at 2 and 33 finals',
    JSON.stringify(dataAudit.weeklyKeys) === weeklyKeys && JSON.stringify(dataAudit.twoKeys) === awardKeys
      && JSON.stringify(dataAudit.fullKeys) === awardKeys && dataAudit.noBenchTwo && dataAudit.noBenchFull, JSON.stringify(dataAudit));
  // the charge sheet itself is covered in depth by cotw.smoke.js; here we only
  // assert it survives a whole settled season without drawing lots
  chk('C*** of the Week is charged on evidence: stable across calls, real manager, proven not drawn',
    dataAudit.cotwStable && dataAudit.cotwReal && dataAudit.cotwWeeks > 0
      && dataAudit.cotwProven === dataAudit.cotwWeeks,
    JSON.stringify({ stable: dataAudit.cotwStable, real: dataAudit.cotwReal, proven: dataAudit.cotwProven, weeks: dataAudit.cotwWeeks }));
  chk('Committee Minutes contains only the surviving award set',
    !/Handful|No-Footed/.test(dataAudit.minutes) && /Manager of the Week|Wooden Spoon/.test(dataAudit.minutes)
      && /C\*\*\* of the Week/.test(dataAudit.minutes));
  chk('Data Room owns awards, team/player data and treatment; Table no longer duplicates moved cards',
    dataAudit.dataHasAll && dataAudit.tableConsolidated && dataAudit.dashTable.rows === 12
      && dataAudit.dashTable.eighth.includes('playoff-line') && dataAudit.dashTable.ownHighlighted && dataAudit.dashTable.fullButton
      && dataAudit.filterCount === 5 && /Show all 12/.test(dataAudit.showAll), JSON.stringify(dataAudit));

  await page.evaluate(() => {
    // Earlier player-card probe removed its test overlay directly; clear the
    // corresponding harness depth before exercising real tab history.
    ovDepth = 0; ovSkipClose = false;
    window.__demoNightCopied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__demoNightCopied = t; return Promise.resolve(); } } });
    state.view = 'data'; render();
  });
  await page.click('#copyMinutes');
  await page.waitForFunction(() => window.__demoNightCopied.length > 40);
  const dataNav = await page.evaluate(() => ({
    copied: window.__demoNightCopied,
    hash: location.hash,
    moreActive: document.querySelector('.nav-more')?.classList.contains('active'),
  }));
  chk('Data Room deep-link/nav state is active and Copy Minutes writes the real recap',
    dataNav.hash === '#data' && dataNav.moreActive && /COMMITTEE MINUTES/.test(dataNav.copied), JSON.stringify(dataNav));
  await page.evaluate(() => { state.view = 'table'; render(); });
  await page.goBack();
  await page.waitForFunction(() => state.view === 'data');
  await page.goForward();
  await page.waitForFunction(() => state.view === 'table');
  chk('browser back/forward walks Table ↔ Data Room',
    await page.evaluate(() => state.view === 'table' && location.hash === '#table'));

  const filterAudit = await page.evaluate(() => {
    state.view = 'data'; trmView = { pos: '', club: '', sev: '' }; trmShowAll = false; render();
    const target = PLAYERS.find(p => p.status !== 'a');
    trmView.pos = target.pos; trmView.club = target.club; trmView.sev = treatmentBand(target).k === 'major-doubt' ? 'doubt' : treatmentBand(target).k;
    if (trmView.sev === 'unknown') trmView.sev = 'long';
    render();
    const rows = [...document.querySelectorAll('.treatment-row')];
    const matched = rows.length > 0 && rows.every(r => r.textContent.includes(target.club));
    trmView = { pos: 'FW', club: '__no_such_club__', sev: 'suspended' }; render();
    const empty = document.querySelector('#main').innerText;
    return { matched, rows: rows.length, empty: /Nobody matches those filters/.test(empty) };
  });
  chk('Treatment Room combines position/club/severity filters and distinguishes an empty filter',
    filterAudit.matched && filterAudit.rows > 0 && filterAudit.empty, JSON.stringify(filterAudit));

  const hamLocal = await page.evaluate(() => {
    demoMode = false; whoami = state.managers[0].id;
    Date.now = () => new Date(GAMEWEEKS[0].from).getTime() - 3600000;
    state.matchStats = {};
    const gw = 20;
    state.hamCup = { gw, drawnAt: Date.now(), openedAt: Date.now(), entries: {} };
    state.view = 'cup'; render();
    const once = [...state.hamCup.frozen];
    render();
    const twice = [...state.hamCup.frozen];
    const localOpen = /window is open and the Trough is frozen/.test(document.querySelector('#main').innerText);
    const filters = {
      pos: document.querySelectorAll('[data-hampos]').length,
      clubs: document.querySelector('#hamClub')?.options.length || 0,
      allActive: document.querySelector('[data-hampos=""]')?.classList.contains('active') || false,
    };
    const xi = PLAYERS.filter(p => !new Set(once).has(p.id)).slice(0, 11).map(p => p.id);
    state.hamCup = { gw, drawnAt: Date.now() + 86400000, entries: { [whoami]: xi } };
    render();
    const healedOpen = /window is open and the Trough is frozen/.test(document.querySelector('#main').innerText);
    return { localOpen, stable: JSON.stringify(once) === JSON.stringify(twice), frozen: once.length, healedOpen, filters };
  });
  chk('local Ham render freezes once without a loop',
    hamLocal.localOpen && hamLocal.stable && hamLocal.frozen === 168, JSON.stringify(hamLocal));
  chk('Ham existing-XI clock healing and position/club picker controls render',
    hamLocal.healedOpen && hamLocal.filters.pos === 5 && hamLocal.filters.clubs > 1 && hamLocal.filters.allActive, JSON.stringify(hamLocal));

  const demoPage = await browser.newPage();
  await demoPage.goto(baseUrl + '?demo', { waitUntil: 'networkidle2' });
  const hamDemo = await demoPage.evaluate(() => {
    state.view = 'cup'; render();
    const text = document.querySelector('#main').innerText;
    return { gw: state.hamCup?.gw, entries: Object.keys(state.hamCup?.entries || {}).length, open: /window is open and the Trough is frozen/.test(text) };
  });
  await demoPage.close();
  chk('pre-seeded demo Ham entries heal the demo window open', hamDemo.entries > 0 && hamDemo.open, JSON.stringify(hamDemo));

  const netPage = await browser.newPage();
  await netPage.setRequestInterception(true);
  netPage.on('request', req => req.url().endsWith('/js/sync.js') ? req.abort() : req.continue());
  await netPage.goto(baseUrl + '/index.html?online-ham-probe', { waitUntil: 'domcontentloaded' });
  await netPage.waitForFunction(() => typeof state !== 'undefined');
  const hamNetwork = await netPage.evaluate(() => {
    state.phase = 'season';
    Date.now = () => new Date(GAMEWEEKS[0].from).getTime() - 3600000;
    state.hamCup = { gw: 20, drawnAt: Date.now(), openedAt: Date.now(), entries: {} };
    state.view = 'cup'; render();
    return { onlineIntent: netOn(), frozen: state.hamCup.frozen };
  });
  await netPage.close();
  chk('network-intent Ham render does not perform the local freeze', hamNetwork.onlineIntent && hamNetwork.frozen == null, JSON.stringify(hamNetwork));

  const scoringRules = await page.evaluate(() => {
    state.settings.scoring.per3Saves = 0;
    state.settings.scoring.yellow = -1;
    state.view = 'rules'; render();
    const text = document.querySelector('#main').innerText;
    return { savesHidden: !text.includes('Every 3 saves'), negativeVisible: text.includes('Yellow card') && text.includes('-1') };
  });
  chk('Rules hides the retired zero-value saves row but keeps negative scoring rules',
    scoringRules.savesHidden && scoringRules.negativeVisible, JSON.stringify(scoringRules));

  const smallFixes = await page.evaluate(() => {
    const longKit = kitSvgRaw({ pattern: 'plain', c1: '#111111', c2: '#ffffff' }, 'ABCDEFGHIJKLMN', 18, 'long-test');
    const shortKit = kitSvgRaw({ pattern: 'plain', c1: '#111111', c2: '#ffffff' }, 'ABC', 18, 'short-test');
    state.view = 'draft'; render();
    const draftCopy = document.querySelector('#main h2')?.textContent || '';
    state.view = 'settings'; render();
    const settingsText = document.querySelector('#main').innerText;
    clubEditor(whoami);
    const boards = [...document.querySelectorAll('[data-board]')];
    boards[0]?.click();
    const boardActiveVisible = boards[0]?.classList.contains('active')
      && getComputedStyle(boards[0]).backgroundColor !== getComputedStyle(boards[1]).backgroundColor;
    const clubOv = document.querySelector('.overlay');
    if (clubOv) closeOv(clubOv);
    return {
      navCopy: NAV_ITEMS.find(x => x[0] === 'draft')?.[1],
      draftCopy,
      boardCount: AD_BOARDS.length,
      kendals: AD_BOARDS.filter(x => x.t === 'KENDALS').length,
      interlink: AD_BOARDS.some(x => x.t === 'INTERLINK RECRUITMENT'),
      longCompressed: /textLength="17"/.test(longKit) && /lengthAdjust="spacingAndGlyphs"/.test(longKit),
      shortStroke: +(shortKit.match(/stroke-width="([\d.]+)" paint-order/) || [])[1],
      savesEditable: settingsText.includes('Every 3 saves'),
      boardActiveVisible,
    };
  });
  chk('smaller fixes retain Draft Console copy, 27-board parity and the in-place KENDALS swap',
    smallFixes.navCopy === 'The Draft Console' && /The Draft Console/.test(smallFixes.draftCopy)
      && smallFixes.boardCount === 27 && smallFixes.kendals === 1 && !smallFixes.interlink && smallFixes.boardActiveVisible,
    JSON.stringify(smallFixes));
  chk('long sponsor markup compresses to the chest, short sponsor keeps a visible stroke, saves remains editable',
    smallFixes.longCompressed && smallFixes.shortStroke >= 1 && smallFixes.savesEditable, JSON.stringify(smallFixes));

  /* Lobus: declarations are gone — the klaxon fires off LOBUS_LIST (goal
     only), names the owner, and the tape render escapes hostile team names. */
  const klaxon = await page.evaluate(() => {
    state.phase = 'season';
    const lob = PLAYERS.find(x => x.pos === 'FW' && LOBUS_LIST.some(l => normName(x.name).includes(l)));
    const civilian = PLAYERS.find(x => x.pos === 'FW' && !LOBUS_LIST.some(l => normName(x.name).includes(l)));
    // put the lobus in manager 1's squad so the owner path renders (and can be XSS-probed)
    state.transfers.push({ gw: 0, managerId: 1, inId: lob.id, type: 'test' });
    state.managers[0].team = '<img data-klaxon-xss src=x>';
    vidiFeed = [];
    vidiDiff(0, { [lob.id]: { min: 90, st: 1, g: 0, a: 0 } }, { [lob.id]: { min: 90, st: 1, g: 1, a: 0 } });
    const goalLines = vidiFeed.filter(x => x.txt.includes('LOBUS KLAXON')).length;
    vidiDiff(0, { [lob.id]: { min: 90, st: 1, g: 1, a: 0 } }, { [lob.id]: { min: 90, st: 1, g: 1, a: 1 } });
    const afterAssist = vidiFeed.filter(x => x.txt.includes('LOBUS KLAXON')).length;
    vidiDiff(0, { [civilian.id]: { min: 90, st: 1, g: 0, a: 0 } }, { [civilian.id]: { min: 90, st: 1, g: 1, a: 0 } });
    const afterCivilian = vidiFeed.filter(x => x.txt.includes('LOBUS KLAXON')).length;
    state.view = 'dash'; render();
    state.transfers.pop();
    return { goalLines, afterAssist, afterCivilian, injected: !!document.querySelector('[data-klaxon-xss]') };
  });
  chk('LOBUS_LIST goal emits one klaxon, assist and civilian goals emit none, tape render escapes team names',
    klaxon.goalLines === 1 && klaxon.afterAssist === 1 && klaxon.afterCivilian === 1 && !klaxon.injected, JSON.stringify(klaxon));

  /* QF formula: winner maths, playoff card, provisional H2H column, Rules. */
  const qf = await page.evaluate(() => {
    window.__demoNightOrig = { standingsBefore, gwStatus, gwManagerPoints, h2hStandings };
    const ids = state.managers.map(m => m.id);
    const pts = [40, 30, 20, 10, 10, 9, 8, 0, 0, 0, 0, 0];
    // pts doubles as h2h: h2hStandings rows carry table Points in .pts, while
    // standingsBefore rows carry them in .h2h — the bracket reads .h2h
    const rows = ids.map((id, i) => ({ ...state.managers[i], id, pts: pts[i], h2h: pts[i], p: 33, w: 0, d: 0, l: 0, pf: 0, pa: 0 }));
    standingsBefore = () => ({ rows, anyFinal: true });
    h2hStandings = () => rows;
    let qfFinal = false;
    gwStatus = i => i < 33 ? 'final' : i === 33 && qfFinal ? 'final' : 'upcoming';
    const raw = {};
    ids.forEach(id => { raw[id] = 0; });
    raw[ids[4]] = 10; raw[ids[5]] = 10; raw[ids[6]] = 10; raw[ids[7]] = 10;
    gwManagerPoints = (id, i) => i === 33 ? raw[id] : 0;
    const pre = playoffState();
    const card = playoffCard();
    // Marc, 9 Aug: the QF column is retired from the League Table — the bracket
    // moved onto that page and carries the handicaps, so the column was saying
    // it twice. The handicap maths is still asserted via playoffState and the
    // card badges below; only the duplicated column rendering goes.
    tableView.mode = 'overall';
    state.view = 'table'; render();
    qfFinal = true;
    const settled = playoffState();
    state.view = 'rules'; render();
    const rules = document.querySelector('#main').innerText;
    standingsBefore = window.__demoNightOrig.standingsBefore;
    gwStatus = window.__demoNightOrig.gwStatus;
    gwManagerPoints = window.__demoNightOrig.gwManagerPoints;
    h2hStandings = window.__demoNightOrig.h2hStandings;
    return {
      handicaps: pre.handicaps,
      cardBadges: ['+40', '+22', '+11'].every(x => card.includes(x)) && !card.includes('starts +0'),
      winners: settled.qfWinners,
      expectedWinners: [ids[0], ids[1], ids[2], ids[4]],
      rules: /full table-Points gap/.test(rules) && !/capped/.test(rules),
    };
  });
  chk('QF handicap is [40,22,11,0] (full Points gap) in playoffState and the playoff card',
    JSON.stringify(qf.handicaps) === JSON.stringify([40, 22, 11, 0]) && qf.cardBadges, JSON.stringify(qf));
  chk('QF winner maths applies the same handicap and Rules states the same formula',
    JSON.stringify(qf.winners) === JSON.stringify(qf.expectedWinners) && qf.rules, JSON.stringify(qf));

  /* 320/390: every moved surface stays inside the viewport; relocated data
   * tables may scroll inside their wrapper but must not widen the page. */
  const responsive = [];
  for (const width of [320, 390]) {
    await page.setViewport({ width, height: 760 });
    responsive.push(await page.evaluate(width => {
      demoMode = true; whoami = state.managers[0].id;
      Date.now = () => new Date(GAMEWEEKS[0].from).getTime() + 3600000;
      const results = {};
      const measure = view => {
        state.view = view; render();
        results[view] = document.documentElement.scrollWidth <= window.innerWidth;
      };
      localStorage.removeItem(A2HS_KEY);
      measure('dash');
      const x = document.querySelector('#a2hsX')?.getBoundingClientRect();
      const h = document.querySelector('#a2hsX')?.parentElement.querySelector('h2')?.getBoundingClientRect();
      results.installNoOverlap = !x || !h || x.left >= h.right || x.bottom <= h.top || x.top >= h.bottom;
      trmView = { pos: '', club: '', sev: '' }; measure('data');
      teamView.mid = whoami; teamView.gw = 0; teamView.showOpp = true; measure('team');
      state.fixtures = [{ gw: GAMEWEEKS[0].n, date: GAMEWEEKS[0].from, home: TEAMS[0].name, away: TEAMS[1].name, started: true, finished: true, hs: 2, as: 1, minutes: 90 }];
      fxView.gw = GAMEWEEKS[0].n; measure('fixtures');
      const yt = document.querySelector('.fx-yt')?.getBoundingClientRect();
      const fx = document.querySelector('.fx')?.getBoundingClientRect();
      results.highlightsInside = !!yt && !!fx && yt.left >= fx.left - 1 && yt.right <= fx.right + 1;
      const ytLink = document.querySelector('.fx-yt');
      // straight to Sky Sports Football's channel search (Ben, GW1 night —
      // "directly to the sky sports football youtube highlights")
      results.highlightsLink = ytLink?.target === '_blank' && ytLink?.rel === 'noopener'
        && ytLink.href.includes('@SkySportsFootball/search');
      state.hamCup = { gw: 20, drawnAt: Date.now(), openedAt: Date.now(), frozen: [...ownedIdsAt(currentGwIndex())], entries: {} };
      hamView = { q: '', sel: null, pos: '', club: '' }; measure('cup');
      results.width = width;
      return results;
    }, width));
  }
  chk('320/390 core moved surfaces do not widen the page',
    responsive.every(r => ['dash', 'data', 'team', 'cup'].every(k => r[k])),
    JSON.stringify(responsive));
  chk('320/390 finished-fixture cards and their Highlights strip stay inside the page',
    responsive.every(r => r.fixtures && r.highlightsInside && r.highlightsLink),
    JSON.stringify(responsive));
  chk('320/390 install dismiss button does not overlap its heading',
    responsive.every(r => r.installNoOverlap),
    JSON.stringify(responsive));

  chk('no uncaught browser errors', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  console.log(`\n[demo-night] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(async e => {
  console.error(e);
  process.exit(1);
});
