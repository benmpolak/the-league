# The Chairman's Desk

Things only Ben can do. Deploys, decisions, and one rule change that is not
the Committee's to make alone.

Raised from Toby's sandbox testing session, 12 Aug 2026. Branch:
`claude/remove-league-table-icons-yqazwx`.

---

## 00. ~~THE SITE IS NOT PUBLISHING~~ — RESOLVED 13 Aug ~16:15, but read the
## last paragraph

**Resolved twice over, nothing for you to do.** The wedged deployment was
cleared with a failed-run re-run (`gh run rerun --failed` on the stuck
`pages build and deployment`), and after it promptly happened AGAIN the same
evening — Marc: "it messes up if you try to commit something at the same
time as fpl pushes info over" — the structural fix below was built rather
than recommended: Pages now deploys via `.github/workflows/pages.yml`
(Actions source, non-cancelling `concurrency: pages` group, chained off the
FPL refresh because bot commits never fire push workflows). Simultaneous
pushes now queue; the wedge mode no longer exists.

**Symptom (as found):** `main` is correct and CI is green, but the live site
has been serving the build from `b78447e` — one commit before the 15:50
merge. Two changes that look shipped are not on the site. Nobody is told: CI
passes, the beta mirror succeeds, and the site quietly stays on an old build.

**Cause.** Two pushes landed 70 seconds apart (`db055bc`, then `039930d`).
GitHub cancelled the first deploy and refused the second, and the first is now
wedged *server-side* — it still counts as in progress, so every deploy since
has been refused with the same error:

> Deployment request failed for `<sha>` due to in progress deployment.
> Please cancel `db055bcf930b88fab4668ddc82a7e5d0f9a8005e` first or wait for it
> to complete.

Three consecutive failures so far: `039930d`, `0bd1c2b`, and anything pushed
after them. This is not a code problem — nothing needs reverting.

**Unblock it (30 seconds, needs your access — the Claude integration is
refused with 403 on both re-run and cancel):** repo → **Environments** →
`github-pages` → the deployment showing *in progress* → **Cancel deployment**.
Then push anything, or re-run the last `pages build and deployment`. GitHub
does eventually time these out on its own, so it may also clear itself.

**Stop it recurring.** The deploy is GitHub's built-in *pages build and
deployment* — there is no workflow file for it in this repo, so it cannot be
given a concurrency group as it stands. The documented fix is to switch Pages
to the **GitHub Actions** source and add an explicit deploy workflow carrying:

```yaml
concurrency:
  group: pages
  cancel-in-progress: false   # queue behind a running deploy, never kill it
```

Worth doing rather than living with: this repo has a bot pushing every five
minutes plus two people committing, so pushes landing inside a minute of each
other is routine. Looking back through today alone, `c845ec2` and `e4424a1`
were cancelled the same way. Each time, the site silently stops updating.

---

## 01. Marc cannot get a sign-in link (13 Aug, live — a manager is locked out
## of one device)

**Symptom:** Marc signed out on his laptop to test the sign-in, asked for a
link, and none arrived. His phone is still signed in, so he is not locked out
of the league — but he cannot get back in anywhere else. He was also expecting
a passcode; there isn't one, it is a link.

**Most likely cause, and it hides itself.** `requestSignInLink` throttles at
**3 requests per 15 minutes** per address (and 10 per 24 hours):

```js
if (await overLimit('email', eh, [{ ms: 15 * 60e3, max: 3 },
                                  { ms: 24 * 3600e3, max: 10 }]))
  return finish('limited', ...);
```

Every outcome — sent, limited, unknown address, revoked membership, provider
failure — returns the byte-identical generic response, by design
(`EMAIL-FALLBACK-DESIGN.md`, enumeration resistance). So the app says "Link
sent to you@example.com" while the server has thrown the request away, and
each extra tap pushes the 15-minute window further out. Somebody who taps it
four times in frustration guarantees themselves a quarter of an hour of
silence with no way to tell.

**Only you can tell which it actually was.** Every call logs one line:

