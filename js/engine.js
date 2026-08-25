/* The League — shared game engine.
 * Pure game law, extracted from app.js so Cloud Functions can enforce the same
 * rules the client renders. No DOM, no Firebase, no globals: everything comes
 * in through make(ctx) and explicit state arguments. Browser gets window.Engine
 * (script tag), node gets module.exports (require).
 *
 * Parity with app.js is guarded by test/engine.parity.test.js — if you change
 * a rule in one place, the parity suite is what tells you about the other. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const XI_RULES = { size: 11, GK: [1, 1], DF: [3, 5], MF: [2, 5], FW: [1, 3] };
  // Constitutional squad shape: 14 total. The lower bounds make the flex
  // genuinely singular — reaching 6 DF, 6 MF or 4 FW consumes the only room
  // for an outfield maximum, so two flex maxima cannot coexist.
  const SQUAD_RULES = { size: 14, min: { GK: 1, DF: 4, MF: 4, FW: 2 }, max: { GK: 2, DF: 6, MF: 6, FW: 4 } };
  const REGULAR_GWS = 33;
  const RATING_HISTORY_WEIGHT = 0.45;
  const DEFAULT_SCORING = {
    appearanceStart: 2,
    appearanceSub: 1,
    goalGK: 10, goalDF: 6, goalMF: 5, goalFW: 4,
    assist: 3,
    cleanSheet: 4,
    cleanSheetMF: 1,
    per3Saves: 0, // retired by the Chairman, 1 Aug 2026
    penSave: 5,
    penMiss: -3,
    yellow: -1,
    red: -5,
    ownGoal: -3,
    per2Conceded: -1,
  };

  const toArr = x => Array.isArray(x) ? x : (x ? Object.values(x) : []);

  /* ctx = {
   *   players:       PLAYERS array from js/data.js
   *   gameweeks:     [{n,label,from,to,finished}] (already mapped like app.js GAMEWEEKS)
   *   lastSeasonByCode: LAST_SEASON.byCode from js/history25.js, or {}
   *   now:           () => ms   (injectable clock)
   * } */
  function make(ctx) {
    const PLAYERS = ctx.players;
    const GAMEWEEKS = ctx.gameweeks;
    const FIXTURES = Array.isArray(ctx.fixtures) ? ctx.fixtures : []; // [{gw, date, ...}] — drives the waiver clock
    const LS_BY_CODE = ctx.lastSeasonByCode || {};
    const now = ctx.now || (() => Date.now());
    const PLAYER_BY_ID = Object.fromEntries(PLAYERS.map(p => [p.id, p]));

    const lastSeasonOf = p => LS_BY_CODE[p.code];
    const FPL_WIPED = PLAYERS.reduce((t, p) => t + (p.pts || 0), 0) < 2000;
    // the board's rating = last season rescored in THE LEAGUE's currency
    // (Committee, UAT night: FPL totals pay bonus + defensive-contribution
    // points this league doesn't). Fixed DEFAULT_SCORING so autopick ranks
    // identically to the client board — js/app.js rating() mirrors this.
    const _ratingCache = new Map();
    const rating = p => {
      let r = _ratingCache.get(p.id);
      if (r == null) {
        const ls = lastSeasonOf(p);
        const src = ls && ls.mp ? ls : (!FPL_WIPED && p.mp ? { mp: p.mp, g: p.g || 0, a: p.a || 0, cs: p.cs || 0 } : null);
        const apps = src ? src.mp / 90 : 0;
        let played = 0;
        if (src) {
          const csPts = p.pos === 'GK' || p.pos === 'DF' ? DEFAULT_SCORING.cleanSheet : p.pos === 'MF' ? DEFAULT_SCORING.cleanSheetMF : 0;
          played = Math.max(0, apps * DEFAULT_SCORING.appearanceStart * 0.85
            + src.g * DEFAULT_SCORING['goal' + p.pos] + src.a * DEFAULT_SCORING.assist + (src.cs || 0) * csPts
            + (p.pos === 'GK' ? apps * 0.5 : 0)
            - (p.pos === 'GK' || p.pos === 'DF' ? apps * 0.55 : 0));
        }
        // Thin/no sample → FPL-value prior. History earns full trust only at ~20
        // apps (half a season): Isak's 694-minute strike year must not read as
        // a real season (Ben, 18 Aug),
        // but valuation keeps a permanent 55% say — slightly ahead of points
        // (Ben, 18 Aug; was 25%); app.js mirrors.
        const prior = (p.price || 4.5) * 12;
        const w = RATING_HISTORY_WEIGHT * Math.min(1, apps / 20);
        r = Math.round(played * w + prior * (1 - w));
        _ratingCache.set(p.id, r);
      }
      return r;
    };

    /* ---- gameweek clock ---- */
    const gwFrom = i => GAMEWEEKS[i].from;
    function currentGwIndex() {
      const t = now();
      for (let i = 0; i < GAMEWEEKS.length; i++) if (t < new Date(GAMEWEEKS[i].to).getTime()) return i;
      return GAMEWEEKS.length - 1;
    }
    const gwIsOver = i => GAMEWEEKS[i].finished || now() > new Date(GAMEWEEKS[i].to).getTime();
    const gwHasStarted = i => now() > new Date(gwFrom(i)).getTime();
    // transfers NEVER land in a gameweek already being played (no retroactive
    // rescoring). A Simulation Chamber matchday counts as "being played" too —
    // pass state so a mock GW pushes deals to the next one, like the real thing.
    const transferGw = (state) => {
      const c = currentGwIndex();
      let g = c + (gwHasStarted(c) ? 1 : 0);
      // the clamp holds for as long as the mock is MOUNTED — the old post-run
      // carve-out let deals land back inside the settled mock GW and rewrite
      // scored squads (UAT night). js/app.js transferGw mirrors this.
      const mk = state && state.mock;
      if (mk && mk.gw != null && GAMEWEEKS[mk.gw]) g = Math.max(g, mk.gw + 1);
      return Math.min(g, GAMEWEEKS.length - 1);
    };
    const gwEvent = (state, i) => GAMEWEEKS[i] ? state.matchStats[`gw${GAMEWEEKS[i].n}`] : null;
    // The whistle test: the WHOLE round is present (every club accounted
    // for), every game has blown full time (the feed's `fp` flag flips at
    // the whistle, hours before FPL "confirms" the fixture), and half an
    // hour has passed since the last game could have finished. Settling on
    // this is safe HERE because the league pays no bonus: the hours FPL
    // spends checking a gameweek are bonus/BPS work we ignore (Committee,
    // 24 Aug — a Monday-night finish was going to leave Tuesday's waiver
    // order on the pre-gameweek table; Ben: "wait 30 mins and then bang",
    // no provisional messaging — the rare late correction just flows
    // through the next refresh). A postponement breaks fullRound, so a
    // part-played round can never settle early.
    const SETTLE_GRACE_MS = 150 * 60000; // last kickoff + ~115min to FT + 30min grace
    function roundBlown(state, i) {
      const gwN = GAMEWEEKS[i] && GAMEWEEKS[i].n;
      if (!gwN) return false;
      const gwFx = FIXTURES.filter(f => f.gw === gwN);
      const clubCount = new Set(PLAYERS.map(p => p.team)).size;
      const fullRound = gwFx.length > 0 && new Set(gwFx.flatMap(f => [f.home, f.away])).size === clubCount;
      if (!fullRound || !gwFx.every(f => f.finished || f.fp)) return false;
      const k = gwKicks(i);
      return !!k && now() >= k.last + SETTLE_GRACE_MS;
    }
    /* Settlement is derived afresh from the feed's flags every time, so a
     * feed regression (an fp flipping BACK) can un-settle a round that was
     * final an hour ago — and a waiver run caught in that window would
     * compute priority off a table missing the round, or worse, the
     * reverse-draft fallback (sol, settlement round, P1). This finds any
     * round that by the clock should long since have settled — stats synced,
     * every kick-off passed, grace elapsed — but is not final. The waiver
     * runner refuses to adjudicate while one exists and retries on the next
     * tick; the next-deadline backstop in gwIsOver bounds the delay. */
    function unsettledPlayedRound(state) {
      for (let i = 0; i < REGULAR_GWS; i++) {
        const ev = gwEvent(state, i);
        if (!ev || !Object.keys(ev.playerStats || {}).length) continue;
        const k = gwKicks(i);
        if (!k || now() < k.last + SETTLE_GRACE_MS) continue;
        if (gwStatus(state, i) !== 'final') return i;
      }
      return null;
    }
    function gwStatus(state, i) {
      const ev = gwEvent(state, i);
      const synced = !!ev && Object.keys(ev.playerStats || {}).length > 0;
      if (synced && (ev.final || gwIsOver(i) || roundBlown(state, i))) return 'final';
      if (synced) return 'live';
      if (gwHasStarted(i)) return 'underway';
      return 'upcoming';
    }
    // round robin, circle method; first team = home, alternated per round
    function pairingsFor(state, i) {
      if (i >= REGULAR_GWS) return [];
      const o = state.draft.order.length ? state.draft.order : state.managers.map(m => m.id);
      const n = o.length;
      if (n < 2) return [];
      const r = i % (n - 1);
      const rest = o.slice(1);
      const rot = rest.slice(r).concat(rest.slice(0, r));
      const line = [o[0], ...rot];
      const pairs = [];
      for (let k = 0; k < Math.floor(n / 2); k++) pairs.push([line[k], line[n - 1 - k]]);
      return i % 2 ? pairs.map(([a, b]) => [b, a]) : pairs;
    }

    /* ---- rosters ---- */
    function squadAt(state, mid, gwIdx) {
      const ids = new Set(state.draft.picks.filter(p => p.managerId === mid).map(p => p.playerId));
      for (const t of state.transfers) {
        if (t.managerId !== mid || t.gw > gwIdx) continue;
        ids.delete(t.outId);
        ids.add(t.inId);
      }
      return [...ids].map(id => PLAYER_BY_ID[id]).filter(Boolean);
    }
    function ownedIdsAt(state, gwIdx) {
      const ids = new Set();
      for (const m of state.managers) for (const p of squadAt(state, m.id, gwIdx)) ids.add(p.id);
      return ids;
    }
    function squadShapeOk(state, squad) {
      if (squad.length !== SQUAD_RULES.size) return false; // exact size — trades can't shrink/grow a squad
      if (new Set(squad.map(p => p.id)).size !== squad.length) return false; // nobody owns a player twice
      const c = { GK: 0, DF: 0, MF: 0, FW: 0 };
      squad.forEach(p => c[p.pos]++);
      return ['GK', 'DF', 'MF', 'FW'].every(pos => c[pos] >= SQUAD_RULES.min[pos] && c[pos] <= SQUAD_RULES.max[pos]);
    }
    // ownership computed from an arbitrary transfers list — for in-transaction checks
    function ownedIdsGiven(state, transfers, gwIdx) {
      const ids = new Set(state.draft.picks.map(p => p.playerId));
      for (const t of transfers) if (t && t.gw <= gwIdx) { ids.delete(t.outId); ids.add(t.inId); }
      return ids;
    }
    function squadIdsGiven(state, mid, transfers, gwIdx) {
      const ids = new Set(state.draft.picks.filter(p => p.managerId === mid).map(p => p.playerId));
      for (const t of transfers) if (t && t.managerId === mid && t.gw <= gwIdx) { ids.delete(t.outId); ids.add(t.inId); }
      return ids;
    }

    /* ---- new arrivals ---- */
    // The pen is for players genuinely NEW to the Premier League. A man who
    // moves between two PL clubs was already on the game and already drafted,
    // so he stays with his owner (Marc, 21 Aug: "konsa was already on the game
    // and drafted by somebody"). Comparing the club as well used to send every
    // intra-PL transfer back to the pen, where the owner could not even field
    // him. Membership of the draft-night snapshot is the whole question.
    const isArrival = (state, p) => !!state.draftPool?.ids && state.draftPool.ids[p.id] === undefined;
    const arrivalLocked = isArrival;

    /* ---- draft ---- */
    const totalPicks = state => state.managers.length * SQUAD_RULES.size;
    const pickNo = state => state.draft.picks.length;
    function currentManagerId(state) {
      const n = pickNo(state), m = state.managers.length;
      if (n >= totalPicks(state)) return null;
      const round = Math.floor(n / m), idx = n % m;
      const order = state.draft.order;
      return (round % 2 === 0) ? order[idx] : order[m - 1 - idx];
    }
    function canPick(state, mid, player) {
      if (arrivalLocked(state, player)) return false;
      const squad = squadAt(state, mid, currentGwIndex());
      const c = { GK: 0, DF: 0, MF: 0, FW: 0 };
      squad.forEach(p => c[p.pos]++);
      const size = squad.length;
      if (size >= SQUAD_RULES.size || c[player.pos] >= SQUAD_RULES.max[player.pos]) return false;
      let need = 0;
      for (const pos of ['GK', 'DF', 'MF', 'FW']) need += Math.max(0, SQUAD_RULES.min[pos] - c[pos] - (pos === player.pos ? 1 : 0));
      return need <= SQUAD_RULES.size - size - 1;
    }
    // deterministic autopick: manager's own list first, then best available by
    // rating with id as tie-break (the server must never flip a coin)
    /* Marc, 18 Aug: "can we do something about the players out on loan /
       transferred out. It seems a bit pointless having them included."

       It is worse than pointless. FPL marks them status 'u' — "Has joined Como
       permanently", "on loan for the rest of the season" — and they are ranked
       on LAST season's points, so Chalobah sits at #42 on 136 points while
       playing in Italy. He cannot score again for anybody, ever. An injury
       flag means "back soon"; this means "gone".

       This lives in the shared engine on purpose: the live draft autopicks on
       the SERVER (functions/index.js → eng.autoPickChoice), so a client-only
       fix would leave the real draft night still handing out men at Getafe. */
    const hasLeft = p => !!p && p.status === 'u';

    function autoPickChoice(state, mid) {
      const taken = new Set(state.draft.picks.map(p => p.playerId));
      const ok = p => p && !taken.has(p.id) && !hasLeft(p) && canPick(state, mid, p);
      let best = toArr(state.autolists?.[mid]).map(id => PLAYER_BY_ID[id]).find(ok);
      if (!best) best = PLAYERS.filter(ok).sort((a, b) => rating(b) - rating(a) || a.id - b.id)[0];
      // a board with nothing but departed men left is still a board: fall back
      // rather than stalling the clock on draft night
      if (!best) best = PLAYERS.filter(p => !taken.has(p.id) && canPick(state, mid, p))
        .sort((a, b) => rating(b) - rating(a) || a.id - b.id)[0];
      return best ? best.id : null;
    }

    /* ---- XI legality ---- */
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
    const autoXI = squad => legalizeXI([], squad);
    function lineupFor(state, mid, gwIdx) {
      const squad = squadAt(state, mid, gwIdx);
      const squadIds = new Set(squad.map(p => p.id));
      const stored = state.lineups[mid] || {};
      let xi = null;
      if (stored[gwIdx]) xi = toArr(stored[gwIdx]).filter(id => squadIds.has(id));
      else {
        for (let j = gwIdx - 1; j >= 0; j--) {
          if (stored[j]) { xi = toArr(stored[j]).filter(id => squadIds.has(id)); break; }
        }
      }
      if (!xi) return autoXI(squad);
      if (xi.length === XI_RULES.size && xiValid(xi)) return xi;
      return legalizeXI(xi, squad);
    }
    function benchFor(state, mid, gwIdx) {
      const xi = new Set(lineupFor(state, mid, gwIdx));
      const squad = squadAt(state, mid, gwIdx).filter(p => !xi.has(p.id));
      const stored = state.benchOrders?.[mid] || {};
      let ord = stored[gwIdx];
      if (!ord) for (let j = gwIdx - 1; j >= 0; j--) { if (stored[j]) { ord = stored[j]; break; } }
      ord = toArr(ord);
      const byId = Object.fromEntries(squad.map(p => [p.id, p]));
      const out = ord.filter(id => byId[id]).map(id => byId[id]);
      for (const p of [...squad].sort((a, b) => rating(b) - rating(a))) if (!out.includes(p)) out.push(p);
      return out;
    }

    /* ---- scoring kernel ---- */
    // Appearance points (Committee ruling, Jul 2026): a START is 2, coming on
    // as a SUB is 1, no 60-minute threshold. s.st is the number of starts in
    // the gameweek; per-fixture rows carry minutes only, so in a double
    // gameweek the appearance points are settled once from the start count +
    // fixtures actually played (additive, so allocation never matters).
    function appearancePts(sc, s, played) {
      const starts = Math.min(s.st || 0, played);
      return starts * sc.appearanceStart + (played - starts) * sc.appearanceSub;
    }
    function statPoints(scoring, player, s, skipAppearance) {
      // missing keys default to the canon table — a partial scoring object
      // must degrade to defaults, never to NaN (sol mock-night P3)
      const sc = { ...DEFAULT_SCORING, ...(scoring || {}) };
      // double gameweek: score per fixture and sum; appearance settled once here
      if (s && s.fx && s.fx.length > 1) {
        const played = s.fx.filter(f => (f.min || 0) > 0).length;
        return appearancePts(sc, s, played)
          + s.fx.reduce((t, f) => t + statPoints(scoring, player, f, true), 0);
      }
      const goalPts = { GK: sc.goalGK, DF: sc.goalDF, MF: sc.goalMF, FW: sc.goalFW }[player.pos] ?? sc.goalFW;
      const min = s.min ?? ((s.st || s.sub) ? 90 : 0);
      let pts = 0;
      if (!skipAppearance && min > 0) pts += appearancePts(sc, s, 1);
      pts += (s.g || 0) * goalPts + (s.a || 0) * sc.assist;
      pts += (s.og || 0) * sc.ownGoal + (s.pm || 0) * sc.penMiss;
      // A red-card deduction is the TOTAL disciplinary sanction for that
      // fixture: it already includes any yellow-card deductions. In
      // particular, second yellow + red is -5, never -7. DGWs are safe
      // because each fixture row is scored separately above.
      pts += (s.rc || 0) ? (s.rc || 0) * sc.red : (s.yc || 0) * sc.yellow;
      const cs60 = min >= 60 ? (s.cs || 0) : 0;
      if (player.pos === 'GK' || player.pos === 'DF') {
        pts += cs60 * sc.cleanSheet;
        pts += Math.floor((s.gc || 0) / 2) * sc.per2Conceded;
      }
      if (player.pos === 'MF') pts += cs60 * sc.cleanSheetMF;
      if (player.pos === 'GK') pts += Math.floor((s.sv || 0) / 3) * sc.per3Saves + (s.ps || 0) * sc.penSave;
      return pts;
    }
    function gwPlayerPoints(state, pid, gwIdx) {
      const s = gwEvent(state, gwIdx)?.playerStats?.[pid];
      const base = s ? statPoints(state.settings.scoring, PLAYER_BY_ID[pid], s) : 0;
      // the Chairman's per-gameweek correction — applies even when the feed
      // missed the appearance entirely (that IS the use case), and flows into
      // H2H results, the table and records because everything derives from here
      return base + (+(((state.adjustments || {})[gwIdx] || {})[pid]) || 0);
    }
    function appearedInGw(state, pid, gwIdx) {
      const s = gwEvent(state, gwIdx)?.playerStats?.[pid];
      return !!(s && (s.min || s.st || s.sub));
    }
    function effectiveXI(state, mid, gwIdx) {
      const xi = [...lineupFor(state, mid, gwIdx)];
      const ev = gwEvent(state, gwIdx);
      const anySynced = !!ev && Object.keys(ev.playerStats || {}).length > 0;
      if (!anySynced) return { xi, subs: [] };
      // auto-subs land at the final whistle of the round's LAST game, never
      // mid-round (Committee ruling, UAT night) — js/app.js mirrors this
      const gwN = GAMEWEEKS[gwIdx] && GAMEWEEKS[gwIdx].n;
      const gwFx = FIXTURES.filter(f => f.gw === gwN);
      // all-finished only counts when the WHOLE round is present — every club
      // accounted for (sol UAT P2; js/app.js mirrors this)
      const clubCount = new Set(PLAYERS.map(p => p.team)).size;
      const fullRound = gwFx.length > 0 && new Set(gwFx.flatMap(f => [f.home, f.away])).size === clubCount;
      const roundDone = (ev && ev.final) || gwIsOver(gwIdx) || (fullRound && gwFx.every(f => f.finished || f.fp));
      if (!roundDone) return { xi, subs: [] };
      const bench = benchFor(state, mid, gwIdx).filter(p => appearedInGw(state, p.id, gwIdx));
      const subs = [];
      for (const pid of [...xi]) {
        if (appearedInGw(state, pid, gwIdx)) continue;
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
      return { xi, subs };
    }
    function gwManagerPoints(state, mid, gwIdx) {
      const xi = effectiveXI(state, mid, gwIdx).xi;
      let pts = xi.reduce((t, pid) => t + gwPlayerPoints(state, pid, gwIdx), 0);
      const bonus = +state.settings.lobusBonus || 0;
      if (bonus) {
        const lob = state.lobus?.[mid];
        const s = lob && xi.includes(lob) ? gwEvent(state, gwIdx)?.playerStats?.[lob] : null;
        if (s && (s.g || 0) + (s.a || 0) > 0) pts += bonus;
      }
      return pts;
    }
    function standingsBefore(state, gwIdx) {
      const rows = state.managers.map(m => ({ id: m.id, h2h: 0, pts: 0 }));
      const byId = Object.fromEntries(rows.map(r => [r.id, r]));
      let anyFinal = false;
      for (let i = 0; i < Math.min(gwIdx, REGULAR_GWS, GAMEWEEKS.length); i++) {
        if (gwStatus(state, i) !== 'final') continue;
        anyFinal = true;
        for (const r of rows) r.pts += gwManagerPoints(state, r.id, i);
        for (const [a, b] of pairingsFor(state, i)) {
          const pa = gwManagerPoints(state, a, i), pb = gwManagerPoints(state, b, i);
          if (pa > pb) byId[a].h2h += 3;
          else if (pb > pa) byId[b].h2h += 3;
          else { byId[a].h2h++; byId[b].h2h++; }
        }
      }
      rows.sort((x, y) => y.h2h - x.h2h || y.pts - x.pts || x.id - y.id);
      return { rows, anyFinal };
    }

    /* ---- waivers ----
     * Committee timing (Toby, Jul 2026) — anchored to the FIXTURES, not the
     * calendar: the post-run at 8pm (London) the day AFTER a gameweek's last
     * fixture, the pre-run at 8pm the day BEFORE the next gameweek's first
     * fixture. The Trough is closed from 90 minutes before a gameweek's first
     * kick-off until its post-run has actually executed, then open. */
    const gwKicks = g => {
      const ts = FIXTURES.filter(f => f && f.gw === g + 1 && f.date).map(f => new Date(f.date).getTime());
      return ts.length ? { first: Math.min(...ts), last: Math.max(...ts) } : null;
    };
    // minutes ahead of UTC that Europe/London sits at the given instant (0 or 60)
    function londonOffsetMin(ms) {
      const s = new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const m = s.match(/(\d+)\/(\d+)\/(\d+),? (\d+):(\d+)/);
      if (!m) return 0;
      return Math.round((Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] % 24, +m[5]) - ms) / 60000);
    }
    /* The waiver clock, v2 (Committee, 12 Aug 2026): runs at 10:00
     * Europe/London every TUESDAY and FRIDAY — fixed days, no longer chasing
     * the fixture list. The Chairman can skip one named run by exception
     * (waiverMeta.skip = its slot id) for double gameweeks or a rogue
     * Wednesday finish; claims stay lodged and roll to the next run. Slots
     * exist only from the cutover epoch so the 14-day lookback can never
     * resurrect the old fixture-anchored gwN-post/pre ids. */
    const WAIVER_DAYS = [2, 5]; // getUTCDay() of the London wall-date: Tue, Fri
    const WAIVER_HOUR = 10;     // 10:00 Europe/London
    const WAIVER_EPOCH = Date.UTC(2026, 7, 13); // schedule v2 begins 13 Aug 2026
    // `hour`:00 Europe/London on (the London calendar day of `ms`) + dayOffset
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
    const slotAtFromId = id => {
      const m = /^wv-(\d{4})-(\d{2})-(\d{2})$/.exec(String(id || ''));
      return m ? londonAt(Date.UTC(+m[1], +m[2] - 1, +m[3], 12), 0, WAIVER_HOUR) : null;
    };
    // first Tue/Fri 10:00 London slot strictly after ms (never before the epoch)
    function nextSlotAt(ms) {
      const from = Math.max(ms, WAIVER_EPOCH - 3600e3);
      for (let off = 0; off <= 8; off++) {
        const at = londonAt(from, off, WAIVER_HOUR);
        if (at <= from) continue;
        if (WAIVER_DAYS.includes(londonWall(at).getUTCDay())) return at;
      }
      return null; // unreachable: a Tuesday or Friday always lands within 8 days
    }
    // the first run that can clear a finished gameweek: the next slot after
    // its last kick-off (kick-offs are never at 10am London, so a slot can't
    // land mid-match)
    const gwClearAt = g => { const k = gwKicks(g); return k ? nextSlotAt(k.last) : null; };
    // scheduled runs already due, within a bounded lookback (deterministic ids
    // let the server's run ledger make each one exactly-once)
    function waiverSchedule(horizonMs = 14 * 24 * 3600e3) {
      // 14-day lookback: a missed run must survive a long Functions outage.
      // Exactly-once is the run ledger's job (deterministic ids), not this window's.
      const t = now(), out = [];
      for (let at = nextSlotAt(t - horizonMs); at != null && at <= t; at = nextSlotAt(at)) {
        out.push({ id: waiverSlotId(at), at });
      }
      return out;
    }
    function nextWaiverRun(afterTs) {
      const t = typeof afterTs === 'number' ? afterTs : new Date(afterTs).getTime();
      return new Date(nextSlotAt(t) ?? (t + 7 * 864e5));
    }
    /* The run the scheduler will actually PROCESS next. The hourly tick fires
     * at :07 past, so a slot stays live for up to an hour after its advertised
     * 10:00 — a due-but-unexecuted slot keeps priority over the following one
     * (sol launch audit, 13 Aug: a Skip pressed at 10:03 stamped TUESDAY's run
     * while Friday's claims still executed at 10:07). Anything a Skip button
     * or a "next run" line shows the Chairman must come from here, never from
     * nextWaiverRun(now). Same lookback as waiverSchedule. */
    function nextProcessableWaiverRun(state, horizonMs = 14 * 24 * 3600e3) {
      const t = now();
      const due = nextSlotAt(Math.max(lastWaiverRun(state), t - horizonMs));
      return new Date(due != null && due <= t ? due : (nextSlotAt(t) ?? t + 7 * 864e5));
    }
    const waiverControl = state => state.waiverMeta?.control || 'auto';
    const lastWaiverRun = state => state.waiverMeta?.lastRun ? new Date(state.waiverMeta.lastRun).getTime() : 0;
    function waiverRunDue(state) {
      if (state.phase !== 'season' || waiverControl(state) !== 'auto') return false;
      const lr = lastWaiverRun(state);
      // a Chairman-skipped slot is not due — its claims roll to the next run
      return waiverSchedule().some(d => d.at > lr && d.id !== state.waiverMeta?.skip);
    }
    /* Trough state under auto control: closed from 90 min before a gameweek's
     * first fixture; reopens only once that gameweek's post-run has executed.
     * A Simulation Chamber matchday (sandbox only) closes it on the mock clock —
     * the mock-waivers rehearsal must behave like the real thing (2 Aug: Marc
     * trough-signed mid-"gameweek" because only real time was consulted). */
    function troughWindow(state) {
      const mk = state.mock;
      if (mk && mk.gw != null) {
        const mkT = typeof mk.t === 'number' ? mk.t : 0;
        // mock:true marks these closures as chamber-driven — callers must let
        // them outrank manual waiver controls (a stale "open" is not a licence
        // to sign mid-simulation)
        if (mk.phase === 'live') return { open: false, until: null, mock: true, why: 'the gameweek is underway (simulation)' };
        if (mk.phase === 'final' && lastWaiverRun(state) < mkT) return { open: false, until: null, mock: true, why: 'awaiting the post-gameweek waiver run (simulation)' };
      }
      const t = now();
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
      if (lastWaiverRun(state) < post) return { open: false, until: null, why: 'awaiting the post-gameweek waiver run' };
      return { open: true };
    }
    /* ---- the Simulation Chamber's deterministic matchday (sandbox) ----
     * VERBATIM parity with app.js mockScorelines/mockGwStats — the server
     * must derive the SAME pretend stats the clients render, or waiver order
     * adjudicates off a different table than the one on screen (Toby, 9 Aug:
     * run processed reverse-DRAFT, screen showed reverse-mock-table). The RNG
     * call ORDER is part of the contract: any drift in when rnd() is consumed
     * changes every stat downstream. Guarded by test/mockparity (browser). */
    const MOCK_KO_SPREAD = 0.6;
    const mockFxElapsed = (ko, frac) => Math.round(90 * Math.max(0, Math.min(1, (frac - ko) / (1 - MOCK_KO_SPREAD))));
    const mockRnd = seed => { let s = (seed >>> 0) || 1; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };
    function mockScorelines(state, gwIdx, seed) {
      const gwN = GAMEWEEKS[gwIdx].n;
      const score = rnd => { const r = rnd(); return r < 0.28 ? 0 : r < 0.62 ? 1 : r < 0.85 ? 2 : r < 0.96 ? 3 : 4; };
      const fxSrc = Array.isArray(state.fixtures) && state.fixtures.length ? state.fixtures : FIXTURES;
      const gwFx = fxSrc.filter(x => x.gw === gwN);
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
    function mockGwStats(state, gwIdx, seed, frac) {
      const ps = {};
      const featured = new Set();
      for (const m of state.managers) for (const p of squadAt(state, m.id, gwIdx)) featured.add(p.id);
      for (const arr of Object.values(state.hamCup?.entries || {})) for (const pid of toArr(arr)) featured.add(+pid);
      const { teams } = mockScorelines(state, gwIdx, seed);
      const haveFixtures = Object.keys(teams).length > 0;
      const roster = [];
      for (const pid of featured) {
        const p = PLAYER_BY_ID[pid];
        if (!p) continue;
        if (haveFixtures && !teams[p.team]) continue;
        const el = haveFixtures ? mockFxElapsed(teams[p.team].ko, frac) : Math.round(90 * frac);
        const rnd = mockRnd(seed * 7919 + pid * 104729);
        if (rnd() < 0.07) continue;
        const started = rnd() < 0.85;
        const mins = started ? el : Math.max(0, el - 60);
        if (!mins) continue;
        roster.push({ p, rnd, started, mins, el });
      }
      const byTeam = {};
      for (const r of roster) (byTeam[r.p.team] = byTeam[r.p.team] || []).push(r);
      const goalW = { FW: 5, MF: 3, DF: 1, GK: 0.05 };
      const credit = {};
      for (const [team, sl] of Object.entries(teams)) {
        const squad = byTeam[team] || [];
        const rnd = mockRnd(seed * 13007 + team.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 251);
        for (const t of sl.times) {
          const pool = squad.filter(r => r.started || t > 60);
          const tw = pool.reduce((a, r) => a + goalW[r.p.pos], 0);
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
    function waiverOrder(state) {
      // reverse of the CURRENT table — every finished GW counts. Passing the
      // current GW index here silently dropped the round that just finished
      // (currentGwIndex doesn't advance until the next one starts).
      const { rows, anyFinal } = standingsBefore(state, REGULAR_GWS);
      const base = anyFinal ? rows.map(r => r.id) : [...state.draft.order];
      return [...base].reverse();
    }
    /* Pure waiver resolution. state.claims here is the MERGED view
     * {gwIndex:{mid:[{in,out}]}} (the server assembles it from the private
     * per-uid nodes). Mutates nothing; returns everything the caller must
     * apply atomically:
     *   records        — transfer records to append (n filled in-txn)
     *   executed       — [{mid,in,out}] for the toast/minutes
     *   buckets        — claim bucket indexes to clear
     *   stampedMeta    — waiverMeta with lastRun set to runStart
     *   strippedLineups— {mid: newXiArray} lineups with the out-player removed */
    function resolveWaivers(state, runStart) {
      const cur = currentGwIndex();
      const tgw = transferGw(state);
      const work = {
        ...state,
        transfers: [...state.transfers],
        lineups: JSON.parse(JSON.stringify(state.lineups || {})),
      };
      const buckets = Object.keys(state.claims || {}).map(Number).filter(g => g <= cur).sort((a, b) => a - b);
      const queue = waiverOrder(state);
      const pending = {};
      for (const mid of queue) { pending[mid] = []; for (const g of buckets) pending[mid].push(...toArr(state.claims[g]?.[mid])); }
      const executed = [];
      const records = [];
      const strippedLineups = {};
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (let qi = 0; qi < queue.length; qi++) {
          const mid = queue[qi];
          while (pending[mid].length) {
            const c = pending[mid].shift();
            const inP = PLAYER_BY_ID[c.in];
            if (!inP || ownedIdsAt(work, tgw).has(c.in)) continue;
            if (!squadAt(work, mid, tgw).some(x => x.id === c.out)) continue;
            if (!squadShapeOk(work, [...squadAt(work, mid, tgw).filter(x => x.id !== c.out), inP])) continue;
            // t must be STRICTLY after this run's lastRun stamp or the player
            // dropped BY the run is instantly free — the drop-lock test is
            // t > lastRun (Toby, 9 Aug: "dropped in waivers are put in trough";
            // same bug the legacy engine fixed on 6 Jul, reborn in the port)
            // code travels with every ledger record: FPL ids are positional and
            // shift on feed rebuilds; code is immutable and makes a record
            // recoverable (Chairman's Desk §3b, built 16 Aug pre-draft)
            const rec = { managerId: mid, outId: c.out, outCode: PLAYER_BY_ID[c.out]?.code ?? null, inId: c.in, inCode: inP.code ?? null, gw: tgw, t: runStart + 1, waiver: true };
            work.transfers.push(rec);
            records.push(rec);
            const lu = work.lineups[mid]?.[tgw];
            if (lu) {
              work.lineups[mid][tgw] = toArr(lu).filter(id => id !== c.out);
              strippedLineups[mid] = work.lineups[mid][tgw];
            }
            executed.push({ mid, in: c.in, out: c.out });
            queue.splice(qi, 1); queue.push(mid);
            progressed = true;
            break;
          }
          if (progressed) break;
        }
      }
      const stampedMeta = { ...state.waiverMeta, lastRun: new Date(runStart).toISOString() };
      // a skip names ONE slot; once that slot is behind a real run it's spent
      // (a manual run-now must not leave a stale skip suppressing next week)
      const skipAt = slotAtFromId(stampedMeta.skip);
      if (skipAt != null && skipAt <= runStart) stampedMeta.skip = null;
      return { records, executed, buckets, stampedMeta, strippedLineups, tgw };
    }

    /* ---- window draft ---- */
    function wdActor(state) {
      const wd = state.windowDraft, ord = toArr(wd.order);
      const lap = Math.floor(wd.turn / ord.length), i = wd.turn % ord.length;
      return lap % 2 === 0 ? ord[i] : ord[ord.length - 1 - i];
    }

    return {
      XI_RULES, SQUAD_RULES, REGULAR_GWS, DEFAULT_SCORING, FPL_WIPED,
      toArr, rating, lastSeasonOf,
      currentGwIndex, gwIsOver, gwHasStarted, transferGw, gwEvent, gwStatus, roundBlown, unsettledPlayedRound, gwFrom, pairingsFor,
      squadAt, ownedIdsAt, squadShapeOk, ownedIdsGiven, squadIdsGiven,
      isArrival, arrivalLocked,
      totalPicks, pickNo, currentManagerId, canPick, autoPickChoice, hasLeft,
      xiCounts, xiValid, legalizeXI, autoXI, lineupFor, benchFor,
      statPoints, gwPlayerPoints, appearedInGw, effectiveXI, gwManagerPoints, standingsBefore,
      nextWaiverRun, nextProcessableWaiverRun, waiverControl, lastWaiverRun, waiverRunDue, waiverOrder, resolveWaivers,
      mockScorelines, mockGwStats,
      gwKicks, gwClearAt, nextSlotAt, waiverSlotId, slotAtFromId, waiverSchedule, troughWindow,
      wdActor,
    };
  }

  return { make, XI_RULES, SQUAD_RULES, REGULAR_GWS, RATING_HISTORY_WEIGHT, DEFAULT_SCORING };
});
