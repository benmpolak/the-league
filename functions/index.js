/* The League — server-authoritative mutation layer (Cloud Functions v2).
 *
 * Every consequential write to the league goes through `mutate` (or the
 * scheduled waiver runner). The actor is ALWAYS derived from the verified
 * auth token — request data never names who is acting. Game legality is
 * enforced with the same engine the client renders with (js/engine.js,
 * copied here at deploy; parity guarded by test/engine.parity.test.js).
 *
 * Authority: the server-owned membership node is the ONLY source of who may
 * act. Custom claims on the token are never trusted — a revoked or
 * downgraded manager is powerless the moment membership says so.
 *
 * Reference data (players/gameweeks/stats) is fetched as PURE JSON from the
 * deployed site and strictly validated (functions/feedcheck.js). Nothing
 * fetched is ever executed.
 *
 * Data layout (see database.rules.v2.json — clients cannot write ANY of it):
 *   v2/leagues/$l/public/...            world-readable game state
 *   v2/leagues/$l/private/$uid/...      autolist + waiver claims (owner-read)
 *   v2/leagues/$l/server/membership     uid -> {managerId, role}
 *   v2/leagues/$l/server/managerUid     managerId -> uid
 *   v2/leagues/$l/server/waiverRuns     runId -> {status, plan, ...}
 */
'use strict';
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const Engine = require('./engine.js');
const Feed = require('./feedcheck.js');

setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });
// explicit databaseURL: the emulator redirects the transport, but the
// NAMESPACE comes from this URL — leaving it implicit made the emulated
// functions read a different (empty) database depending on tooling version
admin.initializeApp({
  databaseURL: 'https://calciopoli-wc26-default-rtdb.europe-west1.firebasedatabase.app',
});

const LEAGUES = ['the-league-2627', 'the-league-sandbox'];
const CUP_START = 7;
// reference data comes from the deployed site (updated every 15 min by the
// FPL Action) so functions never need redeploying for data
const DATA_BASE = process.env.DATA_BASE_URL || 'https://theleaguehq.co.uk';

/* Failure injection for the emulator suites ONLY — proves crash recovery at
 * write boundaries. Inert in production: the env var is set by the emulator. */
const EMULATED = process.env.FUNCTIONS_EMULATOR === 'true';
function failpoint(failAt, name) {
  if (EMULATED && failAt === name) throw new Error(`failpoint:${name}`);
}

/* ---------------- reference data (players / gameweeks / stats) ---------------- */
async function fetchJson(rel, label, maxBytes, { optional = false } = {}) {
  const r = await fetch(`${DATA_BASE}/${rel}?t=${Date.now()}`);
  if (!r.ok) {
    if (optional) return null;
    throw new Error(`${label} ${r.status}`);
  }
  const text = await r.text();
  return Feed.parseJson(text, label, maxBytes); // size-capped, parsed as data only
}

let _ctxCache = null;
async function loadCtx() {
  if (_ctxCache && Date.now() - _ctxCache.at < 5 * 60 * 1000) return _ctxCache;
  const [dataRaw, histRaw, statsRaw, fixturesRaw] = await Promise.all([
    fetchJson('data/data.json', 'data.json', Feed.LIMITS.dataBytes),
    fetchJson('data/history25.json', 'history25.json', Feed.LIMITS.historyBytes, { optional: true }),
    fetchJson('data/stats.json', 'stats.json', Feed.LIMITS.statsBytes),
    fetchJson('data/fixtures.json', 'fixtures.json', Feed.LIMITS.dataBytes, { optional: true }),
  ]);
  const { TEAMS, PLAYERS, GAMEWEEKS_RAW } = Feed.validateData(dataRaw);
  const LAST_SEASON = histRaw ? Feed.validateHistory(histRaw) : { byCode: {} };
  const statsRes = Feed.validateStats(statsRaw);
  const FIXTURES = fixturesRaw ? Feed.validateFixtures(fixturesRaw) : [];
  const gameweeks = GAMEWEEKS_RAW.map(g => ({ n: g.n, label: g.label, from: g.deadline, to: g.to, finished: g.finished }));
  // matchStats in the exact shape the client builds in syncNow()
  const matchStats = {};
  for (const [gwN, gw] of Object.entries(statsRes.gws || {})) {
    const i = +gwN - 1;
    if (!gameweeks[i]) continue;
    matchStats[`gw${gwN}`] = { gw: i, label: gameweeks[i].label, date: gameweeks[i].from, final: !!gw.finished, playerStats: gw.stats || {} };
  }
  const eng = Engine.make({ players: PLAYERS, gameweeks, fixtures: FIXTURES, lastSeasonByCode: LAST_SEASON.byCode || {}, now: () => Date.now() });
  _ctxCache = { at: Date.now(), eng, PLAYERS, TEAMS, gameweeks, matchStats, PLAYER_BY_ID: Object.fromEntries(PLAYERS.map(p => [p.id, p])), feedGenerated: statsRes.generated || null };
  return _ctxCache;
}

/* ---------------- league plumbing ---------------- */
const db = () => admin.database();
function leagueBase(league) {
  if (!LEAGUES.includes(league)) throw new HttpsError('invalid-argument', 'unknown league');
  return `v2/leagues/${league}`;
}
async function actor(req, league) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'sign in first');
  const base = leagueBase(league);
  const uid = req.auth.uid;
  // membership is the ONLY authority. The custom claim on the token is at
  // most a UI hint — it never grants access and never overrides a missing,
  // revoked or downgraded membership entry.
  const m = (await db().ref(`${base}/server/membership/${uid}`).get()).val();
  if (!m || !Number.isInteger(m.managerId)) throw new HttpsError('permission-denied', 'not a manager in this league');
  return { uid, managerId: m.managerId, role: m.role === 'commissioner' ? 'commissioner' : 'manager' };
}
const isCommish = a => a.role === 'commissioner';
// a manager acts for themselves; the commissioner may act for anyone, but only
// by explicitly naming them (the client shows its own override confirm)
function actingManager(a, data) {
  const target = Number.isInteger(data.asManager) ? data.asManager : a.managerId;
  if (target !== a.managerId && !isCommish(a)) throw new HttpsError('permission-denied', 'that is not your team');
  return target;
}

const toArr = x => Array.isArray(x) ? x : (x ? Object.values(x) : []);
function normalizeState(pub, ctx) {
  const s = pub || {};
  s.managers = toArr(s.managers);
  s.settings = s.settings || {};
  s.settings.scoring = { ...Engine.DEFAULT_SCORING, ...(s.settings.scoring || {}) };
  s.settings.posMin = { ...Engine.SQUAD_RULES.min };
  s.settings.posMax = { ...Engine.SQUAD_RULES.max };
  s.settings.squadSize = Engine.SQUAD_RULES.size;
  s.draft = s.draft || {};
  s.draft.order = toArr(s.draft.order);
  s.draft.picks = toArr(s.draft.picks);
  s.draft.breaksDone = toArr(s.draft.breaksDone);
  s.draft.timewastes = s.draft.timewastes || {};
  s.transfers = toArr(s.transfers);
  s.trades = toArr(s.trades);
  s.covenants = toArr(s.covenants);
  s.lineups = s.lineups || {};
  for (const mid of Object.keys(s.lineups)) {
    for (const k of Object.keys(s.lineups[mid] || {})) {
      if (!k.endsWith('-t')) s.lineups[mid][k] = toArr(s.lineups[mid][k]);
    }
  }
  s.benchOrders = s.benchOrders || {};
  s.shirtNums = s.shirtNums || {};
  s.tradeBlock = s.tradeBlock || {};
  s.lobus = s.lobus || {};
  s.adjustments = s.adjustments || {};
  // pre-Aug-2026 flat {pid: pts} adjustments: retired shape (never scored a
  // GW anyway) — canonical is {gwIdx: {pid: delta}}, consumed in gwPlayerPoints
  for (const k of Object.keys(s.adjustments)) {
    if (s.adjustments[k] != null && typeof s.adjustments[k] !== 'object') delete s.adjustments[k];
  }
  s.waiverMeta = s.waiverMeta || { lastRun: null, control: 'auto' };
  s.autolists = {};
  s.claims = {};
  if (s.windowDraft) { s.windowDraft.order = toArr(s.windowDraft.order); s.windowDraft.picks = toArr(s.windowDraft.picks); }
  s.matchStats = ctx.matchStats;
  // a FINISHED Simulation Chamber round is real inside the sandbox: waiver
  // order, standings and transferGw must see the same pretend scores the
  // clients render (Toby, 9 Aug: the run adjudicated in reverse-DRAFT order
  // while every screen showed the mock table). The stats are derived from the
  // seed exactly as the clients derive them — engine port, parity-tested.
  if (s.mock && s.mock.gw != null && s.mock.phase === 'final' && ctx.gameweeks[s.mock.gw]) {
    const g = ctx.gameweeks[s.mock.gw];
    s.matchStats = {
      ...ctx.matchStats,
      [`gw${g.n}`]: { gw: s.mock.gw, label: g.label, date: g.from, final: true, playerStats: ctx.eng.mockGwStats(s, s.mock.gw, +s.mock.seed || 1, 1) },
    };
  }
  return s;
}
async function loadState(league, ctx, { withPrivate = false } = {}) {
  const base = leagueBase(league);
  const pub = (await db().ref(`${base}/public`).get()).val();
  if (!pub) throw new HttpsError('failed-precondition', 'league not initialised');
  const s = normalizeState(pub, ctx);
  if (withPrivate) {
    const [privSnap, memSnap] = await Promise.all([
      db().ref(`${base}/private`).get(),
      db().ref(`${base}/server/membership`).get(),
    ]);
    const priv = privSnap.val() || {};
    const mem = memSnap.val() || {};
    for (const [uid, node] of Object.entries(priv)) {
      const mid = mem[uid]?.managerId;
      if (!Number.isInteger(mid)) continue;
      if (node.autolist) s.autolists[mid] = toArr(node.autolist);
      if (node.windowClaims) (s.windowClaims = s.windowClaims || {})[mid] = toArr(node.windowClaims);
      for (const [g, arr] of Object.entries(node.claims || {})) {
        (s.claims[g] = s.claims[g] || {})[mid] = toArr(arr);
      }
    }
  }
  return s;
}
async function uidForManager(league, mid) {
  return (await db().ref(`${leagueBase(league)}/server/managerUid/${mid}`).get()).val();
}
// every user-supplied id list comes through here: integer ids only, hard cap
const intArray = (x, name, max = 100) => {
  const a = toArr(x).map(Number);
  if (a.length > max) throw new HttpsError('invalid-argument', `${name}: too many entries (max ${max})`);
  if (a.some(n => !Number.isInteger(n) || n < 0 || n > 99999999)) throw new HttpsError('invalid-argument', `${name} must be player ids`);
  return a;
};
const cleanText = (v, max) => String(v == null ? '' : v).slice(0, max);

/* RTDB transactions run their first attempt against an empty local cache
 * (cur === null) even when the node exists. Returning undefined on that pass
 * aborts for good, so every array txn seeds the null pass from the state we
 * already read — if the server disagrees, the txn re-runs with the real value. */
const seeded = (seed, fn) => cur => fn(cur === null ? toArr(seed).map(x => ({ ...x })) : toArr(cur));
// object-node variant (e.g. the whole draft node): same empty-first-pass seeding
const seededObj = (seed, fn) => cur => fn(cur === null ? JSON.parse(JSON.stringify(seed || {})) : cur);

/* ---------------- transfer helper: append records with in-txn revalidation ---------------- */
async function appendTransfers(league, state, eng, records, tgw) {
  const ref = db().ref(`${leagueBase(league)}/public/transfers`);
  const res = await ref.transaction(seeded(state.transfers, out => {
    for (const r of records) {
      const owned = eng.ownedIdsGiven(state, out, tgw);
      if (owned.has(r.inId) || !owned.has(r.outId)) return; // sniped — abort whole txn
      out.push({ ...r, n: out.length + 1 });
    }
    return out;
  }));
  if (!res.committed) throw new HttpsError('aborted', 'squad changed underneath you — try again');
  return toArr(res.snapshot.val());
}
// strip a departing player from the target GW's stored lineup, if one exists
async function stripLineup(league, state, mid, tgw, outId) {
  const lu = state.lineups[mid]?.[tgw];
  if (!lu) return;
  await db().ref(`${leagueBase(league)}/public/lineups/${mid}/${tgw}`).set(toArr(lu).filter(id => id !== outId));
}

/* ---------------- the waiver core (shared by schedule + run-now) ----------------
 * Recoverable, effectively exactly-once:
 *   1. claim the run id under a short lease (txn)
 *   2. compute the resolution and persist it as a durable PLAN on the run record
 *   3. apply the plan: transfer append is idempotent (records tagged with the
 *      run id are skipped on replay), then clear claims, strip only players
 *      whose claims REALLY landed, stamp meta and mark the run done
 * A crash at any point leaves a re-claimable record whose stored plan replays
 * without double-applying. While a fresh lease is held, callers get an ERROR
 * (never a false success), so the Scheduler's retry keeps retrying until the
 * lease expires and the work really completes. */
const WAIVER_LEASE_MS = 3 * 60 * 1000;

async function applyWaiverPlan(league, runId, plan, state, eng, ctx) {
  if (!plan.records || !plan.records.length) return { applied: 0, dropped: 0, landed: [] };
  const ref = db().ref(`${leagueBase(league)}/public/transfers`);
  const seedSnap = (await ref.get()).val();
  const keyOf = r => `${r.managerId}:${r.inId}:${r.outId}`;
  let applied = 0, dropped = 0, landedKeys = new Set();
  const res = await ref.transaction(cur => {
    const out = toArr(cur === null ? seedSnap : cur).map(x => ({ ...x }));
    applied = 0; dropped = 0; landedKeys = new Set();
    const have = new Set(out.filter(t => t && t.waiver && t.runId === runId)
      .map(keyOf));
    for (const r of plan.records) {
      const key = keyOf(r);
      if (have.has(key)) { applied++; landedKeys.add(key); continue; } // replay — already landed
      const owned = eng.ownedIdsGiven(state, out, plan.tgw);
      if (owned.has(r.inId) || !owned.has(r.outId)) { dropped++; continue; } // sniped since planning — claim lapses
      // Ownership may have changed the manager's positional flex after the
      // durable plan was written. Revalidate the resulting 14-man shape at
      // APPLY time as well as PLAN time; an invalid claim lapses harmlessly.
      const current = { ...state, transfers: out };
      const squad = eng.squadAt(current, r.managerId, plan.tgw);
      const inP = ctx.PLAYER_BY_ID[r.inId];
      const after = inP ? [...squad.filter(p => p.id !== r.outId), inP] : [];
      if (!inP || !eng.squadShapeOk(current, after)) { dropped++; continue; }
      out.push({ ...r, n: out.length + 1 });
      applied++; landedKeys.add(key);
    }
    return out;
  });
  if (!res.committed) throw new HttpsError('aborted', 'transfer ledger contended — run again');
  return { applied, dropped, landed: plan.records.filter(r => landedKeys.has(keyOf(r))) };
}

async function runWaivers(league, runId, trigger, failAt) {
  const base = leagueBase(league);
  const runRef = db().ref(`${base}/server/waiverRuns/${runId}`);
  const now0 = Date.now();
  const claim = await runRef.transaction(cur => {
    if (cur && cur.status === 'done') return; // abort: nothing to do
    if (cur && (cur.status === 'running' || cur.status === 'applying')
      && now0 - (cur.startedAt || 0) < WAIVER_LEASE_MS) return; // abort: live lease
    // (re)claim — keep any stored plan so a crashed run replays, not recomputes
    return { ...(cur || {}), status: cur?.plan ? 'applying' : 'running', trigger, startedAt: now0, attempt: ((cur && cur.attempt) || 0) + 1 };
  });
  if (!claim.committed) {
    if (claim.snapshot.val()?.status === 'done') return { skipped: 'already processed' };
    // a live lease means the work is (or may still be) happening — an error,
    // never a success, so schedulers retry instead of assuming completion
    throw new HttpsError('aborted', 'waiver run already in progress — retry shortly');
  }
  try {
    const ctx = await loadCtx();
    const eng = ctx.eng;
    const state = await loadState(league, ctx, { withPrivate: true });
    let plan = claim.snapshot.val()?.plan || null;
    if (!plan) {
      if (state.phase !== 'season') { await runRef.update({ status: 'done', result: 'skipped: not in season', finishedAt: Date.now() }); return { skipped: 'not in season' }; }
      if (trigger === 'schedule' && eng.waiverControl(state) !== 'auto') { await runRef.update({ status: 'done', result: 'skipped: control!=auto', finishedAt: Date.now() }); return { skipped: 'control' }; }
      // the Chairman skipped this named run (Committee, 12 Aug): mark it done
      // in the ledger so it can never fire late, spend the one-shot flag, and
      // leave lastRun alone — the Trough stays shut until a REAL run clears it,
      // so nobody free-signs past the queue of rolled-over claims
      if (trigger === 'schedule' && state.waiverMeta?.skip && runId === `sched-${state.waiverMeta.skip}`) {
        await db().ref(`${base}/public/waiverMeta`).set({ ...state.waiverMeta, skip: null });
        await runRef.update({ status: 'done', result: 'skipped: chairman', finishedAt: Date.now() });
        return { skipped: 'chairman' };
      }
      if (trigger === 'schedule' && !eng.waiverRunDue(state)) { await runRef.update({ status: 'done', result: 'skipped: not due', finishedAt: Date.now() }); return { skipped: 'not due' }; }
      // Do not veto a run merely because the feed's generated timestamp is
      // old. GitHub's cron is best-effort and on 28 Aug that blanket 90-minute
      // check held a perfectly safe pre-deadline run for two hours. What can
      // corrupt priority is narrower: a round that should have settled but
      // has not. Judge that from fixtures + canonical stats below. A stale
      // feed in which every played round is final is safe; a fresh feed with
      // a regressed/empty played round is not.
      // A round that by the clock should long since have settled but is not
      // final means the feed has regressed under us — priority computed now
      // would miss that round, or fall all the way back to reverse draft,
      // and an allocation is irreversible (sol, settlement round, P1).
      // DEFER, don't throw: sol's round 2 showed the failed+finishedAt
      // tombstone from a throw never re-executes. 'deferred' is not 'done'
      // and holds no lease, so the claim transaction at the top of this
      // function re-claims it on every hourly tick until the feed heals,
      // FPL's own flag lands, or the next-deadline backstop settles the
      // round — and only a REAL run ever stamps lastWaiverRun, so the slot
      // stays due throughout. A manual run-now is the Chairman's eyes-open
      // override and passes.
      if (trigger === 'schedule') {
        const unsettled = eng.unsettledPlayedRound(state);
        if (unsettled != null) {
          await runRef.update({ status: 'deferred', reason: `GW${unsettled + 1} played but not settled (feed regression?)`, deferredAt: Date.now() });
          return { deferred: `gw${unsettled + 1}` };
        }
      }
      const runStart = Date.now() - 1;
      const res = eng.resolveWaivers(state, runStart);
      plan = {
        records: res.records.map(r => ({ ...r, runId })), executed: res.executed,
        buckets: res.buckets, stampedMeta: res.stampedMeta,
        strippedLineups: res.strippedLineups, tgw: res.tgw,
        consumed: state.claims || {}, // exactly what this run adjudicated — a claim lodged AFTER planning must survive the apply
      };
      await runRef.update({ status: 'applying', plan });
    }
    failpoint(failAt, 'waivers:afterPlan');
    const { applied, dropped, landed } = await applyWaiverPlan(league, runId, plan, state, eng, ctx);
    failpoint(failAt, 'waivers:afterTransfers');
    const executed = landed.map(r => ({ mid: r.managerId, in: r.inId, out: r.outId }));
    // A plan can go stale while a crashed run waits to replay. Strip lineups
    // only for claims that actually landed, and remove from the CURRENT lineup
    // transactionally so a later team-sheet edit is never overwritten by the
    // plan's stale snapshot.
    const landedOuts = {};
    for (const r of landed) (landedOuts[r.managerId] = landedOuts[r.managerId] || []).push(r.outId);
    for (const [mid, outs] of Object.entries(landedOuts)) {
      const luRef = db().ref(`${base}/public/lineups/${mid}/${plan.tgw}`);
      await luRef.transaction(cur => {
        if (cur == null) return;
        return toArr(cur).filter(id => !outs.includes(id));
      });
    }
    // clear ONLY the claims the plan adjudicated (executed or lapsed). A claim
    // lodged between planning and apply (crash window) stays for the next run.
    // Mapping comes from MEMBERSHIP — the same source loadState planned from —
    // so a membership/managerUid divergence can't leave claims stranded.
    // Removal is count-based: an identical {in,out} re-lodged after planning
    // is one MORE entry than the plan consumed, and the extra one survives.
    const mem = (await db().ref(`${base}/server/membership`).get()).val() || {};
    for (const g of (plan.buckets || [])) {
      for (const [uid, m] of Object.entries(mem)) {
        const wmid = m?.managerId;
        if (!Number.isInteger(wmid)) continue;
        const eaten = toArr(plan.consumed?.[g]?.[wmid]);
        if (!eaten.length) continue;
        await db().ref(`${base}/private/${uid}/claims/${g}`).transaction(cur => {
          // key includes the lodging stamp t: a re-saved identical pair carries
          // a new t and survives; pre-stamp entries (no t) match by pair alone
          const keyOf = c => `${c.in}:${c.out}:${c.t || ''}`;
          const budget = {};
          eaten.forEach(c => { const k = keyOf(c); budget[k] = (budget[k] || 0) + 1; });
          const left = toArr(cur).filter(c => {
            if (!c) return false;
            const k = keyOf(c);
            if (budget[k] > 0) { budget[k]--; return false; }
            return true;
          });
          return left.length ? left : null;
        });
      }
    }
    const upd = {};
    upd[`${base}/public/waiverMeta`] = plan.stampedMeta;
    // legacy plans (written before `consumed` existed) replay with the old wholesale clear
    if (plan.consumed === undefined) for (const uid of Object.keys(mem)) for (const g of (plan.buckets || [])) upd[`${base}/private/${uid}/claims/${g}`] = null;
    upd[`${base}/server/waiverRuns/${runId}/status`] = 'done';
    upd[`${base}/server/waiverRuns/${runId}/finishedAt`] = Date.now();
    upd[`${base}/server/waiverRuns/${runId}/executed`] = executed;
    upd[`${base}/server/waiverRuns/${runId}/applied`] = applied;
    upd[`${base}/server/waiverRuns/${runId}/dropped`] = dropped;
    await db().ref().update(upd);
    return { executed };
  } catch (e) {
    // release the lease; the plan (if written) survives for an exact replay
    await runRef.update({ status: 'failed', error: String(e.message || e), finishedAt: Date.now() }).catch(() => {});
    throw e;
  }
}

