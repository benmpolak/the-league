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

    // draft night happened, then three men appeared: one moved clubs with
    // nobody owning him, one moved clubs and somebody does, one the feed had
    // simply never created
    const cur = currentGwIndex();
    const unownedMover = PLAYERS.find(x => !ownedIdsAt(cur).has(x.id));
    const latecomer = PLAYERS.find(x => x.id !== unownedMover.id && !ownedIdsAt(cur).has(x.id));
    const ownedMover = PLAYERS.find(x => ownedIdsAt(cur).has(x.id));
    const ids = Object.fromEntries(PLAYERS.map(x => [x.id, x.club]));
    ids[unownedMover.id] = 'ZZZ';   // both were at another club on draft night
    ids[ownedMover.id] = 'ZZZ';
    delete ids[latecomer.id];        // and this one did not exist at all
    state.draftPool = { at: Date.now(), ids };

    ok('the late feed entry is in the pen', arrivalLocked(latecomer), latecomer.name);
    // Marc, 30 Aug 2026: "nico, disasi and pinnock all need to be in the
    // holding pen" — all three kept their FPL id across a move, so the old
    // id-based rule left them loose in the Trough
    ok('an unowned man who moved PL clubs is penned too',
      arrivalLocked(unownedMover), `${unownedMover.name} ZZZ -> ${unownedMover.club}`);
    ok('and he shows up in the pen list', lockedArrivals().some(x => x.id === unownedMover.id));
    // Marc, 21 Aug: "konsa was already on the game and drafted by somebody" —
    // THE guarantee from Chairman's Desk §04. An owned man is his owner's
    // business; locking one is what stopped Konsa's owner fielding him.
    ok('but an OWNED mover is never locked — his owner can still field him',
      !arrivalLocked(ownedMover), `${ownedMover.name} ZZZ -> ${ownedMover.club}`);
    ok('and he never appears in the pen list',
      !lockedArrivals().some(x => x.id === ownedMover.id), ownedMover.name);

    admitArrival(latecomer.id);
    ok('admitting the latecomer frees him', !arrivalLocked(latecomer));
    ok('he is signable in the Trough now',
      PLAYERS.filter(x => !ownedIdsAt(cur).has(x.id) && !arrivalLocked(x)).some(x => x.id === latecomer.id));
    ok('nobody else was released', Object.keys(state.draftPool.ids).length === Object.keys(ids).length + 1);

    // The two engines must agree or the server refuses an XI the client offered.
    // This used to grep app.js for a substring, which said nothing about
    // BEHAVIOUR and broke the moment the rule changed. Compare them properly.
    const eng = Engine.make({
      players: PLAYERS, gameweeks: GAMEWEEKS, fixtures: state.fixtures || [],
      lastSeasonByCode: (typeof LAST_SEASON !== 'undefined' && LAST_SEASON.byCode) || {},
      now: () => Date.now(),
    });
    const sample = [latecomer, unownedMover, ownedMover, ...PLAYERS.slice(0, 60)];
    const disagree = sample.filter(x =>
      eng.isArrival(state, x) !== isArrival(x) || eng.arrivalLocked(state, x) !== arrivalLocked(x));
    ok('client and server read arrivals identically',
      disagree.length === 0, disagree.map(x => x.name).join(', ') || 'js/app.js matches js/engine.js');
    ok('(and the comparison is not vacuous — it saw a penned man and a free one)',
      sample.some(x => arrivalLocked(x)) && sample.some(x => !arrivalLocked(x)));

    return out.join('\n');
  });
  for (const line of report.split('\n')) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors admitting him', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[holding-pen] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
