# SOL 5.6 BRIEF — TEST NIGHT ROUND (9 Aug 2026)

You are sol 5.6, the adversarial reviewer for The League (same rules of
engagement as every prior brief: check out the repo read-only, run any suite,
attack the changes, report findings as P0/P1/P2/P3 with repros, end with a
one-word GO or NO-GO). Your last verdict was GO at the UAT-night round.

## Context

Ben is on holiday. Toby (second commissioner) must be able to run the ENTIRE
test loop solo on the sandbox: reset → draft alone → Simulation Chamber GW1 →
transfers/waivers acting as any manager → run waivers → Chamber GW2. One
commit ships this (693a06e on main, functions DEPLOYED, prod + beta Pages
live), plus aa1c0b7 (docs only). All suites green at ship: offline, browser,
emu (functions 272), plus a 12-check scratchpad smoke.

## The changes to attack (693a06e)

1. **Draft routing** (app.js): boot lands `view='draft'` in draft phase;
   `applySharedSnapshot` forces `view='draft'` on any device when phase flips
   INTO draft (`wasPhase` captured before the SHARED_KEYS copy); ceremony
   finish AND skip set `view='draft'` before render. This kills Toby's field
   bug (post-ceremony landed on the dashboard's GW1 matchup card).
2. **`draftAdmin` op `roomOpen`** (functions): commissioner-only (sits after
   the isCommish gate). ONE txn on the draft node: marks EVERY manager id in
   the order `ceremonyReady=true` and arms the first deadline (guards:
   pickTimer set, no deadline, not paused, no picks yet). Client: `#forceRoom`
   button on the ceremony-wait card (netOn + isCommissioner), confirmSheet'd.
3. **`claimSet` accepts `asManager`** (functions): routed through
   `actingManager()`; validates the claims against the TARGET's squad; when
   acting, resolves the target's uid via `uidForManager` and writes the claim
   list under the TARGET's `private/{uid}/claims/{gw}` node.
4. **Acting-as switcher** (app.js): `transfersView.as` + `hubActor()` —
   commissioner online gets a `#actAsSel` select in the Transfers hub header;
   the whole hub (squad card, trough sign, claims desk, trade desk) then acts
   as that manager. Existing `...(mid !== whoami && { asManager: mid })`
   spreads carry it server-side; `setClaims` gained the same spread.
   `actGuard` SKIPS its native override confirm when `transfersView.as ===
   mid` (the switcher is the standing confirm; a banner shows the whole time).
5. **Test Night runbook card** (app.js, sandbox Settings): Chairman-gated
   card with the 8-step loop, a jump button to Transfers, and a WhatsApp
   test-report template on the clipboard.

## Attack surfaces — what worries me most, in order

- **roomOpen on the REAL league.** It is deliberately not sandbox-gated (a
  real draft night with one manager's phone in a taxi is the stated second
  use). Attack: misclick blast radius on the real night — one confirm sheet
  between the Chairman and starting pick one with 4/12 in the room. Is that
  enough friction? Should it name the absent managers in the confirm? Also:
  the txn races — roomOpen vs a concurrent undo/seal/clockStart (all txns on
  the same draft node — verify serialisation holds and none of the r5/r6
  invariants regress; run the 80-race repro if you doubt it).
- **claimSet asManager REPLACES the target's claim list wholesale.** On the
  real league a Chairman lodging "for" a manager overwrites that manager's
  own blind claims — silently, since claims are private and the victim's
  device will echo the new list. Legitimate commissioner power or a P1
  needing a sandbox gate / merge semantics / an audit trail? Argue it.
- **actGuard skip scope.** The skip fires whenever `transfersView.as === mid`,
  but actGuard guards MORE than the transfers hub (lineups, club office,
  window draft). Repro to try: set the switcher to manager X, navigate to My
  Team, view X's team, edit X's lineup — does the old confirm still fire, or
  did the switcher silently widen into a full pen? Decide if that's intended
  ("holding the pen") or a P2 (skip should test the calling surface).
- **Routing forcing.** `applySharedSnapshot` now writes `state.view` on a
  phase flip: attack hash deep-links, the demo (`enterDemo` seeds its own
  state), the setup→draft flip landing mid-overlay (club office open, player
  card open — ovDepth machinery), and a stale device rejoining mid-draft.
- **hubActor validity.** `transfersView.as` survives re-renders; does it
  survive sign-out, identity switch, league reset, phase change? A stale
  `.as` pointing at a manager id that no longer exists must fall back to
  whoami (there is a roster `.some` guard — verify it covers reset-to-setup).
- **The runbook card** is Chairman-gated by `!netOn() || isCommissioner()` —
  same gate as the Chamber. Confirm nothing in it (template, jump) leaks
  anything or renders for spectators online.

## Honesty notes (audit these, don't trust them)

- Emu coverage added: roomOpen chairman-only + arms (5 checks inside the
  existing sandbox draft flow — note it OPENS the room before the existing
  ceremonyReady sequence, which weakens what that older test asserts; judge
  whether it still tests what its name claims). asManager: commissioner-only,
  target-squad validation, target-uid landing, residue cleared.
- The scratchpad smoke (testnight_smoke.js pattern) runs `?sandbox&nosync` at
  390px: card renders, template copies, jump works, select absent locally,
  net-only gates asserted STRUCTURALLY (regex on source). There is NO
  automated net-mode test of the switcher actually acting-as against the
  emulator — the server side is emu-covered, the client wiring is manual +
  structural only. If you can build the emulator-backed client repro, do.
- Routing changes have no dedicated automated test; sim + browser suites
  passed around them.

## The question

GO/NO-GO on two things separately:
1. Toby's solo sandbox week starting now.
2. These tools being live on the REAL league for draft night (~21 Aug).

If NO-GO on (2) only, say what gate (sandbox-only flag, confirm copy, audit
trail) buys the GO.
