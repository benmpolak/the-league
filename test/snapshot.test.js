/* The deadline-snapshot rule (Marc, 15 Sept 2026: "take a snapshot at the
 * gameweek deadline").
 *
 * The capture window is the only thing standing between a real record and a
 * worthless one. Too early and a manager can still change an XI, so we would
 * record a team nobody fielded. Too late and the football has started, so it
 * is not a prediction any more — it is a scoreboard. The window is the 90
 * minutes FPL leaves between its deadline and the first kickoff.
 *
 * Node only, no browser. Usage: node test/snapshot.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chooseRound, addRound, dueFromDisk, KICKOFF_GRACE_MS } = require('../scripts/snapshot_predictions.js');

let passed = 0;
const check = (name, fn) => {
  try { fn(); console.log('PASS ' + name); passed++; }
  catch (e) { console.log('FAIL ' + name + ' — ' + e.message); process.exitCode = 1; }
};

const H = 3600000;
const DEADLINE = Date.parse('2026-09-19T17:30:00Z');
const KICK = DEADLINE + 1.5 * H;             // FPL's 90 minutes
const gameweeks = [
  { n: 5, deadline: '2026-09-12T17:30:00Z' },
  { n: 6, deadline: '2026-09-19T17:30:00Z' },
  { n: 7, deadline: '2026-09-26T17:30:00Z' },
];
const fixtures = [
  { gw: 5, date: '2026-09-12T19:00:00Z' },
  { gw: 6, date: new Date(KICK).toISOString() },
  { gw: 6, date: new Date(KICK + 2 * H).toISOString() },   // the later kickoffs
  { gw: 6, date: new Date(KICK + 20 * H).toISOString() },  // must not widen it
  { gw: 7, date: '2026-09-26T19:00:00Z' },
];
const at = (now, already = ['5']) => chooseRound({ gameweeks, fixtures, already, now, regular: 38 });

check('inside the window, the open round is captured', () => {
  assert.strictEqual(at(DEADLINE + 20 * 60000)?.n, 6);
});
check('the moment the deadline passes counts as inside it', () => {
  assert.strictEqual(at(DEADLINE + 1)?.n, 6);
});
check('before the deadline nothing is captured — an XI can still change', () => {
  assert.strictEqual(at(DEADLINE - 60000), null);
});
check('on the deadline itself, nothing yet', () => {
  assert.strictEqual(at(DEADLINE - 1), null);
});
check('once the first kickoff is near, the chance has gone', () => {
  assert.strictEqual(at(KICK - KICKOFF_GRACE_MS + 1000), null);
  assert.strictEqual(at(KICK), null);
});
check('and it does not come back later in the round', () => {
  assert.strictEqual(at(KICK + 6 * H), null);
  assert.strictEqual(at(KICK + 5 * 24 * H), null);
});
// the whole window, minute by minute, is either open or shut — no gaps
check('the window is continuous from the deadline to the kickoff grace', () => {
  const open = [];
  for (let t = DEADLINE - 10 * 60000; t < KICK + 10 * 60000; t += 60000) open.push(at(t) ? 1 : 0);
  const first = open.indexOf(1), last = open.lastIndexOf(1);
  assert.ok(first > 0, 'window never opened');
  assert.ok(open.slice(first, last + 1).every(x => x === 1), 'window had a hole in it');
  assert.strictEqual(open.slice(0, first).some(x => x), false);
  assert.strictEqual(open.slice(last + 1).some(x => x), false);
  // and it is about the length FPL leaves us
  assert.ok(last - first > 60 && last - first < 100, `window was ${last - first} minutes`);
});
check('a round already in the ledger is closed forever', () => {
  assert.strictEqual(chooseRound({ gameweeks, fixtures, already: ['5', '6'], now: DEADLINE + 20 * 60000, regular: 38 }), null);
});
check('a round with no fixtures on the calendar is left alone', () => {
  assert.strictEqual(chooseRound({ gameweeks, fixtures: fixtures.filter(f => f.gw !== 6), already: ['5'], now: DEADLINE + 20 * 60000, regular: 38 }), null);
});
check('the playoffs are not the league season and are never captured', () => {
  assert.strictEqual(chooseRound({ gameweeks, fixtures, already: ['5'], now: DEADLINE + 20 * 60000, regular: 1 }), null);
});
check('an older uncaptured round is picked up before a newer one', () => {
  // GW5 was missed; at GW5's own window it, not GW6, is the one that is due
  const r = chooseRound({ gameweeks, fixtures, already: [], now: Date.parse('2026-09-12T18:00:00Z'), regular: 38 });
  assert.strictEqual(r?.n, 5);
});
check('a gameweek with an unreadable deadline is skipped, not crashed on', () => {
  const r = chooseRound({ gameweeks: [{ n: 6, deadline: 'not a date' }], fixtures, already: [], now: Date.now(), regular: 38 });
  assert.strictEqual(r, null);
});

/* ----- what gets written ----- */
const goodGames = [
  { a: 1, b: 2, w: 0.5, d: 0.1, l: 0.4, pa: 44, pb: 41 },
  { a: 3, b: 4, w: 0.3, d: 0.12, l: 0.58, pa: 39, pb: 46 },
];
check('a sound round is folded into the ledger', () => {
  const book = addRound({}, { n: 6, deadline: 'd', taken: 't', games: goodGames });
  assert.strictEqual(book.rounds['6'].games.length, 2);
  assert.ok(book.note.includes('never revised'));
});
check('a round already recorded is never overwritten', () => {
  const book = addRound({}, { n: 6, deadline: 'd', taken: 't', games: goodGames });
  assert.throws(() => addRound(book, { n: 6, deadline: 'd2', taken: 't2', games: goodGames }), /already in the ledger/);
  assert.strictEqual(book.rounds['6'].taken, 't');
});
check('odds that do not total one are refused outright', () => {
  assert.throws(() => addRound({}, { n: 6, deadline: 'd', taken: 't',
    games: [{ a: 1, b: 2, w: 0.9, d: 0.9, l: 0.9 }] }), /do not total one/);
});
check('a tie missing its odds is refused', () => {
  assert.throws(() => addRound({}, { n: 6, deadline: 'd', taken: 't',
    games: [{ a: 1, b: 2, w: 0.5, d: 0.1 }] }), /did not compute/);
});
check('a manager appearing in two ties is refused', () => {
  assert.throws(() => addRound({}, { n: 6, deadline: 'd', taken: 't',
    games: [goodGames[0], { a: 1, b: 5, w: 0.5, d: 0.1, l: 0.4 }] }), /two ties/);
});
check('an empty round is refused', () => {
  assert.throws(() => addRound({}, { n: 6, deadline: 'd', taken: 't', games: [] }), /no ties/);
});
check('nothing is half-written: a bad tie leaves the ledger untouched', () => {
  const book = addRound({}, { n: 6, deadline: 'd', taken: 't', games: goodGames });
  const before = JSON.stringify(book);
  assert.throws(() => addRound(book, { n: 7, deadline: 'd', taken: 't',
    games: [{ a: 1, b: 2, w: 0.9, d: 0.9, l: 0.9 }] }));
  assert.strictEqual(JSON.stringify(book), before);
});

