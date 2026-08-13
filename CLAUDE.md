# The League 26/27 — working notes for Claude

Ben's real 12-man EPL fantasy league. Live at **https://theleaguehq.co.uk**
(custom domain since 13 Aug 2026; benmpolak.github.io/the-league redirects
there — on the custom domain the app serves from the ROOT path, not
/the-league/). The beta/sandbox stays at benmpolak.github.io/the-league-beta.
Vanilla JS, no build step, no framework. Firebase RTDB + Functions for the real
league; everything also runs fully offline.

## If you're working for Marc (or anyone who isn't Ben)

Read `MARC-ONBOARDING.md` before touching anything. The short version:
pushing to `main` puts it LIVE on the real site within minutes, so run
`npm run check && npm run test:offline` before every push; never touch
Firebase, deploys, or secrets; leave `functions/`, `js/sync.js` and the
waiver engine alone; Committee voice in all user-facing copy; one idea
per commit, plain-English commit messages.

The beta/sandbox site (the-league-beta) is a force-push mirror of this
repo — never a place for separate work. Mirroring is AUTOMATIC as of
13 Aug 2026 (`.github/workflows/mirror.yml`: every push to main, plus a
15-minute sweep for the data-refresh commits). Only push to it by hand
if the workflow is broken:

    git push --force https://github.com/benmpolak/the-league-beta.git main:main

## DO NOT read app.js top to bottom

`js/app.js` is ~8,000 lines and holds every view. Grep for the function you
need and read a slice. Landmarks (all in app.js unless noted):

- `viewDraft` / `bindDraft` — the Draft Console (scouting floor pre-draft, live board during)
- `viewTeam` / `bindTeam` — My Team, pitch with tap-to-swap XI
- `viewTransfers` / `bindTransfers` — Trough/waivers, trade desk, history, waiver order
- `viewTable` / `h2hStandings` — league table (H2H: 3 a win; overall fantasy pts is the TIEBREAK)
- `standingsBefore` — other standings helper: `.h2h` = table Points, `.pts` = fantasy points. Do not mix them up (Marc's "+11 bracket" bug, Aug 2026)
- `bracketCard` / `playoffState` / `qfHandicap` — playoffs: GW34 handicap QFs, GW35 semis, GW36–38 three-legged final
- `viewH2H`, `viewData`, `viewCup` (Palwin Ham Cup), `viewRules`, `viewSettings`
- `engine.js` — scoring engine (shared with functions/), `sync.js` — Firebase auth + realtime, `functions/` — server-authoritative mutations
- CSS: single `css/style.css` (~1k lines)

## Running it locally

```
python3 -m http.server 8749   # from repo root; it's a static site
```

- `?sandbox` — separate localStorage namespace + STAGING Firebase (don't wipe others' staging data casually)
- `?sandbox&nosync` — fully local, no network: you can be any manager incl. Chairman. Best mode for testing/screenshots
- Demo season: "Try the demo" button (finished fake season, safe)
- Offline identity picker won't show itself: in console `forceIdentity = true; renderIdentity()`
- Draft start / several admin buttons use native `confirm()` — in browser automation override `window.confirm = () => true` BEFORE clicking or the tab freezes
- NEVER mutate the production Firebase league. Real league = no URL params, requires email-link sign-in (never authenticate as anyone)

## Tests

- `npm run check` — syntax pass over all entry files
- `npm run test:offline` — node, no browser (includes sim.test.js full-season sim)
- `npm run test:browser` — puppeteer smokes (demo-night.smoke.js pins QF handicaps [40,22,11,0] — full Points gap)
- `npm run test:emu` — Firebase emulator rules/functions tests

## League glossary (the code speaks this language)

- **The Trough** — free-agent pool. **Waivers** — blind claims, bottom of table feeds first, run 10am London every Tue & Fri (Chairman can skip one run by exception)
- **The Window Draft** — snake draft over new PL arrivals after the transfer window shuts; leftovers spill into the Trough
- **The Chairman** — Ben (commissioner, managers[0]). **The Committee** — the league's voice in copy
- **Lobus** — declared big man; klaxon when he scores. **Palwin Ham Cup** — ledger #6
- **Points vs points** — capital-P Points = H2H table points (3 a win); lowercase = fantasy points scored. The table ranks on Points; overall points is the tiebreak

## House style

- Preserve the league's tone in ALL user-facing copy — dry, in-world, Committee-voiced. Read neighbouring strings before writing new ones
- Code comments cite who asked and when ("Marc, mock night: ...") — keep doing that
- Squad limits, playoff format etc. come from the rules PDF (canon); the Rules page in-app restates it
