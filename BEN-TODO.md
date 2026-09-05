# The Chairman's Desk

Things only Ben can do. Deploys, decisions, and one rule change that is not
the Committee's to make alone.

Raised from Toby's sandbox testing session, 12 Aug 2026. Branch:
`claude/remove-league-table-icons-yqazwx`.

---

## 07b. THE WINDOW DRAFT BECOMES A WAIVER — Thu 3 Sept 20:00 (30 Aug)

### ⚠ THE RUN TIME MOVED TO 20:00 — AND IT NEEDS YOUR DEPLOY TO TAKE EFFECT

Marc, 2 Sept 2026: *"can we delay the window waiver until 8pm tomorrow rather
than 10am as currently scheduled."*

`WINDOW_WAIVER_AT` is now `2026-09-03T19:00:00Z` — 20:00 London, BST — in
**both** `js/app.js` and `functions/index.js`. `waiverTick` runs at 7 past the
hour, so the run lands at **20:07 London**. The slot id is unchanged
(`window-2026-09-03`), so exactly-once still holds.

**Only the server's copy fires the run, and the deployed server still says
10:00.** So until you deploy:

- the app shows everyone 20:00 and keeps the desk open all day, but
- **the run goes at 10:07 tomorrow morning anyway**, off everyone's lodged
  lists, hours before the card says it will.

That is worse than not having moved it at all — a manager who reads the card,
plans to finish his list over lunch and finds it already run has been actively
misled by us. **If you cannot deploy before 10:00, tell Marc and I will put the
client back to 10:00 so the two agree.** Either hour is fine; disagreeing is
not.

`test/windowwaiver.test.js` now reads the constant out of both files and fails
if they differ — the drift above is the only way this goes wrong, and nothing
else was watching for it. Verified with teeth: reverting the server copy alone
turns it red.


**A rules change, and it supersedes Toby's ask in §7.** Marc, 30 Aug: *"we
would like to do the window draft as a waiver where everyone does a waiver list
rather than a draft where everyone needs to be online. we want the waiver to be
a one off waiver, that takes place on Thursday at 10am, only including players
in the holding pen. the order is the reverse of the draft, with duckett first
and toby last. there will be two rounds only and it will be a snake draft. so
toby has picks 12 and 13, duckett has 1 and 24. this will not impact the waiver
order or scheduling of the regular friday waiver."*

§7 records Toby wanting it armed for **Wed 2 Sept 20:00 as a live draft**.
Marc's version replaces that outright — confirmed with him: Thu 3 Sept, and the
live draft console retires rather than staying as a fallback. Flagging it
because §1 sets the precedent that rules changes are the group's, and Toby
should not find his request quietly overwritten.

Also settled with Marc: a manager who lodges no list, or whose list is dead by
the time his slot comes round, **signs nobody** — the slot passes, exactly like
a normal waiver. And each line on the list is a `{in, out}` pair, the same
shape ordinary claims already use, because two signings means two men leaving a
fourteen-man squad.

### What is built and green

`resolveWindowWaiver(state, runStart, rounds)` in **js/engine.js**, exported
alongside `windowSnake`, `penIds` and `WINDOW_ROUNDS`. Pure: mutates nothing,
returns `{records, executed, strippedLineups, tgw, slots}` in the same shape
`resolveWaivers` already returns, so the caller applies it the same way.

`test/windowwaiver.test.js`, 28 checks, wired into `test:offline`. The two that
matter:

- **The snake is pinned by name and by arithmetic.** Toby holds picks 12 and
  13, Ducky 1 and 24, everyone gets exactly two, 24 slots over two rounds.
- **Friday is untouched, and the check has teeth.** The waiver order is
  byte-identical after a window run, AND a control proves a genuine waiver take
  *does* move it — so the first assertion is not passing vacuously.

That second one is free rather than clever: `takesQueue` counts only
`t.waiver`, and these records carry `windowDraft: true` instead. Marc's "will
not impact the waiver order" holds by construction.

