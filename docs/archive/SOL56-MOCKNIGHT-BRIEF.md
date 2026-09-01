# SOL 5.6 — MOCK-DRAFT NIGHT ROUND (2 Aug 2026)

## Context

The lads (Ben, Toby, Marc) ran a full mock draft + Simulation Chamber gameweek
in the sandbox on 2 Aug and fired ~30 pieces of feedback in real time. All of it
was built the same night: commits `d4a360d` (main punch list) and the follow-up
removing the table gag tags. Prod Pages and Cloud Functions are already
deployed. Draft night is ~21 Aug (GW1 deadline). This is the last big mechanical
change before the real draft, so it gets the adversarial treatment.

Your job: try to break it. Verdict format as always — findings by severity, then
one word: **GO / NO-GO** for draft night.

## What changed (read the diff of d4a360d..HEAD on main)

1. **Mock-aware transfer locking (THE big one — engine + server + client).**
   `engine.js troughWindow(state)` and `transferGw(state)` now consult
   `state.mock`: a live Simulation Chamber matchday closes the trough
   ("(simulation)" why) and pushes `transferGw` to `mock.gw + 1`; after mock
   full time the trough stays shut until `waiverMeta.lastRun > mock.t`.
   `transferGw` grew an optional `state` param — all five call sites in
   `functions/index.js` now pass state (the windowDraft txn passes its snapshot
   `s`, the rest pass `state`). Client mirrors in `app.js` (`troughWindow`,
   `transferGw` use the global `state` + `hamTs(mk.t)`).

2. **Simulation Chamber v2.** `mockScorelines(gw, seed)` makes deterministic
   per-fixture scorelines with goal minutes; `mockGwStats` derives player stats
   FROM them (goals sum to team score, weighted scorers incl. an
   unlisted-scorer share, CS only when opponent on 0 + 60min elapsed, `gc` =
   conceded so far, GK assists impossible). `patchMockFixtures` /
   `unpatchMockFixtures` write `hs/as/started/finished/minutes` into
   `state.fixtures` on EVERY `applyMock` pass (feed syncs replace the array)
   and restore saved originals on switch-off.

3. **Projections in league currency.** `playerXp` rebuilt:
   `leagueArchivePpg()` recomputes last-season PPG from raw g/a/cs/mp under
   the league's scoring (FPL ppg carries bonus + defcon we don't score), blends
   toward live league ppg weighted by `apps/6`. NB deliberately calls
   `playerPoints()` not `metricsFor()` — metricsFor→projPts→playerXp would
   recurse.

4. **Heckle desk.** `ACTIONS.heckle` accepts `{text}` (cleanText ≤90, trimmed,
   non-empty) OR `{line}`; stored under `public/heckles/{mid}`; same 15s
   cooldown txn. Client `heckleSheet()` overlay: random barb / custom words /
   recommend-a-player (datalist over top-300 available); `heckleFlash` renders
   `h.text` escaped.

5. **Draft console.** Undo button rendered Chairman-only (server gate
   pre-existed); on-clock banner rebuilt (`.oc-name` 32px, intercept strip +
   `INTERCEPTS` deleted); side squad panel has My-squad/On-the-clock tabs
   (`draftSquadTab`) + a left-side phone drawer (`.squad-fab`/`#squadDrawer`);
   pundit `CLUB_FACTS` deleted; pick/parade `playSound` stings removed
   (`broadcastOnPick` is a tombstone no-op); drinks break = 2-min countdown,
   button disabled until 0, Chairman-only dismiss online, `playSound('bonjovi')`
   synth riff.

6. **Setup order editor.** Manager rows: `.mgr-num` is a drag handle
   ([data-mgrdrag] rows), ▲▼ both present, Shuffle button;
   `#startDraftOrdered` is now the PRIMARY button, `#startDraft` =
   shuffle-and-start. Server permutation check unchanged.

7. **Waiver visibility.** Third trough scope `waivers`
   (free + `onWaivers(p)` + not locked); rows say "on waivers · clears {time}"
   (`clearsTxt` from `troughWindow().until` / `nextWaiverRun`); status header
   spells out TROUGH SHUT + why; locked-arrivals card names the players;
   `mySquadCard` <details> on trough+trades tabs; claim rows draggable
   ([data-cdrag], ▲▼ kept); trade-accept confirmSheet stipulates next-GW
   landing when mid-GW.

8. **Programme.** Preview prints from `gwDeadlinePassed(cur)` (deadline stamp),
   not kick-off. Review gains: vidiprinter-moments line (bench-star, braces,
   hat-tricks, reds, pen saves, OGs — owned players only), and for `last < 10`
   a draft-class paragraph (`draftClassTable()`) + best Trough pickup
   (`bestPickups()`). Preview gains a draft-class-watch line.