/* ---------------- action registry ---------------- */
const ACTIONS = {};

// Seal a full draft board: ONE txn on the public node that re-verifies the
// board is STILL full at commit time — a concurrent undo popping the final
// pick makes the CAS fail and the seal abort. Never write phase='season' for
// a full board any other way (sol r5 P0: heal raced undo into a 41-pick season).
async function sealFullBoard(league) {
  const ref = db().ref(`${leagueBase(league)}/public`);
  const seedSnap = (await ref.get()).val(); // raw server shape for the empty-cache first pass
  const res = await ref.transaction(cur => {
    const c = cur === null ? (seedSnap && JSON.parse(JSON.stringify(seedSnap))) : cur;
    if (!c) return; // nothing to seal
    const picks = toArr(c.draft && c.draft.picks);
    const total = toArr(c.managers).length * Engine.SQUAD_RULES.size;
    if (c.phase !== 'draft' || !total || picks.length < total) return; // board moved — abort
    c.phase = 'season';
    if (c.draft) c.draft.deadline = null;
    return c;
  }).catch(() => ({ committed: false }));
  return !!res.committed;
}

// Pick one is a room start, not merely manager one's start.  A manager is
// counted once (by authenticated manager id) when their ceremony ends or they
// explicitly skip it.  Every route capable of moving the first pick consults
// this same predicate; the client-side waiting card is only an explanation.
function draftCeremonyStatus(state) {
  const order = toArr(state?.draft?.order).map(Number);
  // RTDB materialises dense numeric-key maps as arrays. Treat both shapes as
  // the same manager-id ledger or each acknowledgement would erase the last.
  const rawReady = state?.draft?.ceremonyReady;
  const ready = rawReady && typeof rawReady === 'object' ? rawReady : {};
  const count = order.filter(mid => ready[mid] === true).length;
  return { count, total: order.length, complete: order.length > 0 && count === order.length };
}

// The drinks break, SERVER-owned (sol test-draft round, P0: the client-side
// freeze left the server door open — an {expired:true} autopick advanced the
// board mid-break, and breakDone/timewaste raced each other's blind updates).
// Due when the board sits exactly on a third and that round is unconsumed.
// Mirrors app.js drinksBreakAt; pass the txn's draft node for the committed
// truth, or omit it for a pre-txn courtesy check against the loaded state.
function breakDue(state, eng, draft) {
  const dr = draft || state.draft;
  const n = toArr(dr.picks).length;
  if (!n) return null;
  const t = eng.totalPicks(state);
  const due = n === Math.round(t / 3) || n === Math.round(2 * t / 3);
  return due && !toArr(dr.breaksDone).includes(n) ? n : null;
}

/* ----- draft ----- */
ACTIONS.draftPick = async ({ league, a, data, ctx, state, eng }) => {
  const base = leagueBase(league);
  if (state.phase !== 'draft') throw new HttpsError('failed-precondition', 'not drafting');
  if (state.draft.paused) throw new HttpsError('failed-precondition', 'draft is paused');
  if (!state.draft.picks.length && !draftCeremonyStatus(state).complete) {
    throw new HttpsError('failed-precondition', 'waiting for every manager to finish the opening ceremony');
  }
  const onClock = eng.currentManagerId(state);
  if (onClock == null) {
    // board full but phase never flipped (the final pick's follow-up died) — heal
    await sealFullBoard(league);
    throw new HttpsError('failed-precondition', 'draft is complete');
  }
  if (a.managerId !== onClock && !isCommish(a)) throw new HttpsError('permission-denied', 'not your pick');
  if (breakDue(state, eng)) throw new HttpsError('failed-precondition', 'the room is on a drinks break — picks resume when the Chairman restarts the clock');
  const player = ctx.PLAYER_BY_ID[data.playerId];
  if (!player) throw new HttpsError('invalid-argument', 'unknown player');
  if (!eng.canPick(state, onClock, player)) throw new HttpsError('failed-precondition', 'illegal pick (position limits or locked arrival)');
  const expected = Number.isInteger(data.expectedCount) ? data.expectedCount : state.draft.picks.length;
  let denyReason = null;
  // ONE txn on the whole draft node: pick + next deadline land atomically, and
  // any concurrent undo (same node) is serialised by the database — the
  // pick-vs-undo race cannot interleave at this level
  const res = await db().ref(`${base}/public/draft`).transaction(seededObj(state.draft, dr => {
    denyReason = null;
    const arr = toArr(dr.picks).map(x => ({ ...x }));
    if (arr.length !== expected) return;
    // Re-check the committed draft node inside the pick transaction. The last
    // ceremony acknowledgement and a keen first click may arrive together.
    if (!arr.length && !draftCeremonyStatus({ draft: dr }).complete) return;
    // the break check must hold against the COMMITTED node — the pre-txn one
    // above only gives a polite message (sol P0: mid-break autopick landed)
    if (breakDue(state, eng, dr)) { denyReason = 'the room is on a drinks break — picks resume when the Chairman restarts the clock'; return; }
    // a declared expiry re-verifies the deadline it is executing: a timewaste
    // serialised just before this txn revives the clock, and the pick must die
    if (data.expired === true && dr.deadline && Date.now() <= dr.deadline) { denyReason = 'the clock was extended — play on'; return; }
    if (arr.some(p => p.playerId === player.id)) return;
    // t: when the pick landed — the Gazette's "slowest hand in the room"
    // desk needs it, and draft night 26/27 taught us it can't be backfilled
    arr.push({ managerId: onClock, playerId: player.id, code: player.code ?? null, n: arr.length + 1, t: Date.now() });
    dr.picks = arr;
    if (state.settings.pickTimer) dr.deadline = arr.length < eng.totalPicks(state) ? Date.now() + state.settings.pickTimer * 1000 : null;
    return dr;
  }));
  if (!res.committed) throw new HttpsError(denyReason ? 'failed-precondition' : 'aborted', denyReason || 'the board moved on');
  const total = toArr(res.snapshot.val()?.picks).length;
  // phase lives outside the draft node; the seal txn re-verifies fullness so a
  // concurrent undo can't be overwritten. If the process dies here, the next
  // pick attempt or the clock loop heals it (same seal).
  if (total >= eng.totalPicks(state)) {
    let sealed = false;
    for (let i = 0; i < 3 && !sealed; i++) sealed = await sealFullBoard(league);
  }
  return { picked: player.id, total };
};

ACTIONS.draftAutopick = async ({ league, a, data, ctx, state, eng }) => {
  if (state.phase !== 'draft') throw new HttpsError('failed-precondition', 'not drafting');
  if (state.draft.paused) throw new HttpsError('failed-precondition', 'draft is paused');
  if (!state.draft.picks.length && !draftCeremonyStatus(state).complete) {
    throw new HttpsError('failed-precondition', 'waiting for every manager to finish the opening ceremony');
  }
  const onClock = eng.currentManagerId(state);
  if (onClock == null) {
    await sealFullBoard(league); // heal a died final follow-up (txn-verified)
    throw new HttpsError('failed-precondition', 'draft is complete');
  }
  // anyone signed in may trigger it once the clock has expired (so a sleeping
  // commissioner phone can never stall draft night); the choice is deterministic
  const overdue = state.draft.deadline && Date.now() > state.draft.deadline + 2000;
  // a clock-expiry fire declares itself ({expired:true}) and is judged by THE
  // SERVER'S clock alone — a device with a wrong watch or stale state can ask,
  // but it can never make a pick happen early (test draft, 18 Aug: the room
  // watched managers get "skipped" the moment they came on the clock). The
  // undeclared path stays: the on-clock manager's own Autopick button, or a
  // commissioner deliberately pushing a stalled draft.
  if (data.expired && !overdue) throw new HttpsError('failed-precondition', 'clock has not expired (server time)');
  if (!overdue && a.managerId !== onClock && !isCommish(a)) throw new HttpsError('failed-precondition', 'clock has not expired');
  // sol P0: a due break refuses the autopick outright — the frozen deadline
  // WILL be overdue mid-break, and that must not advance the board. The pick
  // txn re-verifies against the committed node; this gives the clean message.
  if (breakDue(state, eng)) throw new HttpsError('failed-precondition', 'the room is on a drinks break — the clock is frozen');
  const stateWithLists = await loadState(league, ctx, { withPrivate: true });
  const choice = eng.autoPickChoice(stateWithLists, onClock);
  if (choice == null) throw new HttpsError('failed-precondition', 'no legal pick available');
  return ACTIONS.draftPick({ league, a: { ...a, managerId: onClock }, data: { playerId: choice, expectedCount: state.draft.picks.length, expired: data.expired === true }, ctx, state, eng });
};

