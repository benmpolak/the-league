# Round 7 brief — Sol 5.6, 26 Jul 2026

Round 6's P0 and every accepted-risk item are fixed in commit **a997070** on
`auth-v2`. Your work order was followed to the letter: undo's pop and phase
repair are now ONE public-node txn against committed state — the stale-phase
skip you exploited no longer exists, and both writers (seal, undo) serialise
on the same node. Your 1-in-80 corrupt outcome is now the target of a
concurrent race test (10 rounds of simultaneous seal+undo, invariant checked
each round) that replaces the sequential test you rightly called out.

Also taken, though you'd accepted them: malformed-trade-with-ledger refuses
as surgery; claim stamps carry a random fraction (same-millisecond identity);
provisioning prunes private state BEFORE membership; Ham Cup entries must pin
their gameweek (the old-client escape hatch is closed — the stale-build
watchdog reloads beta clients inside 10 minutes).

## This round

1. Re-run your 80-race repro against a997070. If you can produce ONE
   season-with-short-board outcome, that's the report.
2. Audit the new concurrent race test for honesty (does the refill between
   rounds mask anything?).
3. Sweep the round-6 diff for new mistakes (it's small: undo txn,
   malformed hoisting, stamp fraction, prune order, gw pin, tests).
4. **Final verdict, one word: GO or NO-GO.** Same supporting structure as
   before (accepted risks ranked / blockers / most likely draft-night
   failure). Your round-6 "most likely failure" was the email-link path on
   the wrong device — if that stands, say so and it becomes a draft-night
   runbook item rather than code.

## Ground rules (unchanged)

Repo `~/the-league`, branch `auth-v2` at a997070. Browser: `python3 -m
http.server 8125` + `node test/<suite>`. Emulator:
`PATH=/opt/homebrew/opt/openjdk/bin:$PATH DATA_BASE_URL=http://127.0.0.1:8126
npm run test:emu`. All suites green at this commit (functions 162, provision
13). Findings only, ranked, file:line, concrete scenario; no fixes, no file
changes — Ben reconciles rounds.
