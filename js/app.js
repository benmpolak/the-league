/* ================= The League — 2026/27 ================= */
'use strict';

// ?sandbox → practice league: own Firebase node (see sync.js) + own device storage,
// so testing never touches the real league's cloud state or this phone's saved identity
const SANDBOX = new URLSearchParams(location.search).has('sandbox');
/* Leaving the sandbox means leaving THE SITE when you're on the beta host.
   the-league-beta is sandbox-only and hostguard.js puts ?sandbox straight back
   on any URL that lands there without it — so "Go to the real site" used to
   drop the query, get bounced by the guard, and deposit you back in the
   sandbox. That is the login loop (Marc, 13 Aug: "when I click on it, it just
   sends me back to the sandbox"). The real league lives one path over. */
const realSiteHref = () => (location.pathname.includes('the-league-beta')
  ? location.pathname.replace('the-league-beta', 'the-league')
  : location.pathname);
const LS_NS = SANDBOX ? 'tl2627sb' : 'tl2627';
const LS_KEY = `${LS_NS}-league`;

const TEAM_BY_NAME = Object.fromEntries(TEAMS.map(t => [t.name, t]));
const PLAYER_BY_ID = Object.fromEntries(PLAYERS.map(p => [p.id, p]));
/* stale-save guard: a saved game can outlive the player feed it was built on
   (FPL re-keys, half-written save). Unknown ids get a visible stub so every
   view still renders, and boot offers a reload instead of a blank screen. */
let staleSave = false;
function stubMissingPlayers(s) {
  if (!s) return false;
  const need = new Set();
  const arr = x => Array.isArray(x) ? x : x ? Object.values(x) : [];
  // ledger records carry the immutable FPL `code` (Desk §3b) — when an id has
  // shifted under us, the code names the real player, so the stub can at least
  // say WHO instead of "#579 (unknown)". Scoring still needs the id healed
  // (scripts/heal_ids.js); this is the read-side half.
  const codeFor = new Map();
  for (const pk of arr(s.draft?.picks)) if (pk?.playerId && !PLAYER_BY_ID[pk.playerId]) { need.add(pk.playerId); if (pk.code) codeFor.set(pk.playerId, pk.code); }
  for (const t of arr(s.transfers)) {
    if (t?.inId && !PLAYER_BY_ID[t.inId]) { need.add(t.inId); if (t.inCode) codeFor.set(t.inId, t.inCode); }
    if (t?.outId && !PLAYER_BY_ID[t.outId]) { need.add(t.outId); if (t.outCode) codeFor.set(t.outId, t.outCode); }
  }
  const byCode = Object.fromEntries(PLAYERS.map(p => [p.code, p]));
  for (const id of need) {
    const real = byCode[codeFor.get(id)];
    PLAYER_BY_ID[id] = real
      ? { ...real, id, name: `${real.name} (id moved)`, pts: 0, rating: 0, xp: 0 }
      : { id, code: 0, name: `#${id} (unknown)`, full: 'Unknown player — feed changed', team: '', club: '???', pos: 'MF', status: 'a', news: '', newsAdded: '', chance: null, price: 0, pts: 0, rating: 0, xp: 0, ppg: 0, mp: 0, g: 0, a: 0, cs: 0, xg: 0, xa: 0 };
  }
  return need.size > 0;
}
// the same warning, wherever the mismatch turns up — at load, or later from a
// snapshot the cloud sends while we're sitting here
function showStaleBar() {
  if (document.querySelector('.stale-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'stale-bar';
  bar.innerHTML = `<span>&#9888; This device's saved game doesn't match the current player feed — some players show as unknown.</span>
    <button class="btn small" id="staleReload">Reload latest draft</button>
    <button class="btn ghost small icon-btn" id="staleDismiss" aria-label="Dismiss">&#10005;</button>`;
  document.body.appendChild(bar);
  bar.querySelector('#staleDismiss').onclick = () => bar.remove();
  bar.querySelector('#staleReload').onclick = async () => {
    if (!await confirmSheet({
      title: 'Reload the latest draft?',
      body: `<p style="font-size:13.5px">This device's copy is thrown away and replaced by the league's latest saved state${netOn() ? ' from the cloud' : ''}. Your sign-in is kept.</p>`,
      yes: 'Reload',
    })) return;
    localStorage.removeItem(LS_KEY);
    location.reload();
  };
}

/* ---- last season's archive (js/history25.js) ----
   The FPL API zeroes every aggregate when it flips to 26/27 in July. The
   archive was taken first, keyed by the immutable player code — so the
   draft pool still sorts on real numbers on draft night. */
const LS_BY_CODE = (typeof LAST_SEASON !== 'undefined' && LAST_SEASON.byCode) || {};
const LS_SEASON = (typeof LAST_SEASON !== 'undefined' && LAST_SEASON.season) || 'last season';
const lastSeasonOf = p => LS_BY_CODE[p.code];
// has the API flipped and wiped? (a full season's totals sum to ~50k)
const FPL_WIPED = PLAYERS.reduce((t, p) => t + (p.pts || 0), 0) < 2000;
const POS_ORDER = { GK: 0, DF: 1, MF: 2, FW: 3 };
const POS_LABEL = { GK: 'Goalkeepers', DF: 'Defenders', MF: 'Midfielders', FW: 'Forwards' };
// how many players outrank you on last season's points — used for pundit judgement
// rank against the BOARD's rating (league currency) — the feed's own .rating
// field is FPL-flavoured and no longer the truth (Committee, UAT night)
const ratingRank = r => PLAYERS.filter(x => rating(x) > r).length;

// Our established scoring table: no bonus points and no defensive-contribution
// (DEFCON) points. Yes, a goalkeeper goal really is 10.
const DEFAULT_SCORING = {
  appearanceStart: 2,
  appearanceSub: 1,
  goalGK: 10, goalDF: 6, goalMF: 5, goalFW: 4,
  assist: 3,
  cleanSheet: 4,
  cleanSheetMF: 1,
  per3Saves: 0, // retired by the Chairman, 1 Aug 2026 — Marc liked it; overruled
  penSave: 5,
  penMiss: -3,
  yellow: -1,
  red: -5,
  ownGoal: -3,
  per2Conceded: -1,
};
const SCORING_LABELS = {
  appearanceStart: 'Appearance — started',
  appearanceSub: 'Appearance — came on as sub',
  goalGK: 'Goal — GK', goalDF: 'Goal — DF', goalMF: 'Goal — MF', goalFW: 'Goal — FW',
  assist: 'Assist',
  cleanSheet: 'Clean sheet — GK/DF',
  cleanSheetMF: 'Clean sheet — MF',
  per3Saves: 'Every 3 saves — GK',
  penSave: 'Penalty save',
  penMiss: 'Penalty miss',
  yellow: 'Yellow card',
  red: 'Red card',
  ownGoal: 'Own goal',
  per2Conceded: 'Every 2 conceded — GK/DF',
};
// starting XI shape
const XI_RULES = { size: 11, GK: [1, 1], DF: [3, 5], MF: [2, 5], FW: [1, 3] };
const SQUAD_RULES = { size: 14, min: { GK: 1, DF: 4, MF: 4, FW: 2 }, max: { GK: 2, DF: 6, MF: 6, FW: 4 } };
const applySquadRules = settings => Object.assign(settings, {
  squadSize: SQUAD_RULES.size,
  posMin: { ...SQUAD_RULES.min },
  posMax: { ...SQUAD_RULES.max },
});

/* ---------------- The Committee (est. 2015, minutes unavailable) ---------------- */
const COMMITTEE_QUOTES = [
  'The Committee notes this pick with interest.',
  'A solid pick. Your ROI per gameweek improves marginally.',
  'Noted, logged, and screenshotted for use against you in May.',
  'The waiting list — ten years deep — would have picked better.',
  'Conway says he doesn’t care (hate it).',
  'Singer says it’s only a game and doesn’t really matter BUT—',
  'Blanky reminds the room it’s all irrelevant post GW10.',
  'Lee asks why he wasn’t consulted. The fraternity remains democratic.',
  'Stick that one in your Monzo savings pot.',
  'The Committee has seen worse. The Committee has minutes proving it.',
  'The Trough opens at 11.03. Not 11.02. Standards matter.',
];
const committeeSays = () => `The Committee: “${COMMITTEE_QUOTES[Math.floor(Math.random() * COMMITTEE_QUOTES.length)]}”`;


/* ---------------- gameweeks ---------------- */
// Generated from the FPL API — a gameweek runs from its deadline to the next one's
const GAMEWEEKS = GAMEWEEKS_RAW.map(g => ({ n: g.n, label: g.label, from: g.deadline, to: g.to, finished: g.finished }));
const REGULAR_GWS = 33; // GW33 ends the regular season; GW34–38 are the playoffs
const CUP_START = 7;    // the Monzo Cup begins GW8 (index 7)
let demoGwOverride = null;
const gwFrom = i => GAMEWEEKS[i].from;
function currentGwIndex() {
  // The demo fabricates GW1. Keeping the real calendar here made the demo open
  // on GW38 with a blank pitch, which looked broken to a first-time visitor.
  if (demoGwOverride != null) return demoGwOverride;
  const now = Date.now();
  for (let i = 0; i < GAMEWEEKS.length; i++) if (now < new Date(GAMEWEEKS[i].to).getTime()) return i;
  return GAMEWEEKS.length - 1;
}
const gwIsOver = i => GAMEWEEKS[i].finished || Date.now() > new Date(GAMEWEEKS[i].to).getTime();
// >= so transferGw and currentGwIndex agree at the exact deadline millisecond
// (sol, priority round P3 — mirrors js/engine.js)
const gwHasStarted = i => Date.now() >= new Date(gwFrom(i)).getTime();
// which gameweek a transfer takes effect in: NEVER the one already being
// played. A Tuesday waiver run happens inside the just-finished GW's window,
// so its signings must count for the NEXT gameweek, or they'd retroactively
// rescore a settled result (the worst bug a 12-year league could have).
const transferGw = () => {
  const c = currentGwIndex();
  let g = c + (gwHasStarted(c) ? 1 : 0);
  // a Simulation Chamber matchday counts as PLAYED for as long as it's
  // mounted — even after its waiver run. The old lastWaiverRun carve-out let
  // post-run deals land back INSIDE the settled mock GW (real calendar says
  // GW1 hasn't started), retroactively rewriting scored squads — Toby's
  // 15-man, 3-keeper side on UAT night. Open/shut is troughWindow's business;
  // the landing gameweek never rolls back.
  const mk = state.mock;
  if (mk && mk.gw != null && GAMEWEEKS[mk.gw]) g = Math.max(g, mk.gw + 1);
  return Math.min(g, GAMEWEEKS.length - 1);
};
// stats for a gameweek land under key 'gw{n}' — no date-window matching needed
const gwEvent = i => state.matchStats[`gw${GAMEWEEKS[i].n}`];
// round robin (circle method): 11 unique rounds for 12 managers, repeated three times
function pairingsFor(i) {
  if (i >= REGULAR_GWS) return []; // playoffs — bracket handled separately
  const o = state.draft.order.length ? state.draft.order : state.managers.map(m => m.id);
  const n = o.length;
  if (n < 2) return [];
  const r = i % (n - 1);
  const rest = o.slice(1);
  const rot = rest.slice(r).concat(rest.slice(0, r));
  const line = [o[0], ...rot];
  const pairs = [];
  for (let k = 0; k < Math.floor(n / 2); k++) pairs.push([line[k], line[n - 1 - k]]);
  // first team = home; alternate by round so the three meetings split 2-1
  return i % 2 ? pairs.map(([a, b]) => [b, a]) : pairs;
}

/* ---------------- state ---------------- */
let state = load() || freshState();

/* ---------------- multiplayer (Firebase sync) ---------------- */
const SYNC_OFF = new URLSearchParams(location.search).has('nosync');
const WHO_KEY = `${LS_NS}-whoami`;
const SPECT_KEY = `${LS_NS}-spectate`;
// Online identity is unknown until Firebase Auth + the server-owned membership
// have both answered. Never paint an old PIN-era localStorage identity while
// those asynchronous reads are in flight: after the draft reordered managers,
// that startup fallback showed everybody Toby's club on the home page.
let whoami = SYNC_OFF ? (+localStorage.getItem(WHO_KEY) || null) : null; // manager id, -1 = spectator
let syncConnected = false;
let demoMode = false;
let demoBackup = null;
// sync is a matter of INTENT, not module presence: if sync.js failed to load
// (cold start on dead network, CDN hiccup) the game must be READ-ONLY —
// serverAct refuses while disconnected. Treating a load failure like ?nosync
// would accept local writes that silently vanish on the next real snapshot.
const syncOn = () => !SYNC_OFF;
const netOn = () => syncOn() && !demoMode;
// online identity comes from the server (Firebase sign-in + membership), never
// from localStorage — an old stored whoami grants nothing once auth is live
let authUser = null;      // {uid, email} | null
let membership = null;    // {managerId, role} | null
let authResolved = !syncOn();
let membershipResolved = !syncOn();
let spectating = localStorage.getItem(SPECT_KEY) === '1';
const identityLoading = () => netOn() && (!authResolved || (!!authUser && !membershipResolved));
function syncIdentity() {
  if (!netOn()) return;
  whoami = membership ? membership.managerId : (spectating ? -1 : null);
}
const isCommissioner = () => netOn() ? membership?.role === 'commissioner' : whoami === state.managers[0]?.id;
// the one write path when online: a server-side mutation. The authoritative
// result comes back via the snapshot listener; errors surface as toasts.
// Callable mutations travel over HTTPS, independently of RTDB's live socket.
// `.info/connected` can flap false on a phone while HTTPS is perfectly healthy;
// refusing here made an optimistic XI/waiver edit look saved, then disappear on
// the next snapshot (Ian + Marc, 28 Aug). Always TRY the callable and let its
// actual network result decide. One-shot actions still reject double taps;
// replace-style editors are serialised so rapid phone taps land in order and
// the last complete list/XI cannot be overtaken by an earlier request.
const _actPending = new Set();
const _serialActions = new Set(['claimSet', 'lineupSave', 'benchOrder', 'autolistSet', 'watchlistSet']);
const _actTails = new Map();
function serverAct(action, data = {}) {
  const refuse = msg => {
    toast(msg);
    const p = Promise.reject(new Error(msg));
    p.catch(() => {}); // pre-handled: call sites may not attach their own catch
    return p;
  };
  if (!window.WCSync?.call) return refuse('League connection is still starting — try again in a moment.');
  const dispatch = () => window.WCSync.call(action, data)
    .catch(e => { toast(e.message || 'That change did not save — try again.'); throw e; });
  if (_serialActions.has(action)) {
    const previous = _actTails.get(action) || Promise.resolve();
    const current = previous.catch(() => {}).then(dispatch);
    _actTails.set(action, current);
    const clear = () => { if (_actTails.get(action) === current) _actTails.delete(action); };
    current.then(clear, clear);
    return current;
  }
  if (_actPending.has(action)) return refuse('Still sending the last one — give it a second.');
  _actPending.add(action);
  return dispatch()
    .finally(() => _actPending.delete(action));
}
const canActFor = mid => demoMode || !syncOn() || whoami === mid || isCommissioner();
// use for actions: blocks other managers, and makes the commissioner explicitly
// confirm before touching a team that isn't theirs (no more accidents)
function actGuard(mid, what = 'team') {
  if (!canActFor(mid)) { toast(`That's ${managerName(mid)}'s ${what}, not yours`); return false; }
  if (netOn() && !demoMode && whoami !== mid && isCommissioner()) {
    // taking a chair via the Transfers-hub switcher IS the override confirm —
    // the banner stays up the whole time; re-asking per action made a test
    // night twelve confirms deep. Scoped HARD to the sandbox Transfers page
    // (sol test-night P2: an unscoped skip silently widened the pen to
    // lineups and the club office on other pages)
    if (SANDBOX && state.view === 'transfers' && transfersView.as === mid) return true;
    return confirm(`COMMISSIONER OVERRIDE — you are changing ${managerName(mid)}'s ${what}, not your own. Proceed?`);
  }
  return true;
}

// pins are gone — identity is real sign-in now. claims/autolists stay in local
// state but arrive via the OWNER's private node online (blind to everyone else).
const SHARED_KEYS = ['phase', 'managers', 'settings', 'draft', 'lineups', 'transfers', 'trades', 'covenants', 'claims', 'waiverMeta', 'autolists', 'watchlists', 'adjustments', 'shirtNums', 'draftPool', 'windowDraft', 'tradeBlock', 'benchOrders', 'lobus', 'hamCup', 'ready', 'mock', 'heckles', 'suggestions', 'liveStats'];
function sharedSnapshot() {
  const o = {};
  for (const k of SHARED_KEYS) o[k] = state[k];
  return o;
}
// two facts about the shared cloud, learned only from the server itself:
let cloudKnown = false;   // have we received the first snapshot (any value)?
let cloudHasData = false; // does the cloud currently hold a real league?
function pushShared(path, val) {
  // clients can no longer write the database — every converted call site goes
  // through serverAct() when online. Reaching this while netOn is a bug.
  if (netOn()) console.warn('[v2] dropped direct write', path);
}
function publishAll() {
  if (!netOn()) return;
  // full-state publish (empty-cloud restore / file import) is a commissioner
  // mutation like any other — the server splits private data per owner
  serverAct('importState', { state: sharedSnapshot() })
    .then(() => toast('League state published.'))
    .catch(() => {});
}
const toArr = x => Array.isArray(x) ? x : (x ? Object.values(x) : []);

/* ----- concurrency-safe shared-array writes -----
   Two phones acting in the same second must BOTH land (or one must get a
   polite no) — never a silent last-write-wins. fn receives the array as the
   server currently sees it and returns the new array, or null to abort.
   fn must be pure: Firebase may re-run it on contention. */
function txnArray(key, fn) {
  if (!netOn()) {
    const out = fn(toArr(state[key]));
    if (out) { state[key] = out; save(); render(); }
    return Promise.resolve(!!out);
  }
  // online, array writes are server-side transactions inside the mutation
  // functions — a call site still hitting this is unconverted
  console.warn('[v2] dropped direct txn', key);
  return Promise.resolve(false);
}
// ownership computed from an arbitrary transfers list — for in-transaction checks
function ownedIdsGiven(transfers, gwIdx) {
  const ids = new Set(state.draft.picks.map(p => p.playerId));
  for (const t of transfers) if (t && t.gw <= gwIdx) { ids.delete(t.outId); ids.add(t.inId); }
  return ids;
}
function squadIdsGiven(mid, transfers, gwIdx) {
  const ids = new Set(state.draft.picks.filter(p => p.managerId === mid).map(p => p.playerId));
  for (const t of transfers) if (t && t.managerId === mid && t.gw <= gwIdx) { ids.delete(t.outId); ids.add(t.inId); }
  return ids;
}

// Firebase fires snapshots SYNCHRONOUSLY on local writes — if we applied them
// inline, a function pushing several keys would have its own half-echoed state
// wipe its later writes (the first waiver run of a season would silently undo
// itself). Defer by a tick and only apply the freshest snapshot.
let _snapLatest, _snapQueued = false, _snapSeen = false;
window.onSharedSnapshot = data => {
  _snapLatest = data;
  _snapSeen = true;
  // learn what's in the cloud even while in demo mode, so writes aren't
  // stuck "dropped, waiting for the server" after the user exits the demo
  cloudKnown = true;
  if (data) cloudHasData = true;
  if (_snapQueued) return;
  _snapQueued = true;
  setTimeout(() => { _snapQueued = false; applySharedSnapshot(_snapLatest); }, 0);
};
function applySharedSnapshot(data) {
  if (SYNC_OFF || demoMode) return;
  cloudKnown = true; // the server has now spoken — writes are safe from here
  if (!data) {
    cloudHasData = false;
    // cloud league is empty. Only the commissioner's device may repopulate it;
    // everyone else treats empty cloud as the truth (so a deliberate reset sticks).
    if (state.phase !== 'setup') {
      if (isCommissioner()) {
        if (confirm('The cloud league is empty but this device holds a game. Restore it for everyone? (Cancel = start fresh)')) {
          publishAll();
        } else {
          state = freshState();
          localStorage.removeItem(`${LS_NS}-ceremony-seen`);
          save();
        }
      } else {
        state = freshState();
        localStorage.removeItem(`${LS_NS}-ceremony-seen`);
        save();
      }
    }
    render();
    return;
  }
  cloudHasData = true;
  data.managers = toArr(data.managers);
  // a partial or vandalised snapshot must never blank the club list — the
  // twelve names are constitutional
  if (!data.managers.length) delete data.managers;
  // settings arrive merged over the defaults — a fragment can tweak values
  // but can never delete squadSize or the scoring table out from under us
  if (data.settings !== undefined) {
    const d = freshState().settings;
    data.settings = {
      ...d, ...data.settings,
      scoring: { ...d.scoring, ...(data.settings.scoring || {}) },
      posMin: { ...d.posMin, ...(data.settings.posMin || {}) },
      posMax: { ...d.posMax, ...(data.settings.posMax || {}) },
    };
  }
  data.draft = data.draft || {};
  data.draft.order = toArr(data.draft.order);
  data.draft.picks = toArr(data.draft.picks);
  data.draft.breaksDone = toArr(data.draft.breaksDone);
  data.draft.ceremonyReady = data.draft.ceremonyReady || {};
  data.draft.paused = !!data.draft.paused;
  // first sight of a fresh draft on this device → roll the opening ceremony
  const fresh = data.phase === 'draft' && data.draft.picks.length === 0;
  data.transfers = toArr(data.transfers);
  data.suggestions = toArr(data.suggestions);
  data.trades = toArr(data.trades);
  data.covenants = toArr(data.covenants);
  data.autolists = data.autolists || {};
  for (const mid of Object.keys(data.autolists)) data.autolists[mid] = toArr(data.autolists[mid]);
  data.lineups = data.lineups || {};
  for (const mid of Object.keys(data.lineups)) {
    data.lineups[mid] = data.lineups[mid] || {};
    for (const gw of Object.keys(data.lineups[mid])) {
      if (gw.endsWith('-t')) continue; // edit timestamps ride along untouched
      data.lineups[mid][gw] = toArr(data.lineups[mid][gw]);
    }
  }
  data.claims = data.claims || {};
  for (const gw of Object.keys(data.claims)) {
    for (const mid of Object.keys(data.claims[gw] || {})) data.claims[gw][mid] = toArr(data.claims[gw][mid]);
  }
  data.waiverMeta = data.waiverMeta || { lastRun: null, control: 'auto' };
  // saves strip matchStats and old snapshots (the podcast seed) lack the key
  // entirely — every reader assumes the map exists, and managerSquad walking
  // gwStatus made gwEvent the first to throw on it (CI, 25 Aug)
  data.matchStats = data.matchStats || {};
  data.adjustments = data.adjustments || {};
  // pre-Aug-2026 flat {pid: pts} season adjustments: retired shape, dropped —
  // the canonical shape is {gwIdx: {pid: delta}} and lands inside GW scoring
  for (const k of Object.keys(data.adjustments)) {
    if (data.adjustments[k] != null && typeof data.adjustments[k] !== 'object') delete data.adjustments[k];
  }
  data.shirtNums = data.shirtNums || {};
  // Firebase strips empty arrays/objects, so a live windowDraft comes back
  // missing picks/order — restore them or the first sign throws on .push
  if (data.windowDraft) {
    data.windowDraft.order = toArr(data.windowDraft.order);
    data.windowDraft.picks = toArr(data.windowDraft.picks);
  }
  // the snapshot is the COMPLETE league (we listen on the whole node), so a
  // key absent from it has been deleted upstream — reset it to its default
  // rather than clinging to a stale local copy (that's how a cancelled Ham
  // Cup or cleared trade-block used to linger forever on other devices)
  const defaults = freshState();
  const wasPhase = state.phase;
  for (const k of SHARED_KEYS) {
    // online, claims/autolists/watchlists never travel in the public snapshot —
    // they are per-owner private data fed by onPrivateSnapshot. Keep the local
    // copy. A watchlist is nobody else's business (Marc, 20 Aug).
    if (netOn() && (k === 'claims' || k === 'autolists' || k === 'watchlists')) continue;
    state[k] = data[k] !== undefined ? data[k] : defaults[k];
  }
  applySquadRules(state.settings);
  /* The cloud can name players this device's feed has never heard of. The
     server autodrafts from data/data.json fetched live; the browser draws from
     the js/data.js it loaded at page load, and the feed is regenerated every
     five minutes — so the two disagree the moment either drifts. Unstubbed,
     ONE unknown id threw inside render() and killed the Draft Console, My
     Team, Transfers, the table and Matches: a dead screen, no toast, nothing
     to read (Toby, sandbox 12 Aug — "I skipped draft and it froze", then the
     recovery bar on refresh). The load path has always stubbed; the snapshot
     path never did. Now it does, so a feed mismatch degrades to a visible
     "#579 (unknown)" and an offer to reload, instead of a locked page. */
  if (stubMissingPlayers(state)) { staleSave = true; showStaleBar(); }
  // the moment the league goes to draft, every device goes to the console —
  // being left on the dashboard's GW1 card read as "it's broken" (Toby)
  if (state.phase === 'draft' && wasPhase !== 'draft') state.view = 'draft';
  save(); render();
  reportCeremonyReady(); // a previously-finished device retries until its shared tick lands
  ceremonyTick();        // ...and a device still in the pomp learns the room moved on
  const cerKey = state.phase === 'draft' ? ceremonyKey() : '';
  if (fresh && cerKey && localStorage.getItem(`${LS_NS}-ceremony-seen`) !== cerKey) {
    showCeremony(); // stamps "seen" itself, at the END — never at open
  }
};
window.onSyncConnection = up => {
  syncConnected = up;
  renderSyncArea();
  if (document.getElementById('whoOverlay')) renderIdentity();
  if (up) { ceremonyReportFailures = 0; reportCeremonyReady(); } // retry an acknowledgement lost with the connection
};
// a failed private/membership read updates the open identity card's tech line
window.onSyncReadError = () => { if (document.getElementById('whoOverlay')) renderIdentity(); };

/* ----- auth + private data (v2) ----- */
let _pendingPrivate;
function applyPrivateNode(node) {
  const mid = membership?.managerId;
  if (mid == null) return;
  state.autolists = { ...state.autolists, [mid]: toArr(node?.autolist) };
  state.watchlists = { ...state.watchlists, [mid]: toArr(node?.watchlist) };
  const claims = {};
  for (const [g, arr] of Object.entries(node?.claims || {})) claims[g] = { [mid]: toArr(arr) };
  state.claims = claims;
  save(); render();
}
window.onPrivateSnapshot = node => {
  if (!netOn()) return;
  if (!membership) { _pendingPrivate = node; return; } // membership may land second
  applyPrivateNode(node);
};
window.onMembershipSnapshot = m => {
  const previous = whoami;
  membership = m || null;
  membershipResolved = true;
  syncIdentity();
  // A team lens chosen before online identity resolved must not stick to the
  // first manager in the array. On a genuine identity transition, land on the
  // signed-in manager's club; later browsing choices remain untouched.
  if (membership && whoami !== previous) teamView.mid = whoami;
  if (membership && _pendingPrivate !== undefined) { applyPrivateNode(_pendingPrivate); _pendingPrivate = undefined; }
  render();
  if (membership) { ceremonyReportFailures = 0; reportCeremonyReady(); }
};
window.onAuthChanged = u => {
  authUser = u;
  authResolved = true;
  // sync.js delivers auth before attaching this user's membership listener.
  // Clear the previous user's identity during that gap; a truthy-to-truthy
  // account switch must never flash or retain the old club either.
  membership = null;
  membershipResolved = !u;
  _pendingPrivate = undefined;
  syncIdentity();
  render();
};
// magic-link completion: success and failure both get said OUT LOUD —
// a silently-failed link leaves someone signed out without knowing it
window.onAuthLinkResult = (ok, err) => {
  if (ok) { toast('Signed in. Welcome to the league.'); return; }
  const code = String(err?.code || err?.message || '');
  toast(code.includes('invalid-action-code') ? 'That sign-in link has been used or expired — request a fresh one.'
    : code.includes('invalid-email') || code.includes('does not match') ? 'That email doesn’t match the link — type the address the link was sent to.'
    : 'Sign-in didn’t complete — request a fresh link.');
};

function freshState() {
  return {
    phase: 'setup', // setup | draft | season
    managers: [
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
    ],
    settings: {
      squadSize: SQUAD_RULES.size,
      posMin: { ...SQUAD_RULES.min },
      posMax: { ...SQUAD_RULES.max },
      pickTimer: 30,
      scoring: { ...DEFAULT_SCORING },
    },
    draft: { order: [], picks: [], breaksDone: [], timewastes: {}, paused: false, pausedLeft: 0, ceremonyReady: {} },
    autolists: {},         // managerId -> [pid] ranked personal autopick list / shortlist
    watchlists: {},        // managerId -> [pid] private Trough watchlist — a lens, never an action
    lineups: {},           // managerId -> { gwIndex: [pid x11] }
    shirtNums: {},         // managerId -> { pid: customNumber }
    transfers: [],         // [{managerId, outId, inId, gw, n, t, trade?, waiver?}]
    trades: [],            // [{id, from, to, give, get, terms?, status: pending|done|rejected|withdrawn, t}]
    covenants: [],         // the offline bits: [{id, from, to, text, t, gw}] — the register of nonsense
    claims: {},            // gwIndex -> { managerId: [{in, out}] ranked }
    waiverMeta: { lastRun: null, control: 'auto' }, // control: auto | open | closed
    draftPool: null,       // draft-night snapshot {at, ids: {pid: club}} — anyone outside it is a locked "new arrival"
    windowDraft: null,     // {status: live|done, order, turn, passes, picks} — post-window mini-draft of arrivals
    tradeBlock: {},        // managerId -> [pid] players publicly listed as available to trade
    heckles: {},           // managerId -> {line, t} — draft-night barbs, indexes into HECKLES
    suggestions: [],       // the Suggestion Box — feature requests from the floor, ruled on by the Committee
    liveStats: null,       // live-match fast lane {n, t, playerStats} — CI-written, display-only overlay
    benchOrders: {},       // managerId -> { gwIndex: [pid] } — auto-sub priority, leftmost first
    lobus: {},             // managerId -> pid — each manager's declared Lobus (ledger #1)
    hamCup: null,          // {gw, drawnAt, entries: {managerId: [pid x11]}} — the Palwin Ham Cup (ledger #6)
    mock: null,            // {gw, phase: 'live'|'final', seed, t} — the Simulation Chamber (sandbox-only mock matchday)
    ready: {},             // pre-draft roll call {managerId: {t, self}} — cleared by reset
    fixtures: [],
    matchStats: {},        // 'gw{n}' -> { gw, label, date, final, playerStats: {pid:{min,st,sub,g,a,cs,gc,og,ps,pm,yc,rc,sv}} }
    adjustments: {},
    lastSync: null,
    view: 'draft',
  };
}
function save() {
  if (demoMode) return;
  // stats and fixtures re-fetch from the feed on load — persisting them would
  // balloon every save to multiple MB by spring and jank older phones
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...state, matchStats: {}, fixtures: [], liveStats: null }));
  } catch (e) { console.warn('[save]', e); }
}
// last season's FPL points (falls back to price until the new season's data rolls in)
// the board's rating = last season's total in THE LEAGUE's currency (Marc +
// Toby, UAT night: "based on our scoring system… no save points, bonus points
// etc" — the feed's own rating/pts fields carry FPL bonus + defensive-
// contribution points this league does not pay, which had Elliot Anderson
// tenth on the board). Cached per player; cache drops if scoring is edited.
// Fixed DEFAULT_SCORING currency (not the live editable scoring) so the
// board ranks identically on client and server — engine.js mirrors this.
const _ratingCache = new Map();
const RATING_HISTORY_WEIGHT = 0.45;
const rating = p => {
  let r = _ratingCache.get(p.id);
  if (r == null) {
    const src = leagueSeasonSrc(p);
    const apps = src ? src.mp / 90 : 0;
    const played = src ? Math.max(0, leaguePtsFrom(src, p.pos, DEFAULT_SCORING)) : 0;
    // thin or no sample → weight on FPL VALUE (Ben's ruling, UAT night:
    // Jackson and Hackney sat at 6 — "any new players just have 6"). Price
    // tracks expected output well enough to seed a board rank. History earns
    // full trust only at ~20 appearances — half a season — so a strike year
    // (Isak, 694 min) can't read as real form; valuation keeps a permanent 55% say —
    // the market slightly outranks last season's production on the board
    // (Ben, 18 Aug: value weighted slightly higher than points; was 25%).
    const prior = (p.price || 4.5) * 12;
    const w = RATING_HISTORY_WEIGHT * Math.min(1, apps / 20);
    r = Math.round(played * w + prior * (1 - w));
    _ratingCache.set(p.id, r);
  }
  return r;
};

/* ---------------- demo mode ---------------- */
function buildDemoState() {
  const s = freshState();
  s.phase = 'season';
  s.view = 'team';
  // deterministic shuffle so every device shows the same demo
  s.draft.order = s.managers.map(m => m.id).sort((a, b) => ((a * 2654435761) % 97) - ((b * 2654435761) % 97));
  const sorted = [...PLAYERS].sort((a, b) => rating(b) - rating(a));
  const taken = new Set();
  const counts = {};
  s.managers.forEach(m => { counts[m.id] = { GK: 0, DF: 0, MF: 0, FW: 0 }; });
  const { squadSize, posMin, posMax } = s.settings;
  const canTake = (mid, p) => {
    const c = counts[mid];
    const size = c.GK + c.DF + c.MF + c.FW;
    if (size >= squadSize || c[p.pos] >= posMax[p.pos]) return false;
    let need = 0;
    for (const pos of ['GK', 'DF', 'MF', 'FW']) need += Math.max(0, posMin[pos] - c[pos] - (pos === p.pos ? 1 : 0));
    return need <= squadSize - size - 1;
  };
  const m = s.managers.length;
  const totalDemoPicks = squadSize * m;
  for (let n = 0; n < totalDemoPicks; n++) {
    const round = Math.floor(n / m), idx = n % m;
    const mid = round % 2 === 0 ? s.draft.order[idx] : s.draft.order[m - 1 - idx];
    const p = sorted.find(p => !taken.has(p.id) && canTake(mid, p));
    taken.add(p.id);
    counts[mid][p.pos]++;
    s.draft.picks.push({ managerId: mid, playerId: p.id, code: p.code ?? null, n: n + 1 });
  }
  // fabricate Gameweek 1 results for everyone drafted
  const ps = {};
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const pk of s.draft.picks) {
    const p = PLAYER_BY_ID[pk.playerId];
    const started = rnd() < 0.8;
    const mins = started ? (rnd() < 0.85 ? 90 : 55) : (rnd() < 0.6 ? 25 : 0);
    const goalChance = { FW: 0.35, MF: 0.2, DF: 0.07, GK: 0.005 }[p.pos];
    const cs = p.pos !== 'FW' && mins >= 60 && rnd() < 0.35 ? 1 : 0;
    ps[p.id] = {
      min: mins,
      st: started ? 1 : 0,
      sub: !started && mins > 0 ? 1 : 0,
      g: mins > 0 && rnd() < goalChance ? (rnd() < 0.2 ? 2 : 1) : 0,
      a: mins > 0 && rnd() < 0.18 ? 1 : 0,
      cs,
      gc: !cs && mins >= 60 && p.pos !== 'FW' && rnd() < 0.5 ? Math.ceil(rnd() * 3) : 0,
      og: 0,
      ps: p.pos === 'GK' && mins > 0 && rnd() < 0.04 ? 1 : 0,
      pm: 0,
      yc: mins > 0 && rnd() < 0.12 ? 1 : 0,
      rc: mins > 0 && rnd() < 0.01 ? 1 : 0,
      sv: p.pos === 'GK' && mins > 0 ? Math.floor(rnd() * 7) : 0,
    };
  }
  s.matchStats = { gw1: { gw: 0, label: 'Demo — fictional Gameweek 1', date: GAMEWEEKS[0]?.from || '2026-08-15T17:30Z', final: true, playerStats: ps } };
  s.lastSync = new Date().toISOString();
  // the new toys, pre-loaded so the demo shows them all off
  const demoSquad = mid => s.draft.picks.filter(pk => pk.managerId === mid).map(pk => PLAYER_BY_ID[pk.playerId]);
  for (const mgr of s.managers) {
    if (rnd() < 0.25) continue; // a few holdouts, for the shame list
    const sq2 = demoSquad(mgr.id);
    const lob = sq2.filter(p => p.pos === 'FW').sort((a, b) => rating(b) - rating(a))[0] || sq2[0];
    s.lobus[mgr.id] = lob.id;
  }
  const freeAll = PLAYERS.filter(p => !taken.has(p.id)).sort((a, b) => rating(b) - rating(a));
  const freeBy = pos => freeAll.filter(p => p.pos === pos);
  s.hamCup = { gw: 8, drawnAt: new Date().toISOString(), entries: {} };
  [1, 4, 5, 8, 11].forEach((mid, k) => {
    s.hamCup.entries[mid] = [
      ...freeBy('GK').slice(k, k + 1), ...freeBy('DF').slice(k * 4, k * 4 + 4),
      ...freeBy('MF').slice(k * 4, k * 4 + 4), ...freeBy('FW').slice(k * 2, k * 2 + 2),
    ].map(p => p.id);
  });
  s.covenants = [
    { id: 1, from: 5, to: 8, text: 'Tussie holds first refusal on any City player Marc drops, in perpetuity.', t: Date.now(), gw: 0 },
    { id: 2, from: 3, to: 9, text: 'The Haaland curse shall not be mentioned before 9pm on matchdays.', t: Date.now(), gw: 0 },
  ];
  // a bit of market history so the dashboard's Latest-moves snapshot shows
  s.transfers = [2, 5, 7, 9, 11].map((mid, k) => {
    const sq = demoSquad(mid);
    const out = sq[sq.length - 1 - k], inP = freeAll[20 + k * 3];
    return out && inP ? { managerId: mid, outId: out.id, inId: inP.id, gw: 1, n: 1, t: Date.now() - (5 - k) * 3600e3, ...(k === 1 ? { waiver: true } : k === 3 ? { trade: true } : {}) } : null;
  }).filter(Boolean);
  s.tradeBlock = { 2: [s.draft.picks.find(pk => pk.managerId === 2).playerId] };
  return s;
}
async function enterDemo() {
  if (demoMode) return;
  demoBackup = state;
  demoMode = true;
  demoGwOverride = 0;
  state = buildDemoState();
  const hv = location.hash.slice(1);
  state.view = NAV_ITEMS.some(([k]) => k === hv) ? hv : 'dash'; // demo opens at home too
  teamView.gw = 0;
  fxView.gw = GAMEWEEKS[0]?.n || 1;
  // the demo's Vidiprinter needs no hand-written tape any more: it derives
  // from the demo gameweek's stats like every other device does (Marc, 28 Aug)
  render();
  toast('Demo mode — fake draft, fake results. Your real league is untouched.');
  // pull the full real season in, so every feature has something to show
  try {
    const bust = `?t=${Date.now()}`;
    const [stats, fixtures] = await Promise.all([
      fetch(`data/stats.json${bust}`).then(r => r.json()),
      fetch(`data/fixtures.json${bust}`).then(r => r.json()),
    ]);
    if (!demoMode) return;
    state.fixtures = fixtures.filter(f => f.date).sort((a, b) => a.date.localeCompare(b.date));
    for (const [gwN, gw] of Object.entries(stats.gws || {})) {
      const i = +gwN - 1;
      if (!GAMEWEEKS[i]) continue;
      state.matchStats[`gw${gwN}`] = { gw: i, label: GAMEWEEKS[i].label, date: GAMEWEEKS[i].from, final: !!gw.finished, playerStats: gw.stats || {} };
    }
    render();
    toast('Demo loaded a full season of real stats — click around, everything is live.');
  } catch { /* offline demo still works with its fictional GW1 */ }
}
function exitDemo() {
  state = demoBackup || load() || freshState();
  demoMode = false;
  demoGwOverride = null;
  teamView.gw = null;
  fxView.gw = null;
  demoBackup = null;
  // any league changes that landed while we were in the demo were swallowed —
  // apply the freshest snapshot now so we return to the real, current league
  if (_snapSeen && netOn()) applySharedSnapshot(_snapLatest);
  render();
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && !s.lineups) { s.lineups = {}; s.transfers = []; } // migrate pre-lineup saves
    if (s && !s.claims) s.claims = {};
    if (s && !s.autolists) s.autolists = {};
    if (s && !s.watchlists) s.watchlists = {};
    if (s && !s.trades) s.trades = [];
    if (s && s.pins) delete s.pins; // PINs retired — real sign-in now
    if (s && !s.covenants) s.covenants = [];
    if (s && !s.waiverMeta) s.waiverMeta = { lastRun: null, control: 'auto' };
    // saves strip matchStats and fixtures; older snapshots (the podcast seed)
    // lack the keys entirely — every reader assumes they exist (gwEvent broke
    // CI on matchStats, anyMatchLive throws the same way on fixtures — 25 Aug)
    if (s && !s.matchStats) s.matchStats = {};
    if (s && !s.fixtures) s.fixtures = [];
    if (s && !s.shirtNums) s.shirtNums = {};
    if (s && s.draftPool === undefined) s.draftPool = null;
    if (s && s.windowDraft === undefined) s.windowDraft = null;
    if (s && !s.tradeBlock) s.tradeBlock = {};
    if (s && !s.heckles) s.heckles = {};
    if (s && !s.suggestions) s.suggestions = [];
    if (s && s.adjustments) for (const k of Object.keys(s.adjustments)) {
      if (s.adjustments[k] != null && typeof s.adjustments[k] !== 'object') delete s.adjustments[k]; // retired flat shape
    }
    if (s && !s.benchOrders) s.benchOrders = {};
    if (s && !s.lobus) s.lobus = {};
    if (s && !s.ready) s.ready = {};
    if (s && s.hamCup === undefined) s.hamCup = null;
    if (s && s.mock === undefined) s.mock = null;
    if (s && s.settings.pickTimer == null) s.settings.pickTimer = 30;
    if (s) applySquadRules(s.settings);
    staleSave = stubMissingPlayers(s);
    return s;
  } catch { return null; }
}

/* ---------------- helpers ---------------- */
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// club badge — keeps the old flagImg name so every call site works unchanged
const flagImg = (team, big = false) => {
  const t = TEAM_BY_NAME[team];
  return t ? `<img class="flag${big ? ' big' : ''}" loading="lazy" src="https://resources.premierleague.com/premierleague/badges/70/t${t.code}.png" alt="${esc(team)}" title="${esc(team)}">` : '';
};
// official PL headshot, falling back to the league's own "Photo Missing" card.
// data-pcard makes every photo a button that opens the player's stats card.
/* Player photos, a two-library story (Lee was right, the PL went deeper):
 * the CURRENT headshots live in the premierleague25 library (no 'p' prefix,
 * Xhaka in Sunderland red since Aug 2025) but it doesn't cover everyone, so
 * misses fall back to the legacy library (p-prefixed, some photos years
 * old), and only then to the silhouette. */
let PHOTO_LIB = 'premierleague25';
// The PL will mint a premierleague26 library at some point (25 appeared the
// same way, and the old library froze where it stood — Xhaka aged three years
// in it). Probe once per boot and prefer 26 the moment it exists; until then
// this request 502s and nothing changes. Skipped under ?nosync so the test
// harnesses' request-intercepted photo pins stay deterministic.
if (!/nosync/.test(location.search)) {
  try {
    const probe = new Image();
    probe.onload = () => { PHOTO_LIB = 'premierleague26'; };
    probe.src = 'https://resources.premierleague.com/premierleague26/photos/players/110x140/223340.png';
  } catch { /* photos are a nicety */ }
}
const PHOTO_NEW = code => `https://resources.premierleague.com/${PHOTO_LIB}/photos/players/110x140/${code}.png`;
const PHOTO_OLD = code => `https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png`;
const PHOTO_MISSING = 'https://resources.premierleague.com/premierleague/photos/players/110x140/Photo-Missing.png';
const photoImg = p => `<img class="headshot" loading="lazy" data-pcard="${p.id}" data-code="${p.code}" src="${PHOTO_NEW(p.code)}" alt="${esc(p.name)}" title="${esc(p.name)} — tap for stats">`;
// the CSP kills inline onerror= handlers, so broken photos fall back centrally:
// new library → legacy library → silhouette
// the wordmark is a home button — clicking "The League" goes to the dashboard
// (waiting room pre-draft), same as #homeBtn (Ben's UX ask, 1 Aug)
{
  const brandEl = document.querySelector('.brand');
  if (brandEl) {
    brandEl.style.cursor = 'pointer';
    brandEl.title = 'Back to the Dashboard';
    brandEl.addEventListener('click', () => { state.view = 'dash'; save(); render(); });
  }
  // the crest opens full-size — 54px does the detail no justice (Ben, 14 Aug)
  const crestEl = document.querySelector('.brand-crest');
  if (crestEl) {
    crestEl.title = 'The club crest — tap to admire';
    crestEl.addEventListener('click', e => {
      e.stopPropagation();
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="card crest-ov">
        <img src="icons/crest-source.png" alt="The League crest, full size">
        <p class="venue-line" style="margin:10px 0 0">The League &middot; est. 2015 &middot; crest issued by the College of Arms (Warner &amp; Tussie)</p>
      </div>`;
      ov.onclick = () => closeOv(ov);
      document.body.appendChild(ov);
      pushOvState(); // phone back button closes the crest, not the site
    });
  }
  // any [data-gazette] button opens the paper, whatever view rendered it
  document.addEventListener('click', e => { if (e.target.closest('[data-gazette]')) gazetteSheet(); });
}
document.addEventListener('error', e => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !(img.classList.contains('headshot') || img.classList.contains('pcard-photo'))) return;
  if (!img.dataset.fbk && img.dataset.code) {
    img.dataset.fbk = '1';
    img.src = PHOTO_OLD(img.dataset.code);
  } else if (img.dataset.fbk !== '2') {
    img.dataset.fbk = '2';
    img.src = PHOTO_MISSING;
  }
}, true);
// the actual kit artwork FPL uses (GK variant for keepers); pass p to make it clickable too
const kitImg = (team, gk = false, p = null) => {
  const t = TEAM_BY_NAME[team];
  // 110px asset: the 66px one upscales soft on retina pitch chips (Lee's kit love deserves better)
  return t ? `<img class="kit" loading="lazy"${p ? ` data-pcard="${p.id}"` : ''} src="https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${t.code}${gk ? '_1' : ''}-110.png" alt="${esc(team)}" title="${p ? esc(p.name) + ' — tap for stats' : esc(team)}">` : '';
};

/* ----- nationalities (Lee's ask): FPL 'region' code → country + emoji flag.
   Codes are the PL's own country ids, anchored empirically against the 26/27
   player pool (241 England, 200 Spain, 106 Italy…). Academy kids ship null —
   no flag, no fuss; the feed itself has no region for them. Northern Ireland
   has no Unicode flag at all, so it carries no emoji here and is DRAWN
   instead — see NAT_SVG below. */
const NATIONS = {
  2: ['Albania', '🇦🇱'], 3: ['Algeria', '🇩🇿'], 10: ['Argentina', '🇦🇷'], 13: ['Australia', '🇦🇺'],
  14: ['Austria', '🇦🇹'], 21: ['Belgium', '🇧🇪'], 27: ['Bosnia & Herzegovina', '🇧🇦'], 30: ['Brazil', '🇧🇷'],
  34: ['Bulgaria', '🇧🇬'], 35: ['Burkina Faso', '🇧🇫'], 38: ['Cameroon', '🇨🇲'], 39: ['Canada', '🇨🇦'],
  44: ['Chile', '🇨🇱'], 48: ['Colombia', '🇨🇴'], 50: ['DR Congo', '🇨🇩'], 54: ['Ivory Coast', '🇨🇮'],
  57: ['Czechia', '🇨🇿'], 58: ['Denmark', '🇩🇰'], 62: ['Ecuador', '🇪🇨'], 63: ['Egypt', '🇪🇬'],
  73: ['France', '🇫🇷'], 78: ['Gambia', '🇬🇲'], 79: ['Georgia', '🇬🇪'], 80: ['Germany', '🇩🇪'],
  81: ['Ghana', '🇬🇭'], 83: ['Greece', '🇬🇷'], 90: ['Guinea-Bissau', '🇬🇼'], 92: ['Haiti', '🇭🇹'],
  97: ['Croatia', '🇭🇷'], 98: ['Hungary', '🇭🇺'], 99: ['Iceland', '🇮🇸'], 103: ['Iraq', '🇮🇶'],
  104: ['Ireland', '🇮🇪'], 105: ['Israel', '🇮🇱'], 106: ['Italy', '🇮🇹'], 107: ['Jamaica', '🇯🇲'], 108: ['Japan', '🇯🇵'],
  114: ['South Korea', '🇰🇷'], 132: ['Mali', '🇲🇱'], 139: ['Mexico', '🇲🇽'], 145: ['Morocco', '🇲🇦'],
  146: ['Mozambique', '🇲🇿'], 152: ['Netherlands', '🇳🇱'], 154: ['New Zealand', '🇳🇿'], 157: ['Nigeria', '🇳🇬'],
  161: ['Norway', '🇳🇴'], 168: ['Paraguay', '🇵🇾'], 172: ['Poland', '🇵🇱'], 173: ['Portugal', '🇵🇹'],
  189: ['Senegal', '🇸🇳'], 190: ['Serbia', '🇷🇸'], 194: ['Slovakia', '🇸🇰'], 195: ['Slovenia', '🇸🇮'],
  200: ['Spain', '🇪🇸'], 203: ['Suriname', '🇸🇷'], 206: ['Sweden', '🇸🇪'], 207: ['Switzerland', '🇨🇭'],
  217: ['Trinidad & Tobago', '🇹🇹'], 219: ['Türkiye', '🇹🇷'], 225: ['Ukraine', '🇺🇦'], 229: ['USA', '🇺🇸'],
  230: ['Uruguay', '🇺🇾'], 231: ['Uzbekistan', '🇺🇿'],
  241: ['England', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'], 242: ['Northern Ireland', ''], 243: ['Scotland', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'], 244: ['Wales', '🏴󠁧󠁢󠁷󠁬󠁳󠁿'],
};
/* Marc, 18 Aug: "some players dont have the nationality at all still."

   That one is upstream, not ours: every country code the feed sends IS mapped
   here, but seventeen players arrive with `region: null` from FPL itself —
   scripts/fetch_fpl.py reads that field and there is nothing behind it. Most
   are academy names on nought minutes, and FPL usually fills a region in once
   somebody features, so they mend themselves.

   For the ones that matter before then, this is the manual override. Key it on
   `code` — FPL's stable player code, which survives id churn between seasons —
   and it wins over the feed, so it also fixes a country the feed gets WRONG.

   Left empty on purpose. A wrong nationality on a real person is worse than a
   missing one, so add a name here only when you actually know. */
const NAT_OVERRIDE = {
  606798: 200,   // Andrés García (Aston Villa) — Spain. Marc, 18 Aug.
  550090: 106,   // Diego Coppola (Brighton) — Italy. Marc, 18 Aug.
  660392: 157,   // Christantus Uche (Crystal Palace) — Nigeria. Marc, 18 Aug.
                 // Back at Getafe, so he is LEFT and out of the pools — but a
                 // squad or an archive that still names him should name him right.
};
const natOf = p => NATIONS[NAT_OVERRIDE[p.code] ?? p.nat] || null;
/* Marc, 18 Aug: "the northern ireland flag is wrong, it is showing the union
   jack." It was — as a documented stand-in, because Unicode has no Northern
   Ireland flag to fall back to. England, Scotland and Wales have tag sequences;
   Northern Ireland has none, so 🇬🇧 was standing in and reading as plain wrong
   on six players, two of whom (Hume, Ballard) are firmly draftable.

   So it is drawn instead, like the club crests and the station idents — the
   Ulster Banner, which is the flag the IFA plays under and what UEFA and FIFA
   put beside the Northern Ireland team. Same approach works for any future
   nation Unicode has no flag for. */
const NAT_SVG = {
  242: `<svg viewBox="0 0 60 40" class="nat-svg" role="img" aria-label="Northern Ireland" focusable="false">
    <rect width="60" height="40" fill="#fff"/>
    <rect x="24" width="12" height="40" fill="#CF142B"/>
    <rect y="14" width="60" height="12" fill="#CF142B"/>
    <polygon points="30,6 33.5,15 42.5,13.2 37,20 42.5,26.8 33.5,25 30,34 26.5,25 17.5,26.8 23,20 17.5,13.2 26.5,15" fill="#fff" stroke="#CF142B" stroke-width=".7"/>
    <path d="M27.3 23.2v-4.6q0-1 1-1t1 1v2.8v-4.4q0-1 1-1t1 1v4.4v-3.2q0-1 1-1t1 1v5.4q0 2.6-2.4 2.6h-1.6q-2 0-2-2z" fill="#CF142B"/>
    <path d="M26.6 11.6h6.8V9.2l-1.6 1.1L30 8.1l-1.8 2.2-1.6-1.1z" fill="#E8B923" stroke="#7d6210" stroke-width=".35"/>
  </svg>`,
};
const natFlag = p => {
  const n = natOf(p);
  if (!n) return '';
  const code = NAT_OVERRIDE[p.code] ?? p.nat;
  return NAT_SVG[code]
    ? `<span class="nat-flag nat-flag-drawn" title="${esc(n[0])}">${NAT_SVG[code]}</span>`
    : `<span class="nat-flag" title="${esc(n[0])}">${n[1]}</span>`;
};
// next fixture for a club in a gameweek — "MCI (H)" style
function nextOpp(club, gwN) {
  const f = state.fixtures.find(f => f.gw === gwN && (f.home === club || f.away === club));
  if (!f) return null;
  const opp = f.home === club ? f.away : f.home;
  return `${TEAM_BY_NAME[opp]?.short || opp} (${f.home === club ? 'H' : 'A'})`;
}
// fixture difficulty at a glance — green means get them on, red means brace
// FPL's team strength changed scale at the 26/27 reset: ~1000–1300 before,
// plain 1–5 now. Read both, or every fixture renders neutral and the "usual
// fixture tints" legend becomes a lie (Ben, 2 Aug).
const fdrCls = opp => {
  const s = TEAM_BY_NAME[opp]?.str || 0;
  if (!s) return '';
  if (s > 100) return s >= 1240 ? 'fdr-hard' : s <= 1100 ? 'fdr-easy' : '';
  return s >= 4 ? 'fdr-hard' : s <= 2 ? 'fdr-easy' : '';
};
// coloured fixture chip for the pitch views. No fixture for THAT gw on this
// device (blank GW, or a device carrying truncated fixture data — the lads'
// laptops on UAT night) → show the player's NEXT fixture instead of a dash
// (Ben: "show next fixture").
function nextOppHtml(club, gwN) {
  const f = state.fixtures.find(f => f.gw === gwN && (f.home === club || f.away === club));
  if (!f) {
    const nxt = typeof nextFx === 'function' ? nextFx(club) : '—';
    return nxt && nxt !== '—' ? `<span class="muted" title="No fixture that week — this is his next one">next: ${esc(nxt)}</span>` : '—';
  }
  const opp = f.home === club ? f.away : f.home;
  return `<span class="${fdrCls(opp)}">${esc(`${TEAM_BY_NAME[opp]?.short || opp} (${f.home === club ? 'H' : 'A'})`)}</span>`;
}
// Familiar short names keep the tables clean. Only genuine collisions get a
// first initial (Marc + Ben, 5 Aug): E. Martinez / L. Martinez, while Haaland
// stays Haaland. Club + position remain alongside it, and the full name stays
// in the player card/search data rather than becoming a second line.
const _PLAYER_NAME_COUNTS = PLAYERS.reduce((m, p) => {
  const key = normName(p.name);
  m.set(key, (m.get(key) || 0) + 1);
  return m;
}, new Map());
const _PLAYER_INITIAL_LABEL_COUNTS = PLAYERS.reduce((m, p) => {
  const name = String(p.name || p.full || '?').trim();
  if ((_PLAYER_NAME_COUNTS.get(normName(name)) || 0) < 2) return m;
  const initial = String(p.full || '').trim().charAt(0).toUpperCase();
  const label = initial && !name.toUpperCase().startsWith(`${initial}.`) ? `${initial}. ${name}` : name;
  const key = normName(label);
  m.set(key, (m.get(key) || 0) + 1);
  return m;
}, new Map());
function playerDisplayName(p) {
  if (!p) return '?';
  const name = String(p.name || p.full || '?').trim();
  if ((_PLAYER_NAME_COUNTS.get(normName(name)) || 0) < 2) return name;
  const initial = String(p.full || '').trim().charAt(0).toUpperCase();
  const label = initial && !name.toUpperCase().startsWith(`${initial}.`) ? `${initial}. ${name}` : name;
  // Josh/Jay Dasilva and Brennan/Ben Johnson share initials too. Only those
  // stubborn collisions graduate to the full feed name.
  return (_PLAYER_INITIAL_LABEL_COUNTS.get(normName(label)) || 0) > 1
    ? String(p.full || label).trim()
    : label;
}
// clickable player name — opens the stats card, usable in any text row
const pname = p => p ? `<span class="plink" data-pcard="${p.id}">${esc(playerDisplayName(p))}</span>` : '?';
// expected points next gameweek: FPL's own projection, then points-per-game, then a guess
/* Projections in OUR currency (Marc, mock night: "Garner projected top MF" —
   FPL's carried-forward ppg pays bonus + defensive-contribution points this
   league doesn't score). Rebuild expected points from raw stats under league
   scoring; once real gameweeks exist, blend toward the live league ppg. */
function leagueSeasonSrc(p) {
  const ls = lastSeasonOf(p);
  if (ls && ls.mp) return ls;
  return (!FPL_WIPED && p.mp) ? { mp: p.mp, g: p.g || 0, a: p.a || 0, cs: p.cs || 0 } : null;
}
function leaguePtsFrom(src, pos, scFixed) {
  const sc = scFixed || (state.settings && state.settings.scoring) || DEFAULT_SCORING;
  const apps = src.mp / 90;
  const csPts = pos === 'GK' || pos === 'DF' ? (sc.cleanSheet ?? 4) : pos === 'MF' ? (sc.cleanSheetMF ?? 1) : 0;
  return apps * ((sc.appearanceStart ?? 2) * 0.85) // some of those apps were sub outings
    + src.g * (sc['goal' + pos] ?? 4) + src.a * (sc.assist ?? 3) + (src.cs || 0) * csPts
    + (pos === 'GK' ? apps * 0.5 : 0)                  // save/pen-save points, roughly
    - (pos === 'GK' || pos === 'DF' ? apps * 0.55 : 0); // goals-conceded drag, roughly
}
function leagueArchivePpg(p) {
  const src = leagueSeasonSrc(p);
  if (!src) return 0;
  const apps = src.mp / 90;
  if (apps < 3) return 0; // too small a sample to call a projection
  return Math.max(0.5, leaguePtsFrom(src, p.pos) / apps);
}
const playerXp = p => {
  // NB: metricsFor() calls this (via projPts) mid-build — going back through
  // metricsFor here would recurse. playerPoints() is the safe primitive.
  const arch = leagueArchivePpg(p);
  if (seasonHasStats()) {
    const { pts, agg } = playerPoints(p.id);
    if (agg.app > 0) {
      const ppg = pts / agg.app;
      const w = Math.min(1, agg.app / 6); // trust the real season more each week
      return ppg * w + (arch || ppg) * (1 - w);
    }
  }
  return arch > 0 ? arch : (p.ppg > 0 ? p.ppg * 0.75 : p.price / 4);
};
// the pre-kickoff projection, weighted the same way as the live one: a man
// carrying a doubt is not worth a full afternoon (Marc, 24 Aug 2026)
// liveXI, not lineupFor: the same projected eleven teamOutlook uses, so the
// duel heading and the win bar underneath it cannot disagree (r3ui pins that
// they match, and caught it the moment forecast subs moved one and not the
// other — Marc, 28 Aug 2026)
const projectedGwScore = (mid, gwIdx) =>
  Math.round(liveXI(mid, gwIdx).xi.reduce((t, pid) => {
    const p = PLAYER_BY_ID[pid];
    return t + playerXp(p) * startChance(p, gwIdx);
  }, 0));
// waiver/deadline times shown in the reader's OWN timezone — a UK league does
// the BST maths wrong when the app insists on UTC
const fmtWhen = d => new Date(d).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
// win chance from the projected-score gap (logistic; ~12-point gap ≈ 70%)
const winChance = (sa, sb) => 1 / (1 + Math.pow(10, -(sa - sb) / 25));

/* ----- live win probability -----
   Each player still to play contributes expected points plus uncertainty;
   as fixtures run, uncertainty drains and banked points take over.
   Even teams before kickoff = exactly 50:50; final whistle = 100:0. */
/* ----- how uncertain is one man, really? -----
   The flat ±4 this replaces (PLAYER_SD, retired here) conflated two completely
   different doubts: whether he plays at all, and how he does once he is on.
   Separating them is what fixes the win
   bar (Marc, 24 Aug 2026: "i feel like it should be higher in my favour" — 27
   all, two Chelsea men to come against nobody, and the bar said 89%).

   Once a man is on the pitch he BANKS his appearance points. He cannot go
   backwards short of a card, so his remaining spread is the return above that
   floor — lumpy, because goals are lumpy, but nothing like ±4. The old figure
   priced in a downside that the scoring table does not allow.

   So: with probability sc he plays and scores around xp with spread SURPLUS_SD;
   with probability 1-sc he does not play at all and scores nothing. The
   variance of that mixture is sc·SD² + sc(1-sc)·xp², which lands a nailed-on
   starter far tighter than before and an actual coin-flip wider — which is the
   whole point. A premium man's surplus swings harder than a defender's, so the
   spread scales with his expectation rather than sitting flat. */
const SURPLUS_FLOOR_SD = 1.5;  // even a nailed-on man can bring a card home
const SURPLUS_SD_SHARE = 0.55; // the better he is, the lumpier his afternoon
function playerVariance(xp, sc) {
  if (sc <= 0) return 0;
  const sd = Math.max(SURPLUS_FLOOR_SD, SURPLUS_SD_SHARE * Math.max(0, xp));
  return sc * sd * sd + sc * (1 - sc) * xp * xp;
}
// every fixture a club has in a gameweek — blanks return [], doubles both.
// The one fixture-parsing helper: the win bar, "what do I need" and Next Six
// all read the calendar through here.
function teamFixturesInGw(team, gwN) {
  return state.fixtures.filter(f => f.gw === gwN && (f.home === team || f.away === team));
}
function playerFixtureState(p, gwN) {
  const fx = teamFixturesInGw(p.team, gwN);
  // no fixture DATA at all for this GW (failed fetch, not yet synced): assume everyone is
  // still to play rather than letting the win bar collapse to a false 100–0
  if (!fx.length) return { st: 'none', frac: state.fixtures.some(x => x.gw === gwN) ? 0 : 1, fx };
  // frac = the share of this player's gameweek still to come. A double counts
  // per fixture: one done + one not started = half the expectation banked.
  // fxOver honours the provisional whistle: FPL's slow `finished` kept whole
  // finished matches "still to play" for hours (AJ/Toby, GW1 evening — Konsa
  // and Ballard played, scored 0, and the needs line counted them as to come)
  const fracs = fx.map(f => fxOver(f) ? 0 : f.started ? Math.max(0, (90 - Math.min(90, f.minutes || 0)) / 90) : 1);
  const frac = fracs.reduce((a, b) => a + b, 0) / fx.length;
  const st = fracs.every(fr => fr === 0) ? 'done'
    : fx.some(f => f.started && !fxOver(f)) ? 'live'
    : fracs.every(fr => fr === 1) ? 'pre' : 'mixed';
  return { st, frac, fx };
}
/* ----- will he even be on the pitch? -----
   The projection used to hand every listed player his full expected return,
   nailed-on or flagged 25%. Marc asked (24 Aug 2026) whether we could weight
   this off Fantasy Football Scout's predicted line-ups; their team news is a
   paid product and scraping it is out, but we already fetch — and until now
   ignored — everything needed to do it ourselves:

     status   an injury, a ban or a departure is a hard nought
     chance   FPL's own availability %, the CEILING. It is their reading of the
              same press conference Scout writes up (fetch_fpl.py, `chance`)
     history  how often he has ACTUALLY started for us, from our own gameweek
              record, blended with last season's minutes while the sample is thin

   The one thing this cannot see is rotation of a fit man — FPL reports him at
   100% whether he is first choice or cup-tied. Our start history catches that
   after the fact rather than before it, which is the honest trade for not
   lifting somebody's paywalled copy. */
/* ----- somebody else's predicted XI -----
   Fantasy Football Scout publish a predicted eleven per club, updated the
   morning after a round and again as the pressers land. Their judgement is
   sharp exactly where our arithmetic is blind: rotation, a new signing, a man
   back from injury. scripts/scout_lineups.py reads it into data/lineups.json.

   It is never gospel. A club's entry counts only while it is FRESH — their own
   per-club stamp has to fall after the last round's deadline, or it is last
   week's team sheet and says nothing about this one. That test is the whole
   reason the stamp is parsed at all.

   These weights are estimates. Nobody knows yet whether Scout's XIs beat our
   own start history, and the calibration ledger is what will settle it. */
const SCOUT_PICKED = 0.92;    // they name him: strong, not certain — they are guessing too
const SCOUT_OMITTED = 0.2;    // named XI without him: he can still come on, or they can be wrong
function scoutXI(p, gwIdx) {
  const book = state.lineupsFeed?.clubs;
  const club = book && p && p.club && book[String(p.club).toUpperCase()];
  if (!club || !Array.isArray(club.xi) || !club.xi.length) return null;
  // stale is worse than silent: an XI last touched before the previous round
  // finished is not a prediction for this one
  // ON the previous deadline's date counts as stale, not fresh. Their stamp is
  // a date with no time, so "Fri 21st Aug" against a deadline of 21 Aug 17:30
  // cannot be told apart from the morning of the same day — and that morning's
  // XI is last round's team sheet. It went live reading exactly that way and
  // fed GW1's predictions into GW2 (Marc, 24 Aug 2026).
  const since = gwIdx > 0 ? gwFrom(gwIdx - 1) : null;
  if (since && club.updatedOn && club.updatedOn <= String(since).slice(0, 10)) return null;
  if (!club.updatedOn) return null;
  return club.xi.includes(p.id) ? SCOUT_PICKED : SCOUT_OMITTED;
}
function startChance(p, gwIdx) {
  if (!p) return 0;
  // already on the pitch this week: no longer a question of selection
  if (appearedInGw(p.id, gwIdx)) return 1;
  if (p.status && p.status !== 'a' && p.status !== 'd') return 0; // injured, banned, gone
  // NB `chance` is null for everyone the FPL desk has no news about, and
  // +null is 0 — read carelessly that is a 0% rating for the entire league,
  // and every projection on the site collapses to nothing
  const hasChance = p.chance !== null && p.chance !== undefined && p.chance !== '' && Number.isFinite(+p.chance);
  const cap = hasChance ? Math.max(0, Math.min(100, +p.chance)) / 100 : 1;
  if (!cap) return 0;
  // our own record: gameweeks his club actually played, and whether he started
  let played = 0, started = 0;
  for (let i = 0; i < GAMEWEEKS.length; i++) {
    if (gwStatus(i) !== 'final') continue;
    if (!teamFixturesInGw(p.team, GAMEWEEKS[i].n).length) continue; // blank week proves nothing
    played++;
    if (gwEvent(i)?.playerStats?.[p.id]?.st) started++;
  }
  // last season's share of the available minutes, as the prior. A new arrival
  // has no history either way, so he starts from the middle rather than zero.
  const ls = lastSeasonOf(p);
  const prior = ls && ls.mp ? Math.min(1, ls.mp / (38 * 90)) : 0.5;
  const w = Math.min(1, played / 5); // trust this season more with every round
  let rate = played ? (started / played) * w + prior * (1 - w) : prior;
  // a fresh predicted XI outranks our own back-catalogue — it is the only
  // signal here that knows about tomorrow rather than last month. It still
  // cannot lift a man past his availability: the cap below has the last word,
  // and an injury or a ban has already returned zero above.
  const scout = scoutXI(p, gwIdx);
  if (scout != null) rate = scout;
  return Math.max(0, Math.min(1, rate * cap));
}
function teamOutlook(mid, i) {
  const gwN = GAMEWEEKS[i].n;
  let exp = 0, varsum = 0, toPlay = 0;
  // liveXI, not effectiveXI: a sub that's already certain belongs in the
  // projection now, not at the final whistle (Marc, 23 Aug 2026)
  for (const pid of liveXI(mid, i).xi) {
    const p = PLAYER_BY_ID[pid];
    const cur = gwPlayerPoints(pid, i);
    const fs = playerFixtureState(p, gwN);
    // what is still to come is worth his expected return TIMES his chance of
    // being picked at all — a flagged man no longer projects a full afternoon
    const sc = startChance(p, i);
    const xp = playerXp(p);
    exp += cur + xp * fs.frac * sc;
    varsum += fs.frac * playerVariance(xp, sc);
    if (fs.frac > 0) toPlay++;
  }
  return { exp, varsum, toPlay };
}
// Φ(z), Abramowitz–Stegun
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3194815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
/* ----- win, DRAW and loss -----
   A fantasy score is a whole number, so two sides finishing dead level is a
   real result with real odds — and worth a table point (Marc, 24 Aug 2026:
   "is the draw factored into the projections... it probably should be").
   The bar used to read the difference off a continuous curve, which quietly
   says a tie cannot happen and folds its odds into the two teams beside it.
   A level tie with a couple of men left is nearer 13% drawn than 0%.

   So: a continuity correction, and three numbers off the same curve —
   a wins by 1 or more, they finish level, b wins by 1 or more. */
function matchOdds(a, b, i) {
  const A = teamOutlook(a, i), B = teamOutlook(b, i);
  const diff = A.exp - B.exp;
  const sigma = Math.sqrt(A.varsum + B.varsum);
  const live = A.toPlay + B.toPlay > 0;
  if (sigma < 0.5) {
    // nobody left to play: the result is arithmetic, not chance
    if (Math.abs(diff) < 0.5) return { win: 0, draw: 1, loss: 0 };
    return diff > 0 ? { win: 1, draw: 0, loss: 0 } : { win: 0, draw: 0, loss: 1 };
  }
  let win = 1 - normCdf((0.5 - diff) / sigma);
  let loss = normCdf((-0.5 - diff) / sigma);
  // never claim certainty while either side still has football to play
  if (live) {
    win = Math.min(0.99, Math.max(0.005, win));
    loss = Math.min(0.99, Math.max(0.005, loss));
  }
  const draw = Math.max(0, 1 - win - loss);
  const total = win + draw + loss;
  return { win: win / total, draw: draw / total, loss: loss / total };
}
// the old two-way reading, kept for the surfaces that only want "are we ahead":
// the draw is split between the sides so it still totals one
function liveWinProb(a, b, i) {
  const o = matchOdds(a, b, i);
  return o.win + o.draw / 2;
}
/* ----- "what do I need?" — the Opta desk's requirement sheet -----
   One pure calculation for every matchup surface. Sides are (a=left, b=right)
   exactly as the caller renders them; pov (a manager id, or null for a
   neutral) decides who the copy speaks to. Rendering consumes this — the
   requirement maths lives nowhere else. */
function matchNeeds(a, b, i, pov = null) {
  const A = teamOutlook(a, i), B = teamOutlook(b, i);
  const st = gwStatus(i) === 'final' ? 'final' : gwUnderway(i) ? 'live' : 'pre';
  const gwN = GAMEWEEKS[i].n;
  const remaining = mid => liveXI(mid, i).xi
    .map(pid => PLAYER_BY_ID[pid])
    .filter(p => p && playerFixtureState(p, gwN).frac > 0);
  // `current` stays the settlement number so it matches the scoreline above it;
  // `pending` is what the certain auto-subs will add at the final whistle
  const left = { mid: a, current: gwManagerPoints(a, i), pending: pendingSubPoints(a, i), projected: Math.round(A.exp), remainingPlayers: remaining(a), toPlay: A.toPlay };
  const right = { mid: b, current: gwManagerPoints(b, i), pending: pendingSubPoints(b, i), projected: Math.round(B.exp), remainingPlayers: remaining(b), toPlay: B.toPlay };
  // speak to the pov manager if they're in this tie, about-them otherwise
  const P = pov === b ? right : pov === a ? left : left;
  const O = P === left ? right : left;
  const neutral = pov !== a && pov !== b;
  const you = neutral ? esc(teamName(P.mid)) : 'You';
  const margin = P.current - O.current;
  const leader = left.current > right.current ? a : right.current > left.current ? b : null;
  const nameFew = ps => {
    const names = ps.slice(0, 2).map(p => esc(p.name));
    return ps.length > 2 ? `${names.join(', ')} and ${ps.length - 2} more` : names.join(' and ');
  };
  const lines = [];
  if (st === 'pre') {
    const gap = P.projected - O.projected;
    if (Math.abs(gap) < 2) lines.push('Nothing between them on the models.');
    else if (gap > 0) lines.push(neutral ? `${you} are projected to edge it by ${gap}.` : `Projected to edge it by ${gap}.`);
    else lines.push(neutral ? `${you} are projected to fall ${-gap} short.` : `Projected to fall ${-gap} short.`);
  } else if (st === 'final') {
    lines.push(margin > 0 ? `${neutral ? you + ' w' : 'W'}on by ${margin}.` : margin < 0 ? `${neutral ? you + ' l' : 'L'}ost by ${-margin}.` : 'Finished level.');
  } else {
    const pLeft = P.remainingPlayers, oLeft = O.remainingPlayers;
    if (margin === 0) {
      lines.push('All level. Next point takes the lead.');
      if (pLeft.length || oLeft.length) lines.push(`${you} have ${pLeft.length ? nameFew(pLeft) : 'nobody'} left; ${esc(teamName(O.mid))} ${oLeft.length ? nameFew(oLeft) : 'nobody'}.`);
    } else if (margin < 0) {
      const tieN = -margin, leadN = tieN + 1;
      if (!pLeft.length) {
        lines.push(`Nobody left. This now requires an official-stat correction${oLeft.length ? ` — and ${esc(teamName(O.mid))} still have ${nameFew(oLeft)} to come` : ''}.`);
      } else if (pLeft.length === 1) {
        lines.push(`${you} need ${leadN} from ${esc(pLeft[0].name)} to lead — ${tieN} ties it.`);
      } else if (!oLeft.length) {
        lines.push(`${you} need ${leadN} more points to take the lead (${nameFew(pLeft)} still out there).`);
      } else {
        lines.push(`Currently ${neutral ? esc(teamName(P.mid)) + ' need' : 'you need'} ${leadN} more than ${nameFew(oLeft)} produce — ${pLeft.length} of yours still going.`);
      }
    } else {
      if (!oLeft.length) {
        lines.push(`${you} lead by ${margin} and ${esc(teamName(O.mid))} have nobody left.`);
      } else {
        lines.push(`${you} lead by ${margin}, but ${esc(teamName(O.mid))} ${oLeft.length === 1 ? 'has' : 'have'} ${nameFew(oLeft)} remaining${pLeft.length ? '' : ' — and ' + (neutral ? `${esc(teamName(P.mid))} are` : 'you are') + ' done'}.`);
      }
    }
    // points already earned but not yet awarded: the auto-subs are certain,
    // the whistle just hasn't gone (Marc, 23 Aug 2026)
    const owed = [];
    if (P.pending) owed.push(`${neutral ? esc(teamName(P.mid)) : 'you'} ${P.pending > 0 ? '+' : ''}${P.pending}`);
    if (O.pending) owed.push(`${esc(teamName(O.mid))} ${O.pending > 0 ? '+' : ''}${O.pending}`);
    if (owed.length) lines.push(`Auto-subs still to be awarded — ${owed.join(', ')} at the final whistle.`);
  }
  // the third result. A point apiece is worth saying out loud once it is a real
  // possibility rather than a rounding error (Marc, 24 Aug 2026: "if a draw is
  // above 0.5% probability it should be called out as its own thing")
  // ...but only once it is under way. Before kickoff the sheet is deliberately
  // a single projection line and no requirements (matchday N1), and a 2% draw
  // before a ball is kicked is noise — the bar carries its own segment for it.
  const odds = matchOdds(a, b, i);
  if (st === 'live' && odds.draw > 0.005) {
    const pc = Math.round(odds.draw * 100);
    lines.push(pc >= 1
      ? `A point apiece is live at ${pc}%.`
      : 'A point apiece is a live outcome, if an unlikely one.');
  } else if (st === 'final' && margin === 0) {
    lines.push('A point apiece.');
  }
  return { state: st, left, right, leader, margin, drawChance: odds.draw, tieRequirement: margin < 0 ? -margin : 0, leadRequirement: margin < 0 ? -margin + 1 : 0, lines };
}

/* the Opta bar (Conway's ask, Lee-approved): live win chance + projected
   points for a matchup, recomputed every render as minutes tick down — you
   can go into Sunday 20:80 down and watch it swing. Pre-kickoff it's the pure
   squad-vs-squad projection; at full time it hands over to a result line. */
function winProbBar(a, b, i, pov = null) {
  const m = matchNeeds(a, b, i, pov);
  const needLine = m.lines.length ? `<div class="need-line">${m.lines.join(' ')}</div>` : '';
  if (m.state === 'final') return needLine ? `<div class="prob-wrap prob-final">${needLine}</div>` : '';
  // three-way, because a level finish is a real result worth a table point.
  // The percentages are rounded to total exactly 100 — a bar that reads
  // 87 / 4 / 10 invites an argument nobody can win.
  const o = matchOdds(a, b, i);
  let w = Math.round(o.win * 100), d = Math.round(o.draw * 100);
  let l = 100 - w - d;
  if (l < 0) { d += l; l = 0; }
  const live = m.state === 'live';
  return `<div class="prob-wrap" title="Win, draw and loss chance from each XI's expected points, ${live ? 'updating as the gameweek plays out' : 'squad vs squad before kickoff'}">
    <div class="prob-row"><span><b>${w}%</b> ${kitSvg(a)}</span><span class="prob-mid">${live ? '<span class="rec"></span> LIVE WIN CHANCE' : 'WIN CHANCE'}${d ? ` &middot; <span class="prob-draw-pct">draw ${d}%</span>` : ''}</span><span>${kitSvg(b)} <b>${l}%</b></span></div>
    <div class="prob-bar"><span style="width:${w}%"></span>${d ? `<span class="prob-draw" style="width:${d}%"></span>` : ''}</div>
    <div class="prob-row prob-sub"><span>${live ? `<b>${m.left.current}</b> &middot; proj ${m.left.projected}` : `proj ${m.left.projected}`}</span><span class="prob-mid">${live ? `${m.left.toPlay} v ${m.right.toPlay} still to play` : 'projected points'}</span><span>${live ? `<b>${m.right.current}</b> &middot; proj ${m.right.projected}` : `proj ${m.right.projected}`}</span></div>
    ${needLine}
  </div>`;
}

/* Marc, 18 Aug: "can we do something about the players out on loan /
   transferred out. It seems a bit pointless having them included on the list?"

   FPL status 'u' is not a fitness flag. An injury means back in a month; this
   means "Has joined Como permanently" or "on loan for the rest of the season" —
   he will not play another Premier League minute and cannot score for anybody
   again. Treating it as an injury put Chalobah at #42 on the board on last
   season's 136 points while he plays in Italy.

   So: departed men are their own category. Kept OUT of the pools by default,
   skipped by autopick (that rule lives in engine.js — the live draft picks on
   the server), and left visible in a squad that already owns one, because a
   squad must never quietly lose a man. */
const hasLeft = p => !!p && p.status === 'u';
// on loan and sold read the same to us — he is not playing here either way —
// but the copy can say which, because the feed tells us
const leftHow = p => /\bloan\b/i.test(p?.news || '') ? 'on loan' : 'transferred';
const leftTag = p => hasLeft(p)
  ? `<span class="tag left-tag" title="${esc(p.news || 'No longer in the Premier League')}">LEFT</span>` : '';

// injury/availability chip from the FPL status flag
const STATUS_ICON = { d: '⚠️', i: '🏥', s: '🟥', u: '✈️', n: '🚫' };
const statusChip = p => STATUS_ICON[p.status]
  ? `<span class="status-chip" title="${esc(p.news || (hasLeft(p) ? 'No longer in the Premier League' : 'Unavailable'))}">${STATUS_ICON[p.status]}</span>` : '';
// red ring/tint for the crocked and banned, amber for doubts — used on chips and table rows
// A provisional (Marc, 19 Aug) carries a hand-written price and therefore a
// hand-written Rate. Both sit in the same columns as everyone's real FPL
// figures, so say so on the board — nobody should draft off a number the
// Committee invented without knowing that is what it is.
const provChip = p => p?.provisional
  ? '<span class="prov-chip" title="Committee placeholder \u2014 signed, but not yet in the FPL feed. Price and Rate are estimates, and he scores nothing until he lands.">PROV</span>' : '';
const statusClass = p => p.status === 'a' ? '' : p.status === 'd' ? 'st-amber' : 'st-red';
function toast(msg) {
  const el = $('#toast') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'toast' }));
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2600);
}
function normName(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function managerName(mid) { return state.managers.find(m => m.id === mid)?.name || `Manager ${mid}`; }
function teamName(mid) { const m = state.managers.find(m => m.id === mid); return m?.team || m?.name || `Manager ${mid}`; }

/* ----- club kits: every team gets a shirt, everywhere its name appears ----- */
const KIT_PATTERNS = ['plain', 'stripes', 'hoops', 'sash', 'halves'];
// pre-customisation defaults: a deterministic two-colour kit per manager
const KIT_DEFAULTS = [
  ['#2dd4a7', '#0b3b2e'], ['#e05555', '#ffffff'], ['#4f8ce8', '#ffffff'], ['#e8b64c', '#101010'],
  ['#9b59d0', '#ffffff'], ['#ffffff', '#101010'], ['#f08030', '#0b1a3a'], ['#3fb96d', '#ffffff'],
  ['#101010', '#e8b64c'], ['#b7e4f7', '#0b1a3a'], ['#e88aa0', '#101010'], ['#f4f4f4', '#5a1414'],
];
function kitFor(mid) {
  const m = state.managers.find(x => x.id === mid);
  if (m?.kit?.pattern) return m.kit;
  const [c1, c2] = KIT_DEFAULTS[(mid - 1 + KIT_DEFAULTS.length) % KIT_DEFAULTS.length];
  return { pattern: 'plain', c1, c2 };
}
function sponsorFor(mid) { return state.managers.find(x => x.id === mid)?.sponsor || ''; }
// the gaffer in the dugout: an archetype off the FM-style stable, or homemade
function gafferFor(mid) {
  const g = state.managers.find(x => x.id === mid)?.gaffer;
  if (g == null) return null;
  if (typeof g === 'number') return GAFFERS[g] || null;
  return { t: g.t, e: '🧢', bio: g.bio || '', fm: { badges: 'Unverifiable', playing: 'Undisclosed', media: 'No comment' } };
}
// the No. 2 beside him: house-issue by default (every club gets one — the
// briefing card needs a voice from day one), an archetype off the stable, or
// homemade. Clearing goes back to house-issue; there is no vacant No. 2.
function assistantFor(mid) {
  const a = state.managers.find(x => x.id === mid)?.assistant;
  if (typeof a === 'number' && ASSISTANTS[a]) return ASSISTANTS[a];
  if (a && typeof a === 'object' && a.t) return { t: a.t, e: '🤝', bio: a.bio || '' };
  return ASSISTANTS[(mid * 5 + 2) % ASSISTANTS.length];
}
function gafferChip(mid) {
  const g = gafferFor(mid);
  return g ? `<span class="tag" title="${esc(g.bio)}&#10;Coaching badges: ${esc(g.fm.badges)}&#10;Playing career: ${esc(g.fm.playing)}&#10;Media handling: ${esc(g.fm.media)}">${g.e} ${esc(g.t)}</span>` : '';
}
// a wearable SVG shirt: pattern clipped to the jersey, sponsor across the chest
function kitSvg(mid, size = 18, showSponsor = false) {
  return kitSvgRaw(kitFor(mid), showSponsor ? sponsorFor(mid) : '', size, `kc${mid}-${size}${showSponsor ? 's' : ''}`);
}
function kitSvgRaw(k, sponsor, size, uid) {
  const body = 'M10 4 L15 1 Q20 5 25 1 L30 4 L36 10 L31 16 L29 14 L29 39 L11 39 L11 14 L9 16 L4 10 Z';
  const pat = k.pattern === 'stripes' ? `<rect x="13" y="0" width="4" height="40"/><rect x="21" y="0" width="4" height="40"/><rect x="29" y="0" width="4" height="40"/>`
    : k.pattern === 'hoops' ? `<rect x="0" y="10" width="40" height="5"/><rect x="0" y="20" width="40" height="5"/><rect x="0" y="30" width="40" height="5"/>`
    : k.pattern === 'sash' ? `<rect x="14" y="-12" width="7" height="64" transform="rotate(30 20 20)"/>`
    : k.pattern === 'halves' ? `<rect x="20" y="0" width="20" height="40"/>`
    : '';
  // sponsor sits on the chest (x 11.5–28.5): font scales down with name
  // length and long names compress via textLength so nothing bleeds onto the
  // sleeves (Marc's "not sized right", 1 Aug)
  const spTxt = String(sponsor || '').slice(0, 14);
  const spFs = spTxt.length <= 6 ? 4.6 : spTxt.length <= 10 ? 3.8 : 3.1;
  const spFit = spTxt.length * spFs * 0.66 > 17 ? ' textLength="17" lengthAdjust="spacingAndGlyphs"' : '';
  const sp = spTxt
    ? `<text x="20" y="26" text-anchor="middle" font-size="${spFs}" font-weight="800" font-family="inherit" fill="${k.pattern === 'halves' ? k.c1 : k.c2}" stroke="${k.pattern === 'halves' ? k.c2 : k.c1}" stroke-width="${(spFs * 0.24).toFixed(2)}" paint-order="stroke" letter-spacing=".2"${spFit}>${esc(spTxt)}</text>`
    : '';
  return `<svg class="club-kit" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><defs><clipPath id="${uid}"><path d="${body}"/></clipPath></defs><path d="${body}" fill="${k.c1}"/><g clip-path="url(#${uid})" fill="${k.c2}">${pat}</g><path d="M15 1 Q20 5 25 1 L23 3 Q20 6 17 3 Z" fill="${k.c2}"/><path d="${body}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/>${sp}</svg>`;
}
/* ----- the crest: heraldry off the College of Arms in js/lore.js (Lee,
   12 Aug — "upload your own club badge"; hosting twelve JPEGs was never on).
   crest = { shape, div, charge, c1, c2 }, charge null = the monogram; crest
   null entirely = house-issue (kit colours, chief, initials). Bounds mirrored
   by cleanCrest in functions/. */
const crestMonogram = name => String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
function crestSvg(mid, size = 18) {
  const m = state.managers.find(x => x.id === mid);
  return crestSvgRaw(m?.crest || null, kitFor(mid), teamName(mid), size, `cs${mid}-${size}`);
}
function crestSvgRaw(c, kit, name, size, uid) {
  const shape = (c && CREST_SHAPES[c.shape]) || CREST_SHAPES[0];
  const div = c ? (CREST_DIVISIONS[c.div] || CREST_DIVISIONS[0]) : CREST_DIVISIONS[1];
  const c1 = c?.c1 || kit.c1, c2 = c?.c2 || kit.c2;
  const chg = c && Number.isInteger(c.charge) ? CREST_CHARGES[c.charge] : null;
  const inner = chg
    ? `<g transform="translate(8,13)" stroke="${c1}" stroke-width="0.6" paint-order="stroke">${chg.m.replace(/__C__/g, c2).replace(/__F__/g, c1)}</g>`
    : `<text x="20" y="30.5" text-anchor="middle" font-size="13" font-weight="800" font-family="inherit" fill="${c2}" stroke="${c1}" stroke-width="0.9" paint-order="stroke" letter-spacing=".3">${esc(crestMonogram(name))}</text>`;
  return `<svg class="club-crest" viewBox="0 0 40 44" width="${size}" height="${Math.round(size * 1.1)}" aria-hidden="true"><defs><clipPath id="${uid}"><path d="${shape.d}"/></clipPath></defs><path d="${shape.d}" fill="${c1}"/><g clip-path="url(#${uid})" fill="${c2}">${div.m}</g><g clip-path="url(#${uid})">${inner}</g><path d="${shape.d}" fill="none" stroke="${c2}" stroke-width="1.4" opacity="0.85"/><path d="${shape.d}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/></svg>`;
}
// name + shirt, for everywhere a team is written down
function teamTag(mid) { return `${kitSvg(mid)} ${esc(teamName(mid))}`; }
// declared rivalries: mutual = a clásico, one-sided = a derby only one of them
// believes in (which is funnier)
function rivalOf(mid) { return rivalsOf(mid)[0] || null; }
// all declared rivals — the multi-rival array first, the legacy single second
function rivalsOf(mid) {
  const m = state.managers.find(x => x.id === mid);
  if (!m) return [];
  const arr = toArr(m.rivals).filter(x => x !== mid);
  return arr.length ? arr : (m.rival && m.rival !== mid ? [m.rival] : []);
}
function derbyTag(a, b) {
  const ab = rivalsOf(a).includes(b), ba = rivalsOf(b).includes(a);
  if (ab && ba) return '<span class="tag derby-tag">&#128293; EL CL&Aacute;SICO</span>';
  if (ab || ba) return `<span class="tag derby-tag" title="Declared by ${esc(teamName(ab ? a : b))}. ${esc(teamName(ab ? b : a))} remains unaware.">&#128293; derby (one&#8209;sided)</span>`;
  return '';
}

/* ----- the recruitment department: raw material for "Surprise me" ----- */
// distinct shirt colours with real coverage of the wheel — pairs are picked
// with a contrast floor so no one leaves the office in beige-on-beige
const SURPRISE_KIT_COLOURS = [
  '#ffffff', '#101010', '#e05555', '#4f8ce8', '#e8b64c', '#2dd4a7', '#9b59d0',
  '#f08030', '#3fb96d', '#b7e4f7', '#e88aa0', '#0b1a3a', '#5a1414', '#0b3b2e',
  '#f4f4f4', '#7a4a12',
];
// perceived luminance, enough precision for shirt-vs-trim
function kitLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(n >> 16 & 255) + 0.7152 * ch(n >> 8 & 255) + 0.0722 * ch(n & 255);
}
function kitContrast(a, b) {
  const la = kitLum(a), lb = kitLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// grounds the recruitment department has scouted, for owners who never named one
const SURPRISE_STADIA = [
  'The Theatre of Broken Dreams', 'Fortress Allotment', 'The Bovril Bowl',
  'Three Points Lane', 'The Maracanã of the North', 'The Big Ikea',
  'Substandard Liège Arena', 'The Crab Bank', 'Pylon View',
  'The Retractable Roofless', 'Gazebo Park', 'The San Cissé',
];

/* ----- the club office: name, kit, sponsor — first-login ceremony and
   forever after. Changes go through the server like everything else. ----- */
function clubEditor(mid) {
  if (!actGuard(mid, 'club')) return;
  const m = state.managers.find(x => x.id === mid);
  // stale board indices (a hoarding later retired from the catalogue) render
  // nothing — drop them here so they can't eat a slot of the three
  const savedBoards = [...(m?.boards || [])].filter(i => Number.isInteger(i) && i >= 0 && i < AD_BOARDS.length);
  const savedGaffer = typeof m?.gaffer === 'number' && !GAFFERS[m.gaffer] ? null : (m?.gaffer ?? null);
  const savedAssistant = typeof m?.assistant === 'number' && !ASSISTANTS[m.assistant] ? null : (m?.assistant ?? null);
  const draft = { team: teamName(mid), kit: { ...kitFor(mid) }, sponsor: sponsorFor(mid), rivals: [...rivalsOf(mid)], stadium: stadium(mid), boards: savedBoards, gaffer: savedGaffer, assistant: savedAssistant, crest: m?.crest ? { ...m.crest } : null };
  const stock = AD_BOARDS.map(b => b.t);
  const allSp = [...stock, ...RETRO_SPONSORS]; // a saved classic must not present as "Make one up"
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const paint = () => {
    const prev = ov.querySelector('#kitPreview');
    if (prev) prev.innerHTML = kitSvgRaw(draft.kit, draft.sponsor, 120, 'kprev');
    const cprev = ov.querySelector('#crestPreview');
    if (cprev) cprev.innerHTML = crestSvgRaw(draft.crest, draft.kit, draft.team, 78, 'crprev');
    ov.querySelectorAll('[data-cshape]').forEach(b => b.classList.toggle('active', !!draft.crest && +b.dataset.cshape === draft.crest.shape));
    ov.querySelectorAll('[data-cdiv]').forEach(b => b.classList.toggle('active', !!draft.crest && +b.dataset.cdiv === draft.crest.div));
    ov.querySelectorAll('[data-ccharge]').forEach(b => b.classList.toggle('active', !!draft.crest && (b.dataset.ccharge === '' ? draft.crest.charge == null : +b.dataset.ccharge === draft.crest.charge)));
    ov.querySelectorAll('[data-pat]').forEach(b => b.classList.toggle('active', b.dataset.pat === draft.kit.pattern));
    ov.querySelectorAll('[data-board]').forEach(b => b.classList.toggle('active', draft.boards.includes(+b.dataset.board)));
    ov.querySelectorAll('[data-gaffer]').forEach(b => b.classList.toggle('active', draft.gaffer === +b.dataset.gaffer));
    ov.querySelectorAll('[data-assist]').forEach(b => b.classList.toggle('active', draft.assistant === +b.dataset.assist));
  };
  // extras open when any is already chosen — a founder editing their boards
  // shouldn't have to hunt for them behind a closed drawer
  const extrasOpen = draft.boards.length || draft.gaffer != null || draft.assistant != null || draft.rivals.length;
  ov.innerHTML = `<div class="card club-office" role="dialog" aria-modal="true" aria-label="The club office" style="max-width:460px;width:94%">
    <h2>The Club Office${whoami && mid !== whoami ? ` <span class="tag live-tag">acting for ${esc(teamName(mid))}</span>` : ''}</h2>
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:12px">
      <div id="kitPreview" style="flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <label class="muted" style="font-size:11px">TEAM NAME</label>
        <input id="clubName" maxlength="30" value="${esc(draft.team)}" style="width:100%" />
        <label class="muted" style="font-size:11px;margin-top:8px;display:block">SPONSOR — off the hoardings, or make one up</label>
        <select id="clubSpSel" style="width:100%">
          <option value="">No sponsor</option>
          <optgroup label="Off the hoardings">${stock.map(t => `<option value="${esc(t)}"${draft.sponsor === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>
          <optgroup label="The classics shelf">${RETRO_SPONSORS.map(t => `<option value="${esc(t)}"${draft.sponsor === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>
          <option value="__own"${draft.sponsor && !allSp.includes(draft.sponsor) ? ' selected' : ''}>Make one up…</option>
        </select>
        <input id="clubSpOwn" maxlength="20" placeholder="Your sponsor (20 chars)" value="${draft.sponsor && !allSp.includes(draft.sponsor) ? esc(draft.sponsor) : ''}" style="width:100%;margin-top:6px;display:${draft.sponsor && !allSp.includes(draft.sponsor) ? 'block' : 'none'}" />
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <button class="btn ghost small" id="clubLuck" title="Fill anything you haven't decided — never touches what you have">&#127922; Surprise me</button>
      <span class="muted" id="luckLine" role="status" aria-live="polite" style="font-size:11px"></span>
    </div>
    <label class="muted" style="font-size:11px">KIT PATTERN</label>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 10px">
      ${KIT_PATTERNS.map(p => `<button class="btn ghost small" data-pat="${p}">${p}</button>`).join('')}
    </div>
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">
      <label class="muted" style="font-size:11px">SHIRT <input type="color" id="clubC1" value="${draft.kit.c1}"></label>
      <label class="muted" style="font-size:11px">TRIM <input type="color" id="clubC2" value="${draft.kit.c2}"></label>
    </div>
    <label class="muted" style="font-size:11px">THE CREST — house-issue monogram, or cut your own at the College of Arms</label>
    <div style="display:flex;gap:12px;align-items:flex-start;margin:6px 0 12px">
      <div id="crestPreview" style="flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:5px">
          ${CREST_SHAPES.map((s, i) => `<button class="btn ghost small" data-cshape="${i}" style="font-size:10.5px">${esc(s.t)}</button>`).join('')}
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:5px">
          ${CREST_DIVISIONS.map((d, i) => `<button class="btn ghost small" data-cdiv="${i}" style="font-size:10.5px">${esc(d.t)}</button>`).join('')}
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
          <button class="btn ghost small icon-btn" data-ccharge="" title="The monogram — your initials, house style" style="font-weight:800">${esc(crestMonogram(draft.team))}</button>
          ${CREST_CHARGES.map((ch, i) => `<button class="btn ghost small icon-btn" data-ccharge="${i}" title="${esc(ch.t)}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${ch.m.replace(/__C__/g, 'currentColor').replace(/__F__/g, 'var(--card)')}</svg></button>`).join('')}
        </div>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
          <label class="muted" style="font-size:11px">FIELD <input type="color" id="crestC1" value="${draft.crest?.c1 || draft.kit.c1}"></label>
          <label class="muted" style="font-size:11px">CHARGE <input type="color" id="crestC2" value="${draft.crest?.c2 || draft.kit.c2}"></label>
          <button class="btn ghost small" id="crestReset" title="Back to the house-issue crest — kit colours, your initials">House-issue</button>
        </div>
      </div>
    </div>
    <label class="muted" style="font-size:11px">YOUR GROUND</label>
    <input id="clubStadium" maxlength="40" value="${esc(draft.stadium)}" style="width:100%;margin:4px 0 10px" />
    <details class="club-extras"${extrasOpen ? ' open' : ''}>
      <summary>The extras — hoardings, gaffer, assistant, rival</summary>
      <label class="muted" style="font-size:11px">PITCH-SIDE HOARDINGS — pick up to three for home games</label>
      <div id="clubBoards" style="display:flex;gap:5px;flex-wrap:wrap;margin:4px 0 10px">
        ${AD_BOARDS.map((b, i) => `<button class="btn ghost small" data-board="${i}" style="font-size:10px">${esc(b.t)}</button>`).join('')}
      </div>
      <label class="muted" style="font-size:11px">THE GAFFER — who's in your dugout?</label>
      <div id="gafferGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin:4px 0 6px">
        ${GAFFERS.map((g, i) => `<button class="btn ghost gaffer-card" data-gaffer="${i}" title="Coaching badges: ${esc(g.fm.badges)}&#10;Playing career: ${esc(g.fm.playing)}&#10;Media handling: ${esc(g.fm.media)}">
          <b>${g.e} ${esc(g.t)}</b><span class="muted">${esc(g.bio)}</span>
        </button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn ghost small" id="gafferOwn">Make one up…</button>
        <button class="btn ghost small" id="gafferNone">Vacant dugout</button>
      </div>
      <label class="muted" style="font-size:11px">THE ASSISTANT MANAGER — the No. 2 who briefs you on My Team</label>
      <div id="assistGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin:4px 0 6px">
        ${ASSISTANTS.map((g, i) => `<button class="btn ghost gaffer-card" data-assist="${i}">
          <b>${g.e} ${esc(g.t)}</b><span class="muted">${esc(g.bio)}</span>
        </button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn ghost small" id="assistOwn">Make one up…</button>
        <button class="btn ghost small" id="assistNone">House-issue, thanks</button>
      </div>
      <label class="muted" style="font-size:11px">RIVALS — declare up to three derbies. They don't get a say.</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:4px 0 14px">
        ${state.managers.filter(x => x.id !== mid).map(x => `<label style="font-size:12px;display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" data-rival="${x.id}" ${draft.rivals.includes(x.id) ? 'checked' : ''}> ${esc(x.team || x.name)}</label>`).join('')}
      </div>
    </details>
    <div class="club-actions">
      <button class="btn ghost" id="clubCancel" style="flex:1">Cancel</button>
      <button class="btn" id="clubSave" style="flex:1">Save the lot</button>
    </div></div>`;
  document.body.appendChild(ov);
  pushOvState();
  paint();
  // dialog focus contract: keyboard lands inside the office on open and goes
  // back where it came from on close (however the office closed)
  const prevFocus = document.activeElement;
  const origRemove = ov.remove.bind(ov);
  ov.remove = () => { origRemove(); if (prevFocus && document.contains(prevFocus)) try { prevFocus.focus(); } catch { /* gone */ } };
  ov.querySelector('#clubName').focus();
  // "Surprise me" session ledger: which fields arrived saved-custom, which the
  // manager has touched by hand this session. Editor-local only — nothing here
  // persists or travels; the draft object stays the single source of truth.
  const savedCustom = {
    kit: !!m?.kit, sponsor: !!m?.sponsor, boards: savedBoards.length > 0,
    gaffer: savedGaffer != null, assistant: savedAssistant != null, stadium: !!m?.stadium,
    crest: !!m?.crest,
  };
  const touched = new Set();
  const luckEligible = () => ['kit', 'sponsor', 'boards', 'gaffer', 'assistant', 'stadium', 'crest'].filter(f => !savedCustom[f] && !touched.has(f));
  ov.querySelector('#clubName').oninput = e => { draft.team = e.target.value; };
  ov.querySelectorAll('[data-pat]').forEach(b => b.onclick = () => { touched.add('kit'); draft.kit.pattern = b.dataset.pat; paint(); });
  ov.querySelector('#clubC1').oninput = e => { touched.add('kit'); draft.kit.c1 = e.target.value; paint(); };
  ov.querySelector('#clubC2').oninput = e => { touched.add('kit'); draft.kit.c2 = e.target.value; paint(); };
  // the College of Arms: first touch of any control materialises a crest off
  // the house-issue; the reset button hands it back
  const crest0 = () => draft.crest || (draft.crest = { shape: 0, div: 1, charge: null, c1: draft.kit.c1, c2: draft.kit.c2 });
  ov.querySelectorAll('[data-cshape]').forEach(b => b.onclick = () => { touched.add('crest'); crest0().shape = +b.dataset.cshape; paint(); });
  ov.querySelectorAll('[data-cdiv]').forEach(b => b.onclick = () => { touched.add('crest'); crest0().div = +b.dataset.cdiv; paint(); });
  ov.querySelectorAll('[data-ccharge]').forEach(b => b.onclick = () => { touched.add('crest'); crest0().charge = b.dataset.ccharge === '' ? null : +b.dataset.ccharge; paint(); });
  ov.querySelector('#crestC1').oninput = e => { touched.add('crest'); crest0().c1 = e.target.value; paint(); };
  ov.querySelector('#crestC2').oninput = e => { touched.add('crest'); crest0().c2 = e.target.value; paint(); };
  ov.querySelector('#crestReset').onclick = () => { touched.add('crest'); draft.crest = null; ov.querySelector('#crestC1').value = draft.kit.c1; ov.querySelector('#crestC2').value = draft.kit.c2; paint(); toast('Back to the house-issue crest.'); };
  const spSel = ov.querySelector('#clubSpSel'), spOwn = ov.querySelector('#clubSpOwn');
  spSel.onchange = () => {
    touched.add('sponsor');
    spOwn.style.display = spSel.value === '__own' ? 'block' : 'none';
    draft.sponsor = spSel.value === '__own' ? spOwn.value.trim() : spSel.value;
    paint();
  };
  spOwn.oninput = () => { touched.add('sponsor'); draft.sponsor = spOwn.value.trim(); paint(); };
  ov.querySelectorAll('[data-rival]').forEach(cb => cb.onchange = () => {
    const id = +cb.dataset.rival;
    if (cb.checked && draft.rivals.length >= 3) { cb.checked = false; toast('Three rivals is enough hatred for anyone.'); return; }
    draft.rivals = cb.checked ? [...draft.rivals, id] : draft.rivals.filter(r => r !== id);
  });
  ov.querySelector('#clubStadium').oninput = e => { touched.add('stadium'); draft.stadium = e.target.value; };
  ov.querySelectorAll('[data-gaffer]').forEach(b => b.onclick = () => { touched.add('gaffer'); draft.gaffer = +b.dataset.gaffer; paint(); });
  ov.querySelector('#gafferNone').onclick = () => { touched.add('gaffer'); draft.gaffer = null; paint(); toast('The dugout stands empty.'); };
  ov.querySelector('#gafferOwn').onclick = () => {
    const t = prompt('Your gaffer (30 characters):', typeof draft.gaffer === 'object' && draft.gaffer ? draft.gaffer.t : '');
    if (!t || t.trim().length < 2) return;
    touched.add('gaffer');
    const bio = prompt('One-line bio (60 characters):', typeof draft.gaffer === 'object' && draft.gaffer ? draft.gaffer.bio || '' : '') || '';
    draft.gaffer = { t: t.trim().slice(0, 30), bio: bio.trim().slice(0, 60) };
    paint();
    toast(`${draft.gaffer.t} — appointed.`);
  };
  ov.querySelectorAll('[data-assist]').forEach(b => b.onclick = () => { touched.add('assistant'); draft.assistant = +b.dataset.assist; paint(); });
  ov.querySelector('#assistNone').onclick = () => { touched.add('assistant'); draft.assistant = null; paint(); toast('Back to the house-issue No. 2.'); };
  ov.querySelector('#assistOwn').onclick = () => {
    const t = prompt('Your assistant manager (30 characters):', typeof draft.assistant === 'object' && draft.assistant ? draft.assistant.t : '');
    if (!t || t.trim().length < 2) return;
    touched.add('assistant');
    const bio = prompt('One-line bio (60 characters):', typeof draft.assistant === 'object' && draft.assistant ? draft.assistant.bio || '' : '') || '';
    draft.assistant = { t: t.trim().slice(0, 30), bio: bio.trim().slice(0, 60) };
    paint();
    toast(`${draft.assistant.t} — on the staff.`);
  };
  ov.querySelectorAll('[data-board]').forEach(b => b.onclick = () => {
    touched.add('boards');
    const i = +b.dataset.board;
    if (draft.boards.includes(i)) draft.boards = draft.boards.filter(x => x !== i);
    else if (draft.boards.length >= 3) { toast('Three hoardings max — this is a tidy ground'); return; }
    else draft.boards.push(i);
    paint();
  });
  // the recruitment department: fills only what the manager has neither saved
  // nor touched this session. Rerolls hit the same set — a manual edit takes a
  // field off the table for good. Draft-only; Save decides, like everything.
  ov.querySelector('#clubLuck').onclick = () => {
    const R = () => (window.__surpriseRand || Math.random)();
    const pick = arr => arr[Math.floor(R() * arr.length) % arr.length];
    const fields = luckEligible();
    const line = ov.querySelector('#luckLine');
    if (!fields.length) {
      line.textContent = 'Nothing to improvise — every inch of this club is already yours.';
      return;
    }
    for (const f of fields) {
      if (f === 'kit') {
        draft.kit.pattern = pick(KIT_PATTERNS);
        const c1 = pick(SURPRISE_KIT_COLOURS);
        // scan from a random offset for a partner with real contrast — the
        // palette contains white and near-black, so one always exists
        const start = Math.floor(R() * SURPRISE_KIT_COLOURS.length);
        let c2 = c1;
        for (let k = 0; k < SURPRISE_KIT_COLOURS.length; k++) {
          const cand = SURPRISE_KIT_COLOURS[(start + k) % SURPRISE_KIT_COLOURS.length];
          if (cand !== c1 && kitContrast(c1, cand) >= 2) { c2 = cand; break; }
        }
        draft.kit.c1 = c1; draft.kit.c2 = c2;
        ov.querySelector('#clubC1').value = c1;
        ov.querySelector('#clubC2').value = c2;
      } else if (f === 'sponsor') {
        draft.sponsor = pick(AD_BOARDS).t;
        spSel.value = draft.sponsor;
        spOwn.style.display = 'none';
      } else if (f === 'boards') {
        const pool = AD_BOARDS.map((_, i) => i);
        const n = 1 + Math.floor(R() * 3) % 3;
        draft.boards = [];
        for (let k = 0; k < n && pool.length; k++) draft.boards.push(pool.splice(Math.floor(R() * pool.length) % pool.length, 1)[0]);
      } else if (f === 'gaffer') {
        draft.gaffer = Math.floor(R() * GAFFERS.length) % GAFFERS.length;
      } else if (f === 'assistant') {
        draft.assistant = Math.floor(R() * ASSISTANTS.length) % ASSISTANTS.length;
      } else if (f === 'stadium') {
        draft.stadium = pick(SURPRISE_STADIA);
        ov.querySelector('#clubStadium').value = draft.stadium;
      } else if (f === 'crest') {
        const c1 = pick(SURPRISE_KIT_COLOURS);
        const start = Math.floor(R() * SURPRISE_KIT_COLOURS.length);
        let c2 = c1;
        for (let k = 0; k < SURPRISE_KIT_COLOURS.length; k++) {
          const cand = SURPRISE_KIT_COLOURS[(start + k) % SURPRISE_KIT_COLOURS.length];
          if (cand !== c1 && kitContrast(c1, cand) >= 2) { c2 = cand; break; }
        }
        draft.crest = {
          shape: Math.floor(R() * CREST_SHAPES.length) % CREST_SHAPES.length,
          div: Math.floor(R() * CREST_DIVISIONS.length) % CREST_DIVISIONS.length,
          charge: Math.floor(R() * CREST_CHARGES.length) % CREST_CHARGES.length,
          c1, c2,
        };
        ov.querySelector('#crestC1').value = c1;
        ov.querySelector('#crestC2').value = c2;
      }
    }
    paint();
    line.textContent = 'The recruitment department has improvised.';
  };
  // once a save is dispatched it cannot be un-sent — Cancel and the backdrop
  // go dead until the server answers, so a mid-flight dismiss can't pretend
  // the save didn't happen
  let saving = false;
  ov.querySelector('#clubCancel').onclick = () => { if (!saving) closeOv(ov); };
  ov.onclick = e => { if (e.target === ov && !saving) closeOv(ov); };
  ov.querySelector('#clubSave').onclick = async () => {
    const team = draft.team.trim();
    if (team.length < 2) { toast('A club needs a name — 2 characters minimum'); return; }
    const stadiumName = draft.stadium.trim();
    if (!stadiumName) { toast('A ground needs a name'); return; }
    if (netOn()) {
      // the office closes and the founding is marked ONLY on server success —
      // a rejected save keeps the form (and everything typed into it) open
      const btn = ov.querySelector('#clubSave');
      const cnl = ov.querySelector('#clubCancel');
      saving = true; btn.disabled = true; btn.textContent = 'Saving…'; cnl.disabled = true;
      try {
        await serverAct('clubSet', { team, kit: draft.kit, sponsor: draft.sponsor || null, rivals: draft.rivals.length ? draft.rivals : null, stadium: stadiumName, boards: draft.boards.length ? draft.boards : null, gaffer: draft.gaffer, assistant: draft.assistant, crest: draft.crest, ...(mid !== whoami && { asManager: mid }) });
      } catch {
        saving = false; btn.disabled = false; btn.textContent = 'Save the lot'; cnl.disabled = false;
        return; // serverAct already toasted why
      }
      localStorage.setItem(`${LS_NS}-founded-${mid}`, '1');
      closeOv(ov);
      toast('The club is founded. Wear it well.');
      return;
    }
    const idx = state.managers.findIndex(x => x.id === mid);
    state.managers[idx] = { ...state.managers[idx], team, kit: { ...draft.kit }, sponsor: draft.sponsor || null, rivals: draft.rivals.length ? [...draft.rivals] : null, rival: draft.rivals[0] || null, stadium: stadiumName, boards: draft.boards.length ? [...draft.boards] : null, gaffer: draft.gaffer, assistant: draft.assistant, crest: draft.crest ? { ...draft.crest } : null };
    localStorage.setItem(`${LS_NS}-founded-${mid}`, '1');
    save(); render();
    closeOv(ov);
    toast('The club is founded. Wear it well.');
  };
}
// the founding card: shown until the club has been to the office. In the demo
// it fronts for manager #1 so visitors can see the toy without signing in.
function foundingCard() {
  const mid = (whoami && whoami !== -1) ? whoami : (demoMode ? state.managers[0].id : null);
  if (!mid) return '';
  const m = state.managers.find(x => x.id === mid);
  if (!m || m.kit || localStorage.getItem(`${LS_NS}-founded-${mid}`)) return '';
  return `<div class="card" style="border-color:var(--accent)">
    <h2>Found your club ${kitSvg(mid, 22)} ${crestSvg(mid, 20)}</h2>
    <p class="rules-p">You've inherited <b>${esc(teamName(mid))}</b>. Keep the name or take a new one —
    then cut your kit and crest, sign a shirt sponsor, name your ground, line it with hoardings,
    appoint your gaffer and declare your biggest rival. It all goes on show across the league.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="foundBtn" data-mid="${mid}">Open the club office</button>
      <button class="btn ghost small" id="foundLater" data-mid="${mid}">Maybe later</button>
    </div></div>`;
}

/* ----- club records: the numbers the fans actually chant about ----- */
function clubRecords(mid) {
  const cur = currentGwIndex();
  const myPicks = state.draft.picks.filter(pk => pk.managerId === mid);
  const everIds = new Set(myPicks.map(pk => pk.playerId));
  for (const t of state.transfers) if (t.managerId === mid) everIds.add(t.inId);
  let scorer = null;
  for (const pid of everIds) {
    const c = contributedPoints(mid, pid);
    if (c > 0 && (!scorer || c > scorer.c)) scorer = { p: PLAYER_BY_ID[pid], c };
  }
  // longest-serving: current squad member with the earliest arrival —
  // draft-night originals outrank any signing
  const draftees = new Set(myPicks.map(pk => pk.playerId));
  const arrivals = {};
  for (const t of state.transfers) if (t.managerId === mid) arrivals[t.inId] = t.gw ?? 0;
  let served = null;
  for (const p of managerSquad(mid)) {
    const original = draftees.has(p.id) && arrivals[p.id] === undefined;
    const gwIn = original ? -1 : (arrivals[p.id] ?? -1);
    if (!served || gwIn < served.gwIn) served = { p, gwIn, original };
  }
  let bestPick = null;
  for (const pk of myPicks) {
    const c = contributedPoints(mid, pk.playerId);
    if (c > 0 && (!bestPick || c > bestPick.c)) bestPick = { p: PLAYER_BY_ID[pk.playerId], c, n: pk.n };
  }
  // worst transfer: signed, given time, delivered the least
  let worst = null;
  for (const t of state.transfers) {
    if (t.managerId !== mid || t.trade) continue;
    if ((t.gw ?? 0) >= cur) continue; // hasn't had a chance yet
    const p = PLAYER_BY_ID[t.inId];
    if (!p) continue;
    const c = contributedPoints(mid, t.inId);
    if (!worst || c < worst.c) worst = { p, c, gw: t.gw };
  }
  let win = null, high = null;
  for (let i = 0; i < REGULAR_GWS; i++) {
    if (gwStatus(i) !== 'final') continue;
    const mine = gwManagerPoints(mid, i);
    if (!high || mine > high.pts) high = { pts: mine, gw: i };
    const pr = pairingsFor(i).find(x => x.includes(mid));
    if (pr) {
      const opp = pr[0] === mid ? pr[1] : pr[0];
      const theirs = gwManagerPoints(opp, i);
      if (mine > theirs && (!win || mine - theirs > win.margin)) win = { margin: mine - theirs, opp, gw: i, mine, theirs };
    }
  }
  return { scorer, served, bestPick, worst, win, high };
}

// the records as one-line rows — My Club card and the table's tap-a-club
// breakdown share this, so the public view costs no extra page furniture
function clubRecordsHtml(mid) {
  const rec = clubRecords(mid);
  const gwN = i => GAMEWEEKS[i]?.n ?? '?';
  const recRow = (label, val, sub) => `<div class="lrow" style="font-size:12.5px;display:flex;gap:10px;flex-wrap:wrap"><span class="muted">${label}</span><span style="margin-left:auto;text-align:right"><b>${val}</b>${sub ? ` <span class="muted" style="font-size:11px">${sub}</span>` : ''}</span></div>`;
  return [
    rec.scorer ? recRow('Record points scorer', `${esc(rec.scorer.p.name)}`, `${rec.scorer.c} pts`) : '',
    rec.served ? recRow('Longest-serving player', esc(rec.served.p.name), rec.served.original ? 'ever-present since draft night' : `signed GW${gwN(rec.served.gwIn)}`) : '',
    rec.bestPick ? recRow('Best draft pick', esc(rec.bestPick.p.name), `pick #${rec.bestPick.n} · ${rec.bestPick.c} pts`) : '',
    rec.worst ? recRow('Worst transfer', esc(rec.worst.p.name), `${rec.worst.c} pt${rec.worst.c === 1 ? '' : 's'} since GW${gwN(rec.worst.gw)}`) : '',
    rec.win ? recRow('Biggest win', `${rec.win.mine}&ndash;${rec.win.theirs} v ${esc(teamName(rec.win.opp))}`, `GW${gwN(rec.win.gw)}`) : '',
    rec.high ? recRow('Highest GW score', `${rec.high.pts} pts`, `GW${gwN(rec.high.gw)}`) : '',
  ].filter(Boolean);
}

/* ----- supporters' mood: results-driven, board-approved, entirely unfair -----
   Last three results + league position → one of six moods. Pre-season is
   its own mood: everyone is unbeaten in August. */
function supportersMood(mid) {
  const finals = [];
  for (let i = 0; i < REGULAR_GWS; i++) {
    if (gwStatus(i) !== 'final') continue;
    const pr = pairingsFor(i).find(x => x.includes(mid));
    if (!pr) continue;
    const opp = pr[0] === mid ? pr[1] : pr[0];
    const mine = gwManagerPoints(mid, i), theirs = gwManagerPoints(opp, i);
    finals.push(mine > theirs ? 3 : mine === theirs ? 1 : 0);
  }
  const g = gafferFor(mid);
  const gaffer = g ? g.t : 'the gaffer';
  if (!finals.length) return { t: 'Pre-season optimism', line: 'Everyone is unbeaten in August. Scarves selling briskly.' };
  // averaged over the games actually played, then scaled to a 3-game window —
  // a club that has won its only match is in dreamland, not the concourse
  const last3 = finals.slice(-3);
  const form = Math.round(last3.reduce((a, b) => a + b, 0) / last3.length * 3); // 0–9
  const pos = h2hStandings(false).findIndex(r => r.id === mid) + 1;
  const n = state.managers.length;
  const score = form + (pos <= 2 ? 3 : pos <= 4 ? 2 : pos <= 8 ? 1 : pos >= n - 1 ? -2 : 0);
  const MOODS = [
    [11, 'DREAMLAND', `Songs about ${gaffer} to the tune of Sloop John B. Open-top bus routes being sketched.`],
    [8, 'Cautious optimism', 'Programmes selling well. Nobody wants to say it out loud.'],
    [6, 'Quietly concerned', 'Polite applause at full time. The fanzine ran a worried editorial.'],
    [4, 'Grumbling in the concourse', 'The pies are getting blamed for things pies cannot control.'],
    [2, 'Board meeting scheduled', `${gaffer} retains the board's full confidence, which historically means nothing.`],
    [-99, 'PROTEST MARCH PLANNED', 'A plane banner is being costed. The Committee has been made aware.'],
  ];
  const m = MOODS.find(([min]) => score >= min);
  return { t: m[1], line: m[2] };
}

/* ----- the club profile: one renderer for My Club AND the public directory.
   editable=true adds the office button — public profiles NEVER get it. ----- */
function clubProfileHtml(mid, { editable = false } = {}) {
  const m = state.managers.find(x => x.id === mid);
  const g = gafferFor(mid);
  const myRivals = rivalsOf(mid);
  const enemies = state.managers.filter(x => x.id !== mid && rivalsOf(x.id).includes(mid));
  const boards = (m?.boards || []).map(i => AD_BOARDS[i]).filter(Boolean);
  const mood = supportersMood(mid);
  const recRows = clubRecordsHtml(mid);
  return `
  <div class="card" style="text-align:center">
    <div style="display:flex;justify-content:center;align-items:center;gap:20px;margin:6px 0 10px">${crestSvgRaw(m?.crest || null, kitFor(mid), teamName(mid), 84, `clubcrest${mid}${editable ? '' : 'p'}`)}${kitSvgRaw(kitFor(mid), sponsorFor(mid), 140, `clubpage${mid}${editable ? '' : 'p'}`)}</div>
    <h2 style="margin-bottom:2px">${esc(teamName(mid))}</h2>
    <p class="muted" style="font-size:12px">${esc(managerName(mid))} &middot; est. 2015 &middot; ${esc(stadium(mid))}</p>
    ${sponsorFor(mid) ? `<p class="muted" style="font-size:11.5px">Principal partner: <b>${esc(sponsorFor(mid))}</b></p>` : ''}
    <p style="margin-top:10px"><span class="tag" style="font-size:12px">&#128227; Supporters&rsquo; mood: <b>${esc(mood.t)}</b></span></p>
    <p class="muted" style="font-size:11.5px;margin-top:4px">${esc(mood.line)}</p>
    ${editable ? '<button class="btn" id="clubEdit" style="margin-top:10px">The club office — change anything</button>' : ''}
  </div>
  <div class="card" style="margin-top:14px">
    <h2>Club Records <span class="muted" style="font-weight:400;font-size:12px">what the ultras chant</span></h2>
    ${recRows.length ? recRows.join('') : '<p class="muted" style="font-size:12.5px">The record books open at GW1. Every one of these is currently yours for the taking.</p>'}
  </div>
  <div class="card" style="margin-top:14px">
    <h2>The Dugout</h2>
    ${g ? `<p style="font-size:14px"><b>${g.e} ${esc(g.t)}</b></p><p class="muted" style="font-size:12.5px;margin:4px 0 8px">${esc(g.bio)}</p>
      <div class="lrow" style="font-size:12px;display:flex;gap:10px"><span class="muted">Coaching badges</span><b style="margin-left:auto">${esc(g.fm.badges)}</b></div>
      <div class="lrow" style="font-size:12px;display:flex;gap:10px"><span class="muted">Playing career</span><b style="margin-left:auto">${esc(g.fm.playing)}</b></div>
      <div class="lrow" style="font-size:12px;display:flex;gap:10px"><span class="muted">Media handling</span><b style="margin-left:auto">${esc(g.fm.media)}</b></div>`
      : '<p class="muted">The dugout stands vacant. The board is monitoring the situation.</p>'}
    <p style="font-size:12.5px;margin-top:10px"><span class="muted">Assistant manager:</span> <b>${assistantFor(mid).e} ${esc(assistantFor(mid).t)}</b></p>
    <p class="muted" style="font-size:11.5px;margin-top:2px">${esc(assistantFor(mid).bio)}</p>
  </div>
  <div class="card" style="margin-top:14px">
    <h2>Rivalries</h2>
    ${myRivals.length ? myRivals.map(r => `<p style="font-size:13px">Declared: <b>${teamTag(r)}</b> ${derbyTag(mid, r)}</p>`).join('') : '<p class="muted">No declared rivals. The office calls this cowardice.</p>'}
    ${enemies.map(x => `<p style="font-size:12.5px" class="muted">${teamTag(x.id)} has declared YOU.${myRivals.includes(x.id) ? '' : ' You remain officially unaware.'}</p>`).join('')}
  </div>
  ${boards.length ? `<div class="card" style="margin-top:14px"><h2>${esc(stadium(mid))} — Matchday</h2>${adStrip(mid * 7, 3, mid)}</div>` : ''}`;
}

/* ----- My Club: the identity on permanent display, changeable whenever ----- */
function viewClub() {
  const mid = (whoami && whoami !== -1) ? whoami : (demoMode ? state.managers[0].id : null);
  if (!mid) {
    return `<div class="card" style="text-align:center;padding:40px">
      <h2>Whose club?</h2>
      <p class="rules-p">Sign in and this page becomes your club — kit, gaffer, ground, rivals, the lot.</p>
      <button class="btn" id="clubSignIn">Sign in</button></div>`;
  }
  return clubProfileHtml(mid, { editable: true });
}
function bindClub() {
  const ce = $('#clubEdit');
  if (ce) ce.onclick = () => clubEditor((whoami && whoami !== -1) ? whoami : state.managers[0].id);
  const cs = $('#clubSignIn');
  if (cs) cs.onclick = () => { spectating = false; localStorage.removeItem(SPECT_KEY); whoami = null; forceIdentity = true; render(); };
}

/* ----- the club directory: all twelve clubs on public display ----- */
// whose club page would this device see as "mine" — the one profile allowed
// an office button. Public profiles never get one.
function ownClubMid() { return (whoami && whoami !== -1) ? whoami : (demoMode ? state.managers[0].id : null); }
function directoryOrder() {
  // constitutional order until a result exists; league position after — with
  // the constitution as the stable tiebreak (h2hStandings keys rows by id, so
  // equal records fall back to manager order by construction)
  const rows = h2hStandings(false);
  return rows.some(r => r.p > 0) ? rows.map(r => r.id) : state.managers.map(m => m.id);
}
function viewDirectory() {
  const cards = directoryOrder().map(mid => {
    const m = state.managers.find(x => x.id === mid);
    const mood = supportersMood(mid);
    const dirRivals = rivalsOf(mid);
    const opened = !!m?.kit; // server-backed: clubSet always saves a kit
    return `<button type="button" class="dir-card" data-dirmid="${mid}" aria-label="${esc(teamName(mid))} — club profile">
      <div class="dir-kit">${kitSvg(mid, 44, true)}${crestSvg(mid, 30)}</div>
      <div class="dir-body">
        <b class="dir-team">${esc(teamName(mid))}</b>
        <span class="muted dir-line">${esc(managerName(mid))} &middot; ${esc(stadium(mid))}</span>
        ${sponsorFor(mid) ? `<span class="muted dir-line">Principal partner: ${esc(sponsorFor(mid))}</span>` : ''}
        ${gafferFor(mid) ? `<span class="dir-line">${gafferChip(mid)}</span>` : ''}
        ${(() => {
          // first pick on draft night (Ben, GW1 eve) — a club's founding
          // signing belongs on its record
          const pk = (state.draft.picks || []).filter(x => x.managerId === mid).sort((a, b) => a.n - b.n)[0];
          const p = pk && PLAYER_BY_ID[pk.playerId];
          return p ? `<span class="muted dir-line">First pick: <b style="color:var(--text)">${esc(p.name)}</b> (#${pk.n} overall)</span>` : '';
        })()}
        <span class="dir-line"><span class="tag" style="font-size:10.5px">&#128227; ${esc(mood.t)}</span></span>
        ${dirRivals.length ? `<span class="dir-rivals"><span class="dir-rivals-h">Rival${dirRivals.length === 1 ? '' : 's'}</span>${dirRivals.map(r => `<span class="dir-rival"><span class="dir-rival-who">${teamTag(r)}</span>${derbyTag(mid, r)}</span>`).join('')}</span>` : ''}
        ${opened ? '' : '<span class="muted dir-line" style="font-style:italic">Office unopened</span>'}
      </div>
    </button>`;
  });
  return `<div class="card">
    <h2>The Club Directory <span class="muted" style="font-weight:400;font-size:12px">every club, on the record</span></h2>
    <div class="dir-grid">${cards.join('')}</div>
  </div>`;
}
function bindDirectory() {
  document.querySelectorAll('[data-dirmid]').forEach(b => b.onclick = () => showClubProfile(+b.dataset.dirmid));
}
// the read-only profile pop-over: same renderer as My Club, office button only
// on your own club. Back (or ✕) returns to the directory where you left it.
function showClubProfile(mid) {
  $('#clubProfileOverlay')?.remove();
  const editable = ownClubMid() === mid;
  const ov = document.createElement('div');
  ov.id = 'clubProfileOverlay';
  ov.className = 'overlay';
  ov.innerHTML = `<div class="card club-profile-ov" role="dialog" aria-modal="true" aria-label="${esc(teamName(mid))} — club profile">
    <div style="display:flex;justify-content:flex-end;margin-bottom:-6px"><button class="btn ghost small icon-btn" id="profClose" aria-label="Close profile">&#10005;</button></div>
    ${clubProfileHtml(mid, { editable })}
  </div>`;
  ov.onclick = e => { if (e.target === ov || e.target.id === 'profClose') closeOv(ov); };
  document.body.appendChild(ov);
  pushOvState();
  const prevFocus = document.activeElement;
  const origRemove = ov.remove.bind(ov);
  ov.remove = () => { origRemove(); if (prevFocus && document.contains(prevFocus)) try { prevFocus.focus(); } catch { /* gone */ } };
  ov.querySelector('#profClose').focus();
  const ce = ov.querySelector('#clubEdit');
  if (ce) ce.onclick = () => { closeOv(ov); clubEditor(mid); };
}
// default grounds, until the owner sells the naming rights (tap the stadium name on My Team)
const DEFAULT_STADIA = {
  1: 'The Kennel',                                // The Dog's Polaks
  2: 'The Great Hall of the People',              // Chairman Mao *°
  3: 'El Benfield Metropolitano',                 // Atlético Benfield
  4: 'Stadio Giuseppe Jackson',                   // Interjacksonale*
  5: 'The Khusanova Arena (naming rights disputed)', // Champagne Khusanova FC
  6: 'The Hot Gates',                             // Singer's Spartans
  7: 'The Asterisk Bowl*',                        // Asterick
  8: 'The Motherboard',                           // 101011101
  9: 'The Pond',                                  // Mighty 🦆 *
  10: 'Balaídos-upon-Leigh',                      // Celta Leigh-Go
  11: 'The Dog Track',                            // Geldog FC
  12: 'The WACA',                                 // WA Wanderers
};
function stadium(mid) { const m = state.managers.find(m => m.id === mid); return m?.stadium || DEFAULT_STADIA[mid] || `${teamName(mid)} Park`; }
// pitch-side hoardings — the league's proud commercial partners, rotating each
// week; a home manager's OWN sponsors (MANAGER_BOARDS) lead their fixtures
function adStrip(seed, n = 3, homeMid = null) {
  if (typeof AD_BOARDS === 'undefined' || !AD_BOARDS.length) return '';
  let s = (seed * 2654435761) % 2147483648;
  const boards = [];
  // the home side's SHIRT sponsor leads their strip — including made-up ones,
  // which get a board synthesised in their kit colours
  const homeM = homeMid != null ? state.managers.find(x => x.id === homeMid) : null;
  if (homeM?.sponsor) {
    const stock = AD_BOARDS.find(bd => bd.t === homeM.sponsor);
    const k = kitFor(homeMid);
    boards.push(stock || { t: homeM.sponsor.toUpperCase(), s: `principal partner of ${teamName(homeMid)}`, c: k.c1, bg: '#10141c' });
  }
  // then their picked hoardings; the group chat's commissioned boards fall back
  const picked = homeM ? (homeM.boards || []).map(i => AD_BOARDS[i]).filter(Boolean).filter(bd => bd.t !== homeM.sponsor) : [];
  if (picked.length) {
    boards.push(...picked.slice(0, Math.max(0, n - boards.length)));
  } else {
    const own = (typeof MANAGER_BOARDS !== 'undefined' && homeMid != null) ? MANAGER_BOARDS[homeMid] : null;
    if (own && own.length && boards.length < n) {
      s = (s * 1103515245 + 12345) % 2147483648;
      boards.push(own[s % own.length]);
    }
  }
  const pool = AD_BOARDS.map((_, i) => i);
  while (boards.length < n && pool.length) {
    s = (s * 1103515245 + 12345) % 2147483648;
    boards.push(AD_BOARDS[pool.splice(s % pool.length, 1)[0]]);
  }
  // boards can carry manager-typed text (custom sponsors) — escape everything
  return `<div class="ad-strip">${boards.map(b =>
    `<span class="ad-board" style="color:${esc(b.c)};background:${esc(b.bg)}"><b>${esc(b.t)}</b><i>${esc(b.s)}</i></span>`
  ).join('')}</div>`;
}
// matchday attendance: deterministic per fixture, so every device reports the same crowd
function attendance(a, b, i) {
  let s = a * 7919 + b * 104729 + i * 1299709;
  s = (s * 1103515245 + 12345) % 2147483648;
  return 8000 + (s % 34000);
}

/* ---------------- rosters (draft + transfers) ---------------- */
function squadAt(mid, gwIdx) {
  const ids = new Set(state.draft.picks.filter(p => p.managerId === mid).map(p => p.playerId));
  for (const t of state.transfers) {
    if (t.managerId !== mid || t.gw > gwIdx) continue;
    ids.delete(t.outId);
    ids.add(t.inId);
  }
  return [...ids].map(id => PLAYER_BY_ID[id]);
}
function managerSquad(mid) {
  // "the squad as it stands": rolls past settled rounds so the window's
  // signings — which land in the UPCOMING gameweek — are in it the moment
  // they land. Ian, 25 Aug: fresh Trough signings read "not my player" in
  // the club office, and All Squads showed everyone's pre-waiver fourteen,
  // because this still read the played round until Friday's deadline.
  let g = currentGwIndex();
  while (g < GAMEWEEKS.length - 1 && gwStatus(g) === 'final') g++;
  return squadAt(mid, g);
}
function posCount(mid) {
  const c = { GK: 0, DF: 0, MF: 0, FW: 0 };
  managerSquad(mid).forEach(p => c[p.pos]++);
  return c;
}
function ownedIdsAt(gwIdx) {
  const ids = new Set();
  for (const m of state.managers) for (const p of squadAt(m.id, gwIdx)) ids.add(p.id);
  return ids;
}
// one-flex squads: exactly 14 inside the constitutional bounds. No club cap —
// Tussie's right to draft the entire City team by GW30 is constitutionally protected.
function squadShapeOk(squad) {
  if (squad.length !== SQUAD_RULES.size) return false; // exact size — swaps can't shrink/grow a squad
  if (new Set(squad.map(p => p.id)).size !== squad.length) return false; // nobody owns a player twice
  const c = { GK: 0, DF: 0, MF: 0, FW: 0 };
  squad.forEach(p => c[p.pos]++);
  return ['GK', 'DF', 'MF', 'FW'].every(pos => c[pos] >= SQUAD_RULES.min[pos] && c[pos] <= SQUAD_RULES.max[pos]);
}
function shirtNum(mid, pid) {
  return state.shirtNums?.[mid]?.[pid] ?? '–';
}

/* ---------------- waivers & the Trough ----------------
   Committee timing v2 (Toby, 12 Aug 2026): runs at 10am (London) every Tuesday
   and Friday — fixed days, no longer chasing the fixture list; the Chairman
   can skip one named run by exception. The Trough closes 90 minutes before a
   gameweek's first kick-off and reopens once the first run after its last
   fixture has executed. Claims are ranked and blind; order = reverse
   standings, winners drop to the back; dropped players go back on waivers.
   Mirrors js/engine.js. */

const gwKicks = g => {
  // fixtures may not have arrived yet (a freshly seeded state before its
  // first feed sync — the pods render harness boots exactly this way)
  const ts = (state.fixtures || []).filter(f => f && f.gw === g + 1 && f.date).map(f => new Date(f.date).getTime());
  return ts.length ? { first: Math.min(...ts), last: Math.max(...ts) } : null;
};
function londonOffsetMin(ms) {
  const s = new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const m = s.match(/(\d+)\/(\d+)\/(\d+),? (\d+):(\d+)/);
  return m ? Math.round((Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] % 24, +m[5]) - ms) / 60000) : 0;
}
/* The waiver clock, v2 (Committee, 12 Aug 2026): runs at 10:00 Europe/London
 * every TUESDAY and FRIDAY. The Chairman can skip one named run by exception
 * (waiverMeta.skip); claims stay lodged and roll to the next run. Mirrors
 * js/engine.js — the server adjudicates with the same arithmetic. */
const WAIVER_DAYS = [2, 5]; // getUTCDay() of the London wall-date: Tue, Fri
const WAIVER_HOUR = 10;     // 10:00 Europe/London
const WAIVER_EPOCH = Date.UTC(2026, 7, 13); // schedule v2 begins 13 Aug 2026
function londonAt(ms, dayOffset, hour) {
  const wall = new Date(ms + londonOffsetMin(ms) * 60000);
  const naive = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + dayOffset, hour, 0);
  return naive - londonOffsetMin(naive) * 60000;
}
const londonWall = at => new Date(at + londonOffsetMin(at) * 60000);
const waiverSlotId = at => {
  const d = londonWall(at);
  return `wv-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
// first Tue/Fri 10:00 London slot strictly after ms (never before the epoch)
function nextSlotAt(ms) {
  const from = Math.max(ms, WAIVER_EPOCH - 3600e3);
  for (let off = 0; off <= 8; off++) {
    const at = londonAt(from, off, WAIVER_HOUR);
    if (at <= from) continue;
    if (WAIVER_DAYS.includes(londonWall(at).getUTCDay())) return at;
  }
  return null;
}
// the first run that can clear a finished gameweek (kick-offs are never at
// 10am London, so a slot can't land mid-match)
const gwClearAt = g => { const k = gwKicks(g); return k ? nextSlotAt(k.last) : null; };
// the league's FRONT-PAGE gameweek (Ben, 25 Aug: the post-round waiver run
// "signifies a new gameweek"): a settled round stays current until the first
// run after its last fixture has processed, then attention turns to the next.
// Drives the Dashboard hero and the Matches page default. My Team rolls
// earlier, at settlement — planning starts before the paperwork.
function leagueGwIndex() {
  let g = currentGwIndex();
  while (g < REGULAR_GWS - 1 && gwStatus(g) === 'final'
    && gwClearAt(g) != null && lastWaiverRun() >= gwClearAt(g)) g++;
  return g;
}
// the round you are PLANNING for: the first that has not settled. No waiver run
// in the condition — a fixture-difficulty table or a "next six" runway is about
// football still to be played, and a round already in the books belongs in
// neither however the paperwork stands. My Team has rolled this way since UAT
// night (Wilko: "it's still defaulting to gameweek 1"); this is that same loop,
// named, because the Data Room needed it too (Marc, 26 Aug 2026).
function planningGwIndex() {
  let g = currentGwIndex();
  while (g < GAMEWEEKS.length - 1 && gwStatus(g) === 'final') g++;
  return g;
}
/* Ham Cup selection window: opens 7 days before the tie's first kickoff (or
 * at the draw / Chairman's early-open if later); the Trough freezes at open */
const HAM_WINDOW_MS = 7 * 24 * 3600e3;
const hamTs = v => (typeof v === 'number' ? v : (v ? new Date(v).getTime() : 0));
function hamOpensAt(hc) {
  if (!hc || hc.gw == null) return null;
  if (hc.openedAt) return hamTs(hc.openedAt);
  const k = gwKicks(hc.gw);
  const drawn = hamTs(hc.drawnAt);
  return k ? Math.max(drawn, k.first - HAM_WINDOW_MS) : drawn;
}
function nextWaiverRun(afterTs) {
  const t = typeof afterTs === 'number' ? afterTs : new Date(afterTs).getTime();
  return new Date(nextSlotAt(t) ?? (t + 7 * 864e5));
}
/* The run the scheduler will actually PROCESS next. The hourly tick fires at
 * :07 past, so a slot stays live for up to an hour after its advertised
 * 10:00 — a due-but-unexecuted slot keeps priority over the following one
 * (sol launch audit, 13 Aug: a Skip pressed at 10:03 stamped TUESDAY's run
 * while Friday's claims still executed at 10:07). Anything a Skip button or a
 * "next run" line shows the Chairman must come from here, never from
 * nextWaiverRun(now). Mirrors js/engine.js; same lookback as the server tick. */
function nextProcessableWaiverRun() {
  const t = Date.now();
  // DISPLAY horizon: 2 hours, deliberately narrower than the engine's 14-day
  // catch-up window. The hourly tick takes a due slot within the hour, so a
  // slot still "due" after 2h was consumed by the server's run ledger — which
  // this client cannot read (it marks pre-season slots "skipped: not in
  // season"). GW1 eve: lastRun null made the previous Friday look due and
  // every surface promised "waivers process in any minute now" while the
  // Chairman was telling the group there'd be no run at all. The SERVER keeps
  // the full 14-day lookback — that divergence is the point, not a drift.
  const due = nextSlotAt(Math.max(lastWaiverRun(), t - 2 * 3600e3));
  return due != null && due <= t ? new Date(due) : nextWaiverRun(t);
}
// ...and the same, stepping over a Chairman-skipped slot (display truth)
function nextLiveWaiverRun() {
  let run = nextProcessableWaiverRun().getTime();
  while (state.waiverMeta?.skip === waiverSlotId(run)) run = nextWaiverRun(run).getTime();
  return new Date(run);
}
const waiverControl = () => state.waiverMeta?.control || 'auto';
const lastWaiverRun = () => state.waiverMeta?.lastRun ? new Date(state.waiverMeta.lastRun).getTime() : 0;
function waiverRunDue() {
  if (state.phase !== 'season' || waiverControl() !== 'auto') return false;
  const t = Date.now(), lr = lastWaiverRun();
  // 14-day lookback matches the engine's — the horizons drifted (sol P3, 14 Aug)
  for (let at = nextSlotAt(t - 14 * 86400e3); at != null && at <= t; at = nextSlotAt(at)) {
    // a Chairman-skipped slot is not due — its claims roll to the next run
    if (at > lr && waiverSlotId(at) !== state.waiverMeta?.skip) return true;
  }
  return false;
}
// Trough state under auto control — closed during play, reopens post-waivers.
// A Simulation Chamber matchday closes it on the mock clock (mirrors engine.js).
function troughWindow() {
  const mk = state.mock;
  if (mk && mk.gw != null) {
    if (mk.phase === 'live') return { open: false, until: null, mock: true, why: 'the gameweek is underway (simulation)' };
    if (mk.phase === 'final' && lastWaiverRun() < hamTs(mk.t)) return { open: false, until: null, mock: true, why: 'awaiting the post-gameweek waiver run (simulation)' };
  }
  const t = Date.now();
  let cur = -1;
  for (let g = 0; g < GAMEWEEKS.length; g++) {
    const k = gwKicks(g);
    if (k && k.first - 90 * 60000 <= t) cur = g;
    else if (k && cur >= 0) break;
  }
  if (cur < 0) return { open: true };
  const post = gwClearAt(cur);
  if (post == null) return { open: true };
  if (t < post) return { open: false, until: post, why: 'the gameweek is underway' };
  if (lastWaiverRun() < post) return { open: false, until: null, why: 'awaiting the post-gameweek waiver run' };
  return { open: true };
}
// the waiver clock, spoken plainly with a countdown (Toby via Committee,
// 9 Aug: the times move with the fixtures, so the app must do the tracking)
function waiverClockLine() {
  const tw = troughWindow();
  const t = Date.now();
  const fmtIn = ms => {
    if (ms <= 60000) return 'any minute now';
    const d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 3600e3), m = Math.floor(ms % 3600e3 / 60000);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  };
  if (tw.mock) return `Trough shut — ${tw.why}.`;
  const ctl = waiverControl();
  if (ctl === 'open') return 'The Trough is thrown open by the Chairman — no clock tonight.';
  if (ctl === 'closed') return 'The Trough is closed by the Chairman until further notice.';
  if (!tw.open) {
    return tw.until
      ? `Trough shut — ${tw.why}. Waivers run in <b>${fmtIn(tw.until - t)}</b> (${fmtWhen(tw.until)}).`
      : `Trough shut — ${tw.why}.`;
  }
  const scheduled = nextProcessableWaiverRun().getTime();
  const skipped = state.waiverMeta?.skip === waiverSlotId(scheduled);
  const run = skipped ? nextWaiverRun(scheduled).getTime() : scheduled;
  let shut = null;
  for (let g = 0; g < GAMEWEEKS.length; g++) {
    const k = gwKicks(g);
    if (k && k.first - 90 * 60000 > t) { shut = k.first - 90 * 60000; break; }
  }
  const events = [];
  if (run) events.push([run, `waivers process in <b>${fmtIn(run - t)}</b> (${fmtWhen(run)})${skipped ? ` — the Chairman skipped ${fmtWhen(scheduled)}'s run` : ''}`]);
  if (shut != null) events.push([shut, `Trough shuts in <b>${fmtIn(shut - t)}</b> (${fmtWhen(shut)})`]);
  events.sort((a, b) => a[0] - b[0]);
  return events.length ? `Trough open — ${events.map(e => e[1]).join(' &middot; ')}.` : 'Trough open.';
}
/* Live-match fast lane (Ben, 9 Aug: "shame it's not instant"): CI pushes the
 * live gameweek's stats into public/liveStats roughly every minute during
 * matches. This overlay is DISPLAY-ONLY freshness on top of the canonical
 * Pages feed — it never outranks a fresher feed sync, never touches a final
 * round, and stays out of the sandbox (the
 * Chamber owns pretend matchdays) and the demo. */
function applyLiveStats() {
  const lv = state.liveStats;
  if (!lv || !lv.playerStats || !lv.n) return;
  if (SANDBOX || demoMode || state.mock) return;
  // an old overlay is NOT dropped on age alone (28 Aug, Palace v City: the
  // whistle went, the overlay aged past ten minutes, and every phone fell back
  // to a half-time Pages feed — "points … gone backwards", Toby). The last
  // live write is the full-time picture; only a FRESHER canonical feed
  // retires it. The header pill still says how old the data is.
  if (state.feedGenerated && new Date(state.feedGenerated).getTime() > lv.t) return; // feed is fresher
  const key = `gw${lv.n}`;
  const ev = state.matchStats[key];
  if (ev && ev.final) return; // a settled round is never repainted
  // live fixture truth rides along with the overlay: scores, minutes and the
  // provisional whistle (fp) land within a minute, so "still to play", the
  // pill and the scoreboards stop waiting on the Pages feed's slow flags
  if (Array.isArray(lv.fx)) {
    for (const lf of lv.fx) {
      const f = state.fixtures.find(x => x.id === lf.id);
      if (!f) continue;
      if (lf.hs != null) f.hs = lf.hs;
      if (lf.as != null) f.as = lf.as;
      if (lf.started) f.started = true;
      if (lf.fp) f.fp = true;
      if ((lf.min || 0) > (f.minutes || 0)) f.minutes = lf.min;
    }
  }
  // the tape watches the overlay too (Ben, GW1 Saturday evening: "the
  // vidiprinter isn't working"). The fast lane silently refreshed matchStats
  // every minute, so by the time the Pages feed arrived, syncNow's diff — the
  // only place the Vidiprinter listened — had nothing left to say. Diff each
  // NEW overlay stamp against what was showing before it lands.
  const prevPS = ev?.playerStats || null;
  state.matchStats[key] = { gw: lv.n - 1, label: ev?.label || `GW${lv.n}`, date: ev?.date, final: false, playerStats: lv.playerStats };
  // diff AFTER the stats land, like syncNow does — the tape's tie scores come
  // from gwManagerPoints, which reads state (Ben, 23 Aug: "some of the scores
  // looked wrong" — the tape was scoring ties off stale stats and a raw XI)
  if (lv.t !== vidiLiveT && state.phase === 'season') {
    try { vidiKlaxon(lv.n - 1, prevPS, lv.playerStats); } catch (e) { console.warn('[vidi]', e); }
    vidiLiveT = lv.t;
  }
}
let vidiLiveT = 0; // last overlay stamp the tape has diffed — one report per write
/* Layer 4 of the live fast lane (GW1 night: the overlay went quiet and the
 * lads had to guess): the freshest stamp we hold for live scores — the fast
 * lane's write time or the canonical feed's build time, whichever is newer. */
function liveDataAgeMs() {
  const stamps = [];
  const lv = state.liveStats;
  if (lv && lv.t && !SANDBOX && !demoMode && !state.mock) stamps.push(lv.t);
  if (state.feedGenerated) { const t = new Date(state.feedGenerated).getTime(); if (t) stamps.push(t); }
  return stamps.length ? Math.max(0, Date.now() - Math.max(...stamps)) : null;
}
// compact by design: the pill lives in the 320px header (r3ui overflow guard)
const fmtLiveAge = ms => ms < 100e3 ? `${Math.max(0, Math.round(ms / 1000))}s`
  : ms < 3600e3 ? `${Math.round(ms / 60000)}m` : `${Math.round(ms / 3600e3)}h`;
// is this player currently stuck on waivers (claim-only), or free to sign now?
function onWaivers(p) {
  const tw = troughWindow();
  if (tw.mock) return true; // the chamber's clock beats every manual control
  const ctl = waiverControl();
  if (ctl === 'closed') return true;
  // a fresh drop waits for the next run EVEN under a Chairman's manual open —
  // "thrown open" frees the pool, never the waiver rule (Toby, 9 Aug; DF canon)
  for (const t of state.transfers) {
    if (t.outId === p.id && (t.t || 0) > lastWaiverRun()) return true;
  }
  if (ctl === 'open') return false;
  if (!tw.open) return true;
  return false;
}

/* ---------------- new arrivals & the Window Draft ----------------
   League tradition: anyone who joins a PL club after draft night is locked
   until the transfer window shuts. The Chairman then runs the Window Draft —
   snaking backwards from the original order (pick 12 goes first) until a full
   lap of passes — and whatever's left spills into the Trough. */
// Only a player the draft-night snapshot has never seen is an arrival. Moving
// between two PL clubs is not arriving — he was already on the game and
// already drafted, and he stays with his owner (Marc, 21 Aug). Keep this
// identical to js/engine.js or the server will refuse an XI the client offered.
const isArrival = p => !!state.draftPool?.ids && state.draftPool.ids[p.id] === undefined;
const arrivalLocked = p => isArrival(p); // unlocks when the Window Draft ends (snapshot refreshes)
function lockedArrivals() {
  if (!state.draftPool?.ids) return [];
  const owned = ownedIdsAt(currentGwIndex());
  return PLAYERS.filter(p => isArrival(p) && !owned.has(p.id));
}
function wdActor() {
  const wd = state.windowDraft, ord = wd.order;
  const lap = Math.floor(wd.turn / ord.length), i = wd.turn % ord.length;
  return lap % 2 === 0 ? ord[i] : ord[ord.length - 1 - i];
}
// turn / passes / picks are shared bookkeeping written by whoever's on the
// clock AND the Chairman — a transaction stops two devices clobbering each
// other and rewinding the draft. newPick (if any) is appended atomically.
const wdMutate = wd => {
  if (!wd) return undefined;
  wd.order = toArr(wd.order); wd.picks = toArr(wd.picks);
  return wd;
};
function wdAdvance(passed, newPick = null) {
  const apply = wd => {
    wdMutate(wd);
    if (newPick) wd.picks.push(newPick);
    wd.passes = passed ? (wd.passes || 0) + 1 : 0;
    wd.turn = (wd.turn || 0) + 1;
    return wd;
  };
  const after = () => {
    save(); render();
    if (state.windowDraft && (state.windowDraft.passes >= toArr(state.windowDraft.order).length || !lockedArrivals().length)) wdFinish();
  };
  if (!netOn()) { state.windowDraft = apply(state.windowDraft); after(); return; }
  // online: the pick/pass mutation already advanced the turn server-side
}
/* Admit one man to the Trough without opening the window (Marc, 21 Aug:
   "he isnt a new player hes just a player who wasnt on the official fpl game
   until he played in a match last week. the holding pen is for players who are
   added to the game because they have moved clubs").

   isArrival asks whether the draft-night snapshot has this id at this club, so
   it cannot tell a genuine signing from a lad the feed had simply never
   created. Both arrive as an unknown id. Writing him into the snapshot at his
   current club says "he was here on draft night, at this club" — which for an
   academy player is the plain truth, and leaves every real arrival locked. */
function admitArrival(pid) {
  const p = PLAYER_BY_ID[pid];
  if (!p || !state.draftPool?.ids) return;
  if (netOn()) { serverAct('windowDraft', { op: 'admit', playerId: pid }).catch(() => toast('The Chairman only. Or the window has already been run.')); return; }
  state.draftPool = { ...state.draftPool, ids: { ...state.draftPool.ids, [pid]: p.club } };
  save(); render();
  toast(`${p.name} is loose in the Trough. He was never in the window.`);
}
function wdFinish() {
  if (state.windowDraft?.status === 'done') return;
  const done = () => {
    if (state.windowDraft) state.windowDraft = { ...state.windowDraft, status: 'done' };
    // refresh the snapshot: every remaining arrival unlocks into the Trough
    state.draftPool = { at: Date.now(), ids: Object.fromEntries(PLAYERS.map(p => [p.id, p.club])) };
    pushShared('draftPool', state.draftPool);
    save(); render();
    toast('The window business is done — anyone left is loose in the Trough.');
  };
  if (!netOn()) { done(); return; }
  serverAct('windowDraft', { op: 'end' }).catch(() => {});
}
function myClaims(mid) { return toArr(state.claims?.[currentGwIndex()]?.[mid]); }
function setClaims(mid, arr) {
  const cur = currentGwIndex();
  // codes ride along so a lodged claim survives a feed id shift (Desk §3b)
  arr = toArr(arr).map(c => ({ ...c, inCode: PLAYER_BY_ID[c.in]?.code ?? null, outCode: PLAYER_BY_ID[c.out]?.code ?? null }));
  if (netOn()) {
    serverAct('claimSet', { gwIndex: cur, claims: arr, ...(mid !== whoami && { asManager: mid }) }).catch(() => {});
    // the private snapshot echoes the authoritative list back
  }
  (state.claims[cur] = state.claims[cur] || {})[mid] = arr;
  save(); render();
}
// commissioner-only: resolve all pending claims, then open the Trough
function processWaivers(manual = false) {
  if (netOn() && !isCommissioner()) { toast('Only the Chairman runs waivers'); return; }
  // mid-Chamber-match the pretend scores don't exist yet — a run here would
  // adjudicate on the canonical feed while every screen shows the mock table
  // (sol R2 P1; server refuses too)
  if (state.mock?.phase === 'live') { toast('A Simulation Chamber match is live — waivers wait for full time.'); return; }
  if (netOn()) {
    // online, the server resolves waivers (it can see everyone's blind claims;
    // this device can only see its own)
    serverAct('waiverRunNow', {}).then(res => {
      const ex = toArr(res?.executed);
      if (res?.skipped) { toast(`Waivers skipped — ${res.skipped}.`); return; }
      toast(ex.length
        ? `Waivers processed — ${ex.map(e => `${managerName(e.mid)} lands ${PLAYER_BY_ID[e.in]?.name}`).join(', ')}. The Trough is open.`
        : 'Waivers processed — nothing went through. The Trough is open.');
    }).catch(() => {});
    return;
  }
  // stamp the run at its START: players dropped DURING the run land after it,
  // so they go back on waivers until the next one — no instant snipes
  const runStart = Date.now() - 1;
  const cur = currentGwIndex();
  const tgw = transferGw(); // winning claims take effect next unplayed GW
  const preLen = state.transfers.length;
  // sweep EVERY un-run claim bucket up to now (oldest first) so a claim lodged
  // between a Friday run and the Saturday deadline isn't orphaned by the index flip
  const buckets = Object.keys(state.claims || {}).map(Number).filter(g => g <= cur).sort((a, b) => a - b);
  // count-aware queue (sol, priority round P1 — mirrors js/engine.js
  // resolveWaivers): re-derived from the ledger after every win, so a winner
  // drops behind only managers on the same take count, never behind everyone
  const baseRev = waiverBase();
  let queue = takesQueue(baseRev, state.transfers, tgw);
  const pending = {};
  for (const mid of queue) { pending[mid] = []; for (const g of buckets) pending[mid].push(...toArr(state.claims[g]?.[mid])); }
  const executed = [];
  const touchedLineups = new Set();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let qi = 0; qi < queue.length; qi++) {
      const mid = queue[qi];
      while (pending[mid].length) {
        const c = pending[mid].shift();
        const inP = PLAYER_BY_ID[c.in];
        if (!inP || ownedIdsAt(tgw).has(c.in)) continue;                      // gone — try next claim
        if (!squadAt(mid, tgw).some(x => x.id === c.out)) continue;           // out-player no longer theirs
        if (!squadShapeOk([...squadAt(mid, tgw).filter(x => x.id !== c.out), inP])) continue;
        state.transfers.push({ managerId: mid, outId: c.out, outCode: PLAYER_BY_ID[c.out]?.code ?? null, inId: c.in, inCode: PLAYER_BY_ID[c.in]?.code ?? null, gw: tgw, n: state.transfers.length + 1, t: Date.now(), waiver: true });
        const lu = state.lineups[mid]?.[tgw];
        if (lu) { state.lineups[mid][tgw] = lu.filter(id => id !== c.out); touchedLineups.add(mid); }
        executed.push({ mid, in: c.in, out: c.out });
        queue = takesQueue(baseRev, state.transfers, tgw); // his new count decides his slot
        progressed = true;
        break;
      }
      if (progressed) break;
    }
  }
  // capture the exact values to publish BEFORE any await — an in-flight
  // snapshot must not revert them out from under the write
  const stampedMeta = { ...state.waiverMeta, lastRun: new Date(runStart).toISOString() };
  const prevMeta = state.waiverMeta;
  state.waiverMeta = stampedMeta; // stamp locally NOW so onWaivers reads true immediately
  const newRecs = state.transfers.slice(preLen);
  state.transfers = state.transfers.slice(0, preLen); // the txn re-adds them authoritatively
  txnArray('transfers', arr => {
    const out = [...arr];
    for (const r of newRecs) {
      const owned = ownedIdsGiven(out, tgw);
      if (owned.has(r.inId) || !owned.has(r.outId)) continue; // sniped mid-run
      out.push({ ...r, n: out.length + 1 });
    }
    return out;
  }).then(ok => {
    if (ok === false) { // the write failed — undo the stamp, keep the claims
      state.waiverMeta = prevMeta;
      state.transfers = state.transfers.concat(newRecs); // keep local view honest
      toast('Waivers hit a snag sending — nothing was cleared. Try the run again.');
      render();
      return;
    }
    for (const g of buckets) state.claims[g] = {};
    save(); render();
    toast(executed.length
      ? `Waivers processed — ${executed.map(e => `${managerName(e.mid)} lands ${PLAYER_BY_ID[e.in]?.name}`).join(', ')}. The Trough is open.`
      : `Waivers processed — nothing went through. The Trough is open.`);
  });
}
function setWaiverControl(mode) {
  if (netOn() && !isCommissioner()) { toast('Only the Chairman controls the Trough'); return; }
  if (netOn()) { serverAct('waiverControl', { mode }).catch(() => {}); }
  else { state.waiverMeta = { ...state.waiverMeta, control: mode }; save(); render(); }
  toast(mode === 'open' ? 'The Trough is thrown open — everything is free to sign.'
    : mode === 'closed' ? 'The Trough is closed. The Chairman has spoken.'
    : 'Back on schedule — waivers run 10am every Tuesday and Friday.');
}
// one-shot exception (Committee, 12 Aug): skip a named run, claims roll over
function setWaiverSkip(id) {
  if (netOn() && !isCommissioner()) { toast('Only the Chairman controls the Trough'); return; }
  // online, a SKIP lets the server name the slot ({next:true}) — the run
  // ledger is server-only, and the client's computed id skipped an already-
  // consumed slot on draft night 26/27 while the real next run sailed on.
  // A reinstate (null) and local mode still pass the id straight through.
  // the id rides along so a not-yet-redeployed server still lands the old
  // behaviour rather than reading an absent id as a reinstate
  if (netOn()) { serverAct('waiverSkip', id ? { next: true, id } : { id: null }).catch(() => {}); }
  else { state.waiverMeta = { ...state.waiverMeta, skip: id || null }; save(); render(); }
  toast(id ? 'Next run skipped — claims stay lodged and roll to the one after.'
    : 'Run reinstated — waivers process as scheduled.');
}
// standings using ONLY gameweeks final before gwIdx — deterministic, can't reshuffle mid-round
function standingsBefore(gwIdx) {
  const rows = state.managers.map(m => ({ id: m.id, h2h: 0, pts: 0 }));
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  let anyFinal = false;
  for (let i = 0; i < Math.min(gwIdx, REGULAR_GWS); i++) {
    if (gwStatus(i) !== 'final') continue;
    anyFinal = true;
    for (const r of rows) r.pts += gwManagerPoints(r.id, i);
    for (const [a, b] of pairingsFor(i)) {
      const pa = gwManagerPoints(a, i), pb = gwManagerPoints(b, i);
      if (pa > pb) byId[a].h2h += 3;
      else if (pb > pa) byId[b].h2h += 3;
      else { byId[a].h2h++; byId[b].h2h++; }
    }
  }
  rows.sort((x, y) => y.h2h - x.h2h || y.pts - x.pts || x.id - y.id);
  return { rows, anyFinal };
}
function waiverBase() {
  // reverse of the CURRENT table — every finished GW counts (passing the
  // current GW index dropped the round that just finished)
  const { rows, anyFinal } = standingsBefore(REGULAR_GWS);
  const base = anyFinal ? rows.map(r => r.id) : [...state.draft.order];
  return [...base].reverse(); // bottom feeds first
}
// using your priority costs it (Marc, 25 Aug — mirrors js/engine.js): fewest
// waiver takes this window first, ties in reverse-table order; the count
// resets naturally when a new round settles and deals land in the next gw
function takesQueue(baseRev, transfers, tgw) {
  const takes = {};
  for (const t of transfers) {
    if (t && t.waiver && t.gw === tgw) takes[t.managerId] = (takes[t.managerId] || 0) + 1;
  }
  return baseRev.slice().sort((a, b) => (takes[a] || 0) - (takes[b] || 0) || baseRev.indexOf(a) - baseRev.indexOf(b));
}
function waiverOrder() {
  return takesQueue(waiverBase(), state.transfers, transferGw());
}
/* ---------------- trades (Draft Fantasy style: propose, accept, done) ---------------- */
// trades carry give/get as ARRAYS (equal counts). Old single-id offers still parse.
const tGive = t => toArr(t.give ?? []).length ? toArr(t.give) : [t.give].filter(Boolean);
const tGet = t => toArr(t.get ?? []).length ? toArr(t.get) : [t.get].filter(Boolean);
const tradeNames = ids => ids.map(id => PLAYER_BY_ID[id]?.name || '?').join(' + ');
function proposeTrade(from, to, give, get, terms = '') {
  give = toArr(give); get = toArr(get);
  if (!give.length || give.length !== get.length) { toast('Trades swap the same number of players each way'); return; }
  if (netOn()) {
    serverAct('tradePropose', { to, give, get, terms: terms.slice(0, 200), ...(from !== whoami && { asManager: from }) })
      .then(() => toast(`Offer sent — awaiting ${managerName(to)}. Nothing more for you to do; it lands or voids on their say.`)).catch(() => {});
    return;
  }
  const offer = { id: Date.now() + '-' + from, from, to, give, get, terms: terms.slice(0, 200), status: 'pending', t: Date.now() };
  txnArray('trades', arr => [...arr, offer])
    .then(ok => toast(ok ? `Offer sent — awaiting ${managerName(to)}. Nothing more for you to do; it lands or voids on their say.` : 'Proposal didn’t send — check connection and try again'));
}
// flip one trade's status, transaction-safe, only if it's still pending
const setTradeStatus = (id, status) =>
  txnArray('trades', arr => arr.some(x => x && x.id === id && x.status === 'pending')
    ? arr.map(x => x && x.id === id ? { ...x, status } : x) : null);
function respondTrade(id, accept) {
  const tr = toArr(state.trades).find(x => x.id === id);
  if (!tr || tr.status !== 'pending') return;
  if (netOn()) {
    serverAct('tradeRespond', { tradeId: id, action: accept ? 'accept' : 'reject' })
      .then(() => toast(accept
        ? `Trade done: ${tradeNames(tGive(tr))} ↔ ${tradeNames(tGet(tr))}. Executed instantly, as is right and proper.`
        : 'Trade rejected. Nothing personal. (It was personal.)'))
      .catch(() => {});
    return;
  }
  if (!accept) {
    setTradeStatus(id, 'rejected')
      .then(() => toast('Trade rejected. Nothing personal. (It was personal.)'));
    return;
  }
  const tgw = transferGw(); // effect from the next unplayed GW — never rescore history
  const give = tGive(tr), get = tGet(tr);
  // quick local screen for a friendly message; the binding check re-runs
  // inside the transaction against whatever the server holds at that moment
  const giveSet = new Set(give), getSet = new Set(get);
  const fromAfter = [...squadAt(tr.from, tgw).filter(p => !giveSet.has(p.id)), ...get.map(pid => PLAYER_BY_ID[pid])];
  const toAfter = [...squadAt(tr.to, tgw).filter(p => !getSet.has(p.id)), ...give.map(pid => PLAYER_BY_ID[pid])];
  if (!squadShapeOk(fromAfter) || !squadShapeOk(toAfter)) {
    toast('Trade would break a squad\'s position limits'); return;
  }
  txnArray('transfers', arr => {
    const fromIds = squadIdsGiven(tr.from, arr, tgw), toIds = squadIdsGiven(tr.to, arr, tgw);
    if (give.some(pid => !fromIds.has(pid)) || get.some(pid => !toIds.has(pid))) return null; // someone moved on
    const fa = [...fromIds].filter(pid => !giveSet.has(pid)).concat(get).map(pid => PLAYER_BY_ID[pid]);
    const ta = [...toIds].filter(pid => !getSet.has(pid)).concat(give).map(pid => PLAYER_BY_ID[pid]);
    if (!squadShapeOk(fa) || !squadShapeOk(ta)) return null;
    const out = [...arr];
    for (let k = 0; k < give.length; k++) {
      out.push({ managerId: tr.from, outId: give[k], outCode: PLAYER_BY_ID[give[k]]?.code ?? null, inId: get[k], inCode: PLAYER_BY_ID[get[k]]?.code ?? null, gw: tgw, n: out.length + 1, t: Date.now(), trade: tr.id || id });
      out.push({ managerId: tr.to, outId: get[k], outCode: PLAYER_BY_ID[get[k]]?.code ?? null, inId: give[k], inCode: PLAYER_BY_ID[give[k]]?.code ?? null, gw: tgw, n: out.length + 1, t: Date.now(), trade: tr.id || id });
    }
    return out;
  }).then(ok => {
    if (!ok) {
      setTradeStatus(id, 'withdrawn');
      toast('Trade void — a player involved has already moved on.');
      return;
    }
    setTradeStatus(id, 'done');
    if (tr.terms) {
      const covenant = { id: tr.id + '-cov', from: tr.from, to: tr.to, text: tr.terms, t: Date.now(), gw: GAMEWEEKS[currentGwIndex()].n };
      txnArray('covenants', arr => arr.some(c => c && c.id === covenant.id) ? null : [...arr, covenant]);
    }
    for (const [m2, gone] of [[tr.from, give], [tr.to, get]]) {
      const lu = state.lineups[m2]?.[tgw];
      if (lu) {
        state.lineups[m2][tgw] = lu.filter(pid => !gone.includes(pid));
        pushShared(`lineups/${m2}/${tgw}`, state.lineups[m2][tgw]);
      }
    }
    save(); render();
    toast(`Trade done: ${tradeNames(give)} ↔ ${tradeNames(get)}. Executed instantly, as is right and proper.`);
  });
}

/* ---------------- draft logic ---------------- */
function totalPicks() { return state.managers.length * SQUAD_RULES.size; }
function pickNo() { return state.draft.picks.length; }
function currentManagerId() {
  const n = pickNo(), m = state.managers.length;
  if (n >= totalPicks()) return null;
  const round = Math.floor(n / m), idx = n % m;
  const order = state.draft.order;
  return (round % 2 === 0) ? order[idx] : order[m - 1 - idx];
}
function canPick(mid, player) {
  if (arrivalLocked(player)) return false; // new arrivals wait for the Window Draft
  const c = posCount(mid);
  const size = managerSquad(mid).length;
  if (size >= SQUAD_RULES.size || c[player.pos] >= SQUAD_RULES.max[player.pos]) return false;
  // the pick must leave enough slots to satisfy every unmet position minimum
  let need = 0;
  for (const pos of ['GK', 'DF', 'MF', 'FW']) need += Math.max(0, SQUAD_RULES.min[pos] - c[pos] - (pos === player.pos ? 1 : 0));
  return need <= SQUAD_RULES.size - size - 1;
}
/* All Squads (Ben, post-draft: "a tab where we can see everyone's team
   lists... from the draft and then live") — every roster as it stands NOW
   (managerSquad follows transfers), with each man's provenance: his draft
   slot, or however he arrived since. Player-card taps come free via the
   global [data-pcard] delegation, so the view needs no bind. */
function squadProvenance(mid, pid) {
  const pk = (state.draft.picks || []).find(x => x.managerId === mid && x.playerId === pid);
  if (pk) return `R${Math.ceil(pk.n / Math.max(1, state.managers.length))} · #${pk.n}`;
  const tr = [...state.transfers].reverse().find(t => t.managerId === mid && t.inId === pid);
  if (!tr) return '';
  return tr.trade ? 'trade' : tr.windowDraft ? 'window draft' : tr.waiver ? 'waiver' : 'trough';
}
function viewSquads() {
  const POS_ORDER = { GK: 0, DF: 1, MF: 2, FW: 3 };
  const order = (state.draft.order || []).length ? state.draft.order : state.managers.map(m => m.id);
  const cards = order.map(mid => {
    const sq = managerSquad(mid).slice()
      .sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos] || (playerDisplayName(a)).localeCompare(playerDisplayName(b)));
    const rows = sq.map(p => `<div class="lrow" style="font-size:12.5px">
      <span class="pos-badge pos-${p.pos}">${p.pos}</span>
      ${pname(p)} <span class="muted" style="font-size:11px">${esc(p.club)}</span>${leftTag(p)}
      <span class="muted" style="margin-left:auto;font-size:10.5px;white-space:nowrap">${esc(squadProvenance(mid, p.id))}</span>
    </div>`).join('') || '<span class="muted" style="font-size:12px">No players. A bold rebuild.</span>';
    return `<div class="card">
      <h3 style="margin-bottom:2px">${esc(teamName(mid))}</h3>
      <p class="muted" style="font-size:11.5px;margin-bottom:8px">${esc(managerName(mid))} &middot; ${sq.length} players</p>
      ${rows}
    </div>`;
  }).join('');
  return `<div class="card">
    <h2>All Squads</h2>
    <p class="muted" style="font-size:12.5px">Every roster as it stands — drafted, traded, claimed and scavenged. The tag on each man is his provenance: draft round and pick, or how he got in since. Tap a name for his card.</p>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-top:12px">${cards}</div>`;
}
function draftedIds() { return new Set(state.draft.picks.map(p => p.playerId)); }

function makePick(playerId, force = false) {
  const mid = currentManagerId();
  if (mid == null) return;
  if (!force && !canActFor(mid)) { toast(`It's ${managerName(mid)}'s pick — the group chat is watching you`); return; }
  const player = PLAYER_BY_ID[playerId];
  if (!canPick(mid, player)) { toast(`${managerName(mid)} can't fit another ${player.pos} — position limits`); return; }
  const rec = { managerId: mid, playerId, code: PLAYER_BY_ID[playerId]?.code ?? null, n: pickNo() + 1, t: Date.now() };
  const finishPick = total => {
    if (state.settings.pickTimer && total < totalPicks()) {
      state.draft.deadline = Date.now() + state.settings.pickTimer * 1000;
      pushShared('draft/deadline', state.draft.deadline);
    }
    if (total >= totalPicks()) {
      state.phase = 'season';
      if (whoami === mid) state.view = 'dash';
      pushShared('phase', 'season');
      toast('Draft complete. The Committee has ratified the minutes. Game on.');
    } else if (Math.random() < 0.3) {
      toast(committeeSays());
    }
    save(); render();
  };
  if (netOn()) {
    // the server enforces turn, legality and the pick race; deadline/phase
    // advance server-side and come back in the snapshot
    serverAct('draftPick', { playerId, expectedCount: pickNo() })
      .then(r => { if (r.total >= totalPicks() && whoami === mid) state.view = 'dash'; })
      .catch(() => {});
  } else {
    state.draft.picks.push(rec);
    finishPick(state.draft.picks.length);
  }
}
function autoPick(force = false) {
  const mid = currentManagerId();
  if (mid == null) return;
  // a clock fire (force) declares itself so the server can judge it by its
  // own watch; a refusal re-arms this device's one-shot so the expiry isn't
  // lost to a rejected early ask
  if (netOn()) { serverAct('draftAutopick', force ? { expired: true } : {}).catch(() => { if (force) firedDeadline = 0; }); return; }
  const taken = draftedIds();
  // the manager's own autopick list first, then best available by rating
  let best = toArr(state.autolists?.[mid]).map(id => PLAYER_BY_ID[id])
    .find(p => p && !taken.has(p.id) && canPick(mid, p));
  if (!best) best = PLAYERS.filter(p => !taken.has(p.id) && canPick(mid, p))
    .sort((a, b) => rating(b) - rating(a))[0];
  if (best) makePick(best.id, force);
}
function setAutolist(mid, arr) {
  state.autolists[mid] = arr;
  if (netOn()) serverAct('autolistSet', { pids: arr }).catch(() => {});
  save(); render();
}
/* The Trough watchlist (Marc, 20 Aug). Deliberately NOT the autopick list: the
   autolist is an instruction — if your clock dies, take this man — whereas a
   watchlist is only a lens on the Trough. Watching somebody must never sign,
   claim or draft him, so nothing outside the Trough filter reads this. */
const watchIds = mid => toArr(state.watchlists?.[mid]);
const watchBtnHtml = (mid, pid) => {
  const on = isWatched(mid, pid);
  return `<button class="btn ghost small icon-btn watch-btn${on ? ' watch-on' : ''}" data-watch="${pid}" aria-pressed="${on}" aria-label="${on ? 'Stop watching' : 'Watch'} ${esc(PLAYER_BY_ID[pid]?.name || 'this player')}" title="${on ? 'On your watchlist — tap to drop him' : 'Watch him: he joins your private Trough watchlist'}">&#128065;</button>`;
};
const isWatched = (mid, pid) => watchIds(mid).includes(pid);
function toggleWatch(mid, pid) {
  const cur = watchIds(mid);
  const next = cur.includes(pid) ? cur.filter(x => x !== pid) : [...cur, pid];
  state.watchlists = { ...state.watchlists, [mid]: next };
  // the write is fire-and-forget, as the autolist's is: a watchlist that fails
  // to reach the cloud is a lost preference, not a lost pick
  if (netOn()) serverAct('watchlistSet', { pids: next }).catch(() => {});
  save();
  return next;
}

/* ---------------- lineups ---------------- */
// build a legal, best-rated XI from a (possibly empty/illegal/short) starter
// set: keep the best within each position max, then fill minimums, then top up.
// Guarantees 11 legal players whenever the squad allows one — no more 10-man XIs.
function legalizeXI(start, squad) {
  const squadIds = new Set(squad.map(p => p.id));
  const cnt = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const xi = [];
  for (const id of toArr(start).filter(id => squadIds.has(id)).sort((a, b) => rating(PLAYER_BY_ID[b]) - rating(PLAYER_BY_ID[a]))) {
    const pos = PLAYER_BY_ID[id]?.pos;
    if (pos && cnt[pos] < XI_RULES[pos][1] && xi.length < XI_RULES.size && !xi.includes(id)) { xi.push(id); cnt[pos]++; }
  }
  const cands = squad.filter(p => !xi.includes(p.id)).sort((a, b) => rating(b) - rating(a));
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    while (xi.length < XI_RULES.size && xiCounts(xi)[pos] < XI_RULES[pos][0]) {
      const c = cands.find(p => p.pos === pos && !xi.includes(p.id));
      if (!c) break;
      xi.push(c.id);
    }
  }
  for (const c of cands) {
    if (xi.length >= XI_RULES.size) break;
    if (!xi.includes(c.id) && xiCounts(xi)[c.pos] < XI_RULES[c.pos][1]) xi.push(c.id);
  }
  return xi;
}
function autoXI(squad) { return legalizeXI([], squad); }
// every manager-made XI change is time-stamped — the Committee sees edit
// times, and an edit after kick-off (a wound-back phone clock) shows in red
function saveLineup(mid, gw, xi) {
  (state.lineups[mid] = state.lineups[mid] || {})[gw] = xi;
  if (netOn()) {
    // server stamps the -t with ITS clock (no wound-back phones) and re-checks
    // ownership, shape and the deadline
    serverAct('lineupSave', { gw, xi, ...(mid !== whoami && { asManager: mid }) }).catch(() => {});
    return;
  }
  state.lineups[mid][`${gw}-t`] = Date.now();
}
function lineupStamp(mid, gwIdx) {
  const ts = state.lineups?.[mid]?.[`${gwIdx}-t`];
  if (!ts) return '<span class="muted">XI carried over — never touched</span>';
  const late = ts > new Date(gwFrom(gwIdx)).getTime();
  const when = new Date(ts).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return `<span class="muted">XI set ${when}</span>${late ? ' <b style="color:#e05555" title="Edited after the deadline — the Committee has questions">AFTER KICK-OFF</b>' : ''}`;
}
function lineupFor(mid, gwIdx) {
  const squad = squadAt(mid, gwIdx);
  const squadIds = new Set(squad.map(p => p.id));
  const stored = state.lineups[mid] || {};
  let xi = null;
  if (stored[gwIdx]) xi = stored[gwIdx].filter(id => squadIds.has(id));
  else {
    for (let j = gwIdx - 1; j >= 0; j--) {
      if (stored[j]) { xi = stored[j].filter(id => squadIds.has(id)); break; }
    }
  }
  if (!xi) return autoXI(squad);
  // the scored XI must ALWAYS be legal — the list editor can build an illegal
  // shape (too many of a position, a short XI). Keep it if it's a clean 11,
  // otherwise repair to the nearest legal best XI. No illegal XI ever scores.
  if (xi.length === XI_RULES.size && xiValid(xi)) return xi;
  return legalizeXI(xi, squad);
}
function xiCounts(pids) {
  const c = { GK: 0, DF: 0, MF: 0, FW: 0 };
  pids.forEach(id => c[PLAYER_BY_ID[id].pos]++);
  return c;
}
function xiValid(pids) {
  if (pids.length !== XI_RULES.size) return false;
  if (new Set(pids).size !== pids.length) return false; // the same player can't start twice
  if (pids.some(id => !PLAYER_BY_ID[id])) return false;
  const c = xiCounts(pids);
  return ['GK', 'DF', 'MF', 'FW'].every(pos => c[pos] >= XI_RULES[pos][0] && c[pos] <= XI_RULES[pos][1]);
}

/* ---------------- scoring ---------------- */
// raw FPL gameweek stats -> league points, per the editable scoring table.
// FPL's cs/gc stats already respect the 60-minute / on-pitch rules.
// Appearance points (Committee ruling, Jul 2026): a START is 2, a sub
// appearance is 1, no 60-minute threshold. s.st = number of starts in the GW.
function appearancePts(sc, s, played) {
  const starts = Math.min(s.st || 0, played);
  return starts * sc.appearanceStart + (played - starts) * sc.appearanceSub;
}
function statPoints(player, s, skipAppearance) {
  // partial scoring objects (old saves, hand-edited settings) must never make
  // NaN — every missing key falls back to the canon table (sol mock-night P3)
  const sc = { ...DEFAULT_SCORING, ...(state.settings.scoring || {}) };
  // double gameweek: score each fixture on its own and sum (goals-conceded per
  // 2 per match, saves per 3 per match); appearance is settled ONCE from the
  // start count + fixtures actually played — fx rows carry minutes only
  if (s && s.fx && s.fx.length > 1) {
    const played = s.fx.filter(f => (f.min || 0) > 0).length;
    return appearancePts(sc, s, played) + s.fx.reduce((t, f) => t + statPoints(player, f, true), 0);
  }
  const goalPts = { GK: sc.goalGK, DF: sc.goalDF, MF: sc.goalMF, FW: sc.goalFW }[player.pos] ?? sc.goalFW;
  const min = s.min ?? ((s.st || s.sub) ? 90 : 0);
  let pts = 0;
  if (!skipAppearance && min > 0) pts += appearancePts(sc, s, 1);
  pts += (s.g || 0) * goalPts + (s.a || 0) * sc.assist;
  pts += (s.og || 0) * sc.ownGoal + (s.pm || 0) * sc.penMiss;
  // Red includes the yellows that produced it: two yellows and the resulting
  // dismissal are one -5 disciplinary sanction, not -1 -1 -5.
  pts += (s.rc || 0) ? (s.rc || 0) * sc.red : (s.yc || 0) * sc.yellow;
  // clean-sheet points require 60+ minutes (real FPL/DF rule) — a defender
  // subbed at half-time gets nothing even if his team keeps the sheet. The
  // gate lives here so it's correct no matter how the feed reports cs.
  const cs60 = min >= 60 ? (s.cs || 0) : 0;
  if (player.pos === 'GK' || player.pos === 'DF') {
    pts += cs60 * sc.cleanSheet;
    pts += Math.floor((s.gc || 0) / 2) * sc.per2Conceded;
  }
  if (player.pos === 'MF') pts += cs60 * sc.cleanSheetMF;
  if (player.pos === 'GK') pts += Math.floor((s.sv || 0) / 3) * sc.per3Saves + (s.ps || 0) * sc.penSave;
  return pts;
}
function gwPlayerPoints(pid, gwIdx) {
  const s = gwEvent(gwIdx)?.playerStats?.[pid];
  const base = s ? statPoints(PLAYER_BY_ID[pid], s) : 0;
  // per-gameweek Chairman's correction — mirrors engine.js exactly
  return base + (+(((state.adjustments || {})[gwIdx] || {})[pid]) || 0);
}
// did the player get on the pitch at all this gameweek?
function appearedInGw(pid, gwIdx) {
  const s = gwEvent(gwIdx)?.playerStats?.[pid];
  return !!(s && (s.min || s.st || s.sub));
}
// the bench in priority order: stored order first (carried forward like lineups),
// anyone unlisted appended by rating. Leftmost comes on first — Draft Fantasy style.
function benchFor(mid, gwIdx) {
  const xi = new Set(lineupFor(mid, gwIdx));
  const squad = squadAt(mid, gwIdx).filter(p => !xi.has(p.id));
  const stored = state.benchOrders?.[mid] || {};
  let ord = stored[gwIdx];
  if (!ord) for (let j = gwIdx - 1; j >= 0; j--) { if (stored[j]) { ord = stored[j]; break; } }
  ord = toArr(ord);
  const byId = Object.fromEntries(squad.map(p => [p.id, p]));
  const out = ord.filter(id => byId[id]).map(id => byId[id]);
  for (const p of [...squad].sort((a, b) => rating(b) - rating(a))) if (!out.includes(p)) out.push(p);
  return out;
}
function setBenchOrder(mid, gwIdx, pids) {
  (state.benchOrders = state.benchOrders || {})[mid] = state.benchOrders[mid] || {};
  state.benchOrders[mid][gwIdx] = pids;
  if (netOn()) serverAct('benchOrder', { gw: gwIdx, pids, ...(mid !== whoami && { asManager: mid }) }).catch(() => {});
}
// auto-subs: starters who never played are replaced by bench players who did,
// best-rated first, keeping the XI shape legal
function effectiveXI(mid, gwIdx) {
  const xi = [...lineupFor(mid, gwIdx)];
  const ev = gwEvent(gwIdx);
  const anySynced = !!ev && Object.keys(ev.playerStats || {}).length > 0;
  if (!anySynced) return { xi, subs: [] };
  // auto-subs land at the FINAL WHISTLE OF THE LAST GAME, never mid-round
  // (Ben, UAT night: Wilko's Ruben was "subbed out" before Chelsea's Monday
  // kickoff — "players stay in their elevens and it gets recalibrated at the
  // final whistle of the last game of the gw")
  const gwN = GAMEWEEKS[gwIdx]?.n;
  const gwFx = state.fixtures.filter(f => f.gw === gwN);
  // the all-finished shortcut must see the WHOLE round: a device carrying
  // only the finished fixtures would sub early and disagree with the server
  // (sol UAT P2) — every club accounted for, or wait for feed-final/time
  const fullRound = gwFx.length > 0 && new Set(gwFx.flatMap(f => [f.home, f.away])).size === TEAMS.length;
  const roundDone = ev.final || gwIsOver(gwIdx) || (fullRound && gwFx.every(f => f.finished || f.fp));
  if (!roundDone) return { xi, subs: [] };
  const bench = benchFor(mid, gwIdx).filter(p => appearedInGw(p.id, gwIdx)); // manager's order, leftmost first
  const subs = [];
  for (const pid of [...xi]) {
    if (appearedInGw(pid, gwIdx)) continue;
    const idx = xi.indexOf(pid);
    for (const cand of bench) {
      if (xi.includes(cand.id)) continue;
      const trial = [...xi];
      trial[idx] = cand.id;
      // swap must keep position counts inside the rules (length unchanged)
      const c = xiCounts(trial);
      const shapeOk = ['GK', 'DF', 'MF', 'FW'].every(pos => c[pos] >= XI_RULES[pos][0] && c[pos] <= XI_RULES[pos][1]);
      if (shapeOk) {
        xi[idx] = cand.id;
        subs.push({ out: pid, in: cand.id });
        break;
      }
    }
  }
  return { xi, subs };
}
/* ----- auto-subs the maths can already be sure of -----
   Settlement waits for the final whistle of the last game and that stays put
   (effectiveXI / gwManagerPoints — Ben, UAT night). But the PROJECTION has no
   business waiting: once a starter's club is finished for the week and he
   never got on, and a bench man who HAS played can legally take his shirt,
   that sub is a certainty. The win bar was banking the dead starter's nought
   and ignoring the bench points sat right next to it.
   (Marc, 23 Aug 2026: "i know mateta will come on for sarr already meaning
   that i will get 2 more points ... the projection is slightly off")
   Built on effectiveXI's output, so once the round IS done this finds nothing
   left to do and the numbers can't be counted twice. */
// every fixture his club had this gameweek has whistled. A blank gameweek (no
// fixture at all) proves nothing — he cannot be written off on the evidence of
// a match that was never played.
function clubRoundOver(p, gwN) {
  if (!p) return false;
  const fx = teamFixturesInGw(p.team, gwN);
  return fx.length > 0 && fx.every(fxOver);
}
function pendingSubs(mid, gwIdx, base) {
  const gwN = GAMEWEEKS[gwIdx]?.n;
  if (gwN == null) return [];
  const ev = gwEvent(gwIdx);
  if (!ev || !Object.keys(ev.playerStats || {}).length) return [];
  // `base` is an effectiveXI the caller already has — this runs on every live
  // render, twice per matchup row, so don't compute it twice for nothing
  const xi = [...(base || effectiveXI(mid, gwIdx).xi)];
  // certainly out: every fixture his club had this week whistled, no minutes.
  // A blank gameweek (no fixture at all) proves nothing — he can't be replaced
  // on the evidence of a match that was never played.
  const clubDone = pid => clubRoundOver(PLAYER_BY_ID[pid], gwN);
  // certainly in: he is already on the pitch, or has been
  const bench = benchFor(mid, gwIdx).filter(p => appearedInGw(p.id, gwIdx));
  const subs = [];
  for (const pid of [...xi]) {
    if (appearedInGw(pid, gwIdx) || !clubDone(pid)) continue;
    const idx = xi.indexOf(pid);
    for (const cand of bench) {
      if (xi.includes(cand.id)) continue;
      const trial = [...xi];
      trial[idx] = cand.id;
      const c = xiCounts(trial);
      const shapeOk = ['GK', 'DF', 'MF', 'FW'].every(pos => c[pos] >= XI_RULES[pos][0] && c[pos] <= XI_RULES[pos][1]);
      if (shapeOk) {
        xi[idx] = cand.id;
        subs.push({ out: pid, in: cand.id });
        break;
      }
    }
  }
  // a starter whose own club is still to play could yet fail to appear and
  // take a bench man ahead of these — so the final pairings can differ from
  // these, even though the count and the points rarely do
  return subs;
}
// the eleven the projection should believe in: settled subs plus certain ones.
// Display and settlement stay separate — this never feeds gwManagerPoints.
/* ----- the sub you can SEE coming, before he has kicked a ball -----
   Marc, 28 Aug 2026, looking at a locked GW2 side: "why isnt it identifying
   that neto will come on".

   pendingSubs deliberately will not answer that. It banks points that are
   certain but not yet awarded, so it requires the incoming man to have ALREADY
   played — you cannot bank a return from someone who has not kicked a ball,
   and Neto's Chelsea play on Sunday.

   The projection, though, was quietly wrong, and that is the real complaint.
   Mateta is injured until 11 October, Palace have played, he never appeared —
   so startChance returns 0 and he sits in the projected XI contributing
   nothing while nobody is promoted behind him. The side projects as ten men.
   The auto-sub WILL bring Neto on at settlement, and the forecast should say
   so rather than quietly banking a hole.

   PROJECTION ONLY. effectiveXI, gwManagerPoints and the live score never see
   this: a forecast must not move a settled number.

   Known soft spot, and it is the same calibration debt as the Scout weights:
   the promoted man is credited at his startChance, which asks "will he START".
   For an auto-sub the question is really "will he get on at all", which is a
   higher number — Scout leaving Neto out of Chelsea's XI reads 0.2 here, when
   a substitute appearance would do. Under-crediting him is the conservative
   error, so it stands until there is a season of appearances to calibrate on. */
function forecastSubs(mid, gwIdx, base) {
  const gwN = GAMEWEEKS[gwIdx]?.n;
  if (gwN == null) return [];
  const xi = [...(base || effectiveXI(mid, gwIdx).xi)];
  // he cannot play: his club's round is over and he never appeared, or the
  // paperwork rules him out already (injured, banned, departed)
  const cannotPlay = pid => {
    const p = PLAYER_BY_ID[pid];
    if (!p || appearedInGw(pid, gwIdx)) return false;
    return clubRoundOver(p, gwN) || startChance(p, gwIdx) === 0;
  };
  // he can come on: he has ALREADY played (the surest sub there is — Toby,
  // 29 Aug, Amad ruled out with Munoz sat on 6 on the bench: "gone with
  // second sub?" — the forecast was skipping every bench man who had played
  // and naming the next one down), or he is not ruled out himself and his
  // club still has a game left. Manager's bench order throughout.
  const bench = benchFor(mid, gwIdx).filter(p =>
    appearedInGw(p.id, gwIdx) || (startChance(p, gwIdx) > 0 && !clubRoundOver(p, gwN)));
  const subs = [];
  for (const pid of [...xi]) {
    if (!cannotPlay(pid)) continue;
    const idx = xi.indexOf(pid);
    for (const cand of bench) {
      if (xi.includes(cand.id)) continue;
      const trial = [...xi];
      trial[idx] = cand.id;
      const c = xiCounts(trial);
      if (['GK', 'DF', 'MF', 'FW'].every(pos => c[pos] >= XI_RULES[pos][0] && c[pos] <= XI_RULES[pos][1])) {
        xi[idx] = cand.id;
        subs.push({ out: pid, in: cand.id });
        break;
      }
    }
  }
  return subs;
}
function liveXI(mid, gwIdx) {
  const eff = effectiveXI(mid, gwIdx);
  const xi = [...eff.xi];
  const subs = pendingSubs(mid, gwIdx, eff.xi);
  for (const s of subs) {
    const k = xi.indexOf(s.out);
    if (k >= 0) xi[k] = s.in;
  }
  // then the ones we can see coming but cannot bank yet (Marc, 28 Aug 2026)
  const forecast = forecastSubs(mid, gwIdx, xi);
  for (const s of forecast) {
    const k = xi.indexOf(s.out);
    if (k >= 0) xi[k] = s.in;
  }
  return { xi, subs, forecast };
}
// what those certain subs will add to the score at the final whistle
function pendingSubPoints(mid, gwIdx) {
  return pendingSubs(mid, gwIdx)
    .reduce((t, s) => t + gwPlayerPoints(s.in, gwIdx) - gwPlayerPoints(s.out, gwIdx), 0);
}
/* Every sub marker in one place, keyed by player: who is coming off, who is
   coming on, and — Marc, 24 Aug 2026, "add an arrow on the sub coming in as
   well to show that's where it's coming from" — WHO FOR, named on the chip
   itself. A tooltip is no use on a phone, so the partner's name rides beside
   the arrow. Settled subs are solid; the certain-but-unawarded ones pulse. */
function subMarks(mid, gwIdx) {
  const settled = effectiveXI(mid, gwIdx);
  const marks = {};
  const nm = pid => esc(PLAYER_BY_ID[pid]?.name || 'the bench');
  const mark = (pid, dir, pend, partner, title) => {
    marks[pid] = `<span class="sub-arrow ${dir}${pend ? ' pend' : ''}" title="${title}">${dir === 'in' ? '&#9650;' : '&#9660;'} <span class="sub-for">${partner}</span></span>`;
  };
  for (const s of settled.subs) {
    mark(s.in, 'in', false, nm(s.out), `Auto-sub — came on for ${nm(s.out)}`);
    mark(s.out, 'out', false, nm(s.in), `Auto-subbed out — never played. ${nm(s.in)} took his place`);
  }
  const pend = pendingSubs(mid, gwIdx, settled.xi);
  for (const s of pend) {
    mark(s.out, 'out', true, nm(s.in), `Never got on — ${nm(s.in)} replaces him at the final whistle`);
    mark(s.in, 'in', true, nm(s.out), `Coming on for ${nm(s.out)} — his points land at the final whistle`);
  }
  // and the one we can see coming before he has kicked a ball (Marc, 28 Aug
  // 2026: "why isnt it identifying that neto will come on"). Drawn as an
  // outline, not a solid arrow: his club has not played, so this is a forecast
  // rather than a sub that has happened, and it must not read like one.
  const xiSoFar = [...settled.xi];
  for (const s of pend) { const k = xiSoFar.indexOf(s.out); if (k >= 0) xiSoFar[k] = s.in; }
  for (const s of forecastSubs(mid, gwIdx, xiSoFar)) {
    if (!marks[s.out]) marks[s.out] = `<span class="sub-arrow out fc" title="Cannot play — ${nm(s.in)} is expected to replace him">&#9663; <span class="sub-for">${nm(s.in)}</span></span>`;
    if (!marks[s.in]) marks[s.in] = `<span class="sub-arrow in fc" title="Expected to come on for ${nm(s.out)} — he has not played yet, so nothing is banked">&#9653; <span class="sub-for">${nm(s.out)}</span></span>`;
  }
  return marks;
}
// a live score with the certain-but-unawarded auto-subs alongside it. The bold
// number is always the settlement number — the tail is what's coming.
function liveScoreHtml(mid, gwIdx) {
  const n = gwManagerPoints(mid, gwIdx);
  const add = pendingSubPoints(mid, gwIdx);
  if (!add) return `${n}`;
  return `${n} <span class="pend-pts" title="Auto-subs already certain — awarded at the final whistle of the last game">${add > 0 ? '+' : '&minus;'}${Math.abs(add)}</span>`;
}
function gwManagerPoints(mid, gwIdx) {
  const xi = effectiveXI(mid, gwIdx).xi;
  let pts = xi.reduce((t, pid) => t + gwPlayerPoints(pid, gwIdx), 0);
  // the Lobus honours his people (ledger #1) — only if the Committee turns the bonus on
  const bonus = +state.settings.lobusBonus || 0;
  if (bonus) {
    const lob = state.lobus?.[mid];
    const s = lob && xi.includes(lob) ? gwEvent(gwIdx)?.playerStats?.[lob] : null;
    if (s && (s.g || 0) + (s.a || 0) > 0) pts += bonus;
  }
  return pts;
}
function managerPoints(mid) {
  let pts = 0;
  for (let i = 0; i < GAMEWEEKS.length; i++) {
    pts += gwManagerPoints(mid, i); // zero unless results exist in that window
  }
  // per-GW adjustments already land inside gwManagerPoints — no flat add-on
  return pts;
}
// points a player has banked for this manager (only weeks he was in the XI)
function contributedPoints(mid, pid) {
  let pts = 0;
  for (let i = 0; i < GAMEWEEKS.length; i++) {
    if (effectiveXI(mid, i).xi.includes(pid)) pts += gwPlayerPoints(pid, i);
  }
  return pts; // per-GW adjustments ride inside gwPlayerPoints
}
// raw all-season breakdown for tooltips / top players
function playerPoints(pid) {
  const p = PLAYER_BY_ID[pid];
  let pts = 0;
  const agg = { app: 0, g: 0, a: 0, cs: 0, sv: 0, ps: 0, pm: 0, yc: 0, rc: 0, og: 0 };
  for (const ev of Object.values(state.matchStats)) {
    const s = ev.playerStats?.[pid];
    if (!s) continue;
    pts += statPoints(p, s); // points computed per-gameweek, so the floors stay honest
    if (s.min || s.st || s.sub) agg.app++;
    for (const k of ['g', 'a', 'cs', 'sv', 'ps', 'pm', 'yc', 'rc', 'og']) agg[k] += (s[k] || 0);
  }
  const lines = [];
  const say = (n, label) => { if (n) lines.push(`${label} ${n}`); };
  say(agg.app, 'Apps'); say(agg.g, 'Goals'); say(agg.a, 'Assists');
  if (p.pos !== 'FW') say(agg.cs, 'Clean sheets');
  if (p.pos === 'GK') { say(agg.sv, 'Saves'); say(agg.ps, 'Pen saves'); }
  say(agg.yc, 'Yellows'); say(agg.rc, 'Reds'); say(agg.og, 'Own goals'); say(agg.pm, 'Pens missed');
  return { pts, agg, lines };
}

/* ---------------- bragging metrics: bench waste, luck, playoff odds ---------------- */
// the best legal XI a manager COULD have fielded that gameweek
function optimalXI(mid, gwIdx) {
  const byPos = { GK: [], DF: [], MF: [], FW: [] };
  for (const p of squadAt(mid, gwIdx)) byPos[p.pos].push(gwPlayerPoints(p.id, gwIdx));
  for (const k in byPos) byPos[k].sort((a, b) => b - a);
  const take = (arr, n) => arr.slice(0, n).reduce((t, x) => t + x, 0);
  let best = 0;
  for (let df = XI_RULES.DF[0]; df <= Math.min(XI_RULES.DF[1], byPos.DF.length); df++)
    for (let mf = XI_RULES.MF[0]; mf <= Math.min(XI_RULES.MF[1], byPos.MF.length); mf++) {
      const fw = XI_RULES.size - 1 - df - mf;
      if (fw < XI_RULES.FW[0] || fw > XI_RULES.FW[1] || fw > byPos.FW.length || !byPos.GK.length) continue;
      best = Math.max(best, take(byPos.GK, 1) + take(byPos.DF, df) + take(byPos.MF, mf) + take(byPos.FW, fw));
    }
  return best;
}
const benchWaste = (mid, gwIdx) => Math.max(0, optimalXI(mid, gwIdx) - gwManagerPoints(mid, gwIdx));
function seasonBenchWaste(mid) {
  let w = 0;
  for (let i = 0; i < REGULAR_GWS; i++) if (gwStatus(i) === 'final') w += benchWaste(mid, i);
  return w;
}
// all-play: your record if you'd played all eleven others every finished gameweek
function allPlayTable() {
  const rows = Object.fromEntries(state.managers.map(m => [m.id, { w: 0, d: 0, l: 0 }]));
  let played = 0;
  for (let i = 0; i < REGULAR_GWS; i++) {
    if (gwStatus(i) !== 'final') continue;
    played++;
    const scores = state.managers.map(m => [m.id, gwManagerPoints(m.id, i)]);
    for (const [id, s] of scores) for (const [oid, os] of scores) {
      if (id === oid) continue;
      if (s > os) rows[id].w++; else if (s < os) rows[id].l++; else rows[id].d++;
    }
  }
  return { rows, played };
}
// Monte Carlo the rest of the regular season from each manager's scoring history
function playoffOdds(runs = 1000) {
  const hist = Object.fromEntries(state.managers.map(m => [m.id, []]));
  for (let i = 0; i < REGULAR_GWS; i++) {
    if (gwStatus(i) !== 'final') continue;
    for (const m of state.managers) hist[m.id].push(gwManagerPoints(m.id, i));
  }
  const played = hist[state.managers[0].id].length;
  if (played < 3 || played >= REGULAR_GWS) return null; // too early to guess / nothing left to simulate
  const dist = {};
  for (const m of state.managers) {
    const a = hist[m.id];
    const mean = a.reduce((t, x) => t + x, 0) / a.length;
    const sd = Math.sqrt(a.reduce((t, x) => t + (x - mean) ** 2, 0) / a.length);
    dist[m.id] = { mean, sd: Math.max(6, sd) };
  }
  const base = h2hStandings(false);
  const remaining = [];
  for (let i = 0; i < REGULAR_GWS; i++) if (gwStatus(i) !== 'final') remaining.push(i);
  const counts = Object.fromEntries(state.managers.map(m => [m.id, 0]));
  const norm = ({ mean, sd }) => mean + sd * Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
  for (let r = 0; r < runs; r++) {
    const pts = {}, pf = {};
    for (const row of base) { pts[row.id] = row.pts; pf[row.id] = row.pf; }
    for (const i of remaining) for (const [a, b] of pairingsFor(i)) {
      const sa = norm(dist[a]), sb = norm(dist[b]);
      pf[a] += sa; pf[b] += sb;
      if (Math.abs(sa - sb) < 0.5) { pts[a]++; pts[b]++; } else if (sa > sb) pts[a] += 3; else pts[b] += 3;
    }
    state.managers.map(m => m.id)
      .sort((x, y) => (pts[y] - pts[x]) || (pf[y] - pf[x]))
      .slice(0, 8).forEach(id => counts[id]++);
  }
  return Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, Math.round(100 * c / runs)]));
}
/* ---------------- the trade block ---------------- */
const blockList = mid => toArr(state.tradeBlock?.[mid]);
const onBlock = pid => state.managers.some(m => blockList(m.id).includes(pid));
function toggleBlock(mid, pid) {
  if (netOn()) {
    serverAct('blockToggle', { pid, ...(mid !== whoami && { asManager: mid }) }).catch(() => {});
    return;
  }
  const list = blockList(mid);
  const next = list.includes(pid) ? list.filter(x => x !== pid) : [...list, pid];
  state.tradeBlock = { ...(state.tradeBlock || {}), [mid]: next };
  save(); render();
}

/* ---------------- head-to-head ---------------- */
// The whistle test — mirrors js/engine.js roundBlown: whole round present,
// every game blown full time (feed `fp`, set at the whistle), plus half an
// hour's grace after the last game could have finished. Safe to settle on
// because the league pays no bonus; FPL's own event flag can sit unflipped
// well past a Monday night (Committee, 24 Aug; Ben: "wait 30 mins and then
// bang" — no provisional messaging, a rare late correction just flows
// through the next refresh). Postponements break fullRound so a part-played
// round never settles early.
const SETTLE_GRACE_MS = 150 * 60000; // last kickoff + ~115min to FT + 30min grace
function roundBlown(i) {
  // a live Simulation Chamber paints finished=true into state.fixtures as
  // its clock advances (patchMockFixtures) — the whistle test must not read
  // those as a settled real round (sol, settlement round). At mock 'final'
  // the mock stamps ev.final itself, so nothing is lost by sitting out.
  if (state.mock?.phase === 'live') return false;
  const gwN = GAMEWEEKS[i]?.n;
  if (!gwN) return false;
  const gwFx = (state.fixtures || []).filter(f => f.gw === gwN);
  const fullRound = gwFx.length > 0 && new Set(gwFx.flatMap(f => [f.home, f.away])).size === TEAMS.length;
  if (!fullRound || !gwFx.every(f => f.finished || f.fp)) return false;
  const ts = gwFx.filter(f => f.date).map(f => new Date(f.date).getTime());
  return ts.length > 0 && Date.now() >= Math.max(...ts) + SETTLE_GRACE_MS;
}
function gwStatus(i) {
  const ev = gwEvent(i);
  const synced = !!ev && Object.keys(ev.playerStats || {}).length > 0;
  if (synced && (ev.final || gwIsOver(i) || roundBlown(i))) return 'final';
  if (synced) return 'live';
  if (gwHasStarted(i)) return 'underway';
  return 'upcoming';
}
// display truth for "is this gameweek under way": the clock says so, OR stats
// exist for it (the demo and the sandbox Simulation Chamber both produce
// stats before the real kickoff date). Locks and transfer maths must keep
// using the time-based gwHasStarted — this is for showing points, only.
function gwUnderway(i) { const st = gwStatus(i); return st === 'live' || st === 'final' || gwHasStarted(i); }
function h2hStandings(includeLive = false, uptoGw = REGULAR_GWS) {
  const rows = Object.fromEntries(state.managers.map(m => [m.id, { id: m.id, name: m.name, team: m.team, p: 0, w: 0, d: 0, l: 0, pts: 0, pf: 0, pa: 0 }]));
  for (let i = 0; i < Math.min(uptoGw, REGULAR_GWS); i++) {
    const st = gwStatus(i);
    if (st !== 'final' && !(includeLive && st === 'live')) continue;
    for (const [a, b] of pairingsFor(i)) {
      const pa = gwManagerPoints(a, i), pb = gwManagerPoints(b, i);
      rows[a].p++; rows[b].p++;
      rows[a].pf += pa; rows[a].pa += pb;
      rows[b].pf += pb; rows[b].pa += pa;
      if (pa > pb) { rows[a].w++; rows[a].pts += 3; rows[b].l++; }
      else if (pb > pa) { rows[b].w++; rows[b].pts += 3; rows[a].l++; }
      else { rows[a].d++; rows[b].d++; rows[a].pts++; rows[b].pts++; }
    }
  }
  // tiebreak on overall cumulative points — the Ovr number the table shows,
  // in-play GWs included, so a side on 50 sits above a side on 35 when both
  // hold 3 Points (Ben, 23 Aug). Capped at the regular season: managerPoints()
  // spans all 38 GWs, so playoff scoring could reshuffle a settled table.
  for (const m of state.managers) {
    let t = 0;
    for (let i = 0; i < Math.min(uptoGw, REGULAR_GWS); i++) t += gwManagerPoints(m.id, i);
    rows[m.id].ovr = t;
  }
  return Object.values(rows).sort((x, y) => y.pts - x.pts || y.ovr - x.ovr || y.pf - x.pf);
}

/* ---------------- FPL sync ---------------- */
// Stats are fetched by a GitHub Action from the official FPL API and committed
// to data/stats.json + data/fixtures.json. The app just reads those files —
// player ids are FPL's own, so there is no name-matching to go wrong.
let liveTimer = null;
// fp = whistle gone (finished_provisional): FPL's `finished` waits hours for
// data checks, which kept the pill burning and matches "LIVE" all night.
// Every DISPLAY surface asks fxOver; settlement keeps the slow, safe flag.
const fxOver = f => !!(f.finished || f.fp);
// the Highlights href: the EXACT Sky video when the curated map has this
// fixture (Ben, GW1 night — "e.g. youtube.com/watch?v=..."), else a search
// deep-link the YouTube app handles (the channel-page URL form does not).
// The search asks for clubs by the names Sky actually title videos with:
// four of ours are FPL abbreviations that appear in no video title anywhere,
// so "Hull City 2-0 Man Utd" found nothing (Marc, 22 Aug). Only the
// abbreviations are mapped — "Ipswich Town" for Sky's "Ipswich" is a
// superset and searches fine, a wrong short name does not.
const SKY_NAME = {
  'Man Utd': 'Manchester United',
  'Man City': 'Manchester City',
  'Spurs': 'Tottenham',
  "Nott'm Forest": 'Nottingham Forest',
};
const skyName = t => SKY_NAME[t] || t;
function fxYtHref(f) {
  const vid = state.highlights?.[String(f.id)];
  if (vid && /^[\w-]{6,20}$/.test(vid)) return `https://www.youtube.com/watch?v=${vid}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`sky sports ${skyName(f.home)} ${f.hs ?? ''}-${f.as ?? ''} ${skyName(f.away)} highlights`)}`;
}
function anyMatchLive() { return state.fixtures.some(f => f.started && !fxOver(f)); }

/* ---- the Vidiprinter (ledger #8 — Tussie's Soccer-Saturday ticker) ----

   DERIVED from the round's stats, not from what this device happened to watch.

   Marc, 28 Aug 2026, mid Palace v City: "its definitely the first but i think
   this shows a misunderstanding of what the vidiprinter is. its a record of
   everything live, shouldnt be linked to anyones device."

   He is right, and the old design had it backwards. The tape used to be built
   by diffing each stats sync against the last and appending to a localStorage
   feed — so it recorded what YOUR phone was awake to see. Three consequences,
   all of them wrong: two managers watching the same match got different tapes;
   the timestamp on a line was when your device noticed, not when the thing
   happened; and anything that occurred before you opened the app was lost for
   good, because the first snapshot became a silent baseline. That last one is
   what emptied the tape during Palace v City — with the Pages feed three hours
   stale and holding no GW2 stats at all, the baseline was EMPTY, so the guard
   against printing a whole gameweek at once swallowed the entire match.

   A player's cumulative counters for the round already ARE the record: a man
   sitting on g:2 scored twice, whether or not anyone's phone was watching. So
   the tape is now computed from those counters every render. Same input, same
   output, on every device, complete from the moment you open it, and nothing
   kept in localStorage at all.

   What that costs, honestly: FPL's feed carries no minute-of-event, so true
   chronology is not recoverable. It never was — the old per-line clock was
   device-local fiction. Lines are grouped by match instead, live games first,
   and each carries its fixture and the score in it rather than a fake time. */
const VIDI_WORDS = { 10: 'TEN', 11: 'ELEVEN', 12: 'TWELVE', 13: 'THIRTEEN', 14: 'FOURTEEN', 15: 'FIFTEEN', 16: 'SIXTEEN' };
// the round the tape is reporting on: the latest one that has any stats
function vidiRound() {
  for (let i = GAMEWEEKS.length - 1; i >= 0; i--) {
    const ps = gwEvent(i)?.playerStats;
    if (ps && Object.keys(ps).length) return i;
  }
  return null;
}
const VIDI_EVENTS = [
  ['g', '⚽', n => n > 1 ? `${n} GOALS` : 'GOAL'],
  ['a', '🅰️', n => n > 1 ? `${n} assists` : 'assist'],
  ['ps', '🧄', () => 'PENALTY SAVED'],
  ['pm', '🙈', () => 'penalty missed'],
  ['og', '😬', () => 'own goal'],
  ['rc', '🟥', () => 'RED CARD'],
  ['yc', '🟨', () => 'booked'],
];
/* One line per player who has done something this round, built from his
   cumulative counters. Deterministic: same stats in, same tape out, so every
   manager's screen agrees. Grouped by match — live games first, then most
   recent kickoff — because FPL gives no minute-of-event and inventing an
   order would be the same fiction as the old device clock. */
function vidiLines(gwIdx) {
  const ps = gwEvent(gwIdx)?.playerStats;
  if (!ps || !Object.keys(ps).length) return [];
  const gwN = GAMEWEEKS[gwIdx]?.n;
  if (gwN == null) return [];
  // the ticker credits the fantasy team — starters get the points line
  const starterOf = {}, benchOf = {};
  for (const m of state.managers) {
    for (const pid of effectiveXI(m.id, gwIdx).xi) starterOf[pid] = m.id;
    for (const p of squadAt(m.id, gwIdx)) if (starterOf[p.id] == null) benchOf[p.id] = m.id;
  }
  const out = [];
  for (const [pid, s] of Object.entries(ps)) {
    const p = PLAYER_BY_ID[pid];
    if (!p) continue;
    const bits = [];
    for (const [k, icon, word] of VIDI_EVENTS) {
      const n = s[k] || 0;
      if (n > 0) bits.push(`${icon} ${word(n)}`);
    }
    if (!bits.length) continue;
    const fx = teamFixturesInGw(p.team, gwN).find(f => f.started) || teamFixturesInGw(p.team, gwN)[0] || null;
    const live = !!(fx && fx.started && !fxOver(fx));
    // his contribution to the round, not a delta: a derived tape has no
    // "since last time" to measure against, and the total is the truer number
    const pts = statPoints(p, s);
    const mid = starterOf[p.id];
    const who = mid != null ? `${teamName(mid)} ${pts >= 0 ? '+' : ''}${pts}`
      : benchOf[p.id] != null ? `benched by ${teamName(benchOf[p.id])} (!)` : 'the Trough';
    const haul = pts >= 10 && mid != null ? ` (${VIDI_WORDS[pts] || pts}!!)` : '';
    // the real game's score, which is a property of the match and so reads the
    // same for everyone. The fantasy tie used to ride along on every goal line
    // (Ben, 23 Aug: "both") — it cannot any more, because a derived line has no
    // moment attached and would just repeat the CURRENT tie on every row. It is
    // on the scoreboard directly above this card.
    let score = '';
    if ((s.g || 0) > 0 && fx && fx.hs != null)
      score = ` — ${TEAM_BY_NAME[fx.home]?.short || fx.home} ${fx.hs}\u2013${fx.as} ${TEAM_BY_NAME[fx.away]?.short || fx.away}`;
    const at = fx ? `${TEAM_BY_NAME[fx.home]?.short || fx.home} v ${TEAM_BY_NAME[fx.away]?.short || fx.away}` : `GW${gwN}`;
    const sortKick = fx && fx.date ? Date.parse(fx.date) : 0;
    out.push({ key: `${gwN}:${p.id}`, at, live, sortKick, pts,
      txt: `${bits.join(' \u00b7 ')} — ${p.name} (${p.club}) — ${who}${haul}${score}` });
    // the Lobus Klaxon: declarations are GONE (Marc, UAT night — "remove the
    // declare my lobus"); it fires off the certified registry instead, so the
    // gag needs no admin. Big units only. Derived like everything else, so the
    // line is on the tape for a man who scored before you opened the app.
    if ((s.g || 0) > 0 && p.pos === 'FW' && LOBUS_LIST.some(l => normName(p.name).includes(l)))
      out.push({ key: `${gwN}:${p.id}:lobus`, at, live, sortKick, pts: 99,
        txt: `\u{1F6A8}\u{1F4EF} LOBUS KLAXON \u{1F4EF}\u{1F6A8} ${p.name} — certified lobus — has SCORED. Great feet for a big man.` });
  }
  // live matches on top, then the most recent kickoff; within a match the
  // biggest story first. Stable, and identical wherever it is computed.
  out.sort((a, b) => (b.live - a.live) || (b.sortKick - a.sortKick) || (b.pts - a.pts) || a.key.localeCompare(b.key));
  return out;
}
/* The klaxon SOUND still needs a before-and-after — a noise is a live moment,
   not a record, and blasting it for every historic goal on page load would be
   a disaster. Sounded keys are per session on purpose. */
const vidiKlaxonHeard = new Set();
function vidiKlaxon(gwIdx, oldPS, newPS) {
  if (state.phase !== 'season' || !newPS || !oldPS || !Object.keys(oldPS).length) return;
  const gwN = GAMEWEEKS[gwIdx]?.n;
  if (gwN == null) return;
  for (const [pid, s] of Object.entries(newPS)) {
    const p = PLAYER_BY_ID[pid];
    if (!p || p.pos !== 'FW') continue;
    const g = s.g || 0;
    if (g <= (oldPS[pid]?.g || 0)) continue;
    if (!LOBUS_LIST.some(l => normName(p.name).includes(l))) continue;
    const k = `${gwN}:${p.id}:${g}`;
    if (vidiKlaxonHeard.has(k)) continue;
    vidiKlaxonHeard.add(k);
    playSound('klaxon');
  }
}
/* ----- the Simulation Chamber (sandbox-only): a pretend matchday for the
   lads' real drafted teams. The Chairman kicks it off; every device derives
   IDENTICAL stats from the shared {gw, phase, seed, t} flag (deterministic
   LCG per player), so no stat payload ever syncs. 'live' plays out over ~20
   minutes — points tick up, the vidiprinter clatters, the klaxon can fire —
   then 'final' settles it. The real league has no such lever: the server
   action hard-refuses outside the-league-sandbox. ----- */
const MOCK_LIVE_MS = 20 * 60e3;
// Kickoffs are STAGGERED (Ben, UAT night: "let's make it not" all kick off
// together): each fixture's real kickoff time maps onto the first 60% of the
// mock window, so the Friday-to-Monday shape compresses into the 20 minutes —
// the Friday game reaches full time before Monday's has kicked off, exactly
// like a real round. 60% spread + 40% match span guarantees that overlap.
const MOCK_KO_SPREAD = 0.6;
// minutes played in THIS fixture given overall window progress (0..1)
const mockFxElapsed = (ko, frac) => Math.round(90 * Math.max(0, Math.min(1, (frac - ko) / (1 - MOCK_KO_SPREAD))));
function mockRnd(seed) { let s = (seed >>> 0) || 1; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }
/* Real scorelines first, player stats second (Ben, mock night: "annoyed me
   that in the test they didn't make up real game scores"). Each fixture gets a
   deterministic score with goal minutes; player stats are then derived FROM the
   scoreline — goals sum to the team's total, clean sheets exist only when the
   opponent actually failed to score, conceded counts match, and the patched
   fixtures make win-prob "still to play" honest (Toby's 38–28 "11 v 11" bar). */
function mockScorelines(gwIdx, seed) {
  const gwN = GAMEWEEKS[gwIdx].n;
  const score = rnd => { const r = rnd(); return r < 0.28 ? 0 : r < 0.62 ? 1 : r < 0.85 ? 2 : r < 0.96 ? 3 : 4; };
  const gwFx = state.fixtures.filter(x => x.gw === gwN);
  // kickoff offsets: real kickoff order squeezed into [0, MOCK_KO_SPREAD];
  // no usable dates (synthetic calendars) → spread by list position instead
  const stamps = gwFx.map(x => Date.parse(x.date || '') || 0);
  const lo = Math.min(...stamps, Infinity), hi = Math.max(...stamps, -Infinity);
  const koFor = (f, i) => {
    if (hi > lo && Date.parse(f.date || '')) return (Date.parse(f.date) - lo) / (hi - lo) * MOCK_KO_SPREAD;
    return gwFx.length > 1 ? (i / (gwFx.length - 1)) * MOCK_KO_SPREAD : 0;
  };
  const teams = {}, fixtures = [];
  gwFx.forEach((f, i) => {
    const rnd = mockRnd(seed * 6151 + (f.id || 0) * 30011);
    const hs = score(rnd), as = score(rnd);
    const ht = Array.from({ length: hs }, () => Math.max(1, Math.ceil(rnd() * 90))).sort((a, b) => a - b);
    const at = Array.from({ length: as }, () => Math.max(1, Math.ceil(rnd() * 90))).sort((a, b) => a - b);
    const ko = koFor(f, i);
    fixtures.push({ f, ht, at, ko });
    teams[f.home] = { times: ht, oppTimes: at, ko };
    teams[f.away] = { times: at, oppTimes: ht, ko };
  });
  return { teams, fixtures };
}
function mockGwStats(gwIdx, seed, frac) {
  const ps = {};
  const featured = new Set();
  for (const m of state.managers) for (const p of squadAt(m.id, gwIdx)) featured.add(p.id);
  for (const arr of Object.values(state.hamCup?.entries || {})) for (const pid of toArr(arr)) featured.add(+pid);
  const { teams } = mockScorelines(gwIdx, seed);
  const haveFixtures = Object.keys(teams).length > 0;
  // pass 1: who featured, and for how long — each on HIS fixture's clock
  const roster = []; // {p, started, mins, el}
  for (const pid of featured) {
    const p = PLAYER_BY_ID[pid];
    if (!p) continue;
    if (haveFixtures && !teams[p.team]) continue; // blank GW for his club — didn't play, honestly
    const el = haveFixtures ? mockFxElapsed(teams[p.team].ko, frac) : Math.round(90 * frac);
    const rnd = mockRnd(seed * 7919 + pid * 104729);
    if (rnd() < 0.07) continue; // left out this week
    const started = rnd() < 0.85;
    const mins = started ? el : Math.max(0, el - 60); // subs enter on the hour
    if (!mins) continue; // his game hasn't kicked off (or he's not on yet) — no stat line
    roster.push({ p, rnd, started, mins, el });
  }
  const byTeam = {};
  for (const r of roster) (byTeam[r.p.team] = byTeam[r.p.team] || []).push(r);
  // pass 2: hand each team's ACTUAL goals to plausible scorers (or to an
  // unlisted teammate — not every Premier League goal is owned in this league)
  const goalW = { FW: 5, MF: 3, DF: 1, GK: 0.05 };
  const credit = {}; // pid -> {g:[times], a:[times]}
  for (const [team, sl] of Object.entries(teams)) {
    const squad = byTeam[team] || [];
    const rnd = mockRnd(seed * 13007 + team.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 251);
    for (const t of sl.times) {
      const pool = squad.filter(r => r.started || t > 60); // late subs can't score early goals
      const tw = pool.reduce((a, r) => a + goalW[r.p.pos], 0);
      // roughly: the more of the XI this league owns, the likelier the scorer is owned
      if (pool.length && rnd() < Math.min(0.85, 0.25 + pool.length * 0.08)) {
        let pickAt = rnd() * tw;
        const scorer = pool.find(r => (pickAt -= goalW[r.p.pos]) <= 0) || pool[pool.length - 1];
        (credit[scorer.p.id] = credit[scorer.p.id] || { g: [], a: [] }).g.push(t);
        const helpers = pool.filter(r => r !== scorer && r.p.pos !== 'GK');
        if (helpers.length && rnd() < 0.6) {
          const h = helpers[Math.floor(rnd() * helpers.length)];
          (credit[h.p.id] = credit[h.p.id] || { g: [], a: [] }).a.push(t);
        }
      }
    }
  }
  // pass 3: the stat lines, consistent with each fixture's scoreboard so far
  for (const { p, rnd, started, mins, el } of roster) {
    const sl = teams[p.team];
    const conceded = sl ? sl.oppTimes.filter(t => t <= el).length : 0;
    const fxFrac = el / 90;
    const cr = credit[p.id] || { g: [], a: [] };
    const s = {
      min: mins, st: started ? 1 : 0, sub: started ? 0 : 1,
      g: cr.g.filter(t => t <= el).length,
      a: cr.a.filter(t => t <= el).length,
      cs: sl && conceded === 0 && el >= 60 && mins >= 60 ? 1 : 0,
      gc: conceded, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0,
    };
    if (rnd() < 0.10 && rnd() < fxFrac) s.yc = 1;
    if (p.pos === 'GK') s.sv = Math.min(9, Math.floor(rnd() * 4 * fxFrac) + (conceded ? 1 : 0));
    ps[p.id] = s;
  }
  return ps;
}
// the pretend scoreboard goes on the real fixture list (and comes off it
// cleanly) — matchNeeds/win-prob read fixtures, so the mock must feed them.
// A feed sync can replace the array mid-mock with FRESHER truth (a real
// result landing): object identity tells us which fixtures we've already
// patched, so replaced objects get their new values remembered before we
// paint over them (sol mock-night P1: the old code restored stale scores).
// ⚠️ IDENTITY-DEPENDENT (sol r2 P3): this only works because syncNow parses
// fresh JSON, so every sync makes NEW fixture objects. If a future refactor
// ever mutates fixture objects in place instead, the saved values go stale
// again — keep syncs replace-not-mutate, or rethink this capture.
let mockFxSaved = null;
let mockFxPatched = new WeakSet();
function patchMockFixtures(mk, frac, final) {
  const { fixtures } = mockScorelines(mk.gw, +mk.seed || 1);
  mockFxSaved = mockFxSaved || {};
  for (const { f, ht, at, ko } of fixtures) {
    if (!mockFxPatched.has(f)) {
      mockFxSaved[f.id] = { hs: f.hs, as: f.as, started: f.started, finished: f.finished, minutes: f.minutes };
      mockFxPatched.add(f);
    }
    const el = final ? 90 : mockFxElapsed(ko, frac);
    f.hs = el ? ht.filter(t => t <= el).length : null;
    f.as = el ? at.filter(t => t <= el).length : null;
    f.started = el > 0; f.finished = !!final || el >= 90; f.minutes = el;
  }
}
function unpatchMockFixtures() {
  if (!mockFxSaved) return;
  for (const f of state.fixtures) {
    const sv = mockFxSaved[f.id];
    if (sv) Object.assign(f, sv);
  }
  mockFxSaved = null;
  mockFxPatched = new WeakSet();
}
let mockPrevPS = null, mockMemo = '', mockGwKeyApplied = null;
let mockEvSaved = {}; // real matchStats events that synced mid-mock, by gwKey
// returns true when the overlay changed (callers may re-render)
function applyMock() {
  if (!SANDBOX || demoMode) return false;
  const mk = state.mock;
  if (!mk || mk.gw == null || !GAMEWEEKS[mk.gw]) {
    // chamber switched off — remove only what WE injected, never real stats.
    // A REAL event that synced mid-mock was stashed; it goes back now.
    unpatchMockFixtures();
    if (mockGwKeyApplied && String(state.matchStats[mockGwKeyApplied]?.label || '').includes('simulation')) {
      if (mockEvSaved[mockGwKeyApplied]) state.matchStats[mockGwKeyApplied] = mockEvSaved[mockGwKeyApplied];
      else delete state.matchStats[mockGwKeyApplied];
      mockGwKeyApplied = null; mockPrevPS = null; mockMemo = ''; mockEvSaved = {};
      return true;
    }
    mockEvSaved = {};
    return false;
  }
  const final = mk.phase === 'final';
  const frac = final ? 1 : Math.max(0.04, Math.min(1, (Date.now() - hamTs(mk.t)) / MOCK_LIVE_MS));
  const gwKey = `gw${GAMEWEEKS[mk.gw].n}`;
  // fixtures re-patch every pass — a feed sync can silently replace the array
  patchMockFixtures(mk, frac, final);
  const memo = `${mk.gw}:${mk.phase}:${mk.seed}:${final ? 'F' : Math.floor(frac * 40)}`;
  if (memo === mockMemo && state.matchStats[gwKey]?.label?.includes('simulation')) return false;
  mockMemo = memo;
  const ps = mockGwStats(mk.gw, +mk.seed || 1, frac);
  const prevMockPS = mockPrevPS;
  mockPrevPS = ps;
  // a REAL event for this gameweek that synced in while the chamber runs is
  // feed truth — stash it so switch-off restores it instead of deleting
  const existing = state.matchStats[gwKey];
  if (existing && !String(existing.label || '').includes('simulation')) mockEvSaved[gwKey] = existing;
  state.matchStats[gwKey] = { gw: mk.gw, label: `GW${GAMEWEEKS[mk.gw].n} — simulation`, date: GAMEWEEKS[mk.gw].from, final, playerStats: ps };
  // klaxon AFTER the stats land — the tape itself is derived from them,
  // which reads state (Ben, 23 Aug)
  if (prevMockPS && state.phase === 'season') { try { vidiKlaxon(mk.gw, prevMockPS, ps); } catch { /* the klaxon can miss a beat */ } }
  mockGwKeyApplied = gwKey;
  return true;
}
// the live sim advances on its own — nudge the page along once a minute
setInterval(() => { if (SANDBOX && !demoMode && state.mock?.phase === 'live') { if (applyMock()) render(); } }, 60e3);
// the waiver countdown ticks in place — no full re-render under the reader
setInterval(() => {
  if (document.hidden) return;
  for (const id of ['wvClock', 'wvClock2']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = waiverClockLine();
  }
}, 30e3);
/* Live wire truth + self-heal (GW1 night). Every 10s during a live match the
 * LIVE pill re-renders so its age is real, and — Layer 3 — a client staring
 * at a stale overlay asks the server for ONE immediate fetch-and-write per
 * staleness episode. Never a loop: the trigger re-arms only after fresh data
 * actually lands, and a hard cooldown backs that up. Server-side rate limits
 * (per-uid AND global) mean twelve phones can't stampede anything. */
let liveHealArmed = true, liveHealLastAt = 0;
setInterval(() => {
  if (document.hidden || !anyMatchLive()) return;
  renderSyncArea();
  const age = liveDataAgeMs();
  if (age == null) return;
  if (age < 2 * 60e3) { liveHealArmed = true; return; }
  if (!liveHealArmed || !netOn() || !authUser || SANDBOX || demoMode || state.mock) return;
  if (Date.now() - liveHealLastAt < 5 * 60e3) return;
  liveHealArmed = false; liveHealLastAt = Date.now();
  window.WCSync?.liveRefresh?.()
    .then(r => console.log('[live] self-heal', JSON.stringify(r)))
    .catch(e => console.warn('[live] self-heal failed', e));
}, 10e3);
function vidiCard(compact = false) {
  const live = anyMatchLive();
  const gwIdx = vidiRound();
  const all = gwIdx == null ? [] : vidiLines(gwIdx);
  if (!all.length && !live) return '';
  // the fixture replaces the old per-line clock: it is a property of the match,
  // so it reads the same on every phone (Marc, 28 Aug)
  const rows = all.slice(0, compact ? 12 : 30).map(l =>
    `<div class="vidi-line"><span class="vidi-when">${esc(l.at)}</span> ${esc(l.txt)}</div>`).join('');
  const more = all.length > (compact ? 12 : 30) ? `<div class="vidi-line" style="color:var(--muted)">…and ${all.length - (compact ? 12 : 30)} more this gameweek.</div>` : '';
  return `<div class="card" style="margin-top:14px">
    <h2>The Vidiprinter ${live ? '<span class="tag live-tag"><span class="rec"></span>LIVE</span>' : ''} <span class="muted" style="font-weight:400;font-size:12px">every incident, straight off the wire</span></h2>
    <div class="vidi-tape">${rows || '<div class="vidi-line" style="color:var(--muted)">The tape is quiet. Kick-off will fix that.</div>'}${more}</div>
  </div>`;
}

async function syncNow(manual = false) {
  if (demoMode) { if (manual) toast('Demo mode — the results are fictional, like Blanky’s title chances post GW10'); return; }
  const btn = $('#syncBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '&#8987;<span class="sync-txt"> Refreshing…</span>'; }
  try {
    const bust = `?t=${Date.now()}`;
    const [statsRes, fxRes, hlRes, luRes] = await Promise.all([
      fetch(`data/stats.json${bust}`),
      fetch(`data/fixtures.json${bust}`),
      fetch(`data/highlights.json${bust}`).catch(() => null), // optional, hand-curated
      fetch(`data/lineups.json${bust}`).catch(() => null),    // optional, predicted XIs
    ]);
    const stats = await statsRes.json();
    const fixtures = await fxRes.json();
    // exact Sky highlights videos by fixture id (Ben, GW1 night) — absence
    // of the file, or of any given match, just means the search fallback
    if (hlRes?.ok) { try { state.highlights = await hlRes.json(); } catch { /* keep the old map */ } }
    // predicted line-ups (Marc, 24 Aug 2026). Optional in exactly the same way
    // the highlights map is: no file, or a file that will not parse, and the
    // projection carries on with the signals it already had.
    if (luRes?.ok) { try { state.lineupsFeed = await luRes.json(); } catch { /* keep the old book */ } }
    state.feedGenerated = stats.generated || null; // for the stale-feed warning
    state.fixtures = fixtures
      .filter(f => f.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    let fresh = 0;
    for (const [gwN, gw] of Object.entries(stats.gws || {})) {
      const i = +gwN - 1;
      if (!GAMEWEEKS[i]) continue;
      const key = `gw${gwN}`;
      const before = JSON.stringify(state.matchStats[key]?.playerStats || {}).length;
      const oldPS = state.matchStats[key]?.playerStats;
      state.matchStats[key] = {
        gw: i,
        label: GAMEWEEKS[i].label,
        date: GAMEWEEKS[i].from,
        final: !!gw.finished,
        playerStats: gw.stats || {},
      };
      if (JSON.stringify(gw.stats || {}).length !== before) fresh++;
      try { vidiKlaxon(i, oldPS, gw.stats || {}); } catch (e) { console.warn('[vidi]', e); }
    }
    state.lastSync = new Date().toISOString();
    save(); render();
    if (manual) toast(fresh ? `Feed refreshed — ${fresh} gameweek${fresh > 1 ? 's' : ''} updated` : 'Feed refreshed — nothing new');
  } catch (err) {
    console.error(err);
    if (manual) toast('Sync failed — check connection');
  }
  const b2 = $('#syncBtn');
  if (b2) { b2.disabled = false; renderSyncArea(); } // rebuild the stamp whatever happened
  // keep tapping while matches are in play (the Action refreshes every ~5-10 min)
  clearTimeout(liveTimer);
  if (anyMatchLive()) liveTimer = setTimeout(() => syncNow(false), 5 * 60 * 1000);
}

/* ---------------- browser history: back/forward walk the tabs ----------------
   Each view change pushes #view; popstate swaps the view back. Pop-overs
   (player card, matchup) push their own entry so the back button closes
   them instead of leaving the page — the phone-native expectation. */
let hashInit = false;
let ovDepth = 0;        // history entries currently representing open pop-overs
let ovSkipClose = false; // set when a pop-over closed itself and fired history.back()
function syncHash() {
  // setup participates too: the three setup tabs get their own hashes and the
  // waiting room is #home, so Back walks Rules → Club → room instead of
  // falling out of setup entirely (sol club-office P2.3)
  const want = state.phase === 'setup'
    ? `#${SETUP_NAV.has(state.view) ? state.view : 'home'}`
    : `#${state.view}`;
  if (location.hash === want) return;
  try {
    hashInit ? history.pushState(null, '', want) : history.replaceState(null, '', want);
  } catch { /* file:// — no history, no problem */ }
  hashInit = true;
}
function pushOvState() {
  try { history.pushState({ ov: ++ovDepth }, '', location.hash); } catch { ovDepth--; }
}
function closeOv(el) {
  el.remove();
  if (history.state && history.state.ov) {
    ovSkipClose = true;
    try { history.back(); } catch { ovSkipClose = false; }
  }
}
window.addEventListener('popstate', () => {
  if (ovDepth > 0) {
    ovDepth--;
    if (ovSkipClose) { ovSkipClose = false; return; }
    const ovs = document.querySelectorAll('.overlay');
    if (ovs.length) ovs[ovs.length - 1].remove();
    return;
  }
  const v = location.hash.slice(1);
  if (state.phase === 'setup') {
    // #club/#rules/#settings restore that tab; anything else is the room
    const target = SETUP_NAV.has(v) ? v : 'home';
    const curr = SETUP_NAV.has(state.view) ? state.view : 'home';
    if (target !== curr) { state.view = SETUP_NAV.has(v) ? v : 'dash'; save(); render(); }
    return;
  }
  if (v && v !== state.view && NAV_ITEMS.some(([k]) => k === v)) {
    state.view = v; save(); render();
  }
});

/* ---------------- the confirm sheet ----------------
   DF-style final look at a deal before it commits. Every squad-moving
   decision routes through here — a mis-tap must never move a player.
   Back button / backdrop tap = cancel. Test harnesses set
   window.__autoConfirm to sail straight through. */
/* ----- transaction receipts (sol UX #1): after the deal, the paperwork —
   who came, who went, which gameweek it counts from, what it does to your
   XI, and where to go next. Same overlay language as everything else. ----- */
function receiptSheet({ title, inP, outP, gw, note = '', mid = whoami, wasStarting = null, pending = false }) {
  // Executed deals strip the outgoing player before this sheet opens, so the
  // caller captures his pre-deal XI status. Pending claims have changed
  // nothing yet and must never masquerade as completed business.
  const started = wasStarting == null ? !!(outP && mid && lineupFor(mid, gw).includes(outP.id)) : !!wasStarting;
  const impact = !outP ? ''
    : pending ? `No XI change yet — ${esc(outP.name)} stays in your GW${GAMEWEEKS[gw].n} side unless the waiver goes through.`
    : started ? `${esc(outP.name)} was in your GW${GAMEWEEKS[gw].n} XI — pick his replacement on My Team.`
    : `Your XI is untouched — ${esc(outP.name)} was on the bench.`;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="card" style="max-width:420px;width:94%" role="dialog" aria-label="Receipt">
    <h2>${esc(title)}</h2>
    ${dealRows(outP ? [outP] : [], inP ? [inP] : [])}
    <p style="font-size:12.5px;margin-top:8px">${pending ? 'Would count' : 'Counts'} from <b>GW${GAMEWEEKS[gw].n}</b>.${impact ? ` ${impact}` : ''}</p>
    ${note ? `<p class="muted" style="font-size:12px">${note}</p>` : ''}
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn ghost small" id="rcSquad" style="flex:1">View squad</button>
      <button class="btn ghost small" id="rcHist" style="flex:1">History</button>
      <button class="btn small" id="rcDone" style="flex:1">Done</button>
    </div></div>`;
  document.body.appendChild(ov);
  pushOvState();
  const done = () => closeOv(ov);
  ov.onclick = e => { if (e.target === ov) done(); };
  ov.querySelector('#rcDone').onclick = done;
  ov.querySelector('#rcSquad').onclick = () => { done(); state.view = 'team'; if (mid) teamView.mid = mid; save(); render(); };
  ov.querySelector('#rcHist').onclick = () => { done(); state.view = 'transfers'; transfersView.tab = 'history'; save(); render(); };
}
function confirmSheet({ title, body = '', yes = 'Confirm', note = '' }) {
  if (window.__autoConfirm) return Promise.resolve(true);
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.id = 'confirmSheet';
    ov.innerHTML = `<div class="card" style="max-width:420px;width:94%">
      <h2 style="margin-bottom:12px">${title}</h2>
      ${body}
      ${note ? `<p class="muted" style="font-size:12.5px;margin:10px 0 0">${note}</p>` : ''}
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn ghost" id="cfNo" style="flex:1">Cancel</button>
        <button class="btn" id="cfYes" style="flex:1">${yes}</button>
      </div>
    </div>`;
    // any external close (back button, popstate overlay sweep) = cancel —
    // the promise must never hang
    const origRemove = ov.remove.bind(ov);
    ov.remove = () => { origRemove(); resolve(false); };
    document.body.appendChild(ov);
    pushOvState();
    ov.querySelector('#cfYes').onclick = () => { resolve(true); closeOv(ov); };
    ov.querySelector('#cfNo').onclick = () => closeOv(ov);
    ov.onclick = e => { if (e.target === ov) closeOv(ov); };
  });
}
/* Ben (25 Aug, group chat): "I don't like that you can't select a player to
   take from the trough before you select the player out." So now you can:
   tapping Sign/Claim with nobody marked out opens this — pick the man who
   makes way and the deal carries straight on into the usual confirm. The
   old order (out first, then Sign) still works exactly as before. */
function chooseOutSheet(mid, inP, waiv) {
  const tgw = transferGw();
  const squad = squadAt(mid, tgw);
  const claimed = new Set(myClaims(mid).map(c => `${c.in}:${c.out}`));
  const legalFor = p => squadShapeOk([...squad.filter(x => x.id !== p.id), inP]);
  if (window.__autoConfirm) { const f = squad.find(p => legalFor(p) && !(waiv && claimed.has(`${inP.id}:${p.id}`))); return Promise.resolve(f ? f.id : null); }
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.id = 'outPickSheet';
    const rows = squad.map(p => {
      const dupe = waiv && claimed.has(`${inP.id}:${p.id}`);
      const ok = legalFor(p) && !dupe;
      const why = dupe ? 'That exact claim is already on your list' : 'Breaks the squad position limits';
      return `<button class="btn ghost small ${ok ? '' : 'dim'}" data-outpick="${p.id}" ${ok ? '' : `data-why="${esc(why)}" title="${esc(why)}"`} style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;margin-bottom:6px"><span class="pos-badge pos-${p.pos}">${p.pos}</span> <b>${esc(p.name)}</b> <span class="muted" style="font-size:11px">${esc(p.club)}</span></button>`;
    }).join('');
    ov.innerHTML = `<div class="card" style="max-width:420px;width:94%;max-height:80vh;overflow-y:auto">
      <h2 style="margin-bottom:6px">${waiv ? 'Claim' : 'Sign'} ${esc(inP.name)} &mdash; who makes way?</h2>
      <p class="muted" style="font-size:12px;margin-bottom:10px">${waiv ? 'Pick the man your claim would let go.' : `Pick the man who goes to waivers when ${esc(inP.name)} comes in.`}</p>
      ${rows}
      <button class="btn ghost" id="opCancel" style="width:100%;margin-top:8px">Cancel</button>
    </div>`;
    // any external close (back button, overlay sweep) = cancel — never hang
    const origRemove = ov.remove.bind(ov);
    ov.remove = () => { origRemove(); resolve(null); };
    document.body.appendChild(ov);
    pushOvState();
    ov.querySelectorAll('[data-outpick]').forEach(btn => btn.onclick = () => {
      if (btn.dataset.why) { toast(btn.dataset.why); return; }
      resolve(+btn.dataset.outpick); closeOv(ov);
    });
    ov.querySelector('#opCancel').onclick = () => closeOv(ov);
    ov.onclick = e => { if (e.target === ov) closeOv(ov); };
  });
}
const dealLine = p => p ? `<b>${esc(p.name)}</b> <span class="muted">${esc(p.club)} ${p.pos}</span>` : '<b>?</b>';
const dealRows = (outs, ins) => `<div class="deal">${
  outs.map(p => `<div class="deal-row"><span class="deal-tag out">OUT</span>${dealLine(p)}</div>`).join('')}${
  ins.map(p => `<div class="deal-row"><span class="deal-tag in">IN</span>${dealLine(p)}</div>`).join('')}</div>`;

/* ---------------- views ---------------- */
const NAV_ITEMS = [
  ['dash', 'Dashboard', 'Home'],
  ['draft', 'The Draft Console', 'Draft Console'],
  ['team', 'My Team', 'My Team'],
  ['club', 'My Club', 'Club'],
  ['directory', 'Club Directory', 'Clubs'],
  ['squads', 'All Squads', 'Squads'],
  ['transfers', 'Transfers', 'Transfers'],
  ['h2h', 'Matches', 'Matches'],
  ['cup', 'Cup Competitions', 'Cups'],
  ['table', 'League Table', 'Table'],
  ['data', 'The Data Room', 'Data'],
  ['fixtures', 'PL Fixtures', 'PL Fixtures'],
  ['rules', 'Rules', 'Rules'],
  ['settings', 'Settings', 'Settings'],
];
// phone tab bar icons — inline so the CSP stays 'self'-only
const navSvg = paths => `<svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const NAV_ICONS = {
  dash: navSvg('<path d="M3 11 12 3l9 8"/><path d="M5 10v11h14V10"/>'),
  draft: navSvg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>'),
  team: navSvg('<path d="M8 3 2.5 6.5 5 10.5l2-1V21h10V9.5l2 1 2.5-4L16 3a4 4 0 0 1-8 0Z"/>'),
  club: navSvg('<path d="M12 3 5 5.5v6c0 4.5 3 7.5 7 9.5 4-2 7-5 7-9.5v-6Z"/><path d="M12 8v5M9.5 10.5h5"/>'),
  directory: navSvg('<rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/>'),
  squads: navSvg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>'),
  transfers: navSvg('<path d="M4 7h13"/><path d="m14 3 4 4-4 4"/><path d="M20 17H7"/><path d="m10 21-4-4 4-4"/>'),
  h2h: navSvg('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M12 6v13"/><path d="M7 12h2M15 12h2"/>'),
  cup: navSvg('<path d="M8 4h8v6a4 4 0 0 1-8 0Z"/><path d="M8 5H4a4 4 0 0 0 4 5M16 5h4a4 4 0 0 1-4 5"/><path d="M12 14v4M8 21h8M9 18h6"/>'),
  table: navSvg('<path d="M6 20v-8M12 20V5M18 20v-5"/><path d="M4 20h16"/>'),
  data: navSvg('<path d="M4 19l5-6 4 3 7-9"/><path d="M4 21h16"/><circle cx="9" cy="13" r="1.2" fill="currentColor" stroke="none"/><circle cx="13" cy="16" r="1.2" fill="currentColor" stroke="none"/>'),
  fixtures: navSvg('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>'),
  rules: navSvg('<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>'),
  settings: navSvg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  more: navSvg('<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>'),
};
// the four daily-use tabs, in Ben's order — everything else lives under More
const SEASON_PRIMARY_NAV = ['team', 'h2h', 'table', 'transfers'];
const DRAFT_NAV = new Set(['draft', 'rules', 'settings']);
// pre-draft the app is mostly a waiting room, but the scouting floor (the
// Draft Console's pre-season face), club office, rules and settings are
// already worth visiting — so those four get a bar
// the directory joined pre-season (Ben, 13 Aug: "look around other people's
// clubs before the season starts") — founding a club is half the fun, nosing
// at everyone else's is the other half
const SETUP_NAV = new Set(['draft', 'club', 'directory', 'rules', 'settings']);

let lastRenderedView = null;
function render() {
  applyMock(); // sandbox Simulation Chamber overlay — no-op everywhere else
  applyLiveStats(); // real-league live-match fast lane — no-op everywhere else
  // the standing acting-as pen dies the moment the Chairman leaves the
  // Transfers page (sol test-night P2 — covers navigation, phase flips,
  // resets; hubActor additionally re-checks role and roster every call)
  if (transfersView.as != null && state.view !== 'transfers') transfersView.as = null;
  // keep keyboard focus across re-renders (remote updates land mid-typing)
  const ae = document.activeElement;
  const focusId = ae && ae.id && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT') ? ae.id : null;
  let caret = null;
  try { caret = focusId && ae.selectionStart != null ? ae.selectionStart : null; } catch { caret = null; }

  syncHash();
  // fresh page starts at the top; re-renders of the same page hold position
  if (lastRenderedView !== state.view) { window.scrollTo(0, 0); lastRenderedView = state.view; window.onscroll = null; }
  else {
    // same view re-rendering under the reader (draft night syncs every few
    // seconds): the innerHTML swap momentarily shortens the page AND content
    // above the reader changes height (pick log grows, panels swap), so a raw
    // scrollY restore still leaves the page "sort of jumping" (Ben, twice).
    // Anchor to the ELEMENT under the reader's eyes instead: find the nearest
    // id-bearing container at the top of the viewport, and after layout put
    // THAT element back at the same offset. scrollY is the fallback.
    const keepY = window.scrollY;
    let anchorId = null, anchorTop = 0;
    if (keepY > 0) {
      try {
        for (const el of document.elementsFromPoint(window.innerWidth / 2, 80)) {
          const host = el.closest ? el.closest('[id]') : null;
          if (host && host.id && host.closest('#main')) { anchorId = host.id; anchorTop = host.getBoundingClientRect().top; break; }
        }
      } catch { /* anchor is a nicety */ }
    }
    if (keepY > 0) requestAnimationFrame(() => {
      if (lastRenderedView !== state.view) return;
      if (anchorId) {
        const el2 = document.getElementById(anchorId);
        if (el2) {
          const drift = el2.getBoundingClientRect().top - anchorTop;
          if (Math.abs(drift) > 2) window.scrollBy(0, drift);
          return;
        }
      }
      if (Math.abs(window.scrollY - keepY) > 2) window.scrollTo(0, keepY);
    });
  }
  renderNav();
  renderSyncArea();
  const main = $('#main');
  paintScoutCompare();
  // renderIdentity runs on BOTH setup branches: the waiting room is exactly
  // where the lads first tap "Sign in", and returning before it left that
  // button doing nothing (sol club-office P1.2)
  if (state.phase === 'setup' && !SETUP_NAV.has(state.view)) { main.innerHTML = viewSetup(); bindSetup(); renderIdentity(); return; }
  if (state.phase === 'setup') {
    // pre-draft, only the setup-bar views resolve; everything else is the room
    if (state.view === 'draft') { main.innerHTML = viewDraftPrep(); bindDraftPrep(); }
    else if (state.view === 'club') { main.innerHTML = viewClub(); bindClub(); }
    else if (state.view === 'directory') { main.innerHTML = viewDirectory(); bindDirectory(); }
    else if (state.view === 'rules') { main.innerHTML = viewRules(); }
    else { main.innerHTML = viewSettings(); bindSettings(); }
    renderIdentity();
    return;
  }
  switch (state.view) {
    case 'draft': main.innerHTML = viewDraft(); bindDraft(); break;
    case 'team': main.innerHTML = viewTeam(); bindTeam(); break;
    case 'club': main.innerHTML = viewClub(); bindClub(); break;
    case 'directory': main.innerHTML = viewDirectory(); bindDirectory(); break;
    case 'squads': main.innerHTML = viewSquads(); break;
    case 'h2h': main.innerHTML = viewH2H(); bindH2H(); break;
    case 'dash': main.innerHTML = viewDash(); bindDash(); break;
    case 'transfers': main.innerHTML = viewTransfers(); bindTransfers(); break;
    case 'cup': main.innerHTML = viewCup(); bindCup(); break;
    case 'table': main.innerHTML = viewTable(); bindTable(); break;
    case 'data': main.innerHTML = viewData(); bindData(); break;
    case 'fixtures': main.innerHTML = viewFixtures(); bindFixtures(); break;
    case 'rules': main.innerHTML = viewRules(); break;
    case 'settings': main.innerHTML = viewSettings(); bindSettings(); break;
    default: state.view = 'draft'; render();
  }
  renderIdentity();
  maybeDrinksBreak();
  broadcastOnPick();
  renderHeckles();
  renderKlaxons();
  if (typeof manageWakeLock === 'function') manageWakeLock(); // acquire/release as the draft starts/ends
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      try { if (caret != null) el.setSelectionRange(caret, caret); } catch { /* selects */ }
    }
  }
}

// claim an identity — OFFLINE/DEMO ONLY. Online, identity comes from real
// sign-in (email link) and the server-owned membership map; nothing here can
// grant it.
function claimIdentity(mid) {
  if (netOn() && mid !== -1) return false;
  whoami = mid;
  localStorage.setItem(WHO_KEY, whoami);
  render();
  toast(mid === -1 ? 'Spectator mode.' : `Welcome, ${managerName(mid)}. This conversation is being recorded.`);
  return true;
}

let forceIdentity = false; // set when an action needs a signed-in manager first
let linkSentTo = null;     // email a sign-in link was just sent to
function renderIdentity() {
  let ov = $('#whoOverlay');
  const needed = (netOn() && state.phase !== 'setup' && !whoami) || forceIdentity;
  if (!needed) { ov?.remove(); linkSentTo = null; return; }
  ov?.remove();
  ov = document.createElement('div');
  ov.id = 'whoOverlay';
  ov.className = 'overlay';
  if (identityLoading()) {
    const err = window._lastSyncErr;
    ov.innerHTML = `<div class="card" style="max-width:480px;width:94%;text-align:center">
      <h2>Finding your club&hellip;</h2>
      <p class="muted" style="font-size:13px">Checking this device's sign-in against the league.</p>
      ${err ? `<p style="font-size:12.5px;margin-top:10px;color:#ffd76e">The ${esc(err.label)} check is retrying (${esc(err.code)}).</p>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn small" id="whoReload" style="flex:1">&#8635; Reload</button>
          <button class="btn ghost small" id="whoSignOut" style="flex:1">Sign out</button>
        </div>` : ''}
    </div>`;
  } else if (netOn() && authUser && !membership) {
    // signed in with an email the league doesn't know
    // the tech line turns a stuck user's device into the diagnostic probe:
    // "connection DOWN" = transport (home-wifi filters break the database
    // websocket); a permission code = rules/identity; neither = still waiting
    const err = window._lastSyncErr;
    const conn = syncConnected ? 'live' : 'DOWN';
    ov.innerHTML = `<div class="card" style="max-width:480px;width:94%">
      <h2>Who let you in?</h2>
      <p class="muted" style="font-size:13px;margin-bottom:10px">You're signed in as <b>${esc(authUser.email || 'unknown')}</b> but <b style="color:var(--text)">${SANDBOX ? 'the practice sandbox' : 'the real league'}</b> hasn't linked that email to a manager. If it's the one the Chairman registered here, it's usually a hiccup &mdash; reload and it sorts itself. If it's a different email, sign out and use the registered one.</p>
      ${/* The two leagues keep SEPARATE membership lists but share one sign-in
            across the whole site, so being known in one and a stranger in the
            other looks exactly like a broken login — reload, same card, again
            (Marc, 13 Aug). Say which door you're standing at. */''}
      <p class="muted" style="font-size:12px;margin-bottom:10px">Being a manager in the ${SANDBOX ? 'real league' : 'sandbox'} doesn't let you in here: the two keep separate lists. If you're only registered ${SANDBOX ? 'in the real league' : 'in the sandbox'}, this card will keep coming back however many times you reload — ask the Chairman to register you ${SANDBOX ? 'in the sandbox' : 'in the real league'}.</p>
      ${!syncConnected ? `<p style="font-size:12.5px;margin-bottom:10px;color:#ffd76e">&#9888; The live connection to the league isn't establishing &mdash; that's a network problem, not a sign-in problem. Filtered wifi (work/home DNS filters) can block it: try a phone hotspot or another network.</p>` : ''}
      <p class="muted" style="font-size:11px;margin-bottom:12px">Tech: ${esc(window.WCSync?.league || '?')} &middot; connection ${conn} &middot; ${err ? esc(`${err.label} read: ${err.code}`) : 'no read errors logged'}</p>
      <div style="display:flex;gap:8px">
        <button class="btn small" id="whoReload" style="flex:1">&#8635; Reload</button>
        <button class="btn ghost small" id="whoSignOut" style="flex:1">Sign out</button>
        <button class="btn ghost small" data-who="-1" style="flex:1;opacity:.75">&#128065; Just watching</button>
      </div>
    </div>`;
  } else if (netOn()) {
    ov.innerHTML = `<div class="card" style="max-width:480px;width:94%">
      <h2>Sign in ${SANDBOX ? '<span class="tag">SANDBOX</span>' : ''}</h2>
      <p class="muted" style="font-size:12px;margin-bottom:12px">You're signing in to <b style="color:var(--text)">${SANDBOX ? 'the practice sandbox' : 'the real league'}</b>. The two keep separate memberships, so a link sent for one won't let you into the other.</p>
      ${linkSentTo
        ? `<p style="font-size:14px;margin-bottom:14px">&#9993; Link sent to <b>${esc(linkSentTo)}</b>. Open the email ON THIS DEVICE and tap it — that's the whole sign-in.</p>`
        : `<p class="muted" style="font-size:13px;margin-bottom:14px">No passwords, no PINs. Enter the email the Chairman registered for you and we'll send a sign-in link.</p>
           <form id="whoEmailForm" style="display:flex;gap:8px;margin-bottom:10px">
             <input type="email" id="whoEmail" required placeholder="you@example.com" autocomplete="email" style="flex:1;min-width:0">
             <button class="btn" type="submit">Send link</button>
           </form>`}
      ${/* The rescue used to appear only in the same sitting as the send. One
            reload and it vanished, so a link that opened in the wrong browser
            (or outside the installed app) left you sending yourself fresh
            links forever — Marc's laptop loop, 13 Aug. It is always here now. */''}
      <details style="margin-bottom:10px" ${linkSentTo ? 'open' : ''}>
        <summary class="muted" style="font-size:12px;cursor:pointer">Link opened in the wrong browser, or nothing happened?</summary>
        <p class="muted" style="font-size:12px;margin:6px 0">Copy the whole link out of the email and paste it here — that finishes the sign-in on this device, wherever the link opened.</p>
        <form id="whoPasteForm" style="display:flex;gap:8px;margin-bottom:8px">
          <input id="whoPaste" placeholder="Paste the sign-in link" style="flex:1;min-width:0">
          <button class="btn small" type="submit">Finish sign-in</button>
        </form>
        ${linkSentTo ? '<button class="btn ghost small" id="whoResend">Different email</button>' : ''}
      </details>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn ghost small" data-who="-1" style="flex:1;opacity:.75">&#128065; Just watching</button>
        <button class="btn ghost small" id="whoDemo" style="flex:1;opacity:.75">&#127918; Show me a demo season</button>
        ${forceIdentity ? '<button class="btn ghost small" id="whoCancel" style="opacity:.75">&#10005;</button>' : ''}
      </div>
    </div>`;
  } else {
    // offline / local play: the old pick-your-team grid, no PINs
    ov.innerHTML = `<div class="card" style="max-width:560px;width:94%">
      <h2>Who are you?</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;margin-bottom:10px">
      ${state.managers.map((m, i) => `<button class="btn ghost" data-who="${m.id}" style="text-align:left;padding:10px 12px">
        <b>${esc(m.team || m.name)}</b>${i === 0 ? ' <span class="tag">Chairman</span>' : ''}<br>
        <span class="muted" style="font-size:11.5px">${esc(m.name)}</span>
      </button>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn ghost small" data-who="-1" style="flex:1;opacity:.75">&#128065; Just watching</button>
        <button class="btn ghost small" id="whoDemo" style="flex:1;opacity:.75">&#127918; Show me a demo season</button>
        ${forceIdentity ? '<button class="btn ghost small" id="whoCancel" style="opacity:.75">&#10005;</button>' : ''}
      </div>
    </div>`;
  }
  document.body.appendChild(ov);
  const wd = ov.querySelector('#whoDemo');
  if (wd) wd.onclick = () => { forceIdentity = false; ov.remove(); enterDemo(); };
  const wc = ov.querySelector('#whoCancel');
  if (wc) wc.onclick = () => { forceIdentity = false; ov.remove(); };
  const so = ov.querySelector('#whoSignOut');
  if (so) so.onclick = () => window.WCSync ? window.WCSync.auth.signOut() : toast('Can’t reach the league right now — try a refresh');
  const wr = ov.querySelector('#whoReload');
  if (wr) wr.onclick = () => {
    // clear the SDK's remembered-websocket-failure flag too — a stale one
    // forces the dead long-polling route and survives normal reloads
    try { localStorage.removeItem('firebase:previous_websocket_failure'); } catch { /* fine */ }
    location.reload();
  };
  const rs = ov.querySelector('#whoResend');
  if (rs) rs.onclick = () => { linkSentTo = null; renderIdentity(); };
  const form = ov.querySelector('#whoEmailForm');
  if (form) form.onsubmit = e => {
    e.preventDefault();
    const email = ov.querySelector('#whoEmail').value.trim();
    if (!email) return;
    if (!window.WCSync) { toast('Can’t reach the league right now — try a refresh'); return; }
    window.WCSync.auth.sendLink(email)
      .then(() => { linkSentTo = email; renderIdentity(); })
      .catch(err => toast(err.message || 'Could not send the link — check the address.'));
  };
  // installed-app / wrong-browser rescue: the link itself, pasted by hand
  const pf = ov.querySelector('#whoPasteForm');
  if (pf) pf.onsubmit = e => {
    e.preventDefault();
    const url = ov.querySelector('#whoPaste').value.trim();
    if (!url) return;
    if (!window.WCSync) { toast('Can’t reach the league right now — try a refresh'); return; }
    window.WCSync.auth.completeLink(url)
      .then(ok => { if (ok) { forceIdentity = false; toast('Signed in. Welcome back.'); } })
      .catch(err => toast(err.message || 'That link didn’t work — request a fresh one.'));
  };
  ov.querySelectorAll('[data-who]').forEach(b => b.onclick = () => {
    const mid = +b.dataset.who;
    if (mid === -1 && netOn()) {
      spectating = true;
      localStorage.setItem(SPECT_KEY, '1');
      syncIdentity();
      forceIdentity = false;
      render();
      toast('Spectator mode.');
      return;
    }
    if (claimIdentity(mid)) { forceIdentity = false; render(); }
  });
}

function renderNav() {
  const nav = $('#nav');
  if (state.phase === 'setup') {
    nav.classList.remove('draft-nav');
    nav.classList.add('setup-nav');
    nav.innerHTML = NAV_ITEMS.filter(([id]) => SETUP_NAV.has(id)).map(([id, label, short]) =>
      `<button type="button" data-view="${id}" class="${state.view === id ? 'active' : ''}">${NAV_ICONS[id] || ''}<span class="nav-lbl-full">${label}</span><span class="nav-lbl-short">${id === 'draft' ? 'Draft' : (short || label)}</span></button>`).join('');
    nav.querySelectorAll('button[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; save(); render(); });
    return;
  }
  nav.classList.remove('setup-nav');
  nav.classList.toggle('draft-nav', state.phase === 'draft');
  // attention dots — the app taps you on the shoulder when it needs you
  const dots = {};
  if (state.phase === 'season' && whoami && whoami !== -1) {
    const offers = toArr(state.trades).filter(t => t.status === 'pending' && t.to === whoami).length;
    if (offers) dots.transfers = offers;
    const cur = currentGwIndex();
    if (!gwHasStarted(cur)) {
      const crocked = lineupFor(whoami, cur).filter(pid => 'isnu'.includes(PLAYER_BY_ID[pid]?.status)).length;
      if (crocked) dots.team = crocked;
    }
    if (typeof gazetteUnread === 'function' && gazetteUnread()) dots.dash = 1;
  }
  const allowed = state.phase === 'draft' ? DRAFT_NAV : new Set(NAV_ITEMS.map(([id]) => id));
  const available = NAV_ITEMS.filter(([id]) => allowed.has(id));
  const primaryIds = state.phase === 'draft' ? ['draft'] : SEASON_PRIMARY_NAV;
  // bar order follows primaryIds, not NAV_ITEMS order
  const primary = primaryIds.map(id => available.find(([k]) => k === id)).filter(Boolean);
  const more = available.filter(([id]) => !primaryIds.includes(id));
  const button = ([id, label, short]) =>
    `<button type="button" data-view="${id}" class="${state.view === id ? 'active' : ''}"${state.view === id ? ' aria-current="page"' : ''}>${NAV_ICONS[id] || ''}<span class="nav-lbl-full">${label}</span><span class="nav-lbl-short">${short || label}</span>${dots[id] ? `<span class="nav-dot" title="Needs your attention" aria-label="${dots[id]} item${dots[id] === 1 ? '' : 's'} need attention">${dots[id]}</span>` : ''}</button>`;
  const moreActive = more.some(([id]) => id === state.view);
  const moreDots = more.reduce((n, [id]) => n + (dots[id] || 0), 0);
  nav.innerHTML = `${primary.map(button).join('')}
    <details class="nav-more${moreActive ? ' active' : ''}">
      <summary${moreActive ? ' aria-current="page"' : ''}>${NAV_ICONS.more}<span class="nav-lbl-full">More</span><span class="nav-lbl-short">More</span>${moreDots ? `<span class="nav-dot" aria-label="${moreDots} item${moreDots === 1 ? '' : 's'} need attention">${moreDots}</span>` : ''}</summary>
      <div class="nav-more-menu">${more.map(button).join('')}</div>
    </details>`;
  nav.querySelectorAll('button[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; save(); render(); });
  // tapping anywhere else puts the More sheet away
  if (!window.__navMoreCloser) {
    window.__navMoreCloser = true;
    document.addEventListener('click', e => {
      const open = document.querySelector('.nav-more[open]');
      if (open && !open.contains(e.target)) open.removeAttribute('open');
    });
  }
}

function renderSyncArea() {
  const el = $('#syncArea');
  if (!el) return;
  // this used to blank itself pre-draft, which hid the sign-in pill and Home
  // during the exact weeks the lads are arriving to found their clubs
  const bits = [];
  // demo/sandbox live as small chips up here, not a banner over the app
  if (demoMode) bits.push('<button class="tag mode-chip demo-chip" id="demoChip"><span class="rec"></span>DEMO</button>');
  if (SANDBOX && !demoMode) bits.push('<button class="tag mode-chip sandbox-chip" id="sandboxChip"><span class="rec"></span>SANDBOX</button>');
  if (anyMatchLive() && !demoMode) {
    // the pill tells the truth about its own age (GW1 night: silent failure
    // is what burned trust) — green under ~90s, amber to 5 min, stale beyond.
    // Not in the demo: its scores are fictional, and DEMO + LIVE side by side
    // both misleads and overflows the 320px header (ux3 D10/G1b, 22 Aug)
    // silent in health, loud in failure (Ben, GW1 Saturday, seeing "LIVE ·
    // 0s": "do we actually need it" — not while it's healthy): the plain
    // LIVE dot when the wire is fresh; the age appears only once the wire
    // is genuinely behind, which is the one moment it must not be silent
    const age = liveDataAgeMs();
    if (age == null || age <= 90e3) {
      bits.push(`<span class="live-pill" title="${age == null ? 'Live scores' : `Live scores — updated ${fmtLiveAge(age)} ago`}"><span class="rec"></span>LIVE</span>`);
    } else {
      const stale = age > 5 * 60e3;
      const title = stale
        ? `Live scores are STALE — nothing has landed for ${fmtLiveAge(age)}. The feed still refreshes every ~15 min; scores are lagging, not lost.`
        : `Live scores running ${fmtLiveAge(age)} behind — the wire may be slow`;
      bits.push(`<span class="live-pill${stale ? ' stale' : ' amber'}" title="${title}"><span class="rec"></span>LIVE &middot; ${fmtLiveAge(age)}</span>`);
    }
  }
  // (the old separate "feed stale" chip is gone — the LIVE pill above now
  // carries its own age and degrades visibly, and two warnings overflowed
  // the 320px header. One pill, one truth.)
  if (syncOn()) {
    bits.push(`<span class="conn ${syncConnected ? 'up' : ''}" role="status" aria-label="${syncConnected ? 'Live sync connected' : 'Live updates reconnecting — saves will still be attempted'}" title="${syncConnected ? 'Live sync: connected' : 'Live updates reconnecting — saves will still be attempted'}">&#9679;</span>`);
    // signed in but membership never landed: SAY so — a pill reading "Sign in"
    // while the account is authenticated reads as a broken app (Ben, 2 Aug)
    const stuck = netOn() && authUser && !whoami;
    const who = whoami === -1 ? 'Spectating' : (whoami ? esc(managerName(whoami)) : (stuck ? '&#9888; Not recognised' : 'Sign in'));
    const whoTitle = netOn() ? (stuck ? `Signed in as ${esc(authUser.email || 'unknown')} but not linked to a manager yet — tap for options` : authUser ? 'Signed in — tap to sign out' : 'Sign in') : 'Switch who this device acts as';
    bits.push(`<button class="tag" id="whoBtn" style="cursor:pointer" title="${whoTitle}">${who}</button>`);
  }
  if (state.phase === 'season') {
    const last = state.lastSync ? new Date(state.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'never';
    bits.push(`<button class="tag" id="syncBtn" title="Scores auto-refresh every ~5&ndash;10 min on matchdays — tap to refresh now">&#8635;<span class="sync-txt"> ${last}</span></button>`);
  }
  if (state.phase !== 'draft') {
    // Home: the Dashboard in season, the waiting room pre-draft
    const homeLabel = state.phase === 'setup' ? 'Waiting room' : 'Dashboard';
    bits.push(`<button id="homeBtn" class="btn home-btn${state.view === 'dash' ? ' is-current' : ''}" aria-label="${homeLabel}" title="${state.phase === 'setup' ? 'Back to the waiting room' : 'Back to the Dashboard'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11 12 3l9 8"/><path d="M5 10v11h14V10"/></svg><span class="sync-txt">${homeLabel}</span></button>`);
  }
  bits.push(`<button class="tag header-icon-btn" id="gSearchBtn" aria-label="Search players" title="Search every player (Ctrl+K or /)"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" style="vertical-align:-1px"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/></svg></button>`);
  bits.push(`<button class="tag header-icon-btn" id="muteBtn" aria-label="${soundOn() ? 'Mute' : 'Unmute'} broadcast sound" title="Broadcast sound (Ian's mute button)">${soundOn() ? '&#128266;' : '&#128263;'}</button>`);
  el.innerHTML = bits.join('');
  const gsb = $('#gSearchBtn');
  if (gsb) gsb.onclick = () => openPlayerSearch();
  const mb = $('#muteBtn');
  if (mb) mb.onclick = () => {
    localStorage.setItem('tl2627-mute', soundOn() ? '1' : '0');
    renderSyncArea();
    toast(soundOn() ? 'Broadcast sound on. Sorry, Ian.' : 'Broadcast muted. Ian wins this one.');
  };
  const wb = $('#whoBtn');
  if (wb) wb.onclick = () => {
    if (netOn()) {
      spectating = false;
      localStorage.removeItem(SPECT_KEY);
      if (authUser && !whoami) {
        // signed in but unrecognised — open the diagnostic card, not a
        // sign-out confirm that looks like nothing happened
        forceIdentity = true; render();
      } else if (authUser) {
        if (confirm('Sign out of the league on this device?')) window.WCSync?.auth.signOut();
      } else {
        // force the overlay: in the setup phase it doesn't appear on its own,
        // which left the Sign in button dead before the draft
        whoami = null; forceIdentity = true; render();
      }
      return;
    }
    whoami = null; localStorage.removeItem(WHO_KEY); render();
  };
  const sb = $('#syncBtn');
  if (sb) sb.onclick = () => syncNow(true);
  const hb = $('#homeBtn');
  if (hb) hb.onclick = () => { state.view = 'dash'; save(); render(); };
  const dc = $('#demoChip');
  if (dc) dc.onclick = () => confirmSheet({
    title: 'Demo mode',
    body: '<p class="rules-p">Everything here is a fake draft with fictional results — just a look around. Your real league is untouched.</p>',
    yes: 'Exit demo',
  }).then(go => { if (go) exitDemo(); });
  const sc = $('#sandboxChip');
  if (sc) sc.onclick = () => confirmSheet({
    title: 'Sandbox',
    body: '<p class="rules-p">This is the practice league — sign in, draft, trade, break things. The real league is untouched.</p>',
    yes: 'Go to the real site',
  }).then(go => { if (go) location.href = realSiteHref(); });
}

/* ----- the ready room: pre-draft roll call, one tap per manager ----- */
function readyRoomCard() {
  if (!netOn()) return ''; // only means something when everyone is on their own device
  const r = state.ready || {};
  const n = state.managers.filter(mg => r[mg.id]).length;
  const iAmManager = whoami && whoami !== -1;
  return `<div class="card">
    <h2>The Ready Room <span class="tag">${n}/${state.managers.length} ready</span></h2>
    <p class="muted" style="font-size:12px;margin-bottom:10px">Ready means signed in on your draft device and good to go.${isCommissioner() ? ' The Chairman can vouch for a straggler on the phone.' : ''}</p>
    ${state.managers.map(mg => {
      const rd = r[mg.id];
      const mine = iAmManager && mg.id === whoami;
      return `<div class="qrow ready-row${rd ? ' is-ready' : ''}" style="font-size:13px">
        <span class="ready-dot">${rd ? '&#10003;' : '&middot;'}</span>
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>${esc(mg.team || mg.name)}</b> <span class="muted" style="font-size:11px">${esc(mg.name)}</span></span>
        <span style="margin-left:auto">${mine
          ? `<button class="btn small${rd ? ' ghost' : ''}" data-ready="${mg.id}:${rd ? 0 : 1}">${rd ? 'Unready' : `I&rsquo;m ready`}</button>`
          : isCommissioner() ? `<button class="btn ghost small" data-ready="${mg.id}:${rd ? 0 : 1}" title="Chairman&rsquo;s override">${rd ? 'Unmark' : 'Vouch'}</button>` : ''}</span>
      </div>`;
    }).join('')}
  </div>`;
}

/* ----- setup ----- */
// waiting-room signpost to the scouting floor — the whole point of opening
// the app before draft night
function prepCard() {
  const n = whoami && whoami !== -1 ? toArr(state.autolists?.[whoami]).length : 0;
  return `<div class="card" style="text-align:center">
    <h2>The Scouting Floor is open</h2>
    <p class="rules-p">${n ? `Your autopick list has <b>${n}</b> name${n === 1 ? '' : 's'} on it.` : 'Browse the pool, &#9733; star your targets and rank your autopick list before the night.'} If your draft clock ever hits zero, the top available name on your list goes in.</p>
    <button class="btn" id="prepGo" style="margin-top:10px">Open the Draft Console</button>
    <button class="btn ghost" data-gazette style="margin-top:10px">&#128240; Read the Season Preview</button>
  </div>`;
}

function viewSetup() {
  const m = state.managers;
  // pre-draft, only the Chairman gets the editable console. Everyone else sees
  // a calm waiting room (not a form they think they must fill in).
  if (netOn() && !isCommissioner()) {
    return `<div class="setup-wrap">
      <div class="setup-hero">
        <img src="icons/icon-192.png" alt="" style="width:72px;height:72px;border-radius:16px;display:block;margin:0 auto 10px;box-shadow:0 0 24px rgba(233,196,106,.25)">
        <h2>The League &mdash; 2026/27</h2>
        <p>You're in. The draft hasn't started yet.</p>
      </div>
      <div class="card" style="text-align:center">
        <p class="rules-p">${whoami && whoami !== -1 ? `Signed in as <b>${esc(teamName(whoami))}</b>. ` : ''}When the Chairman starts the draft, this screen becomes your draft board automatically — keep it open.</p>
        <p class="muted" style="font-size:12.5px;margin:10px 0">Never seen the app? Have a play with a full fake season — nothing you do here touches the real league.</p>
        <button class="btn" id="waitDemo">&#127918; Try the demo</button>
      </div>
      ${foundingCard()}
      ${prepCard()}
      ${readyRoomCard()}
      ${installCard(true)}
    </div>`;
  }
  return `
  <div class="setup-wrap">
    <div class="setup-hero">
      <img src="icons/icon-192.png" alt="" style="width:72px;height:72px;border-radius:16px;display:block;margin:0 auto 10px;box-shadow:0 0 24px rgba(233,196,106,.25)">
        <h2>The League &mdash; 2026/27</h2>
      <p>One snake draft. Every player in the Premier League.<br>Est. 2015. Minutes kept by the Committee.</p>
    </div>
    ${foundingCard()}
    ${prepCard()}
    ${readyRoomCard()}
    <div class="card">
      <h2>Managers &amp; Draft Order</h2>
      <p class="muted" style="font-size:11.5px;margin-bottom:8px">The list below IS the draft order — first listed picks first. Drag rows (or use the arrows) to set it, or shuffle it and let the envelopes decide.</p>
      ${m.map((mg, i) => `
        <div class="mgr-row" data-mgrdrag="${i}">
          <span class="mgr-num" draggable="true" title="Drag to reorder" style="cursor:grab">${i + 1}</span>
          <input type="text" maxlength="24" placeholder="Manager ${i + 1} name" data-mgr="${mg.id}" value="${esc(mg.name)}">
          <input type="text" maxlength="28" placeholder="Team name" data-mgrteam="${mg.id}" value="${esc(mg.team || '')}">
          <button class="btn ghost small" data-mgrup="${i}" ${i === 0 ? 'disabled' : ''} title="Move up the draft order">&#9650;</button>
          <button class="btn ghost small" data-mgrdn="${i}" ${i === m.length - 1 ? 'disabled' : ''} title="Move down the draft order">&#9660;</button>
        </div>`).join('')}
      <button class="btn ghost small" id="shuffleOrder" style="margin-top:8px">&#127922; Shuffle the order</button>
      <p class="muted" style="font-size:11.5px;margin-top:8px">In local leagues the first manager listed is the commissioner; the real league answers to its Chairman regardless of the running order. Team names pulled from the archive — correct as you see fit.</p>
    </div>
    <div class="card">
      <h2>Squad Rules</h2>
      <p class="muted" style="font-size:12px;margin-bottom:10px">Hard rule: <b>14 players</b>, with one positional flex. Draft picks, autopicks, trades, Trough signings and waivers all use the same limits.</p>
      <div class="quota-grid">
        ${['GK', 'DF', 'MF', 'FW'].map(pos => `
          <div><label>${POS_LABEL[pos]}</label><b>${SQUAD_RULES.min[pos]}–${SQUAD_RULES.max[pos]} ${pos}</b></div>`).join('')}
      </div>
      <div style="margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="tag">SQUAD SIZE ${SQUAD_RULES.size}</span>
        <label style="font-size:12px;color:var(--muted);font-weight:700;margin-left:10px">PICK TIMER</label>
        <select id="pickTimer" aria-label="Pick timer">
          ${[0, 10, 20, 30, 45, 60].map(t => `<option value="${t}" ${state.settings.pickTimer === t ? 'selected' : ''}>${t ? t + 's — autopick at zero' : 'Off'}</option>`).join('')}
        </select>
      </div>
      <div class="setup-total" id="setupTotal"></div>
    </div>
    <button class="btn" id="startDraftOrdered" style="padding:14px;font-size:16px">Start the draft &mdash; in the order listed</button>
    <button class="btn ghost" id="startDraft" style="padding:12px">Shuffle the order &amp; start</button>
    <button class="btn ghost" id="demoBtn">Have a look around first — demo a finished season</button>
  </div>`;
}
function bindSetup() {
  bindInstall();
  document.querySelectorAll('[data-ready]').forEach(b => b.onclick = () => {
    const [mid, val] = b.dataset.ready.split(':').map(Number);
    if (!netOn()) return;
    serverAct('readySet', { ready: !!val, ...(mid !== whoami && { asManager: mid }) })
      .then(() => toast(val ? (mid === whoami ? 'Ready. The Committee notes your promptness.' : `${managerName(mid)} vouched for.`) : 'Unreadied.'))
      .catch(() => {});
  });
  const fb = $('#foundBtn');
  if (fb) fb.onclick = () => clubEditor(+fb.dataset.mid);
  const fl = $('#foundLater');
  if (fl) fl.onclick = () => { localStorage.setItem(`${LS_NS}-founded-${fl.dataset.mid}`, '1'); render(); };
  const pg = $('#prepGo');
  if (pg) pg.onclick = () => { state.view = 'draft'; save(); render(); };
  const wd = $('#waitDemo');
  if (wd) { wd.onclick = enterDemo; return; } // non-commissioner waiting room
  const updateTotal = () => {
    const total = SQUAD_RULES.size;
    $('#setupTotal').innerHTML = `Squad size: <b>${total}</b> each &middot; <b>${total * state.managers.length}</b> of ${PLAYERS.length} players drafted &middot; starting XI picked each gameweek &middot; weekly waivers, bottom feeds first`;
  };
  document.querySelectorAll('[data-mgr]').forEach(inp => inp.oninput = () => {
    state.managers.find(m => m.id === +inp.dataset.mgr).name = inp.value;
  });
  document.querySelectorAll('[data-mgrteam]').forEach(inp => inp.oninput = () => {
    state.managers.find(m => m.id === +inp.dataset.mgrteam).team = inp.value;
  });
  $('#pickTimer').onchange = e => { state.settings.pickTimer = +e.target.value || 0; };
  updateTotal();
  $('#demoBtn').onclick = enterDemo;
  document.querySelectorAll('[data-mgrup]').forEach(b => b.onclick = () => {
    const i = +b.dataset.mgrup;
    [state.managers[i - 1], state.managers[i]] = [state.managers[i], state.managers[i - 1]];
    render();
  });
  document.querySelectorAll('[data-mgrdn]').forEach(b => b.onclick = () => {
    const i = +b.dataset.mgrdn;
    if (i >= state.managers.length - 1) return;
    [state.managers[i], state.managers[i + 1]] = [state.managers[i + 1], state.managers[i]];
    render();
  });
  const sh = $('#shuffleOrder');
  if (sh) sh.onclick = () => {
    state.managers.sort(() => Math.random() - 0.5);
    toast('Order shuffled. What you see is what you draft.');
    render();
  };
  // drag a manager row to a new slot by its number handle (Marc, mock night:
  // set the order by hand) — the handle drags so the name inputs still select
  document.querySelectorAll('[data-mgrdrag]').forEach(row => {
    const handle = row.querySelector('.mgr-num');
    if (handle) handle.ondragstart = e => { e.dataTransfer.setData('text/mgr', row.dataset.mgrdrag); e.dataTransfer.effectAllowed = 'move'; };
    row.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    row.ondrop = e => {
      e.preventDefault();
      const from = +e.dataTransfer.getData('text/mgr');
      if (Number.isNaN(from)) return;
      const rect = row.getBoundingClientRect();
      let to = +row.dataset.mgrdrag + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
      if (from < to) to--;
      if (from === to) return;
      const [mv] = state.managers.splice(from, 1);
      state.managers.splice(to, 0, mv);
      render();
    };
  });
  const startDraft = randomise => {
    // only the Chairman pulls this trigger — sign in first if the device hasn't
    if (netOn() && !isCommissioner()) {
      toast('Only the Chairman starts the draft — sign in as him to prove it');
      forceIdentity = true;
      renderIdentity();
      return;
    }
    const rdyN = netOn() ? state.managers.filter(mg => (state.ready || {})[mg.id]).length : null;
    if (!confirm(`This starts the REAL draft for all twelve managers.${rdyN != null ? ` Ready room says ${rdyN}/${state.managers.length}.` : ''} Everyone ready?`)) return;
    state.managers.forEach((m, i) => { if (!m.name.trim()) m.name = `Manager ${i + 1}`; });
    applySquadRules(state.settings);
    const order = randomise
      ? state.managers.map(m => m.id).sort(() => Math.random() - 0.5)
      : state.managers.map(m => m.id);
    if (netOn()) {
      // ONE server action: the screen's edits (names, teams, squad rules) ride
      // along and merge inside the same txn that flips the phase. The old
      // importState-then-start replaced the whole public node and wiped any
      // club a founder saved while the Chairman's tab sat open (sol P1.1).
      serverAct('draftAdmin', {
        op: 'start', order,
        setup: {
          managers: state.managers.map(mg => ({ id: mg.id, name: mg.name, team: mg.team || '' })),
          settings: {
            pickTimer: state.settings.pickTimer,
            scoring: state.settings.scoring,
          },
        },
      })
        .then(() => showCeremony()) // stamps "seen" itself at the end
        .catch(() => {});
      return;
    }
    state.draft.order = order;
    state.draft.deadline = null; // armed by armClock() once the ceremony ends
    state.draft.ceremonyReady = {};
    // draft-night snapshot: anyone who joins a PL club after this is locked until the window shuts
    state.draftPool = { at: Date.now(), ids: Object.fromEntries(PLAYERS.map(p => [p.id, p.club])) };
    state.phase = 'draft';
    state.view = 'draft';
    save(); render();
    showCeremony(); // stamps "seen" itself at the end
  };
  $('#startDraft').onclick = () => startDraft(true);
  $('#startDraftOrdered').onclick = () => startDraft(false);
}

/* ----- opening ceremony (requested by Marc, dedicated to Ian) ----- */
// each club's flag is carried by a selected legend (selection panel: the Committee)
const FLAG_BEARERS = {
  'Arsenal': 'Ian Wright, already crying',
  'Aston Villa': 'Prince William, heir to the throne, season ticket in the Holte End apparently',
  'Bournemouth': 'a man who remembers when this was a fairytale',
  'Brentford': 'a data analyst carrying a spreadsheet printed on a flag',
  'Brighton': 'the ghost of a future £100m midfielder, currently 17',
  'Burnley': 'Sean Dyche, gravel voice audible over the PA',
  'Chelsea': 'Roman Abramovich’s lawyers, waving from a safe distance',
  'Coventry City': 'Richard Keys, hairy hands gripping the pole. Would you smash it? The flag. The flag',
  'Crystal Palace': 'the entire Holmesdale Fanatics drum section',
  'Everton': 'Duncan Ferguson, escorting two burglars he has made friends with',
  'Fulham': 'Hugh Grant, apologising charmingly',
  'Hull City': 'Lucy Beaumont, asking if everyone got here okay, because it’s Hull',
  'Ipswich Town': 'Ed Sheeran, quietly sponsoring everything he can see',
  'Leeds': 'Marcelo Bielsa on an upturned bucket',
  'Liverpool': 'Jürgen Klopp, hugging the flagpole',
  'Man City': 'a KC from Freshfields carrying box 116 of 130',
  'Man Utd': 'Sir Alex Ferguson, pointing at his watch',
  'Newcastle': 'a topless man in December. Feels like the north wind personally',
  "Nott'm Forest": 'Brian Clough’s statue, carried by four men, still smarter than most managers',
  'Sunderland': 'the Netflix documentary crew, filming season nine',
  'Spurs': 'the Premier League trophy, kept a respectful, familiar distance away',
  'West Ham': 'Ray Winstone’s floating head, slightly too big',
  'Wolves': 'a very good sports scientist selling a very good midfielder',
};
const ceremonyKey = () => state.draft.order.length ? `${state.draft.order.join('-')}:${state.draftPool?.at || ''}` : '';
function draftCeremonyStatus() {
  const order = toArr(state.draft?.order);
  const ready = state.draft?.ceremonyReady || {};
  const count = order.filter(mid => ready[mid] === true).length;
  return { count, total: order.length, complete: order.length > 0 && count === order.length };
}
const draftRoomOpen = () => !netOn() || state.draft.picks.length > 0 || draftCeremonyStatus().complete;
let ceremonyReportPending = false, ceremonyReportFailures = 0, ceremonyReportTimer = null, ceremonyReportKey = '';
let ceremonyWatch = null; // the live pomp overlay, so a shared tick can close it
function reportCeremonyReady() {
  if (!netOn() || ceremonyReportPending || state.phase !== 'draft' || state.draft.picks.length) return;
  if (!whoami || whoami === -1 || !state.draft.order.includes(whoami)) return;
  if (state.draft.ceremonyReady?.[whoami] === true) return;
  const key = ceremonyKey();
  if (!key || localStorage.getItem(`${LS_NS}-ceremony-seen`) !== key) return;
  if (ceremonyReportKey !== key) { ceremonyReportKey = key; ceremonyReportFailures = 0; }
  ceremonyReportPending = true;
  serverAct('draftAdmin', { op: 'ceremonyReady' })
    .then(() => { ceremonyReportFailures = 0; })
    .catch(() => {
      // A one-off callable failure after the final manager leaves the ceremony
      // must not wedge the room with nobody left to create another snapshot.
      // Retry twice; reconnect/sign-in resets the allowance thereafter.
      ceremonyReportFailures++;
      if (ceremonyReportFailures < 3 && !ceremonyReportTimer) {
        ceremonyReportTimer = setTimeout(() => { ceremonyReportTimer = null; reportCeremonyReady(); }, 3000);
      }
    })
    .finally(() => { ceremonyReportPending = false; });
}
function showCeremony() {
  if ($('#ceremony')) return;
  const order = state.draft.order;
  if (!order.length) return;
  // "seen" is stamped only when the ceremony ENDS — stamping at open meant a
  // refresh mid-pomp skipped straight to a live clock (sol r4). The key
  // includes draftPool.at so a rehearsal/reset with the same order replays it.
  const cerFinish = () => {
    localStorage.setItem(`${LS_NS}-ceremony-seen`, ceremonyKey());
    reportCeremonyReady();
  };
  const ordinals = ['twelfth', 'eleventh', 'tenth', 'ninth', 'eighth', 'seventh', 'sixth', 'fifth', 'fourth', 'third', 'second', 'FIRST'];
  const absentFriends = typeof FORMER_MANAGERS !== 'undefined' && FORMER_MANAGERS.length
    ? FORMER_MANAGERS.length > 1 ? `${FORMER_MANAGERS.slice(0, -1).join(', ')} and ${FORMER_MANAGERS.at(-1)}` : FORMER_MANAGERS[0]
    : 'the former managers who escaped the minutes';
  const steps = [
    { h: '&#9917; THE OPENING CEREMONY', p: 'Live and exclusive coverage with David Prutton, alongside Big Al Brazil, who has been here since the gallops. Season twelve of The League. Ian, be upstanding. Especially you.' },
    { h: '&#127884; THE PARADE OF CLUBS', p: '', parade: true },
    { h: '&#127933; THE PARADE OF MANAGERS', p: '', mparade: true },
    { h: '&#128367; ABSENT FRIENDS', p: `The stadium rises for ${absentFriends}. Departed from The League, not this mortal coil. Their picks remain in the minutes.` },
    { h: '&#127908; Main stage', p: 'Coldplay perform Viva la Vida in its 9-minute extended ceremony arrangement. Chris Martin has been told this is a twelve-man WhatsApp league that left its old website over £145. He says every revolution is beautiful.' },
    { h: '&#129309; The draw', p: 'The Committee opens the envelopes. The order is final. The complaints will not be.' },
    ...[...order].reverse().map((mid, i) => ({
      h: `Drafting ${ordinals[i + (ordinals.length - order.length)]}…`, p: managerName(mid), big: true,
    })),
    // Marc, draft eve: "can michael buffer start the draft?" He cannot — but
    // the collapse of negotiations is announced, and a local man steps in
    // (audio/buffer-out.mp3, cut by Ben; missing file = silent, ceremony unhurt)
    { h: '&#128226; A CLUB STATEMENT', p: 'The Committee regrets to announce that, following a late breakdown in negotiations over appearance fees, Michael Buffer is OUT of the opening ceremony. A local man has stepped in. He has been told roughly what to say.', buffer: true },
    { h: 'REPORT TO THE DRAFT ROOM', p: '', wait: true },
  ];
  // the barrier card reports the room's real state, not a fixed sentence — a
  // manager waiting on 11/12 can see who the room is still waiting for
  const waitLine = () => {
    if (!netOn()) return 'You are through. Pick one begins when the room is ready.';
    const st = draftCeremonyStatus();
    return `You are through. Pick one begins only when all ${st.total} managers have finished or skipped the ceremony — ${st.count}/${st.total} are in.`;
  };
  let i = 0;
  const lastStep = steps.length - 1;
  const ov = document.createElement('div');
  ov.id = 'ceremony';
  ov.className = 'overlay';
  ov.innerHTML = '<div id="cerStage" style="display:flex;flex-direction:column;align-items:center;gap:12px;width:92%;max-width:520px"><div id="cerCard" style="width:100%"></div></div>';
  document.body.appendChild(ov);
  let paradeTimer = null;
  const show = () => {
    clearInterval(paradeTimer);
    if (i >= steps.length) { cerFinish(); ov.remove(); state.view = 'draft'; render(); return; }
    const s = steps[i];
    // "You are through" must be TRUE the moment it is on screen. This used to
    // report only when the button was pressed, so anyone who stopped to read
    // the card was silently holding up a room that was telling them they
    // weren't (Marc, 9 Aug: "the draft is still starting before everyone has
    // finished the opening ceremony" — he was sat on this card, uncounted).
    if (i === lastStep) cerFinish();
    $('#cerCard').innerHTML = `<div class="card" style="text-align:center">
      <h2 style="margin-bottom:12px">${s.h}</h2>
      ${s.parade || s.mparade ? '<div id="paradeSlot" class="parade-slot"></div>'
        : s.wait ? `<p class="rules-p" style="text-align:center" id="cerWait">${esc(waitLine())}</p>`
        : s.big ? `<div class="ceremony-name">${esc(s.p)}</div>` : `<p class="rules-p" style="text-align:center">${esc(s.p)}</p>`}
      <div style="margin-top:18px;display:flex;gap:8px;justify-content:center">
        <button class="btn small" id="cerNext">${i === steps.length - 1 ? 'I’m through — join the room' : 'Continue the pomp'}</button>
        <button class="btn ghost small" id="cerSkip" title="Reserved for Ian">Skip ceremony (Ian's button)</button>
      </div></div>`;
    if (s.buffer) {
      // the local man does the honours — the tap that opened this step is the
      // user gesture, so play is allowed; a missing file stays silent
      try { new Audio('audio/buffer-out.mp3').play().catch(() => { /* he lost his voice */ }); } catch { /* no Audio */ }
    }
    if (s.parade) {
      let f = 0;
      const nations = TEAMS;
      const showFlag = () => {
        const slot = $('#paradeSlot');
        if (!slot) { clearInterval(paradeTimer); return; }
        if (f >= nations.length) {
          slot.innerHTML = `<p class="rules-p" style="text-align:center">All ${nations.length} clubs present. Ian checked his watch ${nations.length} times.</p>`;
          clearInterval(paradeTimer);
          return;
        }
        const t = nations[f];
        slot.innerHTML = `${flagImg(t.name, true).replace('class="flag big"', 'class="flag parade-flag"')}
          <div class="parade-team">${esc(t.name)}</div>
          <div class="parade-bearer">flag carried by ${esc(FLAG_BEARERS[t.name] || 'a dignitary')}</div>`;
        f++;
      };
      showFlag();
      paradeTimer = setInterval(showFlag, 1400); // Marc, UAT: "still slightly too fast"
    }
    if (s.mparade) {
      // The twelve are the point of the parade, not a loading spinner. Each
      // entrance gets enough screen time to read; Ian's skip button remains.
      const MGR_WALKS = [
        m => `emerges from the tunnel to polite applause and one boo. The boo was from ${esc(managerName(rivalsOf(m.id)[0] || state.managers.find(x => x.id !== m.id).id))}.`,
        m => `walks out holding the ${esc(sponsorFor(m.id) || 'unsponsored')} matchday programme, waving at a section of ${esc(stadium(m.id))} that is not waving back.`,
        m => gafferFor(m.id) ? `is accompanied by ${esc(gafferFor(m.id).t)}, who has already seen enough.` : 'arrives unaccompanied. The dugout situation remains unresolved.',
        m => `applauds all four sides of ${esc(stadium(m.id))}, two of which exist.`,
        m => `points to the sky, then checks the Rate column on his phone.`,
        m => `high-fives ${esc(assistantFor(m.id).t)}, who was not expecting it.`,
        m => `jogs out looking match-fit, pulls up immediately.`,
        m => `salutes the away end. There is no away end.`,
        m => `carries last season's grudges in a small commemorative box.`,
        m => `mouths 'this is our year' to a camera that has already cut away.`,
        m => `arrives to the sound of ${esc(sponsorFor(m.id) || 'a local firm')}'s jingle, which nobody licensed either.`,
        m => `bows to the Committee. The Committee notes it, without warmth.`,
      ];
      let f = 0;
      const walkOut = () => {
        const slot = $('#paradeSlot');
        if (!slot) { clearInterval(paradeTimer); return; }
        if (f >= state.managers.length) {
          slot.innerHTML = '<p class="rules-p" style="text-align:center">All twelve accounted for. Nobody has been sent off yet. Yet.</p>';
          clearInterval(paradeTimer);
          return;
        }
        const m = state.managers[f];
        const entrance = typeof MANAGER_ENTRANCES !== 'undefined' ? MANAGER_ENTRANCES[m.id] : '';
        slot.innerHTML = `<div style="display:flex;justify-content:center;margin-bottom:6px">${kitSvg(m.id, 46)}</div>
          <div class="parade-team">${esc(m.team || m.name)}</div>
          <div class="parade-bearer">${esc(managerName(m.id))} ${entrance ? esc(entrance) : MGR_WALKS[(m.id * 7 + 3) % MGR_WALKS.length](m)}</div>`;
        f++;
      };
      walkOut();
      paradeTimer = setInterval(walkOut, 6500);
    }
    $('#cerNext').onclick = () => { i++; show(); };
    $('#cerSkip').onclick = () => { cerFinish(); ov.remove(); ceremonyWatch = null; state.view = 'draft'; render(); toast('Ceremony skipped. Waiting for the rest of the room.'); };
  };
  ceremonyWatch = {
    ov,
    finish: cerFinish,
    refresh: () => { const el = $('#cerWait'); if (el) el.textContent = waitLine(); },
  };
  show();
}
/* The room can open underneath a manager who is still in the pomp — the
   Chairman's force-start marks everyone through, and pick one voids the
   barrier for good. The overlay used to sit there frozen while the board moved
   on (Marc, 9 Aug: "once I clicked on the left button it was already 2 picks
   in"), and the pick clock politely refuses to tick while it is up, so there
   was nothing on screen to give the game away. Every shared tick checks. */
function ceremonyTick() {
  if (!ceremonyWatch) return;
  if (!document.body.contains(ceremonyWatch.ov)) { ceremonyWatch = null; return; }
  if (state.phase === 'draft' && !state.draft.picks.length) { ceremonyWatch.refresh(); return; }
  ceremonyWatch.finish(); // count us anyway; the room is past caring
  ceremonyWatch.ov.remove();
  ceremonyWatch = null;
  state.view = 'draft';
  render();
  toast('The draft has started — the Committee has cut the pomp short.');
}

/* ----- drinks breaks (mandatory, per Marc; non-negotiable, per Ian's objections) ----- */
const DRINKS_COPY = [
  'FIRST DRINKS BREAK — a third of the way. Hydrate. The Committee is having a Negroni and reviewing your picks with interest.',
  'SECOND DRINKS BREAK — two thirds done. Stretch the legs. Ian: this break is contractually mandatory and was added specifically because of you.',
];
function drinksBreakAt(n) {
  const t = totalPicks();
  if (n === Math.round(t / 3)) return DRINKS_COPY[0];
  if (n === Math.round(2 * t / 3)) return DRINKS_COPY[1];
  return null;
}
// a proper break, not a pit stop (Marc, mock night: "slightly too quick") —
// the button unlocks after a 2-minute anthem countdown; the Chairman ends it.
const DRINKS_BREAK_MS = 120000;
function drinksBreakTrack(n) {
  const second = n === Math.round(2 * totalPicks() / 3);
  return second
    ? { sound: 'pitbull', title: 'Timber', artist: 'Pitbull' }
    : { sound: 'bonjovi', title: 'Livin\' on a Prayer', artist: 'Bon Jovi' };
}
function maybeDrinksBreak() {
  const ov = $('#drinksBreak');
  const n = pickNo();
  const due = state.phase === 'draft' && drinksBreakAt(n) && !(state.draft.breaksDone || []).includes(n);
  if (!due) { ov?.remove(); return; }
  if (ov) return;
  const track = drinksBreakTrack(n);
  const el = document.createElement('div');
  el.id = 'drinksBreak';
  el.className = 'overlay';
  el.innerHTML = `<div class="card" style="max-width:480px;width:92%;text-align:center">
    <div style="font-size:46px;margin-bottom:8px">&#127866;</div>
    <h2>${drinksBreakAt(n)}</h2>
    <p class="muted drinks-track" style="font-size:12.5px;margin-top:10px">&#127928; Now playing over the tannoy: <b>${esc(track.title)}</b> — ${esc(track.artist)}. Committee anthem, non-negotiable.</p>
    <button class="btn" id="breakDone" style="margin-top:16px" disabled>Back to the Console</button></div>`;
  document.body.appendChild(el);
  // First break: Bon Jovi. Second break: Pitbull. Key this to the break itself,
  // not pick-number parity — in a 168-pick draft both break numbers are even.
  // (Toby, UAT night). Both synthesized; both licensing-free; both shite/brilliant.
  const firstSpin = playSound(track.sound) || 12000;
  // ONE countdown for the whole room (Ben, test draft: "everyone should
  // start from same spot"): the break began the moment pick n landed, and
  // that instant is already shared state — the stale next-pick deadline was
  // armed right then, so its start is the anchor on every device. Falls back
  // to per-device localStorage offline / with the timer off (that fallback
  // still survives refreshes — sol mock-night).
  const shared = netOn() && state.settings.pickTimer && state.draft.deadline
    ? state.draft.deadline - state.settings.pickTimer * 1000 : 0;
  const breakKey = `${LS_NS}-break-${n}-${state.draftPool?.at || 0}`;
  let opened = shared || +localStorage.getItem(breakKey) || 0;
  if (!opened) { opened = Date.now(); try { localStorage.setItem(breakKey, opened); } catch { /* private mode */ } }
  const bd = $('#breakDone');
  const now = () => shared ? Date.now() + (window.__serverTimeOffset || 0) : Date.now();
  const tick = setInterval(() => {
    if (!document.body.contains(bd)) { clearInterval(tick); return; }
    const left = Math.max(0, DRINKS_BREAK_MS - (now() - opened));
    if (!left) { bd.disabled = false; bd.textContent = 'Back to the Console'; clearInterval(tick); return; }
    bd.textContent = `Halfway there… ${Math.floor(left / 60000)}:${String(Math.ceil(left / 1000) % 60).padStart(2, '0')}`;
  }, 500);
  // the anthem plays THROUGH the break, tannoy-style — the riff is ~6s and
  // used to play exactly once ('just the first few beeps, then nothing' —
  // Marc, test draft; Ben: 'what about playing the song?'). Repeats until
  // the countdown runs out or the Chairman calls everyone back in.
  // the anthem loops SEAMLESSLY: each spin schedules the next off the track's
  // own reported length ("didn't work well" — test night, the fixed 12s timer
  // left dead air between spins). A spin only starts if the WHOLE track fits
  // in the remaining countdown (sol P3: a flat 6s cutoff let the final Jovi
  // run 5.44s past the two minutes). Dies with the overlay.
  const spinAgain = dur => {
    if (!document.body.contains(bd)) return;
    if (DRINKS_BREAK_MS - (now() - opened) < dur) return;
    const d = playSound(track.sound) || dur;
    setTimeout(() => spinAgain(d), d);
  };
  setTimeout(() => spinAgain(firstSpin), firstSpin);
  bd.onclick = () => {
    if (bd.disabled) return;
    if (netOn() && !isCommissioner()) { toast('The Chairman calls everyone back in. Enjoy the break.'); return; }
    if (netOn()) { serverAct('draftAdmin', { op: 'breakDone', round: n }).catch(() => {}); return; }
    if (state.settings.pickTimer) state.draft.deadline = Date.now() + state.settings.pickTimer * 1000;
    state.draft.breaksDone = [...(state.draft.breaksDone || []), n];
    save(); render();
  };
}

/* ----- the punditry desk ----- */
const PUNDITS = {
  prutton: { name: 'David Prutton', emoji: '&#127897;&#65039;', init: 'DP', cls: 'pa-dp' },
  al: { name: 'Big Al Brazil', emoji: '&#127866;', init: 'AB', cls: 'pa-al' },
  redknapp: { name: 'Jamie Redknapp', emoji: '&#128084;', init: 'JR', cls: 'pa-jr' },
  coisty: { name: 'Ally McCoisty', emoji: '&#128516;', init: 'AM', cls: 'pa-am' },
};
// certified lobus registry: big centre-forwards, great feet for big men
const LOBUS_LIST = ['haaland', 'sorloth', 'strand larsen', 'gyokeres', 'lukaku', 'batshuayi',
  'fullkrug', 'weghorst', 'brobbey', 'en nesyri', 'azmoun', 'petkovic', 'budimir',
  'arnautovic', 'embolo', 'nunez', 'dykes', 'giroud', 'kane', 'mateta', 'guirassy', 'igor thiago', 'ali daei'];

function pundComment(pk) {
  const p = PLAYER_BY_ID[pk.playerId];
  const mgr = managerName(pk.managerId);
  const seed = (pk.n * 2654435761 + pk.playerId * 97) >>> 0;
  const pick = arr => arr[seed % arr.length];
  const r = rating(p);
  const rank = ratingRank(r);
  const sameClub = managerSquad(pk.managerId).filter(x => x.team === p.team).length;
  const nm = normName(p.name), mgrN = normName(mgr);
  // bespoke triggers — requested by the panel, vetted by nobody
  if (nm.includes('haaland')) {
    return { who: 'prutton', line: mgrN.includes('ben levy')
      ? `Ben Levy takes Haaland. AGAIN. Third year running he's going to fuck it up with the best striker on Earth. It's genuinely a skill.`
      : `${mgr} drafts Haaland — brave, considering what that player did to Ben Levy's last two seasons. Cursed goods, for me. 2-1.`, sound: 'cheer' };
  }
  if (LOBUS_LIST.some(l => nm.includes(l)) && p.pos === 'FW') {
    return { who: 'al', line: `LOBUS KLAXON — sponsored by Ali Daei, Iranian legend, 108 international goals, the original lobus. Congrats ${mgr}, enjoy your shiny new lobus: ${p.name}. Big unit. Great feet for a big man.`, sound: 'cheer' };
  }
  if (p.team === 'Man City') {
    return { who: 'redknapp', line: mgrN.includes('tussie')
      ? `Tussie takes a City player. "I'll be drafting the entire City team by GW30 regardless" — his words, on the record, in the group chat. ${sameClub + 1} down, ${Math.max(0, 10 - sameClub)} to go.`
      : `${p.name} of Manchester City. ${mgr}'s legal team are across the 115 charges as we speak.` };
  }
  if (p.team === 'Everton' && mgrN.includes('polak')) {
    return { who: 'coisty', line: `Ben Polak drafts an Everton player! With his HEART! Magnificent! Sentimental! Almost certainly points-negative!`, sound: 'cheer' };
  }
  if (p.team === 'Arsenal' && mgrN.includes('conway')) {
    return { who: 'prutton', line: `Marc takes an Arsenal man. Somewhere in the distance, North London Forever starts up. Nobody requested it. Nobody ever has to.` };
  }
  // a departed man is his own disaster and gets his own line — Big Al calling
  // a permanent transfer to Como an INJURY was the tell that 'u' had been
  // filed under fitness (Marc, 18 Aug)
  if (hasLeft(p)) {
    return { who: 'al', line: `${mgr}. ${mgr}. He has gone, son. ${p.name} has ${leftHow(p) === 'on loan' ? 'GONE OUT ON LOAN' : 'BEEN SOLD'} — he is not playing in this league again. ${p.news ? `"${p.news}."` : ''} That is a pick you do not get back. I need a Guinness.`, sound: 'trombone' };
  }
  if ((p.status === 'i' || p.status === 's') && pk.n <= state.managers.length * 8) {
    return { who: 'al', line: `${mgr}, small thing — ${p.name} is ${p.status === 's' ? 'SUSPENDED' : 'INJURED'}. Says so right there on the board. ${p.news ? `"${p.news}."` : ''} I need a Guinness.`, sound: 'trombone' };
  }
  if (p.pos === 'GK' && pk.n <= state.managers.length * 2) {
    return { who: 'al', line: `A goalkeeper?! At pick ${pk.n}?! Honestly. I need a coffee. And by coffee I obviously mean a Guinness.`, sound: 'trombone' };
  }
  if (sameClub >= 3) {
    return { who: 'prutton', line: `That's ${sameClub} from ${p.team} for ${mgr}. Like a loan-heavy January window at Barnsley, that. I'm predicting 2-1, by the way. I always am.` };
  }
  if (rank < 25) {
    return { who: pick(['redknapp', 'al', 'coisty']), line: pick([
      `${p.name} is literally a Rolls Royce of a footballer. Literally. Top, top, TOP pick from ${mgr}.`,
      `Top, top player. I had a word with his agent at Cheltenham — lovely fella, bought me a magnum of red. ${mgr}'s done well there.`,
      `Oh I LOVE him! ${p.name}! Absolutely magnificent! What a pick, what a draft, what a MORNING!`,
    ]), sound: 'cheer' };
  }
  if (rank > 400 && pk.n <= state.managers.length * 6) {
    return { who: pick(['al', 'prutton', 'coisty']), line: pick([
      `${p.name}? Never heard of him. And I've heard of EVERYONE. Give it a wide berth, ${mgr}.`,
      `${p.name} at pick ${pk.n}. Shades of a wet Tuesday night at Rotherham about that one.`,
      `${p.name}! ${r} points last season! ${mgr}, you wee rascal, what are you DOING?!`,
    ]), sound: 'trombone' };
  }
  return { who: pick(['prutton', 'al', 'redknapp', 'coisty']), line: pick([
    `Tidy pick from ${mgr}. Honest. Hard-working. EFL-core. 2-1.`,
    `${mgr} goes ${p.name}. Decent shout. Reminds me of a lad I roomed with at Ipswich. Different story for after the break.`,
    `When ${p.name}'s on it, he's literally unplayable. Literally cannot be played. ${mgr} knows it.`,
    `${p.name}, eh? We had him on the show once. Lovely fella. Ate all the biscuits.`,
    `${p.name} of ${p.team}! Honest pro. Good feet. GREAT feet. Right — racing from Chepstow at ten.`,
    `${p.name} at pick ${pk.n}. The Trough nods approvingly. Sticking with 2-1.`,
  ]) };
}

function punditAva(pd) { return `<span class="pundit-ava ${pd.cls}" title="${pd.name}">${pd.init}</span>`; }
function punditryDesk() {
  const recent = [...state.draft.picks].slice(-3).reverse();
  // club trivia lines cut at the mock draft (Marc: funny, but too much space)
  const lines = recent.length ? recent.map(pk => {
    const c = pundComment(pk);
    const pd = PUNDITS[c.who];
    return `<div class="pundit-line">${punditAva(pd)}<div><b>${pd.name}</b><p>${esc(c.line)}</p></div></div>`;
  }).join('') : `<div class="pundit-line">${punditAva(PUNDITS.prutton)}<div><b>${PUNDITS.prutton.name}</b><p>Welcome to draft night, live and exclusive. Alongside me: Big Al, who's been here since the gallops; Jamie, who has literally never been more excited; and Ally, who loves all ${PLAYERS.length} players equally. Twelve managers, one title, and somewhere out there, a Lobus. I'm predicting 2-1.</p></div></div>`;
  return `<div class="card">
    <h2>The Punditry Desk <span class="tag">LIVE on Sky Sports The Console</span></h2>
    <div class="pundit-strip">${Object.values(PUNDITS).map(pd => `<span class="pundit-chip">${punditAva(pd)}${pd.name} ${pd.emoji}</span>`).join('')}</div>
    ${lines}
  </div>`;
}

/* ----- broadcast audio (synthesized, no files, Ian-mutable) ----- */
let audioCtx = null;
const soundOn = () => localStorage.getItem('tl2627-mute') !== '1';
function actx() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
document.addEventListener('click', () => { try { actx(); } catch { /* no audio */ } }, { once: true });
function tone(c, freq, at, dur, { type = 'triangle', gain = 0.07, slideTo = null } = {}) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + at);
  if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, c.currentTime + at + dur);
  g.gain.setValueAtTime(0, c.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + at + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + at);
  o.stop(c.currentTime + at + dur + 0.05);
}
function playSound(kind) {
  if (!soundOn()) return;
  try {
    const c = actx();
    if (kind === 'cheer') {
      // crowd roar: filtered noise swell + triumphant notes
      const len = c.sampleRate * 1.4;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.min(i / (len * 0.3), 1 - i / len);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.6;
      const g = c.createGain(); g.gain.value = 0.12;
      src.connect(f).connect(g).connect(c.destination); src.start();
      tone(c, 523, 0.1, 0.15); tone(c, 659, 0.25, 0.15); tone(c, 784, 0.4, 0.4, { gain: 0.09 });
    } else if (kind === 'bonjovi') {
      // Livin' on a Prayer, chorus, tannoy arrangement — the drinks-break
      // anthem, commissioned by the Chairman mid-mock-draft. Synthesized like
      // everything else here; Jon Bon Jovi was unavailable for licensing.
      // Third attempt (test night, twice: once it played a single bar and
      // stopped; looped, the bar rattled around in six seconds of dead air).
      // Now it's the FULL chorus with a band behind it, and it returns its
      // length so the break can loop it seamlessly.
      const b = 0.49; // one beat at ~122 BPM
      const N = { E2: 82.4, C3: 130.8, D3: 146.8, G4: 392, A4: 440, B4: 493.9, C5: 523.3, D5: 587.3 };
      // bass: driving eighths, two bars each of Em, Em, C, D — twice round
      const bassBars = ['E2', 'E2', 'C3', 'D3', 'E2', 'E2', 'C3', 'D3'];
      bassBars.forEach((root, bar) => {
        for (let q = 0; q < 8; q++) tone(c, N[root], (bar * 4 + q * 0.5) * b, b * 0.42, { type: 'square', gain: 0.03 });
      });
      // the vocal line, in beats: whoa / we're half way there / whoa-OH / livin' on a prayer
      const line = [
        ['G4', 0, .75], ['A4', .8, .75], ['B4', 1.6, 2.2],
        ['B4', 4.5, .45], ['B4', 5, .45], ['A4', 5.5, .45], ['G4', 6, .45], ['A4', 6.5, 1.4],
        ['G4', 8, .75], ['A4', 8.8, .75], ['D5', 9.6, 2.4],
        ['D5', 12.5, .45], ['C5', 13, .45], ['B4', 13.5, .45], ['A4', 14, .45], ['B4', 14.5, 1.5],
      ];
      for (const [note, at, len] of line) {
        tone(c, N[note], at * b, len * b, { type: 'sawtooth', gain: 0.055 });
        tone(c, N[note] * 2, at * b, len * b, { type: 'triangle', gain: 0.018 }); // octave shimmer over the tannoy
      }
      for (const [note, at, len] of line) tone(c, N[note], (at + 16) * b, len * b, { type: 'sawtooth', gain: 0.055 });
      return Math.round(32 * b * 1000); // 8 bars — hand the loop its cue
    } else if (kind === 'pitbull') {
      // Timber, harmonica hook, same tannoy treatment — the SECOND drinks-break
      // anthem (Toby, UAT night: "should be a new song. Pitbull."). Mr Worldwide
      // was also unavailable for licensing. Same full-band rebuild as the Jovi.
      const b = 0.46; // ~130 BPM
      const N = { G2: 98, B2: 123.5, C3: 130.8, D3: 146.8, G4: 392, A4: 440, B4: 493.9, D5: 587.3, E5: 659.3 };
      const bassBars = ['G2', 'B2', 'C3', 'D3', 'G2', 'B2', 'C3', 'D3'];
      bassBars.forEach((root, bar) => {
        for (let q = 0; q < 4; q++) tone(c, N[root], (bar * 4 + q) * b, b * 0.5, { type: 'square', gain: 0.032 });
      });
      const hook = [
        ['E5', 0, .35], ['E5', .5, .35], ['E5', 1, .35], ['D5', 1.5, .5], ['B4', 2.1, .7],
        ['A4', 3, .35], ['B4', 3.5, .35], ['D5', 4, 1],
        ['E5', 5.5, .35], ['E5', 6, .35], ['E5', 6.5, .35], ['D5', 7, .5], ['B4', 7.6, .7],
        ['D5', 8.5, .35], ['B4', 9, .35], ['A4', 9.5, .5], ['G4', 10, 1.4],
      ];
      for (const [note, at, len] of hook) {
        tone(c, N[note], at * b, len * b, { type: 'square', gain: 0.05 });
        tone(c, N[note], at * b + 0.012, len * b, { type: 'square', gain: 0.02 }); // harmonica detune
      }
      for (const [note, at, len] of hook) tone(c, N[note], (at + 16) * b, len * b, { type: 'square', gain: 0.05 });
      return Math.round(32 * b * 1000);
    } else if (kind === 'themeGfw') {
      // Gazette Football Weekly: a lone piano and a cello, faintly sad. The
      // Podcunt Network has no audio files — the stings are synthesised like
      // the klaxons and the drinks-break anthems (Marc, 17 Aug).
      const N = { D4: 294, F4: 349, A4: 440, C5: 523, E5: 659 };
      const fig = [['D4', 0, .5], ['A4', .3, .5], ['F4', .62, .5], ['C5', .95, .7], ['A4', 1.5, .5], ['E5', 1.85, 1.1]];
      for (const [n, at, d] of fig) tone(c, N[n], at, d, { type: 'sine', gain: 0.055 });
      tone(c, 147, 0, 2.6, { type: 'triangle', gain: 0.03 }); // the cello, sighing
    } else if (kind === 'themeTt') {
      // talkTROUGH: brass, an airhorn, and no apology whatsoever
      const N = { C4: 262, E4: 330, G4: 392, C5: 523 };
      const fan = [['C4', 0, .22], ['E4', .2, .22], ['G4', .4, .22], ['C5', .6, .75]];
      for (const [n, at, d] of fan) tone(c, N[n], at, d, { type: 'sawtooth', gain: 0.075 });
      tone(c, 880, .75, .45, { type: 'square', gain: 0.05, slideTo: 660 }); // airhorn
      tone(c, 660, 1.15, .5, { type: 'square', gain: 0.045, slideTo: 880 });
    } else if (kind === 'adGfw') {
      tone(c, 523, 0, .18, { type: 'sine', gain: 0.05 });
      tone(c, 784, .16, .34, { type: 'sine', gain: 0.045 });
    } else if (kind === 'adTt') {
      tone(c, 392, 0, .14, { type: 'sawtooth', gain: 0.07 });
      tone(c, 523, .13, .14, { type: 'sawtooth', gain: 0.07 });
      tone(c, 659, .26, .3, { type: 'sawtooth', gain: 0.08 });
    } else if (kind === 'whistle') {
      // full time: an officious triple blast, the last one held far longer
      // than anyone needed ("more sound effects but not too many… humourous")
      tone(c, 2200, 0, 0.12, { type: 'square', gain: 0.045 });
      tone(c, 2200, 0.22, 0.12, { type: 'square', gain: 0.045 });
      tone(c, 2200, 0.44, 0.85, { type: 'square', gain: 0.05, slideTo: 2150 });
    } else if (kind === 'klaxon') {
      // the lobus air horn: two tones, both wrong
      tone(c, 466, 0, 0.4, { type: 'sawtooth', gain: 0.07 });
      tone(c, 370, 0.42, 0.55, { type: 'sawtooth', gain: 0.07 });
      tone(c, 466, 1.05, 0.7, { type: 'sawtooth', gain: 0.06 });
    } else if (kind === 'trombone') {
      // the universal sound of a bad decision
      tone(c, 466, 0, 0.25, { type: 'sawtooth', gain: 0.06, slideTo: 440 });
      tone(c, 415, 0.28, 0.25, { type: 'sawtooth', gain: 0.06, slideTo: 392 });
      tone(c, 370, 0.56, 0.25, { type: 'sawtooth', gain: 0.06, slideTo: 349 });
      tone(c, 330, 0.84, 0.7, { type: 'sawtooth', gain: 0.07, slideTo: 233 });
    } else {
      // broadcast sting
      tone(c, 523, 0, 0.09); tone(c, 659, 0.1, 0.09); tone(c, 784, 0.2, 0.16);
    }
  } catch { /* no audio available */ }
}
// pick-by-pick broadcast audio SACKED by the Chairman at the mock draft
// (2 Aug: "will tell it to sack the noises"). The punditry desk still writes;
// it just no longer parps. Do not re-add a sting per pick.
function broadcastOnPick() {}

/* ----- the console (draft) ----- */
// The League's own board rating is the draft currency, so the pool opens in
// that order (Ben + Marc, 5 Aug). Managers can still sort it afterwards.
let poolFilter = { q: '', team: '', pos: [], sort: 'rate', limit: 60 };
// pool positions are a SET like the queue's — "I'm out of mids, show me
// everyone EXCEPT mids" is three taps, not impossible (Marc, test draft).
// Accepts a legacy string too: saved scout views stored a single pos.
const poolPosOn = () => Array.isArray(poolFilter.pos) ? poolFilter.pos : (poolFilter.pos ? [poolFilter.pos] : []);
// which squad the side panel shows: yours, or the man on the clock's (Ben +
// Marc, mock night: both, clearly labelled, yours first)
let draftSquadTab = 'mine';
function squadPanelHtml() {
  const meValid = netOn() && whoami && whoami !== -1;
  // third option (Marc + Ben, UAT: "see everyone's squad so far") — a dropdown
  // to nose at ANY board; draftSquadTab holds a manager id when it's in use
  const showMid = meValid && draftSquadTab === 'mine' ? whoami
    : typeof draftSquadTab === 'number' ? draftSquadTab
    : currentManagerId();
  if (showMid == null) return '<span class="muted">No one on the clock.</span>';
  const tabs = `<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      ${meValid ? `<button class="btn small ${draftSquadTab === 'mine' ? '' : 'ghost'}" data-sqtab="mine">My squad</button>` : ''}
      <button class="btn small ${draftSquadTab === 'clock' ? '' : 'ghost'}" data-sqtab="clock">On the clock</button>
      <select id="sqAnyone" style="font-size:12px;max-width:140px">
        <option value="">Anyone&hellip;</option>
        ${state.managers.map(mm => `<option value="${mm.id}" ${draftSquadTab === mm.id ? 'selected' : ''}>${esc(mm.name)}</option>`).join('')}
      </select>
      <button class="btn ghost small" data-allboards>All squads</button>
    </div>`;
  return `${tabs}<h2>${esc(managerName(showMid))}'s squad${meValid && showMid === whoami ? ' <span class="tag">you</span>' : ''}</h2>
    <div class="quota-bar">${quotaPills(showMid)}</div>
    ${managerSquad(showMid).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos]).map(p => `
      <div class="srow"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${kitImg(p.team, p.pos === 'GK', p)}${pname(p)}</div>
    `).join('') || '<span class="muted">No picks yet</span>'}`;
}

// every board at once (Ben, UAT night: "I'd like a function where I can see
// everyone's squad so far — even if it's out the way") — read-only, live
function allBoardsSheet() {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const board = m => {
    const sq = managerSquad(m.id).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos] || rating(b) - rating(a));
    return `<div style="min-width:0">
      <div style="font-weight:800;font-size:12.5px;margin-bottom:2px">${kitSvg(m.id, 14)} ${esc(m.team || m.name)} <span class="muted" style="font-weight:400">${sq.length}</span></div>
      ${sq.map(p => `<div style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span class="pos-badge pos-${p.pos}" style="font-size:8.5px">${p.pos}</span> ${esc(p.name)}</div>`).join('') || '<span class="muted" style="font-size:11px">—</span>'}
    </div>`;
  };
  ov.innerHTML = `<div class="card" style="max-width:720px;width:96%;max-height:88vh;overflow-y:auto">
    <h2>Every squad so far</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:8px">
      ${state.managers.map(board).join('')}
    </div>
    <div style="text-align:center;margin-top:12px"><button class="btn small" id="abClose">Back to the room</button></div>
  </div>`;
  document.body.appendChild(ov);
  pushOvState();
  ov.onclick = e => { if (e.target === ov) closeOv(ov); };
  ov.querySelector('#abClose').onclick = () => closeOv(ov);
}
function viewDraft() {
  if (state.phase === 'season') return viewDraftRecap();
  const mid = currentManagerId();
  const n = pickNo();
  const round = Math.floor(n / state.managers.length) + 1;
  const taken = draftedIds();
  const ceremony = draftCeremonyStatus();
  const roomOpen = draftRoomOpen();

  // personal state: is it MY pick, and if not, how many picks until it is?
  const iAmUp = roomOpen && netOn() && whoami && whoami !== -1 && mid === whoami;
  const picksUntilMine = (() => {
    if (!netOn() || !whoami || whoami === -1 || iAmUp) return null;
    const m = state.managers.length;
    for (let k = 1; k <= m * 2; k++) {
      const nn = n + k, round = Math.floor(nn / m), idx = nn % m;
      const who = round % 2 === 0 ? state.draft.order[idx] : state.draft.order[m - 1 - idx];
      if (who === whoami) return k;
    }
    return null;
  })();
  // the big board: whose pick it is must be readable from across the room
  // (Ben, mock night: "it needs to be clearer that it's your pick — the names
  // are too small"). The group-chat intercept strip died for the space.
  const whoLine = !roomOpen
    ? `<span class="oc-label">OPENING CEREMONY</span><span class="oc-name">Waiting for the room</span><span class="oc-sub">${ceremony.count}/${ceremony.total} managers through</span>`
    : iAmUp
    ? `<span class="oc-label" style="color:var(--accent)">&#9201; YOUR PICK</span><span class="oc-name" style="color:var(--accent)">${esc(managerName(mid))}, you're on the clock</span>`
    : `<span class="oc-label">ON THE CLOCK</span><span class="oc-name">${esc(managerName(mid))}</span>${picksUntilMine ? `<span class="oc-sub">your pick in ${picksUntilMine}${state.settings.pickTimer ? ` (~${Math.ceil(picksUntilMine * state.settings.pickTimer / 60)} min)` : ''}</span>` : ''}`;
  return `
  ${!roomOpen ? `<div class="ceremony-wait" role="status"><b>The first pick is locked.</b><span>${ceremony.count}/${ceremony.total} managers have finished or skipped the opening ceremony. The clock starts automatically when the last manager arrives.</span>${netOn() && isCommissioner() ? `<button class="btn small" id="forceRoom" style="margin-top:8px">&#9878; Declare the room open (Chairman)</button>` : ''}</div>` : ''}
  <div class="on-clock${iAmUp ? ' me-up' : ''}">
    <div class="who">${whoLine}</div>
    ${state.settings.pickTimer ? '<span class="pick-clock" id="pickClock">–:––</span>' : ''}
    <div class="pick-meta">Pick ${n + 1} of ${totalPicks()} &middot; Round ${round} of ${SQUAD_RULES.size}${(() => {
      // every round has a title sponsor (ledger #5) — the hydration break was never in danger
      const sp = typeof AD_BOARDS !== 'undefined' && AD_BOARDS.length ? AD_BOARDS[(round - 1) % AD_BOARDS.length] : null;
      return sp ? ` &middot; Round ${round} brought to you by <b style="color:${sp.c}">${esc(sp.t)}</b> <span class="muted">— ${esc(sp.s)}</span>` : '';
    })()}</div>
    <div class="oc-btns">
      ${roomOpen && state.settings.pickTimer ? `<button class="btn ghost small" id="timewasteBtn" title="Take it to the corner flag (+30s)">&#8987; Timewaste (${1 - (state.draft.timewastes?.[mid] || 0)} left)</button>` : ''}
      ${!netOn() || isCommissioner() ? `<button class="btn ghost small" id="undoPick" ${n === 0 ? 'disabled' : ''}>Undo last</button>` : ''}
      ${roomOpen && (!netOn() || isCommissioner()) && state.settings.pickTimer ? `<button class="btn ghost small" id="pauseDraft">${state.draft.paused ? '&#9654; Resume' : '&#9208; Pause'}</button>` : ''}
      ${roomOpen && (!netOn() || isCommissioner()) && state.settings.pickTimer ? `<select id="pickTimerLive" title="Seconds per pick — applies from the next pick" aria-label="Pick timer">${[...new Set([10, 20, 30, 45, 60, 90, state.settings.pickTimer])].sort((x, y) => x - y).map(t => `<option value="${t}" ${state.settings.pickTimer === t ? 'selected' : ''}>${t}s/pick</option>`).join('')}</select>` : ''}
      ${roomOpen ? '<button class="btn ghost small" id="autoPick" title="Your autopick list first, then best available. Only the manager on the clock (or the Chairman) can press it.">&#129302; Autopick</button>' : ''}
      ${SANDBOX && (!netOn() || isCommissioner()) ? '<button class="btn ghost small" id="skipDraft" title="Sandbox only — autodraft every remaining pick and go straight to the season">&#9193; Skip the draft</button>' : ''}
      <button class="btn ghost small" id="heckleBtn" title="Random barb, your own words, or a player recommendation — lands biggest on the picker's screen. One per 15 seconds.">&#128227; Heckle</button>
    </div>
  </div>
  <div class="clock-strip" id="clockStrip" style="display:none">
    <span class="rec"></span> <b>${esc(managerName(mid))}</b> on the clock
    ${state.settings.pickTimer ? '<span class="pick-clock" id="pickClock2">–:––</span>' : ''}
    <span class="muted">Pick ${n + 1}/${totalPicks()}</span>
  </div>
  <div class="order-strip">${draftOrderStrip()}</div>
  <div class="draft-layout">
    <div class="card" id="poolCard">
      ${poolControlsHtml(PLAYERS.length - taken.size)}
      ${poolTable()}
    </div>
    <div class="draft-side">
      ${whoami && whoami !== -1 ? `<div class="card queue-card" id="queueCard">
        <h2>My Autopick List <span class="tag">${toArr(state.autolists?.[whoami]).length}</span></h2>
        <p class="muted" style="font-size:11.5px;margin-bottom:8px">Your ranked shortlist. If your clock hits zero, the top available pick goes in. Drag players across, or &#9734; them in the pool.</p>
        ${autolistRows()}
      </div>` : ''}
      <div class="card side-squad" id="sideSquad">
        ${squadPanelHtml()}
      </div>
      <div class="card" id="pickHistCard">
        <h2>Pick History</h2>
        <div class="pick-log">
          ${[...state.draft.picks].reverse().slice(0, 40).map(pk => {
            const p = PLAYER_BY_ID[pk.playerId];
            return `<div class="lrow"><span class="muted">#${pk.n}</span><b>${esc(managerName(pk.managerId))}</b> ${flagImg(p.team)} ${pname(p)}</div>`;
          }).join('') || '<span class="muted">First pick incoming…</span>'}
        </div>
      </div>
      ${punditryDesk()}
    </div>
  </div>
  ${(() => {
    // the personal strip (sol UX #4): my turn, my shape, my queue — one line,
    // pinned above the nav on phones, never covering the board
    if (!netOn() || !whoami || whoami === -1 || state.phase !== 'draft') return '';
    const c = posCount(whoami);
    const need = ['GK', 'DF', 'MF', 'FW'].map(pos => {
      const short = Math.max(0, SQUAD_RULES.min[pos] - c[pos]);
      return short ? `${short} ${pos}` : null;
    }).filter(Boolean);
    const sz = c.GK + c.DF + c.MF + c.FW;
    const slots = SQUAD_RULES.size - sz;
    const q = toArr(state.autolists?.[whoami]).map(id => PLAYER_BY_ID[id]).filter(p => p && !draftedIds().has(p.id)).slice(0, 3);
    const turn = iAmUp ? 'YOU ARE ON THE CLOCK' : picksUntilMine != null ? `your pick in ${picksUntilMine}` : 'order pending';
    return `<div class="draft-strip" id="draftStrip" title="Tap for your full queue">
      <b>${turn}</b>
      <span class="muted">&middot; ${slots} slot${slots === 1 ? '' : 's'}${need.length ? `, must draft ${esc(need.join(', '))}` : ''}</span>
      ${q.length ? `<span class="muted">&middot; queue: ${q.map(p => esc(playerDisplayName(p))).join(', ')}</span>` : ''}
    </div>`;
  })()}
  ${queueDrawerHtml()}
  ${squadDrawerHtml()}`;
}

// the pre-season Draft Console: same pool, same queue, no clock. The lads do
// their homework here and the list is waiting when the real board opens.
function viewDraftPrep() {
  const canQueue = whoami && whoami !== -1;
  const introOpen = window._draftIntroOpen === undefined ? _draftIntroFirstVisit : window._draftIntroOpen;
  return `
  <details class="card draft-intro" ${introOpen ? 'open' : ''}>
    <summary><b>The Draft Console &mdash; Scouting Floor</b><span>How the shortlist works</span></summary>
    <div class="draft-intro-body">
      <p class="rules-p">The draft hasn&rsquo;t started. Browse the pool, &#9733; star your targets and put them in order. On the night the top available name on your list goes in automatically if your clock hits zero.</p>
      ${!canQueue && netOn() ? '<p class="muted">Sign in (top right) to build your list &mdash; it saves to your account and will be waiting on draft night.</p>' : ''}
    </div>
  </details>
  <div class="draft-layout draft-prep-layout">
    <div class="card" id="poolCard">
      ${poolControlsHtml(PLAYERS.length)}
      ${poolTable()}
    </div>
    <div class="draft-side">
      <div class="card queue-card" id="queueCard">
        <h2>My Autopick List${canQueue ? ` <span class="tag">${toArr(state.autolists?.[whoami]).length}</span>` : ''}</h2>
        ${canQueue ? `
        <p class="muted" style="font-size:11.5px;margin-bottom:8px">Ranked &mdash; #1 is who the clock would take first. Drag players from the pool into this list and drag to reorder (or use &#9734; and the arrows).</p>
        ${autolistRows()}` : `
        <p class="muted" style="font-size:12.5px">Your ranked draft-night list lives here &mdash; drag players across from the pool, reorder them, and if your clock ever hits zero the top available name goes in.</p>
        <p style="font-size:12.5px;margin-top:8px"><b>${netOn() ? 'Sign in (top right) to start yours.' : 'Claim your team to start yours.'}</b></p>`}
      </div>
    </div>
  </div>
  ${queueDrawerHtml()}`;
}
const DRAFT_INTRO_SEEN_KEY = `${LS_NS}-draft-intro-seen`;
let _draftIntroFirstVisit = (() => { try { return !localStorage.getItem(DRAFT_INTRO_SEEN_KEY); } catch { return true; } })();
function bindDraftPrep() {
  const intro = document.querySelector('.draft-intro');
  if (intro) {
    try { localStorage.setItem(DRAFT_INTRO_SEEN_KEY, '1'); } catch {}
    intro.ontoggle = () => { window._draftIntroOpen = intro.open; };
  }
  bindPoolControls();
}

// shared by the live console and the scouting floor
function poolControlsHtml(availableCount) {
  const teamsOpts = [...TEAMS].sort((a, b) => a.name.localeCompare(b.name)).map(t => `<option value="${esc(t.name)}" ${poolFilter.team === t.name ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  return `<div class="pool-controls">
    <input type="text" id="poolQ" placeholder="Search ${availableCount} available players…" value="${esc(poolFilter.q)}">
    <select id="poolTeam"><option value="">All clubs</option>${teamsOpts}</select>
    ${['GK', 'DF', 'MF', 'FW'].map(p => `<button class="btn small ${poolPosOn().includes(p) ? '' : 'ghost'}" data-poolfpos="${p}" aria-pressed="${poolPosOn().includes(p)}" title="${poolPosOn().includes(p) ? `Stop showing ${p}` : `Also show ${p}`}">${p}</button>`).join('')}
    ${(() => {
      /* This used to render only during the draft, which was fine when its
         only job was showing drafted men. It now also reveals the players who
         have LEFT the league — and the place you most want that is the
         Scouting Floor, before a ball is kicked, which is exactly where the
         control was missing (Marc, 18 Aug: "I cant see that as a filter
         option"). So it is always here, and says what it does in each phase. */
      const live = state.phase === 'draft';
      const wide = live ? 'Everyone (incl. drafted &amp; departed)' : 'Everyone (incl. departed)';
      const tip = live
        ? 'Everyone: drafted men, dimmed with who took them, plus men who have left the league'
        : 'Everyone: also shows men who have left the Premier League — sold or out on loan, so unsignable';
      return `<select id="poolScope" title="${tip}">
      <option value="avail" ${poolFilter.scope !== 'all' ? 'selected' : ''}>Available</option>
      <option value="all" ${poolFilter.scope === 'all' ? 'selected' : ''}>${wide}</option>
    </select>`;
    })()}
  </div>`;
}
function queueDrawerHtml() {
  if (!whoami || whoami === -1) return '';
  return `
  <button class="btn queue-fab" id="queueFab">&#9733; Queue <span class="tag">${toArr(state.autolists?.[whoami]).length}</span></button>
  <div class="queue-drawer${window._queueOpen ? ' open' : ''}" id="queueDrawer">
    <h2 style="display:flex;align-items:center">My autopick queue <span class="tag" style="margin-left:8px">${toArr(state.autolists?.[whoami]).length}</span>
      <button class="btn ghost small icon-btn" id="queueClose" style="margin-left:auto" aria-label="Close queue">&#10005;</button></h2>
    <p class="muted" style="font-size:11.5px;margin-bottom:8px">Your ranked shortlist — the clock takes the top available name. Star players in the pool to add them.</p>
    ${autolistRows()}
  </div>`;
}

// phones: the squad panel scrolls miles below the pool, so it gets its own
// drawer next to the queue's (Toby, mock night: "def need easy access to your squad")
function squadDrawerHtml() {
  if (state.phase !== 'draft') return '';
  return `
  <button class="btn ghost squad-fab" id="squadFab">&#128101; Squads</button>
  <div class="queue-drawer${window._squadOpen ? ' open' : ''}" id="squadDrawer">
    <div class="side-squad">${squadPanelHtml()}</div>
    <button class="btn ghost small" id="squadClose" style="width:100%;margin-top:10px">Close</button>
  </div>`;
}

/* one ranked queue, rendered in the sidebar and the phone drawer alike —
   with a warning where autopick would have to skip a name */
/* Narrowing the queue (Marc, 13 Aug: "may want to reorder just my strikers but
   there will be players of other positions in between them"). The filter is a
   LENS, never a reordering: the rank shown is always the player's true place in
   the whole list, so typing 4 against a filtered striker means fourth overall,
   not fourth among strikers. */
let autoFilter = { pos: [], club: '', hideGone: true };
// positions are a SET, not a choice — "forwards and midfielders" is one
// question, not two (Marc, 13 Aug). Empty means everyone.
const autoPosOn = () => toArr(autoFilter.pos);
const autoFiltered = () => autoPosOn().length || autoFilter.club;
// drafted men are HIDDEN by default, not struck through — "you don't want to
// have to scroll down" (Marc, 18 Aug). Display-only: the list itself keeps
// them, so an undone pick quietly rejoins the queue.
const autoGone = p => p && state.phase === 'draft' && draftedIds().has(p.id);
const autoRowShown = p => p && (!autoPosOn().length || autoPosOn().includes(p.pos))
  && (!autoFilter.club || p.team === autoFilter.club)
  && (!autoFilter.hideGone || !autoGone(p));
// true indices of the rows the filter currently shows, in list order
function visibleAutoIdx() {
  return toArr(state.autolists?.[whoami])
    .map((pid, k) => ({ k, p: PLAYER_BY_ID[pid] }))
    .filter(x => autoRowShown(x.p))
    .map(x => x.k);
}
function moveAuto(from, to) {
  const arr = [...toArr(state.autolists?.[whoami])];
  if (!Number.isInteger(from) || from < 0 || from >= arr.length) return;
  const t = Math.max(0, Math.min(arr.length - 1, to));
  if (t === from) { render(); return; } // redraw so a typed number snaps back
  const [pid] = arr.splice(from, 1);
  arr.splice(t, 0, pid);
  setAutolist(whoami, arr);
}
function autolistRows() {
  const list = toArr(state.autolists?.[whoami]);
  if (!list.length) return '<span class="muted" style="font-size:12px">Empty. Brave.</span>';
  const clubs = [...new Set(list.map(pid => PLAYER_BY_ID[pid]).filter(Boolean).map(p => p.team))].sort();
  // a club filter whose club has left the list (last man removed, or a manager
  // switch) self-heals rather than lingering invisibly — the selector showed
  // "All clubs" while the lens stayed shut (sol launch-verify P3)
  if (autoFilter.club && !clubs.includes(autoFilter.club)) autoFilter = { ...autoFilter, club: '' };
  const goneCount = list.filter(pid => autoGone(PLAYER_BY_ID[pid])).length;
  const vis = visibleAutoIdx();
  // ids would collide — this markup renders in the side card AND the phone
  // drawer at the same time — so the controls are addressed by data attribute
  const on = autoPosOn();
  const controls = `<div class="pool-controls" style="margin:0 0 8px">
    ${['GK', 'DF', 'MF', 'FW'].map(pp => `<button class="btn small ${on.includes(pp) ? '' : 'ghost'}" data-autofpos="${pp}" aria-pressed="${on.includes(pp)}" title="${on.includes(pp) ? `Stop showing ${pp}` : `Also show ${pp}`}">${pp}</button>`).join('')}
    <select data-autofclub aria-label="Filter the list by club">
      <option value="">All clubs</option>
      ${clubs.map(c => `<option value="${esc(c)}" ${autoFilter.club === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
    </select>
    ${goneCount ? `<button class="btn ghost small" data-autofgone aria-pressed="${!autoFilter.hideGone}" title="${autoFilter.hideGone ? 'Show the drafted men, crossed out' : 'Tuck the drafted men away again'}">${autoFilter.hideGone ? `${goneCount} drafted hidden` : 'Hide drafted'}</button>` : ''}
    ${autoFiltered() ? `<button class="btn ghost small" data-autofclear>Clear</button>
      <span class="muted" style="font-size:11px;align-self:center">${vis.length} of ${list.length} &middot; ranks are still out of ${list.length}</span>` : ''}
  </div>`;
  const rows = vis.map((k, i) => {
    const p = PLAYER_BY_ID[list[k]];
    // pre-draft nobody is gone and every squad is empty — the flags only mean
    // something once the board is live
    const live = state.phase === 'draft';
    const gone = live && draftedIds().has(p.id);
    const wontFit = live && !gone && !canPick(whoami, p);
    return `<div class="lrow qrow" draggable="true" data-qdrag="${k}" style="font-size:12.5px${gone ? ';opacity:.45;text-decoration:line-through' : ''}">
      <input class="auto-rank" type="number" min="1" max="${list.length}" value="${k + 1}" data-autorank="${k}" draggable="false"
        title="Type a number to move him there — everyone else shifts down" aria-label="${esc(p.name)} is number ${k + 1}. Type a number to move him.">
      <span class="pos-badge pos-${p.pos}">${p.pos}</span> <span class="qname"><span class="plink qfull" data-pcard="${p.id}">${esc(String(p.full || '').trim() || playerDisplayName(p))}</span> <span class="muted" style="font-size:11px">${esc(p.club)}</span></span>
      ${gone ? '<span class="tag gone-tag" title="Already drafted — autopick skips him">GONE</span>' : ''}${wontFit ? '<span class="tag warn-tag" title="Your squad is full at this position — autopick skips him">won&rsquo;t fit</span>' : ''}${leftTag(p)}
      <span style="margin-left:auto;display:flex;gap:4px;flex:none">
        ${live && !gone ? `<button class="btn small${draftRoomOpen() && canPick(currentManagerId(), p) && canActFor(currentManagerId()) ? '' : ' dim'}" data-pick="${p.id}" draggable="false" title="Draft him straight from your list">Draft</button>` : ''}
        <button class="btn ghost small icon-btn" data-autoup="${k}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">&#9650;</button>
        <button class="btn ghost small icon-btn" data-autodown="${k}" ${i === vis.length - 1 ? 'disabled' : ''} aria-label="Move down">&#9660;</button>
        <button class="btn ghost small icon-btn" data-autodel="${k}" aria-label="Remove">&#10005;</button>
      </span></div>`;
  }).join('') || `<span class="muted" style="font-size:12px">${!autoFiltered() && goneCount ? 'Everyone on your list has been drafted.' : 'Nobody on your list matches that filter.'}</span>`;
  return controls + rows;
}

/* Pick alerts own the important top billboard. Heckles and klaxons are room
   noise: they share a lower rail and queue there, so neither can cover a pick
   or shout over the other (Marc, final mock-night notes). */
let _draftShoutQueue = [], _draftShoutEl = null, _draftShoutCurrent = null, _draftShoutTimer = null, _pickFlashTimer = null;
function pumpDraftShouts() {
  if (document.querySelector('.pick-flash')) return; // the actual pick always owns the room
  if (_draftShoutEl && document.body.contains(_draftShoutEl)) return;
  if (_draftShoutTimer) { clearTimeout(_draftShoutTimer); _draftShoutTimer = null; }
  _draftShoutEl = null;
  _draftShoutCurrent = null;
  const next = _draftShoutQueue.shift();
  if (!next) return;
  const el = document.createElement('div');
  el.className = `heckle-flash draft-shout ${next.kind}-flash${next.you ? ' heckle-you' : ''}`;
  el.innerHTML = next.html;
  document.body.appendChild(el);
  _draftShoutEl = el;
  _draftShoutCurrent = next;
  _draftShoutTimer = setTimeout(() => {
    el.remove();
    if (_draftShoutEl === el) { _draftShoutEl = null; _draftShoutCurrent = null; }
    _draftShoutTimer = null;
    pumpDraftShouts();
  }, next.ms);
}
function queueDraftShout(kind, html, ms, you = false) {
  // Tests and admin resets may remove a rail item directly; do not let its old
  // timer hold the next live message hostage.
  if (_draftShoutEl && !document.body.contains(_draftShoutEl)) {
    clearTimeout(_draftShoutTimer); _draftShoutTimer = null; _draftShoutEl = null; _draftShoutCurrent = null;
  }
  _draftShoutQueue.push({ kind, html, ms, you });
  pumpDraftShouts();
}

/* draft-night heckles: fresh stamps in state.heckles become a flash on every
   screen, biggest on the device that's actually on the clock */
function renderHeckles() {
  if (state.phase !== 'draft') return;
  const seen = window._hecklesSeen || (window._hecklesSeen = {});
  for (const [mid, h] of Object.entries(state.heckles || {})) {
    if (!h || !h.t || h.t <= (seen[mid] || 0)) continue;
    seen[mid] = h.t;
    if (Date.now() - h.t > 12000) continue; // page-load catch-up: don't replay old barbs
    heckleFlash(+mid, h);
  }
}
function heckleFlash(mid, h) {
  const txt = (h && typeof h.text === 'string' && h.text.trim())
    || (typeof HECKLES !== 'undefined' && HECKLES[h?.line]) || 'HURRY UP.';
  const onClock = whoami && whoami !== -1 && currentManagerId() === whoami;
  queueDraftShout('heckle', `<span class="hk-who">${esc(managerName(mid))}</span> &ldquo;${esc(txt)}&rdquo;`, onClock ? 6000 : 4000, onClock);
}

/* the heckle desk (Marc, mock night): random barb, your own words, or a
   player recommendation for the man on the clock. One channel, one cooldown. */
function sendHeckle(payload) {
  if (netOn()) { serverAct('heckle', payload).catch(() => {}); return; }
  const mid = whoami || state.managers[0].id;
  const last = state.heckles?.[mid]?.t || 0;
  if (Date.now() - last < 15000) { toast('One heckle per 15 seconds — pace yourself.'); return; }
  state.heckles = { ...(state.heckles || {}), [mid]: { ...payload, t: Date.now() } };
  save(); render();
}
function heckleSheet() {
  if ($('#heckleSheet')) return;
  const taken = draftedIds();
  const avail = PLAYERS.filter(p => !taken.has(p.id))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 300);
  const onClockName = managerName(currentManagerId());
  const ov = document.createElement('div');
  ov.id = 'heckleSheet';
  ov.className = 'overlay';
  ov.innerHTML = `<div class="card" style="max-width:440px;width:92%">
    <h2>&#128227; The Heckle Desk</h2>
    <p class="muted" style="font-size:12px;margin-bottom:10px">Lands on every screen, biggest on ${esc(onClockName)}'s. One per 15 seconds.</p>
    <button class="btn" id="hkRandom" style="width:100%">&#127922; Random barb</button>
    <div style="display:flex;gap:6px;margin-top:8px">
      <input type="text" id="hkText" maxlength="90" placeholder="Or write your own…" style="flex:1;min-width:0">
      <button class="btn ghost" id="hkSend">Send</button>
    </div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <input type="text" id="hkRec" list="hkRecList" placeholder="Or recommend ${esc(onClockName)} a player…" style="flex:1;min-width:0">
      <datalist id="hkRecList">${avail.map(p => `<option value="${esc(p.name)} (${esc(p.club)})"></option>`).join('')}</datalist>
      <button class="btn ghost" id="hkRecSend">Suggest</button>
    </div>
    <button class="btn ghost small" id="hkCancel" style="width:100%;margin-top:10px">Never mind</button>
  </div>`;
  document.body.appendChild(ov);
  pushOvState(); // phone Back closes the sheet, not the tab behind it
  const close = () => closeOv(ov);
  ov.onclick = e => { if (e.target === ov) close(); };
  $('#hkCancel').onclick = close;
  $('#hkRandom').onclick = () => {
    sendHeckle({ line: Math.floor(Math.random() * (typeof HECKLES !== 'undefined' ? HECKLES.length : 1)) });
    close();
  };
  $('#hkSend').onclick = () => {
    const t = $('#hkText').value.trim();
    if (!t) { toast('An empty heckle is just staring.'); return; }
    sendHeckle({ text: t.slice(0, 90) });
    close();
  };
  $('#hkText').onkeydown = e => { if (e.key === 'Enter') $('#hkSend').click(); };
  $('#hkRecSend').onclick = () => {
    const raw = $('#hkRec').value.trim();
    if (!raw) { toast('Pick a player to push.'); return; }
    const nm = raw.replace(/\s*\(.*\)\s*$/, '');
    const p = avail.find(x => x.name === nm) || avail.find(x => normName(x.name) === normName(nm));
    const text = p ? `recommends ${p.name} (${p.club}). No agenda whatsoever.` : `recommends "${raw.slice(0, 50)}". Spelling his own recommendation wrong, but go on.`;
    sendHeckle({ text: text.slice(0, 90) });
    close();
  };
}

/* player klaxons — the group chat's commissioned alarms, fired as picks land */
function renderKlaxons() {
  if (state.phase !== 'draft' || typeof KLAXONS === 'undefined') return;
  const picks = state.draft?.picks || [];
  if (window._klaxSeen == null) { window._klaxSeen = picks.length; return; } // no replay on page load
  for (let i = window._klaxSeen; i < picks.length; i++) {
    const pk = picks[i], p = PLAYER_BY_ID[pk.playerId];
    if (!p) continue;
    // every pick flashes up for everyone else (Toby, UAT: "I didn't see who
    // Wilko picked without scrolling") — your own pick you already know about
    if (!(whoami && pk.managerId === whoami)) pickFlash(pk, p);
    // surprises get a reaction (Ben: "if someone random is drafted in early
    // rounds") — a board-rank shock in the first five rounds flashes for all
    const shockRound = Math.ceil(pk.n / state.managers.length);
    if (shockRound <= 5 && ratingRank(rating(p)) > 200) {
      klaxonFlash({ label: '\u{1F4EF} SHOCK PICK', line: `Round ${shockRound}?! The board had him nowhere near this. The room needs a minute.` }, p);
    }
    for (const k of KLAXONS) {
      // a klaxon without a mid belongs to the whole room, not one manager
      if (k.mid != null && k.mid !== pk.managerId) continue;
      if (k.club && p.team !== k.club) continue;
      if (k.clubs && !k.clubs.includes(p.team)) continue;
      if (k.pos && p.pos !== k.pos) continue;
      // named men can be listed by immutable code or by name; either identifies
      if (k.codes || k.names) {
        const full = ((p.full || '') + ' ' + (p.name || '')).toLowerCase();
        const byCode = (k.codes || []).includes(p.code);
        const byName = (k.names || []).some(n => full.includes(n));
        if (!byCode && !byName) continue;
      }
      klaxonFlash(k, p);
    }
  }
  window._klaxSeen = picks.length;
}
function pickFlash(pk, p) {
  // A pick is the only compulsory information in this little circus. If room
  // noise is live, put it back at the head of its queue and resume it only
  // after the pick billboard has had the room to itself.
  if (_draftShoutEl && document.body.contains(_draftShoutEl)) {
    if (_draftShoutCurrent) _draftShoutQueue.unshift(_draftShoutCurrent);
    clearTimeout(_draftShoutTimer); _draftShoutTimer = null;
    _draftShoutEl.remove(); _draftShoutEl = null; _draftShoutCurrent = null;
  }
  document.querySelectorAll('.pick-flash').forEach(x => x.remove()); // last pick wins the billboard
  clearTimeout(_pickFlashTimer);
  const el = document.createElement('div');
  el.className = 'heckle-flash pick-flash';
  el.innerHTML = `<span class="hk-who">PICK ${pk.n}</span> ${esc(managerName(pk.managerId))} takes <b>${esc(p.name)}</b> <span class="muted">(${esc(p.pos)}, ${esc(p.team)})</span>`;
  document.body.appendChild(el);
  _pickFlashTimer = setTimeout(() => { el.remove(); _pickFlashTimer = null; pumpDraftShouts(); }, 5000);
}
function klaxonFlash(k, p) {
  queueDraftShout('klaxon', `<span class="hk-who">${esc(k.label)}</span> ${esc(p.name)} &mdash; ${esc(k.line)}`, 6500);
}

function draftOrderStrip() {
  const m = state.managers.length;
  const n = pickNo();
  const round = Math.floor(n / m);
  const order = state.draft.order;
  const seq = (round % 2 === 0) ? order : [...order].reverse();
  return seq.map((mid, i) => {
    const globalIdx = round * m + i;
    const cls = globalIdx < n ? 'done' : (globalIdx === n ? 'now' : '');
    return `<span class="order-chip ${cls}">${esc(managerName(mid))}</span>`;
  }).join('<span class="muted" style="align-self:center">›</span>') +
    `<span class="tag" style="margin-left:10px">Round ${round + 1}${round % 2 ? ' (reversed)' : ''}</span>`;
}

function quotaPills(mid) {
  const c = posCount(mid);
  return ['GK', 'DF', 'MF', 'FW'].map(p =>
    `<span class="quota-pill ${c[p] >= SQUAD_RULES.max[p] ? 'full' : ''}" title="min ${SQUAD_RULES.min[p]}, max ${SQUAD_RULES.max[p]}">${p} ${c[p]}/${SQUAD_RULES.max[p]}</span>`).join('');
}

/* ---- season-aware player metrics (Console pool + the Trough) ----
   Once gameweeks have synced stats, every number is THIS league's scoring,
   computed from matchStats. Until then, fall back to FPL's aggregates. */
const seasonHasStats = () => Object.values(state.matchStats || {}).some(ev => Object.keys(ev.playerStats || {}).length > 0);
let _metricsCache = new Map(), _metricsKey = '';
// projected points over the next n gameweeks: per-game expectation × the
// fixtures actually scheduled — blanks shrink it, doubles swell it
function projPts(p, n) {
  if (!state.fixtures?.length || !GAMEWEEKS.length) return 0;
  const curI = currentGwIndex();
  const fromN = GAMEWEEKS[curI].n + (gwIsOver(curI) ? 1 : 0);
  let games = 0;
  for (const f of state.fixtures) {
    if (fxOver(f)) continue;
    if (f.gw >= fromN && f.gw < fromN + n && (f.home === p.team || f.away === p.team)) games++;
  }
  return games * playerXp(p);
}
function metricsFor(p) {
  const live = seasonHasStats();
  const key = (live ? 'live:' + Object.values(state.matchStats).reduce((t, ev) => t + Object.keys(ev.playerStats || {}).length, 0) : 'pre') + ':fx' + (state.fixtures?.length || 0);
  if (_metricsKey !== key) { _metricsCache = new Map(); _metricsKey = key; }
  let m = _metricsCache.get(p.id);
  if (m) return m;
  if (live) {
    const { pts, agg } = playerPoints(p.id);
    const evs = Object.values(state.matchStats).filter(ev => ev.playerStats).sort((a, b) => a.gw - b.gw);
    let min = 0;
    for (const ev of evs) min += ev.playerStats[p.id]?.min || 0;
    const last5 = evs.slice(-5);
    const f5 = last5.length ? last5.reduce((t, ev) => t + (ev.playerStats[p.id] ? statPoints(p, ev.playerStats[p.id]) : 0), 0) / last5.length : 0;
    m = { pts, apps: agg.app, min, f5, gw: gwPlayerPoints(p.id, currentGwIndex()), g: agg.g, a: agg.a, cs: agg.cs, ppg: agg.app ? pts / agg.app : 0, price: p.price };
  } else {
    // pre-season: FPL's own aggregates until the July wipe, the archive after
    const ls = FPL_WIPED ? lastSeasonOf(p) : null;
    m = ls
      ? { pts: ls.pts, apps: Math.round((ls.mp || 0) / 90), min: ls.mp || 0, f5: 0, gw: 0, g: ls.g || 0, a: ls.a || 0, cs: ls.cs || 0, ppg: ls.ppg || 0, price: p.price }
      // Keep Pts as the official FPL total. Rate is the separate League/FPL
      // blend; using Rate here made the two columns identical (Ben, 5 Aug).
      : { pts: p.pts || 0, apps: Math.round((p.mp || 0) / 90), min: p.mp || 0, f5: 0, gw: 0, g: p.g || 0, a: p.a || 0, cs: p.cs || 0, ppg: p.ppg || 0, price: p.price };
  }
  m.xp1 = projPts(p, 1); m.xp3 = projPts(p, 3); m.xp6 = projPts(p, 6);
  // the xG family comes straight off the player record — FPL's season-to-date
  // figures, refreshed with the feed — so it is identical in both branches
  // above (Marc, 10 Aug). After the July wipe these read 0 until the new
  // season produces some, which is honest rather than borrowed from last year.
  m.xg = p.xg || 0; m.xa = p.xa || 0; m.xgc = p.xgc || 0;
  // xGI belongs to that family and now follows the same rule. It used to be
  // set per-branch, and the archive branch took LAST season's — so a row read
  // xG 0.64, xA 0.08, xGI 14.7: three columns, two seasons (Marc, 24 Aug 2026)
  m.xgi = m.xg + m.xa;
  // ...and last season's alongside it, as its own column rather than the same
  // one quietly changing meaning. Marc, 24 Aug 2026: "it needs both for now and
  // eventually we remove last seasons numbers". The archive holds a combined
  // xGI only — there is no separate xG or xA to pair with it.
  m.xgiLs = lastSeasonOf(p)?.xgi || 0;
  m.xg90 = p.xg90 || 0; m.xa90 = p.xa90 || 0; m.xgi90 = p.xgi90 || 0; m.xgc90 = p.xgc90 || 0;
  _metricsCache.set(p.id, m);
  return m;
}
// next fixture chip, Draft-Fantasy "Vs" style — comes alive once 26/27 fixtures land
const TEAM_SHORT_BY_NAME = Object.fromEntries(TEAMS.map(t => [t.name, t.short]));
let _fxCache = new Map(), _fxKey = '';
function nextFx(team) {
  // the chamber patches fixtures' finished flags, so the cache must turn over
  // when the mock starts, advances phase, or switches off (sol mock-night P2)
  const mk = state.mock;
  const key = String((state.fixtures || []).length) + (mk && mk.gw != null ? `:mk${mk.gw}:${mk.phase}` : ':off');
  if (_fxKey !== key) { _fxCache = new Map(); _fxKey = key; }
  if (_fxCache.has(team)) return _fxCache.get(team);
  const f = (state.fixtures || []).find(x => !x.finished && (x.home === team || x.away === team));
  const v = f ? (f.home === team ? `${TEAM_SHORT_BY_NAME[f.away] || f.away} (H)` : `${TEAM_SHORT_BY_NAME[f.home] || f.home} (A)`) : '—';
  _fxCache.set(team, v);
  return v;
}
// the coloured short fixture ("BOU (A)", tinted by fear) — the Vs column and
// the phone player cells share it
function nextFxHtml(team, gwN = null) {
  // gwN names the gameweek the reader actually cares about. In the Trough that
  // is the LANDING gameweek, not the live one: during GW1 the naive "next
  // unfinished fixture" showed Arsenal v COV — a match that had already
  // kicked off — while any deal signed then lands in GW2 away at Villa
  // (Wilko, GW1 night: "the trough doesn't show gameweek 2's games").
  if (gwN != null) return nextOppHtml(team, gwN);
  const t = nextFx(team);
  const opp = t.endsWith('(H)') || t.endsWith('(A)') ? Object.keys(TEAM_BY_NAME).find(n => TEAM_BY_NAME[n].short === t.slice(0, -4).trim()) : null;
  return opp ? `<span class="${fdrCls(opp)}">${t}</span>` : t;
}
// the full column menu, Draft Fantasy style; users pick their own set (kept per device)
const ALL_STAT_COLS = live => [
  { k: 'vs', h: 'Vs', t: 'Next fixture (H/A) — coloured by how scary they are', v: (m, p) => nextFxHtml(p.team), cls: ' muted', sortable: false },
  // FPL price column RETIRED (Lee read '£m' as transfer fees — there is no
  // money in this league; do not resurrect)
  { k: 'apps', h: live ? 'Apps' : '90s', t: live ? 'Appearances' : 'Minutes ÷ 90, last season', v: m => m.apps },
  { k: 'min', h: 'MP', t: 'Minutes played', v: m => m.min },
  { k: 'g', h: 'G', t: 'Goals', v: m => m.g },
  { k: 'a', h: 'A', t: 'Assists', v: m => m.a },
  { k: 'cs', h: 'CS', t: 'Clean sheets', v: m => m.cs },
  { k: 'xg', h: 'xG', t: 'Expected goals', v: m => m.xg.toFixed(2), cls: ' muted' },
  { k: 'xa', h: 'xA', t: 'Expected assists', v: m => m.xa.toFixed(2), cls: ' muted' },
  // two places, like the xG and xA it is the sum of. At one place Bobby Thomas
  // read xG 0.02, xA 0.01, xGI 0.0 — the column contradicting its own inputs
  // (Marc, 24 Aug 2026)
  { k: 'xgi', h: 'xGI', t: 'Expected goals + assists', v: m => m.xgi.toFixed(2), cls: ' muted' },
  { k: 'xgiLs', h: `xGI ${LS_SEASON.replace(/^20/, '').replace('/20', '/')}`, t: `Expected goals + assists — ${LS_SEASON}, the season before this one`, v: m => m.xgiLs.toFixed(2), cls: ' muted' },
  { k: 'xgc', h: 'xGC', t: 'Expected goals conceded while on the pitch — the defensive read', v: m => m.xgc.toFixed(1), cls: ' muted' },
  // per 90: the only fair way to compare a squad player to a nailed starter
  { k: 'xg90', h: 'xG90', t: 'Expected goals per 90 minutes', v: m => m.xg90.toFixed(2), cls: ' muted' },
  { k: 'xa90', h: 'xA90', t: 'Expected assists per 90 minutes', v: m => m.xa90.toFixed(2), cls: ' muted' },
  { k: 'xgi90', h: 'xGI90', t: 'Expected goals + assists per 90 minutes', v: m => m.xgi90.toFixed(2), cls: ' muted' },
  { k: 'xgc90', h: 'xGC90', t: 'Expected goals conceded per 90 minutes — lower is better', v: m => m.xgc90.toFixed(2), cls: ' muted' },
  { k: 'f5', h: 'F5', t: 'Form — average points over the last five gameweeks (league scoring)', v: m => m.f5.toFixed(1) },
  { k: 'xp1', h: 'P1', t: 'Projected points — next gameweek (per-game expectation × scheduled fixtures)', v: m => m.xp1.toFixed(1), cls: ' muted' },
  { k: 'xp3', h: 'P3', t: 'Projected points — next three gameweeks (blanks and doubles counted)', v: m => m.xp3.toFixed(1), cls: ' muted' },
  { k: 'xp6', h: 'P6', t: 'Projected points — next six gameweeks (blanks and doubles counted)', v: m => m.xp6.toFixed(1), cls: ' muted' },
  { k: 'gw', h: 'GW', t: 'Points this gameweek', v: m => m.gw },
  { k: 'ppg', h: 'PPG', t: live ? 'League points per appearance' : 'FPL points per game, last season', v: m => m.ppg.toFixed(1) },
  { k: 'pts', h: 'Pts', t: live ? 'Points under league scoring' : 'Total FPL points, last season', v: m => m.pts, cls: ' gold' },
  // Marc, UAT night: DF had a "rating" so new arrivals aren't buried at 0 pts —
  // this is the board's own blend (metricSort's rating tiebreak sorts it)
  { k: 'rate', h: 'Rate', t: 'The board’s rating — 75% last-season production rescored under THE LEAGUE’s rules, 25% current FPL valuation; valuation carries more when the sample is thin', v: (m, p) => Math.round(rating(p)) },
];
const DEFAULT_COL_KEYS = live => live
  ? ['vs', 'f5', 'ppg', 'pts', 'rate']
  : ['vs', 'ppg', 'pts', 'rate'];
// phones default to the decision numbers — tap any player for the full
// story, or add columns back from Scouting tools. Vs joined rate the night
// the season started (Iain, GW1 eve: "in the trough it'd be good to see
// their next fixture") — once games exist, the fixture IS a decision number.
// Saved column prefs still win over this default.
// the fixture lives IN the player cell on phones (.pfx / player-mobile-meta),
// so the lone decision-number column returns — nothing to drag sideways for
// (Ben, GW1 eve), and P11c's 320px pin holds
const MOBILE_COL_KEYS = () => ['rate'];
// V2 deliberately retires the old, sprawling defaults once. Managers can
// still add anything back; a clean first render now fits (Ben, 5 Aug).
const COL_PREFS_KEY = `${LS_NS}-cols-v2`;
let _colPrefs;
function visibleColKeys(live) {
  if (_colPrefs === undefined) { try { _colPrefs = JSON.parse(localStorage.getItem(COL_PREFS_KEY)); } catch { _colPrefs = null; } }
  return _colPrefs || (matchMedia('(max-width: 700px)').matches ? MOBILE_COL_KEYS(live) : DEFAULT_COL_KEYS(live));
}
// Marc, 10 Aug: follow the user's order, not the master list's. Vs was pinned
// first for no better reason than being first in ALL_STAT_COLS.
const STAT_COLS = live => {
  const all = ALL_STAT_COLS(live);
  return visibleColKeys(live).map(k => all.find(c => c.k === k)).filter(Boolean);
};
function colOptionsHtml(live) {
  const vis = visibleColKeys(live);
  return ALL_STAT_COLS(live).map(c => `<label class="scout-col-option"><input type="checkbox" data-coltoggle="${c.k}" ${vis.includes(c.k) ? 'checked' : ''}> <b>${c.h}</b> <span class="muted">${esc(c.t)}</span></label>`).join('');
}
/* Column order strip (Marc, 10 Aug). Drag on a laptop, arrows on a phone —
   the same pairing the draft order, the autopick queue and the claims ladder
   already use. HTML5 drag is a luxury; the arrows are the path that always
   works. Shared by all three scouting surfaces. */
function colOrderHtml(live) {
  const vis = visibleColKeys(live);
  const all = ALL_STAT_COLS(live);
  if (vis.length < 2) return '';
  // phones only — on a laptop you drag the table's own headers. A 30px header
  // is far too small a drag target on a touchscreen, so the arrows stay there.
  return `<div class="scout-columns order-only"><span class="scout-title">Order</span>
    <div class="scout-order-strip">${vis.map((k, i) => {
      const c = all.find(x => x.k === k);
      if (!c) return '';
      return `<div class="scout-col-order" title="${esc(c.t)}"><b>${c.h}</b>
        <button class="btn ghost small icon-btn" data-colmove="${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(c.h)} earlier">&#9650;</button>
        <button class="btn ghost small icon-btn" data-colmove="${i}:1" ${i === vis.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(c.h)} later">&#9660;</button>
      </div>`;
    }).join('')}</div>
    <p class="muted" style="font-size:10.5px;margin-top:4px">On a laptop, drag the column headings themselves.</p></div>`;
}
function bindColOrder(rerender) {
  const live = seasonHasStats();
  const write = arr => {
    _colPrefs = arr;
    try { localStorage.setItem(COL_PREFS_KEY, JSON.stringify(arr)); } catch { /* fine */ }
    rerender();
  };
  document.querySelectorAll('[data-colmove]').forEach(b => b.onclick = () => {
    const [i, d] = b.dataset.colmove.split(':').map(Number);
    const arr = [...visibleColKeys(live)];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    write(arr);
  });
  /* Drag the table's own headings, the way a spreadsheet does. Bound generically
     off whichever data-*sort attribute the surface uses, so the Draft Console,
     the Transfers hub and the Data Room explorer all get it without their
     markup knowing. A click still sorts — HTML5 drag never fires one. */
  const vis = visibleColKeys(live);
  const move = (from, onto) => {
    if (!from || from === onto) return;
    const arr = vis.filter(k => k !== from);
    const at = onto ? arr.indexOf(onto) : -1;
    arr.splice(at < 0 ? arr.length : at, 0, from);
    write(arr);
  };
  document.querySelectorAll('.pool-table thead th').forEach(th => {
    const key = Object.values(th.dataset || {}).find(v => vis.includes(v));
    if (!key) return;
    th.setAttribute('draggable', 'true');
    th.title = `${th.title || ''}${th.title ? ' · ' : ''}Drag to reorder`.trim();
    th.ondragstart = e => { e.dataTransfer.setData('text/plain', `col:${key}`); e.dataTransfer.effectAllowed = 'move'; };
    // dragover cannot read the payload (browsers withhold it until drop), so
    // highlight optimistically and verify the prefix when it lands
    th.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; th.classList.add('col-drop'); };
    th.ondragleave = () => th.classList.remove('col-drop');
    th.ondragend = () => document.querySelectorAll('.col-drop').forEach(x => x.classList.remove('col-drop'));
    th.ondrop = e => {
      e.preventDefault(); e.stopPropagation(); th.classList.remove('col-drop');
      const d = String(e.dataTransfer.getData('text/plain') || '');
      if (d.startsWith('col:')) move(d.slice(4), key);
    };
  });
}
function bindColToggle(rerender) {
  document.querySelectorAll('[data-coltoggle]').forEach(cb => cb.onchange = () => {
    const live = seasonHasStats();
    const cur = [...visibleColKeys(live)];
    const k = cb.dataset.coltoggle;
    // ticking a column appends it; it no longer snaps the whole set back to the
    // master order, which used to throw away any arrangement you'd made
    _colPrefs = cb.checked ? (cur.includes(k) ? cur : [...cur, k]) : cur.filter(x => x !== k);
    localStorage.setItem(COL_PREFS_KEY, JSON.stringify(_colPrefs));
    rerender();
  });
}
const metricSort = s => (a, b) => s === 'name' ? a.name.localeCompare(b.name)
  : ((metricsFor(b)[s] ?? 0) - (metricsFor(a)[s] ?? 0)) || rating(b) - rating(a);

/* ----- Scouting Desk -----
   Views and comparisons are deliberately device-local. They never enter the
   shared league state, so twelve managers can tinker without touching one
   another's board (or creating another server schema to babysit). */
const SCOUT_PRESETS = [
  { id: 'form', name: 'Form watch', cols: ['vs', 'f5', 'gw', 'ppg', 'pts'], sort: 'f5' },
  { id: 'reliable', name: 'Reliable starters', cols: ['vs', 'apps', 'min', 'ppg', 'pts'], sort: 'apps' },
  { id: 'output', name: 'Goals & assists', cols: ['vs', 'apps', 'g', 'a', 'xgi', 'xgiLs', 'ppg', 'pts'], sort: 'pts' },
];
const SCOUT_SORTS = new Set(['name', 'apps', 'min', 'g', 'a', 'cs', 'xg', 'xa', 'xgi', 'xgiLs', 'xgc', 'xg90', 'xa90', 'xgi90', 'xgc90', 'f5', 'xp1', 'xp3', 'xp6', 'gw', 'ppg', 'pts', 'rate']);
const SCOUT_POS = new Set(['', 'GK', 'DF', 'MF', 'FW']);
let scoutActiveView = { draft: '', transfers: '', data: '' };
// the Data Room's own filter state (Marc, 9 Aug: the Data Room is where you go
// to research and cut the data — the scout desk already does that, it was just
// locked to the two pages where you're mid-transaction). Read-only: no claims,
// no squad shape, no action column. Defaults to everyone, owners included.
// minMin is the minutes floor. Per-90 rates are nonsense on tiny samples — one
// chance in twenty minutes reads as 3.60 xG90 and tops the sort (Marc, 10 Aug)
// the picked players live in scoutCompare now — shared with the draft pool,
// the Trough and the search palette; what stays here is how to SHOW them
let dataView = { q: '', pos: '', club: '', scope: 'all', sort: 'pts', limit: 40, minMin: 0,
  comparing: false, backWeeks: 6, fwdWeeks: 6, compareCols: null };
const MIN_MINUTES_STEPS = [0, 90, 270, 450, 900];
const scoutViewsKey = () => `${LS_NS}-scout-views-${whoami && whoami !== -1 ? whoami : 'guest'}`;
function cleanScoutView(v) {
  if (!v || typeof v !== 'object') return null;
  const name = String(v.name || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  if (!name) return null;
  const allowedCols = new Set(ALL_STAT_COLS(seasonHasStats()).map(c => c.k));
  const cols = toArr(v.cols).filter((k, i, a) => allowedCols.has(k) && a.indexOf(k) === i);
  const sort = SCOUT_SORTS.has(v.sort) ? v.sort : 'rate';
  // pos is canonically an ARRAY now the pool filter is a set (sol test-draft
  // P2: GK+DF saved as "" and restored as nothing). A legacy string view
  // migrates to a one-element array; junk entries are dropped, dupes deduped.
  const pos = (Array.isArray(v.pos) ? v.pos : [v.pos])
    .filter((p, i, a) => p && SCOUT_POS.has(p) && a.indexOf(p) === i);
  const team = TEAM_BY_NAME[v.team] ? v.team : '';
  // Saved views travel between surfaces, so preserve the Trough's combined
  // Available scope here. applyScoutView degrades it to Free only on surfaces
  // that do not have an Available filter (Data Room and the draft pool).
  const scope = ['all', 'owned', 'waivers', 'avail'].includes(v.scope) ? v.scope : 'free';
  // minutes floor for the Data Room explorer; 0 on the surfaces that have none
  const mm = +v.minMin;
  const minMin = Number.isFinite(mm) && mm > 0 ? Math.min(Math.round(mm), 3420) : 0;
  return { id: String(v.id || `${Date.now()}-${Math.random()}`).slice(0, 80), name, cols, sort, pos, team, scope, minMin };
}
function scoutViews() {
  try {
    return toArr(JSON.parse(localStorage.getItem(scoutViewsKey()))).map(cleanScoutView).filter(Boolean).slice(0, 8);
  } catch { return []; }
}
function writeScoutViews(views) {
  try { localStorage.setItem(scoutViewsKey(), JSON.stringify(views.map(cleanScoutView).filter(Boolean).slice(0, 8))); }
  catch { toast('This device could not save that view'); }
}
function scoutViewHtml(surface) {
  const saved = scoutViews();
  const active = scoutActiveView[surface] || '';
  window._scoutToolsOpen = window._scoutToolsOpen || {};
  return `<details class="scout-tools" data-scout-tools="${surface}" ${window._scoutToolsOpen[surface] ? 'open' : ''}>
    <summary class="btn ghost small">Scouting tools <span aria-hidden="true">&#9881;</span></summary>
    <div class="scout-tools-panel">
      <div class="scout-desk">
        <span class="scout-title">Saved views</span>
        <select data-scout-view aria-label="Open a scouting view">
          <option value="" ${active ? '' : 'selected'}>Open a view…</option>
          <optgroup label="Built in">${SCOUT_PRESETS.map(v => `<option value="preset:${v.id}" ${active === `preset:${v.id}` ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</optgroup>
          ${saved.length ? `<optgroup label="My saved views">${saved.map(v => `<option value="saved:${esc(v.id)}" ${active === `saved:${v.id}` ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</optgroup>` : ''}
        </select>
        <button class="btn ghost small" data-scout-save>Save current</button>
        ${saved.length ? `<button class="btn ghost small" data-scout-delete ${active.startsWith('saved:') ? '' : 'disabled'}>Delete</button>` : ''}
      </div>
      <div class="scout-columns"><span class="scout-title">Columns</span><div class="scout-column-grid">${colOptionsHtml(seasonHasStats())}</div></div>
      ${colOrderHtml(seasonHasStats())}
    </div>
  </details>`;
}
function scoutSnapshot(surface) {
  const src = surface === 'draft' ? poolFilter : surface === 'data' ? dataView : transfersView;
  return cleanScoutView({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'view',
    cols: visibleColKeys(seasonHasStats()),
    sort: src.sort,
    pos: src.pos,
    team: surface === 'draft' ? src.team : src.club,
    scope: surface === 'draft' ? 'free' : src.scope,
    minMin: src.minMin || 0,
  });
}
function applyScoutView(v, surface) {
  const clean = cleanScoutView(v);
  if (!clean) return false;
  _colPrefs = clean.cols.length ? clean.cols : DEFAULT_COL_KEYS(seasonHasStats());
  localStorage.setItem(COL_PREFS_KEY, JSON.stringify(_colPrefs));
  // the pool and the Trough speak position SETS; the Data Room still speaks a
  // single string — a multi-position view honestly degrades to All there
  // rather than silently picking one of the saved positions
  const posOne = clean.pos.length === 1 ? clean.pos[0] : '';
  if (surface === 'draft') {
    poolFilter = { ...poolFilter, team: clean.team, pos: clean.pos, sort: clean.sort, limit: 60 };
  } else if (surface === 'data') {
    dataView = { ...dataView, club: clean.team, pos: posOne, scope: clean.scope === 'avail' ? 'free' : clean.scope, sort: clean.sort, minMin: clean.minMin, limit: 40 };
  } else {
    transfersView = { ...transfersView, club: clean.team, pos: clean.pos, scope: clean.scope, sort: clean.sort, limit: 20 };
  }
  return true;
}
function bindScoutDesk(surface, rerender) {
  document.querySelectorAll(`[data-scout-tools="${surface}"]`).forEach(tools => {
    tools.ontoggle = () => { window._scoutToolsOpen[surface] = tools.open; };
  });
  document.querySelectorAll('.scout-desk').forEach(desk => {
    const sel = desk.querySelector('[data-scout-view]');
    const del = desk.querySelector('[data-scout-delete]');
    sel.onchange = () => {
      scoutActiveView[surface] = sel.value;
      if (del) del.disabled = !sel.value.startsWith('saved:');
      if (!sel.value) return;
      const v = sel.value.startsWith('preset:')
        ? SCOUT_PRESETS.find(x => x.id === sel.value.slice(7))
        : scoutViews().find(x => x.id === sel.value.slice(6));
      if (v && applyScoutView(v, surface)) rerender();
    };
    desk.querySelector('[data-scout-save]').onclick = () => {
      const raw = prompt('Name this scouting view (for example: Friday shortlist)');
      const name = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 28);
      if (!name) return;
      const views = scoutViews();
      const snap = { ...scoutSnapshot(surface), name };
      const existing = views.findIndex(v => v.name.toLowerCase() === name.toLowerCase());
      if (existing >= 0) {
        views[existing] = { ...snap, id: views[existing].id };
        scoutActiveView[surface] = `saved:${views[existing].id}`;
      } else {
        views.push(snap);
        scoutActiveView[surface] = `saved:${snap.id}`;
      }
      writeScoutViews(views.slice(-8));
      toast(existing >= 0 ? `${name} updated` : `${name} saved on this device`);
      rerender();
    };
    if (del) del.onclick = () => {
      if (!sel.value.startsWith('saved:')) return;
      const id = sel.value.slice(6);
      const doomed = scoutViews().find(v => v.id === id);
      writeScoutViews(scoutViews().filter(v => v.id !== id));
      scoutActiveView[surface] = '';
      toast(doomed ? `${doomed.name} deleted` : 'Saved view deleted');
      rerender();
    };
  });
}

/* THE comparison selection — one list, shared by every surface. The Data
   Room's tick boxes, the draft pool's Compare button, the Trough and the
   search palette all add to this, so a pair started in one place is still
   there in another. Three is the cap everywhere; a fourth replaces the oldest
   rather than being refused, which saves hunting for what to untick. */
let scoutCompare = [];
const COMPARE_MAX = 3;
const compareIds = () => scoutCompare.filter(id => PLAYER_BY_ID[id]).slice(0, COMPARE_MAX);
// label lives in its own span so phones can swap it for a glyph (the full
// word made the sticky action column wide enough to bury the player cell)
const compareButtonHtml = pid => {
  const on = scoutCompare.includes(pid);
  return `<button class="btn ghost small${on ? ' compare-on' : ''}" data-compare="${pid}" aria-pressed="${on}" title="${on ? 'Remove from comparison' : 'Add to comparison'}"><span class="cmp-txt">${on ? '&#10003; Comparing' : 'Compare'}</span></button>`;
};
function compareOwner(pid) {
  return state.managers.find(m => managerSquad(m.id).some(p => p.id === pid));
}
function paintScoutCompare() {
  document.querySelectorAll('[data-compare]').forEach(b => {
    const on = scoutCompare.includes(+b.dataset.compare);
    b.classList.toggle('compare-on', on);
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = `<span class="cmp-txt">${on ? '&#10003; Comparing' : 'Compare'}</span>`;
  });
  let fab = document.getElementById('scoutCompareFab');
  if (!scoutCompare.length) {
    fab?.remove();
    const ov = document.getElementById('scoutCompareOverlay');
    if (ov) closeOv(ov);
    return;
  }
  if (!fab) {
    fab = document.createElement('button');
    fab.id = 'scoutCompareFab';
    fab.className = 'btn compare-fab';
    fab.onclick = () => showScoutCompare(true);
    document.body.appendChild(fab);
  }
  fab.textContent = `Compare ${scoutCompare.length}/${COMPARE_MAX}`;
  fab.setAttribute('aria-label', `Compare ${scoutCompare.length} selected players`);
  if (document.getElementById('scoutCompareOverlay')) showScoutCompare(false);
}
function toggleScoutCompare(pid) {
  if (!PLAYER_BY_ID[pid]) return;
  if (scoutCompare.includes(pid)) scoutCompare = scoutCompare.filter(id => id !== pid);
  else scoutCompare = [...scoutCompare, pid].slice(-COMPARE_MAX);
  // the explorer draws its ticks from the same list, so it has to redraw
  if (state.view === 'data') { dataView = { ...dataView, comparing: dataView.comparing && scoutCompare.length >= 2 }; render(); return; }
  paintScoutCompare();
}
function showScoutCompare(addHistory = true) {
  const existing = document.getElementById('scoutCompareOverlay');
  const ids = compareIds();
  if (ids.length < 2) {
    // dropping below two closes the overlay via closeOv so its history entry
    // is consumed with it — a bare remove() left one ghost Back press that
    // swallowed the first tap and did nothing (sol launch-verify P3)
    if (existing) closeOv(existing);
    toast('Pick two to compare');
    return;
  }
  existing?.remove();
  const ov = document.createElement('div');
  ov.id = 'scoutCompareOverlay';
  ov.className = 'overlay';
  ov.innerHTML = `<div class="card compare-card" role="dialog" aria-modal="true" aria-label="Player comparison">
    <div class="compare-head">
      <div><h2>Comparison <span class="tag">${ids.length}/${COMPARE_MAX}</span></h2><p class="muted">League scoring only. No bonus. No DEFCON.</p></div>
      <button class="btn ghost small icon-btn" data-compare-close aria-label="Close comparison">&#10005;</button>
    </div>
    ${compareBody(ids)}
    <div class="compare-foot">
      ${ids.map(id => `<button class="btn ghost small" data-compare-remove="${id}">Remove ${esc(PLAYER_BY_ID[id].name)}</button>`).join('')}
      <button class="btn ghost small" data-compare-clear>Clear all</button>
    </div>
  </div>`;
  ov.onclick = e => { if (e.target === ov || e.target.closest('[data-compare-close]')) closeOv(ov); };
  ov.querySelectorAll('[data-compare-remove]').forEach(b => b.onclick = e => { e.stopPropagation(); toggleScoutCompare(+b.dataset.compareRemove); });
  ov.querySelector('[data-compare-clear]').onclick = e => { e.stopPropagation(); scoutCompare = []; paintScoutCompare(); };
  bindCompareBody(() => showScoutCompare(false), ov);
  document.body.appendChild(ov);
  if (addHistory) pushOvState();
}
// the window pickers and metric ticks inside compareBody, wherever it renders
function bindCompareBody(redraw, root = document) {
  // root matters: the overlay builds its DOM detached, so document-wide
  // getElementById found nothing (or worse, the Data Room's inline copy) —
  // the overlay's window pickers and metric ticks were dead on arrival
  const back = root.querySelector('#cmpBack');
  if (back) back.onchange = e => { dataView = { ...dataView, backWeeks: +e.target.value }; redraw(); };
  const fwd = root.querySelector('#cmpFwd');
  if (fwd) fwd.onchange = e => { dataView = { ...dataView, fwdWeeks: +e.target.value }; redraw(); };
  root.querySelectorAll('[data-cmpcol]').forEach(box => box.onchange = () => {
    const cur = new Set(dataView.compareCols || COMPARE_METRICS.map(m => m.k));
    box.checked ? cur.add(box.dataset.cmpcol) : cur.delete(box.dataset.cmpcol);
    dataView = { ...dataView, compareCols: COMPARE_METRICS.map(m => m.k).filter(k => cur.has(k)) };
    redraw();
  });
}
function poolTable() {
  // on the scouting floor (setup phase) there is no board yet: nobody is
  // taken, nobody is on the clock, and the Draft button stays away
  const live = state.phase === 'draft';
  const taken = live ? draftedIds() : new Set();
  const mid = live ? currentManagerId() : null;
  const showGone = live && poolFilter.scope === 'all';
  // "Everyone" now means everyone — drafted AND departed. Anything narrower
  // hides the men who have left the league, because they are not signable
  const showAll = poolFilter.scope === 'all';
  let rows = showGone ? [...PLAYERS]
    : PLAYERS.filter(p => !taken.has(p.id) && (showAll || !hasLeft(p)));
  if (poolFilter.q) {
    const q = normName(poolFilter.q);
    rows = rows.filter(p => normName(p.name).includes(q) || normName(p.full).includes(q) || normName(p.team).includes(q) || normName(p.club).includes(q));
  }
  if (poolFilter.team) rows = rows.filter(p => p.team === poolFilter.team);
  if (poolPosOn().length) rows = rows.filter(p => poolPosOn().includes(p.pos));
  const s = poolFilter.sort;
  const cols = STAT_COLS(seasonHasStats());
  rows.sort(metricSort(s));
  const total = rows.length;
  rows = rows.slice(0, poolFilter.limit);
  const canQueue = whoami && whoami !== -1;
  // signed-out on the live site: stars still SHOW (dimmed) and tapping one
  // explains — an invisible feature reads as a broken one (Ben, 2 Aug)
  const showStar = canQueue || netOn();
  return `
  <div class="pool-wrap">
  ${scoutViewHtml('draft')}
  <div style="overflow-x:auto">
  <table class="pool-table draft-pool${live ? ' is-live' : ''}">
    <thead><tr>
      <th data-sort="name">Player</th><th class="col-club">Club</th><th class="col-pos">Pos</th>
      <th class="col-status"></th>
      ${cols.map(c => c.sortable === false ? `<th class="num" data-stat="${c.k}" title="${esc(c.t)}">${c.h}</th>` : `<th class="num" data-stat="${c.k}" data-sort="${c.k}" title="${esc(c.t)}">${c.h} ${s === c.k ? '▾' : ''}</th>`).join('')}<th class="act"></th>
    </tr></thead>
    <tbody>
      ${rows.map(p => `
      <tr class="${statusClass(p)}${taken.has(p.id) ? ' gone-row' : ''}${hasLeft(p) ? ' left-row' : ''}"${canQueue && !taken.has(p.id) ? ` draggable="true" data-drag="${p.id}"` : ''}>
        <td class="pcol"><div class="pcell">${photoImg(p)}<div class="player-copy"><button type="button" class="pname plink player-name-btn" data-pcard="${p.id}" title="Open ${esc(playerDisplayName(p))}'s stats">${natFlag(p)} <span class="pn-txt">${esc(playerDisplayName(p))}</span></button>${provChip(p)}<span class="player-mobile-meta">${esc(p.club)} &middot; ${p.pos} &middot; ${nextFxHtml(p.team)}</span></div></div></td>
        <td class="muted col-club" style="white-space:nowrap">${flagImg(p.team)} ${esc(p.club)}</td>
        <td class="col-pos"><span class="pos-badge pos-${p.pos}">${p.pos}</span></td>
        <td class="col-status">${hasLeft(p) ? leftTag(p) : statusChip(p)}</td>
        ${cols.map(c => `<td class="num${c.cls || ''}" data-stat="${c.k}">${c.v(metricsFor(p), p)}</td>`).join('')}
        <td class="act" style="white-space:nowrap">${taken.has(p.id) ? (() => {
          const pk = state.draft.picks.find(x => x.playerId === p.id);
          return pk ? `<span class="tag gone-tag" title="Pick ${pk.n}">#${pk.n} ${esc(teamName(pk.managerId))}</span>` : '<span class="tag gone-tag">GONE</span>';
        })() : `${live ? `<button class="btn small${draftRoomOpen() && canPick(mid, p) && canActFor(mid) ? '' : ' dim'}" data-pick="${p.id}">Draft</button>` : ''}${compareButtonHtml(p.id)}${showStar ? `<button class="btn ghost small icon-btn${canQueue && toArr(state.autolists?.[whoami]).includes(p.id) ? ' star-on' : ''}${canQueue ? '' : ' dim'}" data-auto="${p.id}" aria-label="${canQueue ? 'Add to my autopick list' : 'Sign in to build your list'}" title="${canQueue ? 'Add to my autopick list' : 'Sign in to build your list'}">${canQueue && toArr(state.autolists?.[whoami]).includes(p.id) ? '&#9733;' : '&#9734;'}</button>` : ''}`}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  </div>
  ${total > poolFilter.limit ? `<div class="show-more"><button class="btn ghost small" id="showMore">Show more (${total - poolFilter.limit} hidden)</button> <button class="btn ghost small" id="showAll">Show all ${total}</button></div>` : ''}
  </div>`;
}

let clockTimer = null;
let firedDeadline = 0;
let clockArming = false;
function armClock() {
  if (clockArming || !state.settings.pickTimer) return;
  if (netOn() && !draftRoomOpen()) return;
  if (state.draft.deadline && currentManagerId() != null) return; // armed with someone on the clock — nothing to do
  clockArming = true;
  if (netOn()) {
    // clockStart also HEALS a full board stuck in draft phase server-side
    serverAct('draftAdmin', { op: 'clockStart' })
      .catch(() => {})
      .finally(() => setTimeout(() => { clockArming = false; }, 3000));
  } else {
    if (currentManagerId() == null) state.phase = 'season'; // local seal
    else state.draft.deadline = Date.now() + state.settings.pickTimer * 1000;
    clockArming = false;
    save(); render();
  }
}
// deadline maths runs on SERVER time (Date.now + Firebase's measured offset),
// never the device's watch — a fast phone was firing everyone's expiry the
// instant they came on the clock (test draft, 18 Aug)
function draftDeadlineTiming(deadline, now = Date.now() + (window.__serverTimeOffset || 0)) {
  const rawLeft = Math.round(((deadline || 0) - now) / 1000);
  return { rawLeft, left: Math.max(0, rawLeft), overBy: Math.max(0, -rawLeft) };
}
function bindDraft() {
  clearInterval(clockTimer);
  if (state.phase === 'season') return;
  // pin a slim clock to the top once the big board scrolls out of sight
  const oc = document.querySelector('.on-clock'), cs = $('#clockStrip');
  if (oc && cs) {
    const onScroll = () => { cs.style.display = oc.getBoundingClientRect().bottom < 0 ? 'flex' : 'none'; };
    window.onscroll = onScroll;
    onScroll();
  }
  if (state.settings.pickTimer) {
    const mid = currentManagerId();
    const tw = $('#timewasteBtn');
    if (tw) {
      // one timewaste of +30s (Ben, 14 Aug — was two of +60s, pre test draft)
      const used = state.draft.timewastes?.[mid] || 0;
      tw.disabled = used >= 1 || !canActFor(mid);
      tw.onclick = () => {
        if ((state.draft.timewastes?.[mid] || 0) >= 1) { toast('No timewaste left — play on'); return; }
        if (netOn()) {
          serverAct('draftAdmin', { op: 'timewaste' })
            .then(() => toast(`${managerName(mid)} is timewasting. Taking it to the corner flag.`))
            .catch(() => {});
          return;
        }
        (state.draft.timewastes = state.draft.timewastes || {})[mid] = (state.draft.timewastes[mid] || 0) + 1;
        state.draft.deadline = (state.draft.deadline || Date.now()) + 30 * 1000;
        save(); render();
        toast(`${managerName(mid)} is timewasting. Taking it to the corner flag.`);
      };
    }
    clockTimer = setInterval(() => {
      const el = $('#pickClock');
      const el2 = $('#pickClock2'); // the pinned strip's mirror
      if (!el || state.phase !== 'draft') { clearInterval(clockTimer); return; }
      const bn = pickNo();
      const breakDue = drinksBreakAt(bn) && !(state.draft.breaksDone || []).includes(bn);
      if (state.draft.paused) { el.textContent = 'PAUSED'; el.classList.remove('urgent'); if (el2) el2.textContent = 'PAUSED'; return; }
      if (breakDue || $('#drinksBreak') || $('#ceremony')) return; // clock politely waits for pomp
      if (currentManagerId() == null) {
        // full board still marked draft: the phase flip was lost — ask the
        // server to seal it (clockStart heals) instead of counting a dead clock
        el.textContent = '—'; el.classList.remove('urgent');
        if (el2) el2.textContent = '—';
        armClock();
        return;
      }
      if (!state.draft.deadline) {
        // the start op leaves the deadline null so the ceremony can't eat pick
        // one's clock. The final authenticated ceremony acknowledgement arms
        // it server-side; clockStart below is only the idempotent recovery path.
        const ceremony = draftCeremonyStatus();
        el.textContent = draftRoomOpen() ? '—' : `${ceremony.count}/${ceremony.total}`; el.classList.remove('urgent');
        if (el2) el2.textContent = el.textContent;
        armClock();
        return;
      }
      const { left, overBy, rawLeft } = draftDeadlineTiming(state.draft.deadline);
      el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      el.classList.toggle('urgent', left <= 10);
      if (el2) { el2.textContent = el.textContent; el2.classList.toggle('urgent', left <= 10); }
      if (!state.draft.paused && state.draft.deadline && firedDeadline !== state.draft.deadline) {
        // the commissioner's device fires at 0:00; if his phone slept, the
        // on-clock manager's OWN device fires after an 8s grace. The pick
        // transaction is idempotent, so a double-fire is harmless — this just
        // guarantees the draft never stalls on one sleeping screen.
        // rawLeft (unclamped) is the overdue test: overBy is floored at 0, so
        // "overBy >= 0" is true even mid-countdown and must never gate firing.
        const iAmCommish = !netOn() || isCommissioner();
        const iAmOnClock = netOn() && currentManagerId() === whoami;
        // a due drinks break freezes the room: nobody fires an expiry while
        // the overlay is up — the man on the clock was being timed out UNDER
        // the break, and breakDone re-arms a fresh clock anyway (test draft,
        // 18 Aug: "I think it skipped before the drinks break")
        const breakOn = drinksBreakAt(pickNo()) && !toArr(state.draft.breaksDone).includes(pickNo());
        const mayFire = !breakOn && ((rawLeft <= 0 && iAmCommish) || (overBy >= 8 && iAmOnClock));
        if (mayFire) {
          firedDeadline = state.draft.deadline;
          toast('Time! Autopick makes the call.');
          autoPick(true);
        }
      }
    }, 400);
  }
  const ptl = $('#pickTimerLive');
  if (ptl) ptl.onchange = () => {
    const v = Math.max(0, +ptl.value || 0);
    if (netOn() && !isCommissioner()) { toast('Only the commissioner sets the clock'); return; }
    if (netOn()) {
      // the server writes public/settings/pickTimer; every future pick arms
      // with the new length. The pick already on the clock keeps its deadline.
      serverAct('settingsSet', { key: 'pickTimer', value: v })
        .then(() => toast(`Pick clock is now ${v} seconds — from the next pick.`))
        .catch(() => {});
      return;
    }
    state.settings.pickTimer = v;
    save(); render();
    toast(`Pick clock is now ${v} seconds — from the next pick.`);
  };
  const pb = $('#pauseDraft');
  if (pb) pb.onclick = () => {
    if (netOn() && !isCommissioner()) { toast('Only the commissioner pauses the draft'); return; }
    if (netOn()) {
      serverAct('draftAdmin', { op: state.draft.paused ? 'resume' : 'pause' })
        .then(() => toast(state.draft.paused ? 'Draft resumed. The clock is live.' : 'Draft paused by the commissioner.'))
        .catch(() => {});
      return;
    }
    if (state.draft.paused) {
      state.draft.paused = false;
      if (state.settings.pickTimer) state.draft.deadline = Date.now() + (state.draft.pausedLeft || state.settings.pickTimer * 1000);
      toast('Draft resumed. The clock is live.');
    } else {
      state.draft.paused = true;
      state.draft.pausedLeft = Math.max(5000, (state.draft.deadline || Date.now()) - Date.now());
      toast('Draft paused by the commissioner.');
    }
    save(); render();
  };
  bindPoolControls();
  const fr = $('#forceRoom'); // rendered for the Chairman only, and only while the room waits
  if (fr) fr.onclick = async () => {
    const cer = draftCeremonyStatus();
    // name the managers being marked present (sol test-night P3) — "4 of 12"
    // hides who the Chairman is about to speak for
    const ready = state.draft?.ceremonyReady || {};
    const absent = toArr(state.draft?.order).filter(m => ready[m] !== true).map(m => managerName(m));
    if (!await confirmSheet({
      title: 'Declare the room open?',
      body: `<p style="font-size:13.5px">Only ${cer.count} of ${cer.total} managers are through the ceremony. Opening the room starts pick one now — the absent are treated as arrived, and their clocks autopick from their lists (or best available) when they die.</p><p style="font-size:12.5px"><b>Marked present in absentia:</b> ${esc(absent.join(', ') || 'nobody')}</p><p class="muted" style="font-size:12px">The proper use is a test night, or a real night where someone's phone is in a taxi.</p>`,
      yes: 'Open the room',
    })) return;
    serverAct('draftAdmin', { op: 'roomOpen' })
      .then(() => toast('The Chairman declares the room open. Pick one is live.'))
      .catch(() => {});
  };
  const skd = $('#skipDraft'); // sandbox-only: the Test Night fast-forward
  if (skd) skd.onclick = async () => {
    if (!await confirmSheet({
      title: 'Skip the draft?',
      body: '<p style="font-size:13.5px">Every remaining pick is autodrafted in one stroke — each manager\'s queue first, then best available — and the league goes straight to the season. Sandbox only; the real league will never have this button.</p>',
      yes: 'Autodraft the lot',
    })) return;
    if (netOn()) {
      serverAct('draftAdmin', { op: 'autoComplete' })
        .then(r => toast(`${r.added} picks autodrafted. The Committee has ratified the instant minutes.`))
        .catch(() => {});
      return;
    }
    let guard = state.managers.length * SQUAD_RULES.size + 1;
    let onClock;
    while ((onClock = currentManagerId()) != null && guard-- > 0) {
      const taken = draftedIds();
      let best = toArr(state.autolists?.[onClock]).map(id => PLAYER_BY_ID[id])
        .find(p => p && !taken.has(p.id) && canPick(onClock, p));
      if (!best) best = PLAYERS.filter(p => !taken.has(p.id) && canPick(onClock, p))
        .sort((a, b) => rating(b) - rating(a))[0];
      if (!best) break;
      state.draft.picks.push({ managerId: onClock, playerId: best.id, code: best.code ?? null, n: state.draft.picks.length + 1 });
    }
    state.phase = 'season';
    state.draft.deadline = null;
    state.view = 'dash';
    toast('Board filled. The Committee has ratified the instant minutes.');
    save(); render();
  };
  const up = $('#undoPick'); // rendered for the Chairman only (Marc, mock night)
  if (up) up.onclick = () => {
    if (netOn() && !isCommissioner()) { toast('Only the commissioner can undo a pick'); return; }
    if (netOn()) { serverAct('draftAdmin', { op: 'undo', expectedCount: state.draft.picks.length }).catch(() => {}); return; }
    state.draft.picks.pop();
    if (state.phase === 'season') state.phase = 'draft'; // the final pick flipped it; undo reopens the board
    if (state.settings.pickTimer) state.draft.deadline = Date.now() + state.settings.pickTimer * 1000;
    save(); render();
  };
  const hk = $('#heckleBtn');
  if (hk) hk.onclick = () => {
    if (netOn() && (!whoami || whoami === -1)) { toast('Sign in to heckle. Rules are rules.'); return; }
    heckleSheet();
  };
  document.querySelectorAll('[data-sqtab]').forEach(b => b.onclick = () => { draftSquadTab = b.dataset.sqtab; render(); });
  document.querySelectorAll('#sqAnyone').forEach(s => s.onchange = () => { draftSquadTab = +s.value || 'clock'; render(); });
  document.querySelectorAll('[data-allboards]').forEach(b => b.onclick = allBoardsSheet);
  const sf = $('#squadFab'), sd = $('#squadDrawer');
  if (sf) sf.onclick = () => { window._squadOpen = !window._squadOpen; sd?.classList.toggle('open', window._squadOpen); };
  const sc = $('#squadClose');
  if (sc) sc.onclick = () => { window._squadOpen = false; sd?.classList.remove('open'); };
  const apBtn = $('#autoPick');
  if (apBtn) apBtn.onclick = () => {
    if (!draftRoomOpen()) { toast('Pick one waits for every manager to finish the ceremony.'); return; }
    // strictly the on-clock manager's call — their list, their pick. The
    // Chairman can force it (DF's admin Force Pick) but gets the confirm.
    const mid = currentManagerId();
    if (mid == null) return;
    if (!canActFor(mid)) { toast(`It's ${managerName(mid)}'s pick — the group chat is watching you`); return; }
    if (!actGuard(mid, 'pick')) return;
    autoPick();
  };
}
// pool-controls + queue drawer bindings, shared by the live console and the
// pre-season scouting floor
function bindPoolControls() {
  const q = $('#poolQ');
  q.oninput = () => { poolFilter.q = q.value; poolFilter.limit = 60; refreshPool(); };
  $('#poolTeam').onchange = e => { poolFilter.team = e.target.value; poolFilter.limit = 60; refreshPool(); };
  document.querySelectorAll('[data-poolfpos]').forEach(b => b.onclick = () => {
    const pp = b.dataset.poolfpos, on = poolPosOn();
    poolFilter = { ...poolFilter, pos: on.includes(pp) ? on.filter(x => x !== pp) : [...on, pp], limit: 60 };
    // refreshPool() redraws the table but NOT the controls — restyle the
    // buttons in place or a press gives no visual answer at all (Marc,
    // test draft: "they dont press properly")
    document.querySelectorAll('[data-poolfpos]').forEach(x => {
      const onNow = poolPosOn().includes(x.dataset.poolfpos);
      x.classList.toggle('ghost', !onNow);
      x.setAttribute('aria-pressed', onNow);
    });
    refreshPool();
  });
  const psc = $('#poolScope');
  if (psc) psc.onchange = e => { poolFilter.scope = e.target.value; poolFilter.limit = 60; refreshPool(); };
  bindPoolTable();
  const qf = $('#queueFab'), qd = $('#queueDrawer');
  if (qf) qf.onclick = () => { window._queueOpen = !window._queueOpen; qd?.classList.toggle('open', window._queueOpen); };
  const qc = $('#queueClose');
  if (qc) qc.onclick = () => { window._queueOpen = false; qd?.classList.remove('open'); };
  const dstrip = $('#draftStrip');
  if (dstrip) dstrip.onclick = () => { window._queueOpen = true; qd?.classList.add('open'); };
}
function refreshPool() {
  const card = document.getElementById('poolCard');
  card.querySelector('.pool-wrap')?.remove();
  card.querySelector('.pool-table')?.remove();
  card.querySelector('.show-more')?.remove();
  card.insertAdjacentHTML('beforeend', poolTable());
  bindPoolTable();
  const q = $('#poolQ'); q.focus();
  q.setSelectionRange(q.value.length, q.value.length);
}
function bindPoolTable() {
  bindScoutDesk('draft', refreshPool);
  document.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => {
    const pid = +b.dataset.pick, mid = currentManagerId(), p = PLAYER_BY_ID[pid];
    if (!draftRoomOpen()) { toast('Pick one is locked until every manager is through the ceremony.'); return; }
    // explain, don't dead-tap: a disabled-looking button now says why (tooltips
    // don't exist on touch — the #1 "it's broken" generator on phones)
    if (!canActFor(mid)) { toast(`${managerName(mid)} is on the clock — not you.`); return; }
    if (!canPick(mid, p)) { toast(`Can't fit another ${p.pos} — your squad's full at that position.`); return; }
    // one confirm before an instant, commissioner-only-undo pick (rows shift as
    // other picks land, so a mis-tap is easy)
    if (!await confirmSheet({
      title: `Pick #${pickNo() + 1}`,
      body: dealRows([], [p]),
      yes: `Draft ${esc(p.name)}`,
      note: 'Instant — and only the Chairman can undo it.',
    })) return;
    makePick(pid);
  });
  document.querySelectorAll('[data-auto]').forEach(b => b.onclick = () => {
    if (!whoami || whoami === -1) { toast('Sign in (top right) to build your autopick list'); return; }
    const pid = +b.dataset.auto;
    const list = toArr(state.autolists?.[whoami]);
    if (list.includes(pid)) { setAutolist(whoami, list.filter(x => x !== pid)); toast(`${PLAYER_BY_ID[pid].name} off the list.`); return; }
    setAutolist(whoami, [...list, pid]);
    toast(`${PLAYER_BY_ID[pid].name} added to your autopick list`);
  });
  document.querySelectorAll('[data-autodel]').forEach(b => b.onclick = () => {
    const arr = [...toArr(state.autolists?.[whoami])]; arr.splice(+b.dataset.autodel, 1); setAutolist(whoami, arr);
  });
  /* Up and down step to the previous/next VISIBLE row, not blindly one place.
     Unfiltered those are the same thing; filtered to strikers they are not —
     nudging one place would swap him with a hidden midfielder and look like
     the button did nothing (Marc's "reorder just my strikers"). */
  document.querySelectorAll('[data-autoup]').forEach(b => b.onclick = () => {
    const k = +b.dataset.autoup, vis = visibleAutoIdx(), i = vis.indexOf(k);
    if (i > 0) moveAuto(k, vis[i - 1]);
  });
  document.querySelectorAll('[data-autodown]').forEach(b => b.onclick = () => {
    const k = +b.dataset.autodown, vis = visibleAutoIdx(), i = vis.indexOf(k);
    if (i >= 0 && i < vis.length - 1) moveAuto(k, vis[i + 1]);
  });
  // type a number: "I want Joao Pedro 4th and it pushes everyone else down"
  document.querySelectorAll('[data-autorank]').forEach(inp => {
    const commit = () => {
      const want = Math.round(Number(inp.value));
      if (!Number.isFinite(want)) { render(); return; }
      moveAuto(+inp.dataset.autorank, want - 1);
    };
    inp.onchange = commit;
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
  });
  document.querySelectorAll('[data-autofpos]').forEach(b => b.onclick = () => {
    const pp = b.dataset.autofpos, on = autoPosOn();
    autoFilter = { ...autoFilter, pos: on.includes(pp) ? on.filter(x => x !== pp) : [...on, pp] };
    render();
  });
  document.querySelectorAll('[data-autofclub]').forEach(s => s.onchange = () => {
    autoFilter = { ...autoFilter, club: s.value }; render();
  });
  document.querySelectorAll('[data-autofgone]').forEach(b => b.onclick = () => {
    autoFilter = { ...autoFilter, hideGone: !autoFilter.hideGone }; render();
  });
  // Clear resets pos/club only — hiding drafted men is a default, not a filter
  // someone chose, so Clear must not resurrect forty crossed-out rows
  document.querySelectorAll('[data-autofclear]').forEach(b => b.onclick = () => {
    autoFilter = { ...autoFilter, pos: [], club: '' }; render();
  });
  document.querySelectorAll('[data-sort]').forEach(th => th.onclick = () => { poolFilter.sort = th.dataset.sort; refreshPool(); });
  bindColToggle(refreshPool);
  bindColOrder(refreshPool);
  bindQueueDnD();
  const sm = $('#showMore');
  if (sm) sm.onclick = () => { poolFilter.limit += 100; refreshPool(); };
  // "might be good to have a show all at the bottom too" (Ben, draft eve) —
  // same pair the transfer history already offers
  const sa = $('#showAll');
  if (sa) sa.onclick = () => { poolFilter.limit = Infinity; refreshPool(); };
}

/* drag & drop: drag a pool row into the queue card to add (drop on a row to
   insert there), drag queue rows to reorder. The star and arrow buttons stay
   as the phone path — HTML5 DnD is a laptop luxury, and draft night is
   laptops. Property-assigned handlers so re-binding on refresh is idempotent. */
function bindQueueDnD() {
  if (!whoami || whoami === -1) return;
  document.querySelectorAll('tr[data-drag]').forEach(tr => {
    tr.ondragstart = e => {
      e.dataTransfer.setData('text/plain', `pool:${tr.dataset.drag}`);
      e.dataTransfer.effectAllowed = 'copy';
    };
  });
  document.querySelectorAll('[data-qdrag]').forEach(row => {
    row.ondragstart = e => {
      e.dataTransfer.setData('text/plain', `queue:${row.dataset.qdrag}`);
      e.dataTransfer.effectAllowed = 'move';
    };
  });
  document.querySelectorAll('.queue-card').forEach(zone => {
    zone.ondragover = e => { e.preventDefault(); zone.classList.add('drop-hot'); };
    zone.ondragleave = () => zone.classList.remove('drop-hot');
    zone.ondrop = e => {
      e.preventDefault(); zone.classList.remove('drop-hot');
      const d = e.dataTransfer.getData('text/plain');
      if (!d || !whoami || whoami === -1) return;
      const arr = [...toArr(state.autolists?.[whoami])];
      const over = e.target.closest ? e.target.closest('[data-qdrag]') : null;
      let at = arr.length;
      if (over) {
        const r = over.getBoundingClientRect();
        at = +over.dataset.qdrag + (e.clientY > r.top + r.height / 2 ? 1 : 0);
      }
      if (d.startsWith('pool:')) {
        const pid = +d.slice(5);
        if (!PLAYER_BY_ID[pid]) return;
        if (arr.includes(pid)) { toast(`${PLAYER_BY_ID[pid].name} is already on your list`); return; }
        arr.splice(at, 0, pid);
      } else if (d.startsWith('queue:')) {
        const k = +d.slice(6);
        if (!(k >= 0 && k < arr.length) || !Number.isInteger(k)) return;
        const [pid] = arr.splice(k, 1);
        if (at > k) at--;
        arr.splice(at, 0, pid);
      } else return;
      setAutolist(whoami, arr);
    };
  });
}

function viewDraftRecap() {
  return `<div class="card"><h2>The Draft Console &mdash; Draft Archive</h2>
    <p class="muted" style="margin-bottom:12px">All ${totalPicks()} picks are in. The recordings have been sealed.</p>
    <div class="pick-log" style="max-height:none">
    ${state.draft.picks.map(pk => {
      const p = PLAYER_BY_ID[pk.playerId];
      return `<div class="lrow"><span class="muted" style="width:38px">#${pk.n}</span><b style="width:130px">${esc(managerName(pk.managerId))}</b>${flagImg(p.team)} ${pname(p)} <span class="muted">· ${p.pos} · ${esc(p.team)}</span></div>`;
    }).join('')}
    </div></div>`;
}

/* ----- my team (lineups + transfers) ----- */
let teamView = { mid: null, gw: null, transferOut: null, pitchSel: null, showOpp: false };

function viewTeam() {
  if (teamView.mid == null) teamView.mid = (whoami && whoami !== -1) ? whoami : state.managers[0].id;
  // default to the next UNSETTLED gameweek — after a round goes final (real
  // Tuesday or Simulation Chamber), "current" means next week's team sheet
  // (Wilko, UAT night: "it's still defaulting to gameweek 1")
  if (teamView.gw == null) teamView.gw = planningGwIndex();
  const mid = teamView.mid, gw = teamView.gw;
  const squad = squadAt(mid, gw).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos] || rating(b) - rating(a));
  const xi = lineupFor(mid, gw);
  const counts = xiCounts(xi);
  const valid = xiValid(xi);
  // lineups lock at the gameweek deadline, like the real thing
  const locked = !demoMode && gwHasStarted(gw);
  const cur = currentGwIndex();
  const ownedNow = ownedIdsAt(cur);   // ownership is a calendar question
  // ...but "current" in the picker is not. Marc, 27 Aug 2026: "it is clearly
  // wrong because it says current next to gameweek 1" — GW1 was finished and
  // locked, and the tag sat on it because the label read the calendar index
  // while the selection had already moved on. The round you are picking for is
  // the current one, which is what the fixtures page has always said.
  const curLabel = planningGwIndex();

  const countsBar = ['GK', 'DF', 'MF', 'FW'].map(pos => {
    const [lo, hi] = XI_RULES[pos];
    const ok = counts[pos] >= lo && counts[pos] <= hi;
    return `<span class="quota-pill ${ok ? 'full' : 'bad'}">${pos} ${counts[pos]} <span class="muted">(${lo}–${hi})</span></span>`;
  }).join('') + `<span class="quota-pill ${xi.length === 11 ? 'full' : 'bad'}">XI ${xi.length}/11</span>`;

  const notMine = netOn() && whoami && whoami !== -1 && mid !== whoami;
  return `
  ${notMine ? `<div class="card" style="margin-bottom:12px;border-color:var(--accent)"><p style="font-size:13px">&#128065;&#65039; You're looking at <b>${esc(teamName(mid))}</b> — ${esc(managerName(mid))}'s team${isCommissioner() ? '. Commissioner changes require confirmation.' : '. Look, don\'t touch.'} <button class="btn small" id="backToMine" style="margin-left:8px">Back to my team</button></p></div>` : ''}
  <div class="team-controls card">
    <select id="teamMgr" aria-label="Manager">${state.managers.map(m => `<option value="${m.id}" ${m.id === mid ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
    <select id="teamGw" aria-label="Gameweek">${GAMEWEEKS.map((g, i) => `<option value="${i}" ${i === gw ? 'selected' : ''}>GW${g.n} — ${g.label}${i === curLabel ? ' (current)' : ''}${gwStatus(i) === 'final' ? ' ✓' : ''}</option>`).join('')}</select>
    <span class="tag">${locked ? (gwIsOver(gw) ? 'Gameweek finished — locked' : 'Deadline passed — locked') : `Lineup open — locks ${new Date(gwFrom(gw)).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}</span>
    <span class="tag">GW points: <b class="gold">&nbsp;${liveScoreHtml(mid, gw)}</b></span>
    <span class="tag" style="font-weight:400">${lineupStamp(mid, gw)}</span>
    <button class="tag" id="stadiumBtn" style="cursor:pointer" title="Rename your stadium">&#127967; ${esc(stadium(mid))}</button>
    <button class="tag" id="clubBtn" style="cursor:pointer" title="Name, kit, sponsor, gaffer, rival — the club office">${kitSvg(mid, 14)} Club office</button>
    ${gafferChip(mid)}
  </div>
  <div class="card" style="margin-bottom:18px">
    <h2 style="display:flex;align-items:center;gap:10px">The pitch <span class="muted pitch-hint" style="font-weight:400;font-size:12px">tap two players in a line to swap them — left back goes left</span>
      ${(() => {
        const opp = pairingsFor(gw).find(pr => pr.includes(mid));
        return opp ? `<button class="btn ghost small" id="showOpp" style="margin-left:auto">${teamView.showOpp ? 'Hide' : 'Show'} opponent</button>` : '';
      })()}
    </h2>
    ${(() => {
      // Lee: opponent belongs SIDE BY SIDE at the same scale, not a mini
      // pitch in the corner. Their XI renders on a full pitch in one column;
      // your interactive pitch fills the other (the closing tags land after
      // your pitch block below).
      if (!teamView.showOpp) return '';
      const pair = pairingsFor(gw).find(pr => pr.includes(mid));
      if (!pair) return '';
      const oppMid = pair[0] === mid ? pair[1] : pair[0];
      const oxi = lineupFor(oppMid, gw);
      // their arrows too — you want to see the sub that's about to land on the
      // other side of the tie as much as your own (Marc, 24 Aug 2026)
      const oMarks = gwUnderway(gw) ? subMarks(oppMid, gw) : {};
      return `${winProbBar(oppMid, mid, gw, mid)}<div class="duel-grid"><div class="duel-side">
        <h3 style="text-align:center">${kitSvg(oppMid)} ${esc(teamName(oppMid))} <b class="gold">${gwUnderway(gw) ? liveScoreHtml(oppMid, gw) : projectedGwScore(oppMid, gw)}</b></h3>
        ${adStrip(oppMid * 37 + gw, 3, oppMid)}
        <div class="pitch">${['GK', 'DF', 'MF', 'FW'].map(pos => `<div class="pitch-row">${oxi.map(pid => PLAYER_BY_ID[pid]).filter(p => p.pos === pos).map(p => `
          <div class="pitch-chip ${statusClass(p)}" data-pcard="${p.id}" style="cursor:pointer">
            ${kitImg(p.team, p.pos === 'GK')}
            <span class="pitch-name">${esc(p.name)}</span>
            ${!gwUnderway(gw) ? `<span class="pitch-vs">${nextOppHtml(p.team, GAMEWEEKS[gw].n)}</span>` : `<span class="pitch-vs">${gwPlayerPoints(p.id, gw)} pts</span>`}
            ${oMarks[p.id] || ''}
          </div>`).join('') || '<span class="muted" style="font-size:11px">—</span>'}</div>`).join('')}</div>
        <div class="bench-strip">
          <span class="muted" style="font-size:11px;font-weight:700;align-self:center">BENCH</span>
          ${benchFor(oppMid, gw).map((p, bi) => `
            <div class="pitch-chip benched ${statusClass(p)}" data-pcard="${p.id}" style="cursor:pointer" title="${esc(p.name)} — auto-sub priority ${bi + 1}">
              <span class="tag" style="font-size:9px;padding:1px 5px">${bi + 1}</span>
              ${kitImg(p.team, p.pos === 'GK')}
              <span class="pitch-name">${esc(p.name)}</span>
              ${gwUnderway(gw) ? `<span class="mu-pts">${gwPlayerPoints(p.id, gw)}</span>` : `<span class="pitch-vs">${nextOppHtml(p.team, GAMEWEEKS[gw].n)}</span>`}
              ${oMarks[p.id] || ''}
            </div>`).join('') || '<span class="muted" style="font-size:11px">an empty bench</span>'}
        </div>
      </div><div class="duel-side">
        <h3 style="text-align:center">${crestSvg(mid, 15)} ${kitSvg(mid)} ${esc(teamName(mid))} <b class="gold">${gwUnderway(gw) ? liveScoreHtml(mid, gw) : projectedGwScore(mid, gw)}</b></h3>`;
    })()}
    ${(() => {
      // browsing someone else's team: every chip opens the player card.
      // your own team: tapping a player SELECTS him to swap (the primary action
      // on mobile — there's no drag on touch). The little ⓘ opens his stats.
      // someone else's team: the whole chip opens the card (nothing to swap).
      const browsing = !demoMode && whoami && whoami !== -1 && mid !== whoami;
      const chipAttrs = p => browsing ? `data-pcard="${p.id}" style="cursor:pointer"` : `data-pitch="${p.id}" draggable="${!locked}"`;
      // on your own pitch the kit/name carry NO data-pcard, so a tap can't be
      // hijacked into opening the card — it falls through to the swap handler
      const nameSpan = p => `<span class="pitch-name" ${browsing ? '' : ''}>${esc(p.name)}</span>`;
      const pic = p => browsing ? kitImg(p.team, p.pos === 'GK') : kitImg(p.team, p.pos === 'GK');
      const info = p => browsing ? '' : `<span class="pitch-info" data-pcard="${p.id}" title="${esc(p.name)} — stats">&#9432;</span>`;
      // your own arrows: who's coming off, who's coming on, and who for
      const marks = gwUnderway(gw) ? subMarks(mid, gw) : {};
      return `
    ${adStrip(mid * 37 + gw, 3, mid)}
    <div class="pitch">
      ${['GK', 'DF', 'MF', 'FW'].map(pos => `
        <div class="pitch-row">
          ${xi.map(pid => PLAYER_BY_ID[pid]).filter(p => p.pos === pos).map(p => `
            <div class="pitch-chip ${statusClass(p)} ${teamView.pitchSel === p.id ? 'sel' : ''}" ${chipAttrs(p)}>
              ${info(p)}
              ${pic(p)}
              ${nameSpan(p)}
              ${!gwUnderway(gw) ? `<span class="pitch-vs">${nextOppHtml(p.team, GAMEWEEKS[gw].n)}</span>` : `<span class="pitch-vs">${gwPlayerPoints(p.id, gw)} pts</span>`}
              ${marks[p.id] || ''}
            </div>`).join('') || '<span class="muted" style="font-size:11px">—</span>'}
        </div>`).join('')}
    </div>
    <div class="bench-strip">
      <span class="muted" style="font-size:11px;font-weight:700;align-self:center">BENCH</span>
      ${benchFor(mid, gw).map((p, k) => `
        <div class="pitch-chip benched ${statusClass(p)} ${teamView.pitchSel === p.id ? 'sel' : ''}" ${chipAttrs(p)} title="Auto-sub priority ${k + 1} — leftmost comes on first">
          <span class="tag" style="font-size:9px;padding:1px 5px">${k + 1}</span>
          ${info(p)}
          ${pic(p)}
          ${nameSpan(p)}
          ${gwUnderway(gw) ? `<span class="mu-pts">${gwPlayerPoints(p.id, gw)}</span>` : `<span class="pitch-vs">${nextOppHtml(p.team, GAMEWEEKS[gw].n)}</span>`}
          ${marks[p.id] || ''}
        </div>`).join('')}
    </div>`;
    })()}
    ${teamView.showOpp && pairingsFor(gw).find(pr => pr.includes(mid)) ? '</div></div>' : ''}
    <p class="muted" style="font-size:11px;margin-top:6px"><b>Tap two players to swap them.</b> Bench order = auto-sub order, leftmost first. &#9432; for stats.</p>
  </div>
  <div class="draft-layout">
    <div class="card">
      <h2>Starting XI — GW${GAMEWEEKS[gw].n} <span class="muted" style="font-weight:400">(tap to swap)</span></h2>
      <div class="quota-bar">${countsBar}</div>
      ${!valid ? '<p class="warn">Invalid XI — fix the highlighted limits. Scoring uses whoever is listed, but sort it out before kickoff.</p>' : ''}
      ${['GK', 'DF', 'MF', 'FW'].map(pos => `
        <h3>${POS_LABEL[pos]}</h3>
        ${squad.filter(p => p.pos === pos).map(p => {
          const starting = xi.includes(p.id);
          const pts = gwPlayerPoints(p.id, gw);
          return `<div class="squad-row lineup-row ${statusClass(p)} ${starting ? 'starting' : 'benched'}" data-toggle="${p.id}" ${locked ? '' : 'style="cursor:pointer"'}>
            <span class="shirt-no" data-num="${p.id}" title="Click to assign a squad number">${shirtNum(mid, p.id)}</span>
            <span class="pos-badge pos-${p.pos}">${p.pos}</span>${kitImg(p.team, p.pos === 'GK', p)}
            <span><span data-pcard="${p.id}" style="cursor:pointer" title="Tap for stats">${esc(p.name)}</span> ${statusChip(p)}</span>
            <span class="muted" style="font-size:11.5px">${esc(p.club)}</span>
            <span class="sp-pts ${pts > 0 ? 'gold' : 'muted'}">${pts}</span>
            <span class="xi-chip">${starting ? 'XI' : 'bench'}</span>
          </div>`;
        }).join('')}`).join('')}
    </div>
    <div class="draft-side">
      <div class="card">
        <h2>Transfers ${toArr(state.trades).some(t => t.status === 'pending' && t.to === mid) ? '<span class="tag live-tag">OFFER IN</span>' : ''}</h2>
        <p class="muted" style="font-size:12.5px;margin-bottom:10px">The Trough, waivers and the Trade desk live in the <b>Transfers</b> tab.</p>
        <button class="btn small" id="goTransfers">Open Transfers</button>
      </div>
      <div class="card">
        <h2>Form</h2>
        ${(() => {
          const rows = [];
          for (let i = 0; i < REGULAR_GWS; i++) {
            if (gwStatus(i) !== 'final') continue;
            const pr = pairingsFor(i).find(x => x.includes(mid));
            if (!pr) continue;
            const op = pr[0] === mid ? pr[1] : pr[0];
            const pm = gwManagerPoints(mid, i), po = gwManagerPoints(op, i);
            rows.push({ i, op, pm, po, res: pm > po ? 'W' : pm < po ? 'L' : 'D' });
          }
          if (!rows.length) return '<span class="muted" style="font-size:12.5px">No results yet. All to play for.</span>';
          const strip = rows.slice(-8).map(r => `<span class="form-pill form-${r.res}" title="GW${GAMEWEEKS[r.i].n}">${r.res}</span>`).join('');
          const season = rows.reduce((t, r) => t + r.pm, 0);
          // one lone unlabelled pill above a one-line list reads as a glitch —
          // the strip earns its row from the second result (mobile sweep, 25 Aug).
          // The rows are display:flex explicitly: bare .lrow has no flex rule,
          // so justify-content alone was inert and the score jammed the name.
          return (rows.length >= 2 ? `<div style="margin-bottom:10px">${strip}</div>` : '') +
            rows.slice(-6).reverse().map(r => `<div class="lrow" style="font-size:12.5px;display:flex;align-items:center;gap:8px;justify-content:space-between;padding:2px 0"><span><span class="form-pill form-${r.res}">${r.res}</span> GW${GAMEWEEKS[r.i].n} v ${esc(teamName(r.op))}</span><b>${r.pm}&ndash;${r.po}</b></div>`).join('') +
            `<p class="muted" style="font-size:11.5px;margin-top:8px">Season points: <b style="color:var(--text)">${managerPoints(mid)}</b> &middot; H2H scoring: ${season}</p>`;
        })()}
      </div>
    </div>
  </div>
  ${assistantCard(mid, gw)}
  ${nextSixCard(mid)}`;
}

/* ----- The Assistant Manager (Marc, UAT night: "recommend the team selection
   or trough/waiver players — should I start Liam Delap or Haji Wright").
   A number-cruncher on the same projections as the Crystal Ball, spoken like
   a lower-league No. 2. Deterministic — NOT a chatbot (that's on the
   Committee's wishlist and needs a server + a budget). ----- */
function assistantGwProj(p, gwIdx) {
  const gwN = GAMEWEEKS[gwIdx]?.n;
  if (!gwN || !state.fixtures?.length) return 0;
  const games = state.fixtures.filter(f => f.gw === gwN && (f.home === p.team || f.away === p.team)).length;
  return games * playerXp(p);
}
function assistantCard(mid, gw) {
  if (state.phase !== 'season') return '';
  const signedOut = netOn() && !demoMode && (!whoami || whoami === -1);
  const notMine = netOn() && !demoMode && !signedOut && whoami !== mid;
  if (notMine) return ''; // he works for YOU; other clubs have their own staff
  const asst = assistantFor(mid);
  const head = body => `<div class="card assistant-card">
    <div class="assistant-pop" aria-hidden="true"><span class="assistant-person">&#129489;&#8205;&#128188;</span><small>${asst.e}</small></div>
    <div class="assistant-copy"><h2>${esc(asst.t)} <span class="tag" title="${esc(asst.bio)}">assistant manager${gafferFor(mid) ? ` — No. 2 to ${esc(gafferFor(mid).t)}` : ''}</span></h2>${body}</div>
  </div>`;
  if (signedOut) {
    return head(`<p class="muted" style="font-size:12.5px;opacity:.75">He has opinions on the XI and the Trough, but he only briefs his own manager. Sign in (top right) and he's yours.</p>`);
  }
  // advise the first gameweek that hasn't kicked off yet, from the one being viewed
  let ai = gw;
  while (ai < REGULAR_GWS - 1 && gwHasStarted(ai)) ai++;
  const gwN = GAMEWEEKS[ai].n;
  const xi = lineupFor(mid, ai);
  const xiSet = new Set(xi);
  const squad = squadAt(mid, ai);
  const starters = squad.filter(p => xiSet.has(p.id));
  const bench = squad.filter(p => !xiSet.has(p.id));
  const proj = p => assistantGwProj(p, ai);
  const lines = [];
  // 1. no-fixture starters — the one mistake he will not forgive
  for (const s of starters) {
    if (proj(s) === 0) lines.push(`<b>${pname(s)} has no fixture in GW${gwN}.</b> He cannot score from the sofa. Get him out of the XI.`);
  }
  // 2. fitness doubts in the XI
  for (const s of starters) {
    if (s.status === 'i' || s.status === 's' || s.status === 'u') {
      lines.push(`${pname(s)} is ${s.status === 's' ? 'suspended' : 'flagged'} — ${esc(s.news || 'no details from the club')}. I'd have a plan B warmed up.`);
    }
  }
  // 3. straight positional swaps the numbers back (Delap-or-Wright answered)
  const swaps = [];
  for (const b of bench) {
    if (b.status === 'i' || b.status === 's' || b.status === 'u') continue;
    const rivals = starters.filter(s => s.pos === b.pos && !swaps.some(x => x.out === s.id));
    if (!rivals.length) continue;
    const weakest = rivals.reduce((a, s) => proj(s) < proj(a) ? s : a);
    if (proj(b) > proj(weakest) + 0.5) swaps.push({ in: b, out: weakest, pi: proj(b), po: proj(weakest), outId: weakest.id });
  }
  swaps.sort((a, b) => (b.pi - b.po) - (a.pi - a.po));
  for (const s of swaps.slice(0, 3)) {
    lines.push(`I'd start ${pname(s.in)} over ${pname(s.out)} — projects <b>${s.pi.toFixed(1)}</b> against <b>${s.po.toFixed(1)}</b> this week${s.pi > s.po * 2 && s.po > 0 ? '. Not close, gaffer' : ''}.`);
  }
  // 4. the shopping list: free agents who out-project the weakest of ours
  const owned = ownedIdsAt(currentGwIndex());
  const tips = [];
  for (const p of PLAYERS) {
    if (owned.has(p.id) || arrivalLocked(p) || p.status === 'i' || p.status === 's' || p.status === 'u') continue;
    const mine = squad.filter(x => x.pos === p.pos);
    if (!mine.length) continue;
    const weakest = mine.reduce((a, x) => projPts(x, 3) < projPts(a, 3) ? x : a);
    const gain = projPts(p, 3) - projPts(weakest, 3);
    if (gain > 1) tips.push({ p, weakest, gain });
  }
  tips.sort((a, b) => b.gain - a.gain);
  const tipRows = tips.slice(0, 3).map(t =>
    `<div class="lrow" style="font-size:12.5px">${pname(t.p)} <span class="muted">(${t.p.pos}, ${esc(t.p.team)})</span> &mdash; projects <b>+${t.gain.toFixed(1)}</b> over ${pname(t.weakest)} across three weeks. ${onWaivers(t.p) ? 'On waivers — worth putting a waiver in.' : 'Free in the Trough. I’d move.'}</div>`).join('');
  const brief = lines.length
    ? lines.map(l => `<div class="lrow" style="font-size:12.5px">${l}</div>`).join('')
    : `<p class="muted" style="font-size:12.5px">The XI picks itself for GW${gwN}. I've nothing, gaffer. Good session though.</p>`;
  return head(`
    <p class="muted" style="font-size:11.5px;margin-bottom:6px">Briefing for GW${gwN}. Same numbers as the Crystal Ball — projections, not prophecy.</p>
    ${brief}
    ${tipRows ? `<h3 style="margin-top:10px">The shopping list</h3>${tipRows}` : ''}`);
}

/* ----- Next Six: the current squad's fixture runway. Deliberately small —
   no planning state, no hypotheticals, no crystal ball. Reads the calendar
   through teamFixturesInGw like everything else. ----- */
const NEXT6_KEY = `${LS_NS}-next6-open`;
const DASHMU_KEY = `${LS_NS}-dashmu-open`; // the dashboard's two lineup shots
function nextSixCard(mid) {
  // the runway is a PLANNING surface on My Team, so it rolls with My Team —
  // at settlement, past every finished round (Ian, 25 Aug: the table still
  // opened on played GW1 and showed his pre-waiver squad). squadAt at the
  // upcoming round also carries the window's signings the moment they land.
  let cur = currentGwIndex();
  while (cur < GAMEWEEKS.length - 1 && gwStatus(cur) === 'final') cur++;
  const gws = GAMEWEEKS.slice(cur, cur + 6);
  const squad = squadAt(mid, cur).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos] || rating(b) - rating(a));
  if (!gws.length || !squad.length || !state.fixtures.length) return '';
  const saved = localStorage.getItem(NEXT6_KEY);
  const open = saved != null ? saved === '1' : !window.matchMedia('(max-width: 700px)').matches;
  const cell = (p, g) => {
    const fx = teamFixturesInGw(p.team, g.n);
    if (!fx.length) return '<td class="num n6-blank" title="No fixture — a blank">&mdash;</td>';
    return `<td class="num${fx.length > 1 ? ' n6-double' : ''}">${fx.map(f => {
      const home = f.home === p.team;
      const opp = home ? f.away : f.home;
      return `<span class="n6-fx ${fdrCls(opp)}">${esc(TEAM_BY_NAME[opp]?.short || opp)} (${home ? 'H' : 'A'})</span>`;
    }).join('')}</td>`;
  };
  return `<div class="card" style="margin-top:14px">
    <details id="next6"${open ? ' open' : ''}>
      <summary class="n6-summary"><h2 style="display:inline;margin:0">Next Six <span class="muted" style="font-weight:400;font-size:12px">the current squad's fixture runway — not a transfer planner</span></h2></summary>
      <div style="overflow-x:auto">
      <table class="pool-table n6-table">
        <thead><tr><th class="n6-name">Player</th>${gws.map(g => `<th class="num">GW${g.n}</th>`).join('')}</tr></thead>
        <tbody>${squad.map(p => `<tr>
          <td class="n6-name"><span class="pos-badge pos-${p.pos}">${p.pos}</span> <span class="plink" data-pcard="${p.id}">${esc(p.name)}</span> ${statusChip(p)}</td>
          ${gws.map(g => cell(p, g)).join('')}
        </tr>`).join('')}</tbody>
      </table>
      </div>
      <p class="muted" style="font-size:11px;margin-top:6px">This is the squad as it stands — signings change it. &mdash; is a blank, two chips is a double, colours are the usual fixture tints. Tap a name for stats.</p>
    </details>
  </div>`;
}

function bindTeam() {
  const n6 = $('#next6');
  if (n6) n6.ontoggle = () => localStorage.setItem(NEXT6_KEY, n6.open ? '1' : '0');
  $('#teamMgr').onchange = e => { teamView.mid = +e.target.value; teamView.transferOut = null; render(); };
  const btm = $('#backToMine');
  if (btm) btm.onclick = () => { teamView.mid = whoami; teamView.transferOut = null; render(); };
  $('#teamGw').onchange = e => { teamView.gw = +e.target.value; render(); };
  const gw = teamView.gw, mid = teamView.mid;
  if (demoMode || !gwHasStarted(gw)) {
    document.querySelectorAll('[data-toggle]').forEach(row => row.onclick = () => {
      if (!actGuard(mid, 'lineup')) return;
      const pid = +row.dataset.toggle;
      const xi = [...lineupFor(mid, gw)];
      const i = xi.indexOf(pid);
      if (i >= 0) {
        // don't let a removal drop you below a position minimum
        const pos = PLAYER_BY_ID[pid].pos;
        if (xiCounts(xi)[pos] <= XI_RULES[pos][0]) { toast(`You need at least ${XI_RULES[pos][0]} ${pos} in your XI`); return; }
        xi.splice(i, 1);
      } else {
        if (xi.length >= 11) { toast('XI is full — bench someone first'); return; }
        const pos = PLAYER_BY_ID[pid].pos;
        if (xiCounts(xi)[pos] >= XI_RULES[pos][1]) { toast(`Max ${XI_RULES[pos][1]} ${pos} in the XI — the shape won't allow it`); return; }
        xi.push(pid);
      }
      saveLineup(mid, gw, xi);
      save(); render();
      toast(`Lineup saved — nothing else needed before ${fmtWhen(gwFrom(gw))}.${gwHasStarted(gw) ? ' (This gameweek is already locked though.)' : ''}`);
    });
  }
  const so = $('#showOpp');
  if (so) so.onclick = () => { teamView.showOpp = !teamView.showOpp; render(); };
  // --- stadium naming ---
  const cb = $('#clubBtn');
  if (cb) cb.onclick = () => { state.view = 'club'; save(); render(); };
  const sb2 = $('#stadiumBtn');
  if (sb2) sb2.onclick = () => {
    if (!actGuard(mid, 'stadium')) return;
    const v = prompt(`Name ${teamName(mid)}'s stadium:`, stadium(mid));
    if (v == null || !v.trim()) return;
    if (netOn()) {
      serverAct('stadiumSet', { name: v.trim().slice(0, 40), ...(mid !== whoami && { asManager: mid }) })
        .then(() => toast(`${v.trim()} — naming rights sold for nothing.`)).catch(() => {});
      return;
    }
    const idx = state.managers.findIndex(m => m.id === mid);
    state.managers[idx].stadium = v.trim().slice(0, 40);
    save(); render();
    toast(`${v.trim()} — naming rights sold for nothing.`);
  };
  // --- the pitch: swap two players (tap-tap or drag-drop) ---
  const pitchSwap = (pidA, pidB) => {
    if (pidA === pidB) return;
    const a = PLAYER_BY_ID[pidA], b = PLAYER_BY_ID[pidB];
    const xi2 = [...lineupFor(mid, gw)];
    const ia = xi2.indexOf(pidA), ib = xi2.indexOf(pidB);
    if (ia >= 0 && ib >= 0) {
      // both on the pitch: arrange within a line
      if (a.pos !== b.pos) { toast(`Same line only — ${a.name} is a ${a.pos}, ${b.name} is a ${b.pos}`); return; }
      [xi2[ia], xi2[ib]] = [xi2[ib], xi2[ia]];
    } else if (ia >= 0 || ib >= 0) {
      // substitution: pitch player off, bench player on
      const inIdx = ia >= 0 ? ia : ib;
      const onPid = ia >= 0 ? pidA : pidB, offPid = ia >= 0 ? pidB : pidA;
      const trial = [...xi2];
      trial[inIdx] = offPid;
      if (!xiValid(trial)) { toast('That substitution breaks the XI shape (1 GK, 3–5 DF, 2–5 MF, 1–3 FW)'); return; }
      xi2[inIdx] = offPid;
      // the departing starter inherits the incoming sub's bench slot
      setBenchOrder(mid, gw, benchFor(mid, gw).map(p => p.id === offPid ? onPid : p.id));
    } else {
      // two bench players: swap their auto-sub priority
      const bo = benchFor(mid, gw).map(p => p.id);
      const ka = bo.indexOf(pidA), kb = bo.indexOf(pidB);
      if (ka < 0 || kb < 0) return;
      [bo[ka], bo[kb]] = [bo[kb], bo[ka]];
      setBenchOrder(mid, gw, bo);
      teamView.pitchSel = null;
      save(); render();
      return;
    }
    saveLineup(mid, gw, xi2);
    teamView.pitchSel = null;
    save(); render();
    toast(`Lineup saved — nothing else needed before ${fmtWhen(gwFrom(gw))}.${gwHasStarted(gw) ? ' (This gameweek is already locked though.)' : ''}`);
  };
  const pitchGuard = () => {
    if (!demoMode && gwHasStarted(gw)) { toast('Lineup is locked for this gameweek'); return false; }
    return actGuard(mid, 'lineup');
  };
  let dragPid = null;
  document.querySelectorAll('[data-pitch]').forEach(chip => {
    chip.onclick = () => {
      if (!pitchGuard()) return;
      const pid = +chip.dataset.pitch;
      if (teamView.pitchSel == null) { teamView.pitchSel = pid; render(); return; }
      if (teamView.pitchSel === pid) { teamView.pitchSel = null; render(); return; }
      pitchSwap(teamView.pitchSel, pid);
    };
    chip.ondragstart = e => {
      if (!pitchGuard()) { e.preventDefault(); return; }
      dragPid = +chip.dataset.pitch;
      e.dataTransfer.effectAllowed = 'move';
    };
    chip.ondragover = e => { e.preventDefault(); chip.classList.add('dragover'); };
    chip.ondragleave = () => chip.classList.remove('dragover');
    chip.ondrop = e => {
      e.preventDefault();
      chip.classList.remove('dragover');
      if (dragPid != null) pitchSwap(dragPid, +chip.dataset.pitch);
      dragPid = null;
    };
  });
  // --- custom squad numbers ---
  document.querySelectorAll('[data-num]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    if (!actGuard(mid, 'squad numbers')) return;
    const pid = +el.dataset.num;
    const v = prompt(`Squad number for ${PLAYER_BY_ID[pid].name} (1–99):`, shirtNum(mid, pid));
    if (v == null) return;
    const n = Math.round(+v);
    if (!n || n < 1 || n > 99) { toast('Numbers 1–99 only'); return; }
    // clash-check the squad AS IT STANDS, matching the server — the played
    // round's squad missed fresh signings' numbers (Ian, 25 Aug)
    const clash = managerSquad(mid).find(x => x.id !== pid && +shirtNum(mid, x.id) === n);
    if (clash) { toast(`${n} is taken by ${clash.name}`); return; }
    if (netOn()) {
      serverAct('shirtNumSet', { pid, num: n, ...(mid !== whoami && { asManager: mid }) })
        .then(() => toast(`${PLAYER_BY_ID[pid].name} takes the number ${n} shirt`)).catch(() => {});
      return;
    }
    (state.shirtNums[mid] = state.shirtNums[mid] || {})[pid] = n;
    save(); render();
    toast(`${PLAYER_BY_ID[pid].name} takes the number ${n} shirt`);
  });  const gt = $('#goTransfers');
  if (gt) gt.onclick = () => { state.view = 'transfers'; save(); render(); };
}

/* ---------------- the Transfers hub (Draft Fantasy layout) ---------------- */
let transfersView = { tab: 'trough', out: null, pos: [], club: '', scope: 'avail', sort: 'pts', limit: 20, blockPick: false, as: null, histKind: '', histPage: 0 };
// position filter is a SET like the draft pool's (Ben, 25 Aug: "midfield and
// forward... at the same time") — empty means All. Tolerates the old string.
const trPosOn = () => Array.isArray(transfersView.pos) ? transfersView.pos : (transfersView.pos ? [transfersView.pos] : []);
// the whole hub acts as ONE manager. Normally that's you; the Chairman may
// take any chair (the switcher in the hub header) — every action downstream
// already carries asManager when mid !== whoami, so the server records the
// move as theirs. Built so Toby can test waivers/trades solo on the sandbox.
function hubActor() {
  // SANDBOX only (sol test-night P1/P2): on the real league the Chairman
  // keeps the old per-action override confirm, never a standing pen
  if (SANDBOX && transfersView.as != null && isCommissioner() && state.managers.some(m => m.id === transfersView.as)) return transfersView.as;
  return (whoami && whoami !== -1) ? whoami : state.managers[0].id;
}
function viewTransfers() {
  const mid = hubActor();
  const cur = currentGwIndex();
  const ownedNow = ownedIdsAt(cur);
  // the waiver list gets Ian's green box (25 Aug: his list was 30 deep and
  // shopping meant scrolling past it both ways) — own tab, canon name
  const tabs = [['trough', 'The Trough & Waivers'], ['claims', 'Waiver list'], ['trades', 'Trade desk'], ['history', 'History'], ['order', 'Waiver order']];
  const tab = transfersView.tab;
  const pendingIn = toArr(state.trades).filter(t => t.status === 'pending' && t.to === mid).length;
  const nClaims = myClaims(mid).length;
  // ONE lens statement for the whole hub (sol product review #2): every deal
  // on these pages — signings, claims, trades, window picks — lands in the
  // same gameweek, and the pages say so out loud
  const tgwHub = transferGw();
  const head = `<div class="team-controls card">
    ${tabs.map(([id, label]) => `<button class="btn small ${tab === id ? '' : 'ghost'}" data-trtab="${id}">${label}${id === 'trades' && pendingIn ? ` <span class="tag live-tag">${pendingIn}</span>` : ''}${id === 'claims' && nClaims ? ` <span class="tag">${nClaims}</span>` : ''}</button>`).join('')}
    ${SANDBOX && netOn() && isCommissioner() ? `<label class="tag" style="margin-left:auto">acting as&nbsp;<select id="actAsSel" style="font-size:11.5px">${state.managers.map(m => `<option value="${m.id}" ${m.id === mid ? 'selected' : ''}>${esc(managerName(m.id))}${m.id === whoami ? ' (me)' : ''}</option>`).join('')}</select></label>`
      : `<span class="tag" style="margin-left:auto">acting as ${esc(managerName(mid))}</span>`}
    <span class="tag" title="Squads and ownership on these pages are shown as of this gameweek — no deal ever rewrites a week already being played">deals land in <b>&nbsp;GW${GAMEWEEKS[tgwHub].n}</b>${tgwHub !== cur ? ' &middot; this round is in play' : ''}</span>
  </div>
  ${netOn() && whoami && whoami !== mid ? `<p class="tag live-tag" style="display:inline-block;margin-bottom:8px">ACTING AS ${esc(teamName(mid))} — every signing, waiver and trade on this page is theirs, not yours</p>` : ''}`;
  // your own squad, always in view while you deal (Ben, mock night: "i dont
  // like that you cant see your team on the transfer page")
  const mySquadCard = (() => {
    if (netOn() && (!whoami || whoami === -1)) return '';
    // the squad AT THE LANDING GAMEWEEK — mid-mock, a player traded in for
    // next week is already yours to deal (Toby: "I don't own Vicario!")
    const sq = squadAt(mid, transferGw()).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos]);
    if (!sq.length) return '';
    // the fixture, not last season's points (Marc, 9 Aug: "it should always
    // just say the fixture there on the transfer screen") — you deal on who
    // they play next, and pre-GW1 the pts read as this season's
    const tgwN = GAMEWEEKS[transferGw()].n;
    return `<details class="card" style="margin-bottom:14px" ${window._trSquadOpen ? 'open' : ''} id="trMySquad">
      <summary style="cursor:pointer;font-weight:800">&#128101; ${esc(teamName(mid))} — my squad <span class="tag">${sq.length}</span> <span class="muted" style="font-weight:400;font-size:11.5px">tap to ${window._trSquadOpen ? 'hide' : 'view'}</span></summary>
      <div class="quota-bar" style="margin:8px 0 4px">${quotaPills(mid)}</div>
      <div class="side-squad">${sq.map(p => `
        <div class="srow"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${kitImg(p.team, p.pos === 'GK', p)}${pname(p)}<span class="muted" style="margin-left:auto;font-size:11px">${nextOppHtml(p.team, tgwN)}</span></div>`).join('')}
      </div>
    </details>`;
  })();
  // trough tab: the squad as a pitch, not a list — tap the man who makes way
  // (Ben: "you should see your squad as a lineup pitch style rather than list")
  const myPitchCard = (() => {
    if (netOn() && (!whoami || whoami === -1)) return '';
    // ONE lens for the whole card: the landing gameweek. Mixing it (tgw squad,
    // current-week XI/bench) left Wilko's outgoing Wharton on this pitch while
    // My Team already showed Schade (UAT night, 23:19).
    const tgw = transferGw();
    const sq = squadAt(mid, tgw);
    if (!sq.length) return '';
    // a proper lineup page (Ben, UAT night): the selected XI in its real
    // formation, the subs on a numbered bench strip below — same shape as My
    // Team. Every chip is still a tap-to-put-him-up target.
    const xi = new Set(lineupFor(mid, tgw));
    const starters = sq.filter(p => xi.has(p.id));
    const chip = p => `
          <div class="pitch-chip ${statusClass(p)} ${transfersView.out === p.id ? 'sel' : ''}" data-trout="${p.id}" title="${esc(p.name)} — ${transfersView.out === p.id ? 'tap to keep him' : 'tap to put him up'}">
            ${kitImg(p.team, p.pos === 'GK')}
            <span class="pitch-name">${esc(p.name)}</span>
            <span class="pitch-vs">${nextOppHtml(p.team, GAMEWEEKS[tgw].n)}</span>
          </div>`;
    // phones: the pitch ate the whole first screen and buried the actual
    // Trough below the fold (Ben, GW1 eve: "the trough for mobile view needs
    // a bit of optimizing") — compact rows, same taps, half the height
    if (matchMedia('(max-width: 700px)').matches) {
      const row = (p, tag = '') => `
        <div class="srow trout-row ${statusClass(p)} ${transfersView.out === p.id ? 'sel' : ''}" data-trout="${p.id}" title="${esc(p.name)} — ${transfersView.out === p.id ? 'tap to keep him' : 'tap to put him up'}">
          ${tag}<span class="pos-badge pos-${p.pos}">${p.pos}</span>${kitImg(p.team, p.pos === 'GK', p)}<span>${esc(p.name)}</span>
          <span class="muted" style="margin-left:auto;font-size:11px">${nextOppHtml(p.team, GAMEWEEKS[tgw].n)}</span>
        </div>`;
      return `<div class="card" style="margin-bottom:14px">
        <h2>&#128101; ${esc(teamName(mid))} <span class="muted" style="font-weight:400;font-size:12px">tap the player who makes way</span></h2>
        <div class="quota-bar" style="margin:2px 0 8px">${quotaPills(mid)}</div>
        <div class="side-squad">
          ${['GK', 'DF', 'MF', 'FW'].map(pos => starters.filter(p => p.pos === pos).map(p => row(p)).join('')).join('')}
          ${benchFor(mid, tgw).map((p, bi) => row(p, `<span class="tag" style="font-size:9px;padding:1px 5px">B${bi + 1}</span>`)).join('')}
        </div>
      </div>`;
    }
    return `<div class="card" style="margin-bottom:14px">
      <h2>&#128101; ${esc(teamName(mid))} <span class="muted" style="font-weight:400;font-size:12px">tap the player who makes way</span></h2>
      <div class="quota-bar" style="margin:2px 0 8px">${quotaPills(mid)}</div>
      <div class="pitch mu-pitch">
        ${['GK', 'DF', 'MF', 'FW'].map(pos => {
          const row = starters.filter(p => p.pos === pos);
          return row.length ? `<div class="pitch-row">${row.map(chip).join('')}</div>` : '';
        }).join('')}
      </div>
      <div class="bench-strip">
        <span class="muted" style="font-size:11px;font-weight:700;align-self:center">BENCH</span>
        ${benchFor(mid, tgw).map((p, bi) => `
          <div class="pitch-chip benched ${statusClass(p)} ${transfersView.out === p.id ? 'sel' : ''}" data-trout="${p.id}" title="${esc(p.name)} — ${transfersView.out === p.id ? 'tap to keep him' : 'tap to put him up'}">
            <span class="tag" style="font-size:9px;padding:1px 5px">${bi + 1}</span>
            ${kitImg(p.team, p.pos === 'GK')}
            <span class="pitch-name">${esc(p.name)}</span>
          </div>`).join('') || '<span class="muted" style="font-size:11px">an empty bench</span>'}
      </div>
    </div>`;
  })();
  if (tab === 'trough') {
    const wd = state.windowDraft;
    const arrivals = lockedArrivals();
    let wdCard = '';
    if (wd?.status === 'live') {
      const actor = wdActor();
      const ord = wd.order;
      const lap = Math.floor(wd.turn / ord.length);
      const lapOrd = lap % 2 ? [...ord].reverse() : ord;
      wdCard = `<div class="card" style="margin-bottom:14px">
        <h2>The Window Draft <span class="tag live-tag"><span class="rec"></span>LIVE</span> <span class="muted" style="font-weight:400;font-size:12px">new arrivals only &middot; snakes backwards from the last pick &middot; a full lap of passes ends it</span></h2>
        <div class="order-strip" style="margin:8px 0">${lapOrd.map(id => `<span class="order-chip ${id === actor ? 'now' : ''}">${esc(managerName(id))}</span>`).join('<span class="muted" style="align-self:center">›</span>')}<span class="tag" style="margin-left:10px">Lap ${lap + 1}${lap % 2 ? ' (reversed)' : ''}</span></div>
        <p style="font-size:13px"><b>${esc(managerName(actor))}</b> is on the clock. Sign one of the new arrivals (someone goes out), or pass.</p>
        ${canActFor(actor) && whoami && whoami !== actor ? `<p class="tag live-tag" style="display:inline-block">ACTING AS ${esc(teamName(actor))} — every move here is theirs, not yours</p>` : ''}
        ${canActFor(actor) ? `
        <select id="wdOut" style="width:100%;max-width:420px;margin:8px 0;display:block">
          <option value="">Player out…</option>
          ${squadAt(actor, transferGw()).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos]).map(pp => `<option value="${pp.id}">${pp.pos} — ${esc(pp.name)} (${esc(pp.club)})</option>`).join('')}
        </select>` : `<p class="muted" style="font-size:12px">Lean on them in the group chat.</p>`}
        <div class="pick-log" style="max-height:320px">
          ${[...arrivals].sort(metricSort('pts')).map(p => `<div class="lrow"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${photoImg(p)} ${pname(p)} ${statusChip(p)} <span class="muted" style="font-size:11px">${esc(p.club)} · ${metricsFor(p).pts} pts</span>
            <button class="btn small ${canActFor(actor) ? '' : 'dim'}" style="margin-left:auto" data-wdin="${p.id}" ${canActFor(actor) ? '' : `data-why="It's ${esc(managerName(actor))}'s turn — lean on them in the group chat" title="It's ${esc(managerName(actor))}'s turn"`}>Sign</button></div>`).join('') || '<span class="muted">No arrivals left.</span>'}
        </div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          ${canActFor(actor) ? `<button class="btn ghost small" id="wdPass">Pass</button>` : ''}
          ${!netOn() || isCommissioner() ? `<button class="btn ghost small" id="wdEnd">End it — leftovers to the Trough</button>` : ''}
        </div>
        ${wd.picks?.length ? `<p class="muted" style="font-size:11.5px;margin-top:8px"><b style="color:var(--text)">So far:</b> ${wd.picks.map(k => `${esc(managerName(k.mid))} → ${esc(PLAYER_BY_ID[k.in]?.name || '?')}`).join(' · ')}</p>` : ''}
      </div>`;
    } else if (arrivals.length) {
      wdCard = `<div class="card" style="margin-bottom:14px">
        <h2>The Window <span class="tag">&#128274; ${arrivals.length} new arrival${arrivals.length > 1 ? 's' : ''} locked</span></h2>
        <p class="muted" style="font-size:12.5px">Anyone who joined a Premier League club after draft night is locked until the transfer window shuts. The Chairman then runs the <b>Window Draft</b> — first pick goes to whoever picked last on draft night, snaking back up. Leftovers spill into the Trough. No more WhatsApp draft, no more Ben Levy day.</p>
        <p style="font-size:12px;margin-top:6px"><b>In the holding pen:</b></p>
        <div class="pen-list">${[...arrivals].sort(metricSort('pts')).slice(0, 15).map(p => `<span class="pen-man"><span class="pos-badge pos-${p.pos}">${p.pos}</span> ${pname(p)} <span class="muted">(${esc(p.club)})</span>${!netOn() || isCommissioner() ? `<button class="btn ghost small pen-admit" data-admit="${p.id}" title="He never moved clubs — the feed just added him late. Admit him to the Trough without a Window Draft.">&rarr; Trough</button>` : ''}</span>`).join('')}${arrivals.length > 15 ? `<span class="muted">+${arrivals.length - 15} more</span>` : ''}</div>
        ${netOn() && !isCommissioner() ? '' : `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          <button class="btn small" id="wdStart">Start the Window Draft</button>
          <button class="btn ghost small" id="wdRelease">Skip it — release all to the Trough</button>
        </div><p class="muted" style="font-size:10.5px;margin-top:4px">Chairman's office. Wait for the window to actually shut.</p>`}
      </div>`;
    }
    const ctl = waiverControl();
    const claims = myClaims(mid);
    const nextRun = nextLiveWaiverRun();
    const tw = troughWindow();
    // the state of play, spelled out (mock night: "it just doesn't know when
    // players go on waivers") — closed window means EVERYONE free is claim-only
    // the chamber outranks manual controls in ENFORCEMENT, so it must outrank
    // them here too — "THROWN OPEN" during a live mock was a lie (sol r2 P2)
    const status = tw.mock ? `<span class="tag live-tag">TROUGH SHUT — ${esc(tw.why)}</span> <span class="tag">every signing goes through waivers until it reopens</span>`
      : ctl === 'closed' ? '<span class="tag">CLOSED by the Chairman</span>'
      : ctl === 'open' ? '<span class="tag">THROWN OPEN — free agents sign instantly; fresh drops still clear at the next run</span>'
      : !tw.open ? `<span class="tag live-tag">TROUGH SHUT — ${esc(tw.why)}</span> <span class="tag">every free agent is on waivers${tw.until ? ` · clears ${fmtWhen(tw.until)}` : ' until the run'}</span>`
      : `<span class="tag">open — drops sit on waivers until ${fmtWhen(nextRun)}</span> <span class="tag" id="wvClock2">${waiverClockLine()}</span>`;
    return `${head}${myPitchCard}${wdCard}<div class="card">
      <h2>Waivers &amp; The Trough ${status}</h2>
      <p class="muted" style="font-size:12px;margin-bottom:10px">Tap your <b>player out</b> on the pitch above then <b>Sign</b> — or just tap <b>Sign</b> on the man you want and pick who makes way. Instant if free, a waiver request if he&rsquo;s on waivers.</p>
      ${(() => {
        // the waiver list lives on its own tab now (Ian, 25 Aug: 30 requests
        // made this page a scroll marathon). Marc wanted it visible at the
        // top — this chip is both: one line, never grows. The never-hide
        // rule (learned three times) survives as the chip's empty state.
        const n = claims.length;
        return `<div class="lrow" style="font-size:12.5px;margin-bottom:10px;display:flex;align-items:center;gap:8px">
          ${n ? `<b>${n} waiver request${n === 1 ? '' : 's'} on your list</b> <span class="muted">&middot; processed ${esc(fmtWhen(nextRun))}</span>`
            : `<span class="muted">No waiver requests on your list — Sign a player who's <b>on waivers</b> and he joins it.</span>`}
          <button class="btn ghost small" data-trtab="claims" style="margin-left:auto;flex-shrink:0">Waiver list${n ? ` (${n})` : ''}</button>
        </div>`;
      })()}
      ${ctl === 'closed' ? '<p class="muted" style="font-size:12.5px">The Trough is closed. Complaints to the group chat.</p>' : `
      <select id="trOut" style="width:100%;max-width:420px;margin-bottom:8px;display:block" title="Marc's dropdown — the pitch above does the same job">
        <option value="">Player out — pick here or tap him on the pitch…</option>
        ${squadAt(mid, transferGw()).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos] || rating(b) - rating(a)).map(pp => `<option value="${pp.id}" ${transfersView.out === pp.id ? 'selected' : ''}>${pp.pos} — ${esc(pp.name)} (${esc(pp.club)})</option>`).join('')}
      </select>
      <input type="text" id="trSearch" placeholder="Search the Trough — ${PLAYERS.filter(p => !ownedNow.has(p.id) && !arrivalLocked(p) && !onWaivers(p)).length} players sniffing about…" style="width:100%;max-width:420px;margin-bottom:8px;display:block">
      <div id="trResults" class="pick-log" style="max-height:600px"></div>`}
      ${netOn() && isCommissioner() ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        <button class="btn small" id="runWaivers" ${state.mock?.phase === 'live' ? 'disabled title="A Chamber match is live — waivers wait for full time"' : ''}>Process waivers now</button>
        <button class="btn ghost small" id="ctlOpen" ${ctl === 'open' ? 'disabled' : ''}>Open Trough</button>
        <button class="btn ghost small" id="ctlClosed" ${ctl === 'closed' ? 'disabled' : ''}>Close Trough</button>
        <button class="btn ghost small" id="ctlAuto" ${ctl === 'auto' ? 'disabled' : ''}>Follow schedule</button>
        ${state.waiverMeta?.skip
          ? `<button class="btn ghost small" id="wvUnskip" title="Put the skipped run back on the schedule">Reinstate the skipped run</button>`
          : `<button class="btn ghost small" id="wvSkip" data-slot="${waiverSlotId(nextProcessableWaiverRun().getTime())}" title="Miss one run by exception — double gameweek, rogue Wednesday finish. Claims stay lodged and roll to the run after.">Skip the next run</button>`}
      </div><p class="muted" style="font-size:10.5px;margin-top:4px">Chairman's office. Overrides apply to everyone, immediately.</p>`
      : demoMode ? `<div style="margin-top:10px">
        <button class="btn small" id="runWaivers">&#9889; Process waivers now (demo)</button>
        <p class="muted" style="font-size:10.5px;margin-top:4px">In the real league waivers run at 10am every Tuesday and Friday. In the demo you ARE the Chairman: put in a waiver request on anyone marked "waivers", then process the round and watch it resolve.</p>
      </div>` : ''}
    </div>`;
  }
  if (tab === 'claims') {
    // Ian's green box (25 Aug): the waiver list on its own tab — full desk,
    // reorder, withdraw, the window's completed business. It can run to 30
    // requests here without costing anyone a scroll on the shopping page.
    const claims = myClaims(mid);
    const nextRun = nextLiveWaiverRun();
    const claimRows = claims.map((c, k) => `
      <div class="lrow claim-row" style="font-size:12.5px" draggable="true" data-cdrag="${k}">
        <span class="muted" style="cursor:grab" title="Drag to reorder">&#8942; #${k + 1}</span> <b>${pname(PLAYER_BY_ID[c.in])}</b>
        <span class="muted">in, ${pname(PLAYER_BY_ID[c.out])} out</span>
        <span style="margin-left:auto;display:flex;gap:4px" class="claim-btns">
          <button class="btn ghost small icon-btn" data-claimup="${k}" title="Raise priority" ${k === 0 ? 'disabled' : ''} aria-label="Raise priority">&#9650;</button>
          <button class="btn ghost small icon-btn" data-claimdn="${k}" title="Lower priority" ${k === claims.length - 1 ? 'disabled' : ''} aria-label="Lower priority">&#9660;</button>
          <button class="btn ghost small icon-btn" data-claimdel="${k}" title="Withdraw" aria-label="Withdraw">&#10005;</button>
        </span>
      </div>`).join('');
    // the window's completed business, so a multi-move session is visible as
    // you go ("what if you want to do multiple transfers at once… you should
    // be able to see what you are doing")
    const tgwCl = transferGw();
    const moves = state.transfers.filter(t => t.managerId === mid && t.gw === tgwCl);
    const movesBlock = moves.length ? `<h3 style="margin-top:10px">Done this window</h3>` + moves.map(t => `
      <div class="lrow" style="font-size:12.5px"><b>${pname(PLAYER_BY_ID[t.inId])}</b> <span class="muted">in${PLAYER_BY_ID[t.outId] ? `, ${PLAYER_BY_ID[t.outId].name} out` : ''} · ${t.trade ? 'trade' : t.windowDraft ? 'window draft' : t.waiver ? 'waiver, went through' : 'from the Trough'} · counts from GW${GAMEWEEKS[t.gw]?.n ?? '?'}</span>
      </div>`).join('') : '';
    return `${head}<div class="card">
      <h2>${esc(managerName(mid))}'s waiver list</h2>
      <p class="muted" style="font-size:12px;margin-bottom:10px">Top of the list is tried first when waivers are processed — next run ${esc(fmtWhen(nextRun))}. Drag to reorder, &#10005; to withdraw. Lodge new requests from <button class="btn ghost small" data-trtab="trough" style="padding:2px 8px">the Trough</button>.</p>
      ${claims.length ? claimRows
        : `<p class="muted" style="font-size:12px;margin-bottom:8px">Nothing on the list. Sign a player who's <b>on waivers</b> in the Trough and he joins your waiver list.</p>`}
      ${movesBlock}
    </div>`;
  }
  if (tab === 'trades') {
    // A listing outlives the player: sign him away and he stayed up here for
    // sale, with everyone else invited to bid for someone you no longer own
    // (Toby, sandbox 12 Aug: "I transferred out Senesi but can't take him off
    // the list as he's not my player"). Nobody else sees a phantom now; the
    // lister still does, so he can clear it down.
    const block = state.managers.flatMap(m => {
      const own = new Set(managerSquad(m.id).map(p => p.id));
      return blockList(m.id)
        .map(pid => ({ mid: m.id, p: PLAYER_BY_ID[pid], gone: !own.has(pid) }))
        .filter(x => x.p && (!x.gone || x.mid === mid));
    });
    return `${head}${mySquadCard}<div class="card" style="margin-bottom:14px">
      <h2>The Transfer List <span class="muted" style="font-weight:400;font-size:12px">publicly up for grabs — make an offer</span></h2>
      ${block.length ? block.map(({ mid: bm, p, gone }) => `<div class="lrow" style="font-size:12.5px">
        <span class="pos-badge pos-${p.pos}">${p.pos}</span>${photoImg(p)} ${pname(p)} <span class="muted" style="font-size:11px">${esc(p.club)} · ${metricsFor(p).pts} pts</span>
        <b style="margin-left:6px">${esc(teamName(bm))}</b>
        ${gone ? '<span class="tag">already gone — only you can see this</span>' : ''}
        <span style="margin-left:auto">${bm === mid
          ? `<button class="btn ghost small" data-unblock="${p.id}">Delist</button>`
          : `<button class="btn small" data-blocktrade="${bm}:${p.id}">Make an offer</button>`}</span>
      </div>`).join('') : '<p class="muted" style="font-size:12.5px">Nobody’s listed anyone. Listing is a gesture, not a rule — every player is technically available.</p>'}
      ${mid && mid !== -1 ? `<div style="margin-top:10px">
        <button class="btn ghost small" id="blockAdd">${transfersView.blockPick ? 'Never mind' : '&#128276; List one of my players'}</button>
        ${transfersView.blockPick ? `<div style="margin-top:8px">
          <p class="muted" style="font-size:11.5px;margin-bottom:6px">Tap a player to invite offers. Delist any time — no obligation to accept anything.</p>
          ${managerSquad(mid).filter(p => !blockList(mid).includes(p.id)).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos]).map(p => `<div class="lrow" style="font-size:12.5px">
            <span class="pos-badge pos-${p.pos}">${p.pos}</span>${photoImg(p)} ${pname(p)} <span class="muted" style="font-size:11px">${esc(p.club)}</span>
            <button class="btn small" data-blockpick="${p.id}" style="margin-left:auto">List</button>
          </div>`).join('') || '<p class="muted" style="font-size:12px">Your whole squad is already transfer-listed. Bold strategy.</p>'}
        </div>` : ''}
      </div>` : ''}
    </div>
    <div class="card">
      <h2>The Trade Desk</h2>
      <p class="muted" style="font-size:12px;margin-bottom:10px">Propose a swap with another <b>manager</b>; it executes the instant they accept. After a free agent instead? That&rsquo;s not a trade — that&rsquo;s <button class="btn ghost small" data-trtab="trough" style="padding:2px 8px">the Trough</button>: pick who goes out, sign who comes in.</p>
      ${toArr(state.trades).filter(t => t.status === 'pending' && (t.to === mid || t.from === mid)).map(t => `
        <div class="lrow" style="font-size:12.5px;flex-wrap:wrap">
          <span><b>${esc(managerName(t.from))}</b> gives <b>${esc(tradeNames(tGive(t)))}</b> for <b>${esc(tradeNames(tGet(t)))}</b>${t.terms ? `<br><span class="muted" style="font-size:11px">&#128220; ${esc(t.terms)}</span>` : ''}</span>
          <span style="margin-left:auto;display:flex;gap:4px">
            ${t.to === mid ? `<button class="btn small" data-tracc="${t.id}">Accept</button><button class="btn ghost small" data-trrej="${t.id}">Reject</button>`
              : `<button class="btn ghost small" data-trwd="${t.id}">Withdraw</button>`}
          </span>
        </div>`).join('') || '<p class="muted" style="font-size:12.5px">No offers on the table.</p>'}
      <select id="tradeWith" style="width:100%;max-width:420px;margin:8px 0;display:block">
        <option value="">Trade ${esc(managerName(mid))} with…</option>
        ${state.managers.filter(m => m.id !== mid).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}
      </select>
      <div id="tradePickers" style="max-width:420px"></div>
    </div>
    <div class="card" style="margin-top:14px">
      <h2>The Covenant Register <span class="tag">the offline bits, on the record</span></h2>
      <p class="muted" style="font-size:12px;margin-bottom:10px">Loan-backs, first refusals, "you owe me one" — record it here so nobody can deny it in GW30. Witnessed by the Committee. Enforced by the group chat.</p>
      ${[...toArr(state.covenants)].reverse().map(c => `<div class="lrow" style="font-size:12.5px;flex-wrap:wrap">
        <span class="muted">GW${c.gw ?? '?'}</span>
        <span><b>${esc(managerName(c.from))}</b> &harr; <b>${esc(managerName(c.to))}</b>: &#128220; ${esc(c.text)}</span>
      </div>`).join('') || '<p class="muted" style="font-size:12px">No covenants recorded. Suspiciously clean.</p>'}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <select id="covWith" style="min-width:150px">
          <option value="">With…</option>
          ${state.managers.filter(m => m.id !== mid).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}
        </select>
        <input type="text" id="covText" maxlength="200" placeholder="The agreement, verbatim" style="flex:1;min-width:220px">
        <button class="btn small" id="covAdd">Record it</button>
      </div>
    </div>`;
  }
  if (tab === 'history') {
    // filterable by how the deal happened (Marc, UAT night); redesigned to
    // speak the Dashboard's Transfer Wire language — kind marks, GW sections,
    // out → in flow (Ben, 10 Aug: "this page could be better designed")
    const kindOf = t => t.trade ? 'trade' : t.waiver ? 'waiver' : t.windowDraft ? 'window' : 'trough';
    const marks = { trade: '&#8644;', waiver: 'W', window: '&#9638;', trough: '+' };
    const hf = transfersView.histKind || '';
    const all = [...state.transfers].reverse();
    const counts = {};
    all.forEach(t => { const k = kindOf(t); counts[k] = (counts[k] || 0) + 1; });
    const shown = all.filter(t => !hf || kindOf(t) === hf);
    const sections = [];
    for (const t of shown) {
      const last = sections[sections.length - 1];
      if (last && last.gw === t.gw) last.rows.push(t); else sections.push({ gw: t.gw, rows: [t] });
    }
    const pbit = (p, cls) => p
      ? `<span class="hist-p ${cls}"><span class="pos-badge pos-${p.pos}">${p.pos}</span> ${pname(p)} <span class="hist-club">${esc(p.club)}</span></span>`
      : '<span class="muted">&mdash;</span>';
    const rowHtml = t => `<div class="hist-row">
      <span class="business-mark business-${kindOf(t)}" aria-hidden="true">${marks[kindOf(t)]}</span>
      <div class="hist-main">
        <div class="business-who"><button class="hist-team" data-histteam="${t.managerId}" title="Open ${esc(teamName(t.managerId))}'s squad">${kitSvg(t.managerId, 17)} <b>${esc(teamName(t.managerId))}</b></button> <span class="tag">${kindOf(t)}</span></div>
        <div class="hist-flow">
          <span class="business-label business-label-in">&#8593; IN</span> ${pbit(PLAYER_BY_ID[t.inId], 'hist-in')}
          <span class="business-label business-label-out">&#8595; OUT</span> ${pbit(PLAYER_BY_ID[t.outId], 'hist-out')}
        </div>
      </div>
      <button class="btn ghost small hist-rcbtn" data-rc="${t.n}">Report card <span aria-hidden="true">&#9662;</span></button>
    </div><div class="rc-slot hist-rc" data-rcslot="${t.n}" style="display:none"></div>`;
    const sectionHtml = s => `<div class="hist-gw"><b>Gameweek ${GAMEWEEKS[s.gw].n}</b> ${s.rows.length} ${s.rows.length === 1 ? 'move' : 'moves'}</div>${s.rows.map(rowHtml).join('')}`;
    const fbtn = (k, label) => `<button class="btn small ${hf === k ? '' : 'ghost'}" data-histkind="${k}">${label}${counts[k] || (!k && all.length) ? ` <span class="hist-count">${k ? counts[k] : all.length}</span>` : ''}</button>`;
    // pages back to the start of the season (Ben, 10 Aug) — packed by whole
    // GW sections so a page never opens mid-gameweek, ~15 moves a page which
    // reads well on a laptop and stays a short thumb-scroll on a phone
    const PAGE_TARGET = 15;
    const pages = [];
    for (const s of sections) {
      const last = pages[pages.length - 1];
      if (last && last.count < PAGE_TARGET) { last.secs.push(s); last.count += s.rows.length; }
      else pages.push({ secs: [s], count: s.rows.length });
    }
    const pi = Math.min(transfersView.histPage || 0, Math.max(0, pages.length - 1));
    const pg = pages[pi];
    const gwSpan = p => {
      const hi = GAMEWEEKS[p.secs[0].gw].n, lo = GAMEWEEKS[p.secs[p.secs.length - 1].gw].n;
      return hi === lo ? `GW${hi}` : `GW${hi}–${lo}`;
    };
    const pager = pages.length > 1 ? `<div class="hist-pager">
      <button class="btn ghost small" data-histpage="${pi - 1}" ${pi === 0 ? 'disabled' : ''}>&#8592; Newer</button>
      <span class="hist-pager-label">${gwSpan(pg)} &middot; page ${pi + 1} of ${pages.length}</span>
      <button class="btn ghost small" data-histpage="${pi + 1}" ${pi === pages.length - 1 ? 'disabled' : ''}>Older &#8594;</button>
    </div>` : '';
    return `${head}<div class="card hist-card">
      <div class="business-head">
        <div><span class="business-kicker">The Transfer Wire</span><h2>Every move, on the record</h2></div>
        <span class="muted">THE FULL LEDGER &middot; NOBODY FORGETS</span>
      </div>
      <div class="hist-filters">${fbtn('', 'All')}${fbtn('trough', 'Trough')}${fbtn('waiver', 'Waivers')}${fbtn('trade', 'Trades')}${fbtn('window', 'Window')}</div>
      ${pg ? pg.secs.map(sectionHtml).join('') : '<p class="muted" style="margin-top:12px">Nothing yet. Cowards.</p>'}${pager}</div>`;
  }
  // order — a proper table + wire-style history, not bare text (Ben, 14 Aug)
  const order = waiverOrder();
  const claimCounts = state.managers.map(m => ({ m, n: myClaims(m.id).length }));
  const totalClaims = claimCounts.reduce((s, c) => s + c.n, 0);
  const waiverHist = state.transfers.filter(t => t.waiver);
  const actor = hubActor();
  const orderRows = order.map((om, k) => {
    const n = claimCounts.find(c => c.m.id === om)?.n || 0;
    return `<tr${om === actor ? ' class="wo-me"' : ''}>
      <td class="muted" style="width:30px">#${k + 1}</td>
      <td>${kitSvg(om, 16)} <b>${esc(teamName(om))}</b> <span class="muted wo-mgr">${esc(managerName(om))}</span></td>
      <td class="num">${n || '<span class="muted">&mdash;</span>'}</td>
    </tr>`;
  }).join('');
  const histRows = [...waiverHist].reverse().map(t => `<div class="business-row">
    <span class="business-mark business-waiver" aria-hidden="true">W</span>
    <div class="business-main">
      <div class="business-who">${kitSvg(t.managerId, 17)} <b>${esc(teamName(t.managerId))}</b></div>
      <div class="business-flow">
        <span class="business-label business-label-in">&#8593; IN</span> <span class="business-players business-players-in">${pname(PLAYER_BY_ID[t.inId])}</span>
        <span class="business-label business-label-out">&#8595; OUT</span> <span class="business-players business-players-out">${pname(PLAYER_BY_ID[t.outId])}</span>
      </div>
    </div>
    <span class="business-gw"><small>GW</small><b>${GAMEWEEKS[t.gw].n}</b></span>
  </div>`).join('');
  return `${head}<div class="waiver-duo">
  <div class="card">
    <h2>Waiver Order <span class="tag">bottom of the table feeds first</span></h2>
    <table class="pool-table wo-table">
      <thead><tr><th></th><th>Team</th><th class="num">Claims in</th></tr></thead>
      <tbody>${orderRows}</tbody>
    </table>
    <div class="business-run" style="margin-top:12px">
      <b>NEXT RUN</b> <span>${fmtWhen(nextLiveWaiverRun())}</span>
      <small>${totalClaims ? `${totalClaims} CLAIM${totalClaims === 1 ? '' : 'S'} LODGED LEAGUE-WIDE` : 'NO CLAIMS LODGED YET'}</small>
    </div>
  </div>
  <div class="card business-card" style="margin-top:0">
    <div class="business-head">
      <div><span class="business-kicker">The Waiver Wire</span><h2>Priority spent</h2></div>
      <span class="muted">EVERY CLAIM THAT LANDED</span>
    </div>
    ${waiverHist.length ? `<div class="business-feed">${histRows}</div>` : '<p class="muted" style="font-size:12.5px;margin-top:10px">Nothing has gone through yet. Priority hoarded like it pays interest.</p>'}
  </div>
</div>`;
}
function bindTransfers() {
  const mid = hubActor();
  const cur = currentGwIndex();
  const aas = $('#actAsSel');
  if (aas) aas.onchange = () => {
    const v = +aas.value;
    transfersView.as = v === whoami ? null : v;
    transfersView.out = null; // a drop selected from the last chair makes no sense in this one
    render();
    if (transfersView.as != null) toast(`You now hold ${managerName(v)}'s pen. Switch back to yourself when the business is done.`);
  };
  document.querySelectorAll('[data-trtab]').forEach(b => b.onclick = () => { transfersView.tab = b.dataset.trtab; render(); });
  const cov = $('#covAdd');
  if (cov) cov.onclick = () => {
    if (!actGuard(mid, 'covenant')) return;
    const to = +$('#covWith').value, text = $('#covText').value.trim();
    if (!to || !text) { toast('Pick a counterparty and state the nonsense'); return; }
    if (netOn()) {
      serverAct('covenantAdd', { to, text: text.slice(0, 200), gw: GAMEWEEKS[cur].n, ...(mid !== whoami && { asManager: mid }) })
        .then(() => toast('Recorded. It is now canon.')).catch(() => {});
      return;
    }
    const covenant = { id: Date.now() + '-' + mid, from: mid, to, text: text.slice(0, 200), t: Date.now(), gw: GAMEWEEKS[cur].n };
    txnArray('covenants', arr => [...arr, covenant])
      .then(ok => toast(ok ? 'Recorded. It is now canon.' : 'Didn’t record — check connection and try again'));
  };
  // --- the Window Draft ---
  const wds = $('#wdStart');
  if (wds) wds.onclick = () => {
    const ord = [...state.draft.order].reverse();
    if (!ord.length) { toast('No draft order on record'); return; }
    if (!confirm(`Start the Window Draft? Order snakes backwards from draft night: ${ord.map(managerName).join(' › ')}. It runs until a full lap of passes.`)) return;
    if (netOn()) { serverAct('windowDraft', { op: 'start' }).catch(() => {}); return; }
    state.windowDraft = { status: 'live', order: ord, turn: 0, passes: 0, picks: [] };
    save(); render();
  };
  document.querySelectorAll('[data-admit]').forEach(b => b.onclick = () => {
    const p = PLAYER_BY_ID[+b.dataset.admit];
    if (!p) return;
    if (!confirm(`Admit ${p.name} (${p.club}) straight to the Trough?\n\nOnly for a player the feed added late — an academy debut, a name FPL had never created. A man who actually moved clubs belongs in the Window Draft.`)) return;
    admitArrival(+b.dataset.admit);
  });
  const wdr = $('#wdRelease');
  if (wdr) wdr.onclick = () => { if (confirm('Release every new arrival straight into the Trough — no Window Draft?')) wdFinish(); };
  const wde = $('#wdEnd');
  if (wde) wde.onclick = () => { if (confirm('End the Window Draft? Remaining arrivals go to the Trough.')) wdFinish(); };
  const wdp = $('#wdPass');
  if (wdp) wdp.onclick = () => {
    if (!actGuard(wdActor(), 'window draft')) return;
    if (netOn()) {
      serverAct('windowDraft', { op: 'pass', expectedTurn: state.windowDraft?.turn || 0 })
        .then(() => toast(`${managerName(wdActor())} passes.`)).catch(() => {});
      return;
    }
    toast(`${managerName(wdActor())} passes.`);
    wdAdvance(true);
  };
  document.querySelectorAll('[data-wdin]').forEach(b => b.onclick = async () => {
    if (b.dataset.why) { toast(b.dataset.why); return; } // tap-to-explain (sol #4)
    const actor = wdActor();
    if (!actGuard(actor, 'window draft')) return;
    const inP = PLAYER_BY_ID[+b.dataset.wdin];
    let outId = +($('#wdOut')?.value || 0);
    // no dropdown pick is not a dead end — same either-way-round flow as the
    // Trough (Ben, 25 Aug): tap the man you want, then choose who makes way
    if (!outId) { outId = await chooseOutSheet(actor, inP, false); if (outId == null) return; }
    const tgw = transferGw();
    const outWasStarting = lineupFor(actor, tgw).includes(outId);
    if (!squadShapeOk([...squadAt(actor, tgw).filter(x => x.id !== outId), inP])) { toast('Breaks the squad position limits'); return; }
    if (!await confirmSheet({
      title: 'Window Draft signing',
      body: dealRows([PLAYER_BY_ID[outId]], [inP]),
      yes: `Sign ${esc(inP.name)}`,
      note: 'Done the moment you confirm — and your turn is used.',
    })) return;
    if (netOn()) {
      serverAct('windowDraft', { op: 'pick', inId: inP.id, outId, expectedTurn: state.windowDraft?.turn || 0 })
        .then(() => receiptSheet({ title: 'Window Draft pick', inP, outP: PLAYER_BY_ID[outId], gw: tgw, mid: actor, wasStarting: outWasStarting, note: 'The snake moves on.' }))
        .catch(() => {});
      return;
    }
    txnArray('transfers', arr => {
      const owned = ownedIdsGiven(arr, tgw);
      if (owned.has(inP.id) || !owned.has(outId)) return null;
      return [...arr, { managerId: actor, outId, outCode: PLAYER_BY_ID[outId]?.code ?? null, inId: inP.id, inCode: inP.code ?? null, gw: tgw, n: arr.length + 1, t: Date.now(), windowDraft: true }];
    }).then(ok => {
      if (!ok) { toast(`${inP.name} is already spoken for — pick again.`); render(); return; }
      const lu = state.lineups[actor]?.[tgw];
      if (lu) {
        state.lineups[actor][tgw] = lu.filter(id => id !== outId);
        pushShared(`lineups/${actor}/${tgw}`, state.lineups[actor][tgw]);
      }
      receiptSheet({ title: 'Window Draft pick', inP, outP: PLAYER_BY_ID[outId], gw: tgw, mid: actor, wasStarting: outWasStarting, note: 'The snake moves on.' });
      wdAdvance(false, { mid: actor, in: inP.id, out: outId });
    });
  });
  // --- waivers & the Trough ---
  const search = $('#trSearch'), results = $('#trResults');
  // the player-out dropdown (Marc, UAT night: "we had a drop down… bit of a
  // faff on the pitch") — same state as the pitch taps, either works
  const trOut = $('#trOut');
  if (trOut) trOut.onchange = () => { transfersView.out = +trOut.value || null; render(); };
  document.querySelectorAll('[data-histkind]').forEach(b => b.onclick = () => { transfersView.histKind = b.dataset.histkind; transfersView.histPage = 0; render(); });
  document.querySelectorAll('[data-histpage]').forEach(b => b.onclick = () => { transfersView.histPage = Math.max(0, +b.dataset.histpage); render(); });
  // ledger team names open that club's squad (Ben, 10 Aug) — same jump as the report-card overlay
  document.querySelectorAll('[data-histteam]').forEach(b => b.onclick = () => { state.view = 'team'; teamView.mid = +b.dataset.histteam; save(); render(); });
  document.querySelectorAll('[data-rc]').forEach(b => b.onclick = () => {
    const slot = document.querySelector(`[data-rcslot="${b.dataset.rc}"]`);
    if (!slot) return;
    if (slot.style.display === 'none') {
      const t = state.transfers.find(x => x.n === +b.dataset.rc);
      slot.innerHTML = t ? reportCardHtml(t) : '';
      slot.style.display = '';
    } else slot.style.display = 'none';
  });
  // claim list management (withdraw / reprioritise)
  document.querySelectorAll('[data-claimdel]').forEach(b => b.onclick = () => {
    if (!actGuard(mid, 'waiver claims')) return;
    const arr = [...myClaims(mid)]; arr.splice(+b.dataset.claimdel, 1); setClaims(mid, arr);
  });
  document.querySelectorAll('[data-claimup]').forEach(b => b.onclick = () => {
    if (!actGuard(mid, 'waiver claims')) return;
    const k = +b.dataset.claimup, arr = [...myClaims(mid)];
    if (k === 0) return;
    [arr[k - 1], arr[k]] = [arr[k], arr[k - 1]]; setClaims(mid, arr);
  });
  document.querySelectorAll('[data-claimdn]').forEach(b => b.onclick = () => {
    if (!actGuard(mid, 'waiver claims')) return;
    const k = +b.dataset.claimdn, arr = [...myClaims(mid)];
    if (k >= arr.length - 1) return;
    [arr[k], arr[k + 1]] = [arr[k + 1], arr[k]]; setClaims(mid, arr);
  });
  // drag a claim to its new priority slot (Ben, mock night) — buttons stay for thumbs
  document.querySelectorAll('[data-cdrag]').forEach(row => {
    row.ondragstart = e => { e.dataTransfer.setData('text/claim', row.dataset.cdrag); e.dataTransfer.effectAllowed = 'move'; };
    row.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    row.ondrop = e => {
      e.preventDefault();
      const from = +e.dataTransfer.getData('text/claim');
      if (Number.isNaN(from) || !actGuard(mid, 'waiver claims')) return;
      const rect = row.getBoundingClientRect();
      let to = +row.dataset.cdrag + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
      if (from < to) to--;
      const arr = [...myClaims(mid)];
      if (from === to || from < 0 || from >= arr.length) return;
      const [mv] = arr.splice(from, 1);
      arr.splice(Math.max(0, Math.min(to, arr.length)), 0, mv);
      setClaims(mid, arr);
    };
  });
  const msq = $('#trMySquad');
  if (msq) msq.ontoggle = () => { window._trSquadOpen = msq.open; };
  // Chairman's office
  const rw = $('#runWaivers');
  if (rw) rw.onclick = () => { if (confirm('Process waivers now for everyone? Requests go through in reverse table order and the Trough opens.')) processWaivers(true); };
  ['open', 'closed', 'auto'].forEach(m => { const b = $(`#ctl${m[0].toUpperCase()}${m.slice(1)}`); if (b) b.onclick = () => setWaiverControl(m); });
  const sk = $('#wvSkip');
  if (sk) sk.onclick = () => { if (confirm('Skip the next waiver run? Everyone\'s claims stay lodged and roll to the run after. The Trough stays on its normal clock.')) setWaiverSkip(sk.dataset.slot); };
  const usk = $('#wvUnskip');
  if (usk) usk.onclick = () => setWaiverSkip(null);
  if (results) {
    const cur = currentGwIndex();
    // tap a chip on the pitch to pick who makes way; tap again to change your
    // mind — the class flips in place so the search box keeps its text
    document.querySelectorAll('[data-trout]').forEach(chip => chip.onclick = () => {
      const pid = +chip.dataset.trout;
      transfersView.out = transfersView.out === pid ? null : pid;
      document.querySelectorAll('[data-trout]').forEach(c => c.classList.toggle('sel', +c.dataset.trout === transfersView.out));
      // and Marc's dropdown follows the pitch. It used to sit there still
      // naming the last man you picked in it while a DIFFERENT player went out
      // — the sign button reads transfersView.out, not the select (Toby,
      // sandbox 12 Aug: "the drop down doesn't change but the player selected
      // from the pitch is the one transferred out")
      if (trOut) trOut.value = transfersView.out || '';
      // phones: picking the outgoing man jumps you to the pool — the whole
      // point of the tap is the list that was sitting below the fold
      if (transfersView.out && search && matchMedia('(max-width: 700px)').matches) {
        search.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      renderTrResults();
    });
    search.oninput = renderTrResults;
    function renderTrResults() {
      const q = normName(search.value || '');
      // ownership through the LANDING gameweek's lens — mid-mock, a player
      // traded for next week is already 'owned by' his new club (Toby's
      // Vicario read 'owned by Wilko' while sitting on Toby's bench)
      const owned = ownedIdsAt(transferGw());
      const outP = transfersView.out ? PLAYER_BY_ID[transfersView.out] : null;
      const squadAfterOut = squadAt(mid, transferGw()).filter(p => !outP || p.id !== outP.id);
      // only an IDENTICAL {in, out} pair is a duplicate — "Jones for Okafor,
      // else Dorgu for Okafor" is a legitimate fallback ladder (Marc, UAT
      // night); the run voids whatever's already settled
      const claimPairs = new Set(myClaims(mid).map(c => `${c.in}:${c.out}`));
      const ownedBy = {};
      for (const mm of state.managers) for (const sp of squadAt(mm.id, transferGw())) ownedBy[sp.id] = mm.id;
      // Free agents means SIGNABLE RIGHT NOW. It used to mean merely unowned,
      // so the waiver crowd and the locked new arrivals sat in it too and the
      // filter was a superset of the one beside it (Toby, sandbox 12 Aug:
      // "surely it should only be the everyone filter that has both"). Waivers
      // has its own chip; Everyone still shows the lot, owned included.
      let pool = transfersView.scope === 'watch' ? watchIds(mid).map(id => PLAYER_BY_ID[id]).filter(Boolean)
        : transfersView.scope === 'all' ? [...PLAYERS]
        : transfersView.scope === 'waivers' ? PLAYERS.filter(p => !owned.has(p.id) && !arrivalLocked(p) && onWaivers(p) && !hasLeft(p))
        : transfersView.scope === 'free' ? PLAYERS.filter(p => !owned.has(p.id) && !arrivalLocked(p) && !onWaivers(p) && !hasLeft(p))
        : PLAYERS.filter(p => !owned.has(p.id) && !arrivalLocked(p) && !hasLeft(p));
      if (trPosOn().length) pool = pool.filter(p => trPosOn().includes(p.pos));
      if (transfersView.club) pool = pool.filter(p => p.team === transfersView.club);
      if (q) pool = pool.filter(p => normName(p.name).includes(q) || normName(p.team).includes(q) || normName(p.club).includes(q));
      const s = transfersView.sort;
      const live = seasonHasStats();
      const landingGwN = GAMEWEEKS[transferGw()]?.n ?? null;
      // every fixture shown in the Trough is read through the landing-gameweek
      // lens — the same rule Marc applied to the pitch and bench chips
      const cols = STAT_COLS(live).map(c => c.k === 'vs'
        ? { ...c, h: landingGwN ? `GW${landingGwN}` : c.h, t: 'Fixture in the gameweek this deal lands in', v: (m, p) => nextFxHtml(p.team, landingGwN) }
        : c);
      pool.sort(metricSort(s));
      const twNow = troughWindow();
      // the generic "clears when waivers run" said nothing the page banner
      // doesn't already — repeated 400 times it wrapped every row to four
      // lines on a phone (mobile sweep, 25 Aug). A real date still prints.
      const clearsTxt = !twNow.open
        ? (twNow.until ? `clears ${fmtWhen(twNow.until)}` : '')
        : `clears ${fmtWhen(nextLiveWaiverRun())}`;
      const total = pool.length;
      const shown = pool.slice(0, transfersView.limit);
      const hint = outP ? `<div class="muted" style="font-size:11.5px;padding:2px 0 6px">Making room for ${esc(outP.name)} (${outP.pos}) to leave:</div>`
        : '<div class="muted" style="font-size:11.5px;padding:2px 0 6px">Browsing the Trough — tap a player on your pitch above to unlock signings and waivers. Tap a column to sort.</div>';
      const table = `
      <div style="overflow-x:auto">
      <table class="pool-table">
        <thead><tr>
          <th data-trsort="name">Player</th><th></th>
          ${cols.map(c => c.sortable === false ? `<th class="num" data-stat="${c.k}" title="${esc(c.t)}">${c.h}</th>` : `<th class="num" data-stat="${c.k}" data-trsort="${c.k}" title="${esc(c.t)}">${c.h} ${s === c.k ? '▾' : ''}</th>`).join('')}<th class="act-more"></th><th class="act"></th>
        </tr></thead>
        <tbody>${shown.map(p => {
          const ownerMid = ownedBy[p.id];
          const locked = !ownerMid && arrivalLocked(p);
          const waiv = !ownerMid && !locked && onWaivers(p);
          const dupe = outP && claimPairs.has(`${p.id}:${outP.id}`);
          // no out-man marked is no longer a dead end: the tap opens the
          // who-makes-way picker instead (Ben, 25 Aug — either order works)
          const needOut = !ownerMid && !locked && !outP;
          const ok = !ownerMid && !locked && outP && squadShapeOk([...squadAfterOut, p]) && !dupe;
          const why = locked ? 'New arrival — locked until the window shuts, then the Window Draft'
            : !outP ? 'Tap to choose who makes way' : dupe ? 'That exact claim is already on your list' : 'Breaks the squad position limits';
          const m = metricsFor(p);
          const action = ownerMid
            ? (ownerMid === mid ? '<span class="muted" style="font-size:11px">yours</span>' : `<button class="btn ghost small" data-trtrade="${ownerMid}:${p.id}" title="Open the trade desk with ${esc(managerName(ownerMid))}">Trade</button>`)
            : `<button class="btn small ${waiv || locked ? 'ghost' : ''} ${ok || needOut ? '' : 'dim'}" data-trin="${p.id}" data-waiv="${waiv ? 1 : 0}" ${needOut ? 'data-needout="1"' : ''} ${ok || needOut ? '' : `data-why="${esc(why)}" title="${esc(why)}"`}>${locked ? '&#128274;' : waiv ? 'Claim' : 'Sign'}</button>`;
          return `<tr class="${statusClass(p)}">
            <td class="pcol"><div class="pcell">${photoImg(p)}<div><button type="button" class="pname plink player-name-btn" data-pcard="${p.id}" title="Open ${esc(playerDisplayName(p))}'s stats">${natFlag(p)} <span class="pn-txt">${esc(playerDisplayName(p))}</span></button>${provChip(p)}<div class="pclub">${flagImg(p.team)} ${esc(p.club)} · <span class="pos-badge pos-${p.pos}">${p.pos}</span> <span class="pfx">· ${nextFxHtml(p.team, landingGwN)}</span>${ownerMid ? ` · <b style="color:var(--text)">${esc(teamName(ownerMid))}</b>${onBlock(p.id) ? ' · <span style="color:var(--accent)">&#128276; transfer-listed</span>' : ''}` : locked ? ' · <span class="muted">&#128274; new arrival</span>' : waiv ? ` · <span style="color:var(--accent)">on waivers${clearsTxt ? ` · ${esc(clearsTxt)}` : ''}</span>` : ' · <span class="muted">free</span>'}</div></div></div></td>
            <td>${statusChip(p)}</td>
            ${cols.map(c => `<td class="num${c.cls || ''}" data-stat="${c.k}">${c.v(m, p)}</td>`).join('')}
            <td class="act-more"><div class="row-actions">${compareButtonHtml(p.id)}${watchBtnHtml(mid, p.id)}</div></td>
            <td class="act"><div class="row-actions">${action}</div></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      ${total > transfersView.limit ? `<div class="show-more"><button class="btn ghost small" id="trMore">Show more</button> <button class="btn ghost small" id="trAll">Show all ${total}</button></div>` : ''}`;
      results.innerHTML = hint + scoutViewHtml('transfers') + `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 8px;align-items:center">
        <button class="btn small ${trPosOn().length ? 'ghost' : ''}" data-trpos="" title="Show every position">All</button>
        ${['GK', 'DF', 'MF', 'FW'].map(pp => `<button class="btn small ${trPosOn().includes(pp) ? '' : 'ghost'}" data-trpos="${pp}" aria-pressed="${trPosOn().includes(pp)}" title="${trPosOn().includes(pp) ? `Stop showing ${pp}` : `Also show ${pp}`}">${pp}</button>`).join('')}
        <select id="trClub" style="padding:6px 8px;font-size:12px">
          <option value="">All clubs</option>
          ${TEAMS.map(t => `<option value="${esc(t.name)}" ${transfersView.club === t.name ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
        <span style="width:8px"></span>
        <button class="btn small ${transfersView.scope !== 'all' && transfersView.scope !== 'waivers' && transfersView.scope !== 'free' ? '' : 'ghost'}" data-trscope="avail" title="Everyone you could get: free to sign now, plus the waiver queue">Available</button>
        <button class="btn small ${transfersView.scope === 'free' ? '' : 'ghost'}" data-trscope="free">Free agents</button>
        <button class="btn small ${transfersView.scope === 'waivers' ? '' : 'ghost'}" data-trscope="waivers" title="Everyone currently claim-only, and when they clear">On waivers</button>
        <button class="btn small ${transfersView.scope === 'all' ? '' : 'ghost'}" data-trscope="all" title="Owned players too, and men who have left the league">Everyone</button>
        <button class="btn small ${transfersView.scope === 'watch' ? '' : 'ghost'}" data-trscope="watch" title="Only the players you are watching — owned or free">&#128065; Watchlist${watchIds(mid).length ? ` (${watchIds(mid).length})` : ''}</button>
      </div>` + (shown.length ? table
        : transfersView.scope === 'watch' ? `<span class="muted">Nothing on your watchlist yet. Tap the ${'\u{1F441}'} beside anyone in the Trough — owned or free — and he turns up here. Only you can see it.</span>`
        : transfersView.scope === 'waivers' ? '<span class="muted">Nobody is on waivers right now — everyone free is fair game in the Trough.</span>'
        // now that Free agents means signable, it empties honestly in the hours
        // after a gameweek, when everyone spare is still claim-only
        : PLAYERS.some(p => !owned.has(p.id) && !arrivalLocked(p) && onWaivers(p))
          ? '<span class="muted">Nothing to sign outright — everyone spare is on waivers. Lodge a claim under <b>On waivers</b>.</span>'
          : '<span class="muted">The Trough is empty. Somehow.</span>');
      const clubSel = results.querySelector('#trClub');
      if (clubSel) clubSel.onchange = () => { transfersView.club = clubSel.value; transfersView.limit = 20; renderTrResults(); };
      results.querySelectorAll('[data-trpos]').forEach(b => b.onclick = () => {
        const pp = b.dataset.trpos, on = trPosOn();
        transfersView.pos = pp ? (on.includes(pp) ? on.filter(x => x !== pp) : [...on, pp]) : [];
        transfersView.limit = 20; renderTrResults();
      });
      results.querySelectorAll('[data-trscope]').forEach(b => b.onclick = () => { transfersView.scope = b.dataset.trscope; transfersView.limit = 20; renderTrResults(); });
      results.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => {
        if (!canActFor(mid)) { toast('Sign in to keep a watchlist'); return; }
        const pid = +b.dataset.watch;
        const on = toggleWatch(mid, pid).includes(pid);
        toast(on ? `${PLAYER_BY_ID[pid]?.name || 'He'} is on your watchlist` : `${PLAYER_BY_ID[pid]?.name || 'He'} is off your watchlist`);
        // in the watchlist lens the row has just left the list, so redraw;
        // elsewhere only the button changed
        if (transfersView.scope === 'watch') { renderTrResults(); return; }
        results.querySelectorAll(`[data-watch="${pid}"]`).forEach(x => x.outerHTML = watchBtnHtml(mid, pid));
        // the tally on the scope chip is part of the same thought — leaving it
        // stale until the next full render reads as the tap not registering
        const chip = results.querySelector('[data-trscope="watch"]');
        if (chip) chip.innerHTML = `&#128065; Watchlist${watchIds(mid).length ? ` (${watchIds(mid).length})` : ''}`;
      });
      results.querySelectorAll('[data-trtrade]').forEach(b => b.onclick = () => {
        const [other, get] = b.dataset.trtrade.split(':').map(Number);
        transfersView.tab = 'trades'; window._tradeFocus = { other, get }; render();
      });
      results.querySelectorAll('[data-trsort]').forEach(th => th.onclick = () => { transfersView.sort = th.dataset.trsort; renderTrResults(); });
      bindScoutDesk('transfers', renderTrResults);
      bindColToggle(renderTrResults);
      bindColOrder(renderTrResults);
      const more = results.querySelector('#trMore');
      if (more) more.onclick = () => { transfersView.limit += 50; renderTrResults(); };
      const showAll = results.querySelector('#trAll');
      if (showAll) showAll.onclick = () => { transfersView.limit = 9999; renderTrResults(); };
      results.querySelectorAll('[data-trin]').forEach(b => b.onclick = async () => {
        if (b.dataset.why) { toast(b.dataset.why); return; } // tap-to-explain (sol #4)
        if (!actGuard(mid, 'squad')) return;
        let pickedOut = null;
        if (b.dataset.needout) {
          pickedOut = await chooseOutSheet(mid, PLAYER_BY_ID[+b.dataset.trin], b.dataset.waiv === '1');
          if (pickedOut == null) return;
        }
        const inId = +b.dataset.trin, outId = pickedOut ?? transfersView.out;
        const inP = PLAYER_BY_ID[inId], outP = PLAYER_BY_ID[outId];
        const startingByGw = GAMEWEEKS.map((_, g) => lineupFor(mid, g).includes(outId));
        if (b.dataset.waiv === '1') {
          if (!await confirmSheet({
            title: 'Lodge this claim?',
            body: dealRows([outP], [inP]),
            yes: 'Lodge claim',
            note: 'Resolves when waivers are processed. You can withdraw or reorder it from the Waiver list tab until then.',
          })) return;
          setClaims(mid, [...myClaims(mid), { in: inId, out: outId }]);
          transfersView.out = null;
          receiptSheet({ title: 'Claim lodged', inP, outP, gw: transferGw(), mid, pending: true,
            note: `Waiver request #${myClaims(mid).length} on your list — processed ${esc(fmtWhen(nextLiveWaiverRun()))}. Reorder or withdraw it on the Waiver list tab until then.` });
          return;
        }
        const tgw = transferGw();
        if (!squadShapeOk([...squadAt(mid, tgw).filter(x => x.id !== outId), inP])) { toast('Breaks the squad position limits'); return; }
        if (!await confirmSheet({
          title: 'Do the deal?',
          body: dealRows([outP], [inP]),
          yes: `Sign ${esc(inP.name)}`,
          note: `First come, first served — the deal is done the moment you confirm${tgw !== cur ? `, in for GW${GAMEWEEKS[tgw].n}` : ''}. ${esc(outP?.name || 'Your man')} goes to waivers.`,
        })) return;
        if (netOn()) {
          // first come, first served — settled by a server transaction
          serverAct('troughSign', { inId, outId, ...(mid !== whoami && { asManager: mid }) })
            .then(r => {
              transfersView.out = null;
              receiptSheet({ title: 'Signed from the Trough', inP, outP, gw: r.tgw, mid, wasStarting: startingByGw[r.tgw], note: `${esc(outP?.name || 'Your man')} goes to waivers. First come, first served — this one is done.` });
            }).catch(() => {});
          return;
        }
        // first come, first served — settled by a transaction, not by luck
        txnArray('transfers', arr => {
          const owned = ownedIdsGiven(arr, tgw);
          if (owned.has(inId) || !owned.has(outId)) return null; // beaten to him
          return [...arr, { managerId: mid, outId, inId, gw: tgw, n: arr.length + 1, t: Date.now() }];
        }).then(ok => {
          if (!ok) { toast(`${inP.name} was signed seconds before you got there. The Trough is cruel.`); render(); return; }
          // only ever strip the OUT player from the target (unplayed) GW's XI —
          // never a gameweek already scored
          const lu = state.lineups[mid]?.[tgw];
          if (lu) {
            state.lineups[mid][tgw] = lu.filter(id => id !== outId);
            pushShared(`lineups/${mid}/${tgw}`, state.lineups[mid][tgw]);
          }
          transfersView.out = null;
          save(); render();
          receiptSheet({ title: 'Signed from the Trough', inP, outP, gw: tgw, mid, wasStarting: startingByGw[tgw], note: `${esc(outP?.name || 'Your man')} goes to waivers. First come, first served — this one is done.` });
        });
      });
    }
    if (window._troughFocus) {
      search.value = window._troughFocus;
      window._troughFocus = null;
      renderTrResults();
    } else renderTrResults();
  }
  // --- trade desk: propose / accept / reject / withdraw ---
  document.querySelectorAll('[data-tracc]').forEach(b => b.onclick = async () => {
    const tr = toArr(state.trades).find(x => x.id === b.dataset.tracc);
    if (!tr) return;
    if (!actGuard(tr.to, 'trade')) return;
    if (!await confirmSheet({
      title: 'Accept this trade?',
      body: dealRows(tGet(tr).map(id => PLAYER_BY_ID[id]), tGive(tr).map(id => PLAYER_BY_ID[id]))
        + (tr.terms ? `<p style="font-size:13px;margin:8px 0 0">Side-terms: <i>${esc(tr.terms)}</i></p>` : ''),
      yes: 'Accept &amp; execute',
      // Toby (mock night): a mid-GW trade lands NEXT gameweek — the deal
      // executes now, the players swap in from the first unstarted GW. Say so.
      note: (() => {
        const tgw = transferGw(), cur2 = currentGwIndex();
        return `Executes instantly — both squads swap on confirm${tgw !== cur2 ? `. This gameweek has kicked off, so the incoming players are in from GW${GAMEWEEKS[tgw].n} — locked XIs don't change` : ''}. No takebacks.`;
      })(),
    })) return;
    respondTrade(tr.id, true);
  });
  document.querySelectorAll('[data-trrej]').forEach(b => b.onclick = () => {
    const tr = toArr(state.trades).find(x => x.id === b.dataset.trrej);
    if (!tr) return;
    if (!actGuard(tr.to, 'trade')) return;
    respondTrade(tr.id, false);
  });
  document.querySelectorAll('[data-trwd]').forEach(b => b.onclick = () => {
    const tr = toArr(state.trades).find(x => x.id === b.dataset.trwd);
    if (!tr) return;
    if (!actGuard(tr.from, 'trade')) return;
    if (netOn()) {
      serverAct('tradeRespond', { tradeId: tr.id, action: 'withdraw' })
        .then(() => toast('Offer withdrawn. Never happened.')).catch(() => {});
      return;
    }
    setTradeStatus(tr.id, 'withdrawn')
      .then(ok => toast(ok ? 'Offer withdrawn. Never happened.' : 'Too late — the offer already moved.'));
  });
  // trade block: list your own straight from the card (Marc 2 Aug — the
  // player-card route was invisible once the block had names on it),
  // delist your own, make an offer for theirs
  const ba = $('#blockAdd');
  if (ba) ba.onclick = () => { transfersView.blockPick = !transfersView.blockPick; render(); };
  document.querySelectorAll('[data-blockpick]').forEach(b => b.onclick = () => {
    if (!actGuard(mid, 'transfer list')) return;
    const p = PLAYER_BY_ID[+b.dataset.blockpick];
    transfersView.blockPick = false;
    toggleBlock(mid, +b.dataset.blockpick);
    toast(`${p.name} is on the transfer list. Offers invited.`);
  });
  document.querySelectorAll('[data-unblock]').forEach(b => b.onclick = () => {
    if (!actGuard(mid, 'transfer list')) return;
    toggleBlock(mid, +b.dataset.unblock);
  });
  document.querySelectorAll('[data-blocktrade]').forEach(b => b.onclick = () => {
    const [other, get] = b.dataset.blocktrade.split(':').map(Number);
    window._tradeFocus = { other, get };
    render();
  });
  const tradeWith = $('#tradeWith'), pickers = $('#tradePickers');
  if (tradeWith && window._tradeFocus) {
    const tf = window._tradeFocus;
    window._tradeFocus = null;
    tradeWith.value = tf.other;
    setTimeout(() => {
      tradeWith.onchange();
      const cb = pickers.querySelector(`[data-trside="theirs"][value="${tf.get}"]`);
      if (cb) cb.checked = true;
    }, 0);
  }
  if (tradeWith) {
    tradeWith.onchange = () => {
      const other = +tradeWith.value;
      if (!other) { pickers.innerHTML = ''; return; }
      const cur = currentGwIndex();
      const mine = squadAt(mid, transferGw()).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos]);
      const theirs = squadAt(other, transferGw()).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos]);
      const col = (title, list, side) => `<div style="flex:1;min-width:190px">
        <p style="font-size:12px;font-weight:700;margin-bottom:4px">${title}</p>
        <div style="max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:6px">
        ${list.map(p => `<label style="display:flex;gap:6px;align-items:center;font-size:12px;padding:2px 0;cursor:pointer">
          <input type="checkbox" data-trside="${side}" value="${p.id}"><span class="pos-badge pos-${p.pos}">${p.pos}</span> ${esc(p.name)} <span class="muted">${esc(p.club)}</span>
        </label>`).join('')}
        </div></div>`;
      pickers.innerHTML = `
        <p class="muted" style="font-size:11.5px;margin-bottom:6px">Tick any number of players — the same count on each side (2-for-2, 3-for-3…).</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          ${col(`${esc(managerName(mid))} gives`, mine, 'mine')}
          ${col(`${esc(managerName(other))} gives`, theirs, 'theirs')}
        </div>
        <input type="text" id="tradeTerms" maxlength="200" placeholder="Side terms (optional) — loan-backs, first refusals, the nonsense…" style="width:100%;margin-bottom:8px">
        <button class="btn small" id="tradeGo">Propose trade</button>`;
      const tradeGo = pickers.querySelector('#tradeGo');
      if (!tradeGo) return;
      tradeGo.onclick = async () => {
        if (!actGuard(mid, 'trade')) return;
        const give = [...pickers.querySelectorAll('[data-trside="mine"]:checked')].map(x => +x.value);
        const get = [...pickers.querySelectorAll('[data-trside="theirs"]:checked')].map(x => +x.value);
        if (!give.length || !get.length) { toast('Pick at least one player on each side'); return; }
        if (give.length !== get.length) { toast(`Same number each way — you've ticked ${give.length} for ${get.length}`); return; }
        const giveSet = new Set(give), getSet = new Set(get);
        const meAfter = [...squadAt(mid, transferGw()).filter(p => !giveSet.has(p.id)), ...get.map(pid => PLAYER_BY_ID[pid])];
        const themAfter = [...squadAt(other, transferGw()).filter(p => !getSet.has(p.id)), ...give.map(pid => PLAYER_BY_ID[pid])];
        if (!squadShapeOk(meAfter) || !squadShapeOk(themAfter)) { toast('That combination breaks a squad’s position limits'); return; }
        const terms = $('#tradeTerms').value.trim();
        if (!await confirmSheet({
          title: `Propose to ${esc(managerName(other))}?`,
          body: dealRows(give.map(pid => PLAYER_BY_ID[pid]), get.map(pid => PLAYER_BY_ID[pid]))
            + (terms ? `<p style="font-size:13px;margin:8px 0 0">Side-terms: <i>${esc(terms)}</i></p>` : ''),
          yes: 'Send offer',
          note: 'They accept or reject. You can withdraw the offer any time before they answer.',
        })) return;
        proposeTrade(mid, other, give, get, terms);
      };
    };
  }
}

/* ---------------- dashboard ---------------- */
/* ----- "the app": the site IS the app — home-screen install helpers ----- */
let a2hsEvent = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  a2hsEvent = e; // Chrome/Edge/Android hand us a one-tap installer; stash it for the card
  try { if (state && document.querySelector('#main')) render(); } catch { /* fired before boot — card picks it up on first render */ }
});
const A2HS_KEY = `${LS_NS}-a2hs-hidden`;
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installApp() {
  if (!a2hsEvent) return;
  const ev = a2hsEvent; a2hsEvent = null;
  ev.prompt();
  ev.userChoice.then(c => {
    if (c.outcome === 'accepted') toast('Installed — The League is on your home screen');
    // dismissed: the event is spent — show the manual instructions instead.
    // Chrome refires beforeinstallprompt later and the one-tap button returns.
    else render();
  });
}
function installCard(settingsPage = false) {
  if (isStandalone()) return settingsPage ? `<div class="card"><h2>The App</h2>
    <p class="muted" style="font-size:12.5px">&#9989; You're running the installed app — its own icon, full screen, same live league. Nothing to update; it always loads the latest build.</p></div>` : '';
  if (!settingsPage && localStorage.getItem(A2HS_KEY)) return '';
  const how = a2hsEvent ? ''
    : isIOS() ? `<p class="rules-p" style="font-size:12.5px">On iPhone, in <b>Safari</b>: tap the <b>Share</b> button (square with an up arrow) — or the <b>&#8943; menu</b> by the address bar — then <b>Add to Home Screen</b>. It hides sometimes: scroll down the list, or check <b>View More / Edit Actions</b>. Own icon, full screen, no browser bar.</p>`
    : `<p class="rules-p" style="font-size:12.5px">In Chrome: open the <b>&#8942; menu</b> and choose <b>Add to Home screen / Install app</b> (on desktop it's the install icon in the address bar).</p>`;
  return `<div class="card" style="margin-bottom:18px">
    <div style="display:flex;align-items:flex-start;gap:10px">
      <h2 style="flex:1;min-width:0">Get the app &#128241;</h2>
      ${settingsPage ? '' : '<button class="btn ghost small icon-btn" id="a2hsX" title="Dismiss — it lives in Settings" aria-label="Dismiss">&#10005;</button>'}
    </div>
    <p class="muted" style="font-size:12.5px">The League installs straight from this page — no app store, no downloads, and it never needs updating. Same live league underneath.</p>
    ${how}
    <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
      ${a2hsEvent ? '<button class="btn small" id="a2hsGo">Install the app</button>' : ''}
      ${settingsPage ? '' : '<button class="btn ghost small" id="a2hsHide">Not now</button>'}
    </div>
  </div>`;
}
function bindInstall() {
  const go = $('#a2hsGo');
  if (go) go.onclick = installApp;
  for (const id of ['a2hsHide', 'a2hsX']) {
    const el = $('#' + id);
    if (el) el.onclick = () => { localStorage.setItem(A2HS_KEY, '1'); toast('Fine — it lives in Settings if you change your mind'); render(); };
  }
}

function viewDash() {
  // a signed-out visitor must never be shown manager #1's world as "yours" —
  // Toby got a dashboard of Ben's team and reasonably concluded the app
  // thought he WAS Ben
  const identified = (whoami && whoami !== -1) || demoMode || !netOn();
  const mid = identified ? (whoami && whoami !== -1 ? whoami : state.managers[0].id) : null;
  // the hero card shows the FRONT-PAGE gameweek: the settled round until the
  // post-round waiver run processes, the new one after (Ben, 25 Aug —
  // "dashboard is still showing gw1 team?" the morning after run one)
  const cur = leagueGwIndex();
  const pair = pairingsFor(cur).find(pr => pr.includes(mid));
  const opp = pair ? (pair[0] === mid ? pair[1] : pair[0]) : null;
  const started = gwUnderway(cur); // display truth — a simulated GW counts
  const my = started ? gwManagerPoints(mid, cur) : projectedGwScore(mid, cur);
  const their = opp ? (started ? gwManagerPoints(opp, cur) : projectedGwScore(opp, cur)) : 0;
  const pct = pair ? Math.round(liveWinProb(pair[0], pair[1], cur) * 100) : null;
  const flags = mid == null ? [] : squadAt(mid, cur).filter(p => p.status && p.status !== 'a');
  const offersIn = toArr(state.trades).filter(t => t.status === 'pending' && t.to === mid);
  const myCl = myClaims(mid);
  // settled results only — the table must not shuffle mid-match (Toby, GW1
  // weekend: "Does table update live?" — killed by Chairman's order, 22 Aug)
  const table = h2hStandings(false);
  const myPos = mid == null ? 0 : table.findIndex(r => r.id === mid) + 1;
  const deadline = new Date(gwFrom(cur));
  return `
  ${foundingCard()}
  <div class="settings-grid">
    ${!identified ? `
    <div class="card" style="border-color:var(--accent)">
      <h2>${identityLoading() ? 'Finding your club&hellip;' : 'Who goes there?'}</h2>
      <p class="rules-p">${identityLoading() ? `Checking this device's sign-in against the league.` : `You're browsing as a spectator. Sign in and the league knows whose team, matchup and waivers to show you.`}</p>
      ${identityLoading() ? '' : '<button class="btn" id="dashSignIn">Sign in</button>'}
    </div>` : `
    <div class="card">
      <h2>GW${GAMEWEEKS[cur].n} — Your Matchup</h2>
      ${pair ? `
      <div class="h2h-fx fx-hero" data-mu="${pair[0]}:${pair[1]}:${cur}" style="cursor:pointer;font-size:15px">
        <span class="fx-side">${kitSvg(pair[0], 28)}<b>${esc(teamName(pair[0]))}</b></span>
        <span class="fx-score${started ? '' : ' projected'}">${started ? '' : '<span class="proj-tag">proj</span> '}${started ? liveScoreHtml(pair[0], cur) : projectedGwScore(pair[0], cur)} &ndash; ${started ? liveScoreHtml(pair[1], cur) : projectedGwScore(pair[1], cur)}</span>
        <span class="fx-side">${kitSvg(pair[1], 28)}<b>${esc(teamName(pair[1]))}</b></span>
      </div>
      <div class="venue-line">${derbyTag(pair[0], pair[1]) ? derbyTag(pair[0], pair[1]) + ' &middot; ' : ''}at ${esc(stadium(pair[0]))}${gwStatus(cur) === 'final' ? ' &middot; full time' : ''}</div>
      ${winProbBar(pair[0], pair[1], cur, mid)}
      ${(() => {
        // the two lineup shots collapse behind a summary on phones — Ian,
        // 24 Aug: "your team takes over" the dashboard. Same pattern as
        // Next Six: closed by default under 700px, open on desktop, and the
        // reader's choice is remembered.
        const savedMu = localStorage.getItem(DASHMU_KEY);
        const muOpen = savedMu != null ? savedMu === '1' : !window.matchMedia('(max-width: 700px)').matches;
        return `<details id="dashMu"${muOpen ? ' open' : ''} style="margin-top:10px">
        <summary class="n6-summary muted" style="font-size:12px">Both line-ups</summary>
        <div class="mu-grid dash-mu" style="margin-top:8px">
        ${pair.map(pmid => `<div>
          <p class="muted" style="font-size:10.5px;text-align:center;margin-bottom:2px">${kitSvg(pmid)} ${esc(teamName(pmid))}</p>
          ${dashMiniPitch(pmid, cur)}
        </div>`).join('')}
        </div>
      </details>`;
      })()}` : '<p class="muted">No fixture this week — playoffs or the off-season.</p>'}
      <p class="muted" style="font-size:12px;margin-top:10px">${started ? 'Lineups are locked.' : `Lineup locks ${deadline.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`} You sit <b style="color:var(--text)">${myPos}${['th','st','nd','rd'][((myPos%100>10&&myPos%100<14)?0:Math.min(myPos%10,4))] || 'th'}</b>.</p>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="btn small" data-goto="team">Set my lineup</button>
        <button class="btn ghost small" data-goto="transfers">Transfers</button>
        <button class="btn ghost small" data-goto="h2h">Matches</button>
      </div>
    </div>
    <div class="dash-side-stack">
    <div class="card dash-attention">
      <h2>Needs your attention</h2>
      ${offersIn.length ? `<button type="button" class="gz-nudge offer-nudge" id="offerNudge">
        <span class="gz-nudge-tag">OFFER IN</span>
        <span class="gz-nudge-copy">${offersIn.length === 1
          ? `<b>${esc(managerName(offersIn[0].from))}</b> is after <b>${esc(tradeNames(tGet(offersIn[0])))}</b> &mdash; ${esc(tradeNames(tGive(offersIn[0])))} on the table`
          : `<b>${offersIn.length} offers</b> on your desk &mdash; your players are wanted men`}</span>
        <span class="gz-nudge-go" aria-hidden="true">&rarr;</span>
      </button>` : ''}
      ${gazetteUnread() ? `<button type="button" class="gz-nudge" id="gzNudge">
        <span class="gz-nudge-tag">NEW</span>
        <span class="gz-nudge-copy"><b>${esc(String(progTodays()?.edition || 'A new edition').replace(/^./, c => c.toUpperCase()))}</b> is out${(() => {
          // the lead headline, lifted from the paper so the nudge can never
          // promise a story the edition does not carry
          const sc = document.createElement('div'); sc.innerHTML = progTodays()?.article || '';
          const h = sc.querySelector('.prog-head')?.textContent || '';
          return h ? ` &mdash; ${esc(h)}` : '';
        })()}</span>
        <span class="gz-nudge-go" aria-hidden="true">&rarr;</span>
      </button>` : ''}
      ${flags.length ? `<h3>Squad flags</h3>${flags.map(p => `<div class="lrow" style="font-size:12.5px">${statusChip(p)} ${pname(p)} <span class="muted" style="font-size:11px">${esc(p.news || 'unavailable')}</span></div>`).join('')}` : '<p class="muted" style="font-size:12.5px">Squad fully fit. Enjoy it while it lasts.</p>'}
      <h3 style="margin-top:12px">Waivers</h3>
      <p class="muted" style="font-size:12.5px">${myCl.length ? `${myCl.length} claim${myCl.length > 1 ? 's' : ''} lodged.` : 'No claims lodged.'} <span id="wvClock">${waiverClockLine()}</span></p>
      ${(() => {
        const lastRes = [];
        for (let k = cur; k >= 0 && lastRes.length < 3; k--) {
          if (gwStatus(k) !== 'final') continue;
          const pr = pairingsFor(k).find(x => x.includes(mid));
          if (!pr) continue;
          const opp = pr[0] === mid ? pr[1] : pr[0];
          const my = gwManagerPoints(mid, k), th = gwManagerPoints(opp, k);
          lastRes.push({ k, opp, my, th, r: my > th ? 'W' : my < th ? 'L' : 'D' });
        }
        const badge = r => r === 'W' ? '<b style="color:#3fb96d">W</b>' : r === 'L' ? '<b style="color:#e05555">L</b>' : '<b class="muted">D</b>';
        return lastRes.length ? `<h3 style="margin-top:12px">Last three</h3>
          ${lastRes.map(({ k, opp, my, th, r }) => `<div class="lrow" style="font-size:12.5px;cursor:pointer" data-mu="${mid}:${opp}:${k}" title="Tap for the matchup"><span class="tag">GW${GAMEWEEKS[k].n}</span> ${badge(r)} <b>${my}&ndash;${th}</b> <span class="muted">v</span> ${kitSvg(opp)} ${esc(teamName(opp))}</div>`).join('')}` : '';
      })()}
      ${(() => {
        const next = [];
        for (let k = cur + 1; k < REGULAR_GWS && next.length < 3; k++) {
          const pr = pairingsFor(k).find(x => x.includes(mid));
          if (pr) next.push({ k, opp: pr[0] === mid ? pr[1] : pr[0] });
        }
        return next.length ? `<h3 style="margin-top:12px">Next three</h3>
          ${next.map(({ k, opp }) => `<div class="lrow" style="font-size:12.5px"><span class="tag">GW${GAMEWEEKS[k].n}</span> ${kitSvg(opp)} <b>${esc(teamName(opp))}</b> <span class="muted" style="margin-left:auto;font-size:11px">${esc(managerName(opp))}</span></div>`).join('')}` : '';
      })()}
    </div>
    ${latestBusinessCard(true)}
    </div>`}
    <div class="card">
      <h2>The Table</h2>
      <div style="overflow-x:auto"><table class="pool-table">
        <thead><tr><th></th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Pts</th></tr></thead>
        <tbody>
        ${table.map((r, i) => `<tr class="${i === 7 ? 'playoff-line' : ''}"${mid != null && r.id === mid ? ' style="background:rgba(45,212,167,.07)"' : ''}>
          <td class="muted">${i + 1}</td>
          <td>${kitSvg(r.id)} <b>${esc(r.team || r.name)}</b></td>
          <td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td>
          <td class="num gold">${r.pts}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>
      <p style="margin-top:8px"><button class="btn ghost small" data-goto="table">Full table</button></p>
    </div>
  </div>
  ${identified ? '' : latestBusinessCard(true)}
  ${vidiCard(true)}
  ${programmeCard()}
  ${installCard()}`;
}
/* ----- The Record Book, current season (sol follow-up #2): computed from
   settled truth only, tie-safe, deterministic. "Since records began" is
   reserved for marks the 25/26 archive can genuinely arbitrate; everything
   else says "this season". ----- */
function seasonRecordsNow(uptoGw) {
  const settled = [];
  for (let i = 0; i <= uptoGw && i < REGULAR_GWS; i++) if (gwStatus(i) === 'final') settled.push(i);
  if (!settled.length) return [];
  const recs = [];
  const better = { max: (a, b) => a > b, min: (a, b) => a < b };
  const scan = (key, label, dir, iter, fmt) => {
    let best = null, holders = [];
    iter((value, meta) => {
      if (value == null) return;
      if (best == null || better[dir](value, best)) { best = value; holders = [meta]; }
      else if (value === best) holders.push(meta);
    });
    if (best != null) recs.push({ key, label, value: best, holders, fmt: fmt || (v => String(v)) });
  };
  const eachResult = cb => {
    for (const g of settled) for (const [a, b] of pairingsFor(g)) {
      const sa = gwManagerPoints(a, g), sb = gwManagerPoints(b, g);
      cb(g, a, b, sa, sb); cb(g, b, a, sb, sa);
    }
  };
  scan('hi', 'Highest weekly score', 'max', emit => eachResult((g, m, o, s) => emit(s, { mid: m, gw: g, opp: o })));
  scan('lo', 'Lowest weekly score', 'min', emit => eachResult((g, m, o, s) => emit(s, { mid: m, gw: g, opp: o })));
  scan('margin', 'Biggest winning margin', 'max', emit => eachResult((g, m, o, s, so) => { if (s > so) emit(s - so, { mid: m, gw: g, opp: o }); }));
  scan('defeat', 'Most points in defeat', 'max', emit => eachResult((g, m, o, s, so) => { if (s < so) emit(s, { mid: m, gw: g, opp: o }); }));
  scan('bench', 'Worst bench decision', 'max', emit => { for (const g of settled) for (const m of state.managers) emit(benchWasteOf2(m.id, g), { mid: m.id, gw: g }); });
  // longest streaks — walk each manager's full settled sequence
  const streakScan = (key, label, test) => scan(key, label, 'max', emit => {
    for (const m of state.managers) {
      let run = 0, from = null;
      for (const g of settled) {
        const pr = pairingsFor(g).find(x => x.includes(m.id));
        if (!pr) continue;
        const o = pr[0] === m.id ? pr[1] : pr[0];
        const s = gwManagerPoints(m.id, g), so = gwManagerPoints(o, g);
        if (test(s, so)) { run++; from = from ?? g; emit(run, { mid: m.id, gw: g, from }); }
        else { run = 0; from = null; }
      }
    }
  });
  streakScan('winrun', 'Longest winning run', (s, so) => s > so);
  streakScan('loserun', 'Longest losing run', (s, so) => s < so);
  streakScan('unbeaten', 'Longest unbeaten run', (s, so) => s >= so);
  // most-transferred player. A trade writes reciprocal ledger rows, so each
  // traded player is counted once from the row where he moves OUT; ordinary
  // signings still move both the arrival and the drop once each.
  scan('shuttle', 'Most transferred player', 'max', emit => {
    const count = {};
    for (const t of state.transfers) if (t.gw <= uptoGw) {
      if (!t.trade) count[t.inId] = (count[t.inId] || 0) + 1;
      count[t.outId] = (count[t.outId] || 0) + 1;
    }
    for (const [pid, n] of Object.entries(count)) if (PLAYER_BY_ID[pid]) emit(n, { pid: +pid });
  });
  // best/worst COMPLETED transfer report (6-GW window preferred, else 3)
  const cards = state.transfers.filter(t => !t.trade || tradeBatchOf(t)[0] === t).map(t => {
    const wf = transferWindowFacts(t, 6) || transferWindowFacts(t, 3);
    return wf ? { t, wf } : null;
  }).filter(Boolean);
  if (cards.length) {
    const bestDeal = cards.reduce((a, x) => x.wf.diff > a.wf.diff ? x : a);
    const worstDeal = cards.reduce((a, x) => x.wf.diff < a.wf.diff ? x : a);
    recs.push({ key: 'bestdeal', label: 'Best completed transfer', value: bestDeal.wf.diff, holders: [{ mid: bestDeal.t.managerId, gw: bestDeal.t.gw, pid: bestDeal.t.inId }], fmt: v => `${v >= 0 ? '+' : ''}${v} net` });
    recs.push({ key: 'worstdeal', label: 'Worst completed transfer', value: worstDeal.wf.diff, holders: [{ mid: worstDeal.t.managerId, gw: worstDeal.t.gw, pid: worstDeal.t.inId }], fmt: v => `${v >= 0 ? '+' : ''}${v} net` });
  }
  // highest single player performance in a starting XI
  scan('perf', 'Highest player score', 'max', emit => {
    for (const g of settled) for (const m of state.managers) for (const pid of effectiveXI(m.id, g).xi) emit(gwPlayerPoints(pid, g), { mid: m.id, gw: g, pid });
  });
  // biggest handicap overturned in the playoffs — only when the bracket is real
  const po = typeof playoffState === 'function' ? playoffState() : null;
  if (po && po.qfWinners) {
    scan('overturn', 'Biggest handicap overturned', 'max', emit => {
      po.qfWinners.forEach((wmid, k) => {
        const pair = [po.seeds[k], po.seeds[7 - k]];
        if (wmid === pair[1]) emit(po.handicaps[k], { mid: wmid, gw: REGULAR_GWS }); // lower seed beat the head start
      });
    });
  }
  return recs;
}
const benchWasteOf2 = (mid, g) => Math.max(0, optimalXI(mid, g) - gwManagerPoints(mid, g));
// archive arbitration: 25/26 extremes when the archive is genuinely loaded
function archiveExtremes() {
  const ms = (typeof LEAGUE_HISTORY !== 'undefined' && LEAGUE_HISTORY?.epl25?.matches) || null;
  if (!ms || !ms.length) return null;
  let hi = -Infinity, lo = Infinity, margin = 0;
  for (const m of ms) { hi = Math.max(hi, m.a, m.b); lo = Math.min(lo, m.a, m.b); margin = Math.max(margin, Math.abs(m.a - m.b)); }
  return { hi, lo, margin };
}
function recordStatus(recs, prevRecs, latestGw) {
  return recs.map(r => {
    const prev = prevRecs.find(p => p.key === r.key);
    const touchedNow = r.holders.some(h => h.gw === latestGw);
    let status = '';
    if (touchedNow) {
      if (!prev) status = 'new';
      else if (r.value !== prev.value) status = 'broken';
      else if (r.holders.length > prev.holders.length) status = 'tied';
    }
    return { ...r, status };
  });
}
function recordBookNowCard() {
  const settled = [];
  for (let i = 0; i < REGULAR_GWS; i++) if (gwStatus(i) === 'final') settled.push(i);
  if (!settled.length) return '';
  const last = settled.at(-1);
  const recs = recordStatus(seasonRecordsNow(last), settled.length > 1 ? seasonRecordsNow(settled.at(-2)) : [], last);
  const arch = archiveExtremes();
  const scope = r => {
    if (!arch) return 'this season';
    if (r.key === 'hi' && r.value > arch.hi) return `best in the loaded 25/26–26/27 archive (25/26's best was ${arch.hi})`;
    if (r.key === 'lo' && r.value < arch.lo) return `lowest in the loaded 25/26–26/27 archive (25/26's low was ${arch.lo})`;
    if (r.key === 'margin' && r.value > arch.margin) return `widest in the loaded 25/26–26/27 archive (25/26's widest was ${arch.margin})`;
    return 'this season';
  };
  const who = h => h.pid != null && !h.mid ? esc(PLAYER_BY_ID[h.pid]?.name || '?')
    : `${esc(teamName(h.mid))}${h.pid != null ? ` (${esc(PLAYER_BY_ID[h.pid]?.name || '?')})` : ''}`;
  const rows = recs.map(r => `<div class="lrow" style="font-size:12.5px;flex-wrap:wrap">
    <span style="min-width:170px"><b>${esc(r.label)}</b></span>
    <span>${r.holders.map(who).join(' & ')} — <b class="gold">${esc(r.fmt(r.value))}</b>
      ${r.holders[0].gw != null && GAMEWEEKS[r.holders[0].gw] ? `<span class="muted" style="font-size:11px">GW${GAMEWEEKS[r.holders[0].gw].n}${r.holders[0].opp != null ? ` v ${esc(teamName(r.holders[0].opp))}` : ''}</span>` : ''}
      <span class="muted" style="font-size:10.5px">&middot; ${esc(scope(r))}</span>
      ${r.status ? `<span class="tag live-tag">${r.status.toUpperCase()}</span>` : ''}</span>
  </div>`).join('');
  return `<div class="card"><h2>The Record Book <span class="muted" style="font-weight:400;font-size:12px">this season, settled truth only</span></h2>${rows}</div>`;
}

/* ----- Transfer Report Cards (sol follow-up #1): every completed move gets
   revisited after 3 and 6 COMPLETED gameweeks from its effective GW. Facts
   only — points each side actually produced in the exact window, XI points
   realised, honest notes for zero appearances. No verdict before the window
   completes; failed/private claims are never material here because only
   EXECUTED moves live in state.transfers. ----- */
function tradeBatchOf(t) {
  if (!t.trade) return [t];
  if (t.trade !== true) return state.transfers.filter(u => u.trade === t.trade && u.managerId === t.managerId);
  // Legacy local/demo ledgers used boolean true rather than the trade id.
  return state.transfers.filter(u => u.trade && u.managerId === t.managerId && u.gw === t.gw && Math.abs((u.t || 0) - (t.t || 0)) < 5000);
}
function transferWindowFacts(t, horizon) {
  const gws = [];
  for (let i = t.gw; i < Math.min(t.gw + horizon, REGULAR_GWS) && gws.length < horizon; i++) {
    if (gwStatus(i) === 'final') gws.push(i);
    else if (gwHasStarted(i) || i <= currentGwIndex()) continue; // blank/live weeks don't count as completed
    else break;
  }
  if (gws.length < horizon) return null; // window not complete — no judgement yet
  const batch = tradeBatchOf(t);
  const sum = (pid, realised) => gws.reduce((tot, g) => {
    if (realised && !effectiveXI(t.managerId, g).xi.includes(pid)) return tot;
    return tot + gwPlayerPoints(pid, g);
  }, 0);
  const apps = pid => gws.reduce((n, g) => n + (appearedInGw(pid, g) ? 1 : 0), 0);
  const inn = batch.map(b => ({ p: PLAYER_BY_ID[b.inId], pts: sum(b.inId), xi: sum(b.inId, true), apps: apps(b.inId) })).filter(x => x.p);
  const out = batch.map(b => ({ p: PLAYER_BY_ID[b.outId], pts: sum(b.outId), apps: apps(b.outId) })).filter(x => x.p);
  const inPts = inn.reduce((a, x) => a + x.pts, 0), outPts = out.reduce((a, x) => a + x.pts, 0);
  return { gws, inn, out, inPts, outPts, diff: inPts - outPts, batch };
}
function transferVerdict(wf, horizon) {
  const d = wf.diff;
  if (d >= 20) return 'daylight robbery';
  if (d >= 10) return 'inspired business';
  if (d >= 3) return horizon === 3 ? 'a promising start' : 'good business';
  if (d >= -2) return 'a sideways move';
  if (d >= -9) return horizon === 3 ? 'jury still out' : 'a sideways move, generously';
  return 'an expensive mistake';
}
function reportCardHtml(t) {
  const kind = t.trade ? 'trade' : t.windowDraft ? 'Window Draft' : t.waiver ? 'waiver claim' : 'Trough signing';
  const w3 = transferWindowFacts(t, 3);
  const w6 = transferWindowFacts(t, 6);
  const windowRow = (wf, label) => {
    if (!wf) return '';
    const inTxt = wf.inn.map(x => `${esc(x.p.name)} ${x.pts}${x.apps === 0 ? ' (never appeared)' : ''}${x.xi < x.pts ? ` — ${x.xi} of them in the XI` : ''}`).join(', ');
    const outTxt = wf.out.length ? wf.out.map(x => `${esc(x.p.name)} ${x.pts}${x.apps === 0 ? ' (never appeared)' : ''}`).join(', ') : '—';
    return `<div class="lrow" style="font-size:12px;flex-wrap:wrap"><span class="tag">${label}</span>
      <span>in: <b>${inTxt}</b> &middot; out: ${outTxt} &middot; net <b>${wf.diff >= 0 ? '+' : ''}${wf.diff}</b> — <b>${esc(transferVerdict(wf, wf.gws.length))}</b></span></div>`;
  };
  const body = (w6 ? windowRow(w6, '6 GWs') : '') + (w3 ? windowRow(w3, '3 GWs') : '');
  return body || `<div class="lrow muted" style="font-size:12px">Report card opens after three completed gameweeks from GW${GAMEWEEKS[t.gw]?.n ?? '?'} — the Gazette does not judge early. Much.</div>`;
}

// the post-waivers snapshot (Ben, UAT night: "there should be recent
// transfers and waivers and trades on the dashboard tbf"). A multi-player
// trade is one piece of business per club, not four near-identical ledger
// lines; the full ungrouped audit trail remains one tap away in Transfers.
function latestBusinessCard(compact = false) {
  const latestRun = lastWaiverRun();
  if (!state.transfers.length && !latestRun) return '';
  const kindOf = t => t.trade ? 'trade' : t.waiver ? 'waiver' : t.windowDraft ? 'window' : 'trough';
  const marks = { trade: '&#8644;', waiver: 'W', window: '&#9638;', trough: '+' };
  const labels = { trade: 'TRADE', waiver: 'WAIVER', window: 'WINDOW', trough: 'TROUGH' };
  const grouped = new Map();
  [...state.transfers].map((t, i) => ({ t, i })).reverse().forEach(({ t, i }) => {
    const tradeKey = t.trade
      ? (t.trade === true ? `${t.managerId}:${t.gw}:${Math.floor((t.t || 0) / 5000)}` : `${t.trade}:${t.managerId}`)
      : `move:${i}`;
    const key = t.trade ? `trade:${tradeKey}` : tradeKey;
    if (!grouped.has(key)) grouped.set(key, { ...t, ins: [], outs: [], kind: kindOf(t) });
    const g = grouped.get(key);
    if (PLAYER_BY_ID[t.inId] && !g.ins.includes(t.inId)) g.ins.unshift(t.inId);
    if (PLAYER_BY_ID[t.outId] && !g.outs.includes(t.outId)) g.outs.unshift(t.outId);
  });
  const playerList = ids => ids.map(id => pname(PLAYER_BY_ID[id])).join('<span class="business-plus"> + </span>');
  const allGroups = [...grouped.values()];
  // Publish the latest waiver round as a round, including a nil return. The
  // public transfer ledger gives every successful claim the runStart stamp;
  // waiverMeta supplies the stamp even when nothing landed.
  const publishedRun = latestRun || Math.max(0, ...state.transfers.filter(t => t.waiver).map(t => +t.t || 0));
  const waiverResults = publishedRun ? allGroups.filter(g => g.kind === 'waiver' && Math.abs((+g.t || 0) - publishedRun) < 1000) : [];
  const pinned = new Set(waiverResults);
  // business done SINCE the run leads the wire (Ben, 25 Aug: "latest
  // transfers after waivers aren't pulling through") — a 23-claim round was
  // eating every visible slot, so a Monday trough signing never surfaced.
  const rest = allGroups.filter(g => !pinned.has(g));
  const sinceRun = publishedRun ? rest.filter(g => (+g.t || 0) > publishedRun + 1000) : [];
  const older = rest.filter(g => !sinceRun.includes(g));
  const visible = [...sinceRun, ...waiverResults, ...older.slice(0, Math.max(0, 6 - waiverResults.length - sinceRun.length))];
  const rowHtml = g => `<div class="business-row">
    <span class="business-mark business-${g.kind}" aria-hidden="true">${marks[g.kind]}</span>
    <div class="business-main">
      <div class="business-who">${kitSvg(g.managerId, 17)} <b>${esc(teamName(g.managerId))}</b> <span class="tag">${labels[g.kind]}</span></div>
      <div class="business-flow">
        <span class="business-label business-label-in">&#8593; IN</span> <span class="business-players business-players-in">${playerList(g.ins)}</span>
        ${g.outs.length ? `<span class="business-label business-label-out">&#8595; OUT</span> <span class="business-players business-players-out">${playerList(g.outs)}</span>` : ''}
      </div>
    </div>
    <span class="business-gw"><small>COUNTS</small><b>GW${GAMEWEEKS[g.gw]?.n ?? '?'}</b></span>
  </div>`;
  // a 23-deal waiver round made this card a broadsheet (Ben, 25 Aug: "far
  // too long") — fold everything past the first few behind one button.
  // window._bizOpen survives re-renders the way _trSquadOpen does.
  const FOLD_AT = 4;
  const bizOpen = !!window._bizOpen;
  const shownRows = bizOpen ? visible : visible.slice(0, FOLD_AT);
  const foldedCount = visible.length - shownRows.length;
  const waiverNotice = publishedRun ? `<div class="business-run">
    <b>WAIVER RESULTS</b> <span>${waiverResults.length ? `${waiverResults.length} CLAIM${waiverResults.length === 1 ? '' : 'S'} LANDED` : 'NO CLAIMS LANDED'}</span>
    <small>${new Date(publishedRun).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()}</small>
  </div>` : '';
  // the run banner sits where the run happened: below any business done
  // since it, above the round's own claims — not stapled to the masthead
  // where it captioned deals it had nothing to do with.
  const noticeAt = Math.min(sinceRun.length, shownRows.length);
  const rows = shownRows.map(rowHtml).map((h, i) => (i === noticeAt ? waiverNotice + h : h)).join('')
    + (noticeAt >= shownRows.length ? waiverNotice : '')
    + (foldedCount > 0 ? `<button class="btn ghost small" id="bizMore" style="width:100%;margin-top:6px">SHOW ALL ${visible.length} DEALS &#9662;</button>` : '')
    + (bizOpen && visible.length > FOLD_AT ? `<button class="btn ghost small" id="bizLess" style="width:100%;margin-top:6px">FOLD THE WIRE AWAY &#9652;</button>` : '');
  return `<div class="card business-card${compact ? ' business-compact' : ''}">
    <div class="business-head">
      <div><span class="business-kicker">THE TRANSFER WIRE</span><h2>LATEST BUSINESS</h2></div>
      <span class="muted">COMPLETED DEALS ONLY</span>
    </div>
    <div class="business-feed">${rows}</div>
    <button class="btn ghost business-history" data-goto="transfers">OPEN TRANSFER HISTORY <span aria-hidden="true">&#8594;</span></button>
  </div>`;
}

/* ----- The Matchday Programme (Marc + Ben, 2 Aug): preview and review
   ARTICLES on the Dashboard. The preview goes to print only once the teams
   are locked (first kick-off); the review publishes when the week settles.
   Prose is deterministic — seeded phrase pools, same article every render. */
/* early-season storylines (Ben, mock night): whose draft class is delivering,
   who's dealing well in the Trough, best pick-ups — the Gazette keeps receipts */
function draftClassTable() {
  if (!state.draft.picks.length) return [];
  return state.managers.map(m => {
    const picks = state.draft.picks.filter(pk => pk.managerId === m.id).map(pk => PLAYER_BY_ID[pk.playerId]).filter(Boolean);
    let pts = 0, star = null, starPts = -1;
    for (const p of picks) {
      const v = playerPoints(p.id).pts;
      pts += v;
      if (v > starPts) { star = p; starPts = v; }
    }
    return { mid: m.id, pts, star, starPts };
  }).sort((a, b) => b.pts - a.pts);
}
function bestPickups(uptoGw) {
  const out = [];
  for (const t of state.transfers) {
    if (t.trade || t.windowDraft) continue;
    const p = PLAYER_BY_ID[t.inId];
    if (!p) continue;
    let pts = 0;
    for (let g = t.gw; g <= uptoGw; g++) pts += gwPlayerPoints(t.inId, g);
    out.push({ mid: t.managerId, p, pts, waiver: !!t.waiver });
  }
  return out.sort((a, b) => b.pts - a.pts);
}
// the deadline has passed once the GW's own deadline stamp is behind us —
// Marc's ruling: the matchday edition prints AT the deadline, not at kick-off
const gwDeadlinePassed = i => GAMEWEEKS[i] && new Date(GAMEWEEKS[i].from).getTime() <= Date.now();
// which back-edition the reader has open (null = today's paper). The archive
// is generated, not stored — reviewArticle() rebuilds any settled week from
// state, so every edition is permanent for free (sol product review #5).
let progView = { gw: null };
const progMasthead = (edition, gwN) => `<div class="prog-plate">
  <div class="prog-nameplate">
    <img class="prog-seal" src="icons/icon-192.png" alt="The League crest">
    <div><div class="prog-flag">THE LEAGUE</div><div class="prog-title">GAZETTE</div></div>
    <span class="prog-seal-spacer" aria-hidden="true"></span>
  </div>
  <div class="prog-date"><span>${edition}</span><span>${gwN != null ? `Gameweek ${gwN}` : 'Season 2026/27'}</span><span>Est. 2015</span></div>
</div>`;
// what's on today's front step: {edition, gwN, article} or null
function progTodays() {
  const cur = currentGwIndex();
  const pick = (arr, seed) => arr[seed % arr.length];
  if ((gwDeadlinePassed(cur) || gwUnderway(cur)) && gwStatus(cur) !== 'final') {
    const art = previewArticle(cur, pick);
    if (art) return { edition: 'matchday edition', gwN: GAMEWEEKS[cur].n, article: art };
  }
  const last = lastFinalGw();
  if (last >= 0) return { edition: 'review edition', gwN: GAMEWEEKS[last].n, article: reviewArticle(last, pick), gw: last };
  // nothing settled yet: once the board is full the Post-Draft Special is
  // the paper (Ben, draft night); before that the Season Preview is edition
  // zero (Ben, 16 Aug). Both retire when a real edition exists above.
  if (typeof Gazette !== 'undefined' && Gazette.draftSpecial && state.draft.picks.length) {
    const art = Gazette.draftSpecial();
    if (art) return { edition: 'post-draft special', gwN: null, article: art };
  }
  if (typeof Gazette !== 'undefined' && Gazette.preview) {
    const art = Gazette.preview();
    if (art) return { edition: 'the season preview', gwN: null, article: art };
  }
  return null;
}
// the dashboard shows a FRONT PAGE, not the whole paper (Ben: "make it
// clickable into so it doesn't take the screen over") — nameplate, the
// lead headline and standfirst, one button. The edition opens in the
// reading room overlay.
/* Has this reader seen today's paper? (Ben, 21 Aug: "how can we inform people
   the Gazette has new content?") An edition is identified by its name and
   gameweek, so the marker clears itself the moment a new one goes to press.
   Per-device, like every other 'seen' stamp here — no backend, nothing shared. */
const GZ_SEEN_KEY = `${LS_NS}-gazette-seen`;
const gazetteEditionId = () => { const t = progTodays(); return t ? `${t.edition}:${t.gwN ?? '-'}` : ''; };
const gazetteUnread = () => { const id = gazetteEditionId(); return !!id && localStorage.getItem(GZ_SEEN_KEY) !== id; };
const markGazetteRead = () => { const id = gazetteEditionId(); if (id) localStorage.setItem(GZ_SEEN_KEY, id); };
// the WhatsApp drop — the group chat is how this league actually finds out
// anything (the Minutes and the GW preview already work exactly this way)
function gazetteShareText() {
  const today = progTodays();
  if (!today) return '';
  const scratch = document.createElement('div');
  scratch.innerHTML = today.article;
  const head = scratch.querySelector('.prog-head')?.textContent || '';
  const firstP = scratch.querySelector('.prog-story p, p')?.textContent || '';
  const stand = firstP.split(/(?<=[.!?])\s/)[0] || '';
  const others = [...scratch.querySelectorAll('.prog-head')].slice(1, 4).map(h => `· ${h.textContent}`);
  return [`📰 THE LEAGUE GAZETTE — ${String(today.edition).toUpperCase()}${today.gwN ? ` · GW${today.gwN}` : ''}`,
    '', head, stand, '', ...(others.length ? ['Also inside:', ...others, ''] : []),
    'Read it: https://theleaguehq.co.uk/'].join('\n');
}
function programmeCard() {
  if (state.phase !== 'season' || !state.draft.picks.length) return '';
  const today = progTodays();
  if (!today) {
    return `<div class="card prog-card">
      <p class="muted" style="font-size:12.5px">First edition goes to print when GW1's teams are locked. The presses are warm; the takes are warmer.</p></div>`;
  }
  // the lead's headline + first sentence, lifted from the article itself so
  // the teaser can never disagree with the paper
  const scratch = document.createElement('div');
  scratch.innerHTML = today.article;
  const head = scratch.querySelector('.prog-head')?.textContent || '';
  const firstP = scratch.querySelector('.prog-story p, p')?.textContent || '';
  const byline = scratch.querySelector('.prog-by')?.textContent || 'The League Gazette football desk';
  const standfirst = firstP.split(/(?<=[.!?])\s/)[0] || '';
  return `<div class="card prog-card">
    ${progMasthead(today.edition, today.gwN)}
    <div class="prog-front">
      <div class="prog-front-copy">
        <div class="prog-front-label">LEAD STORY</div>
        ${head ? `<div class="prog-head prog-head-lead">${esc(head)}</div>` : ''}
        ${standfirst ? `<p class="prog-standfirst">${esc(standfirst)}</p>` : ''}
        <div class="prog-front-by">${esc(byline)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <button class="btn prog-read" id="progRead">READ FULL EDITION <span aria-hidden="true">&rarr;</span></button>
        <button class="btn ghost small" id="progShare" title="Copy the front page for the group chat">&#128203; Share</button>
      </div>
    </div>
    ${gazetteUnread() ? '<span class="prog-new" aria-label="New edition">NEW EDITION</span>' : ''}
  </div>`;
}
/* Everything the paper has ever printed, newest first (Ben, GW1 night:
 * "keep stories for a week... old news moves down the page... then move
 * out"). Editions are deterministic functions of state, so each print date
 * is DERIVED from the calendar rather than stored — which also makes every
 * back edition immutable by construction: a review prints when its gameweek
 * settles, a matchday edition at its deadline, the Post-Draft Special on
 * GW1 eve, the Season Preview in the build-up week. `article` is lazy so
 * listing the archive never writes a word. */
function gazetteEditions() {
  const pick = (arr, seed) => arr[seed % arr.length];
  const gw1 = GAMEWEEKS[0] ? new Date(GAMEWEEKS[0].from).getTime() : Date.now();
  const eds = [];
  for (let i = 0; i < REGULAR_GWS; i++) {
    const st = gwStatus(i);
    if (st === 'final') {
      eds.push({ key: `rev${i}`, kind: 'review', edition: 'review edition', gwN: GAMEWEEKS[i].n, gw: i,
        printed: new Date(GAMEWEEKS[i].to || GAMEWEEKS[i].from).getTime() + 20 * 3600e3,
        article: () => reviewArticle(i, pick) });
    } else if ((gwDeadlinePassed(i) || gwUnderway(i))) {
      const art = previewArticle(i, pick);
      if (art) eds.push({ key: `md${i}`, kind: 'matchday', edition: 'matchday edition', gwN: GAMEWEEKS[i].n, gw: null,
        printed: new Date(GAMEWEEKS[i].from).getTime(), article: () => art });
    }
  }
  if (typeof Gazette !== 'undefined' && Gazette.draftSpecial && state.draft.picks.length) {
    const art = Gazette.draftSpecial();
    if (art) eds.push({ key: 'special', kind: 'special', edition: 'post-draft special', gwN: null, gw: null,
      printed: gw1 - 24 * 3600e3, article: () => art });
  }
  if (typeof Gazette !== 'undefined' && Gazette.preview) {
    const art = Gazette.preview();
    if (art) eds.push({ key: 'preview', kind: 'preview', edition: 'the season preview', gwN: null, gw: null,
      printed: gw1 - 5 * 864e5, article: () => art });
  }
  return eds.sort((a, b) => b.printed - a.printed);
}
// which edition in the log is the one progTodays() serves as the paper
function gazetteLeadKey(today) {
  if (!today) return null;
  if (today.edition === 'matchday edition') return `md${currentGwIndex()}`;
  if (today.edition === 'review edition') return `rev${today.gw}`;
  if (today.edition === 'post-draft special') return 'special';
  if (today.edition === 'the season preview') return 'preview';
  return null;
}

// the reading room: the full edition, typeset for reading, archive inside
function gazetteSheet(gwIdx = null) {
  const pick = (arr, seed) => arr[seed % arr.length];
  const settled = [];
  for (let i = 0; i < REGULAR_GWS; i++) if (gwStatus(i) === 'final') settled.push(i);
  const today = progTodays();
  const eds = gazetteEditions();
  // what is on the lectern: today's paper, a settled review, or one of the
  // named pre-season editions (they live in the archive forever — the
  // Post-Draft Special must not vanish the day GW1 settles; Ben, GW1 night)
  let showing = today, atKey = null;
  if (gwIdx === 'special' || gwIdx === 'preview') {
    const e = eds.find(x => x.kind === gwIdx);
    if (e) { showing = { edition: `${e.edition} — from the archive`, gwN: e.gwN, article: e.article(), gw: null }; atKey = e.key; }
  } else if (gwIdx != null && settled.includes(gwIdx)) {
    showing = { edition: gwIdx === today?.gw ? 'review edition' : 'review edition — from the archive', gwN: GAMEWEEKS[gwIdx].n, article: reviewArticle(gwIdx, pick), gw: gwIdx };
    atKey = `rev${gwIdx}`;
  }
  if (!showing) return;
  progView.gw = showing.gw ?? null;
  const at = showing.gw ?? null;
  // this week's back pages: everything printed in the last seven days that
  // isn't the edition on the lectern, stacked beneath it in descending
  // freshness — old news moves down the page before it moves out (Ben)
  const leadKey = atKey || gazetteLeadKey(today);
  const backPages = atKey ? [] : eds.filter(e =>
    e.key !== leadKey && Date.now() - e.printed < 7 * 864e5);
  const backHtml = backPages.length ? `<div class="prog-backpages">
    ${backPages.map(e => `<div class="prog-backpage">
      <div class="prog-backpage-rule">Earlier this week &middot; ${esc(e.edition)}${e.gwN != null ? ` &middot; Gameweek ${e.gwN}` : ''}</div>
      ${e.article()}
    </div>`).join('')}
  </div>` : '';
  // show the nav whenever there is anywhere to GO — another settled edition,
  // a named back edition, or today's paper. The old count-based condition
  // vanished the whole nav when you were READING the only archived edition
  // while today's paper was a different one, stranding the reader in the
  // archive with no way back (product review #5, went red 21 Aug).
  const named = eds.filter(e => e.kind === 'special' || e.kind === 'preview');
  const showToday = atKey != null && today;
  const archNav = settled.some(i => `rev${i}` !== atKey) || named.some(e => e.key !== atKey) || showToday ? `
    <div class="prog-arch">
      <span class="muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.12em">From the archive</span>
      ${settled.map(i => `<button class="btn ghost small" data-progw="${i}" ${atKey === `rev${i}` ? 'disabled' : ''}>GW${GAMEWEEKS[i].n}</button>`).join('')}
      ${named.map(e => `<button class="btn ghost small" data-progw="${e.key}" ${atKey === e.key ? 'disabled' : ''}>${e.kind === 'special' ? 'Draft Special' : 'Season Preview'}</button>`).join('')}
      ${showToday ? '<button class="btn small" data-progw="today">Today&rsquo;s paper</button>' : ''}
    </div>` : '';
  const replacing = !!document.querySelector('.gazette-room');
  document.querySelectorAll('.gazette-room').forEach(x => x.closest('.overlay')?.remove());
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="card gazette-room" role="dialog" aria-label="The League Gazette">
    <button class="btn ghost small icon-btn gz-close" id="gzClose" title="Fold the paper" aria-label="Fold the paper">&#10005;</button>
    ${progMasthead(showing.edition, showing.gwN)}
    ${showing.article}
    ${mediaSection()}
    ${backHtml}
    ${archNav}
  </div>`;
  document.body.appendChild(ov);
  if (!replacing) pushOvState();
  ov.onclick = e => { if (e.target === ov) closeOv(ov); };
  ov.querySelector('#gzClose').onclick = () => closeOv(ov);
  ov.querySelectorAll('[data-progw]').forEach(b => b.onclick = () => {
    const v = b.dataset.progw;
    gazetteSheet(v === 'today' ? null : (v === 'special' || v === 'preview') ? v : +v);
  });
  ov.querySelectorAll('[data-podopen]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    podcastSheet(b.dataset.podopen);
  });
}
/* ================= The Podcunt Network =================
   Marc, 17 Aug: "the links to the podcasts should appear somewhere near the
   gazette as part of a full media overview". So the reading room grows a
   media desk: both shows, their current episode, and a transcript you can
   read or be read to. The generator is js/podcast.js; everything here is
   presentation and the browser's own voice. */
/* Marc, 18 Aug: "id like the two pilots to be positioned in the season preview
   page. The post draft episode and then the normal schedule should be
   positioned alongside the gazette."

   So the desk follows the edition it is printed in. Edition zero — the Season
   Preview, before a ball is kicked — carries the two launch episodes, framed
   as part of that edition rather than as a permanent fixture. Every edition
   after it carries whatever is current: the draft reaction, then the previews
   and reviews as they land. Same component, different bill. */
function mediaSection() {
  if (typeof Podcast === 'undefined') return '';
  /* The hinge is the DRAFT, not the edition. Straight after draft night the
     Gazette is still printing edition zero — no football has happened — but
     the stations have already moved on to the draft reaction, and the pilots
     have retired. Asking the generator which episode is current gets this
     right on its own: it returns a pilot only while there is no draft. */
  const lead = Podcast.latest(Podcast.ON_AIR[0]);
  const launch = !!lead && lead.kind === 'pilot';
  const rows = Podcast.ON_AIR.map(id => {
    const ep = Podcast.latest(id);
    if (!ep) return '';
    const s = ep.show;
    return `<div class="pod-row" data-podopen="${esc(ep.id)}">
      <div class="pod-badge pod-${esc(s.id)}">${Podcast.logoSvg(s.id, 34)}</div>
      <div class="pod-main">
        <b>${esc(s.name)}</b>
        <span class="muted" style="font-size:11.5px">${esc(s.dek)}</span>
        <span style="font-size:12.5px">${esc(ep.title)} <span class="muted">&middot; ${esc(ep.dek)}</span></span>
      </div>
      <button class="btn ghost small" data-podopen="${esc(ep.id)}">Open</button>
    </div>`;
  }).join('');
  if (!rows.trim()) return '';
  /* The back catalogue (Ben, 21 Aug: "we should file the old eps somewhere").
     The desk only ever carries what is current, so the moment the GW1 previews
     published, draft night became unreachable — recordings we had paid to cut,
     with no door to them. Everything the schedule has ever published, newest
     first, minus the two on the desk. */
  const currentIds = new Set(Podcast.ON_AIR.map(id => Podcast.latest(id)?.id).filter(Boolean));
  const back = Podcast.published()
    .filter(p => !currentIds.has(p.id))
    .map(p => ({ p, ep: Podcast.episode(p.show, p.kind, p.gw) }))
    .filter(x => x.ep);
  const archive = back.length ? `<details class="pod-archive">
    <summary>The back catalogue <span class="tag">${back.length}</span></summary>
    <p class="muted" style="font-size:11.5px;margin:6px 0 8px">Every episode either station has broadcast. Nothing is ever deleted; the Committee has learned what happens to things that are.</p>
    ${back.map(({ p, ep }) => `<div class="pod-row" data-podopen="${esc(ep.id)}">
      <div class="pod-badge pod-${esc(p.show)}">${Podcast.logoSvg(p.show, 26)}</div>
      <div class="pod-main">
        <span style="font-size:12.5px">${esc(ep.title)}</span>
        <span class="muted" style="font-size:11.5px">${esc(ep.dek)}</span>
      </div>
      <button class="btn ghost small" data-podopen="${esc(ep.id)}">Open</button>
    </div>`).join('')}
  </details>` : '';
  return launch
    ? `<div class="prog-sec">Also in edition zero: the wireless</div>
      <p class="muted" style="font-size:11.5px;margin-bottom:8px">Both stations open their season the same afternoon. Neither has heard the other, and it shows.</p>
      ${rows}${archive}`
    : `<div class="prog-sec">The Media Desk</div>
      <p class="muted" style="font-size:11.5px;margin-bottom:8px">Two shows, the same gameweek, no agreement of any kind.</p>
      ${rows}${archive}`;
}
// id → the episode object, without trusting the id string
function podById(id) {
  if (typeof Podcast === 'undefined') return null;
  const e = Podcast.published().find(x => x.id === id);
  return e ? Podcast.episode(e.show, e.kind, e.gw) : null;
}
let _podStop = null; // set while an episode is being read aloud
let _podAudio = null; // the <audio> currently playing a RECORDED line, if any
function podStopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch { /* not available */ }
  if (_podAudio) { try { _podAudio.pause(); } catch { /* gone */ } _podAudio = null; }
  if (_podStop) { _podStop(); _podStop = null; }
}
/* ---- the recordings ----
   Marc, 18 Aug: "this joke doesnt work unless the people sound like people not
   robots". It doesn't, and no browser speech engine is ever going to sound
   like Andy Grey. So the player takes REAL audio wherever real audio exists
   and only falls back to the browser's voice where it doesn't.

   The recordings are ordinary files under audio/pod/<episode-id>/, one per
   spoken block, named by its index in ep.blocks — exactly the units the player
   already walks. That keeps the captions, the running order and the
   synthesised stings working untouched.

   Marc, 18 Aug: "ben and i have a new approach which involves using one of the
   paid options to improve the quality of the voices and record some of our
   own". So the manifest is per LINE, not per episode:

     { "gfw-pilot": { "1": "1.mp3", "4": "4.m4a" } }

   A line with a file plays that file; a line without gets read by the browser.
   That means a bought voice and a real human and the robot can all be in the
   same episode while it is being built up, which is what recording your own
   in a spare hour actually looks like. The extension comes from the manifest,
   so a phone recording can be dropped in as it is — `node scripts/render_pods.js
   --scan` rebuilds the manifest from whatever is on disk.
   Nothing here fetches from anywhere but this origin. */
let _podRec = null; // episode id → { blockIndex: filename }; null until asked
async function podRecordings() {
  if (_podRec) return _podRec;
  _podRec = {};
  try {
    const r = await fetch('audio/pod/index.json', { cache: 'no-cache' });
    if (r.ok) {
      const j = await r.json();
      // the old shape was a bare list of fully-cut episodes; still honoured,
      // so a manifest written before the hand-recording work keeps playing
      if (Array.isArray(j)) j.forEach(id => { _podRec[String(id)] = '*'; });
      else if (j && typeof j === 'object') for (const [id, lines] of Object.entries(j)) {
        if (lines && typeof lines === 'object') _podRec[id] = lines;
      }
    }
  } catch { /* no recordings shipped yet — the browser voice carries it */ }
  return _podRec;
}
/* The file for one line, or null if nobody has recorded it yet.
   `key` is Podcast.lineKey(block) — the line's TEXT, not its position. Filing
   by position meant moving the ad break re-pointed every rendered file at
   somebody else's words (caught by the smoke test, 18 Aug). */
function podLineSrc(rec, epId, key) {
  const lines = rec[epId];
  if (!lines || key == null) return null;
  if (lines === '*') return `audio/pod/${encodeURIComponent(epId)}/${key}.mp3`;
  const f = lines[key] || lines[String(key)];
  // the manifest names a file inside the episode's own folder and nothing else
  if (!f || typeof f !== 'string' || /[\/\\]|\.\./.test(f)) return null;
  return `audio/pod/${encodeURIComponent(epId)}/${encodeURIComponent(f)}`;
}
/* ---- the scrub bar ----
   Ben, 16 Aug: "can you make them scrubbable in the app?" The player walks the
   episode line by line, so there is no one file to seek through — instead we
   compute the episode's timeline up front: every recorded line's real duration
   (metadata only, nothing plays), plus the fixed beats the player itself adds
   (2.7s stings, 0.6s ad lead-in, 0.26s between turns). Dragging the bar maps a
   moment on that timeline back to a block and an offset inside it.
   The bar only appears when EVERY spoken line has a recording — you cannot
   seek inside a browser voice, so a part-cut episode keeps the plain player
   rather than a bar that lies. */
let _podTl = {}; // episode id → Promise<timeline|null>
const podAudioDur = src => new Promise(res => {
  const a = new Audio();
  a.preload = 'metadata';
  a.onloadedmetadata = () => res(isFinite(a.duration) ? a.duration : 0);
  a.onerror = () => res(0);
  a.src = src;
});
function podEpTimeline(ep, rec) {
  if (ep.id in _podTl) return _podTl[ep.id];
  return _podTl[ep.id] = (async () => {
    const items = [];
    for (let n = 0; n < ep.blocks.length; n++) {
      const b = ep.blocks[n];
      if (b.t === 'theme') { items.push({ lead: 0, fixed: 2.7, tail: 0 }); continue; }
      const src = podLineSrc(rec, ep.id, Podcast.lineKey(b));
      if (!src) return null; // a robot line somewhere — no honest timeline
      items.push({ src, lead: b.t === 'ad' ? 0.6 : 0, tail: 0.26 });
    }
    const durs = await Promise.all(items.map(it => it.src ? podAudioDur(it.src) : Promise.resolve(it.fixed)));
    const start = []; let t = 0;
    items.forEach((it, k) => { start.push(t); t += it.lead + durs[k] + it.tail; });
    return { start, total: t, lead: items.map(it => it.lead) };
  })();
}
const podFmtTime = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let _podSeek = null; // set while a scrubbable episode plays: seconds → void
function podcastSheet(id) {
  const ep = podById(id);
  if (!ep) return;
  const s = ep.show;
  const canSpeak = typeof window.speechSynthesis !== 'undefined';
  /* Marc, 17 Aug: "i dont want the script to actually be readable, i want
     people to have to click on it and listen". So this is a player, not a
     page: the running order and the cast, and a caption that reveals only the
     line currently being spoken. You cannot skim ahead of the hosts.
     The one exception is a device with no speech engine at all — there the
     transcript is the only way to consume the thing, so it prints. */
  const cast = [...new Set(ep.blocks.filter(b => b.t === 'speech').map(b => b.who))];
  const ads = ep.blocks.filter(b => b.t === 'ad').length;
  const mins = Math.max(1, Math.round(ep.words / 150));
  const locked = `
    <div class="pod-cast">
      <span class="pod-cast-h">On this episode</span>
      ${cast.map(n => `<span class="pod-chip">${esc(n)}</span>`).join('')}
    </div>
    <p class="pod-meta" id="podMeta">${ep.blocks.filter(b => b.t === 'speech').length} exchanges &middot; ${ads} ad break${ads === 1 ? '' : 's'} &middot; about ${mins} minute${mins === 1 ? '' : 's'}</p>
    <div class="pod-nowplaying" id="podNow" aria-live="polite">
      <span class="pod-now-who"></span>
      <span class="pod-now-line">Press play.</span>
    </div>
    <div class="pod-scrub" id="podScrub" hidden>
      <span class="pod-time" id="podTimeCur">0:00</span>
      <input type="range" id="podSeek" min="0" max="1000" value="0" step="1" aria-label="Scrub through the episode">
      <span class="pod-time" id="podTimeTot">&ndash;:&ndash;&ndash;</span>
    </div>`;
  const fallback = `<p class="pod-meta">This device has no speech engine, so the transcript is printed below instead.</p>
    <div class="pod-body">${ep.blocks.map(b => b.t === 'theme' ? `<p class="pod-sting">${esc(b.text)}</p>`
      : b.t === 'ad' ? `<p class="pod-ad"><b>${esc(b.brand)}</b> &mdash; ${esc(b.text)}</p>`
      : `<p class="pod-line"><b>${esc(b.who)}:</b> ${esc(b.text)}</p>`).join('')}</div>`;
  document.querySelectorAll('.pod-room').forEach(x => x.closest('.overlay')?.remove());
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="card pod-room pod-${esc(s.id)}-room" role="dialog" aria-label="${esc(s.name)}">
    <button class="btn ghost small icon-btn gz-close" id="podClose" aria-label="Close">&#10005;</button>
    <div class="pod-head">
      <span class="pod-badge pod-lg pod-${esc(s.id)}">${Podcast.logoSvg(s.id, 46)}</span>
      <div><h2 style="margin:0">${esc(s.name)}</h2>
        <p class="muted" style="margin:2px 0 0;font-size:12px">${esc(ep.title)} &middot; ${esc(ep.dek)}</p></div>
    </div>
    ${canSpeak ? `<button class="btn" id="podPlay">&#9654; Listen</button>${locked}` : fallback}
  </div>`;
  document.body.appendChild(ov);
  pushOvState();
  const shut = () => { podStopSpeaking(); closeOv(ov); };
  ov.onclick = e => { if (e.target === ov) shut(); };
  ov.querySelector('#podClose').onclick = shut;
  const btn = ov.querySelector('#podPlay');
  if (btn) btn.onclick = () => podPlay(ep, btn, ov.querySelector('#podNow'));
  // say so when this one is the real thing, so nobody judges the hosts on a
  // read the browser did for them — and say when it is only part cut, so a
  // robot turning up halfway through isn't taken for a bug
  podRecordings().then(async rec => {
    if (!ov.isConnected) return;
    const spoken = ep.blocks.map((b, n) => [b, n]).filter(([b]) => b.t !== 'theme');
    const cut = spoken.filter(([b]) => podLineSrc(rec, ep.id, Podcast.lineKey(b))).length;
    if (!cut) return;
    const meta = ov.querySelector('#podMeta');
    if (meta) meta.textContent += cut === spoken.length ? ' · recorded' : ' · part recorded';
    // fully recorded → the scrub bar earns its place (Ben, 16 Aug)
    if (cut !== spoken.length || !canSpeak) return;
    const tl = await podEpTimeline(ep, rec);
    if (!tl || !ov.isConnected) return;
    const scr = ov.querySelector('#podScrub'), seek = ov.querySelector('#podSeek');
    const cur = ov.querySelector('#podTimeCur'), tot = ov.querySelector('#podTimeTot');
    if (!scr || !seek) return;
    scr.hidden = false;
    tot.textContent = podFmtTime(tl.total);
    seek.oninput = () => { seek.dataset.drag = '1'; cur.textContent = podFmtTime(seek.value / 1000 * tl.total); };
    seek.onchange = () => {
      delete seek.dataset.drag;
      const t = seek.value / 1000 * tl.total;
      if (_podSeek) _podSeek(t);
      else podPlay(ep, ov.querySelector('#podPlay'), ov.querySelector('#podNow'), t);
    };
  });
}
/* ---- the speech desk ----
   Marc, 18 Aug: "there are some examples where a word is in all caps, and the
   tone doesnt change and it is spelt out as if it is an acronym". Both faults
   are fixable in the TEXT, before the engine ever sees it — no engine can tell
   SHOUTING from an initialism, and none of them will ever say "GW3" the way a
   broadcaster would.

   1. Abbreviations are expanded to what a man with a microphone would actually
      say. "IPS" is Ipswich out loud, not I-P-S. The ones that genuinely ARE
      initialisms (VAR) are spaced so they stay spelled.
   2. A shouted run is spoken in lower case — so it is read as words — and the
      emphasis is put back where it belongs: its own utterance, louder and a
      shade faster. The caption still prints the capitals, so the page shouts
      even though the string handed to the engine does not. */
const POD_SAY = [
  [/talkTROUGH/g, 'talk Trough'],
  [/\bGW\s*(\d+)\b/g, 'gameweek $1'], [/\bGW\b/g, 'gameweek'],
  [/\bxGI\b/g, 'expected goal involvement'], [/\bxG\b/g, 'expected goals'], [/\bxA\b/g, 'expected assists'],
  [/\bH2H\b/g, 'head to head'], [/\bPPG\b/gi, 'points per game'], [/\bpts\b/gi, 'points'],
  [/\bVAR\b/g, 'V A R'], [/\bEPL\b/g, 'E P L'], [/\bFPL\b/g, 'F P L'],
  [/\bGK\b/g, 'goalkeeper'], [/\bDF\b/g, 'defender'], [/\bMF\b/g, 'midfielder'], [/\bFW\b/g, 'forward'],
  [/\bARS\b/g, 'Arsenal'], [/\bAVL\b/g, 'Aston Villa'], [/\bBHA\b/g, 'Brighton'], [/\bBOU\b/g, 'Bournemouth'],
  [/\bBRE\b/g, 'Brentford'], [/\bCHE\b/g, 'Chelsea'], [/\bCOV\b/g, 'Coventry'], [/\bCRY\b/g, 'Crystal Palace'],
  [/\bEVE\b/g, 'Everton'], [/\bFUL\b/g, 'Fulham'], [/\bHUL\b/g, 'Hull'], [/\bIPS\b/g, 'Ipswich'],
  [/\bLEE\b/g, 'Leeds'], [/\bLIV\b/g, 'Liverpool'], [/\bMCI\b/g, 'Manchester City'], [/\bMUN\b/g, 'Manchester United'],
  [/\bNEW\b/g, 'Newcastle'], [/\bNFO\b/g, 'Nottingham Forest'], [/\bSUN\b/g, 'Sunderland'], [/\bTOT\b/g, 'Tottenham'],
];
// ONE shouted word: two or more capitals standing on their own, optionally
// carrying the single-letter words in front of it ("A CREST", "I SAID"). Group
// 1 is the left boundary — a lookbehind would be neater but Safari only grew
// them recently — and the lookahead stops it biting talkTROUGH in half or
// splitting "I'll" at the apostrophe.
const POD_SHOUT = /(^|[^A-Za-z0-9'’])((?:[A-Z](?:['’][A-Z]+)?[ \t]+)*[A-Z]{2,}(?:['’][A-Z]+)*)(?![A-Za-z])/g;
/* Two shouted words belong to the same shout if all that stands between them
   is space, a comma or a dash — and single-letter words, because "WRITE IT ON
   A BIT OF PAPER" is one bellow and the lone A must not fall out of it. A full
   stop is deliberately NOT in here: that ends the shout. */
const POD_SHOUT_GAP = /^[\s,\-–—]*(?:[A-Z](?:['’][A-Z]+)?[\s,\-–—]+)*$/;
function podRuns(text) {
  const t = POD_SAY.reduce((x, [re, to]) => x.replace(re, to), String(text || ''));
  const out = [];
  let last = 0, m;
  POD_SHOUT.lastIndex = 0;
  while ((m = POD_SHOUT.exec(t)) !== null) {
    const s = m.index + m[1].length, e = s + m[2].length;
    const gap = t.slice(last, s);
    const prev = out[out.length - 1];
    // adjacent shouted words are ONE shout: "FRAUD OF THE WEEK" is a phrase,
    // not four separate barks with a gap for breath between each
    if (prev && prev.shout && POD_SHOUT_GAP.test(gap)) prev.say += gap.toLowerCase() + m[2].toLowerCase();
    else {
      if (gap) out.push({ say: gap, shout: false });
      out.push({ say: m[2].toLowerCase(), shout: true });
    }
    last = e;
  }
  if (last < t.length) out.push({ say: t.slice(last), shout: false });
  /* Marc, 18 Aug: "why do the voices keep saying full stop". Because splitting
     a line into runs can leave the punctuation stranded as a run of its own —
     "It's WOKE NONSENSE." ends up as a shout followed by an utterance that is
     nothing but a dot, and an engine handed a lone dot reads out its NAME.
     So a fragment with no letters or digits in it is never spoken on its own:
     it goes back onto the neighbouring run, where it is punctuation again. */
  const runs = [];
  let pend = '';
  for (const r of out) {
    if (!/\S/.test(r.say)) continue;
    if (!/[A-Za-z0-9]/.test(r.say)) {
      if (runs.length) runs[runs.length - 1].say += r.say; else pend += r.say;
      continue;
    }
    if (pend) { r.say = pend + r.say; pend = ''; }
    runs.push(r);
  }
  return runs;
}
/* Read the episode aloud. Started only from a tap (iOS refuses otherwise),
   cancelled on close. Each speaker gets his own INSTALLED voice where the
   device has more than one — that is the single biggest thing that makes this
   sound like a room of people rather than one screen reader doing accents —
   and pitch and rate then colour a voice that is already somebody else.
   The caption follows one line behind nothing: it shows exactly what is being
   said and not a word more. Captions are written with textContent, so a
   hostile club name cannot become an element here. */
async function podPlay(ep, btn, nowEl, startSec) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const who = nowEl?.querySelector('.pod-now-who');
  const line = nowEl?.querySelector('.pod-now-line');
  const caption = (w, t) => { if (who) who.textContent = w || ''; if (line) line.textContent = t || ''; };
  if (_podStop) { podStopSpeaking(); btn.innerHTML = '&#9654; Listen'; caption('', 'Stopped. Press play to start again.'); return; }
  const rec = await podRecordings();
  /* Scrub support (Ben, 16 Aug): when the timeline exists, the bar tracks
     playback and dragging it jumps. `gen` guards the walk — every async
     callback belongs to one generation, and a seek starts the next one, so a
     line paused mid-jump can never advance the new position. */
  const tl = await podEpTimeline(ep, rec).catch(() => null);
  const room = btn.closest('.pod-room');
  const seekEl = room?.querySelector('#podSeek'), curEl = room?.querySelector('#podTimeCur');
  let gen = 0, curN = 0, curWall = Date.now(), curLead = 0;
  const all = synth.getVoices() || [];
  // the default voice is usually the worst one installed — prefer a real
  // en-GB one, and prefer the enhanced/natural variants where they exist
  const score = v => (/en[-_]GB/i.test(v.lang) ? 6 : /en[-_](IE|AU|NZ|ZA)/i.test(v.lang) ? 3 : /^en/i.test(v.lang) ? 2 : 0)
    + (/enhanced|premium|natural|neural/i.test(v.name) ? 4 : 0)
    + (/google|microsoft|daniel|serena|kate/i.test(v.name) ? 1 : 0);
  const pool = all.slice().sort((a, b) => score(b) - score(a));
  // deal distinct voices round the table in speaking order, wrapping if the
  // device has fewer voices than chairs — a repeat beats everyone identical
  const chairs = [...new Set(ep.blocks.filter(b => b.t === 'speech').map(b => b.who))];
  const cast = {};
  chairs.forEach((n, k) => { if (pool.length) cast[n] = pool[k % pool.length]; });
  let i = 0, live = true;
  _podStop = () => { live = false; _podSeek = null; };
  btn.innerHTML = '&#9632; Stop';
  const done = () => { live = false; _podStop = null; _podSeek = null; btn.innerHTML = '&#9654; Listen'; caption('', 'That is the end of the episode.'); };
  // the bar follows the room: recorded lines report their own clock, the
  // fixed beats (stings, lead-ins) run on the wall clock
  const posNow = () => !tl ? 0 : Math.min(tl.total,
    (tl.start[curN] || 0) + curLead + (_podAudio ? _podAudio.currentTime : (Date.now() - curWall) / 1000));
  if (tl && seekEl) {
    const tick = setInterval(() => {
      if (!live) { clearInterval(tick); return; }
      if (seekEl.isConnected && !seekEl.dataset.drag) {
        seekEl.value = Math.round(posNow() / tl.total * 1000);
        if (curEl) curEl.textContent = podFmtTime(posNow());
      }
    }, 250);
  }
  const speak = (text, name, then, g) => {
    const v = cast[name] || pool[0] || null;
    const col = Podcast.VOICES[name] || { pitch: 1, rate: 1 };
    /* Spelling is for the caption, this is for the mouth: the pronunciation
       fixes plus the cleanup only the browser needs — it says "dash" out loud
       where a paid voice just pauses (Marc, 18 Aug). */
    const parts = podRuns(Podcast.browserSay(text));
    if (!parts.length) { then(); return; }
    let k = 0;
    const say = () => {
      if (!live || g !== gen) return;
      if (k >= parts.length) { then(); return; }
      const r = parts[k++];
      const u = new SpeechSynthesisUtterance(r.say);
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
      u.pitch = col.pitch * (r.shout ? 1.06 : 1);
      u.rate = col.rate * (r.shout ? 1.07 : 1);
      u.volume = r.shout ? 1 : 0.82;
      u.onend = say; u.onerror = say;
      synth.speak(u);
    };
    say();
  };
  /* Play the line the way it was RECORDED, and only fall back to the browser
     reading it if there is no file — a part-rendered episode still plays end
     to end, it just has a robot standing in for whoever hasn't been cut yet.
     `off` starts a recorded line part-way through: that is a seek landing. */
  const perform = (b, text, name, then, g, off) => {
    const src = podLineSrc(rec, ep.id, Podcast.lineKey(b));
    if (!src) { speak(text, name, then, g); return; }
    const a = new Audio(src);
    _podAudio = a;
    let handed = false;
    const hand = fn => { if (handed || g !== gen) return; handed = true; if (_podAudio === a) _podAudio = null; fn(); };
    if (off > 0) a.onloadedmetadata = () => { try { a.currentTime = Math.min(off, (a.duration || off) - 0.05); } catch { /* start at 0 */ } };
    a.onended = () => hand(then);
    a.onerror = () => hand(() => speak(text, name, then, g));
    a.play().catch(() => hand(() => speak(text, name, then, g)));
  };
  // a beat between turns; without it the whole thing reads like one long list
  const after = (fn, g) => setTimeout(() => { if (g === gen) fn(); }, 260);
  const next = off => {
    const g = gen;
    if (!live) return;
    if (i >= ep.blocks.length) { done(); return; }
    const n = i, b = ep.blocks[i++];
    curN = n; curWall = Date.now(); curLead = 0;
    if (b.t === 'theme') { caption('', b.text); playSound(ep.show.theme === 'tt' ? 'themeTt' : 'themeGfw'); setTimeout(() => { if (g === gen) next(); }, 2700); return; }
    if (b.t === 'ad') {
      if (off > 0) { // seek landed inside the ad: skip the sting, join the read
        curLead = 0.6;
        caption('ADVERTISEMENT', `${b.brand}. ${b.text}`);
        perform(b, `${b.brand}. ${b.text}`, ep.show.host, () => after(() => next(), g), g, Math.max(0, off - 0.6));
        return;
      }
      caption('ADVERTISEMENT', b.brand);
      playSound(ep.show.ads === 'tt' ? 'adTt' : 'adGfw');
      setTimeout(() => { if (g !== gen) return; curLead = 0.6; caption('ADVERTISEMENT', `${b.brand}. ${b.text}`); perform(b, `${b.brand}. ${b.text}`, ep.show.host, () => after(() => next(), g), g); }, 600);
      return;
    }
    caption(b.who, b.text);
    perform(b, b.text, b.who, () => after(() => next(), g), g, off > 0 ? off : 0);
  };
  // dragging the bar while playing lands here: silence the current line,
  // retire its generation, walk on from the target block and offset
  if (tl) _podSeek = t => {
    if (!live) return;
    gen++;
    if (_podAudio) { try { _podAudio.pause(); } catch { /* gone */ } _podAudio = null; }
    try { synth.cancel(); } catch { /* not available */ }
    let k = tl.start.length - 1;
    while (k > 0 && tl.start[k] > t) k--;
    i = k;
    next(Math.max(0, t - tl.start[k]));
  };
  if (!all.length && typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', () => { }, { once: true });
  }
  if (tl && startSec > 0) { _podSeek(startSec); return; }
  next();
}
function previewArticle(i, pick) {
  const d = gwPreviewData(i);
  if (!d) return '';
  const { rows, motw, notes, recent } = d;
  const table = h2hStandings();
  const posOf = Object.fromEntries(table.map((r, k) => [r.id, k + 1]));
  const played = table.some(r => r.p > 0);
  const pos = id => played ? `${ord(posOf[id])}` : null;
  const pct = Math.round(motw.p * 100);
  const fav = pct >= 50 ? motw.a : motw.b;
  const dog = fav === motw.a ? motw.b : motw.a;
  const favPct = Math.max(pct, 100 - pct);
  const keyMan = mid => lineupFor(mid, i).map(id => PLAYER_BY_ID[id]).filter(Boolean)
    .sort((a, b) => playerXp(b) - playerXp(a))[0];
  const ka = keyMan(motw.a), kb = keyMan(motw.b);
  const stakes = played
    ? (Math.abs(posOf[motw.a] - posOf[motw.b]) <= 2
      ? `with ${pos(motw.a)} hosting ${pos(motw.b)}, the table says this one matters and for once the table is right`
      : `${pos(motw.a)} against ${pos(motw.b)} — a mismatch on paper, and paper has embarrassed people all season`)
    : 'the first exchanges of a season twelve men have waited all summer for';
  const lead = pick([
    `All roads lead to ${stadium(motw.a)}, where ${teamName(motw.a)} host ${teamName(motw.b)} — ${stakes}.`,
    `The Committee has stamped ${teamName(motw.a)} v ${teamName(motw.b)} as the tie of the round: ${stakes}.`,
    `One fixture stands above the rest this week: ${teamName(motw.a)} against ${teamName(motw.b)} at ${stadium(motw.a)}, ${stakes}.`,
  ], i);
  const numbers = pick([
    `The projections make it ${motw.sa}–${motw.sb} and hand ${teamName(fav)} a ${favPct}% chance — numbers ${managerName(dog)} will treat with the contempt they possibly deserve.`,
    `On expected points it's ${motw.sa}–${motw.sb}, ${favPct}% in ${teamName(fav)}'s favour. ${teamName(dog)} have read worse forecasts and won.`,
  ], i + 1);
  const men = ka && kb
    ? ` ${ka.name} (${playerXp(ka).toFixed(1)} expected) carries the home hopes; ${kb.name} (${playerXp(kb).toFixed(1)}) the away ones.`
    : '';
  const ga = gafferFor(motw.a), gb = gafferFor(motw.b);
  const dugouts = ga && gb ? ` In the dugouts, ${ga.t} against ${gb.t} — no handshake confirmed.` : '';
  const motwNotes = notes(motw).join(' ');
  const grounds = rows.filter(r => r !== motw).map((r, k) => {
    const p2 = Math.round(r.p * 100);
    const f2 = p2 >= 50 ? r.a : r.b, u2 = f2 === r.a ? r.b : r.a;
    const m2 = Math.max(p2, 100 - p2);
    return pick([
      `${teamName(f2)} should have too much for ${teamName(u2)} (${m2}%)`,
      `${teamName(u2)} will fancy the upset against ${teamName(f2)}, the numbers (${m2}% against) will not`,
      `${teamName(f2)} and ${teamName(u2)} looks tight enough to ruin somebody's Sunday (${m2}–${100 - m2})`,
      `${teamName(f2)} are ${m2}% favourites over ${teamName(u2)}, projected ${r.sa}–${r.sb}`,
    ], i * 7 + k);
  });
  const troughLine = recent.length
    ? ` The transfer columns note ${recent.slice(-3).map(t => `${managerName(t.managerId)} ${t.trade ? 'trading for' : 'signing'} ${PLAYER_BY_ID[t.inId]?.name || '?'}`).join(', ')} — moves that will look either shrewd or desperate by Monday.`
    : '';
  // week one leads with the draft (Ben, UAT night: "who takes who, who might
  // perform, interesting clashes") — first pick, the steal by the numbers,
  // and any club-hoarding policy the Committee should note
  let draftRecap = '';
  if (i === 0 && !played && state.draft?.picks?.length) {
    const picks = state.draft.picks;
    const fp = PLAYER_BY_ID[picks[0]?.playerId];
    const bits = [];
    if (fp) bits.push(`${managerName(picks[0].managerId)} opened the night with ${fp.name} at No. 1 — ${playerXp(fp).toFixed(1)} expected a week says fair enough`);
    const late = picks.filter(pk => pk.n > picks.length / 2).map(pk => ({ pk, p: PLAYER_BY_ID[pk.playerId] })).filter(x => x.p);
    const steal = late.sort((a, b) => playerXp(b.p) - playerXp(a.p))[0];
    if (steal && playerXp(steal.p) > 0) bits.push(`the steal, by the numbers: ${steal.p.name} at pick ${steal.pk.n}, round ${Math.ceil(steal.pk.n / state.managers.length)}, to ${teamName(steal.pk.managerId)}`);
    let hoard = null;
    for (const m of state.managers) {
      const c = {};
      for (const p of squadAt(m.id, 0)) { c[p.team] = (c[p.team] || 0) + 1; if (!hoard || c[p.team] > hoard.n) hoard = { mid: m.id, team: p.team, n: c[p.team] }; }
    }
    if (hoard && hoard.n >= 4) bits.push(`${teamName(hoard.mid)} left with ${hoard.n} from ${hoard.team}, a procurement policy the Committee has noted without endorsing`);
    if (bits.length) draftRecap = `The draft, minuted: ${bits.map((s, k) => k ? s[0].toUpperCase() + s.slice(1) : s).join('. ')}.`;
  }
  const dc = i < 10 ? draftClassTable() : [];
  const draftLine = dc.length >= 2 && dc[0].pts > 0
    ? ` Draft-class watch: ${teamName(dc[0].mid)}'s August board still tops the charts (${dc[0].pts} banked); ${teamName(dc[dc.length - 1].mid)}'s is being described, generously, as "a project".`
    : '';
  const closer = pick([
    'Projections by the algorithm; consequences by the group chat.',
    'The Committee wishes all twelve managers the fortune they deserve. Exactly that much.',
    'Lineups lock at kick-off. Regret locks in shortly afterwards.',
  ], i + 3);
  // Meet the Managers (Ian's commission) — an issue keyed to this gameweek
  // prints here first; its .prog-head makes it the front-page splash
  const sitdown = (typeof Gazette !== 'undefined' && Gazette.interview) ? Gazette.interview(i) : '';
  return `<div class="prog-art">
    <p class="prog-lead">${esc(lead)}</p>
    <p>${esc(numbers)}${esc(men)}${esc(dugouts)}</p>
    ${draftRecap ? `<p>${esc(draftRecap)}</p>` : ''}
    ${motwNotes ? `<p>${esc(motwNotes)} ${esc(chantFor(motw.a, motw.b, i))}</p>` : `<p>${esc(chantFor(motw.a, motw.b, i))}</p>`}
    <div class="prog-sec">Around the grounds</div><p>${esc(grounds.join('; '))}.${esc(troughLine)}${esc(draftLine)}</p>
    ${sitdown}
    <p class="muted" style="font-size:12px">${esc(closer)}</p>
  </div>`;
}
function reviewArticle(last, pick) {
  // the Gazette's writing engine (js/gazette.js) sets the paper now —
  // archetypes, lore, cliché gates, cooldowns. This body remains as the
  // fallback edition if the engine ever fails to load or throws.
  if (typeof Gazette !== 'undefined' && Gazette.review) {
    const g = Gazette.review(last);
    if (g) return g;
  }
  const aw = weeklyAwards(last);
  const results = pairingsFor(last).map(([a, b]) => ({ a, b, sa: gwManagerPoints(a, last), sb: gwManagerPoints(b, last) }));
  if (!results.length) return '';
  const { hi, lo, jammy, robbed, hiding, bench } = aw;
  // the star turn: best single scorer across every scored XI this week
  let star = null;
  for (const m of state.managers) for (const pid of lineupFor(m.id, last)) {
    const pts = gwPlayerPoints(pid, last);
    if (!star || pts > star.pts) star = { p: PLAYER_BY_ID[pid], pts, mid: m.id };
  }
  const lead = hiding && hiding.margin >= 18
    ? pick([
      `${teamName(hiding.w)} did not so much beat ${teamName(hiding.l)} as dismantle them — ${hiding.ws}–${hiding.ls}, a margin the Committee has filed under "hidings, biggest" and ${managerName(hiding.l)} has filed under "never mention again".`,
      `The week belonged to ${teamName(hiding.w)}, who put ${hiding.ws} points on ${teamName(hiding.l)} and celebrated with the quiet dignity of a man who has already screenshotted the score.`,
    ], last)
    : pick([
      `${teamName(hi.id)} topped the week with ${hi.s} points — a total assembled ${hiding ? `while ${teamName(hiding.l)} were shipping ${hiding.ws} elsewhere` : 'with minimal fuss and maximal smugness'}.`,
      `A week of fine margins, and none finer than ${teamName(hi.id)}'s ${hi.s} — enough for the points, the bragging rights, and an insufferable Monday.`,
    ], last);
  const starLine = star && star.pts > 0
    ? ` The individual honours go to ${star.p.name}, whose ${star.pts} points for ${teamName(star.mid)} were the week's outstanding shift.`
    : '';
  // per-match reports (Ben, UAT night: "more depth — who drafted who, who
  // scored the points"): star men with their stat lines and their provenance
  // (round drafted / Trough find / waiver claim / trade), flops in dispatches
  const provenance = (mid, pid) => {
    const pk = (state.draft.picks || []).find(x => x.managerId === mid && x.playerId === pid);
    if (pk && pk.n) return `his round-${Math.ceil(pk.n / state.managers.length)} pick (No. ${pk.n} overall)`;
    if (pk) return 'his own draft pick';
    const tr = [...state.transfers].reverse().find(t => t.managerId === mid && t.inId === pid);
    if (!tr) return '';
    return tr.trade ? 'landed in a trade' : tr.windowDraft ? 'a Window Draft signing' : tr.waiver ? 'a waiver-wire claim' : 'plucked from the Trough for nothing';
  };
  const shift = pid => {
    const s = gwEvent(last)?.playerStats?.[pid];
    if (!s) return '';
    const bits = [];
    if ((s.g || 0) >= 3) bits.push('a hat-trick'); else if (s.g === 2) bits.push('two goals'); else if (s.g === 1) bits.push('a goal');
    if ((s.a || 0) === 1) bits.push('an assist'); else if ((s.a || 0) >= 2) bits.push(`${s.a} assists`);
    if (s.cs && ['GK', 'DF'].includes(PLAYER_BY_ID[pid]?.pos)) bits.push('a clean sheet');
    if (s.ps) bits.push('a penalty save');
    return bits.length <= 2 ? bits.join(' and ') : `${bits.slice(0, -1).join(', ')} and ${bits.at(-1)}`;
  };
  const topOf = mid => {
    let best = null;
    for (const pid of lineupFor(mid, last)) {
      const pts = gwPlayerPoints(pid, last);
      if (!best || pts > best.pts) best = { pid, pts };
    }
    return best;
  };
  const reports = results.map((r, k) => {
    const story = (home, hs2, away, as2, byline, body) => `<div class="prog-story">
      <div class="prog-head">${esc(teamName(home))} ${hs2} &nbsp;${esc(teamName(away))} ${as2}</div>
      <div class="prog-by">${esc(byline)}</div>
      <p>${esc(body)}</p></div>`;
    if (r.sa === r.sb) {
      const ba = topOf(r.a), bb = topOf(r.b);
      const bm = ba && bb && bb.pts > ba.pts ? { ...bb, mid: r.b } : ba ? { ...ba, mid: r.a } : null;
      return story(r.a, r.sa, r.b, r.sb, `From our man at ${stadium(r.a)}`,
        bm && bm.pts > 0 ? `A draw nobody enjoyed; ${PLAYER_BY_ID[bm.pid]?.name || '?'} (${bm.pts}) did most to avoid it.` : 'A draw nobody enjoyed, least of all the neutrals. There were no neutrals.');
    }
    const w = r.sa > r.sb ? r.a : r.b, l = w === r.a ? r.b : r.a;
    const ws = Math.max(r.sa, r.sb), ls = Math.min(r.sa, r.sb);
    const wStar = topOf(w), lStar = topOf(l);
    const wp = wStar ? PLAYER_BY_ID[wStar.pid] : null;
    const verb = pick(['saw off', 'edged', 'beat', 'dispatched', 'got past'], last * 5 + k);
    let body = `${teamName(w)} ${verb} ${teamName(l)}.`;
    if (wp && wStar.pts > 0) {
      const sh = shift(wStar.pid);
      const prov = provenance(w, wStar.pid);
      body += ` ${wp.name} led the winning effort with ${wStar.pts}${sh ? ` — ${sh}` : ''}${prov ? ` — ${prov}` : ''}.`;
    }
    if (lStar && PLAYER_BY_ID[lStar.pid]) {
      body += lStar.pts >= Math.max(8, ws / 3)
        ? ` In defeat, ${PLAYER_BY_ID[lStar.pid].name}'s ${lStar.pts} deserved better company.`
        : ` ${teamName(l)}'s best was ${PLAYER_BY_ID[lStar.pid].name} with ${lStar.pts}, which tells its own story.`;
    }
    return story(w === r.a ? r.a : r.b, w === r.a ? ws : ls, w === r.a ? r.b : r.a, w === r.a ? ls : ws, `From our man at ${stadium(r.a)}`, body);
  }).join('');
  const awardBits = [];
  if (lo) awardBits.push(`the Wooden Spoon goes to ${teamName(lo.id)} (${lo.s})`);
  if (jammy && jammy.ws < (hi?.s || 99)) awardBits.push(`${teamName(jammy.w)} take Jammiest Win, victorious with just ${jammy.ws}`);
  if (robbed) awardBits.push(`${teamName(robbed.l)} were Robbed — ${robbed.ls} points and nothing to show for it`);
  if (bench && bench.waste > 0) awardBits.push(`${teamName(bench.id)} left ${bench.waste} on the bench, which the Committee records without comment but with an eyebrow`);
  const table = h2hStandings();
  let tableLine = '';
  if (table.length && table.some(r => r.p > 0)) {
    const top = table[0], second = table[1], eighth = table[7], ninth = table[8], bottom = table[table.length - 1];
    const gap = top.pts - (second?.pts || 0);
    tableLine = `${teamName(top.id)} lead the table${gap > 0 ? ` by ${gap}` : ' on tiebreak'}; at the other end ${teamName(bottom.id)} prop everyone up. The playoff line: ${teamName(eighth.id)} in, ${teamName(ninth.id)} out, ${eighth.pts - ninth.pts <= 3 ? 'and barely a cigarette paper between them' : 'with work to do'}.`;
  }
  // the vidiprinter's greatest hits (Ben, mock night: "sat on bench and stuff
  // like that is what goes in the matchweek review")
  const moments = [];
  let benchStar = null;
  for (const m of state.managers) {
    const xi = new Set(lineupFor(m.id, last));
    for (const p of squadAt(m.id, last)) {
      if (xi.has(p.id)) continue;
      const v = gwPlayerPoints(p.id, last);
      if (!benchStar || v > benchStar.pts) benchStar = { mid: m.id, p, pts: v };
    }
  }
  if (benchStar && benchStar.pts >= 8) moments.push(`${benchStar.p.name} scored ${benchStar.pts} on ${teamName(benchStar.mid)}'s bench, into the void, for nobody`);
  const ev = gwEvent(last)?.playerStats || {};
  const ownedBy = {};
  for (const m of state.managers) for (const p of squadAt(m.id, last)) ownedBy[p.id] = m.id;
  for (const [pid, s] of Object.entries(ev)) {
    const p = PLAYER_BY_ID[pid], om = ownedBy[pid];
    if (!p || om == null) continue;
    if ((s.g || 0) >= 3) moments.push(`a ${p.name} hat-trick for ${teamName(om)}`);
    else if ((s.g || 0) === 2) moments.push(`a ${p.name} brace for ${teamName(om)}`);
    if (s.rc) moments.push(`${p.name} sent off on ${teamName(om)} duty`);
    if (s.ps) moments.push(`a ${p.name} penalty save for ${teamName(om)}`);
    if (s.og) moments.push(`${p.name} scoring at the wrong end for ${teamName(om)}`);
    if (moments.length >= 5) break;
  }
  const momentsLine = moments.length ? `The vidiprinter will remember: ${moments.slice(0, 4).join('; ')}.` : '';
  // early-season receipts: the draft revisited + Trough dealings (Ben's ask)
  let draftPara = '';
  if (last < 10) {
    const dc = draftClassTable();
    if (dc.length >= 2 && dc[0].pts > 0) {
      const top = dc[0], flop = dc[dc.length - 1];
      draftPara = pick([
        `The draft, revisited: ${teamName(top.mid)}'s class of August leads the way on ${top.pts} points${top.star ? `, ${top.star.name} doing the heavy lifting` : ''}, while ${teamName(flop.mid)}'s board (${flop.pts}) is aging like milk in the sun.`,
        `Draft report: ${teamName(top.mid)} drafted the field (${top.pts} and counting${top.star ? `, led by ${top.star.name}` : ''}); ${teamName(flop.mid)} would like the record to show it's early days (${flop.pts}).`,
      ], last + 7);
      const pu = bestPickups(last).filter(x => x.pts > 0)[0];
      if (pu) draftPara += ` In the Trough, ${managerName(pu.mid)}'s ${pu.waiver ? 'waiver swoop for' : 'free signing of'} ${pu.p.name} — ${pu.pts} point${pu.pts === 1 ? '' : 's'} since — is the market's deal to beat.`;
    }
  }
  return `<div class="prog-art">
    <p class="prog-lead">${esc(lead)}${esc(starLine)}</p>
    <div class="prog-cols">${reports}</div>
    ${awardBits.length ? `<div class="prog-sec">In dispatches</div><p>${esc(awardBits.join('; '))}.</p>` : ''}
    ${momentsLine ? `<div class="prog-sec">The Vidiprinter</div><p>${esc(momentsLine)}</p>` : ''}
    ${draftPara ? `<div class="prog-sec">The draft, revisited</div><p>${esc(draftPara)}</p>` : ''}
    ${tableLine ? `<div class="prog-sec">The state of the table</div><p>${esc(tableLine)}</p>` : ''}
  </div>`;
}
/* ----- the Data Room (Marc, 1 Aug): the stats desk gets its own page so the
   dashboard stays clean — awards, treatment room and the fixture quirks desk
   all live here now ----- */
// Marc's taxonomy (1 Aug screenshots): league data / team data / player data.
// More desks move in here as the Committee rules on them.
/* the live playoff bracket (Marc, 2 Aug — Data Room, league data): projected
   from the current table all season (seeds + points-based QF handicaps firm
   up as the table does), then the real thing once GW33 settles */
function bracketCard() {
  const po = playoffState();
  const rows = standingsBefore(REGULAR_GWS).rows;
  const seeds = po ? po.seeds : rows.slice(0, 8).map(r => r.id);
  if (seeds.length < 8) return '';
  // handicaps come off the H2H table Points (3 a win), NOT overall fantasy
  // points (Marc, 3 Aug: "+11 in the bracket — it's using points not Points")
  const tablePts = Object.fromEntries(rows.map(r => [r.id, r.h2h]));
  const qfs = po ? po.qfs : [[seeds[0], seeds[7]], [seeds[1], seeds[6]], [seeds[2], seeds[5]], [seeds[3], seeds[4]]];
  const hcaps = po ? po.handicaps : qfs.map(([a, b]) => qfHandicap(tablePts[a] || 0, tablePts[b] || 0));
  const seedNo = id => seeds.indexOf(id) + 1;
  const box = (a, b, { hcap = 0, score = null, winner = null, labelA = '', labelB = '' } = {}) =>
    `<div class="br-tie">${[a, b].map((id, j) => id == null
      ? `<div class="br-side br-tbd muted">${j ? labelB : labelA}</div>`
      : `<div class="br-side${winner != null ? (winner === id ? ' br-won' : ' br-out') : ''}">
          <span class="br-seed">${seedNo(id)}</span>${kitSvg(id, 15)}<span class="br-name">${esc(teamName(id))}</span>
          ${j === 0 && hcap ? `<span class="gold br-hcap" title="Head start — the full table-Points gap between the pair">+${hcap}</span>` : ''}
          ${score ? `<span class="br-pts">${score[j]}</span>` : ''}
        </div>`).join('')}</div>`;
  const qfCol = qfs.map((pair, k) => {
    const sc = po && gwStatus(po.qfIdx) !== 'upcoming'
      ? [gwManagerPoints(pair[0], po.qfIdx) + hcaps[k], gwManagerPoints(pair[1], po.qfIdx)] : null;
    return box(pair[0], pair[1], { hcap: hcaps[k], score: sc, winner: po?.qfWinners ? po.qfWinners[k] : null });
  }).join('');
  const semiPairs = po?.semis || [[null, null], [null, null]];
  const semiScore = po?.semis && gwStatus(po.semiIdx) !== 'upcoming'
    ? po.semis.map(([a, b]) => [gwManagerPoints(a, po.semiIdx), gwManagerPoints(b, po.semiIdx)]) : null;
  const semiCol = semiPairs.map((pair, k) => box(pair[0], pair[1], {
    score: semiScore ? semiScore[k] : null,
    winner: po?.semiWinners ? po.semiWinners[k] : null,
    labelA: k === 0 ? 'Winner 1v8' : 'Winner 2v7', labelB: k === 0 ? 'Winner 4v5' : 'Winner 3v6',
  })).join('');
  let finalBox;
  if (po?.semiWinners) {
    const [x, y] = po.semiWinners;
    const played = po.finalIdx.filter(i => gwStatus(i) !== 'upcoming');
    const agg = played.reduce((t, i) => [t[0] + gwManagerPoints(x, i), t[1] + gwManagerPoints(y, i)], [0, 0]);
    finalBox = box(x, y, { score: played.length ? agg : null, winner: po.champion });
  } else finalBox = box(null, null, { labelA: 'SF winner', labelB: 'SF winner' });
  return `<div class="card"><h2>The Playoff Bracket${po ? '' : ' <span class="tag">projected</span>'}</h2>
    <p class="muted" style="font-size:11.5px;margin-bottom:8px">${po
      ? 'Top eight. Handicap quarter-finals, fixed bracket, three-legged final. Ties: higher seed.'
      : `If the season ended today &mdash; seeds from the table, quarter-final head starts = the full table-Points gap. Firms up as the table does; the real thing kicks off GW34.`}</p>
    <div class="bracket">
      <div class="br-col"><p class="br-stage">Quarter-finals &middot; GW34</p>${qfCol}</div>
      <div class="br-col"><p class="br-stage">Semi-finals &middot; GW35</p>${semiCol}</div>
      <div class="br-col"><p class="br-stage">The Final &middot; GW36&ndash;38</p>${finalBox}
        ${po?.champion ? `<p style="text-align:center;margin-top:8px;font-size:15px">&#127942; <b>${esc(teamName(po.champion))}</b></p>` : ''}</div>
    </div></div>`;
}

function viewData() {
  const sect = t => `<p class="muted" style="font-size:11px;margin:14px 0 4px;text-transform:uppercase;letter-spacing:.08em">${t}</p>`;
  return `
  ${sect('Research')}
  ${compareCard()}
  ${playerExplorerCard()}
  ${fixtureMatrixCard()}
  ${sect('League data')}
  ${recordBookNowCard()}
  ${awardsCard() || `<div class="card"><h2>The Committee's Awards</h2><p class="muted" style="font-size:12.5px">No settled gameweek yet. The Committee sharpens its pencils.</p></div>`}
  ${awardsHonoursCard()}
  ${sect('Team data')}
  ${troughActivityCard()}
  ${tradeRecordCard()}
  ${seasonSquadCard()}
  ${sect('Player data')}
  ${treatmentRoomCard()}
  ${sect('The archive')}
  ${recordBookCards() ? `<details class="card draft-intro">
    <summary><b>Last season &mdash; 2025/26</b> <span>records, draft night, the cup, head-to-head</span></summary>
    <div class="draft-intro-body">${recordBookCards()}</div>
  </details>` : ''}`;
}
function bindData() {
  bindAwardsBits();
  bindPitchLinks();
  bindExplorer();
  bindFixtureMatrix();
  bindTradeRecord();
  document.querySelectorAll('[data-sqrow]').forEach(row => row.onclick = () => {
    const bd = $(`#sq-${row.dataset.sqrow}`);
    bd.style.display = bd.style.display === 'none' ? '' : 'none'; // '' = table-row
  });
}
// the awards + treatment desk handlers, shared by whichever page hosts them
function bindAwardsBits() {
  const cm = $('#copyMinutes');
  if (cm) cm.onclick = () => {
    const last = lastFinalGw();
    if (last < 0) return;
    const txt = committeeMinutes(last);
    (navigator.clipboard?.writeText(txt) || Promise.reject()).then(
      () => toast('Minutes copied — paste straight into the chat'),
      () => { window.prompt('Copy the Minutes:', txt); });
  };
  const tm = $('#trmMore');
  if (tm) tm.onclick = () => { trmShowAll = !trmShowAll; render(); };
  document.querySelectorAll('[data-trmpos]').forEach(b => b.onclick = () => { trmView.pos = b.dataset.trmpos; render(); });
  const tc = $('#trmClub');
  if (tc) tc.onchange = () => { trmView.club = tc.value; render(); };
  const tsv = $('#trmSev');
  if (tsv) tsv.onchange = () => { trmView.sev = tsv.value; render(); };
}
/* ----- the Treatment Room: league-wide injury desk + fixture quirks -----
   Injury lines ride the official FPL feed (Premier Injuries / Ben Dinnery data);
   blank & double gameweeks are computed from the fixture list, Crellin-style. */
let trmShowAll = false;
function treatmentBand(p) {
  const news = String(p.news || '');
  if (p.status === 'd') {
    const chance = Number.isFinite(+p.chance) ? +p.chance : null;
    return {
      k: chance != null && chance <= 25 ? 'major-doubt' : 'doubt',
      label: chance != null && chance > 0 && chance < 100 ? `${chance}% CHANCE` : 'DOUBT',
    };
  }
  if (p.status === 's') return { k: 'suspended', label: 'SUSPENDED' };
  const m = news.match(/Expected back\s+(\d{1,2})\s+([A-Za-z]{3})/i);
  if (m) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(m[2].toLowerCase());
    if (month >= 0) {
      const now = new Date(Date.now());
      let target = new Date(now.getFullYear(), month, +m[1], 12);
      // December news read in January (or vice versa) should resolve to the
      // nearest sensible future date, not look eleven months overdue.
      if (target.getTime() < now.getTime() - 120 * 86400000) target = new Date(now.getFullYear() + 1, month, +m[1], 12);
      const days = Math.ceil((target.getTime() - now.getTime()) / 86400000);
      if (days > 28) return { k: 'long', label: 'LONG-TERM' };
      if (days > 14) return { k: 'medium', label: '2–4 WEEKS' };
      return { k: 'out', label: 'OUT' };
    }
  }
  if (/unknown return/i.test(news)) return { k: 'unknown', label: 'RETURN UNKNOWN' };
  return { k: 'out', label: p.status === 'n' || p.status === 'u' ? 'UNAVAILABLE' : 'OUT' };
}
// treatment room filters (Marc, 1 Aug): club, position, recovery time
let trmView = { pos: '', club: '', sev: '' };
const TRM_SEV_BUCKETS = {
  doubt: ['doubt', 'major-doubt'], out: ['out'], medium: ['medium'],
  long: ['long', 'unknown'], suspended: ['suspended'],
};
const TRM_SEV_LABELS = { doubt: 'Doubtful', out: 'Out', medium: '2–4 weeks', long: 'Long-term', suspended: 'Suspended' };
function treatmentRoomCard() {
  const ownedBy = {};
  for (const m of state.managers) for (const p of managerSquad(m.id)) ownedBy[p.id] = m.id;
  // owned players: every flag matters; free agents: injuries/doubts/bans only (skip loanees)
  const allFlagged = PLAYERS.filter(p => p.status !== 'a' && (ownedBy[p.id] != null || 'ids'.includes(p.status)))
    .sort((a, b) => ((ownedBy[b.id] != null) - (ownedBy[a.id] != null)) || (b.newsAdded || '').localeCompare(a.newsAdded || ''));
  const flagged = allFlagged.filter(p =>
    (!trmView.pos || p.pos === trmView.pos)
    && (!trmView.club || p.club === trmView.club)
    && (!trmView.sev || TRM_SEV_BUCKETS[trmView.sev].includes(treatmentBand(p).k)));
  const trmClubs = [...new Set(allFlagged.map(p => p.club))].sort();
  const filterRow = `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:2px 0 10px">
    ${['', 'GK', 'DF', 'MF', 'FW'].map(ps => `<button class="btn ghost small${trmView.pos === ps ? ' active' : ''}" data-trmpos="${ps}" style="font-size:11px">${ps || 'All'}</button>`).join('')}
    <select id="trmClub" style="font-size:12px"><option value="">Every club</option>${trmClubs.map(c => `<option value="${esc(c)}" ${trmView.club === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <select id="trmSev" style="font-size:12px"><option value="">Any recovery time</option>${Object.entries(TRM_SEV_LABELS).map(([k, l]) => `<option value="${k}" ${trmView.sev === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </div>`;
  const shown = trmShowAll ? flagged : flagged.slice(0, 10);
  const when = p => p.newsAdded ? `<span class="treatment-updated">Updated ${new Date(p.newsAdded).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>` : '';
  const rows = shown.map(p => {
    const band = treatmentBand(p);
    return `<div class="treatment-row treatment-${band.k}">
      <span class="treatment-icon" aria-hidden="true">${statusChip(p)}</span>
      <div class="treatment-body">
        <div class="treatment-head">
          <span class="treatment-player">${pname(p)} <span class="treatment-club">${esc(p.club)}</span></span>
          <span class="treatment-severity">${esc(band.label)}</span>
        </div>
        <div class="treatment-owner">${ownedBy[p.id] != null ? `<span class="tag">${esc(teamName(ownedBy[p.id]))}</span>` : '<span>Free agent</span>'}</div>
        <div class="treatment-news">${esc(p.news || 'No update')} ${when(p)}</div>
      </div>
    </div>`;
  }).join('');
  // fixture desk: blank & double gameweeks still to come
  const byGw = {};
  for (const f of (state.fixtures || [])) if (f.gw) (byGw[f.gw] = byGw[f.gw] || []).push(f);
  const curN = GAMEWEEKS[currentGwIndex()].n;
  const clubs = TEAMS.map(t => t.name);
  const short = name => TEAMS.find(t => t.name === name)?.short || name;
  const quirks = [];
  for (const [gwN, fx] of Object.entries(byGw)) {
    if (+gwN < curN) continue;
    const count = {};
    for (const f of fx) { count[f.home] = (count[f.home] || 0) + 1; count[f.away] = (count[f.away] || 0) + 1; }
    const dgw = clubs.filter(c => (count[c] || 0) > 1);
    const bgw = fx.length >= 5 ? clubs.filter(c => !count[c]) : []; // <5 fixtures = unscheduled data, not a BGW
    if (dgw.length || bgw.length) quirks.push({ n: +gwN, dgw, bgw });
  }
  quirks.sort((a, b) => a.n - b.n);
  return `<div class="card" style="margin-top:14px">
    <h2>The Treatment Room <span class="muted" style="font-weight:400;font-size:12px">who's crocked, league-wide</span></h2>
    ${filterRow}
    ${rows || `<p class="muted" style="font-size:12.5px">${allFlagged.length ? 'Nobody matches those filters. The physio shrugs.' : 'A clean bill of health across the league. Suspicious.'}</p>`}
    ${flagged.length > 10 ? `<button class="btn ghost small" id="trmMore" style="margin-top:8px">${trmShowAll ? 'Show fewer' : `Show all ${flagged.length}`}</button>` : ''}
    <h3 style="margin-top:14px">Fixture desk <span class="muted" style="font-weight:400;font-size:11px">blanks &amp; doubles ahead</span></h3>
    ${quirks.length ? quirks.slice(0, 4).map(q => `<div class="lrow" style="font-size:12.5px;flex-wrap:wrap"><span class="tag">GW${q.n}</span>
      ${q.dgw.length ? `<span>DOUBLE: <b>${q.dgw.map(short).join(', ')}</b></span>` : ''}
      ${q.bgw.length ? `<span class="muted">BLANK: ${q.bgw.map(short).join(', ')}</span>` : ''}</div>`).join('')
      : '<p class="muted" style="font-size:12.5px">No blank or double gameweeks on the horizon.</p>'}
    <p class="muted" style="font-size:10.5px;margin-top:8px">Injury lines from the official FPL feed (Premier Injuries data), refreshed every few minutes on matchdays. Deep cuts: <a href="https://x.com/BenDinnery" target="_blank" rel="noopener" style="color:var(--accent)">@BenDinnery</a> · <a href="https://x.com/BenCrellin" target="_blank" rel="noopener" style="color:var(--accent)">@BenCrellin</a>.</p>
  </div>`;
}
/* ----- points grid: every score, every week — Draft Fantasy's Points tab ----- */
function pointsGridCard(standings) {
  const gws = [];
  for (let i = 0; i < GAMEWEEKS.length; i++) if (gwStatus(i) === 'final' || gwStatus(i) === 'live') gws.push(i);
  if (!gws.length) return '';
  const scores = {};
  for (const r of standings) scores[r.id] = gws.map(i => gwManagerPoints(r.id, i));
  const hi = gws.map((_, k) => Math.max(...standings.map(r => scores[r.id][k])));
  return `<div class="card" style="margin-bottom:18px">
    <h2>Points, week by week <span class="muted" style="font-weight:400;font-size:12px">gold = top score of the week</span></h2>
    <div style="overflow-x:auto">
    <table class="pool-table" style="font-size:12px">
      <thead><tr><th>Team</th>${gws.map(i => `<th class="num" title="${esc(GAMEWEEKS[i].label)}${gwStatus(i) === 'live' ? ' — in play' : ''}">${GAMEWEEKS[i].n}${gwStatus(i) === 'live' ? '&#8226;' : ''}</th>`).join('')}<th class="num act">Total</th></tr></thead>
      <tbody>${standings.map(r => `<tr>
        <td style="white-space:nowrap"><b>${esc(r.team || r.name)}</b></td>
        ${gws.map((i, k) => `<td class="num ${scores[r.id][k] === hi[k] && hi[k] > 0 ? 'gold' : 'muted'}">${scores[r.id][k]}</td>`).join('')}
        <td class="num act" style="font-weight:700">${scores[r.id].reduce((t, x) => t + x, 0)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}
/* ----- the Crystal Ball: luck, playoff odds, points left on bench ----- */
function crystalBallCard(standings) {
  const { rows: ap, played } = allPlayTable();
  if (!played) return '';
  const odds = playoffOdds();
  const rows = standings.map(r => {
    const a = ap[r.id];
    // expected H2H points if you'd played everyone: (3W + D) scaled to one game a week
    const expPts = (3 * a.w + a.d) / 11;
    const luck = r.pts - expPts;
    return { id: r.id, team: r.team || r.name, a, luck, waste: seasonBenchWaste(r.id), odds: odds?.[r.id] };
  });
  const luckiest = [...rows].sort((x, y) => y.luck - x.luck)[0];
  const wasteful = [...rows].sort((x, y) => y.waste - x.waste)[0];
  return `<div class="card" style="margin-bottom:18px">
    <h2>The Crystal Ball <span class="muted" style="font-weight:400;font-size:12px">luck, waste and destiny — the arguments, quantified</span></h2>
    <div style="overflow-x:auto">
    <table class="pool-table">
      <thead><tr><th>Team</th>
        <th class="num" title="Your win-draw-loss record against all eleven managers each finished week">Vs all</th>
        <th class="num" title="H2H points vs what your scores deserved. Positive = riding your luck">Luck</th>
        <th class="num" title="Points left on the bench vs your best possible XI, season total">Waste</th>
        ${odds ? '<th class="num" title="Monte Carlo simulation of the remaining fixtures, 1,000 runs">Playoffs %</th>' : ''}
      </tr></thead>
      <tbody>
      ${rows.map(r => `<tr>
        <td><b>${esc(r.team)}</b>${r.id === luckiest.id && r.luck > 1 ? ' <span title="Luckiest team in the league">&#127808;</span>' : ''}${r.id === wasteful.id && r.waste > 0 ? ' <span title="Most points left rotting on the bench">&#129681;</span>' : ''}</td>
        <td class="num muted">${r.a.w}-${r.a.d}-${r.a.l}</td>
        <td class="num" style="color:${r.luck > 0.5 ? '#3fb96d' : r.luck < -0.5 ? '#e05555' : 'var(--muted)'}">${r.luck > 0 ? '+' : ''}${r.luck.toFixed(1)}</td>
        <td class="num muted">${r.waste}</td>
        ${odds ? `<td class="num gold">${r.odds}%</td>` : ''}
      </tr>`).join('')}
      </tbody>
    </table></div>
    <p class="muted" style="font-size:10.5px;margin-top:6px"><b>Vs all:</b> the record your weekly score would have earned against all 11 managers, not only your fixture. <b>Luck:</b> actual H2H points minus what those scores deserved. <b>Waste:</b> points left on the bench vs your best possible XI. ${odds ? '<b>Playoff odds:</b> 1,000 simulated seasons from everyone’s scoring so far.' : 'Playoff odds appear after three finished gameweeks.'}</p>
  </div>`;
}
/* ----- the week's awards, auto-issued ----- */
// the week's honours, computed once — feeds the awards card AND the Minutes
function lastFinalGw() {
  let last = -1;
  for (let i = 0; i < REGULAR_GWS; i++) if (gwStatus(i) === 'final') last = i;
  return last;
}
// Marc, 9 Aug 2026: "cunt of the week… randomly assigned each week for
// whatever reason" — then, an hour later, "can you make it for an actual
// reason based on the gameplay". So it is earned. The Committee reads the
// week's settled data against a ranked charge sheet and names the gravest
// offence it can actually prove. No seed involved: the evidence is the same
// on all twelve phones. The stenographer declines to print the title in full.
//
// The draw survives only for weeks where nobody did anything chargeable.
const COTW_DRAWS = [
  'no reason was recorded',
  'the Committee declines to elaborate',
  'for the message sent at 23:41',
  'for what happened at the draft',
  'nothing specific. It was simply felt',
  'for the celebration',
  'the minutes on this point are sealed for thirty years',
  'for tone',
  'a matter arising',
  'reasons available on request, in writing, to an address that does not exist',
  'it was a quiet week and the trophy needed a home',
  'for conduct in the group chat, unspecified',
  'a complaint was received. It was anonymous. It was upheld',
  'for the second reminder about the fifty quid',
  'the Committee has moved on. The Committee has not moved on',
];
// The charge sheet, gravest first (Marc, 9 Aug: "annoying things like…").
// Every charge is provable from settled data — team sheets, the transfer log,
// timestamps against the deadline. Nothing here rewards or punishes a score:
// you get charged for the faffing, not for losing.
function cotwCharges(i) {
  const out = [];
  const file = (gravity, id, why, weight = 1) => { if (id != null) out.push({ gravity, id, why, weight }); };
  const nameOf = pid => PLAYER_BY_ID[pid]?.name || 'a player';
  const gwT = j => Date.parse(GAMEWEEKS[j]?.from || '') || 0;
  const deadline = gwT(i);
  const moves = state.transfers.filter(t => t.gw === i);
  const mins = pid => gwEvent(i)?.playerStats?.[pid]?.min || 0;
  // a feed that carries no minutes at all is a gap in the data, not twelve
  // negligent managers — the charges that read minutes stand down for the week
  const anyMins = Object.values(gwEvent(i)?.playerStats || {}).some(s => (s?.min || 0) > 0);
  // likewise the blank-gameweek charge: no fixture list, no accusation
  const gwN = GAMEWEEKS[i]?.n;
  const roundFx = state.fixtures.filter(f => f.gw === gwN);
  const blankFor = team => roundFx.length > 0 && !roundFx.some(f => f.home === team || f.away === team);
  const cup = state.hamCup && state.hamCup.status !== 'off' && GAMEWEEKS[state.hamCup.gw] ? state.hamCup : null;

  for (const m of state.managers) {
    const mid = m.id;
    const stored = state.lineups[mid] || {};
    const mine = moves.filter(t => t.managerId === mid);

    // I. named a man whose club were not playing. Marc's favourite, and the
    // one the fixture list proves outright
    const blanks = lineupFor(mid, i).map(pid => PLAYER_BY_ID[pid]).filter(p => p && blankFor(p.team));
    if (blanks.length) file(1, mid, blanks.length === 1
      ? `for naming ${blanks[0].name}, whose club were not playing`
      : `for naming ${blanks.length} men whose clubs were not playing, ${blanks[0].name} among them`, blanks.length);

    // II. the revolving door: signed and binned inside a week
    for (const t of mine) {
      const took = state.transfers.find(u => u.managerId === mid && u.inId === t.outId && u.gw >= i - 1 && u.gw <= i && (u.t || 0) < (t.t || 0));
      if (took) file(2, mid, `for signing ${nameOf(t.outId)} and binning him ${took.gw === i ? 'the same week' : 'seven days later'}, having seen enough`, took.gw === i ? 2 : 1);
    }

    // III. turned up short: an XI where the names outnumbered the participants
    const played = effectiveXI(mid, i).xi.filter(pid => mins(pid) > 0).length;
    if (anyMins && played <= 8) file(3, mid, `for naming eleven men and fielding ${played} who actually kicked a ball`, 11 - played);

    // IV. binned a man who went straight out and hauled
    for (const t of mine) {
      const got = t.outId ? gwPlayerPoints(t.outId, i) : 0;
      if (got >= 10) file(4, mid, `for binning ${nameOf(t.outId)}, who returned ${got} the same week`, got);
    }

    // V–VI. conduct in the XI they chose. Not their fault, strictly. The
    // Committee is not a court and has never claimed to be
    const xi = effectiveXI(mid, i).xi.map(pid => PLAYER_BY_ID[pid]).filter(Boolean);
    const stat = pid => gwEvent(i)?.playerStats?.[pid] || {};
    const redCard = xi.find(p => stat(p.id).rc);
    if (redCard) file(5, mid, `for fielding ${redCard.name}, who was sent off`);
    const ownGoal = xi.find(p => stat(p.id).og);
    if (ownGoal) file(6, mid, `for fielding ${ownGoal.name}, who scored at the wrong end`);
    const missedPen = xi.find(p => stat(p.id).pm);
    if (missedPen) file(7, mid, `for fielding ${missedPen.name}, who was handed a penalty and declined it`);

    // VIII. handed in an incomplete team sheet and left the repair to the app
    const sheet = stored[i];
    if (sheet && (sheet.length !== XI_RULES.size || !xiValid(sheet)))
      file(8, mid, `for handing in a team sheet of ${sheet.length} name${sheet.length === 1 ? '' : 's'} and leaving the Committee to finish it`, Math.abs(XI_RULES.size - sheet.length) + 1);

    // IX. a waiver claim spent on a man who never left the stands
    const dud = mine.filter(t => t.waiver && !mins(t.inId));
    if (anyMins && dud.length)
      file(9, mid, `for spending a waiver claim on ${nameOf(dud[0].inId)}, who did not record a minute`, dud.length);

    // X. selling your own declared Lobus (ledger #1). A constitutional matter
    for (const t of mine) if (state.lobus?.[mid] && state.lobus[mid] === t.outId)
      file(10, mid, `for selling ${nameOf(t.outId)}, their own declared Lobus. The klaxon has been disconnected`);

    // XI. deadline faffing — business conducted in the last hour, as is traditional
    const late = mine.filter(t => deadline && t.t && t.t < deadline && deadline - t.t <= 3600000)
      .sort((a, b) => b.t - a.t)[0];
    if (late) {
      const left = Math.max(1, Math.round((deadline - late.t) / 60000));
      file(11, mid, `for conducting business ${left} minute${left === 1 ? '' : 's'} before the deadline, as is traditional`, 61 - left);
    }

    // XII. offers out, all of them returned
    const offers = toArr(state.trades).filter(t => t.from === mid && t.t >= deadline - 6048e5 && t.t < deadline);
    if (offers.length >= 2 && offers.every(t => t.status === 'rejected' || t.status === 'withdrawn'))
      file(12, mid, `for sending ${offers.length} trade offers in one week and having all ${offers.length} returned`, offers.length);

    // XIII. the silent week: dead men in the squad, no claims, no moves. Claims
    // are wiped once a run settles, so the unattended squad is the evidence
    const dead = squadAt(mid, i).filter(p => !mins(p.id)).length;
    if (anyMins && !mine.length && !toArr(state.claims?.[i]?.[mid]).length && dead >= 4)
      file(13, mid, `for carrying ${dead} players who did not kick a ball and still not troubling the waiver list`, dead);

    // XIV. churn for its own sake
    if (mine.length >= 4) file(14, mid, `for making ${mine.length} transfers in a single week, none of which helped`, mine.length);

    // XV. needed the app to fix the side it was handed, having never said
    // which way round the bench should go
    const subs = effectiveXI(mid, i).subs.length;
    if (subs > 0 && !toArr(state.benchOrders?.[mid]?.[i]).length)
      file(15, mid, `for needing ${subs} auto-sub${subs === 1 ? '' : 's'} having never set a bench order`, subs);

    // XVI. never touched the team sheet this week
    if (!sheet) file(16, mid, 'for not naming a side at all, and letting last week’s eleven turn up on its own');

    /* ----- standing offences: not news, so they sit at the bottom of the
       sheet and surface only in weeks where nobody managed anything better.
       Marc, 9 Aug: these can and will land on the same man week after week. */

    // XVII. the Palwin Ham Cup (ledger #6) asks for eleven names and nothing else
    if (cup && i >= cup.gw && !toArr(cup.entries?.[mid]).length)
      file(17, mid, 'for never entering the Palwin Ham Cup, a competition that asks for eleven names and nothing else');

    if (!Object.keys(stored).length) file(18, mid, 'for never once naming a side all season, and letting the Committee pick one every week');

    // XIX. a second keeper who has not played a minute since the draft
    const keepers = squadAt(mid, i).filter(p => p.pos === 'GK');
    if (i >= 9 && keepers.length > 1) {
      const idle = keepers.find(p => !Array.from({ length: i + 1 }, (_, g) => g).some(g => gwStatus(g) === 'final' && appearedInGw(p.id, g)));
      if (idle) file(19, mid, `for a squad place spent on ${idle.name}, who has not played a minute all season`);
    }

    // XX. Tussie's right to draft an entire club is constitutionally
    // protected. It is not, however, above comment
    const byClub = {};
    for (const p of squadAt(mid, i)) byClub[p.team] = (byClub[p.team] || 0) + 1;
    const hoard = Object.entries(byClub).sort((a, b) => b[1] - a[1])[0];
    if (hoard && hoard[1] >= 5) file(20, mid, `for carrying ${hoard[1]} ${hoard[0]} players, which is permitted, and remains the problem`, hoard[1]);

    // XXI. draft-night clock abuse. One each, and they used it
    const stalling = state.draft?.timewastes?.[mid] || 0;
    if (stalling >= 1) file(21, mid, 'for timewasting on draft night and still not being ready when the clock came back');

    // XXII. listed nobody, all season, while maintaining everyone else is the problem
    if (state.phase === 'season' && !blockList(mid).length)
      file(22, mid, 'for listing nobody on the trade block all season, while maintaining that everyone else’s squad is the problem');

    // XXIII. covenants (ledger #7) that have quietly aged out
    const stale = toArr(state.covenants).filter(c => c.from === mid && i - (c.gw ?? i) >= 10)
      .sort((a, b) => (a.gw ?? 0) - (b.gw ?? 0))[0];
    if (stale) file(23, mid, `for a covenant with ${teamName(stale.to)}, entered into in GW${GAMEWEEKS[stale.gw]?.n ?? '?'} and never mentioned again`, i - stale.gw);

    // XXIV. the Suggestion Box, and the Committee's warm indifference to it
    const noted = toArr(state.suggestions).filter(s => s.by === mid && s.status === 'noted');
    if (noted.length >= 3) file(24, mid, `for ${noted.length} submissions to the Suggestion Box, every one of them still marked “noted”`, noted.length);

    if (!toArr(state.autolists?.[mid]).length) file(25, mid, 'for arriving at the draft without an autopick list, and expecting sympathy');
    if (state.phase === 'season' && !state.ready?.[mid]) file(26, mid, 'for never answering the pre-draft roll call');
    if (!state.lobus?.[mid]) file(27, mid, 'for still not having declared a Lobus');
    if (!state.heckles?.[mid]) file(28, mid, 'for going through an entire draft night without heckling anybody');
  }
  return out;
}
function cotwFor(i) {
  if (!state.managers.length) return null;
  // gravest charge wins, then the worst offence within it. Level offenders are
  // separated on their whole record for the week — most charges, then heaviest
  // — so it lands on merit and never on a coin toss (Marc, 9 Aug: "it shouldn't
  // be random, you can be cunt of the week multiple weeks in a row")
  const sheet = cotwCharges(i);
  if (sheet.length) {
    const rap = {};
    for (const c of sheet) {
      const r = rap[c.id] = rap[c.id] || { n: 0, w: 0 };
      r.n++; r.w += c.weight;
    }
    sheet.sort((a, b) => a.gravity - b.gravity || b.weight - a.weight
      || rap[b.id].n - rap[a.id].n || rap[b.id].w - rap[a.id].w || a.id - b.id);
    const top = sheet[0];
    return { id: top.id, why: top.why, proven: true, also: rap[top.id].n - 1 };
  }
  // a week in which the league behaved itself. The trophy still needs a home,
  // so the Committee draws lots — seeded off the gameweek the way chantFor is,
  // because Math.random() would name a different man on every phone
  const seed = (i * 2246822519 + 3266489917) >>> 0;
  const m = state.managers[seed % state.managers.length];
  return m ? { id: m.id, why: COTW_DRAWS[(seed >>> 8) % COTW_DRAWS.length], proven: false } : null;
}
function weeklyAwards(last) {
  const scores = state.managers.map(m => ({ id: m.id, s: gwManagerPoints(m.id, last), waste: benchWaste(m.id, last) }));
  const hi = [...scores].sort((a, b) => b.s - a.s)[0];
  const lo = [...scores].sort((a, b) => a.s - b.s)[0];
  const results = pairingsFor(last).map(([a, b]) => {
    const sa = gwManagerPoints(a, last), sb = gwManagerPoints(b, last);
    return sa === sb ? null : { w: sa > sb ? a : b, l: sa > sb ? b : a, ws: Math.max(sa, sb), ls: Math.min(sa, sb), margin: Math.abs(sa - sb) };
  }).filter(Boolean);
  const jammy = [...results].sort((a, b) => a.ws - b.ws)[0];
  const robbed = [...results].sort((a, b) => b.ls - a.ls)[0];
  const hiding = [...results].sort((a, b) => b.margin - a.margin)[0];
  const bench = [...scores].sort((a, b) => b.waste - a.waste)[0];
  // He's A Handful™ and the No-Footed Full Back retired by Committee order,
  // 1 Aug 2026 (Marc: "so much in there" — the six that survive are the six).
  // cotw is the seventh and is not earned; it is drawn.
  return { hi, lo, jammy, robbed, hiding, bench, cotw: cotwFor(last) };
}
// the same six awards judged across every settled gameweek — Marc's point:
// "those 6 are actually good, but it's more useful over the season"
function seasonAwards() {
  let hi = null, lo = null, jammy = null, robbed = null, hiding = null, bench = null, finals = 0;
  for (let i = 0; i < REGULAR_GWS; i++) {
    if (gwStatus(i) !== 'final') continue;
    finals++;
    for (const m of state.managers) {
      const s = gwManagerPoints(m.id, i);
      if (!hi || s > hi.s) hi = { id: m.id, s, gw: i };
      if (!lo || s < lo.s) lo = { id: m.id, s, gw: i };
      const waste = benchWaste(m.id, i);
      if (waste > 0 && (!bench || waste > bench.waste)) bench = { id: m.id, waste, gw: i };
    }
    for (const [a, b] of pairingsFor(i)) {
      const sa = gwManagerPoints(a, i), sb = gwManagerPoints(b, i);
      if (sa === sb) continue;
      const w = sa > sb ? a : b, l = sa > sb ? b : a, ws = Math.max(sa, sb), ls = Math.min(sa, sb);
      if (!jammy || ws < jammy.ws) jammy = { w, ws, gw: i };
      if (!robbed || ls > robbed.ls) robbed = { l, ls, gw: i };
      if (!hiding || ws - ls > hiding.margin) hiding = { w, l, ws, ls, margin: ws - ls, gw: i };
    }
  }
  return finals >= 2 ? { hi, lo, jammy, robbed, hiding, bench } : null;
}
/* The honours board (Marc, 9 Aug). The awards card shows this gameweek and a
   single season-best instance; neither tells you who has actually collected the
   most of anything. This tallies every settled gameweek and hands out gold,
   silver and bronze per category. Ties share a medal — two managers on four
   Wooden Spoons are both gold, and nobody gets silver. */
const AWARD_HONOURS = [
  { icon: '&#127942;', name: 'Manager of the Week', pick: a => a.hi?.id },
  { icon: '&#129348;', name: 'The Wooden Spoon', pick: a => a.lo?.id },
  { icon: '&#127808;', name: 'Jammiest Win', pick: a => a.jammy?.w },
  { icon: '&#128148;', name: 'Robbed', pick: a => a.robbed?.l },
  { icon: '&#128296;', name: 'Biggest Hiding', pick: a => a.hiding?.w },
  { icon: '&#129681;', name: 'Bench of the Week', pick: a => (a.bench?.waste > 0 ? a.bench.id : null) },
  { icon: '&#128683;', name: 'C*** of the Week', pick: a => a.cotw?.id },
];
function awardsHonoursCard() {
  const gws = [];
  for (let i = 0; i < REGULAR_GWS; i++) if (gwStatus(i) === 'final') gws.push(i);
  const head = `<h2>The Honours Board <span class="muted" style="font-weight:400;font-size:12px">who has actually collected what</span></h2>`;
  if (!gws.length) {
    return `<div class="card" style="margin-top:14px">${head}
      <p class="muted" style="font-size:12.5px">Nothing settled yet. The cabinet is empty and the polish is unopened.</p></div>`;
  }
  const weekly = gws.map(i => weeklyAwards(i));
  const medals = ['&#129351;', '&#129352;', '&#129353;'];
  // early season everyone is level on one, and twelve names in a cell is not a
  // medal — show three and count the rest
  const cell = tier => {
    if (!tier) return '<span class="muted">&mdash;</span>';
    const shown = tier.slice(0, 3).map(r => `<b>${esc(teamName(r.id))}</b> <span class="muted">${r.n}</span>`).join('<br>');
    return tier.length > 3 ? `${shown}<br><span class="muted">+${tier.length - 3} more level</span>` : shown;
  };
  return `<div class="card" style="margin-top:14px">${head}
    <div style="overflow-x:auto"><table class="pool-table">
      <thead><tr><th style="width:28%">Award</th>${medals.map(m => `<th style="width:24%">${m}</th>`).join('')}</tr></thead>
      <tbody>${AWARD_HONOURS.map(def => {
        const tally = {};
        for (const a of weekly) { const id = def.pick(a); if (id != null) tally[id] = (tally[id] || 0) + 1; }
        const ranked = Object.entries(tally).map(([id, n]) => ({ id: +id, n })).sort((a, b) => b.n - a.n);
        const levels = [...new Set(ranked.map(r => r.n))].slice(0, 3);
        const tiers = levels.map(c => ranked.filter(r => r.n === c));
        return `<tr>
          <td style="white-space:nowrap"><span aria-hidden="true">${def.icon}</span> ${esc(def.name)}</td>
          ${[0, 1, 2].map(i => `<td style="white-space:nowrap;font-size:12px">${cell(tiers[i])}</td>`).join('')}
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="muted" style="font-size:10.5px;margin-top:6px">Across ${gws.length} settled gameweek${gws.length === 1 ? '' : 's'}. The number is how many times it has been won. Level pegging shares the medal.</p>
  </div>`;
}
function awardsCard() {
  const last = lastFinalGw();
  if (last < 0) return '';
  const { hi, lo, jammy, robbed, hiding, bench, cotw } = weeklyAwards(last);
  const sa = seasonAwards();
  const row = (icon, label, text) => `<div class="award-row"><span class="award-icon" aria-hidden="true">${icon}</span><b class="award-label">${label}</b><span class="award-value">${text}</span></div>`;
  const gwTag = i => ` <span class="muted">(GW${GAMEWEEKS[i].n})</span>`;
  const sect = t => `<p class="muted" style="font-size:11px;margin:10px 0 2px;text-transform:uppercase;letter-spacing:.06em">${t}</p>`;
  return `<div class="card" style="margin-top:14px">
    <div class="awards-head">
      <div><h2>The Committee's Awards</h2><p>issued automatically, disputed endlessly</p></div>
      <button class="btn ghost small" id="copyMinutes" title="WhatsApp-ready gameweek recap">&#128203; Copy the Minutes</button>
    </div>
    ${sect(`This gameweek — GW${GAMEWEEKS[last].n}`)}
    <div class="awards-list">
      ${row('&#127942;', 'Manager of the Week', `<b>${esc(teamName(hi.id))}</b> — ${hi.s} points`)}
      ${row('&#129348;', 'The Wooden Spoon', `<b>${esc(teamName(lo.id))}</b> — ${lo.s} points`)}
      ${jammy ? row('&#127808;', 'Jammiest Win', `<b>${esc(teamName(jammy.w))}</b> won with just ${jammy.ws}`) : ''}
      ${robbed ? row('&#128148;', 'Robbed', `<b>${esc(teamName(robbed.l))}</b> scored ${robbed.ls} and still lost`) : ''}
      ${hiding ? row('&#128296;', 'Biggest Hiding', `<b>${esc(teamName(hiding.w))}</b> ${hiding.ws}–${hiding.ls} <b>${esc(teamName(hiding.l))}</b>`) : ''}
      ${bench.waste > 0 ? row('&#129681;', 'Bench of the Week', `<b>${esc(teamName(bench.id))}</b> left ${bench.waste} point${bench.waste === 1 ? '' : 's'} rotting on the bench`) : ''}
      ${cotw ? row('&#128683;', 'C*** of the Week', `<b>${esc(teamName(cotw.id))}</b> — ${esc(cotw.why)}${cotw.also > 0 ? ` <span class="muted">(and ${cotw.also} other matter${cotw.also === 1 ? '' : 's'} on the sheet)</span>` : ''}`) : ''}
    </div>
    ${cotw ? `<p class="muted" style="font-size:10.5px;margin-top:6px"><b>C*** of the Week:</b> charged on the week's evidence — team sheets, the transfer log, the fixture list and the clock — and ranked by gravity, not by score. You cannot earn it by playing badly, only by being annoying about it, and you keep it for as long as you keep earning it.${cotw.proven ? '' : ' Nobody offended this week, so the Committee drew lots.'} No appeal.</p>` : ''}
    ${sa ? `${sect('Season so far')}
    <div class="awards-list">
      ${row('&#127942;', 'Highest Score', `<b>${esc(teamName(sa.hi.id))}</b> — ${sa.hi.s} points${gwTag(sa.hi.gw)}`)}
      ${row('&#129348;', 'Lowest Score', `<b>${esc(teamName(sa.lo.id))}</b> — ${sa.lo.s} points${gwTag(sa.lo.gw)}`)}
      ${sa.jammy ? row('&#127808;', 'Jammiest Win', `<b>${esc(teamName(sa.jammy.w))}</b> won with just ${sa.jammy.ws}${gwTag(sa.jammy.gw)}`) : ''}
      ${sa.robbed ? row('&#128148;', 'Robbed', `<b>${esc(teamName(sa.robbed.l))}</b> scored ${sa.robbed.ls} and still lost${gwTag(sa.robbed.gw)}`) : ''}
      ${sa.hiding ? row('&#128296;', 'Biggest Hiding', `<b>${esc(teamName(sa.hiding.w))}</b> ${sa.hiding.ws}–${sa.hiding.ls} <b>${esc(teamName(sa.hiding.l))}</b>${gwTag(sa.hiding.gw)}`) : ''}
      ${sa.bench ? row('&#129681;', 'Bench Tragedy', `<b>${esc(teamName(sa.bench.id))}</b> left ${sa.bench.waste} on the bench${gwTag(sa.bench.gw)}`) : ''}
    </div>` : ''}
  </div>`;
}
/* ----- the Lobus (ledger #1): Registry card GONE (Marc, 1 Aug), declarations
   GONE (Marc, UAT night). The gag survives as the LOBUS KLAXON on the
   Vidiprinter, fired off LOBUS_LIST — no admin, no constitution clause. ----- */
/* ----- the Committee Minutes: one tap, WhatsApp-ready recap ----- */
function committeeMinutes(last) {
  const g = GAMEWEEKS[last];
  const { hi, lo, jammy, robbed, hiding, bench, cotw } = weeklyAwards(last);
  const L = [`\u{1F3C6} THE LEAGUE — GW${g.n} COMMITTEE MINUTES`, '', '*Results*'];
  for (const [a, b] of pairingsFor(last)) {
    const sa = gwManagerPoints(a, last), sb = gwManagerPoints(b, last);
    const na = sa > sb ? `*${teamName(a)}*` : teamName(a);
    const nb = sb > sa ? `*${teamName(b)}*` : teamName(b);
    L.push(`${na} ${sa}–${sb} ${nb}`);
  }
  L.push('', "*The Committee's Awards*");
  L.push(`\u{1F3C6} Manager of the Week: ${teamName(hi.id)} (${hi.s})`);
  L.push(`\u{1F944} Wooden Spoon: ${teamName(lo.id)} (${lo.s})`);
  if (jammy) L.push(`\u{1F340} Jammiest Win: ${teamName(jammy.w)} won with just ${jammy.ws}`);
  if (robbed) L.push(`\u{1F494} Robbed: ${teamName(robbed.l)} scored ${robbed.ls} and still lost`);
  if (hiding) L.push(`\u{1F528} Biggest Hiding: ${teamName(hiding.w)} ${hiding.ws}–${hiding.ls} ${teamName(hiding.l)}`);
  if (bench.waste > 0) L.push(`\u{1FAD1} Bench of the Week: ${teamName(bench.id)} left ${bench.waste} on the bench`);
  if (cotw) L.push(`\u{1F6AB} C*** of the Week: ${teamName(cotw.id)} — ${cotw.why}${cotw.also > 0 ? ` (and ${cotw.also} other matter${cotw.also === 1 ? '' : 's'} on the sheet)` : ''}${cotw.proven ? '' : ' (a quiet week; the Committee drew lots)'}`);
  const t = h2hStandings(false);
  L.push('', '*The Table*');
  t.slice(0, 4).forEach((r, i) => L.push(`${i + 1}. ${r.team || r.name} — ${r.pts}`));
  const bottom = t[t.length - 1];
  L.push('…', `${t.length}. ${bottom.team || bottom.name} — ${bottom.pts} \u{1F96B}`);
  L.push('', 'Minutes recorded automatically. Disputes to the group chat, where they will be enjoyed.');
  L.push('https://theleaguehq.co.uk/');
  return L.join('\n');
}
// the cheeky lineup shot on the dashboard matchup card (Ben, 1 Aug): both
// XIs as mini pitches, chips open player cards, points live once started
function dashMiniPitch(mid, gw) {
  const xi = lineupFor(mid, gw);
  // subs ride under the XI in queue order (Toby, GW1 eve: "on homepage it
  // doesn't show subs — it does everywhere else")
  const bench = benchFor(mid, gw);
  return `<div style="overflow-x:auto"><div class="pitch mu-pitch">${['GK', 'DF', 'MF', 'FW'].map(pos => `<div class="pitch-row">${
    xi.map(pid => PLAYER_BY_ID[pid]).filter(p => p && p.pos === pos).map(p => `
      <div class="pitch-chip mu-chip ${statusClass(p)}" data-pcard="${p.id}" style="cursor:pointer">
        ${kitImg(p.team, p.pos === 'GK')}
        <span class="pitch-name">${esc(p.name)}</span>
        ${gwUnderway(gw) ? `<span class="mu-pts">${gwPlayerPoints(p.id, gw)}</span>` : ''}
      </div>`).join('') || '<span class="muted" style="font-size:10px">—</span>'}</div>`).join('')}</div>
  ${bench.length ? `<div class="bench-strip">
    <span class="muted" style="font-size:10px;font-weight:700;align-self:center">BENCH</span>
    ${bench.map((p, bi) => `
      <div class="pitch-chip mu-chip benched ${statusClass(p)}" data-pcard="${p.id}" style="cursor:pointer">
        <span class="tag" style="font-size:9px;padding:1px 5px">${bi + 1}</span>
        ${kitImg(p.team, p.pos === 'GK')}
        <span class="pitch-name">${esc(p.name)}</span>
        ${gwUnderway(gw) ? `<span class="mu-pts">${gwPlayerPoints(p.id, gw)}</span>` : ''}
      </div>`).join('')}
  </div>` : ''}</div>`;
}
function bindDash() {
  bindInstall();
  const pr = $('#progRead');
  if (pr) pr.onclick = () => { markGazetteRead(); gazetteSheet(); render(); };
  const gzn = $('#gzNudge');
  if (gzn) gzn.onclick = () => { markGazetteRead(); gazetteSheet(); render(); };
  const ofn = $('#offerNudge');
  if (ofn) ofn.onclick = () => { transfersView.tab = 'trades'; state.view = 'transfers'; save(); render(); };
  const dmu = $('#dashMu');
  if (dmu) dmu.ontoggle = () => localStorage.setItem(DASHMU_KEY, dmu.open ? '1' : '0');
  const psh = $('#progShare');
  if (psh) psh.onclick = () => {
    const txt = gazetteShareText();
    if (!txt) return;
    (navigator.clipboard?.writeText(txt) || Promise.reject()).then(
      () => toast('Front page copied — paste it into the group chat.'),
      () => { window.prompt('Copy the front page:', txt); });
  };
  const fb = $('#foundBtn');
  if (fb) fb.onclick = () => clubEditor(+fb.dataset.mid);
  const fl = $('#foundLater');
  if (fl) fl.onclick = () => { localStorage.setItem(`${LS_NS}-founded-${fl.dataset.mid}`, '1'); render(); };
  const ds = $('#dashSignIn');
  if (ds) ds.onclick = () => { spectating = false; localStorage.removeItem(SPECT_KEY); whoami = null; forceIdentity = true; render(); };
  document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => {
    if (b.dataset.goto === 'transfers') transfersView.tab = 'history'; // Latest business lands on the full record
    state.view = b.dataset.goto; save(); render();
  });
  const bizMore = $('#bizMore');
  if (bizMore) bizMore.onclick = () => { window._bizOpen = true; render(); };
  const bizLess = $('#bizLess');
  if (bizLess) bizLess.onclick = () => { window._bizOpen = false; render(); };
  bindAwardsBits(); // awards/treatment live in the Data Room now, but stay bound if ever re-hosted
  document.querySelectorAll('[data-mu]').forEach(el => el.onclick = () => {
    const [a, b, i] = el.dataset.mu.split(':').map(Number);
    showMatchup(a, b, i);
  });
}

/* ----- playoffs (top 8: GW34 handicap quarter-finals, GW35 semis, GW36–38 three-legged final) ----- */
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) === 1 ? 1 : n % 10 === 2 ? 2 : n % 10 === 3 ? 3 : 0]);
// QF head start for the higher seed: the FULL table-Points gap between the
// pair (Marc + Toby, group chat 3 Aug: "just the table points gap", "full
// handicap week one" — replaces the halved-and-capped-15 version; a tight
// 4v5 still carries next to nothing)
const qfHandicap = (ptsHigh, ptsLow) => Math.max(0, ptsHigh - ptsLow);
function playoffState() {
  for (let i = 0; i < REGULAR_GWS; i++) if (gwStatus(i) !== 'final') return null;
  const table = standingsBefore(REGULAR_GWS).rows;
  const seeds = table.map(r => r.id).slice(0, 8);
  // H2H table Points, not overall fantasy points (Marc's "+11" bracket bug)
  const tablePts = Object.fromEntries(table.map(r => [r.id, r.h2h]));
  const qfIdx = REGULAR_GWS;       // GW34
  const semiIdx = REGULAR_GWS + 1; // GW35
  const finalIdx = [REGULAR_GWS + 2, REGULAR_GWS + 3, REGULAR_GWS + 4]; // GW36–38
  const higherSeed = (a, b) => seeds.indexOf(a) < seeds.indexOf(b) ? a : b;
  const qfs = [[seeds[0], seeds[7]], [seeds[1], seeds[6]], [seeds[2], seeds[5]], [seeds[3], seeds[4]]];
  const handicaps = qfs.map(([a, b]) => qfHandicap(tablePts[a], tablePts[b]));
  const qfWinners = gwStatus(qfIdx) === 'final' ? qfs.map(([a, b], k) => {
    const pa = gwManagerPoints(a, qfIdx) + handicaps[k], pb = gwManagerPoints(b, qfIdx);
    return pa === pb ? higherSeed(a, b) : (pa > pb ? a : b);
  }) : null;
  // fixed bracket: winner of 1v8 meets winner of 4v5, winner of 2v7 meets winner of 3v6
  const semis = qfWinners ? [[qfWinners[0], qfWinners[3]], [qfWinners[1], qfWinners[2]]] : null;
  const semiWinners = semis && gwStatus(semiIdx) === 'final' ? semis.map(([a, b]) => {
    const pa = gwManagerPoints(a, semiIdx), pb = gwManagerPoints(b, semiIdx);
    return pa === pb ? higherSeed(a, b) : (pa > pb ? a : b);
  }) : null;
  let champion = null;
  if (semiWinners && finalIdx.every(i => gwStatus(i) === 'final')) {
    const [x, y] = semiWinners;
    let wx = 0, wy = 0, cx = 0, cy = 0;
    for (const i of finalIdx) {
      const px = gwManagerPoints(x, i), py = gwManagerPoints(y, i);
      cx += px; cy += py;
      if (px > py) wx++; else if (py > px) wy++;
    }
    champion = wx > wy ? x : wy > wx ? y
      : cx > cy ? x : cy > cx ? y : higherSeed(x, y);
  }
  return { seeds, qfs, handicaps, qfIdx, qfWinners, semis, semiIdx, semiWinners, finalIdx, champion };
}
function playoffCard() {
  const po = playoffState();
  if (!po) {
    return `<div class="card" style="margin-bottom:18px"><h2>The Playoffs</h2>
      <p class="muted" style="font-size:12.5px">GW33 ends the regular season. Top eight go through. <b>GW34</b>: handicap quarter-finals — 1v8, 2v7, 3v6, 4v5, the higher seed starting with <b>the full table-Points gap</b> between the pair. Finish miles clear, start miles ahead. <b>GW35</b>: semi-finals — winner of 1v8 meets winner of 4v5, winner of 2v7 meets winner of 3v6. <b>GW36–38</b>: the three-legged final — most legs won, then cumulative points, then regular-season position. Ties elsewhere: higher seed advances.</p></div>`;
  }
  const seedNo = id => po.seeds.indexOf(id) + 1;
  const stageHead = t => `<p class="muted" style="font-size:11px;margin:10px 0 2px;text-transform:uppercase;letter-spacing:.06em">${t}</p>`;
  const tieRow = (a, b, score, hcap) => `<div class="h2h-fx fx-row">
      <span class="fx-name fx-l">${esc(teamName(a))}${hcap ? ` <span class="gold" style="font-size:11px" title="handicap — the higher seed starts +${hcap}">+${hcap}</span>` : ''}</span>
      <span class="fx-chip"><small class="muted">${ord(seedNo(a))}</small></span>
      <span class="fx-score">${score}</span>
      <span class="fx-chip"><small class="muted">${ord(seedNo(b))}</small></span>
      <span class="fx-name">${esc(teamName(b))}</span></div>`;
  const qfRows = po.qfs.map(([a, b], k) => tieRow(a, b,
    gwStatus(po.qfIdx) === 'upcoming' ? 'GW34' : `${gwManagerPoints(a, po.qfIdx) + po.handicaps[k]} – ${gwManagerPoints(b, po.qfIdx)}`,
    po.handicaps[k])).join('');
  const semiRows = po.semis ? po.semis.map(([a, b]) => tieRow(a, b,
    gwStatus(po.semiIdx) === 'upcoming' ? 'GW35' : `${gwManagerPoints(a, po.semiIdx)} – ${gwManagerPoints(b, po.semiIdx)}`)).join('') : '';
  let finalRows = '';
  if (po.semiWinners) {
    const [x, y] = po.semiWinners;
    const played = po.finalIdx.filter(i => gwStatus(i) !== 'upcoming');
    if (!played.length) finalRows = tieRow(x, y, 'GW36–38');
    else {
      const legs = played.map(i => `${gwManagerPoints(x, i)}–${gwManagerPoints(y, i)}`);
      const agg = played.reduce((t, i) => [t[0] + gwManagerPoints(x, i), t[1] + gwManagerPoints(y, i)], [0, 0]);
      finalRows = tieRow(x, y, `${agg[0]} – ${agg[1]}`)
        + `<p class="muted" style="font-size:11px;text-align:center;margin:2px 0 0">legs: ${legs.join(' · ')}${played.length < 3 ? ` · ${3 - played.length} to play` : ' · aggregate'}</p>`;
    }
  }
  return `<div class="card" style="margin-bottom:18px"><h2>The Playoffs</h2>
    ${stageHead('Quarter-finals · GW34 · handicaps apply')}${qfRows}
    ${po.semis ? stageHead('Semi-finals · GW35') + semiRows : ''}
    ${finalRows ? stageHead('The Final · GW36–38 · three legs') + finalRows : ''}
    ${po.champion ? `<p style="text-align:center;font-size:16px;margin-top:10px">&#127942; <b>${esc(teamName(po.champion))}</b> — champions of The League 2026/27</p>` : ''}
  </div>`;
}

/* ----- head-to-head ----- */
/* ----- fixture matchup: side-by-side pitches, Draft Fantasy style ----- */
let muView = 'pitch';
function showMatchup(a, b, i) {
  const reopening = !!$('#muOverlay'); // pitch/table toggle re-renders in place
  $('#muOverlay')?.remove();
  const started = gwStatus(i) !== 'upcoming';
  const effInfo = {};
  // pending: the sub hasn't been awarded yet, but his club is finished and the
  // bench man has played, so it's coming (Marc, 23 Aug 2026). Shirts don't move
  // until the final whistle — only the marker and the +N say what's due.
  const markInfo = {};
  for (const mid of [a, b]) {
    effInfo[mid] = started ? effectiveXI(mid, i) : { xi: lineupFor(mid, i), subs: [] };
    markInfo[mid] = started ? subMarks(mid, i) : {};
  }
  const xiOf = mid => effInfo[mid].xi;
  const chip = (pid, mid) => {
    const p = PLAYER_BY_ID[pid];
    const pts = started ? gwPlayerPoints(pid, i) : null;
    return `<div class="pitch-chip mu-chip ${statusClass(p)}" data-pcard="${p.id}">
      ${kitImg(p.team, p.pos === 'GK')}
      <span class="pitch-name">${esc(p.name)}</span>
      ${pts != null ? `<span class="mu-pts">${pts}</span>` : `<span class="pitch-vs">${nextOppHtml(p.team, GAMEWEEKS[i].n)}</span>`}
      ${markInfo[mid][pid] || ''}
    </div>`;
  };
  // the bench: unused subs in priority order, then anyone auto-subbed OUT
  const benchOf = mid => {
    const xi = new Set(xiOf(mid));
    const outs = new Set(effInfo[mid].subs.map(s => s.out));
    return [...benchFor(mid, i).filter(p => !xi.has(p.id)), ...squadAt(mid, i).filter(p => outs.has(p.id))];
  };
  const sideBench = mid => {
    const bench = benchOf(mid);
    if (!bench.length) return '';
    return `<div class="bench-strip mu-bench">
      <span class="muted" style="font-size:10px;font-weight:700;align-self:center">BENCH</span>
      ${bench.map(p => `<div class="pitch-chip mu-chip benched ${statusClass(p)}" data-pcard="${p.id}">
        ${kitImg(p.team, p.pos === 'GK')}
        <span class="pitch-name">${esc(p.name)}</span>
        ${started ? `<span class="mu-pts">${gwPlayerPoints(p.id, i)}</span>` : ''}
        ${markInfo[mid][p.id] || ''}
      </div>`).join('')}
    </div>`;
  };
  const sidePitch = mid => `<div class="pitch mu-pitch">
    ${['GK', 'DF', 'MF', 'FW'].map(pos =>
      `<div class="pitch-row">${xiOf(mid).map(pid => PLAYER_BY_ID[pid]).filter(p => p.pos === pos).map(p => chip(p.id, mid)).join('')}</div>`).join('')}
  </div>${sideBench(mid)}`;
  const sideTable = mid => `<div>${xiOf(mid).map(pid => PLAYER_BY_ID[pid])
    .sort((x, y) => POS_ORDER[x.pos] - POS_ORDER[y.pos])
    .map(p => `<div class="lrow" style="font-size:12px"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${pname(p)}<span class="sp-pts ${started && gwPlayerPoints(p.id, i) > 0 ? 'gold' : 'muted'}" style="margin-left:auto">${started ? gwPlayerPoints(p.id, i) : playerXp(p).toFixed(1)}</span></div>`).join('')}
    ${benchOf(mid).map(p => `<div class="lrow" style="font-size:11.5px;opacity:.65"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${pname(p)}<span class="xi-chip">bench</span><span class="sp-pts muted" style="margin-left:auto">${started ? gwPlayerPoints(p.id, i) : ''}</span></div>`).join('')}</div>`;
  const side = mid => `<div class="mu-side">
    <h3 style="text-align:center">${crestSvg(mid, 15)} ${kitSvg(mid)} ${esc(teamName(mid))} <b class="gold">${started ? liveScoreHtml(mid, i) : projectedGwScore(mid, i)}</b></h3>
    ${gafferFor(mid) ? `<p class="muted" style="text-align:center;font-size:10.5px;margin:-4px 0 4px">${gafferChip(mid)}</p>` : ''}
    <p style="text-align:center;font-size:10.5px;margin:-2px 0 4px">${lineupStamp(mid, i)}</p>
    ${muView === 'pitch' ? sidePitch(mid) : sideTable(mid)}
  </div>`;
  const ov = document.createElement('div');
  ov.id = 'muOverlay';
  ov.className = 'overlay';
  ov.innerHTML = `<div class="card mu-card">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div class="pool-controls" style="margin:0">
        <button class="btn small ${muView === 'pitch' ? '' : 'ghost'}" id="muPitch">Pitch</button>
        <button class="btn small ${muView === 'table' ? '' : 'ghost'}" id="muTable">Table</button>
      </div>
      <p class="venue-line" style="flex:1;margin:0">GW${GAMEWEEKS[i].n} &middot; at ${esc(stadium(a))} &middot; Att ${attendance(a, b, i).toLocaleString()}${gwStatus(i) === 'final' ? ' &middot; full time' : ''}</p>
      <button class="btn ghost small" id="muClose">&#10005;</button>
    </div>
    <div class="h2h-fx mu-scoreline fx-hero">
      <span class="fx-side">${kitSvg(a, 28)}<b>${esc(teamName(a))}</b></span>
      <span class="fx-score${started ? '' : ' projected'}">${started ? '' : '<span class="proj-tag">proj</span> '}${started ? liveScoreHtml(a, i) : projectedGwScore(a, i)} &ndash; ${started ? liveScoreHtml(b, i) : projectedGwScore(b, i)}</span>
      <span class="fx-side">${kitSvg(b, 28)}<b>${esc(teamName(b))}</b></span>
    </div>
    ${winProbBar(a, b, i, (whoami === a || whoami === b) ? whoami : null)}
    ${adStrip(a * 1009 + b * 31 + i, 4, a)}
    <div class="mu-grid">${side(a)}${side(b)}</div>
    <p class="venue-line" style="margin-top:8px">${esc(chantFor(a, b, i))}</p>
  </div>`;
  ov.onclick = e => { if (e.target === ov || e.target.id === 'muClose') closeOv(ov); };
  ov.querySelector('#muPitch').onclick = e => { e.stopPropagation(); muView = 'pitch'; showMatchup(a, b, i); };
  ov.querySelector('#muTable').onclick = e => { e.stopPropagation(); muView = 'table'; showMatchup(a, b, i); };
  document.body.appendChild(ov);
  if (!reopening) pushOvState(); // phone back button closes the matchup, not the site
}
let h2hView = { gw: null };
function bindH2H() {
  bindPitchLinks();
  document.querySelectorAll('[data-mu]').forEach(el => el.onclick = () => {
    const [a, b, i] = el.dataset.mu.split(':').map(Number);
    showMatchup(a, b, i);
  });
  // the real-fixture rows open the same match centre as the dashboard ticker
  document.querySelectorAll('[data-fx]').forEach(el => el.onclick = e => {
    if (e.target.closest('.fx-yt')) return; // the Highlights link keeps its job
    showFixtureCard(+el.dataset.fx);
  });
  const prev = $('#gwPrev'), next = $('#gwNext');
  if (prev) prev.onclick = () => { h2hView.gw = Math.max(0, h2hView.gw - 1); render(); };
  if (next) next.onclick = () => { h2hView.gw = Math.min(REGULAR_GWS - 1, h2hView.gw + 1); render(); };
  const cp = $('#copyPreview');
  if (cp) cp.onclick = e => {
    e.stopPropagation();
    const txt = gwPreviewText(currentGwIndex());
    if (!txt) return;
    (navigator.clipboard?.writeText(txt) || Promise.reject()).then(
      () => toast('Preview copied — paste straight into the chat'),
      () => { window.prompt('Copy the Preview:', txt); });
  };
}

/* ----- the weekly preview ----- */
function lastMeetings(a, b, before) {
  const res = [];
  for (let i = 0; i < before; i++) {
    if (gwStatus(i) !== 'final') continue;
    if (pairingsFor(i).some(([x, y]) => (x === a && y === b) || (x === b && y === a))) {
      res.push({ gw: i, pa: gwManagerPoints(a, i), pb: gwManagerPoints(b, i) });
    }
  }
  return res;
}
// average FPL strength of the clubs a manager's XI faces this gameweek (lower = kinder)
function fixtureEase(mid, gwIdx) {
  const gwN = GAMEWEEKS[gwIdx].n;
  const opps = [];
  for (const pid of lineupFor(mid, gwIdx)) {
    const p = PLAYER_BY_ID[pid];
    for (const f of state.fixtures) {
      if (f.gw !== gwN) continue;
      if (f.home === p.team) opps.push(TEAM_BY_NAME[f.away]?.str);
      else if (f.away === p.team) opps.push(TEAM_BY_NAME[f.home]?.str);
    }
  }
  const vals = opps.filter(Boolean);
  return vals.length ? vals.reduce((t, v) => t + v, 0) / vals.length : null;
}
function rivalryFor(a, b, seed) {
  if (typeof RIVALRIES === 'undefined') return null;
  const hits = RIVALRIES.filter(r => (r.pair[0] === a && r.pair[1] === b) || (r.pair[0] === b && r.pair[1] === a));
  return hits.length ? hits[seed % hits.length].line : null;
}
/* ----- from the terraces (requested by Marc, 03/07/2026, 12:59) ----- */
const CHANTS = [
  '\u{1F3B5} One {star}! There\u2019s only one {star}!',
  '\u{1F3B5} {hmgr}\u2019s barmy army! {hmgr}\u2019s barmy army!',
  '\u{1F3B5} Stand up if you hate {away}!',
  '\u{1F3B5} You\u2019re getting dropped in the mo-o-orning \u2014 dropped in the morning!',
  '\u{1F3B5} 2-1 to the {home}! (Prutton, from the away end)',
  '\u{1F3B5} Que sera sera, whatever will be will be, we\u2019re going to {stadium}, que sera sera',
  '\u{1F3B5} Is this the Emirates? Is this the Emirates?',
  '\u{1F3B5} We forgot that you were here \u2014 we forgot that you were he-ere',
  '\u{1F3B5} Empty seats! Empty seats! (the {stadium} faithful, all four of them)',
  '\u{1F4CB} A banner unfurls at {stadium}: \u201CWELCOME TO HELL\u201D. Stewards confirm it is laminated.',
  '\u{1F3B5} You\u2019ve only got one Lobus \u2014 one Lobus, you\u2019ve only got one Lobus',
  '\u{1F3B5} We want our fifty quid back! We want our fifty quid back!',
  '\u{1F3B5} {amgr}, give us a wave \u2014 {amgr}, {amgr}, give us a wave',
  '\u{1F3B5} Sacked in the morning, you\u2019re getting sacked in the morning ({away} board: no comment)',
  '\u{1F3B5} Shall we sing a song for you? The {stadium} end asks, genuinely, out of concern',
];
function chantFor(a, b, i) {
  const seed = (i * 2654435761 + a * 97 + b * 13) >>> 0;
  const t = CHANTS[seed % CHANTS.length];
  const xi = lineupFor(a, i).map(pid => PLAYER_BY_ID[pid]).sort((x, y) => rating(y) - rating(x));
  return t.replaceAll('{star}', xi[0]?.name || 'the big man')
    .replaceAll('{home}', teamName(a)).replaceAll('{away}', teamName(b))
    .replaceAll('{hmgr}', managerName(a).split(' ')[0]).replaceAll('{amgr}', managerName(b).split(' ')[0])
    .replaceAll('{stadium}', stadium(a));
}

function gwPreviewData(i) {
  if (i >= REGULAR_GWS || gwStatus(i) === 'final' || !state.draft.picks.length) return null;
  const pairs = pairingsFor(i);
  if (!pairs.length) return null;
  const table = h2hStandings();
  const posOf = Object.fromEntries(table.map((r, k) => [r.id, k + 1]));
  const anyPlayed = table.some(r => r.p > 0);
  const rows = pairs.map(([a, b]) => {
    const sa = projectedGwScore(a, i), sb = projectedGwScore(b, i);
    return { a, b, sa, sb, p: liveWinProb(a, b, i), riv: rivalryFor(a, b, i) || (rivalsOf(a).includes(b) || rivalsOf(b).includes(a) ? 'Derby day — a declared rivalry.' : null) };
  });
  // matchup of the week: a rivalry if one is on, else the tightest projection
  const motw = [...rows].sort((x, y) => (y.riv ? 1 : 0) - (x.riv ? 1 : 0) || Math.abs(x.sa - x.sb) - Math.abs(y.sa - y.sb))[0];
  const notes = r => {
    const out = [];
    if (r.riv) out.push(r.riv);
    const met = lastMeetings(r.a, r.b, i);
    if (met.length) {
      const m = met[met.length - 1];
      out.push(m.pa === m.pb
        ? `Last met GW${GAMEWEEKS[m.gw].n}: a ${m.pa}–${m.pb} draw nobody enjoyed.`
        : `Last met GW${GAMEWEEKS[m.gw].n}: ${teamName(m.pa > m.pb ? r.a : r.b)} won it ${Math.max(m.pa, m.pb)}–${Math.min(m.pa, m.pb)}.`);
    } else if (anyPlayed) out.push('First meeting of the season.');
    if (anyPlayed && out.length < 2) {
      for (const id of [r.a, r.b]) {
        if (posOf[id] >= 10) { out.push(`${teamName(id)} (${ord(posOf[id])}) badly needs the points.`); break; }
        if (posOf[id] === 9) { out.push(`${teamName(id)} sits 9th — right on the playoff line.`); break; }
      }
    }
    if (out.length < 2) {
      const ea = fixtureEase(r.a, i), eb = fixtureEase(r.b, i);
      if (ea && eb && Math.abs(ea - eb) > 40) out.push(`${teamName(ea < eb ? r.a : r.b)}'s players have the kinder club fixtures this week.`);
    }
    if (out.length < 2 && typeof MANAGER_LORE !== 'undefined') {
      for (const id of [r.a, r.b]) if (MANAGER_LORE[id]) { out.push(`${managerName(id)} ${MANAGER_LORE[id]}.`); break; }
    }
    return out.slice(0, 2);
  };
  const recent = state.transfers.filter(t => t.gw === i || t.gw === i - 1).slice(-6);
  return { rows, motw, notes, recent };
}
/* ----- the GW preview, WhatsApp-ready: the Minutes' pre-match twin ----- */
function gwPreviewText(i) {
  const d = gwPreviewData(i);
  if (!d) return '';
  const L = [`\u{1F52E} THE LEAGUE — GW${GAMEWEEKS[i].n} PREVIEW`, ''];
  const line = r => {
    const pct = Math.round(r.p * 100);
    const fav = pct >= 50 ? r.a : r.b;
    const name = id => id === fav ? `*${teamName(id)}*` : teamName(id);
    return `${name(r.a)} ${r.sa}–${r.sb} ${name(r.b)} (${Math.max(pct, 100 - pct)}%)`;
  };
  L.push('⭐ Matchup of the Week');
  L.push(line(d.motw));
  for (const n of d.notes(d.motw)) L.push(`_${n}_`);
  L.push(`_${chantFor(d.motw.a, d.motw.b, i)}_`);
  L.push('', '*The rest*');
  for (const r of d.rows.filter(r => r !== d.motw)) L.push(line(r));
  if (d.recent.length) L.push('', `\u{1F416} Trough watch: ${d.recent.map(t => `${managerName(t.managerId)} ${t.trade ? 'traded for' : 'signed'} ${PLAYER_BY_ID[t.inId]?.name || '?'}`).join(' · ')}`);
  L.push('', 'Projections from FPL expected points. The Committee accepts no liability.');
  L.push('https://theleaguehq.co.uk/');
  return L.join('\n');
}
function gwPreviewCard(i) {
  const d = gwPreviewData(i);
  if (!d) return '';
  const { rows, motw, notes, recent } = d;
  const trough = recent.length ? `<p class="muted" style="font-size:12px;margin-top:10px"><b>Trough watch:</b> ${recent.map(t => `${esc(managerName(t.managerId))} ${t.trade ? 'traded for' : 'signed'} ${esc(PLAYER_BY_ID[t.inId]?.name || '?')}`).join(' · ')}</p>` : '';
  return `<div class="card" style="margin-bottom:18px">
    <h2>GW${GAMEWEEKS[i].n} Preview <span class="tag">projected scores &amp; win chance</span>
      <button class="btn ghost small" id="copyPreview" style="margin-left:auto" title="WhatsApp-ready preview">&#128203; Copy the Preview</button></h2>
    ${[motw, ...rows.filter(r => r !== motw)].map(r => {
      const pct = Math.round(r.p * 100);
      return `<div class="preview-fx${r === motw ? ' motw' : ''}">
        ${r === motw ? '<div class="motw-tag">&#11088; MATCHUP OF THE WEEK</div>' : ''}
        <div class="h2h-fx fx-row" data-mu="${r.a}:${r.b}:${i}" style="cursor:pointer" title="Tap for the matchup">
          <span class="fx-name fx-l">${esc(teamName(r.a))}</span>
          <span class="fx-chip"><b class="pct">${pct}%</b></span>
          <span class="fx-score" title="projected score">${r.sa} &ndash; ${r.sb}</span>
          <span class="fx-chip"><b class="pct">${100 - pct}%</b></span>
          <span class="fx-name">${esc(teamName(r.b))}</span>
        </div>
        <div class="venue-line">at ${esc(stadium(r.a))}</div>
        ${notes(r).map(n => `<div class="preview-note">${esc(n)}</div>`).join('')}
      </div>`;
    }).join('')}
    ${trough}
    <p class="muted" style="font-size:10.5px;margin-top:8px">Projections built from FPL expected points for each current XI. The Committee accepts no liability.</p>
  </div>`;
}

function viewH2H() {
  const cur = currentGwIndex();
  // settled results only (Toby, GW1 weekend) — in-play scores stay on the
  // matchup cards and the Vidiprinter; the standings wait for the whistle
  const standings = h2hStandings(false);
  // the standings table itself moved to the League Table page (Ben, 1 Aug:
  // "the head to head table is what should be in the league table") — this
  // page is Matches: fixtures, preview, playoffs, points grid, crystal ball
  const matchesCard = (() => {
    // the Matches page opens on the league's front-page gameweek — the
    // settled round stays up as THE result until the post-round waiver run
    // has processed (leagueGwIndex; Ben, 25 Aug)
    if (h2hView.gw == null) h2hView.gw = Math.min(leagueGwIndex(), REGULAR_GWS - 1);
    const i = h2hView.gw, g = GAMEWEEKS[i];
    const st = gwStatus(i);
    const tag = st === 'final' ? '<span class="tag">FT</span>'
      : st === 'live' ? '<span class="tag live-tag"><span class="rec"></span>LIVE</span>'
      : st === 'underway' ? '<span class="tag">underway — refresh for the latest</span>'
      : '<span class="tag">upcoming</span>';
    return `
    <div class="card" style="margin-bottom:12px">
      <h2 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">GW${g.n} Matches ${tag}
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center;flex:none">
          <button class="btn ghost small" id="gwPrev" ${i === 0 ? 'disabled' : ''}>&#8249; Previous</button>
          <span class="tag">${g.n}</span>
          <button class="btn ghost small" id="gwNext" ${i >= REGULAR_GWS - 1 ? 'disabled' : ''}>Next &#8250;</button>
        </span>
      </h2>
      ${pairingsFor(i).map(([a, b]) => {
        const pa = st === 'upcoming' ? '–' : gwManagerPoints(a, i);
        const pb = st === 'upcoming' ? '–' : gwManagerPoints(b, i);
        const aWin = st === 'final' && pa > pb, bWin = st === 'final' && pb > pa;
        // the scoreline carries the settled number plus whatever the certain
        // auto-subs owe (Marc, 23 Aug 2026); the win/loss test stays on settled
        const sa = st === 'upcoming' ? '–' : liveScoreHtml(a, i);
        const sb = st === 'upcoming' ? '–' : liveScoreHtml(b, i);
        return `<div class="h2h-fx fx-row" data-mu="${a}:${b}:${i}" style="cursor:pointer" title="Tap for the matchup">
          <span class="fx-name fx-l ${aWin ? 'h2h-win' : ''}">${esc(teamName(a))}</span>
          <span class="fx-chip">${kitSvg(a)}<small class="muted">(H)</small></span>
          <span class="fx-score">${sa} &ndash; ${sb}</span>
          <span class="fx-chip">${kitSvg(b)}</span>
          <span class="fx-name ${bWin ? 'h2h-win' : ''}">${esc(teamName(b))}</span>
        </div>
        <div class="venue-line">${derbyTag(a, b) ? derbyTag(a, b) + ' &middot; ' : ''}${esc(stadium(a))}${st === 'live' || st === 'underway' ? (() => {
          // three-way, to agree with the bar on the matchup card this row opens
          const o = matchOdds(a, b, i);
          const w = Math.round(o.win * 100), dr = Math.round(o.draw * 100);
          const ta = teamOutlook(a, i), tb = teamOutlook(b, i);
          return ` &middot; win chance ${w}%${dr ? ` – ${dr}% draw` : ''} – ${100 - w - dr}%` +
            ` &middot; ${ta.toPlay} v ${tb.toPlay} still to play`;
        })() : ''}</div>`;
      }).join('')}
      <h3 style="margin-top:14px">GW${g.n} — the real fixtures</h3>
      ${(() => {
        const fxs = state.fixtures.filter(f => f.gw === g.n);
        return fxs.map(f => {
          const live = f.started && !fxOver(f);
          const score = !f.started ? new Date(f.date).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : `${f.hs ?? ''} – ${f.as ?? ''}`;
          // tappable like the dashboard ticker (Ben, GW1 night: "can we get
          // this clickable on the matches/fixtures too?") — same match
          // centre. The row keeps its original five columns: a sixth child
          // made the grid wrap tall ("the fixtures have gone a bit big"), so
          // highlights live in the match centre and on the games page.
          return `<div class="h2h-fx fx-row" data-fx="${f.id}" style="font-size:12.5px;cursor:pointer" title="Tap for scorers and lineups">
            <span class="fx-name fx-l">${esc(f.home)}</span>
            <span class="fx-chip">${flagImg(f.home)}</span>
            <span class="fx-score" style="font-size:12px">${score}${live ? ` <span class="rec" style="display:inline-block"></span>` : fxOver(f) && f.started ? ' <span class="muted" style="font-size:10px">FT</span>' : ''}</span>
            <span class="fx-chip">${flagImg(f.away)}</span>
            <span class="fx-name">${esc(f.away)}</span>
          </div>`;
        }).join('') || '<p class="muted" style="font-size:12px">No fixtures scheduled yet.</p>';
      })()}
    </div>`;
  })();
  // Lee's note: "Head-to-Head" must LEAD with the head-to-heads. Matches and
  // the preview first, THEN the standings — it read as a second league table.
  return `${matchesCard}
  ${gwPreviewCard(cur)}
  ${playoffCard()}
  ${pointsGridCard(standings)}
  ${crystalBallCard(standings)}
  ${vidiCard()}`;
}

/* ----- the Monzo Cup (last man standing, from GW8) ----- */
function viewCup() {
  let alive = state.managers.map(m => m.id);
  const rounds = [];
  for (let i = CUP_START; i < REGULAR_GWS && alive.length > 1; i++) {
    if (gwStatus(i) !== 'final') break;
    const scores = alive.map(id => ({ id, pts: gwManagerPoints(id, i) })).sort((x, y) => y.pts - x.pts);
    const min = scores[scores.length - 1].pts;
    const lowest = scores.filter(s => s.pts === min);
    const out = lowest.length === 1 ? lowest[0].id : null;
    rounds.push({ i, scores, out, tie: lowest.length > 1 });
    if (out) alive = alive.filter(id => id !== out);
  }
  const winner = alive.length === 1 ? alive[0] : null;
  return `
  <div class="card" style="margin-bottom:18px">
    <h2>The Monzo League Cup <span class="tag">last man standing</span></h2>
    <p class="muted" style="font-size:12.5px;margin-bottom:10px">From GW8: the lowest gameweek score among the survivors is eliminated. Ties roll over — nobody goes. Winner takes £75 and eternal glory (£75 of it).</p>
    ${winner ? `<p style="font-size:16px">&#127942; <b>${esc(teamName(winner))}</b> — last man standing.</p>`
      : rounds.length === 0 ? `<p class="muted">The Cup begins GW8. All twelve enter. One leaves per week. It's very simple and very cruel.</p>`
      : `<p style="font-size:13.5px"><b>${alive.length} still standing:</b> ${alive.map(id => esc(teamName(id))).join(' · ')}</p>`}
  </div>
  ${[...rounds].reverse().map(r => `
    <div class="card" style="margin-bottom:12px">
      <h2>GW${GAMEWEEKS[r.i].n} ${r.tie ? '<span class="tag">tie at the bottom — everyone survives</span>' : ''}</h2>
      ${r.scores.map(s => `<div class="lrow" style="justify-content:space-between${s.id === r.out ? ';color:var(--bad,#e66)' : ''}">
        <span>${esc(teamName(s.id))} ${s.id === r.out ? '&#128128; ELIMINATED' : ''}</span><b>${s.pts}</b></div>`).join('')}
    </div>`).join('')}
  ${hamCupCard()}`;
}

/* ----- the Palwin Ham Cup (ledger #6, Tussie) — Trough players only ----- */
let hamView = { q: '', sel: null, pos: '', club: '' };
function hamCupCard() {
  if (state.phase !== 'season') return '';
  const hc = state.hamCup;
  const head = `<h2>The Palwin Ham Cup <span class="tag">strictly Trough</span></h2>
    <p class="muted" style="font-size:12.5px;margin-bottom:10px">One random gameweek, late in the season. Every manager fields an XI drawn ONLY from the unowned — <b>as the Trough stood when the selection window opened, a week before the tie</b> — the Trough's finest, like the Milk Cup if the milk had turned. Entirely optional, entirely stupid. Proudly sponsored by Palwin.</p>`;
  // a cancelled cup (tombstone) or a malformed one with no drawn GW both fall
  // back to the "not drawn" state — never crash the Cup view on GAMEWEEKS[undefined]
  if (!hc || hc.status === 'off' || GAMEWEEKS[hc.gw] === undefined) {
    return `<div class="card" style="margin-top:18px">${head}
      ${netOn() && !isCommissioner() ? '<p class="muted" style="font-size:12px">The tie has not been drawn. The Chairman holds the velvet bag.</p>'
        : '<button class="btn small" id="hamDraw">&#127829; Draw the Ham Cup tie</button>'}
    </div>`;
  }
  const i = hc.gw, g = GAMEWEEKS[i];
  const st = gwStatus(i);
  const entries = hc.entries || {};
  const entered = state.managers.filter(m => toArr(entries[m.id]).length === 11);
  if (st === 'upcoming') {
    const opensAt = hamOpensAt(hc);
    // entries on the node mean the window already opened somewhere — never
    // re-close it under them on a clock disagreement
    const windowOpen = !opensAt || Date.now() >= opensAt || entered.length > 0;
    if (!windowOpen) {
      const when = new Date(opensAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<div class="card" style="margin-top:18px">${head}
        <p class="rules-p"><b>The tie is drawn: GW${g.n}.</b> The selection window opens <b>${when}</b> — a week before kick-off. At that exact moment the Trough is photographed, and THAT pool is the pool. No early homework.</p>
        ${(netOn() && isCommissioner()) || !netOn() ? '<button class="btn ghost small" id="hamOpen">Open the window early (Chairman)</button>' : ''}
        ${(netOn() && isCommissioner()) || !netOn() ? '<button class="btn ghost small" id="hamCancel" style="margin-left:6px">Call the whole thing off</button>' : ''}
      </div>`;
    }
    // local play freezes the pool the first time the open window is seen;
    // online the server freezes it (hourly tick or first entry)
    if (!netOn() && !Array.isArray(hc.frozen)) { hc.frozen = [...ownedIdsAt(currentGwIndex())]; save(); }
    const iAm = whoami && whoami !== -1;
    const owned = Array.isArray(hc.frozen) ? new Set(hc.frozen) : ownedIdsAt(currentGwIndex());
    const mySel = hamView.sel ?? toArr(entries[whoami] || []);
    const free = PLAYERS.filter(p => !owned.has(p.id));
    const q = normName(hamView.q);
    const picked = mySel.map(pid => PLAYER_BY_ID[pid]).filter(Boolean);
    const cands = free.filter(p => !mySel.includes(p.id)
        && (!hamView.pos || p.pos === hamView.pos)
        && (!hamView.club || p.club === hamView.club)
        && (!q || normName(p.name).includes(q) || normName(p.club).includes(q)))
      .sort((a, b) => rating(b) - rating(a)).slice(0, 30);
    const hamClubs = [...new Set(free.map(p => p.club))].sort();
    const shape = xiValid(mySel);
    const cnt = xiCounts(mySel);
    const prow = (p, on) => `<div class="lrow" style="font-size:12.5px"><label style="display:flex;gap:8px;align-items:center;cursor:pointer;flex:1">
      <input type="checkbox" data-ham="${p.id}" ${on ? 'checked' : ''}> <span class="pos-badge pos-${p.pos}">${p.pos}</span> ${pname(p)}
      <span class="muted" style="font-size:11px">${esc(p.club)}</span><span class="muted" style="margin-left:auto;font-size:11px">${metricsFor(p).pts} pts</span></label></div>`;
    return `<div class="card" style="margin-top:18px">${head}
      <p class="rules-p"><b>The tie is drawn: GW${g.n}.</b> The window is open and the Trough is frozen — the pool below is the pool, whatever transfers happen between now and kick-off. Entries lock at the deadline. ${entered.length}/12 XIs in${entered.length ? ` (${entered.map(m => esc(managerName(m.id))).join(', ')})` : ''}.</p>
      ${iAm ? `
      <h3 style="margin-top:12px">Your Ham XI <span class="tag">${mySel.length}/11</span> <span class="muted" style="font-weight:400;font-size:11px">1 GK &middot; 3–5 DF &middot; 2–5 MF &middot; 1–3 FW &middot; picked: ${cnt.GK} GK ${cnt.DF} DF ${cnt.MF} MF ${cnt.FW} FW</span></h3>
      ${picked.map(p => prow(p, true)).join('') || '<p class="muted" style="font-size:12px">Nobody yet. The Trough awaits.</p>'}
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0 2px">
        ${['', 'GK', 'DF', 'MF', 'FW'].map(ps => `<button class="btn ghost small${hamView.pos === ps ? ' active' : ''}" data-hampos="${ps}" style="font-size:11px">${ps || 'All'}</button>`).join('')}
        <select id="hamClub" style="font-size:12px;margin-left:auto"><option value="">Every club</option>${hamClubs.map(c => `<option value="${esc(c)}" ${hamView.club === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div>
      <input type="text" id="hamQ" placeholder="Search the Trough…" value="${esc(hamView.q)}" style="margin:8px 0;width:100%;box-sizing:border-box">
      ${cands.map(p => prow(p, false)).join('')}
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
        <button class="btn small" id="hamSave" ${shape ? '' : 'disabled'}>Enter this XI</button>
        ${!shape && mySel.length === 11 ? '<span class="muted" style="font-size:11.5px">Shape’s illegal — check the position counts.</span>' : ''}
      </div>
      <p class="muted" style="font-size:10.5px;margin-top:8px">If someone signs your ham player before the gameweek, he still counts for your Ham XI. The Committee finds this funny.</p>` : '<p class="muted" style="font-size:12px">Sign in to enter your Ham XI.</p>'}
      ${netOn() && isCommissioner() || !netOn() ? '<button class="btn ghost small" id="hamCancel" style="margin-top:8px">Call the whole thing off</button>' : ''}
    </div>`;
  }
  // underway or done — score it
  const rows = state.managers.map(m => {
    const xi = toArr(entries[m.id]);
    return { id: m.id, entered: xi.length === 11, pts: xi.reduce((t, pid) => t + gwPlayerPoints(pid, i), 0) };
  }).sort((a, b) => (b.entered - a.entered) || b.pts - a.pts);
  const winner = st === 'final' && rows[0]?.entered ? rows[0] : null;
  return `<div class="card" style="margin-top:18px">${head}
    <p class="rules-p"><b>GW${g.n}</b> — ${st === 'final' ? 'full time.' : 'in play. The ham is loose.'}</p>
    ${winner ? `<p style="font-size:15px">&#127829;&#127942; <b>${esc(teamName(winner.id))}</b> lifts the Palwin Ham Cup with ${winner.pts} Trough points. Nobody can take this away, though many will try.</p>` : ''}
    ${rows.map((r, k) => r.entered ? `<div class="lrow" style="justify-content:space-between"><span><span class="muted">${k + 1}</span> ${esc(teamName(r.id))}</span><b class="${k === 0 ? 'gold' : ''}">${r.pts}</b></div>`
      : `<div class="lrow" style="justify-content:space-between;opacity:.55"><span>${esc(teamName(r.id))}</span><span class="muted" style="font-size:11px">no XI — scared of the Trough</span></div>`).join('')}
  </div>`;
}
function bindCup() {
  const draw = $('#hamDraw');
  if (draw) draw.onclick = () => {
    if (netOn() && !isCommissioner()) { toast('Only the Chairman holds the velvet bag'); return; }
    const cur = currentGwIndex();
    // Marc (1 Aug): the ham belongs later in the season — the velvet bag only
    // holds GW20 onwards (still random within that, still before the playoffs)
    const from = Math.min(Math.max(cur + 2, 19), REGULAR_GWS - 1);
    const gw = from + Math.floor(Math.random() * Math.max(1, REGULAR_GWS - from));
    if (netOn()) {
      serverAct('hamAdmin', { op: 'draw', gw })
        .then(() => { playSound('cheer'); toast(`THE HAM CUP IS DRAWN — GW${GAMEWEEKS[gw].n}. Palwin corks are popping.`); })
        .catch(() => {});
      return;
    }
    state.hamCup = { gw, drawnAt: new Date().toISOString(), entries: {} };
    save(); render();
    playSound('cheer');
    toast(`THE HAM CUP IS DRAWN — GW${GAMEWEEKS[gw].n}. Palwin corks are popping.`);
  };
  const cancel = $('#hamCancel');
  if (cancel) cancel.onclick = () => {
    if (netOn() && !isCommissioner()) { toast('Only the Chairman calls it off'); return; }
    if (!confirm('Call off the Ham Cup — for EVERYONE?')) return;
    if (netOn()) {
      serverAct('hamAdmin', { op: 'cancel' })
        .then(() => toast('The Ham Cup is off. Palwin has withdrawn its sponsorship in disgust.'))
        .catch(() => {});
      return;
    }
    // a tombstone, not a deletion: deleting the node would be invisible to
    // other devices (an absent key reads as "never drawn"), so a lingering
    // entry could resurrect a gw-less cup and crash the view
    state.hamCup = { status: 'off' };
    save(); render();
    toast('The Ham Cup is off. Palwin has withdrawn its sponsorship in disgust.');
  };
  document.querySelectorAll('[data-ham]').forEach(cb => cb.onchange = () => {
    const pid = +cb.dataset.ham;
    const cur = hamView.sel ?? toArr(state.hamCup?.entries?.[whoami] || []);
    hamView.sel = cb.checked ? [...cur, pid] : cur.filter(x => x !== pid);
    if (hamView.sel.length > 11) { hamView.sel = cur; toast('Eleven. It’s an XI.'); }
    render();
  });
  const hq = $('#hamQ');
  if (hq) { hq.oninput = () => { hamView.q = hq.value; render(); }; }
  document.querySelectorAll('[data-hampos]').forEach(b => b.onclick = () => { hamView.pos = b.dataset.hampos; render(); });
  const hClub = $('#hamClub');
  if (hClub) hClub.onchange = () => { hamView.club = hClub.value; render(); };
  const hOpen = $('#hamOpen');
  if (hOpen) hOpen.onclick = () => {
    if (netOn() && !isCommissioner()) { toast('Only the Chairman opens the window'); return; }
    if (netOn()) {
      serverAct('hamAdmin', { op: 'open' })
        .then(() => toast('The window is OPEN — the Trough is frozen. Pick your ham.'))
        .catch(() => {});
      return;
    }
    state.hamCup.openedAt = Date.now();
    state.hamCup.frozen = [...ownedIdsAt(currentGwIndex())];
    save(); render();
    toast('The window is OPEN — the Trough is frozen. Pick your ham.');
  };
  const hs = $('#hamSave');
  if (hs) hs.onclick = () => {
    if (!whoami || whoami === -1) { toast('Sign in first'); return; }
    if (!state.hamCup || state.hamCup.status === 'off' || GAMEWEEKS[state.hamCup.gw] === undefined) { toast('No Ham Cup is running.'); render(); return; }
    const sel = hamView.sel ?? toArr(state.hamCup?.entries?.[whoami] || []);
    if (!xiValid(sel)) { toast('That XI is illegal, even for the Ham Cup'); return; }
    if (netOn()) {
      serverAct('hamEnter', { xi: sel, gw: state.hamCup.gw })
        .then(() => { hamView.sel = null; toast('Ham XI entered. May God have mercy.'); })
        .catch(() => {});
      return;
    }
    state.hamCup.entries = state.hamCup.entries || {};
    state.hamCup.entries[whoami] = sel;
    hamView.sel = null;
    save(); render();
    toast('Ham XI entered. May God have mercy.');
  };
}

/* ----- league table ----- */
/* tableGwCard (this GW's scores on the Table page) RETIRED in the 1 Aug
   dedupe audit — the Matches page leads with exactly that, one tab away */
/* form table: the same table, judged over a shorter memory. Informational
   only — official standings, seeding and waivers never read this. */
// mode 'overall' | 'form'; n = how many finished gameweeks the form window covers
// (Marc, 9 Aug: the two fixed Last 3 / Last 5 buttons become any number you like)
let tableView = { mode: 'overall', n: 5 }; // survives the session, never persisted
/* Head-to-head grid for the season in progress (Marc, 9 Aug). The Record Book
   has carried one for 2025/26 since the archive was recovered; the live season
   never had one. Row's record against column, W-D-L. */
function h2hMatrixCard() {
  const ms = state.managers;
  const at = Object.fromEntries(ms.map((m, i) => [m.id, i]));
  const grid = ms.map(() => ms.map(() => ({ w: 0, d: 0, l: 0 })));
  let met = 0;
  for (let g = 0; g < REGULAR_GWS; g++) {
    if (gwStatus(g) !== 'final') continue;
    for (const [a, b] of pairingsFor(g)) {
      const ia = at[a], ib = at[b];
      if (ia == null || ib == null) continue;
      const pa = gwManagerPoints(a, g), pb = gwManagerPoints(b, g);
      met++;
      if (pa > pb) { grid[ia][ib].w++; grid[ib][ia].l++; }
      else if (pa < pb) { grid[ia][ib].l++; grid[ib][ia].w++; }
      else { grid[ia][ib].d++; grid[ib][ia].d++; }
    }
  }
  const init = t => esc(String(t).split(/\s+/).map(w => (w.codePointAt(0) < 128 ? w[0] : '')).join('').slice(0, 3).toUpperCase() || String(t).slice(0, 3).toUpperCase());
  if (!met) {
    return `<div class="card" style="margin-top:14px">
      <h2>Head-to-head <span class="muted" style="font-weight:400;font-size:12px">row's record vs column</span></h2>
      <p class="muted" style="font-size:12.5px">No gameweek has been settled yet. Grudges are still theoretical.</p></div>`;
  }
  return `<div class="card" style="margin-top:14px">
    <h2>Head-to-head <span class="muted" style="font-weight:400;font-size:12px">row's record vs column (W-D-L), this season</span></h2>
    <div style="overflow-x:auto">
    <table class="pool-table" style="font-size:11px">
      <thead><tr><th></th>${ms.map(c => `<th class="num" title="${esc(teamName(c.id))}">${init(teamName(c.id))}</th>`).join('')}</tr></thead>
      <tbody>${ms.map((r, i) => `<tr>
        <td style="white-space:nowrap"><b title="${esc(managerName(r.id))}">${esc(teamName(r.id))}</b></td>
        ${ms.map((c, j) => i === j ? '<td class="num muted">&mdash;</td>'
          : `<td class="num" style="white-space:nowrap;${grid[i][j].w > grid[i][j].l ? 'color:#3fb96d' : grid[i][j].w < grid[i][j].l ? 'color:#e05555' : ''}">${grid[i][j].w}-${grid[i][j].d}-${grid[i][j].l}</td>`).join('')}
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="muted" style="font-size:10.5px;margin-top:6px">${met} meeting${met === 1 ? '' : 's'} settled so far. Each pair meets three times across the regular season.</p>
  </div>`;
}
function finishedGwIdxs() {
  const out = [];
  for (let i = 0; i < REGULAR_GWS; i++) if (gwStatus(i) === 'final') out.push(i);
  return out;
}
function formStandings(n) {
  const idxs = finishedGwIdxs().slice(-n);
  const overall = [...state.managers].map(m => ({ id: m.id, pts: managerPoints(m.id) })).sort((a, b) => b.pts - a.pts);
  const overallPos = Object.fromEntries(overall.map((r, i) => [r.id, i + 1]));
  const constitution = Object.fromEntries(state.managers.map((m, i) => [m.id, i]));
  const rows = state.managers.map(m => ({
    ...m,
    win: idxs.reduce((t, i) => t + gwManagerPoints(m.id, i), 0),
    overall: managerPoints(m.id),
  }));
  rows.sort((a, b) => b.win - a.win || b.overall - a.overall || constitution[a.id] - constitution[b.id]);
  return { rows, counted: idxs.length, overallPos };
}
function viewTable() {
  const ranked = [...state.managers]
    .map(m => ({ ...m, pts: managerPoints(m.id) }))
    .sort((a, b) => b.pts - a.pts);
  const hasPts = ranked.some(r => r.pts !== 0);
  // INVESTIGATION UPDATE card removed (Ben, 2 Aug: old Calciopoli gag, goes)
  // Lee (twice): the FULL table must be the first thing this page shows, and
  // the dense H2H-table look beats the big expandable rows. Fixtures and the
  // investigation gag moved below; tap a row for the points breakdown.
  // Ben (1 Aug): THE league table is the head-to-head table — 3 for a win,
  // 1 for a draw, W/D/L columns like Draft Fantasy. Overall FPL points is a
  // tiebreak column, not the ranking.
  const cur = currentGwIndex();
  // (the table no longer ranks in-play scores — Toby, GW1 weekend — so the
  // LIVE tag and the live standings feed are gone with it)
  const mode = tableView.mode;
  // Marc, 9 Aug: Last 3 / Last 5 become any window you like, capped at the
  // number of gameweeks that have actually finished — offering "last 12" in
  // September would just be a longer way of saying Overall
  const maxN = Math.max(1, finishedGwIdxs().length);
  const formN = Math.min(Math.max(1, tableView.n || 5), maxN);
  const form = mode === 'overall' ? null : formStandings(formN);
  const standings = form ? null : h2hStandings(false);
  const rowsData = form ? form.rows : standings;
  const toggles = `<div class="pool-controls" style="margin:0 0 10px">
      <button class="btn small ${mode === 'overall' ? '' : 'ghost'}" data-tblmode="overall">Overall</button>
      <button class="btn small ${mode === 'overall' ? 'ghost' : ''}" data-tblmode="form">Form</button>
      <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px">over the last
        <select id="tblFormN" aria-label="How many gameweeks the form table covers">
          ${Array.from({ length: maxN }, (_, i) => i + 1).map(n => `<option value="${n}" ${formN === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select> gameweek${formN === 1 ? '' : 's'}</label>
    </div>`;
  const formNote = form ? (form.counted === 0
    ? '<p class="muted" style="font-size:11.5px;margin-bottom:8px">Form begins after GW1 — nothing has finished yet, so this is the constitutional order.</p>'
    : form.counted < mode
      ? `<p class="muted" style="font-size:11.5px;margin-bottom:8px">Only ${form.counted} gameweek${form.counted === 1 ? '' : 's'} finished so far — form is judged on what exists.</p>`
      : '') : '';
  const moveTag = m => {
    if (!form || form.counted === 0) return '';
    const d = form.overallPos[m.id] - (rowsData.findIndex(r => r.id === m.id) + 1);
    return d > 0 ? `<span class="form-move up" title="vs overall position">&#9650;${d}</span>`
      : d < 0 ? `<span class="form-move down" title="vs overall position">&#9660;${-d}</span>`
      : '<span class="form-move flat" title="vs overall position">&ndash;</span>';
  };
  const nCols = form ? 4 : 10; // QF column retired — the bracket below carries it now
  return `
    <div class="card" style="margin-bottom:14px">
      <h2>The Table <span class="muted" style="font-weight:400;font-size:12px">${form ? `points over the last ${form.counted || 0} finished GW${form.counted === 1 ? '' : 's'} &middot; informational only` : 'settled gameweeks only &middot; win 3 &middot; draw 1 &middot; tiebreak: overall points'}</span></h2>
      ${toggles}
      ${formNote}
      <div style="overflow-x:auto">
      <table class="pool-table">
        <thead>${form
          ? '<tr><th></th><th>Team</th><th class="num" title="Finished gameweeks counted">GWs</th><th class="num act">Pts</th></tr>'
          : '<tr><th></th><th>Team</th><th class="num">P</th><th class="num col-wdl">W</th><th class="num col-wdl">D</th><th class="num col-wdl">L</th><th class="num col-wdl" title="H2H points scored">+</th><th class="num col-wdl" title="H2H points conceded">&minus;</th><th class="num act">Pts</th><th class="num" title="Overall FPL-style points — the tiebreak">Ovr</th></tr>'}</thead>
        <tbody>
        ${rowsData.map((m, i) => {
          // table gag tags all retired (Marc/Ben, 2 Aug: "committee fraud
          // nonsense" — under-review, investigation and Chumpionship alike)
          const commTag = '';
          return `
          <tr data-mgr-row="${m.id}" style="cursor:pointer" class="${!form && i === 7 ? 'playoff-line' : ''}">
            <td class="muted">${i + 1}</td>
            <td><div style="display:flex;align-items:center;gap:6px"><button class="btn ghost small icon-btn" data-pitchview="${m.id}" title="See this team on the pitch" aria-label="See this team on the pitch">&#9917;</button> ${kitSvg(m.id)}<div style="min-width:0;line-height:1.3"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b>${esc(m.team || m.name)}</b> ${moveTag(m)}${!form && i === 0 && m.pts > 0 ? ' &#127942;' : ''}${commTag}</div><div class="muted" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.name)}</div></div></div></td>
            ${form
              ? `<td class="num muted">${form.counted}</td><td class="num gold act"><b>${m.win}</b></td>`
              : `<td class="num">${m.p}</td><td class="num col-wdl">${m.w}</td><td class="num col-wdl">${m.d}</td><td class="num col-wdl">${m.l}</td>
                 <td class="num muted col-wdl">${m.pf}</td><td class="num muted col-wdl">${m.pa}</td>
                 <td class="num gold act"><b>${m.pts}</b></td>
                 <td class="num muted">${m.ovr ?? managerPoints(m.id)}</td>`}
          </tr>
          <tr class="bd-tr" id="bd-${m.id}" style="display:none"><td colspan="${nCols}">
            ${(() => { const md = supportersMood(m.id); return `<p style="font-size:12.5px;margin-bottom:2px">&#128227; <b>${esc(md.t)}</b> <span class="muted" style="font-size:11.5px">${esc(md.line)}</span></p>`; })()}
            ${(() => { const rr = clubRecordsHtml(m.id); return rr.length ? `<div style="margin-bottom:8px">${rr.join('')}</div>` : ''; })()}
            ${managerSquad(m.id).map(p => ({ p, c: contributedPoints(m.id, p.id), r: playerPoints(p.id) }))
              .sort((a, b) => b.c - a.c)
              .map(({ p, c, r }) => `<div class="squad-row" title="Season: ${esc(r.lines.join(' · ') || 'nothing yet')}"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${photoImg(p)}<span>${esc(p.name)}</span><span class="muted" style="margin-left:8px;font-size:11.5px">${esc(r.lines.join(' · '))}</span><span class="sp-pts">${c}</span></div>`).join('') || '<span class="muted">Empty squad</span>'}
            <p class="muted" style="font-size:11px;margin:6px 0 4px">Points shown are what each player banked while in the starting XI.</p>
          </td></tr>`;
        }).join('')}
        </tbody>
      </table>
      </div>
      <p class="muted" style="font-size:11px;margin-top:6px">Tap a row for where the points came from &middot; &#9917; for the pitch.</p>
    </div>
    ${h2hMatrixCard()}
    ${bracketCard()}`;
}
// team data: who can't leave the Trough alone (moved to the Data Room, 1 Aug)
// every player who has banked a point in this manager's XI this season, the
// departed included (Marc, 9 Aug: the league table's breakdown only knows the
// CURRENT squad, so anyone traded away or dropped vanishes from it entirely)
function seasonContributors(mid) {
  const tally = new Map(), heldFor = new Map(), pickedFor = new Map();
  for (let i = 0; i < GAMEWEEKS.length; i++) {
    // points stay unbounded — a week with no stats scores nothing anyway — but
    // the GW counts only run to what has actually happened, or every current
    // pick would read 38 (Marc, 9 Aug)
    const played = gwUnderway(i);
    if (played) for (const p of squadAt(mid, i)) heldFor.set(p.id, (heldFor.get(p.id) || 0) + 1);
    for (const pid of effectiveXI(mid, i).xi) {
      tally.set(pid, (tally.get(pid) || 0) + gwPlayerPoints(pid, i));
      if (played) pickedFor.set(pid, (pickedFor.get(pid) || 0) + 1);
    }
  }
  const owned = new Set(managerSquad(mid).map(p => p.id));
  const total = managerPoints(mid);
  return [...tally.entries()]
    .map(([pid, pts]) => ({
      p: PLAYER_BY_ID[pid], pts,
      held: heldFor.get(pid) || 0,
      picked: pickedFor.get(pid) || 0,
      share: total ? (pts / total) * 100 : 0,
      gone: !owned.has(pid),
    }))
    .filter(x => x.p)
    .sort((a, b) => b.pts - a.pts);
}
/* Fixture difficulty matrix (Marc, 9 Aug): the Vs column shows one fixture and
   P3/P6 bake difficulty into a single number. This lays the run out club by
   club so you can see WHERE the good weeks are, over any window up to ten.
   Blanks show as a dash, doubles stack in the same cell. */
let fdrView = { weeks: 6, sort: 'easiest' }; // 'easiest' | 'hardest' | 'club'
function fdrOf(team) {
  const s = TEAM_BY_NAME[team]?.str || 0;
  if (!s) return 3;
  // the feed has shipped both a 1–5 scale and an FPL-style ~1000–1400 one
  return s > 100 ? (s >= 1240 ? 5 : s >= 1180 ? 4 : s >= 1100 ? 3 : s >= 1060 ? 2 : 1) : s;
}
const FDR_BG = { 1: 'rgba(63,185,109,.28)', 2: 'rgba(63,185,109,.14)', 3: 'transparent', 4: 'rgba(224,85,85,.16)', 5: 'rgba(224,85,85,.3)' };
function fixtureMatrixCard() {
  const fx = state.fixtures || [];
  if (!fx.length) {
    return `<div class="card" style="margin-top:14px"><h2>Fixture Difficulty</h2>
      <p class="muted" style="font-size:12.5px">No fixtures loaded yet. Refresh to pull the season's schedule.</p></div>`;
  }
  const weeks = Math.min(Math.max(1, fdrView.weeks || 6), 10);
  const start = planningGwIndex();   // never a round already in the books
  const gwNs = [];
  for (let i = start; i < GAMEWEEKS.length && gwNs.length < weeks; i++) gwNs.push(GAMEWEEKS[i].n);
  const rows = Object.keys(TEAM_BY_NAME).map(team => {
    const cells = gwNs.map(n => fx.filter(f => f.gw === n && (f.home === team || f.away === team))
      .map(f => { const opp = f.home === team ? f.away : f.home; return { opp, home: f.home === team, fdr: fdrOf(opp) }; }));
    const flat = cells.flat();
    return { team, cells, total: flat.reduce((t, c) => t + c.fdr, 0), games: flat.length };
  });
  rows.sort(fdrView.sort === 'club' ? (a, b) => a.team.localeCompare(b.team)
    : fdrView.sort === 'hardest' ? (a, b) => b.total - a.total || a.team.localeCompare(b.team)
    : (a, b) => a.total - b.total || a.team.localeCompare(b.team));
  const short = t => TEAM_BY_NAME[t]?.short || t.slice(0, 3).toUpperCase();
  return `<div class="card" style="margin-top:14px">
    <h2>Fixture Difficulty <span class="muted" style="font-weight:400;font-size:12px">the run ahead, club by club</span></h2>
    <div class="pool-controls">
      <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px">next
        <select id="fdrWeeks" aria-label="How many gameweeks ahead">
          ${Array.from({ length: 10 }, (_, i) => i + 1).map(n => `<option value="${n}" ${weeks === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select> gameweek${weeks === 1 ? '' : 's'}</label>
      <select id="fdrSort" aria-label="Sort order">
        <option value="easiest" ${fdrView.sort === 'easiest' ? 'selected' : ''}>Easiest run first</option>
        <option value="hardest" ${fdrView.sort === 'hardest' ? 'selected' : ''}>Hardest run first</option>
        <option value="club" ${fdrView.sort === 'club' ? 'selected' : ''}>Club A&ndash;Z</option>
      </select>
    </div>
    <div style="overflow-x:auto"><table class="pool-table" style="font-size:11.5px">
      <thead><tr><th>Club</th>${gwNs.map(n => `<th class="num">GW${n}</th>`).join('')}<th class="num act" title="Total opponent difficulty over the window — lower is kinder">FDR</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td style="white-space:nowrap"><b>${esc(short(r.team))}</b> <span class="muted">${esc(r.team)}</span></td>
        ${r.cells.map(c => c.length
          ? `<td class="num" style="white-space:nowrap;background:${FDR_BG[Math.round(c.reduce((t, x) => t + x.fdr, 0) / c.length)] || 'transparent'}">${c.map(x => `${esc(short(x.opp))} <span class="muted">(${x.home ? 'H' : 'A'})</span>`).join('<br>')}</td>`
          : '<td class="num muted" title="Blank gameweek">&mdash;</td>').join('')}
        <td class="num gold act"><b>${r.total}</b>${r.games !== gwNs.length ? ` <span class="muted" style="font-weight:400">${r.games}g</span>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="muted" style="font-size:10.5px;margin-top:6px">Green is kind, red is not. FDR totals opponent strength across the window, so a double gameweek scores higher than a blank &mdash; the games count is shown where it isn't ${gwNs.length}.</p>
  </div>`;
}
/* Head-to-head player comparison (Marc, 10 Aug). Tick two players, hit Compare,
   get a card that ranks them metric by metric.

   Windows: everything backward-looking honours "last N settled gameweeks",
   everything forward-looking honours "next N". The ONE exception is xG and xA,
   which FPL only publishes as season-to-date totals in the feed we pull —
   per-fixture xG lives behind a per-player endpoint the page CSP forbids us
   from calling. Those rows say SEASON rather than quietly pretending to
   respect a window they cannot. */
/* A getter returning null means "this player has no figure here" — the row
   prints a dash and sits out of the verdict, instead of a fabricated nil-nil. */
const COMPARE_METRICS = [
  { k: 'min', name: 'Minutes played', win: 'back', get: w => w.min },
  { k: 'xg', name: 'xG', win: 'season', get: (w, p) => (w.archive ? null : p.xg || 0), dp: 2 },
  { k: 'xa', name: 'xA', win: 'season', get: (w, p) => (w.archive ? null : p.xa || 0), dp: 2 },
  { k: 'form', name: 'Form (pts per GW)', win: 'back', get: w => w.form, dp: 1 },
  { k: 'g', name: 'Goals', win: 'back', get: w => w.g },
  { k: 'a', name: 'Assists', win: 'back', get: w => w.a },
  { k: 'cs', name: 'Clean sheets', win: 'back', get: w => w.cs },
  { k: 'pts', name: 'League points', win: 'back', get: w => w.pts },
  { k: 'proj', name: 'Projected points', win: 'fwd', get: (w, p, fwd) => projPts(p, fwd), dp: 1 },
];
/* Before a ball is kicked there are no finished gameweeks, so every windowed
   figure was zero and the card sat there declaring a winner off five 0-0 rows
   — while the Draft Console's tool, one tap away, showed the same two players
   with last season's real numbers (Marc, 13 Aug). The window falls back the
   same way metricsFor does, and says so in the label rather than passing an
   archive off as current form. */
function compareWindowStats(pid, back) {
  const p = PLAYER_BY_ID[pid];
  const finals = [];
  for (let i = 0; i < REGULAR_GWS; i++) if (gwStatus(i) === 'final') finals.push(i);
  const w = finals.slice(-back);
  if (!w.length) {
    // pre-season: FPL's own aggregates until the July wipe, the archive after
    const ls = FPL_WIPED ? lastSeasonOf(p) : null;
    const src = ls || (p.mp ? { mp: p.mp, g: p.g, a: p.a, cs: p.cs, pts: p.pts, ppg: p.ppg } : null);
    if (!src) return { gws: 0, archive: false, min: null, g: null, a: null, cs: null, pts: null, form: null };
    return { gws: 0, archive: true, min: src.mp || 0, g: src.g || 0, a: src.a || 0,
      cs: src.cs || 0, pts: src.pts || 0, form: src.ppg || 0 };
  }
  let min = 0, g = 0, a = 0, cs = 0, pts = 0;
  for (const i of w) {
    const s = gwEvent(i)?.playerStats?.[pid];
    if (!s) continue;
    min += s.min || 0; g += s.g || 0; a += s.a || 0; cs += s.cs || 0;
    pts += statPoints(p, s);
  }
  return { gws: w.length, archive: false, min, g, a, cs, pts, form: w.length ? pts / w.length : 0 };
}
/* ONE comparison, two front doors. The Data Room grew a tick-box head-to-head
   while the Draft Console, the Trough and the search palette kept a separate
   three-player overlay with its own field list — same verb, two mental models,
   and two different answers for the same pair (Marc, 13 Aug). This is the body
   both now render: same metrics, same windows, same verdict, inline in the
   explorer and inside the overlay everywhere else. */
function compareBody(ids, fwdRunway = true) {
  const back = dataView.backWeeks || 6, fwd = dataView.fwdWeeks || 6;
  const ps = ids.map(id => PLAYER_BY_ID[id]);
  const ws = ids.map(id => compareWindowStats(id, back));
  const on = new Set(dataView.compareCols || COMPARE_METRICS.map(m => m.k));
  const shown = COMPARE_METRICS.filter(m => on.has(m.k));
  const archive = ws.some(w => w.archive);
  const valsOf = m => ids.map((_, i) => {
    const v = m.get(ws[i], ps[i], fwd);
    return v == null ? null : (+v || 0);
  });
  const tally = ids.map(() => 0);
  let judged = 0;
  const rows = shown.map(m => {
    const vals = valsOf(m);
    const real = vals.filter(v => v != null);
    // a row nobody has a figure for decides nothing and is not a draw
    const hasData = real.length > 0 && (real.some(v => v !== 0) || (m.win === 'back' && ws[0].gws > 0));
    const top = hasData ? Math.max(...real) : null;
    const winners = hasData ? vals.map(v => v != null && v === top) : vals.map(() => false);
    const outright = hasData && winners.filter(Boolean).length === 1;
    if (outright) { tally[winners.indexOf(true)]++; judged++; }
    else if (hasData) judged++;
    const fmt = v => (v == null ? '&mdash;' : m.dp ? v.toFixed(m.dp) : Math.round(v));
    const tag = m.win === 'season' ? '<span class="muted" style="font-size:10px"> season</span>'
      : m.win === 'fwd' ? `<span class="muted" style="font-size:10px"> next ${fwd}</span>`
      : archive ? `<span class="muted" style="font-size:10px"> ${esc(LS_SEASON)}</span>`
      : `<span class="muted" style="font-size:10px"> last ${ws[0].gws || back}</span>`;
    return `<tr><td>${esc(m.name)}${tag}</td>
      ${vals.map((v, i) => `<td class="num"${outright && winners[i] ? ' style="color:#3fb96d;font-weight:700"' : ''}>${fmt(v)}${outright && winners[i] ? ' &#9650;' : ''}</td>`).join('')}</tr>`;
  }).join('');
  // the fixture runway the Draft Console's version always had — on draft night
  // who they play next is half the argument, and it belongs to no tally
  const gws = GAMEWEEKS.slice(planningGwIndex(), planningGwIndex() + fwd);
  const runway = fwdRunway && gws.length ? `<tr><td>Next ${gws.length}<span class="muted" style="font-size:10px"> fixtures</span></td>
    ${ps.map(p => `<td class="num" style="font-size:11px">${gws.map(g => `<span class="muted">GW${g.n}</span> ${esc(nextOpp(p.team, g.n) || '—')}`).join(' &middot; ')}</td>`).join('')}</tr>` : '';
  const best = Math.max(...tally);
  const leaders = tally.filter(t => t === best).length;
  const verdict = !judged ? 'No figures to separate them yet.'
    : leaders > 1 ? `Nothing to choose between them on ${judged} metric${judged === 1 ? '' : 's'}.`
    : `<b>${esc(ps[tally.indexOf(best)].name)}</b> leads on ${best} of ${judged} metric${judged === 1 ? '' : 's'}.`;
  return `<div class="pool-controls">
      <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px">last
        <select id="cmpBack" aria-label="Backward window">${[1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => `<option value="${n}" ${back === n ? 'selected' : ''}>${n}</option>`).join('')}</select> GWs</label>
      <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px">next
        <select id="cmpFwd" aria-label="Forward window">${[1, 2, 3, 4, 5, 6, 8, 10].map(n => `<option value="${n}" ${fwd === n ? 'selected' : ''}>${n}</option>`).join('')}</select> GWs</label>
    </div>
    ${archive ? `<p class="muted" style="font-size:11.5px;margin-bottom:6px">&#9888; No gameweek has finished yet, so the windowed rows show <b>${esc(LS_SEASON)}</b> instead. The window picker starts meaning something once results land.</p>` : ''}
    <div style="overflow-x:auto"><table class="pool-table">
      <thead><tr><th>Metric</th>${ps.map(p => `<th class="num">${esc(p.name)} <span class="muted">${esc(p.club)}</span><br><span class="muted" style="font-weight:400;font-size:10.5px">${(() => { const o = compareOwner(p.id); return o ? esc(teamName(o.id)) : 'Free agent'; })()}</span></th>`).join('')}</tr></thead>
      <tbody>${rows}${runway}</tbody>
    </table></div>
    <p style="font-size:13px;margin-top:8px">${verdict}</p>
    <div class="scout-columns"><span class="scout-title">Metrics</span><div class="scout-column-grid">
      ${COMPARE_METRICS.map(m => `<label class="scout-col-option"><input type="checkbox" data-cmpcol="${m.k}" ${on.has(m.k) ? 'checked' : ''}> <b>${esc(m.name)}</b></label>`).join('')}
    </div></div>
    <p class="muted" style="font-size:10.5px;margin-top:6px">Green marks the better figure; a dash means nobody has that number yet and the row sits out of the verdict. xG and xA are season-to-date &mdash; FPL publishes no per-gameweek xG in the feed this app may read, so those two cannot honour the window.</p>`;
}
function compareCard() {
  const ids = compareIds();
  if (ids.length < 2 || !dataView.comparing) return '';
  return `<div class="card" style="margin-top:14px;border:1px solid var(--accent)">
    <h2>Head-to-head <span class="muted" style="font-weight:400;font-size:12px">${ids.map(id => esc(PLAYER_BY_ID[id].name)).join(' v ')}</span>
      <button class="btn ghost small" id="cmpClose" style="margin-left:auto;float:right">Close</button></h2>
    ${compareBody(ids)}
  </div>`;
}
function playerExplorerCard() {
  const live = seasonHasStats();
  const cols = STAT_COLS(live);
  const ownedBy = {};
  for (const m of state.managers) for (const p of managerSquad(m.id)) ownedBy[p.id] = m.id;
  const q = normName(dataView.q || '');
  let pool = dataView.scope === 'owned' ? PLAYERS.filter(p => ownedBy[p.id] != null)
    // claim-only: dropped, and waiting on the next waiver run before the Trough
    // reopens them to anyone (Marc, 10 Aug)
    : dataView.scope === 'waivers' ? PLAYERS.filter(p => ownedBy[p.id] == null && !arrivalLocked(p) && onWaivers(p))
    : dataView.scope === 'free' ? PLAYERS.filter(p => ownedBy[p.id] == null && !onWaivers(p))
    : [...PLAYERS];
  if (dataView.pos) pool = pool.filter(p => p.pos === dataView.pos);
  if (dataView.club) pool = pool.filter(p => p.team === dataView.club);
  // filter on p.mp — FPL's own minutes — because that is the denominator the
  // per-90 figures are divided by. Using our match-stat minutes would gate the
  // rates on a different number entirely and hide everyone early season.
  if (dataView.minMin) pool = pool.filter(p => (p.mp || 0) >= dataView.minMin);
  if (q) pool = pool.filter(p => normName(p.name).includes(q) || normName(p.team).includes(q) || normName(p.club).includes(q));
  pool.sort(dataView.sort === 'owner'
    ? (a, b) => String(teamName(ownedBy[a.id]) || '~').localeCompare(String(teamName(ownedBy[b.id]) || '~')) || rating(b) - rating(a)
    : metricSort(dataView.sort));
  const total = pool.length;
  const shown = pool.slice(0, dataView.limit);
  const clubs = [...new Set(PLAYERS.map(p => p.team))].sort();
  return `<div class="card" style="margin-top:14px">
    <h2>The Player Explorer <span class="muted" style="font-weight:400;font-size:12px">every player, every stat, and who has him</span></h2>
    <div class="pool-controls">
      <input type="text" id="dxQ" placeholder="Search ${PLAYERS.length} players&hellip;" value="${esc(dataView.q)}">
      <select id="dxScope" aria-label="Ownership">
        <option value="all" ${dataView.scope === 'all' ? 'selected' : ''}>Everyone</option>
        <option value="owned" ${dataView.scope === 'owned' ? 'selected' : ''}>Owned only</option>
        <option value="waivers" ${dataView.scope === 'waivers' ? 'selected' : ''}>On waivers</option>
        <option value="free" ${dataView.scope === 'free' ? 'selected' : ''}>In the Trough</option>
      </select>
      <select id="dxPos" aria-label="Position"><option value="">All positions</option>
        ${['GK', 'DF', 'MF', 'FW'].map(p => `<option ${dataView.pos === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <select id="dxClub" aria-label="Club"><option value="">All clubs</option>
        ${clubs.map(c => `<option value="${esc(c)}" ${dataView.club === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <select id="dxMin" aria-label="Minimum minutes played" title="Per-90 columns are meaningless on a small sample — set a floor before trusting them">
        ${MIN_MINUTES_STEPS.map(n => `<option value="${n}" ${dataView.minMin === n ? 'selected' : ''}>${n ? `${n}+ mins (${Math.round(n / 90)} match${n / 90 === 1 ? '' : 'es'})` : 'Any minutes'}</option>`).join('')}
      </select>
    </div>
    ${(() => {
      const sel = compareIds();
      const n = sel.length;
      const names = sel.map(id => PLAYER_BY_ID[id]?.name).filter(Boolean);
      return `<div class="pool-controls" style="margin:0 0 10px">
        <button class="btn small ${n >= 2 ? '' : 'ghost'}" id="dxCompare" ${n >= 2 ? '' : 'disabled'} title="${n >= 2 ? 'Compare these' : 'Tick at least two players first'}">&#9878; Compare${n ? ` (${n}/${COMPARE_MAX})` : ''}</button>
        ${n ? `<span class="muted" style="font-size:11.5px">${names.map(esc).join(' v ')}</span>
        <button class="btn ghost small" id="dxClearCmp">Clear</button>` : `<span class="muted" style="font-size:11.5px">Tick two or three players to compare them &mdash; the same list the Draft Console and the Trough use.</span>`}
      </div>`;
    })()}
    ${scoutViewHtml('data')}
    <div style="overflow-x:auto"><table class="pool-table">
      <thead><tr>
        <th title="Tick two players to compare them" aria-label="Compare"></th>
        <th data-dxsort="name">Player</th>
        <th data-dxsort="owner">Owner ${dataView.sort === 'owner' ? '&#9662;' : ''}</th>
        ${cols.map(c => c.sortable === false
          ? `<th class="num" data-stat="${c.k}" title="${esc(c.t)}">${c.h}</th>`
          : `<th class="num" data-stat="${c.k}" data-dxsort="${c.k}" title="${esc(c.t)}">${c.h} ${dataView.sort === c.k ? '&#9662;' : ''}</th>`).join('')}
      </tr></thead>
      <tbody>${shown.map(p => {
        const m = metricsFor(p);
        const om = ownedBy[p.id];
        const picked = scoutCompare.includes(p.id);
        return `<tr${picked ? ' style="background:rgba(45,212,167,.06)"' : ''}>
          <td><input type="checkbox" data-cmp="${p.id}" ${picked ? 'checked' : ''} aria-label="Compare ${esc(p.name)}"></td>
          <td><span class="pos-badge pos-${p.pos}">${p.pos}</span> ${photoImg(p)} ${pname(p)} <span class="muted" style="font-size:11px">${esc(p.club)}</span></td>
          <td>${om != null ? `<span class="tag">${esc(teamName(om))}</span>`
            : onWaivers(p) ? '<span class="tag" title="Claim-only until the next waiver run">On waivers</span>'
            : '<span class="muted" style="font-size:11.5px">Trough</span>'}</td>
          ${cols.map(c => `<td class="num${c.cls || ''}">${c.v(m, p)}</td>`).join('')}
        </tr>`;
      }).join('') || `<tr><td colspan="${cols.length + 3}" class="muted">Nobody matches that.</td></tr>`}</tbody>
    </table></div>
    <p class="muted" style="font-size:11.5px;margin-top:6px">Showing ${shown.length} of ${total}${total > shown.length ? ' &middot; <button class="btn ghost small" id="dxMore">Show more</button>' : ''} &middot; tap a column to sort.</p>
  </div>`;
}
function bindExplorer() {
  if (!document.getElementById('dxQ')) return;
  // render() replaces the input, so the caret has to be put back or typing a
  // second character sends focus to the top of the page
  const redraw = (refocus) => {
    render();
    if (!refocus) return;
    const box = document.getElementById('dxQ');
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  };
  const q = document.getElementById('dxQ');
  q.oninput = e => { dataView = { ...dataView, q: e.target.value, limit: 40 }; redraw(true); };
  const pick = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.onchange = e => { dataView = { ...dataView, [key]: e.target.value, limit: 40 }; redraw(false); };
  };
  pick('dxScope', 'scope'); pick('dxPos', 'pos'); pick('dxClub', 'club');
  const mm = document.getElementById('dxMin');
  if (mm) mm.onchange = e => { dataView = { ...dataView, minMin: +e.target.value, limit: 40 }; redraw(false); };
  // comparison: tick two, then Compare. A third tick replaces the older pick
  // rather than refusing — refusing makes you hunt for what to untick.
  document.querySelectorAll('[data-cmp]').forEach(cb => cb.onchange = () => {
    const id = +cb.dataset.cmp;
    scoutCompare = cb.checked ? [...scoutCompare.filter(x => x !== id), id].slice(-COMPARE_MAX)
      : scoutCompare.filter(x => x !== id);
    dataView = { ...dataView, comparing: dataView.comparing && compareIds().length >= 2 };
    redraw(false);
  });
  const cmp = document.getElementById('dxCompare');
  if (cmp) cmp.onclick = () => { dataView = { ...dataView, comparing: true }; redraw(false); };
  const clr = document.getElementById('dxClearCmp');
  if (clr) clr.onclick = () => { scoutCompare = []; dataView = { ...dataView, comparing: false }; redraw(false); };
  const cc = document.getElementById('cmpClose');
  if (cc) cc.onclick = () => { dataView = { ...dataView, comparing: false }; redraw(false); };
  bindCompareBody(() => redraw(false));
  document.querySelectorAll('[data-dxsort]').forEach(th => th.onclick = () => {
    dataView = { ...dataView, sort: th.dataset.dxsort };
    scoutActiveView.data = ''; // hand-sorting means you've left the saved view
    redraw(false);
  });
  const more = document.getElementById('dxMore');
  if (more) more.onclick = () => { dataView = { ...dataView, limit: dataView.limit + 40 }; redraw(false); };
  bindScoutDesk('data', () => redraw(false));
  bindColToggle(() => redraw(false));
  bindColOrder(() => redraw(false));
}
function bindTradeRecord() {
  document.querySelectorAll('[data-traderec]').forEach(b => b.onclick = () => {
    tradeView = { scope: b.dataset.traderec };
    render();
  });
}
function bindFixtureMatrix() {
  const w = document.getElementById('fdrWeeks');
  if (w) w.onchange = e => { fdrView = { ...fdrView, weeks: +e.target.value }; render(); };
  const s = document.getElementById('fdrSort');
  if (s) s.onchange = e => { fdrView = { ...fdrView, sort: e.target.value }; render(); };
}
// the Lobus bonus rides on the manager's total but belongs to no single player,
// so it gets its own line — otherwise the rows quietly fail to sum (ledger #1)
function lobusBonusTotal(mid) {
  const bonus = +state.settings.lobusBonus || 0;
  if (!bonus) return 0;
  const lob = state.lobus?.[mid];
  if (!lob) return 0;
  let t = 0;
  for (let i = 0; i < GAMEWEEKS.length; i++) {
    if (!effectiveXI(mid, i).xi.includes(lob)) continue;
    const s = gwEvent(i)?.playerStats?.[lob];
    if (s && (s.g || 0) + (s.a || 0) > 0) t += bonus;
  }
  return t;
}
// Marc, 9 Aug: the season ledger — every team, its total, and on tap the men
// who actually earned it, biggest first
function seasonSquadCard() {
  const rows = state.managers.map(m => ({ m, pts: managerPoints(m.id) }))
    .sort((a, b) => b.pts - a.pts);
  if (!rows.some(r => r.pts !== 0)) {
    return `<div class="card toplist" style="margin-top:14px">
      <h2>The Season Ledger</h2>
      <p class="muted" style="font-size:12.5px">Nothing has been settled yet. The ledger opens when the football does.</p></div>`;
  }
  return `<div class="card toplist" style="margin-top:14px">
    <h2>The Season Ledger <span class="muted" style="font-weight:400;font-size:12px">tap a team for who actually earned it</span></h2>
    <div style="overflow-x:auto"><table class="pool-table">
      <thead><tr><th>Team</th><th class="num act">Points</th></tr></thead>
      <tbody>
      ${rows.map(({ m, pts }) => {
        const contribs = seasonContributors(m.id);
        const lob = lobusBonusTotal(m.id);
        return `
        <tr data-sqrow="${m.id}" style="cursor:pointer">
          <td><button class="btn ghost small icon-btn" data-pitchview="${m.id}" title="See this team on the pitch" aria-label="See this team on the pitch">&#9917;</button> ${kitSvg(m.id)} <b>${esc(m.team || m.name)}</b> <span class="muted" style="font-size:11px">${esc(m.name)}</span></td>
          <td class="num gold act"><b>${pts}</b></td>
        </tr>
        <tr class="bd-tr" id="sq-${m.id}" style="display:none"><td colspan="2">
          ${contribs.length ? `<div class="squad-row muted" style="font-size:10.5px;letter-spacing:.05em;text-transform:uppercase">
            <span style="flex:1"></span>
            <span style="flex:none;width:34px;text-align:right" title="Gameweeks this player has been in the squad">Own</span>
            <span style="flex:none;width:30px;text-align:right" title="Gameweeks this player started, auto-subs included">XI</span>
            <span style="flex:none;width:46px;text-align:right" title="Share of this team's season points">Share</span>
            <span style="flex:none;width:40px;text-align:right;margin-left:0">Pts</span>
          </div>` : ''}
          ${contribs.map(({ p, pts: cp, gone, held, picked, share }) => `
            <div class="squad-row"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${photoImg(p)}
            <span>${esc(p.name)}</span>
            <span class="muted" style="margin-left:8px;font-size:11.5px">${esc(p.club)}</span>
            ${gone ? '' : '<span class="tag">Owned</span>'}
            <span class="muted" style="flex:none;margin-left:auto;width:34px;text-align:right;font-variant-numeric:tabular-nums">${held}</span>
            <span class="muted" style="flex:none;width:30px;text-align:right;font-variant-numeric:tabular-nums">${picked}</span>
            <span class="muted" style="flex:none;width:46px;text-align:right;font-variant-numeric:tabular-nums">${share < 10 ? share.toFixed(1) : Math.round(share)}%</span>
            <span class="sp-pts" style="flex:none;width:40px;margin-left:0;text-align:right">${cp}</span></div>`).join('')
            || '<span class="muted">Nobody has banked a point for this team yet.</span>'}
          ${lob ? `<div class="squad-row"><span class="muted" style="margin-left:8px;font-size:11.5px">&#128227; Lobus bonus</span>
            <span style="flex:none;margin-left:auto;width:34px"></span><span style="flex:none;width:30px"></span><span style="flex:none;width:46px"></span>
            <span class="sp-pts" style="flex:none;width:40px;margin-left:0;text-align:right">${lob}</span></div>` : ''}
          <p class="muted" style="font-size:11px;margin:6px 0 4px">Own = gameweeks in the squad, XI = gameweeks started. Only points banked while in the starting XI count; bench weeks, Trough weeks and time served under another manager count for nothing here.</p>
        </td></tr>`;
      }).join('')}
      </tbody>
    </table></div>
  </div>`;
}
/* The trade record (Marc, 10 Aug). Transfer Report Cards already judge every
   completed move one at a time; nothing ever rolled them up. This is the
   league table of that — who has come out ahead across all their business.

   Trades only by default, because a trade is the only move with an opponent:
   the player you gave up goes to a NAMED manager who then benefits. A Trough
   signing's discard goes back to the Trough and nobody gains, so its net
   measures your own squad management, not a contest. Lumping them together
   produces a number that means two things at once.

   Scored on the 6-gameweek window where it has closed, the 3 where it hasn't,
   and each row says which — so nobody can argue the horizon was cherry-picked. */
let tradeView = { scope: 'trades' }; // 'trades' | 'all'
function tradeRecordCard() {
  const rows = Object.fromEntries(state.managers.map(m => [m.id, { id: m.id, n: 0, net: 0, best: null, worst: null, h3: 0 }]));
  const seen = new Set();
  state.transfers.forEach((t, i) => {
    if (tradeView.scope === 'trades' && !t.trade) return;
    // a 2-for-2 trade is several rows in state.transfers; judge the batch once
    const key = t.trade ? `${t.managerId}:${t.trade}` : `solo:${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    const w6 = transferWindowFacts(t, 6);
    const wf = w6 || transferWindowFacts(t, 3);
    if (!wf) return; // window still open — the Gazette does not judge early
    const r = rows[t.managerId];
    if (!r) return;
    r.n++; r.net += wf.diff;
    if (!w6) r.h3++;
    const label = `${wf.inn.map(x => x.p.name).join(' + ') || '—'} for ${wf.out.map(x => x.p.name).join(' + ') || '—'}`;
    if (!r.best || wf.diff > r.best.diff) r.best = { diff: wf.diff, label };
    if (!r.worst || wf.diff < r.worst.diff) r.worst = { diff: wf.diff, label };
  });
  const list = Object.values(rows).filter(r => r.n).sort((a, b) => b.net - a.net || b.n - a.n);
  const toggle = `<div class="pool-controls" style="margin:0 0 10px">
      <button class="btn small ${tradeView.scope === 'trades' ? '' : 'ghost'}" data-traderec="trades">Trades only</button>
      <button class="btn small ${tradeView.scope === 'all' ? '' : 'ghost'}" data-traderec="all">All moves</button>
    </div>`;
  const head = `<h2>The Trade Record <span class="muted" style="font-weight:400;font-size:12px">who has come out ahead</span></h2>`;
  if (!list.length) {
    return `<div class="card toplist" style="margin-top:14px">${head}${toggle}
      <p class="muted" style="font-size:12.5px">${tradeView.scope === 'trades'
        ? 'No trade has completed its three-gameweek review window yet. The Committee will not judge a deal before it has had a chance to go wrong.'
        : 'No move has completed its three-gameweek review window yet.'}</p></div>`;
  }
  const sign = n => `${n >= 0 ? '+' : ''}${n}`;
  const deal = d => d ? `<span class="muted" style="font-size:11.5px">${esc(d.label)}</span> <b>${sign(d.diff)}</b>` : '<span class="muted">&mdash;</span>';
  return `<div class="card toplist" style="margin-top:14px">${head}${toggle}
    <div style="overflow-x:auto"><table class="pool-table">
      <thead><tr><th>Team</th><th class="num">Judged</th><th class="num act">Net</th><th>Best</th><th>Worst</th></tr></thead>
      <tbody>${list.map((r, i) => `<tr>
        <td style="white-space:nowrap"><b>${esc(teamName(r.id))}</b> <span class="muted" style="font-size:11px">${esc(managerName(r.id))}</span>
          ${i === 0 && r.net > 0 ? '<span class="tag">&#129461; robbing the league</span>' : ''}
          ${i === list.length - 1 && r.net < 0 && list.length > 1 ? '<span class="tag">generous to a fault</span>' : ''}</td>
        <td class="num">${r.n}${r.h3 ? `<span class="muted" style="font-size:10.5px" title="${r.h3} of these are judged on the 3-gameweek window; the rest on 6"> (${r.h3}&times;3GW)</span>` : ''}</td>
        <td class="num act"><b style="color:${r.net > 0 ? '#3fb96d' : r.net < 0 ? '#e05555' : 'inherit'}">${sign(r.net)}</b></td>
        <td>${deal(r.best)}</td>
        <td>${deal(r.worst)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="muted" style="font-size:10.5px;margin-top:6px">Net is points in minus points shipped, over each move's review window &mdash; six gameweeks where that has closed, three where it hasn't. ${tradeView.scope === 'trades' ? 'Trades only: the one move type with an opponent on the other end.' : 'All completed business, including waivers and the Trough &mdash; where the discard goes back to the pool and nobody gains.'}</p>
  </div>`;
}
function troughActivityCard() {
  const rows = state.managers.map(m => {
    const mine = state.transfers.filter(t => t.managerId === m.id);
    return {
      id: m.id,
      signs: mine.filter(t => !t.trade && !t.waiver).length,
      claims: mine.filter(t => t.waiver).length,
      trades: mine.filter(t => t.trade).length,
      total: mine.length,
    };
  }).sort((a, b) => b.total - a.total);
  const max = rows[0]?.total || 0;
  const counts = {};
  for (const t of state.transfers) {
    if (t.trade) continue; // trades aren't the Trough
    for (const pid of [t.inId, t.outId]) counts[pid] = (counts[pid] || 0) + 1;
  }
  const hot = Object.entries(counts).map(([pid, n]) => ({ p: PLAYER_BY_ID[pid], n }))
    .filter(x => x.p && x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 8);
  return `<div class="card toplist" style="margin-top:14px">
    <h2>Trough Activity <span class="muted" style="font-weight:400;font-size:12px">who can't leave it alone</span></h2>
    <div style="overflow-x:auto"><table class="pool-table">
      <thead><tr><th>Manager</th><th class="num">Trough signings</th><th class="num">Waiver claims won</th><th class="num">Trades</th><th class="num">Total moves</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td><b>${esc(teamName(r.id))}</b> <span class="muted" style="font-size:11px">${esc(managerName(r.id))}</span>
          ${max > 0 && i === 0 ? '<span class="tag">&#128055; lives at the Trough</span>' : ''}
          ${max > 0 && i === rows.length - 1 && r.total === 0 ? '<span class="tag">hasn\'t touched his team</span>' : ''}</td>
        <td class="num">${r.signs}</td><td class="num">${r.claims}</td><td class="num">${r.trades}</td>
        <td class="num gold">${r.total}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <h3 style="margin-top:16px">Hot potatoes &#129364; <span class="muted" style="font-weight:400;font-size:11.5px">most passed through the Trough</span></h3>
    ${hot.length
      ? hot.map(({ p, n }) => `<div class="squad-row"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${photoImg(p)}<span>${pname(p)}</span><span class="muted" style="margin-left:8px;font-size:11.5px">${esc(p.club)}</span><span class="sp-pts">${n} moves</span></div>`).join('')
      // Marc, 9 Aug: it holds its place and says something rather than vanishing
      // the moment nobody has been passed around twice
      : `<p class="muted" style="font-size:12.5px;margin:6px 0 2px">${Object.keys(counts).length
        ? 'One move each so far. Nobody has been passed around twice.'
        : 'Waiting for those first snouts to hit the sweet, sweet Trough.'}</p>`}
  </div>`;
}
// any [data-pitchview] jumps straight to that team's pitch (Lee's ask:
// every team clickable through to a pitch view, not just a dropdown)
function bindPitchLinks() {
  document.querySelectorAll('[data-pitchview]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    teamView.mid = +b.dataset.pitchview;
    teamView.gw = null;
    teamView.showOpp = false;
    state.view = 'team';
    save(); render();
  });
}
function bindTable() {
  bindPitchLinks();
  document.querySelectorAll('[data-tblmode]').forEach(b => b.onclick = () => {
    tableView = { ...tableView, mode: b.dataset.tblmode === 'overall' ? 'overall' : 'form' };
    render();
  });
  const fn = $('#tblFormN');
  if (fn) fn.onchange = e => { tableView = { ...tableView, n: +e.target.value, mode: 'form' }; render(); };
  document.querySelectorAll('[data-mgr-row]').forEach(row => row.onclick = () => {
    const bd = $(`#bd-${row.dataset.mgrRow}`);
    bd.style.display = bd.style.display === 'none' ? '' : 'none'; // '' = table-row
  });
  document.querySelectorAll('[data-mu]').forEach(el => el.onclick = () => {
    const [a, b, i] = el.dataset.mu.split(':').map(Number);
    showMatchup(a, b, i);
  });
  document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { state.view = b.dataset.goto; save(); render(); });
}

/* ----- fixtures ----- */
let fxView = { gw: null };
function viewFixtures() {
  if (!state.fixtures.length) {
    return `<div class="card" style="text-align:center;padding:50px">
      <h2>No fixtures loaded yet</h2>
      <p class="muted" style="margin:10px 0 18px">Refresh to pull the season's schedule and any results.</p>
      <button class="btn" id="fxSync">&#8635; Refresh</button></div>`;
  }
  if (fxView.gw == null) fxView.gw = GAMEWEEKS[planningGwIndex()].n;
  const fxs = state.fixtures.filter(f => f.gw === fxView.gw);
  const byDay = {};
  for (const f of fxs) {
    const d = new Date(f.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    (byDay[d] = byDay[d] || []).push(f);
  }
  return `
  <div class="team-controls card">
    <select id="fxGw">${GAMEWEEKS.map(g => `<option value="${g.n}" ${g.n === fxView.gw ? 'selected' : ''}>GW${g.n}${g.n === GAMEWEEKS[planningGwIndex()].n ? ' (current)' : ''}</option>`).join('')}</select>
  </div>
  ${Object.entries(byDay).map(([day, list]) => `
    <div class="fx-day"><h3>${day}</h3><div class="fx-grid">
    ${list.map(f => {
      const live = f.started && !fxOver(f); // fp: the whistle ends it here too
      const score = !f.started ? new Date(f.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : `${f.hs ?? ''}–${f.as ?? ''}`;
      // scorers live ON the page; a tap unfolds the full match centre inline
      // (lineups, assists, who featured — owner tags and all). Ben, GW1
      // night: "better to have the epl games page have the lineups and
      // scorers — i like the feature with the who owned still so leave that"
      const open = fxView.open === f.id;
      const detail = open ? (() => { const c = fixtureCardBody(f); return `<div class="fx-detail">${c.body}</div>`; })() : '';
      return `<div class="fx ${live ? 'live' : ''}" data-fx="${f.id}" style="cursor:pointer" title="${open ? 'Fold it away' : 'Tap for the full match centre'}">
        <div class="fx-team right"><span>${esc(f.home)}</span>${flagImg(f.home)}</div>
        <span class="fx-score">${score}</span>
        <div class="fx-team"><span>${flagImg(f.away)}</span><span>${esc(f.away)}</span></div>
        <span class="fx-time">${live ? `${f.minutes}'` : (fxOver(f) && f.started ? 'FT' : '')}</span>
        ${fxOver(f) && f.started ? `<a class="fx-yt" href="${fxYtHref(f)}" target="_blank" rel="noopener" title="Highlights on Sky Sports Football">&#9654; Highlights</a>` : ''}
      </div>${detail}`;
    }).join('')}
    </div></div>`).join('') || '<div class="card"><p class="muted">No fixtures scheduled for this gameweek yet.</p></div>'}`;
}
function bindFixtures() {
  const sel = $('#fxGw');
  if (sel) sel.onchange = e => { fxView.gw = +e.target.value; render(); };
  const fs = $('#fxSync');
  if (fs) fs.onclick = () => syncNow(true); // inline onclick= is dead under the CSP
  document.querySelectorAll('[data-fx]').forEach(el => el.onclick = e => {
    if (e.target.closest('.fx-yt')) return; // the Highlights link keeps its job
    // the detail unfolds in place on the games page; one open at a time
    const id = +el.dataset.fx;
    fxView.open = fxView.open === id ? null : id;
    render();
  });
}
// tap a game → the match centre (Ben, UAT night: "pulling the lineups and
// scorers in games… assists too"). Everything comes from our own gw stats —
// scorers, assists, cards, who featured — with league-owner tags. Pre-match
// it lists both clubs' owned men (predicted XIs aren't public FPL data).
// the match centre's body, shared by the popup (dashboard ticker, Matches
// page) and the EPL games page's inline expansion (Ben, GW1 night: "better to
// have the epl games page have the lineups and scorers — leave the who owned")
function fixtureCardBody(f) {
  const gwIdx = GAMEWEEKS.findIndex(g => g.n === f.gw);
  const ev = gwIdx >= 0 ? gwEvent(gwIdx) : null;
  const ownedBy = {};
  if (gwIdx >= 0) for (const mm of state.managers) for (const sp of squadAt(mm.id, gwIdx)) ownedBy[sp.id] = mm.id;
  const ownTag = pid => ownedBy[pid] != null ? ` <span class="muted" style="font-size:10.5px">(${esc(teamName(ownedBy[pid]))})</span>` : '';
  const side = club => {
    const rows = [];
    if (ev) {
      const played = PLAYERS.filter(p => p.team === club && ev.playerStats?.[p.id]?.min > 0)
        .map(p => ({ p, s: ev.playerStats[p.id] }));
      const line = (list, icon, label) => list.length
        ? `<div class="lrow" style="font-size:12.5px">${icon} <b>${label}</b>&nbsp; ${list.map(({ p, s, n }) => `${pname(p)}${n > 1 ? ` ×${n}` : ''}${ownTag(p.id)}`).join(', ')}</div>` : '';
      rows.push(line(played.filter(x => x.s.g > 0).map(x => ({ ...x, n: x.s.g })), '&#9917;', 'Scorers'));
      rows.push(line(played.filter(x => x.s.a > 0).map(x => ({ ...x, n: x.s.a })), '&#127919;', 'Assists'));
      rows.push(line(played.filter(x => x.s.rc).map(x => ({ ...x, n: 1 })), '&#128997;', 'Sent off'));
      rows.push(line(played.filter(x => x.s.og).map(x => ({ ...x, n: x.s.og })), '&#128552;', 'Own goals'));
      rows.push(line(played.filter(x => x.s.ps).map(x => ({ ...x, n: x.s.ps })), '&#129508;', 'Pen saves'));
      // a proper teamsheet, not a flat list (Ben, GW1 night: "get this more
      // into the proper lineups in order") — the XI by position with minutes,
      // the bench beneath, owner tags throughout
      const posOrder = { GK: 0, DF: 1, MF: 2, FW: 3 };
      const starters = played.filter(x => x.s.st).sort((a, b) => posOrder[a.p.pos] - posOrder[b.p.pos] || b.s.min - a.s.min);
      const bench = played.filter(x => !x.s.st).sort((a, b) => b.s.min - a.s.min);
      if (starters.length) {
        // FPL publishes no formations, but the XI's own shape is ours to
        // count (Ben: "can we not pull that data from elsewhere?" — the
        // proper sources cost keys, scraping or an Opta id-mapping project;
        // the counts give the line for free). ↩ = came off, ↪ = came on.
        const shape = ['DF', 'MF', 'FW'].map(pos => starters.filter(x => x.p.pos === pos).length).join('-');
        rows.push(`<div class="ms-sheet">
          <div class="ms-shape">STARTING XI &middot; ${shape}</div>
          ${['GK', 'DF', 'MF', 'FW'].map(pos => {
            const men = starters.filter(x => x.p.pos === pos);
            return men.length ? `<div class="ms-row"><span class="pos-chip">${pos}</span><span>${men.map(({ p, s }) => `${pname(p)} <span class="muted">${fxOver(f) && s.min < 90 && !s.rc ? '&#8617; ' : ''}${s.min}'</span>${ownTag(p.id)}`).join(' &middot; ')}</span></div>` : '';
          }).join('')}
          ${bench.length ? `<div class="ms-row"><span class="pos-chip">SUB</span><span>${bench.map(({ p, s }) => `${pname(p)} <span class="muted">&#8618; ${s.min}'</span>${ownTag(p.id)}`).join(' &middot; ')}</span></div>` : ''}
        </div>`);
      } else if (bench.length) {
        rows.push(`<div class="ms-row"><span class="pos-chip">SUB</span><span>${bench.map(({ p, s }) => `${pname(p)} <span class="muted">&#8618; ${s.min}'</span>${ownTag(p.id)}`).join(' &middot; ')}</span></div>`);
      }
      if (!played.length) rows.push('<p class="muted" style="font-size:12px">No one on the pitch yet.</p>');
    } else {
      const owned = PLAYERS.filter(p => p.team === club && ownedBy[p.id] != null);
      rows.push(owned.length
        ? `<div class="lrow" style="font-size:12.5px;flex-wrap:wrap"><span class="muted">Our men in this one:</span>&nbsp;${owned.map(p => `${pname(p)}${ownTag(p.id)}`).join(', ')}</div>`
        : '<p class="muted" style="font-size:12px">Nobody from this club is owned. The Trough awaits.</p>');
    }
    return rows.filter(Boolean).join('');
  };
  const score = !f.started ? new Date(f.date).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : `${f.hs ?? 0}–${f.as ?? 0}`;
  const status = fxOver(f) && f.started ? 'FT' : f.started ? `${f.minutes}&prime; LIVE` : 'kick-off';
  // the highlights ride inside the match centre too ("where is youtube?")
  const yt = fxOver(f) && f.started
    ? `<div style="text-align:center;margin-top:10px"><a class="fx-yt" href="${fxYtHref(f)}" target="_blank" rel="noopener">&#9654; Highlights on Sky Sports</a></div>` : '';
  const body = `<h3 class="ms-club">${flagImg(f.home)} ${esc(f.home)}</h3>${side(f.home)}
    <h3 class="ms-club">${flagImg(f.away)} ${esc(f.away)}</h3>${side(f.away)}${yt}`;
  return { score, status, body, ownedBy };
}
function showFixtureCard(fxId) {
  const f = state.fixtures.find(x => x.id === fxId);
  if (!f) return;
  const { score, status, body } = fixtureCardBody(f);
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="card" style="max-width:460px;width:94%;max-height:86vh;overflow-y:auto">
    <h2 style="text-align:center">${flagImg(f.home)} ${esc(f.home)} <span class="gold">${score}</span> ${esc(f.away)} ${flagImg(f.away)} <span class="tag">${status}</span></h2>
    ${body}
    <div style="text-align:center;margin-top:12px"><button class="btn ghost small" id="fxcClose">Close</button></div>
  </div>`;
  document.body.appendChild(ov);
  pushOvState();
  ov.onclick = e => { if (e.target === ov) closeOv(ov); };
  ov.querySelector('#fxcClose').onclick = () => closeOv(ov);
}

/* ----- rules ----- */
const HONOURS_BOARD = [
  ['2015–16', 'Toby Levy', '*'], ['2016–17', 'Marc Conway', '*'], ['2017–18', 'Ian Tussie', '*'],
  ['2018–19', 'Marc Conway', '**'], ['2019–20', 'Ben Polak', '*'], ['2020–21', 'Alex Singer', '*'],
  ['2021–22', 'Alex Singer', '**'], ['2022–23', 'Alex Duckett', '*'], ['2023–24', 'Ian Tussie', '**'],
  ['2024–25', 'Richard Blank', '*'], ['2025–26', 'Adam Jackson', '*'],
];
function viewRules() {
  const sc = state.settings.scoring;
  return `
  <div class="settings-grid">
    <div class="card">
      <h2>The Basics</h2>
      <p class="rules-p">Twelve managers. One snake draft over all ${PLAYERS.length} Premier League players — order reverses every round. Est. 2015; this is season twelve.</p>
      <p class="rules-p">Squads are fixed at <b>${SQUAD_RULES.size}</b>: ${['GK', 'DF', 'MF', 'FW'].map(p => `${SQUAD_RULES.min[p]}–${SQUAD_RULES.max[p]} ${p}`).join(', ')}. Those lower bounds leave room for only <b>one positional flex</b> — you cannot carry 6 midfielders and 4 forwards together. The same rule applies to the draft, autopicks, trades, waivers, the Trough and the Window Draft. <b>No club cap.</b></p>
      <p class="rules-p"><b>Starting XI:</b> pick 11 from your ${SQUAD_RULES.size} each gameweek — 1 GK, 3–5 DF, 2–5 MF, 1–3 FW. <b>Only starters score.</b> Lineups lock at the FPL deadline.</p>
      <p class="rules-p"><b>Forgot to set it?</b> Your last saved XI carries over, minus anyone you've since sold (repaired to a legal shape if needed). A best XI is auto-picked only if you've never set one at all. Nobody scores nil for being on holiday.</p>
      <p class="rules-p"><b>Auto-subs:</b> if a starter doesn't play at all that gameweek, your bench comes in automatically <b>in the order you've set</b> — leftmost first (tap two bench players on the pitch view to reorder).</p>
      <h3>The season</h3>
      <p class="rules-p"><b>GW1–33</b>: regular season, head-to-head every week — everyone plays everyone, nearly three times over. Win 3, draw 1, loss 0.</p>
      <p class="rules-p"><b>GW34</b>: handicap quarter-finals, one leg — top eight go through. 1v8, 2v7, 3v6, 4v5, with the higher seed starting on <b>the full table-Points gap</b> between the pair. Dominate the regular season, carry the cushion; scrape in level, get nothing.</p>
      <p class="rules-p"><b>GW35</b>: semi-finals, one leg — winner of 1v8 meets winner of 4v5, winner of 2v7 meets winner of 3v6. No handicaps from here.</p>
      <p class="rules-p"><b>GW36–38</b>: the final, three legs. Most legs won → cumulative points → higher regular-season finish. All other ties: higher seed advances.</p>
      <p class="rules-p"><b>The Monzo League Cup</b>, from GW8: last man standing. Lowest score each gameweek is eliminated; ties roll over.</p>
      <p class="rules-p"><b>The Palwin Ham Cup</b> — the second cup (Toby asked; here it is). One random gameweek, drawn by the Chairman from GW20 onwards. Selection opens seven days before the tie's first kickoff, at which point the Trough is <b>frozen</b> — every manager picks an XI from that frozen pool of unowned players only. Highest score lifts the Ham. Your actual squad plays no part; this is scouting, pure and petty.</p>
    </div>
    <div class="card">
      <h2>Scoring</h2>
      ${Object.keys(DEFAULT_SCORING).filter(k => sc[k] !== 0).map(k => `<div class="score-row"><span>${SCORING_LABELS[k]}</span><b class="gold">${sc[k] > 0 ? '+' : ''}${sc[k]}</b></div>`).join('')}
      <p class="muted" style="font-size:11.5px;margin-top:8px">Raw stats from the official FPL feed, scored by our table above. No captains. No bonus points. <b>No defensive-contribution (DEFCON) points.</b> Double gameweeks score on the week's combined stats.</p>
      <h3 style="margin-top:16px">Waivers &amp; trades</h3>
      <p class="rules-p"><b>Waivers:</b> the market runs to a fixed clock. The Trough closes <b>90 minutes before a gameweek's first kick-off</b>; while the gameweek plays, everyone is claim-only. Waivers resolve at <b>10am every Tuesday and Friday</b> (reverse table order — win a claim, drop to the back); the first run after the gameweek's last fixture reopens the Trough. The Chairman can run waivers early, skip one run by exception (claims roll to the next), or open/close the Trough entirely.</p>
      <p class="rules-p"><b>The Trough:</b> whatever clears waivers is a free agent — first come, first served, instant. Squads stay at 14; someone always goes out.</p>
      <p class="rules-p"><b>The Window:</b> anyone who joins a Premier League club after draft night is locked away until the transfer window shuts. The Chairman then runs the <b>Window Draft</b> — first pick to whoever picked last on draft night, snaking back up, until a full lap of passes. Whatever's left spills into the Trough.</p>
      <p class="rules-p"><b>January:</b> new signings can't be taken until the window shuts — then it's bottom of the league up. Nitty-gritty confirmed nearer the time, as is tradition.</p>
      <p class="rules-p"><b>Trades:</b> player-for-player swaps between managers, agreed in the group, any time until the playoff lock. Doesn't use your waiver turn.</p>
      <p class="rules-p"><b>Playoff lock:</b> after GW33, non-playoff teams are frozen — no waivers, no trades, no passing players back.</p>
    </div>
    <div class="card">
      <h2>Honours Board &#127942;</h2>
      ${HONOURS_BOARD.map(([yr, who, stars]) => `<div class="score-row"><span>${yr}</span><b>${esc(who)} ${stars}</b></div>`).join('')}
      <h3 style="margin-top:16px">Prize money</h3>
      <p class="rules-p">£50 each. Last season's split: £250 playoff winner, £130 runner-up, £75 last man standing — and <b>£145 to the site</b>. The site now costs <b>£0</b>, because we built our own. That's £145 back in the pot; redistribution to be argued about in the group chat.</p>
      <h3 style="margin-top:16px">The small print</h3>
      <p class="rules-p">Stats sync automatically from the official FPL feed (goals land within ~15 minutes on matchdays). The Chairman settles disputes, can act for absent managers, and adjusts points if the feed errs.</p>
      <p class="rules-p muted" style="font-style:italic">All decisions are final. Complaints may be lodged in the group chat, where they will be enjoyed. — The Committee</p>
    </div>
  </div>`;
}

/* ----- the Record Book — mined from Draft Fantasy before the lights went out ----- */
function recordBookCards() {
  if (typeof LEAGUE_HISTORY === 'undefined' || !LEAGUE_HISTORY.length) return '';
  return LEAGUE_HISTORY.map(S => {
    const rows = S.managers.map((m, i) => ({ i, team: m.team, name: m.name, p: 0, w: 0, d: 0, l: 0, pf: 0, pa: 0, pts: 0 }));
    let hi = null, lo = null, hiding = null;
    for (const [gw, h, a, hp, ap] of S.matches) {
      const H = rows[h], A = rows[a];
      H.p++; A.p++; H.pf += hp; H.pa += ap; A.pf += ap; A.pa += hp;
      if (hp > ap) { H.w++; A.l++; } else if (hp < ap) { A.w++; H.l++; } else { H.d++; A.d++; }
      for (const [idx, pts] of [[h, hp], [a, ap]]) {
        if (!hi || pts > hi.pts) hi = { idx, pts, gw };
        if (!lo || pts < lo.pts) lo = { idx, pts, gw };
      }
      const margin = Math.abs(hp - ap);
      if (margin && (!hiding || margin > hiding.margin)) hiding = { margin, gw, w: hp > ap ? h : a, l: hp > ap ? a : h, ws: Math.max(hp, ap), ls: Math.min(hp, ap) };
    }
    rows.forEach(r => { r.pts = 3 * r.w + r.d; });
    const table = [...rows].sort((x, y) => y.pts - x.pts || y.pf - x.pf);
    const hon = S.honours || {};
    const isChamp = r => hon.champion && r.name === hon.champion.name;
    const isTopped = r => hon.regularSeason && r.name === hon.regularSeason.name;
    // head-to-head ledger: row's record against column, all meetings
    const grid = rows.map(() => rows.map(() => ({ w: 0, d: 0, l: 0 })));
    for (const [, h, a, hp, ap] of S.matches) {
      if (hp > ap) { grid[h][a].w++; grid[a][h].l++; }
      else if (hp < ap) { grid[h][a].l++; grid[a][h].w++; }
      else { grid[h][a].d++; grid[a][h].d++; }
    }
    const init = t => esc(t.split(/\s+/).map(w => (w.codePointAt(0) < 128 ? w[0] : '')).join('').slice(0, 3).toUpperCase() || t.slice(0, 3).toUpperCase());
    const rec = (icon, label, text) => `<div class="lrow" style="font-size:12.5px"><span style="width:22px">${icon}</span><b style="min-width:170px">${label}</b><span>${text}</span></div>`;

    // Draft Night board — [round, pick, teamIdx, player, club, pos], snake order preserved by pick number
    let draftCard = '';
    if (S.draft && S.draft.length) {
      const order = S.draft.filter(p => p[0] === 1).sort((a, b) => a[1] - b[1]).map(p => p[2]);
      const nRounds = Math.max(...S.draft.map(p => p[0]));
      const cell = {};
      for (const [r, , t, player, club, pos] of S.draft) cell[r + ':' + t] = { player, club, pos };
      draftCard = `
    <div class="card" style="margin-top:14px">
      <h2>Draft Night — ${esc(S.season)} <span class="muted" style="font-weight:400;font-size:12px">the full board, ${S.draft.length} picks, snake order</span></h2>
      <div style="overflow-x:auto">
      <table class="pool-table" style="font-size:11px">
        <thead><tr><th></th>${order.map(t => `<th class="num" title="${esc(rows[t].name)}">${init(rows[t].team)}</th>`).join('')}</tr></thead>
        <tbody>${Array.from({ length: nRounds }, (_, k) => k + 1).map(r => `<tr>
          <td class="muted">R${r}</td>
          ${(r % 2 ? order : [...order].reverse()).map(t => { const p = cell[r + ':' + t]; return p ? `<td style="white-space:nowrap"><span class="pos-badge pos-${p.pos}" style="font-size:9px;padding:1px 4px">${p.pos}</span> ${esc(p.player)} <span class="muted" style="font-size:10px">${esc(p.club)}</span></td>` : '<td class="muted">—</td>'; }).join('')}
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="muted" style="font-size:10.5px;margin-top:6px">Even rounds read right-to-left, as the snake intended. First overall: <b>${esc(S.draft[0][3])}</b> to ${esc(rows[S.draft[0][2]].team)}.</p>
    </div>`;
    }

    // The Cup — [gw, round, leg, home, away, hp, ap]
    let cupCard = '';
    if (S.cup && S.cup.length) {
      const maxR = Math.max(...S.cup.map(m => m[1]));
      const label = m => m[1] === maxR ? `Final${S.cup.filter(x => x[1] === maxR).length > 1 ? `, leg ${m[2]}` : ''}` : 'Semi-final';
      const agg = {};
      for (const m of S.cup.filter(x => x[1] === maxR)) { agg[m[3]] = (agg[m[3]] || 0) + m[5]; agg[m[4]] = (agg[m[4]] || 0) + m[6]; }
      const [wIdx] = Object.entries(agg).sort((a, b) => b[1] - a[1])[0] || [];
      cupCard = `
    <div class="card" style="margin-top:14px">
      <h2>The Cup — ${esc(S.season)} <span class="muted" style="font-weight:400;font-size:12px">as recorded by Draft Fantasy</span></h2>
      ${S.cup.map(m => rec('&#9917;', `${label(m)} &middot; GW${m[0]}`, `<b>${esc(rows[m[3]].team)}</b> ${m[5]}&ndash;${m[6]} <b>${esc(rows[m[4]].team)}</b>`)).join('')}
      ${wIdx !== undefined ? `<p class="rules-p" style="margin-top:8px">&#127942; Cup winner: <b>${esc(rows[wIdx].team)}</b> (${esc(rows[wIdx].name)}), ${Object.values(agg).sort((a, b) => b - a).join('&ndash;')} on aggregate.</p>` : ''}
    </div>`;
    }
    return `
    <div class="card" style="margin-top:18px">
      <h2>The Record Book — ${esc(S.season)} <span class="muted" style="font-weight:400;font-size:12px">mined from Draft Fantasy before we turned the lights off</span></h2>
      ${hon.champion ? `<p class="rules-p">&#127942; <b>Champion: ${esc(hon.champion.team.replace(/\*+$/, ''))}</b> (${esc(hon.champion.name)}) — ${esc(hon.champion.note || 'won the playoffs')}. ${hon.regularSeason ? `${esc(hon.regularSeason.team)} ${esc(hon.regularSeason.note || 'topped the table')}.` : ''}</p>` : ''}
      ${hon.caveat ? `<p class="rules-p muted" style="font-size:11.5px;font-style:italic">${esc(hon.caveat)}</p>` : ''}
      <div style="overflow-x:auto">
      <table class="pool-table" style="font-size:12px">
        <thead><tr><th></th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">+</th><th class="num">&minus;</th><th class="num">Pts</th></tr></thead>
        <tbody>${table.map((r, k) => `<tr>
          <td class="muted">${k + 1}</td>
          <td style="white-space:nowrap"><b>${esc(r.team)}</b> <span class="muted" style="font-size:11px">${esc(r.name)}</span>${isChamp(r) ? ' &#127942;' : ''}${isTopped(r) ? ' <span class="tag" title="Topped the table, lost the playoffs">table</span>' : ''}</td>
          <td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td>
          <td class="num muted">${r.pf}</td><td class="num muted">${r.pa}</td><td class="num gold">${r.pts}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <h3 style="margin-top:14px">Season records</h3>
      ${hi ? rec('&#128293;', 'Highest score', `<b>${esc(rows[hi.idx].team)}</b> — ${hi.pts} points, GW${hi.gw}`) : ''}
      ${lo ? rec('&#128128;', 'Lowest score', `<b>${esc(rows[lo.idx].team)}</b> — ${lo.pts} points, GW${lo.gw}`) : ''}
      ${hiding ? rec('&#128296;', 'Biggest hiding', `<b>${esc(rows[hiding.w].team)}</b> ${hiding.ws}&ndash;${hiding.ls} <b>${esc(rows[hiding.l].team)}</b>, GW${hiding.gw}`) : ''}
    </div>${draftCard}${cupCard}
    <div class="card" style="margin-top:14px">
      <h2>Head-to-head ledger — ${esc(S.season)} <span class="muted" style="font-weight:400;font-size:12px">row's record vs column (W-D-L), grudges included</span></h2>
      <div style="overflow-x:auto">
      <table class="pool-table" style="font-size:11px">
        <thead><tr><th></th>${rows.map(c => `<th class="num" title="${esc(c.team)}">${init(c.team)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr>
          <td style="white-space:nowrap"><b title="${esc(r.name)}">${esc(r.team)}</b></td>
          ${rows.map((c, j) => i === j ? '<td class="num muted">—</td>' : `<td class="num" style="white-space:nowrap;${grid[i][j].w > grid[i][j].l ? 'color:#3fb96d' : grid[i][j].w < grid[i][j].l ? 'color:#e05555' : ''}">${grid[i][j].w}-${grid[i][j].d}-${grid[i][j].l}</td>`).join('')}
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="muted" style="font-size:10.5px;margin-top:6px">All ${S.matches.length} meetings, ${esc(S.season)}. Earlier seasons join the Book as they're recovered from Draft Fantasy's archives.</p>
    </div>`;
  }).join('');
}

/* ----- settings ----- */
/* ----- the Chairman's pre-flight panel (sol product review #3): one glance,
   seven checks, honest reasons. Read-only — every button is a safe link to a
   control that already exists. ----- */
function preflightCard() {
  const light = (st, label, why, extra = '') => `<div class="lrow" style="font-size:12.5px;display:flex;gap:8px;align-items:flex-start;padding:3px 0">
    <span style="flex-shrink:0;font-size:13px">${st === 'ok' ? '&#128994;' : st === 'warn' ? '&#128993;' : st === 'bad' ? '&#128308;' : '&#9898;'}</span>
    <div style="min-width:0"><b>${label}</b> <span class="muted">— ${why}</span>${extra}</div></div>`;
  const rows = [];
  // 1. feed freshness
  const age = state.feedGenerated ? Date.now() - new Date(state.feedGenerated).getTime() : null;
  const mins = age != null ? Math.round(age / 60000) : null;
  rows.push(light(age == null ? 'warn' : mins <= 30 ? 'ok' : mins <= 90 ? 'warn' : 'bad', 'Stats feed',
    age == null ? 'no feed stamp in memory — refresh' : `updated ${mins} min ago${mins > 90 ? ' — waivers will refuse to run on this' : ''}`,
    ` <button class="btn ghost small" id="pfSync">&#8635; refresh</button>`));
  // 1b. the live wire (GW1 night: it stalled silently) — last fast-lane write
  const lvT = state.liveStats?.t || null;
  const lvAge = lvT ? Date.now() - lvT : null;
  if (anyMatchLive()) {
    rows.push(light(lvAge != null && lvAge <= 90e3 ? 'ok' : lvAge != null && lvAge <= 5 * 60e3 ? 'warn' : 'bad', 'Live wire',
      lvAge == null ? 'match in play but NO fast-lane write — check liveTick (Cloud Scheduler) and the live.yml fallback'
        : `last write ${fmtLiveAge(lvAge)} ago${lvAge > 5 * 60e3 ? ' — the fast lane has stalled; the Pages feed still lands every ~15 min' : ''}`));
  } else {
    rows.push(light('info', 'Live wire', lvT
      ? `idle — last write ${new Date(lvT).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
      : 'idle — no match in play, the overlay is clear'));
  }
  // 2. the chamber
  const mk = state.mock;
  rows.push(SANDBOX
    ? light(mk ? 'warn' : 'ok', 'Simulation Chamber', mk ? `mounted (GW${GAMEWEEKS[mk.gw]?.n}, ${esc(mk.phase)}) — deals clamp to GW${GAMEWEEKS[Math.min(mk.gw + 1, GAMEWEEKS.length - 1)]?.n} until it's switched off` : 'dark — real clocks apply')
    : light(mk ? 'bad' : 'ok', 'Simulation Chamber', mk ? 'a mock is mounted in the REAL league — switch it off, this should be impossible' : 'no mock in the real league, as it should be'));
  // 3. squads
  if (state.draft.picks.length) {
    const tgw = transferGw();
    const broken = state.managers.filter(m => { const sq = squadAt(m.id, tgw); return sq.length !== SQUAD_RULES.size || !squadShapeOk(sq); });
    rows.push(light(broken.length ? 'bad' : 'ok', 'Squads',
      broken.length ? `${broken.length} squad${broken.length > 1 ? 's' : ''} illegal at GW${GAMEWEEKS[tgw].n}: ${broken.map(m => esc(m.team || m.name)).join(', ')}` : `all ${state.managers.length} legal — ${SQUAD_RULES.size} men, shapes inside the rules`));
  } else {
    rows.push(light('info', 'Squads', state.phase === 'setup' ? `not drafted yet — ${Object.keys(state.ready || {}).length}/${state.managers.length} in the ready room` : 'no picks on the board'));
  }
  // 4. draft board
  const expect = state.managers.length * SQUAD_RULES.size;
  rows.push(state.phase === 'draft'
    ? light(state.draft.deadline || !state.settings.pickTimer ? 'ok' : 'warn', 'Draft board', `live — pick ${state.draft.picks.length + 1} of ${expect}${state.settings.pickTimer && !state.draft.deadline ? ', clock not yet armed' : ''}`)
    : light(state.phase === 'season' && state.draft.picks.length === expect ? 'ok' : state.phase === 'season' ? 'bad' : 'info', 'Draft board',
      state.phase === 'season' ? `${state.draft.picks.length}/${expect} picks recorded${state.draft.picks.length === expect ? '' : ' — the board is short'}` : 'waiting for draft night'));
  // 5. waiver scheduler
  const ctl = waiverControl();
  const nextRun = nextLiveWaiverRun();
  rows.push(light(ctl === 'auto' ? 'ok' : 'warn', 'Waivers',
    ctl === 'auto' ? `10am Tuesday and Friday — next run ${fmtWhen(nextRun)}${state.waiverMeta?.skip ? ' (one run skipped by the Chairman)' : ''}` : `manual override active (${esc(ctl)}) — the scheduler stands down until it's back on auto`));
  // 6. orphaned trades
  const stale = toArr(state.trades).filter(t => t.status === 'executing' || (t.status === 'pending' && Date.now() - (t.t || 0) > 7 * 864e5));
  rows.push(light(stale.length ? 'warn' : 'ok', 'Trade desk', stale.length ? `${stale.length} offer${stale.length > 1 ? 's' : ''} stuck or older than a week — worth a look` : 'no orphaned offers'));
  // 7. backups — the client can't see GitHub's artifacts, so no false greens
  rows.push(light('info', 'Backups', 'hourly + encrypted on GitHub — this panel cannot verify them, the Actions page can',
    ` <a class="btn ghost small" href="https://github.com/benmpolak/the-league/actions/workflows/backup.yml" target="_blank" rel="noopener">open</a>`));
  return `<div class="card">
    <h2>Pre-flight <span class="tag">Chairman only</span></h2>
    <p class="muted" style="font-size:11.5px;margin-bottom:8px">Eight checks before you trust a matchday to the machinery. Green means go; every light says why.</p>
    ${rows.join('')}
  </div>`;
}
function viewSettings() {
  const sc = state.settings.scoring;
  const admin = !netOn() || isCommissioner(); // only the Chairman edits league settings
  const ro = admin ? '' : 'disabled';
  return `<div class="settings-grid">
    ${admin ? preflightCard() : ''}
    <div class="card">
      <h2>Scoring rules ${admin ? '' : '<span class="tag">read-only</span>'}</h2>
      ${Object.keys(DEFAULT_SCORING).map(k => `
        <div class="score-row"><span>${SCORING_LABELS[k]}</span>
        <input type="number" step="1" data-score="${k}" value="${sc[k]}" ${ro}></div>`).join('')}
      <p class="muted" style="margin-top:10px;font-size:12px">Only your starting XI scores each gameweek. ${admin ? 'Changes apply instantly to all past and future matches.' : `Only the Chairman can change scoring.`}</p>
    </div>
    ${installCard(true)}
    ${admin ? `
    <div class="card">
      <h2>League admin</h2>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn ghost" id="demoBtn2">Demo mode — preview with fake results</button>
        <button class="btn ghost" id="exportBtn">Export league file (backup)</button>
        <label class="btn ghost" style="text-align:center;cursor:pointer">Import league file<input type="file" id="importFile" accept=".json" style="display:none"></label>
        ${!netOn() || isCommissioner() ? '<button class="btn danger" id="resetBtn">Reset everything</button>' : ''}
        ${netOn() && isCommissioner() ? '<button class="btn ghost" id="restoreBtn" title="Every reset stashes the outgoing game first — this puts the stashed one back">Restore the pre-reset game</button>' : ''}
      </div>
      <p class="muted" style="font-size:12px;margin-top:10px">Backups only — the league syncs live on its own, no files to pass around. Export drops a snapshot to your device; import restores one if it all goes wrong. Reset stashes the outgoing game first — Restore brings the stashed one back (held until the next reset overwrites it).</p>
      <h3 style="margin-top:18px">Sign-in</h3>
      <p class="muted" style="font-size:12px;margin-bottom:8px">Managers sign in with an email link — no PINs, nothing to reset. Adding or changing a manager's email is done with the provisioning script (see the README).</p>
      <h3 style="margin-top:18px">Manual point adjustments</h3>
      <p class="muted" style="font-size:12px;margin-bottom:8px">If a stat feed gets something wrong, add/subtract points per player <b>in a named gameweek</b> — the matchup, table and records all re-score.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select id="adjPlayer" style="flex:1;min-width:200px">
          <option value="">Pick a player…</option>
          ${state.managers.flatMap(m => managerSquad(m.id).map(p => `<option value="${p.id}">${esc(p.name)} (${esc(m.name)})</option>`)).join('')}
        </select>
        <select id="adjGw" style="width:90px">
          ${GAMEWEEKS.slice(0, Math.min(currentGwIndex() + 1, GAMEWEEKS.length)).map((g, i) => `<option value="${i}" ${i === Math.max(0, lastFinalGw()) ? 'selected' : ''}>GW${g.n}</option>`).join('')}
        </select>
        <input type="number" id="adjPts" placeholder="±pts" style="width:90px">
        <button class="btn small" id="adjApply">Apply</button>
      </div>
      ${Object.entries(state.adjustments).flatMap(([g, m]) => Object.entries(m || {}).filter(([, v]) => v).map(([pid, v]) =>
        `<div class="score-row"><span><span class="tag">GW${GAMEWEEKS[+g]?.n ?? '?'}</span> ${esc(PLAYER_BY_ID[pid]?.name || `#${pid}`)}</span><span class="gold">${v > 0 ? '+' : ''}${v}</span></div>`)).join('')}
    </div>` : `<div class="card"><h2>League admin <span class="tag">Chairman only</span></h2><p class="muted" style="font-size:12.5px">Scoring, resets and point adjustments are the Chairman's. Backups and demo mode live there too.</p><button class="btn ghost" id="demoBtn2" style="margin-top:10px">Demo mode — preview with fake results</button></div>`}
    <div class="card">
      <h2>The Suggestion Box <span class="tag">${toArr(state.suggestions).length}</span></h2>
      <p class="muted" style="font-size:12.5px">Feature requests from the floor. The Committee reads everything and rules on nothing quickly.</p>
      <div style="display:flex;gap:6px;margin:8px 0;flex-wrap:wrap">
        <input id="sugText" maxlength="240" placeholder="What should the game do that it doesn't?" style="flex:1;min-width:200px" ${netOn() && (!whoami || whoami === -1) ? 'disabled' : ''}>
        <button class="btn small${netOn() && (!whoami || whoami === -1) ? ' dim' : ''}" id="sugSend">${netOn() && (!whoami || whoami === -1) ? 'Sign in to suggest' : 'Submit to the Committee'}</button>
      </div>
      ${(() => {
        const sugs = [...toArr(state.suggestions)].sort((a, b) => (b.t || 0) - (a.t || 0));
        if (!sugs.length) return '<p class="muted" style="font-size:12px">The box is empty. History will record who broke the silence.</p>';
        const stTag = s => s.status === 'built' ? '<span class="tag" style="color:var(--accent)">BUILT</span>'
          : s.status === 'building' ? '<span class="tag live-tag">IN THE WORKSHOP</span>'
          : '<span class="tag">MINUTED</span>';
        return sugs.map(s => `<div class="lrow" style="font-size:12.5px;flex-wrap:wrap;gap:6px">
          ${stTag(s)} <b>${esc(s.text)}</b>
          <span class="muted" style="font-size:11px">— ${esc(managerName(s.by))}, ${fmtWhen(s.t)}</span>
          ${(!netOn() || isCommissioner()) ? `<span style="margin-left:auto;display:flex;gap:4px">
            ${s.status !== 'building' ? `<button class="btn ghost small" data-sugadm="${esc(s.id)}:building" title="The Committee is on it">Workshop</button>` : ''}
            ${s.status !== 'built' ? `<button class="btn ghost small" data-sugadm="${esc(s.id)}:built" title="It shipped">Built</button>` : ''}
            <button class="btn ghost small icon-btn" data-sugadm="${esc(s.id)}:bin" title="Minuted and ignored" aria-label="Bin">&#128465;</button>
          </span>` : ''}
        </div>`).join('');
      })()}
    </div>
    <div class="card">
      <h2>The Constitution <span class="muted" style="font-weight:400;font-size:12px">read-only, as all constitutions should be</span></h2>
      <p class="rules-p">&sect;1 The title is the playoffs. The table is for arguing.</p>
      <p class="rules-p">&sect;2 Twelve managers, £50 a head, est. 2015. The waiting list is ten years deep and moving slowly.</p>
      <p class="rules-p">&sect;3 No club cap. Tussie's right to hoard the entire City squad is constitutionally protected.</p>
      <p class="rules-p">&sect;4 Waivers run 10am Tuesday and Friday, reverse table order. The Chairman may skip a run by exception. The Trough takes the rest.</p>
      <p class="rules-p">&sect;5 New signings wait for the Window Draft. January is bottom-up, nitty-gritty nearer the time, as is tradition.</p>
      <p class="rules-p">&sect;6 Side deals belong in the Covenant Register, where they are timestamped, witnessed and mocked.</p>
      <p class="rules-p">&sect;7 The hydration break is inviolable.</p>
      <p class="rules-p muted" style="font-style:italic">Amendments require a Committee majority and will be ignored regardless. Full rules on the Rules page.</p>
    </div>
    ${SANDBOX && (!netOn() || isCommissioner()) ? `<div class="card" style="border-color:var(--gold,#d4af37)">
      <h2>Test Night — the Chairman's runbook <span class="tag">sandbox only</span></h2>
      <p class="muted" style="font-size:12.5px">The full loop, solo, no Ben required. Draft a league, play two pretend gameweeks, do the transfer business in between. Everything here is sandbox — the real league can't be touched from this site.</p>
      <ol class="rules-p" style="font-size:13px;padding-left:18px;display:grid;gap:6px;margin-top:8px">
        <li><b>Reset everything</b> (button below) — wipes the sandbox back to the waiting room. Sign-in survives, and the outgoing game is stashed: <b>Restore the pre-reset game</b> (same section) brings it back if you regret it.</li>
        <li>In the waiting room, set the draft order and <b>Start the draft</b>. Tip: drop the pick clock to 15–30s first for a fast solo draft.</li>
        <li>Sit through the ceremony (or use Ian's button). You land on the console. Alone in the room? Press <b>&#9878; Declare the room open</b> on the waiting card — pick one goes live and absent managers autopick when their clock dies.</li>
        <li>Draft. Your picks are yours; on anyone else's clock press <b>Autopick</b> — or press <b>&#9193; Skip the draft</b> on the console to autodraft the whole board in one stroke and go straight to the season.</li>
        <li>Open the Chamber below: <b>Kick off GW1</b> (20-min live matchday) or go straight to <b>Full time</b>.</li>
        <li>After full time: on the Transfers page, use the <b>acting as</b> switcher in the header to take any manager's chair — make drops, sign from the Trough, lodge waiver claims, propose and accept trades between clubs. It all lands as theirs.</li>
        <li>On the Waiver order tab, <b>Process waivers now</b> — that's Tuesday 10am happening early. Check the requests went through in reverse table order.</li>
        <li>Chamber GW2, and round again.</li>
      </ol>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        <button class="btn small" id="trGoTransfers">Open Transfers</button>
        <button class="btn ghost small" id="trCopyReport">&#128203; Copy the test report template</button>
      </div>
      <p class="muted" style="font-size:10.5px;margin-top:6px">Fill the report in as you go and paste it into the group chat — that's the feedback the Committee wants.</p>
    </div>` : ''}
    ${SANDBOX && (!netOn() || isCommissioner()) ? (() => {
      const mk = state.mock;
      const cur = currentGwIndex();
      const gw = mk?.gw ?? cur;
      const stateLine = !mk ? 'The chamber is dark. No simulation running.'
        : mk.phase === 'live' ? `GW${GAMEWEEKS[mk.gw].n} is being simulated LIVE — kickoffs are staggered like a real matchday round (the Friday game finishes while Monday's hasn't kicked off), the whole thing lands over ~20 minutes. Watch the dashboard.`
        : `GW${GAMEWEEKS[mk.gw].n} simulation is at FULL TIME — table, awards and results all count it.`;
      return `<div class="card" style="border-color:var(--gold,#d4af37)">
      <h2>The Simulation Chamber <span class="tag">sandbox only</span></h2>
      <p class="muted" style="font-size:12.5px">Pretend matchday for the real drafted squads — every device sees identical made-up stats. ${esc(stateLine)}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center">
        <select id="mockGw" style="font-size:12px">${GAMEWEEKS.slice(0, REGULAR_GWS).map((g, i) => `<option value="${i}" ${i === gw ? 'selected' : ''}>GW${g.n}</option>`).join('')}</select>
        <button class="btn small" id="mockLive">&#9654; Kick off (live)</button>
        <button class="btn small" id="mockFinal">Full time</button>
        <button class="btn ghost small" id="mockOff">Switch it off</button>
      </div>
      <p class="muted" style="font-size:10.5px;margin-top:6px">Then: drops go to waivers, lodge claims, and Run Waivers Now on the Transfers page plays the part of Tuesday 8pm. The real league has no such chamber.</p>
    </div>`;
    })() : ''}
  </div>`;
}
function bindSettings() {
  bindInstall();
  // Test Night runbook (sandbox-only, Chairman's solo test loop)
  const tgt = $('#trGoTransfers');
  if (tgt) tgt.onclick = () => { state.view = 'transfers'; transfersView.tab = 'trough'; save(); render(); };
  const tcr = $('#trCopyReport');
  if (tcr) tcr.onclick = () => {
    const txt = [
      'THE LEAGUE — SANDBOX TEST REPORT',
      `Tested by: ${whoami && whoami !== -1 ? managerName(whoami) : 'the Chairman'}`,
      '',
      'DRAFT (reset → order → start → force open → picks): OK / issues:',
      'CHAMBER GW1 (live matchday, scores, table): OK / issues:',
      'TROUGH + TRADES (acting as other managers): OK / issues:',
      'WAIVER LIST + PROCESS NOW (right winners, right order?): OK / issues:',
      'CHAMBER GW2 + second waiver round: OK / issues:',
      '',
      'Anything broken:',
      'Anything confusing:',
      'Anything DF did better:',
    ].join('\n');
    (navigator.clipboard?.writeText(txt) || Promise.reject()).then(
      () => toast('Report template copied — fill it in as you test'),
      () => { window.prompt('Copy the test report:', txt); });
  };
  // the Suggestion Box
  const ss = $('#sugSend');
  if (ss) ss.onclick = () => {
    if (netOn() && (!whoami || whoami === -1)) { toast('Sign in (top right) to make suggestions'); return; }
    const inp = $('#sugText');
    const text = (inp?.value || '').trim();
    if (!text) { toast('Say what you want built'); return; }
    if (netOn()) {
      serverAct('suggestionAdd', { text })
        .then(() => { toast('Minuted. The Committee will pretend to deliberate.'); })
        .catch(() => {});
      inp.value = '';
      return;
    }
    const by = (whoami && whoami !== -1) ? whoami : state.managers[0].id;
    state.suggestions = toArr(state.suggestions);
    state.suggestions.push({ id: `s${Date.now()}m${by}`, by, text: text.slice(0, 240), t: Date.now(), status: 'noted' });
    save(); render();
    toast('Minuted. The Committee will pretend to deliberate.');
  };
  document.querySelectorAll('[data-sugadm]').forEach(b => b.onclick = () => {
    const [id, op] = b.dataset.sugadm.split(':');
    if (netOn() && !isCommissioner()) { toast('Only the Chairman rules on the box'); return; }
    if (netOn()) { serverAct('suggestionAdmin', { id, op }).catch(() => {}); return; }
    state.suggestions = toArr(state.suggestions);
    const i = state.suggestions.findIndex(s => s.id === id);
    if (i < 0) return;
    if (op === 'bin') state.suggestions.splice(i, 1);
    else state.suggestions[i] = { ...state.suggestions[i], status: op };
    save(); render();
  });
  // the Simulation Chamber (sandbox-only; server refuses everywhere else)
  const mockAct = op => {
    const gw = +($('#mockGw')?.value ?? currentGwIndex());
    if (netOn()) {
      serverAct('mockMatchday', { op, gw })
        .then(() => { if (op === 'final') playSound('whistle'); toast(op === 'off' ? 'The chamber goes dark.' : op === 'live' ? `GW${GAMEWEEKS[gw].n} KICKS OFF — entirely imaginary, fiercely contested.` : `FULL TIME in the simulation. The results stand (in here).`); })
        .catch(() => {});
      return;
    }
    state.mock = op === 'off' ? null : { gw, phase: op, seed: (state.mock?.gw === gw ? state.mock.seed : Math.floor(Math.random() * 999983)), t: state.mock?.gw === gw && state.mock?.phase === 'live' && op === 'live' ? state.mock.t : Date.now() };
    applyMock(); save(); render();
  };
  for (const [id, op] of [['mockLive', 'live'], ['mockFinal', 'final'], ['mockOff', 'off']]) {
    const el = $('#' + id);
    if (el) el.onclick = () => mockAct(op);
  }
  document.querySelectorAll('[data-score]').forEach(inp => inp.onchange = () => {
    if (netOn() && !isCommissioner()) { toast('Only the commissioner changes scoring'); render(); return; }
    if (netOn()) {
      serverAct('settingsSet', { scoringKey: inp.dataset.score, value: +inp.value || 0 })
        .then(() => toast('Scoring updated')).catch(() => {});
      return;
    }
    state.settings.scoring[inp.dataset.score] = +inp.value || 0;
    save(); toast('Scoring updated');
  });
  const pfS = $('#pfSync'); if (pfS) pfS.onclick = () => syncNow(true);
  const demoB = $('#demoBtn2'); if (demoB) demoB.onclick = enterDemo;
  const exportB = $('#exportBtn');
  if (!exportB) return; // non-commissioner: admin controls aren't rendered
  exportB.onclick = () => {
    const out = JSON.parse(JSON.stringify(state));
    // RTDB hands a gw-keyed map back as an ARRAY when its keys are 0,1,2… and
    // the import gate requires plain objects (sol R2 P2) — canonicalise on the
    // way out so the file always round-trips
    for (const k of ['adjustments', 'claims', 'watchlists']) {
      if (Array.isArray(out[k])) out[k] = Object.fromEntries(out[k].map((v, i) => [i, v]).filter(([, v]) => v != null));
    }
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'the-league-2627.json';
    a.click();
    toast('League file downloaded');
  };
  $('#importFile').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then(txt => {
      try {
        const imported = JSON.parse(txt);
        if (!imported.managers || !imported.draft) throw new Error('bad file');
        if (!imported.lineups) { imported.lineups = {}; imported.transfers = []; }
        if (!imported.waivers) imported.waivers = {};
        // older exports carry the RTDB array shape (sol R2 P2) — canonicalise
        for (const k of ['adjustments', 'claims', 'watchlists']) {
          if (Array.isArray(imported[k])) imported[k] = Object.fromEntries(imported[k].map((v, i) => [i, v]).filter(([, v]) => v != null));
        }
        state = imported;
        save(); render();
        if (netOn() && isCommissioner()) {
          // success reads AFTER the server accepts — "League imported" used to
          // print optimistically while the publish was mid-flight or refused
          serverAct('importState', { state: sharedSnapshot() })
            .then(() => toast('League imported and published.'))
            .catch(() => {}); // serverAct toasts the server's reason
        } else toast('League imported');
      } catch { toast('That file doesn’t look like a league export'); }
    });
  };
  const rb = $('#resetBtn'); // hidden for non-commissioners online (Marc, 2 Aug:
  // a visible "Reset everything" reads as "anyone can" — server refuses anyway)
  if (rb) rb.onclick = () => {
    if (netOn() && !isCommissioner()) { toast('Only the commissioner can reset the league'); return; }
    if (confirm('Wipe the league, draft and all scores — for EVERYONE?')) {
      if (netOn()) { serverAct('resetLeague', { confirm: 'RESET' }).catch(() => {}); return; }
      state = freshState();
      localStorage.removeItem(`${LS_NS}-ceremony-seen`);
      save(); render();
    }
  };
  const rrb = $('#restoreBtn'); // the reset's regret button — puts the stashed game back
  if (rrb) rrb.onclick = async () => {
    let info;
    try { info = await serverAct('resetRestore', { peek: true }); } catch { return; } // serverAct already toasts "no game is held"
    if (!await confirmSheet({
      title: 'Restore the pre-reset game?',
      body: `<p style="font-size:13.5px">A game in its <b>${esc(info.phase)}</b> phase, stashed ${fmtWhen(info.t)} by ${esc(managerName(info.by))}, replaces EVERYTHING currently here — for every manager.</p><p class="muted" style="font-size:12px">The stash survives the restore, so a mistaken restore can simply be reset again.</p>`,
      yes: 'Bring it back',
    })) return;
    serverAct('resetRestore', { confirm: 'RESTORE' })
      .then(() => toast('The old game is back. The Committee denies it was ever gone.'))
      .catch(() => {});
  };
  $('#adjApply').onclick = () => {
    if (netOn() && !isCommissioner()) { toast('Only the commissioner adjusts points'); return; }
    const pid = +$('#adjPlayer').value, pts = +$('#adjPts').value || 0, gw = +($('#adjGw')?.value ?? -1);
    if (!pid || gw < 0) return;
    const cur = +(((state.adjustments || {})[gw] || {})[pid]) || 0;
    if (netOn()) {
      serverAct('adjustmentSet', { pid, gw, value: cur + pts })
        .then(() => toast(`Adjustment lands in GW${GAMEWEEKS[gw].n} — everything re-scores`)).catch(() => {});
      return;
    }
    (state.adjustments[gw] = state.adjustments[gw] || {})[pid] = cur + pts;
    save(); render(); toast(`Adjustment lands in GW${GAMEWEEKS[gw].n} — everything re-scores`);
  };
}

/* ---------------- player stats card ---------------- */
function showPlayerCard(pid) {
  const p = PLAYER_BY_ID[pid];
  if (!p) return;
  $('#pcardOverlay')?.remove();
  const owner = state.managers.find(m => managerSquad(m.id).some(x => x.id === pid));
  const pp = playerPoints(pid);
  const gwRows = [];
  for (let i = GAMEWEEKS.length - 1; i >= 0; i--) {
    const s = gwEvent(i)?.playerStats?.[pid];
    if (!s) continue;
    const bits = [];
    if (s.g) bits.push(`\u26bd\u00d7${s.g}`);
    if (s.a) bits.push(`A\u00d7${s.a}`);
    if (s.cs) bits.push('CS');
    if (s.ps) bits.push('pen save');
    if (s.yc) bits.push('\ud83d\udfe8');
    if (s.rc) bits.push('\ud83d\udfe5');
    if (s.og) bits.push('OG');
    gwRows.push(`<div class="score-row"><span>GW${GAMEWEEKS[i].n} <span class="muted" style="font-size:11px">${s.min || 0}&prime; ${bits.join(' ')}</span></span><b class="${gwPlayerPoints(pid, i) > 0 ? 'gold' : 'muted'}">${gwPlayerPoints(pid, i)}</b></div>`);
  }
  const ov = document.createElement('div');
  ov.id = 'pcardOverlay';
  ov.className = 'overlay';
  ov.innerHTML = `<div class="card pcard">
    <div class="pcard-head">
      <img class="pcard-photo" data-code="${p.code}" src="${PHOTO_NEW(p.code)}" alt="">
      <div>
        <h2 style="margin-bottom:2px">${esc(p.name)} <span class="pos-badge pos-${p.pos}">${p.pos}</span>${provChip(p)}</h2>
        <p class="muted" style="font-size:12px">${esc(p.full)}</p>
        <p style="font-size:13px;margin-top:4px">${flagImg(p.team)} ${esc(p.team)}</p>
        ${p.news ? `<p class="warn" style="font-size:12px;margin-top:4px">${statusChip(p)} ${esc(p.news)}</p>` : ''}
        <p class="muted" style="font-size:12px;margin-top:4px">${owner ? `Owned by <b style="color:var(--text)">${esc(teamName(owner.id))}</b>` : 'Free agent' + (state.phase === 'season' && onWaivers(p) ? ' \u2014 on waivers' : ' \u2014 in the Trough')}</p>
      </div>
      <button class="btn ghost small icon-btn" id="pcardClose" style="margin-left:auto" aria-label="Close player card">\u2715</button>
    </div>
    <div class="quota-bar" style="margin:10px 0">
      <span class="quota-pill">League pts <b class="gold">&nbsp;${pp.pts}</b></span>
      <span class="quota-pill">FPL official ${p.pts}</span>
      <span class="quota-pill" title="FPL expected points, next gameweek">xPts next ${playerXp(p).toFixed(1)}</span>
    </div>
    ${(() => {
      // Iain, GW1 eve: "see a team's fixtures when I click on a player —
      // this week should be on view but you should be able to see the rest
      // too". The run of six, coloured by how scary they are.
      const ups = (state.fixtures || []).filter(f => !fxOver(f) && (f.home === p.team || f.away === p.team)).slice(0, 6);
      if (!ups.length) return '';
      const pill = f => {
        const opp = f.home === p.team ? f.away : f.home;
        return `<span class="quota-pill">GW${f.gw} <b class="${fdrCls(opp)}">${esc(TEAM_BY_NAME[opp]?.short || opp)} (${f.home === p.team ? 'H' : 'A'})</b></span>`;
      };
      return `<div class="quota-bar" style="margin:0 0 10px">${ups.map(pill).join('')}</div>`;
    })()}
    ${(() => {
      const ls = lastSeasonOf(p);
      return ls ? `<p class="muted" style="font-size:12px;margin-bottom:8px"><b style="color:var(--text)">${LS_SEASON}:</b> ${ls.pts} FPL pts &middot; ${ls.g} G &middot; ${ls.a} A &middot; ${ls.cs} CS &middot; ${ls.ppg} per game &middot; ${Math.round((ls.mp || 0) / 90)} &times; 90s${ls.club && ls.club !== p.club ? ` <span class="muted">(at ${esc(ls.club)})</span>` : ''}</p>`
        : `<p class="muted" style="font-size:12px;margin-bottom:8px">No ${LS_SEASON} record — new to the Premier League.</p>`;
    })()}
    ${pp.lines.length ? `<p class="muted" style="font-size:12px;margin-bottom:8px">${esc(pp.lines.join(' \u00b7 '))}</p>` : ''}
    ${(() => {
      const hist = [];
      const pk = state.draft.picks.find(x => x.playerId === pid);
      if (pk) hist.push(`Drafted pick #${pk.n} by ${teamName(pk.managerId)}`);
      for (const t of state.transfers) {
        if (t.inId === pid) {
          const wf = transferWindowFacts(t, 6) || transferWindowFacts(t, 3);
          hist.push(`GW${GAMEWEEKS[t.gw].n}: ${t.trade ? 'traded to' : t.waiver ? 'taken on waivers by' : 'signed from the Trough by'} ${teamName(t.managerId)}${wf ? ` — the report card reads ${transferVerdict(wf, wf.gws.length)} (${wf.diff >= 0 ? '+' : ''}${wf.diff} over ${wf.gws.length})` : ''}`);
        }
        else if (t.outId === pid && !t.trade) hist.push(`GW${GAMEWEEKS[t.gw].n}: dropped by ${teamName(t.managerId)}`);
      }
      return hist.length ? `<p class="muted" style="font-size:11.5px;margin-bottom:8px"><b style="color:var(--text)">History:</b> ${hist.map(esc).join(' \u00b7 ')}</p>` : '';
    })()}
    <div style="max-height:260px;overflow-y:auto">${gwRows.join('') || '<p class="muted" style="font-size:12px">No gameweek data yet this season.</p>'}</div>
    <div id="pcardActions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"></div>
  </div>`;
  ov.onclick = e => { if (e.target === ov || e.target.id === 'pcardClose') closeOv(ov); };
  document.body.appendChild(ov);
  pushOvState(); // phone back button closes the card, not the site
  recordRecentPcard(pid); // feeds the search palette's "recently viewed"
  // context actions — the card is a place to DO things, not just read them
  const acts = ov.querySelector('#pcardActions');
  const btn = (label, fn, ghost = false) => {
    const b = document.createElement('button');
    b.className = `btn small${ghost ? ' ghost' : ''}`;
    b.innerHTML = label;
    // a card action that navigates must also clear the search palette the card
    // may be stacked on — otherwise it floats over the destination view
    b.onclick = e => { e.stopPropagation(); document.getElementById('searchOverlay')?.remove(); fn(); };
    acts.appendChild(b);
  };
  const iAmManager = whoami && whoami !== -1;
  btn(scoutCompare.includes(pid) ? '&#10003; Remove from comparison' : 'Compare player', () => toggleScoutCompare(pid), true);
  if (state.phase === 'draft' && !draftedIds().has(pid)) {
    const myTurn = currentManagerId() != null && canActFor(currentManagerId()) && canPick(currentManagerId(), p);
    if (myTurn) btn('Draft him', async () => {
      // same confirm the pool table gets — this path had none at all
      if (!await confirmSheet({
        title: `Pick #${pickNo() + 1}`,
        body: dealRows([], [p]),
        yes: `Draft ${esc(p.name)}`,
        note: 'Instant — and only the Chairman can undo it.',
      })) return;
      ov.remove(); makePick(pid);
    });
    if (iAmManager && !toArr(state.autolists?.[whoami]).includes(pid)) {
      btn('&#9734; Add to autopick list', () => { setAutolist(whoami, [...toArr(state.autolists?.[whoami]), pid]); ov.remove(); toast(`${p.name} added to your list`); }, true);
    }
  }
  if (state.phase === 'season' && iAmManager) {
    if (!owner) {
      btn(onWaivers(p) ? 'Claim in Transfers' : 'Sign in Transfers', () => {
        ov.remove();
        window._troughFocus = p.name;
        transfersView.tab = 'trough'; state.view = 'transfers'; save(); render();
      });
    } else if (owner.id !== whoami) {
      btn('Propose a trade', () => {
        ov.remove();
        window._tradeFocus = { other: owner.id, get: pid };
        transfersView.tab = 'trades'; state.view = 'transfers'; save(); render();
      });
    } else {
      const listed = blockList(whoami).includes(pid);
      btn(listed ? 'Take off the transfer list' : '&#128276; Put on the transfer list', () => {
        ov.remove();
        toggleBlock(whoami, pid);
        toast(listed ? `${p.name} quietly delisted.` : `${p.name} is on the transfer list. Offers invited.`);
      }, true);
    }
    // from your own pitch view: start a swap from the card, finish it with a tap
    if (owner && state.view === 'team' && owner.id === teamView.mid && canActFor(owner.id) && (demoMode || !gwHasStarted(teamView.gw))) {
      btn('&#8646; Swap / move him', () => {
        ov.remove();
        teamView.pitchSel = pid;
        render();
        toast('Now tap the teammate to swap with');
      }, true);
    }
  }
}
// Compare buttons are dynamic across the draft pool, Trough and global search.
// Capture them before their enclosing player row opens the normal stats card.
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-compare]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  toggleScoutCompare(+b.dataset.compare);
}, true);
// any player photo/kit anywhere opens the card (capture phase beats row handlers)
document.addEventListener('click', e => {
  const t = e.target.closest?.('[data-pcard]');
  if (!t) return;
  // search-result action buttons sit inside a data-pcard row — their click is
  // a navigation, not a card-open; let the palette's own handler take it
  if (e.target.closest?.('[data-gsact], [data-compare]')) return;
  // mid-swap on your own pitch: the tap completes the swap instead of opening the card
  if (state.view === 'team' && teamView.pitchSel != null && e.target.closest?.('[data-pitch]')) return;
  e.preventDefault();
  e.stopPropagation();
  showPlayerCard(+t.dataset.pcard);
}, true);

/* ---------------- global player search ----------------
   One box, every player, from anywhere: header 🔍, Cmd/Ctrl+K, or "/".
   Read-only by design — it deep-links into the views where things happen;
   nothing here signs, claims or trades anyone. */
const RECENT_PCARD_KEY = `${LS_NS}-recent-pcards`;
function recentPcards() {
  try { return (JSON.parse(localStorage.getItem(RECENT_PCARD_KEY)) || []).filter(id => PLAYER_BY_ID[id]); } catch { return []; }
}
function recordRecentPcard(pid) {
  try {
    localStorage.setItem(RECENT_PCARD_KEY, JSON.stringify([pid, ...recentPcards().filter(x => x !== pid)].slice(0, 8)));
  } catch { /* storage full — the search just gets less nostalgic */ }
}
let _gsIndex = null;
function gsIndex() {
  if (!_gsIndex) _gsIndex = PLAYERS.map(p => ({
    p,
    name: normName(p.name),
    full: normName(p.full || ''),
    hay: [p.name, p.full || '', p.club, p.team, TEAM_BY_NAME[p.team]?.short || '', p.pos, natOf(p)?.[0] || ''].map(normName).join(' '),
  }));
  return _gsIndex;
}
// exact name first, then name-prefix, then anything that mentions every word
function gsMatches(query) {
  const q = normName(query);
  if (!q) return [];
  const toks = q.split(' ');
  const ranked = [];
  for (const e of gsIndex()) {
    const rank = (e.name === q || e.full === q) ? 0
      : (e.name.startsWith(q) || e.full.startsWith(q)) ? 1
      : toks.every(t => e.hay.includes(t)) ? 2 : -1;
    if (rank >= 0) ranked.push({ e, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || metricsFor(b.e.p).pts - metricsFor(a.e.p).pts)
    .slice(0, 12).map(r => r.e.p);
}
function gsRowsHtml(players, ownerOf) {
  const cur = currentGwIndex();
  const iAm = whoami && whoami !== -1;
  return players.map(p => {
    const ownerMid = ownerOf[p.id];
    const ownLabel = ownerMid
      ? `Owned by <b>${esc(teamName(ownerMid))}</b>`
      : isArrival(p) ? '<span class="muted">&#128274; new arrival — locked until the Window Draft</span>'
      : state.phase === 'season' && onWaivers(p) ? '<span class="muted">on waivers</span>'
      : '<span class="muted">free agent</span>';
    const act = ownerMid && iAm && ownerMid === whoami
      ? `<button class="btn small ghost" data-gsact="team" data-gsp="${p.id}">View in My Team</button>`
      : ownerMid
        ? `<button class="btn small ghost" data-gsact="owner" data-gsp="${p.id}" data-gsmid="${ownerMid}">View owner</button>${state.phase === 'season' && iAm ? `<button class="btn small ghost" data-gsact="trade" data-gsp="${p.id}" data-gsmid="${ownerMid}">Trade desk</button>` : ''}`
        : state.phase === 'season' ? `<button class="btn small ghost" data-gsact="trough" data-gsp="${p.id}">Open in Transfers</button>` : '';
    return `<div class="gs-row" data-pcard="${p.id}" role="button" tabindex="0">
      ${photoImg(p)}
      <div class="gs-main">
        <span class="gs-name"><span class="gs-nm">${esc(playerDisplayName(p))}</span> ${natFlag(p)} ${statusChip(p)}</span>
        <span class="gs-sub muted">${esc(p.club)} &middot; <span class="pos-badge pos-${p.pos}">${p.pos}</span></span>
        <span class="gs-sub">${ownLabel}</span>
      </div>
      <div class="gs-stats">
        <span><b class="gold">${metricsFor(p).pts}</b> <span class="muted">pts</span></span>
        <span class="muted" title="FPL expected points, next gameweek">x${playerXp(p).toFixed(1)}</span>
        <span>${nextOppHtml(p.team, GAMEWEEKS[cur]?.n)}</span>
      </div>
      <div class="gs-act">${compareButtonHtml(p.id)}${act}</div>
    </div>`;
  }).join('');
}
function openPlayerSearch() {
  if (document.getElementById('searchOverlay')) return;
  const ov = document.createElement('div');
  ov.id = 'searchOverlay';
  ov.className = 'overlay';
  ov.innerHTML = `<div class="card search-pal" role="dialog" aria-modal="true" aria-label="Player search">
    <div class="gs-head">
      <input type="text" id="gsq" placeholder="Search ${PLAYERS.length} players — name, club, position…" aria-label="Search players" autocomplete="off">
      <button class="btn ghost small" id="gsClear" aria-label="Clear search">Clear</button>
      <button class="btn ghost small icon-btn" id="gsClose" aria-label="Close search">&#10005;</button>
    </div>
    <div id="gsResults"></div>
  </div>`;
  document.body.appendChild(ov);
  pushOvState();
  const prevFocus = document.activeElement;
  const origRemove = ov.remove.bind(ov);
  ov.remove = () => { origRemove(); if (prevFocus && document.contains(prevFocus)) try { prevFocus.focus(); } catch { /* gone */ } };
  const q = ov.querySelector('#gsq'), results = ov.querySelector('#gsResults');
  const ownerOf = {};
  for (const mg of state.managers) for (const sp of managerSquad(mg.id)) ownerOf[sp.id] = mg.id;
  const paint = () => {
    const query = q.value.trim();
    if (!query) {
      const recents = recentPcards();
      results.innerHTML = recents.length
        ? `<p class="gs-hint muted">Recently viewed</p>${gsRowsHtml(recents.map(id => PLAYER_BY_ID[id]), ownerOf)}`
        : '<p class="gs-hint muted">Type a player, club or position — accents and dots optional. The whole league is in here.</p>';
      return;
    }
    const hits = gsMatches(query);
    results.innerHTML = hits.length
      ? gsRowsHtml(hits, ownerOf)
      : '<p class="gs-hint muted">No one matches. Try a surname, a club, or a position (GK/DF/MF/FW).</p>';
  };
  q.oninput = paint;
  paint();
  q.focus();
  ov.querySelector('#gsClear').onclick = () => { q.value = ''; paint(); q.focus(); };
  ov.querySelector('#gsClose').onclick = () => closeOv(ov);
  ov.onclick = e => { if (e.target === ov) closeOv(ov); };
  // context actions deep-link and get out of the way — actual signings,
  // claims and trades stay behind their own confirms in their own views
  results.addEventListener('click', e => {
    const b = e.target.closest('[data-gsact]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const pid = +b.dataset.gsp;
    const goto = (view, fn) => { closeOv(ov); fn?.(); state.view = view; save(); render(); };
    if (b.dataset.gsact === 'team') goto('team', () => { teamView.mid = whoami; });
    else if (b.dataset.gsact === 'owner') goto('team', () => { teamView.mid = +b.dataset.gsmid; });
    else if (b.dataset.gsact === 'trough') goto('transfers', () => { window._troughFocus = PLAYER_BY_ID[pid].name; transfersView.tab = 'trough'; });
    else if (b.dataset.gsact === 'trade') goto('transfers', () => { window._tradeFocus = { other: +b.dataset.gsmid, get: pid }; transfersView.tab = 'trades'; });
  }, true);
  // rows are keyboard-real: Enter/Space opens the card like a tap would
  results.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.gs-row');
    if (row) { e.preventDefault(); showPlayerCard(+row.dataset.pcard); }
  });
  // focus stays inside the palette while it's the top layer
  ov.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || document.getElementById('pcardOverlay')) return;
    const focusables = [...ov.querySelectorAll('input, button, [tabindex="0"]')].filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}
// the shortcuts: Cmd/Ctrl+K toggles, "/" opens (never from inside a field),
// Escape peels the top layer — card first, then the palette
document.addEventListener('keydown', e => {
  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    const ov = document.getElementById('searchOverlay');
    ov ? closeOv(ov) : openPlayerSearch();
    return;
  }
  const t = e.target;
  const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (e.key === '/' && !inField && !document.getElementById('searchOverlay')) {
    e.preventDefault();
    openPlayerSearch();
    return;
  }
  if (e.key === 'Escape') {
    const ov = document.getElementById('searchOverlay');
    if (!ov) return;
    e.preventDefault();
    closeOv(document.getElementById('pcardOverlay') || ov);
  }
});

/* ---------------- boot ---------------- */
// keep the commissioner's screen awake through the draft so the deadline
// autopick keeps firing (phones suspend timers on a locked screen). If the
// browser refuses, the on-clock manager's fallback autopick covers it.
let _wakeLock = null;
async function manageWakeLock() {
  try {
    if (state.phase === 'draft' && !document.hidden && 'wakeLock' in navigator && !_wakeLock) {
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    } else if ((state.phase !== 'draft' || document.hidden) && _wakeLock) {
      await _wakeLock.release(); _wakeLock = null;
    }
  } catch { /* unsupported/denied — fallback autopick handles it */ }
}
// reopening a backgrounded phone must refresh: pull fresh scores on matchday,
// re-arm the wake lock, and reconcile any league change that landed while away
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  manageWakeLock();
  if (state.phase === 'season' && netOn()) syncNow(false);
  if (_snapSeen && netOn() && !demoMode) applySharedSnapshot(_snapLatest);
});

// a #hash deep-link opens straight onto that page; otherwise the app always
// opens at home — the Dashboard — not wherever it was left last time
{
  const v0 = location.hash.slice(1);
  if (state.phase !== 'setup' && NAV_ITEMS.some(([k]) => k === v0)) state.view = v0;
  else if (state.phase === 'setup' && SETUP_NAV.has(v0)) state.view = v0;
  else if (state.phase === 'setup') state.view = 'dash'; // the waiting room is home
  else if (state.phase === 'season') state.view = 'dash';
  else if (state.phase === 'draft') state.view = 'draft'; // a live draft opens on the console, never the dashboard (Toby, sandbox)
}
render();
manageWakeLock();
// stale save detected at load: offer recovery rather than a subtly-broken game
if (staleSave) showStaleBar();
// local mode: a refresh mid-ceremony replays the pomp, exactly like the online
// snapshot path — otherwise the reload skips straight to a live clock (sol r5)
if (!netOn() && state.phase === 'draft') {
  const bootCer = ceremonyKey();
  if (bootCer && localStorage.getItem(`${LS_NS}-ceremony-seen`) !== bootCer) showCeremony();
}
// ?demo drops visitors straight into the demo season
if (new URLSearchParams(location.search).has('demo')) enterDemo();
// commissioner devices run overdue scheduled waivers automatically — but only
// once the cloud has loaded (never on stale boot state) AND the stats feed is
// fresh, or waiverOrder would fall back to reverse-draft order and resolve
// every claim with the wrong priority
function tryAutoWaivers(attempt = 0) {
  // online, the scheduled Cloud Function owns waiver runs — no device fires them
  if (netOn()) return;
  if (!(syncOn() && isCommissioner() && waiverRunDue())) return;
  const statsFresh = state.lastSync && (Date.now() - new Date(state.lastSync).getTime()) < 20 * 60 * 1000
    && Object.keys(state.matchStats || {}).length > 0;
  if (statsFresh) { processWaivers(false); return; }
  if (attempt < 6) setTimeout(() => tryAutoWaivers(attempt + 1), 5000); // wait for the feed
}
setTimeout(() => tryAutoWaivers(), 4000);
// auto-sync on load during the tournament (max once per 20 min, always if live,
// and always when stats aren't in memory — saves no longer persist them)
if (state.phase === 'season') {
  const stale = !state.lastSync || (Date.now() - new Date(state.lastSync).getTime()) > 20 * 60 * 1000;
  // truncated fixtures (a device with only the current round in memory —
  // laptops on UAT night showed dashes for every future gameweek) count as
  // needing a sync too
  const nextI = Math.min(currentGwIndex() + 1, GAMEWEEKS.length - 1);
  const fxShort = !state.fixtures?.length || !state.fixtures.some(f => f.gw === GAMEWEEKS[nextI].n);
  if (stale || anyMatchLive() || fxShort || !Object.keys(state.matchStats || {}).length) syncNow(false);
} else if (!state.fixtures?.length) {
  // setup + draft: the scouting floor's Vs column and the draft room's
  // fixture bits need the schedule too, and saves never persist it — without
  // this the pre-season console showed a fixture section with nothing in it
  syncNow(false);
}
// stale-build watchdog: long-lived tabs and home-screen installs reload
// themselves when a new version ships (never mid-draft — draft night is sacred)
let appBuildTag = null;
async function checkBuild() {
  try {
    const r = await fetch('js/app.js', { method: 'HEAD', cache: 'no-store' });
    const tag = r.headers.get('etag') || r.headers.get('last-modified');
    if (!tag) return;
    if (appBuildTag === null) { appBuildTag = tag; return; }
    if (tag !== appBuildTag && state.phase !== 'draft' && !document.querySelector('.overlay')) {
      toast('New club shop stock — updating…');
      setTimeout(() => location.reload(), 1500);
    }
  } catch { /* offline — try again next cycle */ }
}
checkBuild();
setInterval(checkBuild, 10 * 60 * 1000);

// Cache the app shell for flaky draft-night Wi-Fi. Live league writes still go
// straight to Firebase; the worker only makes the interface itself resilient.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('[sw]', e));
  });
}
