/* The Window Waiver: the holding pen settled by blind lists, not by a draft.
 *
 * Marc, 30 Aug 2026: "we would like to do the window draft as a waiver where
 * everyone does a waiver list rather than a draft where everyone needs to be
 * online... a one off waiver, that takes place on Thursday at 10am, only
 * including players in the holding pen. the order is the reverse of the draft,
 * with duckett first and toby last. there will be two rounds only and it will
 * be a snake draft. so toby has picks 12 and 13, duckett has 1 and 24. this
 * will not impact the waiver order or scheduling of the regular friday waiver."
 *
 * Every clause in that paragraph is a check below. The two that matter most,
 * because they are the ones that would quietly rob somebody:
 *
 *   - the snake. Toby 12 and 13, Ducky 1 and 24, pinned by name.
 *   - Friday is untouched. A man signed here must not spend a waiver take, or
 *     the regular queue reorders itself behind everyone's back.
 *
 * Node only, no browser, no network. Usage: node test/windowwaiver.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};
const ROOT = path.resolve(__dirname, '..');

// load the shared engine the way functions/ does
const sandbox = { module: { exports: {} }, exports: {}, console };
sandbox.self = sandbox; sandbox.window = undefined;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'engine.js'), 'utf-8'), sandbox);
const Engine = sandbox.module.exports || sandbox.Engine;

/* ---- a twelve-man league in the league's own draft order ---- */
const DRAFT_ORDER = [
  'Toby', 'Lee', 'Geller', 'BenLevy', 'Pol', 'Conners',
  'Blanky', 'Wilko', 'AJ', 'Singer', 'Tus', 'Ducky',
];
const MID = Object.fromEntries(DRAFT_ORDER.map((n, i) => [n, i + 1]));
const NAME = Object.fromEntries(DRAFT_ORDER.map((n, i) => [i + 1, n]));

