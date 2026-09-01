# SOL 5.6 BRIEF — LAUNCH VERIFY ROUND 2 (13 Aug 2026, addendum)

You are sol 5.6, same rules of engagement as always (read-only checkout, run
any suite, findings as P0/P1/P2/P3 with repros, one-word verdict at the end).
Your last verdict was GO at `cbddf33` with two P3s. Three code commits have
landed since; this round confirms your P3s are dead and sweeps the two small
features. It should be your shortest round yet — the draft is Thursday
20 Aug and nothing here touches the server.

## 1. Your two P3s — verify the kills (commit `58d3d56`)

- **Stale club lens:** `autolistRows()` now clears `autoFilter.club` the
  moment the filtered club has no row in the list (last man removed, manager
  switch). Re-run your repro. Attack: the self-heal runs inside a render —
  can the filter flicker back (two render sites, side card + drawer, same
  pass)? Does clearing mid-render leave the select and the rows disagreeing
  within one paint?
- **Ghost Back entry:** `showScoutCompare()` now routes the
  fewer-than-two-left closure through `closeOv()`, consuming the history
  entry. Re-run your repro. Attack: rapid remove-remove (two toggles before
  the async `history.back()` settles), and the pin's honesty — SC6c asserts
  RELATIVE history depth because the shared harness page inherits earlier
  checks' entries; check that relativity can't mask a real ghost.

## 2. Photo library probe (commit `015e894`)

`PHOTO_LIB` starts at `premierleague25`; a one-image boot probe flips it to
`premierleague26` the moment the PL mints that library (it 502s today).
Attack surfaces:
- the flip is async and mid-session — images already rendered keep 25 URLs,
  new renders get 26; the delegated error chain (`fbk` stages new→old→
  silhouette) must stay coherent whichever library a given img started on;
- the probe is skipped under `?nosync` so matchday/r3ui's intercepted photo
  pins stay deterministic — confirm no real user path carries `nosync` (the
  gate must never disable the upgrade for an actual visitor);
- a hostile/captive network answering the probe URL with a 200 image flips
  the lib to a URL that then 404s everything — the fallback chain should
  absorb that to legacy/silhouette, not blank pages. Confirm.

## 3. The club directory pre-season (commit `1c45070`)

`SETUP_NAV` gained `'directory'` (five tabs) and the setup-phase dispatch in
`render()` resolves it — note the bug pattern this fix itself exposed: the
set and the dispatch are TWO places, and the miss rendered Settings silently
under a Clubs tab. Attack:
- any OTHER route into views during setup (boot deep link `#directory`,
  popstate, snapshot-forced view changes, demo) that might still fall
  through to the wrong page;
- the directory and profile overlay pre-season with hostile custom text
  (team names, sponsors, gaffer bios are manager-typed; the components are
  the season ones you swept in the club-office rounds — confirm nothing new
  renders unescaped on this new surface);
- signed-out and spectator visitors in setup: the directory is deliberately
  public; confirm no edit affordance leaks for clubs that aren't yours;
- 320px: five tabs in the setup bar (CSS went 4→5 columns) — no overflow,
  tap targets sane.
- prep P1 was re-pinned from 4 tabs to 5 — check the re-pin asserts the
  right things rather than merely passing.

## Out of scope

pages.yml / CI (infrastructure, live-verified), the domain plan, and
everything your two launch rounds already cleared. Suites all green at
`1c45070`: offline + sim, 16 browser suites (prep 36, scouting 12,
matchday 49, r3ui 45), emu untouched (no server change — confirm that
claim with a glance at the diff).

## Verdict

One word again: does the REAL league remain GO for Thursday?
