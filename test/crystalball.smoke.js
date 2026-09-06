/* The Crystal Ball's Playoffs % — Marc, 6 Sep 2026: "the playoff prediction %
 * doesnt make sense. we are only 3 games in and its giving people 99/100% …
 * there are still 30 gameweeks left."
 *
 * The test the model has to pass: hand it twelve managers who are IDENTICAL by
 * construction and three weeks of pure variance, and it must not turn that
 * into a pecking order. Three rounds of H2H results ARE worth something — a
 * 3-0 start is a real head start on a 33-game season — so the spread does not
 * collapse to nothing; what must go is the old model's certainty. The numbers
 * quoted in the failures are what the old model produced on the same shape of
 * data: 100/99/99 at the top and 3/4/14 at the bottom.
 *
 * And the other half of the job: it still has to be able to make its mind up.
 * A model that only ever says "who knows" is no better than one that only ever
 * says "certain".
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

  const R = await page.evaluate(() => {
    state = buildDemoState();
    const ids = state.managers.map(m => m.id);
    const norm = (mu, sd) => mu + sd * Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
    // drive playoffOdds off a fabricated season by standing in for the two
    // readers it uses — the same pair it reads the real season through
    const feed = (rounds, scoreFor) => {
      const s = {};
      for (const id of ids) s[id] = Array.from({ length: rounds }, (_, i) => Math.round(scoreFor(id, i)));
      window.gwStatus = i => (i < rounds ? 'final' : 'upcoming');
      window.gwManagerPoints = (mid, i) => (i < rounds ? s[mid][i] : 0);
    };
    const run = () => { const o = playoffOdds(2500); return ids.map(id => o[id]); };
    const mid = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const out = {};

    // 1. five independent leagues of twelve identical managers, three rounds
    //    each. One league can always draw a freak table; five cannot all
    const his = [], los = [], means = [];
    for (let t = 0; t < 5; t++) {
      feed(3, () => norm(50, 15));
      const o = run();
      his.push(Math.max(...o)); los.push(Math.min(...o));
      means.push(o.reduce((a, b) => a + b, 0) / 12);
    }
    out.flat = { hi: mid(his), lo: mid(los), range: mid(his) - mid(los), mean: mid(means) };

    // 2. eighteen rounds of a man 25 a week clear of the rest
    const star = ids[0];
    feed(18, id => norm(id === star ? 75 : 50, 15));
    out.dominant = run()[0];

    // 3. a real but ordinary edge — ten a week, well inside the weekly bounce.
    //    Three leagues at each horizon: one sample of three rounds can flatter
    //    a man more than eighteen rounds of the truth does
    const edge = rounds => mid([0, 1, 2].map(() => {
      feed(rounds, id => norm(id === star ? 60 : 50, 15));
      return run()[0];
    }));
    out.edge3 = edge(3);
    out.edge18 = edge(18);
    return out;
  });

  // eight of twelve make the playoffs, so a field that has proved nothing
  // averages 67% apiece and must not reach either end of the scale
  chk('twelve equal managers, three rounds: nobody is a certainty',
    R.flat.hi <= 97, `highest ${R.flat.hi}% (old model: 100%)`);
  chk('twelve equal managers, three rounds: nobody is written off',
    R.flat.lo >= 18, `lowest ${R.flat.lo}% (old model: 4%)`);
  chk('the field is not strung out end to end on three weeks',
    R.flat.range <= 80, `${R.flat.range} points of spread (old model: ~96)`);
  chk('the twelve still average the eight places on offer',
    Math.abs(R.flat.mean - 66.7) < 6, `mean ${R.flat.mean.toFixed(1)}%`);
  // ...but the model must still be able to make its mind up
  chk('eighteen rounds of real dominance is backed',
    R.dominant >= 95, `${R.dominant}%`);
  chk('an ordinary edge firms up as the weeks back it',
    R.edge18 > R.edge3, `${R.edge3}% at three rounds, ${R.edge18}% at eighteen`);
  chk('no page errors while reading the Crystal Ball', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[crystal-ball] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
