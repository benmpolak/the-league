# Round 4 brief — Sol 5.6, 25 Jul 2026

Round 3's 8 findings are fixed in commit **97d8752** on `auth-v2`. Three rounds
in, every report has been all-signal — this round decides launch. Standard is
unchanged: verify, then attack.

## What changed at 97d8752 (verify each adversarially)

1. **Ceremony clock**: `draftAdmin start` now leaves `deadline` NULL; a new
   idempotent `clockStart` op (any signed-in manager) arms it; the client's
   tick loop calls it once no ceremony/break overlay is up, and shows "—"
   while unarmed. Local (?nosync) path mirrors via `armClock()`. Attack: a
   device that never saw the ceremony, refresh mid-pomp, clockStart racing a
   pause, a full-board league with a null deadline, the local path.
2. **Pick/undo race**: `draftPick` and `undo` are both single txns on the
   whole draft node (`seededObj`) — picks + deadline atomic, serialised
   against each other; undo carries `expectedCount`; a full-board-in-draft
   wedge heals on the next pick attempt. Re-run your 40-race repro. Attack:
   timewaste/pause/breakDone writes racing the draft-node txn (they update
   subpaths of the same node — check nothing is clobbered by txn retries),
   undo racing undo, expectedCount omitted (older clients).
3. **Late waiver claims**: plans store `consumed`; apply removes only those
   entries via per-uid/bucket txns; legacy plans (no `consumed`) keep the
   wholesale clear. Re-run your repro. Attack: a late claim on the SAME
   player as an adjudicated one, claims lodged during the apply txns
   themselves, the `{in,out}` matching key colliding (same pair claimed
   twice), buckets with claims from managers with no uid mapping.
4. **Landed-trade heal**: accept completes any trade whose `tr.trade`
   records exist and status ≠ done (lineups, covenant once via `cov.trade`,
   status done); tail failures park as `executing`, never pending-after-
   landing. Re-run your repro. Attack: partial landing (one of the two
   symmetric records), heal racing a genuine concurrent accept, covenant
   duplication across heal + normal path.
5. **Client xiValid** mirrors the engine (dupes/unknowns), local undo mirrors
   phase restore. Check the remaining client mirrors for drift you'd flagged
   as a class: anything else app.js validates more loosely than engine.js?
6. **Ham redraw**: refuses started GWs, out-of-calendar GWs, and replacing a
   live/settled cup without an explicit cancel. Attack: cancel-then-redraw
   of a settled cup (allowed — is that right?), draw racing entries.

New tests you should audit for honesty (do they pin the semantics or just
pass?): functions.test.js "sol r3" sections (137 checks now — late-claim
survival, landed-heal, clockStart trio, expectedCount race, wedge heal) and
the ceremony-clock browser smoke pattern in the session scratchpad.

## Part 2 — the launch question

If Part 1 holds, answer directly: **is this league safe to run a real draft
night and a 38-GW season for 12 managers?** Structure the answer as:
- Remaining risks you'd accept (with why), ranked
- Remaining risks you would NOT accept (launch blockers), if any
- The single most likely failure on draft night, even if acceptable

Anything already in the known-limits list (README + earlier briefs) stays
accepted unless you've found it's worse than documented.

## Ground rules (unchanged)

Repo `~/the-league`, branch `auth-v2` at 97d8752. Browser suites:
`python3 -m http.server 8125` + `node test/<suite>`. Emulator:
`PATH=/opt/homebrew/opt/openjdk/bin:$PATH DATA_BASE_URL=http://127.0.0.1:8126
npm run test:emu`. All 14 suites green at this commit. Findings only, ranked,
file:line, concrete failure scenario; verify before reporting; cleared
suspicions listed; no fixes, no file changes — Ben reconciles rounds.
