# Sol 5.6 — Club Office round 4: the commits your r3 checkout never saw

Your r3 checkout was taken before three commits landed the same evening, so
your verdict doesn't cover them. This round: confirm your confirmed-P2 fix is
dead, sweep the new surfaces, audit the new smoke suite for honesty, and say
whether the GO stands.

## 1. Your P2 — duel Opta bar orientation (fixed 77a7394)

viewTeam's Show Opponent duel renders opponent LEFT, you RIGHT, but
winProbBar was called with (pair[0], pair[1]) — for any manager sitting at
pair[0] the percentages and projected points were swapped. Now
`winProbBar(oppMid, mid)`. Verify from BOTH seats (a pair[0] manager and a
pair[1] manager), and confirm the dashboard matchup (pair[0] left) and the
matchup modal (a left) are still consistent — the fix must not have
re-reversed either of those.

## 2. New since your checkout — sweep these (7f3196e + bf167d3)

- **Club records**: `clubRecords(mid)` — record scorer, longest-serving, best
  draft pick, worst transfer, biggest win, highest GW — computed from
  picks + transfers + contributedPoints. Rendered via `clubRecordsHtml(mid)`
  on My Club AND publicly inside the League Table tap-a-club breakdown rows.
  Check: empty states (pre-draft, no transfers, zero games), division edges,
  and that manager-typed text reaching these rows is escaped.
- **Supporters' mood**: `supportersMood(mid)` — six moods from last-3 form
  AVERAGED per games played + table position, gaffer name woven into the
  lines; pre-season = its own mood. Same two surfaces. Check the calibration
  boundaries (1 game played, 0 games), and that a custom gaffer name (manager
  input) can't inject through the mood line.
- **Player photos**: `photoImg` now tries the CURRENT FPL headshot library
  (`resources.premierleague.com/premierleague25/photos/players/110x140/{code}.png`,
  no p-prefix) → legacy p-prefixed library → silhouette, via the delegated
  capture-phase error chain (data-code attr, fbk '1'/'2' stages). The new
  library is incomplete (e.g. Donnarumma 403s). Check: the chain can't loop,
  a player missing from BOTH libraries lands on the silhouette exactly once,
  and no inline on* handlers snuck back in (CSP has no unsafe-inline).
- **The crest** (bf167d3): black-and-gold crest replaces the ball emoji in
  the header (30px on phones, gold glow), fronts both pre-draft waiting-room
  heroes, and is now the favicon + app icons. Check header layout at 320px,
  and that sw.js's precached shell still matches the icon file names.

## 3. The new suite — audit for honesty

test/r3ui.smoke.js (35 checks, wired into test:browser): duel orientation
pinned from both seats (claimed verified RED against pre-fix code — check the
pin actually distinguishes the seats), pct sum/bar width, no-pairing GW
renders no duel, empty-XI NaN guard, demo Run-waivers = local engine + zero
WCSync calls, stale 'price' column pref can't resurrect, table ⚽ button
navigates without firing the row breakdown toggle, 320px overflow + third
hoarding, null nat renders no flag, club-office backdrop + Cancel inert
mid-save, 320px setup console. Call out anything vacuous.

Harness note: multi-page browser tests on one profile share localStorage —
pages needing clean state use browser.createBrowserContext(). If you extend
the suite, keep that pattern or page A's saved league wedges page B's boot.

## Suites at this commit

offline: noeval 51 / feed 29 / waiverclock 17 / sim 68 / dgw 8 / parity 8.
browser: authui 16 / offline-ux 16 / r3ui 35.
emulator: rules 21 / functions 211 / migrate 41 / backup 21 / provision 13 /
emaillink 18. `npm run test:emu` needs
`PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`.
test/fixtures/testdata/* are run artifacts — git checkout after runs, don't
flag the churn.

Do NOT run browser suites on port 8125 if another checkout is serving there —
use a side port.

No production writes. Sandbox, emulator, localhost only.

Findings ranked P0→P3 with repros, then one word: does the GO stand —
GO or NO-GO.
