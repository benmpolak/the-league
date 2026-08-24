/* Reading Fantasy Football Scout's predicted XIs out of their page.
 *
 * Marc, 24 Aug 2026. The fixture below is modelled on the real markup the
 * probe returned on 24 Aug — the team-news-item block with its data-team-code,
 * the scout-picks pitch, the row-N/players nesting, the player-name spans, the
 * "Last Updated" line, and crucially the editorial prose that sits alongside.
 *
 * The prose is the trap. Their commentary reads:
 *
 *   "Ross Barkley or Lamare Bogarde are options to come in for Joao Gomes...
 *    Emery will have to play someone like Garnacho as the spearhead"
 *
 * Those men are being discussed, not picked. A parser that swept the block
 * would call all three nailed-on starters — confidently wrong, which is worse
 * than no data. Half these checks exist to prove it does not.
 *
 * Node only, no browser, no network. Usage: node test/scoutparse.test.js
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

// a club block in their shape. `picks` are inside the pitch; `prose` is the
// commentary that must be ignored.
const club = (code, name, picks, prose, updated = 'Fri 21st Aug', formation = '4-2-3-1') => `
<li class="team-news-item" data-team-code="${code}">
  <div class="story-wrap">
    <header class="!flex items-center gap-x-2 mb-2">
      <img loading="lazy" decoding="async" src="https://x/badges/t1.png" alt="${name} badge" class="team-badge" width="24" height="24" />
      <h2 class="!m-0">${name}</h2>
    </header>
  </div>
  <div class="scout-picks scout-picks-pitch formation formation-${formation}">
    ${picks.map((row, i) => `<div class="row-${i + 1}"><div class="players">${row.map(p => `
      <div class="flex items-center gap-2 py-2 px-1">
        <img class="player-image w-7 h-7 max-w-7 max-h-7 rounded-full object-contain bg-gray-200 pt-1" src="x.png" alt="${p}" />
        <span class="player-name truncate max-w-full">${p}</span>
      </div>`).join('')}</div></div>`).join('')}
  </div>
  <ul>
    <li><p>${prose}</p></li>
    <li class="headers grey"><em>Last Updated ${updated}</em></li>
  </ul>
</li>`;

// eleven real Arsenal men, in their shape, with prose naming three who are NOT picked
const ARS = club('ars', 'Arsenal',
  [['Raya'], ['Timber', 'Saliba', 'Gabriel', 'Calafiori'],
   ['Rice', 'Zubimendi'], ['Saka', 'Ødegaard', 'Martinelli'], ['Gyökeres']],
  'Kepa is fit again and pushing for a recall. Gabriel Jesus remains out, ' +
  'while Fábio Vieira could come in for Ødegaard if he is not risked.');

// a second club so the "enough clubs" gate has something to count
const LIV = club('liv', 'Liverpool',
  [['Alisson'], ['Frimpong', 'Van Dijk', 'Gomez', 'Kerkez'],
   ['Mac Allister', 'Gravenberch'], ['Szoboszlai', 'Wirtz', 'Gakpo'], ['Ekitiké']],
  'Mamardashvili is the understudy. Chiesa may feature.', 'Sat 22nd Aug', '4-3-3');

function run(html) {
  const py = `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'scripts'))})
import scout_lineups, lineups
html = sys.stdin.read()
players = lineups.load_players()
raw = scout_lineups.parse(html)
book, report = scout_lineups.build(html, players)
print(json.dumps({'raw': raw, 'book': book, 'report': report}))
`;
  return JSON.parse(execFileSync('python3', ['-c', py], { input: html, encoding: 'utf-8' }));
}

const r = run(`<html><body><ul>${ARS}${LIV}</ul></body></html>`);

/* ----- the pitch, and nothing but the pitch ----- */
const ars = r.raw.ars;
chk('both club blocks are found by their team code',
  Object.keys(r.raw).sort().join() === 'ars,liv', JSON.stringify(Object.keys(r.raw)));
chk('exactly eleven names come out of the Arsenal pitch',
  ars.xi.length === 11, `${ars.xi.length}: ${ars.xi.join(', ')}`);
