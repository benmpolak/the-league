# Cunthanger Media — release verdict

**NO-GO for the twelve real managers.**

**P0: none found. P1: two. P2: six.** The database delivery and identity protections work in the emulator, but the open feed does not show arriving messages, and a failed submission discards the manager's writing. The green suites do not exercise those user journeys.

## Scope and evidence

- Audited initially clean `main` at `8a627f6ad54e1a87b953397c295994649dcf39d6`. HEAD stayed unchanged throughout. All source line references are to that commit.
- After the focused browser probes completed, concurrent uncommitted edits appeared in `js/app.js` and `css/style.css`, adding a dedicated Media page. Their diff was inspected and left untouched. This verdict covers the committed release, not those pending changes; the disposable audit copy retains the original audited source.
- Read `CLAUDE.md`, then `docs/SOL-CUNTHANGER-BRIEF.md`. Reviewed `80628ea..HEAD` **and the feature merged by `80628ea`** (`80628ea^1..HEAD`); the requested exclusive range alone omits most of the feature.
- Public live `index.html`, `js/app.js`, `js/cunthanger.js`, `js/gazette.js`, `js/sync.js`, `css/style.css` and `sw.js` byte-match the checkout.
- Ran tests in `/private/tmp/cunthanger-audit`, with dependencies linked from the source checkout. Existing localhost servers were checked against the correct repository; 8125 served the app, and the emulator harness served its generated fixtures on IPv4 port 8126. No source implementation was edited, no production Firebase data was read or written, and no real manager was authenticated. Only this verdict file was added to the repository.
- Backend conclusions below concern the audited source running in local emulators. The deployed Cloud Functions source archive was not downloaded, so frontend parity is not a claim of deployed backend parity. Browser checks used separate disposable Chrome contexts; actual iOS hardware was not available.

## 1. Real-league sync and saves

**Verified:** `sync.js:155` listens to the complete public node. `SHARED_KEYS` includes both `posts` and `pressers`; `applySharedSnapshot` installs them and `save()` persists them locally. Two separately authenticated browser contexts received a server-created post and presser. A recipient's local save did not change or delete either server record. Concurrent posts from two different managers both survived the server transaction. An absent media key resets to its default instead of retaining deleted content.

### P1-1 — An open feed never repaints when posts or pressers arrive

**Where:** `js/app.js:4520` (`cunthangerSheet`), `js/app.js:4567` (send handler), `js/app.js:356` / `js/app.js:4871` (snapshot/render).

**Repro:** Manager 2 opens the feed. Manager 1 posts `CROSS_PHONE_POST_1`, then submits `CROSS_PHONE_PRESSER`. On manager 2's phone, both arrive in state; the post also reaches localStorage and the dashboard nudge. Neither appears in the open timeline. Closing and reopening the sheet reveals the post.

**Cause/impact:** The sheet is a one-time DOM snapshot appended to `body`; ordinary renders update `main`, not its timeline. The sender also closes/reopens the sheet immediately, before the callable's result and snapshot arrive, so their own successful post can appear missing. This breaks the primary live conversation surface even though database sync succeeds.

**Required change:** Refresh the mounted timeline on incoming snapshots while preserving compose text, focus and scroll; make a successful send visibly complete. Do not rebuild the whole editor on every snapshot.

### P1-2 — Failed sends discard typed text after announcing success

**Where:** `js/app.js:4335–4350`, `js/app.js:4398–4407`, `js/app.js:4565–4571`.

**Repro:** Enter `UNSAVED_MANAGER_WORDS` in the press room and make the callable reject. Click “End the press conference”. The room closes, the success toast is issued before the request settles, then the error toast arrives. No presser is stored and the answer is no longer recoverable from the UI. The feed composer follows the same early-close pattern.

**Cause/impact:** `sendPresser`/`sendPost` start `serverAct`, swallow its rejection and return no completion promise. Their callers dispose of the input immediately. A routine connection failure or rejected repeat submission loses the user's writing; a slower failure leaves the false success message visible longer.

**Required change:** Await confirmed success, disable repeat submission while pending, and retain the editor and its text on failure. Show success only after acceptance.

### P2-1 — The restore API rejects the new media fields

**Where:** `functions/index.js:2063–2072`, `functions/index.js:2133–2135`; client `sharedSnapshot` / `publishAll` at `js/app.js:289–306`.

**Repro:** Import a valid synthetic league as Chairman: HTTP 200. Add only `posts: []`: HTTP 400, `unknown key "posts"`. Independently add only `pressers: {}`: HTTP 400, `unknown key "pressers"`.

**Impact:** Media-bearing browser exports and empty-cloud republishing cannot pass this restore contract. These fields are now included in the client's shared state but absent from both server import allowlists. This is an additional incompatibility; it does not imply that every other pre-existing export key was already compatible. Normal local saves and realtime reads are unaffected; the separate administrative V2 backup/restore tooling is a different path.

**Required change:** Add validated, bounded media fields to the import contract and verify their export/import round trip.