// squads: 14 each, legal shape (2 GK, 5 DF, 5 MF, 2 FW)
const SHAPE = ['GK', 'GK', 'DF', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'];
const PLAYERS = [];
let pid = 1;
for (const n of DRAFT_ORDER)
  for (const pos of SHAPE)
    PLAYERS.push({ id: pid, code: 90000 + pid++, name: `${n}-${pos}-${pid}`, pos, club: 'ARS', team: 'Arsenal', price: 50 });
// and the holding pen: men draft night never saw, one of each position
const PEN = [];
for (const pos of ['FW', 'FW', 'MF', 'MF', 'DF', 'GK'])
  PEN.push({ id: pid, code: 90000 + pid++, name: `PEN-${pos}-${pid}`, pos, club: 'MCI', team: 'Man City', price: 60 });
const ALL = [...PLAYERS, ...PEN];
const byName = n => ALL.find(p => p.name === n);

function baseState() {
  const picks = [];
  let k = 0;
  for (const n of DRAFT_ORDER) for (let j = 0; j < SHAPE.length; j++) picks.push({ managerId: MID[n], playerId: PLAYERS[k++].id, n: picks.length + 1 });
  return {
    phase: 'season',
    managers: DRAFT_ORDER.map(n => ({ id: MID[n], name: n, team: `${n} FC` })),
    settings: {},
    draft: { order: DRAFT_ORDER.map(n => MID[n]), picks },
    // draft night saw the squad players and nobody else — so the PEN men are arrivals
    draftPool: { ids: Object.fromEntries(PLAYERS.map(p => [p.id, p.club])) },
    lineups: {}, transfers: [], claims: {}, waiverMeta: {}, matchStats: {},
    windowClaims: {},
  };
}

const GWS = Array.from({ length: 38 }, (_, i) => ({
  n: i + 1, label: `GW${i + 1}`,
  from: new Date(Date.UTC(2026, 7, 14) + i * 7 * 864e5).toISOString(),
  to: new Date(Date.UTC(2026, 7, 21) + i * 7 * 864e5).toISOString(),
}));
const mkEngine = () => Engine.make({
  players: ALL, gameweeks: GWS, fixtures: [], lastSeasonByCode: {},
  now: () => Date.parse('2026-09-03T09:00:00Z'),
});

/* ---------- the snake ---------- */
{
  const eng = mkEngine();
  const order = [...baseState().draft.order].reverse();
  const slots = eng.windowSnake(order, 2);
  chk('two rounds over twelve managers is twenty-four picks', slots.length === 24, String(slots.length));
  chk('Ducky picks first — the reverse of draft night',
    NAME[slots[0]] === 'Ducky', NAME[slots[0]]);
  chk('Toby picks last in round one (pick 12)',
    NAME[slots[11]] === 'Toby', NAME[slots[11]]);
  chk('and first in round two (pick 13) — it snakes',
    NAME[slots[12]] === 'Toby', NAME[slots[12]]);
  chk('Ducky has the last pick of all (pick 24)',
    NAME[slots[23]] === 'Ducky', NAME[slots[23]]);
  // Marc's exact sentence, checked as arithmetic rather than as prose
  const picksOf = who => slots.map((m, i) => (NAME[m] === who ? i + 1 : 0)).filter(Boolean);
  chk('Toby has picks 12 and 13, exactly as asked',
    JSON.stringify(picksOf('Toby')) === '[12,13]', JSON.stringify(picksOf('Toby')));
  chk('Ducky has picks 1 and 24, exactly as asked',
    JSON.stringify(picksOf('Ducky')) === '[1,24]', JSON.stringify(picksOf('Ducky')));
  chk('everybody gets exactly two',
    DRAFT_ORDER.every(n => picksOf(n).length === 2),
    DRAFT_ORDER.map(n => `${n}:${picksOf(n).length}`).join(' '));
}

/* ---------- the pen is the whole pool, and nothing else is ---------- */
{
  const eng = mkEngine();
  const st = baseState();
  const pen = eng.penIds(st, 0);
  chk('every man draft night never saw is in the pen', PEN.every(p => pen.has(p.id)), `${pen.size} in the pen`);
  chk('and nobody already drafted is', PLAYERS.every(p => !pen.has(p.id)));
}

/* ---------- a straight run ---------- */
{
  const eng = mkEngine();
  const st = baseState();
  const drop = who => st.draft.picks.find(k => k.managerId === MID[who] && ALL.find(p => p.id === k.playerId).pos === 'FW').playerId;
  // everyone wants the same striker first; Ducky picks first so Ducky gets him
  const topFw = PEN[0], secondFw = PEN[1];
  for (const n of DRAFT_ORDER)
    st.windowClaims[MID[n]] = [
      { in: topFw.id, out: drop(n) },
      { in: secondFw.id, out: drop(n) },
    ];
  const res = eng.resolveWindowWaiver(st, Date.parse('2026-09-03T09:00:00Z'));
  const winner = res.executed.find(e => e.in === topFw.id);
  chk('the first pick goes to Ducky, not to whoever is top of the Friday queue',
    winner && NAME[winner.mid] === 'Ducky', winner ? NAME[winner.mid] : 'nobody');
  chk('the contested striker is signed exactly once',
    res.executed.filter(e => e.in === topFw.id).length === 1);
  // Tus picks second and had the same first choice, so falls to his second
  const tus = res.executed.find(e => NAME[e.mid] === 'Tus');
  chk('the man who missed him drops to his next choice',
    tus && tus.in === secondFw.id, tus ? `got ${tus.in}` : 'got nothing');
  chk('nobody signs a man twice over',
    new Set(res.executed.map(e => e.in)).size === res.executed.length);
  chk('and only pen men are signed',
    res.executed.every(e => PEN.some(p => p.id === e.in)));
}

/* ---------- FRIDAY IS UNTOUCHED — the clause with teeth ---------- */
{
  const eng = mkEngine();
  const st = baseState();
  const before = eng.waiverOrder(st);
  const drop = who => st.draft.picks.find(k => k.managerId === MID[who] && ALL.find(p => p.id === k.playerId).pos === 'FW').playerId;
  st.windowClaims[MID['Ducky']] = [{ in: PEN[0].id, out: drop('Ducky') }];
  st.windowClaims[MID['Tus']] = [{ in: PEN[1].id, out: drop('Tus') }];
  const res = eng.resolveWindowWaiver(st, Date.parse('2026-09-03T09:00:00Z'));
  chk('two men were actually signed (the check is not vacuous)', res.executed.length === 2, String(res.executed.length));
  chk('not one record is flagged as a waiver',
    res.records.every(r => !r.waiver), JSON.stringify(res.records.map(r => !!r.waiver)));
  chk('every record is flagged windowDraft, so the ledger says what it was',
    res.records.every(r => r.windowDraft === true));
  // apply them and re-derive Friday's queue
  const after = eng.waiverOrder({ ...st, transfers: [...st.transfers, ...res.records] });
  chk('the Friday waiver order is byte-identical afterwards',
    JSON.stringify(before) === JSON.stringify(after),
    `${before.map(m => NAME[m]).join(',')} -> ${after.map(m => NAME[m]).join(',')}`);
  // and a REAL waiver take still moves it, so the comparison means something
  const real = { managerId: MID['Ducky'], inId: PEN[2].id, outId: drop('Ducky'), gw: eng.transferGw(st), t: Date.now(), waiver: true };
  const moved = eng.waiverOrder({ ...st, transfers: [...st.transfers, real] });
  chk('(a genuine waiver take DOES move it, so that check has teeth)',
    JSON.stringify(before) !== JSON.stringify(moved),
    `${before.map(m => NAME[m]).join(',')} -> ${moved.map(m => NAME[m]).join(',')}`);
}

/* ---------- no list, dead list, illegal list ---------- */
{
  const eng = mkEngine();
  const st = baseState();
  const drop = who => st.draft.picks.find(k => k.managerId === MID[who] && ALL.find(p => p.id === k.playerId).pos === 'FW').playerId;
  // only two managers bother
  st.windowClaims[MID['Ducky']] = [{ in: PEN[0].id, out: drop('Ducky') }];
  st.windowClaims[MID['Toby']] = [{ in: PEN[1].id, out: drop('Toby') }];
  const res = eng.resolveWindowWaiver(st, Date.parse('2026-09-03T09:00:00Z'));
  chk('a manager who lodged nothing signs nobody — his slot simply passes',
    res.executed.length === 2, `${res.executed.length} signings from 24 slots`);
  chk('and the two who did lodge both got their man',
    res.executed.some(e => NAME[e.mid] === 'Ducky') && res.executed.some(e => NAME[e.mid] === 'Toby'));
}
{
  const eng = mkEngine();
  const st = baseState();
  // a claim naming a man he does not own, and one that would wreck his shape
  const notHis = st.draft.picks.find(k => k.managerId === MID['Toby']).playerId;
  const hisOnlyGk = st.draft.picks.filter(k => k.managerId === MID['Ducky'])
    .map(k => ALL.find(p => p.id === k.playerId)).filter(p => p.pos === 'GK');
  st.windowClaims[MID['Ducky']] = [
    { in: PEN[0].id, out: notHis },                    // not his man to drop
    { in: PEN[5].id, out: hisOnlyGk[0].id },           // GK for GK — legal
  ];
  const res = eng.resolveWindowWaiver(st, Date.parse('2026-09-03T09:00:00Z'));
  chk('a claim offering a man he does not own is skipped, not honoured',
    !res.executed.some(e => e.out === notHis), JSON.stringify(res.executed));
  chk('and he falls through to the next legal line on his list',
    res.executed.some(e => NAME[e.mid] === 'Ducky' && e.in === PEN[5].id),
    JSON.stringify(res.executed.filter(e => NAME[e.mid] === 'Ducky')));
}
{
  const eng = mkEngine();
  const st = baseState();
  const drop = who => st.draft.picks.find(k => k.managerId === MID[who] && ALL.find(p => p.id === k.playerId).pos === 'FW').playerId;
  // every line names a man already gone
  st.windowClaims[MID['Ducky']] = [{ in: PEN[0].id, out: drop('Ducky') }];
  st.windowClaims[MID['Tus']] = [{ in: PEN[0].id, out: drop('Tus') }];
  const res = eng.resolveWindowWaiver(st, Date.parse('2026-09-03T09:00:00Z'));
  chk('a list whose every man has gone signs nobody rather than something else',
    res.executed.filter(e => NAME[e.mid] === 'Tus').length === 0, JSON.stringify(res.executed));
}

/* ---------- two picks each, and never a third ---------- */
{
  const eng = mkEngine();
  const st = baseState();
  const mine = ALL.filter(p => st.draft.picks.some(k => k.managerId === MID['Ducky'] && k.playerId === p.id));
  const spare = mine.filter(p => p.pos === 'MF');
  // a greedy list: four claims, all legal in isolation
  st.windowClaims[MID['Ducky']] = [
    { in: PEN[2].id, out: spare[0].id },
    { in: PEN[3].id, out: spare[1].id },
    { in: PEN[4].id, out: spare[2].id },
    { in: PEN[5].id, out: spare[3].id },
  ];
  const res = eng.resolveWindowWaiver(st, Date.parse('2026-09-03T09:00:00Z'));
  const his = res.executed.filter(e => NAME[e.mid] === 'Ducky');
  chk('a greedy list still only wins two — one per slot, two slots',
    his.length === 2, `${his.length} signings`);
  chk('and they are the top two of his list, in his order',
    his[0].in === PEN[2].id && his[1].in === PEN[3].id,
    his.map(e => e.in).join(','));
}

/* ---------- it mutates nothing ---------- */
{
  const eng = mkEngine();
  const st = baseState();
  const drop = st.draft.picks.find(k => k.managerId === MID['Ducky']).playerId;
  st.windowClaims[MID['Ducky']] = [{ in: PEN[0].id, out: drop }];
  const snapshot = JSON.stringify(st);
  eng.resolveWindowWaiver(st, Date.parse('2026-09-03T09:00:00Z'));
  chk('the state it was handed is untouched — the caller applies the result',
    JSON.stringify(st) === snapshot);
}

/* ---------- SQUAD LAW: the same rules that govern any other signing ----------
   Marc, 30 Aug: "are the same rules that govern squad selection re formations
   been tested?" They were not — the resolver called squadShapeOk and the suite
   only ever fed it a legal swap, so it proved the call existed and nothing
   about what it refuses. Squad law is 14 men, GK 1-2, DF 4-6, MF 4-6, FW 2-4. */
{
  const eng = mkEngine();
  const st = baseState();
  const mine = pos => st.draft.picks
    .filter(k => k.managerId === MID['Ducky'])
    .map(k => ALL.find(p => p.id === k.playerId)).filter(p => p.pos === pos);
  const penOf = pos => PEN.find(p => p.pos === pos);

  // a third keeper: GK max is 2, and he already has two
  st.windowClaims[MID['Ducky']] = [{ in: penOf('GK').id, out: mine('DF')[0].id }];
  let res = eng.resolveWindowWaiver(st, 1);
  chk('a third goalkeeper is refused — GK max is 2',
    res.executed.length === 0, JSON.stringify(res.executed));

  // dropping to one forward: FW min is 2, and he has exactly two
  st.windowClaims[MID['Ducky']] = [{ in: penOf('MF').id, out: mine('FW')[0].id }];
  res = eng.resolveWindowWaiver(st, 1);
  chk('dropping below two forwards is refused — FW min is 2',
    res.executed.length === 0, JSON.stringify(res.executed));

  // dropping to three defenders: DF min is 4, and he has five... so ONE is fine
  st.windowClaims[MID['Ducky']] = [{ in: penOf('MF').id, out: mine('DF')[0].id }];
  res = eng.resolveWindowWaiver(st, 1);
  chk('but a swap that keeps every minimum is allowed (DF 5 -> 4, MF 5 -> 6)',
    res.executed.length === 1, JSON.stringify(res.executed));

  // and a sixth midfielder is the cap, so a seventh is not
  const seven = [
    { in: PEN.filter(p => p.pos === 'MF')[0].id, out: mine('DF')[0].id },
    { in: PEN.filter(p => p.pos === 'MF')[1].id, out: mine('DF')[1].id },
  ];
  st.windowClaims[MID['Ducky']] = seven;
  res = eng.resolveWindowWaiver(st, 1);
  chk('MF 5 -> 6 lands, MF 6 -> 7 does not — the cap holds across both picks',
    res.executed.length === 1, JSON.stringify(res.executed.map(e => e.in)));

  // like-for-like is always safe
  st.windowClaims[MID['Ducky']] = [{ in: penOf('FW').id, out: mine('FW')[0].id }];
  res = eng.resolveWindowWaiver(st, 1);
  chk('a like-for-like swap is always legal', res.executed.length === 1);

  // and the squad is still exactly fourteen afterwards
  const after = { ...st, transfers: [...st.transfers, ...res.records] };
  chk('the squad is still fourteen men after the run',
    eng.squadAt(after, MID['Ducky'], eng.transferGw(st)).length === 14,
    String(eng.squadAt(after, MID['Ducky'], eng.transferGw(st)).length));
  chk('and still a legal shape',
    eng.squadShapeOk(after, eng.squadAt(after, MID['Ducky'], eng.transferGw(st))));
}

/* ---------- SCHEDULING: the Friday clock must not move ----------
   The other half of Marc's sentence, and the half I had not tested. The order
   check proves who is where in the queue; this proves WHEN the queue next
   runs, and that a Thursday run does not eat Friday's pending claims. */
{
  const eng = mkEngine();
  const st = baseState();
  st.waiverMeta = { lastRun: '2026-09-01T09:00:00.000Z', control: 'auto', skip: null };
  const cur = eng.currentGwIndex(st);
  // somebody has a REGULAR Friday claim lodged and pending
  const drop = st.draft.picks.find(k => k.managerId === MID['Lee']).playerId;
  st.claims = { [cur]: { [MID['Lee']]: [{ in: PEN[4].id, out: drop }] } };
  const clockBefore = eng.nextWaiverRun(Date.parse('2026-09-03T10:00:00Z')).toISOString();
  const metaBefore = JSON.stringify(st.waiverMeta);
  const claimsBefore = JSON.stringify(st.claims);

  const dDrop = st.draft.picks.find(k => k.managerId === MID['Ducky']).playerId;
  st.windowClaims[MID['Ducky']] = [{ in: PEN[0].id, out: dDrop }];
  const res = eng.resolveWindowWaiver(st, Date.parse('2026-09-03T09:00:00Z'));

  chk('a window run actually did something (not vacuous)', res.executed.length === 1);
  chk('it returns no stampedMeta at all — it CANNOT move the Friday clock',
    !('stampedMeta' in res), Object.keys(res).join(','));
  chk('waiverMeta is untouched, lastRun included',
    JSON.stringify(st.waiverMeta) === metaBefore, JSON.stringify(st.waiverMeta));
  chk('the next Friday run is at exactly the same moment as before',
    eng.nextWaiverRun(Date.parse('2026-09-03T10:00:00Z')).toISOString() === clockBefore, clockBefore);
  chk('it returns no buckets — regular claim buckets are not swept',
    !('buckets' in res), Object.keys(res).join(','));
  chk("Lee's pending Friday claim is still lodged and untouched",
    JSON.stringify(st.claims) === claimsBefore, JSON.stringify(st.claims));

  // and Friday still runs afterwards, honouring that claim
  const applied = { ...st, transfers: [...st.transfers, ...res.records] };
  const fri = eng.resolveWaivers(applied, Date.parse('2026-09-04T09:00:00Z'));
  chk('and Friday still executes it the next morning',
    fri.executed.some(e => e.mid === MID['Lee'] && e.in === PEN[4].id),
    JSON.stringify(fri.executed));
  chk('Friday stamps its own lastRun, as it always did',
    !!fri.stampedMeta.lastRun, JSON.stringify(fri.stampedMeta));
}

console.log(`\n[window-waiver] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
