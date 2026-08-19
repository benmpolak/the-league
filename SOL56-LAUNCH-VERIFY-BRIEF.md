# SOL 5.6 BRIEF — LAUNCH VERIFY ROUND (13 Aug 2026)

You are sol 5.6, the adversarial reviewer for The League (same rules of
engagement as every prior brief: check out the repo read-only, run any suite,
attack the changes, report findings as P0/P1/P2/P3 with repros, end with a
one-word GO or NO-GO). Your last verdict was the launch audit: SANDBOX GO,
REAL LEAGUE NO-GO on exactly one P1 — the waiver Skip targeting the wrong
run in the 10:00–10:07 window.

This round is narrow: confirm your P1 is dead, sweep what landed since your
checkout, and give the final one-word verdict on the REAL league. Draft
night is ~21 Aug. Do not re-run the full audit — you already did it and it
held; scope is the delta below.

## 1. Your P1 — verify the kill (the round's centre of gravity)

Fix commit `039930d`. The claim: `nextProcessableWaiverRun()` (js/engine.js,
mirrored in js/app.js) returns the first due-but-UNEXECUTED slot — first
slot strictly after `lastWaiverRun()`, within the same 14-day lookback as
`waiverSchedule()` — and only falls forward to `nextWaiverRun(now)` when
nothing is owed. The Skip button's `data-slot` and every next-run surface
now read it (or `nextLiveWaiverRun()`, which steps over a stamped skip).

- Re-run YOUR 10:03 repro against the fixed build. Skip pressed after the
  advertised run time but before the :07 tick must stamp the DUE run's slot
  id, and the tick must then mark that run skipped — not execute it.
- Attack the fix itself, the way you attacked my heal paths in rounds 5–6:
  - skip already stamped + a second due slot in the lookback window;
  - manual "Process waivers now" DURING the 10:00–10:07 window (lastRun
    stamps ahead of the slot — does the button now offer the right target?);
  - DST boundary (August BST vs December GMT slot times — waiverclock.test
    pins both, check the pins are honest);
  - lookback divergence: client `waiverRunDue` still scans 48h while the
    engine/server scan 14 days. I judged it harmless (client dueness is
    display-adjacent post-v2). Prove me wrong if you can.
- The engine change is additive and the server was NOT redeployed — confirm
  from functions/index.js that the server tick never needed the new helper
  (its dueness maths were already correct) and that nothing server-side
  imports it unawares.

## 2. Your P2 — one truth on every surface

All five surfaces you flagged (Transfers status line, Waiver Order, claim
receipt, Trough clears-at, Chairman pre-flight) plus the clock line now go
through nextProcessableWaiverRun/nextLiveWaiverRun. Grep for any stragglers
still calling `nextWaiverRun(Math.max(lastWaiverRun(), Date.now()))` — the
pattern that caused this — and check no surface can display a stamped-skip
slot as "next".

## 3. Landed since your checkout — Marc's merge + the audit fix

Marc's AI now pushes straight to main (Ben's ruling, no PR flow). Two
features landed after your audit checkout, then my post-merge audit fix:

- `842cdb2` — autopick queue LENS: position/club filter over the ranked
  queue (filter never reorders; rank inputs are true whole-list positions;
  arrows step to previous/next VISIBLE row). Attack: typed-rank vs filter
  interactions, DnD (`data-qdrag` carries whole-list indices) while
  filtered, the two simultaneous render sites (sidebar + phone drawer,
  controls addressed by data attribute not id), filter state vs whoami
  switches, and whether any path can corrupt the server-side autolist
  (moveAuto validates `from`, clamps `to`).
- `8cb853d` — ONE comparison tool: `scoutCompare` is now the single 3-cap
  selection shared by Data Room tick-boxes, draft pool, Trough and search
  palette; one `compareBody()` renders inline and in the overlay; windowed
  rows fall back to the archive pre-season with the season labelled; null
  rows print a dash and sit out of the verdict. Attack: the verdict
  arithmetic (ties, all-null rows, mixed archive/null players), the
  pre-season fallback's sourcing, and the fourth-player-evicts-oldest rule
  vs the overlay redraw path (remove down to 1 while the overlay is open —
  it closes with a toast; check history/back-button state stays sane).
- `665ad8e` — my audit fix: `bindCompareBody(redraw, root)` — the overlay
  builds its DOM detached, and the old document-wide getElementById meant
  its window pickers and metric ticks were DEAD (or could seize the inline
  card's controls). The overlay now passes itself as root. SC6b in
  test/scouting.smoke.js drives both pickers inside the overlay and was
  verified red against the unfixed code. Audit SC6b's honesty and look for
  the same detached-DOM binding mistake elsewhere in the new code.

## 4. Out of scope

CI/deploy plumbing (pages.yml, mirror.yml — your P3) is infrastructure,
live-verified end to end tonight, and not your lane this round. The
Chairman's launch runbook items (ready room, draft order, autopick uptake,
timer) are ops, owned by Ben.

## Suites at HEAD

offline (waiverclock 41 incl. six new window pins, sim, dgw, parity, noeval
51), browser 16 suites (scouting 11 incl. SC6b, prep 35), emulator (rules
22, functions 318, migrate, backup 23, provision 13, emaillink 18). All
green at `3205c84`. Fixture testdata churn after emu runs is run artifacts —
`git checkout` it, don't report it.

## Verdict

One question, one word: is the REAL league GO for draft night?
