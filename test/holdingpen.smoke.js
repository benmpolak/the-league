/* The holding pen, and the one man who should never have been in it.
 *
 * Marc, 21 Aug: "he isnt a new player hes just a player who wasnt on the
 * official fpl game until he played in a match last week. the holding pen is
 * for players who are added to the game because they have moved clubs."
 *
 * isArrival cannot tell those apart — a transfer and a late feed entry both
 * surface as an id the draft-night snapshot has never seen. So the Chairman
 * gets a per-player admission, and the thing worth pinning is that it frees
 * ONLY that man: every genuine arrival stays locked for the Window Draft.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' \u2014 ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const report = await page.evaluate(() => {
    const out = [];
    const ok = (n, c, d = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
    window.__autoConfirm = true; window.confirm = () => true;
    state = buildDemoState(); state.phase = 'season';
    whoami = state.managers[0].id;

    // draft night happened, then two men appeared: one moved clubs, one the
    // feed had simply never created
    const mover = PLAYERS.find(x => !ownedIdsAt(0).has(x.id));
    const latecomer = PLAYERS.find(x => x.id !== mover.id && !ownedIdsAt(0).has(x.id));
    const ids = Object.fromEntries(PLAYERS.map(x => [x.id, x.club]));
    ids[mover.id] = 'ZZZ';        // he was at another club on draft night
    delete ids[latecomer.id];      // he did not exist on draft night
    state.draftPool = { at: Date.now(), ids };

    ok('the late feed entry is in the pen', arrivalLocked(latecomer), latecomer.name);
    ok('the man who moved clubs is in the pen too', arrivalLocked(mover), mover.name);

    admitArrival(latecomer.id);
    ok('admitting the latecomer frees him', !arrivalLocked(latecomer));
    ok('and leaves the genuine arrival locked', arrivalLocked(mover), mover.name);
    ok('he is signable in the Trough now',
      PLAYERS.filter(x => !ownedIdsAt(0).has(x.id) && !arrivalLocked(x)).some(x => x.id === latecomer.id));
    ok('nobody else was released', Object.keys(state.draftPool.ids).length === Object.keys(ids).length + 1);
    return out.join('\n');
  });
  for (const line of report.split('\n')) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors admitting him', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[holding-pen] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
