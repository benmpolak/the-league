# Handoff — after GW1 night (21 Aug 2026, ~23:20)

Written by Fable 5 at the end of GW1's opening night, for whoever picks this
up next. Everything below is either shipped and verified, or explicitly not
done. The league is LIVE and mid-gameweek: GW1 runs to Mon 24 Aug ~22:00,
first waiver run Tue 25 Aug 10:00.

## Shipped tonight (all pushed, client + functions match HEAD)

1. **Live fast lane actually covers the match** (`30adf8c`). The lads' main
   complaint — "clearly doing it every 10 mins and grouping it all together".
   Diagnosis: `.github/workflows/live.yml` crons `*/5`, but GitHub fired it
   every **25–35 minutes** under load, and each run looped only ~4.5 minutes.
   So ~85% of the match had no coverage and one pass delivered everything at
   once. GitHub's scheduler cannot be made punctual, so each run now loops
   **~28 minutes** (38 × 45s, `timeout-minutes: 32`); the no-cancel
   concurrency group makes consecutive runs join end to end. Verified: a
   manual dispatch pushed `liveStats` with an age of 0.1 min.
   **WATCH THIS during Saturday's 3pm block** — it is the first real test.
   If gaps persist, the next lever is a second workflow offset by ~15 min,
   or an external pinger; GitHub will not honour `*/5`.

2. **Trough fixtures read the landing gameweek** (`b26ddb3`). Wilko: "the
   trough doesn't show gameweek 2's games". It showed Arsenal v COV — a match
   already in play — when a deal signed then lands in GW2 (AVL away). Fixed
   on the column, its header (now reads `GW2`) and the phone in-cell fixture.

3. Earlier today: Marc's watchlist merged + `importState` hardened + deployed;
   sol's audit passed (its one finding, `d5f9ca6`, is deployed); Trough
   control returned to `auto` so the 18:30 shutter fired correctly; Gazette
   Post-Draft Special (Warner leading, Dev & Dev investigation); both podcasts
   voiced with a back catalogue; Gazette unread nudge; OG tags + share card.

## Open, in priority order

### 0. LIVE DATA — must be bulletproof before Sat 22 Aug 12:30
Ben: *"the lads will basically walk away if we can't get instant data into the
game live... I want the most 11/10 foolproof answer, fixed before a match
kicks off tomorrow."* **Hard deadline: Saturday 12:30 (Hull v Man Utd).** Then
15:00 ×3, 17:30, and Sunday.

**Root cause, established.** Not our code — a pass costs ~1s (FPL fetch 0.4s).
`live.yml` depends on GitHub *scheduled* workflows, which are best-effort by
design: a `*/5` cron fired at 19:55, 20:29, 20:53, 21:23 on GW1 night. Gaps of
24-34 minutes, so ~85% of the match had no coverage and updates arrived in one
lump. No GitHub setting fixes this. `waiverTick`
(`onSchedule({schedule:'7 * * * *'})`) has fired on time every hour since
launch — Google Cloud Scheduler is punctual where GitHub is not.

**Target:** during any live fixture, `public/liveStats` is never more than
~60s old, and a failure can never be silent.

Build all four layers. They must fail independently.

**Layer 1 — primary: `liveTick`, a scheduled function, every minute.**
`onSchedule({ schedule: '* * * * *', region: 'europe-west1' })` doing what
`scripts/push_live.js` does: read FPL, write `public/liveStats`, clear the node
when nothing is live. Use FPL's per-gameweek live endpoint
(`/api/event/{id}/live/`), not `bootstrap-static`. Return in milliseconds when
no fixture is live. Cost is nil on the existing Blaze plan (~43k invocations
vs a 2M free tier; Cloud Scheduler's first three jobs are free, this is the
second) — verify rather than assume.

**Layer 2 — independent fallback: keep `live.yml` running.** Different
infrastructure, different failure mode. Do NOT retire it until the function has
survived a full matchday. Both writers must be idempotent and last-write-wins
safe: whoever writes most recently wins, and neither can corrupt the other.

**Layer 3 — self-healing: a `liveRefresh` callable + client auto-heal.** Any
signed-in client that sees a live fixture with a stale overlay calls it, and it
does one immediate fetch-and-write. Rate-limit hard (per-uid AND global, reuse
the `mailGuard` sliding-bucket pattern) so twelve phones cannot stampede FPL or
your bill. Client calls it at most once per staleness episode, never in a loop.

**Layer 4 — visible truth: a freshness indicator.** Show the live overlay's
age where scores are read ("Live · updated 14s ago"), amber past ~90s, and
say plainly when it is stale. Silent failure is what burned trust on GW1 night
— the lads had to guess. Also surface last-write age in the Chairman's
pre-flight card.

**Hard constraints.**
- `liveStats` stays DISPLAY-ONLY. Settlement, waivers, H2H results and the
  server engine continue to read the canonical Pages feed. Nothing in this work
  may make a live fetch capable of changing a score. This is THE safety
  property — sol has cleared it twice; do not regress it.
- Never commit a secret. The function uses the existing service-account path.
- **Ask Ben before deploying functions.** He is the only one who deploys.
- Full suites green before each push, including `test:emu`
  (`PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`).

**Acceptance — demonstrate, do not assert.**
1. Emulator tests for `liveTick` (writes, clears when nothing live, is
   idempotent) and `liveRefresh` (rate limits bite, unauthenticated refused).