```
{"evt":"signin_link","out":"<sent|limited|suppressed|duplicate|provider_error>","eh":"<first 8 of sha256(email)>"}
```

Pull the `requestSignInLink` logs around the time he tried and read `out`:

- `limited` → the throttle. Nothing wrong; he waits 15 minutes and taps once.
- `provider_error` → mail delivery is genuinely broken. Check
  `GMAIL_APP_PASSWORD` and the `err` field on the log line. **This is the one
  that matters** — if it is failing for Marc it is failing for everyone, and
  the draft is close.
- `suppressed` → the address does not match a registered auth user, or that
  uid holds no membership in `the-league-2627`. Cross-check against
  `managers.local.json`; this is the same class of problem as §0 (Ric).
- `sent` → it left the server. Then it is spam filtering at his end; sender is
  `benmpolak@googlemail.com`.

**The copy fix, if you want it.** The generic server response should not
change. But the client can stop implying success it cannot vouch for — the
"Link sent to…" panel could add: *if nothing arrives in two minutes, wait a
quarter of an hour before asking again; repeated requests are throttled and
extra taps lengthen the wait*. Client-only, no deploy. Marc's AI can do it on
your nod — flagged here rather than done because you may want the wording.

---

## 0. ~~Ric's email~~ — RESOLVED 13 Aug, verified live; one instruction for Ric

**Live state (read-only admin probe, 13 Aug eve):** `ric.blank@gmail.com` is
provisioned as manager 7 in BOTH leagues; the old undotted account exists but
holds no membership and no private data — an empty orphan, harmless. Nothing
to migrate, nothing at risk, no provision run needed.

**The one thing that matters:** Ric has NEVER signed in, and he must type
**`ric.blank@gmail.com` — with the dot** — into the sign-in box. Gmail treats
both forms as one inbox, but Firebase matches exactly: the undotted form hits
the empty orphan, no membership, and the server (by design) returns the same
generic "link sent" while sending nothing. If Ric says "no email arrived",
the dot is the first thing to check.

The original triage, kept for reference:

**Asked (Marc, 13 Aug):** change `Ricblank@gmail.com` to `Ric.blank@gmail.com`.

**Check this first — it may need nothing.** Gmail ignores dots, so both forms
are the same inbox. Firebase does not: they are two different identities, and
`normaliseEmail` (`functions/index.js:1801`) only trims and lowercases. So if
Ric is registered as the undotted address, he can simply sign in with it and
nothing needs doing. Only change the registration if he is actually stuck —
the symptom is the "Who let you in?" card that survives every reload.

**If you do change it:** edit `managers.local.json` and re-run
`GOOGLE_APPLICATION_CREDENTIALS=service-account.json node scripts/provision_managers.js --live`.

**The cost, which is not obvious.** The script finds users by email
(`scripts/provision_managers.js:59`). The dotted address will not match Ric's
existing auth user, so it creates a **new uid** — and the prune step then
removes the old uid's private node (`:93`), which is where his **autolist and
any lodged waiver claims** live. Pre-draft that is his draft queue. Note it
down first and put it back after, or do the change at a moment when losing it
costs nothing. Membership and the managerUid map rebuild correctly; the old
auth user is left orphaned but harmless.

---

## 1. Clean sheets and the red card — a RULES change, needs the group

**What was asked (Toby/Marc, 12 Aug):** a player sent off should *lose* any
clean sheet, and should keep taking goals-conceded deductions as if he were
still on the pitch.

**What the app does today:** neither. The engine takes `cs` and `gc` per player
straight from the FPL feed and applies our table (`js/engine.js:296-301`).
FPL treats a dismissed player as off the pitch, so:

- sent off on 65 minutes, team never concedes → **he keeps the clean sheet**
  (pinned by `test/scoring.test.js:40`)
- goals conceded after the red are **not** charged to him