chk('the formation is read off the class', ars.formation === '4-2-3-1', String(ars.formation));
chk('so is the Last Updated stamp', ars.updated === 'Fri 21st Aug', String(ars.updated));
chk('Liverpool keeps its own formation and date, not Arsenal\'s',
  r.raw.liv.formation === '4-3-3' && r.raw.liv.updated === 'Sat 22nd Aug',
  `${r.raw.liv.formation} / ${r.raw.liv.updated}`);

/* ----- THE PROSE TRAP ----- */
for (const ghost of ['Kepa', 'Gabriel Jesus', 'Fábio Vieira']) {
  chk(`"${ghost}" is discussed in the prose and must NOT be in the XI`,
    !ars.xi.includes(ghost), ars.xi.join(', '));
}
chk('Mamardashvili is named in Liverpool\'s prose and stays out too',
  !r.raw.liv.xi.includes('Mamardashvili'), r.raw.liv.xi.join(', '));

/* ----- onto our ids ----- */
const A = r.book.clubs.ARS;
chk('Arsenal maps to eleven of our player ids', A && A.xi.length === 11,
  A ? `${A.xi.length} ids, unmatched: ${JSON.stringify(A.unmatched)}` : 'no ARS block');
chk('with nothing left unmatched', A && A.unmatched.length === 0, JSON.stringify(A && A.unmatched));
chk('Gabriel resolves to the defender, not Martinelli or Jesus',
  A && A.xi.includes(4) && A.xi.includes(18) && !A.xi.includes(27),
  JSON.stringify(A && A.xi));
chk('Liverpool maps cleanly too, Mac Allister and all',
  r.book.clubs.LIV && r.book.clubs.LIV.xi.length === 11 && r.book.clubs.LIV.xi.includes(372),
  JSON.stringify(r.book.clubs.LIV && r.book.clubs.LIV.xi));
// Ødegaard and Gyökeres carry letters NFKD alone will not fold, and Alisson
// is printed by his first name while our feed holds him as A.Becker
chk('accented and first-name forms both land (Ødegaard, Gyökeres, Alisson)',
  A.unmatched.length === 0 && r.book.clubs.LIV.unmatched.length === 0 &&
  r.book.clubs.LIV.xi.includes(350),
  JSON.stringify([A.unmatched, r.book.clubs.LIV.unmatched]));

/* ----- failing closed ----- */
const thin = run(`<html><ul>${club('ars', 'Arsenal', [['Raya'], ['Timber']], 'x')}${LIV}</ul></html>`);
chk('a club with too few names is dropped, not half-written',
  !thin.book.clubs.ARS && thin.report.thin.includes('ARS'),
  JSON.stringify(thin.report.thin));
chk('and the run is refused when too few clubs survive',
  thin.report.ok === false, `ok=${thin.report.ok}`);

const junk = run('<html><body><p>Nothing to see here at all.</p></body></html>');
chk('a page with no blocks yields nothing and refuses',
  Object.keys(junk.book.clubs).length === 0 && junk.report.ok === false);

const strange = run(`<html><ul>${club('zzz', 'Somewhere', [['Raya'], ['Timber', 'Saliba', 'Gabriel', 'Calafiori'], ['Rice', 'Zubimendi'], ['Saka', 'Ødegaard', 'Martinelli'], ['Gyökeres']], 'x')}</ul></html>`);
chk('an unrecognised team code is reported, never guessed at',
  strange.report.unknown_clubs.includes('zzz') && Object.keys(strange.book.clubs).length === 0,
  JSON.stringify(strange.report.unknown_clubs));

// a name they print that we cannot place must be surfaced, not silently lost
const odd = run(`<html><ul>${club('ars', 'Arsenal',
  [['Raya'], ['Timber', 'Saliba', 'Gabriel', 'Calafiori'], ['Rice', 'Zubimendi'],
   ['Saka', 'Ødegaard', 'Reginald Perrin']], 'x')}${LIV}</ul></html>`);
chk('a name we cannot place is reported as unmatched, not dropped in silence',
  odd.book.clubs.ARS.unmatched.includes('Reginald Perrin') &&
  odd.book.clubs.ARS.xi.length === 9,
  JSON.stringify(odd.book.clubs.ARS));

console.log(`\n[scout-parse] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
