/* Adversarial checks for the 2 Aug mock-night round. These intentionally pin
 * the scratchpad-only surfaces in the review brief: feed replacement during
 * a Simulation Chamber run, projection degenerates/perf, history-aware
 * heckle sheets, order dragging and drinks-break restart behaviour.
 *
 * Usage: python3 -m http.server 8125 & node test/mocknight.review.js */
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
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?sandbox&nosync&mocknight-review=1', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof applyMock === 'function');

  const fxAudit = await page.evaluate(() => {
    state = freshState(); state.phase = 'season'; state.view = 'fixtures';
    const baseFixture = { id: 7001, gw: 1, date: GAMEWEEKS[0].from, home: TEAMS[0].name, away: TEAMS[1].name,
      hs: null, as: null, started: false, finished: false, minutes: 0, feedOnly: 'before' };
    state.fixtures = [baseFixture]; state.matchStats = {};
    mockFxSaved = null; mockPrevPS = null; mockMemo = ''; mockGwKeyApplied = null;
    state.mock = { gw: 0, phase: 'live', seed: 17, t: Date.now() - MOCK_LIVE_MS / 2 };
    applyMock();
    const patchedFirst = { ...state.fixtures[0] };

    // Emulate syncNow replacing the entire feed array and the real GW event
    // while the chamber remains live. These are the values off must restore.
    const syncedFixture = { ...baseFixture, hs: 3, as: 2, started: true, finished: true, minutes: 90, feedOnly: 'after' };
    const expectedSyncedFixture = structuredClone(syncedFixture);
    const realEvent = { gw: 0, label: 'GW1', date: GAMEWEEKS[0].from, final: true,
      playerStats: { [PLAYERS[0].id]: { min: 90, st: 1, g: 1 } } };
    state.fixtures = [syncedFixture];
    state.matchStats.gw1 = structuredClone(realEvent);
    applyMock();
    const repatchedFeed = { ...state.fixtures[0] };
    state.mock = null;
    applyMock();
    const restoredFixture = { ...state.fixtures[0] };
    const restoredEvent = state.matchStats.gw1;

    // Local persistence must never carry either real feed bulk or mock bulk.
    save();
    const persisted = JSON.parse(localStorage.getItem(LS_KEY));
    return {
      patchedFirst, repatchedFeed, restoredFixture, restoredEvent,
      fixtureExact: JSON.stringify(restoredFixture) === JSON.stringify(expectedSyncedFixture),
      eventExact: JSON.stringify(restoredEvent) === JSON.stringify(realEvent),
      persistedFixtures: persisted.fixtures.length,
      persistedStats: Object.keys(persisted.matchStats).length,
    };
  });
  chk('mock switch-off restores the latest feed fixture exactly after array replacement', fxAudit.fixtureExact, JSON.stringify(fxAudit));
  chk('mock switch-off restores a real matchStats event that synced mid-simulation', fxAudit.eventExact, JSON.stringify(fxAudit));
  chk('localStorage strips fixtures and matchStats while the mock overlay is active',
    fxAudit.persistedFixtures === 0 && fxAudit.persistedStats === 0, JSON.stringify(fxAudit));

  const nextFxAudit = await page.evaluate(() => {
    state = freshState(); state.phase = 'season';
    const a = { id: 7101, gw: 1, date: GAMEWEEKS[0].from, home: TEAMS[0].name, away: TEAMS[1].name,
      hs: null, as: null, started: false, finished: false, minutes: 0 };
    const b = { id: 7102, gw: 2, date: GAMEWEEKS[1].from, home: TEAMS[0].name, away: TEAMS[2].name,
      hs: null, as: null, started: false, finished: false, minutes: 0 };
    state.fixtures = [a, b]; state.matchStats = {};
    mockFxSaved = null; mockMemo = ''; mockGwKeyApplied = null; _fxKey = ''; _fxCache = new Map();
    state.mock = { gw: 0, phase: 'final', seed: 21, t: Date.now() };
    applyMock();
    const during = nextFx(TEAMS[0].name);
    state.mock = null; applyMock();
    const after = nextFx(TEAMS[0].name);
    _fxKey = ''; _fxCache = new Map();
    const recalculated = nextFx(TEAMS[0].name);
    return { during, after, recalculated };
  });
  chk('switch-off invalidates next-fixture caches derived from mock-finished fixtures',
    nextFxAudit.after === nextFxAudit.recalculated, JSON.stringify(nextFxAudit));

  const xpAudit = await page.evaluate(() => {
    state = freshState(); state.phase = 'season'; state.fixtures = GAMEWEEKS.slice(0, 6).flatMap((g, i) => [
      { id: 8000 + i, gw: g.n, date: g.from, home: TEAMS[i % TEAMS.length].name, away: TEAMS[(i + 1) % TEAMS.length].name,
        started: false, finished: false, minutes: 0 },
    ]);
    const p = PLAYERS.find(x => x.pos === 'MF') || PLAYERS[0];
    state.matchStats = { gw1: { gw: 0, label: 'GW1', final: true,
      playerStats: { [p.id]: { min: 90, st: 1, g: 0, a: 0, cs: 0, gc: 0, sv: 0 } } } };
    state.settings.scoring = { ...DEFAULT_SCORING };
    _metricsKey = ''; _metricsCache = new Map();
    const started = performance.now();
    const vals = PLAYERS.map(x => metricsFor(x));
    const elapsed = performance.now() - started;
    const completeFinite = vals.every(m => [m.pts, m.ppg, m.xp1, m.xp3, m.xp6].every(Number.isFinite));
    state.settings.scoring = { appearanceStart: 2 }; // degenerate legacy/custom fragment
    _metricsKey = ''; _metricsCache = new Map();
    const missingKeysXp = playerXp(p);
    const noArchive = PLAYERS.find(x => !lastSeasonOf(x)) || PLAYERS[PLAYERS.length - 1];
    const oldNoArchive = { code: noArchive.code, ppg: noArchive.ppg, mp: noArchive.mp, price: noArchive.price };
    noArchive.code = -999; noArchive.ppg = 0; noArchive.mp = 0; noArchive.price = 40;
    let fallback = null, fallbackError = '';
    try { fallback = playerXp(noArchive); }
    catch (e) { fallbackError = e.message; }
    Object.assign(noArchive, oldNoArchive);
    return { elapsed: Math.round(elapsed), count: vals.length, completeFinite, missingKeysXp, fallback, fallbackError };
  });
  chk('full-pool live metrics render terminates, stays finite and completes under one second',
    xpAudit.completeFinite && xpAudit.elapsed < 1000, JSON.stringify(xpAudit));
  chk('playerXp stays finite with missing scoring keys, zero apps and no archive',
    Number.isFinite(xpAudit.missingKeysXp) && Number.isFinite(xpAudit.fallback), JSON.stringify(xpAudit));

  for (const width of [320, 390]) {
    await page.setViewport({ width, height: 760, deviceScaleFactor: 1 });
    const responsiveAudit = await page.evaluate(() => {
      const rows = [];
      const measure = name => rows.push({ name, scroll: document.documentElement.scrollWidth, viewport: innerWidth });
      state = freshState(); state.phase = 'setup'; state.view = 'dash'; render(); measure('setup/order editor');
      state.phase = 'draft'; state.view = 'draft'; state.draft.order = state.managers.map(m => m.id); render();
      heckleSheet(); measure('draft + heckle sheet'); document.getElementById('heckleSheet')?.remove();
      state.phase = 'season'; state.view = 'dash'; render(); measure('dashboard/programme');
      state.view = 'transfers'; state.mock = { gw: 0, phase: 'live', seed: 7, t: Date.now() }; render(); measure('trough/mock status');
      return rows;
    });
    chk(`${width}px moved-page pass has no horizontal overflow`,
      responsiveAudit.every(x => x.scroll <= x.viewport), JSON.stringify(responsiveAudit));
  }

  const xssAudit = await page.evaluate(() => {
    state = freshState(); state.phase = 'draft'; state.view = 'draft'; whoami = state.managers[0].id;
    state.draft.order = state.managers.map(m => m.id);
    state.managers[1].name = '<img data-hk-xss src=x>'; state.managers[1].team = '<img data-hk-xss src=x>';
    render();
    heckleFlash(state.managers[1].id, { text: '<svg data-hk-xss onload=alert(1)>' });
    const flash = document.querySelector('.heckle-flash');
    return { literal: flash?.textContent || '', injected: !!document.querySelector('[data-hk-xss]') };
  });
  chk('heckle manager name and custom text render literally at the only flash site',
    /<img/.test(xssAudit.literal) && /<svg/.test(xssAudit.literal) && !xssAudit.injected, JSON.stringify(xssAudit));

  // Establish real tab history, then open a sheet. Back should consume an
  // overlay entry and close it, not change the view behind a still-open sheet.
  await page.evaluate(() => { state.view = 'rules'; render(); state.view = 'draft'; render(); document.getElementById('heckleBtn').click(); });
  await page.goBack();
  await new Promise(r => setTimeout(r, 150));
  const backAudit = await page.evaluate(() => ({ sheet: !!document.getElementById('heckleSheet'), view: state.view, hash: location.hash, ovDepth }));
  chk('phone Back closes the heckle sheet before navigating the draft tabs',
    !backAudit.sheet && backAudit.view === 'draft', JSON.stringify(backAudit));

  const orderAudit = await page.evaluate(() => {
    state = freshState(); state.view = 'dash'; whoami = state.managers[0].id; render();
    const drop = (from, target, after) => {
      const row = document.querySelector(`[data-mgrdrag="${target}"]`);
      const rect = row.getBoundingClientRect();
      row.ondrop({ preventDefault() {}, dataTransfer: { getData: () => String(from) },
        clientY: after ? rect.bottom - 1 : rect.top + 1 });
    };
    drop(0, 2, true); // 1 after 3
    drop(11, 0, false); // 12 to the front
    const visible = state.managers.map(m => m.id);
    window.__autoConfirm = true;
    document.getElementById('startDraftOrdered').click();
    return { visible, draftOrder: state.draft.order, permutation: new Set(visible).size === 12 };
  });
  chk('order-editor drops preserve a permutation and ordered start uses the visible order',
    orderAudit.permutation && JSON.stringify(orderAudit.visible) === JSON.stringify(orderAudit.draftOrder), JSON.stringify(orderAudit));

  const breakAudit = await page.evaluate(async () => {
    document.querySelectorAll('.overlay').forEach(x => x.remove());
    state = freshState(); state.phase = 'draft'; state.view = 'draft'; state.settings.pickTimer = 0;
    state.draft.order = state.managers.map(m => m.id);
    state.draft.picks = Array.from({ length: Math.round(totalPicks() / 3) }, (_, i) => ({ n: i + 1, managerId: 1, playerId: PLAYERS[i].id }));
    state.draft.breaksDone = [];
    window.__mockNow = 1000000; Date.now = () => window.__mockNow;
    maybeDrinksBreak();
    const firstDisabled = document.getElementById('breakDone')?.disabled;
    window.__mockNow += DRINKS_BREAK_MS - 1000;
    document.getElementById('drinksBreak')?.remove(); // refresh/navigation loses the local opened timestamp
    maybeDrinksBreak();
    window.__mockNow += 2000;
    await new Promise(r => setTimeout(r, 600));
    return { firstDisabled, restartedDisabled: document.getElementById('breakDone')?.disabled };
  });
  chk('drinks-break countdown survives a refresh/re-render instead of restarting from two minutes',
    breakAudit.firstDisabled && breakAudit.restartedDisabled === false, JSON.stringify(breakAudit));

  chk('no uncaught browser errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n[mocknight-review] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
