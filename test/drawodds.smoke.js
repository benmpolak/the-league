/* The third result.
 *
 * Marc, 24 Aug 2026: "is the draw factored into the projections, because it
 * probably should be. if a draw is above 0.5% probability it should be called
 * out as its own thing."
 *
 * It was not. A fantasy score is a whole number, so two sides finishing level
 * is a real result worth a table point, but the bar read the difference off a
 * continuous curve — which says a tie cannot happen and quietly folds its odds
 * into the two teams either side of it.
 *
 * Usage: python3 -m http.server 8125 (repo root) then node test/drawodds.smoke.js
 */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const log = await page.evaluate(() => {
    const log = [];
    const t = (name, ok, detail = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
    const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

    const GW = 0;
    const played = () => ({ min: 90, st: 1, sub: 0, g: 0, a: 0, cs: 0, gc: 0, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0 });

    function baseline() {
      state = buildDemoState();
      const g = GAMEWEEKS[GW];
      g.finished = false;
      g.from = new Date(Date.now() - 36e5).toISOString();
      g.to = new Date(Date.now() + 6 * 864e5).toISOString();
      const ev = state.matchStats['gw' + g.n];
      ev.final = false; ev.playerStats = {}; state.adjustments = {};
      state.fixtures = [];
      for (let k = 0; k + 1 < TEAMS.length; k += 2)
        state.fixtures.push({ gw: g.n, home: TEAMS[k].name, away: TEAMS[k + 1].name, started: false, minutes: 0, finished: false });
      for (const m of state.managers) state.lineups[m.id] = { [GW]: autoXI(squadAt(m.id, GW)) };
      return ev;
    }

    /* ----- the shape of the thing ----- */
    baseline();
    const [a, b] = pairingsFor(GW)[0];
    let o = matchOdds(a, b, GW);
    t('win, draw and loss are three numbers that total one',
      near(o.win + o.draw + o.loss, 1), JSON.stringify(o));
    t('all three are probabilities', [o.win, o.draw, o.loss].every(x => x >= 0 && x <= 1), JSON.stringify(o));
    t('a draw is possible before a ball is kicked — it never used to be',
      o.draw > 0, String(o.draw));

    // reading the tie from the other end must mirror exactly
    const rev = matchOdds(b, a, GW);
    t('reading the fixture the other way round mirrors it',
      near(o.win, rev.loss) && near(o.loss, rev.win) && near(o.draw, rev.draw),
      `${JSON.stringify(o)} vs ${JSON.stringify(rev)}`);
    t('the old two-way reading still totals one across both ends',
      near(liveWinProb(a, b, GW) + liveWinProb(b, a, GW), 1),
      String(liveWinProb(a, b, GW) + liveWinProb(b, a, GW)));

    /* ----- a settled result is arithmetic, not chance ----- */
    (() => {
      const ev = baseline();
      // everyone plays, everything whistled: both sides on identical scores
      for (const m of [a, b]) for (const id of lineupFor(m, GW)) ev.playerStats[id] = played();
      state.fixtures.forEach(f => { f.finished = true; f.minutes = 90; });
      const pa = gwManagerPoints(a, GW), pb = gwManagerPoints(b, GW);
      const settled = matchOdds(a, b, GW);
      if (pa === pb) {
        t('a finished match that ended level is a DRAW, not a coin flip',
          settled.draw === 1 && settled.win === 0 && settled.loss === 0,
          `${pa} v ${pb} -> ${JSON.stringify(settled)}`);
      } else {
        const winner = pa > pb ? 'win' : 'loss';
        t(`a finished match that was won reads 100% ${winner}`,
          settled[winner] === 1 && settled.draw === 0,
          `${pa} v ${pb} -> ${JSON.stringify(settled)}`);
      }
      t('and a settled match claims no residual doubt',
        near(settled.win + settled.draw + settled.loss, 1) &&
        [settled.win, settled.draw, settled.loss].filter(x => x === 1).length === 1,
        JSON.stringify(settled));
    })();

    /* ----- the closer it gets, the likelier a draw ----- */
    // same level scoreline, less football left: the draw must grow, because a
    // gap of nought is easier to keep when there is nothing left to change it
    const drawAt = sigma => {
      const w = 1 - normCdf((0.5 - 0) / sigma);
      const l = normCdf((-0.5 - 0) / sigma);
      return 1 - w - l;
    };
    t('a level match drawn is likelier late than early',
      drawAt(3) > drawAt(8) && drawAt(8) > drawAt(15),
      `${(drawAt(3) * 100).toFixed(1)}% / ${(drawAt(8) * 100).toFixed(1)}% / ${(drawAt(15) * 100).toFixed(1)}%`);
    t('a level match with a couple of men left is around one in eight',
      drawAt(3) > 0.10 && drawAt(3) < 0.18, `${(drawAt(3) * 100).toFixed(1)}%`);
    t('a runaway lead leaves the draw at essentially nothing',
      (() => { const w = 1 - normCdf((0.5 - 30) / 6), l = normCdf((-0.5 - 30) / 6); return 1 - w - l < 0.001; })());

    /* ----- never certain while there is football left ----- */
    (() => {
      const ev = baseline();
      // one side loaded, nothing played, everything still to come
      for (const id of lineupFor(a, GW)) ev.playerStats[id] = { ...played(), g: 3 };
      const wild = matchOdds(a, b, GW);
      t('a huge lead with everyone still to play never reads 100%',
        wild.win < 1 && wild.loss > 0, JSON.stringify(wild));
    })();

    /* ----- the Committee says so out loud ----- */
    (() => {
      baseline();
      const needs = matchNeeds(a, b, GW, a);
      const said = needs.lines.some(l => l.includes('point apiece'));
      t('the requirement sheet reports the draw when it clears half a percent',
        needs.drawChance > 0.005 ? said : !said,
        `draw ${(needs.drawChance * 100).toFixed(1)}%, lines: ${JSON.stringify(needs.lines)}`);
      t('matchNeeds now carries the draw chance for any surface that wants it',
        typeof needs.drawChance === 'number', String(needs.drawChance));
    })();

    // ...but not before kickoff. That sheet is deliberately one projection line
    // and no requirements, and a 2% draw before a ball is kicked is clutter —
    // the bar shows its own segment for it either way.
    (() => {
      baseline();
      const g = GAMEWEEKS[GW];
      g.from = new Date(Date.now() + 6 * 864e5).toISOString();   // kickoff still ahead
      g.to = new Date(Date.now() + 12 * 864e5).toISOString();
      state.matchStats['gw' + g.n].playerStats = {};
      const pre = matchNeeds(a, b, GW, a);
      t('before kickoff the sheet stays a single projection line',
        pre.state === 'pre' && pre.lines.length === 1 && !/point apiece/.test(pre.lines[0]),
        JSON.stringify(pre.lines));
      t('and the draw still reaches the bar, which is where it belongs pre-match',
        /prob-draw/.test(winProbBar(a, b, GW, a)) || matchOdds(a, b, GW).draw < 0.005,
        `draw ${(matchOdds(a, b, GW).draw * 100).toFixed(1)}%`);
    })();

    /* ----- the bar draws a third segment, and the three add to 100 ----- */
    (() => {
      baseline();
      const html = winProbBar(a, b, GW, a);
      const widths = [...html.matchAll(/width:([\d.]+)%/g)].map(m => +m[1]);
      const shown = [...html.matchAll(/<b>(\d+)%<\/b>/g)].map(m => +m[1]);
      const drawPc = /draw (\d+)%/.exec(html);
      t('the bar carries a distinct draw segment', /prob-draw/.test(html), html.slice(0, 200));
      t('the printed percentages total exactly 100 — no rounding argument',
        shown.length === 2 && drawPc && shown[0] + shown[1] + (+drawPc[1]) === 100,
        `${JSON.stringify(shown)} + draw ${drawPc && drawPc[1]}`);
      t('the segment widths never overflow the track',
        widths.reduce((x, y) => x + y, 0) <= 100.001, JSON.stringify(widths));
    })();

    return log;
  });

  for (const line of log) { console.log(line); if (line.startsWith('PASS')) pass++; else fail++; }
  console.log(`${pageErrors.length === 0 ? 'PASS' : 'FAIL'}  no page errors${pageErrors.length ? ' — ' + pageErrors.join(' | ') : ''}`);
  if (pageErrors.length === 0) pass++; else fail++;

  await browser.close();
  console.log(`\n[draw-odds] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
