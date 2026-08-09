# SOL 5.6 BRIEF — TEST-NIGHT ROUND 3: VERIFY THE R2 FIXES (9 Aug 2026, late)

Same rules of engagement as always: read-only checkout, run any suite,
findings as P0/P1/P2/P3 with repros, one-word verdicts at the end. Your R2
verdict was NO-GO (Toby's sandbox week) / GO (real league), gated on the P1.
All three findings are fixed at commit `ec0f709`. Verify each with your own
repros — do not take the new tests' word for it.

## P1 — waivers during a live Chamber match (the sandbox gate)

Fix: `ACTIONS.waiverRunNow` reads `public/mock` before claiming a run lease
and refuses `failed-precondition` while `phase === 'live'` (functions/index.js).
Client `processWaivers()` refuses at the top with a toast (covers the local
mode and the auto-run path); the Run-now button renders disabled with the
reason while a Chamber match is live (app.js, trough tab).

Re-run your exact emulator repro: import season → chamber live → run as
Chairman. Expect refusal, `lastRun` untouched, no run-ledger entry beyond the
refused call. Then flip to `final` and confirm the post-GW run proceeds
(pinned in functions.test: 'waiverRunNow refuses while a Chamber match is
live' + 'full time lifts the gate'). Also attack: does the refusal leave a
stale `running` lease that blocks the legitimate full-time run? (It should
not — the guard sits BEFORE the lease claim.)

## P2 — GW1-adjustment export round-trip

Fix: `adjustments` and `claims` are canonicalised from RTDB's array coercion
in three places — client export, client import, and the server `importState`
gate (arrays → `{index: value}`, null holes dropped). The client's 'League
imported' toast now prints only after the server accepts; a refusal surfaces
the server's reason instead.

Re-run: export a league with only a GW1 adjustment, re-import the file.
Expect acceptance and the adjustment intact (pinned: 'import canonicalises
array-shaped adjustments'). Also attack: a PRE-fix export (array shape
already in the file) through the new client import; and whether `claims`
arrays in old files now pass where they used to refuse.

## P3 — Suggestion Box cap race

Fix: cap and cooldown moved INSIDE the transaction fn (deny via abort +
typed HttpsError; on contention the fn re-runs against the committed array).
Re-run your 199+3 concurrent repro — expect exactly one landing. Pinned:
'a full box refuses INSIDE the transaction' (200-stuffed box, no growth).

## Verdict

One word, for Toby's sandbox week: GO / NO-GO. (Real league was GO at R2;
flag only if one of these fixes somehow regresses it.)

Honesty notes: the concurrent-at-199 case is argued from Firebase txn
semantics + the full-box pin, not a literal 3-way race test; the P1 emulator
pins run in the existing functions.test flow, not a fresh league; functions
were NOT yet deployed at `ec0f709` commit time (Ben owes the deploy — verify
against the emulator, and note it in your report if prod still lacks the
guard when you run).
