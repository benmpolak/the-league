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
chk('the injury goes to the injury desk with a second opinion', a.some(p => p.key === 'n1' && (p.who.h === 'BenSuppery' || p.who.h === 'RobDawdle') && /Our understanding|physio|Unofficial|Club say|Worse than feared|not good/.test(p.text)));
chk('the signing gets a here we go, or a can reveal', a.some(p => p.key === 't1' && /here we go|can reveal|exclusive|confirmed by sources/i.test(p.text)));
chk('Le Tus posts a conspiracy', a.some(p => p.key === 'l1' && p.who.h === 'MattLeTus'));
chk('Howard posts, in his shape', (() => { const h = C.compose([{ type: 'howard', key: 'hw1', gwN: 3, fact: 'the Trough is shut.', at: 'Prestwich', sortKick: 1 }], opts); return h.length === 1 && h[0].who.h === 'HowardPrestwich' && /when I thought: the Trough is shut\./.test(h[0].text); })());
chk('live posts sort first', a.findIndex(p => !p.live) >= a.filter(p => p.live).length);
chk('an unknown club still gets a supporter', a.some(p => p.key === 'f1' && /Brand New Club|New Club/.test(p.who.n + p.who.h + p.text)));
chk('team names reach the copy unescaped (app escapes at render)', a.some(p => /Dog’s Polaks|Polaks/.test(p.text)));
chk('the roster covers two fans per club plus the press', C.accounts([{ id: 1 }, { id: 2 }], id => teams[id] || 'X').length === 4 + C.accounts([], () => '').length);
// the press room
const pctx = { mid: 3, gw: 2, mgr: 'Ben Levy', team: 'Atlético Benfield', short: 'Benfield', opp: 'Mighty 🦆 *', oppMgr: 'Alex Duckett', pos: 11, oppPos: 5,
  last: { r: 'L', my: 20, th: 46, opp: 'WA Wanderers' }, doubt: { name: 'Caicedo', news: 'Knee injury - 75% chance of playing' }, star: { name: 'Palmer', pts: 31 },
  signed: { name: 'Wissa', from: 'the Trough' }, dropped: { name: 'Beto' }, benched: { name: 'Mateta' }, axed: { name: 'Rice' }, recalled: null };
