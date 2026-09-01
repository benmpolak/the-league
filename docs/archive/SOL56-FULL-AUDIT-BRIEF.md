# Full-game audit brief — Sol 5.6, 25 Jul 2026

Whole-codebase pass this time, not just the day's diff. Your six-finding round
on the playoff/app work was all signal — same standard, wider net.

## What this is and why it matters

A 12-manager draft fantasy league (est. 2015, £50 a head) self-hosted to
replace Draft Fantasy. Repo `~/the-league`, branch `auth-v2` (the launch
branch). Live beta: https://benmpolak.github.io/the-league-beta (sandbox
forced; `?demo` shows a full fake season). Real draft night is ~mid-August,
GW1 deadline 21 Aug. Draft night is **laptops**; the season is lived on
phones. Twelve years of history and real money ride on it not falling over.

## Architecture in one paragraph

Static client (GitHub Pages) — `js/app.js` (UI + local game logic),
`js/engine.js` (pure game kernel, shared client/server), `js/sync.js`
(Firebase RTDB realtime sync), `sw.js` (network-first offline shell).
Server-authoritative mutations via Cloud Functions (`functions/index.js`,
action registry, actor from auth token, engine-validated, seeded RTDB txns),
deny-by-default rules (`database.rules.v2.json`), email-link auth with
membership provisioning. Data feed: `scripts/fetch_fpl.py` → `data/*.json`
committed by a 15-min GitHub Action. Waivers run on a scheduled function
following the fixture calendar. Hourly encrypted backups via Actions.

## Scope — attack anywhere, these angles pay best

1. **Game-rules correctness against canon.** Format: GW1–33 triple round
   robin (H2H, win 3/draw 1); top-8 playoffs — GW34 handicap QFs
   (+12/+9/+6/+3 to seeds 1–4), GW35 semis (W1v8 v W4v5), GW36–38 three-leg
   final (legs → aggregate → seed); Monzo Cup last-man-standing from GW8;
   squads of 14, XI of 1GK/3–5DF/2–5MF/1–3FW; auto-subs by bench order;
   scoring per Settings incl. GK-goal 10, appearance 2 start / 1 sub, DGWs
   scored per-fixture from the `fx` arrays. Waivers: blind ranked claims,
   reverse-standings, Trough closes 90min before first kick, post-run 8pm day
   after last fixture, pre-run 8pm day before next first fixture. Hunt
   boundary cases: transfer effective-GW (`transferGw`) around kickoffs,
   settled-GW immutability, bench-order locks, window-draft snake, waiver
   order after wins, playoff lock, DST around the 8pm London runs.
2. **Server truth vs client mirror.** `engine.js` runs both sides; app.js has
   its own copies of some logic (standings, playoffs are client-only). Look
   for drift: anything the client displays or permits that the server would
   score or reject differently. Anything mutable client-side that should be
   server-owned.
3. **Security.** Rules and functions: can any authenticated manager write
   outside their lane (other squads, settings, waiverRuns, membership)? Can a
   stranger read private state? Replay/idempotency of `mutate` actions and
   scheduled waiver runs; the unauthenticated `requestSignInLink` callable
   (rate buckets, enumeration, timing); secrets handling in CI.
4. **Draft night.** 12 laptops, one live draft: clock/autopick races,
   commissioner-device fallback, refresh/rejoin mid-draft, undo, sync loss
   mid-pick, two devices claiming one identity, the pinned clock strip.
   Anything that could stall or double-pick with the whole league watching.
5. **Season ops under failure.** Stale/partial FPL feed mid-GW, postponed and
   double GWs, Firebase outage mid-waiver-run, backup/restore integrity,
   stale-build watchdog vs the service worker, PWA install states.
6. **UX cold and hot.** A manager who's never seen it (waiting room → first
   lineup) at 390px, and the H2H/matchup views mid-GW. Desktop draft room.

## Already covered — don't respawn these

Max-scrutiny audit 6 Jul fixed: retroactive transfers, stale-republish,
deletion propagation, illegal-XI scoring, txn-everywhere for shared arrays,
fragment-league seeding, self-wiping waivers, autopick gating. Your 25 Jul
round fixed: mobile nav containing-block, early champion, origin-wide cache
deletion, cache-buster growth, hostguard query loss, spent install prompt.
Known limits (accepted): manual adjustments don't change H2H results;
fully-postponed GW wedges playoffs; no push notifications; no draft chat;
tap-swap lineups; pre-25/26 record book awaits DF mining. Kante rule: vetoed.

## Running it

- Browser suites: `python3 -m http.server 8125` then `node test/sim.test.js`
  (npm i puppeteer-core first); also dgw, engine.parity, noeval, feedcheck,
  authui, offline-ux tests in `test/`.
- Emulator suites (rules/functions/migrate/backup/provision/emaillink):
  Java on PATH (`/opt/homebrew/opt/openjdk/bin`), then `npm run test:emu`
  with `DATA_BASE_URL=http://127.0.0.1:8126` serving the repo. Forgetting
  DATA_BASE_URL makes trade tests fail confusingly.
- Live-DB suites (race, stress, e2e.multiclient) hit a throwaway league —
  read their headers before running.

## Report format

Findings only, ranked by severity, each with file:line and a concrete failure
scenario (state + inputs → wrong outcome). Verify before reporting — a
plausible-sounding non-bug costs a round trip. Cleared suspicions are worth
listing too. Don't push fixes or change files; Ben reconciles rounds between
models. If a finding implies a rules-canon question rather than a bug, flag it
as a Committee decision, not a defect.
