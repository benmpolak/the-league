'use strict';
const assert = require('node:assert/strict');
const { FEED_FILES, sourceFingerprint, matchingRun, runState, validateFeed } = require('../scripts/release_gate.js');
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const tree = files => Object.entries(files).map(([p, sha]) => `100644 blob ${sha}\t${p}\0`).join('');
const base = { 'js/app.js': 'app1', 'functions/index.js': 'fn1', '.github/workflows/test.yml': 'test1', ...Object.fromEntries([...FEED_FILES].map(p => [p, 'feed1'])) };
check('all validated feed outputs may change without re-testing identical code', () =>
  assert.equal(sourceFingerprint(tree(base)), sourceFingerprint(tree({ ...base, ...Object.fromEntries([...FEED_FILES].map(p => [p, 'feed2'])) }))));
for (const file of ['js/app.js', 'functions/index.js', '.github/workflows/test.yml', '.github/workflows/lineups.yml', 'scripts/scout_lineups.py', 'data/provisional.json', 'data/history25.json', 'data/lineups-config.json']) {
  check(`${file} changes require new tests`, () => assert.notEqual(sourceFingerprint(tree(base)), sourceFingerprint(tree({ ...base, [file]: 'changed' }))));
}
// the render bot's commits: recordings and their manifests, never code
check('rendered podcast audio may change without re-testing identical code', () =>
  assert.equal(sourceFingerprint(tree(base)), sourceFingerprint(tree({ ...base, 'audio/pod/index.json': 'idx2', 'audio/pod/rendered.json': 'prov2', 'audio/pod/tt-review-gw4/abc123.mp3': 'take1' }))));
check('a file merely named audio outside audio/pod/ still counts as code', () =>
  assert.notEqual(sourceFingerprint(tree(base)), sourceFingerprint(tree({ ...base, 'js/audio.js': 'changed' }))));
const run = (id, sha, state = 'success') => ({ id, head_sha: sha, event: 'push', head_branch: 'main', status: 'completed', conclusion: state });
check('a bot predicted-lineups refresh reuses the passing run of identical code', () => {
  const trees = { tested: tree(base), refreshed: tree({ ...base, 'data/lineups.json': 'new-scout-picks' }) };
  const approved = matchingRun([run(1, 'tested')], sha => sourceFingerprint(trees[sha]), () => true, 'refreshed');
  assert.equal(approved?.head_sha, 'tested');
  assert.equal(runState(approved, [{ name: 'browser', conclusion: 'success' }, { name: 'emulator', conclusion: 'success' }]), 'ready');
});
const fingerprints = { head: 'new', good: 'new', failed: 'new', pending: 'new', old: 'old', unrelated: 'new' };
const match = runs => matchingRun(runs, sha => fingerprints[sha], sha => sha !== 'unrelated', 'head');
check('failed current code cannot borrow the old version green result', () => assert.equal(match([run(1, 'old'), run(2, 'failed', 'failure')]).conclusion, 'failure'));
check('newer failed rerun defeats older green run of the same code', () => assert.equal(match([run(1, 'good'), run(2, 'failed', 'failure')]).id, 2));
check('a newer pending run does not reuse an older green run', () => assert.equal(runState(match([run(1, 'good'), { ...run(2, 'pending'), status: 'in_progress' }])), 'pending'));
check('an unrelated branch cannot approve main', () => assert.equal(match([run(1, 'unrelated')]), undefined));
check('PR and non-main runs cannot approve a release', () => assert.equal(match([{ ...run(1, 'good'), event: 'pull_request' }, { ...run(2, 'good'), head_branch: 'feature' }]), undefined));
check('missing tests defer deployment', () => assert.equal(runState(undefined), 'pending'));
check('a workflow success with a skipped emulator job is insufficient', () => assert.equal(runState(run(1, 'good'), [{ name: 'browser', conclusion: 'success' }, { name: 'emulator', conclusion: 'skipped' }]), 'failed'));
check('both required suites must pass', () => assert.equal(runState(run(1, 'good'), [{ name: 'browser', conclusion: 'success' }, { name: 'emulator', conclusion: 'success' }]), 'ready'));

