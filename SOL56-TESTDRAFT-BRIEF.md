# SOL 5.6 — TEST-DRAFT NIGHT ROUND (19 Aug 2026, draft is TOMORROW)

## Context

Toby ran a live test draft in the sandbox on the evening of 18 Aug (Toby, Marc,
Ben + absentees force-opened). It flushed out real bugs — managers "skipped"
the instant they came on the clock, the drinks break timing people out
underneath the overlay — and every fix was built and shipped the same night,
plus two of Marc's branches merged the morning after. The real draft is
**Thursday 20 Aug**. This is the final adversarial round before it.

Your job: try to break it. Findings by severity, then one word:
**GO / NO-GO** for draft night.

Review the delta `ed384e4..HEAD` on main (roughly: everything dated 18–19 Aug).
Cloud Functions were deployed twice on the 18th; the LAST deploy included the
`{expired:true}` server gate described below — verify the repo's
`functions/index.js` is what the night depends on, and remember
`functions/engine.js` is a gitignored copy refreshed from `js/engine.js` at
predeploy.

## What changed

### 1. The board's Rate — two levers moved (engine ×2 mirrors + app.js)

- `RATING_HISTORY_WEIGHT` 0.75 → **0.45**: FPL valuation now takes 55%,
  last-season points 45% (Ben's ruling: market slightly outranks production).
- History trust ramp `apps/8` → **`apps/20`**: a season earns full trust at
  half a season of ninety-minute appearances. The motivating case: Isak's
  694-minute strike year had him #100; he is now #29. Palmer #33→#12.
- The constant lives in THREE places (js/engine.js, functions/engine.js,
  js/app.js) and scoring.test pins weight + a 66-point valuation gap.
  **Attack: any drift between the mirrors; autopick ranking parity between
  server engine and client board.**

### 2. The draft clock — the night's big find

The room watched managers get autopicked the moment they came on the clock.
Three-layer fix:

- `js/sync.js` subscribes `.info/serverTimeOffset`; `draftDeadlineTiming`
  adds it — deadline maths never trusts the device watch.
- The expiry fire (`mayFire` in the clock tick) now sends
  `{expired: true}`; **the server refuses a declared expiry unless ITS OWN
  clock says the deadline passed** (`draftAutopick`, +2s slack). The
  undeclared path is unchanged (on-clock manager's Autopick button;
  commissioner deliberately pushing a stalled draft). A refused fire resets
  `firedDeadline = 0` so the device retries next tick.
- **Attack:** a slow-clock room (every device behind server time) — does the
  draft stall? Who fires, when, and does the retry loop converge? Double-fire
  idempotence still holds? Can a malicious manager still skip someone via the
  undeclared path they could not before? (They could always self-autopick;
  commissioners could always push — confirm nothing NEW opened.)

### 3. Drinks breaks

- A due break **gates the expiry fire entirely** (`breakOn` in the tick) —
  the on-clock manager was being timed out under the overlay, and the forced
  pick advanced `pickNo` past the trigger, yanking the break (and anthem) off
  every screen mid-song.
- The 2-minute countdown is now **one shared clock**: anchored to
  `draft.deadline - pickTimer*1000` (the moment pick n landed), corrected by
  serverTimeOffset. Offline keeps per-device localStorage.
- The anthem loops every 12s until the countdown ends or the room is called
  back.
- **Attack:** a timewaste pressed just before the break shifts `deadline` by
  +30s — the shared anchor is then 30s late. How wrong does the countdown get,
  and does anything worse than a long break follow? Also: break due on the
  FINAL pick of a third (boundary), break during a paused draft, breakDone
  re-arm racing an expiry fire.

### 4. The ceremony barrier (Marc's branch, merged)

- The barrier card counts you as through the moment it is ON SCREEN
  (`cerFinish` at `lastStep`), shows a live "N/12 are in" line, and
  `ceremonyTick()` (called from every shared snapshot) closes a stranded
  overlay once picks land, with a toast.
- Merged by hand around the Buffer club-statement step — **verify the steps
  array union**: Buffer step then wait-barrier step, `lastStep` maths still
  correct, `buffer: true` audio step unharmed.
- test/ceremony.smoke.js runs in test:browser (10/10 at merge).
- **Attack:** refresh mid-ceremony after the barrier stamped seen; force-open
  while a device sits on an EARLIER pomp step (does cerFinish fire early for
  them? — it should not, only at lastStep); the `fresh` gate in
  applySharedSnapshot still only rolls the pomp pre-pick-one.

### 5. Autopick queue + pool UX (all client)

- Queue hides drafted men by default ("N drafted hidden" chip restores,
  crossed out); GONE rows keep an 8ch name floor (names were collapsing to
  nothing on phones); queue card self-scrolls at 52vh.
- Pool: position filter is a multi-select SET (`poolPosOn`, accepts legacy
  string pos from saved scout views — **attack a saved view round-trip**),
  buttons restyle in place on press, Show all button, scope select now also
  on the scouting floor (departed men), "All squads" label.
- NI flag drawn inline (NAT_SVG), NAT_OVERRIDE keyed on stable player code.

### 6. Ops facts for the runbook

- Sandbox pickTimer set to 60 server-side mid-test (sandbox only). REAL league
  still defaults 30 — **the Chairman sets 60 on the setup screen before
  pressing Start** (it rides in the start txn). Confirm nothing else reads the
  old value first.
- Real-league autolists verified + snapshotted
  (data/backups/league-v2-2026-08-18-draft-eve.json, gitignored).
- Ben Levy sign-in still outstanding (runbook blocker, chase today).

## Verdict format

Findings by severity (P0 blocks Thursday), each with a repro. Then the word.
