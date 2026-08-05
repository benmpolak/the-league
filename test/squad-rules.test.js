/* Constitutional 14-man, one-flex squad law. Pure engine pins run offline so
 * draft, autopick, transfers, trades and waivers cannot drift onto different
 * interpretations of the shape. */
'use strict';
const Engine = require('../js/engine.js');
let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${detail}`}`);
  ok ? pass++ : fail++;
};

const players = [];
let id = 1;
for (const [pos, n] of Object.entries({ GK: 4, DF: 10, MF: 10, FW: 8 })) {
  for (let i = 0; i < n; i++) players.push({ id: id++, code: id, name: `${pos}${i}`, pos, club: `${pos} Club`, team: `${pos} Club`, price: pos === 'FW' ? 12 : 5 });
}
const byPos = pos => players.filter(p => p.pos === pos);
const gameweeks = [{ n: 1, from: '2026-08-21T18:30:00Z', to: '2026-08-24T22:00:00Z' }];
const eng = Engine.make({ players, gameweeks, now: () => new Date('2026-08-20T12:00:00Z').getTime() });
const shape = ({ GK, DF, MF, FW }) => [...byPos('GK').slice(0, GK), ...byPos('DF').slice(0, DF), ...byPos('MF').slice(0, MF), ...byPos('FW').slice(0, FW)];
// Deliberately hostile settings prove the law is code, not editable state.
const baseState = {
  phase: 'draft', managers: [{ id: 1 }],
  settings: { squadSize: 99, posMin: { GK: 0, DF: 0, MF: 0, FW: 0 }, posMax: { GK: 99, DF: 99, MF: 99, FW: 99 }, scoring: {} },
  draft: { order: [1], picks: [] }, transfers: [], autolists: {}, draftPool: { ids: Object.fromEntries(players.map(p => [p.id, p.club])) },
};

chk('squad law is exported as 14 / 1–2 GK / 4–6 DF / 4–6 MF / 2–4 FW',
  JSON.stringify(Engine.SQUAD_RULES) === JSON.stringify({ size: 14, min: { GK: 1, DF: 4, MF: 4, FW: 2 }, max: { GK: 2, DF: 6, MF: 6, FW: 4 } }));
for (const counts of [
  { GK: 2, DF: 5, MF: 4, FW: 3 },
  { GK: 1, DF: 6, MF: 4, FW: 3 },
  { GK: 1, DF: 4, MF: 6, FW: 3 },
  { GK: 1, DF: 4, MF: 5, FW: 4 },
]) chk(`legal one-flex edge ${JSON.stringify(counts)}`, eng.squadShapeOk(baseState, shape(counts)));
for (const counts of [
  { GK: 1, DF: 3, MF: 6, FW: 4 }, // the exact old double-flex hole
  { GK: 1, DF: 4, MF: 7, FW: 2 },
  { GK: 2, DF: 4, MF: 4, FW: 5 },
  { GK: 2, DF: 5, MF: 4, FW: 2 }, // only 13
]) chk(`illegal shape rejected ${JSON.stringify(counts)}`, !eng.squadShapeOk(baseState, shape(counts)));

// An old/hostile partial board has one slot left and still owes a fourth DF.
// A tempting fourth forward must be refused; the legal defender is accepted.
const partial = shape({ GK: 1, DF: 3, MF: 6, FW: 3 });
baseState.draft.picks = partial.map((p, i) => ({ managerId: 1, playerId: p.id, n: i + 1 }));
const freeFw = byPos('FW').find(p => !partial.includes(p));
const freeDf = byPos('DF').find(p => !partial.includes(p));
chk('manual draft pick reserves the last mandatory defender', !eng.canPick(baseState, 1, freeFw) && eng.canPick(baseState, 1, freeDf));
baseState.autolists = { 1: [freeFw.id, freeDf.id] };
chk('autopick skips an illegal double-flex target and takes the legal defender', eng.autoPickChoice(baseState, 1) === freeDf.id);

console.log(`\n[squad-rules] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