const pre = C.questions(pctx, "pre"), pre2 = C.questions(pctx, "pre");
chk('a press conference asks three questions, the opponent first', pre.length === 3 && pre[0].id === 'opp');
chk('the duck survives into the copy', pre.some(q => /Mighty 🦆/.test(q.q) || q.options.some(o => /Mighty 🦆/.test(o.text))) && !pre.some(q => /\*/.test(q.q)));
chk('selection and Trough facts get asked about', pre.some(q => ['transfer', 'selection'].includes(q.id)));
chk('questions are deterministic', JSON.stringify(pre) === JSON.stringify(pre2));
chk('every option resolves', pre.every(q => q.options.length === 4 && q.options.every(o => o.text && !/\{\w+\}/.test(o.text))));
const post = C.questions({ ...pctx, result: { my: 20, th: 46 }, best: { name: 'Palmer', pts: 12 }, worst: { name: 'Meslier', pts: 0 }, benchBurn: { name: 'Mateta', pts: 9 } }, 'post');
chk('post-match asks about the result, then the bench burn', post.length === 3 && post[0].id === 'result' && post.some(q => q.id === 'bench'));
// the six new question types (Ian, 13 Oct 2026; Ben, 15 Oct: Football Manager style)
const NEW = ['gap', 'trade', 'trough', 'injury', 'cup', 'playoff'];
const allSpecs = [...C.PRESSER.pre, ...C.PRESSER.post];
chk('every press question id passes the server filter (lowercase letters, 20 or fewer)', allSpecs.every(sp => /^[a-z]{1,20}$/.test(sp.id)) && new Set(allSpecs.map(sp => sp.id)).size === allSpecs.length);
chk('the six new types are in the bank, opponent and result still lead', NEW.every(id => allSpecs.some(sp => sp.id === id)) && C.PRESSER.pre[0].id === 'opp' && C.PRESSER.post[0].id === 'result');
chk('every new answer bank has two lines per tone per side', allSpecs.filter(sp => NEW.includes(sp.id)).every(sp => C.TONES.every(([t]) => {
  const a = sp.a[t]; return Array.isArray(a) ? a.length === 2 : Object.entries(a).every(([side, l]) => l.length === (side === 'level' ? 1 : 2));
})));
chk('no new question or answer runs past the server limits (240 and 280)', allSpecs.filter(sp => NEW.includes(sp.id)).every(sp => sp.q.every(q => q.length <= 200) && C.TONES.every(([t]) => [].concat(...Object.values(Array.isArray(sp.a[t]) ? { x: sp.a[t] } : sp.a[t])).every(a => a.length <= 220))));
// find the round in which a given question comes up for this context
const askFor = (c, phase, id) => { for (let gw = 0; gw < 400; gw++) { const qs = C.questions({ ...c, gw }, phase); const q = qs.find(x => x.id === id); if (q) return { q, qs }; } return null; };
const plain = { ...pctx, signed: null, dropped: null, benched: null, axed: null, recalled: null };
chk('without their facts, the new types are never asked', Array.from({ length: 60 }, (_, gw) => [...C.questions({ ...plain, gw }, 'pre'), ...C.questions({ ...plain, gw, result: { my: 50, th: 40 }, best: { name: 'Palmer', pts: 12 } }, 'post')]).flat().every(q => !NEW.includes(q.id)));
const clean = r => r && r.qs.length === 3 && r.qs.every(q => !/\{\w+\}/.test(q.q) && q.options.length === 4 && q.options.every(o => o.text && !/\{\w+\}/.test(o.text)));
const sideOf = (r, id, side) => C.TONES.every(([t]) => C.PRESSER.pre.concat(C.PRESSER.post).find(sp => sp.id === id).a[t][side].some(l => r.q.options.find(o => o.tone === t).text === l.replace(/\{opp\}/g, 'Mighty 🦆').replace(/\{oppMgr\}/g, 'Alex')));
const behind = askFor({ ...plain, gap: { my: 7, th: 12 } }, 'pre', 'gap');
chk('chasing the opponent: the gap in Points, answers from the chasing bank', clean(behind) && /5 Points/.test(behind.q.q) && sideOf(behind, 'gap', 'behind'), behind && behind.q.q);
const ahead = askFor({ ...plain, gap: { my: 13, th: 12 } }, 'pre', 'gap');
chk('ahead by one: singular Point, answers from the leading bank', clean(ahead) && /1 Point\b/.test(ahead.q.q) && sideOf(ahead, 'gap', 'ahead'), ahead && ahead.q.q);
const level = askFor({ ...plain, gap: { my: 9, th: 9 } }, 'pre', 'gap');
chk('level on Points gets the level question', clean(level) && /level on 9 Points/.test(level.q.q) && sideOf(level, 'gap', 'level'), level && level.q.q);
const trade = askFor({ ...plain, trade: { inName: 'Wissa', outName: 'Rice', withTeam: '101011101 *' } }, 'pre', 'trade');
chk('a trade gets asked about, by name', clean(trade) && /Wissa|Rice/.test(trade.q.q), trade && trade.q.q);
const tradeNoPartner = askFor({ ...plain, trade: { inName: 'Wissa', outName: 'Rice', withTeam: null } }, 'pre', 'trade');
chk('a trade with no partner on record still reads', clean(tradeNoPartner) && !/101011101/.test(tradeNoPartner.q.q));
const trough = askFor({ ...plain, trough: { name: 'Mateta', pts: 11 } }, 'pre', 'trough');
chk('the Trough scorer nobody signed gets asked about', clean(trough) && /Mateta/.test(trough.q.q) && /11/.test(trough.q.q), trough && trough.q.q);
const injury = askFor({ ...plain, injured: { n: 3, names: ['Saka', 'Isak', 'Caicedo'] } }, 'pre', 'injury');
chk('an injury crisis gets asked about', clean(injury) && /3|Saka, Isak and Caicedo/.test(injury.q.q), injury && injury.q.q);
const postBase = { ...plain, result: { my: 50, th: 40 }, best: { name: 'Palmer', pts: 12 }, worst: { name: 'Meslier', pts: 0 } };
const through = askFor({ ...postBase, cup: { out: false, score: 50, margin: 3, left: 10, outTeam: 'WA Wanderers', tied: false } }, 'post', 'cup');
chk('through in the Monzo Cup: the margin or the field, answers from the still-in bank', clean(through) && /3 points|10 left/.test(through.q.q) && sideOf(through, 'cup', 'alive'), through && through.q.q);
const tied = askFor({ ...postBase, cup: { out: false, score: 28, margin: 0, left: 11, outTeam: null, tied: true } }, 'post', 'cup');
chk('joint bottom, nobody goes: that is the question, never a margin or a loser', clean(tied) && /^Joint bottom of the Monzo Cup on 28 points/.test(tied.q.q), tied && tied.q.q);
const cupOut = askFor({ ...postBase, cup: { out: true, score: 24 } }, 'post', 'cup');
chk('out of the Monzo Cup: the score, answers from the out bank', clean(cupOut) && /24 points/.test(cupOut.q.q) && sideOf(cupOut, 'cup', 'out'), cupOut && cupOut.q.q);
const inside = askFor({ ...postBase, playoff: { pos: 5, left: 25, cushion: 4, gap: null } }, 'post', 'playoff');
chk('inside the top eight: the cushion, answers from the inside bank', clean(inside) && /4 Points/.test(inside.q.q) && sideOf(inside, 'playoff', 'in'), inside && inside.q.q);
const outside = askFor({ ...postBase, playoff: { pos: 11, left: 1, cushion: null, gap: 3 } }, 'post', 'playoff');
chk('outside the top eight: the gap, ordinals and one round', clean(outside) && /3 Points/.test(outside.q.q) && !/1 rounds/.test(outside.q.q) && sideOf(outside, 'playoff', 'out'), outside && outside.q.q);
const edge = askFor({ ...postBase, playoff: { pos: 8, left: 20, cushion: 0, gap: null } }, 'post', 'playoff');
chk('eighth on the tiebreak gets the tiebreak question, not "0 Points clear"', clean(edge) && /^8th, and only overall points/.test(edge.q.q), edge && edge.q.q);
const tieOut = askFor({ ...postBase, playoff: { pos: 9, left: 20, cushion: null, gap: 0 } }, 'post', 'playoff');
chk('ninth on the tiebreak gets the tiebreak question, not "0 Points off"', clean(tieOut) && /^9th, level on Points with eighth/.test(tieOut.q.q), tieOut && tieOut.q.q);
// variety: one news question, then one from everything else (Ben, 15 Oct)
const busy = { ...pctx, gap: { my: 7, th: 12 }, trough: { name: 'Mateta', pts: 11 } };
const papers = Array.from({ length: 30 }, (_, gw) => C.questions({ ...busy, gw }, 'pre'));
chk('every paper still has three questions, opponent first, and some news', papers.every(p => p.length === 3 && p[0].id === 'opp' && p.some(q => ['transfer', 'selection'].includes(q.id))));
chk('with a transfer and a team change on, the other questions still get a look in', new Set(papers.flatMap(p => p.map(q => q.id)).filter(id => !['opp', 'transfer', 'selection'].includes(id))).size >= 3);
const postPapers = Array.from({ length: 30 }, (_, gw) => C.questions({ ...postBase, gw, cup: { out: false, score: 50, margin: 3, left: 10, outTeam: 'WA Wanderers', tied: false }, playoff: { pos: 5, left: 25, cushion: 4, gap: null } }, 'post'));
chk('post-match: three questions, result first, the Cup and the playoffs both come up', postPapers.every(p => p.length === 3 && p[0].id === 'result') && postPapers.some(p => p.some(q => q.id === 'cup')) && postPapers.some(p => p.some(q => q.id === 'playoff')));
const mp = C.compose([{ type: 'manager', key: 'm1', mid: 3, oppMid: 8, aimed: true, mgrName: 'Ben Levy', text: 'Marc is a charity.', tone: 'unhinged', gwN: 3, at: 'GW3', sortKick: 5 }], opts);
chk('a post shows who it is aimed at, and the wire picks it up', mp.some(p => p.who.kind === 'manager' && /→ 101011101/.test(p.at)) && mp.some(p => p.who.kind === 'press' && /Marc is a charity/.test(p.text) && /101011101/.test(p.text)));
chk('the opponent’s supporter bites', mp.some(p => p.key === 'm1:reply' && p.who.mid === 8));
chk('every bank line resolves its placeholders to known keys', Object.values(C.BANKS).flat().every(t =>
  [...t.matchAll(/\{(\w+)\}/g)].every(m => ['P', 'club', 'wor', 'team', 'text', 'quote', 'oppMgr', 'short', 'mgr', 'opp', 'n', 'pts', 'gw', 'my', 'their', 'news', 'diag', 'ret'].includes(m[1]))));