ACTIONS.draftAdmin = async ({ league, a, data, state, eng, ctx }) => {
  const base = leagueBase(league);
  const d = `${base}/public/draft`;
  const op = data.op;
  if (op === 'ceremonyReady') {
    if (state.phase !== 'draft') throw new HttpsError('failed-precondition', 'not drafting');
    if (!state.draft.order.includes(a.managerId)) throw new HttpsError('permission-denied', 'not in this draft');
    const res = await db().ref(d).transaction(seededObj(state.draft, dr => {
      if (toArr(dr.picks).length) return dr; // harmless late/retried acknowledgement
      const order = toArr(dr.order).map(Number);
      if (!order.includes(a.managerId)) return;
      dr.ceremonyReady = { ...(dr.ceremonyReady && typeof dr.ceremonyReady === 'object' ? dr.ceremonyReady : {}), [a.managerId]: true };
      const status = draftCeremonyStatus({ draft: dr });
      // The final acknowledgement starts the first clock in this SAME txn.
      // There is no gap in which a client can see 12/12 with an unarmed room.
      if (status.complete && state.settings.pickTimer && !dr.deadline && !dr.paused) {
        dr.deadline = Date.now() + state.settings.pickTimer * 1000;
      }
      return dr;
    }));
    if (!res.committed) throw new HttpsError('aborted', 'the draft room moved on');
    const draft = res.snapshot.val() || {};
    const status = draftCeremonyStatus({ draft });
    return { ok: true, ...status, armed: !!draft.deadline };
  }
  if (op === 'clockStart') {
    // arms the first deadline once the opening ceremony is over — the start op
    // deliberately leaves it null so the pomp can't eat manager one's clock.
    // Any signed-in manager may arm it (idempotent; a sleeping Chairman
    // mustn't stall the room).
    if (state.phase !== 'draft') throw new HttpsError('failed-precondition', 'not drafting');
    if (eng.currentManagerId(state) == null) {
      // full board still marked draft (a died final follow-up) — seal, don't arm.
      // The seal is a txn that re-verifies fullness, so it can't race an undo.
      const healed = await sealFullBoard(league);
      return { ok: true, armed: false, healed };
    }
    const status = draftCeremonyStatus(state);
    if (!state.draft.picks.length && !status.complete) {
      // Backward compatibility for a phone holding the previous cached app:
      // that client calls clockStart only after ITS local ceremony ends. Count
      // that authenticated manager as through, but still require every id in
      // the order before arming. One stale phone cannot bypass or wedge the room.
      const compat = await ACTIONS.draftAdmin({ league, a, data: { op: 'ceremonyReady' }, state, eng });
      return { ...compat, waiting: { count: compat.count, total: compat.total, complete: compat.complete }, legacyAck: true };
    }
    if (!state.settings.pickTimer || state.draft.deadline || state.draft.paused) return { ok: true, armed: false };
    const res = await db().ref(d).transaction(seededObj(state.draft, dr => {
      if (dr.deadline || dr.paused) return dr;
      if (!toArr(dr.picks).length && !draftCeremonyStatus({ draft: dr }).complete) return dr;
      dr.deadline = Date.now() + state.settings.pickTimer * 1000;
      return dr;
    }));
    const deadline = res.snapshot.val()?.deadline || null;
    return { ok: true, armed: !!deadline };
  }
  if (op === 'timewaste') {
    if (state.phase !== 'draft') throw new HttpsError('failed-precondition', 'not drafting');
    if (!state.draft.picks.length && !draftCeremonyStatus(state).complete) throw new HttpsError('failed-precondition', 'the draft room is not open');
    const onClock = eng.currentManagerId(state);
    if (a.managerId !== onClock && !isCommish(a)) throw new HttpsError('permission-denied', 'not your clock to waste');
    // one timewaste of +30s (Ben, 14 Aug — was two of +60s). A same-node txn,
    // not a blind update (sol P0: timewaste raced breakDone and stamped the
    // fresh clock with a stale, already-expired deadline; a mid-break waste
    // also shifted the shared break anchor by thirty seconds).
    let twDeny = null;
    const twRes = await db().ref(d).transaction(seededObj(state.draft, dr => {
      twDeny = null;
      if (breakDue(state, eng, dr)) { twDeny = 'the room is on a drinks break — the clock is frozen'; return; }
      if (toArr(dr.picks).length !== state.draft.picks.length) { twDeny = 'the board moved on — that clock is gone'; return; }
      const used = dr.timewastes && typeof dr.timewastes === 'object' ? (dr.timewastes[onClock] || 0) : 0;
      if (used >= 1) { twDeny = 'timewaste already burned'; return; }
      dr.timewastes = { ...(dr.timewastes && typeof dr.timewastes === 'object' ? dr.timewastes : {}), [onClock]: used + 1 };
      dr.deadline = (dr.deadline || Date.now()) + 30 * 1000;
      return dr;
    }));
    if (!twRes.committed) throw new HttpsError('failed-precondition', twDeny || 'the board moved on');
    return { ok: true };
  }
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  if (op === 'roomOpen') {
    // Chairman force-start: a test night (or a no-show on the real night)
    // can't wait forever for managers who are never going to arrive. Marks
    // every manager in the order through the ceremony and arms the first
    // clock in the SAME txn — absentees simply autopick when their clock
    // dies. Idempotent; harmless once picks exist (the room is already open).
    if (state.phase !== 'draft') throw new HttpsError('failed-precondition', 'not drafting');
    const res = await db().ref(d).transaction(seededObj(state.draft, dr => {
      const order = toArr(dr.order).map(Number);
      if (!order.length) return dr;
      const ready = dr.ceremonyReady && typeof dr.ceremonyReady === 'object' ? { ...dr.ceremonyReady } : {};
      for (const mid of order) ready[mid] = true;
      dr.ceremonyReady = ready;
      if (state.settings.pickTimer && !dr.deadline && !dr.paused && !toArr(dr.picks).length) {
        dr.deadline = Date.now() + state.settings.pickTimer * 1000;
      }
      return dr;
    }));
    if (!res.committed) throw new HttpsError('aborted', 'the draft room moved on');
    const draft = res.snapshot.val() || {};
    return { ok: true, ...draftCeremonyStatus({ draft }), armed: !!draft.deadline };
  }
  if (op === 'autoComplete') {
    // sandbox-only: autodraft every remaining pick in one stroke (Test Night —
    // a solo Chairman needs a full board in ten seconds, not 168 taps).
    // Exactly what the expiring clock would do, repeated: each manager's
    // queue first, then best available. HARD-refused outside the sandbox —
    // the real draft is the whole point of the real league.
    if (league !== 'the-league-sandbox') throw new HttpsError('failed-precondition', 'the full autodraft only exists in the sandbox');
    if (state.phase !== 'draft') throw new HttpsError('failed-precondition', 'not drafting');
    const stateWithLists = await loadState(league, ctx, { withPrivate: true });
    const sim = JSON.parse(JSON.stringify(stateWithLists));
    const startCount = toArr(state.draft.picks).length;
    const added = [];
    let onClock;
    while ((onClock = eng.currentManagerId(sim)) != null) {
      const choice = eng.autoPickChoice(sim, onClock);
      if (choice == null) throw new HttpsError('failed-precondition', 'no legal pick available mid-autodraft');
      const rec = { managerId: onClock, playerId: choice, code: ctx.PLAYER_BY_ID[choice]?.code ?? null, n: toArr(sim.draft.picks).length + 1, t: Date.now() };
      sim.draft.picks = [...toArr(sim.draft.picks), rec];
      added.push(rec);
    }
    const ref = db().ref(`${base}/public`);
    const seedSnap = (await ref.get()).val(); // raw server shape for the empty-cache first pass
    const res = await ref.transaction(cur => {
      const c = cur === null ? (seedSnap && JSON.parse(JSON.stringify(seedSnap))) : cur;
      if (!c) return;
      const picks = toArr(c.draft && c.draft.picks);
      // CAS on the pick count: a pick or undo landing mid-computation aborts
      // the skip rather than double-drafting anyone — press it again
      if (c.phase !== 'draft' || picks.length !== startCount) return;
      c.draft = { ...(c.draft || {}), picks: [...picks, ...added], deadline: null, paused: false };
      c.phase = 'season';
      return c;
    }).catch(() => ({ committed: false }));
    if (!res.committed) throw new HttpsError('aborted', 'the board moved mid-autodraft — press it again');
    return { ok: true, added: added.length, total: startCount + added.length };
  }
  if (op === 'start') {
    if (state.phase !== 'setup') throw new HttpsError('failed-precondition', 'already started');
    const order = intArray(data.order, 'order', 20);
    /* Optional setup payload: the Chairman's screen edits (names, team names,
     * squad rules) ride along and merge HERE, inside the same txn that flips
     * the phase. The old flow — client importState of the whole setup state,
     * then start — replaced the entire public node and lost any club a founder
     * saved concurrently (sol club-office P1.1). Club identity fields (kit,
     * sponsor, rival, gaffer, boards, stadium) are never accepted from this
     * payload: the committed server state owns them. */
    let setupMgrs = null, setupSettings = null;
    if (data.setup !== undefined) {
      if (!isPlainObj(data.setup)) throw new HttpsError('invalid-argument', 'bad setup payload');
      for (const k of Object.keys(data.setup)) if (!['managers', 'settings'].includes(k)) throw new HttpsError('invalid-argument', `setup key "${k}"`);
      if (data.setup.managers != null) {
        setupMgrs = new Map();
        for (const m of toArr(data.setup.managers)) {
          if (!isPlainObj(m) || !Number.isInteger(m.id)) throw new HttpsError('invalid-argument', 'setup manager entry');
          for (const k of Object.keys(m)) if (!['id', 'name', 'team'].includes(k)) throw new HttpsError('invalid-argument', `setup manager key "${k}"`);
          setupMgrs.set(m.id, { name: cleanText(m.name || '', 60).trim(), team: cleanText(m.team || '', 80).trim() });
        }
      }
      if (data.setup.settings != null) setupSettings = cleanSettingsPatch(data.setup.settings);
    }
    const ctx2 = await loadCtx();
    const poolIds = Object.fromEntries(ctx2.PLAYERS.map(p => [p.id, p.club]));
    const pubRef = db().ref(`${base}/public`);
    const pubSeed = (await pubRef.get()).val();
    let deny = null;
    const res = await pubRef.transaction(cur => {
      const c = cur === null ? (pubSeed && JSON.parse(JSON.stringify(pubSeed))) : cur;
      if (!c) return;
      deny = null; // a retry must re-judge against the fresh value
      if (c.phase !== 'setup') { deny = { code: 'failed-precondition', msg: 'already started' }; return; }
      const mgrs = toArr(c.managers);
      // permutation check against COMMITTED managers, not the request's snapshot
      const ids = mgrs.map(m => m.id).sort((x, y) => x - y);
      if (JSON.stringify([...order].sort((x, y) => x - y)) !== JSON.stringify(ids)) { deny = { code: 'invalid-argument', msg: 'order must be a permutation of the twelve' }; return; }
      if (setupMgrs) for (const m of mgrs) {
        const s = setupMgrs.get(m.id);
        if (s) { if (s.name) m.name = s.name; if (s.team) m.team = s.team; }
      }
      c.managers = mgrs;
      // the settings payload is a PATCH onto committed settings — only the
      // keys actually supplied change; omitted rules keep their committed
      // values, never a default (sol r2 P2). Legality is judged on the merge.
      if (setupSettings) {
        const cur = c.settings || {};
        const merged = { ...DEFAULT_SETTINGS(), ...cur, ...setupSettings };
        merged.scoring = { ...Engine.DEFAULT_SCORING, ...(cur.scoring || {}), ...(setupSettings.scoring || {}) };
        Object.assign(merged, fixedSquadSettings());
        c.settings = merged;
      } else {
        c.settings = { ...DEFAULT_SETTINGS(), ...(c.settings || {}), ...fixedSquadSettings(), scoring: { ...Engine.DEFAULT_SCORING, ...(c.settings?.scoring || {}) } };
      }
      c.phase = 'draft';
      c.draft = { ...(c.draft || {}), order, picks: null, deadline: null, ceremonyReady: null }; // the final manager through the ceremony arms pick one
      c.draftPool = { at: Date.now(), ids: poolIds };
      c.ready = null; // the roll call served its purpose; it must not haunt the next reset
      return c;
    });
    if (!res.committed) {
      const dn = deny || { code: 'aborted', msg: 'try again' };
      throw new HttpsError(dn.code, dn.msg);
    }
    return { ok: true };
  }
  if (op === 'pause') {
    if (!state.draft.picks.length && !draftCeremonyStatus(state).complete) throw new HttpsError('failed-precondition', 'the draft room is not open');
    await db().ref().update({ [`${d}/paused`]: true, [`${d}/pausedLeft`]: Math.max(0, (state.draft.deadline || 0) - Date.now()) }); return { ok: true };
  }
  if (op === 'resume') {
    if (!state.draft.picks.length && !draftCeremonyStatus(state).complete) throw new HttpsError('failed-precondition', 'the draft room is not open');
    await db().ref().update({ [`${d}/paused`]: false, [`${d}/deadline`]: Date.now() + (state.draft.pausedLeft || (state.settings.pickTimer || 30) * 1000) }); return { ok: true };
  }
  if (op === 'breakDone') {
    if (!state.draft.picks.length && !draftCeremonyStatus(state).complete) throw new HttpsError('failed-precondition', 'the draft room is not open');
    // Ending the break CONSUMES it and arms a fresh server-time clock in ONE
    // txn (sol P0: the old blind update raced expiries — 11/12 runs advanced
    // the board during the break or armed nothing). The round is derived from
    // the committed node, never trusted from the request; a second press
    // finds no break due and is a harmless no-op, not a second fresh clock.
    let already = false;
    const bdRes = await db().ref(d).transaction(seededObj(state.draft, dr => {
      already = false;
      const due = breakDue(state, eng, dr);
      if (!due) { already = true; return dr; }
      dr.breaksDone = [...toArr(dr.breaksDone), due];
      if (state.settings.pickTimer) dr.deadline = Date.now() + state.settings.pickTimer * 1000;
      return dr;
    }));
    if (!bdRes.committed) throw new HttpsError('aborted', 'the draft room moved on — try again');
    return { ok: true, already };
  }
  if (op === 'undo') {
    // draft-night tool only: during the draft, or immediately after the final
    // pick flipped phase to season (still pre-GW1). Never mid-season — popping
    // a pick then would corrupt every squad computation.
    if (state.phase !== 'draft' && !(state.phase === 'season' && !eng.gwHasStarted(0))) {
      throw new HttpsError('failed-precondition', 'undo is a draft-night tool');
    }
    if (!state.draft.picks.length) throw new HttpsError('failed-precondition', 'nothing to undo');
    // same-node txn as draftPick: pop + deadline are atomic and serialised
    // against concurrent picks. expectedCount pins the undo to the board the
    // Chairman was LOOKING at — a pick landing first aborts it cleanly.
    // MANDATORY: a blind undo (old client, replayed request) racing the final
    // pick is exactly how a league loses picks it can never re-make.
    const expected = data.expectedCount;
    if (!Number.isInteger(expected) || expected < 0) throw new HttpsError('invalid-argument', 'undo requires expectedCount — refresh the page and try again');
    // ONE txn on the public node: pop, deadline AND the phase repair commit
    // together against COMMITTED state — never the request's stale phase. A
    // concurrent seal (also a public-node txn) is fully serialised with this,
    // so "season with a short board" cannot be produced from any interleaving
    // (sol r6 P0: the old two-step skipped the repair when its cached phase
    // said draft while a seal had just flipped it).
    const pubRef = db().ref(`${base}/public`);
    const pubSeed = (await pubRef.get()).val();
    const res = await pubRef.transaction(cur => {
      const c = cur === null ? (pubSeed && JSON.parse(JSON.stringify(pubSeed))) : cur;
      if (!c || !c.draft) return;
      const arr = toArr(c.draft.picks).map(x => ({ ...x }));
      if (arr.length !== expected || !arr.length) return;
      arr.pop();
      c.draft.picks = arr;
      c.draft.deadline = Date.now() + ((c.settings && c.settings.pickTimer) || 30) * 1000;
      const total = toArr(c.managers).length * Engine.SQUAD_RULES.size;
      if (c.phase === 'season' && arr.length < total) c.phase = 'draft'; // the final pick flipped it; undo reopens atomically
      return c;
    });
    if (!res.committed) throw new HttpsError('aborted', 'undo clashed — the board moved on');
    return { total: toArr(res.snapshot.val()?.draft?.picks).length };
  }
  throw new HttpsError('invalid-argument', 'unknown draft op');
};

/* ----- lineups / bench / lists ----- */
ACTIONS.lineupSave = async ({ league, a, data, ctx, state, eng }) => {
  const mid = actingManager(a, data);
  const gw = Number(data.gw);
  if (!Number.isInteger(gw) || gw < 0 || gw >= ctx.gameweeks.length) throw new HttpsError('invalid-argument', 'bad gameweek');
  if (eng.gwHasStarted(gw)) throw new HttpsError('failed-precondition', 'that gameweek has kicked off');
  const xi = intArray(data.xi, 'xi', 11);
  const squadIds = new Set(eng.squadAt(state, mid, gw).map(p => p.id));
  if (!xi.every(id => squadIds.has(id))) throw new HttpsError('invalid-argument', 'XI contains players not in the squad');
  if (!eng.xiValid(xi)) throw new HttpsError('invalid-argument', 'XI shape is illegal');
  await db().ref().update({
    [`${leagueBase(league)}/public/lineups/${mid}/${gw}`]: xi,
    [`${leagueBase(league)}/public/lineups/${mid}/${gw}-t`]: Date.now(), // server clock: no wound-back phones
  });
  return { ok: true };
};

ACTIONS.benchOrder = async ({ league, a, data, state, eng, ctx }) => {
  const mid = actingManager(a, data);
  const gw = Number(data.gw);
  if (!Number.isInteger(gw) || gw < 0 || gw >= ctx.gameweeks.length) throw new HttpsError('invalid-argument', 'bad gameweek');
  // bench order shapes auto-subs, so it locks with the lineup — exactly like lineupSave
  if (eng.gwHasStarted(gw)) throw new HttpsError('failed-precondition', 'that gameweek has kicked off');
  const pids = intArray(data.pids, 'pids', 30);
  if (new Set(pids).size !== pids.length) throw new HttpsError('invalid-argument', 'bench order repeats a player');
  const squadIds = new Set(eng.squadAt(state, mid, gw).map(p => p.id));
  if (!pids.every(id => squadIds.has(id))) throw new HttpsError('invalid-argument', 'bench order names players not in the squad');
  await db().ref(`${leagueBase(league)}/public/benchOrders/${mid}/${gw}`).set(pids);
  return { ok: true };
};

ACTIONS.autolistSet = async ({ league, a, data, ctx }) => {
  const pids = intArray(data.pids, 'pids', 300);
  if (new Set(pids).size !== pids.length) throw new HttpsError('invalid-argument', 'autolist repeats a player');
  if (pids.some(id => !ctx.PLAYER_BY_ID[id])) throw new HttpsError('invalid-argument', 'autolist names an unknown player');
  await db().ref(`${leagueBase(league)}/private/${a.uid}/autolist`).set(pids);
  return { ok: true };
};

// The Trough watchlist (Marc, 20 Aug). Private per manager, like the autolist
// — it lives under private/{uid} so no other manager's snapshot can ever carry
// it. Deliberately inert: watching a player is a lens on the Trough and grants
// nothing, so this writes a list and validates it, and nothing else reads it.
ACTIONS.watchlistSet = async ({ league, a, data, ctx }) => {
  const pids = intArray(data.pids, 'pids', 300);
  if (new Set(pids).size !== pids.length) throw new HttpsError('invalid-argument', 'watchlist repeats a player');
  if (pids.some(id => !ctx.PLAYER_BY_ID[id])) throw new HttpsError('invalid-argument', 'watchlist names an unknown player');
  await db().ref(`${leagueBase(league)}/private/${a.uid}/watchlist`).set(pids);
  return { ok: true };
};

ACTIONS.claimSet = async ({ league, a, data, eng, ctx, state }) => {
  const g = Number(data.gwIndex);
  const cur = eng.currentGwIndex();
  if (!Number.isInteger(g) || Math.abs(g - cur) > 1) throw new HttpsError('invalid-argument', 'claims go in the current gameweek bucket');
  const raw = toArr(data.claims);
  if (raw.length > 30) throw new HttpsError('invalid-argument', 'too many claims (max 30)');
  // t identifies each LODGING, not just the pair — waiver cleanup matches on
  // it, so re-saving an identical {in,out} after a run planned is a NEW claim
  // that survives the replay (sol r5)
  const claims = raw.map(c => ({
    in: Number(c && c.in), out: Number(c && c.out),
    inCode: ctx.PLAYER_BY_ID[Number(c && c.in)]?.code ?? null, outCode: ctx.PLAYER_BY_ID[Number(c && c.out)]?.code ?? null,
    t: Date.now() + Math.random(), // fractional part: same-millisecond lodgings still get distinct identities
  }));
  if (claims.some(c => !Number.isInteger(c.in) || !Number.isInteger(c.out))) throw new HttpsError('invalid-argument', 'bad claim');
  const tgw = eng.transferGw(state);
  // the commissioner may lodge claims FOR a manager (asManager) — validation
  // and storage both follow the target, so the claim adjudicates as theirs.
  // SANDBOX ONLY (sol test-night P1): the client can't see the target's
  // private ladder, so this write REPLACES claims the Chairman never saw —
  // fine against test-night stand-ins, unacceptable against real managers.
  const mid = actingManager(a, data);
  if (mid !== a.managerId && league !== 'the-league-sandbox') {
    throw new HttpsError('failed-precondition', 'acting-as claims only exist in the sandbox');
  }
  const squad = eng.squadAt(state, mid, tgw);
  const squadIds = new Set(squad.map(p => p.id));
  for (const c of claims) {
    const inP = ctx.PLAYER_BY_ID[c.in];
    if (!inP) throw new HttpsError('invalid-argument', 'claim names an unknown player');
    if (squadIds.has(c.in)) throw new HttpsError('failed-precondition', 'you already own that player');
    if (!squadIds.has(c.out)) throw new HttpsError('failed-precondition', 'the drop player is not in your squad');
    if (!eng.squadShapeOk(state, [...squad.filter(p => p.id !== c.out), inP])) throw new HttpsError('failed-precondition', 'claim would leave an illegal squad shape');
  }
  let uid = a.uid;
  if (mid !== a.managerId) {
    uid = await uidForManager(league, mid);
    if (!uid) throw new HttpsError('failed-precondition', 'that manager has no account to hold claims');
  }
  await db().ref(`${leagueBase(league)}/private/${uid}/claims/${g}`).set(claims);
  return { ok: true };
};

/* ----- signings and trades ----- */
ACTIONS.troughSign = async ({ league, a, data, ctx, state, eng }) => {
  const mid = actingManager(a, data);
  if (state.phase !== 'season') throw new HttpsError('failed-precondition', 'season not underway');
  const inP = ctx.PLAYER_BY_ID[data.inId], outP = ctx.PLAYER_BY_ID[data.outId];
  if (!inP || !outP) throw new HttpsError('invalid-argument', 'unknown player');
  if (eng.arrivalLocked(state, inP)) throw new HttpsError('failed-precondition', 'locked until the Window Draft');
  if (eng.onWaiversCheck ? eng.onWaiversCheck(state, inP) : onWaiversServer(state, inP, eng)) throw new HttpsError('failed-precondition', 'player is on waivers — lodge a claim instead');
  const tgw = eng.transferGw(state);
  if (eng.ownedIdsAt(state, tgw).has(inP.id)) throw new HttpsError('failed-precondition', 'already owned');
  const squad = eng.squadAt(state, mid, tgw);
  if (!squad.some(p => p.id === outP.id)) throw new HttpsError('failed-precondition', 'that player is not yours to drop');
  if (!eng.squadShapeOk(state, [...squad.filter(p => p.id !== outP.id), inP])) throw new HttpsError('failed-precondition', 'squad shape would be illegal');
  await appendTransfers(league, state, eng, [{ managerId: mid, outId: outP.id, outCode: outP.code ?? null, inId: inP.id, inCode: inP.code ?? null, gw: tgw, t: Date.now() }], tgw);
  await stripLineup(league, state, mid, tgw, outP.id);
  return { ok: true, tgw };
};
// mirror of app.js onWaivers() — Committee fixture-window model. The chamber's
// mock clock outranks EVERY manual control: a stale "open" override must not
// let signings through mid-simulation (sol mock-night P1).
function onWaiversServer(state, p, eng) {
  const tw = eng.troughWindow(state);
  if (tw.mock) return true;
  const ctl = eng.waiverControl(state);
  if (ctl === 'closed') return true;
  // a fresh drop waits for the next run EVEN under a Chairman's manual open —
  // "thrown open" frees the pool, never the waiver rule (Toby, 9 Aug; DF canon)
  for (const t of state.transfers) if (t.outId === p.id && (t.t || 0) > eng.lastWaiverRun(state)) return true;
  if (ctl === 'open') return false;
  if (!tw.open) return true;
  return false;
}

