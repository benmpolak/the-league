#!/usr/bin/env node
/* Freeze the rounds that were never captured, so they stop moving.
 *
 * Marc, 18 Sept 2026: "why does the prediction tracker keep changing, that
 * shouldnt be possible."
 *
 * He was right. The deadline capture (snapshot_predictions.js) only started at
 * GW5, so every earlier round on the Prediction Accuracy card was being REBUILT
 * from scratch on each page load — and a rebuild reads some inputs that are
 * still live. Measured over thirty hours of ordinary FPL refreshes: ten injury
 * flags moved, eleven availability figures moved, seventeen prices moved, and
 * three of GW1's six ties moved with them, the worst by 5.1 points — 50.8%
 * against 55.9%, which straddles the line where a call flips from one manager
 * to the other. A flipped call flips a tick, and the running total changes.
 *
 * So: rebuild each settled round ONCE, write it to the ledger, and never
 * rebuild it again. From there the card reads a fixed number.
 *
 * What this is NOT: a record of what was said at the time. It is a
 * reconstruction, frozen. Every round it writes is marked `rebuilt` so the card
 * can say so, and rounds that predate the team-news archive (GW1 — the archive
 * starts at GW2) additionally carry `newsGap`, because those were marked
 * against the flags as they stood when this ran, NOT as they stood that
 * Saturday. That is the honest caveat and it must survive into the ledger; a
 * frozen wrong number that claims to be a record is worse than a moving one.
 *
 * It reads the live site the same way the deadline capture does — drives the
 * real page and asks the app's own matchOdds(), so it cannot drift away from
 * what managers actually saw. It signs in as nobody and writes nothing but this
 * one file in the checkout: the league's own data is never touched.
 *
 * A round already in the ledger is never overwritten, so this can never clobber
 * a real deadline capture, and running it twice does nothing the second time.
 *
 *   node scripts/backfill_predictions.js          freeze every settled round
 *   node scripts/backfill_predictions.js --dry    print what it would write
 *   SNAPSHOT_URL=... to point somewhere other than the live site
 */
'use strict';
const fs = require('fs');
const { addRound, readLedger, OUT } = require('./snapshot_predictions.js');

async function main() {
  const SITE = process.env.SNAPSHOT_URL || 'https://theleaguehq.co.uk/';
  const DRY = process.argv.includes('--dry');
  const chromePath = process.env.CHROME_BIN
    || (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

  const puppeteer = require('puppeteer-core');
  const book = readLedger();
  const already = new Set(Object.keys(book.rounds || {}));
  const browser = await puppeteer.launch({
    executablePath: chromePath, headless: 'new', args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    page.on('dialog', d => d.dismiss());
    await page.goto(SITE, { waitUntil: 'networkidle2', timeout: 60000 });
    try {
      await page.waitForFunction(
        () => typeof state !== 'undefined' && typeof cloudKnown !== 'undefined' && cloudKnown
          && Array.isArray(state.managers) && state.managers.length > 1
          && Object.keys(state.matchStats || {}).length > 0,
        { timeout: 60000, polling: 1000 });
    } catch {
      throw Error('league state or score feed did not become ready');
    }

    /* Every settled round of the league season, rebuilt through the app's own
       wind-back. withAsOf is what blinds matchOdds to the football that has
       been played since; asking for it here rather than reimplementing it is
       the same discipline the card itself follows. */
    const shots = await page.evaluate(skip => {
      if (state.phase !== 'season') return { skip: `phase is ${state.phase}` };
      const out = [];
      for (let i = 0; i < Math.min(REGULAR_GWS, GAMEWEEKS.length); i++) {
        const n = GAMEWEEKS[i].n;
        if (skip.includes(String(n))) continue;
        if (gwStatus(i) !== 'final') continue;           // not settled: leave it live
        const games = withAsOf(i, () => pairingsFor(i).map(([a, b]) => {
          const o = matchOdds(a, b, i);
          return { a, b,
            w: +o.win.toFixed(4), d: +o.draw.toFixed(4), l: +o.loss.toFixed(4),
            pa: projectedGwScore(a, i), pb: projectedGwScore(b, i) };
        }));
        out.push({ n, deadline: GAMEWEEKS[i].deadline || GAMEWEEKS[i].from || null,
          games, newsGap: !newsKnownAt(i) });
      }
      return { rounds: out, managers: state.managers.length };
    }, [...already]);
    if (shots.skip) { console.log(JSON.stringify({ skipped: shots.skip })); return; }
    if (!shots.rounds.length) { console.log('nothing to freeze — every settled round is already in the ledger'); return; }

    const taken = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    for (const r of shots.rounds) {
      // the same all-or-nothing rule the deadline capture keeps: a round is
      // written whole or not at all
      if (r.games.length !== shots.managers / 2) {
        throw Error(`GW${r.n}: expected ${shots.managers / 2} ties, got ${r.games.length}`);
      }
      addRound(book, { n: r.n, deadline: r.deadline, taken, games: r.games,
        rebuilt: true, newsGap: r.newsGap });
      console.log(`GW${r.n}: ${r.games.length} ties frozen${r.newsGap ? '  (predates the team-news archive)' : ''}`);
    }
    if (DRY) { console.log(JSON.stringify(book, null, 2)); return; }
    fs.writeFileSync(OUT, JSON.stringify(book) + '\n', 'utf8');
    console.log(`\nwrote ${shots.rounds.length} rebuilt round(s) to data/predictions.json`);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('[backfill]', e.message); process.exit(1); });
}