## 2. Identity and press-room authority

**Verified:** Real-league `meId()` uses authenticated membership. An unsigned callable returned `UNAUTHENTICATED`; a spectator with manager ID `-1` returned `PERMISSION_DENIED`. A Chairman request containing `asManager: 2` and `managerId: 2` still wrote the presser under **the Chairman's ID 1**. It could not impersonate manager 2. Sequential replacement returned `ALREADY_EXISTS`; two concurrent submissions to the same presser slot produced exactly one success and one rejection. The client fallback to the first manager is confined to demo/nosync.

### P2-2 — Managers can submit “pre-match” predictions after the result

**Where:** `functions/index.js:1256–1277`; client availability gate at `js/app.js:4322–4332`.

**Repro:** With the emulator's GW1 already finished, submit `presser` with `gw: 0, phase: 'pre'`: HTTP 200. Submit `gw: 30, phase: 'post'` while that round is in the future: HTTP 200.

**Impact:** The server validates only season phase, a broad numeric GW range and the phase string. A manager cannot overwrite an existing conference, but can fill an unused historical slot after knowing the result. The receipts then describe those words as said “before the round”. The UI's availability restrictions are bypassable from the client.

**Required change:** Enforce the same real round, pairing, kickoff and final-result eligibility on the server. Reject retrospectively created pre-match records and premature post-match records.

**Handle note:** Posting authority stays attached to membership, not the handle. The handle check only reserves other managers' explicitly stored handles; it accepts a spoof journalist's name such as `MattLeTus`. Names and kits still distinguish the author. This is a naming limitation, not a demonstrated ability to post under another manager's ID.

## 3. Takeover alert, sign-in and PWA

**Verified:** A fresh signed-out season page showed the sign-in overlay and no alert. After choosing spectator mode, the alert appeared and `meId()` remained null. Acknowledging OK persisted the flag and suppressed it after reload. Demo/nosync/test suppression and the existing-overlay guard are present; the nosync runtime probe showed no alert. The real manifest starts at the app root; the service worker is network-first, so installed mode does not introduce a separate takeover implementation.

### P2-3 — Back dismisses the alert without recording it as seen

**Where:** `js/app.js:4577–4605`, shared `popstate` handler at `js/app.js:4694–4700`.

**Repro:** Open the takeover, press browser Back, reload. Back removes the overlay; the storage flag is still null; the alert reappears. OK followed by reload correctly suppresses it.

**Impact:** The stated once-per-device behaviour is only once-per-OK. Back navigation, including a mobile back gesture using this history entry, can cause repeat alerts.

**Required change:** Persist the seen/acknowledged state on every supported dismissal path, or deliberately constrain dismissal and define the intended behaviour.

**PWA coverage limit:** `sw.js` does not list `js/cunthanger.js` in its install-time shell; a controlled online fetch can cache it dynamically. Cold/offline upgrade coverage and actual iOS standalone gestures were not proven. This is not presented as a reproduced production outage.

## 4. Determinism

**Pass for content generation:** Repeated composition of identical events returned identical output. `cunthanger.js` uses seeded hashes for wording, reactions and engagement numbers; there is no content sampling through `Math.random()` or `Date.now()`.

**Qualification:** The complete event list still depends on clock windows and locally loaded football data. The explicit clock read filters recent news, transfers, posts and pressers; indirect `currentGwIndex()` / `gwHasStarted()` calls select the round and pre/live state. A boundary probe with the same state just before/after kickoff changed a fixture post from a pre-match threat to “Level with …”. Thus identical event input is deterministic; identical stored state alone, across different device clocks/window boundaries, is not a sufficient guarantee. No additional random-content defect was found.

## 5. Escaping of manager-typed text

**Pass in the tested paths.** Posts, presser answers, names and handles pass through `esc()` in the feed, press-room readback, paper, dashboard nudges and club-office value/placeholder attributes. Handle resolution additionally strips non-handle characters.

Injected `<img ... onerror>`, `<svg ... onload>`, quotes, apostrophes and ampersands into posts, answers and the handle. The feed/paper/nudge retained literal text, the office retained the literal input value, and none created the injected DOM elements. No XSS finding. A 280-character unbroken post also stayed within the mobile feed width.

## 6. The paper and its new sections

### P2-4 — Saved answers are paired with newly generated questions

**Where:** `js/app.js:4361–4373`, `js/app.js:4435–4447`.

**Repro:** In the real demo squad, the pre-match question was “Gonzalo on the bench again. What has he done?” Swap Gonzalo into the XI for N. Jackson and regenerate the same conference: it becomes “Gonzalo is back in the side. What's changed?” The saved answer remains unchanged. A controlled context change also changed question IDs from `opp, transfer, form` to `opp, form, squad`; the paper printed `ANSWER_TO_transfer` under the new pressure/form question.

**Impact:** Both readback and the paper recompute questions from mutable squad/news/transfer context and attach answers by array index, despite saving answer IDs. The historical transcript can misrepresent what a manager was answering. Matching IDs alone would still not preserve wording within one question type.