ACTIONS.tradePropose = async ({ league, a, data, ctx, state, eng }) => {
  const from = actingManager(a, data);
  const to = Number(data.to);
  if (!state.managers.some(m => m.id === to) || to === from) throw new HttpsError('invalid-argument', 'bad counterparty');
  const cap = Engine.SQUAD_RULES.size;
  const give = intArray(data.give, 'give', cap), get = intArray(data.get, 'get', cap);
  if (!give.length || give.length !== get.length) throw new HttpsError('invalid-argument', 'trades swap the same number each way');
  if (new Set(give).size !== give.length || new Set(get).size !== get.length || give.some(id => get.includes(id))) {
    throw new HttpsError('invalid-argument', 'a trade can’t repeat a player'); // dupes corrupt both squad sizes on execution
  }
  const tgw = eng.transferGw(state);
  const mine = eng.squadIdsGiven(state, from, state.transfers, tgw);
  const theirs = eng.squadIdsGiven(state, to, state.transfers, tgw);
  if (!give.every(id => mine.has(id)) || !get.every(id => theirs.has(id))) throw new HttpsError('failed-precondition', 'players not owned by the right sides');
  const offer = {
    id: `t${Date.now()}-${from}`, from, to, give, get,
    terms: cleanText(data.terms, 400), status: 'pending', t: Date.now(),
  };
  const res = await db().ref(`${leagueBase(league)}/public/trades`).transaction(seeded(state.trades, arr => {
    if (arr.length >= 1000) return; // ledger cap — a real league never gets near this
    return [...arr, offer];
  }));
  if (!res.committed) throw new HttpsError('aborted', 'try again');
  return { id: offer.id };
};

ACTIONS.tradeRespond = async ({ league, a, data, ctx, state, eng }) => {
  const trade = state.trades.find(t => t.id === data.tradeId);
  if (!trade) throw new HttpsError('not-found', 'no such trade');
  const action = data.action;
  const base = leagueBase(league);
  const mid = a.managerId;
  if (action === 'withdraw' && mid !== trade.from && !isCommish(a)) throw new HttpsError('permission-denied', 'not your offer');
  if ((action === 'accept' || action === 'reject') && mid !== trade.to && !isCommish(a)) throw new HttpsError('permission-denied', 'not your decision');
  if (!['accept', 'reject', 'withdraw'].includes(action)) throw new HttpsError('invalid-argument', 'unknown action');
  const give = toArr(trade.give).length ? toArr(trade.give) : [trade.give].filter(Boolean);
  const get = toArr(trade.get).length ? toArr(trade.get) : [trade.get].filter(Boolean);
  const tgw = eng.transferGw(state);
  const finishEarly = status => db().ref(`${base}/public/trades`).transaction(seeded(state.trades, arr => {
    const t = arr.find(x => x.id === trade.id);
    if (t) t.status = status;
    return arr;
  }));
  const ensureCovenant = async () => {
    if (!trade.terms) return;
    const cov = { id: `c${Date.now()}`, trade: trade.id, from: trade.from, to: trade.to, text: trade.terms, t: Date.now(), gw: eng.currentGwIndex() };
    await db().ref(`${base}/public/covenants`).transaction(seeded(state.covenants, arr => {
      if (!arr.some(c => c && (c.id === cov.id || c.trade === trade.id))) arr.push(cov); // one covenant per trade, crash-replay included
      return arr;
    }));
  };
  // ledger truth comes BEFORE any action, reject and withdraw included: if this
  // trade's transfer records landed, the players are swapped no matter what the
  // status says or what the caller asks for. A landed trade can only become
  // 'done' — rejecting it would leave the swap standing under a lying status.
  const malformed = new Set(give).size !== give.length || new Set(get).size !== get.length || give.some(id => get.includes(id));
  const landedRecs = state.transfers.filter(tr => tr && tr.trade === trade.id);
  if (landedRecs.length && trade.status !== 'done') {
    if (malformed) { // a dupe-player trade with a ledger is forged twice over — no auto-heal
      throw new HttpsError('failed-precondition', 'malformed trade with ledger records — Committee surgery required');
    }
    // the ledger must match this trade EXACTLY — right managers, right players,
    // right directions, right multiplicity. Anything else (partial, or records
    // tagged with this id but describing a different swap) is forged/corrupt
    // state and no automatic story is honest.
    const wanted = [];
    give.forEach((pid, i) => {
      wanted.push(`${trade.from}:${pid}>${get[i]}`);
      wanted.push(`${trade.to}:${get[i]}>${pid}`);
    });
    const got = landedRecs.map(r => `${r.managerId}:${r.outId}>${r.inId}`);
    if (wanted.length !== got.length || wanted.sort().join('|') !== got.sort().join('|')) {
      throw new HttpsError('failed-precondition', `trade ledger does not match the offer (${got.length}/${wanted.length} records) — Committee surgery required`);
    }
    const upd = {};
    for (const side of [{ mid: trade.from, outs: give }, { mid: trade.to, outs: get }]) {
      const lu = state.lineups[side.mid]?.[tgw];
      if (lu) upd[`${base}/public/lineups/${side.mid}/${tgw}`] = toArr(lu).filter(id => !side.outs.includes(id));
    }
    if (Object.keys(upd).length) await db().ref().update(upd);
    await ensureCovenant();
    await finishEarly('done');
    return { status: 'done', healed: true };
  }
  if (action === 'reject' || action === 'withdraw') {
    const to = action === 'reject' ? 'rejected' : 'withdrawn';
    const rres = await db().ref(`${base}/public/trades`).transaction(seeded(state.trades, arr => {
      const t = arr.find(x => x.id === trade.id);
      if (!t || t.status !== 'pending') return;
      t.status = to;
      return arr;
    }));
    if (!rres.committed) { // wasn't pending — report what it actually is, not what was asked
      const curT = toArr(rres.snapshot.val()).find(x => x && x.id === trade.id);
      return { status: curT?.status || trade.status, unchanged: true };
    }
    return { status: to };
  }
  // stored offers may predate validation — a duplicated player corrupts both squads
  if (malformed) {
    await finishEarly('withdrawn');
    throw new HttpsError('failed-precondition', 'malformed trade (repeated player) — withdrawn');
  }
  if (trade.status === 'executing') { // claimed but nothing landed
    if (Date.now() - (trade.claimT || trade.t || 0) > 60000) { // stale claim — release it
      await finishEarly('pending');
      throw new HttpsError('aborted', 'the trade was stuck mid-execution — released, accept it again');
    }
    throw new HttpsError('aborted', 'trade already being executed');
  }
  // phase 1: claim the trade (pending -> executing) so a double-accept is impossible
  const claim = await db().ref(`${base}/public/trades`).transaction(seeded(state.trades, arr => {
    const t = arr.find(x => x.id === trade.id);
    if (!t || t.status !== 'pending') return;
    t.status = 'executing';
    t.claimT = Date.now(); // lets a later accept tell a crashed claim from a live one
    return arr;
  }));
  if (!claim.committed) throw new HttpsError('aborted', 'trade already handled');
  const finish = status => db().ref(`${base}/public/trades`).transaction(seeded(state.trades, arr => {
    const t = arr.find(x => x.id === trade.id);
    if (t) t.status = status;
    return arr;
  }));
  let landed = false; // set once the transfers txn commits — after that, NEVER reset to pending
  try {
    // symmetric records, validated inside the transfers txn: each side must own
    // what it gives and not own what it receives, and both shapes must stay legal
    const recs = [];
    const pc = id => ctx.PLAYER_BY_ID[id]?.code ?? null;
    give.forEach((pid, i) => {
      recs.push({ managerId: trade.from, outId: pid, outCode: pc(pid), inId: get[i], inCode: pc(get[i]), gw: tgw, t: Date.now(), trade: trade.id });
      recs.push({ managerId: trade.to, outId: get[i], outCode: pc(get[i]), inId: pid, inCode: pc(pid), gw: tgw, t: Date.now(), trade: trade.id });
    });
    const ref = db().ref(`${base}/public/transfers`);
    const res = await ref.transaction(seeded(state.transfers, out => {
      const fromSquad = eng.squadIdsGiven(state, trade.from, out, tgw);
      const toSquad = eng.squadIdsGiven(state, trade.to, out, tgw);
      if (!give.every(id => fromSquad.has(id)) || !get.every(id => toSquad.has(id))) return;
      const fromAfter = [...fromSquad].filter(id => !give.includes(id)).concat(get).map(id => ctx.PLAYER_BY_ID[id]).filter(Boolean);
      const toAfter = [...toSquad].filter(id => !get.includes(id)).concat(give).map(id => ctx.PLAYER_BY_ID[id]).filter(Boolean);
      if (!eng.squadShapeOk(state, fromAfter) || !eng.squadShapeOk(state, toAfter)) return;
      for (const r of recs) out.push({ ...r, n: out.length + 1 });
      return out;
    }));
    if (!res.committed) { await finish('pending'); throw new HttpsError('failed-precondition', 'squads changed — trade is void for now'); }
    landed = true;
    const upd = {};
    for (const side of [{ mid: trade.from, outs: give }, { mid: trade.to, outs: get }]) {
      const lu = state.lineups[side.mid]?.[tgw];
      if (lu) upd[`${base}/public/lineups/${side.mid}/${tgw}`] = toArr(lu).filter(id => !side.outs.includes(id));
    }
    if (trade.terms) {
      const cov = { id: `c${Date.now()}`, trade: trade.id, from: trade.from, to: trade.to, text: trade.terms, t: Date.now(), gw: eng.currentGwIndex() };
      await db().ref(`${base}/public/covenants`).transaction(seeded(state.covenants, arr => {
        if (!arr.some(c => c.id === cov.id || c.trade === trade.id)) arr.push(cov); // one covenant per trade, even across a crash-replay
        return arr;
      }));
    }
    if (Object.keys(upd).length) await db().ref().update(upd);
    await finish('done');
    return { status: 'done' };
  } catch (e) {
    // once transfers landed, 'pending' is a lie — park it as 'executing' so
    // the landed-recovery branch above completes it on the next accept
    if (!(e instanceof HttpsError)) await finish(landed ? 'executing' : 'pending').catch(() => {});
    throw e;
  }
};

ACTIONS.covenantAdd = async ({ league, a, data, state }) => {
  const from = actingManager(a, data);
  const to = Number(data.to);
  if (!state.managers.some(m => m.id === to)) throw new HttpsError('invalid-argument', 'bad counterparty');
  const cov = { id: `c${Date.now()}-${from}`, from, to, text: cleanText(data.text, 400), t: Date.now(), gw: data.gw ?? null };
  const res = await db().ref(`${leagueBase(league)}/public/covenants`).transaction(seeded(state.covenants, arr => {
    if (arr.length >= 500) return; // register cap
    return [...arr, cov];
  }));
  if (!res.committed) throw new HttpsError('aborted', 'the register is full or contended');
  return { id: cov.id };
};

/* ----- personalia ----- */
ACTIONS.blockToggle = async ({ league, a, data, state, eng }) => {
  const mid = actingManager(a, data);
  const pid = Number(data.pid);
  const cur = toArr(state.tradeBlock[mid]);
  const listing = !cur.includes(pid);
  // Ownership gates LISTING only. It used to gate both ways, so signing away a
  // listed player left him advertised forever with no way to pull him down —
  // the delist was refused for the very reason it was needed (Toby, sandbox
  // 12 Aug). Taking your own name off a list is always allowed.
  if (listing) {
    // the squad AS IT STANDS — a waiver signing lands in the upcoming GW, so
    // the played round's squad refused him ("not your player" on a man you
    // just signed — Ian, 25 Aug, same family as the club-office fix)
    const squad = eng.squadAt(state, mid, eng.transferGw(state));
    if (!squad.some(p => p.id === pid)) throw new HttpsError('failed-precondition', 'not your player');
  }
  const next = listing ? [...cur, pid] : cur.filter(x => x !== pid);
  await db().ref(`${leagueBase(league)}/public/tradeBlock/${mid}`).set(next);
  return { listed: next.includes(pid) };
};

/* the ready room: pre-draft roll call. Marking yourself ready proves you're
 * signed in on your draft device; the Chairman can mark anyone (the runbook
 * override for the mate whose email opened on the wrong phone). Lives only
 * in setup — reset wipes it with the rest of public. */
ACTIONS.readySet = async ({ league, a, data, state }) => {
  const mid = actingManager(a, data);
  if (state.phase !== 'setup') throw new HttpsError('failed-precondition', 'the ready room closes once the draft starts');
  if (!toArr(state.managers).some(m => m.id === mid)) throw new HttpsError('not-found', 'no such manager');
  await db().ref(`${leagueBase(league)}/public/ready/${mid}`)
    .set(data.ready === false ? null : { t: Date.now(), self: mid === a.managerId });
  return { ok: true };
};

// draft-night heckling (Marc, 2 Aug): one button, a randomised barb, a
// cooldown. Self only — the Chairman does not heckle by proxy. Stock barbs are
// stored as an index (the client owns the words); custom text (Marc's follow-up,
// same night) is stored verbatim, cleaned, and ONLY ever rendered escaped.
ACTIONS.heckle = async ({ league, a, data, state }) => {
  const mid = a.managerId;
  if (state.phase !== 'draft') throw new HttpsError('failed-precondition', 'heckling is a draft-night art');
  let entry = null;
  if (data.text !== undefined) {
    if (typeof data.text !== 'string') throw new HttpsError('invalid-argument', 'bad heckle');
    const text = cleanText(data.text, 90).trim();
    if (!text) throw new HttpsError('invalid-argument', 'an empty heckle is just staring');
    entry = { text };
  } else {
    const line = Number(data.line);
    if (!Number.isInteger(line) || line < 0 || line > 63) throw new HttpsError('invalid-argument', 'bad heckle');
    entry = { line };
  }
  const ref = db().ref(`${leagueBase(league)}/public/heckles/${mid}`);
  const seedSnap = (await ref.get()).val(); // seed: empty first txn pass must not bypass the cooldown
  const res = await ref.transaction(seededObj(seedSnap, cur => {
    if (cur && cur.t && Date.now() - cur.t < 15000) return; // abort — cooldown
    return { ...entry, t: Date.now() };
  }));
  if (!res.committed) throw new HttpsError('resource-exhausted', 'one heckle per 15 seconds — pace yourself');
  return { ok: true };
};

ACTIONS.stadiumSet = async ({ league, a, data, state }) => {
  const mid = actingManager(a, data);
  if (!toArr(state.managers).some(m => m.id === mid)) throw new HttpsError('not-found', 'no such manager');
  await managerMerge(league, state, mid, { stadium: cleanStadium(data.name) });
  return { ok: true };
};

// club identity — name, kit, sponsor. The founding of a club is a sacred act;
// the validation is not.
const KIT_PATTERNS = ['plain', 'stripes', 'hoops', 'sash', 'halves'];
const hexOk = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
// the catalogues live in js/lore.js; these counts are pinned to that file by
// functions.test.js — grow them together or the suite fails. Out-of-range
// values render as a vacant dugout / dead hoarding, so they must not validate.
const GAFFER_COUNT = 12;
const ASSISTANT_COUNT = 12;
const BOARD_COUNT = 27;
const cleanKit = k => {
  if (k === null) return null;
  if (!KIT_PATTERNS.includes(k?.pattern) || !hexOk(k?.c1) || !hexOk(k?.c2)) throw new HttpsError('invalid-argument', 'kit is a pattern + two hex colours');
  return { pattern: k.pattern, c1: k.c1.toLowerCase(), c2: k.c2.toLowerCase() };
};
const cleanGaffer = g => {
  // the FM character sheet: an archetype off the stable, or a made-up one
  if (g === null) return null;
  if (Number.isInteger(g) && g >= 0 && g < GAFFER_COUNT) return g;
  if (g && typeof g === 'object' && typeof g.t === 'string' && cleanText(g.t, 30).trim().length >= 2) {
    return { t: cleanText(g.t, 30).trim(), bio: cleanText(g.bio || '', 60).trim() || null };
  }
  throw new HttpsError('invalid-argument', 'gaffer is an archetype number or a name + bio');
};
const cleanAssistant = g => {
  // the No. 2: one off the stable, or a made-up one. null = back to house-issue
  if (g === null) return null;
  if (Number.isInteger(g) && g >= 0 && g < ASSISTANT_COUNT) return g;
  if (g && typeof g === 'object' && typeof g.t === 'string' && cleanText(g.t, 30).trim().length >= 2) {
    return { t: cleanText(g.t, 30).trim(), bio: cleanText(g.bio || '', 60).trim() || null };
  }
  throw new HttpsError('invalid-argument', 'assistant is an archetype number or a name + bio');
};
// the College of Arms (Lee, 12 Aug): a shield shape and division off the
// stable, a charge off the catalogue (null = the house monogram), two hex
// colours. crest null entirely = back to house-issue. Counts pinned to
// js/lore.js by functions.test.js — grow them together or the suite fails.
const CREST_SHAPE_COUNT = 4;
const CREST_DIVISION_COUNT = 6;
const CREST_CHARGE_COUNT = 16;
const cleanCrest = c => {
  if (c === null) return null;
  const idx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
  if (!c || typeof c !== 'object' || !idx(c.shape, CREST_SHAPE_COUNT) || !idx(c.div, CREST_DIVISION_COUNT)
    || (c.charge != null && !idx(c.charge, CREST_CHARGE_COUNT))
    || !hexOk(c.c1) || !hexOk(c.c2)) throw new HttpsError('invalid-argument', 'a crest is shape + division + charge + two hex colours');
  return { shape: c.shape, div: c.div, charge: c.charge ?? null, c1: c.c1.toLowerCase(), c2: c.c2.toLowerCase() };
};
const cleanBoards = b0 => {
  // up to three hoardings off the league's stable to line the home ground.
  // RAW length is checked before dedupe — a thousand-entry array must not
  // sneak in as "one board" (sol club-office r2 P3)
  if (b0 === null) return null;
  if (!Array.isArray(b0) || b0.length > 3) throw new HttpsError('invalid-argument', 'boards are up to three hoarding numbers');
  const b = [...new Set(b0)];
  if (b.some(i => !Number.isInteger(i) || i < 0 || i >= BOARD_COUNT)) throw new HttpsError('invalid-argument', 'boards are up to three hoarding numbers');
  return b.length ? b : null;
};
// ONE stadium contract everywhere — office, rename button and import share it
const cleanStadium = v => {
  if (typeof v !== 'string') throw new HttpsError('invalid-argument', 'a ground needs a name');
  const st = cleanText(v, 40).trim();
  if (!st) throw new HttpsError('invalid-argument', 'a ground needs a name');
  return st;
};
/* merge fields onto ONE manager, resolved BY ID inside the txn — an index
 * computed from a stale snapshot lands the write on whoever now occupies that
 * slot when a concurrent import reorders the roster (sol club-office P1.1).
 * Null values in `up` delete the key (RTDB strips nulls on write). */