/* ----- the check that actually runs, 288 times a day -----
 * It rides the FPL refresh, so it has to answer off the checkout alone: no
 * network, no browser, and no node_modules, because that job installs none.
 * Anything it needs beyond node's own libraries would break the refresh. */
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-'));
fs.mkdirSync(path.join(work, 'data'));
const put = (name, obj) => fs.writeFileSync(path.join(work, 'data', name), JSON.stringify(obj));
put('data.json', { gameweeks });
put('fixtures.json', fixtures);
put('predictions.json', { rounds: {} });

check('off the disk, the window opens and shuts the same way', () => {
  assert.strictEqual(dueFromDisk(DEADLINE - 60000, work), null);
  assert.strictEqual(dueFromDisk(DEADLINE + 60000, work)?.n, 6);
  assert.strictEqual(dueFromDisk(KICK, work), null);
});
check('a round already in that root\'s ledger is closed there too', () => {
  const seen = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-seen-'));
  fs.mkdirSync(path.join(seen, 'data'));
  fs.writeFileSync(path.join(seen, 'data', 'data.json'), JSON.stringify({ gameweeks }));
  fs.writeFileSync(path.join(seen, 'data', 'fixtures.json'), JSON.stringify(fixtures));
  fs.writeFileSync(path.join(seen, 'data', 'predictions.json'), JSON.stringify({ rounds: { 6: { games: [] } } }));
  assert.strictEqual(dueFromDisk(DEADLINE + 60000, seen), null);
});
check('a missing calendar is survived, not thrown on', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-bare-'));
  assert.strictEqual(dueFromDisk(DEADLINE + 60000, bare), null);
});
check('an unparseable calendar is survived too', () => {
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-broken-'));
  fs.mkdirSync(path.join(broken, 'data'));
  fs.writeFileSync(path.join(broken, 'data', 'data.json'), '{ not json');
  fs.writeFileSync(path.join(broken, 'data', 'fixtures.json'), '[]');
  assert.strictEqual(dueFromDisk(DEADLINE + 60000, broken), null);
});
check('the check needs nothing but node itself', () => {
  // the refresh it hangs off installs no dependencies, so requiring one at
  // load time would break the data feed rather than just this
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'snapshot_predictions.js'), 'utf8');
  const top = src.slice(0, src.indexOf('async function main'));
  const requires = [...top.matchAll(/require\('([^']+)'\)/g)].map(m => m[1]);
  assert.deepStrictEqual(requires.sort(), ['fs', 'path'], `top-level requires: ${requires}`);
  assert.ok(/require\('puppeteer-core'\)/.test(src.slice(src.indexOf('async function main'))),
    'the browser should be required inside main, after the due check');
});

console.log(`\n[snapshot] ${passed} passed, ${process.exitCode ? 'some' : 0} failed`);
