'use strict';
const assert = require('node:assert/strict');
const { FEED_FILES, sourceFingerprint, matchingRun, runState, validateFeed } = require('../scripts/release_gate.js');
let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
const tree = files => Object.entries(files).map(([p, sha]) => `100644 blob ${sha}\t${p}\0`).join('');
const base = { 'js/app.js': 'app1', 'functions/index.js': 'fn1', '.github/workflows/test.yml': 'test1', ...Object.fromEntries([...FEED_FILES].map(p => [p, 'feed1'])) };
check('all five feed outputs may change without re-testing identical code', () =>
  assert.equal(sourceFingerprint(tree(base)), sourceFingerprint(tree({ ...base, ...Object.fromEntries([...FEED_FILES].map(p => [p, 'feed2'])) }))));
for (const file of ['js/app.js', 'functions/index.js', '.github/workflows/test.yml', 'data/provisional.json']) {
  check(`${file} changes require new tests`, () => assert.notEqual(sourceFingerprint(tree(base)), sourceFingerprint(tree({ ...base, [file]: 'changed' }))));
}
const run = (id, sha, state = 'success') => ({ id, head_sha: sha, event: 'push', head_branch: 'main', status: 'completed', conclusion: state });
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
const files = {
  'data/data.json': JSON.stringify(data),
  'data/stats.json': JSON.stringify({ gws: {} }),
  'data/fixtures.json': '[]',
  'data/teamnews.json': '{}',
  'js/data.js': `// Generated\nconst TEAMS = ${JSON.stringify(data.teams)};\nconst PLAYERS = ${JSON.stringify(data.players)};\nconst GAMEWEEKS_RAW = ${JSON.stringify(data.gameweeks)};\n`,
};
const validate = changes => validateFeed(p => ({ ...files, ...changes })[p]);
check('valid feed passes', () => validate({}));
check('malformed live data is refused', () => assert.throws(() => validate({ 'data/stats.json': '{' })));
check('extra executable JavaScript cannot hide in a feed-only update', () => assert.throws(() => validate({ 'js/data.js': files['js/data.js'] + 'alert(1);\n' })));
check('inline executable JavaScript cannot hide in a declaration', () => assert.throws(() => validate({ 'js/data.js': files['js/data.js'].replace('const TEAMS = ', 'const TEAMS = alert(1) || ') })));
check('Unicode comment line breaks cannot hide executable JavaScript', () => assert.throws(() => validate({ 'js/data.js': '// safe\u2028alert(1);\n' + files['js/data.js'] })));
check('browser and server player data must match', () => assert.throws(() => validate({ 'js/data.js': files['js/data.js'].replace('Player One', 'Other Player') })));
console.log(`\n[release-gate] ${passed} passed, 0 failed`);