9. **Deletions.** "under Committee review" tag, INVESTIGATION UPDATE card +
   `WEEKLY_MINUTES`/`investigationLine`, Chumpionship tag, `CLUB_FACTS`,
   `INTERCEPTS`, pick stings.

## Attack surfaces (in priority order)

1. **Can `state.mock` ever exist in the REAL league?** `mockMatchday`
   hard-refuses `league !== 'the-league-sandbox'`; `mock` is in
   `IMPORT_DROPPED`. Hunt for ANY other write path (importState variants,
   resetLeague, rules holes) that could plant `mock` in prod public state — if
   one exists, the trough locks shut and every transfer shifts a gameweek.
   Also: stale mock node (chamber left ON for days) — what does the sandbox
   look like a week later? Waiver crons sweep both leagues hourly — does
   `waiverTick` misbehave against a mock-shut trough?

2. **`transferGw(state)` honesty.** Any call site (server OR client OR engine
   internals) still calling it bare where mock-awareness matters? Emulator
   race: trough sign racing `mockMatchday off` — which gameweek does the
   record land in, and can two clients disagree? `resolveWaivers` uses
   `transferGw(state)` — a waiver run WHILE mock is live lands claims in
   `mock.gw+1`: is that consistent with what the mock-night flow promises
   ("run waivers after FT")?

3. **Fixture patching integrity.** `patchMockFixtures` mutates the shared
   `state.fixtures` objects. Verify: switch-off restores EXACTLY (incl. after a
   mid-mock feed sync replaced the array — saved-by-id map applied to new
   objects); nothing mock-derived leaks into anything persisted (saves strip
   fixtures from localStorage — confirm still true; vidiprinter lines are
   ephemeral by design; Record Book/history untouched). Does any REAL-data
   consumer (waiver clock gwKicks, feedcheck, treatment room) read the patched
   `hs/as/started` and act on it in a way that outlives the sim?

4. **`playerXp` rewrite.** Recursion truly dead (metricsFor→projPts→playerXp→
   playerPoints)? Perf on the pool table (563 players × playerPoints per
   metrics cache rebuild) — measure a render. Degenerate inputs: player with no
   archive + FPL_WIPED, div-by-zero apps, settings.scoring missing keys
   (custom-scored leagues), demo mode.

5. **Heckle text.** XSS through every render site of heckles (flash is
   `esc()`d — is there anywhere else heckles render? exports? minutes?).
   cleanText behavior on emoji/RTL/zero-width; cooldown bypass by alternating
   `{line}`/`{text}`; rules: can a non-member write `public/heckles/*`
   directly?

6. **Draft-night UX regressions.** Drinks break: countdown interval cleanup on
   re-render; can the room get STUCK if no commissioner clicks (both
   commissioners asleep)? Ceremony → clockStart interplay unchanged? Squad
   drawer/queue drawer z-index + FAB collisions at 320px; undo hidden but
   `bindDraft` null-guards; heckle sheet overlay stacking with pcard/back
   button (ovDepth machinery ignores it — does BACK navigate away with the
   sheet open?).

7. **Order editor.** Drag handler index maths (from<to adjustment) — fuzz a few
   drops; shuffle-then-start uses the VISIBLE order; server permutation check
   still rejects junk.

8. **Programme additions.** `draftClassTable`/`bestPickups` perf (loops over
   picks × playerPoints every dashboard render pre-memo); esc() on every
   interpolated name; `gwDeadlinePassed` vs `currentGwIndex` off-by-one at the
   season edge (GW38, playoffs).

## Test state

All green at HEAD: offline (noeval 51, feed 29, waiverclock **21** incl. 4 new
chamber-clock pins, sim 69, dgw 8, parity 8), browser (authui 16, offline-ux
16, r3ui 45, ux3 48, scouting 10, prep **24** incl. heckle-sheet + escape pins,
matchday 49, demo-night 32), emulator (rules 21, functions **237** incl. custom
heckle text pins, migrate, backup 21, provision 13, emaillink 18). Scratchpad
patterns (recreate if wanted): chamber_smoke (12 checks — scoreline coherence,
trough shut, restore-on-off, per3Saves=0 Kelleher check), waiverui_smoke (9 —
scope tab, clears times, claim DnD, order editor), 320/390 overflow audit
clean.

## Known/accepted

- Sounds: only ham-cup cheer + drinks-break riff remain; mute key
  `tl2627-mute` untouched.
- Chamber is sandbox-only by server refusal; client applyMock additionally
  requires `SANDBOX && !demoMode`.
- Toby's scoring query (red -5, pen ±3) answered as "ours matches their DF
  league"; no change.
- Beta mirror may lag main until Ben force-pushes.
