/* When to hold a runner open, and when to go home.
 *
 * Marc, 28 Aug 2026: "why, do i have to do this. you know the timings, surely
 * we can automate it."
 *
 * scripts/matchwatch.py turns data/fixtures.json into a decision: watch now,
 * wait a bit then watch, or exit. Getting it wrong is expensive in both
 * directions — hold a runner all week and it is idle for nothing; go home
 * during a match and the feed is stale exactly when the league is looking at
 * it, which is what happened on 28 Aug.
 *
 * These are the real GW2 kickoff times from the live feed.
 *
 * Node only, no browser, no network. Usage: node test/matchwatch.test.js
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

// the real GW2 card, Friday night through Monday night
const GW2 = [
  { gw: 2, home: 'Crystal Palace', away: 'Man City', date: '2026-08-28T19:00:00Z' },
  { gw: 2, home: 'Liverpool', away: "Nott'm Forest", date: '2026-08-29T11:30:00Z' },
  { gw: 2, home: 'Bournemouth', away: 'Everton', date: '2026-08-29T14:00:00Z' },
  { gw: 2, home: 'Coventry City', away: 'Hull City', date: '2026-08-29T14:00:00Z' },
  { gw: 2, home: 'Spurs', away: 'Newcastle', date: '2026-08-29T16:30:00Z' },
  { gw: 2, home: 'Chelsea', away: 'Brighton', date: '2026-08-30T13:00:00Z' },
  { gw: 2, home: 'Man Utd', away: 'Ipswich Town', date: '2026-08-30T15:30:00Z' },
  { gw: 2, home: 'Aston Villa', away: 'Arsenal', date: '2026-08-31T19:00:00Z' },
];

// run the planner against a fixture list at a pretended moment
function planAt(fixtures, nowIso, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-'));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'fixtures.json'), JSON.stringify(fixtures));
  const script = `
import json, sys, datetime
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts'))})
import matchwatch as mw
fx = json.load(open(${JSON.stringify(path.join(dir, 'data', 'fixtures.json'))}))
now = datetime.datetime.fromisoformat(${JSON.stringify(nowIso)}.replace('Z', '+00:00'))
print(json.dumps(mw.plan(fx, now)))
`;
  const out = execFileSync('python3', ['-c', script], {
    cwd: ROOT, encoding: 'utf-8', env: { ...process.env, ...env },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return JSON.parse(out.trim());
}

// ---- the moment it all went wrong ----
// 19:42Z on the 28th: Palace v City forty minutes in, feed three hours stale
{
  const p = planAt(GW2, '2026-08-28T19:42:00Z');
  chk('mid-match, it watches', p.action === 'watch', JSON.stringify(p));
  chk('and stays until well after the whistle',
    Date.parse(p.until) >= Date.parse('2026-08-28T21:30:00Z'),
    p.until);
}

// ---- team news, an hour before kickoff, is the most valuable fetch ----
{
  const p = planAt(GW2, '2026-08-28T18:00:00Z');
  chk('an hour before kickoff it is already watching', p.action === 'watch', JSON.stringify(p));
}
{
  // two hours out: too early to watch, close enough to be worth waiting for
  const p = planAt(GW2, '2026-08-28T17:20:00Z');
  chk('two hours out it waits rather than holding a pointless loop',
    p.action === 'wait', JSON.stringify(p));
  chk('and it waits for the right moment (kickoff minus 75)',
    p.start === '2026-08-28T17:45:00+00:00', p.start);
}

// ---- the whole Saturday card is ONE window, not five sittings ----
{
  const p = planAt(GW2, '2026-08-29T11:00:00Z');
  chk('Saturday morning: watching', p.action === 'watch', JSON.stringify(p));
  chk('the 11:30, 14:00 and 16:30 kickoffs merge into one unbroken window',
    Date.parse(p.until) >= Date.parse('2026-08-29T19:00:00Z'), p.until);
  // the gap between the 14:00s ending and the 16:30 starting must NOT be a
  // reason to go home — that is exactly the hole a naive per-fixture loop leaves
  const gap = planAt(GW2, '2026-08-29T15:45:00Z');
  chk('and the lull between kickoffs never drops the watch',
    gap.action === 'watch', JSON.stringify(gap));
}

// ---- and it must NOT squat on a runner when there is no football ----
{
  const p = planAt(GW2, '2026-08-27T09:00:00Z');
  chk('the day before, it goes home rather than idling for 34 hours',
    p.action === 'idle', JSON.stringify(p));
  chk('but it says when the next window opens, so the log explains itself',
    typeof p.start === 'string' && p.start.startsWith('2026-08-28'), JSON.stringify(p));
}
{
  const p = planAt(GW2, '2026-09-02T09:00:00Z');
  chk('after the last match of the round, nothing to watch',
    p.action === 'idle', JSON.stringify(p));
}
{
  chk('an empty fixture list is idle, not a crash',
    planAt([], '2026-08-29T14:00:00Z').action === 'idle');
  chk('junk in the fixture list is survived, not obeyed',
    planAt([null, {}, { date: 'not a date' }, 'nonsense'], '2026-08-29T14:00:00Z').action === 'idle');
}

// ---- a finished match is not worth a runner ----
{
  // 12:30 on the Saturday. The 11:30 kickoff's window runs to 14:00, so while
  // that match counts we are watching; once it is marked finished the next
  // window (the 14:00s, opening 12:45) is fifteen minutes away instead. The
  // flag has to change the answer or it is not being read at all.
  const live = planAt(GW2, '2026-08-29T12:30:00Z');
  chk('an unfinished 11:30 kickoff keeps the watch up at 12:30',
    live.action === 'watch', JSON.stringify(live));
  const done = GW2.map(f => ({ ...f, finished: f.date < '2026-08-29T12:00:00Z' }));
  const p = planAt(done, '2026-08-29T12:30:00Z');
  chk('marking it finished stops it holding the window open',
    p.action === 'wait' && p.start === '2026-08-29T12:45:00+00:00', JSON.stringify(p));
  chk('and the watch still runs to the end of the afternoon card',
    Date.parse(p.until) >= Date.parse('2026-08-29T19:00:00Z'), p.until);
  const allDone = GW2.map(f => ({ ...f, finished: true }));
  chk('every match finished means go home',
    planAt(allDone, '2026-08-29T14:00:00Z').action === 'idle');
}

// ---- a midweek round, which is where day-of-week scheduling would fail ----
{
  const midweek = [
    { gw: 13, home: 'Arsenal', away: 'Chelsea', date: '2026-12-02T19:45:00Z' },
    { gw: 13, home: 'Leeds', away: 'Everton', date: '2026-12-02T19:45:00Z' },
  ];
  const p = planAt(midweek, '2026-12-02T20:15:00Z');
  chk('a Wednesday night round is watched like any other',
    p.action === 'watch', JSON.stringify(p));
}

// ---- the knobs are knobs ----
{
  const p = planAt(GW2, '2026-08-28T16:00:00Z', { MW_IDLE_WAIT_MIN: '240' });
  chk('a longer idle tolerance turns "go home" into "wait"',
    p.action === 'wait', JSON.stringify(p));
}

console.log(`\n[matchwatch] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
