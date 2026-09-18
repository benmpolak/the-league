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
 * Which round to capture is decided in node off the checkout's own calendar, so
 * the rule can be tested without a browser in the room and costs nothing to ask.
 * The page is handed a round NUMBER and finds its own index, so the ledger can
 * never depend on our calendar and the app's being in step.
 *
 * It writes nothing unless it has every tie with odds that compute, and fails
 * loudly rather than committing half a round: a missing round can still be
 * rebuilt afterwards, a wrong one is wrong forever.
 *
 * It costs almost nothing to run and nothing to run often. Whether a round is
 * due is decided from data/data.json, data/fixtures.json and the ledger — all
 * of them already in the checkout — so an off-window pass is a few milliseconds
 * of node and exits before Chrome is ever started. The browser opens twice a
 * week, inside the window, and not otherwise. That is why this hangs off the
 * FPL refresh instead of carrying a schedule of its own: that job already runs
 * every five minutes, and it is already the one that catches the perishable
 * team news at the deadline. This is the same problem with the same answer.
 *
 *   node scripts/snapshot_predictions.js            capture if a round is due
 *   node scripts/snapshot_predictions.js --due      say whether one is, and stop
 *   node scripts/snapshot_predictions.js --dry      capture, print, write nothing
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
   which is the whole window — the five-minute refresh this rides on passes
   through it around twenty times, and the first one to arrive is the only one
   that does any work. */
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

/* Is a round due, decided entirely from the checkout? The calendar and the
   fixtures are shipped data and the ledger is next to them, so this answers
   without a network call, a browser, or the live league — which is what makes
   it cheap enough to ask every five minutes off the back of the FPL refresh. */
function dueFromDisk(now = Date.now(), root = ROOT) {
  let gameweeks, fixtures;
  try {
    gameweeks = JSON.parse(fs.readFileSync(path.join(root, 'data', 'data.json'), 'utf8')).gameweeks;
    fixtures = JSON.parse(fs.readFileSync(path.join(root, 'data', 'fixtures.json'), 'utf8'));
  } catch (e) {
    return null; // no calendar to read: the refresh that owns those files will say so
  }
  if (!Array.isArray(gameweeks) || !Array.isArray(fixtures)) return null;
  // REGULAR_GWS is the app's to know, not ours — the page refuses a playoff
  // round on its own, so this does not carry a second copy of that number
  const ledger = readLedger(path.join(root, 'data', 'predictions.json'));
  return chooseRound({ gameweeks, fixtures, already: Object.keys(ledger.rounds || {}), now });
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
  + 'A round marked "rebuilt" was not captured at its deadline: it was reconstructed afterwards '
  + 'by scripts/backfill_predictions.js and frozen, so that it stops moving. '
  + 'Do not edit by hand.';

/* Fold one captured round into the ledger. Refuses a round already present and
   refuses a round whose odds do not add up, because half a record is worse
   than none — a missing round can still be rebuilt, a wrong one cannot.

   `rebuilt` marks a round that was reconstructed after the fact rather than
   caught at its deadline (Marc, 18 Sept 2026: "why does the prediction tracker
   keep changing, that shouldnt be possible"). Freezing a reconstruction stops
   it drifting, but it is NOT the same thing as a record, and the ledger says
   which is which so the card can too. */
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
  rounds[String(shot.n)] = { deadline: shot.deadline, taken: shot.taken, games: shot.games,
    ...(shot.rebuilt ? { rebuilt: true, newsGap: !!shot.newsGap } : {}) };
  return book;
}

async function main() {
  const SITE = process.env.SNAPSHOT_URL || 'https://theleaguehq.co.uk/';
  const DRY = process.argv.includes('--dry');
  const chromePath = process.env.CHROME_BIN
    || (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

  /* The cheap question first, and it needs nothing but the checkout: no
     network, no browser, and — deliberately — no node_modules, because the FPL
     refresh this rides on does not install any. --due answers in an EXIT CODE
     so a shell can gate the install on it: 0 a round is due, 1 none is. */
  const due = dueFromDisk();
  if (process.argv.includes('--due')) {
    if (due) console.log(`GW${due.n} is due: its deadline has passed and its first game has not started`);
    else console.log('nothing due');
    process.exitCode = due ? 0 : 1;
    return;
  }
  if (!due) { console.log(JSON.stringify({ skipped: 'no round sitting between its deadline and its first kickoff' })); return; }

  const puppeteer = require('puppeteer-core');
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

    // The round is named by NUMBER, and the page finds its own index: the
    // ledger must never depend on our calendar and the app's being in step.
    const shot = await page.evaluate(n => {
      if (state.phase !== 'season') return { skip: `phase is ${state.phase}` };
      const i = GAMEWEEKS.findIndex(g => g.n === n);
      if (i < 0) return { skip: `the app has no GW${n}` };
      if (i >= REGULAR_GWS) return { skip: 'the playoffs are not the league season' };
      const games = pairingsFor(i).map(([a, b]) => {
        const o = matchOdds(a, b, i);
        return { a, b,
          w: +o.win.toFixed(4), d: +o.draw.toFixed(4), l: +o.loss.toFixed(4),
          pa: projectedGwScore(a, i), pb: projectedGwScore(b, i) };
      });
      return { games, managers: state.managers.length };
    }, due.n);
    if (shot.skip) { console.log(JSON.stringify({ skipped: shot.skip })); return; }
    const games = shot.games;
    if (games.length !== shot.managers / 2) throw Error(`expected ${shot.managers / 2} ties, got ${games.length}`);

    addRound(book, {
      n: due.n,
      deadline: new Date(due.deadline).toISOString().replace(/\.\d+Z$/, 'Z'),
      taken: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      games,
    });
    if (DRY) { console.log(JSON.stringify({ wouldRecord: due.n, ties: games.length, games }, null, 2)); return; }
    fs.writeFileSync(OUT, JSON.stringify(book) + '\n', 'utf8');
    console.log(`recorded GW${due.n}: ${games.length} ties, deadline ${new Date(due.deadline).toISOString()}`);
  } finally {
    await browser.close();
  }
}

module.exports = { chooseRound, addRound, readLedger, dueFromDisk, KICKOFF_GRACE_MS, NOTE, OUT };

if (require.main === module) {
  main().catch(e => { console.error('[snapshot]', e.message); process.exit(1); });
}
