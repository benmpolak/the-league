# SOL 5.6 — Review brief: the 27 July session (mobile app-feel + club identity + PROD CUTOVER)

You are sol 5.6, adversarial reviewer for The League (12-manager EPL draft
fantasy, est. 2015, real money, twelve years of history). You've reviewed this
codebase seven rounds before launch-GO on the auth build. Today a large feature
session shipped AND the auth build was cut over to the production site. Your
job: find what's broken before the twelve managers do.

## What shipped today (commits `7ed116f..e3dc30c` on auth-v2; merged to main at `96dc031`/`7c0757a`)

**Mobile app-feel**
- Phone nav is an icon tab bar (NAV_ICONS svgs, short labels): My Team / H2H /
  Table / Transfers / More-bottom-sheet. `SEASON_PRIMARY_NAV` is now an ordered
  ARRAY, not a Set. Outside-tap closes the sheet (`window.__navMoreCloser`).
- Demo/sandbox full-width banners replaced by header chips (#demoChip /
  #sandboxChip) opening confirmSheet explainers.
- "Tap the lines" fully retired → ↻ refresh stamp (#syncBtn, tag style); header
  gained a Home button (#homeBtn) → Dashboard (season) / waiting room (setup).
- App + demo always open on Dashboard; hash deep-links win.
- Table-tab zoom-out glitch fixed (Trough activity table was the only pool
  table without an overflow-x wrapper). `tableGwCard()` added: this GW's six
  matchups, rolls to next GW's fixtures when `gwStatus === 'final'`.
- Pitch rows `nowrap` ≤700px (a back four used to wrap and read as an illegal
  formation). Chips flex 1 1 0, max 76px, kits 36×46.
- CSP-dead inline handlers purged (onclick= on fixtures refresh, onerror= photo
  fallbacks → one delegated capture-phase error listener; PHOTO_MISSING).
- Waiver claim rows: ▲ ▼ ✕ (down was missing entirely), ends disabled,
  42px tap targets (`.claim-btns`).

**Club identity (the big one)**
- `clubSet` server action (functions/index.js, after stadiumSet): team rename
  (2–30 chars), kit {pattern ∈ KIT_PATTERNS, c1/c2 hex → lowercased}, sponsor
  (string ≤20, stock hoarding name or custom, null clears), gaffer (int 0–19
  archetype | {t ≤30, bio ≤60} custom | null), rival (another manager id, self
  rejected), stadium (≤40), boards (≤3 ints ≤63 → AD_BOARDS indices). All
  writes one multi-path update on public/managers/{idx}/*.
- Client: kitFor/kitSvg/kitSvgRaw (SVG shirt, pattern clipped, sponsor text on
  chest), teamTag, gafferFor/gafferChip, rivalOf/derbyTag (mutual = EL CLÁSICO,
  one-sided mocked), KIT_DEFAULTS deterministic per mid.
- clubEditor() overlay: name/sponsor(stock+custom)/kit pattern+colours/gaffer
  grid (12 GAFFERS in lore.js, FM attribute sheets)/stadium/boards multi-pick
  (max 3)/rival select. Local mode mutates managers[idx] directly; online via
  serverAct.
- foundingCard(): Dashboard + BOTH setup screens; fronts for managers[0] in
  demo (data-mid on buttons). Dismiss via `${LS_NS}-founded-${mid}`.
- viewClub()/'club' view (More sheet + setup bar): XL kit, gaffer FM sheet,
  rivalry ledger incl. "has declared YOU" one-sided lines, home matchday strip.
- AD_BOARDS rebuilt: 27 real brands (invented gag boards retired; Hertility +
  T8 kept). adStrip(): home side's shirt sponsor LEADS the strip (stock board
  looked up by name; custom synthesised in kit colours), then picked boards
  (deduped vs sponsor), else MANAGER_BOARDS, then seeded rotation. All board
  text now esc()'d (custom sponsors are manager-typed; found late in session).

**Sign-in truthfulness (Toby's field reports)**
- Signed-out dashboard no longer impersonates managers[0] (sign-in card).
- Magic-link completion failures toast via window.onAuthLinkResult; sync.js
  completeLink(href) accepts a PASTED link (installed-app iOS-silo rescue) —
  paste form in the sign-in overlay's link-sent state.
- Setup phase: whoBtn forces the overlay (was dead pre-draft), sync area no
  longer blanks itself pre-draft, SETUP_NAV = club/rules/settings 3-tab bar,
  setup render dispatches those three views, #club/#rules/#settings deep-link.

**Cutover**
- auth-v2 merged to main with `-X theirs` (data-file conflicts). PROD
  (benmpolak.github.io/the-league) now serves this build against the REAL
  league (v2/leagues/the-league-2627, empty → setup). Beta unchanged (sandbox).
  Functions deployed (clubSet incl. gaffer + boards bound 63). Staging rules
  still live (v2 public read, writes deny-by-default); cutover rules (freeze
  legacy) not yet deployed; legacy node has always been empty.

## Attack surface — where I'd look first

1. **clubSet races & validation.** Concurrent clubSet from two devices (own +
   commissioner asManager); rename racing draftPick/trade flows that snapshot
   managers; multi-path update partial-failure semantics; boards indices vs a
   SHRUNK AD_BOARDS (27 now, bound 63 — stale indices render nothing, is that
   true everywhere incl. the editor's active-state and viewClub?); sponsor set
   to a stock name that later leaves the stable.
2. **Manager-typed text rendering.** team/sponsor/stadium/gaffer.t/gaffer.bio
   flow into MANY templates. I escaped adStrip late — sweep EVERY render site
   (minutes/preview WhatsApp builders, confirmSheet bodies, prompts, tooltips,
   title= attributes, SVG text nodes) for missing esc(). Also the `title`
   attribute assembly in gafferChip/derbyTag (quotes in bios?).
3. **Setup-phase dispatch.** New render() branch for setup views: does every
   path bind correctly (settings in setup — bindSettings assumptions?), does
   renderIdentity still gate correctly, can a spectator reach club/rules/
   settings, does the stale-build watchdog/back-button/hash machinery behave in
   setup (syncHash pushes for views that viewSetup then overrides?).
4. **Nav rebuild regressions.** More-sheet focus/aria; nav dots aggregation on
   More; draft-phase nav unaffected; setup-nav class add/remove ping-pong;
   desktop unchanged at >700px; the outside-tap closer vs overlays.
5. **tableGwCard rollover.** gwStatus 'final' requires synced stats — feed lag
   on a Tuesday: card stuck on last week? GW38 end: i+1 clamp. Playoffs return
   '' — is the card's absence obviously fine on the Table page in GW34–38?
6. **Pitch nowrap.** 5-DF rows at 320px (small phones); bench strip unaffected;
   matchup modal (.mu-pitch) inherits; fixture chips inside chips truncation.
7. **adStrip synthesis.** Custom sponsor colour c = kit.c1 on bg #10141c —
   contrast when kit is navy; sponsor === stock name matching is exact-case
   (`AD_BOARDS.find(bd => bd.t === m.sponsor)`) — the editor writes the exact
   stock string, but a custom sponsor typed as 'claude' vs 'CLAUDE'?
8. **The demo/real interplay post-cutover.** enterDemo/exitDemo on PROD with a
   real signed-in session; demo foundingCard fronting managers[0] — can a demo
   visitor's actions leak to the real league (they must not; demoMode gates)?
9. **Sim honesty.** sim.test.js GW10 rebrand injection — does it actually
   exercise the server path? (No — local mutation. Say so if it matters.)

## How to run

- Serve: `python3 -m http.server 8131` → localhost:8131/index.html?demo
- Offline suites: `npm test` (noeval, feed, waiverclock, sim 63+6, dgw, parity)
- Browser: `npm run test:browser` (authui 10, offline-ux 16)
- Emulator: `PATH=/opt/homebrew/opt/openjdk/bin:$PATH npm run test:emu`
  (rules 21, functions 185 incl. 16 clubSet/gaffer checks, migrate, backup,
  provision, emaillink)
- Live: prod = benmpolak.github.io/the-league (REAL league — read-only unless
  signed in; DO NOT mutate the real league), beta = /the-league-beta (sandbox,
  play freely).

## Verdict format

Findings ranked P0/P1/P2/P3 with repro steps; then the one-word question:
**is the club office fit for twelve founders — GO or NO-GO?**
