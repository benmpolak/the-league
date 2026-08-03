/* ================= The League — 2026/27 ================= */
'use strict';

// ?sandbox → practice league: own Firebase node (see sync.js) + own device storage,
// so testing never touches the real league's cloud state or this phone's saved identity
const SANDBOX = new URLSearchParams(location.search).has('sandbox');
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
  for (const pk of arr(s.draft?.picks)) if (pk?.playerId && !PLAYER_BY_ID[pk.playerId]) need.add(pk.playerId);
  for (const t of arr(s.transfers)) for (const id of [t?.inId, t?.outId]) if (id && !PLAYER_BY_ID[id]) need.add(id);
  for (const id of need) {
    PLAYER_BY_ID[id] = { id, code: 0, name: `#${id} (unknown)`, full: 'Unknown player — feed changed', team: '', club: '???', pos: 'MF', status: 'a', news: '', newsAdded: '', chance: null, price: 0, pts: 0, rating: 0, xp: 0, ppg: 0, mp: 0, g: 0, a: 0, cs: 0, xg: 0, xa: 0 };
  }
  return need.size > 0;
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
const ratingRank = r => PLAYERS.filter(x => (x.rating ?? 0) > r).length;

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
  penMiss: -2,
  yellow: -1,
  red: -3,
  ownGoal: -2,
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
const gwHasStarted = i => Date.now() > new Date(gwFrom(i)).getTime();
// which gameweek a transfer takes effect in: NEVER the one already being
// played. A Tuesday waiver run happens inside the just-finished GW's window,
// so its signings must count for the NEXT gameweek, or they'd retroactively
// rescore a settled result (the worst bug a 12-year league could have).
const transferGw = () => {
  const c = currentGwIndex();
  let g = c + (gwHasStarted(c) ? 1 : 0);
  // a Simulation Chamber matchday counts as "being played" — deals land next GW
  const mk = state.mock;
  if (mk && mk.gw != null && GAMEWEEKS[mk.gw]
    && (mk.phase === 'live' || (mk.phase === 'final' && lastWaiverRun() < hamTs(mk.t)))) g = Math.max(g, mk.gw + 1);
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
let whoami = +localStorage.getItem(WHO_KEY) || null; // manager id, -1 = spectator
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
let spectating = localStorage.getItem(SPECT_KEY) === '1';
function syncIdentity() {
  if (!netOn()) return;
  whoami = membership ? membership.managerId : (spectating ? -1 : null);
}
const isCommissioner = () => netOn() ? membership?.role === 'commissioner' : whoami === state.managers[0]?.id;
// the one write path when online: a server-side mutation. The authoritative
// result comes back via the snapshot listener; errors surface as toasts.
// Callable mutations do NOT queue offline — while disconnected the game is
// read-only and every attempt fails immediately with a reconnect message.
// One in-flight request per action: no double submissions from double taps.
const _actPending = new Set();
function serverAct(action, data = {}) {
  const refuse = msg => {
    toast(msg);
    const p = Promise.reject(new Error(msg));
    p.catch(() => {}); // pre-handled: call sites may not attach their own catch
    return p;
  };
  if (netOn() && !syncConnected) return refuse('You’re offline — the league is read-only until you reconnect.');
  if (_actPending.has(action)) return refuse('Still sending the last one — give it a second.');
  _actPending.add(action);
  return window.WCSync.call(action, data)
    .catch(e => { toast(e.message || 'The Committee refused that one.'); throw e; })
    .finally(() => _actPending.delete(action));
}
const canActFor = mid => demoMode || !syncOn() || whoami === mid || isCommissioner();
// use for actions: blocks other managers, and makes the commissioner explicitly
// confirm before touching a team that isn't theirs (no more accidents)
function actGuard(mid, what = 'team') {
  if (!canActFor(mid)) { toast(`That's ${managerName(mid)}'s ${what}, not yours`); return false; }
  if (netOn() && !demoMode && whoami !== mid && isCommissioner()) {
    return confirm(`COMMISSIONER OVERRIDE — you are changing ${managerName(mid)}'s ${what}, not your own. Proceed?`);
  }
  return true;
}

// pins are gone — identity is real sign-in now. claims/autolists stay in local
// state but arrive via the OWNER's private node online (blind to everyone else).
const SHARED_KEYS = ['phase', 'managers', 'settings', 'draft', 'lineups', 'transfers', 'trades', 'covenants', 'claims', 'waiverMeta', 'autolists', 'adjustments', 'shirtNums', 'draftPool', 'windowDraft', 'tradeBlock', 'benchOrders', 'lobus', 'hamCup', 'ready', 'mock', 'heckles'];
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
  data.draft.paused = !!data.draft.paused;
  // first sight of a fresh draft on this device → roll the opening ceremony
  const fresh = data.phase === 'draft' && data.draft.picks.length === 0;
  data.transfers = toArr(data.transfers);
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
  data.adjustments = data.adjustments || {};
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
  for (const k of SHARED_KEYS) {
    // online, claims/autolists never travel in the public snapshot — they are
    // per-owner private data fed by onPrivateSnapshot. Keep the local copy.
    if (netOn() && (k === 'claims' || k === 'autolists')) continue;
    state[k] = data[k] !== undefined ? data[k] : defaults[k];
  }
  if (!state.settings.posMin) state.settings.posMin = { GK: 1, DF: 3, MF: 3, FW: 1 };
  if (!state.settings.posMax) state.settings.posMax = { GK: 2, DF: 6, MF: 6, FW: 4 };
  save(); render();
  const cerKey = state.phase === 'draft' ? ceremonyKey() : '';
  if (fresh && cerKey && localStorage.getItem(`${LS_NS}-ceremony-seen`) !== cerKey) {
    showCeremony(); // stamps "seen" itself, at the END — never at open
  }
};
window.onSyncConnection = up => { syncConnected = up; renderSyncArea(); if (document.getElementById('whoOverlay')) renderIdentity(); };
// a failed private/membership read updates the open identity card's tech line
window.onSyncReadError = () => { if (document.getElementById('whoOverlay')) renderIdentity(); };

/* ----- auth + private data (v2) ----- */
let _pendingPrivate;
function applyPrivateNode(node) {
  const mid = membership?.managerId;
  if (mid == null) return;
  state.autolists = { ...state.autolists, [mid]: toArr(node?.autolist) };
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
  membership = m || null;
  syncIdentity();
  if (membership && _pendingPrivate !== undefined) { applyPrivateNode(_pendingPrivate); _pendingPrivate = undefined; }
  render();
};
window.onAuthChanged = u => {
  authUser = u;
  if (!u) { membership = null; _pendingPrivate = undefined; }
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
      squadSize: 14,
      posMin: { GK: 1, DF: 3, MF: 3, FW: 1 }, // flex squads: any 14 inside these bounds
      posMax: { GK: 2, DF: 6, MF: 6, FW: 4 },
      pickTimer: 30,
      scoring: { ...DEFAULT_SCORING },
    },
    draft: { order: [], picks: [], breaksDone: [], timewastes: {}, paused: false, pausedLeft: 0 },
    autolists: {},         // managerId -> [pid] ranked personal autopick list / shortlist
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
    localStorage.setItem(LS_KEY, JSON.stringify({ ...state, matchStats: {}, fixtures: [] }));
  } catch (e) { console.warn('[save]', e); }
}
// last season's FPL points (falls back to price until the new season's data rolls in)
const rating = p => p.rating || lastSeasonOf(p)?.pts || 0;

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
    s.draft.picks.push({ managerId: mid, playerId: p.id, n: n + 1 });
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
let vidiStash = null;
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
  // a live-looking Vidiprinter tape from real drafted names (memory only —
  // the device's real tape is stashed and restored on exit)
  const dsq = mid => state.draft.picks.filter(pk => pk.managerId === mid).map(pk => PLAYER_BY_ID[pk.playerId]);
  const dfw = mid => dsq(mid).find(p => p.pos === 'FW') || dsq(mid)[0];
  const ddf = mid => dsq(mid).find(p => p.pos === 'DF') || dsq(mid)[0];
  vidiStash = vidiFeed;
  vidiFeed = [
    { txt: `⚽ 2 GOALS · 🅰️ assist — ${dfw(8).name} (${dfw(8).club}) — ${teamName(8)} +13 (13!!)` },
    { txt: `🚨📯 LOBUS KLAXON 📯🚨 ${dfw(8).name} — the declared Lobus of ${teamName(8)} — has SCORED. Great feet for a big man.` },
    { txt: `⚽ GOAL — ${dfw(5).name} (${dfw(5).club}) — ${teamName(5)} +5` },
    { txt: `🟥 RED CARD — ${ddf(3).name} (${ddf(3).club}) — ${teamName(3)} -3` },
    { txt: `🟨 booked — ${ddf(1).name} (${ddf(1).club}) — ${teamName(1)} -1` },
    { txt: `⚽ GOAL — ${dfw(12).name} (${dfw(12).club}) — benched by ${teamName(12)} (!)` },
  ].map((x, i) => ({ ts: Date.now() - (i + 2) * 7 * 60 * 1000, gw: 1, ...x }));
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
  if (vidiStash !== null) { vidiFeed = vidiStash; vidiStash = null; }
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
    if (s && !s.trades) s.trades = [];
    if (s && s.pins) delete s.pins; // PINs retired — real sign-in now
    if (s && !s.covenants) s.covenants = [];
    if (s && !s.waiverMeta) s.waiverMeta = { lastRun: null, control: 'auto' };
    if (s && !s.shirtNums) s.shirtNums = {};
    if (s && s.draftPool === undefined) s.draftPool = null;
    if (s && s.windowDraft === undefined) s.windowDraft = null;
    if (s && !s.tradeBlock) s.tradeBlock = {};
    if (s && !s.heckles) s.heckles = {};
    if (s && !s.benchOrders) s.benchOrders = {};
    if (s && !s.lobus) s.lobus = {};
    if (s && !s.ready) s.ready = {};
    if (s && s.hamCup === undefined) s.hamCup = null;
    if (s && s.mock === undefined) s.mock = null;
    if (s && s.settings.pickTimer == null) s.settings.pickTimer = 30;
    if (s && !s.settings.posMin) s.settings.posMin = { GK: 1, DF: 3, MF: 3, FW: 1 };
    if (s && !s.settings.posMax) s.settings.posMax = { GK: 2, DF: 6, MF: 6, FW: 4 };
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
const PHOTO_NEW = code => `https://resources.premierleague.com/premierleague25/photos/players/110x140/${code}.png`;
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
   no flag, no fuss. Northern Ireland has no Unicode flag; the Union flag
   stands in with the right name on the tooltip. */