chk('the takeover copy is intact', C.TAKEOVER.lines.some(l => /due cunt/.test(l)) && /Cunthanger Alert System/.test(C.TAKEOVER.head));
console.log(`\n[cunthanger] ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

// variety: ten different posts should not all get the same treatment
const many = Array.from({ length: 10 }, (_, i) => C.compose([{ type: 'manager', key: `v${i}`, mid: 3, oppMid: 8, aimed: true, mgrName: 'Ben Levy', text: `Post number ${i} about Marc.`, tone: 'unhinged', gwN: 3, at: 'GW3', sortKick: 5 }], opts));
const desks = new Set(many.map(r => r.find(p => p.key.endsWith(':wire'))?.who.h));
const shapes = new Set(many.map(r => r.map(p => p.key.split(':')[1] || 'post').sort().join('+')));
chk('different journalists pick up different posts', desks.size >= 4, [...desks].join(','));
chk('the roster is ten to fifteen strong', (() => { const n = C.accounts([], () => '').length; return n >= 10 && n <= 15; })());
chk('the colour writers have a voice on the football', C.compose(Array.from({ length: 12 }, (_, i) => ({ type: 'haul', key: `h${i}`, player: 'Haaland', club: 'MCI', mid: 3, role: 'xi', pts: 15, at: 'x', sortKick: 1 })), opts).some(p => p.who.h === 'AdamCrafty'));
chk('the reaction mix varies from post to post', shapes.size >= 3, [...shapes].join(' | '));
chk('no reaction leaks a placeholder', many.flat().every(p => !/\{\w+\}/.test(p.text)), many.flat().filter(p => /\{\w+\}/.test(p.text)).map(p => p.text).join(' | '));
console.log(`\n[cunthanger variety] ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