**Done 31 Aug (Ben's desk):** all four numbered items below shipped and
deployed. `windowClaimSet` (private per-uid lists, validated at the desk),
`windowWaiverRun` + the one-off `window-2026-09-03` slot on the hourly tick
(exactly-once via the run ledger, 14-day tail, `waiverMeta` never touched),
leftovers to the Trough in the same commit. Twelve emulator checks in
`functions.test.js` pin the lot — reverse order, cover lines, privacy rules,
the unmoved Friday clock, replay-safety. Marc's UI can point at it now.

### What still needs you

1. **A server action to lodge a list.** Claims live per-uid and private, merged
   server-side, exactly as ordinary claims do — a blind list that any client
   could read is not blind. New node `windowClaims/{uid}`, an ordered array of
   `{in, out}`. The engine reads `state.windowClaims[mid]`.
2. **The run itself.** One-off, Thu 3 Sept 20:00 London (was 10:00). `waiverTick` already
   owns the due-check pattern; this wants a one-shot slot beside it that fires
   once and marks itself spent, and must NOT stamp `waiverMeta.lastRun` or the
   Friday clock moves.
3. **Leftovers to the Trough** when it finishes, which is what `wdFinish`
   already does — refresh the draft-pool snapshot so the pen empties.
4. **Deploy**, then retire `ACTIONS.windowDraft`'s `start`/`pick`/`pass` ops
   and the live console in `viewTransfers`. `admit` stays: it is the Osman
   escape hatch from §04 and has nothing to do with the draft.

### Still to build client-side (Marc's AI, not you)

The list-lodging UI. Nobody can enter a list yet, so this is not usable by
anyone until both halves exist. Flagged here so the two do not get deployed out
of step: **the server action should land before or with the UI**, never after,
or managers will type lists into a screen that quietly drops them.

**Done 31 Aug:** lodging works and holds. The list is read back off
`private/{uid}/windowClaims`, the public snapshot no longer wipes it, and a
list the desk refuses rolls back instead of sitting on screen looking lodged.

### ~~A deploy: the waiver-claim cap goes 30 → 100~~ — DEPLOYED 2 Sept

*(commit `2a86daf`, 31 Aug. Functions deployed by Ben 2 Sept ~13:00 London; cap is 100 live.)*

Marc, 31 Aug 2026: "why does there need to be a limit at all? can we make it
100? it needs to be far bigger than anyone could use."

There has to be a limit — the server writes what the caller sends straight into
the league, and without a ceiling one request can push an arbitrarily large
array into the database. But 30 was a round number picked on 8 Aug on the
assumption nobody would go near it, and **Ian's list was 30 deep by 25 August**.
A guard a real manager walks into in the second week of the season is not a
guard, it is a rule nobody agreed to.

`functions/index.js` now has one `MAX_CLAIMS = 100` and three readers:
`claimSet`, `windowClaimSet`, and the claims-bucket check on the restore path.
That third one matters — leave it at 30 while the other two go to 100 and a
backup taken with a long list cannot be put back.

**This is inert until you deploy.** Pushing to main publishes the site, not the
functions, and there is no cap on the client, so nothing changes for anyone
until `firebase deploy`. `test/functions.test.js` pins both halves — 101 is
refused, 40 is accepted where the old cap refused it. **I could not run
`npm run test:emu` to see it pass**: the emulator will not start in the dev
sandbox (it cannot fetch its rules runtime through the egress proxy — the error
is a "request blocked" body where JSON should be, not anything in
`database.rules.v2.json`, which parses). So this is reviewed and syntax-checked,
not executed. Please run the emulator suite before you deploy it.

### ~~One button only you can press~~ — DONE, and thank you

Cozier-Duberry is out of the pen, and Cairns with him. Neither is owned by
anybody, so the only thing that can have moved them is your **→ Trough**
button. Confirmed off the 06:23 status read on 2 Sept.

Worth another look down the list before the run: "new to the game" covers both
a genuine signing from abroad and a man who was at the club all along and only
just got an FPL entry. The rule cannot tell those apart and never will, so that
group is where any remaining wrongly-penned man is.

### The escape hatch cannot release a man who MOVED — and six just did

*(Fixed on main 2 Sept, commit `da1a0e7` — the one-line guard below, as written. Emulator suite run on Ben's machine: 480 passed, 0 failed. DEPLOYED 2 Sept ~13:00 London alongside the cap — the button releases movers now.)*

**Found 2 Sept, and it matters before 10:00 tomorrow.** `windowDraft {op:'admit'}`
still guards on the OLD arrival rule:

```js
// functions/index.js, ACTIONS.windowDraft, op === 'admit'
if (pool.ids[pid] !== undefined) {
  throw new HttpsError('failed-precondition', `${p.name} was on the game at draft night — he was never in the pen`);
}
```

That was right when an arrival meant "an id draft night never saw". Since
30 Aug an arrival is "a man the snapshot does not have AT HIS CURRENT CLUB",
which pens **movers** too — and a mover's id IS in the snapshot, at his old
club. So the button refuses precisely the men the new rule pens. The comment
above it still describes the old rule; it was not updated with the change, and
this is the cost.

Live consequence: Tosin, Danso, Mudryk, Enzo Fernández, Ndiaye and Grealish
were all corrected into the feed today and are all movers. If any one of them
turns out to be wrongly penned — a loan you would rather did not count, or a
club I have got wrong — **you cannot free him.** The Chairman has no lever, and
neither does anyone else.

The guard should ask whether the snapshot already has him where he now plays,
which is the real "nothing to admit" case:

```js
if (pool.ids[pid] === p.club) {
  throw new HttpsError('failed-precondition', `${p.name} is already at ${p.club} in the draft-night snapshot — he was never in the pen`);
}
```

One line, same file, needs a deploy. Deliberately not committed: it is server
code, you deploy it, and you should read it rather than find it in a diff.

### A stale transfer listing survives the transfer (small, no rush)

Marc, 5 Sept 2026: J.King showed "transfer-listed" beside his NEW owner. He
had been listed, released, then signed by somebody else, and the old owner's
`tradeBlock` entry outlived the ownership.

Fixed on the client the same day — a listing now counts only while the manager
who made it still holds the player, so nothing displays wrongly and no deploy
was needed. **This is only a display fix.** The dead rows are still in
`public/tradeBlock` under the old owners.

Harmless today. The one case it could bite: if an original owner ever re-signs
a man he had listed before releasing him, the old entry wakes up and he is
listed again without anyone touching it.

The tidy fix is to drop the pid from every manager's `tradeBlock` whenever a
transfer moves him — one line wherever transfers are applied, alongside the
lineup-stripping that already happens there. Worth doing next time you are in
`functions/index.js`; not worth a deploy of its own.

### Engine parity is unreliable, and it guards the waiver order

**What it is:** the game law is written twice — `js/engine.js` for the client,
the same copy on the server — and `test/engine.parity.test.js` is the tripwire
that catches them drifting. If they drift you get the worst class of bug: the
app offers something the server refuses, or the screen shows one waiver order
and the run uses another.

**What happened:** it went red on 2 Sept on `season: roster/lineup/scoring
parity`, and the diff named `waiverOrder` and `standingsBefore` at gameweeks 1,
3 and 5 — the two functions that decide who wins a contested claim. It has
since gone green, three runs out of three, with nothing changed that should
have fixed it.

**Why green is not reassuring here.** The waiver half of the suite skips itself
when the demo pool happens not to offer a free agent all three test managers
could legally sign — and it reports that skip as a PASS:

```js
if (waiv.skip) chk('waivers: (skipped — no suitable free agent in demo pool)', true);
```

Eight checks ran when it failed. Six run now. So three waiver-parity checks are
currently not running at all, and the suite says green either way. A skip that
counts as a pass is not a tripwire.

**Two things worth doing,** neither of them yours unless you want them:
a skipped branch should report as a SKIP, not a PASS, so the coverage is
visible; and the 2 Sept failure needs diagnosing properly rather than being
allowed to lapse — that suite has cried wolf twice this week on wall-calendar
drift (28 Aug, 1 Sept), which is exactly how a real divergence gets waved
through. **There is a waiver on Friday.** Marc has been told; say the word and
I will take it.

---

## 06. GITHUB'S SCHEDULER HAS STOPPED — move the FPL fetch to a Cloud Function (28 Aug)

**Done 29 Aug (commit 196cd56):** `feedTick` Cloud Function, every 5 min on
Cloud Scheduler, fires `repository_dispatch` → `fpl.yml` (every tick inside a
match window, on the hour/half hour otherwise) and → `backup.yml` hourly. The
`repository_dispatch` option, not RTDB: git stays the feed's home, one small
function, no client change. Needs the `GH_DISPATCH_TOKEN` secret. Same deploy
fixed the full-time regression (liveTick no longer deletes the overlay at the
whistle; client no longer drops it on age). `fpl.yml`/`live.yml` crons left
in place as harmless extras; retire once feedTick has a clean week.

**One fault, and almost everything that went wrong this week came off it.**

`fpl.yml` asks for a run every five minutes — 288 a day. Counted off the commit
log for 28 Aug:

| Job | Cron asks for | Actually ran, 24h |
|---|---|---|
| `fpl.yml` — data refresh | ~288 | **5** (gaps of 6h, 6h, 3h) |
| `live.yml` — live fast lane | ~288 | **~3**, last at 12:12Z, none through the 19:00 kickoff |
| `backup.yml` — league backup | 24 | **2** (a 13-hour hole, 05:17 → 18:33) |

One of those five `fpl.yml` runs was Marc pressing the button by hand. On
26 Aug the hourly backup ran roughly hourly, as designed; by the 28th it managed
twice. **It has been degrading since 26 Aug and is still degrading.**

**What it broke, in order:**

- **Waivers, Friday morning.** `functions/index.js:298` refuses to run on a feed
  older than 90 minutes. The feed was 368 minutes old, so the run threw and no
  claims settled. Marc ran `fpl.yml` by hand at 10:40; `waiverTick` picked it up
  at 11:07 and waivers went through.
- **The scoreboard**, hours behind during live matches.
- **The Vidiprinter**, blank through Palace v City — `data/stats.json` held zero
  GW2 player stats three hours after kickoff, so there was nothing to report.

**This is GitHub, not us.** `liveTick` — the Cloud Function on Firebase's own
scheduler, `* * * * *` — ran perfectly all evening. Read off the live public
node at 19:44Z, mid-match:

    live overlay    : GW2  written Fri 28 Aug 19:44Z (1m ago)
       players with stats : 22
       fixtures started   : 1 of 10

Right round, right count, one minute old, while every GitHub cron on the repo
sat idle. Firebase's scheduler is keeping its promises; GitHub's is not.

### What is already done, and what it is not

`.github/workflows/matchwatch.yml` + `scripts/matchwatch.py` (pushed 28 Aug).
GitHub throttles the *scheduler*, not a job already running, and this repo is
public so Actions minutes are free. So instead of 288 short runs it asks for a
few long ones: each fire reads `data/fixtures.json`, and if a match window is
open it fetches every 2½ minutes until it closes. Three legs chained with
`needs:` — which always fires, unlike cron — so one trigger covers ~15 hours.
Off-matchday it exits in seconds. Windows open 75 minutes before kickoff (team
sheets) and close 150 after the last one (bonus points settling); nearby
kickoffs merge, so the lull between the 14:00s and a 16:30 does not drop the
watch. `test/matchwatch.test.js` drives the real GW2 card through it, 19 checks.

It worked on the first pass: pushed at 21:06Z, committed a refresh eight seconds
later, feed age 0 minutes, 30 GW2 players.

**But it is a workaround and should be read as one.** It still depends on
*something* firing to start it — four scattered crons, any push, or the button.
It burns a runner for hours. And it does nothing for `backup.yml`, which is the
one with real stakes: thirteen hours without a league backup is a data-loss
window, not an inconvenience.

### What only you can do

**Move the FPL fetch to a Cloud Function, next to `liveTick`.** Same schedule
mechanism that demonstrably works, no runner, no throttling, and it fixes
waivers, the live scoreboard and the Vidiprinter's canonical lane in one go.
`scripts/fetch_fpl.py` is the logic to port; `pushLiveOnce` is the shape to copy.
The awkward part is that the Pages feed is a *committed file* and a Cloud
Function cannot push to git — so either it writes the feed to RTDB and the
client prefers that (closer to what `liveStats` already does), or it fires a
`repository_dispatch` and a workflow does the commit. The first is cleaner and
removes git from the matchday path entirely.

**And give `backup.yml` the same treatment**, or accept that a backup is a
twice-daily thing and say so in the runbook. It is currently neither.

Order of play, none of it urgent enough to do tonight:

1. Nothing. `matchwatch` covers this weekend; tomorrow's 11:30 kickoff needs no
   button pressed.
2. Decide RTDB-feed vs `repository_dispatch` for the fetch.
3. Port and deploy. Then `fpl.yml` and `matchwatch.yml` can both be retired, and
   `live.yml` — already documented as the independent fallback to `liveTick` —
   is doing nothing useful three runs a day.

Raised by Marc, 28 Aug: *"why, do i have to do this. you know the timings,
surely we can automate it."* He was right that it should not be a button.

### Retire `matchwatch.yml` too — and the reason is that it never worked

Marc, 30 Aug: put it on the same list as the `fpl.yml`/`live.yml` crons. It
belongs there, but it is a stronger case than "harmless extra", because the
run log says the stopgap was never actually load-bearing.

**Five runs, ever. All five triggered by `push`. Not one of its four scheduled
crons has fired.** Its whole design was "cron is unreliable, so get one fire to
cover fifteen hours" — and it could not get the one fire. Through Saturday's
card (29 Aug, 11:30 through 16:30) it did not run at all: the 06:13, 10:47,
14:29 and 18:11 crons were all swallowed exactly like every other cron on the
repo, and nobody happened to push. Saturday's coverage was `feedTick` from the
moment you deployed it, and nothing else.

So it is not redundant cover, it is dead weight that reads like cover — which
is worse, because the next person to look at the Actions tab will assume the
matchday feed has a backup that has never once run on its own.

`git rm .github/workflows/matchwatch.yml scripts/matchwatch.py
test/matchwatch.test.js` and drop `matchwatch.test.js` from `test:offline` in
`package.json`. Keep it until `feedTick` has its clean week if you would rather
hold a spare, but it is a spare that has only ever started when a human pushed.

The window logic in `matchwatch.py` — 75 minutes before kickoff to 150 after,
with nearby kickoffs merged — is the same rule `feedTick` now uses, so nothing
is lost by deleting it. That much of it survives in your function.

---

## 04. THE HOLDING PEN — the rule was wrong, and this branch fixes it (21 Aug)

Branch: `claude/holding-pen-arrivals`, cut fresh from main.

Reconstructed by diffing draft night's published feed (20 Aug ~20:43) against
now. The pen held exactly two men:

| | Player | What actually happened |
|---|---|---|
| id 600 | **Osman**, MF, Brighton | Never existed at the snapshot. He did not move — FPL had no record of him until he played. |
| id 31 | **Konsa**, DF | Moved Aston Villa → Arsenal. Already on the game, already drafted. |

**The Chairman's ruling (Marc, 21 Aug): neither belongs in the pen.** "konsa
was already on the game and drafted by somebody. osman wasnt on the game but
only because of an error on the fpl data feed, he should be on waivers."

That matches CLAUDE.md, which calls the Window Draft "a snake draft over new PL
arrivals". A man moving between two PL clubs is not arriving. Confirmed against
the feed: Konsa kept id 31 AND code 199798 across the move — FPL updates the
record rather than creating one.

### The live consequence, which is worse than a mislabelled card

`arrivalLocked` ignores ownership, but `lockedArrivals()` — the pen list —
filters owned men out. So whoever drafted Konsa **cannot field him and cannot
see why**: `lineupSave` refuses a locked arrival (`functions/index.js:1354`),
he is absent from the pen because he is owned, and nothing on screen explains
the rejected XI. GW1 was already deadlined when he moved, so it has not bitten
yet. GW2's deadline is Fri 28 Aug.

### What this branch changes

`isArrival` now asks the one question that matters — did draft night know this
id — in **both** `js/app.js` and `js/engine.js`:

    const isArrival = p => !!state.draftPool?.ids && state.draftPool.ids[p.id] === undefined;

They must ship together: a client that offers an XI the server refuses is worse
than either rule alone. `test/holdingpen.smoke.js` pins that the two agree.

Plus a per-player **"→ Trough"** beside each man in the pen (Chairman only), and
`windowDraft op:'admit'` behind it, which writes him into the snapshot at his
current club.

`ux3` G7b built its test arrival by changing a player's club — the case that is
no longer one — so it now omits him from the snapshot instead.

### Order of operations

1. Merge this branch.
2. Deploy functions (the rule lives in the engine the server runs).
3. Press **→ Trough** on Osman. He lands claim-only on waivers — the trough
   window is shut because a gameweek is underway, not because anyone closed it
   — and clears at the next run, **Tue 25 Aug 10:00 London**.

**Konsa needs no button.** Step 2 alone unlocks him.

**Do not press "Skip it — release all to the Trough" before then.** With the old
rule still live on the server it would spring Konsa into the Trough as well.

---

## 05. THE TEST SUITE ASSUMES A PRE-KICKOFF LEAGUE (21 Aug, after 17:30Z)

GW1's deadline passed at 17:30Z and free agents went to zero — everyone spare is
claim-only until the next run. Four things depend on a signable free agent
existing, and all four broke at that moment. None is a code fault:

- `prep.smoke` **P11b** — fails; the Free agents pool is empty, so there is no
  row whose flag it can measure
- `product.smoke` — **crashes** (`Cannot read properties of undefined`) picking
  a free agent to sign
- `feature-fixes.review` — **crashes** the same way
- `engine.parity` — silently drops from 8 checks to 6, skipping the three waiver
  assertions ("no suitable free agent in demo pool")

The last is the one I would fix first: it does not fail, it just quietly stops
testing. All four want a seeded pre-kickoff state rather than the live calendar.
`podcast.smoke` P17 is also red, but it was red before kickoff.

**Re-measured 24 Aug, on `main` at `0da787e`.** Three of the four have healed
themselves as the calendar moved on — `prep.smoke` 38/0, `product.smoke` 9/0,
`feature-fixes.review` 16/0. `engine.parity` is still quietly running 6 checks
instead of 8, so the waiver assertions have not been exercised since 21 Aug.

A new one had gone red in their place, the same way and for the same reason:

- `matchday.smoke` **N1** ("seeded projections genuinely differ") — failed with
  `0 v 0`. Both seeded projections had collapsed to zero, so the orientation
  checks it guards were vacuous.

**~~Fixed by Ben~~ before I finished writing this up** (`9f27edb`, 23 Aug 20:45
— "matchday N1 stops trusting the real calendar"). N1 now builds its own
pre-kickoff world: phantom fixtures, no stats, clock before kickoff. Verified
green here on 24 Aug — `matchday.smoke` 49/0. Ben also confirmed independently
that the auto-subs work was not the cause, which matches what I measured by
stashing and re-running.

So the outstanding item in this section is now just one:

- `engine.parity` still quietly runs **6 checks instead of 8**, skipping the
  three waiver assertions. It does not fail; it stops testing. It is the one I
  would still fix, and it is the same root cause — pinning live data rather
  than a seeded fixture. Ben's N1 fix is the pattern to copy.

**Re-measured 28 Aug, and it needs splitting in two — the two halves are not
the same item.**

- The `resolveWaivers` block is **still skipping**, verified by running with
  `VERBOSE=1`: `waivers: (skipped — no suitable free agent in demo pool)`. Still
  the one worth fixing, still wants a seeded pool rather than the live one.
- The demo-season `waiverOrder` comparison, by contrast, **is** running and
  earned its keep: it caught a real clock bug this evening. The suite went red
  at 17:30Z on the 28th with `waiverOrder 1/3/5` when the wall calendar rolled
  into GW2 while the demo stayed pinned to GW1, so the engine read `transferGw`
  2 against the app's 1. The harness was passing `now: () => Date.now()` while
  its own comment said to freeze the clock inside the demo gameweek's window.
  Fixed in the test — with the clock frozen correctly the engine and app.js
  agree on every check, so no engine or app change was needed. Third
  wall-calendar expiry in a week, after N1 and the Gazette smoke.

---

## 02. CEREMONY vs FIRST PICK — the race Toby's test draft exposed (18 Aug, PRE-THURSDAY)

**What happened (sandbox test draft, 18 Aug ~23:20):** Toby started the
draft and force-opened the room; picks began while Marc's device never
showed the draft had started. Server state was correct throughout (phase
`draft`, clock armed, picks landing) — this is a client presentation race,
not a data bug.

**The mechanism, confirmed in code:**
1. A client only auto-rolls the opening ceremony when its snapshot arrives
   with `picks.length === 0` (`app.js:378` — `fresh`). Once pick 1 lands,
   a syncing client skips the ceremony AND the view-flip logic it rides on.
2. The commissioner's force-open (`draftAdmin roomOpen`) marks EVERY
   manager through the ceremony and arms the clock — including managers
   who are mid-ceremony or not yet synced. Designed for no-shows; on the
   night it also tramples the people who ARE there.

**The Chairman's ruling (18 Aug, group chat):** nobody should be picking
until everyone has finished the ceremony — or everyone watches the
ceremony concurrently. Either is acceptable; the current half-and-half
(starter watches pomp, force-open lets picks race ahead of everyone
else's overlay) is not.

**Options when we build it (post-Thursday or Wed if time):**
- (a) Concurrent ceremony: phase flip triggers the ceremony on every
  connected client at once (drop the `picks.length === 0` gate; key the
  overlay on ceremony-seen only), clock stays unarmed until 12/12 acks —
  which is already the server's default. Force-open stays as the no-show
  escape hatch but shows a "the Chairman opened the room" banner on
  devices still mid-ceremony instead of leaving them stranded.
- (b) Minimal: keep everything, but when a snapshot arrives with
  `phase === 'draft'` and picks > 0 and this device hasn't seen the
  ceremony, skip the pomp and land HARD on the Draft Console with a
  toast ("the draft is live — pick N on the board").

**DO NOT DEPLOY before Thursday without Ben's word** — the game build is
meant to be frozen; Ben explicitly said "don't deploy yet" when this was
found. Sandbox repro: reset, start as one manager, force-open, watch a
second signed-in device.

Also from the same session: **Toby wants the pick timer at 60s, not 30**
— that's a Settings change on the real league's setup screen before
Thursday (`settings.pickTimer`), no code needed.

---

## THE DRAFT ORDER (randomiser complete, group chat 16 Aug — FINAL)

1. Toby (Chairman Mao) · 2. Lee (Celta Leigh-Go) · 3. Geller (Geldog FC) ·
4. Ben Levy (Atlético Benfield) · 5. Pol (The Dog's Polaks) ·
6. Conners (101011101) · 7. Blanky (Asterick) · 8. Wilko (WA Wanderers) ·
9. AJ (Interjacksonale) · 10. Singer (Singer's Spartans) ·
11. Tus (Champagne Khusanova FC) · 12. Ducky (Mighty 🦆)

**Draft-night mechanics (Chairman only):** in the Chairman console, drag the
manager rows into the order above by the number handle, then press **Start
draft (ordered)** — it drafts what's on screen. Do NOT press the randomise
start; the randomiser has already spoken. Snake format, reverses each round.

Runbook reminders: all 12 signed in on their draft device BEFORE the
ceremony (Ben Levy still outstanding as of 16 Aug — chase); each device
shows its correct NAMED identity, not Demo/SANDBOX.

---

## 000. BEFORE DRAFT NIGHT — one deploy, one merge (18 Aug)

### A functions deploy, and this one actually matters

Marc, 18 Aug: "can we do something about the players out on loan/transferred
out." Nineteen players are marked `status: 'u'` by FPL — "Has joined Como
permanently", "on loan for the rest of the season". They will never play
another Premier League minute, but the board ranks on last season's points, so
**Chalobah sits at #42 on 136 points while playing in Italy** and Digne at #126
on 97 while at PSG. Both inside draftable range.

They are now hidden from the pool and the Trough, tagged LEFT, and **autopick
refuses them**. That last rule lives in `js/engine.js` — which is where it has
to be, because the live draft autopicks on the SERVER via
`eng.autoPickChoice`, not in the browser.

**So the client change is live on `main` and does nothing for draft night on
its own.** Until functions are deployed, a clock running out can still hand
somebody a man at Getafe — the exact thing the change exists to prevent, at the
exact moment it costs a pick that cannot be got back.

    npm run deploy:functions

Everything else about it is client-side and already live.

### Three commits still on the branch

`claude/podcunt-network` carries three that landed after your merge:

- Draw the Northern Ireland flag — Unicode has no NI flag, so it was falling
  back to the **Union Jack**, currently showing on Hume, Ballard, Bradley and
  Devenny on the live site. Drawn now as the Ulster Banner, the flag the IFA
  plays under.
- Andrés García → Spain, Diego Coppola → Italy (both arrive from FPL with no
  region at all).
- Christantus Uche → Nigeria.

Purely cosmetic, nothing depends on them, tests green. Merge when convenient.

Fourteen players still have no country. That is FPL's own null, not a gap in
our mapping — every code the feed sends is mapped. `NAT_OVERRIDE` in
`js/app.js` fixes any of them in one line, keyed on the stable player code.

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
  prints the same episode). Audio: see the VOICES DECISION below (16 Aug
  evening — the original speechSynthesis plan is dead).
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
- **VOICES DECISION (group chat, 16 Aug evening — supersedes the
  speechSynthesis plan above):** Marc's pilots proved the transcripts
  ("the cuntent is too good not to use") but browser/robot voices are
  "too bad to use". Agreed in chat: pay for proper voices, get it running
  now, improve later. The plan:
  - **ElevenLabs, Starter tier — DONE (16 Aug eve, £4.61/mo, Ben's
    account).** Upgrade to Creator (~£17/$22, Marc's "20 quid") only if
    the monthly credit allowance or voice quality forces it.
  - **WHERE THINGS ARE (for Marc's AI — set up 16 Aug eve):**
    - API key: created ("podcunt-render", scoped to Text-to-Speech +
      Voices-read only). It lives on Ben's machine at
      `~/.config/the-league/elevenlabs.env` — Ben sends it to Marc
      PRIVATELY. The render script must read it from the
      `ELEVENLABS_API_KEY` environment variable. Never in the repo.
    - Voices are cast, added to the account, and smoke-tested (four
      audition clips rendered fine on 16 Aug). Voice IDs are not secrets;
      hardcode them in the render config:
      | Host | Library voice | voice_id |
      |---|---|---|
      | Keys (talkTROUGH) | Andy — gruff, raspy | `kVBPcEMsUF1nsAO1oNWw` |
      | Grey (talkTROUGH) | Chris — Scottish Casual | `csXxiUN2BUFflsCaDxPM` |
      | Rax Mushden (Gazette FW) | Marcus — SE England Indie | `MLSOvrM2Tyi3okEfyOiI` |
      | North Manc dreg (guest/wildcard) | Jay — Proper Mancunian | `c8MZcZcr0JnMAwkwnTIu` |
      Panel guests can reuse the account's premade British voices free of
      casting work: George `JBFqnCBsd6RMkjVDRZzb` (warm storyteller —
      Bilson?), Daniel `onwK4e9ZLuTAKqWW03F9` (steady broadcaster —
      continuity/listings), Lily `pFZP5JQG7iQjIQuC4Bku`, Alice
      `Xb7hH8MSUJpSbSDYk0k2`.
    - Render call that's proven to work: `POST
      https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`
      with header `xi-api-key`, body `{text, model_id:
      "eleven_flash_v2_5", voice_settings: {stability: 0.5,
      similarity_boost: 0.75}}`. Flash keeps two weekly shows inside
      Starter's 30k credits — don't switch the whole render to the
      flagship model without checking the budget.
    - Stitching: prefer ffmpeg (concat demuxer, re-encode once at the
      end). Naive `cat` of same-format mp3s plays but reports broken
      durations — don't ship that. Marcus's voice has Live Moderation
      enabled (slightly slower renders; harmless for a batch job).
  - **Audio is PRE-RENDERED, not live**: a script (Marc's side, run
    locally) takes the deterministic transcript, calls ElevenLabs per
    line with each host's voice id, stitches one mp3 per episode
    (ffmpeg), commits it to `data/pods/`. The ▶ Listen button just plays
    the mp3 (hide it when no file exists). This keeps the client-only
    rule intact and keeps the API key OUT of the repo and the site —
    never commit or paste the key anywhere public, including the group
    chat.
  - **Voices**: pick British voices from the ElevenLabs voice library —
    Rax Mushden earnest Guardian southerner; Keys gruff, Grey the
    sidekick; Ben wants "a north manc drek" in the mix. Bootleg
    SOUNDALIKES only — do not voice-clone the actual Richard Keys or any
    real person without consent (ElevenLabs ToS + the league is run by a
    lawyer). Wave 2: Iain records a couple of minutes of accents →
    instant voice clone (included on Starter) → he's a host.
  - Budget sanity: a ~5-min episode is roughly 5k characters; two shows
    a week ≈ 40k chars/month. Starter's allowance covers that on the
    cheaper Flash model; if every line uses the flagship model it will
    run out mid-month — that's the trigger to go to Creator.
- `esc()` every dynamic string (team names are user-controlled).
- Before every push: `npm run check && npm run test:offline`, plus
  `node test/gazette.test.js` and `node test/mockparity.smoke.js`. Pushing
  main deploys the live site within minutes and the beta mirrors itself.

### 5b. THE VOICES — one decision for you, and it contradicts your spec above

Ben, your brief says *"the voices being naff is the joke — do not add an audio
backend."* Marc has listened to the pilots and disagrees, twice, in terms:

> "the voices need to be more realistic and individual to each personality"
> "this joke doesnt work unless the people sound like people not robots"

He is right on the facts. I have taken browser speech as far as it goes:
abbreviations now expand to what a broadcaster would say ("IPS" → Ipswich),
shouted runs are handed over in lower case so they stop being spelled out
letter by letter, and each host gets a different installed voice. It is much
better and it is still a screen reader. `speechSynthesis` cannot do character.

**What is already built and needs nothing from you.** The player takes real
audio wherever real audio exists and falls back to the browser voice line by
line where it doesn't. Files live at `audio/pod/<episode-id>/<block>.mp3`,
listed in `audio/pod/index.json` — which currently ships EMPTY, so today
nothing changes and nothing is fetched. Still client-only, still same-origin,
still works offline, no runtime backend. The stings stay synthesised.

**What needs you — ELEVENLABS (your call, relayed by Marc 18 Aug).**
`scripts/render_pods.js` reads the episodes out of the live generator headless
and cuts them to real voices. It needs the API key, so only you can run it.
`audio/pod/cast.json` is already set to `"provider": "elevenlabs"` with the
per-character tuning done; the `"voice"` fields are deliberately BLANK because
ElevenLabs ids are specific to your library. Order of play:

    node scripts/render_pods.js --voices      # the ids in your library
    node scripts/render_pods.js --audition    # all of them, same line, compare
    # paste the ids into audio/pod/cast.json
    node scripts/render_pods.js --dry         # what it would cost
    node scripts/render_pods.js               # cut it, then commit audio/

Two things specific to ElevenLabs, both handled: it IGNORES written direction,
so the performance knob is `settings` per character (low `stability` = more
variation and more shouting — Grey is at 0.22, Bilson at 0.75), and lines are
sent with `previous_text`/`next_text` so it knows where it is in the
conversation instead of reading twenty unrelated announcements. Nothing renders
until every non-human part is cast, and the ids are checked against your
library before a credit is spent.

**The numbers:**

- Both pilots together are **~6,000 characters**. A normal week (two shows,
  preview + review) is ~12–14k. A full 38-week season ≈ **~450k characters**.
- ElevenLabs bills per character, so that is comfortably inside Creator
  (100k/month) for a few weeks at a time and wants Pro for a full season —
  call it **£20–80 a month**, which is the tier decision, not a per-render one.
- Storage ≈ 290 MB a season at 64 kbps. Pages is fine to ~1 GB, but prune to
  the last eight gameweeks and it stays under 60 MB.
- Rendering the weeklies automatically would want a scheduled workflow and the
  key as a repo secret. **I have not touched that** — secrets and deploys are
  yours. Until you do, the pilots and the draft reaction are one-offs you can
  cut by hand, which is most of the value for almost none of the cost.

### 5d. Re-rendering — one command, and optionally none

Marc, 18 Aug: "how do they get re rendered. We need a better process for this
surely." He's right, and the old loop had already gone wrong once.

**Locally, it is one command, always the same one:**

    npm run pods

It works out what is OUTSTANDING and cuts exactly that — lines with no audio,
lines whose words changed, lines whose cast voice changed. Run it when nothing
has changed and it spends nothing and writes nothing. It starts its own web
server and stops it again, so there is no second terminal to forget.

    npm run pods:due       what it would cut, and what that costs
    npm run pods:voices    your ElevenLabs library, with ids
    npm run pods:audition  every voice reading the same line
    npm run pods:parts     lines still waiting on a human recording
    npm run pods:scan      rebuild the manifest from files on disk

That works because recordings are filed under a hash of what is SAID, not
where the line sits. Re-ordering is free; re-wording re-cuts that line alone.

**A spend cap.** Anything over 25,000 characters stops and asks, before it
touches the network — one shared phrase can legitimately re-cut hundreds of
lines, and that should be a decision rather than an invoice. Raise it
deliberately with `--max-chars` when the big job is the point.

**To take yourself out of the loop entirely**, there is now
`.github/workflows/render-pods.yml`. It needs one thing from you:

    Settings → Secrets and variables → Actions → New repository secret
    ELEVENLABS_API_KEY = a key that has never been in a chat

With that, you can run a render from the Actions tab without a terminal. To let
it run on a schedule too — Friday before the previews, late Monday once the
reviews can be cut — also add a repository **variable** `PODS_AUTORENDER = on`.
Until that variable exists the scheduled runs exit immediately, so merging the
workflow changes nothing on its own. It commits to whichever branch it ran on
and never pushes to `main` by itself.

It costs the job before spending, runs the smoke test after rendering, and
commits nothing if nothing changed.

**The gap this leaves, stated plainly.** Marc asked (18 Aug) whether the
episodes generate themselves on a schedule. The TEXT does, with no server and
no job at all: `Podcast.published()` is a pure function of league state and the
current time, computed in the browser, so a new episode simply exists the
moment its slot passes. The AUDIO does not — it is committed files. So from the
first weekly episode onwards, a new show appears **in browser-robot voice**
until somebody renders it and pushes, which will be conspicuous once the rest
of the cast is ElevenLabs.

Three ways out, and it is your call:

1. **Scheduled render** (the real fix). A workflow that runs the render and
   commits `audio/`. It has to fire *after* the content is knowable but *before*
   the slot opens — so roughly Fri 16:00 London for the preview, and on the
   review side only once `gwStatus(i) === 'final'`, which is why a plain cron
   is not quite enough on its own.
2. **Accept the lag** — robot on Friday teatime, real voices whenever you next
   render. Cheap, and honestly fine for a first season.
3. **Hold the episode until its audio exists** — gate weekly publishing on the
   manifest. Cleanest sound, but an episode never appears at all if nobody
   renders, and a silent Media section is worse than a robot one.

**The slots are Tuesday and Friday, midday London.** Marc, 18 Aug: "why not
just have the twice weekly schedule to be Tuesday at midday and friday at
midday and have the time fixed." Done — a show nobody can predict is a show
nobody remembers, and it puts the review two hours after the waiver run on the
same day, so it can talk about claims that have actually settled.

Fixed TIMES, but bound to the gameweek rather than the calendar. Five rounds
this season kick off on a **Wednesday**, and a naive weekly calendar would have
previewed those six days early and reviewed them six days late. So: a preview
goes out in the last slot before the first kick-off, a review in the first slot
after the last whistle. Weekend rounds land Friday and Tuesday exactly as
asked; midweek rounds shuffle to the slot that still makes sense. Checked
across all 38: every preview lands before kick-off, every review after full
time and before the next round starts.

**Midweek rounds get a double bill.** Marc again: "when there is a midweek
gameweek you can just do the review and the preview as one slightly longer
episode." That is how every real football podcast handles it, and it avoids
two episodes per show racing into the same minute. One opening, one sign-off,
one ad break, one phone-in, with a bridge in the middle — about 600 words
against 400 for a single. The two halves are the existing bodies with their own
top and tail suppressed, so there is no second copy of the copy to drift.

### 5e. Pods — what is actually left (18 Aug)

Both pilots are finished: 46 of 46 lines carry a real voice, nothing
outstanding, all of it merged and live. Three things remain, none urgent:

1. **Press Run workflow once, as a rehearsal.** `render-pods.yml` has never
   run — zero runs. With everything already rendered it will cost nothing and
   commit nothing, but it proves the secret is set and the path works. Do it
   while it does not matter, rather than discovering it on draft night, which
   is the one episode a timer cannot catch (see 5d).
2. **`PODS_AUTORENDER = on`** if you want the Tuesday/Friday renders to happen
   without you. Until that repository variable exists the scheduled runs fire
   and immediately skip.
3. **`audio/buffer-out.mp3`** — a loose 97KB file on `main`, outside
   `audio/pod/`, from the ring-announcer experiment. Nothing plays it, but it
   ships to everyone who loads the site. Delete it unless it is headed
   somewhere.

Marc has also floated a boxing-style ring announcer to open the draft
("MICHAEL BUFFERIN", an in-world name, our own catchphrase — not a clone of a
real person's voice, and not the trademarked line). Parked, not built.

### 5c. Howard from Prestwich

Marc, 18 Aug: a phone-in caller on talkTROUGH, one call an episode, "in the
style that phone in callers are normally introduced". Keys takes the call and
answers it. He is a first-time caller every single week, he mentions something
nobody asked about before he gets to the point, and he hangs up to listen.

What he is WRONG about comes from real league state — the draft grades, the
shared clubs in Friday's tie, who is about to be named Fraud of the Week — so
it is a different complaint every episode and still deterministic.

He is also the human-recorded part, which is the right shape for it: a caller
is the one voice on a station that isn't a broadcaster, so the join shows least
where the amateur genuinely is the amateur. `--parts` prints his script and the
exact filenames; drop the recordings in (any format a browser plays, straight
off a phone is fine), run `--scan`, commit. A render can never overwrite them,
`--force` or not. Side effect: it closes the length gap on talkTROUGH — the
pilot goes from 451 words to 606.

**Clone the voice — this is the bit that makes it sustainable.** Marc, 18 Aug:
"im not recording for howard, someone else is", then "can we not use a
synthesized voice from a pre recorded voice?" Yes, and that is the answer. The
pilots are fixed scripts and can be recorded once, but the weekly episodes are
built from that week's results, so Howard's question is new every time. Two
fresh takes a week for eight months, from someone who isn't even in the league,
is a commitment that quietly dies in October.

So: record him once — a few minutes of him talking, in character, unhurried —
and then

    node scripts/render_pods.js --clone "Howard" sample1.m4a sample2.m4a

which writes the cloned voice id straight into `cast.json`. Every episode after
that generates Howard in his own voice, automatically, forever. An afternoon of
his time instead of a season of it.

**Get his consent, explicitly.** ElevenLabs requires you hold the rights to a
cloned voice, and beyond the terms, cloning somebody's voice without asking
isn't a thing this league does. Ask him, tell him what it's for, and keep the
samples.

Hand-recorded takes still win wherever they exist — a render can never
overwrite one, `--force` or not — so the two mix freely: clone for the weeks
nobody got to, real takes wherever anybody fancied doing it properly.

`settings.stability` is already at 0.7 for him, because he is the one man on
the show who never shouts.

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

---

## 7. Toby's deadline-day package (group chat, 16 Aug 23:30) — BUILD WEEK OF 25 AUG

Toby, in the group: prize money needs changing, deadline day is Tue 1 Sept
23:00 (a waiver run falls that morning), and he wants a "secondary new
signing direct" on Wed 2 Sept ~20:00 that runs automatically, with anyone
dropped going to WAIVERS, not into the draft. Ben: "we just hardwire it in."

What the app does today, so the delta is honest:

- **Prize money** is one paragraph on the Rules page (`viewRules`, app.js
  ~10240) — it already says the £145 windfall's "redistribution to be argued
  about in the group chat". Changing it is a copy edit. **Blocked on the
  group actually agreeing numbers — get the split from Toby before touching.**
- **The Window Draft** exists (snake over locked arrivals, leftovers spill to
  the Trough) but is COMMISSIONER-TRIGGERED — Ben presses start/end. Toby's
  ask = schedule it: arm at Wed 2 Sept 20:00 London, run without Ben.
  The unattended-waivers pattern (.github/workflows/waivers.yml driving the
  live site headless as the commissioner device) is the template — a
  one-off scheduled workflow can do the same for `wd start`.
- **Drops → waivers, not the draft**: check how dropped players currently
  re-enter (Trough immediately vs waiver-gated). Toby wants them
  waiver-gated. Scope this against `troughSign`/claims before promising.

Order of play (after draft night, nothing here is urgent):
1. Group agrees the prize split → copy edit lands same day.
2. Build + emulator-test the scheduled Window Draft start (Ben approves the
   cron time; runbook line for the manual fallback if the workflow misses).
3. Drops-to-waivers rule change — small engine delta, needs the usual
   sol-style check because waiver order is competitive surface.

Rules changes are the group's to make (see §1 precedent) — Toby raised it in
the group, so the mandate exists; only the prize numbers are still open.

### 5d. Draft-episode data inventory (group chat, 17 Aug — for Marc's AI)

What the draft episode can actually mine, checked against the code:

- **Picks vs ratings vs last season** — already built: the episode's draft
  table ranks every pick against last-season points and carries the delta
  (steal-of-the-draft / reach-of-the-draft both fall out of it).
- **KLAXONS — no remembering needed.** Ben wondered if klaxon moments need
  recording. They don't: KLAXONS (js/lore.js) are RULES keyed to immutable
  FPL codes/clubs/manager ids, and every pick in the ledger carries its code
  (the code-fields build). The episode can recompute exactly which klaxons
  fired, for whom, in pick order — deterministically, forever. A "Klaxon
  Review" segment is free content.
- **Clubs** — available: shared-club concentrations, the City-hoarding
  count, promoted-club picks (the taxonomy is already in lore.js).
- **Nationalities — NOT available.** The FPL feed carries no nationality
  field. Would need a new data source; don't promise it on air.
- Marc's editorial line stands: "the content isnt the point really. Its the
  adverts."

---

## 08. THE FRIDAY PAPER — GW3 matchday edition (2 Sept)

Ben's commission for the Friday 4 Sept edition, built and on main. It is a
`COMMISSIONS` entry in `js/gazette.js` keyed to gameweek NUMBER 3, printed by
`Gazette.frontPage()` above the fixtures in `previewArticle` — so it goes to
print at the 18:30 deadline and the archive keeps it. Two pieces on Friday, plus the special below:

- **Lead:** Ian's lucky streak. Every figure (table place, points-for, the
  Crystal Ball luck number, all-play record, the GW1 Jammiest Win, the
  transaction count) is read from state at print time and each clause is
  gated on its fact.
- **The Window Waiver** is its OWN edition (Ben, later on 2 Sept: "a preview
  of the pen tonight actually? special edition"). `Gazette.windowSpecial()`
  is the paper from Wed 2 Sept 17:30 until the GW3 deadline, with a permanent
  "Window Waiver" slot in the archive. Before the run: the pen in tiers, the
  running order, the rules. Once the ledger carries `windowDraft` records the
  same edition becomes "window waiver result", pick by pick, and the NEW
  EDITION marker fires again. Nothing to do after Thursday's run.
- **Letters page:** Ian's my-fourteen petition from the group chat, and the
  Committee's reply. The "my fourteen" feature itself was NOT built — Ben
  and Marc both declined to spend usage on it.

Pins in `test/gazette.test.js` (5 new). Nothing else in the paper moved.
