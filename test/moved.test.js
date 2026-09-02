/* Men the feed still has at the wrong club.
 *
 * Marc, 2 Sept 2026: "you appear to have missed tosin, how did this happen?"
 *
 * Because there was nothing to see. The holding pen compares a man's club in
 * the feed against his club in the draft-night snapshot; Tosin moved on
 * deadline day, FPL had not processed it, and both said Chelsea. No rule could
 * tell. The sweep I ran to check the pen read the same feed, so it shared the
 * blind spot exactly — it could catch a bug in the rule, never a gap in the
 * source.
 *
 * data/moved.json states where a man actually plays and the feed is corrected
 * on the next refresh, which pens him by the ordinary rule. What this pins is
 * the part that matters when somebody types it in a hurry the night before a
 * waiver: a typo must FAIL, loudly. An entry that corrects nobody is exactly
 * how a man goes missing, which is the fault the mechanism exists to fix.
 *
 * Runs the real python module — no reimplementation of the rules in JS.
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

// drive provisional.apply_moves with an in-memory feed and an in-memory
// moved.json, so the test never touches the committed data files
function run(moves, players) {
  const py = `
import json, sys, tempfile, os
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts'))})
import provisional
d = tempfile.mkdtemp()
provisional.MOVED_FILE = __import__('pathlib').Path(d) / 'moved.json'
provisional.MOVED_FILE.write_text(${JSON.stringify(JSON.stringify(moves))})
teams = [{"id":1,"name":"Arsenal","short":"ARS"},{"id":2,"name":"Chelsea","short":"CHE"},{"id":3,"name":"Everton","short":"EVE"}]
players = ${JSON.stringify(players)}
try:
    out, notes = provisional.apply_moves(players, teams)
    print(json.dumps({"ok": True, "players": out, "notes": notes}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
`;
  return JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf-8' }));
}

const feed = () => ([
  { id: 147, name: 'Tosin', club: 'CHE', team: 'Chelsea', news: '', newsAdded: '' },
  { id: 200, name: 'Someone Else', club: 'ARS', team: 'Arsenal', news: '', newsAdded: '' },
]);

// ---- the case that started it ----
let r = run([{ id: 147, club: 'EVE' }], feed());
chk('a declared move corrects the club', r.ok && r.players[0].club === 'EVE', JSON.stringify(r.error || r.players[0].club));
chk('and the full club name follows the code, so the two cannot disagree',
  r.ok && r.players[0].team === 'Everton', r.ok ? r.players[0].team : r.error);
chk('nobody else is touched', r.ok && r.players[1].club === 'ARS' && r.players[1].team === 'Arsenal');
chk('the correction says so on his card rather than happening invisibly',
  r.ok && /Everton/.test(r.players[0].news), r.ok ? r.players[0].news : r.error);
chk('and it is reported to whoever ran the refresh',
  r.ok && r.notes.length === 1 && /Tosin/.test(r.notes[0]) && /CHE/.test(r.notes[0]), JSON.stringify(r.notes));

// ---- a typo must not pass quietly ----
r = run([{ id: 999999, club: 'EVE' }], feed());
chk('an id the feed does not have is an ERROR, not a silent no-op',
  !r.ok && /not in the feed/.test(r.error), r.error || 'it was accepted');
r = run([{ id: 147, club: 'XYZ' }], feed());
chk('a club that is not in this season is an ERROR too',
  !r.ok && /not a club this season/.test(r.error), r.error || 'it was accepted');
r = run([{ club: 'EVE' }], feed());
chk('an entry with no id is refused', !r.ok && /missing "id"/.test(r.error), r.error || 'accepted');
r = run([{ id: 147, club: 'EVE' }, { id: 147, club: 'ARS' }], feed());
chk('the same man declared twice is refused rather than last-one-wins',
  !r.ok && /duplicate/.test(r.error), r.error || 'accepted');

// ---- the handover ----
r = run([{ id: 147, club: 'CHE' }], feed());
chk('an entry the feed has caught up with is NOT an error — the refresh runs every five minutes',
  r.ok, r.error || '');
chk('...but it says plainly that the entry should be deleted',
  r.ok && /delete this entry/.test(r.notes[0] || ''), JSON.stringify(r.notes));

// ---- nothing declared is nothing done ----
r = run([], feed());
chk('an empty file changes nothing at all',
  r.ok && r.players[0].club === 'CHE' && r.notes.length === 0, JSON.stringify(r.notes));

// ---- idempotent, because the refresh runs over and over ----
r = run([{ id: 147, club: 'EVE' }], feed());
const once = JSON.stringify(r.players);
const twice = run([{ id: 147, club: 'EVE' }], JSON.parse(once)).players;
chk('applying it twice is the same as applying it once',
  JSON.stringify(twice) === once);

// ---- the committed file is valid, whatever is in it ----
try {
  execFileSync('python3', ['-c',
    `import sys; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts'))}); import provisional; provisional.load_moves()`],
    { encoding: 'utf-8' });
  chk('the committed data/moved.json validates', true);
} catch (e) {
  chk('the committed data/moved.json validates', false, String(e.stderr || e).slice(0, 200));
}

console.log(`\n[moved] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
