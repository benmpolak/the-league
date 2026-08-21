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

### 0. THE ONE THAT DECIDES THE PROJECT — get live data off GitHub's scheduler
Ben, GW1 night: *"the lads will basically walk away if we can't get instant
data into the game live."* Treat this as priority zero.

**Root cause is not our code.** A pass costs ~1s (the FPL fetch is 0.4s). The
problem is that `.github/workflows/live.yml` depends on GitHub's *scheduled*
workflows, which are explicitly best-effort: tonight a `*/5` cron fired at
19:55, 20:29, 20:53, 21:23 — gaps of 24-34 minutes. No amount of tuning makes
GitHub punctual.

**The fix already exists in this codebase, one file over.** `waiverTick`
(`functions/index.js`, `onSchedule({ schedule: '7 * * * *' })`) runs on Google
Cloud Scheduler and has fired on time every time — the waiver run ledger
proves it. Cloud Scheduler accepts `* * * * *`.

Proposed: add a **`liveTick` scheduled function, every minute**, that does what
`scripts/push_live.js` does — read FPL, write `public/liveStats` — and returns
in milliseconds when no fixture is live. That removes GitHub from the live
path entirely and makes worst-case staleness ~60s + FPL's own lag.

Notes for whoever builds it:
- Use FPL's per-gameweek live endpoint (`/api/event/{id}/live/`), not
  `bootstrap-static`, which is far heavier than this needs.
- Keep the safety property intact: `liveStats` is a DISPLAY-ONLY overlay.
  Settlement, waivers and the server engine must continue to read the
  canonical Pages feed. Do not let a live fetch influence scoring.
- Reuse the existing staleness/clear-down behaviour: clear the node when no
  fixture is live, exactly as `push_live.js` does today.
- Cost on the existing Blaze plan is effectively nil: ~43k invocations/month
  against a 2M free tier, and Cloud Scheduler's first three jobs are free
  (this would be the second). Confirm before promising Ben a number.
- Keep `live.yml` as a belt-and-braces fallback at first; retire it once the
  function has survived a full matchday.
- **This needs a functions deploy, so ask Ben before deploying.**

**Interim state as of tonight:** `live.yml` was rewritten to work a 36-minute
deadline at a 30s cadence with a no-cancel concurrency group, so successive
runs meet end to end and the 25-minute silences should be gone. That is a
mitigation, not the fix — it still depends on GitHub firing at all.


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
