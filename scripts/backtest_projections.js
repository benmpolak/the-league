#!/usr/bin/env node
/* Score the projection model against what actually happened.
 *
 * Marc, 6 Sept 2026: "now you have 3 weeks of data, what lessons have you
 * learned about the projection model... in general the projections seem too
 * low" — and then, correctly, when the first answer came back as totals:
 * "surely you need to take this down a level on either a team by team or
 * player by player basis to be meaningful". He was right. A total that nets
 * out proves nothing, because the two halves of this model are wrong in
 * opposite directions and cancel.
 *
 * We do not archive projections. We do not need to: the FEED is committed on
 * every refresh, so the inputs as they stood at each deadline are recoverable
 * from git. This rewinds data/ to the last refresh BEFORE a deadline, runs
 * TODAY's model over it, and scores it against the settled result. The model
 * is the variable and the evidence is fixed, so a change to the model can be
 * measured rather than argued about.
 *
 * Deliberately reports no single number. Bias (are we too low?) and accuracy
 * (are we close?) are different questions, and this model can be unbiased and
 * badly wrong at the same time — which at GW2 is exactly what it was.
 *
 *   npm run backtest              # every settled gameweek
 *   npm run backtest -- 2 3       # just these
 *
 * Needs a browser (the model lives in js/app.js, which is a browser script):
 *   CHROME_BIN=/path/to/chrome npm run backtest
 */
'use strict';
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.BACKTEST_PORT || 8757);
// stderr ignored: asking for a file the feed did not carry that day is an
// expected answer, not a fault — lineups.json did not exist until 24 Aug
const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'ignore'] });
const sum = a => a.reduce((t, x) => t + x, 0);
const avg = a => (a.length ? sum(a) / a.length : 0);
const f = (x, d = 2) => Number(x).toFixed(d);

