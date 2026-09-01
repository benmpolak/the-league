# SOL 5.6 BRIEF — TEST-NIGHT ROUND 2: THE FULL TRANSFER-SYSTEM AUDIT (9 Aug 2026, evening edition)

You are sol 5.6, adversarial reviewer for The League — same rules of
engagement as every prior brief (read-only checkout, run any suite, findings
as P0/P1/P2/P3 with repros, one-word verdicts at the end). Your round-1
verdict was GO (Toby's sandbox week) / NO-GO (real league) with a named gate.
Since then Toby field-tested all day and a LOT shipped. This round is
deliberately consolidated: verify your round-1 findings dead, attack
everything new, and give the TRANSFER SYSTEM one end-to-end adversarial
sweep before real draft night (~21 Aug). Budget your depth accordingly —
this is the pre-season MOT, not a spot check.

## Part 1 — verify round-1 findings dead (commit d6761c0)

- **P1**: `claimSet` refuses `asManager` outside the sandbox; the target's
  blind ladder survives a refused attempt (emu-pinned with your exact
  two-claim repro). Re-run your repro.
- **P2**: `#actAsSel` renders only `SANDBOX && netOn() && isCommissioner()`;
  `hubActor()` ignores the pen unless SANDBOX; the `actGuard` skip requires
  `SANDBOX && state.view === 'transfers'`; `render()` clears the pen on
  leaving Transfers. Re-run your My-Team lineupSave repro.
- **P3**: roomOpen confirm names the absentees.

## Part 2 — new since your round 1, attack each

1. **Reset stash/restore** (d6761c0): resetLeague snapshots public+private to
   `server/resetStash` in the same multi-path update; `resetRestore` peeks or
   restores both trees wholesale; stash survives restore. Attack: no CAS on
   restore (argue whether Chairman-only + typed confirm suffices); 12 live
   clients swallowing a wholesale swap; membership/managerUid deliberately
   not stashed; backup/migrate tooling vs a multi-MB server key.
2. **skipDraft / draftAdmin autoComplete** (5ce02e1): sandbox-HARD-refused,
   Chairman-only, engine-computed remaining picks in ONE public txn with a
   pick-count CAS. Attack the CAS honesty and the sandbox gate.
3. **Chamber parity port** (99f4da1): `mockScorelines`/`mockGwStats` ported
   VERBATIM into engine.js; `normalizeState` overlays a FINISHED mock round
   into `s.matchStats` so server waiverOrder/standings/transferGw see what
   clients render. `test/mockparity.smoke.js` pins app-vs-engine byte parity.
   Attack: RNG call-order drift risks, the overlay leaking anywhere it
   shouldn't (mock can only exist in the sandbox — prove the gates), LIVE
   (non-final) mock rounds deliberately NOT overlaid (waiver runs during a
   live mock — coherent?), and the parity test's honesty (it uses the demo
   league — is that representative?).
4. **Per-GW point adjustments** (b0bbe45): flat {pid:pts} retired and dropped
   by every normalizer; canonical {gwIdx:{pid:delta}} consumed INSIDE
   gwPlayerPoints (both engines) so H2H, table, records, Gazette and report
   cards all re-score. `adjustmentSet` requires a gw. Attack: an adjustment
   to a SETTLED gw rewrites history by design — probe every downstream
   consumer for coherence (records "since records began", Gazette archive
   determinism, report-card verdicts, waiver order at the next run); RTDB
   array-coercion of the gw-keyed node; the UI's GW list capping at the
   current gw.
5. **Run-drop waiver lock** (b0bbe45): resolveWaivers records now stamp
   `t = runStart + 1` (strictly after lastRun — run-executed drops were
   instantly free, the reborn 6 Jul legacy bug); manual THROWN OPEN now
   frees the pool but never fresh drops (drop-lock loop moved above the
   ctl==='open' early return, app + server). Attack: anything assuming
   t <= lastRun for run records; double-lock or deadlock scenarios (a drop
   that can never clear); the +1ms colliding with the claim-stamp scheme.
6. **Live-match fast lane** (ea13bad): live.yml pushes the live GW's stats
   to `public/liveStats` ~every 60s during live fixtures (real league only);
   client `applyLiveStats()` is a DISPLAY-ONLY overlay with staleness,
   feed-freshness, final-round, sandbox/demo/Chamber guards
   (test/livestats.smoke.js). THE PROPERTY TO BREAK: prove the overlay can
   never affect an OUTCOME — settlement, waivers, auto-subs, records all
   read the canonical feed. Also: rules deny client writes to liveStats?
   A malicious/stale liveStats node shaping user decisions mid-window;
   vidiprinter/win-prob coherence when overlay and feed interleave.
7. **Suggestion Box** (1c3a1ff): public suggestions, 240ch, 1/min cooldown,
   Chairman rulings, survives resets, dropped from imports. Attack: escaping
   (manager-typed text), cooldown bypass, the 200 cap, reset-carry edge.
8. **Waiver countdown + feed cadence** (e8eb8c7, 8d1c043): waiverClockLine
   on Dashboard/Transfers, 30s in-place tick; fpl.yml at */5. Light touch —
   DST correctness and the tick surviving view churn.

## Part 3 — the end-to-end transfer sweep

One adversarial pass over the WHOLE transfer system as it will run on real
draft night + GW1: trough signing, drop-locks, blind-claim ladders and
fallbacks, adjudication order vs the displayed table (build the
emulator-backed order pin I skipped — you were right that it was missing),
trades incl. multi-player + covenants, window-draft locks, transferGw
landing rules mid-round, and the interaction matrix of manual overrides ×
chamber × real clock. DF canon (docs.draftfantasy.com) is the reference
where the rules PDF is silent.

## Verdicts

1. GO/NO-GO — Toby's sandbox week continuing on current main.
2. GO/NO-GO — the REAL league for draft night (~21 Aug), everything as
   shipped. If NO-GO, name the cheapest gate that buys the GO.
