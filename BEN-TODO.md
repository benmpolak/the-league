# The Chairman's Desk

Things only Ben can do. Deploys, decisions, and one rule change that is not
the Committee's to make alone.

Raised from Toby's sandbox testing session, 12 Aug 2026. Branch:
`claude/remove-league-table-icons-yqazwx`.

---

## 0. Ric's email — check before you change it

**Asked (Marc, 13 Aug):** change `Ricblank@gmail.com` to `Ric.blank@gmail.com`.

**Check this first — it may need nothing.** Gmail ignores dots, so both forms
are the same inbox. Firebase does not: they are two different identities, and
`normaliseEmail` (`functions/index.js:1801`) only trims and lowercases. So if
Ric is registered as the undotted address, he can simply sign in with it and
nothing needs doing. Only change the registration if he is actually stuck —
the symptom is the "Who let you in?" card that survives every reload.

**If you do change it:** edit `managers.local.json` and re-run
`GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/provision_managers.js --live`.

**The cost, which is not obvious.** The script finds users by email
(`scripts/provision_managers.js:59`). The dotted address will not match Ric's
existing auth user, so it creates a **new uid** — and the prune step then
removes the old uid's private node (`:93`), which is where his **autolist and
any lodged waiver claims** live. Pre-draft that is his draft queue. Note it
down first and put it back after, or do the change at a moment when losing it
costs nothing. Membership and the managerUid map rebuild correctly; the old
auth user is left orphaned but harmless.

---

## 1. Clean sheets and the red card — a RULES change, needs the group

**What was asked (Toby/Marc, 12 Aug):** a player sent off should *lose* any
clean sheet, and should keep taking goals-conceded deductions as if he were
still on the pitch.

**What the app does today:** neither. The engine takes `cs` and `gc` per player
straight from the FPL feed and applies our table (`js/engine.js:296-301`).
FPL treats a dismissed player as off the pitch, so:

- sent off on 65 minutes, team never concedes → **he keeps the clean sheet**
  (pinned by `test/scoring.test.js:40`)
- goals conceded after the red are **not** charged to him

Both are the opposite of the request. Note `test/scoring.test.js:41` looks like
it covers the rule but does not — it hand-feeds `cs: 0, gc: 2` and its comment
assumes the feed already reports post-dismissal concessions against the player.
That assumption is load-bearing and probably wrong.

**What building it needs:**

- losing the clean sheet on a red is one line (`if (s.rc) cs60 = 0`)
- the continuing deduction needs the team's match total, which `data/fixtures.json`
  carries as `hs`/`as` — derivable for a player who *started* and was dismissed
- **open question for the group:** a substitute who comes on and is *then* sent
  off. The feed gives per-player totals, not timings, so goals conceded before
  he came on cannot be separated from goals conceded after his red. Charge him
  the full match total, or leave substitutes alone?

**Why it is yours:** it is a scoring rule. `MARC-ONBOARDING.md` has the rules
PDF as canon and scoring explicitly not up for reinterpretation in code. It
also lives in `js/engine.js`, shared verbatim with the server, so it needs a
deploy as well as a decision.

**Also unconfirmed:** whether FPL awards a clean sheet to a substitute who
comes on *after* his team has conceded and then plays 60+ minutes without
conceding again. Our scoring follows the feed either way, but nobody has
verified what the feed actually says. Worth checking against a real round.

---

## 2. Deploys waiting on you — ~~both~~ DONE (Ben's dev, 12–13 Aug)

| What | Status |
|---|---|
| Delisting a player you have transferred away | **DEPLOYED 12 Aug** with the rest of the transfers fixes. Works online. |
| Skipping a waiver run | **SHIPPED 12 Aug, different design.** The branch's `waiverMeta.override` timestamp was not merged: its override run id embeds an ISO timestamp whose `.` is an illegal RTDB key character, so the first held-over run would have wedged the hourly tick, and the change sat in `functions/` + the waiver engine, which `MARC-ONBOARDING.md` reserves. What shipped instead: Tue/Fri 10am clock plus a one-shot **Skip the next run** (`waiverMeta.skip`, new `waiverSkip` action) — the named run is marked done in the ledger, claims roll over, Trough stays shut until a real run. Live and deployed, first run Fri 14 Aug 10:00. |

---

## 3. Two decisions on the player feed

Toby's `#579 (unknown)` came from the app running on two different copies of
the player list. The page has been stopped from dying on it, but the drift is
still there and a stubbed player is still a hole in the record.

**a. Which site is the sandbox's source of truth?** `DATA_BASE` is hardcoded to
the main site (`functions/index.js:44`) regardless of sandbox, so a beta client
and the server are structurally never in sync. Either point the sandbox league
at the beta site, or make the beta mirror sync automatically so the two cannot
diverge. The second needs a token and a workflow — your territory.

**b. Should picks carry `code` alongside `id`?** FPL element ids are positional
and shift whenever the feed is rebuilt, which is every five minutes
(`.github/workflows/fpl.yml`). `code` is immutable and already trusted for the
last-season archive (`js/app.js:32`). Storing both would make a lost pick
recoverable instead of a permanent `#579 (unknown)`. It is a state-shape change
across picks, transfers, trades and claims plus a migration of live cloud data,
in the server-authoritative core — not a quiet test-week change.

---

## 4. Merge and mirror — DONE (13 Aug)

The four transfers fixes merged and deployed 12 Aug; the sandbox-identity and
go-to-real-site fixes cherry-picked to `main` 13 Aug (this commit), beta
mirrored. The branch's waiver-clock commit was superseded (see §2) — the
branch `claude/remove-league-table-icons-yqazwx` can be deleted.

**Still genuinely on the desk:** §1 (red-card scoring — needs a GROUP ruling,
then a build) and §3 (feed decisions — 3b `code` alongside `id` is the real
fix for `#579 (unknown)` and worth doing before the season starts).
