# Window waiver lifecycle

Prepared from Marc's 6 September request. Not deployed by this change alone.

## Confirmed fault

The live September snapshot was written at `2026-09-03T19:07:02.440Z`, so the
September run completed. Graham (EVE) and Samba (MCI) arrived in the feed later.
The old rule compared every subsequent feed against that snapshot indefinitely,
trapping them with no remaining September run to release them.

## Result

- A completed window stays closed. Later additions use the ordinary Trough and
  weekly waiver rules, including the usual closed-market and fresh-drop rules.
- The old Window Waiver tab disappears. A saved selection of that tab returns
  to the Trough.
- The shared engine owns the lifecycle used by both client and server.
- The hourly scheduler maintains the between-window player/club baseline.
  On 1 January (London midnight), that baseline freezes. The first January
  tick preserves it rather than absorbing new January arrivals.
- January's desk appears on 1 January even if the pen is empty. Blind lists use
  the existing private storage, with bottom-up table priority at execution.
- The existing two-round snake is retained as the working assumption. The
  February date is unconfirmed. Only the Chairman can set a future February
  date, after confirming the transfer window will have closed.
- Lists close at that date/time. The hourly scheduler executes on its next
  check, normally seven minutes past the hour. The manual fallback cannot
  execute January before that time. It shares the scheduled run's identifier,
  lease and recovery plan, preventing duplicate runs.
- Completion clears window lists, releases leftovers and closes the January
  pen. It does not consume normal waiver takes or change the weekly clock.

During an open window, a new feed ID is still the existing proxy for an
arrival. The Chairman's individual admission control remains available for
academy players or other late feed entries that were not transfers.

## Verification

- Syntax and the complete offline suite, including season simulation and
  client/server parity, passed.
- Existing holding-pen, window-list and rank-input browser checks passed.
- New lifecycle browser checks cover the September release, midnight January
  boundary, retained baseline, empty January desk, private-list controls,
  provisional order, undated run, completion and mobile width.
- Complete emulator suite passed. Additional January emulator checks cover
  scheduling permissions, date validation, claim cut-off, bottom-up contested
  allocation, manual/scheduled overlap, retry, privacy, closure and unchanged
  weekly waiver metadata.
- Production inspection was read-only. No live squads, claims or transfers
  were changed during development.

## Release

Both the Functions engine and the website must be released. Publish the
Functions first, then fast-forward the website branch after reconciling any
intervening main changes. Confirm the live shared snapshot still has zero
arrivals under the new rule, that Graham/Samba are available under normal
Trough rules, and that the old window tab is absent. Preserve all live game
state. January's actual February date remains unset.
