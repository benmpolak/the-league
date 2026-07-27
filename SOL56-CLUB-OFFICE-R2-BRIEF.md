# Sol 5.6 — Club Office round 2: verify the fixes, re-answer the founder question

Your club-office audit came back NO-GO: 2 blockers, 2 P1s, 4 P2s, 3 P3s.
All are claimed fixed in this round. Your job: try to break the fixes, then
give a one-word GO/NO-GO for inviting the twelve founders into the office.

## What was fixed, and where

**P0.1 — empty league refuses setup actions.** `ensureSetupState()` in
functions/index.js: setup actions (`clubSet`, `readySet`, `stadiumSet`, and
`draftAdmin op:start`) seed the canonical setup state when `/public` is
absent, via a txn that only writes when the node is truly null. Attack it:
concurrent first-arrivals, seed-vs-import races, whether any OTHER action
still needs seeding, whether seeding can ever clobber a live league.

**P0.2 — importState rejected club fields.** The manager-key whitelist now
carries `kit / sponsor / rival / gaffer / boards`, validated by the same
cleaners clubSet uses; rival must reference a roster id and not self. Attack:
malformed club fields through import, oversized boards arrays, rival forward
references, whether the cleaners mutate-and-pass anything they shouldn't.

**P1.1 — the reorder race.** Two changes:
1. `clubSet`/`stadiumSet` write through `managerMerge()` — ONE txn on the
   managers node resolving the manager BY ID at commit time; aborts if the
   id vanished.
2. **Draft start no longer imports the whole state.** `draftAdmin op:start`
   takes an optional `setup` payload (managers: id/name/team only;
   settings section) and merges it INSIDE the same public-node txn that
   flips the phase, checks the order permutation against COMMITTED managers,
   stamps the pool, and clears `ready`. Club identity fields are rejected
   from the payload. The client (js/app.js startDraft) now makes one call.
   Attack: start racing clubSet, start racing undo/reset, payload smuggling,
   settings that survive/vanish across start (lobusBonus must survive),
   double-start, start on a cold league.

**P1.2 — dead Sign in on the waiting room.** render() now calls
renderIdentity() on the early-return setup branch. Browser check added in
authui.smoke.js (12 checks).

**P2.1 — failed saves closed the office.** clubSave awaits the server;
rejection keeps the form open with everything typed; the founded flag and
close happen only on success (or on the offline/local path).

**P2.2 — catalogue bounds.** `GAFFER_COUNT`/`BOARD_COUNT` in functions are
pinned to js/lore.js lengths by a functions.test check that parses both
files. Client filters stale board indices and out-of-range gaffers out of
the editor draft so an untouched save can't fail.

**P2.3 — setup hash routing.** Setup tabs push `#club/#rules/#settings`,
the waiting room is `#home`; popstate walks them; boot maps unknown hashes
to the room.

**P2.4 — staging rules.** Legacy `$league` write rule now requires
`data.exists()` — no anonymous creation of new legacy leagues; existing
legacy leagues keep working; wipe protection kept. Cutover deploy remains
the runbook step after your GO.

**P3.** Club office: extras (hoardings/gaffer/rival) behind a `<details>`
drawer, sticky Save/Cancel bar, `role=dialog` + focus in/out. My Team:
`.draft-layout > * { min-width: 0 }` + squad rows ellipsize ≤700px.

## New tests you should audit for honesty

- functions.test.js: cold-league block (seed + idempotence), catalogue
  parity, export→import round-trip with club fields, import rejections
  (junk key / out-of-catalogue gaffer / phantom rival), clubSet vs
  reordering-import raced 10x (wrong-manager must be 0), atomic start block
  (payload smuggling rejected, screen edits merged, just-founded club
  survives, ready cleared).
- authui.smoke.js: setup waiting-room Sign in summons the overlay.

Suites at this commit: check + offline (sim 63, dgw, feed, waiverclock,
engine parity, noeval), browser (authui 12, offline-ux 16), emulator
(rules 21, functions 205, migrate, backup 21, provision 13, emaillink 18).
All green. `npm run test:emu` needs `PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`.

## Also in this round (not from your audit)

- New app icon (icons/icon-{192,512}.png): gold jersey, navy pitch,
  wordmark — Lee's request. No manifest changes; filenames unchanged.

## The question

Same as last time: is the club office safe to open to the twelve founders
on the LIVE league — empty `/public`, memberships provisioned, staging
rules deployed — before the Chairman has pressed anything? Repro your
original findings against this build; anything that still reproduces is a
blocker. One word at the end: GO or NO-GO.
