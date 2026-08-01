# SOL 5.6 — Review brief: the 1 August demo-night round (Marc's feedback batch)

You are sol 5.6, adversarial reviewer for The League (12-manager EPL draft
fantasy, est. 2015, real money, twelve years of history). You have GO'd the
auth build after seven rounds and GO'd the club office after four. Tonight a
live feedback session with Marc Conway produced a large batch of changes,
written and shipped in one sitting while he tested. That is exactly the sort
of session that ships a regression. Find it before the twelve do.

## Scope (commits `dab88c4` + `493714e` on main; prod + beta + functions all deployed)

Diff base: `ecbe5b0` (last FPL data refresh before the batch).
`git diff ecbe5b0..HEAD` is the whole round (a consolidation commit landed
after 493714e — review to the branch tip). Functions ARE live.

**Late consolidation commit (after the brief below was first drafted):**
- Trough activity + Top players cards EXTRACTED from viewTable into
  troughActivityCard()/topPlayersCard() and moved to the Data Room under Team
  data / Player data (Marc's taxonomy; Ben: "remove stuff that is now in
  data"). viewTable now ends at tableGwCard(). Check nothing else referenced
  `allDrafted` (it moved inside topPlayersCard) and that the Table view's
  zoom-out regression (the overflow-x wrapper story from b37b37d) can't
  recur via the RELOCATED table — the wrapper travelled with it.
- Cup nav renamed: ['cup', 'Cup competitions', 'Cups'].
- Ham draw floor: random GW now drawn from max(cur+2, index 19) — GW20+.
  Server hamAdmin still validates only CUP_START..REGULAR_GWS; the floor is
  client-side. Decide whether that gap matters (a stale client could still
  draw early — Chairman-only surface).
- Ham Cup head copy now states the freeze rule ("as the Trough stood when
  the selection window opened, a week before the tie").

## What shipped

**1. Ham Cup mechanics (the big one — server + client)**
- Selection window: opens 7 days before the cup GW's first kickoff, or at the
  draw if drawn later, or at the Chairman's early-open. `hamOpensAt(cup, eng)`
  in functions/index.js (near ACTIONS.hamEnter) mirrors `hamOpensAt(hc)` in
  js/app.js (near gwKicks). `opensAt = max(drawnAt, firstKick − 7d)`;
  `openedAt` on the node overrides. NO fixtures for that GW → opens at draw.
- Pool freeze: at window open the OWNED-player-id set is written to
  `hamCup.frozen`; eligibility is judged against the snapshot, not the live
  Trough. Three freeze paths: hourly `waiverTick` sweep (both leagues, new
  block at the end of the tick), lazy first-entry freeze inside the hamEnter
  txn, and `hamAdmin {op:'open'}` (freezes as it opens). Entries validate
  against `frozen` pre-txn, and the txn callback refuses if a
  differently-frozen pool conflicts with the submitted XI.
- `hamAdmin {op:'open'}` is NEW (Chairman-only). Redraw writes a fresh
  `{gw, drawnAt, entries:{}}` node — frozen/openedAt implicitly cleared.
- Client: closed-window card (shows open time, Chairman early-open button),
  open-window card copy, local-mode freeze on first render of an open window
  (`!netOn()` guard — check it), `entered.length > 0` heals windowOpen client
  side (entries imply the window opened somewhere).
- Picker filters: position chips (`data-hampos`) + club dropdown (`#hamClub`)
  in hamView; candidates still rating-sorted, top 30.

**2. Playoff QF handicap is now POINTS-BASED (Toby proposed, Marc echoed, Ben ruled)**
- `qfHandicap(ptsHigh, ptsLow) = min(15, floor(max(0, gap)/2))` of regular
  season TABLE points. `QF_HANDICAPS` const is GONE. Four render sites:
  playoffState (winner maths), playoffCard pre/post text + tieRow, the H2H
  table QF column (now computed per-pair from the LIVE displayed standings:
  `k = min(i, 7−i)`, plus sign for top four, minus for 5th–8th, muted 0), and
  the Rules page copy. test/sim.test.js's independent recompute now derives H
  from the same formula — audit that this is not "the code testing itself":
  the sim's table comes from randomised scores, so the formula is exercised
  against arbitrary gaps, but confirm a nonzero AND a zero handicap actually
  occurred in a sim run (log it) or the recompute check is weaker than it
  reads.

**3. The Data Room (new page) + dashboard reshape**
- NAV_ITEMS gained `['data','The Data Room','Data']` (after table), NAV_ICONS
  gained `data`, render() gained the case. Awards + Treatment Room moved OFF
  the dashboard into viewData() with League data / Player data section labels.
- Dashboard: "Top six" replaced by the FULL 12-row table with a dashed
  playoff-cut line after 8th and own-row highlight; "Full table" data-goto
  button. Install card gained an absolute-positioned ✕ (`#a2hsX`).
- `bindAwardsBits()` (copyMinutes + trmMore) extracted, called from bindDash
  AND bindData. The Minutes button now only exists in the Data Room.
- test/matchday.smoke.js's awards/treatment probe moved to `state.view='data'`.

**4. Committee's Awards rebuilt (Marc's six)**
- weeklyAwards: He's A Handful™ + No-Footed Full Back DELETED (with their
  gwEvent scan). Returns the six: hi/lo/jammy/robbed/hiding/bench.
- NEW seasonAwards(): same six across every settled GW (gate: ≥2 finals),
  rendered as a second section with GW tags. committeeMinutes destructure
  trimmed to the six.

**5. Lobus: Registry card deleted, LOBUS KLAXON added**
- lobusCard() gone from the dashboard and from the codebase. Declarations
  (player card) and the dormant lobusBonus wiring remain.