async function managerMerge(league, state, mid, up) {
  const ref = db().ref(`${leagueBase(league)}/public/managers`);
  const res = await ref.transaction(seeded(state.managers, arr => {
    const i = arr.findIndex(m => m && m.id === mid);
    if (i < 0) return; // roster changed underneath — abort, never a blind write
    // relational fields revalidate against the roster AT COMMIT — a rival
    // validated on the request's snapshot can vanish under a concurrent
    // import, leaving a ghost rivalry (sol club-office r2 P1)
    if (up.rival != null && !arr.some(m => m && m.id === up.rival)) return;
    if (up.rivals) up.rivals = up.rivals.filter(r => arr.some(m => m && m.id === r)) || null;
    arr[i] = { ...arr[i], ...up };
    return arr;
  }));
  if (!res.committed) throw new HttpsError('aborted', 'the roster changed underneath you — try again');
}
ACTIONS.clubSet = async ({ league, a, data, state }) => {
  const mid = actingManager(a, data);
  if (!toArr(state.managers).some(m => m.id === mid)) throw new HttpsError('not-found', 'no such manager');
  const up = {};
  if (data.team !== undefined) {
    const t = cleanText(data.team, 30).trim();
    if (t.length < 2) throw new HttpsError('invalid-argument', 'team name needs 2+ characters');
    up.team = t;
  }
  if (data.kit !== undefined) up.kit = cleanKit(data.kit);
  if (data.sponsor !== undefined) {
    // a name off the league's hoardings, or one they made up themselves
    if (data.sponsor !== null && typeof data.sponsor !== 'string') throw new HttpsError('invalid-argument', 'sponsor is text');
    const s = data.sponsor === null ? '' : cleanText(data.sponsor, 20).trim();
    up.sponsor = s || null;
  }
  if (data.rivals !== undefined) {
    // multiple declared rivals (Ben, 2 Aug) — up to three, no self, roster only.
    // Mutuality is still not required; that's still the joke.
    if (data.rivals === null) { up.rivals = null; up.rival = null; }
    else {
      const arr = toArr(data.rivals).map(Number);
      if (arr.length > 3 || new Set(arr).size !== arr.length) throw new HttpsError('invalid-argument', 'up to three distinct rivals');
      if (arr.some(r => !Number.isInteger(r) || r === mid || !state.managers.some(x => x.id === r))) throw new HttpsError('invalid-argument', 'a rival must be another of the twelve');
      up.rivals = arr.length ? arr : null;
      up.rival = arr.length ? arr[0] : null; // stale clients still read the single field
    }
  } else if (data.rival !== undefined) {
    // legacy single-rival clients — still honoured, mirrored into the array
    if (data.rival !== null && (!state.managers.some(x => x.id === data.rival) || data.rival === mid)) throw new HttpsError('invalid-argument', 'a rival must be another of the twelve');
    up.rival = data.rival;
    up.rivals = data.rival === null ? null : [data.rival];
  }
  if (data.stadium !== undefined) up.stadium = cleanStadium(data.stadium);
  if (data.gaffer !== undefined) up.gaffer = cleanGaffer(data.gaffer);
  if (data.assistant !== undefined) up.assistant = cleanAssistant(data.assistant);
  if (data.boards !== undefined) up.boards = cleanBoards(data.boards);
  if (data.crest !== undefined) up.crest = cleanCrest(data.crest);
  if (!Object.keys(up).length) throw new HttpsError('invalid-argument', 'nothing to change');
  await managerMerge(league, state, mid, up);
  return { ok: true };
};

ACTIONS.shirtNumSet = async ({ league, a, data, state, eng }) => {
  const mid = actingManager(a, data);
  const pid = Number(data.pid), num = data.num == null ? null : Number(data.num);
  // transferGw, not the played round: fresh waiver signings must be
  // numberable the moment they land (Ian, 25 Aug)
  if (!eng.squadAt(state, mid, eng.transferGw(state)).some(p => p.id === pid)) throw new HttpsError('failed-precondition', 'not your player');
  if (num != null && (!Number.isInteger(num) || num < 1 || num > 99)) throw new HttpsError('invalid-argument', 'numbers run 1-99');
  if (num != null && Object.entries(state.shirtNums[mid] || {}).some(([p, n]) => +p !== pid && n === num)) throw new HttpsError('failed-precondition', 'number taken');
  await db().ref(`${leagueBase(league)}/public/shirtNums/${mid}/${pid}`).set(num);
  return { ok: true };
};

ACTIONS.lobusDeclare = async ({ league, a, data, state, eng }) => {
  const mid = actingManager(a, data);
  const pid = Number(data.pid);
  if (!eng.squadAt(state, mid, eng.transferGw(state)).some(p => p.id === pid)) throw new HttpsError('failed-precondition', 'the Lobus must be one of your own');
  if (state.lobus[mid] && eng.gwHasStarted(0)) throw new HttpsError('failed-precondition', 'the Lobus is declared for the season');
  await db().ref(`${leagueBase(league)}/public/lobus/${mid}`).set(pid);
  return { ok: true };
};

/* ----- Ham Cup ----- */
/* The selection window opens 7 days before the cup gameweek's first kickoff
 * (or at the draw / the Chairman's early-open, whichever is later to arrive),
 * and the Trough is frozen as of the moment it opens: `frozen` on the cup
 * node = the OWNED player ids at that instant, and eligibility is judged
 * against that snapshot, not the live Trough. Entries still lock at kickoff. */
const HAM_WINDOW_MS = 7 * 24 * 3600e3;
const hamTs = v => (typeof v === 'number' ? v : (v ? new Date(v).getTime() : 0));
function hamOpensAt(cup, eng) {
  if (!cup || !cup.gw) return null;
  if (cup.openedAt) return hamTs(cup.openedAt);
  const k = eng.gwKicks(cup.gw);
  const drawn = hamTs(cup.drawnAt);
  return k ? Math.max(drawn, k.first - HAM_WINDOW_MS) : drawn;
}
ACTIONS.hamEnter = async ({ league, a, data, state, eng, ctx }) => {
  const mid = actingManager(a, data);
  if (!Number.isInteger(data.gw)) throw new HttpsError('invalid-argument', 'entry must name its cup gameweek — refresh the app');
  if (!state.hamCup || state.hamCup.status === 'off' || !state.hamCup.gw) throw new HttpsError('failed-precondition', 'no cup drawn');
  if (eng.gwHasStarted(state.hamCup.gw)) throw new HttpsError('failed-precondition', 'the cup gameweek has kicked off — entries are locked');
  const opensAt = hamOpensAt(state.hamCup, eng);
  if (opensAt && Date.now() < opensAt) throw new HttpsError('failed-precondition', 'the selection window has not opened yet — it opens a week before the tie');
  const xi = intArray(data.xi, 'xi', 11);
  if (!eng.xiValid(xi)) throw new HttpsError('invalid-argument', 'XI shape is illegal');
  const frozenSet = Array.isArray(state.hamCup.frozen) ? new Set(state.hamCup.frozen) : null;
  const owned = frozenSet || eng.ownedIdsAt(state, eng.currentGwIndex());
  if (xi.some(id => owned.has(id))) throw new HttpsError('invalid-argument', 'Ham Cup XIs come from the Trough only');
  if (xi.some(id => !ctx.PLAYER_BY_ID[id] || eng.arrivalLocked(state, ctx.PLAYER_BY_ID[id]))) throw new HttpsError('invalid-argument', 'locked or unknown player');
  // the first entry after the window opens freezes the pool in the same txn,
  // so every later entry is judged against the identical snapshot
  const ownedNow = [...eng.ownedIdsAt(state, eng.currentGwIndex())];
  // entry lands via a txn on the cup node: if the cup was redrawn to a
  // different GW after this device loaded it, the entry refuses instead of
  // silently attaching to the new cup (the gw pin above is mandatory)
  const res = await db().ref(`${leagueBase(league)}/public/hamCup`).transaction(seededObj(state.hamCup, c => {
    if (!c || c.status === 'off' || !c.gw) return;
    if (c.gw !== data.gw) return; // cup changed underneath them
    if (!Array.isArray(c.frozen)) c.frozen = ownedNow;
    else if (xi.some(id => c.frozen.includes(id))) return; // pool froze differently underneath them
    (c.entries = c.entries || {})[mid] = xi;
    return c;
  }));
  if (!res.committed) throw new HttpsError('failed-precondition', 'the cup changed while you picked — reopen it and enter again');
  return { ok: true };
};

ACTIONS.hamAdmin = async ({ league, a, data, state, eng, ctx }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  if (data.op === 'cancel') { await db().ref(`${leagueBase(league)}/public/hamCup`).set({ status: 'off' }); return { ok: true }; }
  if (data.op === 'open') {
    // Chairman opens the selection window early — the pool freezes right here
    if (!state.hamCup || state.hamCup.status === 'off' || !state.hamCup.gw) throw new HttpsError('failed-precondition', 'no cup drawn');
    if (eng.gwHasStarted(state.hamCup.gw)) throw new HttpsError('failed-precondition', 'that tie has already kicked off');
    const ownedNow = [...eng.ownedIdsAt(state, eng.currentGwIndex())];
    const res = await db().ref(`${leagueBase(league)}/public/hamCup`).transaction(seededObj(state.hamCup, c => {
      if (!c || c.status === 'off' || !c.gw) return;
      if (!c.openedAt) c.openedAt = Date.now();
      if (!Array.isArray(c.frozen)) c.frozen = ownedNow;
      return c;
    }));
    if (!res.committed) throw new HttpsError('failed-precondition', 'no cup to open');
    return { ok: true };
  }
  if (data.op === 'draw') {
    const gw = Number(data.gw);
    if (!Number.isInteger(gw) || gw < CUP_START || gw >= Engine.REGULAR_GWS) throw new HttpsError('invalid-argument', 'draw a gameweek between the cup start and the end of the regular season');
    if (gw >= ctx.gameweeks.length) throw new HttpsError('invalid-argument', 'no such gameweek in the fixture calendar');
    // the ham belongs later in the season (Marc, 1 Aug): GW20+ in a real
    // calendar; clamped so short synthetic test calendars stay drawable
    const hamFloor = Math.min(19, ctx.gameweeks.length - 1);
    if (gw < hamFloor) throw new HttpsError('invalid-argument', 'the velvet bag only opens from GW20 — the ham belongs later in the season');
    if (eng.gwHasStarted(gw)) throw new HttpsError('failed-precondition', 'that gameweek has already kicked off');
    // an existing cup with entries — upcoming, live or settled — can't be
    // silently replaced (entries and results would vanish); the Chairman must
    // cancel explicitly first. The check runs INSIDE the txn so a simultaneous
    // entry submission makes the redraw retry and then refuse, never the
    // entry vanish. An entry-less upcoming draw may be redrawn.
    const res = await db().ref(`${leagueBase(league)}/public/hamCup`).transaction(seededObj(state.hamCup || null, c => {
      if (c && c.gw != null && c.status !== 'off'
        && (eng.gwHasStarted(c.gw) || Object.keys(c.entries || {}).length)) return; // refuse
      return { gw, drawnAt: Date.now(), entries: {} };
    }));
    if (!res.committed) throw new HttpsError('failed-precondition', 'the current cup has entries or is underway — cancel it explicitly before redrawing');
    return { ok: true };
  }
  throw new HttpsError('invalid-argument', 'unknown op');
};

/* ----- the Simulation Chamber (sandbox ONLY) -----
 * Stores the tiny {gw, phase, seed, t} flag; every client derives identical
 * pretend stats from it locally. The seed is pinned per gameweek so live →
 * full-time follows one consistent story; re-kicking a live sim keeps its
 * clock. Hard-refused outside the sandbox league — the real league's results
 * come from the FPL wire or not at all. */
ACTIONS.mockMatchday = async ({ league, a, data }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  if (league !== 'the-league-sandbox') throw new HttpsError('failed-precondition', 'the Simulation Chamber only exists in the sandbox');
  const ref = db().ref(`${leagueBase(league)}/public/mock`);
  if (data.op === 'off') { await ref.set(null); return { ok: true }; }
  if (!['live', 'final'].includes(data.op)) throw new HttpsError('invalid-argument', 'unknown op');
  const gw = Number(data.gw);
  if (!Number.isInteger(gw) || gw < 0 || gw >= Engine.REGULAR_GWS) throw new HttpsError('invalid-argument', 'no such gameweek');
  const cur = (await ref.get()).val();
  const sameGw = cur && cur.gw === gw;
  await ref.set({
    gw,
    phase: data.op,
    seed: sameGw ? cur.seed : (Date.now() % 999983) || 1,
    t: sameGw && cur.phase === 'live' && data.op === 'live' ? cur.t : Date.now(),
  });
  return { ok: true };
};

/* ----- commissioner desk ----- */
const fixedSquadSettings = () => ({ squadSize: Engine.SQUAD_RULES.size, posMin: { ...Engine.SQUAD_RULES.min }, posMax: { ...Engine.SQUAD_RULES.max } });

ACTIONS.settingsSet = async ({ league, a, data, state }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  const base = leagueBase(league);
  if (data.scoringKey) {
    if (!(data.scoringKey in Engine.DEFAULT_SCORING)) throw new HttpsError('invalid-argument', 'unknown scoring key');
    const v = Number(data.value);
    if (!Number.isFinite(v) || Math.abs(v) > 100) throw new HttpsError('invalid-argument', 'scoring values are numbers (|v| <= 100)');
    await db().ref(`${base}/public/settings/scoring/${data.scoringKey}`).set(v);
    return { ok: true };
  }
  if (data.key === 'lobusBonus') {
    const v = Number(data.value) || 0;
    if (Math.abs(v) > 100) throw new HttpsError('invalid-argument', 'be serious');
    await db().ref(`${base}/public/settings/lobusBonus`).set(v);
    return { ok: true };
  }
  if (data.key === 'pickTimer') {
    const v = Math.max(0, Number(data.value) || 0);
    if (v > 3600) throw new HttpsError('invalid-argument', 'pick timer runs 0-3600 seconds');
    await db().ref(`${base}/public/settings/pickTimer`).set(v);
    return { ok: true };
  }
  if (['squadSize', 'posMin', 'posMax'].includes(data.key)) {
    await db().ref(`${base}/public/settings`).update(fixedSquadSettings());
    return { ok: true, fixed: true };
  }
  throw new HttpsError('invalid-argument', 'unknown setting');
};

ACTIONS.adjustmentSet = async ({ league, a, data, ctx }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  const pid = Number(data.pid), v = Number(data.value), g = Number(data.gw);
  if (!Number.isInteger(pid) || !Number.isFinite(v) || Math.abs(v) > 1000) throw new HttpsError('invalid-argument', 'bad adjustment');
  // adjustments land IN a gameweek — that is what makes them change results
  // (Toby, 9 Aug: the old flat shape never touched a single H2H score)
  if (!Number.isInteger(g) || g < 0 || g >= ctx.gameweeks.length) throw new HttpsError('invalid-argument', 'adjustments land in a named gameweek');
  await db().ref(`${leagueBase(league)}/public/adjustments/${g}/${pid}`).set(v || null);
  return { ok: true };
};

ACTIONS.waiverControl = async ({ league, a, data, state }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  if (!['auto', 'open', 'closed'].includes(data.mode)) throw new HttpsError('invalid-argument', 'auto, open or closed');
  await db().ref(`${leagueBase(league)}/public/waiverMeta`).set({ ...state.waiverMeta, control: data.mode });
  return { ok: true };
};

// skip one named run by exception (Toby, 12 Aug: double gameweeks, a rogue
// Wednesday finish) — claims stay lodged and roll to the run after. id null
// reinstates. The scheduled runner spends the flag when the slot comes due.
ACTIONS.waiverSkip = async ({ league, a, data, ctx }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  let id = data.id == null ? null : String(data.id);
  /* {next:true}: the SERVER names the slot. The client's idea of "next run"
     comes from public state and cannot see the run ledger — on draft night
     26/27 it skipped a slot the ledger had already consumed ("skipped: not
     in season") while the genuinely-next slot sailed on unprotected. Only
     the ledger knows which slot the runner will actually process. */
  if (data.next === true) {
    const eng = ctx.eng;
    const due = eng.waiverSchedule();
    const future = eng.waiverSlotId(eng.nextSlotAt(Date.now()));
    const baseRef = db().ref(leagueBase(league));
    const seedSnap = (await baseRef.get()).val();
    /* Select the slot and stamp the flag in ONE transaction with the run
       ledger. A scheduled run claims its child of this same tree first; RTDB
       then retries us against status=running/applying, so we cannot recreate
       the draft-night TOCTOU and skip a slot already being processed. If we
       win first, the runner sees the flag after its claim and consumes it. */
    const res = await baseRef.transaction(cur => {
      // Admin may invoke a transaction once against an empty local cache. Seed
      // that attempt from a read; the server compare then retries us against
      // any newer value, preserving the atomic ledger/public judgement.
      const c = cur === null && seedSnap ? JSON.parse(JSON.stringify(seedSnap)) : cur;
      if (!c) return;
      const runs = c.server?.waiverRuns || {};
      const unavailable = sid => ['done', 'running', 'applying'].includes(runs[`sched-${sid}`]?.status);
      id = (due.find(d => !unavailable(d.id)) || {}).id || future;
      c.public = c.public || {};
      c.public.waiverMeta = { ...(c.public.waiverMeta || {}), skip: id };
      return c;
    });
    if (!res.committed) throw new HttpsError('aborted', 'waiver ledger moved — retry');
    return { ok: true, skip: id };
  }
  if (id != null && !/^wv-\d{4}-\d{2}-\d{2}$/.test(id)) throw new HttpsError('invalid-argument', 'not a waiver slot id');
  // Legacy named-slot clients and Reinstate keep working, without replacing a
  // concurrent lastRun/control update with the action's earlier snapshot.
  await db().ref(`${leagueBase(league)}/public/waiverMeta`).update({ skip: id });
  return { ok: true, skip: id };
};

ACTIONS.waiverRunNow = async ({ league, a, data }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  // A LIVE Chamber match means the pretend scores are still being invented —
  // a run now adjudicates against the canonical feed instead of the mock
  // table, then stamps lastRun as if the post-GW run had happened (sol R2 P1).
  const mock = (await db().ref(`${leagueBase(league)}/public/mock`).get()).val();
  if (mock && mock.phase === 'live') throw new HttpsError('failed-precondition', 'a Simulation Chamber match is live — waivers wait for full time');
  return runWaivers(league, data.runId ? `manual-${cleanText(data.runId, 40)}` : `manual-${Date.now()}`, `manual:${a.uid}`, EMULATED ? data.__failpoint : undefined);
};

/* ----- window draft ----- */
/* pick/pass/end run as ONE transaction on the whole public node: turn check,
 * transfer append, lineup strip, pick record, pass counter and completion all
 * commit together or not at all — no partial state to recover from. */
