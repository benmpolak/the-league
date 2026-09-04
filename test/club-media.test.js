/* Decisions must produce earned, shared stories without altering the game. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const M = require('../js/club-media.js');
let n = 0;
const check = (name, f) => { f(); n++; console.log('PASS ' + name); };
const fresh = () => ({ phase: 'season', managers: [{ id: 1, name: 'Ben', team: 'Polaks', assistant: 1 }, { id: 2, name: 'Toby', team: 'Mao' }], transfers: [], pressers: {}, mediaCases: {}, scores: [] });
const api = { REGULAR_GWS: 33, gwStatus: (s, g) => s.scores[g] ? 'final' : 'live', pairingsFor: () => [[1, 2]], gwManagerPoints: (s, mid, g) => s.scores[g][mid - 1] };
const press = s => { s.pressers[1] = { '0:pre': { answers: [{ tone: 'confident', text: 'Never in doubt.' }] } }; return s; };
check('quiet weeks produce no busywork', () => assert.equal(M.incident(fresh(), 1, 0, api), null));
check('all twelve assistants match the existing canon', () => {
  const ctx = {}; vm.runInNewContext(fs.readFileSync('js/lore.js', 'utf8') + ';this.staff=ASSISTANTS.map(a=>a.t)', ctx);
  assert.deepEqual([...ctx.staff], M.STAFF);
  assert.equal(new Set(M.STAFF.map(t => M.voice(t, 'same'))).size, 12);
});
check('custom assistants retain their identity without a false biography', () => {
  const s = fresh(); s.managers[0].assistant = { t: '<Stan>' };
  assert.equal(M.staff(s, 1), '<Stan>'); assert.ok(M.voice('<Stan>', 'x').includes('training'));
});
check('three actual consecutive defeats summon the board', () => {
  const s = fresh(); s.scores = [[20, 30], [24, 40], [19, 35]];
  const before = JSON.stringify(s); const item = M.incident(s, 1, 3, api);
  assert.equal(item.kind, 'board'); assert.match(item.body, /3 consecutive defeats/);
  assert.equal(JSON.stringify(s), before);
  s.scores[1] = [40, 40]; assert.equal(M.incident(s, 1, 3, api), null);
});
check('a quote is eligible next week, never before it happened', () => {
  const s = press(fresh()); assert.equal(M.incident(s, 1, 0, api), null);
  assert.equal(M.incident(s, 1, 1, api).kind, 'receipt');
  assert.equal(M.incident(s, 1, 5, api), null);
});
check('a storm-out is remembered without inventing a quotation', () => {
  const s = fresh(); s.pressers[1] = { '0:pre': { answers: [{ storm: true, text: 'Stormed out.' }] } };
  assert.match(M.incident(s, 1, 1, api).body, /doorstop/);
  s.scores = [[30, 20]]; assert.match(M.echoes(s, 1, api)[0].text, /walked out/);
});
check('banning creates a continuing dispute; clearing the air ends it', () => {
  const s = press(fresh()), item = M.incident(s, 1, 1, api);
  const ban = M.decide(s, 1, item, 'ban', 100);
  s.mediaCases[1] = { 1: ban };
  const next = M.incident(s, 1, 2, api); assert.equal(next.kind, 'carpark');
  s.mediaCases[1][2] = M.decide(s, 1, next, 'double', 200);
  assert.equal(M.incident(s, 1, 3, api).kind, 'carpark');
  s.mediaCases[1][3] = M.decide(s, 1, M.incident(s, 1, 3, api), 'apologise', 300);
  assert.equal(M.incident(s, 1, 4, api), null);
});
check('blaming Phil Neal produces Phil Neal, then a meeting', () => {
  const s = fresh(); s.scores = [[20, 30], [24, 40], [19, 35]];
  const r = M.decide(s, 1, M.incident(s, 1, 3, api), 'blame', 100);
  assert.equal(r.replyBy, 'Phil Neal'); assert.match(r.reply, /My fault, boss/);
  s.mediaCases[1] = { 3: r }; assert.equal(M.incident(s, 1, 4, api).kind, 'assistant');
});
check('responses cannot select an unoffered option', () => {
  const s = press(fresh()); assert.equal(M.decide(s, 1, M.incident(s, 1, 1, api), 'blame', 1), null);
});
check('old disputes expire without a compulsory reply', () => {
  const s = press(fresh()); s.mediaCases[1] = { 1: M.decide(s, 1, M.incident(s, 1, 1, api), 'ban', 1) };
  assert.equal(M.incident(s, 1, 6, api), null);
});
check('result receipts count only settled matches, excluding post-match quotes own match', () => {
  const s = press(fresh()); s.scores = [[30, 20], null, [25, 30]];
  assert.match(M.echoes(s, 3, api)[0].text, /1 win from 2 settled matches/);
  s.pressers[1] = { '0:post': { answers: [{ tone: 'confident', text: 'We go again.' }] } };
  assert.equal(M.echoes(s, 1, api).length, 0);
  assert.match(M.echoes(s, 3, api)[0].text, /0 wins from 1 settled match/);
});
check('market stories count this rounds actual arrivals, not future/private lists', () => {
  const s = fresh(); s.transfers = [1, 2, 3].map(inId => ({ managerId: 1, gw: 2, inId }));
  assert.equal(M.incident(s, 1, 1, api), null);
  assert.equal(M.incident(s, 1, 2, api).kind, 'market');
});
check('private plans cannot influence either narrative or available options', () => {
  const s = press(fresh()), before = JSON.stringify(M.incident(s, 1, 1, api));
  Object.defineProperty(s, 'claims', { get() { throw Error('private'); } });
  Object.defineProperty(s, 'autolists', { get() { throw Error('private'); } });
  assert.equal(JSON.stringify(M.incident(s, 1, 1, api)), before); M.echoes(s, 1, api);
});
check('browser and server use byte-identical generators', () => {
  const ctx = {}; vm.runInNewContext(fs.readFileSync('js/club-media.js', 'utf8'), ctx);
  const s = press(fresh()); assert.equal(JSON.stringify(ctx.ClubMedia.incident(s, 1, 1, api)), JSON.stringify(M.incident(s, 1, 1, api)));
});
check('no inbox outside season, for spectators or in playoffs', () => {
  const s = press(fresh()); assert.equal(M.incident(s, 99, 1, api), null); assert.equal(M.incident(s, 1, 33, api), null);
  s.phase = 'draft'; assert.equal(M.incident(s, 1, 1, api), null);
});
console.log(`[club-media] ${n} passed`);
