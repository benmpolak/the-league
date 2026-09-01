# Round 3 brief — Sol 5.6, 25 Jul 2026

Your full audit (14 findings at 99f995a) came back all-real — the draft-clock
one alone justified the no-go. Every finding is now fixed in commit **81385eb**
on `auth-v2`. This round: **verify the fixes hold under attack, then push past
where round 2 stopped.**

## Part 1 — re-verify your 14, adversarially

Don't take the fix descriptions on trust; re-run your original repros against
81385eb and try to break the repairs themselves:

1. **Draft clock** — fire-gate now `rawLeft <= 0` (unclamped), app.js
   `bindDraft`. Re-run your 30s-draft repro. Then attack the edges: timewaste
   extending the deadline mid-countdown, pause/resume, the on-clock manager's
   8s-grace path, two devices racing at expiry, `firedDeadline` reuse after
   undo resets the same deadline value.
2. **Waiver priority** — `waiverOrder()` now reads the full finished-GW table
   (engine + app mirrors). Check the GW1 PRE-season run still uses reverse
   draft order (canon), and that a GW going final between claim-lodging and
   run-execution is counted.
3. **Ham Cup lock** — entries refused once the cup GW kicks off. Try the
   commissioner path, and a draw-then-redraw to an earlier GW.
4. **XI duplicates** — `xiValid` rejects dupes/unknowns everywhere it's
   called (lineupSave, hamEnter, auto-XI repair). Try dupes via benchOrder
   interplay and the client's legalizeXI repair path.
5. **Trade duplicates** — rejected at propose AND at accept (stored offers).
   Try: dupes across give/get, self-trades, a malformed offer written before
   the fix would have been (the accept path must withdraw it).
6. **Undo** — draft-night only, restores phase after the final-pick flip.
   Try undo mid-season (must refuse), undo at pick 0, undo racing a pick.
7. **Legacy node** — `.read` false in database.rules.v2.json. Confirm no v2
   client code path still reads `leagues/*`.
8. **Restore** — private tree replaced wholesale. Verify claims/autolists for
   a manager ABSENT from the snapshot are gone after restore, and present ones
   land under the right uid.
9. **Sync-load failure** — `syncOn()` is intent; with `window.WCSync` deleted
   the app must be read-only (serverAct refuses), not local-writes. Check no
   remaining code path assumes WCSync exists when netOn() is true.
10-14. **Mediums** — tiebreak frozen at regular season (pf), 14-day waiver
   lookback (try a 3-day outage), draft-pick follow-up retry, trade crash
   recovery (kill between transfers-txn and finish('done'), then re-accept —
   also the <60s live-claim window), retired suites actually refuse to run.

Note the test re-pins in 81385eb (sim GW1 waivers, waiverclock lookback,
rules legacy) — check the re-pinned expectations encode the NEW semantics
correctly rather than just making the suite pass.

## Part 2 — take it further

Round 2 covered breadth; go deeper where the stakes are highest:

- **Draft night end-to-end**: simulate a full timed multi-client draft against
  the emulator stack (not ?nosync) — clock races, rejoin mid-draft, undo
  under fire, autopick storms, the ceremony/breaks interplay with the clock.
- **The waiver state machine under partial failure**: lease expiry mid-plan,
  feed going stale between post-run and pre-run, control flipped manual
  mid-window, claims lodged during a run.
- **The new code itself**: the crash-recovery branch in tradeRespond, the
  private-tree replacement in importState, and the retry loop in draftPick
  are fresh code written today under time pressure — treat them as the most
  suspect lines in the repo.
- **Anything round 2's "Cleared" list took on trust.**

## Ground rules (unchanged)

Repo `~/the-league`, branch `auth-v2` at 81385eb. Suites: browser
(`python3 -m http.server 8125` + node test/<suite>), emulator
(`PATH=/opt/homebrew/opt/openjdk/bin:$PATH DATA_BASE_URL=http://127.0.0.1:8126
npm run test:emu`). All 14 suites green at this commit — a finding that
breaks one is a finding, not an excuse. Findings only, ranked, file:line,
concrete failure scenario; verify before reporting; cleared suspicions worth
listing; no fixes, no file changes — Ben reconciles rounds between models.
