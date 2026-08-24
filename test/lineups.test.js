/* Matching a predicted-line-up page's names onto our player ids.
 *
 * Marc, 24 Aug 2026. This is the piece the whole Scout integration rests on,
 * and its failure mode is the nasty kind: a wrong id does not throw, it
 * silently credits one manager's projection with another man's afternoon.
 *
 * So the safety cases matter more than the hits. Refusing to answer is a
 * correct answer here; guessing is not.
 *
 * Node only, no browser, no network. Usage: node test/lineups.test.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

const ROOT = path.resolve(__dirname, '..');

// one python call, many lookups — [name, club] in, id or null out
function lookup(pairs) {
  const py = `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts'))})
from lineups import build_index, match, load_players
players = load_players()
index = build_index(players)
index.pop('_dropped', None); index.pop('_rescued', None)
pairs = json.loads(sys.stdin.read())
print(json.dumps([match(n, c, index) for n, c in pairs]))
`;
  return JSON.parse(execFileSync('python3', ['-c', py], {
    input: JSON.stringify(pairs), encoding: 'utf-8',
  }));
}

// the real ids from data/data.json, confirmed against the feed
const HITS = [
  ['Bruno Fernandes', 'MUN', 426, 'three-part full name, they print two'],
  ['Benoit Badiashile', 'CHE', 146, 'surname is the MIDDLE word, and no accent'],
  ['Kepa', 'ARS', 2, 'they print the nickname, we hold Kepa Arrizabalaga Revuelta'],
  ['Van den Berg', 'BRE', 85, 'lower-case particles'],
  ['Milosavljevic', 'BOU', 63, 'plain spelling of our Milosavljević'],
  ['Calvert-Lewin', 'LEE', 346, 'hyphen'],
  ['Mac Allister', 'LIV', 372, 'space inside the surname'],
  ['Rak-Sakyi', 'CRY', 219, 'our web_name carries an initial, theirs will not'],
  ['Gibbs-White', 'NFO', 480, 'straight hyphen match'],
  ['Hudson-Odoi', 'NFO', 482, 'clubmate of the above, must not cross over'],
  ['Fabio Vieira', 'ARS', 23, 'accents dropped on their side'],
  ['Mamardashvili', 'LIV', 351, 'plain surname'],
  ['Eze', 'ARS', 14, 'a three-letter short name is exactly what a line-up prints'],
  ['Dominic Calvert-Lewin', 'LEE', 346, 'full name still lands'],
  ['Bruno Fernandes (c)', 'MUN', 426, 'captain marker trailing the name'],
];

const hits = lookup(HITS.map(([n, c]) => [n, c]));
for (let i = 0; i < HITS.length; i++) {
  const [name, club, want, why] = HITS[i];
  chk(`"${name}" (${club}) -> ${want} — ${why}`, hits[i] === want, `got ${hits[i]}`);
}

/* ----- the feed's own disambiguation ----- */
// Arsenal field Gabriel, Gabriel Martinelli and Gabriel Jesus. All three
// answer to "gabriel"; the feed abbreviates the other two and leaves the
// defender plain, so that is who is meant.
const AMB = [
  ['Gabriel', 'ARS', 4, 'the plain short name wins his own first name'],
  ['Martinelli', 'ARS', 18, 'and his clubmates are still reachable'],
  ['Gabriel Jesus', 'ARS', 27, ''],
  ['Thomas', 'COV', 173, 'Thomas, alongside Thomas-Asante'],
  ['Thomas-Asante', 'COV', 194, ''],
];
const amb = lookup(AMB.map(([n, c]) => [n, c]));
for (let i = 0; i < AMB.length; i++) {
  const [name, club, want, why] = AMB[i];
  chk(`"${name}" (${club}) -> ${want}${why ? ' — ' + why : ''}`, amb[i] === want, `got ${amb[i]}`);
}

/* ----- REFUSING is the right answer ----- */
const REFUSE = [
  ['Pedro', 'CHE', 'Chelsea have Pedro Neto AND João Pedro — a coin toss, so no answer'],
  ['James', 'EVE', 'James Tarkowski and James Garner — first names are not identifiers'],
  ['Emiliano', 'AVL', 'Emiliano Martinez and Emiliano Buendía'],
  ['Bruno Fernandes', 'LIV', 'right man, wrong club — the club scope must hold'],
  ['Calvert-Lewin', 'ARS', 'likewise'],
  ['Reginald Perrin', 'ARS', 'nobody at all'],
  ['', 'ARS', 'an empty cell'],
  ['Bruno Fernandes', 'ZZZ', 'a club code we do not recognise'],
  ['Bruno Fernandes', '', 'no club at all'],
];
const refuse = lookup(REFUSE.map(([n, c]) => [n, c]));
for (let i = 0; i < REFUSE.length; i++) {
  const [name, club, why] = REFUSE[i];
  chk(`"${name}" (${club || '-'}) -> no answer — ${why}`, refuse[i] === null, `got ${refuse[i]}`);
}

/* ----- nobody is matched twice, and everybody is reachable ----- */
const sweep = execFileSync('python3', ['-c', `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts'))})
from lineups import build_index, match, load_players, norm
players = load_players()
index = build_index(players)
dropped = index.pop('_dropped'); rescued = index.pop('_rescued')
unreachable = [p for p in players
               if p.get('club') and match(p.get('full') or p['name'], p['club'], index) != p['id']]
byweb = [p for p in players
         if p.get('club') and match(p['name'], p['club'], index) != p['id']]
print(json.dumps({'players': len(players), 'clubs': len(index), 'dropped': dropped,
                  'rescued': rescued, 'unreachable': len(unreachable),
                  'byweb': len(byweb),
                  'bywebnames': [f"{p['club']} {p['name']}" for p in byweb[:8]]}))
`], { encoding: 'utf-8' });
const s = JSON.parse(sweep);
chk('every player in the feed is reachable by his full name',
  s.unreachable === 0, `${s.unreachable} unreachable of ${s.players}`);
chk('and all twenty clubs are indexed', s.clubs === 20, String(s.clubs));
chk('the feed\'s short name resolves the shared first names', s.rescued > 0, `${s.rescued} rescued`);
chk('genuinely ambiguous keys are struck out rather than guessed',
  s.dropped > 0, `${s.dropped} struck out`);
// our own web_name is the weakest form we hold — worth knowing the true rate
console.log(`      (of ${s.players}, ${s.byweb} are not reachable by our own short name` +
  `${s.bywebnames.length ? ': ' + s.bywebnames.join(', ') + '…' : ''})`);

console.log(`\n[lineups] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