2. A real observation during the 12:30 match: sample `liveStats.t` ten times
   over ~10 minutes and show the age never exceeds ~90s.
3. Fallback proof: with the function disabled or erroring, the GitHub workflow
   still writes and the overlay still updates.
4. The indicator shows a true age and visibly degrades when the feed stalls.

**If it is not confidently done by 11:30 Saturday, STOP.** Do not deploy
half-finished server code before a matchday. Instead spend the remaining time
making the GitHub fallback as robust as possible (self-chaining via a PAT is
the strongest GitHub-only option, but it needs Ben to create the token), and
tell Ben plainly where it stands.

### 1. FEATURE — the Gazette should keep stories for a week (Ben's ask, tonight)
> "the gazette old stories disappearing was disappointing — i think you should
> keep stories for a week... and then move them out... like old news moves
> down the page maybe"

Today the front page shows exactly ONE edition (`progTodays()`), and the
archive (`[data-progw]` buttons in the reading room) only lists **settled
gameweeks**. Consequences: the **Post-Draft Special becomes unreachable
forever** the moment GW1 settles on Monday — the Warner splash and the Dev &
Dev investigation both vanish — and there is no notion of a story ageing.

Ben's design, as stated: recent stories stay on the page for about a week and
**move down the page as they age**, then move out to the archive. Suggested
shape (not built, not agreed):
- give every generated edition a stable id + timestamp when first printed;
- the reading room renders today's lead first, then older stories beneath it
  in descending age, up to ~7 days;
- past that, they drop into the archive list, which must include non-gameweek
  editions (the draft special has no `gw` and therefore no archive slot today);
- the same "published artefacts are immutable" idea would fix the podcast
  drift below — consider doing both together.

### 2. FEATURE — waiver claim UX (Ian, GW1 night)
> "don't love functionality for making waiver claims. Bit clunky... Reordering
> list is easier but adding players to it isn't."

Reordering is good; **adding** a player to the claim ladder is the clunky
half. Not diagnosed. Worth watching someone do it on a phone before designing.
Claims are being lodged now for Tuesday's run, so this has a real audience.

### 3. BUG — repeated "confirm your email" prompt (AJ, via Toby)
> "Every time I refresh it asks me to confirm my email. Not impacting site
> usage, just annoying."

Cause (read, not yet proven): `js/sync.js → completeLink()` runs on every load
and prompts whenever `isSignInWithEmailLink(href)` is true but `EMAIL_KEY` is
absent from localStorage. The URL is only scrubbed **after** a successful
`signInWithEmailLink`. So a saved/bookmarked/home-screened URL that still
carries the oob code re-triggers the prompt forever.
Suggested fix: if a user is already signed in, scrub the sign-in params and
return without prompting; and scrub on failure too, so a dead link cannot
nag. Do NOT regress the paste-a-link rescue path.

### 4. TEST — `product.smoke #5` is red, and it may be my doing
`#5 Gazette archive opens a back edition and returns to today's paper` fails
with `{nav:1, fromArchive:true, restored:false}` — going *back to today* no
longer restores. It fails identically with tonight's Trough change stashed, so
it is **not** from that; the likely culprit is the **Post-Draft Special taking
the front page** (edition zero is no longer what "today" renders) or the
`render()` I added to `#progRead`'s handler when marking the Gazette read.
Not user-facing yet: production has no settled gameweeks, so no archive
buttons exist. It will become real on Monday when GW1 settles. **Fix before
Monday night.** Reproduce: `node test/product.smoke.js` on 8125.

### 5. KNOWN P3 — podcast scripts drift, orphaning paid audio
Episode text re-derives from live state, so a transfer can change the wording
of an already-published episode; its recordings then no longer match and lines
fall back to the browser's robot voice. Sol's agreed fix: store an immutable
published episode/script snapshot and tie audio + provenance to its content
hash. Overlaps with item 1.

### 6. POLICY — the browser export is not a backup (sol, written up)
An online browser only subscribes to its own private node, so a Settings
export contains only that user's claims/autolist/watchlist — but `importState`
**replaces the whole private tree**. Restoring a browser file could erase the
other eleven managers' private data. **Rule until fixed: never use Settings →
import to restore; use `scripts/restore_league.js`.** Needs Ben's decision:
server-generated commissioner backup, or merge semantics.

## State of the tree
- `main` = `b26ddb3`, worktree clean, client and deployed functions in step.
- Suites: `check`, `test:offline`, `test:emu` (rules 22 / functions 340 /
  backup 23 / provision 13 / emaillink 20) all green. `test:browser` has the
  one known red above (`product #5`).
- **Two tests expired today because the calendar moved, not because code
  broke** — `podcast P17` (fixed) and `prep P11b` (fixed tonight). Expect more
  of this class as the season progresses: anything asserting "the Trough has
  signable players" or "the current episode is the draft one" is time-bound.
  Prefer asking the app what it believes over hard-coding the expected state.

## Live-league rules for whoever is next
Never write to production Firebase without Ben saying so; the classifier
blocks most of it anyway. Read-only probes are fine (`service-account.json` +
`firebase-admin` from `functions/node_modules`). Never deploy functions
without being asked. The waiver skip is set to `wv-2026-08-21` and is spent
harmlessly by Tuesday's run.
