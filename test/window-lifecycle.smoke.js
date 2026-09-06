'use strict';
// Marc, 6 Sept: Graham goes straight to the Trough; reopen on 1 January.
const assert = require('node:assert/strict');
const Engine = require('../js/engine.js');
const puppeteer = require('puppeteer-core');
(async () => {
  assert.equal(Engine.JANUARY_WINDOW_OPENS, Date.parse('2027-01-01T00:00:00Z'));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 390, height: 844 });
    await page.goto((process.env.TEST_BASE_URL || 'http://localhost:8125') + '?sandbox&nosync', { waitUntil: 'networkidle2' });
    const checks = await page.evaluate(() => {
      let count = 0;
      const check = (ok, message) => { if (!ok) throw new Error(message); count++; };
      const realNow = Date.now;
      try {
        Date.now = () => Date.parse('2026-09-06T21:00:00Z');
        state = buildDemoState(); state.phase = 'season'; whoami = state.managers[0].id;
        const prior = PLAYERS.find(p => !ownedIdsAt(transferGw()).has(p.id));
        const ids = Object.fromEntries(PLAYERS.filter(p => p.id !== prior.id).map(p => [p.id, p.club]));
        state.draftPool = { at: Date.parse('2026-09-03T19:07:02Z'), ids };
        const eng = () => Engine.make({ players: PLAYERS, gameweeks: GAMEWEEKS, fixtures: state.fixtures, lastSeasonByCode: LAST_SEASON.byCode, now: () => Date.now() });
        check(!isArrival(prior) && !eng().isArrival(state, prior), 'post-run addition still penned');
        check(lockedArrivals().length === 0, 'completed September pen not empty');
        state.view = 'transfers'; transfersView.tab = 'window'; render();
        check(!document.querySelector('[data-trtab="window"]'), 'window tab still visible between windows');
        check(document.body.textContent.includes('Waivers & The Trough'), 'stale window tab does not return to Trough');
        check(!document.body.textContent.includes('desk is shut'), 'obsolete September card shown');
        const snapshot = Engine.prepareWindowPool(state, PLAYERS);
        check(snapshot.ids[prior.id] === prior.club && snapshot.closed, 'between-window baseline not refreshed');
        state.draftPool = snapshot;
        const newcomer = { ...prior, id: 9999991, name: 'January Newcomer', code: 9999991 };
        PLAYERS.push(newcomer); PLAYER_BY_ID[newcomer.id] = newcomer;
        Date.now = () => Engine.JANUARY_WINDOW_OPENS - 1;
        check(!isArrival(newcomer), 'December addition penned before midnight');
        Date.now = () => Engine.JANUARY_WINDOW_OPENS;
        check(isArrival(newcomer) && eng().isArrival(state, newcomer), 'January boundary differs between client and server');
        check(!isArrival(prior), 'September addition re-penned in January');
        const frozen = Engine.prepareWindowPool(state, PLAYERS);
        check(!frozen.ids[newcomer.id], 'rollover admitted a January addition');
        state.draftPool = frozen;
        check(Engine.prepareWindowPool(state, PLAYERS) === null, 'next tick overwrites open January baseline');
        check(!Engine.windowInfo(state).at, 'February execution date invented');
        transfersView.tab = 'window'; render();
        check(!!document.querySelector('[data-trtab="window"]'), 'January tab missing');
        check(document.body.textContent.includes('January Window Waiver'), 'January heading missing');
        check(document.body.textContent.includes('date to be confirmed'), 'unconfirmed date not explained');
        check(!document.body.textContent.includes('3 September'), 'January shows September run date');
        check(!!document.querySelector('#wcAdd'), 'January blind list unavailable');
        check(document.querySelector('#wwRun').disabled, 'undated January run enabled');
        check(JSON.stringify(windowOrder()) === JSON.stringify(eng().waiverBase(state)), 'January order is not bottom-up: ' + JSON.stringify([windowOrder(), eng().waiverBase(state), currentGwIndex(), eng().currentGwIndex()]));
        const unchanged = JSON.stringify(state.waiverMeta);
        state.draftPool = { ...state.draftPool, at: Date.parse('2027-02-03T20:07:00Z'), closed: true };
        Date.now = () => Date.parse('2027-02-04T12:00:00Z');
        check(!isArrival(newcomer) && !eng().isArrival(state, newcomer), 'post-January addition still penned');
        check(JSON.stringify(state.waiverMeta) === unchanged, 'window lifecycle changes weekly clock');
        render();
        check(!document.querySelector('[data-trtab="window"]'), 'January desk survives its completion');
        // Empty January still has a desk: managers should not have to wait for
        // a feed addition to find the schedule and their list.
        state.draftPool = { ...frozen, ids: Object.fromEntries(PLAYERS.map(p => [p.id, p.club])) };
        Date.now = () => Engine.JANUARY_WINDOW_OPENS;
        transfersView.tab = 'window'; render();
        check(lockedArrivals().length === 0 && !!document.querySelector('#wcAdd'), 'empty January desk disappears');
        check(document.documentElement.scrollWidth <= 390, 'January desk overflows mobile');
        return count;
      } finally { Date.now = realNow; }
    });
    assert.deepEqual(errors, []);
    console.log(`[window-lifecycle] ${checks} passed`);
    if (process.env.WINDOW_SCREENSHOT) await page.screenshot({ path: process.env.WINDOW_SCREENSHOT, fullPage: true });
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