Both are the opposite of the request. Note `test/scoring.test.js:41` looks like
it covers the rule but does not — it hand-feeds `cs: 0, gc: 2` and its comment
assumes the feed already reports post-dismissal concessions against the player.
That assumption is load-bearing and probably wrong.

**What building it needs:**

- losing the clean sheet on a red is one line (`if (s.rc) cs60 = 0`)
- the continuing deduction needs the team's match total, which `data/fixtures.json`
  carries as `hs`/`as` — derivable for a player who *started* and was dismissed
- **open question for the group:** a substitute who comes on and is *then* sent
  off. The feed gives per-player totals, not timings, so goals conceded before
  he came on cannot be separated from goals conceded after his red. Charge him
  the full match total, or leave substitutes alone?

**Why it is yours:** it is a scoring rule. `MARC-ONBOARDING.md` has the rules
PDF as canon and scoring explicitly not up for reinterpretation in code. It
also lives in `js/engine.js`, shared verbatim with the server, so it needs a
deploy as well as a decision.

**Also unconfirmed:** whether FPL awards a clean sheet to a substitute who
comes on *after* his team has conceded and then plays 60+ minutes without
conceding again. Our scoring follows the feed either way, but nobody has
verified what the feed actually says. Worth checking against a real round.

---

## 2. Deploys waiting on you — ~~both~~ DONE (Ben's dev, 12–13 Aug)

| What | Status |
|---|---|
| Delisting a player you have transferred away | **DEPLOYED 12 Aug** with the rest of the transfers fixes. Works online. |
| Skipping a waiver run | **SHIPPED 12 Aug, different design.** The branch's `waiverMeta.override` timestamp was not merged: its override run id embeds an ISO timestamp whose `.` is an illegal RTDB key character, so the first held-over run would have wedged the hourly tick, and the change sat in `functions/` + the waiver engine, which `MARC-ONBOARDING.md` reserves. What shipped instead: Tue/Fri 10am clock plus a one-shot **Skip the next run** (`waiverMeta.skip`, new `waiverSkip` action) — the named run is marked done in the ledger, claims roll over, Trough stays shut until a real run. Live and deployed, first run Fri 14 Aug 10:00. |

---

## 3. Two decisions on the player feed

Toby's `#579 (unknown)` came from the app running on two different copies of
the player list. The page has been stopped from dying on it, but the drift is
still there and a stubbed player is still a hole in the record.

**a. Which site is the sandbox's source of truth?** `DATA_BASE` is hardcoded to
the main site (`functions/index.js:44`) regardless of sandbox, so a beta client
and the server are structurally never in sync. Either point the sandbox league
at the beta site, or make the beta mirror sync automatically so the two cannot
diverge. The second needs a token and a workflow — your territory.

**b. Should picks carry `code` alongside `id`?** FPL element ids are positional
and shift whenever the feed is rebuilt, which is every five minutes
(`.github/workflows/fpl.yml`). `code` is immutable and already trusted for the
last-season archive (`js/app.js:32`). Storing both would make a lost pick
recoverable instead of a permanent `#579 (unknown)`. It is a state-shape change
across picks, transfers, trades and claims plus a migration of live cloud data,
in the server-authoritative core — not a quiet test-week change.

---

## 4. Merge and mirror — DONE (13 Aug)

The four transfers fixes merged and deployed 12 Aug; the sandbox-identity and
go-to-real-site fixes cherry-picked to `main` 13 Aug (this commit), beta
mirrored. The branch's waiver-clock commit was superseded (see §2) — the
branch `claude/remove-league-table-icons-yqazwx` can be deleted.

**Still genuinely on the desk:** §1 (red-card scoring — needs a GROUP ruling,
then a build) and §3 (feed decisions — 3b `code` alongside `id` is the real
fix for `#579 (unknown)` and worth doing before the season starts).

---

## 5. The Podcunt Network (group chat, 16 Aug) — POST-DRAFT BUILD (Ben's call)

Two AI-generated weekly "podcunts", commissioned in chat, parked until after
draft night. The design is settled — do not re-litigate, just build:

