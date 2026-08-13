/* The Committee's waiver clock v2 (Committee, 12 Aug 2026), pinned: waivers
 * process at 10:00 Europe/London every TUESDAY and FRIDAY — fixed days, no
 * longer chasing the fixture list. The Chairman may skip ONE named run by
 * exception (waiverMeta.skip); claims stay lodged and roll to the next run.
 * Trough closed from 90 minutes before a gameweek's first kick-off until the
 * first run AFTER its last fixture has executed. Includes the DST trap: 10am
 * London is 09:00Z in August, 10:00Z in December. Slots exist only from the
 * 13 Aug 2026 cutover epoch, so the lookback can never resurrect the old
 * fixture-anchored ids. */
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
// 2026 calendar: 14 Aug Fri, 18 Aug Tue, 21 Aug Fri, 15 Dec Tue.
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
let NOW = iso('2026-08-14T12:00:00Z');
const eng = Engine.make({ players: [], gameweeks: GWS, fixtures: FIXTURES, lastSeasonByCode: {}, now: () => NOW });
const state = seasonState => ({ phase: 'season', waiverMeta: { lastRun: null, control: 'auto' }, ...seasonState });

/* ---- run times: Tue & Fri 10:00 London ---- */
chk('next slot from Saturday is Tuesday 10am London = 09:00Z (BST)',
  eng.nextSlotAt(iso('2026-08-15T12:00:00Z')) === iso('2026-08-18T09:00:00Z'),
  new Date(eng.nextSlotAt(iso('2026-08-15T12:00:00Z'))).toISOString());
chk('next slot from just after Tuesday\'s run is Friday',
  eng.nextSlotAt(iso('2026-08-18T09:00:01Z')) === iso('2026-08-21T09:00:00Z'));
chk('a slot at exactly 10am is not its own successor (strictly after)',
  eng.nextSlotAt(iso('2026-08-18T09:00:00Z')) === iso('2026-08-21T09:00:00Z'));
chk('December honours GMT: 10am London = 10:00Z',
  eng.nextSlotAt(iso('2026-12-13T18:00:00Z')) === iso('2026-12-15T10:00:00Z'),
  new Date(eng.nextSlotAt(iso('2026-12-13T18:00:00Z'))).toISOString());
chk('the epoch guard: no slots before 13 Aug 2026, first ever run is Fri 14 Aug',
  eng.nextSlotAt(iso('2026-08-01T00:00:00Z')) === iso('2026-08-14T09:00:00Z'));
chk('gwClearAt: the run that clears GW1 (last kick Sun) is Tuesday\'s',
  eng.gwClearAt(0) === iso('2026-08-18T09:00:00Z'), new Date(eng.gwClearAt(0)).toISOString());
chk('gwClearAt December (GMT): GW3 clears Tue 15 Dec 10:00Z',
  eng.gwClearAt(2) === iso('2026-12-15T10:00:00Z'));
chk('nextWaiverRun from mid-GW1 is the Tuesday run',
  eng.nextWaiverRun(iso('2026-08-16T12:00:00Z')).getTime() === iso('2026-08-18T09:00:00Z'));

/* ---- slot ids: London wall date, round-trippable ---- */
chk('slot id is the London wall date', eng.waiverSlotId(iso('2026-08-18T09:00:00Z')) === 'wv-2026-08-18');
chk('slot id round-trips back to its run time',
  eng.slotAtFromId('wv-2026-08-18') === iso('2026-08-18T09:00:00Z')
  && eng.slotAtFromId('wv-2026-12-15') === iso('2026-12-15T10:00:00Z'));
chk('garbage ids resolve to null', eng.slotAtFromId('gw1-post') === null && eng.slotAtFromId(null) === null);

/* ---- trough window ---- */
const S = state({});
NOW = iso('2026-08-15T10:59:00Z'); // 91 min before GW1's first kick
chk('trough open until 90 min before first kick-off', eng.troughWindow(S).open === true);
NOW = iso('2026-08-15T11:01:00Z'); // 89 min before
chk('trough closes 90 min before first kick-off', eng.troughWindow(S).open === false);
NOW = iso('2026-08-16T17:00:00Z'); // gameweek underway
chk('trough closed while the gameweek plays', eng.troughWindow(S).open === false && /underway/.test(eng.troughWindow(S).why));
NOW = iso('2026-08-17T19:30:00Z'); // Monday night: GW done, Tuesday's run still ahead
chk('trough closed until Tuesday\'s run, countdown pointing at it',
  eng.troughWindow(S).open === false && eng.troughWindow(S).until === iso('2026-08-18T09:00:00Z'));
