# Reliability pass

The September codebase audit reproduced two defects: unauthenticated reads of
pending waiver claims through recovery plans, and two simultaneous signings
leaving a manager with seven defenders. This change fixes both, preserves
waiver crash recovery, and makes website publication depend on passing tests.

## Changes

- `server/waiverRuns` is unreadable to every client, including signed-in
  managers and the commissioner. Admin SDK recovery and backups still work.
  This protects existing plans as soon as the v2 rules are deployed; no
  deletion of historical records is needed. Future claims are also excluded
  from newly written plans. The game uses public transfers and waiverMeta,
  not recovery plans, so its screens keep working.
- Free signings recheck the manager's resulting squad inside the transfer
  transaction. Two individually legal requests cannot together exceed the
  squad limits. Compatible moves still both succeed; their lineup cleanup
  removes both outgoing players without overwriting the other request.
- Pages requires a successful `Test game engine` run on main with both
  browser and emulator jobs successful. All tracked files must match that
  tested commit except the five generated FPL outputs. Those outputs are
  validated on every release; the browser feed must contain only its three
  JSON declarations and agree with the server JSON. This allows fresh scores
  to publish promptly without rerunning the entire season simulation.
- Untested code waits for the test-completion trigger. Failed checks stop
  publication; an older passing result cannot excuse a newer failed run of
  the same code. The candidate checkout remains fixed throughout deployment.
- CI runs `npm run test:emu`, including the live-update and browser email-link
  suites previously absent from CI. The new regression suite is included.
- Pages writes `release.json` with the site commit, tested commit, test run,
  source fingerprint and expected server-file hashes. These hashes describe
  what the release expects, not proof of the currently deployed server.

## Verification

`npm test` covers syntax, release gating, offline game rules, a complete season,
double gameweeks and browser/server engine parity. `npm run test:emu` covers
database access, mutations, the new regressions, live updates, migration,
backup/restore, provisioning and email-link sign-in.

The signing regression forces the precise stale-state interleaving through
the real database transaction, then checks eight concurrent callable pairs.
The privacy regression crashes a real waiver run after its plan is written,
checks denied reads, replays the plan and confirms future claims survive.
Rules tests also seed an old plan to protect historical data.

Local results: `npm test` and the complete `npm run test:emu` passed. The
new reliability suite passed 25 checks and the release-gate suite passed 19.
As a control, the unchanged reliability tests were run against the original
implementation (with only the emulator test hooks exposed): 13 checks failed,
including the deterministic stale-squad, lineup cleanup and private-plan
checks. Both workflow YAML files parsed successfully and the current FPL feed
passed release validation. The revised GitHub workflow has not yet run on
GitHub; that verification follows the approved merge.

## Production release order

These changes are prepared locally. Publishing the website alone does not
fix either server defect. After Ben approves the tested release:

1. Deploy `database.rules.v2.json` through `npm run deploy:cutover-rules`.
   This immediately closes the old recovery-log exposure. Do not deploy the
   staging or legacy rules to production.
2. Deploy Functions through `npm run deploy:functions`. The existing predeploy
   hook copies `js/engine.js` into the Functions bundle. Verify the deployed
   source files against the tested branch, including the copied engine.
3. Merge the branch to main. Its test workflow must pass before Pages can
   publish the updated website and release manifest.
4. Verify the published manifest and the normal public game screens. Recheck
   denied access to the recovery ledger without retrieving private claims.

GitHub branch protection is a separate repository setting and is not changed
by this branch. Recommended follow-up: require the browser and emulator
checks for human code merges while preserving the FPL bot's data refreshes.
The separate beta mirror remains a practice site; this gate governs the
production Pages workflow.

If a later code rollback is needed, retain the new private-ledger rules.
Reopening the recovery log is not a valid rollback. Existing plans remain
available to the server under the tighter rules.
