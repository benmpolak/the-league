/* R3 UI regression + smoke, in a real browser.
 *
 * Regression (sol R3 P2): the Show Opponent duel renders opponent LEFT and
 * yourself RIGHT, so the Opta bar must be called with (oppMid, mid) — calling
 * it with (pair[0], pair[1]) reversed the percentages and projected points
 * for every manager who happened to be pair[0].
 *
 * Smokes for previously untested R3 wiring: demo "Run waivers now" stays on
 * the local engine and never touches WCSync; a stale saved `price` column
 * preference cannot resurrect the retired price column; the table's pitch
 * button navigates without toggling the breakdown row; 320px has no
 * horizontal overflow and hides the third hoarding; unknown/null nationality
 * renders no flag; the club-office backdrop and Cancel are both inert while
 * a save is in flight.
 *
 * Usage: python3 -m http.server 8125 &   node test/r3ui.smoke.js */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });

  /* ================= page A: ?nosync, seeded season ================= */
  const p = await browser.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(baseUrl + '?nosync', { waitUntil: 'networkidle2' });
  await p.waitForFunction(() => typeof state !== 'undefined');

  // hermetic season: frozen clock before GW1, 12 seeded 14-man squads with a
  // steep quality gradient (manager 1 strongest, 12 weakest) so a reversed
  // bar produces visibly wrong numbers rather than a coin-flip coincidence
  const seeded = await p.evaluate(() => {
    window.__autoConfirm = true;
    syncNow = async () => {};
    const t0 = new Date(GAMEWEEKS[0].from).getTime() - 7 * 86400000;
    Date.now = () => t0;
    state.matchStats = {};
    state.fixtures = [];
    for (const g of GAMEWEEKS) g.finished = false;
    PLAYERS.forEach((pl, i) => { pl.xp = Math.max(0.5, 12 - i * 0.02); });
    const byPos = { GK: [], DF: [], MF: [], FW: [] };
    for (const pl of PLAYERS) byPos[pl.pos]?.push(pl);
    for (const k in byPos) byPos[k].sort((a, b) => b.xp - a.xp);
    const NEED = { GK: 2, DF: 5, MF: 4, FW: 3 };
    if (byPos.GK.length < 24 || byPos.DF.length < 60 || byPos.MF.length < 48 || byPos.FW.length < 36) return 'not enough players in the feed';
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
    save();
    return 'ok';
  });
  chk('season seeds cleanly', seeded === 'ok', seeded);

  // pull the rendered duel numbers: [leftHeadProj, rightHeadProj] from the
  // duel headings, [leftBarProj, rightBarProj, leftPct, rightPct, barWidth]
  // from the Opta bar
  const duelNums = () => p.evaluate(() => {
    const num = s => +String(s).replace(/[^0-9.-]/g, '');
    const heads = [...document.querySelectorAll('.duel-side h3 b')].map(b => num(b.textContent));
    const sub = document.querySelector('.prob-wrap .prob-sub');
    const row = document.querySelector('.prob-wrap .prob-row');
    const projs = sub ? [num(sub.children[0].textContent), num(sub.children[2].textContent)] : [];
    const pcts = row ? [...row.querySelectorAll('b')].map(b => num(b.textContent)) : [];
    const width = document.querySelector('.prob-bar span')?.style.width || '';
    return { heads, projs, pcts, width };
  });

  /* 1 — manager who is pair[0]: duel columns and bar agree left/right */
  await p.evaluate(() => {
    teamView.mid = state.draft.order[0]; teamView.gw = 0; teamView.showOpp = true;
    state.view = 'team'; render();
  });
  let d = await duelNums();
  chk('pair[0] manager: duel renders (headings + bar present)',
    d.heads.length === 2 && d.projs.length === 2 && d.pcts.length === 2, JSON.stringify(d));
  chk('pair[0] manager: seeded projections actually differ (test is not vacuous)',
    d.heads[0] !== d.heads[1], JSON.stringify(d.heads));
  chk('pair[0] manager: LEFT duel heading proj equals LEFT bar proj',
    d.heads[0] === d.projs[0], `heading ${d.heads[0]} vs bar ${d.projs[0]}`);
  chk('pair[0] manager: RIGHT duel heading proj equals RIGHT bar proj',
    d.heads[1] === d.projs[1], `heading ${d.heads[1]} vs bar ${d.projs[1]}`);
  chk('percentages sum to 100', d.pcts[0] + d.pcts[1] === 100, JSON.stringify(d.pcts));
  chk('bar width equals the left percentage', d.width === `${d.pcts[0]}%`, `${d.width} vs ${d.pcts[0]}%`);

  /* 2 — manager who is pair[1]: same agreement */
  await p.evaluate(() => {
    const pair = pairingsFor(0)[0];
    teamView.mid = pair[1]; teamView.gw = 0; teamView.showOpp = true; render();
  });
  d = await duelNums();
  chk('pair[1] manager: LEFT duel heading proj equals LEFT bar proj',
    d.heads.length === 2 && d.heads[0] === d.projs[0], JSON.stringify(d));
  chk('pair[1] manager: RIGHT duel heading proj equals RIGHT bar proj',
    d.heads[1] === d.projs[1], `heading ${d.heads[1]} vs bar ${d.projs[1]}`);

  /* 3 — a GW with no pairing (playoffs): no duel, no bar, structure intact */
  await p.evaluate(() => { teamView.gw = 33; teamView.showOpp = true; render(); });
  const noPair = await p.evaluate(() => ({
    duel: !!document.querySelector('.duel-grid'),
    bar: !!document.querySelector('.prob-wrap'),
    btn: !!document.querySelector('#showOpp'),
    pitch: !!document.querySelector('.pitch'),
    controls: !!document.querySelector('#teamMgr'),
  }));
  chk('no-pairing GW: no duel, no probability bar, no Show-opponent button',
    !noPair.duel && !noPair.bar && !noPair.btn, JSON.stringify(noPair));
  chk('no-pairing GW: page structure stays valid (pitch + controls render)',
    noPair.pitch && noPair.controls, JSON.stringify(noPair));

  /* 4 — an empty XI produces no NaN/Infinity anywhere */
  const nanChk = await p.evaluate(() => {
    const strip = state.draft.order[state.draft.order.length - 1]; // pair[0]'s opponent in round 0
    const stash = state.draft.picks;
    state.draft.picks = stash.filter(pk => pk.managerId !== strip);
    teamView.mid = state.draft.order[0]; teamView.gw = 0; teamView.showOpp = true; render();
    const opp = document.querySelector('main').innerText;
    const oppDuel = !!document.querySelector('.duel-grid'), oppBar = !!document.querySelector('.prob-wrap');
    teamView.mid = strip; render();
    const own = document.querySelector('main').innerText;
    const ownDuel = !!document.querySelector('.duel-grid'), ownBar = !!document.querySelector('.prob-wrap');
    state.draft.picks = stash;
    teamView.showOpp = false; render();
    return { opp, own, oppDuel, oppBar, ownDuel, ownBar };
  });
  // the duel must still RENDER against an empty XI — a vanished duel would
  // pass a bare NaN grep while hiding the regression it exists to catch
  chk('empty opponent XI: duel + bar still render',
    nanChk.oppDuel && nanChk.oppBar, JSON.stringify(nanChk));
  chk('empty opponent XI: no NaN/Infinity in the duel or bar',
    !/NaN|Infinity/.test(nanChk.opp), (nanChk.opp.match(/.{0,30}(NaN|Infinity).{0,30}/) || [''])[0]);
  chk('own empty XI: duel + bar still render',
    nanChk.ownDuel && nanChk.ownBar, JSON.stringify(nanChk));
  chk('own empty XI: no NaN/Infinity on the team page',
    !/NaN|Infinity/.test(nanChk.own), (nanChk.own.match(/.{0,30}(NaN|Infinity).{0,30}/) || [''])[0]);

  /* 4b — dashboard + matchup-modal bar orientation (sol r4: previously only
   * the duel was pinned). Both surfaces render pair[0]/a LEFT, so the bar's
   * left projection must equal teamOutlook(pair[0]).exp — and the seeded
   * gradient guarantees the two sides differ, so a reversal cannot hide. */
  const dashChk = await p.evaluate(() => {
    const pair = pairingsFor(0)[0];
    whoami = pair[1]; // viewer sits at pair[1]; the card must still show pair[0] left
    state.view = 'dash'; render();
    const wrap = document.querySelector('.prob-wrap');
    const projs = wrap ? [...wrap.querySelectorAll('.prob-sub span:not(.prob-mid)')]
      .map(s => s.textContent).filter(t => /proj/.test(t)).map(t => +t.replace(/\D/g, '')) : [];
    const leftName = document.querySelector('.h2h-fx span b')?.textContent || '';
    whoami = null;
    return {
      projs,
      leftName,
      exp0: Math.round(teamOutlook(pair[0], 0).exp),
      exp1: Math.round(teamOutlook(pair[1], 0).exp),
      name0: teamName(pair[0]),
    };
  });
  chk('dashboard matchup: sides differ (orientation check is non-vacuous)',
    dashChk.exp0 !== dashChk.exp1, JSON.stringify(dashChk));
  chk('dashboard matchup: pair[0] named LEFT and bar left proj is pair[0]\'s',
    dashChk.leftName.includes(dashChk.name0) && dashChk.projs.length === 2
      && dashChk.projs[0] === dashChk.exp0 && dashChk.projs[1] === dashChk.exp1,
    JSON.stringify(dashChk));
  const muChk = await p.evaluate(() => {
    const pair = pairingsFor(0)[0];
    showMatchup(pair[0], pair[1], 0);
    const ov = document.querySelector('#muOverlay');
    const wrap = ov.querySelector('.prob-wrap');
    const projs = [...wrap.querySelectorAll('.prob-sub span:not(.prob-mid)')]
      .map(s => s.textContent).filter(t => /proj/.test(t)).map(t => +t.replace(/\D/g, ''));
    const leftHead = ov.querySelector('.mu-side h3')?.textContent || '';
    const fill = wrap.querySelector('.prob-bar span')?.style.width;
    const scoreline = ov.querySelector('.mu-scoreline');
    const scoreNums = (scoreline?.querySelector('.fx-score')?.textContent.match(/\d+/g) || []).map(Number);
    const scoreText = scoreline?.textContent || '';
    ov.remove();
    return {
      projs, leftHead, fill, scoreNums, scoreText,
      exp0: Math.round(teamOutlook(pair[0], 0).exp),
      exp1: Math.round(teamOutlook(pair[1], 0).exp),
      proj0: projectedGwScore(pair[0], 0),
      proj1: projectedGwScore(pair[1], 0),
      pct0: Math.round(liveWinProb(pair[0], pair[1], 0) * 100),
      name0: teamName(pair[0]),
      name1: teamName(pair[1]),
    };
  });
  chk('matchup modal: scoreboard at the top names both teams, a-side left',
    muChk.scoreText.indexOf(muChk.name0) !== -1 && muChk.scoreText.indexOf(muChk.name1) !== -1
      && muChk.scoreText.indexOf(muChk.name0) < muChk.scoreText.indexOf(muChk.name1),
    muChk.scoreText.slice(0, 80));
  chk('matchup modal: scoreboard numbers match the side projections, a first',
    muChk.scoreNums.length === 2 && muChk.scoreNums[0] === muChk.proj0 && muChk.scoreNums[1] === muChk.proj1,
    JSON.stringify({ scoreNums: muChk.scoreNums, proj0: muChk.proj0, proj1: muChk.proj1 }));
  chk('matchup modal: a-side named LEFT and bar left proj is a\'s',
    muChk.leftHead.includes(muChk.name0) && muChk.projs.length === 2
      && muChk.projs[0] === muChk.exp0 && muChk.projs[1] === muChk.exp1,
    JSON.stringify(muChk));
  chk('matchup modal: bar fill width equals the LEFT side\'s win chance',
    muChk.fill === `${muChk.pct0}%`, `${muChk.fill} vs ${muChk.pct0}%`);

  /* 4c — player card starts on the CURRENT photo library with the fallback
   * chain armed (sol r4 P2: it hardcoded the legacy URL with no data-code,
   * so missing-from-legacy players jumped straight to the silhouette) */
  const pcardChk = await p.evaluate(() => {
    const pl = PLAYERS.find(x => x.code);
    showPlayerCard(pl.id);
    const img = document.querySelector('#pcardOverlay .pcard-photo');
    const out = {
      src: img?.src || '',
      code: img?.dataset.code,
      fbk: img?.dataset.fbk,
      want: String(pl.code),
    };
    document.querySelector('#pcardOverlay')?.remove();
    return out;
  });
  chk('player card photo starts on the current library (premierleague25, no p-prefix)',
    /premierleague25\/photos\/players/.test(pcardChk.src) && pcardChk.src.includes(`/${pcardChk.want}.png`),
    pcardChk.src);
  chk('player card photo carries data-code so the fallback chain can fire',
    pcardChk.code === pcardChk.want && !pcardChk.fbk, JSON.stringify(pcardChk));

  /* 5 — a stale saved `price` column preference cannot resurrect the column */
  const priceChk = await p.evaluate(() => {
    localStorage.setItem(COL_PREFS_KEY, JSON.stringify(['vs', 'price', 'ppg', 'pts']));
    _colPrefs = undefined; // force a re-read of the stale preference
    state.view = 'transfers'; transfersView.tab = 'trough'; render();
    const heads = [...document.querySelectorAll('#trResults thead th')].map(th => th.textContent.trim());
    const keys = ALL_STAT_COLS(false).map(c => c.k).concat(ALL_STAT_COLS(true).map(c => c.k));
    localStorage.removeItem(COL_PREFS_KEY); _colPrefs = undefined;
    return { heads, hasPriceKey: keys.includes('price') };
  });
  chk('price column is gone from the catalogue', !priceChk.hasPriceKey);
  chk('stale price preference: no £m/price header, surviving columns intact',
    priceChk.heads.length > 0 && !priceChk.heads.some(h => /£|price/i.test(h))
      && priceChk.heads.some(h => /^PPG/.test(h)) && priceChk.heads.some(h => /^Pts/.test(h)),
    JSON.stringify(priceChk.heads));

  /* 6 — unknown/null nationality renders no flag */
  const natChk = await p.evaluate(() => {
    const fn = {
      nullNat: natFlag({ nat: null }),
      unknownNat: natFlag({ nat: 99999 }),
      knownNat: natFlag({ nat: 200 }),
    };
    // DOM: null out a RENDERED free agent's nationality and re-render. The
    // Trough is forced open for the probe — mid-gameweek the shutter is down
    // and the table empties, which is the app being right, not the flag code
    // (this check went red the morning GW1 kicked off, 22 Aug).
    const keepCtl = state.waiverMeta?.control;
    state.waiverMeta = { ...(state.waiverMeta || {}), control: 'open' };
    render();
    let top = null, cell = null;
    for (const el of document.querySelectorAll('#trResults .pname')) {
      const pl = PLAYERS.find(x => x.name && el.textContent.includes(x.name));
      if (pl) { top = pl; cell = el; break; }
    }
    let domFlag = null;
    if (top) {
      const keep = top.nat;
      top.nat = null;
      render();
      cell = [...document.querySelectorAll('#trResults .pname')].find(el => el.textContent.includes(top.name));
      domFlag = cell ? !!cell.querySelector('.nat-flag') : null;
      top.nat = keep;
    }
    state.waiverMeta = { ...(state.waiverMeta || {}), control: keepCtl };
    render();
    return { ...fn, domFlag, found: !!cell };
  });
  chk('natFlag: null and unknown ids render nothing, known id renders a flag',
    natChk.nullNat === '' && natChk.unknownNat === '' && natChk.knownNat !== '', JSON.stringify(natChk));
  chk('null-nat player row carries no flag span', natChk.found && natChk.domFlag === false, JSON.stringify(natChk));

  /* 7 — table pitch button navigates without toggling the breakdown row */
  const pitchBtn = await p.evaluate(() => {
    state.view = 'table'; render();
    const row = document.querySelector('[data-mgr-row]');
    const mid = +row.dataset.mgrRow;
    const orig = row.onclick;
    let rowFired = 0;
    row.onclick = e => { rowFired++; return orig.call(row, e); };
    row.querySelector('[data-pitchview]').click();
    return { rowFired, view: state.view, mid, teamMid: teamView.mid };
  });
  chk('pitch button navigates to that team\'s pitch', pitchBtn.view === 'team' && pitchBtn.teamMid === pitchBtn.mid, JSON.stringify(pitchBtn));
  chk('pitch button does NOT fire the breakdown row toggle', pitchBtn.rowFired === 0, `row handler fired ${pitchBtn.rowFired}x`);
  const rowTap = await p.evaluate(() => {
    state.view = 'table'; render();
    const row = document.querySelector('[data-mgr-row]');
    row.click();
    const bd = document.querySelector(`#bd-${row.dataset.mgrRow}`);
    return { open: bd && bd.style.display !== 'none', view: state.view };
  });
  chk('tapping the row itself still toggles the breakdown, staying on the table', rowTap.open && rowTap.view === 'table', JSON.stringify(rowTap));

  /* 8 — 320px: no horizontal overflow, third hoarding hidden */
  await p.setViewport({ width: 320, height: 650 });
  await p.evaluate(() => { teamView.mid = state.draft.order[0]; teamView.gw = 0; state.view = 'team'; render(); });
  await sleep(150);
  const narrow = await p.evaluate(() => {
    const boards = [...document.querySelectorAll('.ad-strip .ad-board')];
    return {
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      boards: boards.length,
      thirdHidden: boards.length >= 3 ? getComputedStyle(boards[2]).display === 'none' : null,
    };
  });
  chk('320px team view: no horizontal overflow', narrow.scrollW <= narrow.innerW, `scrollWidth ${narrow.scrollW} vs ${narrow.innerW}`);
  chk('320px: third hoarding is hidden', narrow.boards >= 3 && narrow.thirdHidden === true, JSON.stringify(narrow));
  const narrowTable = await p.evaluate(() => { state.view = 'table'; render(); return document.documentElement.scrollWidth; });
  chk('320px table view: no horizontal overflow', narrowTable <= 320, `scrollWidth ${narrowTable}`);

  chk('page A: no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await p.close();

  /* ============ page B: sync-on with a stubbed WCSync (netOn true) ============ */
  // page B gets its own browser context: page A's saved league in shared
  // localStorage would otherwise wedge the boot-time local-vs-cloud
  // reconciliation under stubbed confirms and identity never lands
  const bCtx = await browser.createBrowserContext();
  const b = await bCtx.newPage();
  const bErrors = [];
  b.on('pageerror', e => bErrors.push(e.message));
  await b.setRequestInterception(true);
  b.on('request', req => req.url().endsWith('/js/sync.js') ? req.abort() : req.continue());
  await b.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await b.waitForFunction(() => typeof state !== 'undefined');
  await b.evaluate(() => {
    window.__autoConfirm = true;
    window.confirm = () => true;
    window._calls = [];
    window._resolvers = [];
    window.WCSync = {
      league: 'the-league-2627',
      call: (action, data) => new Promise((resolve, reject) => {
        window._calls.push({ action, data });
        window._resolvers.push({ resolve, reject });
      }),
      auth: {
        user: () => ({ uid: 'u-test', email: 'ben@example.com' }),
        sendLink: () => Promise.resolve(),
        completeLink: () => Promise.resolve(false),
        signOut: () => Promise.resolve(),
      },
    };
    const s = freshState();
    s.phase = 'season';
    s.draft.order = s.managers.map(m => m.id);
    window.onSharedSnapshot(JSON.parse(JSON.stringify({
      phase: s.phase, managers: s.managers, settings: s.settings, draft: s.draft,
      lineups: {}, transfers: [], trades: [], covenants: [], waiverMeta: s.waiverMeta,
      adjustments: {}, shirtNums: {}, draftPool: null, windowDraft: null,
      tradeBlock: {}, benchOrders: {}, lobus: {}, hamCup: null,
    })));
    window.onAuthChanged({ uid: 'u-test', email: 'ben@example.com' });
    window.onMembershipSnapshot({ managerId: 1, role: 'commissioner' });
    window.onSyncConnection(true);
  });
  await sleep(300);

  /* 9 — demo "Run waivers now" runs the LOCAL engine and never calls WCSync */
  const demoWaiv = await b.evaluate(async () => {
    await enterDemo();
    const callsBefore = window._calls.length;
    const cur = currentGwIndex();
    const mid = state.managers[0].id;
    const outP = squadAt(mid, cur).find(x => x.pos === 'MF') || squadAt(mid, cur)[0];
    const owned = ownedIdsAt(cur);
    const fa = PLAYERS.find(x => !owned.has(x.id) && x.pos === outP.pos);
    state.claims = { [cur]: { [mid]: [{ in: fa.id, out: outP.id, t: Date.now() }] } };
    const preTransfers = state.transfers.length;
    state.view = 'transfers'; transfersView.tab = 'trough'; render();
    const btn = document.querySelector('#runWaivers');
    const demoLabel = btn ? /demo/i.test(btn.textContent) : false;
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 300));
    const rec = state.transfers[state.transfers.length - 1];
    return {
      demoLabel,
      demoStillOn: demoMode,
      landed: state.transfers.length === preTransfers + 1 && rec?.waiver === true
        && rec?.managerId === mid && rec?.inId === fa.id && rec?.outId === outP.id,
      claimsCleared: !Object.values(state.claims).some(bkt => Object.values(bkt || {}).some(a => (a || []).length)),
      wcsyncCalls: window._calls.length - callsBefore,
    };
  });
  chk('demo trough shows the demo Run-waivers button', demoWaiv.demoLabel === true, JSON.stringify(demoWaiv));
  chk('demo waiver run lands the claim through the local engine', demoWaiv.landed && demoWaiv.claimsCleared, JSON.stringify(demoWaiv));
  chk('demo waiver run never touches WCSync.call', demoWaiv.wcsyncCalls === 0, `${demoWaiv.wcsyncCalls} calls dispatched`);
  chk('demo mode stayed on throughout', demoWaiv.demoStillOn === true);

  /* 10 — club office: backdrop AND Cancel are inert while a save is in flight */
  const office = await b.evaluate(async () => {
    exitDemo();
    await new Promise(r => setTimeout(r, 100));
    clubEditor(1);
    const ov = [...document.querySelectorAll('.overlay')].pop();
    if (!ov || !ov.querySelector('#clubSave')) return { opened: false };
    const callsBefore = window._calls.length;
    ov.querySelector('#clubSave').click();
    await new Promise(r => setTimeout(r, 50));
    const dispatched = window._calls.length === callsBefore + 1 && window._calls[window._calls.length - 1].action === 'clubSet';
    const saveBtn = ov.querySelector('#clubSave');
    const midFlight = { saving: saveBtn.disabled && /saving/i.test(saveBtn.textContent), cancelDisabled: ov.querySelector('#clubCancel').disabled };
    ov.querySelector('#clubCancel').click();
    const afterCancel = document.body.contains(ov);
    ov.click(); // target === ov -> the backdrop path
    const afterBackdrop = document.body.contains(ov);
    window._resolvers.pop().resolve({});
    await new Promise(r => setTimeout(r, 100));
    const closedAfterResolve = !document.body.contains(ov);
    return { opened: true, dispatched, midFlight, afterCancel, afterBackdrop, closedAfterResolve };
  });
  chk('club office opens and the save dispatches one clubSet call', office.opened && office.dispatched, JSON.stringify(office));
  chk('mid-flight: Save shows Saving… and Cancel is disabled',
    office.midFlight && office.midFlight.saving && office.midFlight.cancelDisabled, JSON.stringify(office.midFlight));
  chk('mid-flight: Cancel click does not close the office', office.afterCancel === true);
  chk('mid-flight: backdrop click does not close the office', office.afterBackdrop === true);
  chk('server success closes the office', office.closedAfterResolve === true);

  chk('page B: no uncaught page errors', bErrors.length === 0, bErrors.join(' | '));
  await b.close();

  /* ====== page C: 320px setup phase (Chairman console) fits the screen ====== */
  const cCtx = await browser.createBrowserContext();
  const c = await cCtx.newPage();
  await c.setViewport({ width: 320, height: 650 });
  await c.goto(baseUrl + '?nosync', { waitUntil: 'networkidle2' });
  await c.waitForFunction(() => typeof state !== 'undefined');
  const setup320 = await c.evaluate(() => ({
    phase: state.phase,
    scrollW: document.documentElement.scrollWidth,
    mgrRows: document.querySelectorAll('.mgr-row').length,
    quota: !!document.querySelector('.quota-grid'),
  }));
  chk('320px setup console: manager rows + quota grid, no horizontal overflow',
    setup320.phase === 'setup' && setup320.mgrRows > 0 && setup320.quota && setup320.scrollW <= 320,
    JSON.stringify(setup320));
  await c.close();

  await browser.close();
  console.log(`\nr3ui.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
