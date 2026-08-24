/* The team-news snapshot: the one projection input that cannot be recovered.
 *
 * `chance_of_playing_next_round` is overwritten on every refresh, so once a
 * deadline passes there is no record that a man was ever doubtful before it.
 * scripts/fetch_fpl.py keeps a row per round, refreshed until the deadline and
 * frozen after (Marc, 24 Aug 2026 — the calibration ledger).
 *
 * The behaviour that matters is the FREEZE. A bug here does not throw, it
 * quietly rewrites history with this week's news, and the ledger built on top
 * would then be flattering nonsense. Hence a test that drives the real python.
 *
 * Node only, no browser. Usage: node test/teamnews.test.js
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

const ROOT = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'teamnews-'));
fs.mkdirSync(path.join(work, 'data'), { recursive: true });
fs.mkdirSync(path.join(work, 'scripts'), { recursive: true });
for (const f of ['fetch_fpl.py', 'provisional.py'])
  fs.copyFileSync(path.join(ROOT, 'scripts', f), path.join(work, 'scripts', f));
fs.copyFileSync(path.join(ROOT, 'data', 'provisional.json'), path.join(work, 'data', 'provisional.json'));

// drive the real function with our own clock and players — no network
function run(players, gameweeks, nowIso) {
  const py = `
import sys, json, datetime as dt
sys.path.insert(0, ${JSON.stringify(path.join(work, 'scripts'))})
import fetch_fpl
fetch_fpl.ROOT = __import__('pathlib').Path(${JSON.stringify(work)})
players = json.loads(${JSON.stringify(JSON.stringify(players))})
gws = json.loads(${JSON.stringify(JSON.stringify(gameweeks))})
now = dt.datetime.fromisoformat(${JSON.stringify(nowIso.replace('Z', '+00:00'))}).replace(tzinfo=dt.timezone.utc)
print(fetch_fpl.snapshot_team_news(players, gws, now=now))
`;
  execFileSync('python3', ['-c', py], { encoding: 'utf-8' });
  return JSON.parse(fs.readFileSync(path.join(work, 'data', 'teamnews.json'), 'utf-8'));
}

const GWS = [
  { n: 1, deadline: '2026-08-21T17:30:00Z' },
  { n: 2, deadline: '2026-08-28T17:30:00Z' },
  { n: 3, deadline: '2026-09-04T17:30:00Z' },
];
const squad = (over) => [
  { id: 1, status: 'a', chance: null, news: '' },                                  // unremarkable
  { id: 2, status: 'd', chance: 75, news: 'Knock - 75% chance of playing' },        // the doubt
  { id: 3, status: 'i', chance: 0, news: 'Hamstring' },
  { id: 4, status: 'a', chance: null, news: '' },
  ...(over || []),
];

/* ----- the open round is captured, and only the men worth remembering ----- */
let book = run(squad(), GWS, '2026-08-26T09:00:00Z');   // GW1 gone, GW2 open
chk('the open round is the one written', !!book.rounds['2'] && !book.rounds['1'],
  JSON.stringify(Object.keys(book.rounds)));
chk('it stamps the deadline it was taken against',
  book.rounds['2'].deadline === '2026-08-28T17:30:00Z', book.rounds['2'].deadline);
const flagged = book.rounds['2'].flagged;
chk('a fit man with no news takes no space', !flagged['1'] && !flagged['4'],
  JSON.stringify(Object.keys(flagged)));
chk('the doubt is kept with his percentage',
  flagged['2'] && flagged['2'].s === 'd' && flagged['2'].c === 75, JSON.stringify(flagged['2']));
chk('the injury is kept too', flagged['3'] && flagged['3'].s === 'i', JSON.stringify(flagged['3']));

/* ----- an open round keeps taking the latest word ----- */
book = run(squad([{ id: 5, status: 'd', chance: 50, news: 'Late fitness test' }]), GWS, '2026-08-28T17:00:00Z');
chk('a later run before the deadline overwrites the open round',
  !!book.rounds['2'].flagged['5'], JSON.stringify(Object.keys(book.rounds['2'].flagged)));
chk('and it is still the same round, not a second copy',
  Object.keys(book.rounds).length === 1, JSON.stringify(Object.keys(book.rounds)));
const gw2Taken = book.rounds['2'].taken;
const gw2Flagged = JSON.stringify(book.rounds['2'].flagged);

/* ----- THE FREEZE: once the deadline passes, that round is history ----- */
// the following week everyone is fit again and the news has moved on
const nextWeek = [
  { id: 1, status: 'a', chance: null, news: '' },
  { id: 2, status: 'a', chance: null, news: '' },   // recovered
  { id: 3, status: 'a', chance: null, news: '' },   // recovered
  { id: 9, status: 's', chance: 0, news: 'Suspended' },
];
book = run(nextWeek, GWS, '2026-08-29T09:00:00Z');  // GW2 gone, GW3 open
chk('GW2 is untouched once its deadline has passed',
  JSON.stringify(book.rounds['2'].flagged) === gw2Flagged && book.rounds['2'].taken === gw2Taken,
  JSON.stringify(book.rounds['2'].flagged));
chk('the doubtful man is still recorded as doubtful for GW2, though he is fit now',
  book.rounds['2'].flagged['2'].s === 'd' && book.rounds['2'].flagged['2'].c === 75);
chk('and GW3 opens as its own round', !!book.rounds['3'] && !!book.rounds['3'].flagged['9'],
  JSON.stringify(Object.keys(book.rounds)));
chk('nothing is lost as rounds accumulate', Object.keys(book.rounds).sort().join() === '2,3',
  JSON.stringify(Object.keys(book.rounds)));

/* ----- the end of the season, and other awkward corners ----- */
book = run(squad(), GWS, '2027-07-01T09:00:00Z');   // every deadline behind us
chk('past the last deadline nothing new is written, and nothing is destroyed',
  Object.keys(book.rounds).sort().join() === '2,3', JSON.stringify(Object.keys(book.rounds)));

// a corrupt file must not take the refresh down with it — but it must not
// silently eat a good history either, so this only proves it recovers
fs.writeFileSync(path.join(work, 'data', 'teamnews.json'), '{ this is not json');
let recovered = null;
try {
  recovered = run(squad(), GWS, '2026-08-26T09:00:00Z');
} catch (e) { /* fall through to the check */ }
chk('an unreadable file is rebuilt rather than crashing the whole refresh',
  !!recovered && !!recovered.rounds['2'], recovered ? 'rebuilt' : 'threw');

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n[team-news] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