ACTIONS.windowDraft = async ({ league, a, data, ctx, state, eng }) => {
  const base = leagueBase(league);
  const op = data.op;
  if (op === 'start') {
    if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
    if (state.windowDraft?.status === 'live') throw new HttpsError('failed-precondition', 'already live');
    const order = [...state.draft.order].reverse();
    await db().ref(`${base}/public/windowDraft`).set({ status: 'live', order, turn: 0, passes: 0, picks: [] });
    return { ok: true };
  }
  // Admit ONE man to the Trough without opening the window (Marc, 21 Aug:
  // Osman was never a signing — FPL had simply never created him until he
  // played). isArrival cannot tell that from a real transfer: both surface as
  // an id the draft-night snapshot has never seen. Recording him in the
  // snapshot at his current club states what was already true — he was at that
  // club on draft night — and leaves every genuine arrival locked.
  if (op === 'admit') {
    if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
    const pid = Number(data.playerId);
    const p = ctx.PLAYER_BY_ID[pid];
    if (!p) throw new HttpsError('invalid-argument', 'unknown player');
    const pool = state.draftPool;
    if (!pool || !pool.ids) throw new HttpsError('failed-precondition', 'no draft pool to admit him to');
    // a man the snapshot already knows was never in the pen — isArrival only
    // fires on an id draft night never saw, so there is nothing to admit
    if (pool.ids[pid] !== undefined) {
      throw new HttpsError('failed-precondition', `${p.name} was on the game at draft night — he was never in the pen`);
    }
    await db().ref(`${base}/public/draftPool/ids/${pid}`).set(p.club);
    return { ok: true, admitted: pid, club: p.club };
  }
  if (!['pick', 'pass', 'end'].includes(op)) throw new HttpsError('invalid-argument', 'unknown op');
  if (op === 'end' && !isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  if (!state.windowDraft || state.windowDraft.status !== 'live') throw new HttpsError('failed-precondition', 'no window draft running');
  failpoint(EMULATED ? data.__failpoint : undefined, 'wd:beforeTxn');

  const poolIds = Object.fromEntries(ctx.PLAYERS.map(p => [p.id, p.club]));
  const pubRef = db().ref(`${base}/public`);
  const rawSeed = (await pubRef.get()).val(); // fresh raw value for the null first pass
  let deny = null; // {code, msg} decided inside the txn on its final attempt
  const res = await pubRef.transaction(cur => {
    const pub = structuredClone(cur === null ? rawSeed : cur);
    deny = null;
    if (!pub) { deny = { code: 'failed-precondition', msg: 'league not initialised' }; return; }
    const s = normalizeState(structuredClone(pub), ctx); // read-only view for the engine
    const wd = s.windowDraft;
    if (!wd || wd.status !== 'live') { deny = { code: 'failed-precondition', msg: 'no window draft running' }; return; }
    if (Number.isInteger(data.expectedTurn) && data.expectedTurn !== (wd.turn || 0)) { deny = { code: 'aborted', msg: 'the window moved on' }; return; }
    if (op === 'end') {
      pub.windowDraft = { ...pub.windowDraft, status: 'done' };
      pub.draftPool = { at: Date.now(), ids: poolIds };
      return pub;
    }
    const onClock = eng.wdActor(s);
    if (a.managerId !== onClock && !isCommish(a)) { deny = { code: 'permission-denied', msg: 'not your turn' }; return; }
    const wdRaw = pub.windowDraft;
    wdRaw.order = toArr(wdRaw.order);
    wdRaw.picks = toArr(wdRaw.picks);
    if (op === 'pick') {
      const inP = ctx.PLAYER_BY_ID[Number(data.inId)], outP = ctx.PLAYER_BY_ID[Number(data.outId)];
      if (!inP || !outP) { deny = { code: 'invalid-argument', msg: 'unknown player' }; return; }
      if (!eng.isArrival(s, inP)) { deny = { code: 'failed-precondition', msg: 'the Window Draft is for new arrivals only' }; return; }
      const tgw = eng.transferGw(s);
      if (eng.ownedIdsAt(s, tgw).has(inP.id)) { deny = { code: 'failed-precondition', msg: 'already owned' }; return; }
      const squad = eng.squadAt(s, onClock, tgw);
      if (!squad.some(p => p.id === outP.id)) { deny = { code: 'failed-precondition', msg: 'not yours to drop' }; return; }
      if (!eng.squadShapeOk(s, [...squad.filter(p => p.id !== outP.id), inP])) { deny = { code: 'failed-precondition', msg: 'squad shape would be illegal' }; return; }
      const transfers = toArr(pub.transfers);
      transfers.push({ managerId: onClock, outId: outP.id, outCode: outP.code ?? null, inId: inP.id, inCode: inP.code ?? null, gw: tgw, t: Date.now(), windowDraft: true, n: transfers.length + 1 });
      pub.transfers = transfers;
      const lu = pub.lineups?.[onClock]?.[tgw];
      if (lu) pub.lineups[onClock][tgw] = toArr(lu).filter(id => id !== outP.id);
      wdRaw.picks.push({ mid: onClock, in: inP.id, out: outP.id });
      wdRaw.passes = 0;
    } else {
      wdRaw.passes = (wdRaw.passes || 0) + 1;
    }
    wdRaw.turn = (wdRaw.turn || 0) + 1;
    if (wdRaw.passes >= wdRaw.order.length) {
      wdRaw.status = 'done'; // a full lap of passes ends the window in the same commit
      pub.draftPool = { at: Date.now(), ids: poolIds };
    }
    return pub;
  });
  if (!res.committed) {
    const d = deny || { code: 'aborted', msg: 'try again' };
    throw new HttpsError(d.code, d.msg);
  }
  const wdAfter = res.snapshot.val()?.windowDraft || null;
  return { ok: true, turn: wdAfter?.turn ?? null, status: wdAfter?.status ?? null };
};

/* ---------------- the Window Waiver (Marc, 30 Aug 2026) ----------------
 * "the window draft as a waiver where everyone does a waiver list rather than
 * a draft where everyone needs to be online... one off waiver, Thursday at
 * 10am, only including players in the holding pen... this will not impact the
 * waiver order or scheduling of the regular friday waiver."
 *
 * The law lives in js/engine.js (resolveWindowWaiver) so this file runs the
 * same rules the client renders. Lists are lodged per-uid and PRIVATE — a
 * blind list any client could read is not blind — merged by loadState the way
 * ordinary claims are. The run follows runWaivers' recoverable shape: claim
 * the run id under a lease, persist the plan, apply idempotently, mark done.
 * It never touches waiverMeta, so the Friday clock cannot move. */
const WINDOW_WAIVER_AT = Date.parse('2026-09-03T09:00:00Z'); // Thu 3 Sept 10:00 London — mirrored in js/app.js
const WINDOW_WAIVER_SLOT = 'window-2026-09-03';

ACTIONS.windowClaimSet = async ({ league, a, data, eng, ctx, state }) => {
  if (state.phase !== 'season') throw new HttpsError('failed-precondition', 'season not underway');
  const raw = toArr(data.claims);
  if (raw.length > 30) throw new HttpsError('invalid-argument', 'too many lines (max 30)');
  const claims = raw.map(c => ({
    in: Number(c && c.in), out: Number(c && c.out),
    inCode: ctx.PLAYER_BY_ID[Number(c && c.in)]?.code ?? null, outCode: ctx.PLAYER_BY_ID[Number(c && c.out)]?.code ?? null,
  }));
  if (claims.some(c => !Number.isInteger(c.in) || !Number.isInteger(c.out))) throw new HttpsError('invalid-argument', 'bad line');
  // the commissioner may lodge FOR a manager in the sandbox only, exactly as
  // claimSet rules: against real managers the write would replace a private
  // list the Chairman cannot see
  const mid = actingManager(a, data);
  if (mid !== a.managerId && league !== 'the-league-sandbox') {
    throw new HttpsError('failed-precondition', 'acting-as lists only exist in the sandbox');
  }
  const tgw = eng.transferGw(state);
  const squad = eng.squadAt(state, mid, tgw);
  const squadIds = new Set(squad.map(p => p.id));
  const owned = eng.ownedIdsAt(state, tgw);
  for (const c of claims) {
    const inP = ctx.PLAYER_BY_ID[c.in];
    if (!inP) throw new HttpsError('invalid-argument', 'line names an unknown player');
    // a doomed line is refused at the desk, not skipped on Thursday morning
    if (!eng.isArrival(state, inP)) throw new HttpsError('failed-precondition', `${inP.name} is not in the holding pen — use the weekly waiver list`);
    if (owned.has(c.in)) throw new HttpsError('failed-precondition', 'already owned');
    if (!squadIds.has(c.out)) throw new HttpsError('failed-precondition', 'the drop player is not in your squad');
    if (!eng.squadShapeOk(state, [...squad.filter(p => p.id !== c.out), ctx.PLAYER_BY_ID[c.in]])) throw new HttpsError('failed-precondition', 'line would leave an illegal squad shape');
  }
  let uid = a.uid;
  if (mid !== a.managerId) {
    uid = await uidForManager(league, mid);
    if (!uid) throw new HttpsError('failed-precondition', 'that manager has no account to hold a list');
  }
  await db().ref(`${leagueBase(league)}/private/${uid}/windowClaims`).set(claims);
  return { ok: true };
};

// applyWaiverPlan's twin for the window ledger: replay detection keys on the
// windowDraft flag these records carry, never the waiver flag they must not.
async function applyWindowPlan(league, runId, plan, state, eng, ctx) {
  if (!plan.records || !plan.records.length) return { applied: 0, dropped: 0, landed: [] };
  const ref = db().ref(`${leagueBase(league)}/public/transfers`);
  const seedSnap = (await ref.get()).val();
  const keyOf = r => `${r.managerId}:${r.inId}:${r.outId}`;
  let applied = 0, dropped = 0, landedKeys = new Set();
  const res = await ref.transaction(cur => {
    const out = toArr(cur === null ? seedSnap : cur).map(x => ({ ...x }));
    applied = 0; dropped = 0; landedKeys = new Set();
    const have = new Set(out.filter(t => t && t.windowDraft && t.runId === runId).map(keyOf));
    for (const r of plan.records) {
      const key = keyOf(r);
      if (have.has(key)) { applied++; landedKeys.add(key); continue; } // replay — already landed
      const owned = eng.ownedIdsGiven(state, out, plan.tgw);
      if (owned.has(r.inId) || !owned.has(r.outId)) { dropped++; continue; } // gone since planning — the line lapses
      const current = { ...state, transfers: out };
      const squad = eng.squadAt(current, r.managerId, plan.tgw);
      const inP = ctx.PLAYER_BY_ID[r.inId];
      const after = inP ? [...squad.filter(p => p.id !== r.outId), inP] : [];
      if (!inP || !eng.squadShapeOk(current, after)) { dropped++; continue; }
      out.push({ ...r, n: out.length + 1 });
      applied++; landedKeys.add(key);
    }
    return out;
  });
  if (!res.committed) throw new HttpsError('aborted', 'transfer ledger contended — run again');
  return { applied, dropped, landed: plan.records.filter(r => landedKeys.has(keyOf(r))) };
}

async function runWindowWaiver(league, runId, trigger) {
  const base = leagueBase(league);
  const runRef = db().ref(`${base}/server/waiverRuns/${runId}`);
  const now0 = Date.now();
  const claim = await runRef.transaction(cur => {
    if (cur && cur.status === 'done') return; // abort: nothing to do
    if (cur && (cur.status === 'running' || cur.status === 'applying')
      && now0 - (cur.startedAt || 0) < WAIVER_LEASE_MS) return; // abort: live lease
    return { ...(cur || {}), status: cur?.plan ? 'applying' : 'running', trigger, startedAt: now0, attempt: ((cur && cur.attempt) || 0) + 1 };
  });
  if (!claim.committed) {
    if (claim.snapshot.val()?.status === 'done') return { skipped: 'already processed' };
    throw new HttpsError('aborted', 'window waiver already in progress — retry shortly');
  }
  try {
    const ctx = await loadCtx();
    const eng = ctx.eng;
    const state = await loadState(league, ctx, { withPrivate: true });
    let plan = claim.snapshot.val()?.plan || null;
    if (!plan) {
      if (state.phase !== 'season') { await runRef.update({ status: 'done', result: 'skipped: not in season', finishedAt: Date.now() }); return { skipped: 'not in season' }; }
      const runStart = Date.now() - 1;
      const res = eng.resolveWindowWaiver(state, runStart);
      plan = { records: res.records.map(r => ({ ...r, runId })), executed: res.executed, strippedLineups: res.strippedLineups, tgw: res.tgw };
      await runRef.update({ status: 'applying', plan });
    }
    const { applied, dropped, landed } = await applyWindowPlan(league, runId, plan, state, eng, ctx);
    const executed = landed.map(r => ({ mid: r.managerId, in: r.inId, out: r.outId }));
    // strip only landed outs, from the CURRENT lineup, transactionally
    const landedOuts = {};
    for (const r of landed) (landedOuts[r.managerId] = landedOuts[r.managerId] || []).push(r.outId);
    for (const [mid, outs] of Object.entries(landedOuts)) {
      await db().ref(`${base}/public/lineups/${mid}/${plan.tgw}`).transaction(cur => {
        if (cur == null) return;
        return toArr(cur).filter(id => !outs.includes(id));
      });
    }
    // one desk, one run: every list is consumed wholesale (there is no next
    // run for a leftover line to roll to), the leftovers unlock into the
    // Trough via a fresh snapshot, and waiverMeta is NEVER touched — that is
    // Marc's "will not impact the waiver order", held by construction.
    const mem = (await db().ref(`${base}/server/membership`).get()).val() || {};
    const upd = {};
    for (const uid of Object.keys(mem)) upd[`${base}/private/${uid}/windowClaims`] = null;
    upd[`${base}/public/draftPool`] = { at: Date.now(), ids: Object.fromEntries(ctx.PLAYERS.map(p => [p.id, p.club])) };
    upd[`${base}/server/waiverRuns/${runId}/status`] = 'done';
    upd[`${base}/server/waiverRuns/${runId}/finishedAt`] = Date.now();
    upd[`${base}/server/waiverRuns/${runId}/executed`] = executed;
    upd[`${base}/server/waiverRuns/${runId}/applied`] = applied;
    upd[`${base}/server/waiverRuns/${runId}/dropped`] = dropped;
    await db().ref().update(upd);
    return { executed };
  } catch (e) {
    await runRef.update({ status: 'failed', error: String(e.message || e), finishedAt: Date.now() }).catch(() => {});
    throw e;
  }
}

ACTIONS.windowWaiverRun = async ({ league, a, data }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  return runWindowWaiver(league, data.runId ? `window-${cleanText(data.runId, 40)}` : `window-manual-${Date.now()}`, `manual:${a.uid}`);
};

/* ----- reset / import (the nuclear desk) ----- */
// the 12, as they appear in the client's freshState — the fallback roster when
// a reset finds no managers to carry over
const DEFAULT_ROSTER = [
  { id: 1, name: 'Ben Polak', team: 'The Dog’s Polaks' },
  { id: 2, name: 'Toby Levy', team: 'Chairman Mao *°' },
  { id: 3, name: 'Ben Levy', team: 'Atlético Benfield' },
  { id: 4, name: 'Adam Jackson', team: 'Interjacksonale*' },
  { id: 5, name: 'Ian Tussie', team: 'Champagne Khusanova FC' },
  { id: 6, name: 'Alex Singer', team: 'Singer’s Spartans' },
  { id: 7, name: 'Ric Blank', team: 'Asterick' },
  { id: 8, name: 'Marc Conway', team: '101011101' },
  { id: 9, name: 'Alex Duckett', team: 'Mighty 🦆 *' },
  { id: 10, name: 'Lee Warner', team: 'Celta Leigh-Go' },
  { id: 11, name: 'Daniel Geller', team: 'Geldog FC' },
  { id: 12, name: 'Wilko Wilkowski', team: 'WA Wanderers' },
];
const DEFAULT_SETTINGS = () => ({
  ...fixedSquadSettings(),
  pickTimer: 30,
  scoring: { ...Engine.DEFAULT_SCORING },
});
function canonicalSetupState(prevPub) {
  const prev = prevPub || {};
  const managers = toArr(prev.managers).length ? toArr(prev.managers) : DEFAULT_ROSTER;
  // carry the Committee's settings through a reset when they are still sane
  let settings = DEFAULT_SETTINGS();
  if (prev.settings) {
    const cand = {
      ...DEFAULT_SETTINGS(),
      ...prev.settings,
      scoring: { ...Engine.DEFAULT_SCORING, ...(prev.settings.scoring || {}) },
    };
    settings = { ...cand, ...fixedSquadSettings() };
  }
  const out = {
    phase: 'setup',
    managers,
    settings,
    waiverMeta: { lastRun: null, control: 'auto' },
  };
  // the Suggestion Box survives a reset — feature requests are ABOUT the
  // game, not part of it, and a sandbox test night must not eat them
  if (toArr(prev.suggestions).length) out.suggestions = toArr(prev.suggestions);
  return out;
}

/* The empty live league: founders arrive to found clubs and mark ready before
 * the Chairman has ever pressed anything, but every stateful action refuses on
 * a null /public (sol club-office P0.1). Setup-phase actions therefore seed
 * the canonical setup state first — idempotent: the txn only writes when the
 * node is truly absent. If the node exists (or a concurrent seed wins), the
 * retry pass sees real data and aborts without touching it. */
async function ensureSetupState(league) {
  const ref = db().ref(`${leagueBase(league)}/public`);
  if ((await ref.get()).exists()) return false;
  const res = await ref.transaction(cur => cur === null ? canonicalSetupState(null) : undefined);
  return res.committed;
}
// the actions a founder (or the Chairman starting the draft) may fire against
// a never-initialised league — each seeds setup state on the way in.
// settingsSet is here for the Chairman's pre-draft Settings page (sol r2 P1).
const SETUP_SEED_ACTIONS = new Set(['clubSet', 'readySet', 'stadiumSet', 'settingsSet']);

/* A confirmed reset atomically installs a valid setup-state, clears private
 * game data (claims/autolists) and the waiver run log, preserves membership,
 * and leaves the commissioner able to start a new draft immediately. */
/* ----- the Suggestion Box (Ben, 9 Aug: "a feature request section for
 * people playing the game") — any manager may submit; the Committee sets
 * status or bins. Lives in public/suggestions; survives resets. ----- */
ACTIONS.suggestionAdd = async ({ league, a, data, state }) => {
  const text = String(data.text || '').trim().slice(0, 240);
  if (!text) throw new HttpsError('invalid-argument', 'say what you want built');
  const rec = { id: `s${Date.now()}m${a.managerId}`, by: a.managerId, text, t: Date.now(), status: 'noted' };
  // cap and cooldown are enforced INSIDE the transaction: on contention the
  // fn re-runs against the committed array, so three managers hitting a
  // 199-deep box can't all land (sol R2 P3 — the pre-txn check raced)
  let deny = null;
  const res = await db().ref(`${leagueBase(league)}/public/suggestions`).transaction(seeded(state.suggestions, arr => {
    deny = null;
    if (arr.some(s => s.id === rec.id)) return arr;
    if (arr.length >= 200) { deny = { code: 'resource-exhausted', msg: 'the box is full — the Committee must empty it first' }; return undefined; }
    const mine = arr.filter(s => s.by === a.managerId);
    const last = mine.length ? Math.max(...mine.map(s => s.t || 0)) : 0;
    if (Date.now() - last < 60e3) { deny = { code: 'resource-exhausted', msg: 'one suggestion a minute — quality over quantity' }; return undefined; }
    arr.push(rec);
    return arr;
  }));
  if (!res.committed) {
    if (deny) throw new HttpsError(deny.code, deny.msg);
    throw new HttpsError('aborted', 'the box moved — try again');
  }
  return { ok: true, id: rec.id };
};
ACTIONS.suggestionAdmin = async ({ league, a, data, state }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  const id = String(data.id || '');
  const op = String(data.op || '');
  if (!['noted', 'building', 'built', 'bin'].includes(op)) throw new HttpsError('invalid-argument', 'unknown ruling');
  const res = await db().ref(`${leagueBase(league)}/public/suggestions`).transaction(seeded(state.suggestions, arr => {
    const i = arr.findIndex(s => s.id === id);
    if (i < 0) return arr;
    if (op === 'bin') arr.splice(i, 1);
    else arr[i] = { ...arr[i], status: op };
    return arr;
  }));
  if (!res.committed) throw new HttpsError('aborted', 'the box moved — try again');
  return { ok: true };
};

ACTIONS.resetLeague = async ({ league, a, data }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  if (data.confirm !== 'RESET') throw new HttpsError('failed-precondition', 'type RESET to confirm');
  const base = leagueBase(league);
  const prevPub = (await db().ref(`${base}/public`).get()).val();
  const prevPriv = (await db().ref(`${base}/private`).get()).val();
  const update = {
    [`${base}/public`]: canonicalSetupState(prevPub),
    [`${base}/private`]: null,
    [`${base}/server/waiverRuns`]: null,
  };
  // the outgoing game is STASHED, not destroyed (Ben: "preserve data for a
  // bit even if we reset") — one reset's worth of regret insurance under the
  // admin-only server subtree. The NEXT reset overwrites it; the hourly CI
  // backups are the deeper archive.
  if (prevPub) update[`${base}/server/resetStash`] = { t: Date.now(), by: a.managerId, public: prevPub, private: prevPriv || null };
  await db().ref().update(update);
  return { ok: true, stashed: !!prevPub };
};

// the other half of the stash: peek at what's held, or put it all back.
// Restoring replaces the ENTIRE current game (public + private); the stash
// itself survives a restore, so a mistaken restore can simply be reset again.
ACTIONS.resetRestore = async ({ league, a, data }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  const base = leagueBase(league);
  const stash = (await db().ref(`${base}/server/resetStash`).get()).val();
  if (!stash || !stash.public) throw new HttpsError('failed-precondition', 'no game is held from before a reset');
  if (data.peek) return { ok: true, t: stash.t, by: stash.by, phase: stash.public.phase || 'setup' };
  if (data.confirm !== 'RESTORE') throw new HttpsError('failed-precondition', 'type RESTORE to confirm');
  await db().ref().update({
    [`${base}/public`]: stash.public,
    [`${base}/private`]: stash.private || null,
  });
  return { ok: true, t: stash.t };
};

/* importState is the commissioner's restore path (empty-cloud seed / file
 * import) — strict allowed-key schema, typed sections, hard size cap. */
const IMPORT_ALLOWED = new Set([
  'phase', 'managers', 'settings', 'draft', 'lineups', 'transfers', 'trades',
  'covenants', 'waiverMeta', 'adjustments', 'shirtNums', 'draftPool',
  'windowDraft', 'tradeBlock', 'benchOrders', 'lobus', 'hamCup',
  'claims', 'autolists', 'watchlists',
]);
// legacy-export debris: silently dropped, never imported ('mock' = the
// sandbox Simulation Chamber flag — a pretend matchday must never ride an
// import into a league)
const IMPORT_DROPPED = new Set(['pins', 'matchStats', 'fixtures', 'lastSync', 'view', 'feedGenerated', 'ready', 'mock', 'heckles', 'suggestions', 'liveStats']);
const isPlainObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
function importError(msg) { throw new HttpsError('invalid-argument', `not a valid league export: ${msg}`); }

// shared by importState and draftAdmin:start — one definition of what a
// settings section may contain. Mutates sIn only to drop retired scoring keys
// (pre-Jul-2026 exports carry the 60-minute appearance keys; tolerated, never
// imported). Returns the fully-defaulted candidate.
function cleanSettingsSection(sIn) {
  if (!isPlainObj(sIn)) importError('settings');
  for (const k of Object.keys(sIn)) {
    if (!['squadSize', 'posMin', 'posMax', 'pickTimer', 'scoring', 'lobusBonus'].includes(k)) importError(`settings key "${k}"`);
  }
  const cand = { ...DEFAULT_SETTINGS(), ...sIn, ...fixedSquadSettings() };
  if (sIn.scoring != null) {
    if (!isPlainObj(sIn.scoring)) importError('scoring');
    for (const [k, v] of Object.entries(sIn.scoring)) {
      if (k === 'appearance' || k === 'appearance60') { delete sIn.scoring[k]; continue; }
      if (!(k in Engine.DEFAULT_SCORING) || typeof v !== 'number' || !Number.isFinite(v)) importError(`scoring "${k}"`);
    }
    cand.scoring = { ...Engine.DEFAULT_SCORING, ...sIn.scoring };
  }
  return cand;
}

/* start-time settings PATCH: only the keys actually supplied are validated
 * and returned — filling omissions from defaults here would silently reset
 * committed rules on start (sol club-office r2 P2). The full-import path
 * keeps cleanSettingsSection; squad-shape legality of a patch is judged
 * inside the start txn against the settings it merges onto. */
function cleanSettingsPatch(sIn) {
  if (!isPlainObj(sIn)) importError('settings');
  const out = {};
  for (const k of Object.keys(sIn)) {
    if (!['squadSize', 'posMin', 'posMax', 'pickTimer', 'scoring', 'lobusBonus'].includes(k)) importError(`settings key "${k}"`);
  }
  for (const k of ['pickTimer', 'lobusBonus']) {
    if (sIn[k] !== undefined) {
      if (typeof sIn[k] !== 'number' || !Number.isFinite(sIn[k])) importError(`settings "${k}"`);
      out[k] = sIn[k];
    }
  }
  if (sIn.scoring !== undefined) {
    if (!isPlainObj(sIn.scoring)) importError('scoring');
    const sc = {};
    for (const [k, v] of Object.entries(sIn.scoring)) {
      if (k === 'appearance' || k === 'appearance60') continue; // retired keys, dropped
      if (!(k in Engine.DEFAULT_SCORING) || typeof v !== 'number' || !Number.isFinite(v)) importError(`scoring "${k}"`);
      sc[k] = v;
    }
    out.scoring = sc;
  }
  return out;
}

ACTIONS.importState = async ({ league, a, data, ctx }) => {
  if (!isCommish(a)) throw new HttpsError('permission-denied', 'Chairman only');
  const s = data.state;
  if (!isPlainObj(s)) importError('not an object');
  const bytes = Buffer.byteLength(JSON.stringify(s), 'utf8');
  if (bytes > 4 * 1024 * 1024) importError(`too large (${bytes} bytes)`);
  for (const k of Object.keys(s)) {
    if (!IMPORT_ALLOWED.has(k) && !IMPORT_DROPPED.has(k)) importError(`unknown key "${k}"`);
  }
  if (!['setup', 'draft', 'season'].includes(s.phase)) importError('bad phase');
  const managers = toArr(s.managers);
  if (managers.length < 2 || managers.length > 20) importError('managers');
  const midSeen = new Set();
  for (const m of managers) {
    if (!isPlainObj(m) || !Number.isInteger(m.id) || m.id < 1 || m.id > 99 || midSeen.has(m.id)) importError('manager entry');
    midSeen.add(m.id);
    // club identity fields travel with the manager — a backup taken after a
    // founding must restore, and the pre-draft start once exported them too
    // (sol club-office P0.2: rejecting "boards" here wedged the draft start)
    // 'crest' was missing from this list while the block below validated it —
    // backups taken after a College of Arms visit refused to restore (sol P2, 14 Aug)
    for (const k of Object.keys(m)) if (!['id', 'name', 'team', 'stadium', 'kit', 'sponsor', 'rival', 'rivals', 'gaffer', 'assistant', 'boards', 'crest'].includes(k)) importError(`manager key "${k}"`);
    if (typeof m.name !== 'string' || m.name.length > 60) importError('manager name');
    if (typeof m.team !== 'string' || m.team.length > 80) importError('manager team');
    // stadium shares the office's 40-char contract; old longer backups are
    // clamped rather than refused (a restore must not fail on cosmetics)
    if (m.stadium != null) {
      if (typeof m.stadium !== 'string') importError('manager stadium');
      m.stadium = cleanText(m.stadium, 40).trim() || null;
    }
    if (m.sponsor != null && (typeof m.sponsor !== 'string' || !m.sponsor.length || m.sponsor.length > 20)) importError('manager sponsor');
    // kit/gaffer/boards reuse the clubSet validators — same bounds, same shapes
    if (m.kit != null) m.kit = cleanKit(m.kit);
    if (m.gaffer != null) m.gaffer = cleanGaffer(m.gaffer);
    if (m.assistant != null) m.assistant = cleanAssistant(m.assistant);
    if (m.boards != null) m.boards = cleanBoards(m.boards);
    if (m.crest != null) m.crest = cleanCrest(m.crest);
  }
  for (const m of managers) {
    if (m.rival != null && (!midSeen.has(m.rival) || m.rival === m.id)) importError('manager rival');
    if (m.rivals != null) {
      m.rivals = toArr(m.rivals).map(Number);
      if (m.rivals.length > 3 || new Set(m.rivals).size !== m.rivals.length
        || m.rivals.some(r => !midSeen.has(r) || r === m.id)) importError('manager rivals');
    }
  }
  if (s.settings != null) s.settings = cleanSettingsSection(s.settings);
  const arrayCaps = { transfers: 5000, trades: 1000, covenants: 500 };
  for (const [k, cap] of Object.entries(arrayCaps)) {
    if (s[k] != null && toArr(s[k]).length > cap) importError(`${k} too long`);
    if (s[k] != null && toArr(s[k]).some(x => x != null && !isPlainObj(x))) importError(`${k} entries`);
  }
  // RTDB coerces a gw-keyed map whose keys are 0,1,2… into an ARRAY, and an
  // exported file carries that shape back (sol R2 P2) — canonicalise, don't refuse
  for (const k of ['adjustments', 'claims', 'watchlists']) {
    if (Array.isArray(s[k])) s[k] = Object.fromEntries(s[k].map((v, i) => [i, v]).filter(([, v]) => v != null));
  }
  for (const k of ['lineups', 'benchOrders', 'shirtNums', 'tradeBlock', 'lobus', 'adjustments', 'claims', 'autolists', 'watchlists']) {
    if (s[k] != null && !isPlainObj(s[k])) importError(k);
    if (s[k] != null && Object.keys(s[k]).length > 200) importError(`${k} too large`);
  }
  if (s.draft != null && !isPlainObj(s.draft)) importError('draft');
  if (s.draft?.picks != null && toArr(s.draft.picks).length > 500) importError('draft picks');

  // Restoring a pre-pick draft must not be an escape hatch around the shared
  // ceremony barrier. A restore creates a new room session, so everybody
  // acknowledges again—even if the file claimed all managers were through.
  if (s.phase === 'draft' && s.draft && !toArr(s.draft.picks).length) {
    s.draft.ceremonyReady = {};
    s.draft.deadline = null;
  }

  const base = leagueBase(league);
  const pub = {};
  for (const k of Object.keys(s)) {
    if (IMPORT_ALLOWED.has(k) && k !== 'claims' && k !== 'autolists' && k !== 'watchlists') pub[k] = s[k];
  }
  const upd = { [`${base}/public`]: pub };
  const mem = (await db().ref(`${base}/server/managerUid`).get()).val() || {};
  // the private tree is REPLACED wholesale, not merged: a restore that carries
  // no claims must also delete the claims already there, or a stale claim
  // survives the restore and fires at the next waiver run
  const priv = {};
  for (const [g, byMid] of Object.entries(s.claims || {})) {
    if (!/^\d{1,2}$/.test(g)) importError(`claims bucket "${g}"`);
    for (const [mid, arr] of Object.entries(byMid || {})) {
      const list = toArr(arr);
      if (list.length > 30) importError('claims bucket too long');
      const uid = mem[mid];
      if (uid) ((priv[uid] = priv[uid] || {}).claims = priv[uid].claims || {})[g] = list;
    }
  }
  for (const [mid, arr] of Object.entries(s.autolists || {})) {
    const list = toArr(arr);
    if (list.length > 300) importError('autolist too long');
    const uid = mem[mid];
    if (uid) (priv[uid] = priv[uid] || {}).autolist = list;
  }
  // watchlists ride the same private rails as autolists: a restore keeps each
  // manager's lens, and no manager's watchlist ever lands in public state
  for (const [mid, arr] of Object.entries(s.watchlists || {})) {
    const midN = Number(mid);
    if (!Number.isInteger(midN) || !midSeen.has(midN)) importError(`watchlist manager "${mid}"`);
    if (!Array.isArray(arr) && !isPlainObj(arr)) importError('watchlist entries');
    const list = toArr(arr).map(Number);
    if (list.length > 300) importError('watchlist too long');
    if (list.some(id => !Number.isInteger(id) || !ctx.PLAYER_BY_ID[id])) importError('watchlist names an unknown player');
    if (new Set(list).size !== list.length) importError('watchlist repeats a player');
    const uid = mem[mid];
    // A restore is all-or-nothing. Silently dropping private data because the
    // membership index is incomplete is worse than refusing the backup: the
    // Chairman gets a clean error and can repair provisioning first.
    if (list.length && !uid) importError(`watchlist manager "${mid}" has no uid`);
    if (uid) (priv[uid] = priv[uid] || {}).watchlist = list;
  }
  upd[`${base}/private`] = Object.keys(priv).length ? priv : null;
  await db().ref().update(upd);
  return { ok: true };
};

/* ---------------- sign-in link delivery (EMAIL-FALLBACK-DESIGN.md) ----------------
 * Firebase's default mail relay never delivers for this project, so the server
 * generates the standard sign-in link and emails it itself. UNAUTHENTICATED by
 * necessity (nobody has an identity before signing in), so it trusts nothing:
 * the email is normalised and looked up, the uid must hold CURRENT membership,
 * and every path — member, unknown, revoked, throttled, duplicate, provider
 * failure — returns the same generic response on the same timing floor. The
 * response never reveals whether an address is registered. */
const MAIL_API = process.env.MAIL_API_URL || 'smtp'; // 'smtp' = Gmail; a URL = the emulator test stub
const MAIL_SENDER = process.env.MAIL_SENDER || 'benmpolak@googlemail.com';
const GENERIC = { ok: true, message: 'If that address belongs to a manager, a sign-in link is on its way.' };
const RESPONSE_FLOOR_MS = 900;
const sha256 = s => require('crypto').createHash('sha256').update(s).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normaliseEmail(raw) {
  if (typeof raw !== 'string') return null;
  const e = raw.normalize('NFC').trim().toLowerCase();
  if (e.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e)) return null;
  return e;
}
/* sliding-window limiter on hashed buckets — the store never holds an address
 * or an IP, only sha256 hashes and timestamps (self-pruning at 24h) */
