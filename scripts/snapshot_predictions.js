#!/usr/bin/env node
/* Record what the projection actually said, at the deadline, once per round.
 *
 * Marc, 15 Sept 2026: "why dont you just take a snapshot at the gameweek
 * deadline and keep it alongside the live predictor and the final score so we
 * can see it for every archived game individually."
 *
 * He is right, and for a reason worth writing down. The Prediction Accuracy
 * card can REBUILD a past round — wind the season back and ask matchOdds()
 * again — but a rebuild always re-derives with TODAY'S model. Improve the
 * projection next month and every past round silently changes with it. A
 * recorded number is what the Committee actually claimed, and it cannot move.
 *
 * So this runs in the window between a deadline passing and the first kickoff,
 * reads the live app's own matchOdds() for that round's six ties, and writes
 * them to data/predictions.json. Same promise as teamnews.json: the open round
 * is written once, and a round already in the ledger is never touched again.
 *
 * It drives the real site in a headless browser rather than reimplementing the
 * projection, for the same reason the card calls matchOdds() instead of copying
 * it — a second implementation would drift, and then the ledger would be
 * recording something no manager ever saw. Same trick as run_waivers.js.
 *
 * Which round to capture is decided HERE, in node, off data the page hands
 * back, so the rule can be tested without a browser in the room. The page is
 * asked to do only the one thing that needs it.
 *
 * It writes nothing unless it has every tie with odds that compute, and fails
 * loudly rather than committing half a round: a missing round can still be
 * rebuilt afterwards, a wrong one is wrong forever.
 *
 *   node scripts/snapshot_predictions.js            capture if a round is due
 *   node scripts/snapshot_predictions.js --dry      report, write nothing
 *   SNAPSHOT_URL=... to point somewhere other than the live site
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'predictions.json');

/* A round is capturable between its deadline and its first kickoff. Before the
   deadline a manager can still change an XI, so the snapshot would be of a team
   nobody fielded; after kickoff the odds have started moving and it is no
   longer a prediction. FPL's deadline sits 90 minutes before the first match,
   which is the whole window — a job on a 20-minute cron lands in it several
   times over and the first to arrive is the one that counts. */
const KICKOFF_GRACE_MS = 5 * 60000; // never capture a round already under way

/* The decision, as a pure function of what the page can tell us. Returns the
   round to capture, or the reason there isn't one. `already` is the set of
   round numbers the ledger holds: those are closed forever. */
function chooseRound({ gameweeks, fixtures, already = [], now = Date.now(), grace = KICKOFF_GRACE_MS, regular = Infinity }) {
  const seen = new Set((already || []).map(String));
  for (let i = 0; i < Math.min(regular, gameweeks.length); i++) {
    const gw = gameweeks[i];
    if (seen.has(String(gw.n))) continue;                // written once, never again
    const deadline = new Date(gw.deadline || gw.from).getTime();
    if (!Number.isFinite(deadline)) continue;
    if (now < deadline) continue;                        // not yet: XIs can still change
    const kicks = fixtures.filter(f => f.gw === gw.n)
      .map(f => new Date(f.date).getTime()).filter(Number.isFinite);
    if (!kicks.length) continue;                         // no calendar for it yet
    const firstKick = Math.min(...kicks);
    if (now > firstKick - grace) continue;               // under way, or played: too late
    return { index: i, n: gw.n, deadline };
  }
  return null;
}

function readLedger(file = OUT) {
  try {
    const book = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (book && typeof book === 'object' && !Array.isArray(book)) return book;
  } catch { /* first run, or a file we cannot read: start clean */ }
  return {};
}

const NOTE = 'What the projection said at each deadline, recorded once and never revised. '
  + 'Written by scripts/snapshot_predictions.js; a round already here is never touched again. '
  + 'w/d/l are the first-named side\'s win, draw and loss chances; pa/pb the projected scores. '
  + 'Do not edit by hand.';