// the deadlines, straight out of the schedule the app itself runs on
function deadlines() {
  const src = fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8');
  const m = src.match(/const GAMEWEEKS_RAW\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error('could not read GAMEWEEKS_RAW out of js/data.js');
  return JSON.parse(m[1]).map(g => ({ n: g.n, deadline: g.deadline }));
}

// A gameweek is scoreable once it has stats AND every game of it has been
// blown. FPL's own `finished` flag can sit unflipped well past a Monday night
// (see roundBlown in js/app.js), so the whistle is what we go on — otherwise
// the most recent round, the one anybody actually wants scored, is the one
// this refuses to look at.
function settled() {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/stats.json'), 'utf8'));
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/fixtures.json'), 'utf8'));
  return Object.entries(s.gws || {})
    .filter(([n, g]) => {
      if (!Object.keys(g.stats || {}).length) return false;
      const round = fx.filter(x => x.gw === Number(n));
      return round.length > 0 && round.every(x => x.finished || x.fp);
    })
    .map(([n]) => Number(n));
}

const FEED = ['data.json', 'stats.json', 'fixtures.json', 'teamnews.json', 'lineups.json', 'highlights.json'];

// one served copy of the site per gameweek, each with the feed as it stood at
// that deadline. The app is today's; only the evidence rewinds.
function buildSnapshot(dir, gwN, deadline) {
  const commit = git('rev-list', '-1', `--before=${deadline}`, 'HEAD', '--', 'data/data.json')
    .toString().trim();
  if (!commit) throw new Error(`no feed commit before the GW${gwN} deadline — history does not go back that far`);
  const d = path.join(dir, `s${gwN}`);
  fs.mkdirSync(path.join(d, 'data'), { recursive: true });
  for (const f2 of ['index.html', 'manifest.json']) {
    try { fs.copyFileSync(path.join(ROOT, f2), path.join(d, f2)); } catch { /* optional */ }
  }
  for (const sub of ['js', 'css', 'icons']) {
    try { fs.cpSync(path.join(ROOT, sub), path.join(d, sub), { recursive: true }); } catch { /* optional */ }
  }
  for (const name of FEED) {
    let body = '{}';
    try { body = git('show', `${commit}:data/${name}`).toString(); } catch { /* absent that day */ }
    fs.writeFileSync(path.join(d, 'data', name), body);
  }
  // the settled result, for marking the homework
  fs.copyFileSync(path.join(ROOT, 'data/stats.json'), path.join(d, 'actual-stats.json'));
  return { commit, at: git('log', '-1', '--format=%ad', '--date=iso', commit).toString().trim() };
}

async function collect(browser, gwN) {
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(`http://127.0.0.1:${PORT}/s${gwN}/?sandbox&nosync`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof PLAYERS !== 'undefined' && PLAYERS.length > 100);
  const out = await page.evaluate(async n => {
    const i = n - 1;
    const said = PLAYERS.map(p => ({
      id: p.id, name: p.name, pos: p.pos, team: p.team,
      xp: playerXp(p),            // what he is worth per appearance
      sc: startChance(p, i),      // and how likely he was to be out there
      fx: teamFixturesInGw(p.team, n).length,
    }));
    const act = await (await fetch('actual-stats.json?t=' + Date.now())).json();
    const ps = (act.gws && act.gws[n] && act.gws[n].stats) || {};
    return said.map(r => {
      const s = ps[r.id];
      return { ...r, actual: s ? statPoints(PLAYER_BY_ID[r.id], s) : 0,
        mins: s ? s.min || 0 : 0, started: !!(s && s.st) };
    });
  }, gwN);
  await page.close();
  return out;
}

/* ---------- the report ---------- */
const proj = x => x.xp * x.sc * x.fx;
const POOL = 180;   // roughly the men twelve squads of fourteen are drawn from
const FIELDED = 132; // and the men they would actually field: twelve XIs

function report(all) {
  console.log('\n=== 1. BIAS — are the projections too low? ===');
  console.log('The draftable pool: the top ' + POOL + ' by expectation each week.');
  console.log('gw   projected   actual   bias');
  for (const { gw, rows } of all) {
    const pool = rows.filter(x => x.fx > 0).sort((a, b) => b.xp - a.xp).slice(0, POOL);
    const P = sum(pool.map(proj)), A = sum(pool.map(x => x.actual));
    console.log(`GW${String(gw).padEnd(2)} ${f(P, 0).padStart(9)} ${f(A, 0).padStart(8)}  ${f(A - P, 0).padStart(5)}   (${f(A / P)}x)`);
  }

  console.log('\n=== 2. ACCURACY — and are they CLOSE? ===');
  console.log('Bias can be nil while every single line is wrong, so this is the');
  console.log('question that matters. Beat the naive predictors or go home.');
  console.log('gw    model MAE   "everyone gets 2"   no start model   correl');
  for (const { gw, rows } of all) {
    const pool = rows.filter(x => x.fx > 0).sort((a, b) => b.xp - a.xp).slice(0, POOL);
    const mae = p => avg(pool.map(x => Math.abs(p(x) - x.actual)));
    const P = pool.map(proj), A = pool.map(x => x.actual);
    const mp = avg(P), ma = avg(A);
    const r = avg(pool.map((x, k) => (P[k] - mp) * (A[k] - ma)))
      / (Math.sqrt(avg(P.map(x => (x - mp) ** 2))) * Math.sqrt(avg(A.map(x => (x - ma) ** 2))) || 1);
    console.log(`GW${String(gw).padEnd(2)} ${f(mae(proj)).padStart(10)} ${f(mae(() => 2)).padStart(19)} ${f(mae(x => x.xp * x.fx)).padStart(16)} ${f(r).padStart(8)}`);
  }

  console.log('\n=== 3. THE TWO HALVES, for the men a league would FIELD ===');
  console.log('Availability and scoring can be wrong in opposite directions and');
  console.log('flatter each other in the total. Kept apart, they cannot.');
  console.log('gw   said start   did start   said pts   scored (of those who played)');
  for (const { gw, rows } of all) {
    const xi = rows.filter(x => x.fx > 0).sort((a, b) => proj(b) - proj(a)).slice(0, FIELDED);
    const played = xi.filter(x => x.mins > 0);
    console.log(`GW${String(gw).padEnd(2)} ${f(avg(xi.map(x => x.sc))).padStart(10)} ${f(xi.filter(x => x.started).length / xi.length).padStart(11)} ${f(avg(xi.map(x => x.xp))).padStart(10)} ${f(avg(played.map(x => x.actual))).padStart(12)}`);
  }

  console.log('\n=== 4. CALIBRATION BY LEVEL ===');
  console.log('Of the men we projected at X, what did they actually return?');
  const pooled = all.flatMap(({ rows }) => rows.filter(x => x.fx > 0).sort((a, b) => b.xp - a.xp).slice(0, POOL));
  console.log('projected      n     said   actually got');
  for (const [lo, hi] of [[0, 1], [1, 2], [2, 3], [3, 4], [4, 6], [6, 999]]) {
    const b = pooled.filter(x => proj(x) >= lo && proj(x) < hi);
    if (!b.length) continue;
    const label = hi === 999 ? '6+   ' : `${lo}-${hi}  `;
    console.log(`${label}     ${String(b.length).padStart(5)}  ${f(avg(b.map(proj))).padStart(7)}  ${f(avg(b.map(x => x.actual))).padStart(12)}`);
  }
  console.log('\nA reminder before anyone retunes anything: three gameweeks is a');
  console.log('small sample, and fitting the model to it is the same mistake the');
  console.log('Crystal Ball was making. Come back when the season has grown.');
}

(async () => {
  const puppeteer = require('puppeteer-core');
  const want = process.argv.slice(2).map(Number).filter(Boolean);
  const done = settled();
  const gws = (want.length ? want : done).filter(n => done.includes(n));
  if (!gws.length) {
    console.error(`Nothing settled to score${want.length ? ' among ' + want.join(', ') : ''}. Settled so far: ${done.join(', ') || 'none'}.`);
    process.exit(1);
  }
  const dl = Object.fromEntries(deadlines().map(g => [g.n, g.deadline]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backtest-'));
  let server;
  try {
    for (const n of gws) {
      const s = buildSnapshot(dir, n, dl[n]);
      console.log(`GW${n}: feed as of ${s.at} (${s.commit.slice(0, 7)})`);
    }
    server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: dir, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
    const all = [];
    for (const n of gws) all.push({ gw: n, rows: await collect(browser, n) });
    await browser.close();
    report(all);
    if (process.env.BACKTEST_JSON) {
      fs.writeFileSync(process.env.BACKTEST_JSON, JSON.stringify(all));
      console.log(`\nraw rows written to ${process.env.BACKTEST_JSON}`);
    }
  } finally {
    if (server) server.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
