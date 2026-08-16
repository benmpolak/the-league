# SOL 5.6 — DRAFT-EVE CROSS-CHECK (16 Aug, late)

Ben's ask: "once all this is done can you do a sol cross check". This brief.
Audit the FULL delta since your last GO (freeze was declared at e28815b; you
re-verified at e82f889 and cb19f48+). The freeze was then broken twice on the
Chairman's explicit order, on draft eve. Your job: verify the draft-night
core is unregressed, and issue one final GO / NO-GO for tomorrow.

Checkout `main` at the commit Ben's message pins (must include the ceremony
statement step). Everything below is on main and LIVE at theleaguehq.co.uk.

## The delta, honestly labelled

1. **The Podcunt Network merged to main** (merge 75e2c03). Marc's build +
   Ben-side renders: `js/podcast.js` (new, ~900 lines), player + reading-room
   surface in `js/app.js`, `sw.js` precache additions, `css/style.css`,
   `audio/pod/**` (46 mp3s + cast.json + index.json), `scripts/render_pods.js`,
   `test/podcast.smoke.js`. Client-only by design — verify NOTHING in
   `functions/`, `js/sync.js`, or the waiver engine moved.
2. **Scrub bar** (ec9be48): timeline computed from recorded-line durations
   (`podEpTimeline`), seek during playback via a generation counter (`gen`),
   position interval, seek-before-play cold start. Attack it: seek/onended
   races double-advancing the walk; the old generation's `after()` timers;
   interval leak after close/stop; a part-recorded episode must NEVER show
   the bar; `podLineSrc` path traversal (was already guarded — confirm).
3. **Ceremony: "A CLUB STATEMENT" step** (this commit): one additive step
   before REPORT TO THE DRAFT ROOM + `new Audio('audio/buffer-out.mp3')`
   played on a user tap; missing file must be silent and harmless. Verify the
   ceremony CONTRACT is untouched: seen-key stamps at END only, key is
   order+draftPool.at, skip works, readiness reporting unchanged, and the
   step count change cannot wedge the clockStart barrier.
4. **The draft order was WRITTEN to the LIVE league** by
   `scripts/set_draft_order.js` (3ae012c) — public/managers reordered to the
   randomiser result (Toby first, Ben now index 4). Commissioner is
   role-based on the live league (app.js:222) — SWEEP for any surviving
   `managers[0]` / index-order assumption in draft-night paths (start,
   ceremony, clock, waiver order GW1 reverse-draft, engine parity). The sim
   drafts with a synthetic order, so it will NOT catch an index assumption
   that only bites when managers[0] isn't the commissioner.
5. **Docs/data only**: BEN-TODO draft-order pin + §7 (Toby's deadline-day
   package, parked), podcast renders and cast recasts.

## Known accepted risks (Chairman's calls, tonight)

- Freeze broken on draft eve, twice. That is WHY you are being run.
- Jamie O'Hara-Hara and Howard are voiced by clones made in Ben's dashboard;
  provenance of the Jamie clone was flagged to Ben and is his to own. Not a
  code question — out of scope for you beyond noting it.
- Scheduled pod renders (repo secret) deliberately NOT built until after
  draft night.

## The bar

Same as ever: findings by severity with repro, then one word — GO or NO-GO
for draft night. Anything you'd fix, fix nothing yourself: report. The suites
you can run: `npm run check`, `npm run test:offline`, `npm run test:browser`,
`TEST_BASE_URL=http://localhost:<port> node test/podcast.smoke.js`, emulator
suite if you need the functions parity check (nothing server-side changed —
prove it rather than trust it).
