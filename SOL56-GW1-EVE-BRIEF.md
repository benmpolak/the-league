# SOL 5.6 — GW1-EVE AUDIT BRIEF

**Context.** The real draft ran tonight (Thu 20 Aug, 168 picks, phase =
season). GW1 kicks off Fri 21 Aug 20:00 London. Everything below was built
and shipped IN THE HOURS AFTER THE DRAFT, under field reports from the lads,
and is LIVE on theleaguehq.co.uk at `ff1208d` — except the two functions/
changes, which are committed but NOT deployed (flagged below). This is a
fast-surgery session: the review's job is to find what speed broke.

**Verdicts requested, separately:**
1. Is the live client build safe to leave up through GW1? (Anything here
   that can corrupt state, mislead a manager into a wrong irreversible
   action, or crash on a phone mid-gameweek.)
2. Are the two undeployed functions changes safe to deploy in daylight
   tomorrow, or do they need another round first?

---

## What changed (in shipping order)

### A. Mid-draft, used live during the real draft
- **Full names on the autopick list**: `.plink.qfull` (wraps instead of
  truncating), `autolistRows()` prints `p.full`.
- **Chairman clock control mid-draft**: `#pickTimerLive` select beside
  Pause (render-gated `(!netOn() || isCommissioner())`), calls
  `settingsSet {key:'pickTimer', value}` online; local mode writes state
  directly. Used live to move 30s → 60s. Server side was ALREADY deployed
  (settingsSet has handled pickTimer all along) — only the client control
  is new.

### B. Provisional players (with Marc's commit `1ea3545`)
- Marc's merge() rewrite: strips every provisional + everything ≥ ID_FLOOR,
  rebuilds from provisional.json (the file is truth). My `0f1bba8`
  regenerated the feed from live FPL. provisional.json is now `[]`.

### C. The Podcunt Network
- `render_pods.js --state <file>`: seeds the harvest page's localStorage
  (`tl2627sb-league`) with a league snapshot so post-draft episodes
  generate from the real board; writes the seed to
  `audio/pod/league-state.json` beside the audio it produced.
- `test/podcast.smoke.js` P13 now harvests from a SECOND page seeded with
  that file (when present) so the orphan check judges recordings against
  the words they were cut for. 19/19.
- Both draft episodes rendered (39 lines, ElevenLabs, cast verified).

### D. Gazette Post-Draft Special
- `Gazette.draftSpecial()`: lead (pick one), round one in full, bargain
  (best archive pts after halfway) + eyebrow (lightest archive in round
  one), squad grades A–F on summed archive pts (verdict banks deduped
  within the edition via a `used` set), longest same-position pick run,
  top-3 undrafted by archive pts, hand-written Celta joint-manager story,
  Corrections box, pick 168. All facts from `state.draft.picks` +
  archive; `esc()` at point of use; no wall-clock (one `new Date()` was
  caught and removed pre-ship — check I got them all).
- `progTodays()`: draftSpecial takes the front page when picks exist and
  nothing is settled; retires when a matchday/review edition exists.

### E. All Squads tab
- `viewSquads()` + `squadProvenance()`: NAV_ITEMS `squads`, dispatch
  case, no bind (relies on global `[data-pcard]` delegation). Rosters via
  `managerSquad(mid)` (live through transfers), provenance = draft
  round/pick or trough/waiver/trade/window from `state.transfers`.

### F. Pick timestamps — **functions NOT deployed**
- `draftPick` and sandbox `autoComplete` stamp `t: Date.now()` on pick
  records; client local-mode `makePick` mirrors. Purpose: Window Draft
  "slowest hand" stats. importState only bounds pick COUNT (≤500), no
  key whitelist — verified tonight, but check every consumer of pick
  records (engine normalize, heal_ids, build_history, export/import
  round-trip, emulator pins that assert exact pick shapes).

### G. waiverSkip ledger-aware — **functions NOT deployed**
- Field incident: the Chairman pressed Skip and the client stamped
  `wv-2026-08-14` — a slot the server ledger had already consumed
  ("skipped: not in season") — leaving Friday's run unprotected. Fixed by
  hand on the live DB (`skip = wv-2026-08-21`), then in code:
  `waiverSkip {next:true}` makes the SERVER name the slot: first
  scheduled slot whose `sched-<id>` ledger entry isn't status done, else
  next future slot. Client sends `{next:true, id}` — the id rides along
  so the NOT-YET-DEPLOYED server still lands old behaviour instead of
  reading an absent id as a reinstate. Reinstate (null) and local mode
  unchanged.