/* Fold one captured round into the ledger. Refuses a round already present and
   refuses a round whose odds do not add up, because half a record is worse
   than none — a missing round can still be rebuilt, a wrong one cannot. */
function addRound(book, shot) {
  const rounds = book.rounds || (book.rounds = {});
  if (rounds[String(shot.n)]) throw Error(`GW${shot.n} is already in the ledger`);
  if (!Array.isArray(shot.games) || !shot.games.length) throw Error(`GW${shot.n} came back with no ties`);
  for (const g of shot.games) {
    if (!Number.isFinite(g.a) || !Number.isFinite(g.b)) throw Error(`GW${shot.n}: a tie with no sides`);
    if (![g.w, g.d, g.l].every(Number.isFinite)) throw Error(`GW${shot.n}: odds did not compute for ${g.a} v ${g.b}`);
    if (Math.abs(g.w + g.d + g.l - 1) > 0.01) throw Error(`GW${shot.n}: odds for ${g.a} v ${g.b} do not total one`);
  }
  const sides = shot.games.flatMap(g => [g.a, g.b]);
  if (new Set(sides).size !== sides.length) throw Error(`GW${shot.n}: a manager appears in two ties`);
  book.note = NOTE;
  rounds[String(shot.n)] = { deadline: shot.deadline, taken: shot.taken, games: shot.games };
  return book;
}

async function main() {
  const puppeteer = require('puppeteer-core');
  const SITE = process.env.SNAPSHOT_URL || 'https://theleaguehq.co.uk/';
  const DRY = process.argv.includes('--dry');
  const chromePath = process.env.CHROME_BIN
    || (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

  const book = readLedger();
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
          && Object.keys(state.matchStats || {}).length > 0
          && Array.isArray(state.fixtures) && state.fixtures.length > 0,
        { timeout: 60000, polling: 1000 });
    } catch {
      throw Error('league state or score feed did not become ready');
    }

    const world = await page.evaluate(() => ({
      phase: state.phase,
      regular: REGULAR_GWS,
      managers: state.managers.length,
      gameweeks: GAMEWEEKS.map(g => ({ n: g.n, deadline: g.deadline || g.from })),
      fixtures: state.fixtures.map(f => ({ gw: f.gw, date: f.date })),
    }));
    if (world.phase !== 'season') { console.log(JSON.stringify({ skipped: `phase is ${world.phase}` })); return; }

    const target = chooseRound({
      gameweeks: world.gameweeks, fixtures: world.fixtures,
      already: Object.keys(book.rounds || {}), regular: world.regular,
    });
    if (!target) { console.log(JSON.stringify({ skipped: 'no round sitting between its deadline and its first kickoff' })); return; }

    const games = await page.evaluate(i => pairingsFor(i).map(([a, b]) => {
      const o = matchOdds(a, b, i);
      return { a, b,
        w: +o.win.toFixed(4), d: +o.draw.toFixed(4), l: +o.loss.toFixed(4),
        pa: projectedGwScore(a, i), pb: projectedGwScore(b, i) };
    }), target.index);
    if (games.length !== world.managers / 2) throw Error(`expected ${world.managers / 2} ties, got ${games.length}`);

    addRound(book, {
      n: target.n,
      deadline: new Date(target.deadline).toISOString().replace(/\.\d+Z$/, 'Z'),
      taken: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      games,
    });
    if (DRY) { console.log(JSON.stringify({ wouldRecord: target.n, ties: games.length, games }, null, 2)); return; }
    fs.writeFileSync(OUT, JSON.stringify(book) + '\n', 'utf8');
    console.log(`recorded GW${target.n}: ${games.length} ties, deadline ${target.deadline}`);
  } finally {
    await browser.close();
  }
}

module.exports = { chooseRound, addRound, readLedger, KICKOFF_GRACE_MS, NOTE, OUT };

if (require.main === module) {
  main().catch(e => { console.error('[snapshot]', e.message); process.exit(1); });
}