- **Format**: transcript episodes generated deterministically from real league
  data (same philosophy as the Gazette — own hash, no shared RNG, every phone
  prints the same episode). NO server audio pipeline. The punchline is a
  ▶ Listen button using browser `speechSynthesis` — two naff robot voices,
  distinct pitch/rate per host, user-gesture gated (iOS-safe), free, offline.
- **Show 1**: *Gazette Football Weekly* — host Rax Mushden (Marc's name),
  liberal-lefty Guardian register, panel from GAZETTE_PRESS (Bilson on
  tactics, Liu on culture, Sid Lowry "in Spain").
- **Show 2**: *talkTROUGH* — drivetime with Keys & Grey (Ian's), talkSPORT
  outrage register: bench-waste fury, anti-analytics, "in my day".
- **Cadence**: ~5 minutes, "every Tuesday after waivers" — episodes key on the
  latest settled GW + waiver ledger, so they appear naturally post-run; no
  cron needed. Pilot episodes can run off Season Preview material.
- **Where**: a section in the Gazette reading room; new `js/podcast.js`, add
  to index.html AND sw.js precache (bump the shell cache version).

**Assigned to Marc (Ben, 16 Aug). For Marc's AI — read before writing code:**

- Read `CLAUDE.md` and `MARC-ONBOARDING.md` first. This is a CLIENT-ONLY
  build: nothing in `functions/`, `js/sync.js` or the waiver engine.
- Determinism is a hard contract: every phone must generate the identical
  transcript. Use gazette.js's `hash()` pattern with your own keys. NEVER
  call the shared RNG and never use `Date.now()`/`Math.random()` in content —
  `test/mockparity.smoke.js` pins RNG call order and will catch you.
- Hosts join `GAZETTE_PRESS` in `js/lore.js` (beat: `'pod'`): Rax Mushden,
  plus Keys & Grey for talkTROUGH. Bootleg names are canon — do not correct
  the spellings. Panel guests come from the existing press corps (Donathan
  Bilson, Yonni Liu, Sid Lowry).
- The Gazette's FORMAT IS SETTLED (Ben's rule): the pods are a new section in
  the reading room, they do not restructure the paper. Committee voice, house
  clichés per register — read `FOOTBALLESE` in gazette.js for the tone bar.
- `speechSynthesis`: start only from a tap (iOS), `cancel()` on overlay
  close, feature-detect and hide the button if absent. Distinct pitch/rate
  per host. The voices being naff is the joke — do not add an audio backend.
- `esc()` every dynamic string (team names are user-controlled).
- Before every push: `npm run check && npm run test:offline`, plus
  `node test/gazette.test.js` and `node test/mockparity.smoke.js`. Pushing
  main deploys the live site within minutes and the beta mirrors itself.

---

## 6. Post-draft housekeeping (from sol's 16 Aug launch verdict — GO/GO)

- **www TLS certificate (sol P2)**: the Pages cert covers only the apex
  (`gh api repos/benmpolak/the-league/pages` → https_certificate.domains =
  [theleaguehq.co.uk]; expires 11 Nov). `https://www.` serves a *.github.io
  cert and fails. Fix AFTER draft night (re-provisioning can flap the domain
  for minutes): re-save the custom domain — Settings → Pages → remove and
  re-add `theleaguehq.co.uk` (or `gh api -X PUT repos/benmpolak/the-league/pages
  -f cname=theleaguehq.co.uk`) — then confirm the new cert lists BOTH domains.
  Until then: share the apex URL only, never www.
- **Stale skip under manual control (sol P3, twice-flagged)**: harmless while
  waivers stay AUTO; if a code fix is ever wanted, spend the stale skip when
  control returns to auto. Runbook covers it meanwhile.
- **Coverage debt (sol P3)**: promote sol's targeted repros into the suite —
  (a) emulator: concurrent timewaste = exactly one success, +30s, second
  refused; (b) browser: Gazette.preview() retires once GW1 settles + hostile
  team/sponsor names escape in the preview registers.
