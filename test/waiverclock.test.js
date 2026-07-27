/* The Committee's fixture-anchored waiver clock (Toby, Jul 2026), pinned:
 * post-run 8pm Europe/London the day AFTER a gameweek's last fixture, pre-run
 * 8pm the day BEFORE the next gameweek's first fixture, Trough closed from
 * 90 minutes before first kick-off until the post-run has executed. Includes
 * the DST trap: 8pm London is 19:00Z in August, 20:00Z in December. */
'use strict';
const path = require('path');
const Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  if (ok) pass++; else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};
const iso = s => new Date(s).getTime();

// August gameweek (BST): GW1 Sat 15 Aug 12:30Z .. Sun 16 Aug 15:30Z kick-offs;
// GW2 starts Sat 22 Aug 11:30Z. December gameweek (GMT): GW3 Sat 12 Dec.
const FIXTURES = [
  { id: 1, gw: 1, date: '2026-08-15T12:30:00Z', home: 'A', away: 'B' },
  { id: 2, gw: 1, date: '2026-08-16T15:30:00Z', home: 'C', away: 'D' },
  { id: 3, gw: 2, date: '2026-08-22T11:30:00Z', home: 'A', away: 'C' },
  { id: 4, gw: 2, date: '2026-08-23T15:30:00Z', home: 'B', away: 'D' },
  { id: 5, gw: 3, date: '2026-12-12T15:00:00Z', home: 'A', away: 'D' },
  { id: 6, gw: 3, date: '2026-12-13T16:30:00Z', home: 'B', away: 'C' },
];
const GWS = [
  { n: 1, label: 'GW1', from: '2026-08-15T11:00:00Z', to: '2026-08-16T18:00:00Z' },
  { n: 2, label: 'GW2', from: '2026-08-22T10:00:00Z', to: '2026-08-23T18:00:00Z' },
  { n: 3, label: 'GW3', from: '2026-12-12T13:30:00Z', to: '2026-12-13T18:00:00Z' },
];
let NOW = iso('2026-08-10T09:00:00Z');
const eng = Engine.make({ players: [], gameweeks: GWS, fixtures: FIXTURES, lastSeasonByCode: {}, now: () => NOW });
const state = seasonState => ({ phase: 'season', waiverMeta: { lastRun: null, control: 'auto' }, ...seasonState });

/* ---- run times ---- */
chk('post-run: 8pm London the day after GW1\'s last (Sunday) fixture = Mon 17 Aug 19:00Z (BST)',
  eng.postRunAt(0) === iso('2026-08-17T19:00:00Z'), new Date(eng.postRunAt(0)).toISOString());
chk('pre-run: 8pm London the day before GW2\'s first (Saturday) fixture = Fri 21 Aug 19:00Z (BST)',
  eng.preRunAt(1) === iso('2026-08-21T19:00:00Z'), new Date(eng.preRunAt(1)).toISOString());
chk('December post-run honours GMT: day after Sun 13 Dec = Mon 14 Dec 20:00Z',
  eng.postRunAt(2) === iso('2026-12-14T20:00:00Z'), new Date(eng.postRunAt(2)).toISOString());
chk('nextWaiverRun from mid-GW1 is the Monday post-run',
  eng.nextWaiverRun(iso('2026-08-16T12:00:00Z')).getTime() === iso('2026-08-17T19:00:00Z'));
chk('nextWaiverRun after the post-run is the Friday pre-run',
  eng.nextWaiverRun(iso('2026-08-17T20:00:00Z')).getTime() === iso('2026-08-21T19:00:00Z'));

/* ---- trough window ---- */
const S = state({});
NOW = iso('2026-08-15T10:59:00Z'); // 91 min before GW1's first kick
chk('trough open until 90 min before first kick-off', eng.troughWindow(S).open === true);
NOW = iso('2026-08-15T11:01:00Z'); // 89 min before
chk('trough closes 90 min before first kick-off', eng.troughWindow(S).open === false);
NOW = iso('2026-08-16T17:00:00Z'); // gameweek underway
chk('trough closed while the gameweek plays', eng.troughWindow(S).open === false && /underway/.test(eng.troughWindow(S).why));
NOW = iso('2026-08-17T19:30:00Z'); // post-run time passed, run NOT executed
chk('trough stays closed awaiting the post-run', eng.troughWindow(S).open === false && /awaiting/.test(eng.troughWindow(S).why));
const ran = state({ waiverMeta: { lastRun: '2026-08-17T19:00:05Z', control: 'auto' } });
chk('trough reopens once the post-run has executed', eng.troughWindow(ran).open === true);
NOW = iso('2026-08-22T10:30:00Z'); // 60 min before GW2 first kick
chk('trough closes again before the next gameweek', eng.troughWindow(ran).open === false);

/* ---- due schedule (deterministic ids, bounded lookback) ---- */
NOW = iso('2026-08-17T19:05:00Z');
let due = eng.waiverSchedule();
chk('post-run due just after 8pm, newest last (ledger ids make replays exactly-once)',
  due.length >= 1 && due[due.length - 1].id === 'gw1-post', JSON.stringify(due));
NOW = iso('2026-08-21T19:05:00Z');
due = eng.waiverSchedule();
chk('pre-run due Friday evening; a run missed days earlier still surfaces (14-day lookback, sol 5.6)',
  due[due.length - 1].id === 'gw2-pre' && due.some(d => d.id === 'gw1-post'), JSON.stringify(due));
chk('waiverRunDue false once lastRun covers the slot',
  eng.waiverRunDue(state({ waiverMeta: { lastRun: '2026-08-21T19:06:00Z', control: 'auto' } })) === false);
chk('waiverRunDue true while the slot is uncovered', eng.waiverRunDue(S) === true);
chk('manual control suppresses scheduled dueness',
  eng.waiverRunDue(state({ waiverMeta: { lastRun: null, control: 'open' } })) === false);

/* ---- no fixture data: everything stays open and quiet ---- */
const bare = Engine.make({ players: [], gameweeks: GWS, fixtures: [], lastSeasonByCode: {}, now: () => NOW });
chk('no fixtures: trough open, nothing due', bare.troughWindow(S).open === true && bare.waiverSchedule().length === 0);

console.log(`\n[waiverclock] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
