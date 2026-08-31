/* Minutes for one gameweek, alongside the season total.
 *
 * Marc, 31 Aug 2026: "can we add minutes in previous gameweek and minutes in
 * current gameweek as a filter in scouting tools. can you also rename minutes
 * to total minutes and then order all three next to each other."
 *
 * The point of the pair is the man a season total flatters: 900 minutes in the
 * bank and nought last week is a player who has lost his place, and the season
 * column alone will never tell you. So the case that matters here is the one
 * where the three columns DISAGREE about the same man.
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

    // the demo fabricates GW1; put the clock in GW2 so there IS a previous one
    demoGwOverride = 1;
    const cur = currentGwIndex();
    const prev = cur - 1;
    ok('(setup) the clock is in a round with a round behind it', cur === 1 && prev === 0);

    // Three men, three shapes: a regular, one who has just lost his place, and
    // one who has just won it. Written straight into the two rounds' stats.
    const [reg, dropped, risen] = PLAYERS.slice(0, 3);
    const ev = i => (state.matchStats[`gw${GAMEWEEKS[i].n}`] =
      state.matchStats[`gw${GAMEWEEKS[i].n}`] || { gw: GAMEWEEKS[i].n, playerStats: {} });
    const put = (i, p, min) => { ev(i).playerStats[p.id] = { min, st: min >= 60 ? 1 : 0, sub: 0, g: 0, a: 0, cs: 0, gc: 0, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0 }; };
    put(prev, reg, 90);     put(cur, reg, 90);
    put(prev, dropped, 90); put(cur, dropped, 0);
    put(prev, risen, 0);    put(cur, risen, 78);
    _metricsCache = new Map(); _metricsKey = null;   // the feed just moved

    const m = p => metricsFor(p);
    ok('the regular reads 90 and 90', m(reg).minPrev === 90 && m(reg).minGw === 90,
      `${m(reg).minPrev}/${m(reg).minGw}`);
    ok('the man who lost his place reads 90 then 0 — the whole point of the pair',
      m(dropped).minPrev === 90 && m(dropped).minGw === 0, `${m(dropped).minPrev}/${m(dropped).minGw}`);
    ok('the man who won it reads 0 then 78',
      m(risen).minPrev === 0 && m(risen).minGw === 78, `${m(risen).minPrev}/${m(risen).minGw}`);
    // these three have stats in NO other round, so the season column must be
    // exactly the two added up — and must not be quietly reading one of them
    ok('the season total is the two rounds added up, not a copy of either',
      m(reg).min === 180 && m(dropped).min === 90 && m(risen).min === 78,
      `${m(reg).min}/${m(dropped).min}/${m(risen).min}`);
    ok('(so the three columns genuinely disagree about the same man)',
      m(dropped).min !== m(dropped).minGw && m(risen).min !== m(risen).minPrev);
    ok('a man with no line in either round reads 0, not blank',
      m(PLAYERS[400]).minPrev === 0 && m(PLAYERS[400]).minGw === 0);

    // ---- the three columns, together and correctly labelled ----
    const cols = ALL_STAT_COLS(seasonHasStats());
    const keys = cols.map(c => c.k);
    const i0 = keys.indexOf('min'), i1 = keys.indexOf('minPrev'), i2 = keys.indexOf('minGw');
    ok('all three minute columns exist', i0 >= 0 && i1 >= 0 && i2 >= 0, `${i0},${i1},${i2}`);
    ok('and they sit next to each other, in that order', i1 === i0 + 1 && i2 === i1 + 1, `${i0},${i1},${i2}`);
    ok('the season one is called TOTAL minutes now', /total minutes/i.test(cols[i0].t), cols[i0].t);
    ok('the headings name the actual gameweeks, so you need not remember which is which',
      cols[i1].h === `MP GW${GAMEWEEKS[prev].n}` && cols[i2].h === `MP GW${GAMEWEEKS[cur].n}`,
      `${cols[i1].h} | ${cols[i2].h}`);
    ok('each column reads its own number off the metrics',
      cols[i0].v(m(dropped)) === m(dropped).min && cols[i1].v(m(dropped)) === 90 && cols[i2].v(m(dropped)) === 0);

    // ---- sortable, and saveable in a view ----
    const byPrev = [reg, dropped, risen].slice().sort(metricSort('minPrev')).map(p => p.id);
    const byGw = [reg, dropped, risen].slice().sort(metricSort('minGw')).map(p => p.id);
    ok('sorting by last week puts the dropped man above the one who has just come in',
      byPrev.indexOf(dropped.id) < byPrev.indexOf(risen.id), JSON.stringify(byPrev));
    ok('sorting by this week turns that round the other way',
      byGw.indexOf(risen.id) < byGw.indexOf(dropped.id), JSON.stringify(byGw));
    ok('a saved view may sort on either of them',
      cleanScoutView({ name: 'v', sort: 'minPrev' }).sort === 'minPrev' &&
      cleanScoutView({ name: 'v', sort: 'minGw' }).sort === 'minGw');
    ok('and a saved view may carry them as columns',
      cleanScoutView({ name: 'v', cols: ['min', 'minPrev', 'minGw'] }).cols.join(',') === 'min,minPrev,minGw');

    // ---- before a ball is kicked there is no round to name ----
    demoGwOverride = 0;
    const pre = ALL_STAT_COLS(seasonHasStats());
    const ph = pre[pre.findIndex(c => c.k === 'minPrev')].h;
    ok('with no previous round the heading says so rather than inventing GW0',
      !/GW0|GW-1|undefined|NaN/.test(ph), ph);
    demoGwOverride = 1;

    return out.join('\n');
  });
  for (const line of report.split('\n')) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[gw-minutes] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