const NATIONS = {
  2: ['Albania', '🇦🇱'], 3: ['Algeria', '🇩🇿'], 10: ['Argentina', '🇦🇷'], 13: ['Australia', '🇦🇺'],
  14: ['Austria', '🇦🇹'], 21: ['Belgium', '🇧🇪'], 27: ['Bosnia & Herzegovina', '🇧🇦'], 30: ['Brazil', '🇧🇷'],
  34: ['Bulgaria', '🇧🇬'], 35: ['Burkina Faso', '🇧🇫'], 38: ['Cameroon', '🇨🇲'], 39: ['Canada', '🇨🇦'],
  44: ['Chile', '🇨🇱'], 48: ['Colombia', '🇨🇴'], 50: ['DR Congo', '🇨🇩'], 54: ['Ivory Coast', '🇨🇮'],
  57: ['Czechia', '🇨🇿'], 58: ['Denmark', '🇩🇰'], 62: ['Ecuador', '🇪🇨'], 63: ['Egypt', '🇪🇬'],
  73: ['France', '🇫🇷'], 78: ['Gambia', '🇬🇲'], 79: ['Georgia', '🇬🇪'], 80: ['Germany', '🇩🇪'],
  81: ['Ghana', '🇬🇭'], 83: ['Greece', '🇬🇷'], 90: ['Guinea-Bissau', '🇬🇼'], 92: ['Haiti', '🇭🇹'],
  97: ['Croatia', '🇭🇷'], 98: ['Hungary', '🇭🇺'], 99: ['Iceland', '🇮🇸'], 103: ['Iraq', '🇮🇶'],
  104: ['Ireland', '🇮🇪'], 106: ['Italy', '🇮🇹'], 107: ['Jamaica', '🇯🇲'], 108: ['Japan', '🇯🇵'],
  114: ['South Korea', '🇰🇷'], 132: ['Mali', '🇲🇱'], 139: ['Mexico', '🇲🇽'], 145: ['Morocco', '🇲🇦'],
  146: ['Mozambique', '🇲🇿'], 152: ['Netherlands', '🇳🇱'], 154: ['New Zealand', '🇳🇿'], 157: ['Nigeria', '🇳🇬'],
  161: ['Norway', '🇳🇴'], 168: ['Paraguay', '🇵🇾'], 172: ['Poland', '🇵🇱'], 173: ['Portugal', '🇵🇹'],
  189: ['Senegal', '🇸🇳'], 190: ['Serbia', '🇷🇸'], 194: ['Slovakia', '🇸🇰'], 195: ['Slovenia', '🇸🇮'],
  200: ['Spain', '🇪🇸'], 203: ['Suriname', '🇸🇷'], 206: ['Sweden', '🇸🇪'], 207: ['Switzerland', '🇨🇭'],
  217: ['Trinidad & Tobago', '🇹🇹'], 219: ['Türkiye', '🇹🇷'], 225: ['Ukraine', '🇺🇦'], 229: ['USA', '🇺🇸'],
  230: ['Uruguay', '🇺🇾'], 231: ['Uzbekistan', '🇺🇿'],
  241: ['England', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'], 242: ['Northern Ireland', '🇬🇧'], 243: ['Scotland', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'], 244: ['Wales', '🏴󠁧󠁢󠁷󠁬󠁳󠁿'],
};
const natOf = p => NATIONS[p.nat] || null;
const natFlag = p => {
  const n = natOf(p);
  return n ? `<span class="nat-flag" title="${esc(n[0])}">${n[1]}</span>` : '';
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
// coloured fixture chip for the pitch views
function nextOppHtml(club, gwN) {
  const f = state.fixtures.find(f => f.gw === gwN && (f.home === club || f.away === club));
  if (!f) return '—';
  const opp = f.home === club ? f.away : f.home;
  return `<span class="${fdrCls(opp)}">${esc(`${TEAM_BY_NAME[opp]?.short || opp} (${f.home === club ? 'H' : 'A'})`)}</span>`;
}
// clickable player name — opens the stats card, usable in any text row
const pname = p => p ? `<span class="plink" data-pcard="${p.id}">${esc(p.name)}</span>` : '?';
// expected points next gameweek: FPL's own projection, then points-per-game, then a guess
/* Projections in OUR currency (Marc, mock night: "Garner projected top MF" —
   FPL's carried-forward ppg pays bonus + defensive-contribution points this
   league doesn't score). Rebuild expected points from raw stats under league
   scoring; once real gameweeks exist, blend toward the live league ppg. */
function leagueArchivePpg(p) {
  const sc = (state.settings && state.settings.scoring) || DEFAULT_SCORING;
  const ls = lastSeasonOf(p);
  const src = ls && ls.mp ? ls : (!FPL_WIPED && p.mp ? { mp: p.mp, g: p.g || 0, a: p.a || 0, cs: p.cs || 0 } : null);
  if (!src) return 0;
  const apps = src.mp / 90;
  if (apps < 3) return 0; // too small a sample to call a projection
  const csPts = p.pos === 'GK' || p.pos === 'DF' ? (sc.cleanSheet ?? 4) : p.pos === 'MF' ? (sc.cleanSheetMF ?? 1) : 0;
  const pts = apps * ((sc.appearanceStart ?? 2) * 0.85) // some of those apps were sub outings
    + src.g * (sc['goal' + p.pos] ?? 4) + src.a * (sc.assist ?? 3) + (src.cs || 0) * csPts
    + (p.pos === 'GK' ? apps * 0.5 : 0)                  // save/pen-save points, roughly
    - (p.pos === 'GK' || p.pos === 'DF' ? apps * 0.55 : 0); // goals-conceded drag, roughly
  return Math.max(0.5, pts / apps);
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
const projectedGwScore = (mid, gwIdx) =>
  Math.round(lineupFor(mid, gwIdx).reduce((t, pid) => t + playerXp(PLAYER_BY_ID[pid]), 0));
// waiver/deadline times shown in the reader's OWN timezone — a UK league does
// the BST maths wrong when the app insists on UTC
const fmtWhen = d => new Date(d).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
// win chance from the projected-score gap (logistic; ~12-point gap ≈ 70%)
const winChance = (sa, sb) => 1 / (1 + Math.pow(10, -(sa - sb) / 25));

/* ----- live win probability -----
   Each player still to play contributes expected points plus uncertainty;
   as fixtures run, uncertainty drains and banked points take over.
   Even teams before kickoff = exactly 50:50; final whistle = 100:0. */
const PLAYER_SD = 4; // one player's gameweek points spread
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
  const fracs = fx.map(f => f.finished ? 0 : f.started ? Math.max(0, (90 - Math.min(90, f.minutes || 0)) / 90) : 1);
  const frac = fracs.reduce((a, b) => a + b, 0) / fx.length;
  const st = fracs.every(fr => fr === 0) ? 'done'
    : fx.some(f => f.started && !f.finished) ? 'live'
    : fracs.every(fr => fr === 1) ? 'pre' : 'mixed';
  return { st, frac, fx };
}
function teamOutlook(mid, i) {
  const gwN = GAMEWEEKS[i].n;
  let exp = 0, varsum = 0, toPlay = 0;
  for (const pid of effectiveXI(mid, i).xi) {
    const p = PLAYER_BY_ID[pid];
    const cur = gwPlayerPoints(pid, i);
    const fs = playerFixtureState(p, gwN);
    exp += cur + playerXp(p) * fs.frac;
    varsum += PLAYER_SD * PLAYER_SD * fs.frac;
    if (fs.frac > 0) toPlay++;
  }
  return { exp, varsum, toPlay };
}
function liveWinProb(a, b, i) {
  const A = teamOutlook(a, i), B = teamOutlook(b, i);
  const diff = A.exp - B.exp;
  const sigma = Math.sqrt(A.varsum + B.varsum);
  if (sigma < 0.5) return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
  const z = diff / sigma;
  // Φ(z), Abramowitz–Stegun
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  let p = d * t * (0.3194815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  p = z > 0 ? 1 - p : p;
  // never claim certainty while either side still has football to play
  if (A.toPlay + B.toPlay > 0) p = Math.min(0.99, Math.max(0.01, p));
  return p;
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
  const remaining = mid => effectiveXI(mid, i).xi
    .map(pid => PLAYER_BY_ID[pid])
    .filter(p => p && playerFixtureState(p, gwN).frac > 0);
  const left = { mid: a, current: gwManagerPoints(a, i), projected: Math.round(A.exp), remainingPlayers: remaining(a), toPlay: A.toPlay };
  const right = { mid: b, current: gwManagerPoints(b, i), projected: Math.round(B.exp), remainingPlayers: remaining(b), toPlay: B.toPlay };
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
  }
  return { state: st, left, right, leader, margin, tieRequirement: margin < 0 ? -margin : 0, leadRequirement: margin < 0 ? -margin + 1 : 0, lines };
}

/* the Opta bar (Conway's ask, Lee-approved): live win chance + projected
   points for a matchup, recomputed every render as minutes tick down — you
   can go into Sunday 20:80 down and watch it swing. Pre-kickoff it's the pure
   squad-vs-squad projection; at full time it hands over to a result line. */
function winProbBar(a, b, i, pov = null) {
  const m = matchNeeds(a, b, i, pov);
  const needLine = m.lines.length ? `<div class="need-line">${m.lines.join(' ')}</div>` : '';
  if (m.state === 'final') return needLine ? `<div class="prob-wrap prob-final">${needLine}</div>` : '';
  const w = Math.round(liveWinProb(a, b, i) * 100);
  const live = m.state === 'live';
  return `<div class="prob-wrap" title="Win chance from each XI's expected points, ${live ? 'updating as the gameweek plays out' : 'squad vs squad before kickoff'}">
    <div class="prob-row"><span><b>${w}%</b> ${kitSvg(a)}</span><span class="prob-mid">${live ? '<span class="rec"></span> LIVE WIN CHANCE' : 'WIN CHANCE'}</span><span>${kitSvg(b)} <b>${100 - w}%</b></span></div>
    <div class="prob-bar"><span style="width:${w}%"></span></div>
    <div class="prob-row prob-sub"><span>${live ? `<b>${m.left.current}</b> &middot; proj ${m.left.projected}` : `proj ${m.left.projected}`}</span><span class="prob-mid">${live ? `${m.left.toPlay} v ${m.right.toPlay} still to play` : 'projected points'}</span><span>${live ? `<b>${m.right.current}</b> &middot; proj ${m.right.projected}` : `proj ${m.right.projected}`}</span></div>
    ${needLine}
  </div>`;
}

// injury/availability chip from the FPL status flag
const STATUS_ICON = { d: '⚠️', i: '🏥', s: '🟥', u: '🚫', n: '🚫' };
const statusChip = p => STATUS_ICON[p.status]
  ? `<span class="status-chip" title="${esc(p.news || 'Unavailable')}">${STATUS_ICON[p.status]}</span>` : '';
// red ring/tint for the crocked and banned, amber for doubts — used on chips and table rows
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
  const draft = { team: teamName(mid), kit: { ...kitFor(mid) }, sponsor: sponsorFor(mid), rivals: [...rivalsOf(mid)], stadium: stadium(mid), boards: savedBoards, gaffer: savedGaffer };
  const stock = AD_BOARDS.map(b => b.t);
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const paint = () => {
    const prev = ov.querySelector('#kitPreview');
    if (prev) prev.innerHTML = kitSvgRaw(draft.kit, draft.sponsor, 120, 'kprev');
    ov.querySelectorAll('[data-pat]').forEach(b => b.classList.toggle('active', b.dataset.pat === draft.kit.pattern));
    ov.querySelectorAll('[data-board]').forEach(b => b.classList.toggle('active', draft.boards.includes(+b.dataset.board)));
    ov.querySelectorAll('[data-gaffer]').forEach(b => b.classList.toggle('active', draft.gaffer === +b.dataset.gaffer));
  };
  // extras open when any is already chosen — a founder editing their boards
  // shouldn't have to hunt for them behind a closed drawer
  const extrasOpen = draft.boards.length || draft.gaffer != null || draft.rivals.length;
  ov.innerHTML = `<div class="card club-office" role="dialog" aria-modal="true" aria-label="The club office" style="max-width:460px;width:94%">
    <h2>The club office</h2>
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:12px">
      <div id="kitPreview" style="flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <label class="muted" style="font-size:11px">TEAM NAME</label>
        <input id="clubName" maxlength="30" value="${esc(draft.team)}" style="width:100%" />
        <label class="muted" style="font-size:11px;margin-top:8px;display:block">SPONSOR — off the hoardings, or make one up</label>
        <select id="clubSpSel" style="width:100%">
          <option value="">No sponsor</option>
          ${stock.map(t => `<option value="${esc(t)}"${draft.sponsor === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
          <option value="__own"${draft.sponsor && !stock.includes(draft.sponsor) ? ' selected' : ''}>Make one up…</option>
        </select>
        <input id="clubSpOwn" maxlength="20" placeholder="Your sponsor (20 chars)" value="${draft.sponsor && !stock.includes(draft.sponsor) ? esc(draft.sponsor) : ''}" style="width:100%;margin-top:6px;display:${draft.sponsor && !stock.includes(draft.sponsor) ? 'block' : 'none'}" />
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
    <label class="muted" style="font-size:11px">YOUR GROUND</label>
    <input id="clubStadium" maxlength="40" value="${esc(draft.stadium)}" style="width:100%;margin:4px 0 10px" />
    <details class="club-extras"${extrasOpen ? ' open' : ''}>
      <summary>The extras — hoardings, gaffer, rival</summary>
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
    gaffer: savedGaffer != null, stadium: !!m?.stadium,
  };
  const touched = new Set();
  const luckEligible = () => ['kit', 'sponsor', 'boards', 'gaffer', 'stadium'].filter(f => !savedCustom[f] && !touched.has(f));
  ov.querySelector('#clubName').oninput = e => { draft.team = e.target.value; };
  ov.querySelectorAll('[data-pat]').forEach(b => b.onclick = () => { touched.add('kit'); draft.kit.pattern = b.dataset.pat; paint(); });
  ov.querySelector('#clubC1').oninput = e => { touched.add('kit'); draft.kit.c1 = e.target.value; paint(); };
  ov.querySelector('#clubC2').oninput = e => { touched.add('kit'); draft.kit.c2 = e.target.value; paint(); };
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
      } else if (f === 'stadium') {
        draft.stadium = pick(SURPRISE_STADIA);
        ov.querySelector('#clubStadium').value = draft.stadium;
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
        await serverAct('clubSet', { team, kit: draft.kit, sponsor: draft.sponsor || null, rivals: draft.rivals.length ? draft.rivals : null, stadium: stadiumName, boards: draft.boards.length ? draft.boards : null, gaffer: draft.gaffer, ...(mid !== whoami && { asManager: mid }) });
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
    state.managers[idx] = { ...state.managers[idx], team, kit: { ...draft.kit }, sponsor: draft.sponsor || null, rivals: draft.rivals.length ? [...draft.rivals] : null, rival: draft.rivals[0] || null, stadium: stadiumName, boards: draft.boards.length ? [...draft.boards] : null, gaffer: draft.gaffer };
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
    <h2>Found your club ${kitSvg(mid, 22)}</h2>
    <p class="rules-p">You've inherited <b>${esc(teamName(mid))}</b>. Keep the name or take a new one —
    then cut your kit, sign a shirt sponsor, name your ground, line it with hoardings, appoint your
    gaffer and declare your biggest rival. It all goes on show across the league.</p>
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
    <div style="display:flex;justify-content:center;margin:6px 0 10px">${kitSvgRaw(kitFor(mid), sponsorFor(mid), 140, `clubpage${mid}${editable ? '' : 'p'}`)}</div>
    <h2 style="margin-bottom:2px">${esc(teamName(mid))}</h2>
    <p class="muted" style="font-size:12px">${esc(managerName(mid))} &middot; est. 2015 &middot; ${esc(stadium(mid))}</p>
    ${sponsorFor(mid) ? `<p class="muted" style="font-size:11.5px">Principal partner: <b>${esc(sponsorFor(mid))}</b></p>` : ''}
    <p style="margin-top:10px"><span class="tag" style="font-size:12px">&#128227; Supporters&rsquo; mood: <b>${esc(mood.t)}</b></span></p>
    <p class="muted" style="font-size:11.5px;margin-top:4px">${esc(mood.line)}</p>
    ${editable ? '<button class="btn" id="clubEdit" style="margin-top:10px">The club office — change anything</button>' : ''}
  </div>
  <div class="card" style="margin-top:14px">
    <h2>Club records <span class="muted" style="font-weight:400;font-size:12px">what the ultras chant</span></h2>
    ${recRows.length ? recRows.join('') : '<p class="muted" style="font-size:12.5px">The record books open at GW1. Every one of these is currently yours for the taking.</p>'}
  </div>
  <div class="card" style="margin-top:14px">
    <h2>The dugout</h2>
    ${g ? `<p style="font-size:14px"><b>${g.e} ${esc(g.t)}</b></p><p class="muted" style="font-size:12.5px;margin:4px 0 8px">${esc(g.bio)}</p>
      <div class="lrow" style="font-size:12px;display:flex;gap:10px"><span class="muted">Coaching badges</span><b style="margin-left:auto">${esc(g.fm.badges)}</b></div>
      <div class="lrow" style="font-size:12px;display:flex;gap:10px"><span class="muted">Playing career</span><b style="margin-left:auto">${esc(g.fm.playing)}</b></div>
      <div class="lrow" style="font-size:12px;display:flex;gap:10px"><span class="muted">Media handling</span><b style="margin-left:auto">${esc(g.fm.media)}</b></div>`
      : '<p class="muted">The dugout stands vacant. The board is monitoring the situation.</p>'}
  </div>
  <div class="card" style="margin-top:14px">
    <h2>Rivalries</h2>
    ${myRivals.length ? myRivals.map(r => `<p style="font-size:13px">Declared: <b>${teamTag(r)}</b> ${derbyTag(mid, r)}</p>`).join('') : '<p class="muted">No declared rivals. The office calls this cowardice.</p>'}
    ${enemies.map(x => `<p style="font-size:12.5px" class="muted">${teamTag(x.id)} has declared YOU.${myRivals.includes(x.id) ? '' : ' You remain officially unaware.'}</p>`).join('')}
  </div>
  ${boards.length ? `<div class="card" style="margin-top:14px"><h2>${esc(stadium(mid))} — matchday</h2>${adStrip(mid * 7, 3, mid)}</div>` : ''}`;
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
      <div class="dir-kit">${kitSvg(mid, 44, true)}</div>
      <div class="dir-body">
        <b class="dir-team">${esc(teamName(mid))}</b>
        <span class="muted dir-line">${esc(managerName(mid))} &middot; ${esc(stadium(mid))}</span>
        ${sponsorFor(mid) ? `<span class="muted dir-line">Principal partner: ${esc(sponsorFor(mid))}</span>` : ''}
        ${gafferFor(mid) ? `<span class="dir-line">${gafferChip(mid)}</span>` : ''}
        <span class="dir-line"><span class="tag" style="font-size:10.5px">&#128227; ${esc(mood.t)}</span></span>
        ${dirRivals.length ? `<span class="dir-line" style="font-size:11px">Rival${dirRivals.length === 1 ? '' : 's'}: ${dirRivals.map(r => `${teamTag(r)} ${derbyTag(mid, r)}`).join(' ')}</span>` : ''}
        ${opened ? '' : '<span class="muted dir-line" style="font-style:italic">Office unopened</span>'}
      </div>
    </button>`;
  });
  return `<div class="card">
    <h2>The club directory <span class="muted" style="font-weight:400;font-size:12px">every club, on the record</span></h2>
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
    <div style="display:flex;justify-content:flex-end;margin-bottom:-6px"><button class="btn ghost small" id="profClose" aria-label="Close profile">&#10005;</button></div>
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
function managerSquad(mid) { return squadAt(mid, currentGwIndex()); }
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
// flex squads: any 14 inside per-position min/max bounds. No club cap —
// Tussie's right to draft the entire City team by GW30 is constitutionally protected.
function squadShapeOk(squad) {
  if (squad.length !== state.settings.squadSize) return false; // exact size — swaps can't shrink/grow a squad
  if (new Set(squad.map(p => p.id)).size !== squad.length) return false; // nobody owns a player twice
  const c = { GK: 0, DF: 0, MF: 0, FW: 0 };
  squad.forEach(p => c[p.pos]++);
  const { posMin, posMax } = state.settings;
  return ['GK', 'DF', 'MF', 'FW'].every(pos => c[pos] >= posMin[pos] && c[pos] <= posMax[pos]);
}
function shirtNum(mid, pid) {
  return state.shirtNums?.[mid]?.[pid] ?? '–';
}

/* ---------------- waivers & the Trough ----------------
   Committee timing (Toby, Jul 2026), anchored to the fixtures: the post-run at
   8pm (London) the day AFTER a gameweek's last fixture, the pre-run at 8pm the
   day BEFORE the next gameweek's first fixture. The Trough closes 90 minutes
   before a gameweek's first kick-off and reopens once the post-run has
   executed. Claims are ranked and blind; order = reverse standings, winners
   drop to the back; dropped players go back on waivers. Mirrors js/engine.js. */

const gwKicks = g => {
  const ts = state.fixtures.filter(f => f && f.gw === g + 1 && f.date).map(f => new Date(f.date).getTime());
  return ts.length ? { first: Math.min(...ts), last: Math.max(...ts) } : null;
};
function londonOffsetMin(ms) {
  const s = new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const m = s.match(/(\d+)\/(\d+)\/(\d+),? (\d+):(\d+)/);
  return m ? Math.round((Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] % 24, +m[5]) - ms) / 60000) : 0;
}
function london20(ms, dayOffset) {
  const wall = new Date(ms + londonOffsetMin(ms) * 60000);
  const naive = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + dayOffset, 20, 0);
  return naive - londonOffsetMin(naive) * 60000;
}
const postRunAt = g => { const k = gwKicks(g); return k ? london20(k.last, 1) : null; };
const preRunAt = g => { const k = gwKicks(g); return k ? london20(k.first, -1) : null; };
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
  let best = null;
  for (let g = 0; g < GAMEWEEKS.length; g++) {
    for (const x of [postRunAt(g), preRunAt(g)]) if (x != null && x > t && (best == null || x < best)) best = x;
  }
  return new Date(best ?? (t + 7 * 864e5));
}
const waiverControl = () => state.waiverMeta?.control || 'auto';
const lastWaiverRun = () => state.waiverMeta?.lastRun ? new Date(state.waiverMeta.lastRun).getTime() : 0;
function waiverRunDue() {
  if (state.phase !== 'season' || waiverControl() !== 'auto') return false;
  const t = Date.now(), lr = lastWaiverRun();
  for (let g = 0; g < GAMEWEEKS.length; g++) {
    for (const x of [postRunAt(g), preRunAt(g)]) {
      if (x != null && x <= t && t - x < 48 * 3600e3 && x > lr) return true;
    }
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
  const post = postRunAt(cur);
  if (post == null) return { open: true };
  if (t < post) return { open: false, until: post, why: 'the gameweek is underway' };
  if (lastWaiverRun() < post) return { open: false, until: null, why: 'awaiting the post-gameweek waiver run' };
  return { open: true };
}
// is this player currently stuck on waivers (claim-only), or free to sign now?
function onWaivers(p) {
  const tw = troughWindow();
  if (tw.mock) return true; // the chamber's clock beats every manual control
  const ctl = waiverControl();
  if (ctl === 'open') return false;
  if (ctl === 'closed') return true;
  if (!tw.open) return true;
  // recently dropped players wait for the next processing
  for (const t of state.transfers) {
    if (t.outId === p.id && (t.t || 0) > lastWaiverRun()) return true;
  }
  return false;
}

/* ---------------- new arrivals & the Window Draft ----------------
   League tradition: anyone who joins a PL club after draft night is locked
   until the transfer window shuts. The Chairman then runs the Window Draft —
   snaking backwards from the original order (pick 12 goes first) until a full
   lap of passes — and whatever's left spills into the Trough. */
const isArrival = p => !!state.draftPool?.ids && state.draftPool.ids[p.id] !== p.club;
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
  if (netOn()) {
    serverAct('claimSet', { gwIndex: cur, claims: arr }).catch(() => {});
    // the private snapshot echoes the authoritative list back
  }
  (state.claims[cur] = state.claims[cur] || {})[mid] = arr;
  save(); render();
}
// commissioner-only: resolve all pending claims, then open the Trough
function processWaivers(manual = false) {
  if (netOn() && !isCommissioner()) { toast('Only the Chairman runs waivers'); return; }
  if (netOn()) {
    // online, the server resolves waivers (it can see everyone's blind claims;
    // this device can only see its own)
    serverAct('waiverRunNow', {}).then(res => {
      const ex = toArr(res?.executed);
      if (res?.skipped) { toast(`Waivers skipped — ${res.skipped}.`); return; }
      toast(ex.length
        ? `Waivers processed — ${ex.map(e => `${managerName(e.mid)} lands ${PLAYER_BY_ID[e.in]?.name}`).join(', ')}. The Trough is open.`
        : 'Waivers processed — no claims landed. The Trough is open.');
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
  const queue = waiverOrder(); // reverse standings — weekly reset
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
        state.transfers.push({ managerId: mid, outId: c.out, inId: c.in, gw: tgw, n: state.transfers.length + 1, t: Date.now(), waiver: true });
        const lu = state.lineups[mid]?.[tgw];
        if (lu) { state.lineups[mid][tgw] = lu.filter(id => id !== c.out); touchedLineups.add(mid); }
        executed.push({ mid, in: c.in, out: c.out });
        queue.splice(qi, 1); queue.push(mid); // winner drops to the back
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
      : `Waivers processed — no claims landed. The Trough is open.`);
  });
}
function setWaiverControl(mode) {
  if (netOn() && !isCommissioner()) { toast('Only the Chairman controls the Trough'); return; }
  if (netOn()) { serverAct('waiverControl', { mode }).catch(() => {}); }
  else { state.waiverMeta = { ...state.waiverMeta, control: mode }; save(); render(); }
  toast(mode === 'open' ? 'The Trough is thrown open — everything is free to sign.'
    : mode === 'closed' ? 'The Trough is closed. The Chairman has spoken.'
    : 'Back on schedule — waivers follow the fixtures (8pm after the gameweek, 8pm before the next).');
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
function waiverOrder() {
  // reverse of the CURRENT table — every finished GW counts (passing the
  // current GW index dropped the round that just finished)
  const { rows, anyFinal } = standingsBefore(REGULAR_GWS);
  const base = anyFinal ? rows.map(r => r.id) : [...state.draft.order];
  return [...base].reverse(); // bottom feeds first
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
      .then(() => toast(`Trade proposed to ${managerName(to)}. Their move.`)).catch(() => {});
    return;
  }
  const offer = { id: Date.now() + '-' + from, from, to, give, get, terms: terms.slice(0, 200), status: 'pending', t: Date.now() };
  txnArray('trades', arr => [...arr, offer])
    .then(ok => toast(ok ? `Trade proposed to ${managerName(to)}. Their move.` : 'Proposal didn’t send — check connection and try again'));
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
      out.push({ managerId: tr.from, outId: give[k], inId: get[k], gw: tgw, n: out.length + 1, t: Date.now(), trade: true });
      out.push({ managerId: tr.to, outId: get[k], inId: give[k], gw: tgw, n: out.length + 1, t: Date.now(), trade: true });
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
function totalPicks() { return state.managers.length * state.settings.squadSize; }
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
  const { squadSize, posMin, posMax } = state.settings;
  const c = posCount(mid);
  const size = managerSquad(mid).length;
  if (size >= squadSize || c[player.pos] >= posMax[player.pos]) return false;
  // the pick must leave enough slots to satisfy every unmet position minimum
  let need = 0;
  for (const pos of ['GK', 'DF', 'MF', 'FW']) need += Math.max(0, posMin[pos] - c[pos] - (pos === player.pos ? 1 : 0));
  return need <= squadSize - size - 1;
}
function draftedIds() { return new Set(state.draft.picks.map(p => p.playerId)); }

function makePick(playerId, force = false) {
  const mid = currentManagerId();
  if (mid == null) return;
  if (!force && !canActFor(mid)) { toast(`It's ${managerName(mid)}'s pick — the group chat is watching you`); return; }
  const player = PLAYER_BY_ID[playerId];
  if (!canPick(mid, player)) { toast(`${managerName(mid)} can't fit another ${player.pos} — position limits`); return; }
  const rec = { managerId: mid, playerId, n: pickNo() + 1 };
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
  if (netOn()) { serverAct('draftAutopick', {}).catch(() => {}); return; }
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
  pts += (s.yc || 0) * sc.yellow + (s.rc || 0) * sc.red;
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
  return s ? statPoints(PLAYER_BY_ID[pid], s) : 0;
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
  const squadIds = new Set(managerSquad(mid).map(p => p.id));
  for (const [pid, adj] of Object.entries(state.adjustments)) {
    if (adj && squadIds.has(+pid)) pts += adj;
  }
  return pts;
}
// points a player has banked for this manager (only weeks he was in the XI)
function contributedPoints(mid, pid) {
  let pts = 0;
  for (let i = 0; i < GAMEWEEKS.length; i++) {
    if (effectiveXI(mid, i).xi.includes(pid)) pts += gwPlayerPoints(pid, i);
  }
  return pts + (state.adjustments[pid] || 0);
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
function gwStatus(i) {
  const ev = gwEvent(i);
  const synced = !!ev && Object.keys(ev.playerStats || {}).length > 0;
  if (synced && (ev.final || gwIsOver(i))) return 'final';
  if (synced) return 'live';
  if (gwHasStarted(i)) return 'underway';
  return 'upcoming';
}
// display truth for "is this gameweek under way": the clock says so, OR stats
// exist for it (the demo and the sandbox Simulation Chamber both produce
// stats before the real kickoff date). Locks and transfer maths must keep
// using the time-based gwHasStarted — this is for showing points, only.
function gwUnderway(i) { const st = gwStatus(i); return st === 'live' || st === 'final' || gwHasStarted(i); }
function h2hStandings(includeLive = false) {
  const rows = Object.fromEntries(state.managers.map(m => [m.id, { id: m.id, name: m.name, team: m.team, p: 0, w: 0, d: 0, l: 0, pts: 0, pf: 0, pa: 0 }]));
  for (let i = 0; i < REGULAR_GWS; i++) {
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
  // tiebreak on regular-season overall points (pf = points scored across the
  // GWs counted above) — managerPoints() spans all 38 GWs, so playoff scoring
  // could reshuffle a settled regular-season table
  return Object.values(rows).sort((x, y) => y.pts - x.pts || y.pf - x.pf);
}

/* ---------------- FPL sync ---------------- */
// Stats are fetched by a GitHub Action from the official FPL API and committed
// to data/stats.json + data/fixtures.json. The app just reads those files —
// player ids are FPL's own, so there is no name-matching to go wrong.
let liveTimer = null;
function anyMatchLive() { return state.fixtures.some(f => f.started && !f.finished); }

/* ---- the Vidiprinter (ledger #8 — Tussie's Soccer-Saturday ticker) ----
   Every stats sync is diffed against the last; anything that happened
   comes off the tape, newest first. Kept per device, like a real telly. */
const VIDI_KEY = `${LS_NS}-vidi`;
const VIDI_WORDS = { 10: 'TEN', 11: 'ELEVEN', 12: 'TWELVE', 13: 'THIRTEEN', 14: 'FOURTEEN', 15: 'FIFTEEN', 16: 'SIXTEEN' };
let vidiFeed = [];
try { vidiFeed = JSON.parse(localStorage.getItem(VIDI_KEY)) || []; } catch { vidiFeed = []; }
function vidiPush(lines) {
  if (!lines.length) return;
  vidiFeed = [...lines, ...vidiFeed].slice(0, 60);
  try { localStorage.setItem(VIDI_KEY, JSON.stringify(vidiFeed)); } catch { /* tape full, carry on */ }
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
function vidiDiff(gwIdx, oldPS, newPS) {
  if (state.phase !== 'season' || !oldPS || !Object.keys(oldPS).length) return;
  // the ticker credits the fantasy team — starters get the points line
  const starterOf = {}, benchOf = {};
  for (const m of state.managers) {
    for (const pid of effectiveXI(m.id, gwIdx).xi) starterOf[pid] = m.id;
    for (const p of squadAt(m.id, gwIdx)) if (starterOf[p.id] == null) benchOf[p.id] = m.id;
  }
  const lines = [];
  for (const [pid, s] of Object.entries(newPS)) {
    const p = PLAYER_BY_ID[pid];
    if (!p) continue;
    const o = oldPS[pid] || {};
    const bits = [];
    for (const [k, icon, word] of VIDI_EVENTS) {
      const d = (s[k] || 0) - (o[k] || 0);
      if (d > 0) bits.push(`${icon} ${word(d)}`);
    }
    if (!bits.length) continue;
    const dp = statPoints(p, s) - (Object.keys(o).length ? statPoints(p, o) : 0);
    const now = statPoints(p, s);
    const mid = starterOf[p.id];
    const who = mid != null ? `${teamName(mid)} ${dp >= 0 ? '+' : ''}${dp}`
      : benchOf[p.id] != null ? `benched by ${teamName(benchOf[p.id])} (!)` : 'the Trough';
    const haul = now >= 10 && mid != null ? ` (${VIDI_WORDS[now] || now}!!)` : '';
    lines.push({ ts: Date.now(), gw: GAMEWEEKS[gwIdx].n, txt: `${bits.join(' · ')} — ${p.name} (${p.club}) — ${who}${haul}` });
    // the Lobus Klaxon (Marc, 1 Aug): the gag is DELIVERED here — any declared
    // Lobus scoring sets off the klaxon on the tape, whoever owns him
    const dg = (s.g || 0) - (o.g || 0);
    if (dg > 0) {
      for (const [lmid, lpid] of Object.entries(state.lobus || {})) {
        if (+lpid !== +pid) continue;
        lines.push({ ts: Date.now(), gw: GAMEWEEKS[gwIdx].n, txt: `\u{1F6A8}\u{1F4EF} LOBUS KLAXON \u{1F4EF}\u{1F6A8} ${p.name} — the declared Lobus of ${teamName(+lmid)} — has SCORED. Great feet for a big man.` });
      }
    }
  }
  vidiPush(lines);
}
/* ----- the Simulation Chamber (sandbox-only): a pretend matchday for the
   lads' real drafted teams. The Chairman kicks it off; every device derives
   IDENTICAL stats from the shared {gw, phase, seed, t} flag (deterministic
   LCG per player), so no stat payload ever syncs. 'live' plays out over ~20
   minutes — points tick up, the vidiprinter clatters, the klaxon can fire —
   then 'final' settles it. The real league has no such lever: the server
   action hard-refuses outside the-league-sandbox. ----- */
const MOCK_LIVE_MS = 20 * 60e3;
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
  const teams = {}, fixtures = [];
  for (const f of state.fixtures.filter(x => x.gw === gwN)) {
    const rnd = mockRnd(seed * 6151 + (f.id || 0) * 30011);
    const hs = score(rnd), as = score(rnd);
    const ht = Array.from({ length: hs }, () => Math.max(1, Math.ceil(rnd() * 90))).sort((a, b) => a - b);
    const at = Array.from({ length: as }, () => Math.max(1, Math.ceil(rnd() * 90))).sort((a, b) => a - b);
    fixtures.push({ f, ht, at });
    teams[f.home] = { times: ht, oppTimes: at };
    teams[f.away] = { times: at, oppTimes: ht };
  }
  return { teams, fixtures };
}
function mockGwStats(gwIdx, seed, frac) {
  const ps = {};
  const featured = new Set();
  for (const m of state.managers) for (const p of squadAt(m.id, gwIdx)) featured.add(p.id);
  for (const arr of Object.values(state.hamCup?.entries || {})) for (const pid of toArr(arr)) featured.add(+pid);
  const { teams } = mockScorelines(gwIdx, seed);
  const haveFixtures = Object.keys(teams).length > 0;
  const elapsed = Math.round(90 * frac);
  // pass 1: who featured, and for how long
  const roster = []; // {p, started, mins}
  for (const pid of featured) {
    const p = PLAYER_BY_ID[pid];
    if (!p) continue;
    if (haveFixtures && !teams[p.team]) continue; // blank GW for his club — didn't play, honestly
    const rnd = mockRnd(seed * 7919 + pid * 104729);
    if (rnd() < 0.07) continue; // left out this week
    const started = rnd() < 0.85;
    const mins = started ? elapsed : Math.max(0, elapsed - 60); // subs enter on the hour
    if (!mins) continue; // not on the pitch yet — no stat line
    roster.push({ p, rnd, started, mins });
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
  // pass 3: the stat lines, consistent with the scoreboard so far
  for (const { p, rnd, started, mins } of roster) {
    const sl = teams[p.team];
    const conceded = sl ? sl.oppTimes.filter(t => t <= elapsed).length : 0;
    const cr = credit[p.id] || { g: [], a: [] };
    const s = {
      min: mins, st: started ? 1 : 0, sub: started ? 0 : 1,
      g: cr.g.filter(t => t <= elapsed).length,
      a: cr.a.filter(t => t <= elapsed).length,
      cs: sl && conceded === 0 && elapsed >= 60 && mins >= 60 ? 1 : 0,
      gc: conceded, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0,
    };
    if (rnd() < 0.10 && rnd() < frac) s.yc = 1;
    if (p.pos === 'GK') s.sv = Math.min(9, Math.floor(rnd() * 4 * frac) + (conceded ? 1 : 0));
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
  const elapsed = Math.round(90 * frac);
  mockFxSaved = mockFxSaved || {};
  for (const { f, ht, at } of fixtures) {
    if (!mockFxPatched.has(f)) {
      mockFxSaved[f.id] = { hs: f.hs, as: f.as, started: f.started, finished: f.finished, minutes: f.minutes };
      mockFxPatched.add(f);
    }
    f.hs = ht.filter(t => t <= elapsed).length;
    f.as = at.filter(t => t <= elapsed).length;
    f.started = true; f.finished = !!final; f.minutes = elapsed;
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
  if (mockPrevPS && state.phase === 'season') { try { vidiDiff(mk.gw, mockPrevPS, ps); } catch { /* the tape can miss a beat */ } }
  mockPrevPS = ps;
  // a REAL event for this gameweek that synced in while the chamber runs is
  // feed truth — stash it so switch-off restores it instead of deleting
  const existing = state.matchStats[gwKey];
  if (existing && !String(existing.label || '').includes('simulation')) mockEvSaved[gwKey] = existing;
  state.matchStats[gwKey] = { gw: mk.gw, label: `GW${GAMEWEEKS[mk.gw].n} — simulation`, date: GAMEWEEKS[mk.gw].from, final, playerStats: ps };
  mockGwKeyApplied = gwKey;
  return true;
}
// the live sim advances on its own — nudge the page along once a minute
setInterval(() => { if (SANDBOX && !demoMode && state.mock?.phase === 'live') { if (applyMock()) render(); } }, 60e3);
function vidiCard(compact = false) {
  const live = anyMatchLive();
  if (!vidiFeed.length && !live) return '';
  const rows = vidiFeed.slice(0, compact ? 12 : 30).map(l =>
    `<div class="vidi-line"><span class="vidi-when">${new Date(l.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} GW${l.gw}</span> ${esc(l.txt)}</div>`).join('');
  return `<div class="card" style="margin-top:14px">
    <h2>The Vidiprinter ${live ? '<span class="tag live-tag"><span class="rec"></span>LIVE</span>' : ''} <span class="muted" style="font-weight:400;font-size:12px">every incident, straight off the wire</span></h2>
    <div class="vidi-tape">${rows || '<div class="vidi-line" style="color:var(--muted)">The tape is quiet. Kick-off will fix that.</div>'}</div>
    <p class="muted" style="font-size:10.5px;margin-top:6px">Sponsored by Ceefax page 302. Lines land as the feed refreshes (~15 min on matchdays); the tape lives on this device.</p>
  </div>`;
}

async function syncNow(manual = false) {
  if (demoMode) { if (manual) toast('Demo mode — the results are fictional, like Blanky’s title chances post GW10'); return; }
  const btn = $('#syncBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '&#8987;<span class="sync-txt"> Refreshing…</span>'; }
  try {
    const bust = `?t=${Date.now()}`;
    const [statsRes, fxRes] = await Promise.all([
      fetch(`data/stats.json${bust}`),
      fetch(`data/fixtures.json${bust}`),
    ]);
    const stats = await statsRes.json();
    const fixtures = await fxRes.json();
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
      try { vidiDiff(i, oldPS, gw.stats || {}); } catch (e) { console.warn('[vidi]', e); }
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
  // keep tapping while matches are in play (the Action refreshes every 15 min)
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
  ['directory', 'Club directory', 'Clubs'],
  ['transfers', 'Transfers', 'Transfers'],
  ['h2h', 'Matches', 'Matches'],
  ['cup', 'Cup competitions', 'Cups'],
  ['table', 'League Table', 'Table'],
  ['data', 'The Data Room', 'Data'],
  ['fixtures', 'PL fixtures', 'PL fixtures'],
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
const SETUP_NAV = new Set(['draft', 'club', 'rules', 'settings']);

let lastRenderedView = null;
function render() {
  applyMock(); // sandbox Simulation Chamber overlay — no-op everywhere else
  // keep keyboard focus across re-renders (remote updates land mid-typing)
  const ae = document.activeElement;
  const focusId = ae && ae.id && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT') ? ae.id : null;
  let caret = null;
  try { caret = focusId && ae.selectionStart != null ? ae.selectionStart : null; } catch { caret = null; }

  syncHash();
  // fresh page starts at the top; re-renders of the same page hold position
  if (lastRenderedView !== state.view) { window.scrollTo(0, 0); lastRenderedView = state.view; window.onscroll = null; }
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
  if (netOn() && authUser && !membership) {
    // signed in with an email the league doesn't know
    // the tech line turns a stuck user's device into the diagnostic probe:
    // "connection DOWN" = transport (home-wifi filters break the database
    // websocket); a permission code = rules/identity; neither = still waiting
    const err = window._lastSyncErr;
    const conn = syncConnected ? 'live' : 'DOWN';
    ov.innerHTML = `<div class="card" style="max-width:480px;width:94%">
      <h2>Who let you in?</h2>
      <p class="muted" style="font-size:13px;margin-bottom:10px">You're signed in as <b>${esc(authUser.email || 'unknown')}</b> but this device hasn't linked you to a manager. If that email is the one the Chairman registered, it's usually a hiccup &mdash; reload and it sorts itself. If it's a different email, sign out and use the registered one.</p>
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
      <h2>Sign in</h2>
      ${linkSentTo
        ? `<p style="font-size:14px;margin-bottom:14px">&#9993; Link sent to <b>${esc(linkSentTo)}</b>. Open the email ON THIS DEVICE and tap it — that's the whole sign-in.</p>
           <p class="muted" style="font-size:12px;margin-bottom:6px">Link opened somewhere else (or you're in the installed app)? Copy it from the email and paste it here:</p>
           <form id="whoPasteForm" style="display:flex;gap:8px;margin-bottom:10px">
             <input id="whoPaste" placeholder="Paste the sign-in link" style="flex:1;min-width:0">
             <button class="btn small" type="submit">Finish sign-in</button>
           </form>
           <button class="btn ghost small" id="whoResend">Different email</button>`
        : `<p class="muted" style="font-size:13px;margin-bottom:14px">No passwords, no PINs. Enter the email the Chairman registered for you and we'll send a sign-in link.</p>
           <form id="whoEmailForm" style="display:flex;gap:8px;margin-bottom:10px">
             <input type="email" id="whoEmail" required placeholder="you@example.com" autocomplete="email" style="flex:1;min-width:0">
             <button class="btn" type="submit">Send link</button>
           </form>`}
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
  if (anyMatchLive()) bits.push('<span class="live-pill"><span class="rec"></span>LIVE</span>');
  // the feed going quiet on a matchday should be visible, not discovered
  if (state.feedGenerated && anyMatchLive()) {
    const ageH = (Date.now() - new Date(state.feedGenerated).getTime()) / 3600000;
    if (ageH > 1.5) bits.push(`<span class="tag" style="background:#4a3a10;color:#ffd98a" title="The stats feed normally refreshes every 15 minutes on matchdays. Scores may be lagging.">&#9888; feed ${ageH < 2 ? '90m' : Math.round(ageH) + 'h'} stale</span>`);
  }
  if (syncOn()) {
    bits.push(`<span class="conn ${syncConnected ? 'up' : ''}" role="status" aria-label="${syncConnected ? 'Live sync connected' : 'Offline — the league is read-only until you reconnect'}" title="${syncConnected ? 'Live sync: connected' : 'Offline — the league is read-only until you reconnect'}">&#9679;</span>`);
    // signed in but membership never landed: SAY so — a pill reading "Sign in"
    // while the account is authenticated reads as a broken app (Ben, 2 Aug)
    const stuck = netOn() && authUser && !whoami;
    const who = whoami === -1 ? 'Spectating' : (whoami ? esc(managerName(whoami)) : (stuck ? '&#9888; Not recognised' : 'Sign in'));
    const whoTitle = netOn() ? (stuck ? `Signed in as ${esc(authUser.email || 'unknown')} but not linked to a manager yet — tap for options` : authUser ? 'Signed in — tap to sign out' : 'Sign in') : 'Switch who this device acts as';
    bits.push(`<button class="tag" id="whoBtn" style="cursor:pointer" title="${whoTitle}">${who}</button>`);
  }
  if (state.phase === 'season') {
    const last = state.lastSync ? new Date(state.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'never';
    bits.push(`<button class="tag" id="syncBtn" title="Scores auto-refresh every ~15 min on matchdays — tap to refresh now">&#8635;<span class="sync-txt"> ${last}</span></button>`);
  }
  if (state.phase !== 'draft') {
    // Home: the Dashboard in season, the waiting room pre-draft
    const homeLabel = state.phase === 'setup' ? 'Waiting room' : 'Dashboard';
    bits.push(`<button id="homeBtn" class="btn home-btn${state.view === 'dash' ? ' is-current' : ''}" aria-label="${homeLabel}" title="${state.phase === 'setup' ? 'Back to the waiting room' : 'Back to the Dashboard'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11 12 3l9 8"/><path d="M5 10v11h14V10"/></svg><span class="sync-txt">${homeLabel}</span></button>`);
  }
  bits.push(`<button class="tag" id="gSearchBtn" style="cursor:pointer" aria-label="Search players" title="Search every player (Ctrl+K or /)"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" style="vertical-align:-1px"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/></svg></button>`);
  bits.push(`<button class="tag" id="muteBtn" style="cursor:pointer" aria-label="${soundOn() ? 'Mute' : 'Unmute'} broadcast sound" title="Broadcast sound (Ian's mute button)">${soundOn() ? '&#128266;' : '&#128263;'}</button>`);
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
  }).then(go => { if (go) location.href = location.pathname; });
}

/* ----- the ready room: pre-draft roll call, one tap per manager ----- */
function readyRoomCard() {
  if (!netOn()) return ''; // only means something when everyone is on their own device
  const r = state.ready || {};
  const n = state.managers.filter(mg => r[mg.id]).length;
  const iAmManager = whoami && whoami !== -1;
  return `<div class="card">
    <h2>The ready room <span class="tag">${n}/${state.managers.length} ready</span></h2>
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
    <h2>The scouting floor is open</h2>
    <p class="rules-p">${n ? `Your autopick list has <b>${n}</b> name${n === 1 ? '' : 's'} on it.` : 'Browse the pool, &#9733; star your targets and rank your autopick list before the night.'} If your draft clock ever hits zero, the top available name on your list goes in.</p>
    <button class="btn" id="prepGo" style="margin-top:10px">Open the Draft Console</button>
  </div>`;
}

function viewSetup() {
  const m = state.managers;
  const { posMin, posMax } = state.settings;
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
        <p class="rules-p">${whoami && whoami !== -1 ? `Signed in as <b>${esc(teamName(whoami))}</b>. ` : ''}When ${esc(managerName(state.managers[0]?.id))} starts the draft, this screen becomes your draft board automatically — keep it open.</p>
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
      <p>Twelve managers. One snake draft. Every player in the Premier League.<br>Est. 2015. Minutes kept by the Committee.</p>
    </div>
    ${foundingCard()}
    ${prepCard()}
    ${readyRoomCard()}
    <div class="card">
      <h2>Managers &amp; draft order</h2>
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
      <p class="muted" style="font-size:11.5px;margin-top:8px">First manager listed is the commissioner. Team names pulled from the archive — correct as you see fit.</p>
    </div>
    <div class="card">
      <h2>Squad rules</h2>
      <p class="muted" style="font-size:12px;margin-bottom:10px">Squads of <b>${state.settings.squadSize}</b>, flexible make-up between each position's min and max.</p>
      <div class="quota-grid">
        ${['GK', 'DF', 'MF', 'FW'].map(pos => `
          <div><label>${POS_LABEL[pos]} min–max</label>
          <div style="display:flex;gap:6px">
            <input type="number" min="0" max="11" data-posmin="${pos}" aria-label="${POS_LABEL[pos]} minimum" value="${posMin[pos]}">
            <input type="number" min="0" max="11" data-posmax="${pos}" aria-label="${POS_LABEL[pos]} maximum" value="${posMax[pos]}">
          </div></div>`).join('')}
      </div>
      <div style="margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label style="font-size:12px;color:var(--muted);font-weight:700">SQUAD SIZE</label>
        <input type="number" min="11" max="20" id="squadSize" aria-label="Squad size" value="${state.settings.squadSize}" style="width:60px">
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
    const total = state.settings.squadSize;
    $('#setupTotal').innerHTML = `Squad size: <b>${total}</b> each &middot; <b>${total * state.managers.length}</b> of ${PLAYERS.length} players drafted &middot; starting XI picked each gameweek &middot; weekly waivers, bottom feeds first`;
  };
  document.querySelectorAll('[data-mgr]').forEach(inp => inp.oninput = () => {
    state.managers.find(m => m.id === +inp.dataset.mgr).name = inp.value;
  });
  document.querySelectorAll('[data-mgrteam]').forEach(inp => inp.oninput = () => {
    state.managers.find(m => m.id === +inp.dataset.mgrteam).team = inp.value;
  });
  document.querySelectorAll('[data-posmin]').forEach(inp => inp.oninput = () => {
    state.settings.posMin[inp.dataset.posmin] = Math.max(0, +inp.value || 0);
  });
  document.querySelectorAll('[data-posmax]').forEach(inp => inp.oninput = () => {
    state.settings.posMax[inp.dataset.posmax] = Math.max(0, +inp.value || 0);
  });
  $('#squadSize').oninput = e => { state.settings.squadSize = Math.max(11, +e.target.value || 14); updateTotal(); };
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
    if (state.settings.squadSize < 11) { toast('Squads need at least 11 for a starting XI'); return; }
    const { posMin, posMax } = state.settings;
    const minSum = posMin.GK + posMin.DF + posMin.MF + posMin.FW;
    const maxSum = posMax.GK + posMax.DF + posMax.MF + posMax.FW;
    if (minSum > state.settings.squadSize || maxSum < state.settings.squadSize) { toast('Position min/max can’t make a legal squad'); return; }
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
            squadSize: state.settings.squadSize,
            posMin: state.settings.posMin,
            posMax: state.settings.posMax,
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
  'Crystal Palace': 'the entire Holmesdale Fanatics drum section',
  'Everton': 'Duncan Ferguson, escorting two burglars he has made friends with',
  'Fulham': 'Hugh Grant, apologising charmingly',
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
function showCeremony() {
  if ($('#ceremony')) return;
  const order = state.draft.order;
  if (!order.length) return;
  // "seen" is stamped only when the ceremony ENDS — stamping at open meant a
  // refresh mid-pomp skipped straight to a live clock (sol r4). The key
  // includes draftPool.at so a rehearsal/reset with the same order replays it.
  const cerFinish = () => { localStorage.setItem(`${LS_NS}-ceremony-seen`, ceremonyKey()); };
  const ordinals = ['twelfth', 'eleventh', 'tenth', 'ninth', 'eighth', 'seventh', 'sixth', 'fifth', 'fourth', 'third', 'second', 'FIRST'];
  const steps = [
    { h: '&#9917; THE OPENING CEREMONY', p: 'Live and exclusive coverage with David Prutton, alongside Big Al Brazil, who has been here since the gallops. Season twelve of The League. Ian, be upstanding. Especially you.' },
    { h: '&#127884; THE PARADE OF CLUBS', p: '', parade: true },
    { h: '&#127908; Main stage', p: 'Coldplay perform Viva la Vida in its 9-minute extended ceremony arrangement. Chris Martin has been told this is a twelve-man WhatsApp league that left its old website over £145. He says every revolution is beautiful.' },
    { h: '&#129309; The draw', p: 'The Committee opens the envelopes. The order is final. The complaints will not be.' },
    ...[...order].reverse().map((mid, i) => ({
      h: `Drafting ${ordinals[i + (ordinals.length - order.length)]}…`, p: managerName(mid), big: true,
    })),
    { h: 'LET THE DRAFT BEGIN', p: `${managerName(order[0])} is on the clock. The Committee is watching.` },
  ];
  let i = 0;
  const ov = document.createElement('div');
  ov.id = 'ceremony';
  ov.className = 'overlay';
  ov.innerHTML = '<div id="cerStage" style="display:flex;flex-direction:column;align-items:center;gap:12px;width:92%;max-width:520px"><div id="cerCard" style="width:100%"></div></div>';
  document.body.appendChild(ov);
  let paradeTimer = null;
  const show = () => {
    clearInterval(paradeTimer);
    if (i >= steps.length) { cerFinish(); ov.remove(); return; }
    const s = steps[i];
    $('#cerCard').innerHTML = `<div class="card" style="text-align:center">
      <h2 style="margin-bottom:12px">${s.h}</h2>
      ${s.parade ? '<div id="paradeSlot" class="parade-slot"></div>'
        : s.big ? `<div class="ceremony-name">${esc(s.p)}</div>` : `<p class="rules-p" style="text-align:center">${esc(s.p)}</p>`}
      <div style="margin-top:18px;display:flex;gap:8px;justify-content:center">
        <button class="btn small" id="cerNext">${i === steps.length - 1 ? 'To the Console' : 'Continue the pomp'}</button>
        <button class="btn ghost small" id="cerSkip" title="Reserved for Ian">Skip ceremony (Ian's button)</button>
      </div></div>`;
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
      paradeTimer = setInterval(showFlag, 900);
    }
    $('#cerNext').onclick = () => { i++; show(); };
    $('#cerSkip').onclick = () => { cerFinish(); ov.remove(); toast('Ceremony skipped. Ian nods, once.'); };
  };
  show();
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
function maybeDrinksBreak() {
  const ov = $('#drinksBreak');
  const n = pickNo();
  const due = state.phase === 'draft' && drinksBreakAt(n) && !(state.draft.breaksDone || []).includes(n);
  if (!due) { ov?.remove(); return; }
  if (ov) return;
  const el = document.createElement('div');
  el.id = 'drinksBreak';
  el.className = 'overlay';
  el.innerHTML = `<div class="card" style="max-width:480px;width:92%;text-align:center">
    <div style="font-size:46px;margin-bottom:8px">&#127866;</div>
    <h2>${drinksBreakAt(n)}</h2>
    <p class="muted" style="font-size:12.5px;margin-top:10px">&#127928; Now playing over the tannoy: <b>Livin' on a Prayer</b> — Bon Jovi. Committee anthem, non-negotiable, requested by the Chairman himself.</p>
    <button class="btn" id="breakDone" style="margin-top:16px" disabled>Back to the Console</button></div>`;
  document.body.appendChild(el);
  playSound('bonjovi');
  // the countdown survives refreshes/re-renders — stored per break, so a
  // reload at 1:59 doesn't hold the room another two minutes (sol mock-night)
  const breakKey = `${LS_NS}-break-${n}-${state.draftPool?.at || 0}`;
  let opened = +localStorage.getItem(breakKey) || 0;
  if (!opened) { opened = Date.now(); try { localStorage.setItem(breakKey, opened); } catch { /* private mode */ } }
  const bd = $('#breakDone');
  const tick = setInterval(() => {
    if (!document.body.contains(bd)) { clearInterval(tick); return; }
    const left = Math.max(0, DRINKS_BREAK_MS - (Date.now() - opened));
    if (!left) { bd.disabled = false; bd.textContent = 'Back to the Console'; clearInterval(tick); return; }
    bd.textContent = `Halfway there… ${Math.floor(left / 60000)}:${String(Math.ceil(left / 1000) % 60).padStart(2, '0')}`;
  }, 500);
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
  if ((p.status === 'i' || p.status === 's' || p.status === 'u') && pk.n <= state.managers.length * 8) {
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
      const N = { G4: 392, A4: 440, B4: 494, D5: 587 };
      const riff = [
        ['G4', 0, .28], ['A4', .3, .28], ['B4', .62, .55],          // whoa-oh-oh
        ['B4', 1.35, .18], ['B4', 1.56, .18], ['A4', 1.77, .18], ['G4', 1.98, .18], ['A4', 2.2, .5], // we're half way there
        ['G4', 2.95, .28], ['A4', 3.25, .28], ['D5', 3.57, .6],     // whoa-OH
        ['B4', 4.25, .18], ['A4', 4.46, .18], ['G4', 4.67, .18], ['A4', 4.9, .7], // livin' on a prayer
      ];
      for (const [note, at, dur] of riff) tone(c, N[note], at, dur, { type: 'sawtooth', gain: 0.05 });
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
let poolFilter = { q: '', team: '', pos: '', sort: 'pts', limit: 60 };
// which squad the side panel shows: yours, or the man on the clock's (Ben +
// Marc, mock night: both, clearly labelled, yours first)
let draftSquadTab = 'mine';
function squadPanelHtml() {
  const meValid = netOn() && whoami && whoami !== -1;
  const showMid = meValid && draftSquadTab === 'mine' ? whoami : currentManagerId();
  if (showMid == null) return '<span class="muted">No one on the clock.</span>';
  const tabs = meValid ? `<div style="display:flex;gap:6px;margin-bottom:8px">
      <button class="btn small ${draftSquadTab === 'mine' ? '' : 'ghost'}" data-sqtab="mine">My squad</button>
      <button class="btn small ${draftSquadTab === 'clock' ? '' : 'ghost'}" data-sqtab="clock">On the clock</button>
    </div>` : '';
  return `${tabs}<h2>${esc(managerName(showMid))}'s squad${meValid && showMid === whoami ? ' <span class="tag">you</span>' : ''}</h2>
    <div class="quota-bar">${quotaPills(showMid)}</div>
    ${managerSquad(showMid).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos]).map(p => `
      <div class="srow"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${kitImg(p.team, p.pos === 'GK', p)}${pname(p)}</div>
    `).join('') || '<span class="muted">No picks yet</span>'}`;
}

function viewDraft() {
  if (state.phase === 'season') return viewDraftRecap();
  const mid = currentManagerId();
  const n = pickNo();
  const round = Math.floor(n / state.managers.length) + 1;
  const taken = draftedIds();

  // personal state: is it MY pick, and if not, how many picks until it is?
  const iAmUp = netOn() && whoami && whoami !== -1 && mid === whoami;
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
  const whoLine = iAmUp
    ? `<span class="oc-label" style="color:var(--accent)">&#9201; YOUR PICK</span><span class="oc-name" style="color:var(--accent)">${esc(managerName(mid))}, you're on the clock</span>`
    : `<span class="oc-label">ON THE CLOCK</span><span class="oc-name">${esc(managerName(mid))}</span>${picksUntilMine ? `<span class="oc-sub">your pick in ${picksUntilMine}${state.settings.pickTimer ? ` (~${Math.ceil(picksUntilMine * state.settings.pickTimer / 60)} min)` : ''}</span>` : ''}`;
  return `
  <div class="on-clock${iAmUp ? ' me-up' : ''}">
    <div class="who">${whoLine}</div>
    ${state.settings.pickTimer ? '<span class="pick-clock" id="pickClock">–:––</span>' : ''}
    <div class="pick-meta">Pick ${n + 1} of ${totalPicks()} &middot; Round ${round} of ${state.settings.squadSize}${(() => {
      // every round has a title sponsor (ledger #5) — the hydration break was never in danger
      const sp = typeof AD_BOARDS !== 'undefined' && AD_BOARDS.length ? AD_BOARDS[(round - 1) % AD_BOARDS.length] : null;
      return sp ? ` &middot; Round ${round} brought to you by <b style="color:${sp.c}">${esc(sp.t)}</b> <span class="muted">— ${esc(sp.s)}</span>` : '';
    })()}</div>
    <div class="oc-btns">
      ${state.settings.pickTimer ? `<button class="btn ghost small" id="timewasteBtn" title="Take it to the corner flag (+60s)">&#8987; Timewaste (${2 - (state.draft.timewastes?.[mid] || 0)} left)</button>` : ''}
      ${!netOn() || isCommissioner() ? `<button class="btn ghost small" id="undoPick" ${n === 0 ? 'disabled' : ''}>Undo last</button>` : ''}
      ${(!netOn() || isCommissioner()) && state.settings.pickTimer ? `<button class="btn ghost small" id="pauseDraft">${state.draft.paused ? '&#9654; Resume' : '&#9208; Pause'}</button>` : ''}
      <button class="btn ghost small" id="autoPick" title="Your autopick list first, then best available. Only the manager on the clock (or the Chairman) can press it.">&#129302; Autopick</button>
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
      ${whoami && whoami !== -1 ? `<div class="card queue-card">
        <h2>My autopick list <span class="tag">${toArr(state.autolists?.[whoami]).length}</span></h2>
        <p class="muted" style="font-size:11.5px;margin-bottom:8px">Your ranked shortlist. If your clock hits zero, the top available pick goes in. Drag players across, or &#9734; them in the pool.</p>
        ${autolistRows()}
      </div>` : ''}
      <div class="card side-squad" id="sideSquad">
        ${squadPanelHtml()}
      </div>
      ${punditryDesk()}
      <div class="card">
        <h2>Pick history</h2>
        <div class="pick-log">
          ${[...state.draft.picks].reverse().slice(0, 40).map(pk => {
            const p = PLAYER_BY_ID[pk.playerId];
            return `<div class="lrow"><span class="muted">#${pk.n}</span><b>${esc(managerName(pk.managerId))}</b> ${flagImg(p.team)} ${pname(p)}</div>`;
          }).join('') || '<span class="muted">First pick incoming…</span>'}
        </div>
      </div>
    </div>
  </div>
  ${queueDrawerHtml()}
  ${squadDrawerHtml()}`;
}

// the pre-season Draft Console: same pool, same queue, no clock. The lads do
// their homework here and the list is waiting when the real board opens.
function viewDraftPrep() {
  const canQueue = whoami && whoami !== -1;
  return `
  <div class="card" style="margin-bottom:14px">
    <h2>The Draft Console &mdash; scouting floor</h2>
    <p class="rules-p">The draft hasn&rsquo;t started. Until it does, this is where the homework happens: browse the pool, &#9733; star your targets and put them in order. On the night your list doubles as a shortlist &mdash; and if your clock ever hits zero, the top available name on it goes in automatically.</p>
    ${!canQueue && netOn() ? '<p class="muted" style="margin-top:8px">Sign in (top right) to build your list &mdash; it saves to your account and will be waiting on draft night.</p>' : ''}
  </div>
  <div class="draft-layout">
    <div class="card" id="poolCard">
      ${poolControlsHtml(PLAYERS.length)}
      ${poolTable()}
    </div>
    <div class="draft-side">
      <div class="card queue-card">
        <h2>My autopick list${canQueue ? ` <span class="tag">${toArr(state.autolists?.[whoami]).length}</span>` : ''}</h2>
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
function bindDraftPrep() { bindPoolControls(); }

// shared by the live console and the scouting floor
function poolControlsHtml(availableCount) {
  const teamsOpts = [...TEAMS].sort((a, b) => a.name.localeCompare(b.name)).map(t => `<option value="${esc(t.name)}" ${poolFilter.team === t.name ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  return `<div class="pool-controls">
    <input type="text" id="poolQ" placeholder="Search ${availableCount} available players…" value="${esc(poolFilter.q)}">
    <select id="poolTeam"><option value="">All clubs</option>${teamsOpts}</select>
    <select id="poolPos">
      <option value="">All positions</option>
      ${['GK', 'DF', 'MF', 'FW'].map(p => `<option ${poolFilter.pos === p ? 'selected' : ''}>${p}</option>`).join('')}
    </select>
    ${state.phase === 'draft' ? `<select id="poolScope" title="Show drafted players too — dimmed, with who took them">
      <option value="avail" ${poolFilter.scope !== 'all' ? 'selected' : ''}>Available</option>
      <option value="all" ${poolFilter.scope === 'all' ? 'selected' : ''}>Everyone (incl. drafted)</option>
    </select>` : ''}
  </div>`;
}
function queueDrawerHtml() {
  if (!whoami || whoami === -1) return '';
  return `
  <button class="btn queue-fab" id="queueFab">&#9733; Queue <span class="tag">${toArr(state.autolists?.[whoami]).length}</span></button>
  <div class="queue-drawer${window._queueOpen ? ' open' : ''}" id="queueDrawer">
    <h2 style="display:flex;align-items:center">My autopick queue <span class="tag" style="margin-left:8px">${toArr(state.autolists?.[whoami]).length}</span>
      <button class="btn ghost small" id="queueClose" style="margin-left:auto">&#10005;</button></h2>
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
function autolistRows() {
  const list = toArr(state.autolists?.[whoami]);
  return list.map((pid, k) => {
    const p = PLAYER_BY_ID[pid];
    if (!p) return '';
    // pre-draft nobody is gone and every squad is empty — the flags only mean
    // something once the board is live
    const live = state.phase === 'draft';
    const gone = live && draftedIds().has(pid);
    const wontFit = live && !gone && !canPick(whoami, p);
    return `<div class="lrow qrow" draggable="true" data-qdrag="${k}" style="font-size:12.5px${gone ? ';opacity:.45;text-decoration:line-through' : ''}">
      <span class="muted">#${k + 1}</span> <span class="pos-badge pos-${p.pos}">${p.pos}</span> ${pname(p)}
      ${gone ? '<span class="tag gone-tag" title="Already drafted — autopick skips him">GONE</span>' : ''}${wontFit ? '<span class="tag warn-tag" title="Your squad is full at this position — autopick skips him">won&rsquo;t fit</span>' : ''}
      <span style="margin-left:auto;display:flex;gap:4px">
        <button class="btn ghost small" data-autoup="${k}" ${k === 0 ? 'disabled' : ''}>&#9650;</button>
        <button class="btn ghost small" data-autodown="${k}" ${k === list.length - 1 ? 'disabled' : ''}>&#9660;</button>
        <button class="btn ghost small" data-autodel="${k}">&#10005;</button>
      </span></div>`;
  }).join('') || '<span class="muted" style="font-size:12px">Empty. Brave.</span>';
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
  const el = document.createElement('div');
  el.className = 'heckle-flash' + (onClock ? ' heckle-you' : '');
  el.innerHTML = `<span class="hk-who">${esc(managerName(mid))}</span> &ldquo;${esc(txt)}&rdquo;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), onClock ? 6000 : 4000);
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
    <h2>&#128227; The heckle desk</h2>
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
    for (const k of KLAXONS) {
      if (k.mid !== pk.managerId) continue;
      if (k.club && p.team !== k.club) continue;
      if (k.pos && p.pos !== k.pos) continue;
      if (k.names) {
        const full = ((p.full || '') + ' ' + (p.name || '')).toLowerCase();
        if (!k.names.some(n => full.includes(n))) continue;
      }
      klaxonFlash(k, p);
    }
  }
  window._klaxSeen = picks.length;
}
function klaxonFlash(k, p) {
  const el = document.createElement('div');
  el.className = 'heckle-flash klaxon-flash';
  el.innerHTML = `<span class="hk-who">${esc(k.label)}</span> ${esc(p.name)} &mdash; ${esc(k.line)}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6500);
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
  const { posMin, posMax } = state.settings, c = posCount(mid);
  return ['GK', 'DF', 'MF', 'FW'].map(p =>
    `<span class="quota-pill ${c[p] >= posMax[p] ? 'full' : ''}" title="min ${posMin[p]}, max ${posMax[p]}">${p} ${c[p]}/${posMax[p]}</span>`).join('');
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
    if (f.finished) continue;
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
    m = { pts, apps: agg.app, min, f5, gw: gwPlayerPoints(p.id, currentGwIndex()), g: agg.g, a: agg.a, cs: agg.cs, ppg: agg.app ? pts / agg.app : 0, xgi: (p.xg || 0) + (p.xa || 0), price: p.price };
  } else {
    // pre-season: FPL's own aggregates until the July wipe, the archive after
    const ls = FPL_WIPED ? lastSeasonOf(p) : null;
    m = ls
      ? { pts: ls.pts, apps: Math.round((ls.mp || 0) / 90), min: ls.mp || 0, f5: 0, gw: 0, g: ls.g || 0, a: ls.a || 0, cs: ls.cs || 0, ppg: ls.ppg || 0, xgi: ls.xgi || 0, price: p.price }
      : { pts: rating(p), apps: Math.round((p.mp || 0) / 90), min: p.mp || 0, f5: 0, gw: 0, g: p.g || 0, a: p.a || 0, cs: p.cs || 0, ppg: p.ppg || 0, xgi: (p.xg || 0) + (p.xa || 0), price: p.price };
  }
  m.xp1 = projPts(p, 1); m.xp3 = projPts(p, 3); m.xp6 = projPts(p, 6);
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
// the full column menu, Draft Fantasy style; users pick their own set (kept per device)
const ALL_STAT_COLS = live => [
  { k: 'vs', h: 'Vs', t: 'Next fixture (H/A) — coloured by how scary they are', v: (m, p) => { const t = nextFx(p.team); const opp = t.endsWith('(H)') || t.endsWith('(A)') ? Object.keys(TEAM_BY_NAME).find(n => TEAM_BY_NAME[n].short === t.slice(0, -4).trim()) : null; return opp ? `<span class="${fdrCls(opp)}">${t}</span>` : t; }, cls: ' muted', sortable: false },
  // FPL price column RETIRED (Lee read '£m' as transfer fees — there is no
  // money in this league; do not resurrect)
  { k: 'apps', h: live ? 'Apps' : '90s', t: live ? 'Appearances' : 'Minutes ÷ 90, last season', v: m => m.apps },
  { k: 'min', h: 'MP', t: 'Minutes played', v: m => m.min },
  { k: 'g', h: 'G', t: 'Goals', v: m => m.g },
  { k: 'a', h: 'A', t: 'Assists', v: m => m.a },
  { k: 'cs', h: 'CS', t: 'Clean sheets', v: m => m.cs },
  { k: 'xgi', h: 'xGI', t: 'Expected goals + assists', v: m => m.xgi.toFixed(1), cls: ' muted' },
  { k: 'f5', h: 'F5', t: 'Form — average points over the last five gameweeks (league scoring)', v: m => m.f5.toFixed(1) },
  { k: 'xp1', h: 'P1', t: 'Projected points — next gameweek (per-game expectation × scheduled fixtures)', v: m => m.xp1.toFixed(1), cls: ' muted' },
  { k: 'xp3', h: 'P3', t: 'Projected points — next three gameweeks (blanks and doubles counted)', v: m => m.xp3.toFixed(1), cls: ' muted' },
  { k: 'xp6', h: 'P6', t: 'Projected points — next six gameweeks (blanks and doubles counted)', v: m => m.xp6.toFixed(1), cls: ' muted' },
  { k: 'gw', h: 'GW', t: 'Points this gameweek', v: m => m.gw },
  { k: 'ppg', h: 'PPG', t: live ? 'League points per appearance' : 'FPL points per game, last season', v: m => m.ppg.toFixed(1) },
  { k: 'pts', h: 'Pts', t: live ? 'Points under league scoring' : 'Total FPL points, last season', v: m => m.pts, cls: ' gold' },
];
const DEFAULT_COL_KEYS = live => live
  ? ['vs', 'apps', 'g', 'a', 'cs', 'xgi', 'f5', 'gw', 'ppg', 'pts']
  : ['vs', 'apps', 'g', 'a', 'cs', 'xgi', 'ppg', 'pts'];
// phones default to the essentials — tap any player for the full story, or
// add columns back via the Columns toggle (a saved preference wins everywhere)
const MOBILE_COL_KEYS = live => live ? ['vs', 'f5', 'ppg', 'pts'] : ['vs', 'ppg', 'pts'];
let _colPrefs;
function visibleColKeys(live) {
  if (_colPrefs === undefined) { try { _colPrefs = JSON.parse(localStorage.getItem('tl2627-cols')); } catch { _colPrefs = null; } }
  return _colPrefs || (matchMedia('(max-width: 700px)').matches ? MOBILE_COL_KEYS(live) : DEFAULT_COL_KEYS(live));
}
const STAT_COLS = live => ALL_STAT_COLS(live).filter(c => visibleColKeys(live).includes(c.k));
window._colsOpen = false;
function colToggleHtml(live) {
  const vis = visibleColKeys(live);
  return `<details class="col-toggle" style="position:relative;margin-left:auto" ${window._colsOpen ? 'open' : ''}>
    <summary class="btn ghost small" style="list-style:none;display:inline-block">Columns &#9881;</summary>
    <div style="position:absolute;right:0;z-index:6;background:#131c31;border:1px solid var(--line);border-radius:10px;padding:10px;display:grid;gap:5px;min-width:230px;box-shadow:0 8px 24px rgba(0,0,0,.5)">
      ${ALL_STAT_COLS(live).map(c => `<label style="font-size:12px;display:flex;gap:7px;align-items:center;cursor:pointer"><input type="checkbox" data-coltoggle="${c.k}" ${vis.includes(c.k) ? 'checked' : ''}> <b style="min-width:30px">${c.h}</b> <span class="muted">${esc(c.t)}</span></label>`).join('')}
    </div>
  </details>`;
}
function bindColToggle(rerender) {
  document.querySelectorAll('.col-toggle').forEach(d => d.ontoggle = () => { window._colsOpen = d.open; });
  document.querySelectorAll('[data-coltoggle]').forEach(cb => cb.onchange = () => {
    const live = seasonHasStats();
    const set = new Set(visibleColKeys(live));
    cb.checked ? set.add(cb.dataset.coltoggle) : set.delete(cb.dataset.coltoggle);
    _colPrefs = ALL_STAT_COLS(live).map(c => c.k).filter(k => set.has(k)); // keep column order
    localStorage.setItem('tl2627-cols', JSON.stringify(_colPrefs));
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
  { id: 'output', name: 'Goals & assists', cols: ['vs', 'apps', 'g', 'a', 'xgi', 'ppg', 'pts'], sort: 'pts' },
];
const SCOUT_SORTS = new Set(['name', 'apps', 'min', 'g', 'a', 'cs', 'xgi', 'f5', 'xp1', 'xp3', 'xp6', 'gw', 'ppg', 'pts']);
const SCOUT_POS = new Set(['', 'GK', 'DF', 'MF', 'FW']);
let scoutActiveView = { draft: '', transfers: '' };
const scoutViewsKey = () => `${LS_NS}-scout-views-${whoami && whoami !== -1 ? whoami : 'guest'}`;
function cleanScoutView(v) {
  if (!v || typeof v !== 'object') return null;
  const name = String(v.name || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  if (!name) return null;
  const allowedCols = new Set(ALL_STAT_COLS(seasonHasStats()).map(c => c.k));
  const cols = toArr(v.cols).filter((k, i, a) => allowedCols.has(k) && a.indexOf(k) === i);
  const sort = SCOUT_SORTS.has(v.sort) ? v.sort : 'pts';
  const pos = SCOUT_POS.has(v.pos) ? v.pos : '';
  const team = TEAM_BY_NAME[v.team] ? v.team : '';
  const scope = v.scope === 'all' ? 'all' : 'free';
  return { id: String(v.id || `${Date.now()}-${Math.random()}`).slice(0, 80), name, cols, sort, pos, team, scope };
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
  return `<div class="scout-desk">
    <span class="scout-title">Scouting desk</span>
    <select data-scout-view aria-label="Open a scouting view">
      <option value="" ${active ? '' : 'selected'}>Open a view…</option>
      <optgroup label="Built in">${SCOUT_PRESETS.map(v => `<option value="preset:${v.id}" ${active === `preset:${v.id}` ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</optgroup>
      ${saved.length ? `<optgroup label="My saved views">${saved.map(v => `<option value="saved:${esc(v.id)}" ${active === `saved:${v.id}` ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</optgroup>` : ''}
    </select>
    <button class="btn ghost small" data-scout-save>Save current</button>
    ${saved.length ? `<button class="btn ghost small" data-scout-delete ${active.startsWith('saved:') ? '' : 'disabled'}>Delete</button>` : ''}
    <span class="muted scout-private">Private to this device</span>
  </div>`;
}
function scoutSnapshot(surface) {
  const src = surface === 'draft' ? poolFilter : transfersView;
  return cleanScoutView({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'view',
    cols: visibleColKeys(seasonHasStats()),
    sort: src.sort,
    pos: src.pos,
    team: surface === 'draft' ? src.team : src.club,
    scope: surface === 'transfers' ? src.scope : 'free',
  });
}
function applyScoutView(v, surface) {
  const clean = cleanScoutView(v);
  if (!clean) return false;
  _colPrefs = clean.cols.length ? clean.cols : DEFAULT_COL_KEYS(seasonHasStats());
  localStorage.setItem('tl2627-cols', JSON.stringify(_colPrefs));
  if (surface === 'draft') {
    poolFilter = { ...poolFilter, team: clean.team, pos: clean.pos, sort: clean.sort, limit: 60 };
  } else {
    transfersView = { ...transfersView, club: clean.team, pos: clean.pos, scope: clean.scope, sort: clean.sort, limit: 20 };
  }
  return true;
}
function bindScoutDesk(surface, rerender) {
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

let scoutCompare = [];
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
  fab.textContent = `Compare ${scoutCompare.length}/3`;
  fab.setAttribute('aria-label', `Compare ${scoutCompare.length} selected players`);
  if (document.getElementById('scoutCompareOverlay')) showScoutCompare(false);
}
function toggleScoutCompare(pid) {
  if (!PLAYER_BY_ID[pid]) return;
  if (scoutCompare.includes(pid)) scoutCompare = scoutCompare.filter(id => id !== pid);
  else if (scoutCompare.length >= 3) { toast('Three is enough for an honest comparison'); return; }
  else scoutCompare = [...scoutCompare, pid];
  paintScoutCompare();
}
function showScoutCompare(addHistory = true) {
  document.getElementById('scoutCompareOverlay')?.remove();
  if (!scoutCompare.length) return;
  const fields = [
    ['Next', p => esc(nextFx(p.team))],
    ['Apps', p => metricsFor(p).apps],
    ['Minutes', p => metricsFor(p).min],
    ['Goals', p => metricsFor(p).g],
    ['Assists', p => metricsFor(p).a],
    ['xGI', p => metricsFor(p).xgi.toFixed(1)],
    ['Form (5)', p => metricsFor(p).f5.toFixed(1)],
    ['PPG', p => metricsFor(p).ppg.toFixed(1)],
    ['League pts', p => `<b class="gold">${metricsFor(p).pts}</b>`],
  ];
  const players = scoutCompare.map(id => PLAYER_BY_ID[id]).filter(Boolean);
  const gws = GAMEWEEKS.slice(currentGwIndex(), currentGwIndex() + 6);
  const ov = document.createElement('div');
  ov.id = 'scoutCompareOverlay';
  ov.className = 'overlay';
  ov.innerHTML = `<div class="card compare-card" role="dialog" aria-modal="true" aria-label="Player comparison">
    <div class="compare-head">
      <div><h2>Scouting comparison <span class="tag">${players.length}/3</span></h2><p class="muted">League scoring only. No bonus. No DEFCON.</p></div>
      <button class="btn ghost small" data-compare-close aria-label="Close comparison">&#10005;</button>
    </div>
    <div class="compare-grid" style="--compare-count:${players.length}">
      ${players.map(p => {
        const owner = compareOwner(p.id);
        return `<section class="compare-player">
          <div class="compare-player-head">${photoImg(p)}<div><h3>${esc(p.name)}</h3><p class="muted">${esc(p.club)} &middot; ${p.pos}</p><p class="muted">${owner ? `Owned by ${esc(teamName(owner.id))}` : 'Free agent'}</p></div></div>
          ${fields.map(([label, val]) => `<div class="compare-row"><span>${label}</span><span>${val(p)}</span></div>`).join('')}
          <div class="compare-runway"><b>Next six</b>${gws.map(g => `<span><small>GW${g.n}</small>${esc(nextOpp(p.team, g.n) || '—')}</span>`).join('')}</div>
          <button class="btn ghost small" data-compare-remove="${p.id}">Remove</button>
        </section>`;
      }).join('')}
    </div>
    <div class="compare-foot"><button class="btn ghost small" data-compare-clear>Clear all</button></div>
  </div>`;
  ov.onclick = e => { if (e.target === ov || e.target.closest('[data-compare-close]')) closeOv(ov); };
  ov.querySelectorAll('[data-compare-remove]').forEach(b => b.onclick = e => { e.stopPropagation(); toggleScoutCompare(+b.dataset.compareRemove); });
  ov.querySelector('[data-compare-clear]').onclick = e => { e.stopPropagation(); scoutCompare = []; paintScoutCompare(); };
  document.body.appendChild(ov);
  if (addHistory) pushOvState();
}

let bulkQueueIds = new Set();

function poolTable() {
  // on the scouting floor (setup phase) there is no board yet: nobody is
  // taken, nobody is on the clock, and the Draft button stays away
  const live = state.phase === 'draft';
  const taken = live ? draftedIds() : new Set();
  const mid = live ? currentManagerId() : null;
  const showGone = live && poolFilter.scope === 'all';
  let rows = showGone ? [...PLAYERS] : PLAYERS.filter(p => !taken.has(p.id));
  if (poolFilter.q) {
    const q = normName(poolFilter.q);
    rows = rows.filter(p => normName(p.name).includes(q) || normName(p.team).includes(q) || normName(p.club).includes(q));
  }
  if (poolFilter.team) rows = rows.filter(p => p.team === poolFilter.team);
  if (poolFilter.pos) rows = rows.filter(p => p.pos === poolFilter.pos);
  const s = poolFilter.sort;
  const cols = STAT_COLS(seasonHasStats());
  rows.sort(metricSort(s));
  const total = rows.length;
  rows = rows.slice(0, poolFilter.limit);
  const canQueue = whoami && whoami !== -1;
  // signed-out on the live site: stars still SHOW (dimmed) and tapping one
  // explains — an invisible feature reads as a broken one (Ben, 2 Aug)
  const showStar = canQueue || netOn();
  const visibleIds = rows.map(p => p.id);
  const selected = [...bulkQueueIds].filter(id => !taken.has(id));
  return `
  <div class="pool-wrap">
  ${scoutViewHtml('draft')}
  <div class="pool-toolbar">
    ${canQueue ? `<div class="bulk-queue">
      <button class="btn ghost small" data-bulk-all="${visibleIds.join(',')}">${visibleIds.length && visibleIds.every(id => bulkQueueIds.has(id)) ? 'Clear page' : 'Select page'}</button>
      <button class="btn small" data-bulk-add ${selected.length ? '' : 'disabled'}>Add ${selected.length || ''} to queue</button>
    </div>` : ''}
    ${colToggleHtml(seasonHasStats())}
  </div>
  <div style="overflow-x:auto">
  <table class="pool-table">
    <thead><tr>
      ${canQueue ? '<th class="bulk-check"><span class="sr-only">Queue selection</span></th>' : ''}
      <th data-sort="name">Player</th><th>Club</th><th>Pos</th>
      <th></th>
      ${cols.map(c => c.sortable === false ? `<th class="num" title="${esc(c.t)}">${c.h}</th>` : `<th class="num" data-sort="${c.k}" title="${esc(c.t)}">${c.h} ${s === c.k ? '▾' : ''}</th>`).join('')}<th class="act"></th>
    </tr></thead>
    <tbody>
      ${rows.map(p => `
      <tr class="${statusClass(p)}${taken.has(p.id) ? ' gone-row' : ''}"${canQueue && !taken.has(p.id) ? ` draggable="true" data-drag="${p.id}"` : ''}>
        ${canQueue ? `<td class="bulk-check"><input type="checkbox" data-bulk-pid="${p.id}" aria-label="Select ${esc(p.name)} for the autopick queue" ${bulkQueueIds.has(p.id) ? 'checked' : ''}></td>` : ''}
        <td class="pcol"><div class="pcell">${photoImg(p)}<div><div class="pname">${natFlag(p)} <span class="pn-txt">${esc(p.name)}</span></div><div class="pclub">${esc(p.full)}</div></div></div></td>
        <td class="muted" style="white-space:nowrap">${flagImg(p.team)} ${esc(p.club)}</td>
        <td><span class="pos-badge pos-${p.pos}">${p.pos}</span></td>
        <td>${statusChip(p)}</td>
        ${cols.map(c => `<td class="num${c.cls || ''}">${c.v(metricsFor(p), p)}</td>`).join('')}
        <td class="act" style="white-space:nowrap">${taken.has(p.id) ? (() => {
          const pk = state.draft.picks.find(x => x.playerId === p.id);
          return pk ? `<span class="tag gone-tag" title="Pick ${pk.n}">#${pk.n} ${esc(teamName(pk.managerId))}</span>` : '<span class="tag gone-tag">GONE</span>';
        })() : `${live ? `<button class="btn small${canPick(mid, p) && canActFor(mid) ? '' : ' dim'}" data-pick="${p.id}">Draft</button>` : ''}${compareButtonHtml(p.id)}${showStar ? `<button class="btn ghost small${canQueue && toArr(state.autolists?.[whoami]).includes(p.id) ? ' star-on' : ''}${canQueue ? '' : ' dim'}" data-auto="${p.id}" title="${canQueue ? 'Add to my autopick list' : 'Sign in to build your list'}">${canQueue && toArr(state.autolists?.[whoami]).includes(p.id) ? '&#9733;' : '&#9734;'}</button>` : ''}`}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  </div>
  ${total > poolFilter.limit ? `<div class="show-more"><button class="btn ghost small" id="showMore">Show more (${total - poolFilter.limit} hidden)</button></div>` : ''}
  </div>`;
}

let clockTimer = null;
let firedDeadline = 0;
let clockArming = false;
function armClock() {
  if (clockArming || !state.settings.pickTimer) return;
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
function draftDeadlineTiming(deadline, now = Date.now()) {
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
      const used = state.draft.timewastes?.[mid] || 0;
      tw.disabled = used >= 2 || !canActFor(mid);
      tw.onclick = () => {
        if ((state.draft.timewastes?.[mid] || 0) >= 2) { toast('No timewastes left — play on'); return; }
        if (netOn()) {
          serverAct('draftAdmin', { op: 'timewaste' })
            .then(() => toast(`${managerName(mid)} is timewasting. Taking it to the corner flag.`))
            .catch(() => {});
          return;
        }
        (state.draft.timewastes = state.draft.timewastes || {})[mid] = (state.draft.timewastes[mid] || 0) + 1;
        state.draft.deadline = (state.draft.deadline || Date.now()) + 60 * 1000;
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
        // one's clock — the first device past the pomp arms it (op idempotent)
        el.textContent = '—'; el.classList.remove('urgent');
        if (el2) el2.textContent = '—';
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
        const mayFire = (rawLeft <= 0 && iAmCommish) || (overBy >= 8 && iAmOnClock);
        if (mayFire) {
          firedDeadline = state.draft.deadline;
          toast('Time! Autopick makes the call.');
          autoPick(true);
        }
      }
    }, 400);
  }
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
  const sf = $('#squadFab'), sd = $('#squadDrawer');
  if (sf) sf.onclick = () => { window._squadOpen = !window._squadOpen; sd?.classList.toggle('open', window._squadOpen); };
  const sc = $('#squadClose');
  if (sc) sc.onclick = () => { window._squadOpen = false; sd?.classList.remove('open'); };
  const apBtn = $('#autoPick');
  if (apBtn) apBtn.onclick = () => {
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
  $('#poolPos').onchange = e => { poolFilter.pos = e.target.value; poolFilter.limit = 60; refreshPool(); };
  const psc = $('#poolScope');
  if (psc) psc.onchange = e => { poolFilter.scope = e.target.value; poolFilter.limit = 60; refreshPool(); };
  bindPoolTable();
  const qf = $('#queueFab'), qd = $('#queueDrawer');
  if (qf) qf.onclick = () => { window._queueOpen = !window._queueOpen; qd?.classList.toggle('open', window._queueOpen); };
  const qc = $('#queueClose');
  if (qc) qc.onclick = () => { window._queueOpen = false; qd?.classList.remove('open'); };
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
  const takenNow = () => state.phase === 'draft' ? draftedIds() : new Set();
  const updateBulkQueue = () => {
    const add = document.querySelector('[data-bulk-add]');
    const selected = [...bulkQueueIds].filter(id => PLAYER_BY_ID[id] && !takenNow().has(id));
    if (add) {
      add.disabled = !selected.length;
      add.textContent = `Add ${selected.length || ''} to queue`;
    }
  };
  document.querySelectorAll('[data-bulk-pid]').forEach(cb => cb.onchange = () => {
    const pid = +cb.dataset.bulkPid;
    cb.checked ? bulkQueueIds.add(pid) : bulkQueueIds.delete(pid);
    updateBulkQueue();
  });
  const all = document.querySelector('[data-bulk-all]');
  if (all) all.onclick = () => {
    const ids = all.dataset.bulkAll.split(',').map(Number).filter(Boolean);
    const clear = ids.length && ids.every(id => bulkQueueIds.has(id));
    ids.forEach(id => clear ? bulkQueueIds.delete(id) : bulkQueueIds.add(id));
    refreshPool();
  };
  const bulkAdd = document.querySelector('[data-bulk-add]');
  if (bulkAdd) bulkAdd.onclick = () => {
    if (!whoami || whoami === -1) return;
    const taken = takenNow();
    const selected = [...bulkQueueIds].filter(id => PLAYER_BY_ID[id] && !taken.has(id));
    const current = toArr(state.autolists?.[whoami]);
    const fresh = selected.filter(id => !current.includes(id));
    if (!fresh.length) { toast('Those players are already queued'); return; }
    bulkQueueIds = new Set();
    setAutolist(whoami, [...current, ...fresh]);
    toast(`${fresh.length} player${fresh.length === 1 ? '' : 's'} added to your autopick queue`);
  };
  document.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => {
    const pid = +b.dataset.pick, mid = currentManagerId(), p = PLAYER_BY_ID[pid];
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
  document.querySelectorAll('[data-autoup]').forEach(b => b.onclick = () => {
    const k = +b.dataset.autoup, arr = [...toArr(state.autolists?.[whoami])];
    if (k < 1) return;
    [arr[k - 1], arr[k]] = [arr[k], arr[k - 1]]; setAutolist(whoami, arr);
  });
  document.querySelectorAll('[data-autodown]').forEach(b => b.onclick = () => {
    const k = +b.dataset.autodown, arr = [...toArr(state.autolists?.[whoami])];
    if (k >= arr.length - 1) return;
    [arr[k], arr[k + 1]] = [arr[k + 1], arr[k]]; setAutolist(whoami, arr);
  });
  document.querySelectorAll('[data-sort]').forEach(th => th.onclick = () => { poolFilter.sort = th.dataset.sort; refreshPool(); });
  bindColToggle(refreshPool);
  bindQueueDnD();
  const sm = $('#showMore');
  if (sm) sm.onclick = () => { poolFilter.limit += 100; refreshPool(); };
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
  return `<div class="card"><h2>The Draft Console &mdash; draft archive</h2>
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
  if (teamView.gw == null) teamView.gw = currentGwIndex();
  const mid = teamView.mid, gw = teamView.gw;
  const squad = squadAt(mid, gw).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos] || rating(b) - rating(a));
  const xi = lineupFor(mid, gw);
  const counts = xiCounts(xi);
  const valid = xiValid(xi);
  // lineups lock at the gameweek deadline, like the real thing
  const locked = !demoMode && gwHasStarted(gw);
  const cur = currentGwIndex();
  const ownedNow = ownedIdsAt(cur);

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
    <select id="teamGw" aria-label="Gameweek">${GAMEWEEKS.map((g, i) => `<option value="${i}" ${i === gw ? 'selected' : ''}>GW${g.n} — ${g.label}${i === cur ? ' (current)' : ''}</option>`).join('')}</select>
    <span class="tag">${locked ? (gwIsOver(gw) ? 'Gameweek finished — locked' : 'Deadline passed — locked') : `Lineup open — locks ${new Date(gwFrom(gw)).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}</span>
    <span class="tag">GW points: <b class="gold">&nbsp;${gwManagerPoints(mid, gw)}</b></span>
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
      return `${winProbBar(oppMid, mid, gw, mid)}<div class="duel-grid"><div class="duel-side">
        <h3 style="text-align:center">${kitSvg(oppMid)} ${esc(teamName(oppMid))} <b class="gold">${gwUnderway(gw) ? gwManagerPoints(oppMid, gw) : projectedGwScore(oppMid, gw)}</b></h3>
        ${adStrip(oppMid * 37 + gw, 3, oppMid)}
        <div class="pitch">${['GK', 'DF', 'MF', 'FW'].map(pos => `<div class="pitch-row">${oxi.map(pid => PLAYER_BY_ID[pid]).filter(p => p.pos === pos).map(p => `
          <div class="pitch-chip ${statusClass(p)}" data-pcard="${p.id}" style="cursor:pointer">
            ${kitImg(p.team, p.pos === 'GK')}
            <span class="pitch-name">${esc(p.name)}</span>
            ${!gwUnderway(gw) ? `<span class="pitch-vs">${nextOppHtml(p.team, GAMEWEEKS[gw].n)}</span>` : `<span class="pitch-vs">${gwPlayerPoints(p.id, gw)} pts</span>`}
          </div>`).join('') || '<span class="muted" style="font-size:11px">—</span>'}</div>`).join('')}</div>
        <div class="bench-strip">
          <span class="muted" style="font-size:11px;font-weight:700;align-self:center">BENCH</span>
          ${benchFor(oppMid, gw).map((p, bi) => `
            <div class="pitch-chip benched ${statusClass(p)}" data-pcard="${p.id}" style="cursor:pointer" title="${esc(p.name)} — auto-sub priority ${bi + 1}">
              <span class="tag" style="font-size:9px;padding:1px 5px">${bi + 1}</span>
              ${kitImg(p.team, p.pos === 'GK')}
              <span class="pitch-name">${esc(p.name)}</span>
              ${gwUnderway(gw) ? `<span class="mu-pts">${gwPlayerPoints(p.id, gw)}</span>` : ''}
            </div>`).join('') || '<span class="muted" style="font-size:11px">an empty bench</span>'}
        </div>
      </div><div class="duel-side">
        <h3 style="text-align:center">${kitSvg(mid)} ${esc(teamName(mid))} <b class="gold">${gwUnderway(gw) ? gwManagerPoints(mid, gw) : projectedGwScore(mid, gw)}</b></h3>`;
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
          ${gwUnderway(gw) ? `<span class="mu-pts">${gwPlayerPoints(p.id, gw)}</span>` : ''}
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
          return `<div style="margin-bottom:10px">${strip}</div>` +
            rows.slice(-6).reverse().map(r => `<div class="lrow" style="font-size:12.5px;justify-content:space-between"><span><span class="form-pill form-${r.res}">${r.res}</span> GW${GAMEWEEKS[r.i].n} v ${esc(teamName(r.op))}</span><b>${r.pm}&ndash;${r.po}</b></div>`).join('') +
            `<p class="muted" style="font-size:11.5px;margin-top:8px">Season points: <b style="color:var(--text)">${managerPoints(mid)}</b> &middot; H2H scoring: ${season}</p>`;
        })()}
      </div>
    </div>
  </div>
  ${nextSixCard(mid)}`;
}

/* ----- Next Six: the current squad's fixture runway. Deliberately small —
   no planning state, no hypotheticals, no crystal ball. Reads the calendar
   through teamFixturesInGw like everything else. ----- */
const NEXT6_KEY = `${LS_NS}-next6-open`;
function nextSixCard(mid) {
  const cur = currentGwIndex();
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
      toast(`Saved. ${gwHasStarted(gw) ? 'This gameweek is locked though.' : `Locks ${fmtWhen(gwFrom(gw))}.`}`);
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
    toast(`Saved. ${gwHasStarted(gw) ? 'This gameweek is locked though.' : `Locks ${fmtWhen(gwFrom(gw))}.`}`);
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
    const cur2 = currentGwIndex();
    const v = prompt(`Squad number for ${PLAYER_BY_ID[pid].name} (1–99):`, shirtNum(mid, pid));
    if (v == null) return;
    const n = Math.round(+v);
    if (!n || n < 1 || n > 99) { toast('Numbers 1–99 only'); return; }
    const clash = squadAt(mid, cur2).find(x => x.id !== pid && +shirtNum(mid, x.id) === n);
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
let transfersView = { tab: 'trough', out: null, pos: '', club: '', scope: 'free', sort: 'pts', limit: 20, blockPick: false };
function viewTransfers() {
  const mid = (whoami && whoami !== -1) ? whoami : state.managers[0].id;
  const cur = currentGwIndex();
  const ownedNow = ownedIdsAt(cur);
  const tabs = [['trough', 'The Trough & Waivers'], ['trades', 'Trade desk'], ['history', 'History'], ['order', 'Waiver order']];
  const tab = transfersView.tab;
  const pendingIn = toArr(state.trades).filter(t => t.status === 'pending' && t.to === mid).length;
  const head = `<div class="team-controls card">
    ${tabs.map(([id, label]) => `<button class="btn small ${tab === id ? '' : 'ghost'}" data-trtab="${id}">${label}${id === 'trades' && pendingIn ? ` <span class="tag live-tag">${pendingIn}</span>` : ''}</button>`).join('')}
    <span class="tag" style="margin-left:auto">acting as ${esc(managerName(mid))}</span>
  </div>`;
  // your own squad, always in view while you deal (Ben, mock night: "i dont
  // like that you cant see your team on the transfer page")
  const mySquadCard = (() => {
    if (netOn() && (!whoami || whoami === -1)) return '';
    const sq = squadAt(mid, cur).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos]);
    if (!sq.length) return '';
    return `<details class="card" style="margin-bottom:14px" ${window._trSquadOpen ? 'open' : ''} id="trMySquad">
      <summary style="cursor:pointer;font-weight:800">&#128101; ${esc(teamName(mid))} — my squad <span class="tag">${sq.length}</span> <span class="muted" style="font-weight:400;font-size:11.5px">tap to ${window._trSquadOpen ? 'hide' : 'view'}</span></summary>
      <div class="quota-bar" style="margin:8px 0 4px">${quotaPills(mid)}</div>
      <div class="side-squad">${sq.map(p => `
        <div class="srow"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${kitImg(p.team, p.pos === 'GK', p)}${pname(p)}<span class="muted" style="margin-left:auto;font-size:11px">${metricsFor(p).pts} pts</span></div>`).join('')}
      </div>
    </details>`;
  })();
  // trough tab: the squad as a pitch, not a list — tap the man who makes way
  // (Ben: "you should see your squad as a lineup pitch style rather than list")
  const myPitchCard = (() => {
    if (netOn() && (!whoami || whoami === -1)) return '';
    const sq = squadAt(mid, cur);
    if (!sq.length) return '';
    return `<div class="card" style="margin-bottom:14px">
      <h2>&#128101; ${esc(teamName(mid))} <span class="muted" style="font-weight:400;font-size:12px">tap the player who makes way</span></h2>
      <div class="quota-bar" style="margin:2px 0 8px">${quotaPills(mid)}</div>
      <div class="pitch mu-pitch">
        ${['GK', 'DF', 'MF', 'FW'].map(pos => `<div class="pitch-row">${sq.filter(p => p.pos === pos).map(p => `
          <div class="pitch-chip ${statusClass(p)} ${transfersView.out === p.id ? 'sel' : ''}" data-trout="${p.id}" title="${esc(p.name)} — ${transfersView.out === p.id ? 'tap to keep him' : 'tap to put him up'}">
            ${kitImg(p.team, p.pos === 'GK')}
            <span class="pitch-name">${esc(p.name)}</span>
            <span class="pitch-vs">${metricsFor(p).pts} pts</span>
          </div>`).join('') || '<span class="muted" style="font-size:11px">—</span>'}</div>`).join('')}
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
        ${canActFor(actor) ? `
        <select id="wdOut" style="width:100%;max-width:420px;margin:8px 0;display:block">
          <option value="">Player out…</option>
          ${squadAt(actor, cur).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos]).map(pp => `<option value="${pp.id}">${pp.pos} — ${esc(pp.name)} (${esc(pp.club)})</option>`).join('')}
        </select>` : `<p class="muted" style="font-size:12px">Lean on them in the group chat.</p>`}
        <div class="pick-log" style="max-height:320px">
          ${[...arrivals].sort(metricSort('pts')).map(p => `<div class="lrow"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${photoImg(p)} ${pname(p)} ${statusChip(p)} <span class="muted" style="font-size:11px">${esc(p.club)} · ${metricsFor(p).pts} pts</span>
            <button class="btn small" style="margin-left:auto" data-wdin="${p.id}" ${canActFor(actor) ? '' : `disabled title="It's ${esc(managerName(actor))}'s turn"`}>Sign</button></div>`).join('') || '<span class="muted">No arrivals left.</span>'}
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
        <p class="muted" style="font-size:12.5px">Anyone who joined a Premier League club after draft night is locked until the transfer window shuts. The Chairman then runs the <b>Window Draft</b> — first pick goes to whoever picked last on draft night, snaking back up. Leftovers spill into the Trough.</p>
        <p style="font-size:12px;margin-top:6px"><b>In the holding pen:</b> ${[...arrivals].sort(metricSort('pts')).slice(0, 15).map(p => `${pname(p)} <span class="muted">(${esc(p.club)})</span>`).join(' · ')}${arrivals.length > 15 ? ` <span class="muted">+${arrivals.length - 15} more</span>` : ''}</p>
        ${netOn() && !isCommissioner() ? '' : `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          <button class="btn small" id="wdStart">Start the Window Draft</button>
          <button class="btn ghost small" id="wdRelease">Skip it — release all to the Trough</button>
        </div><p class="muted" style="font-size:10.5px;margin-top:4px">Chairman's office. Wait for the window to actually shut.</p>`}
      </div>`;
    }
    const ctl = waiverControl();
    const claims = myClaims(mid);
    const nextRun = nextWaiverRun(Math.max(lastWaiverRun(), Date.now()));
    const tw = troughWindow();
    // the state of play, spelled out (mock night: "it just doesn't know when
    // players go on waivers") — closed window means EVERYONE free is claim-only
    // the chamber outranks manual controls in ENFORCEMENT, so it must outrank
    // them here too — "THROWN OPEN" during a live mock was a lie (sol r2 P2)
    const status = tw.mock ? `<span class="tag live-tag">TROUGH SHUT — ${esc(tw.why)}</span> <span class="tag">every free agent is claim-only until the run</span>`
      : ctl === 'closed' ? '<span class="tag">CLOSED by the Chairman</span>'
      : ctl === 'open' ? '<span class="tag">THROWN OPEN — everything is free</span>'
      : !tw.open ? `<span class="tag live-tag">TROUGH SHUT — ${esc(tw.why)}</span> <span class="tag">every free agent is on waivers${tw.until ? ` · clears ${fmtWhen(tw.until)}` : ' until the run'}</span>`
      : `<span class="tag">open — drops sit on waivers until ${fmtWhen(nextRun)}</span>`;
    const claimRows = claims.map((c, k) => `
      <div class="lrow claim-row" style="font-size:12.5px" draggable="true" data-cdrag="${k}">
        <span class="muted" style="cursor:grab" title="Drag to reorder">&#8942; #${k + 1}</span> <b>${pname(PLAYER_BY_ID[c.in])}</b>
        <span class="muted">in, ${pname(PLAYER_BY_ID[c.out])} out</span>
        <span style="margin-left:auto;display:flex;gap:4px" class="claim-btns">
          <button class="btn ghost small" data-claimup="${k}" title="Raise priority" ${k === 0 ? 'disabled' : ''}>&#9650;</button>
          <button class="btn ghost small" data-claimdn="${k}" title="Lower priority" ${k === claims.length - 1 ? 'disabled' : ''}>&#9660;</button>
          <button class="btn ghost small" data-claimdel="${k}" title="Withdraw">&#10005;</button>
        </span>
      </div>`).join('');
    return `${head}${myPitchCard}${wdCard}<div class="card">
      <h2>Waivers &amp; The Trough ${status}</h2>
      <p class="muted" style="font-size:12px;margin-bottom:10px">Tap your <b>player out</b> on the pitch above, then <b>Sign</b> the one you want — instant if free, a blind claim if on waivers.</p>
      ${claims.length ? `<h3>${esc(managerName(mid))}'s claims</h3>${claimRows}` : ''}
      ${ctl === 'closed' ? '<p class="muted" style="font-size:12.5px">The Trough is closed. Complaints to the group chat.</p>' : `
      <input type="text" id="trSearch" placeholder="Search the Trough — ${PLAYERS.length - ownedNow.size} players sniffing about…" style="width:100%;max-width:420px;margin-bottom:8px;display:block">
      <div id="trResults" class="pick-log" style="max-height:600px"></div>`}
      ${netOn() && isCommissioner() ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        <button class="btn small" id="runWaivers">Run waivers now</button>
        <button class="btn ghost small" id="ctlOpen" ${ctl === 'open' ? 'disabled' : ''}>Open Trough</button>
        <button class="btn ghost small" id="ctlClosed" ${ctl === 'closed' ? 'disabled' : ''}>Close Trough</button>
        <button class="btn ghost small" id="ctlAuto" ${ctl === 'auto' ? 'disabled' : ''}>Follow schedule</button>
      </div><p class="muted" style="font-size:10.5px;margin-top:4px">Chairman's office. Overrides apply to everyone, immediately.</p>`
      : demoMode ? `<div style="margin-top:10px">
        <button class="btn small" id="runWaivers">&#9889; Run waivers now (demo)</button>
        <p class="muted" style="font-size:10.5px;margin-top:4px">In the real league waivers run on the fixture clock — the evening after a gameweek finishes and the evening before the next kicks off. In the demo you ARE the Chairman: lodge a claim on anyone marked "waivers", then run the round and watch it resolve.</p>
      </div>` : ''}
    </div>`;
  }
  if (tab === 'trades') {
    const block = state.managers.flatMap(m => blockList(m.id).map(pid => ({ mid: m.id, p: PLAYER_BY_ID[pid] })).filter(x => x.p));
    return `${head}${mySquadCard}<div class="card" style="margin-bottom:14px">
      <h2>The Transfer List <span class="muted" style="font-weight:400;font-size:12px">publicly up for grabs — make an offer</span></h2>
      ${block.length ? block.map(({ mid: bm, p }) => `<div class="lrow" style="font-size:12.5px">
        <span class="pos-badge pos-${p.pos}">${p.pos}</span>${photoImg(p)} ${pname(p)} <span class="muted" style="font-size:11px">${esc(p.club)} · ${metricsFor(p).pts} pts</span>
        <b style="margin-left:6px">${esc(teamName(bm))}</b>
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
      <h2>Trade desk</h2>
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
    const rows = [...state.transfers].reverse().map(t => `<div class="lrow" style="font-size:12.5px">
      <span class="muted" style="width:44px">GW${GAMEWEEKS[t.gw].n}</span>
      <span class="tag">${t.trade ? 'trade' : t.waiver ? 'waiver' : t.windowDraft ? 'window' : 'trough'}</span>
      <b style="min-width:120px">${esc(teamName(t.managerId))}</b>
      ${pname(PLAYER_BY_ID[t.outId])} <span class="muted">→</span> <b>${pname(PLAYER_BY_ID[t.inId])}</b>
    </div>`).join('');
    return `${head}<div class="card"><h2>Every move, on the record</h2>${rows || '<p class="muted">Nothing yet. Cowards.</p>'}</div>`;
  }
  // order
  const order = waiverOrder();
  const claimCounts = state.managers.map(m => ({ m, n: myClaims(m.id).length }));
  const waiverHist = state.transfers.filter(t => t.waiver);
  return `${head}<div class="card">
    <h2>Waiver order <span class="tag">bottom of the table feeds first</span></h2>
    ${order.map((om, k) => `<div class="lrow"><span class="muted">#${k + 1}</span> <b>${esc(teamName(om))}</b> <span class="muted" style="font-size:11.5px">${esc(managerName(om))}</span>
      <span style="margin-left:auto" class="muted">${claimCounts.find(c => c.m.id === om)?.n || 0} claim${(claimCounts.find(c => c.m.id === om)?.n || 0) === 1 ? '' : 's'} pending</span></div>`).join('')}
    <p class="muted" style="font-size:11px;margin-top:8px">Claims are blind — counts are public, targets are not. Next run: ${fmtWhen(nextWaiverRun(Math.max(lastWaiverRun(), Date.now())))}.</p>
    <h3 style="margin-top:16px">Waiver history</h3>
    ${waiverHist.length ? [...waiverHist].reverse().map(t => `<div class="lrow" style="font-size:12.5px"><span class="muted">GW${GAMEWEEKS[t.gw].n}</span> <b>${esc(teamName(t.managerId))}</b> claimed ${pname(PLAYER_BY_ID[t.inId])} <span class="muted">(${pname(PLAYER_BY_ID[t.outId])} out)</span></div>`).join('') : '<p class="muted" style="font-size:12px">No claims have landed yet.</p>'}
  </div>`;
}
function bindTransfers() {
  const mid = (whoami && whoami !== -1) ? whoami : state.managers[0].id;
  const cur = currentGwIndex();
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
    const actor = wdActor();
    if (!actGuard(actor, 'window draft')) return;
    const outId = +($('#wdOut')?.value || 0);
    if (!outId) { toast('Pick who goes out first'); return; }
    const inP = PLAYER_BY_ID[+b.dataset.wdin];
    const tgw = transferGw();
    if (!squadShapeOk([...squadAt(actor, tgw).filter(x => x.id !== outId), inP])) { toast('Breaks the squad position limits'); return; }
    if (!await confirmSheet({
      title: 'Window Draft signing',
      body: dealRows([PLAYER_BY_ID[outId]], [inP]),
      yes: `Sign ${esc(inP.name)}`,
      note: 'Done the moment you confirm — and your turn is used.',
    })) return;
    if (netOn()) {
      serverAct('windowDraft', { op: 'pick', inId: inP.id, outId, expectedTurn: state.windowDraft?.turn || 0 })
        .then(() => toast(`${inP.name} signed in the Window Draft. ${PLAYER_BY_ID[outId]?.name} makes way.`))
        .catch(() => {});
      return;
    }
    txnArray('transfers', arr => {
      const owned = ownedIdsGiven(arr, tgw);
      if (owned.has(inP.id) || !owned.has(outId)) return null;
      return [...arr, { managerId: actor, outId, inId: inP.id, gw: tgw, n: arr.length + 1, t: Date.now(), windowDraft: true }];
    }).then(ok => {
      if (!ok) { toast(`${inP.name} is already spoken for — pick again.`); render(); return; }
      const lu = state.lineups[actor]?.[tgw];
      if (lu) {
        state.lineups[actor][tgw] = lu.filter(id => id !== outId);
        pushShared(`lineups/${actor}/${tgw}`, state.lineups[actor][tgw]);
      }
      toast(`${inP.name} signed in the Window Draft. ${PLAYER_BY_ID[outId]?.name} makes way.`);
      wdAdvance(false, { mid: actor, in: inP.id, out: outId });
    });
  });
  // --- waivers & the Trough ---
  const search = $('#trSearch'), results = $('#trResults');
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
  if (rw) rw.onclick = () => { if (confirm('Run waivers now for everyone? Claims resolve in reverse table order and the Trough opens.')) processWaivers(true); };
  ['open', 'closed', 'auto'].forEach(m => { const b = $(`#ctl${m[0].toUpperCase()}${m.slice(1)}`); if (b) b.onclick = () => setWaiverControl(m); });
  if (results) {
    const cur = currentGwIndex();
    // tap a chip on the pitch to pick who makes way; tap again to change your
    // mind — the class flips in place so the search box keeps its text
    document.querySelectorAll('[data-trout]').forEach(chip => chip.onclick = () => {
      const pid = +chip.dataset.trout;
      transfersView.out = transfersView.out === pid ? null : pid;
      document.querySelectorAll('[data-trout]').forEach(c => c.classList.toggle('sel', +c.dataset.trout === transfersView.out));
      renderTrResults();
    });
    search.oninput = renderTrResults;
    function renderTrResults() {
      const q = normName(search.value || '');
      const owned = ownedIdsAt(cur);
      const outP = transfersView.out ? PLAYER_BY_ID[transfersView.out] : null;
      const squadAfterOut = squadAt(mid, cur).filter(p => !outP || p.id !== outP.id);
      const claimedIds = new Set(myClaims(mid).map(c => c.in));
      const ownedBy = {};
      for (const mm of state.managers) for (const sp of squadAt(mm.id, cur)) ownedBy[sp.id] = mm.id;
      let pool = transfersView.scope === 'all' ? [...PLAYERS]
        : transfersView.scope === 'waivers' ? PLAYERS.filter(p => !owned.has(p.id) && !arrivalLocked(p) && onWaivers(p))
        : PLAYERS.filter(p => !owned.has(p.id));
      if (transfersView.pos) pool = pool.filter(p => p.pos === transfersView.pos);
      if (transfersView.club) pool = pool.filter(p => p.team === transfersView.club);
      if (q) pool = pool.filter(p => normName(p.name).includes(q) || normName(p.team).includes(q) || normName(p.club).includes(q));
      const s = transfersView.sort;
      const live = seasonHasStats();
      const cols = STAT_COLS(live);
      pool.sort(metricSort(s));
      const twNow = troughWindow();
      const clearsTxt = !twNow.open
        ? (twNow.until ? `clears ${fmtWhen(twNow.until)}` : 'clears when waivers run')
        : `clears ${fmtWhen(nextWaiverRun(Math.max(lastWaiverRun(), Date.now())))}`;
      const total = pool.length;
      const shown = pool.slice(0, transfersView.limit);
      const hint = outP ? `<div class="muted" style="font-size:11.5px;padding:2px 0 6px">Making room for ${esc(outP.name)} (${outP.pos}) to leave:</div>`
        : '<div class="muted" style="font-size:11.5px;padding:2px 0 6px">Browsing the Trough — tap a player on your pitch above to unlock signing and claiming. Tap a column to sort.</div>';
      const table = `
      <div style="overflow-x:auto">
      <table class="pool-table">
        <thead><tr>
          <th data-trsort="name">Player</th><th></th>
          ${cols.map(c => c.sortable === false ? `<th class="num" title="${esc(c.t)}">${c.h}</th>` : `<th class="num" data-trsort="${c.k}" title="${esc(c.t)}">${c.h} ${s === c.k ? '▾' : ''}</th>`).join('')}<th class="act"></th>
        </tr></thead>
        <tbody>${shown.map(p => {
          const ownerMid = ownedBy[p.id];
          const locked = !ownerMid && arrivalLocked(p);
          const waiv = !ownerMid && !locked && onWaivers(p);
          const ok = !ownerMid && !locked && outP && squadShapeOk([...squadAfterOut, p]) && !claimedIds.has(p.id);
          const why = locked ? 'New arrival — locked until the window shuts, then the Window Draft'
            : !outP ? 'Pick who goes out first' : claimedIds.has(p.id) ? 'Already claimed' : 'Breaks the squad position limits';
          const m = metricsFor(p);
          const action = ownerMid
            ? (ownerMid === mid ? '<span class="muted" style="font-size:11px">yours</span>' : `<button class="btn ghost small" data-trtrade="${ownerMid}:${p.id}" title="Open the trade desk with ${esc(managerName(ownerMid))}">Trade</button>`)
            : `<button class="btn small ${waiv || locked ? 'ghost' : ''}" data-trin="${p.id}" data-waiv="${waiv ? 1 : 0}" ${ok ? '' : `disabled title="${why}"`}>${locked ? '&#128274;' : waiv ? 'Claim' : 'Sign'}</button>`;
          return `<tr class="${statusClass(p)}">
            <td class="pcol"><div class="pcell">${photoImg(p)}<div><div class="pname">${natFlag(p)} <span class="pn-txt">${esc(p.name)}</span></div><div class="pclub">${flagImg(p.team)} ${esc(p.club)} · <span class="pos-badge pos-${p.pos}">${p.pos}</span>${ownerMid ? ` · <b style="color:var(--text)">${esc(teamName(ownerMid))}</b>${onBlock(p.id) ? ' · <span style="color:var(--accent)">&#128276; transfer-listed</span>' : ''}` : locked ? ' · <span class="muted">&#128274; new arrival</span>' : waiv ? ` · <span style="color:var(--accent)">on waivers · ${esc(clearsTxt)}</span>` : ' · <span class="muted">free</span>'}</div></div></div></td>
            <td>${statusChip(p)}</td>
            ${cols.map(c => `<td class="num${c.cls || ''}">${c.v(m, p)}</td>`).join('')}
            <td class="act"><div class="row-actions">${action}${compareButtonHtml(p.id)}</div></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
      ${total > transfersView.limit ? `<div class="show-more"><button class="btn ghost small" id="trMore">Show more</button> <button class="btn ghost small" id="trAll">Show all ${total}</button></div>` : ''}`;
      results.innerHTML = hint + scoutViewHtml('transfers') + `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 8px;align-items:center">
        ${['', 'GK', 'DF', 'MF', 'FW'].map(pp => `<button class="btn small ${transfersView.pos === pp ? '' : 'ghost'}" data-trpos="${pp}">${pp || 'All'}</button>`).join('')}
        <select id="trClub" style="padding:6px 8px;font-size:12px">
          <option value="">All clubs</option>
          ${TEAMS.map(t => `<option value="${esc(t.name)}" ${transfersView.club === t.name ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
        <span style="width:8px"></span>
        <button class="btn small ${transfersView.scope !== 'all' && transfersView.scope !== 'waivers' ? '' : 'ghost'}" data-trscope="free">Free agents</button>
        <button class="btn small ${transfersView.scope === 'waivers' ? '' : 'ghost'}" data-trscope="waivers" title="Everyone currently claim-only, and when they clear">On waivers</button>
        <button class="btn small ${transfersView.scope === 'all' ? '' : 'ghost'}" data-trscope="all" title="Show owned players too, Draft Fantasy style">Everyone</button>
        ${colToggleHtml(live)}
      </div>` + (shown.length ? table
        : transfersView.scope === 'waivers' ? '<span class="muted">Nobody is on waivers right now — everyone free is fair game in the Trough.</span>'
        : '<span class="muted">The Trough is empty. Somehow.</span>');
      const clubSel = results.querySelector('#trClub');
      if (clubSel) clubSel.onchange = () => { transfersView.club = clubSel.value; transfersView.limit = 20; renderTrResults(); };
      results.querySelectorAll('[data-trpos]').forEach(b => b.onclick = () => { transfersView.pos = b.dataset.trpos; transfersView.limit = 20; renderTrResults(); });
      results.querySelectorAll('[data-trscope]').forEach(b => b.onclick = () => { transfersView.scope = b.dataset.trscope; transfersView.limit = 20; renderTrResults(); });
      results.querySelectorAll('[data-trtrade]').forEach(b => b.onclick = () => {
        const [other, get] = b.dataset.trtrade.split(':').map(Number);
        transfersView.tab = 'trades'; window._tradeFocus = { other, get }; render();
      });
      results.querySelectorAll('[data-trsort]').forEach(th => th.onclick = () => { transfersView.sort = th.dataset.trsort; renderTrResults(); });
      bindScoutDesk('transfers', renderTrResults);
      bindColToggle(renderTrResults);
      const more = results.querySelector('#trMore');
      if (more) more.onclick = () => { transfersView.limit += 50; renderTrResults(); };
      const showAll = results.querySelector('#trAll');
      if (showAll) showAll.onclick = () => { transfersView.limit = 9999; renderTrResults(); };
      results.querySelectorAll('[data-trin]').forEach(b => b.onclick = async () => {
        if (!actGuard(mid, 'squad')) return;
        const inId = +b.dataset.trin, outId = transfersView.out;
        const inP = PLAYER_BY_ID[inId], outP = PLAYER_BY_ID[outId];
        if (b.dataset.waiv === '1') {
          if (!await confirmSheet({
            title: 'Lodge this claim?',
            body: dealRows([outP], [inP]),
            yes: 'Lodge claim',
            note: 'Resolves when waivers run. You can withdraw or reorder it from your claims list until then.',
          })) return;
          setClaims(mid, [...myClaims(mid), { in: inId, out: outId }]);
          transfersView.out = null;
          toast(`Claim lodged: ${inP.name}. Resolves when waivers run.`);
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
              toast(`${inP.name} signed from the Trough${r.tgw !== cur ? ` — in for GW${GAMEWEEKS[r.tgw].n}` : ''}. First come, first served.`);
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
          toast(`${inP.name} signed from the Trough${tgw !== cur ? ` — in for GW${GAMEWEEKS[tgw].n}` : ''}. First come, first served.`);
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
      const mine = squadAt(mid, cur).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos]);
      const theirs = squadAt(other, cur).sort((a, b) => POS_ORDER[a.pos] - POS_ORDER[b.pos]);
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
        const meAfter = [...squadAt(mid, cur).filter(p => !giveSet.has(p.id)), ...get.map(pid => PLAYER_BY_ID[pid])];
        const themAfter = [...squadAt(other, cur).filter(p => !getSet.has(p.id)), ...give.map(pid => PLAYER_BY_ID[pid])];
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
  if (isStandalone()) return settingsPage ? `<div class="card"><h2>The app</h2>
    <p class="muted" style="font-size:12.5px">&#9989; You're running the installed app — its own icon, full screen, same live league. Nothing to update; it always loads the latest build.</p></div>` : '';
  if (!settingsPage && localStorage.getItem(A2HS_KEY)) return '';
  const how = a2hsEvent ? ''
    : isIOS() ? `<p class="rules-p" style="font-size:12.5px">On iPhone, in <b>Safari</b>: tap the <b>Share</b> button (square with an up arrow) — or the <b>&#8943; menu</b> by the address bar — then <b>Add to Home Screen</b>. It hides sometimes: scroll down the list, or check <b>View More / Edit Actions</b>. Own icon, full screen, no browser bar.</p>`
    : `<p class="rules-p" style="font-size:12.5px">In Chrome: open the <b>&#8942; menu</b> and choose <b>Add to Home screen / Install app</b> (on desktop it's the install icon in the address bar).</p>`;
  return `<div class="card" style="margin-bottom:18px">
    <div style="display:flex;align-items:flex-start;gap:10px">
      <h2 style="flex:1;min-width:0">Get the app &#128241;</h2>
      ${settingsPage ? '' : '<button class="btn ghost small" id="a2hsX" title="Dismiss — it lives in Settings" aria-label="Dismiss" style="padding:2px 9px;flex:none">&#10005;</button>'}
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
  const mid = identified ? (whoami && whoami !== -1 ? whoami : state.managers[0].id) : state.managers[0].id;
  const cur = currentGwIndex();
  const pair = pairingsFor(cur).find(pr => pr.includes(mid));
  const opp = pair ? (pair[0] === mid ? pair[1] : pair[0]) : null;
  const started = gwUnderway(cur); // display truth — a simulated GW counts
  const my = started ? gwManagerPoints(mid, cur) : projectedGwScore(mid, cur);
  const their = opp ? (started ? gwManagerPoints(opp, cur) : projectedGwScore(opp, cur)) : 0;
  const pct = pair ? Math.round(liveWinProb(pair[0], pair[1], cur) * 100) : null;
  const flags = squadAt(mid, cur).filter(p => p.status && p.status !== 'a');
  const offersIn = toArr(state.trades).filter(t => t.status === 'pending' && t.to === mid);
  const myCl = myClaims(mid);
  const news = [...state.transfers].slice(-5).reverse();
  const covs = [...toArr(state.covenants)].slice(-2).reverse();
  const table = h2hStandings(true);
  const myPos = table.findIndex(r => r.id === mid) + 1;
  const deadline = new Date(gwFrom(cur));
  return `
  ${foundingCard()}
  <div class="settings-grid">
    ${!identified ? `
    <div class="card" style="border-color:var(--accent)">
      <h2>Who goes there?</h2>
      <p class="rules-p">You're browsing as a spectator. Sign in and the league knows whose team, matchup and waivers to show you.</p>
      <button class="btn" id="dashSignIn">Sign in</button>
    </div>` : `
    <div class="card">
      <h2>GW${GAMEWEEKS[cur].n} — your matchup</h2>
      ${pair ? `
      <div class="h2h-fx" data-mu="${pair[0]}:${pair[1]}:${cur}" style="cursor:pointer;font-size:15px">
        <span style="flex:1;text-align:right"><b>${esc(teamName(pair[0]))} ${kitSvg(pair[0])}</b></span>
        <span class="fx-score${started ? '' : ' projected'}">${started ? '' : '<span class="proj-tag">proj</span> '}${started ? gwManagerPoints(pair[0], cur) : projectedGwScore(pair[0], cur)} &ndash; ${started ? gwManagerPoints(pair[1], cur) : projectedGwScore(pair[1], cur)}</span>
        <span style="flex:1"><b>${kitSvg(pair[1])} ${esc(teamName(pair[1]))}</b></span>
      </div>
      <div class="venue-line">${derbyTag(pair[0], pair[1]) ? derbyTag(pair[0], pair[1]) + ' &middot; ' : ''}at ${esc(stadium(pair[0]))}${gwStatus(cur) === 'final' ? ' &middot; full time' : ''}</div>
      ${winProbBar(pair[0], pair[1], cur, mid)}
      <div class="preview-note chant">${esc(chantFor(pair[0], pair[1], cur))}</div>
      <div class="mu-grid dash-mu" style="margin-top:10px">
        ${pair.map(pmid => `<div>
          <p class="muted" style="font-size:10.5px;text-align:center;margin-bottom:2px">${kitSvg(pmid)} ${esc(teamName(pmid))}</p>
          ${dashMiniPitch(pmid, cur)}
        </div>`).join('')}
      </div>` : '<p class="muted">No fixture this week — playoffs or the off-season.</p>'}
      <p class="muted" style="font-size:12px;margin-top:10px">${started ? 'Lineups are locked.' : `Lineup locks ${deadline.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`} You sit <b style="color:var(--text)">${myPos}${['th','st','nd','rd'][((myPos%100>10&&myPos%100<14)?0:Math.min(myPos%10,4))] || 'th'}</b>.</p>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="btn small" data-goto="team">Set my lineup</button>
        <button class="btn ghost small" data-goto="transfers">Transfers</button>
        <button class="btn ghost small" data-goto="h2h">Matches</button>
      </div>
    </div>
    <div class="card">
      <h2>Needs your attention</h2>
      ${flags.length ? `<h3>Squad flags</h3>${flags.map(p => `<div class="lrow" style="font-size:12.5px">${statusChip(p)} ${pname(p)} <span class="muted" style="font-size:11px">${esc(p.news || 'unavailable')}</span></div>`).join('')}` : '<p class="muted" style="font-size:12.5px">Squad fully fit. Enjoy it while it lasts.</p>'}
      ${offersIn.length ? `<h3 style="margin-top:12px">Trade offers in</h3>${offersIn.map(t => `<div class="lrow" style="font-size:12.5px"><b>${esc(managerName(t.from))}</b> offers <b>${esc(tradeNames(tGive(t)))}</b> for ${esc(tradeNames(tGet(t)))}</div>`).join('')}<button class="btn small" data-goto="transfers" style="margin-top:6px">Respond</button>` : ''}
      <h3 style="margin-top:12px">Waivers</h3>
      <p class="muted" style="font-size:12.5px">${myCl.length ? `${myCl.length} claim${myCl.length > 1 ? 's' : ''} lodged.` : 'No claims lodged.'} ${(() => {
        const tw = troughWindow();
        if (tw.mock) return `Trough shut — ${tw.why}.`; // the sim outranks manual controls (sol r2 P2)
        return waiverControl() === 'auto' ? `Next run: ${fmtWhen(nextWaiverRun(Math.max(lastWaiverRun(), Date.now())))}.` : waiverControl() === 'open' ? 'The Trough is thrown open.' : 'The Trough is closed.';
      })()}</p>
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
      ${news.length ? `<h3 style="margin-top:12px">Latest moves</h3>
        ${news.map(t => {
          const nm = pid => esc(PLAYER_BY_ID[pid]?.name || 'unknown'); // plain text — links inside a truncating one-liner are unreachable anyway
          return `<div class="move-row"><span class="tag">${t.trade ? 'trade' : t.waiver ? 'waiver' : t.windowDraft ? 'window' : 'trough'}</span>
          <span class="move-txt"><b>${esc(teamName(t.managerId))}</b> &middot; ${nm(t.outId)} <span class="muted">→</span> <b>${nm(t.inId)}</b></span></div>`;
        }).join('')}` : ''}
    </div>`}
    <div class="card">
      <h2>The table <span class="muted" style="font-weight:400;font-size:12px">win 3 &middot; draw 1</span></h2>
      <div style="overflow-x:auto"><table class="pool-table">
        <thead><tr><th></th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">Pts</th></tr></thead>
        <tbody>
        ${table.map((r, i) => `<tr class="${i === 7 ? 'playoff-line' : ''}"${r.id === mid ? ' style="background:rgba(45,212,167,.07)"' : ''}>
          <td class="muted">${i + 1}</td>
          <td>${kitSvg(r.id)} <b>${esc(r.team || r.name)}</b></td>
          <td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td>
          <td class="num gold">${r.pts}</td>
        </tr>`).join('')}
        </tbody>
      </table></div>
      <p class="muted" style="font-size:10.5px;margin-top:4px">The dashed line is the playoff cut. <button class="btn ghost small" data-goto="table" style="font-size:10.5px;padding:1px 8px">Full table</button></p>
    </div>
  </div>
  ${programmeCard()}
  ${installCard()}
  ${vidiCard(true)}`;
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
function programmeCard() {
  if (state.phase !== 'season' || !state.draft.picks.length) return '';
  const cur = currentGwIndex();
  const pick = (arr, seed) => arr[seed % arr.length];
  const masthead = (edition, gwN) => `<p class="prog-mast">The League Gazette &middot; ${edition} &middot; GW${gwN}</p>`;
  if ((gwDeadlinePassed(cur) || gwUnderway(cur)) && gwStatus(cur) !== 'final') {
    const art = previewArticle(cur, pick);
    if (art) return `<div class="card prog-card"><h2>The Matchday Programme</h2>${masthead('matchday edition', GAMEWEEKS[cur].n)}${art}</div>`;
  }
  const last = lastFinalGw();
  if (last >= 0) {
    return `<div class="card prog-card"><h2>The Matchday Programme</h2>${masthead('review edition', GAMEWEEKS[last].n)}${reviewArticle(last, pick)}
      <p class="muted" style="font-size:11px;margin-top:8px">The GW${GAMEWEEKS[Math.min(cur, REGULAR_GWS - 1)].n} matchday edition goes to print when the teams are locked.</p></div>`;
  }
  return `<div class="card prog-card"><h2>The Matchday Programme</h2>
    <p class="muted" style="font-size:12.5px">First edition goes to print when GW1's teams are locked. The presses are warm; the takes are warmer.</p></div>`;
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
  const dc = i < 10 ? draftClassTable() : [];
  const draftLine = dc.length >= 2 && dc[0].pts > 0
    ? ` Draft-class watch: ${teamName(dc[0].mid)}'s August board still tops the charts (${dc[0].pts} banked); ${teamName(dc[dc.length - 1].mid)}'s is being described, generously, as "a project".`
    : '';
  const closer = pick([
    'Projections by the algorithm; consequences by the group chat.',
    'The Committee wishes all twelve managers the fortune they deserve. Exactly that much.',
    'Lineups lock at kick-off. Regret locks in shortly afterwards.',
  ], i + 3);
  return `<div class="prog-art">
    <p class="prog-lead">${esc(lead)}</p>
    <p>${esc(numbers)}${esc(men)}${esc(dugouts)}</p>
    ${motwNotes ? `<p>${esc(motwNotes)} ${esc(chantFor(motw.a, motw.b, i))}</p>` : `<p>${esc(chantFor(motw.a, motw.b, i))}</p>`}
    <p><b>Around the grounds:</b> ${esc(grounds.join('; '))}.${esc(troughLine)}${esc(draftLine)}</p>
    <p class="muted" style="font-size:12px">${esc(closer)}</p>
  </div>`;
}
function reviewArticle(last, pick) {
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
  const card = results.map((r, k) => r.sa === r.sb
    ? `${teamName(r.a)} ${r.sa}–${r.sb} ${teamName(r.b)} (a draw nobody enjoyed)`
    : pick([
      `${teamName(r.sa > r.sb ? r.a : r.b)} saw off ${teamName(r.sa > r.sb ? r.b : r.a)} ${Math.max(r.sa, r.sb)}–${Math.min(r.sa, r.sb)}`,
      `${teamName(r.sa > r.sb ? r.a : r.b)} edged ${teamName(r.sa > r.sb ? r.b : r.a)} ${Math.max(r.sa, r.sb)}–${Math.min(r.sa, r.sb)}`,
      `${teamName(r.sa > r.sb ? r.a : r.b)} beat ${teamName(r.sa > r.sb ? r.b : r.a)} ${Math.max(r.sa, r.sb)}–${Math.min(r.sa, r.sb)}`,
    ], last * 5 + k)).join('; ');
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
    <p><b>The full card:</b> ${esc(card)}.</p>
    ${awardBits.length ? `<p><b>In dispatches:</b> ${esc(awardBits.join('; '))}.</p>` : ''}
    ${momentsLine ? `<p>${esc(momentsLine)}</p>` : ''}
    ${draftPara ? `<p>${esc(draftPara)}</p>` : ''}
    ${tableLine ? `<p>${esc(tableLine)}</p>` : ''}
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
          ${j === 0 && hcap ? `<span class="gold br-hcap" title="Head start — half the table-points gap between the pair, capped +${QF_HANDICAP_CAP}">+${hcap}</span>` : ''}
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
      : `If the season ended today &mdash; seeds from the table, quarter-final head starts = half the points gap (capped +${QF_HANDICAP_CAP}). Firms up as the table does; the real thing kicks off GW34.`}</p>
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
  ${sect('League data')}
  ${bracketCard()}
  ${awardsCard() || `<div class="card"><h2>The Committee's Awards</h2><p class="muted" style="font-size:12.5px">No settled gameweek yet. The Committee sharpens its pencils.</p></div>`}
  ${sect('Team data')}
  ${troughActivityCard()}
  ${sect('Player data')}
  ${topPlayersCard()}
  ${treatmentRoomCard()}
  ${sect('The archive')}
  ${recordBookCards()}`;
}
function bindData() {
  bindAwardsBits();
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
    <p class="muted" style="font-size:10.5px;margin-top:8px">Injury lines from the official FPL feed (Premier Injuries data), refreshed every 15 minutes. Deep cuts: <a href="https://x.com/BenDinnery" target="_blank" rel="noopener" style="color:var(--accent)">@BenDinnery</a> · <a href="https://x.com/BenCrellin" target="_blank" rel="noopener" style="color:var(--accent)">@BenCrellin</a>.</p>
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
        <th class="num" title="Your record if you'd played all eleven others every week">All-play</th>
        <th class="num" title="H2H points vs what your scores deserved. Positive = riding your luck">Luck</th>
        <th class="num" title="Points left on the bench vs your best possible XI, season total">Bench waste</th>
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
    <p class="muted" style="font-size:10.5px;margin-top:6px">All-play: your record playing every manager every finished week. Luck: actual H2H points minus what that record deserved. ${odds ? 'Playoff odds: 1,000 simulated seasons from everyone’s scoring so far.' : 'Playoff odds appear after three finished gameweeks.'}</p>
  </div>`;
}
/* ----- the week's awards, auto-issued ----- */
// the week's honours, computed once — feeds the awards card AND the Minutes
function lastFinalGw() {
  let last = -1;
  for (let i = 0; i < REGULAR_GWS; i++) if (gwStatus(i) === 'final') last = i;
  return last;
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
  // 1 Aug 2026 (Marc: "so much in there" — the six that survive are the six)
  return { hi, lo, jammy, robbed, hiding, bench };
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
function awardsCard() {
  const last = lastFinalGw();
  if (last < 0) return '';
  const { hi, lo, jammy, robbed, hiding, bench } = weeklyAwards(last);
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
    </div>
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
/* ----- the Lobus (ledger #1): the Registry card is GONE (Marc, 1 Aug —
   "not a fully formed joke"); declarations stay (player card) and the gag is
   delivered by the LOBUS KLAXON on the Vidiprinter when a declared Lobus
   scores. ----- */
/* ----- the Committee Minutes: one tap, WhatsApp-ready recap ----- */
function committeeMinutes(last) {
  const g = GAMEWEEKS[last];
  const { hi, lo, jammy, robbed, hiding, bench } = weeklyAwards(last);
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
  const t = h2hStandings(false);
  L.push('', '*The Table*');
  t.slice(0, 4).forEach((r, i) => L.push(`${i + 1}. ${r.team || r.name} — ${r.pts}`));
  const bottom = t[t.length - 1];
  L.push('…', `${t.length}. ${bottom.team || bottom.name} — ${bottom.pts} \u{1F96B}`);
  L.push('', 'Minutes recorded automatically. Disputes to the group chat, where they will be enjoyed.');
  L.push('https://benmpolak.github.io/the-league/');
  return L.join('\n');
}
// the cheeky lineup shot on the dashboard matchup card (Ben, 1 Aug): both
// XIs as mini pitches, chips open player cards, points live once started
function dashMiniPitch(mid, gw) {
  const xi = lineupFor(mid, gw);
  return `<div style="overflow-x:auto"><div class="pitch mu-pitch">${['GK', 'DF', 'MF', 'FW'].map(pos => `<div class="pitch-row">${
    xi.map(pid => PLAYER_BY_ID[pid]).filter(p => p && p.pos === pos).map(p => `
      <div class="pitch-chip mu-chip ${statusClass(p)}" data-pcard="${p.id}" style="cursor:pointer">
        ${kitImg(p.team, p.pos === 'GK')}
        <span class="pitch-name">${esc(p.name)}</span>
        ${gwUnderway(gw) ? `<span class="mu-pts">${gwPlayerPoints(p.id, gw)}</span>` : ''}
      </div>`).join('') || '<span class="muted" style="font-size:10px">—</span>'}</div>`).join('')}</div></div>`;
}
function bindDash() {
  bindInstall();
  const fb = $('#foundBtn');
  if (fb) fb.onclick = () => clubEditor(+fb.dataset.mid);
  const fl = $('#foundLater');
  if (fl) fl.onclick = () => { localStorage.setItem(`${LS_NS}-founded-${fl.dataset.mid}`, '1'); render(); };
  const ds = $('#dashSignIn');
  if (ds) ds.onclick = () => { spectating = false; localStorage.removeItem(SPECT_KEY); whoami = null; forceIdentity = true; render(); };
  document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => { state.view = b.dataset.goto; save(); render(); });
  bindAwardsBits(); // awards/treatment live in the Data Room now, but stay bound if ever re-hosted
  document.querySelectorAll('[data-mu]').forEach(el => el.onclick = () => {
    const [a, b, i] = el.dataset.mu.split(':').map(Number);
    showMatchup(a, b, i);
  });
}

/* ----- playoffs (top 8: GW34 handicap quarter-finals, GW35 semis, GW36–38 three-legged final) ----- */
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) === 1 ? 1 : n % 10 === 2 ? 2 : n % 10 === 3 ? 3 : 0]);
// QF head start for the higher seed: half the table-points gap between the
// pair, rounded down, capped at +15 (Committee ruling — replaces the old
// fixed +12/+9/+6/+3; a tight 4v5 now carries no handicap at all)
const QF_HANDICAP_CAP = 15;
const qfHandicap = (ptsHigh, ptsLow) => Math.min(QF_HANDICAP_CAP, Math.floor(Math.max(0, ptsHigh - ptsLow) / 2));
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
      <p class="muted" style="font-size:12.5px">GW33 ends the regular season. Top eight go through. <b>GW34</b>: handicap quarter-finals — 1v8, 2v7, 3v6, 4v5, the higher seed starting with <b>half the table-points gap</b> between the pair (rounded down, capped at +${QF_HANDICAP_CAP}). Finish miles clear, start miles ahead. <b>GW35</b>: semi-finals — winner of 1v8 meets winner of 4v5, winner of 2v7 meets winner of 3v6. <b>GW36–38</b>: the three-legged final — most legs won, then cumulative points, then regular-season position. Ties elsewhere: higher seed advances.</p></div>`;
  }
  const seedNo = id => po.seeds.indexOf(id) + 1;
  const stageHead = t => `<p class="muted" style="font-size:11px;margin:10px 0 2px;text-transform:uppercase;letter-spacing:.06em">${t}</p>`;
  const tieRow = (a, b, score, hcap) => `<div class="h2h-fx">
      <span style="flex:1;text-align:right">${ord(seedNo(a))} ${esc(teamName(a))}${hcap ? ` <span class="gold" style="font-size:11px" title="handicap — the higher seed starts +${hcap}">+${hcap}</span>` : ''}</span>
      <span class="fx-score">${score}</span>
      <span style="flex:1">${esc(teamName(b))} ${ord(seedNo(b))}</span></div>`;
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
  for (const mid of [a, b]) effInfo[mid] = started ? effectiveXI(mid, i) : { xi: lineupFor(mid, i), subs: [] };
  const xiOf = mid => effInfo[mid].xi;
  const chip = (pid, mid) => {
    const p = PLAYER_BY_ID[pid];
    const pts = started ? gwPlayerPoints(pid, i) : null;
    const cameOn = effInfo[mid].subs.some(s => s.in === pid);
    return `<div class="pitch-chip mu-chip ${statusClass(p)}" data-pcard="${p.id}">
      ${cameOn ? '<span class="sub-arrow in" title="Auto-sub — came on">&#9650;</span>' : ''}
      ${kitImg(p.team, p.pos === 'GK')}
      <span class="pitch-name">${esc(p.name)}</span>
      ${pts != null ? `<span class="mu-pts">${pts}</span>` : `<span class="pitch-vs">${nextOppHtml(p.team, GAMEWEEKS[i].n)}</span>`}
    </div>`;
  };
  // the bench: unused subs in priority order, then anyone auto-subbed OUT
  const benchOf = mid => {
    const xi = new Set(xiOf(mid));
    const outs = new Set(effInfo[mid].subs.map(s => s.out));
    return [...benchFor(mid, i).filter(p => !xi.has(p.id)), ...squadAt(mid, i).filter(p => outs.has(p.id))];
  };
  const sideBench = mid => {
    const outs = new Set(effInfo[mid].subs.map(s => s.out));
    const bench = benchOf(mid);
    if (!bench.length) return '';
    return `<div class="bench-strip mu-bench">
      <span class="muted" style="font-size:10px;font-weight:700;align-self:center">BENCH</span>
      ${bench.map(p => `<div class="pitch-chip mu-chip benched ${statusClass(p)}" data-pcard="${p.id}">
        ${outs.has(p.id) ? '<span class="sub-arrow out" title="Auto-subbed out — did not play">&#9660;</span>' : ''}
        ${kitImg(p.team, p.pos === 'GK')}
        <span class="pitch-name">${esc(p.name)}</span>
        ${started ? `<span class="mu-pts">${gwPlayerPoints(p.id, i)}</span>` : ''}
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
    <h3 style="text-align:center">${kitSvg(mid)} ${esc(teamName(mid))} <b class="gold">${started ? gwManagerPoints(mid, i) : projectedGwScore(mid, i)}</b></h3>
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
    <div class="h2h-fx mu-scoreline">
      <span style="flex:1;text-align:right"><b>${esc(teamName(a))} ${kitSvg(a)}</b></span>
      <span class="fx-score${started ? '' : ' projected'}">${started ? '' : '<span class="proj-tag">proj</span> '}${started ? gwManagerPoints(a, i) : projectedGwScore(a, i)} &ndash; ${started ? gwManagerPoints(b, i) : projectedGwScore(b, i)}</span>
      <span style="flex:1"><b>${kitSvg(b)} ${esc(teamName(b))}</b></span>
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
  L.push('https://benmpolak.github.io/the-league/');
  return L.join('\n');
}
function gwPreviewCard(i) {
  const d = gwPreviewData(i);
  if (!d) return '';
  const { rows, motw, notes, recent } = d;
  const trough = recent.length ? `<p class="muted" style="font-size:12px;margin-top:10px"><b>Trough watch:</b> ${recent.map(t => `${esc(managerName(t.managerId))} ${t.trade ? 'traded for' : 'signed'} ${esc(PLAYER_BY_ID[t.inId]?.name || '?')}`).join(' · ')}</p>` : '';
  return `<div class="card" style="margin-bottom:18px">
    <h2>GW${GAMEWEEKS[i].n} preview <span class="tag">projected scores &amp; win chance</span>
      <button class="btn ghost small" id="copyPreview" style="margin-left:auto" title="WhatsApp-ready preview">&#128203; Copy the Preview</button></h2>
    ${[motw, ...rows.filter(r => r !== motw)].map(r => {
      const pct = Math.round(r.p * 100);
      return `<div class="preview-fx${r === motw ? ' motw' : ''}">
        ${r === motw ? '<div class="motw-tag">&#11088; MATCHUP OF THE WEEK</div>' : ''}
        <div class="h2h-fx" data-mu="${r.a}:${r.b}:${i}" style="cursor:pointer" title="Tap for the matchup">
          <span style="flex:1;text-align:right">${esc(teamName(r.a))} <b class="pct">${pct}%</b></span>
          <span class="fx-score" title="projected score">${r.sa} &ndash; ${r.sb}</span>
          <span style="flex:1"><b class="pct">${100 - pct}%</b> ${esc(teamName(r.b))}</span>
        </div>
        <div class="venue-line">at ${esc(stadium(r.a))}</div>
        ${notes(r).map(n => `<div class="preview-note">${esc(n)}</div>`).join('')}
        <div class="preview-note chant">${esc(chantFor(r.a, r.b, i))}</div>
      </div>`;
    }).join('')}
    ${trough}
    <p class="muted" style="font-size:10.5px;margin-top:8px">Projections built from FPL expected points for each current XI. The Committee accepts no liability.</p>
  </div>`;
}

function viewH2H() {
  const cur = currentGwIndex();
  const liveNow = GAMEWEEKS.slice(0, REGULAR_GWS).some((g, i) => gwStatus(i) === 'live');
  const standings = h2hStandings(liveNow);
  // the standings table itself moved to the League Table page (Ben, 1 Aug:
  // "the head to head table is what should be in the league table") — this
  // page is Matches: fixtures, preview, playoffs, points grid, crystal ball
  const matchesCard = (() => {
    if (h2hView.gw == null) h2hView.gw = Math.min(cur, REGULAR_GWS - 1);
    const i = h2hView.gw, g = GAMEWEEKS[i];
    const st = gwStatus(i);
    const tag = st === 'final' ? '<span class="tag">FT</span>'
      : st === 'live' ? '<span class="tag live-tag"><span class="rec"></span>LIVE</span>'
      : st === 'underway' ? '<span class="tag">underway — refresh for the latest</span>'
      : '<span class="tag">upcoming</span>';
    return `
    <div class="card" style="margin-bottom:12px">
      <h2 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">GW${g.n} Matches ${tag}
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
          <button class="btn ghost small" id="gwPrev" ${i === 0 ? 'disabled' : ''}>&#8249; Previous</button>
          <span class="tag">${g.n}</span>
          <button class="btn ghost small" id="gwNext" ${i >= REGULAR_GWS - 1 ? 'disabled' : ''}>Next &#8250;</button>
        </span>
      </h2>
      ${pairingsFor(i).map(([a, b]) => {
        const pa = st === 'upcoming' ? '–' : gwManagerPoints(a, i);
        const pb = st === 'upcoming' ? '–' : gwManagerPoints(b, i);
        const aWin = st === 'final' && pa > pb, bWin = st === 'final' && pb > pa;
        return `<div class="h2h-fx" data-mu="${a}:${b}:${i}" style="cursor:pointer" title="Tap for the matchup">
          <span class="${aWin ? 'h2h-win' : ''}" style="flex:1;text-align:right">${esc(teamName(a))} ${kitSvg(a)} <span class="muted" style="font-size:10px">(H)</span></span>
          <span class="fx-score">${pa} &ndash; ${pb}</span>
          <span class="${bWin ? 'h2h-win' : ''}" style="flex:1">${kitSvg(b)} ${esc(teamName(b))}</span>
        </div>
        <div class="venue-line">${derbyTag(a, b) ? derbyTag(a, b) + ' &middot; ' : ''}${esc(stadium(a))}${st === 'live' || st === 'underway' ? (() => {
          const w = Math.round(liveWinProb(a, b, i) * 100);
          const ta = teamOutlook(a, i), tb = teamOutlook(b, i);
          return ` &middot; win chance ${w}% – ${100 - w}% &middot; ${ta.toPlay} v ${tb.toPlay} still to play`;
        })() : ''}</div>`;
      }).join('')}
      <h3 style="margin-top:14px">GW${g.n} — the real fixtures</h3>
      ${(() => {
        const fxs = state.fixtures.filter(f => f.gw === g.n);
        return fxs.map(f => {
          const live = f.started && !f.finished;
          const score = !f.started ? new Date(f.date).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : `${f.hs ?? ''} – ${f.as ?? ''}`;
          return `<div class="h2h-fx" style="font-size:12.5px">
            <span style="flex:1;text-align:right">${esc(f.home)} ${flagImg(f.home)}</span>
            <span class="fx-score" style="font-size:12px">${score}${live ? ` <span class="rec" style="display:inline-block"></span>` : ''}</span>
            <span style="flex:1">${flagImg(f.away)} ${esc(f.away)}</span>
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
let tableView = { mode: 'overall' }; // 'overall' | 3 | 5 — survives the session, never persisted
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
  const liveNow = anyMatchLive();
  const mode = tableView.mode;
  const form = mode === 'overall' ? null : formStandings(mode);
  const standings = form ? null : h2hStandings(true);
  const rowsData = form ? form.rows : standings;
  const toggles = `<div class="pool-controls" style="margin:0 0 10px">
      <button class="btn small ${mode === 'overall' ? '' : 'ghost'}" data-tblmode="overall">Overall</button>
      <button class="btn small ${mode === 3 ? '' : 'ghost'}" data-tblmode="3">Last 3</button>
      <button class="btn small ${mode === 5 ? '' : 'ghost'}" data-tblmode="5">Last 5</button>
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
  const nCols = form ? 4 : 11;
  return `
    <div class="card" style="margin-bottom:14px">
      <h2>The table ${liveNow && !form ? '<span class="tag live-tag"><span class="rec"></span>LIVE</span>' : ''} <span class="muted" style="font-weight:400;font-size:12px">${form ? `points over the last ${form.counted || 0} finished GW${form.counted === 1 ? '' : 's'} &middot; informational only` : 'win 3 &middot; draw 1 &middot; loss 0 &middot; tiebreak: overall points'}</span></h2>
      ${toggles}
      ${formNote}
      <div style="overflow-x:auto">
      <table class="pool-table">
        <thead>${form
          ? '<tr><th></th><th>Team</th><th class="num" title="Finished gameweeks counted">GWs</th><th class="num act">Pts</th></tr>'
          : '<tr><th></th><th>Team</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num" title="H2H points scored">+</th><th class="num" title="H2H points conceded">&minus;</th><th class="num act">Pts</th><th class="num" title="Overall FPL-style points — the tiebreak">Ovr</th><th class="num" title="The quarter-final handicap this position earns (top 4) or concedes (5th–8th)">QF</th></tr>'}</thead>
        <tbody>
        ${rowsData.map((m, i) => {
          // table gag tags all retired (Marc/Ben, 2 Aug: "committee fraud
          // nonsense" — under-review, investigation and Chumpionship alike)
          const commTag = '';
          const qfCell = form ? '' : (() => {
            if (i >= 8) return '<td class="num"></td>';
            const k = Math.min(i, 7 - i);
            const h = qfHandicap(standings[k].pts, standings[7 - k].pts);
            if (!h) return '<td class="num"><span class="muted">0</span></td>';
            return `<td class="num">${i < 4 ? `<span class="gold">+${h}</span>` : `<span style="color:#e05555">&minus;${h}</span>`}</td>`;
          })();
          return `
          <tr data-mgr-row="${m.id}" style="cursor:pointer" class="${!form && i === 7 ? 'playoff-line' : ''}">
            <td class="muted">${i + 1}</td>
            <td><button class="btn ghost small" data-pitchview="${m.id}" title="See this team on the pitch" style="padding:2px 7px">&#9917;</button> ${kitSvg(m.id)} <b>${esc(m.team || m.name)}</b> <span class="muted" style="font-size:11px">${esc(m.name)}</span> ${moveTag(m)} ${!form && i === 0 && m.pts > 0 ? '&#127942;' : ''} ${commTag}</td>
            ${form
              ? `<td class="num muted">${form.counted}</td><td class="num gold act"><b>${m.win}</b></td>`
              : `<td class="num">${m.p}</td><td class="num">${m.w}</td><td class="num">${m.d}</td><td class="num">${m.l}</td>
                 <td class="num muted">${m.pf}</td><td class="num muted">${m.pa}</td>
                 <td class="num gold act"><b>${m.pts}</b></td>
                 <td class="num muted">${managerPoints(m.id)}</td>
                 ${qfCell}`}
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
    </div>`;
}
// team data: who can't leave the Trough alone (moved to the Data Room, 1 Aug)
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
    <h2>Trough activity <span class="muted" style="font-weight:400;font-size:12px">who can't leave it alone</span></h2>
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
    ${hot.length ? `<h3 style="margin-top:16px">Hot potatoes &#129364; <span class="muted" style="font-weight:400;font-size:11.5px">most passed through the Trough</span></h3>
      ${hot.map(({ p, n }) => `<div class="squad-row"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${photoImg(p)}<span>${pname(p)}</span><span class="muted" style="margin-left:8px;font-size:11.5px">${esc(p.club)}</span><span class="sp-pts">${n} moves</span></div>`).join('')}` : ''}
  </div>`;
}
// player data: top scorers among everyone drafted or signed (Data Room, 1 Aug)
function topPlayersCard() {
  const allDrafted = [...new Set(state.draft.picks.map(pk => pk.playerId).concat(state.transfers.map(t => t.inId)))]
    .map(pid => ({ p: PLAYER_BY_ID[pid], pts: playerPoints(pid).pts }))
    .filter(x => x.p)
    .sort((a, b) => b.pts - a.pts).slice(0, 10);
  return `<div class="card toplist" style="margin-top:14px">
    <h2>Top players (all drafted &amp; signed)</h2>
    ${allDrafted.map(({ p, pts }) => `
      <div class="squad-row"><span class="pos-badge pos-${p.pos}">${p.pos}</span>${photoImg(p)}
      <span>${esc(p.name)}</span> <span class="muted" style="font-size:11px">${esc(p.club)}</span>
      <span class="sp-pts gold">${pts}</span></div>`).join('') || '<span class="muted">Points appear once matches are played and synced.</span>'}
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
    tableView.mode = b.dataset.tblmode === 'overall' ? 'overall' : +b.dataset.tblmode;
    render();
  });
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
  if (fxView.gw == null) fxView.gw = GAMEWEEKS[currentGwIndex()].n;
  const fxs = state.fixtures.filter(f => f.gw === fxView.gw);
  const byDay = {};
  for (const f of fxs) {
    const d = new Date(f.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    (byDay[d] = byDay[d] || []).push(f);
  }
  return `
  <div class="team-controls card">
    <select id="fxGw">${GAMEWEEKS.map(g => `<option value="${g.n}" ${g.n === fxView.gw ? 'selected' : ''}>GW${g.n}${g.n === GAMEWEEKS[currentGwIndex()].n ? ' (current)' : ''}</option>`).join('')}</select>
  </div>
  ${Object.entries(byDay).map(([day, list]) => `
    <div class="fx-day"><h3>${day}</h3><div class="fx-grid">
    ${list.map(f => {
      const live = f.started && !f.finished;
      const score = !f.started ? new Date(f.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : `${f.hs ?? ''}–${f.as ?? ''}`;
      const ytq = encodeURIComponent(`${f.home} vs ${f.away} Premier League highlights`);
      return `<div class="fx ${live ? 'live' : ''}">
        <div class="fx-team right"><span>${esc(f.home)}</span>${flagImg(f.home)}</div>
        <span class="fx-score">${score}</span>
        <div class="fx-team"><span>${flagImg(f.away)}</span><span>${esc(f.away)}</span></div>
        <span class="fx-time">${live ? `${f.minutes}'` : (f.finished ? 'FT' : '')}</span>
        ${f.finished ? `<a class="fx-yt" href="https://www.youtube.com/results?search_query=${ytq}" target="_blank" rel="noopener" title="Match highlights on YouTube">&#9654; Highlights</a>` : ''}
      </div>`;
    }).join('')}
    </div></div>`).join('') || '<div class="card"><p class="muted">No fixtures scheduled for this gameweek yet.</p></div>'}`;
}
function bindFixtures() {
  const sel = $('#fxGw');
  if (sel) sel.onchange = e => { fxView.gw = +e.target.value; render(); };
  const fs = $('#fxSync');
  if (fs) fs.onclick = () => syncNow(true); // inline onclick= is dead under the CSP
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
  const { posMin, posMax } = state.settings;
  return `
  <div class="settings-grid">
    <div class="card">
      <h2>The basics</h2>
      <p class="rules-p">Twelve managers. One snake draft over all ${PLAYERS.length} Premier League players — order reverses every round. Est. 2015; this is season twelve.</p>
      <p class="rules-p">Squads of <b>${state.settings.squadSize}</b>, flexible make-up: ${['GK', 'DF', 'MF', 'FW'].map(p => `${posMin[p]}–${posMax[p]} ${p}`).join(', ')}. <b>No club cap.</b> Tussie may draft the entire City team by GW30. That is his right.</p>
      <p class="rules-p"><b>Starting XI:</b> pick 11 from your ${state.settings.squadSize} each gameweek — 1 GK, 3–5 DF, 2–5 MF, 1–3 FW. <b>Only starters score.</b> Lineups lock at the FPL deadline.</p>
      <p class="rules-p"><b>Forgot to set it?</b> Your last saved XI carries over, minus anyone you've since sold (repaired to a legal shape if needed). A best XI is auto-picked only if you've never set one at all. Nobody scores nil for being on holiday.</p>
      <p class="rules-p"><b>Auto-subs:</b> if a starter doesn't play at all that gameweek, your bench comes in automatically <b>in the order you've set</b> — leftmost first (tap two bench players on the pitch view to reorder).</p>
      <h3>The season</h3>
      <p class="rules-p"><b>GW1–33</b>: regular season, head-to-head every week — everyone plays everyone, nearly three times over. Win 3, draw 1, loss 0.</p>
      <p class="rules-p"><b>GW34</b>: handicap quarter-finals, one leg — top eight go through. 1v8, 2v7, 3v6, 4v5, with the higher seed starting on <b>half the table-points gap</b> between the pair (rounded down, capped at +15). Dominate the regular season, carry the cushion; scrape in level, get nothing.</p>
      <p class="rules-p"><b>GW35</b>: semi-finals, one leg — winner of 1v8 meets winner of 4v5, winner of 2v7 meets winner of 3v6. No handicaps from here.</p>
      <p class="rules-p"><b>GW36–38</b>: the final, three legs. Most legs won → cumulative points → higher regular-season finish. All other ties: higher seed advances.</p>
      <p class="rules-p"><b>The Monzo League Cup</b>, from GW8: last man standing. Lowest score each gameweek is eliminated; ties roll over.</p>
    </div>
    <div class="card">
      <h2>Scoring</h2>
      ${Object.keys(DEFAULT_SCORING).filter(k => sc[k] !== 0).map(k => `<div class="score-row"><span>${SCORING_LABELS[k]}</span><b class="gold">${sc[k] > 0 ? '+' : ''}${sc[k]}</b></div>`).join('')}
      <p class="muted" style="font-size:11.5px;margin-top:8px">Raw stats from the official FPL feed, scored by our table above. No captains. No bonus points. <b>No defensive-contribution (DEFCON) points.</b> Double gameweeks score on the week's combined stats.</p>
      <h3 style="margin-top:16px">Waivers &amp; trades</h3>
      <p class="rules-p"><b>Waivers:</b> the market follows the fixtures. The Trough closes <b>90 minutes before a gameweek's first kick-off</b>; while the gameweek plays, everyone is claim-only. Waivers resolve at <b>8pm the day after the gameweek's last fixture</b> (reverse table order — win a claim, drop to the back), which reopens the Trough. A second run at <b>8pm the day before the next gameweek's first fixture</b> clears claims on freshly dropped players. The Chairman can run waivers early, or open/close the Trough entirely.</p>
      <p class="rules-p"><b>The Trough:</b> whatever clears waivers is a free agent — first come, first served, instant. Squads stay at 14; someone always goes out.</p>
      <p class="rules-p"><b>The Window:</b> anyone who joins a Premier League club after draft night is locked away until the transfer window shuts. The Chairman then runs the <b>Window Draft</b> — first pick to whoever picked last on draft night, snaking back up, until a full lap of passes. Whatever's left spills into the Trough.</p>
      <p class="rules-p"><b>January:</b> new signings can't be taken until the window shuts — then it's bottom of the league up. Nitty-gritty confirmed nearer the time, as is tradition.</p>
      <p class="rules-p"><b>Trades:</b> player-for-player swaps between managers, agreed in the group, any time until the playoff lock. Doesn't use your waiver turn.</p>
      <p class="rules-p"><b>Playoff lock:</b> after GW33, non-playoff teams are frozen — no waivers, no trades, no passing players back.</p>
    </div>
    <div class="card">
      <h2>Honours board &#127942;</h2>
      ${HONOURS_BOARD.map(([yr, who, stars]) => `<div class="score-row"><span>${yr}</span><b>${esc(who)} ${stars}</b></div>`).join('')}
      <h3 style="margin-top:16px">Prize money</h3>
      <p class="rules-p">£50 each. Last season's split: £250 playoff winner, £130 runner-up, £75 last man standing — and <b>£145 to the site</b>. The site now costs <b>£0</b>, because we built our own. That's £145 back in the pot; redistribution to be argued about in the group chat.</p>
      <h3 style="margin-top:16px">The small print</h3>
      <p class="rules-p">Stats sync automatically from the official FPL feed (goals land within ~15 minutes on matchdays). The commissioner (${esc(managerName(state.managers[0]?.id))}) settles disputes, can act for absent managers, and adjusts points if the feed errs.</p>
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
function viewSettings() {
  const sc = state.settings.scoring;
  const admin = !netOn() || isCommissioner(); // only the Chairman edits league settings
  const ro = admin ? '' : 'disabled';
  return `<div class="settings-grid">
    <div class="card">
      <h2>Scoring rules ${admin ? '' : '<span class="tag">read-only</span>'}</h2>
      ${Object.keys(DEFAULT_SCORING).map(k => `
        <div class="score-row"><span>${SCORING_LABELS[k]}</span>
        <input type="number" step="1" data-score="${k}" value="${sc[k]}" ${ro}></div>`).join('')}
      <div class="score-row" style="margin-top:8px;border-top:1px dashed var(--line);padding-top:8px"><span>Lobus bonus <span class="muted" style="font-size:11px">(0 = off; +N any GW your starting Lobus scores or assists — ledger #1, Committee approval pending)</span></span>
      <input type="number" step="1" id="lobusBonus" value="${+state.settings.lobusBonus || 0}" ${ro}></div>
      <p class="muted" style="margin-top:10px;font-size:12px">Only your starting XI scores each gameweek. ${admin ? 'Changes apply instantly to all past and future matches.' : `Only ${esc(managerName(state.managers[0]?.id))} can change scoring.`}</p>
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
      </div>
      <p class="muted" style="font-size:12px;margin-top:10px">Backups only — the league syncs live on its own, no files to pass around. Export drops a snapshot to your device; import restores one if it all goes wrong.</p>
      <h3 style="margin-top:18px">Sign-in</h3>
      <p class="muted" style="font-size:12px;margin-bottom:8px">Managers sign in with an email link — no PINs, nothing to reset. Adding or changing a manager's email is done with the provisioning script (see the README).</p>
      <h3 style="margin-top:18px">Manual point adjustments</h3>
      <p class="muted" style="font-size:12px;margin-bottom:8px">If a stat feed gets something wrong, add/subtract points per player.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select id="adjPlayer" style="flex:1;min-width:200px">
          <option value="">Pick a player…</option>
          ${state.managers.flatMap(m => managerSquad(m.id).map(p => `<option value="${p.id}">${esc(p.name)} (${esc(m.name)})</option>`)).join('')}
        </select>
        <input type="number" id="adjPts" placeholder="±pts" style="width:90px">
        <button class="btn small" id="adjApply">Apply</button>
      </div>
      ${Object.entries(state.adjustments).filter(([, v]) => v).map(([pid, v]) =>
        `<div class="score-row"><span>${esc(PLAYER_BY_ID[pid]?.name)}</span><span class="gold">${v > 0 ? '+' : ''}${v}</span></div>`).join('')}
    </div>` : `<div class="card"><h2>League admin <span class="tag">Chairman only</span></h2><p class="muted" style="font-size:12.5px">Scoring, resets and point adjustments are the Chairman's (${esc(managerName(state.managers[0]?.id))}'s). Backups and demo mode live there too.</p><button class="btn ghost" id="demoBtn2" style="margin-top:10px">Demo mode — preview with fake results</button></div>`}
    <div class="card">
      <h2>The Constitution <span class="muted" style="font-weight:400;font-size:12px">read-only, as all constitutions should be</span></h2>
      <p class="rules-p">&sect;1 The title is the playoffs. The table is for arguing.</p>
      <p class="rules-p">&sect;2 Twelve managers, £50 a head, est. 2015. The waiting list is ten years deep and moving slowly.</p>
      <p class="rules-p">&sect;3 No club cap. Tussie's right to hoard the entire City squad is constitutionally protected.</p>
      <p class="rules-p">&sect;4 Waivers follow the fixtures: 8pm after the gameweek, 8pm before the next. Reverse table order. The Trough takes the rest.</p>
      <p class="rules-p">&sect;5 New signings wait for the Window Draft. January is bottom-up, nitty-gritty nearer the time, as is tradition.</p>
      <p class="rules-p">&sect;6 Every manager declares one (1) Lobus. The klaxon is ceremonial until the Committee says otherwise.</p>
      <p class="rules-p">&sect;7 Side deals belong in the Covenant Register, where they are timestamped, witnessed and mocked.</p>
      <p class="rules-p">&sect;8 The hydration break is inviolable.</p>
      <p class="rules-p muted" style="font-style:italic">Amendments require a Committee majority and will be ignored regardless. Full rules on the Rules page.</p>
    </div>
    ${SANDBOX && (!netOn() || isCommissioner()) ? (() => {
      const mk = state.mock;
      const cur = currentGwIndex();
      const gw = mk?.gw ?? cur;
      const stateLine = !mk ? 'The chamber is dark. No simulation running.'
        : mk.phase === 'live' ? `GW${GAMEWEEKS[mk.gw].n} is being simulated LIVE — points land over ~20 minutes. Watch the dashboard.`
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
  // the Simulation Chamber (sandbox-only; server refuses everywhere else)
  const mockAct = op => {
    const gw = +($('#mockGw')?.value ?? currentGwIndex());
    if (netOn()) {
      serverAct('mockMatchday', { op, gw })
        .then(() => toast(op === 'off' ? 'The chamber goes dark.' : op === 'live' ? `GW${GAMEWEEKS[gw].n} KICKS OFF — entirely imaginary, fiercely contested.` : `FULL TIME in the simulation. The results stand (in here).`))
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
  const lb = $('#lobusBonus');
  if (lb) lb.onchange = () => {
    if (netOn() && !isCommissioner()) { toast('Only the commissioner changes scoring'); render(); return; }
    const v = +lb.value || 0;
    if (netOn()) {
      serverAct('settingsSet', { key: 'lobusBonus', value: v })
        .then(() => toast(v ? `Lobus bonus live: +${v}. Marc will be told.` : 'Lobus bonus off. The klaxon stays ceremonial.'))
        .catch(() => {});
      return;
    }
    state.settings.lobusBonus = v;
    save(); toast(v ? `Lobus bonus live: +${v}. Marc will be told.` : 'Lobus bonus off. The klaxon stays ceremonial.');
  };
  const demoB = $('#demoBtn2'); if (demoB) demoB.onclick = enterDemo;
  const exportB = $('#exportBtn');
  if (!exportB) return; // non-commissioner: admin controls aren't rendered
  exportB.onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
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
        state = imported;
        if (netOn() && isCommissioner()) publishAll();
        save(); render(); toast('League imported');
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
  $('#adjApply').onclick = () => {
    if (netOn() && !isCommissioner()) { toast('Only the commissioner adjusts points'); return; }
    const pid = +$('#adjPlayer').value, pts = +$('#adjPts').value || 0;
    if (!pid) return;
    if (netOn()) {
      serverAct('adjustmentSet', { pid, value: (state.adjustments[pid] || 0) + pts })
        .then(() => toast('Adjustment applied')).catch(() => {});
      return;
    }
    state.adjustments[pid] = (state.adjustments[pid] || 0) + pts;
    save(); render(); toast('Adjustment applied');
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
        <h2 style="margin-bottom:2px">${esc(p.name)} <span class="pos-badge pos-${p.pos}">${p.pos}</span></h2>
        <p class="muted" style="font-size:12px">${esc(p.full)}</p>
        <p style="font-size:13px;margin-top:4px">${flagImg(p.team)} ${esc(p.team)}</p>
        ${p.news ? `<p class="warn" style="font-size:12px;margin-top:4px">${statusChip(p)} ${esc(p.news)}</p>` : ''}
        <p class="muted" style="font-size:12px;margin-top:4px">${owner ? `Owned by <b style="color:var(--text)">${esc(teamName(owner.id))}</b>` : 'Free agent' + (state.phase === 'season' && onWaivers(p) ? ' \u2014 on waivers' : ' \u2014 in the Trough')}</p>
      </div>
      <button class="btn ghost small" id="pcardClose" style="margin-left:auto">\u2715</button>
    </div>
    <div class="quota-bar" style="margin:10px 0">
      <span class="quota-pill">League pts <b class="gold">&nbsp;${pp.pts}</b></span>
      <span class="quota-pill">FPL official ${p.pts}</span>
      <span class="quota-pill" title="FPL expected points, next gameweek">xPts next ${playerXp(p).toFixed(1)}</span>
    </div>
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
        if (t.inId === pid) hist.push(`GW${GAMEWEEKS[t.gw].n}: ${t.trade ? 'traded to' : t.waiver ? 'claimed off waivers by' : 'signed from the Trough by'} ${teamName(t.managerId)}`);
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
      // one mandatory Lobus per manager (ledger #1) — changeable until GW1 kicks off
      const myLob = state.lobus?.[whoami];
      if (myLob === pid) {
        btn('&#128239; Your declared Lobus', () => toast('He is your Lobus. There is no undo, only a new Lobus.'), true);
      } else if (!myLob || !gwHasStarted(0)) {
        btn('&#128239; Declare my Lobus', () => {
          ov.remove();
          const crow = () => {
            playSound('cheer');
            toast(`LOBUS KLAXON — ${p.name} is now ${managerName(whoami)}'s Lobus. Big unit. Great feet for a big man.`);
          };
          if (netOn()) { serverAct('lobusDeclare', { pid }).then(crow).catch(() => {}); return; }
          state.lobus[whoami] = pid;
          save(); render();
          crow();
        }, true);
      }
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
        <span class="gs-name"><span class="gs-nm">${esc(p.name)}</span> ${natFlag(p)} ${statusChip(p)}</span>
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
      <button class="btn ghost small" id="gsClose" aria-label="Close search">&#10005;</button>
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
}
render();
manageWakeLock();
// stale save detected at load: offer recovery rather than a subtly-broken game
if (staleSave) {
  const bar = document.createElement('div');
  bar.className = 'stale-bar';
  bar.innerHTML = `<span>&#9888; This device's saved game doesn't match the current player feed — some players show as unknown.</span>
    <button class="btn small" id="staleReload">Reload latest draft</button>
    <button class="btn ghost small" id="staleDismiss">&#10005;</button>`;
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
  if (stale || anyMatchLive() || !Object.keys(state.matchStats || {}).length) syncNow(false);
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