async function overLimit(kind, hash, windows) {
  const ref = db().ref(`v2/mailGuard/${kind}/${hash}`);
  let over = false;
  const res = await ref.transaction(cur => {
    const now = Date.now();
    const arr = toArr(cur).filter(t => typeof t === 'number' && now - t < 24 * 3600e3);
    over = windows.some(w => arr.filter(t => now - t < w.ms).length >= w.max);
    if (over) return; // abort: no write needed
    arr.push(now);
    return arr.slice(-60);
  });
  void res; // outcome is carried by `over`, decided on the txn's final attempt
  return over;
}
// duplicate suppression: first caller of an idempotency key within 10 min wins
async function idemFresh(idemHash) {
  const res = await db().ref(`v2/mailGuard/idem/${idemHash}`).transaction(cur =>
    (cur && Date.now() - cur < 10 * 60e3) ? undefined : Date.now());
  return res.committed;
}
const MAIL_TEXT = link => 'Sign in to The League:\n\n' + link + '\n\nThe link is single-use and only works for this email address. If you didn’t ask for it, ignore this.\n\n— The Committee';
// the raw URL appears as copyable text as well as a link: tapping the link
// opens the DEFAULT browser, which is the wrong place when you're signing in
// from another browser or the installed app — those need the site's
// paste-the-link box, and you can't paste what you can't copy (Ben, 2 Aug)
const MAIL_HTML = link => '<p>Sign in to The League.</p>'
  + '<p><b>Same browser?</b> Just tap: <a href="' + link + '">Open The League</a></p>'
  + '<p><b>Different browser or the installed app?</b> Copy the whole link below and paste it into the sign-in box on the site:</p>'
  + '<p style="word-break:break-all;font-family:monospace;font-size:12px;background:#f2f2f2;padding:10px;border-radius:6px">' + link + '</p>'
  + '<p style="color:#666">The link is single-use and only works for this email address. If you didn’t ask for it, ignore this.</p><p>— The Committee</p>';

/* Delivery: Gmail SMTP with an app password (no third-party account needed —
 * the league writes from the Chairman's own address). The emulator suites set
 * MAIL_API_URL and exercise the guard logic through an HTTP stub instead; the
 * SMTP leg itself is verified live after deploy. */
async function deliverLink(email, link) {
  if (MAIL_API !== 'smtp') { // test stub path (emulator only)
    const r = await fetch(MAIL_API, {
      method: 'POST',
      headers: { 'api-key': process.env.GMAIL_APP_PASSWORD || '', 'content-type': 'application/json' },
      body: JSON.stringify({ sender: { email: MAIL_SENDER }, to: [{ email }], subject: 'Your sign-in link for The League', textContent: MAIL_TEXT(link), htmlContent: MAIL_HTML(link) }),
    });
    if (!r.ok) throw new Error('mail api ' + r.status);
    return (await r.json().catch(() => ({}))).messageId || 'sent';
  }
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!pass) throw new Error('mail credential not configured');
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: MAIL_SENDER, pass },
  });
  const info = await transport.sendMail({
    from: `"The League" <${MAIL_SENDER}>`,
    to: email,
    subject: 'Your sign-in link for The League',
    text: MAIL_TEXT(link),
    html: MAIL_HTML(link),
  });
  return info.messageId || 'sent';
}
async function deliverWithRetries(email, link) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await deliverLink(email, link); } catch (e) { lastErr = e; }
    if (attempt < 2) await sleep(300 + Math.floor(Math.random() * 400));
  }
  throw lastErr;
}

