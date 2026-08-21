/* Committee-issued provisional players (data/provisional.json).
 *
 * The failure that matters is silent: a scheduled FPL refresh regenerates the
 * feed WITHOUT the merge, and whoever drafted the man is left holding
 * "#900001 (unknown)" with no warning until someone notices in April. These
 * checks run offline, on the committed feed, so CI catches that the moment it
 * happens.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

// the client's feed, loaded exactly as the browser loads it
const sandbox = {};
vm.createContext(sandbox);
// data.js declares with const, which stays lexical rather than landing on the
// context — hand the values out explicitly
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8')
  + ';this.PLAYERS = PLAYERS; this.TEAMS = TEAMS;', sandbox);
const PLAYERS = sandbox.PLAYERS;

// the server's copy — a separate file, and the one Cloud Functions validate against
const serverPlayers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'data.json'), 'utf8')).players;

const declared = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'provisional.json'), 'utf8'));

const clientProv = PLAYERS.filter(p => p.provisional);
const serverProv = serverPlayers.filter(p => p.provisional);

chk('data/provisional.json parses as a list', Array.isArray(declared), `${declared.length} declared`);

// THE check: the two feeds must agree, or the server rejects picks the client offered
chk('every declared provisional reached js/data.js (the client)',
  declared.every(e => clientProv.some(p => p.id === e.id)),
  `${clientProv.length}/${declared.length} present`);
chk('every declared provisional reached data/data.json (the server)',
  declared.every(e => serverProv.some(p => p.id === e.id)),
  `${serverProv.length}/${declared.length} present`);
chk('client and server carry the identical provisional set',
  JSON.stringify(clientProv.map(p => p.id).sort()) === JSON.stringify(serverProv.map(p => p.id).sort()));

// the handover is "delete the entry, re-run the merge". A placeholder left
// behind after its real player lands is the whole feature failing quietly, so
// the feed must carry NOTHING the file does not declare.
const declaredIds = new Set(declared.map(e => e.id));
const orphans = [...clientProv, ...serverProv].filter(p => !declaredIds.has(p.id));
chk('no placeholder survives in the feed that provisional.json no longer declares',
  orphans.length === 0, orphans.map(p => `${p.id} ${p.name}`).join(', ') || 'none');

// ids must never be able to collide with a real FPL element id
const realMax = Math.max(...PLAYERS.filter(p => !p.provisional).map(p => p.id));
chk('provisional ids sit far above every real FPL id',
  clientProv.every(p => p.id >= 900001), `real feed tops out at ${realMax}`);
chk('no provisional id collides with a real player',
  clientProv.every(p => !PLAYERS.some(q => !q.provisional && q.id === p.id)));
chk('no duplicate ids anywhere in the feed',
  new Set(PLAYERS.map(p => p.id)).size === PLAYERS.length);

// a provisional missing a field the app reads renders as undefined on the board
const FIELDS = ['id', 'name', 'full', 'team', 'club', 'pos', 'code', 'status', 'news',
  'newsAdded', 'chance', 'price', 'pts', 'rating', 'xp', 'ppg', 'mp', 'g', 'a', 'cs', 'xg', 'xa'];
for (const p of clientProv) {
  chk(`${p.name}: carries every field a real player carries`,
    FIELDS.every(f => f in p), FIELDS.filter(f => !(f in p)).join(', ') || 'complete');
  chk(`${p.name}: legal position`, ['GK', 'DF', 'MF', 'FW'].includes(p.pos), p.pos);
  chk(`${p.name}: available, so he can be drafted`, p.status === 'a');
  chk(`${p.name}: priced, so the board can rank him`, typeof p.price === 'number' && p.price > 0, `£${p.price}m`);
  chk(`${p.name}: no points or history — he has not played`, p.pts === 0 && p.mp === 0);
  chk(`${p.name}: club is a real Premier League club`,
    sandbox.TEAMS.some(t => t.name === p.team && t.short === p.club), `${p.team} / ${p.club}`);
}

console.log(`\n[provisional] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
