#!/usr/bin/env node
/* Ben, reliability pass, 4 Sept: Pages may ship only tested code. FPL bot
 * refreshes can reuse that test result, but their current data is validated
 * below. All other tracked files (including workflows) must match exactly.
 * GitHub API: https://docs.github.com/en/rest/actions/workflow-runs */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const { isDeepStrictEqual } = require('util');
const Feed = require('../functions/feedcheck.js');
const ROOT = path.resolve(__dirname, '..');
const FEED_FILES = new Set(['js/data.js', 'data/data.json', 'data/stats.json', 'data/fixtures.json', 'data/teamnews.json']);
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();

function sourceFingerprint(tree) {
  const rows = tree.split('\0').filter(Boolean).filter(row => !FEED_FILES.has(row.slice(row.indexOf('\t') + 1)));
  return hash(rows.sort().join('\0'));
}
function matchingRun(runs, fingerprint, ancestor, head) {
  const wanted = fingerprint(head);
  // Latest matching run wins, including a failure/rerun. Never fish an older
  // green result out from under a newer failed attempt of the same code.
  return [...runs].sort((a, b) => b.id - a.id).find(r =>
    r.event === 'push' && r.head_branch === 'main' && ancestor(r.head_sha, head)
    && fingerprint(r.head_sha) === wanted);
}
function runState(run, jobs = []) {
  if (!run || run.status !== 'completed') return 'pending';
  if (run.conclusion !== 'success') return 'failed';
  return ['browser', 'emulator'].every(name => jobs.some(j => j.name === name && j.conclusion === 'success')) ? 'ready' : 'failed';
}

function validateFeed(read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')) {
  const data = Feed.parseJson(read('data/data.json'), 'data.json', Feed.LIMITS.dataBytes);
  Feed.validateData(data);
  Feed.validateStats(Feed.parseJson(read('data/stats.json'), 'stats.json', Feed.LIMITS.statsBytes));
  Feed.validateFixtures(Feed.parseJson(read('data/fixtures.json'), 'fixtures.json', Feed.LIMITS.dataBytes));
  const news = Feed.parseJson(read('data/teamnews.json'), 'teamnews.json', Feed.LIMITS.dataBytes);
  if (!news || typeof news !== 'object' || Array.isArray(news)) throw Error('teamnews.json must be an object');
  // This file executes in the browser, so it cannot be treated as an opaque
  // data exception. Accept ONLY comments plus the three JSON declarations,
  // and require them to agree with the server's validated JSON feed.
  const browserData = read('js/data.js');
  if (/[\u2028\u2029]/.test(browserData)) throw Error('Unexpected JavaScript line separator in js/data.js');
  const lines = browserData.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('//'));
  const names = ['TEAMS', 'PLAYERS', 'GAMEWEEKS_RAW'];
  const values = [data.teams, data.players, data.gameweeks];
  if (lines.length !== names.length) throw Error('Unexpected code in js/data.js');
  names.forEach((name, i) => {
    const match = lines[i].match(new RegExp(`^const ${name} = (.+);$`));
    if (!match || !isDeepStrictEqual(JSON.parse(match[1]), values[i])) throw Error(`js/data.js ${name} differs from data.json`);
  });
}

async function main() {
  if (git('status', '--porcelain', '--untracked-files=all')) throw Error('Release requires a clean checkout of the candidate commit');
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) throw Error('GitHub repository and read-only Actions token required');
  const api = async rel => {
    const r = await fetch(`https://api.github.com/repos/${repo}/${rel}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw Error(`GitHub release check failed: HTTP ${r.status}`);
    return r.json();
  };
  const head = git('rev-parse', 'HEAD');
  const cache = new Map();
  const fingerprint = sha => {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Invalid commit id');
    if (!cache.has(sha)) cache.set(sha, sourceFingerprint(git('ls-tree', '-rz', '--full-tree', sha)));
    return cache.get(sha);
  };
  const ancestor = (a, b) => /^[a-f0-9]{40}$/.test(a) && spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: ROOT }).status === 0;
  const { workflow_runs: runs } = await api('actions/workflows/test.yml/runs?branch=main&event=push&per_page=100');
  const run = matchingRun(runs, fingerprint, ancestor, head);
  const jobs = run?.status === 'completed' && run.conclusion === 'success'
    ? (await api(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)).jobs : [];
  const state = runState(run, jobs);
  if (state === 'pending') {
    // Test completion triggers Pages again. Do not occupy its deploy queue
    // waiting while matchday data commits keep arriving.
    console.log('Code has no completed checks yet; test completion will retry the release.');
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'skip=1\n');
    return;
  }
  if (state !== 'ready') throw Error(`Refusing release: matching test run ${run.id} did not pass both suites`);
  validateFeed();
  const serverFiles = ['functions/index.js', 'functions/feedcheck.js', 'js/engine.js', 'functions/package.json', 'functions/package-lock.json'];
  const release = {
    siteCommit: head, sourceFingerprint: fingerprint(head), testedCommit: run.head_sha,
    testRun: run.html_url,
    // Expected server source, not a claim about what is currently deployed.
    expectedServerFiles: Object.fromEntries(serverFiles.map(p => [p, hash(fs.readFileSync(path.join(ROOT, p)))])),
  };
  fs.writeFileSync(path.join(ROOT, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  console.log(`Release approved: ${head}, tested code ${run.head_sha}, run ${run.id}; current feed validated.`);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { FEED_FILES, sourceFingerprint, matchingRun, runState, validateFeed };
