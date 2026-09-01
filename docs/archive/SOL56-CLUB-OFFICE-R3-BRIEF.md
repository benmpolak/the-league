# Sol 5.6 — Club Office round 3: confirm the r2 fixes, does the GO stand?

Your r2 verdict was GO with 2 P1s, 1 P2 and 2 P3s outstanding, plus a list of
tests you called vacuous. Everything on both lists is claimed fixed at this
commit. This is a short verify round: confirm the five fixes are dead, audit
the hardened tests, sweep the new client work, and say whether the GO stands.

## The five fixes (commit fedf778)

1. **Cold Settings (your P1).** `settingsSet` joined `SETUP_SEED_ACTIONS`.
   Repro your original: provision membership, `/public` absent, Chairman
   calls settingsSet — must seed and land.
2. **Ghost rivalry (your P1).** `managerMerge` revalidates `up.rival` against
   the roster INSIDE the txn; vanished rival = abort, not a blind write.
   Re-run your 100-iteration race (clubSet rival vs import that removes the
   rival). Any ghost is a blocker.
3. **Start settings reset (your P2).** `draftAdmin:start` now validates the
   payload with `cleanSettingsPatch` (only supplied keys), merges onto
   COMMITTED settings inside the txn, and judges squad-rule legality on the
   merge. Re-run your repro: committed non-defaults + partial patch — nothing
   omitted may reset.
4. **Validation drift (your P3).** `cleanBoards` checks raw length before
   dedupe (your 1000-entry array must fail on clubSet AND import). One
   `cleanStadium` (40ch) across office/rename/import — import CLAMPS overlong
   legacy stadiums rather than refusing; check a 60-char stadium imports as 40.
5. **In-flight Cancel (your P3).** Cancel and backdrop are dead while a save
   is dispatched; rejection re-enables them. Localhost repro with a delayed
   server.

## The hardened tests — audit for honesty again

functions.test.js: cold settingsSet + cold START (public nulled between),
ghost-rival race x10, reorder race now demands `landed >= 3` (your all-aborts
hole), start block runs against committed assist=8/lobusBonus=13 with a
partial patch, boards-flood and stadium-clamp import checks, round-trip now
asserts ALL five club fields. authui.smoke.js: rejected-save keeps the form,
in-flight Cancel dead, success closes + founds, focus lands inside.
Call out anything still vacuous.

## Also new since r2 — sweep, lower priority

- **Demo waivers** (aa98a3d): demo Trough shows "Run waivers now (demo)"
  wired to the LOCAL processWaivers. Verify demo can never write the cloud
  through this path.
- **Lee batch** (620d597, client-only): viewH2H reassembled from
  tableCard/matchesCard consts (check nothing dropped or doubled in the
  return); £m price column retired from ALL_STAT_COLS while saved column
  prefs may still contain 'price' (must degrade silently); bindPitchLinks
  data-pitchview navigation (stopPropagation vs the breakdown row toggle);
  kit art 66→110px; hoarding strip restyle; ≤480px third board hidden;
  desktop pitch capped via `.pitch:not(.mu-pitch)` (matchup modal must be
  unaffected); Around-the-league card slimmed.

Suites at this commit: everything green — functions 211, authui 16,
offline-ux 16, rules 21, migrate, backup 21, provision 13, emaillink 18,
sim + dgw + feed + waiverclock + parity + noeval.
`npm run test:emu` needs `PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`.

No production writes. Sandbox, emulator, localhost only.

Findings ranked P0→P3 with repros, then one word: does the GO stand —
GO or NO-GO.

## Addendum — landed after this brief was written, sweep these too

- **Nationality flags** (Lee): fetch_fpl.py exports FPL `region` as `nat`;
  feedcheck validates it; NATIONS map in app.js (67 codes, anchored
  empirically) renders emoji flags in the pool tables and player card.
  Check: unknown/null region renders nothing; no XSS through titles; the
  map's country assignments spot-check correctly.
- **Show Opponent side-by-side** (Lee): viewTeam's opponent preview is now a
  full-scale pitch in a .duel-grid next to your interactive pitch — the
  closing tags for the grid are emitted CONDITIONALLY after the own-pitch
  block (viewTeam ~line 3420). Check malformed-HTML risk when showOpp
  toggles with no pairing (playoff GWs, cup weeks).
- **League Table rebuild** (Lee): full compact table (pool-table style) is
  now the FIRST card; breakdown rows are hidden <tr>s toggled by row tap;
  fixtures + investigation moved below. sim's kit check re-pinned to the new
  selector — audit that re-pin for honesty.
- **The Opta bar** (Conway via Lee): winProbBar() — liveWinProb + teamOutlook
  rendered as a win-chance bar with projected points, on the dashboard
  matchup, the matchup modal and the Show Opponent view. Hidden at full time.
  Check: division/NaN edge when a side has an empty XI; playoff/cup GWs with
  no pairing; the 1–99% clamp still holds on the rendered numbers.
