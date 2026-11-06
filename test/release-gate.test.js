'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { FEED_FILES, PINNED, sourceFingerprint, dataFingerprint, matchingRun, runState, validateFeed, gitRepo, release } = require('../scripts/release_gate.js');
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

// The data-only release (Ben, 6 Nov 2026: a red or still-testing push froze
// the scores four times in four weeks), end to end in a scratch repo. The live
// code is v1; a held-back push brings v2, and the bot refreshes data on top.
const root = path.resolve(__dirname, '..');
check('every script a data-committing workflow runs, and what it loads, is pinned', () => {
  const flows = path.join(root, '.github/workflows');
  for (const name of fs.readdirSync(flows)) {
    const text = fs.readFileSync(path.join(flows, name), 'utf8');
    if (!/\bgit add\b/.test(text)) continue;
    for (const [script] of text.matchAll(/scripts\/[\w.-]+/g)) assert.ok(PINNED.includes(script), `${name} runs ${script}, which is not pinned`);
  }
  for (const file of PINNED) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is pinned but missing`);
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const deps = file.endsWith('.py')
      ? [...src.matchAll(/^(?:import|from)\s+(\w+)/gm)].map(m => `scripts/${m[1]}.py`).filter(p => fs.existsSync(path.join(root, p)))
      : [...src.matchAll(/require\('\.\/([\w.-]+?)(?:\.js)?'\)/g)].map(m => `scripts/${m[1]}.js`);
    for (const dep of deps) assert.ok(PINNED.includes(dep), `${file} loads ${dep}, which is not pinned`);
  }
});

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const feed = ({ format = 1, gw = 1 } = {}) => ({
  ...files,
  'data/data.json': JSON.stringify({ ...data, format }),
  'data/stats.json': JSON.stringify({ gws: { [gw]: { finished: false, stats: { 1: { pts: gw } } } } }),
});
// Stands in for the gate's validateFeed: loads the checkout's own feedcheck.
const scratchGate = `'use strict';
const fs = require('fs');
const path = require('path');
const check = require('../functions/feedcheck.js');
exports.validateFeed = () => check(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/data.json'), 'utf8')));
`;
const scratchDirs = [];
function scenario({ heldBack = {}, refresh = {} } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-test-'));
  scratchDirs.push(cwd);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' }).trim();
  const commit = changes => {
    for (const [p, body] of Object.entries(changes)) {
      const file = path.join(cwd, p);
      if (body === null) { fs.rmSync(file); continue; }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    git('add', '-A');
    git('commit', '-q', '-m', 'step');
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  const live = commit({
    ...feed(), 'index.html': '<script src="js/app.js"></script>', 'js/app.js': 'v1',
    'scripts/release_gate.js': scratchGate, 'scripts/fetch_fpl.py': 'writer v1',
    'functions/feedcheck.js': "module.exports = d => { if (d.format !== 1) throw Error('this code reads feed format 1 only'); };",
    'functions/index.js': 'fn1', 'js/engine.js': 'engine1', 'js/club-media.js': 'media1', 'functions/package.json': '{}', 'functions/package-lock.json': '{}',
    'audio/pod/index.json': '{"takes":["old"]}', 'audio/pod/old.mp3': 'old take',
  });
  const pushed = commit({ 'js/app.js': 'v2', 'js/new.js': 'new in v2', 'functions/feedcheck.js': 'module.exports = () => {};', ...heldBack });
  const head = commit({ ...feed({ gw: 2 }), 'audio/pod/index.json': '{"takes":["new"]}', 'audio/pod/old.mp3': null, 'audio/pod/new.mp3': 'new take', ...refresh });
  return {
    git, commit, repo: gitRepo(cwd), live, pushed, head,
    read: p => fs.readFileSync(path.join(cwd, p), 'utf8'), exists: p => fs.existsSync(path.join(cwd, p)),
  };
}
const ghRun = (id, sha, extra = {}) => ({ ...run(id, sha), run_attempt: 1, html_url: `https://github.com/o/r/actions/runs/${id}`, ...extra });
const clearance = async r => runState(r, [{ name: 'browser', conclusion: 'success' }, { name: 'emulator', conclusion: 'success' }]);
function gate(s, { held = 'failure', head = s.head, live = { siteCommit: s.live }, runs } = {}) {
  const logs = [];
  const heldRun = held === 'pending' ? ghRun(2, s.pushed, { status: 'in_progress', conclusion: null }) : ghRun(2, s.pushed, { conclusion: held });
  const result = release({
    repo: s.repo, head, runs: runs || [ghRun(1, s.live), heldRun], clearance,
    loadLive: async () => (typeof live === 'function' ? live() : live), log: m => logs.push(m),
  });
  return { logs, result };
}
const asyncChecks = [];
const checkAsync = (name, fn) => asyncChecks.push([name, fn]);

checkAsync('a red push no longer freezes the data: the live code ships with the new data', async () => {
  const s = scenario();
  const { logs, result } = gate(s);
  const r = await result;
  assert.equal(r.mode, 'data-only');
  assert.equal(r.siteCommit, s.live);
  assert.equal(r.dataCommit, s.head);
  assert.equal(r.testedCommit, s.live);
  assert.equal(r.sourceFingerprint, s.repo.fingerprint(s.live));
  assert.equal(r.dataFingerprint, dataFingerprint(s.repo.tree(s.head)));
  assert.deepEqual(r.heldBack, { commit: s.head, sourceFingerprint: s.repo.fingerprint(s.head), tests: 'failed', testRun: 'https://github.com/o/r/actions/runs/2' });
  // the checkout Pages uploads: v1 code, v2's new file gone, the newest data
  assert.equal(s.read('js/app.js'), 'v1');
  assert.equal(s.exists('js/new.js'), false);
  assert.match(s.read('functions/feedcheck.js'), /format 1/);
  assert.equal(r.expectedServerFiles['functions/feedcheck.js'], sha256(s.read('functions/feedcheck.js')));
  assert.equal(s.read('data/stats.json'), feed({ gw: 2 })['data/stats.json']);
  assert.equal(s.read('audio/pod/new.mp3'), 'new take');
  assert.equal(s.exists('audio/pod/old.mp3'), false);
  assert.equal(s.git('rev-parse', 'HEAD'), s.head);
  assert.match(logs.join('\n'), /::warning::Data-only release/);
});
checkAsync('a push still testing ships its data on the live code too', async () => {
  const s = scenario();
  const r = await gate(s, { held: 'pending' }).result;
  assert.equal(r.mode, 'data-only');
  assert.equal(r.heldBack.tests, 'pending');
  assert.equal(r.heldBack.testRun, 'https://github.com/o/r/actions/runs/2');
  assert.equal(s.read('js/app.js'), 'v1');
});
checkAsync('new code still ships whole only after its own green run', async () => {
  const s = scenario();
  const r = await gate(s, { held: 'success' }).result;
  assert.equal(r.mode, 'tested');
  assert.equal(r.siteCommit, s.head);
  assert.equal(r.testedCommit, s.pushed);
  assert.equal(s.read('js/app.js'), 'v2');
});
checkAsync('the next refresh while the push is still red stays on the same live code', async () => {
  const s = scenario();
  const first = await gate(s).result;
  s.git('reset', '-q', '--hard', s.head); // each deploy starts from a clean checkout
  const next = s.commit(feed({ gw: 3 }));
  const r = await gate(s, { head: next, live: first }).result;
  assert.equal(r.siteCommit, s.live);
  assert.equal(r.dataCommit, next);
  assert.equal(s.read('js/app.js'), 'v1');
  assert.equal(s.read('data/stats.json'), feed({ gw: 3 })['data/stats.json']);
});
checkAsync('a code push that brings no new data is not redeployed', async () => {
  const s = scenario();
  const live = { siteCommit: s.live, dataFingerprint: dataFingerprint(s.repo.tree(s.head)) };
  assert.deepEqual(await gate(s, { held: 'pending', live }).result, { skip: true });
  assert.equal(s.read('js/app.js'), 'v2');
});
checkAsync('data the live code\'s own checks refuse is not shipped, and the failure says why', async () => {
  const s = scenario({ refresh: feed({ format: 2, gw: 2 }) }); // the held-back writer's new format
  await assert.rejects(gate(s).result, /Refusing release: code \w{7} failed test run 2, and the live code cannot take the new data: its own feed checks refuse the data: this code reads feed format 1 only/);
});
checkAsync('while the push is still testing, that refusal waits for the tests as before', async () => {
  const s = scenario({ refresh: feed({ format: 2, gw: 2 }) });
  const { logs, result } = gate(s, { held: 'pending' });
  assert.deepEqual(await result, { skip: true });
  assert.match(logs.join('\n'), /::warning::Release waits: .*format 1 only/);
});
checkAsync('data the current feed checks refuse is not shipped either', async () => {
  const s = scenario({ refresh: { 'data/stats.json': '{' } });
  await assert.rejects(gate(s).result, /live code cannot take the new data: feed rejected: stats.json/);
});
for (const file of ['scripts/fetch_fpl.py', 'scripts/release_gate.js']) {
  checkAsync(`a held-back push that changes ${file} keeps the old freeze`, async () => {
    const s = scenario({ heldBack: { [file]: 'changed' } });
    await assert.rejects(gate(s).result, new RegExp(`the held-back push changes ${file}`));
    assert.equal(s.read('js/app.js'), 'v2'); // nothing on disk moved
  });
}
checkAsync('live code outside main\'s history is never brought back', async () => {
  const s = scenario();
  const stray = s.git('commit-tree', `${s.live}^{tree}`, '-m', 'stray');
  await assert.rejects(gate(s, { live: { siteCommit: stray } }).result, /is not in main's history/);
});
checkAsync('live code with no passing run of its own is not released', async () => {
  const s = scenario();
  await assert.rejects(gate(s, { runs: [ghRun(2, s.pushed, { conclusion: 'failure' })] }).result, /has no passing test run/);
});
checkAsync('an unreadable live manifest keeps the old behaviour', async () => {
  const s = scenario();
  await assert.rejects(gate(s, { live: () => { throw Error('live release.json: HTTP 404'); } }).result, /HTTP 404/);
  assert.deepEqual(await gate(s, { held: 'pending', live: {} }).result, { skip: true });
});

(async () => {
  for (const [name, fn] of asyncChecks) { await fn(); passed++; console.log(`PASS ${name}`); }
  console.log(`\n[release-gate] ${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => { for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true }); });
