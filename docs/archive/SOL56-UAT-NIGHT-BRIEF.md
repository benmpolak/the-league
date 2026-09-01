# SOL 5.6 BRIEF — UAT-NIGHT ROUND (4 Aug 2026): VERIFY GO

You are sol 5.6, the adversarial reviewer for The League (see prior briefs
SOL56-MOCKNIGHT-BRIEF.md and earlier — same rules of engagement: check out the
repo read-only, run any suite, attack the changes, report findings as
P0/P1/P2/P3 with repros, and end with a one-word GO or NO-GO for draft night).
Your last verdict was GO at a8aa3d3 (mock-night r2). Since then the lads ran a
full live UAT (draft → Simulation Chamber GW1 → waivers) and a large batch
shipped. Commits to review, oldest first, all on main:

- 7c7cb24 — Trough squad pitch-style; QF handicaps use table Points
- b3a7d60 — UAT prep: staggered chamber kickoffs (MOCK_KO_SPREAD=0.6,
  per-fixture clocks in mockScorelines/mockGwStats/patchMockFixtures);
  Assistant Manager briefing card (assistantCard/assistantGwProj) + ASSISTANTS
  stable + clubSet `assistant` field server-side (cleanAssistant,
  ASSISTANT_COUNT parity, import whitelist); QF handicap = FULL Points gap
  (qfHandicap, cap deleted); lobus declarations removed (constitution
  renumbered, klaxon now fires off LOBUS_LIST); Wilko provisioned
- 9fbd4ec — ASSISTANTS stable now real famous No. 2s
- 7ecdf69 — ux3 S11 fixture carries assistant
- 7bc7e8f — Gazette review: per-match reports w/ star man stat line +
  provenance (draft round/pick, trough/waiver/trade); Trough squad card =
  XI in formation + numbered bench
- 4017351 — claims desk ALWAYS renders (empty state explains); "Done this
  window" ledger; week-one Programme draft recap
- 8bd0c4b — waiver claim LADDERS: only identical {in,out} pair blocked
- d46f9bb — Gazette nameplate/two-column newspaper CSS; #trOut player-out
  dropdown restored beside the pitch (shared transfersView.out)
- 4fd9473 — same-view re-renders pin scroll position (rAF restore)
- 2e82b92 — pick flash-up banner (pickFlash in renderKlaxons scan), squad
  panel "Anyone…" dropdown (draftSquadTab holds a mid), parade 1400ms +
  promoted-club flag bearers, pool "Rate" column
- e550a7e — rating() = last season rescored in LEAGUE currency
  (leagueSeasonSrc/leaguePtsFrom, fixed DEFAULT_SCORING, cached), engine
  mirrors exactly; leagueArchivePpg refactored onto shared source
- 985a76e — **missed cutover step found in the field**: functions/.env still
  pointed DATA_BASE_URL at the frozen auth-v2 branch (feed generated 27 Jul)
  → every waiver run tripped the stale-feed guard, surfacing as bare
  "internal". Override deleted; guard now HttpsError failed-precondition.
- 90cc769 — **the big one.** Three field bugs from the live UAT:
  1) transferGw: the chamber clamp now holds while mock is MOUNTED. The old
     post-run carve-out (`lastWaiverRun() < mk.t`) fell back to the real
     calendar (gw 0, GW1 unstarted) so post-run trades/signings landed
     RETROACTIVELY inside the settled mock GW — results flipped, returns
     vanished, and Toby traded Donnarumma twice (15-man, 3-GK squad).
     app.js + engine both changed; troughWindow (open/shut) deliberately
     unchanged.
  2) effectiveXI: auto-subs now land only when the round is DONE
     (ev.final || gwIsOver || every fixture finished) — Committee ruling
     after Wilko's starter was "subbed out" before his Monday fixture kicked
     off. app.js + engine.
  3) My Team defaults to the next UNSETTLED gw once a round is final.
  Plus scripts/repair_sandbox_donnarumma.js (one-shot sandbox surgery).
- 5cd28b5 — nextOppHtml falls back to the player's next fixture ("next: …")
  when the selected gw has no fixture on-device; boot resync when fixtures
  are truncated (missing next round).

Functions were deployed four times tonight; live sandbox retains the
corrupted records until Ben runs the repair script or resets.

## Suites at HEAD (all green when handed to you)
offline: noeval 51, feed 29, waiverclock 21, sim (full season), dgw, parity 8.
browser: authui 16, offline-ux 16, r3ui 45, ux3 48, scouting 10, prep 24,
matchday 49, demo-night 32, mocknight 13.
emu: rules 22, functions 243, migrate, backup 22, provision 13, emaillink 18.

## Attack surfaces — where I'd go if I were you
1. **transferGw clamp**: prove the Donnarumma double-trade is dead (mock final
   + run complete → trade/trough/waiver/windowDraft all land ≥ mk.gw+1 on BOTH
   engines). Then attack the REAL-league path: with no mock, is behavior
   byte-identical to before? And chamber lifecycle: switch-off (`mock:null`) →
   clamp releases — can a deal race the switch-off and still land low?
