// The whistle settlement and its guard rail (sol's settlement round, Aug 2026).
// roundBlown: a round settles at last kick-off + 150 minutes once every
// fixture has blown full time — and NOT before, NOT with a straggler, NOT
// with a club missing. unsettledPlayedRound: the waiver runner's refusal
// predicate — a round that by the clock should long since have settled but
// is not final means the feed has regressed, and adjudicating claims on it
// would allocate players in the wrong order, irreversibly.
// Usage: node test/settlement.test.js
'use strict';
const path = require('path');
const Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  if (ok) pass++;
  else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const MIN = 60000;
const KICK = Date.UTC(2026, 7, 24, 19, 0); // last game kicks off 19:00
const GRACE = 150 * MIN;

// a two-club round is a full round when the pool knows only two clubs
const PLAYERS = [
  { id: 1, code: 101, name: 'A GK', team: 'Alpha', pos: 'GK' },
  { id: 2, code: 102, name: 'B GK', team: 'Beta', pos: 'GK' },
];
const GAMEWEEKS = [
  { n: 1, label: 'Gameweek 1', from: '2026-08-21T17:30:00Z', to: '2026-08-28T17:30:00Z', finished: false },
  { n: 2, label: 'Gameweek 2', from: '2026-08-28T17:30:00Z', to: '2026-09-04T17:30:00Z', finished: false },
];
const fx = (over = {}) => ({ id: 1, gw: 1, date: new Date(KICK).toISOString(), home: 'Alpha', away: 'Beta', finished: false, fp: true, ...over });

const eng = (nowMs, fixtures) => Engine.make({
  players: PLAYERS, gameweeks: GAMEWEEKS, fixtures,
  lastSeasonByCode: {}, now: () => nowMs,
});
const stateWith = stats => ({
  phase: 'season',
  managers: [{ id: 1 }, { id: 2 }],
  draft: { order: [1, 2], picks: [] },
  transfers: [],
  matchStats: stats,
  fixtures: undefined, // the engine must live off ctx fixtures alone
});
const synced = final => ({ gw1: { gw: 0, label: 'Gameweek 1', final, playerStats: { 1: { min: 90, st: 1 } } } });

/* ---- roundBlown: the boundary, to the millisecond (sol P3) ---- */
{
  const s = stateWith(synced(false));
  chk('one minute short of the grace: not blown',
    eng(KICK + GRACE - MIN, [fx()]).roundBlown(s, 0) === false);
  chk('exactly at last kick-off + 150 minutes: blown',
    eng(KICK + GRACE, [fx()]).roundBlown(s, 0) === true);
  chk('a millisecond past: still blown',
    eng(KICK + GRACE + 1, [fx()]).roundBlown(s, 0) === true);
  chk('gwStatus reads final off the whistle alone (event flag still false)',
    eng(KICK + GRACE, [fx()]).gwStatus(s, 0) === 'final');
}

/* ---- roundBlown refuses partial rounds ---- */
{
  const s = stateWith(synced(false));
  chk('a straggler without full time holds the round open, however late the clock',
    eng(KICK + GRACE + 24 * 60 * MIN, [fx({ fp: false })]).roundBlown(s, 0) === false);
  chk('a club missing from the fixture list (postponement) holds the round open',
    eng(KICK + GRACE, [fx({ away: 'Alpha' })]).roundBlown(s, 0) === false);
  chk('no fixtures at all: nothing to blow',
    eng(KICK + GRACE, []).roundBlown(s, 0) === false);
}

/* ---- unsettledPlayedRound: the waiver refusal predicate (sol P1) ---- */
{
  const now = KICK + GRACE + 60 * MIN; // an hour after settlement was due
  chk('healthy settled round (all fp): no refusal',
    eng(now, [fx()]).unsettledPlayedRound(stateWith(synced(false))) === null);
  chk('feed regression (an fp flips back) on a played round: refusal names it',
    eng(now, [fx({ fp: false })]).unsettledPlayedRound(stateWith(synced(false))) === 0);
  chk('FPL ratification (event final) clears the refusal even with the flag down',
    eng(now, [fx({ fp: false })]).unsettledPlayedRound(stateWith(synced(true))) === null);
  chk('round not yet due to settle (inside the grace): no refusal',
    eng(KICK + GRACE - MIN, [fx({ fp: false })]).unsettledPlayedRound(stateWith(synced(false))) === null);
  // sol round 2's bypass: a played round whose stats map came back EMPTY
  // drops out of the table exactly like a regressed flag — refuse it too
  chk('played round with an empty stats map: refusal (sol r2 bypass)',
    eng(now, [fx()]).unsettledPlayedRound(stateWith({ gw1: { gw: 0, final: false, playerStats: {} } })) === 0);
  chk('played round with no stats object at all: refusal',
    eng(now, [fx({ fp: false })]).unsettledPlayedRound(stateWith({})) === 0);
  // the regression window itself: settled → regressed → restored
  const healthy = eng(now, [fx()]);
  const regressed = eng(now, [fx({ fp: false })]);
  const s = stateWith(synced(false));
  chk('the full P1 arc: final → refusal while regressed → final again',
    healthy.gwStatus(s, 0) === 'final'
      && regressed.gwStatus(s, 0) === 'live'
      && regressed.unsettledPlayedRound(s) === 0
      && healthy.gwStatus(s, 0) === 'final');
}

console.log(`\n[settlement] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
