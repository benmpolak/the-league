# Sol brief — settlement at the whistle (24 Aug 2026, commits 577b8b2, a919e91, 9009f8e, c968a8e)

## What changed and why

FPL's event-level `finished` flag waits for their bonus/data checks — on GW1
night every one of the 10 fixtures sat `fp: true, finished: false` a full day
after the Saturday games. Two real consequences:

1. The table sat saying "live" all Sunday night after everything had finished
   (Toby: "when does it all update? Midnight?").
2. A Monday-night finish would leave Tuesday's 10:00 waiver run computing
   priority on a table WITHOUT the just-played gameweek — and an unsettled
   GW1 means the reverse-draft fallback order, not the real table.

Ruling: this league pays no bonus, so FPL's post-whistle checking is work we
ignore. The round now settles at **last kick-off + 150 minutes** (~30 min
after the last whistle), provided the WHOLE round is present and every
fixture has `finished || fp`. No provisional messaging (Chairman: "wait 30
mins and then bang") — a late stat correction just flows through the next
refresh. Review pods publish at the settlement moment; previews keep the
Tue/Fri midday slots; the Gazette already printed off `gwStatus` so it
follows for free.

## The changes to verify

- `js/engine.js` — new `roundBlown(state, i)` (exported): fullRound club
  check + every `finished || fp` + `now() > gwKicks(i).last + 150min`.
  `gwStatus` gains `|| roundBlown(state, i)` in its final test. `effectiveXI`
  roundDone gains `|| f.fp` (auto-subs at the whistle — NO grace there,
  deliberate: subs recalibrate at the whistle, settlement waits 30 min).
- `js/app.js` — mirrored `roundBlown(i)` off `state.fixtures`; same gwStatus
  change; same roundDone change (line ~2985).
- `js/podcast.js` — `reviewAt = k.last + 150 * 60000` (was
  `slotAfter(k.last + 2h)`). `published()` still gates on `gwStatus final`.
  Double bills structurally dead (review can never equal a preview slot).
- `test/engine.parity.test.js` — now passes `fixtures: state.fixtures` into
  `Engine.make` (without it the whistle test is invisible to the engine side
  and effectiveXI parity fails — this is a tripwire worth keeping honest).
- `test/podcast.smoke.js` P5 — re-pinned: previews Tue/Fri 12:00 London,
  reviews exactly `k.last + 150min`.
- `.github/workflows/render-pods.yml` — nightly 19:15 + 23:15 UTC render
  passes added. `PODS_AUTORENDER=on` set and `ELEVENLABS_API_KEY` now in
  repo secrets (piped from Ben's local env file, never displayed).
- `scripts/render_pods.js` (9009f8e) — the workflow's `--state` path had
  NEVER worked (every earlier scheduled run skipped on the gate; existing
  audio was cut locally): a seeded snapshot is the league's PUBLIC state,
  which carries neither `fixtures` nor `matchStats` — both are built
  client-side during a feed sync, and under `?sandbox&nosync` no sync runs,
  so `published()` threw and the render died. The harness now feeds the page
  its own static `data/fixtures.json` + `data/stats.json` post-boot, the way
  the app's sync does. `gwKicks` and app `roundBlown` also gained
  `(state.fixtures || [])` guards.
- `audio/pod/` (c968a8e) — orphaned recording `tt-draft/94gfcn` deleted
  (script line changed under it days ago; it blocked the proving step and
  cost one discarded render pass). `rendered.json`/`index.json` scrubbed.
  Podcast smoke now 20/20.
- Functions deployed twice tonight (engine copy at 577b8b2, then a919e91).

## Known, deliberately NOT changed tonight

Table dead-heat tiebreak: app sorts Points → overall points → points-for,
and a full tie falls to registry order (engine uses explicit `x.id - y.id`;
the app relies on stable sort — note they'd disagree if pf/ovr ever diverge
from the engine's `pts` key ordering, worth a look). Marc has proposed
head-to-head-between-tied as the next key; that is a Committee/format
decision and waits for a ruling. Flag anything that makes the current
behaviour worse than cosmetic (e.g. playoff seeding on a dead heat).

## Questions for sol — attack these

1. **The mock/chamber.** Engine `roundBlown` reads ctx `FIXTURES` (the feed);
   app `roundBlown(i)` reads `state.fixtures`, which `patchMockFixtures`
   REWRITES during a Simulation Chamber run (hs/as/started/finished). Can a
   mounted mock make app-side `gwStatus` go final while the engine (or the
   server) disagrees? The mock also sets `ev.final` — is every path covered,
   including switch-off mid-window (`unpatchMockFixtures` restore)?
2. **The grace maths.** `k.last + 150min` assumes a game is over ~115 min
   after kick-off. Extra time doesn't exist in the league game, but LONG
   stoppages do (the fp check should hold the gate — verify the AND ordering
   actually does: all-fp false → no settle regardless of clock).
3. **Waiver order on a Monday finish.** Walk the Tuesday 10:00 run with a GW
   settling Monday ~22:30: does `waiverOrder` (full-table, gwStatus-final
   gated) now include it on the server? Any path where functions' feed fetch
   (ctx fixtures) is staler than the client's and the two disagree about
   priority on the boundary?
4. **`fp` trust.** `finished_provisional` comes straight off the FPL feed via
   `scripts/fetch_fpl.py`. What happens on a feed hiccup that drops the flag
   back to false after settlement (does anything UN-settle, and does that
   matter — e.g. the review pod disappearing from `published()`)? Related:
   `gwIsOver` keeps the old time-based backstop — confirm nothing can settle
   TWICE or flap.
5. **Postponements.** fullRound requires every club in the round's fixture
   list. A postponed fixture usually MOVES gw — verify the feed's postponed
   representation (fixture kept with same gw but no date? date null?) can't
   leave a 10-fixture round that passes fullRound while a game is unplayed.
6. **Auto-subs at fp.** roundDone now fires at the whistle. A player whose
   match is fp but stats not yet in `playerStats` for that sync cycle —
   can `appearedInGw` briefly read false and sub someone out who actually
   played, in the window between fixture-fp and the stats commit landing?

## Honest gaps (no regression tests yet)

- No test that gwStatus flips at exactly last-KO+150 and NOT at +149 (P5
  pins reviewAt's arithmetic; nothing pins the engine's clock directly).
- No emulator test of the Monday-night waiver-order scenario (q3).
- The mock-interaction question (q1) is reasoned, not tested.
- The render harness fix (9009f8e) was proven by a local `--dry` run against
  the real league snapshot, not by a dedicated test — the workflow is its
  own test from here.
- The engine-vs-app standings sort discrepancy noted above (explicit id key
  vs stable-sort insertion order) predates tonight but deserves a verdict.

## Verdict wanted

GO / NO-GO on the settlement change as deployed, plus any of q1–q6 that
turn out real, in the usual format.