- vidiDiff: when any player's goal count increments and he is someone's
  declared Lobus, an extra klaxon line lands on the tape. Note
  `Object.entries(state.lobus)` yields STRING manager ids — check the `+lmid`
  / `+lpid` coercions. Demo tape seeds one klaxon line (enterDemo).

**6. Scoring: per3Saves → 0 (both js/app.js DEFAULT_SCORING and js/engine.js)**
- functions/engine.js re-copied (noeval parity test pins it). Rules page now
  hides zero-value scoring rows (`filter(k => sc[k] !== 0)`) — negative rules
  must still render. Settings editor still shows the row (deliberate).
- ⚠️ The LIVE SANDBOX league was seeded before this change and still carries
  per3Saves: 1 — Ben is flipping it by hand in sandbox Settings. The real
  league is unseeded and will take the new default. Confirm both.

**7. Smaller items**
- Fixtures page: finished fixtures render a `.fx-yt` YouTube-search link
  (encodeURIComponent'd home/away, target _blank rel noopener); `.fx` is now
  flex-wrap and the link is a full-width bottom strip.
- Duel view ("Show opponent"): opponent's BENCH now renders under their pitch
  (`.duel-bench`, benchFor order, points shown once the GW has started,
  data-pcard taps).
- Club office hoardings: the toggle was always working — `[data-board].active`
  CSS was MISSING, so selection was invisible. Rule added (plus
  `[data-hampos].active`).
- Kit sponsor text: scales by length (4.6/3.8/3.1) and compresses via
  `textLength`/`lengthAdjust="spacingAndGlyphs"` when the estimate exceeds the
  chest (17 units). Check Safari/WebKit rendering of textLength on <text>,
  and that stroke-width scaling keeps short sponsors legible at 18px kits.
- NAV rename: The Console → The Draft Console (NAV_ITEMS + draft archive h2).
- AD_BOARDS: INTERLINK RECRUITMENT replaced IN PLACE by KENDALS — slot swap,
  array length still 27, BOARD_COUNT parity must hold. Confirm no splice.
- Provisioning: Marc's email corrected (hotmail → gmail), old hotmail auth
  user deleted, membership re-verified 12/12 both leagues. Check nothing else
  keyed on the pruned uids (private tree, claims).

## Attack surfaces — where I'd look first

1. **Ham freeze races.** Two first-entries racing: both compute `ownedNow`
   from their own state read; one commits the freeze, the loser's callback
   re-runs against the committed `frozen` and must refuse ONLY if his XI
   actually conflicts. Also: tick-freeze racing a transfer (ownedNow read
   outside the txn), redraw racing an entry (existing gw-pin), cancel racing
   the tick sweep.
2. **Emulator coverage honesty.** functions.test passed 211 UNCHANGED —
   which means the existing hamEnter tests never hit the closed-window
   refusal. Work out why (synthetic feed's cup GW has no fixtures → opensAt
   falls back to drawnAt → always open?) and ADD emulator checks for: closed
   window refuses, `op:'open'` opens + freezes, frozen pool rejects a
   newly-dropped player, first-entry freeze race. testenv emits synthetic
   fixtures — extend the calendar if CUP_START is out of range (known
   limitation from the r4 round).
3. **Ham local/demo paths.** hamCupCard mutates state during render for the
   local freeze — confirm it can't fire in net mode, can't loop, and that
   ?demo (entries pre-seeded, gw 8) renders the OPEN card not the closed one.
4. **QF column pairing maths.** Row 5th–8th shows minus-the-handicap of pair
   `k = min(i, 7−i)` — confirm the displayed number for 5th is the 4v5
   handicap, 8th is the 1v8 handicap, on a live (partial) table AND the final
   one, and that the playoffCard's actual winner maths uses the FINAL table
   (standingsBefore(REGULAR_GWS)) while the column is deliberately
   provisional.
5. **Dashboard/Data Room plumbing.** Deep link #data, back/forward, More
   sheet icon + active state, the moved Minutes button actually copying, no
   orphaned handlers on dash, matchday.smoke honestly probing the new view
   (not passing vacuously on an empty dash).
6. **Season awards over a part-season.** 2 finals, 33 finals, ties everywhere
   (identical scores), no-bench-waste season, and the committeeMinutes text
   with the six only.
7. **320/390px pass** on: dashboard 12-row table + dashed cut, Data Room,
   duel bench wrap, fixtures cards with the .fx-yt strip, ham filter row,
   install ✕ not overlapping the h2.
8. **Klaxon integrity.** Goal diff only (not assists), one line per declaring
   manager, esc/teamName on manager-controlled names, tape cap (60) not
   flooded by a DGW brace.

## Honesty notes (mine, for you to verify not trust)

- No NEW automated tests were added tonight except moving matchday.smoke's
  probe. The ham window/freeze paths, the Data Room view, season awards, duel
  bench, and the klaxon are covered by "suites still green", not by targeted
  checks. That is the round's biggest weakness — write the missing checks
  (browser smoke: scratchpad pattern is fine; emulator: extend
  functions.test.js) rather than only eyeballing.
- The sponsor textLength change and the .fx-yt strip were not screenshotted
  at phone widths before shipping.
- sim 69/69, dgw, parity, noeval 51, feed 29, waiverclock 17, authui 16,
  offline-ux 16, r3ui 45, ux3 48, scouting 10, matchday 49, rules 21,
  functions 211, migrate, backup 21, provision 13, emaillink 18 — all green
  at 493714e.

## Deliverable

Findings ranked P0/P1/P2/P3 with repro, the new tests you added (commit
them), and a one-word GO/NO-GO on leaving this build live for the lads'
mock-draft session. The sandbox mock draft is IMMINENT — weight anything
that can wedge a draft or a sandbox waiver run accordingly.