### H. Client waiver DISPLAY horizon — deliberate engine divergence
- `app.js nextProcessableWaiverRun()` now uses a **2-hour** lookback
  (was the engine's 14-day). Rationale: the hourly tick takes a due slot
  within the hour; a slot still "due" after 2h was consumed by the
  server ledger, which the client cannot read — with lastRun null the
  dashboard promised "waivers process in any minute now" all evening.
  The ENGINE (and server) keep 14 days. `nextLiveWaiverRun()` now steps
  the skip with a `while`. **This divergence is intentional — attack it
  anyway**: the sol-P3 rule was "horizons must not drift"; is there a
  surface (pre-flight lights, Run-now, claim receipts, waiver order
  card) where display-2h and server-14d disagree in a way that misleads
  an action? What does the display claim during a genuine >2h Functions
  outage while the server will still catch up?

### I. Dashboard benches
- `dashMiniPitch()` gains the bench strip (queue order, numbered, live
  points once underway, `data-pcard` chips).

### J. Mobile pass (Iain/Ben/Toby field reports)
- Trough makes-way picker: ≤700px renders compact `.trout-row` rows
  (same `data-trout` taps) instead of the pitch; picking a man
  scroll-jumps to the pool search.
- Fixture IN the player cell: `nextFxHtml()` (shared with the Vs column)
  appended to the trough `.pclub` line (phone-only via `.pfx`) and the
  draft pool's `.player-mobile-meta`. `MOBILE_COL_KEYS` back to
  `['rate']` — nothing to drag sideways; P11c's 320px pin holds.
- Player card: next-6 fixture pills coloured by `fdrCls`.
- **Available scope** (new default `avail`): unowned + unlocked +
  not-departed — free agents and the waiver queue together; Free/
  Waivers/Everyone chips unchanged. Check every consumer of
  `transfersView.scope` and saved scouting views for assumptions that
  scope ∈ {free, waivers, all}.
- Directory cards: "First pick: X (#n overall)".
- Fixed in passing: doubled `provChip(p)` in trough rows.

### K. Ops / CI
- `pages.yml`: deploy step `continue-on-error` + one 75s-paced retry
  (the API refuses deploys for seconds after the previous record
  finishes). Attack: can the retry mask a REAL failure as green? (Retry
  failing still reds the run — verify.) Tonight also saw a phantom
  "in progress" deployment block ALL deploys ~21:01→22:50 before timing
  out; the retry does not address that class.
- `MOBILE_COL_KEYS` briefly shipped `['vs','rate']` and broke P11c at
  320px — caught by CI, fixed width-aware, then superseded by the
  in-cell fixture. Noted for honesty.

## Named attack surfaces (priority order)
1. **The waiver stack end-to-end for the next 5 days**: skip currently
   hand-set to `wv-2026-08-21`; Friday 10:07 tick must mark it
   skipped-chairman and touch nothing; Trough shuts Fri 18:30; first
   real run Tue 25 10:00 with lastRun null and reverse-DRAFT order
   (no results yet — GW1 finishes Mon night; verify waiverOrder's
   GW1-pre-season rule still holds with the season's first run
   happening AFTER a finished GW). Drop-locks: Stach (dropped 20 Aug)
   claim-only until Tue's run.
2. **Display-horizon divergence** (H above).
3. **waiverSkip {next:true}** correctness + the old-server compat window.
4. **Pick `t`** through every consumer (F above).
5. **Squads/gazette/dashboard renderers** on hostile input: club names,
   emoji team names, players with no `full`, empty benches, mock/demo
   states, 320px.
6. **draftSpecial determinism**: same edition on every phone, no
   wall-clock, no RNG, verdict dedup stable under object-key order.
7. **P13's seeded audio page**: renders run WITHOUT --state after a
   state-dependent episode shipped → league-state.json goes stale
   against new audio — does the test catch or mask that?

## Honesty gaps (declared)
- **The emulator suite was NOT run tonight** (functions changed: pick
  `t`, waiverSkip next). No new emulator pins were written for either.
  CI's "Test game engine" ran green but review whether it covers the
  emulator functions tests at all.
- The two functions changes are code-reviewed only; they are NOT live.
- No automated test covers the mid-draft pickTimerLive control (it was
  field-tested once, during the actual draft).
- draftSpecial's facts were eyeballed against the real board once;
  there is no pinned test for the special edition.
- The 2h display horizon has no dedicated test; waiverclock's 41 pins
  pass but were written for the engine mirror, not the divergence.

Sim, browser (16 suites), offline, prep, waiverclock, podcast all green
at `ff1208d`. Report findings by severity with repros; the Committee
pays in Ham Cup seedings and the recognition of your peers.
