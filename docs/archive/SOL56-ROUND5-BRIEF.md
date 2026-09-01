# Round 5 brief — Sol 5.6, 25 Jul 2026

Round 4's two blockers and six findings are fixed in commit **df5cff9** on
`auth-v2`. This is the verification round: confirm the blockers are dead,
sweep the repairs, and re-answer the launch question.

## The fixes to verify (attack each)

1. **P0 blind undo**: the server now REJECTS `undo` without `expectedCount`
   (invalid-argument). Re-run your 40-race repro with old-client (blind)
   undos — every one must refuse. Attack: expectedCount of the wrong type,
   negative, replayed identical requests.
2. **P1 ceremony refresh**: `ceremony-seen` stamps at ceremony END (finish or
   Ian's skip), key = `order:draftPool.at`, ceremony only in draft phase.
   Re-run: refresh mid-pomp → ceremony replays, clock stays "—"/null.
   Attack: refresh DURING the final ceremony step, reset + rehearsal with the
   same order (new draftPool.at → replays), a device joining mid-season
   (must NOT see the ceremony), the commissioner path where draftPool.at
   hasn't synced when the ceremony ends (stamps with empty suffix — check
   the re-show it causes is benign).
3. **P1 landed-trade truth**: reject/withdraw of a fully-landed trade heals
   to done; partial ledger (count ≠ give×2) refuses with a surgery error and
   touches nothing. Attack: reject racing accept on the same landed trade,
   a done trade rejected (should no-op), ledger records with the right count
   but wrong players.
4. **P2 heal reachability**: `clockStart` seals a full board (even with an
   armed deadline) and the client clock loop calls it; local mode seals
   directly. Attack: the heal racing a genuine concurrent undo.
5. **P2 waiver cleanup**: mapping via membership (managerUid deleted in a
   test and nothing strands), count-based removal. Attack: managers present
   in managerUid but MISSING from membership (the inverse divergence —
   does planning even see their claims? should it?), duplicate identical
   entries within one claim list.
6. **P2 ham redraw**: refuses when the existing cup has entries. NOTE: this
   guard is emulator-untestable (synthetic calendar ends before CUP_START=7)
   — it is pinned by code review only. If you can extend the test calendar
   to 10 GWs without breaking the other pins, that closes the gap; report
   what you find either way.

New tests to audit for honesty: functions.test.js grew 137 → 147; the
ceremony smoke asserts open-not-stamped / clock-held / stamp-at-end /
local-wedge-heal.

## The launch question, again

Same structure as round 4: accepted risks ranked with reasons, blockers if
any, single most likely draft-night failure. Last round you accepted the
full-board phase-write risk conditionally on Chairman recovery — that path
is now automatic; say whether that changes your ranking. A clean round here
means Ben schedules the real draft.

## Ground rules (unchanged)

Repo `~/the-league`, branch `auth-v2` at df5cff9. Browser: `python3 -m
http.server 8125` + `node test/<suite>`. Emulator:
`PATH=/opt/homebrew/opt/openjdk/bin:$PATH DATA_BASE_URL=http://127.0.0.1:8126
npm run test:emu`. All suites green at this commit. Findings only, ranked,
file:line, concrete scenario; verify before reporting; cleared suspicions
listed; no fixes, no file changes — Ben reconciles rounds.