const data = { teams: [{ id: 1, name: 'Everton', short: 'EVE', code: 1, str: 100 }], players: [{ id: 1, name: 'P1', full: 'Player One', team: 1, club: 'Everton', pos: 'GK', code: 1 }], gameweeks: [{ n: 1, label: 'GW1', deadline: '2026-08-21T18:00:00Z', to: '2026-08-24T22:00:00Z', finished: false }] };
const predictedLineups = {
  source: 'https://www.fantasyfootballscout.co.uk/team-news', fetched: '2026-09-18T10:00:00Z', slot: 'gw5-T3h',
  clubs: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`T${String.fromCharCode(65 + i)}`, {
    xi: Array.from({ length: 11 }, (_, p) => i * 11 + p + 1), named: 11, unmatched: [],
    formation: '4-2-3-1', updated: 'Thu 17th Sep', updatedOn: '2026-09-17',
  }])),
};
const files = {
  'data/data.json': JSON.stringify(data),
  'data/stats.json': JSON.stringify({ gws: {} }),
  'data/fixtures.json': '[]',
  'data/teamnews.json': '{}',
  'data/predictions.json': '{}',
  'data/lineups.json': JSON.stringify(predictedLineups),
  'js/data.js': `// Generated\nconst TEAMS = ${JSON.stringify(data.teams)};\nconst PLAYERS = ${JSON.stringify(data.players)};\nconst GAMEWEEKS_RAW = ${JSON.stringify(data.gameweeks)};\n`,
};
const validate = changes => validateFeed(p => ({ ...files, ...changes })[p]);
check('valid feed passes', () => validate({}));
const lineups = change => {
  const book = structuredClone(predictedLineups);
  change(book);
  return { 'data/lineups.json': JSON.stringify(book) };
};
check('predicted lineups allow a forced fetch and unknown editorial dates', () => validate(lineups(book => {
  delete book.slot;
  Object.assign(book.clubs.TA, { formation: null, updated: null, updatedOn: null });
})));
check('predicted lineups allow omitted editorial metadata', () => validate(lineups(book => {
  delete book.source;
  delete book.fetched;
  for (const row of Object.values(book.clubs)) for (const key of ['named', 'unmatched', 'formation', 'updated', 'updatedOn']) delete row[key];
})));
check('an absent optional predicted-lineups file does not block the feed', () => validateFeed(p => {
  if (p === 'data/lineups.json') throw Object.assign(Error('missing optional feed'), { code: 'ENOENT' });
  return files[p];
}));
check('other predicted-lineups read errors still block the feed', () => assert.throws(() => validateFeed(p => {
  if (p === 'data/lineups.json') throw Object.assign(Error('permission denied'), { code: 'EACCES' });
  return files[p];
}), /permission denied/));
for (const empty of ['{}', '{"clubs":{}}']) {
  check('an explicitly empty optional predicted-lineups feed passes', () => validate({ 'data/lineups.json': empty }));
}
check('predicted lineups allow partially matched XIs from an older player feed', () => validate(lineups(book => {
  book.fetched = '2026-08-01T10:00:00Z';
  Object.assign(book.clubs.TA, { xi: [900001, 2, 3, 4, 5, 6, 7, 8], unmatched: ['One', 'Two', 'Three'], updatedOn: '2026-08-01' });
})));
for (const [name, value] of [['invalid JSON', '{'], ['an array', '[]'], ['null', 'null'], ['missing clubs', '{"source":"https://example.com"}']]) {
  check(`predicted lineups reject ${name}`, () => assert.throws(() => validate({ 'data/lineups.json': value }), /lineups.json/));
}
for (const [name, change] of [
  ['too few clubs', b => { delete b.clubs.TA; }],
  ['a malformed club', b => { b.clubs.TA = []; }],
  ['a thin XI', b => { b.clubs.TA.xi = [1, 2]; }],
  ['an oversized XI', b => { b.clubs.TA.xi.push(12); }],
  ['duplicate players', b => { b.clubs.TA.xi[0] = b.clubs.TA.xi[1]; }],
  ['non-numeric players', b => { b.clubs.TA.xi[0] = '1'; }],
  ['invalid player IDs', b => { b.clubs.TA.xi[0] = -1; }],
  ['an invalid editorial date', b => { b.clubs.TA.updatedOn = '2026-02-31'; }],
  ['an invalid fetch date', b => { b.fetched = 'yesterday'; }],
  ['an invalid fetch slot', b => { b.slot = 'latest'; }],
  ['invalid source metadata', b => { b.source = {}; }],
  ['malformed unmatched names', b => { b.clubs.TA.unmatched = {}; }],
  ['an impossible named count', b => { b.clubs.TA.named = 2; }],
]) {
  check(`predicted lineups reject ${name}`, () => assert.throws(() => validate(lineups(change)), /lineups.json/));
}
check('malformed live data is refused', () => assert.throws(() => validate({ 'data/stats.json': '{' })));
check('extra executable JavaScript cannot hide in a feed-only update', () => assert.throws(() => validate({ 'js/data.js': files['js/data.js'] + 'alert(1);\n' })));
check('inline executable JavaScript cannot hide in a declaration', () => assert.throws(() => validate({ 'js/data.js': files['js/data.js'].replace('const TEAMS = ', 'const TEAMS = alert(1) || ') })));
check('Unicode comment line breaks cannot hide executable JavaScript', () => assert.throws(() => validate({ 'js/data.js': '// safe\u2028alert(1);\n' + files['js/data.js'] })));
check('browser and server player data must match', () => assert.throws(() => validate({ 'js/data.js': files['js/data.js'].replace('Player One', 'Other Player') })));
// the deadline ledger rides the feed exception, so the gate is the only thing
// standing between a bot's arithmetic and the Committee being quoted on odds
// it never gave (Marc, 15 Sept 2026)
check('a deadline record whose odds do not add up is refused', () => assert.throws(() => validate({
  'data/predictions.json': JSON.stringify({ rounds: { 3: { games: [{ a: 1, b: 2, w: 0.9, d: 0.9, l: 0.9 }] } } }) })));
check('a deadline record with a tie missing its odds is refused', () => assert.throws(() => validate({
  'data/predictions.json': JSON.stringify({ rounds: { 3: { games: [{ a: 1, b: 2 }] } } }) })));
check('an empty round in the ledger is refused', () => assert.throws(() => validate({
  'data/predictions.json': JSON.stringify({ rounds: { 3: { games: [] } } }) })));
check('a sound deadline record passes', () => validate({
  'data/predictions.json': JSON.stringify({ rounds: { 3: { deadline: 'x', taken: 'y', games: [{ a: 1, b: 2, w: 0.5, d: 0.1, l: 0.4, pa: 44, pb: 41 }] } } }) }));
console.log(`\n[release-gate] ${passed} passed, 0 failed`);