2. **Honesty gap, stated plainly: I added NO regression test for the clamp fix,
   the effectiveXI round-done gate, or the teamView default.** waiverclock 21
   and functions 243 pass but pre-date these branches. Demand or write the
   pins.
3. **effectiveXI round-done gate**: postponed fixture never finishes →
   subs wait for gwIsOver (time-based) — verify no wedge beyond the known
   limit. DGW: one played, one postponed. Also scoring parity: engine vs app
   disagree on `roundDone` inputs? (engine uses ctx FIXTURES; app uses
   state.fixtures — a device with truncated fixtures now computes roundDone
   differently than the server: CHECK whether that can flip a live standings
   display vs settled truth.)
4. **Claim ladders**: same-in different-out AND same-out different-in chains;
   adjudication one-winner invariants under ladders on both engines; claimSet
   accepts ≤30 — can a 30-rung ladder starve others or slow the txn?
5. **League-currency rating**: client/engine parity (exact formula, cache
   staleness on scoring edits — client cache is permanent per session BY
   DESIGN since it pins DEFAULT_SCORING; confirm nothing reads it expecting
   live-scoring sensitivity). Autopick determinism (id tiebreak preserved).
6. **Stagger**: mockGwStats per-fixture clocks — CS/gc/minutes consistency at
   partial fracs; memo granularity vs 60s tick; unpatch restores after feed
   replacement mid-mock (WeakSet identity note from your r2 still holds?).
7. **Feed cutover fix**: functions now read Pages. Kill-switch scenarios:
   Pages outage mid-Tuesday-run → stale guard message path; emulator
   DATA_BASE_URL override unaffected (test:emu green says yes — verify).
8. **pickFlash**: fires on others' picks only; page-load replay guarded by
   _klaxSeen; XSS via manager/team names in the banner (esc coverage).
9. **UI batch**: scroll pin (rAF) vs intentional anchors; #trOut dropdown +
   pitch selection two-way; "Anyone…" dropdown in both panels (duplicate DOM
   ids across sidebar + phone drawer — I used querySelectorAll but the ids
   still collide; call it if it bites); claims desk always-on (spectator
   path); Gazette markup (prog-cols column layout at 320/390, esc coverage in
   match reports incl. hostile team names in headlines).

## The question
The lads intend more waiver-cycle tests this week and the REAL draft is
imminent (GW1 deadline 21 Aug). Verify the three field-bug fixes are dead by
independent repro, sweep the batch above, then one word: **GO or NO-GO** for
draft night.

## ADDENDUM — commits after the brief was first cut (review these too)
- 31c6386 drinks-break anthems alternate (bonjovi/pitbull synth, n%2)
- Sandbox REPAIRED live (scripts/repair_sandbox_donnarumma.js ran clean:
  all squads 14, Donnarumma solely Wilko's — verify the invariant holds)
- Trough/trade desk views moved to the LANDING-GW lens: mySquadCard,
  myPitchCard, #trOut options, squadAfterOut, trade give/meAfter, pool
  owned/ownedBy all use transferGw() not currentGwIndex() (Toby's "I don't
  own Vicario!"). ATTACK: display vs server-validation consistency, and the
  no-mock real-season path where transferGw==cur pre-deadline.
- Vidiprinter goal lines carry BOTH scoreboards: live fixture score + the
  fantasy tie state computed from newPS via lineupFor+statPoints (Ben:
  "both"). ATTACK: ordering (vidiDiff runs before state.matchStats update),
  escaping, DGW fixture pick (first started fixture wins).
- Scroll anchoring v2: element-anchored restore (elementsFromPoint →
  closest('[id]') in #main) with scrollY fallback. ATTACK: anchors inside
  overlays, ids duplicated across drawers, elementsFromPoint on mobile.
- Match centre: fixture rows on PL fixtures open showFixtureCard —
  scorers/assists/cards/featured from gw stats with owner tags; pre-match =
  owned players per club. ATTACK: XSS via names, gwIdx -1 path, the
  Highlights anchor passthrough.
- Rating: thin-sample (<8 apps) blends an FPL-price prior (price*12), pure
  prior at 0 apps (Jackson 6→78). Engine mirrors. ATTACK: parity again,
  price missing/0, FPL_WIPED interplay.
- History tab filters (All/Trough/Waivers/Trades/Window); Rate column added
  to desktop DEFAULT_COL_KEYS (saved prefs still win); punditry desk moved
  BELOW pick history; Ham Cup documented on the Rules page; vidi tape wipes
  on a new draft era (VIDI_ERA_KEY = draftPool.at).
- demo-night duel pin re-set to 14 fixture chips/side (bench chips carry
  fixtures now — deliberate).
