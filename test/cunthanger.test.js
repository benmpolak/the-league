/* Cunthanger: the timeline must be deterministic, complete and never leak a
 * raw {placeholder}. Runs the engine in a VM with the lore banks loaded. */
'use strict';
const fs = require('fs');
const vm = require('vm');
const ctx = { window: {}, globalThis: null, console };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync('js/lore.js', 'utf8') + '\n' + fs.readFileSync('js/cunthanger.js', 'utf8'), ctx);
const C = ctx.window.Cunthanger;
let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${detail}`}`); ok ? pass++ : fail++; };

const teams = { 1: 'The Dog’s Polaks', 3: 'Atlético Benfield', 8: '101011101', 12: 'WA Wanderers', 13: 'Brand New Club FC *' };
const names = { 1: 'Ben Polak', 3: 'Ben Levy', 8: 'Marc Conway', 12: 'Wilko Wilkowski', 13: 'Someone New' };
const opts = { teamName: id => teams[id] || `Club ${id}`, managerName: id => names[id] || `Manager ${id}` };
const base = { at: 'ARS 2–1 MCI', live: true, sortKick: 1000, gwN: 3 };
const events = [
  { ...base, type: 'goal', key: 'g1', player: 'Saka', club: 'ARS', mid: 8, oppMid: 3, role: 'xi', n: 1, pts: 9 },
  { ...base, type: 'goal', key: 'g2', player: 'Haaland', club: 'MCI', mid: 3, oppMid: 8, role: 'bench', n: 2, pts: 13 },
  { ...base, type: 'goal', key: 'g3', player: 'Mateta', club: 'CRY', mid: null, role: 'trough', n: 1, pts: 6 },
  { ...base, type: 'haul', key: 'h1', player: 'Haaland', club: 'MCI', mid: 3, role: 'bench', pts: 13 },
  { ...base, type: 'assist', key: 'a1', player: 'Ødegaard', club: 'ARS', mid: 8, role: 'xi', n: 1, pts: 5 },
  { ...base, type: 'red', key: 'r1', player: 'Gabriel', club: 'ARS', mid: 1, role: 'xi', pts: -2 },
  { ...base, type: 'penmiss', key: 'pm1', player: 'Palmer', club: 'CHE', mid: 12, role: 'xi', pts: 0 },
  { ...base, type: 'owngoal', key: 'og1', player: 'Tarkowski', club: 'EVE', mid: 1, role: 'xi', pts: 0 },
  { ...base, type: 'pensave', key: 'ps1', player: 'Pickford', club: 'EVE', mid: 1, role: 'xi', pts: 11 },
  { ...base, type: 'yellow', key: 'y1', player: 'Rice', club: 'ARS', mid: 8, role: 'xi', pts: 1 },
  { type: 'injury', key: 'n1', player: 'Joelinton', club: 'NEW', mid: 12, news: 'Knee injury - Expected back 20 Sep', gwN: 3, at: 'Team news', sortKick: 900 },
  { type: 'signing', key: 't1', player: 'Wissa', club: 'NEW', mid: 1, gwN: 3, at: 'Waivers', sortKick: 950 },
  { type: 'fixture', key: 'f1', mid: 13, oppMid: 1, gwN: 3, state: 'pre', my: 0, their: 0, at: 'GW3', sortKick: 800 },
  { type: 'fixture', key: 'f2', mid: 3, oppMid: 8, gwN: 3, state: 'live', my: 41, their: 39, at: 'GW3', sortKick: 800 },
  { type: 'fixture', key: 'f3', mid: 8, oppMid: 3, gwN: 3, state: 'over', my: 39, their: 41, at: 'GW3', sortKick: 800 },
  { type: 'fixture', key: 'f4', mid: 12, oppMid: 1, gwN: 3, state: 'over', my: 40, their: 40, at: 'GW3', sortKick: 800 },
  { type: 'letus', key: 'l1', gwN: 3, at: 'Thread', sortKick: 700 },
];
const a = C.compose(events, opts), b = C.compose(events, opts);
chk('deterministic: same events, same timeline', JSON.stringify(a) === JSON.stringify(b));
chk('every event that should post, posts', a.length >= events.length - 1, `${a.length} posts from ${events.length} events`);
chk('no raw placeholder survives', !a.some(p => /\{\w+\}/.test(p.text)), a.filter(p => /\{\w+\}/.test(p.text)).map(p => p.text).join(' | '));
chk('no empty post', a.every(p => p.text && p.text.length > 8));
chk('every post has an account with a handle', a.every(p => p.who && p.who.h && p.who.n));
chk('the Trough goal goes to the press, not a fan', a.filter(p => p.key === 'g3').every(p => p.who.kind === 'press'));
chk('the injury goes to Ben Suppery with a second opinion', a.some(p => p.key === 'n1' && p.who.h === 'BenSuppery' && /Our understanding|physio|Unofficial/.test(p.text)));
chk('the signing gets a here we go', a.some(p => p.key === 't1' && /here we go/i.test(p.text)));
chk('Le Tus posts a conspiracy', a.some(p => p.key === 'l1' && p.who.h === 'MattLeTus'));
chk('live posts sort first', a.findIndex(p => !p.live) >= a.filter(p => p.live).length);
chk('an unknown club still gets a supporter', a.some(p => p.key === 'f1' && /Brand New Club|New Club/.test(p.who.n + p.who.h + p.text)));
chk('team names reach the copy unescaped (app escapes at render)', a.some(p => /Dog’s Polaks|Polaks/.test(p.text)));
chk('the roster covers two fans per club plus the press', C.accounts([{ id: 1 }, { id: 2 }], id => teams[id] || 'X').length === 4 + C.accounts([], () => '').length);
chk('every bank line resolves its placeholders to known keys', Object.values(C.BANKS).flat().every(t =>
  [...t.matchAll(/\{(\w+)\}/g)].every(m => ['P', 'club', 'team', 'short', 'mgr', 'opp', 'n', 'pts', 'gw', 'my', 'their', 'news', 'diag', 'ret'].includes(m[1]))));
chk('the takeover copy is intact', C.TAKEOVER.lines.some(l => /due cunt/.test(l)) && /Cunthanger Alert System/.test(C.TAKEOVER.head));
console.log(`\n[cunthanger] ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