NOW = iso('2026-08-18T09:30:00Z'); // Tuesday 10am passed, run NOT executed
chk('trough stays closed awaiting the run', eng.troughWindow(S).open === false && /awaiting/.test(eng.troughWindow(S).why));
const ran = state({ waiverMeta: { lastRun: '2026-08-18T09:00:05Z', control: 'auto' } });
chk('trough reopens once the run has executed', eng.troughWindow(ran).open === true);
chk('a SKIPPED clearing run keeps the trough shut — claims must not be jumped',
  eng.troughWindow(state({ waiverMeta: { lastRun: null, control: 'auto', skip: 'wv-2026-08-18' } })).open === false);
NOW = iso('2026-08-21T09:30:05Z'); // Friday's run executed instead
chk('the NEXT run (Friday) reopens it',
  eng.troughWindow(state({ waiverMeta: { lastRun: '2026-08-21T09:00:05Z', control: 'auto' } })).open === true);
NOW = iso('2026-08-22T10:30:00Z'); // 60 min before GW2 first kick
chk('trough closes again before the next gameweek', eng.troughWindow(ran).open === false);

/* ---- due schedule (deterministic ids, bounded lookback, epoch-guarded) ---- */
NOW = iso('2026-08-13T12:00:00Z'); // after cutover, before the first slot
let due = eng.waiverSchedule();
chk('nothing due before the first post-epoch slot (deploy day is quiet)', due.length === 0, JSON.stringify(due));
NOW = iso('2026-08-18T09:05:00Z');
due = eng.waiverSchedule();
chk('Tuesday\'s run due just after 10am, newest last; Friday\'s missed run still surfaces (lookback)',
  due.length === 2 && due[0].id === 'wv-2026-08-14' && due[1].id === 'wv-2026-08-18', JSON.stringify(due));
chk('waiverRunDue false once lastRun covers the slots',
  eng.waiverRunDue(state({ waiverMeta: { lastRun: '2026-08-18T09:06:00Z', control: 'auto' } })) === false);
chk('waiverRunDue true while a slot is uncovered', eng.waiverRunDue(S) === true);
chk('manual control suppresses scheduled dueness',
  eng.waiverRunDue(state({ waiverMeta: { lastRun: null, control: 'open' } })) === false);

/* ---- the Chairman's one-shot skip ---- */
chk('a skipped slot is not due',
  eng.waiverRunDue(state({ waiverMeta: { lastRun: '2026-08-14T09:06:00Z', control: 'auto', skip: 'wv-2026-08-18' } })) === false);
NOW = iso('2026-08-21T09:05:00Z');
chk('the run AFTER a skipped slot is due as normal',
  eng.waiverRunDue(state({ waiverMeta: { lastRun: '2026-08-14T09:06:00Z', control: 'auto', skip: 'wv-2026-08-18' } })) === true);
// a real run spends a skip that is now behind it (manual run-now must not
// leave a stale skip suppressing next week's run)
const bare = { phase: 'season', managers: [], draft: { order: [] }, claims: {}, transfers: [], lineups: {}, matchStats: {},
  waiverMeta: { lastRun: null, control: 'auto', skip: 'wv-2026-08-18' } };
chk('resolveWaivers clears a skip its run has overtaken',
  eng.resolveWaivers(bare, iso('2026-08-21T09:00:01Z')).stampedMeta.skip === null);
chk('resolveWaivers keeps a skip still in the future',
  eng.resolveWaivers({ ...bare, waiverMeta: { ...bare.waiverMeta, skip: 'wv-2026-08-25' } }, iso('2026-08-21T09:00:01Z')).stampedMeta.skip === 'wv-2026-08-25');

/* ---- the run a Skip must target (sol launch audit P1, 13 Aug): the hourly
   tick fires at :07, so between 10:00 and execution the due run is still LIVE.
   A Skip pressed at 10:03 must stamp the due run, not the following one. ---- */