exports.requestSignInLink = onCall({
  secrets: ['GMAIL_APP_PASSWORD'],
  enforceAppCheck: process.env.ENFORCE_APPCHECK === 'true', // flip at the App Check step
}, async req => {
  const t0 = Date.now();
  // single exit: every outcome converges here onto the same response + floor
  const finish = async (outcome, extra = {}) => {
    console.log(JSON.stringify({ evt: 'signin_link', out: outcome, ...extra })); // hashes only, never addresses/links/IPs
    await sleep(Math.max(0, RESPONSE_FLOOR_MS - (Date.now() - t0)));
    return { ...GENERIC };
  };
  try {
    const { league } = req.data || {};
    if (!LEAGUES.includes(league)) return finish('suppressed', { why: 'league' });
    const email = normaliseEmail((req.data || {}).email);
    if (!email) return finish('suppressed', { why: 'shape' });
    const eh = sha256(email);
    const idemRaw = String((req.data || {}).idempotencyKey || '');
    const idemHash = idemRaw ? sha256(idemRaw) : null;
    const ip = req.rawRequest?.ip || req.rawRequest?.headers?.['x-forwarded-for'] || 'unknown';
    const ih = sha256(String(ip));
    if (await overLimit('email', eh, [{ ms: 15 * 60e3, max: 3 }, { ms: 24 * 3600e3, max: 10 }])) return finish('limited', { eh: eh.slice(0, 8) });
    if (await overLimit('ip', ih, [{ ms: 15 * 60e3, max: 10 }])) return finish('limited', { ih: ih.slice(0, 8) });
    if (idemHash && !(await idemFresh(idemHash))) return finish('duplicate', { idem: idemHash.slice(0, 8) });
    let uid = null;
    try { uid = (await admin.auth().getUserByEmail(email)).uid; } catch { /* unknown address */ }
    if (!uid) return finish('suppressed', { eh: eh.slice(0, 8) });
    const m = (await db().ref(`${leagueBase(league)}/server/membership/${uid}`).get()).val();
    if (!m || !Number.isInteger(m.managerId)) return finish('suppressed', { eh: eh.slice(0, 8) });
    const link = await admin.auth().generateSignInWithEmailLink(email, {
      url: league.endsWith('sandbox') ? 'https://benmpolak.github.io/the-league-beta/?sandbox' : 'https://theleaguehq.co.uk/',
      handleCodeInApp: true,
    });
    try {
      const mid = await deliverWithRetries(email, link);
      return finish('sent', { eh: eh.slice(0, 8), rid: String(mid).slice(0, 24) });
    } catch (e) {
      return finish('provider_error', { eh: eh.slice(0, 8), err: String(e.message || e).slice(0, 60) });
    }
  } catch (e) {
    return finish('provider_error', { err: String(e.message || e).slice(0, 60) });
  }
});

/* ---------------- entry points ---------------- */
exports.ping = onCall(req => ({ ok: true, uid: req.auth?.uid || null }));

exports.mutate = onCall(async req => {
  const { league, action, data = {} } = req.data || {};
  if (!isPlainObj(data)) throw new HttpsError('invalid-argument', 'bad data');
  const fn = ACTIONS[action];
  if (!fn) throw new HttpsError('invalid-argument', `unknown action ${action}`);
  const a = await actor(req, league);
  const ctx = await loadCtx();
  const needsState = !['autolistSet', 'adjustmentSet', 'waiverRunNow', 'windowWaiverRun', 'resetLeague', 'importState'].includes(action);
  // a never-initialised league accepts setup actions by seeding itself first
  if (SETUP_SEED_ACTIONS.has(action) || (action === 'draftAdmin' && data.op === 'start')) await ensureSetupState(league);
  const state = needsState ? await loadState(league, ctx) : null;
  return fn({ league, a, data, ctx, state, eng: ctx.eng });
});

// Hourly tick; the ENGINE decides which fixture-anchored runs are due
// (post-run 8pm London the day after a gameweek's last fixture, pre-run 8pm
// the day before the next one's first). Run ids are deterministic per window
// slot, so the run ledger makes each exactly-once — and a retry hitting a
// live lease gets an error, not a hollow success.
exports.waiverTick = onSchedule({ schedule: '7 * * * *', timeZone: 'Etc/UTC', retryCount: 3 }, async () => {
  const ctx = await loadCtx();
  const due = ctx.eng.waiverSchedule();
  const errs = [];
  for (const d of due) {
    await runWaivers('the-league-2627', `sched-${d.id}`, 'schedule').catch(e => {
      errs.push(d.id + ': ' + String(e.message || e).slice(0, 80));
    });
  }
  // the one-off Window Waiver (Marc, 30 Aug): Thu 3 Sept 10:00 London. The
  // deterministic id and the run ledger make it exactly-once; the 14-day tail
  // lets a scheduler outage on the morning still deliver it late rather than
  // never. Once done, every later tick returns 'already processed' for pence.
  if (Date.now() >= WINDOW_WAIVER_AT && Date.now() - WINDOW_WAIVER_AT < 14 * 864e5) {
    await runWindowWaiver('the-league-2627', WINDOW_WAIVER_SLOT, 'schedule').catch(e => {
      errs.push('window: ' + String(e.message || e).slice(0, 80));
    });
  }
  // freeze any drawn Ham Cup whose selection window has opened (idempotent —
  // the hourly tick pins the pool within the hour; a first entry would pin it
  // lazily anyway, this just makes the snapshot moment predictable)
  for (const lg of LEAGUES) {
    try {
      const st = await loadState(lg, ctx).catch(() => null);
      const cup = st && st.hamCup;
      if (!cup || cup.status === 'off' || !cup.gw || Array.isArray(cup.frozen)) continue;
      if (ctx.eng.gwHasStarted(cup.gw)) continue; // entries locked anyway
      const opensAt = hamOpensAt(cup, ctx.eng);
      if (opensAt == null || Date.now() < opensAt) continue;
      const ownedNow = [...ctx.eng.ownedIdsAt(st, ctx.eng.currentGwIndex())];
      await db().ref(`${leagueBase(lg)}/public/hamCup`).transaction(seededObj(cup, c => {
        if (!c || c.status === 'off' || c.gw !== cup.gw || Array.isArray(c.frozen)) return;
        c.frozen = ownedNow;
        return c;
      }));
    } catch (e) {
      errs.push('hamfreeze-' + lg + ': ' + String(e.message || e).slice(0, 80));
    }
  }
  if (errs.length) throw new Error('waiverTick failures — ' + errs.join(' | ')); // real errors must reach the Scheduler's retry
});

/* ---------------- live-match fast lane (Ben, GW1 night) ----------------
 * GitHub's scheduled workflow fired every 25-35 minutes on GW1 night, so the
 * lads watched a match with no scores. Cloud Scheduler has been punctual for
 * waiverTick since launch, so `liveTick` (every minute) becomes the primary
 * writer of public/liveStats; live.yml stays running as an independent
 * fallback (different infrastructure, different failure mode) and both
 * writers are idempotent last-write-wins over the same node. `liveRefresh`
 * lets a signed-in client that sees a stale overlay during a live match
 * request one immediate fetch-and-write, rate-limited per-uid AND globally.
 *
 * DISPLAY-ONLY — the safety property sol has now cleared three times: no
 * scoring, settlement or waiver logic consumes liveStats. Settlement, H2H
 * and the engine read only the canonical Pages feed. Precisely (sol, 22 Aug):
 * this block's league-state output is the single node
 * v2/leagues/the-league-2627/public/liveStats; liveRefresh additionally
 * writes its fixed, hashed rate-limit buckets under v2/mailGuard; and
 * resetLeague's stash/restore copies the whole public tree byte-for-byte,
 * liveStats included, without ever interpreting it. */
const FPL_BASE = process.env.FPL_API_URL || 'https://fantasy.premierleague.com/api';
const LIVE_LEAGUE = 'the-league-2627'; // the sandbox fakes its own matchdays (the Chamber)
const liveRef = () => db().ref(`${leagueBase(LIVE_LEAGUE)}/public/liveStats`);
const LIVE_OPENS_EARLY_MS = 2 * 60e3;      // window opens 2 min before kickoff
const LIVE_WINDOW_MS = 3.5 * 3600e3;       // and is capped 3.5h after it

async function fetchFplJson(rel, label, maxBytes) {
  const r = await fetch(`${FPL_BASE}/${rel}`, { headers: { 'User-Agent': 'the-league/1.0' } });
  if (!r.ok) throw new Error(`${label} ${r.status}`);
  // enforce the cap WHILE streaming (sol P3, 22 Aug): buffering first meant a
  // hostile or broken endpoint could out-eat the function's memory before the
  // nominal cap ever ran. The overage aborts the read, not the process.
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      reader.cancel().catch(() => {});
      throw new Error(`${label}: oversized (> ${maxBytes} bytes)`);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return Feed.parseJson(text, label, maxBytes); // parsed as data only
}

/* Site fixtures give kickoff times, so the every-minute tick can answer "could
 * anything be live right now?" without touching the network on the quiet path.
 * The cache self-refreshes only when it can no longer answer that question. */
let _fxCache = null; // { at, fixtures }
const kickWindow = (f, now) => f && f.date && !f.finished
  && now >= Date.parse(f.date) - LIVE_OPENS_EARLY_MS
  && now <= Date.parse(f.date) + LIVE_WINDOW_MS;
async function liveFixtures(now) {
  const c = _fxCache;
  if (c && now - c.at < 6 * 3600e3) {
    if (c.fixtures.some(f => kickWindow(f, now))) return c.fixtures;
    // quiet, and the cache says the next kickoff hasn't arrived yet — trust it
    const opens = c.fixtures
      .filter(f => f && f.date && !f.finished)
      .map(f => Date.parse(f.date) - LIVE_OPENS_EARLY_MS)
      .filter(t => t > c.at);
    if (opens.length && now < Math.min(...opens)) return c.fixtures;
  }
  const raw = await fetchJson('data/fixtures.json', 'fixtures.json', Feed.LIMITS.dataBytes);
  const fixtures = Feed.validateFixtures(raw);
  _fxCache = { at: now, fixtures };
  return fixtures;
}

// FPL identifier -> our short key (same table as scripts/fetch_fpl.py — the
// two writers must produce byte-compatible rows or the overlay would flicker)
const LIVE_EXPLAIN_MAP = {
  minutes: 'min', goals_scored: 'g', assists: 'a',
  clean_sheets: 'cs', goals_conceded: 'gc', own_goals: 'og',
  penalties_saved: 'ps', penalties_missed: 'pm',
  yellow_cards: 'yc', red_cards: 'rc', saves: 'sv',
};
function liveRows(elements) {
  const out = {};
  for (const el of toArr(elements)) {
    if (!el || !Number.isInteger(el.id)) continue;
    const s = el.stats || {};
    const num = k => Number.isFinite(s[k]) ? s[k] : 0;
    const min = num('minutes');
    if (min === 0 && !num('yellow_cards') && !num('red_cards')) continue;
    const started = Number.isFinite(s.starts) ? s.starts : (min >= 60 ? 1 : 0);
    const row = {
      min, st: Math.trunc(started), sub: (min > 0 && !started) ? 1 : 0,
      g: num('goals_scored'), a: num('assists'), cs: num('clean_sheets'),
      gc: num('goals_conceded'), og: num('own_goals'), ps: num('penalties_saved'),
      pm: num('penalties_missed'), yc: num('yellow_cards'), rc: num('red_cards'),
      sv: num('saves'),
    };
    // double gameweek: store per-fixture rows so the client scores match-by-match
    const explain = Array.isArray(el.explain) ? el.explain : [];
    if (explain.length >= 2) {
      row.fx = explain.slice(0, Feed.LIMITS.fixturesPerPlayer).map(ex => {
        const fs = { min: 0, g: 0, a: 0, cs: 0, gc: 0, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0 };
        for (const st of toArr(ex && ex.stats)) {
          const k = LIVE_EXPLAIN_MAP[st && st.identifier];
          if (k && Number.isFinite(st.value)) fs[k] = st.value;
        }
        return fs;
      });
    }
    out[el.id] = row;
    if (Object.keys(out).length > Feed.LIMITS.statPlayersPerGw) throw new Error('fpl live: too many players');
  }
  return out;
}

// The overlay is NEVER deleted at the whistle. It used to be — "clear a
// leftover overlay once per quiet spell" — and on 28 Aug (Palace v City) that
// sent every phone BACKWARDS at full time: the moment FPL flagged the match
// finished, liveTick wiped the node and the clients fell back to the Pages
// feed, which GitHub's throttled cron had last committed at half-time (Toby,
// 23:05: "points had been updated and now gone backwards … to half time
// figures"). The last live write IS the full-time picture; it stays until a
// fresher canonical feed retires it — the client already prefers the feed
// whenever feedGenerated is newer than the overlay's stamp, and never
// repaints a settled round. The next round's kickoff overwrites it.

/* One idempotent fetch-and-write pass, shared by the scheduler tick and the
 * client-triggered refresh. Milliseconds on the quiet path: outside a kickoff
 * window it does at most one cached-fixtures check and stands down. */
async function pushLiveOnce() {
  const now = Date.now();
  const fixtures = await liveFixtures(now);
  const win = fixtures.filter(f => kickWindow(f, now));
  if (!win.length) return { live: false };
  // inside a window, FPL's own fixture flags decide what is ACTUALLY live
  let liveGw = null, gwFx = null;
  for (const gwN of [...new Set(win.map(f => f.gw).filter(Number.isInteger))]) {
    const fpl = toArr(await fetchFplJson(`fixtures/?event=${gwN}`, 'fpl fixtures', 2 * 1024 * 1024));
    if (fpl.some(f => f && f.started && !(f.finished || f.finished_provisional))) { liveGw = gwN; gwFx = fpl; break; }
  }
  if (liveGw == null) return { live: false };
  const live = await fetchFplJson(`event/${liveGw}/live/`, 'fpl live', Feed.LIMITS.statsBytes);
  const playerStats = liveRows(live && live.elements);
  // live fixture truth rides along: scores, minutes and the provisional
  // whistle reach clients within a minute instead of the Pages feed's ~15
  // (GW1 evening: finished matches sat "still to play" on the slow flag).
  // Compact allowlisted rows, matched client-side by FPL fixture id.
  const fx = gwFx.filter(f => f && Number.isInteger(f.id)).slice(0, 20).map(f => ({
    id: f.id,
    hs: Number.isFinite(f.team_h_score) ? f.team_h_score : null,
    as: Number.isFinite(f.team_a_score) ? f.team_a_score : null,
    started: !!f.started,
    fp: !!(f.finished_provisional || f.finished),
    min: Number.isFinite(f.minutes) ? Math.max(0, Math.min(120, f.minutes)) : 0,
  }));
  const t = Date.now();
  await liveRef().set({ n: liveGw, t, playerStats, fx });
  return { live: true, n: liveGw, t, players: Object.keys(playerStats).length };
}

// Layer 1 — primary. Every minute; Cloud Scheduler has been punctual where
// GitHub's cron was not. Errors are thrown so they reach the Scheduler's logs;
// the next minute's tick is the retry.
exports.liveTick = onSchedule({ schedule: '* * * * *', timeZone: 'Etc/UTC' }, async () => {
  const res = await pushLiveOnce();
  if (res.live) console.log(`liveTick: GW${res.n}, ${res.players} players`);
});

/* ---------------- the feed clock ----------------
 * GitHub's cron scheduler collapsed under this repo on 26–28 Aug: fpl.yml
 * asked for 288 runs on the 28th and got five, with six-hour holes. Every
 * failure that day came off it — Friday's waivers refusing a 368-minute-old
 * feed, the scoreboard hours behind, a Vidiprinter with nothing to derive
 * from. Cloud Scheduler has been punctual for waiverTick and liveTick since
 * launch, so the CLOCK moves here: every five minutes this tick decides
 * whether the feed is due and, if it is, fires a repository_dispatch that runs
 * fpl.yml. An event-triggered run queues within seconds where a cron tick is
 * a suggestion. The fetch-and-commit itself stays on GitHub — a function
 * cannot push to git, and the Pages feed is a committed file.
 *
 * Cadence: every tick inside a match window (confirmed team sheets land ~75
 * minutes before kickoff, provisional flags ~150 after), on the hour and half
 * hour otherwise. The hourly league backup rides the same clock at the top of
 * each hour, because backup.yml's cron was down to twice a day as well.
 *
 * Writes nothing to RTDB. Needs the GH_DISPATCH_TOKEN secret (Contents:
 * write on the repo); without it the tick logs and stands down. */
const GH_REPO = process.env.GH_DISPATCH_REPO || 'benmpolak/the-league';
const FEED_PRE_MS = 75 * 60e3, FEED_POST_MS = 150 * 60e3;
const feedWindow = (f, now) => f && f.date && !f.finished
  && now >= Date.parse(f.date) - FEED_PRE_MS
  && now <= Date.parse(f.date) + FEED_POST_MS;
async function ghDispatch(token, eventType) {
  const r = await fetch(`https://api.github.com/repos/${GH_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
      'user-agent': 'the-league/1.0', 'content-type': 'application/json',
    },
    body: JSON.stringify({ event_type: eventType }),
  });
  if (r.status !== 204) throw new Error(`github dispatch ${eventType}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}
function feedDue(fixtures, now) {
  const m = new Date(now).getUTCMinutes();
  const inWindow = fixtures.some(f => feedWindow(f, now));
  const events = [];
  if (inWindow || m < 5 || (m >= 30 && m < 35)) events.push('fpl-refresh');
  if (m < 5) events.push('league-backup');
  return { events, inWindow };
}
exports.feedTick = onSchedule({ schedule: '*/5 * * * *', timeZone: 'Etc/UTC', secrets: ['GH_DISPATCH_TOKEN'] }, async () => {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) { console.warn('feedTick: GH_DISPATCH_TOKEN is not set — nothing dispatched'); return; }
  const now = Date.now();
  const { events, inWindow } = feedDue(await liveFixtures(now), now);
  for (const ev of events) await ghDispatch(token, ev); // errors reach the Scheduler's logs; next tick retries
  console.log(`feedTick: ${events.join(', ') || 'quiet'}${inWindow ? ' (match window)' : ''}`);
});

// Layer 3 — self-healing. A signed-in manager whose client sees a live match
// with a stale overlay asks for one immediate pass. Limited per-uid AND
// globally (mailGuard sliding buckets): one healed write serves all twelve
// phones, so the caps are deliberately tight — a limited caller just waits.
exports.liveRefresh = onCall(async req => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'sign in first');
  await actor(req, LIVE_LEAGUE); // membership is the only authority
  if (await overLimit('lrUid', sha256(req.auth.uid), [{ ms: 10 * 60e3, max: 3 }])) return { ok: false, limited: true };
  if (await overLimit('lrAll', sha256('live-global'), [{ ms: 60e3, max: 2 }, { ms: 15 * 60e3, max: 8 }])) return { ok: false, limited: true };
  const res = await pushLiveOnce();
  return { ok: true, live: !!res.live, t: res.t || null, players: res.players || 0 };
});

/* emulator-only test hooks: the suites reset per-instance caches so one test
 * process can walk through window/no-window scenarios. Inert in production —
 * the DB-emulator gate covers the suites that require this module in-process. */
if (EMULATED || process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  exports._liveTest = {
    reset() { _fxCache = null; },
    pushLiveOnce,
    feedDue,
  };
}
