# Test brief for Sol 5.6 — fresh-eyes review, 25 Jul 2026

You're being asked for an independent, adversarial review of today's changes to
The League. You wrote the auth-v2 spec (FABLE5-HANDOFF.md); this is the return
leg. Assume nothing in today's work is correct until you've checked it.

## What shipped today (auth-v2, commits 749fbd6 → bbcf315)

1. **Top-8 playoff format** (Committee ruling, replaces top-4):
   - GW1–33 regular season unchanged.
   - **GW34 quarter-finals**, one leg, top 8: 1v8, 2v7, 3v6, 4v5. The higher
     seed starts with a handicap head start: **+12 / +9 / +6 / +3** respectively
     (`QF_HANDICAPS` in `js/app.js`).
   - **GW35 semi-finals**, one leg, fixed bracket: W(1v8) v W(4v5), W(2v7) v W(3v6).
   - **GW36–38 final, three legs**: most legs won → cumulative points → higher
     regular-season finish. All other ties everywhere: higher seed advances.
   - Code: `playoffState()` / `playoffCard()` in `js/app.js`; table playoff line
     moved to 8th; `playoffOdds()` now simulates top-8; rules page + README updated.
2. **QF column on the H2H table** — what each position earns (top 4, gold) or
   concedes (5th–8th, red) in the quarter-final.
3. **"Get the app" install card** — Dashboard (dismissible,
   localStorage `tl2627*-a2hs-hidden`), Settings (permanent), and the pre-draft
   waiting room. One-tap via stashed `beforeinstallprompt` where available;
   iOS Add-to-Home-Screen instructions otherwise; hidden when already standalone.
4. **Service worker rewritten** (`sw.js`) — strictly network-first; the cache
   answers ONLY when fetch fails. Full shell precached (the old worker missed
   engine/sync/hostguard and served app.js cache-first, one build behind the
   stale-build watchdog).

## Where to look

- Repo: `~/the-league`, branch `auth-v2` (worktree may be checked out on it).
- Live beta: https://benmpolak.github.io/the-league-beta (mirror of auth-v2;
  forces sandbox mode via `js/hostguard.js`).
- Demo with a full fake season (fastest way to see the playoff card end-state):
  https://benmpolak.github.io/the-league-beta/?demo
- No credentials needed for any of this. Don't test the email sign-in path.

## What to attack

- **Playoff logic**: seeds off-by-one, handicap applied to the wrong side,
  bracket wiring (semis must be W1v8–W4v5, not reseeded), tie handling at every
  stage, the three-leg final aggregate, `standingsBefore(33)` as the seeding
  source, behaviour when GW34–38 are partially final. Independent recompute
  lives in `test/sim.test.js` section 7 — check the test itself for shared
  blind spots with the implementation (same author, same day).
- **Playoff odds**: `playoffOdds()` top-8 slice — sane percentages mid-season?
- **The QF table column**: correct values in live-table mode, mobile overflow.
- **Install card**: logic branches (standalone / dismissed / iOS / beforeinstallprompt),
  `bindInstall()` wired in all three views, LS_NS namespacing.
- **Service worker**: can it EVER serve stale while online? Interaction with the
  ETag stale-build watchdog (`checkBuild()` in app.js), sandbox/beta scope,
  cache growth, the gstatic opaque-response caching.
- **Cold-user UX** on the waiting room at 390px, and draft-room UX on a laptop
  (draft night is laptops — Committee note 25 Jul).

## Known limits — don't re-litigate

Manual adjustments don't change H2H results; fully-postponed GW wedges playoffs;
no push notifications (group chat covers it); no draft-room chat (WhatsApp);
tap-swap not drag-drop lineups; pre-25/26 record book needs DF login mining.

## Running the suites locally

- Browser suites: `python3 -m http.server 8125` then `node test/sim.test.js`
  (needs `npm i puppeteer-core`, gitignored). Also `test/dgw.test.js`,
  `test/engine.parity.test.js`, `test/noeval.test.js`.
- Emulator suites need Java on PATH (`/opt/homebrew/opt/openjdk/bin`) and
  `DATA_BASE_URL=http://127.0.0.1:8126` — see README "Tests".

## Report format

Findings only, ranked by severity, each with file:line and a concrete failure
scenario (inputs → wrong output). Confirmed bugs beat style opinions. If you
verify something suspicious and it's actually fine, say that too — clearing a
suspicion is a finding. Don't push fixes; Ben reconciles rounds between models.
