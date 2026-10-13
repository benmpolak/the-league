/* Minutes for one round, when the season total flatters.
 *
 * Marc, 31 Aug 2026: "can we add minutes in previous gameweek and minutes in
 * current gameweek as a filter in scouting tools."
 *
 * The point was never the columns. It was the man a season total flatters:
 * 900 minutes in the bank and nought last week is a player who has lost his
 * place, and the season column alone will never tell you.
 *
 * Those two columns are gone (Marc, 13 Oct 2026 — the window does the same job
 * for every column, not just minutes). The QUESTION is not gone, so this still
 * asks it, through the window instead. Including the trap that caught the
 * columns: "last one round" means a DIFFERENT round once the calendar rolls,
 * with no new stats landing to tell the cache anything has changed.
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
  await page.goto(baseUrl + '?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const report = await page.evaluate(() => {
    const out = [];
    const ok = (n, c, d = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
    window.__autoConfirm = true; window.confirm = () => true;
    state = buildDemoState(); state.phase = 'season';
    whoami = state.managers[0].id;

    // the demo fabricates GW1; put the clock in GW2 so there IS a round behind
    demoGwOverride = 1;
    const cur = currentGwIndex();
    const prev = cur - 1;
    ok('(setup) the clock is in a round with a round behind it', cur === 1 && prev === 0);

    // Three men, three shapes: a regular, one who has just lost his place, and
    // one who has just won it. Written straight into the two rounds' stats.
    const [reg, dropped, risen] = PLAYERS.slice(0, 3);
    const ev = i => (state.matchStats[`gw${GAMEWEEKS[i].n}`] =
      state.matchStats[`gw${GAMEWEEKS[i].n}`] || { gw: i, playerStats: {} });
    const put = (i, p, min) => { ev(i).playerStats[p.id] = { min, st: min >= 60 ? 1 : 0, sub: 0, g: 0, a: 0, cs: 0, gc: 0, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0 }; };
    put(prev, reg, 90);     put(cur, reg, 90);
    put(prev, dropped, 90); put(cur, dropped, 0);
    put(prev, risen, 0);    put(cur, risen, 78);
    _metricsCache = new Map(); _metricsKey = null;   // the feed just moved

    const nPrev = GAMEWEEKS[prev].n, nCur = GAMEWEEKS[cur].n;
    const minOf = (p, w) => withStatWindow(w, () => metricsFor(p).min);
    const lastRound = { from: nCur, to: nCur };
    const roundBefore = { from: nPrev, to: nPrev };

    ok('narrowed to the round just gone, the regular still reads 90',
      minOf(reg, lastRound) === 90, String(minOf(reg, lastRound)));
    ok('the man who lost his place reads 90 then 0 — the whole point of asking',
      minOf(dropped, roundBefore) === 90 && minOf(dropped, lastRound) === 0,
      `${minOf(dropped, roundBefore)}/${minOf(dropped, lastRound)}`);
    ok('the man who won it reads 0 then 78',
      minOf(risen, roundBefore) === 0 && minOf(risen, lastRound) === 78,
      `${minOf(risen, roundBefore)}/${minOf(risen, lastRound)}`);
    // these three have stats in NO other round, so the season figure must be
    // exactly the two added up — and must not be quietly reading one of them
    ok('with no window the season total is the two rounds added up',
      minOf(reg, null) === 180 && minOf(dropped, null) === 90 && minOf(risen, null) === 78,
      `${minOf(reg, null)}/${minOf(dropped, null)}/${minOf(risen, null)}`);
    ok('(so the season and the window genuinely disagree about the same man)',
      minOf(dropped, null) !== minOf(dropped, lastRound)
      && minOf(risen, null) !== minOf(risen, roundBefore));
    const blank = PLAYERS.find(p => ![reg, dropped, risen].includes(p) && ![prev, cur].some(i => state.matchStats[`gw${GAMEWEEKS[i].n}`]?.playerStats?.[p.id]));
    ok('a man with no line in either round reads 0, not blank',
      !!blank && minOf(blank, lastRound) === 0 && minOf(blank, roundBefore) === 0,
      blank ? `${blank.name}` : 'no blank man');

    // ---- "Last 1" must mean the round just gone, whichever that is ----
    ok('Last 1 and naming the round outright agree',
      minOf(dropped, { n: 1 }) === minOf(dropped, lastRound)
      && minOf(risen, { n: 1 }) === minOf(risen, lastRound),
      `${minOf(dropped, { n: 1 })}/${minOf(risen, { n: 1 })}`);

    // ---- sorting, which is what you actually do with it ----
    const by = w => withStatWindow(w, () => [reg, dropped, risen].slice().sort(metricSort('min')).map(p => p.id));
    const byLast = by(lastRound), byBefore = by(roundBefore);
    ok('sorted on the round just gone, the man who has come in is above the dropped one',
      byLast.indexOf(risen.id) < byLast.indexOf(dropped.id), JSON.stringify(byLast));
    ok('sorted on the round before, that turns round the other way',
      byBefore.indexOf(dropped.id) < byBefore.indexOf(risen.id), JSON.stringify(byBefore));

    // ---- a view can keep the window, so the question is one tap next time ----
    ok('a saved view may carry a last-n window',
      JSON.stringify(cleanScoutView({ name: 'v', win: { n: 1 } }).win) === '{"n":1}');
    ok('and a named range',
      JSON.stringify(cleanScoutView({ name: 'v', win: { from: nPrev, to: nCur } }).win)
        === JSON.stringify({ from: nPrev, to: nCur }));
    ok('a view saved with no window is simply the season',
      cleanScoutView({ name: 'v' }).win === null);

    /* ---- THE TRAP, inherited from the columns this replaced ----
       The metrics cache used to key on how many player stats exist, which does
       not change at the moment the calendar rolls. "Last 1" is the round that
       moves: write GW3 once, roll the clock, and read again WITHOUT touching
       the stats. If the cache is keyed wrongly it serves GW2's number under
       GW3's window and nobody notices for a week. */
    demoGwOverride = 1;
    put(2, dropped, 55);                    // a GW3 line, written while it is still GW2
    _metricsCache = new Map(); _metricsKey = null;
    const atGw2 = minOf(dropped, { n: 1 });
    demoGwOverride = 2;                      // the calendar rolls. Nothing else changes.
    const atGw3 = minOf(dropped, { n: 1 });
    ok('rolling the calendar moves Last 1 along, with no new stats landing',
      atGw2 === 0 && atGw3 === 55, `was ${atGw2}, now ${atGw3}`);

    demoGwOverride = null;
    return out;
  });

  for (const line of report) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log(`\n[gw-minutes] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
