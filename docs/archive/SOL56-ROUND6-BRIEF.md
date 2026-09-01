# Round 6 brief — Sol 5.6, 25 Jul 2026

Round 5's blocker and all findings are fixed in commit **a23b311** on
`auth-v2`. Five rounds, every report all-signal, and the findings have
converged from product-wide to races inside the repair code itself. This
round: confirm the P0 is dead, sweep once more, and give the final verdict.

## What changed (attack it)

1. **P0 seal race**: `sealFullBoard()` — one txn on the public node that
   re-verifies fullness at commit time; a concurrent undo fails the CAS and
   the seal aborts. Wired into the final-pick follow-up, both pick-attempt
   heals and clockStart. Undo's phase restore has the symmetric guard.
   Re-run your race repro. Attack: the txn's empty-cache seeding (fresh GET
   — can a write between GET and first CAS pass slip through?), seal racing
   seal, the local (?nosync) mirror in `armClock`.
2. **Ledger content validation**: exact multiset of
   `{manager, out, in}` both directions. Attack: duplicate give-pairs in a
   2-for-2 (same player twice was already rejected upstream — but forged
   ledgers with swapped directions?).
3. **Ham txns**: draw and entry both transact on the cup node; entries carry
   their gw. Attack: entry with no gw field (older client — allowed by
   design), draw racing draw.
4. **Claim lodging stamps**: `t` on every claim entry; cleanup matches
   `{in,out,t}` with pair-only fallback for pre-stamp entries. Attack: two
   claims saved in the same millisecond, the fallback matching a stamped
   entry it shouldn't.
5. **Local ceremony replay at boot**, **provision prune purge**, **truthful
   reject-of-done**, **negative-count validation** — verify each.

Tests grew again: functions 159, provision 13; audit the new ones for
honesty as before.

## The verdict

Same three-part structure (accepted risks ranked / blockers / most likely
draft-night failure) — but this round, end with a one-word answer: **GO or
NO-GO** for a real draft night in mid-August with these 12 managers, this
commissioner, and the documented limits. If NO-GO, the blocker list is the
work order; if GO, say what the Committee should watch for in week one.

## Ground rules (unchanged)

Repo `~/the-league`, branch `auth-v2` at a23b311. Browser: `python3 -m
http.server 8125` + `node test/<suite>`. Emulator:
`PATH=/opt/homebrew/opt/openjdk/bin:$PATH DATA_BASE_URL=http://127.0.0.1:8126
npm run test:emu`. All suites green at this commit. Findings only, ranked,
file:line, concrete scenario; verify before reporting; no fixes, no file
changes — Ben reconciles rounds.
