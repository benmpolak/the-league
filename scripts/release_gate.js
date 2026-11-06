#!/usr/bin/env node
/* Ben, reliability pass, 4 Sept: Pages may ship only tested code. FPL bot
 * refreshes can reuse that test result, but their current data is validated
 * below. All other tracked files (including workflows) must match exactly.
 * GitHub API: https://docs.github.com/en/rest/actions/workflow-runs
 *
 * Ben, 6 Nov 2026: while a code push was red, or still testing (15-25
 * minutes), that rule refused every five-minute data refresh with it, and the
 * scores on the site froze: 11, 14 and 23 Oct (twice), 4 Nov. Four of those five
 * pushes changed site code, so "the same code is already live" would not have
 * saved them. Now, when HEAD's code is not cleared, the release keeps the code
 * that is already live and lays HEAD's data over it (dataOnlyRelease). New
 * code still ships only after its own green run. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const { isDeepStrictEqual } = require('util');
const Feed = require('../functions/feedcheck.js');
const ROOT = path.resolve(__dirname, '..');
const FEED_FILES = new Set(['js/data.js', 'data/data.json', 'data/stats.json', 'data/fixtures.json', 'data/teamnews.json', 'data/predictions.json', 'data/lineups.json']);
// Rendered podcast audio and its manifests are data too (Ben, 16 Sept 2026).
// The render bot commits them with the workflow token, which never triggers
// the test workflow, so counting them as code left the gate with no test run
// to match and froze every deploy until a human pushed: 02:24 to 12:13 that
// morning, then again the same evening. The app only reads index.json to find
// a recording; nothing under here executes.
const AUDIO_DIR = 'audio/pod/';
const isData = p => FEED_FILES.has(p) || p.startsWith(AUDIO_DIR);
// This script's own manifest ships with the site, so the live copy names the
// code that is running. Read with a cache-buster: Pages' CDN can hold a copy
// for ten minutes, and a stale one would roll the site back a release.
const LIVE_RELEASE = 'https://theleaguehq.co.uk/release.json';
// If a held-back push changed any of these, the data-only release stands
// aside and the old freeze applies (Ben, 6 Nov 2026). The bots run the data
// writers from HEAD, so a changed writer could hand the live code data in a
// shape it was never tested with: the feed checks test shape for safety, not
// every field the app reads. (The predictions writers also drive the app in a
// browser; pinning the app would pin nearly every push, so the ledger's odds
// are checked instead.) An unchanged gate and deploy workflow mean the
// data-only release is itself run by tested code.
const PINNED = [
  'scripts/fetch_fpl.py', 'scripts/provisional.py', 'scripts/scout_lineups.py', 'scripts/lineups.py',
  'scripts/snapshot_predictions.js', 'scripts/backfill_predictions.js',
  'scripts/render_pods.js', 'scripts/pod_voice.js', 'scripts/pod_history.js',
  'scripts/release_gate.js', '.github/workflows/pages.yml',
];
const SERVER_FILES = ['functions/index.js', 'functions/feedcheck.js', 'js/engine.js', 'js/club-media.js', 'functions/package.json', 'functions/package-lock.json'];
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const isSha = v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const short = sha => sha.slice(0, 7);
const rows = tree => tree.split('\0').filter(Boolean);
const pathOf = row => row.slice(row.indexOf('\t') + 1);

function sourceFingerprint(tree) {
  return hash(rows(tree).filter(row => !isData(pathOf(row))).sort().join('\0'));
}
// The other half: lets a data-only release see the site already has this data.
function dataFingerprint(tree) {
  return hash(rows(tree).filter(row => isData(pathOf(row))).sort().join('\0'));
}
function gitRepo(cwd) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();
  const trees = new Map();
  const tree = sha => {
    if (!isSha(sha)) throw Error('Invalid commit id');
    if (!trees.has(sha)) trees.set(sha, git('ls-tree', '-rz', '--full-tree', sha));
    return trees.get(sha);
  };
  return {
    cwd, git, tree,
    fingerprint: sha => sourceFingerprint(tree(sha)),
    ancestor: (a, b) => isSha(a) && spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd }).status === 0,
    read: p => fs.readFileSync(path.join(cwd, p), 'utf8'),
  };
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

function validateLineups(book) {
  const object = v => v && typeof v === 'object' && !Array.isArray(v);
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if (!object(book)) throw Error('lineups.json must be an object');
  // The app treats an empty optional feed as no scouting input.
  if (!Object.keys(book).length) return;
  if (!object(book.clubs)) throw Error('lineups.json must contain a clubs object');
  if ((book.source != null && (!text(book.source, 200) || !/^https:\/\//.test(book.source)))
    || (book.fetched != null && (!text(book.fetched, 40) || !Number.isFinite(Date.parse(book.fetched))))) throw Error('lineups.json has invalid source metadata');
  // A forced fetch has no slot; the scheduled fetch names its deadline window.
  if (book.slot != null && (!text(book.slot, 30) || !/^gw[1-9]\d?-T\d{1,3}h$/.test(book.slot))) throw Error('lineups.json has an invalid fetch slot');
  const clubs = Object.entries(book.clubs);
  if (clubs.length && (clubs.length < 12 || clubs.length > Feed.LIMITS.teams)) throw Error('lineups.json has an invalid club count');
  for (const [code, row] of clubs) {
    if (!/^[A-Z]{2,4}$/.test(code) || !object(row)) throw Error('lineups.json has an invalid club entry');
    if (!Array.isArray(row.xi) || row.xi.length < 8 || row.xi.length > 11
      || !row.xi.every(id => Number.isInteger(id) && id > 0 && id <= 99999999)
      || new Set(row.xi).size !== row.xi.length) throw Error(`lineups.json ${code} has an invalid predicted XI`);
    if ((row.named != null && (!Number.isInteger(row.named) || row.named < row.xi.length || row.named > 11))
      || (row.unmatched != null && (!Array.isArray(row.unmatched) || row.unmatched.length > 11 || !row.unmatched.every(name => text(name, 120))))
      || !(row.formation == null || text(row.formation, 40))
      || !(row.updated == null || text(row.updated, 120))
      || !(row.updatedOn == null || date(row.updatedOn))) throw Error(`lineups.json ${code} has invalid prediction metadata`);
  }
}

function validateFeed(read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')) {
  const data = Feed.parseJson(read('data/data.json'), 'data.json', Feed.LIMITS.dataBytes);
  Feed.validateData(data);
  Feed.validateStats(Feed.parseJson(read('data/stats.json'), 'stats.json', Feed.LIMITS.statsBytes));
  Feed.validateFixtures(Feed.parseJson(read('data/fixtures.json'), 'fixtures.json', Feed.LIMITS.dataBytes));
  const news = Feed.parseJson(read('data/teamnews.json'), 'teamnews.json', Feed.LIMITS.dataBytes);
  if (!news || typeof news !== 'object' || Array.isArray(news)) throw Error('teamnews.json must be an object');
  // Ben, 19 Sept 2026: Scout's bot does not trigger CI either. Validate its
  // JSON output before reusing tested code, as for the other feed writers.
  // Stale dates and transferred player IDs are valid: scoutXI handles age,
  // and the prediction may outlive the player feed it was matched against.
  let lineups;
  try { lineups = read('data/lineups.json'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; } // The browser also accepts an absent optional feed.
  if (lineups !== undefined) validateLineups(Feed.parseJson(lineups, 'lineups.json', Feed.LIMITS.dataBytes));
  // the deadline ledger. A bot writes it, so it rides the feed exception and
  // has to be checked here instead: a round's odds must add up, or the card
  // would be quoting the Committee on something it never said.
  const preds = Feed.parseJson(read('data/predictions.json'), 'predictions.json', Feed.LIMITS.dataBytes);
  if (!preds || typeof preds !== 'object' || Array.isArray(preds)) throw Error('predictions.json must be an object');
  for (const [gwN, row] of Object.entries(preds.rounds || {})) {
    if (!row || !Array.isArray(row.games) || !row.games.length) throw Error(`predictions.json GW${gwN} has no ties`);
    for (const g of row.games) {
      if (![g.w, g.d, g.l].every(Number.isFinite)) throw Error(`predictions.json GW${gwN} has a tie with no odds`);
      if (Math.abs(g.w + g.d + g.l - 1) > 0.01) throw Error(`predictions.json GW${gwN} has odds that do not total one`);
    }
  }
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

// Base's code with head's data, built in a scratch index so nothing on disk
// moves until the result has been checked.
function overlayTree(repo, base, head) {
  const dataRows = sha => rows(repo.tree(sha)).filter(row => isData(pathOf(row)));
  const keep = dataRows(head);
  const kept = new Set(keep.map(pathOf));
  // mode 0 removes a path: data the held-back push deleted stays deleted
  const drop = dataRows(base).map(pathOf).filter(p => !kept.has(p)).map(p => `0 ${'0'.repeat(40)}\t${p}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-overlay-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') };
  const git = (args, input) => execFileSync('git', args, { cwd: repo.cwd, env, input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }).trim();
  try {
    git(['read-tree', base]);
    git(['update-index', '-z', '--index-info'], [...drop, ...keep].map(row => row + '\0').join(''));
    const overlay = git(['write-tree']);
    if (sourceFingerprint(repo.tree(overlay)) !== repo.fingerprint(base)
      || dataFingerprint(repo.tree(overlay)) !== dataFingerprint(repo.tree(head))) throw Error('the overlay does not match its sources');
    return overlay;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The feed checks of the code that will read the data, run from the overlaid
// checkout so they load that code's own functions/feedcheck.js.
function validateWithLiveCode(cwd) {
  const r = spawnSync(process.execPath, ['-e', 'try { require(process.argv[1]).validateFeed(); } catch (e) { console.error(e.message); process.exit(1); }',
    path.join(cwd, 'scripts/release_gate.js')], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw Error(`its own feed checks refuse the data: ${(r.stderr || '').trim().slice(0, 300)}`);
}

// HEAD's code is not cleared, so keep the code the site is already running
// and lay HEAD's data over it, in the working tree, for Pages to upload.
// The live code's own test run must still stand: an older green result is
// only borrowed for code that is already live, never for new code.
async function dataOnlyRelease(repo, { head, runs, clearance, live }) {
  const base = live && live.siteCommit;
  if (!isSha(base)) throw Error('the live release.json names no site commit');
  if (!repo.ancestor(base, head)) throw Error(`live code ${short(base)} is not in main's history`);
  const run = matchingRun(runs, repo.fingerprint, repo.ancestor, base);
  if (await clearance(run) !== 'ready') throw Error(`live code ${short(base)} has no passing test run to stand on`);
  const blobs = sha => new Map(rows(repo.tree(sha)).map(row => [pathOf(row), row.slice(0, row.indexOf('\t'))]));
  const [was, now] = [blobs(base), blobs(head)];
  const moved = PINNED.filter(p => was.get(p) !== now.get(p));
  if (moved.length) throw Error(`the held-back push changes ${moved.join(', ')}`);
  const data = dataFingerprint(repo.tree(head));
  if (live.dataFingerprint === data) return { skip: `the site already has this data on live code ${short(base)}` };
  repo.git('read-tree', '--reset', '-u', overlayTree(repo, base, head));
  validateFeed(repo.read); // the checks that came with the data's writers
  validateWithLiveCode(repo.cwd);
  return { base, run, data };
}

function manifest(repo, fields) {
  // Expected server source, not a claim about what is currently deployed.
  return { ...fields, expectedServerFiles: Object.fromEntries(SERVER_FILES.map(p => [p, hash(fs.readFileSync(path.join(repo.cwd, p)))])) };
}

async function release({ repo, head, runs, clearance, loadLive, log = console.log }) {
  const run = matchingRun(runs, repo.fingerprint, repo.ancestor, head);
  const state = await clearance(run);
  const data = dataFingerprint(repo.tree(head));
  if (state === 'ready') {
    validateFeed(repo.read);
    log(`Release approved: ${head}, tested code ${run.head_sha}, run ${run.id}; current feed validated.`);
    return manifest(repo, {
      mode: 'tested', siteCommit: head, dataCommit: head, sourceFingerprint: repo.fingerprint(head), dataFingerprint: data,
      testedCommit: run.head_sha, testRun: run.html_url,
    });
  }
  const held = state === 'pending' ? `code ${short(head)} has no completed checks yet` : `code ${short(head)} failed test run ${run.id}`;
  let fallback;
  try {
    fallback = await dataOnlyRelease(repo, { head, runs, clearance, live: await loadLive() });
  } catch (e) {
    if (state !== 'pending') throw Error(`Refusing release: ${held}, and the live code cannot take the new data: ${e.message}`);
    // Test completion triggers Pages again. Do not occupy its deploy queue
    // waiting while matchday data commits keep arriving.
    log(`::warning::Release waits: ${held}, and the live code cannot take the new data (${e.message}). Test completion will retry.`);
    return { skip: true };
  }
  if (fallback.skip) {
    log(`Nothing to release: ${held}, and ${fallback.skip}.`);
    return { skip: true };
  }
  log(`::warning::Data-only release: ${held}, so the site keeps code ${short(fallback.base)} (test run ${fallback.run.id}) with the data from ${short(head)}.`);
  return manifest(repo, {
    mode: 'data-only',
    note: 'The site is running earlier tested code (siteCommit) with newer data (dataCommit). The newer code waits for its own tests.',
    siteCommit: fallback.base, dataCommit: head, sourceFingerprint: repo.fingerprint(fallback.base), dataFingerprint: data,
    testedCommit: fallback.run.head_sha, testRun: fallback.run.html_url,
    heldBack: { commit: head, sourceFingerprint: repo.fingerprint(head), tests: state, testRun: run?.html_url ?? null },
  });
}

async function main() {
  const repo = gitRepo(ROOT);
  if (repo.git('status', '--porcelain', '--untracked-files=all')) throw Error('Release requires a clean checkout of the candidate commit');
  const slug = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!slug || !/^[\w.-]+\/[\w.-]+$/.test(slug) || !token) throw Error('GitHub repository and read-only Actions token required');
  const api = async rel => {
    const r = await fetch(`https://api.github.com/repos/${slug}/${rel}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw Error(`GitHub release check failed: HTTP ${r.status}`);
    return r.json();
  };
  const clearance = async run => runState(run, run?.status === 'completed' && run.conclusion === 'success'
    ? (await api(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)).jobs : []);
  const loadLive = async () => {
    const r = await fetch(`${LIVE_RELEASE}?gate=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Error(`live release.json: HTTP ${r.status}`);
    return r.json();
  };
  const head = repo.git('rev-parse', 'HEAD');
  const { workflow_runs: runs } = await api('actions/workflows/test.yml/runs?branch=main&event=push&per_page=100');
  const result = await release({ repo, head, runs, clearance, loadLive });
  if (result.skip) {
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'skip=1\n');
    return;
  }
  fs.writeFileSync(path.join(ROOT, 'release.json'), JSON.stringify(result, null, 2) + '\n');
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { FEED_FILES, PINNED, sourceFingerprint, dataFingerprint, matchingRun, runState, validateFeed, gitRepo, release };