**Required change:** Persist the actual question wording with the accepted answer, or preserve the immutable question context and version. Render that historical pairing.

### P2-5 — “Lodged nothing” is inferred from no completed window transfer

**Where:** `js/gazette.js:1022–1050` (`managerInFocus`).

**Repro:** Render a qualifying winless manager with no completed `windowDraft` transfer. The story asserts that the manager “lodged nothing”. The function only examines completed public transfers, not submitted private window claims.

**Impact:** An unsuccessful, invalidated or exhausted bid list produces the same public ledger as no submission. The asserted fact is unsupported by the state available to this story. Likewise, an answer consisting only of “No comment.” is treated as no usable quote, then described as the manager not having faced the press.

**Required change:** Say that no window signing was completed; distinguish an absent conference from an attended conference with no substantive quote.

### P2-6 — The post-match bench question can never see a scoring substitute

**Where:** `js/app.js:4312–4318` (`presserCtx`).

**Repro:** Give benched Gonzalo a final-round score of 10 in the local fixture. `gwPlayerPoints` returns 10, but `presserCtx(1, round, 'post').benchBurn` remains null.

**Cause/impact:** `benchFor()` returns player objects. The loop treats each object as a player ID and looks it up in `PLAYER_BY_ID`, so every bench player is skipped. The supposedly fact-driven post-match questioning misses this supported story.

**Required change:** Read the returned player's ID and use the intended effective-bench definition.

**Other section checks:** Manager in Focus and Sack Race are guarded with `try/catch`; the Sack Race orders by wins, table Points, fantasy points and bench waste as stated. No exception occurred with canonical records in the browser runs. Contrary to the brief, `pressConferenceSection` and `pressReceipts` themselves have no `try/catch`. A deliberately malformed object-shaped `answers` value made `pressReceipts` throw `find is not a function`; no normal accepted presser action producing that malformed shape was demonstrated, so this is a robustness gap rather than an additional release finding.

## 7. Mobile at 390px

**Pass for the requested surfaces in Chrome.** Dashboard width 390px; media card 370px; feed and press-room inner widths 335px with no horizontal overflow. Inspected screenshots of the card, timeline and three-question press room. Long post wrapping also passed. No mobile-layout P0/P1/P2 found. Keyboard/installed-iOS behaviour remains outside this desktop browser evidence.

## 8. Render performance

**Cache check passed:** Instrumenting `Cunthanger.compose` found one build across `render()`, an extra `programmeCard()` call and opening the feed sheet. `_chCache` is reset at the start of a render and reused by the card/nudge/sheet.

With twelve clubs, 48 recent conferences and 40 recent posts, the generated feed contained 348 entries. Five uncached compositions took approximately 42–47ms; render plus the extra card call and sheet opening took approximately 184ms on this Mac. This is measured desktop cost, not a phone benchmark. No redundant-compose loop was found. The stale mounted sheet in P1-1 is a refresh omission, not a cache being rebuilt too often.

## Test results and reproduction files

| Check | Result |
| --- | --- |
| `npm run check` | PASS |
| `npm run test:offline` | PASS, including the full 33-round season/playoffs simulation, DGW checks and engine parity |
| Cunthanger engine/variety tests | 28 cumulative assertions, zero failures |
| `npm run test:emu` | PASS: rules 22; functions 367; live tick 33; migration passed; backup 23; provisioning 13; email-link 20; email-link client 14 |
| Additional `test/gazette.test.js` | 17 passed, zero failures |
| Focused browser/emulator audit | Reproduced the findings above; no normal-state page errors |

The first sandboxed offline attempt could not launch Chrome. The successful rerun used the required host execution access. No implementation change was needed to run either requested suite.

Local reproduction scripts are in `/private/tmp/cunthanger-audit/test/`: `cunthanger.audit.emu.js`, `cunthanger.audit.extra.js`, `cunthanger.audit.browser.js`, `cunthanger.audit.morebrowser.js`, `cunthanger.audit.finalprobes.js`. Emulator scripts use `test/testenv.js` and must run only under the local emulator configuration. Logs/results: `/private/tmp/cunthanger-offline.log`, `/private/tmp/cunthanger-emu-full.log`, `/private/tmp/cunthanger-emu-probes.json`, `/private/tmp/cunthanger-extra-results.json`, `/private/tmp/cunthanger-browser-results.json`, `/private/tmp/cunthanger-morebrowser.json`, `/private/tmp/cunthanger-finalprobes.json`, `/private/tmp/cunthanger-gazette.log`. Screenshots: `/private/tmp/cunthanger-card-detail-390.png`, `/private/tmp/cunthanger-feed-390.png`, `/private/tmp/cunthanger-press-390.png`. These temporary files are supporting evidence, not committed tests.

**Release gate:** Fix and rerun both P1 journeys before approving this feature for the twelve. Verify open-feed delivery in two signed-in sessions, retained drafts after failed sends, and confirmed-success feedback. No fixes were made in this audit.
