# SOL 5.6 BRIEF — TEST-NIGHT ROUND 2 (9 Aug 2026): VERIFY THE GATE

Same rules of engagement as ever. Your round-1 verdict was GO (Toby's sandbox
week) / NO-GO (real-league draft night) with a named gate: make acting-as
sandbox-only end-to-end, scope the actGuard bypass, and you'd have accepted
roomOpen as-is (P3 was non-blocking hardening). All three findings are
addressed in commit d6761c0 (functions DEPLOYED, prod+beta Pages live), plus
one NEW feature to attack.

## The fixes to verify dead

- **P1** — `claimSet` now REFUSES `asManager` outside `the-league-sandbox`
  (failed-precondition, checked immediately after `actingManager()` resolves).
  Emu pins: real-league refusal for both roles, nothing written under the
  target's uid; the sandbox happy path re-pinned at the end of
  functions.test.js against the autodrafted board.
- **P2** — `#actAsSel` renders only when `SANDBOX && netOn() &&
  isCommissioner()`; `hubActor()` ignores `transfersView.as` unless SANDBOX;
  the `actGuard` skip now requires `SANDBOX && state.view === 'transfers' &&
  transfersView.as === mid`; and `render()` clears `transfersView.as` the
  moment the view is not 'transfers' (covers navigation, phase flips, resets —
  re-run your My-Team lineupSave repro and confirm the old confirm is back).
- **P3** — the roomOpen confirm sheet now lists the absent managers by name
  ("Marked present in absentia: …").

## NEW since round 1 — attack this

**Reset stash + restore** (Ben's ask: "preserve data for a bit even if we
reset everything"):

- `resetLeague` now snapshots the outgoing `public` + `private` trees to
  `server/resetStash` ({t, by, public, private}) in the SAME multi-path update
  that installs the canonical setup state. One stash held; the next reset
  overwrites it. Empty leagues stash nothing.
- New `ACTIONS.resetRestore`: Chairman-only. `{peek:true}` returns {t, by,
  phase} without writing. `{confirm:'RESTORE'}` puts BOTH trees back
  wholesale. The stash survives its own restore.
- Client: "Restore the pre-reset game" beside Reset on Settings (netOn +
  commissioner), peek → confirmSheet naming phase/time/who → typed-confirm
  action.

Attack surfaces: stash under `server/` must be invisible to every client read
path (rules); restore-over-a-live-game semantics (12 devices watching the
public node get a wholesale snapshot swap — does every client reconcile, does
anything cache draft/mock state across it); the restore racing a concurrent
mutate (no CAS on restore — argue whether one is needed or whether
Chairman-only + typed confirm suffices); membership/managerUid deliberately
NOT stashed or restored (verify a provision run between stash and restore
can't strand anything); backup/migrate/repair tooling meeting a multi-MB
`server/resetStash` key (backup schema check, manifest count comparison,
restore_league.js). Emu pins: 10 new checks (functions 286) — stash/peek/
restore round-trip incl. private claims, Chairman-only, typed confirm,
stash-survives-restore.

## The question

Re-answer both verdicts:
1. GO/NO-GO — Toby's solo sandbox week (now with skip-draft + stash/restore).
2. GO/NO-GO — the REAL league for draft night (~21 Aug): roomOpen + the
   P1/P2 gates as shipped + reset stash/restore live there too.
