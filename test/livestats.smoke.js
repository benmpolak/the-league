/* Live-match fast lane overlay: display-only freshness rules. The overlay
 * must apply only when fresh, never repaint a settled round, never outrank a
 * fresher feed sync, and stay out of the demo (and, by SANDBOX gate, the
 * sandbox). Run with TEST_BASE_URL=http://127.0.0.1:8135 for a side port. */
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

  const r = await page.evaluate(() => {
    const out = {};
    const pid = PLAYERS[0].id;
    const mk = t => ({ n: 1, t, playerStats: { [pid]: { min: 45, st: 1, g: 1, a: 0, cs: 0, gc: 0 } } });
    const gwKey = 'gw1';
    demoMode = false;

    // fresh overlay applies
    state.matchStats = {};
    state.feedGenerated = null;
    state.liveStats = mk(Date.now());
    applyLiveStats();
    out.freshApplies = !!state.matchStats[gwKey] && state.matchStats[gwKey].playerStats[pid].g === 1 && state.matchStats[gwKey].final === false;

    // stale overlay ignored
    state.matchStats = {};
    state.liveStats = mk(Date.now() - 11 * 60e3);
    applyLiveStats();
    out.staleIgnored = !state.matchStats[gwKey];

    // a fresher canonical feed outranks it
    state.matchStats = {};
    state.liveStats = mk(Date.now() - 60e3);
    state.feedGenerated = new Date().toISOString();
    applyLiveStats();
    out.feedWins = !state.matchStats[gwKey];
    state.feedGenerated = null;

    // a settled round is never repainted
    state.matchStats = { [gwKey]: { gw: 0, final: true, playerStats: { 999: { g: 9 } } } };
    state.liveStats = mk(Date.now());
    applyLiveStats();
    out.finalUntouched = state.matchStats[gwKey].final === true && state.matchStats[gwKey].playerStats[999].g === 9;

    // the demo owns its own world
    state.matchStats = {};
    demoMode = true;
    state.liveStats = mk(Date.now());
    applyLiveStats();
    out.demoSkipped = !state.matchStats[gwKey];
    demoMode = false;

    // a mounted Chamber outranks it (belt: SANDBOX also gates)
    state.matchStats = {};
    state.mock = { gw: 0, phase: 'final', seed: 1, t: Date.now() };
    state.liveStats = mk(Date.now());
    applyLiveStats();
    out.mockWins = !state.matchStats[gwKey];
    state.mock = null;

    state.liveStats = null;
    return out;
  });

  chk('fresh liveStats overlays the live round (non-final)', r.freshApplies);
  chk('stale liveStats is ignored — the feed is truth', r.staleIgnored);
  chk('a fresher canonical feed outranks the overlay', r.feedWins);
  chk('a settled round is never repainted', r.finalUntouched);
  chk('demo mode is untouched', r.demoSkipped);
  chk('a mounted Simulation Chamber outranks it', r.mockWins);
  chk('zero page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  console.log(`\n[livestats] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