const tueRan = state({ waiverMeta: { lastRun: '2026-08-18T09:06:00Z', control: 'auto' } });
NOW = iso('2026-08-21T09:03:00Z'); // Friday 10:03 London: due, not yet executed
chk('10:03 window: the processable run is FRIDAY\'s, still owed by the tick',
  eng.nextProcessableWaiverRun(tueRan).getTime() === iso('2026-08-21T09:00:00Z'),
  eng.nextProcessableWaiverRun(tueRan).toISOString());
chk('...and its slot id is Friday\'s (the exact id a Skip at 10:03 must stamp)',
  eng.waiverSlotId(eng.nextProcessableWaiverRun(tueRan).getTime()) === 'wv-2026-08-21');
NOW = iso('2026-08-21T08:59:00Z'); // one minute before the deadline
chk('09:59: same answer from the future side of the deadline',
  eng.nextProcessableWaiverRun(tueRan).getTime() === iso('2026-08-21T09:00:00Z'));
NOW = iso('2026-08-21T09:10:00Z'); // Friday's run executed at :07
chk('once the run executes, the processable run rolls to Tuesday',
  eng.nextProcessableWaiverRun(state({ waiverMeta: { lastRun: '2026-08-21T09:07:00Z', control: 'auto' } })).getTime() === iso('2026-08-25T09:00:00Z'));
NOW = iso('2026-08-30T12:00:00Z'); // outage: three slots owed since the 18th
chk('after an outage the OLDEST owed slot leads (the server processes it first)',
  eng.nextProcessableWaiverRun(tueRan).getTime() === iso('2026-08-21T09:00:00Z'));
NOW = iso('2026-08-18T09:05:00Z'); // never run at all
chk('never-run league: the first post-epoch slot is the processable one',
  eng.nextProcessableWaiverRun(state({})).getTime() === iso('2026-08-14T09:00:00Z'));

/* ---- no fixture data: trough stays open; the clock ticks regardless ---- */
NOW = iso('2026-08-18T09:05:00Z');
const bareEng = Engine.make({ players: [], gameweeks: GWS, fixtures: [], lastSeasonByCode: {}, now: () => NOW });
chk('no fixtures: trough open, but Tue/Fri slots exist anyway (fixed clock)',
  bareEng.troughWindow(S).open === true && bareEng.waiverSchedule().length === 2);

/* ---- the Simulation Chamber drives the SAME rules on its mock clock (mock
   night, 2 Aug: Marc trough-signed mid-"gameweek" because only real time was
   consulted — never again) ---- */
NOW = iso('2026-08-10T09:00:00Z'); // real clock: pre-season, trough would be open
const mockLive = state({ mock: { gw: 0, phase: 'live', seed: 7, t: iso('2026-08-10T08:50:00Z') } });
chk('mock LIVE closes the trough even though real time says pre-season',
  eng.troughWindow(mockLive).open === false && /simulation/.test(eng.troughWindow(mockLive).why));
const mockFT = state({ mock: { gw: 0, phase: 'final', seed: 7, t: iso('2026-08-10T08:50:00Z') } });
chk('mock FULL TIME keeps the trough shut awaiting the waiver run',
  eng.troughWindow(mockFT).open === false && /awaiting/.test(eng.troughWindow(mockFT).why));
const mockRan = state({ mock: { gw: 0, phase: 'final', seed: 7, t: iso('2026-08-10T08:50:00Z') },
  waiverMeta: { lastRun: '2026-08-10T09:05:00Z', control: 'auto' } });
chk('a waiver run AFTER mock full time reopens the trough',
  eng.troughWindow(mockRan).open === true);
chk('mock LIVE pushes transfers to the NEXT gameweek (no mid-sim landings)',
  eng.transferGw(mockLive) === 1 && eng.transferGw(state({})) === 0,
  `mock=${eng.transferGw(mockLive)} plain=${eng.transferGw(state({}))}`);
chk('mock FULL TIME still clamps transfers after its waiver run has completed',
  eng.transferGw(mockRan) === 1,
  `mock-final-post-run=${eng.transferGw(mockRan)}`);

console.log(`\n[waiverclock] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
