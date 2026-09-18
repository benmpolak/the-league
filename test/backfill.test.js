/* Freezing the rounds that were never captured (Marc, 18 Sept 2026: "why does
 * the prediction tracker keep changing, that shouldnt be possible").
 *
 * The whole value of this is that a frozen round CANNOT move, so that is what
 * gets attacked here — along with the two ways freezing could do harm:
 *   - clobbering a real deadline capture with a reconstruction
 *   - letting a reconstruction pass itself off as a record
 * The second is the one that matters to the league. A frozen wrong number that
 * claims to be what the Committee said is worse than an honest moving one.
 *
 * Node only, no browser. Usage: node test/backfill.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { addRound, NOTE } = require('../scripts/snapshot_predictions.js');

let passed = 0;
const check = (name, fn) => {
  try { fn(); console.log('PASS ' + name); passed++; }
  catch (e) { console.log('FAIL ' + name + ' — ' + e.message); process.exitCode = 1; }
};

const games = [
  { a: 1, b: 2, w: 0.5, d: 0.1, l: 0.4, pa: 44, pb: 41 },
  { a: 3, b: 4, w: 0.3, d: 0.12, l: 0.58, pa: 39, pb: 46 },
];

check('a rebuilt round is written, and says it was rebuilt', () => {
  const book = addRound({}, { n: 1, deadline: 'd', taken: 't', games, rebuilt: true });
  assert.strictEqual(book.rounds['1'].rebuilt, true);
  assert.strictEqual(book.rounds['1'].games.length, 2);
});
check('a deadline capture is NOT marked rebuilt', () => {
  const book = addRound({}, { n: 6, deadline: 'd', taken: 't', games });
  assert.strictEqual('rebuilt' in book.rounds['6'], false, 'a real capture must not carry the rebuilt flag');
});
/* The one that protects the record. The backfill runs over "every settled
   round"; if it ever reached a round the deadline job had already caught, it
   would replace a real claim with a reconstruction of it — and nobody would
   know, because both end up as six frozen ties. */
check('a reconstruction can never overwrite a real deadline capture', () => {
  const book = addRound({}, { n: 6, deadline: 'real', taken: 'then', games });
  assert.throws(() => addRound(book, { n: 6, deadline: 'x', taken: 'now', games, rebuilt: true }),
    /already in the ledger/);
  assert.strictEqual(book.rounds['6'].deadline, 'real');
  assert.strictEqual('rebuilt' in book.rounds['6'], false);
});
check('and running the backfill twice changes nothing the second time', () => {
  const book = addRound({}, { n: 1, deadline: 'd', taken: 't', games, rebuilt: true });
  const before = JSON.stringify(book);
  assert.throws(() => addRound(book, { n: 1, deadline: 'd', taken: 't2', games, rebuilt: true }));
  assert.strictEqual(JSON.stringify(book), before);
});
/* GW1 predates teamnews.json, so its rebuild was scored against whatever the
   treatment room looked like on the day it was rebuilt. That caveat has to
   survive into the file, or the card cannot print it and the number quietly
   becomes a claim it has not earned. */
check('a round with no team news of its own is flagged in the ledger', () => {
  const book = addRound({}, { n: 1, deadline: 'd', taken: 't', games, rebuilt: true, newsGap: true });
  assert.strictEqual(book.rounds['1'].newsGap, true);
});
check('a rebuilt round that DOES have its news is not flagged', () => {
  const book = addRound({}, { n: 3, deadline: 'd', taken: 't', games, rebuilt: true, newsGap: false });
  assert.strictEqual(book.rounds['3'].newsGap, false);
});
check('the ledger note explains what a rebuilt round is', () => {
  const book = addRound({}, { n: 1, deadline: 'd', taken: 't', games, rebuilt: true });
  assert.ok(/rebuilt/.test(book.note), 'the note never mentions rebuilt rounds');
  assert.ok(/reconstructed/.test(NOTE));
});
// a reconstruction is held to exactly the same arithmetic as a capture
check('a rebuilt round with impossible odds is refused like any other', () => {
  assert.throws(() => addRound({}, { n: 1, deadline: 'd', taken: 't', rebuilt: true,
    games: [{ a: 1, b: 2, w: 0.9, d: 0.9, l: 0.9 }] }), /do not total one/);
});
check('and a rebuilt round with a manager in two ties is refused', () => {
  assert.throws(() => addRound({}, { n: 1, deadline: 'd', taken: 't', rebuilt: true,
    games: [games[0], { a: 1, b: 9, w: 0.5, d: 0.1, l: 0.4 }] }), /two ties/);
});

/* ----- the script itself ----- */
const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'backfill_predictions.js'), 'utf8');
check('it only ever freezes a round that has actually settled', () => {
  assert.ok(/gwStatus\(i\) !== 'final'/.test(src),
    'nothing stops it freezing a round still being played');
});
check('it skips rounds the ledger already holds before touching them', () => {
  assert.ok(/skip\.includes\(String\(n\)\)/.test(src), 'the already-recorded guard is gone');
});
check('it rebuilds through the app\'s own wind-back, not a copy of it', () => {
  assert.ok(/withAsOf\(i,/.test(src), 'not using withAsOf — a rebuild that can see the result is worthless');
  assert.ok(/matchOdds\(a, b, i\)/.test(src), 'not using the real matchOdds');
});
check('it stays out of the playoffs', () => {
  assert.ok(/REGULAR_GWS/.test(src));
});
check('it writes one file and only one file', () => {
  const writes = [...src.matchAll(/writeFileSync\(([^,]+)/g)].map(m => m[1].trim());
  assert.deepStrictEqual(writes, ['OUT'], `it writes to: ${writes.join(', ')}`);
});
check('it refuses a short round rather than writing half of one', () => {
  assert.ok(/expected \$\{shots\.managers \/ 2\} ties/.test(src), 'no completeness check');
});

console.log(`\n[backfill] ${passed} passed, ${process.exitCode ? 'some' : 0} failed`);
