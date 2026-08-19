/* Chairman's scoring-law pins (Toby, 5 Aug 2026).
 * These use the shared production kernel directly: the browser/server parity
 * suite separately proves app.js uses identical arithmetic. */
'use strict';

const Engine = require('../js/engine.js');

const players = [
  { id: 1, pos: 'GK' },
  { id: 2, pos: 'DF' },
  { id: 3, pos: 'MF' },
  { id: 4, pos: 'FW' },
];
const eng = Engine.make({ players, gameweeks: [{ n: 1, from: '2026-08-14T18:00:00Z', to: '2026-08-18T23:00:00Z' }] });
const sc = { ...Engine.DEFAULT_SCORING };
let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (ok) pass++; else fail++;
};
const pts = (pos, stats, skipAppearance = false) => eng.statPoints(sc, players.find(p => p.pos === pos), stats, skipAppearance);

chk('canonical own goal is -3', sc.ownGoal === -3, `got ${sc.ownGoal}`);
chk('canonical red card is -5', sc.red === -5, `got ${sc.red}`);
chk('canonical penalty save is +5', sc.penSave === 5, `got ${sc.penSave}`);
chk('canonical penalty miss is -3', sc.penMiss === -3, `got ${sc.penMiss}`);

chk('one yellow scores -1', pts('MF', { min: 90, yc: 1 }, true) === -1);
chk('two yellows without a dismissal score -2', pts('MF', { min: 90, yc: 2 }, true) === -2);
chk('direct red scores -5', pts('MF', { min: 90, rc: 1 }, true) === -5);
chk('two yellows plus red are capped at -5, not -7', pts('MF', { min: 90, yc: 2, rc: 1 }, true) === -5);
chk('own goal scores -3', pts('FW', { min: 90, og: 1 }, true) === -3);
chk('penalty save scores +5', pts('GK', { min: 90, ps: 1 }, true) === 5);
chk('penalty miss scores -3', pts('FW', { min: 90, pm: 1 }, true) === -3);

// The feed supplies player-specific cs/gc. A substituted defender's clean
// sheet stays after a later team concession; a dismissed defender continues
// to inherit later concessions, exactly as the official source reports it.
chk('subbed after 60: earned clean sheet stays locked', pts('DF', { min: 65, st: 1, cs: 1, gc: 0 }) === 6);
chk('sent off after 60: clean sheet still pays if the team never concedes', pts('DF', { min: 65, st: 1, cs: 1, gc: 0, rc: 1 }) === 1);
chk('sent off: later two concessions remove CS and cost another point', pts('DF', { min: 65, st: 1, cs: 0, gc: 2, rc: 1 }) === -4);
chk('under 60 never earns clean-sheet points', pts('DF', { min: 59, st: 1, cs: 1, gc: 0 }) === 2);

// Per-fixture rows matter: a yellow in one DGW match and a second-yellow red
// in the other produce -1 + -5, while appearance points remain additive.
chk('DGW cards are capped per fixture, not across the week', pts('MF', {
  min: 180, st: 2, yc: 3, rc: 1,
  fx: [{ min: 90, yc: 1 }, { min: 90, yc: 2, rc: 1 }],
}) === -2); // 4 appearance - 1 yellow - 5 red

// Established players keep a meaningful current-market signal: identical
// League production, but a £10m valuation gap, must create exactly a 66-point
// Rate gap (10 × 12-point price scale × permanent 55% valuation weight —
// the market slightly outranks last season's points, Ben 18 Aug).
const ratingPlayers = [
  { id: 11, code: 11, pos: 'MF', price: 5 },
  { id: 12, code: 12, pos: 'MF', price: 15 },
];
const sameHistory = { mp: 1800, g: 8, a: 8, cs: 6 };
const ratingEng = Engine.make({
  players: ratingPlayers,
  gameweeks: [{ n: 1, from: '2026-08-14T18:00:00Z', to: '2026-08-18T23:00:00Z' }],
  lastSeasonByCode: { 11: sameHistory, 12: sameHistory },
});
const valuationGap = ratingEng.rating(ratingPlayers[1]) - ratingEng.rating(ratingPlayers[0]);
chk('established-player Rate includes 55% current FPL valuation',
  Engine.RATING_HISTORY_WEIGHT === 0.45 && valuationGap === 66, `gap ${valuationGap}`);

console.log(`\n[scoring] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
