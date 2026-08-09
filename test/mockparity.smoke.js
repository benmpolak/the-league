/* Simulation Chamber parity: js/app.js mockScorelines/mockGwStats and the
 * js/engine.js port must produce BYTE-IDENTICAL output for the same state —
 * the server adjudicates waivers off the engine's derivation while every
 * screen renders the app's (Toby, 9 Aug: the two disagreed and the run
 * processed in reverse-draft order). RNG call order is part of the contract.
 * Run against any side-port server with TEST_BASE_URL=http://127.0.0.1:8135. */
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

  const res = await page.evaluate(async () => {
    // a full league with squads: the demo provides one deterministically
    enterDemo();
    // fixtures must exist or the scoreline branch under test is vacuous
    if (!toArr(state.fixtures).length) {
      try {
        const r = await fetch('data/fixtures.json');
        state.fixtures = await r.json();
      } catch { /* asserted below */ }
    }
    const eng = Engine.make({
      players: PLAYERS,
      gameweeks: GAMEWEEKS,
      fixtures: state.fixtures,
      lastSeasonByCode: (typeof LAST_SEASON !== 'undefined' && LAST_SEASON.byCode) || {},
    });
    const cases = [];
    for (const seed of [42, 999983, 1]) {
      for (const gw of [0, 7]) {
        for (const frac of [1, 0.55]) {
          const app = JSON.stringify(mockGwStats(gw, seed, frac));
          const engine = JSON.stringify(eng.mockGwStats(state, gw, seed, frac));
          cases.push({ seed, gw, frac, same: app === engine, appLen: app.length });
        }
      }
    }
    const slApp = JSON.stringify(mockScorelines(0, 42).teams);
    const slEng = JSON.stringify(eng.mockScorelines(state, 0, 42).teams);
    return {
      fixtures: toArr(state.fixtures).length,
      cases,
      scorelines: slApp === slEng,
      nonEmpty: JSON.parse(JSON.stringify(mockGwStats(0, 42, 1))),
    };
  });

  chk('fixtures present (the scoreline branch is actually exercised)', res.fixtures > 0, `${res.fixtures} fixtures`);
  for (const c of res.cases) {
    chk(`app and engine agree: seed ${c.seed}, gw ${c.gw}, frac ${c.frac}`, c.same, `app bytes ${c.appLen}`);
  }
  chk('scorelines agree (seed 42, gw 0)', res.scorelines);
  chk('the parity is not vacuous — stats were actually generated', Object.keys(res.nonEmpty).length > 20, `${Object.keys(res.nonEmpty).length} stat lines`);
  chk('zero page errors', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  console.log(`\n[mockparity] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
