# Draft night: the ceremony barrier and the pick clock

**For Ben.** Raised by Marc, 9 Aug 2026, off a sandbox test night with Toby.
Two faults, both live on the real draft path. **Two managers will be drafting
abroad this year**, which turns the second one from a curiosity into a
must-fix.

Some of this is already fixed and pushed to
`claude/committee-awards-count-week-4uo6bz`. The rest needs decisions from you,
and one part needs a `functions/` deploy, which is yours alone.

---

## Issue 1 — the draft started before everyone had seen the ceremony

### What Marc saw

He was sat on the **REPORT TO THE DRAFT ROOM** card. When he pressed *I'm
through — join the room*, the draft was already two picks in.

### Why

Three separate things, in order of how much they matter.

**a) The card lied.** `cerFinish()` — which stamps you seen and tells the
server — only ran when the button was *pressed*. So while the card said "You
are through", the server still had Marc as not through. Anyone who stopped to
read it was silently holding up a room that was telling them they were fine.
**Fixed** (`js/app.js`): the acknowledgement now goes out the moment the card
appears, and the card carries a live count ("— 7/12 are in") instead of a
fixed sentence.

**b) The overlay never closed.** It was built once, detached, and nothing ever
removed it. When the room opened underneath, sync re-rendered the page *behind*
the overlay and left the barrier frozen. Worse, the pick clock deliberately
skips its tick while the pomp is up (`js/app.js:4979`), so there was nothing on
screen to give the game away. **Fixed**: `ceremonyTick()` (`js/app.js:3838`)
runs on every shared tick — refreshes the count, and once picks land it cuts
the pomp short and drops you on the console.

**c) The barrier has two legitimate bypasses.** These are the ones needing your
call, below. The barrier itself is sound: `draftPick`, `draftAutopick` and the
pick transaction all require every id in `draft.order` before pick one.

### The complete audit — every route to pick one

Marc asked, reasonably, how confident we actually are. This is exhaustive:
every server write to `draft.picks` and every route that can arm the first
clock.

**Can create pick one:**

| Route | Barrier | Notes |
|---|---|---|
| `draftPick` | yes, twice | before the txn (`:423`) and **inside** it (`:445`) |
| `draftAutopick` | yes (`:467`) | then delegates to `draftPick` |
| `autoComplete` | **none** | hard-refused unless `league === 'the-league-sandbox'` (`:583`) |

**Can arm the first clock:**

| Route | Barrier | Notes |
|---|---|---|
| `ceremonyReady` | yes | arms on the twelfth acknowledgement, same txn |
| `clockStart` | yes (`:522`) | the legacy-client path still requires all twelve |
| `roomOpen` | **none, by design** | marks all twelve through and arms. Chairman only (`:555`) |

`pause`, `resume`, `breakDone` and `timewaste` are barrier-checked as well
(`:543`, `:681`, `:685`, `:689`). The `start` op resets `ceremonyReady` to null
(`:669`).

**Conclusion: on the real league there is exactly one way to start without
somebody — you pressing "⚖ Declare the room open".** That button renders
inside the locked-room card (`js/app.js:4175`), directly beneath the line
reading "7/12 managers have finished the opening ceremony". On 9 Aug it was the
sandbox, where `autoComplete` is also available — but that fills all 168 picks
at once, which does not match "two picks in". The Chairman's button is the
likely answer.

### Decisions for you

The honest tension: **"no way to start without someone" and "a no-show can't
wedge the draft forever" cannot both hold absolutely.** A dead phone at 8pm
means the league either waits indefinitely or starts without them. So the
question is what the escape hatch looks like, not whether there is one.

Marc has seen the options below and endorsed **1 + 2 together** — the draft can
never start without you *unnoticed*, and never without you *unwarned*, but the
league still can't be held hostage by a flat battery.

**1. Name and shame.** Force-start marks through only the managers who have
**not** acknowledged, names them in the confirm sheet ("Start without Marc and
Ian?"), and records it so every screen can say who was left behind. Today the
other eleven get no explanation for why the pomp vanished. Cheapest change,
and it removes the silence.

**2. Enforced wait.** The button stays disabled until the room has been waiting
a set period, with a countdown everyone can see — "Marc has 4:30 to report".
Nobody is dropped without warning. Needs a "waiting since" timestamp; the
`ceremonyReady` txn is the natural place to stamp it when the first manager
reports.

**3. Co-sign** (offered, not chosen): a second manager must agree before the
force-start fires.

**4. Still open, and only you and Marc can settle it.** "Everyone has
*reported*" and "everyone has *seen it*" are different rules. **Skip ceremony
(Ian's button)** counts you as through without watching. If mandatory means
mandatory, Ian's button goes. If it means "nobody starts without you", it can
stay. The code implements the second today.

**5. `autoComplete`** (`functions/index.js:577`) should either refuse before the
ceremony completes, or mark everyone through the way `roomOpen` does, so the
state stays coherent. Sandbox-only, so low stakes — but it is what Toby hit.

None of this is built. It is all `functions/` plus a confirm sheet, so it wants
your call first; the client half is a small change once the policy is set.

---

## Issue 2 — the timer depends on each device's own clock

**This is the one that matters for the managers abroad.**

### The good news first

The deadline is **already correct and shared**. It is stamped with *server*
time inside the Cloud Function, and no client can write it: `makePick` routes
through `serverAct` when online, and `pushShared` is a hard no-op online
(`js/app.js:229`, which logs `[v2] dropped direct write`). So the number
everyone holds is identical and right.

The bug is entirely in **how each device reads it**.

### The fault

`draftDeadlineTiming` (`js/app.js:4938`) computes `deadline - Date.now()` with
raw local time. There is no server-time offset anywhere in the codebase — I
grepped for `serverTimeOffset`, `ServerValue.TIMESTAMP` and friends; nothing.

Measured against a server-armed 30-second pick clock:

| Device clock | Countdown shows | Chairman's device autopicks? | On-clock manager's? |
|---|---|---|---|
| Correct | 0:30 | no | no |
| **1 hour fast** | **0:00** | **immediately** | **immediately** |
| 2 minutes fast | 0:00 | immediately | immediately |
| 9 seconds fast | 0:21 | no | no |
| 1 hour slow | 60:30 | never | never |

### Why one bad device governs the whole room

```js
const mayFire = (rawLeft <= 0 && iAmCommish) || (overBy >= 8 && iAmOnClock);
```
`js/app.js:5011`. Online, `iAmCommish` is `membership?.role === 'commissioner'`
(`js/app.js:180`) — **only your device**. So your phone fires autopick at zero
for whoever is on the clock, with **no grace at all**, while a manager gets 8
seconds on their own pick. If your clock runs fast, every pick is taken the
instant its deadline is armed.

**And the server won't stop it.** `functions/index.js:478`:

```js
if (!overdue && a.managerId !== onClock && !isCommish(a)) throw 'clock has not expired';
```

It only rejects callers who are *neither* on the clock *nor* commissioner —
precisely the two that fire on a timer. A skewed Chairman's phone sails
through.

### Marc's "first pick manual, then it started skipping" is probably NOT skew

Worth stating plainly, because my first read of this was wrong. Marc checked:
his laptop was **seconds** off, not an hour. Seconds cannot do it.

Every pick arms a *fresh* deadline, so an enforcing device only fires instantly
if it is fast **by more than the whole pick timer** — 30+ seconds on a 30s
clock. The table above shows the threshold: 9 seconds fast still reads 0:21 and
fires nothing.

Two likelier causes, neither needing a wrong clock:

1. **The timer simply expired.** `pickTimer` is configurable — 10/20/30/45/60,
   default 30 (`js/app.js:3523`). At 10 or 20 seconds, "ready for my first
   pick, too slow for the rest" is the whole story. **Check what test night was
   set to before pursuing anything else.**
2. **Enforcement switched on mid-draft.** Only the commissioner's device fires
   at zero, and its clock interval is dead while it has the ceremony overlay up
   (`js/app.js:4979`). The room may have drafted unpoliced until that device
   left the pomp, at which point a guillotine appeared on a room used to no
   clock. Same root as Issue 1(b), seen from the other side — and now fixed.

Distinguishing evidence: autopick takes the manager's queue first, then
best-available-by-rating. Skipped picks that are the highest-rated player left
mean the timer fired.

**This does not weaken the case for Issue 2.** The skew exposure is real and
unguarded; it is simply not what happened on 9 Aug.

### Proposed fix

**Client (`sync.js` + `app.js`)** — the real fix:
1. `js/sync.js`: subscribe to RTDB `/.info/serverTimeOffset` (Firebase gives it
   free) and publish it.
2. `js/app.js`: `const serverNow = () => Date.now() + (serverTimeOffset || 0);`
3. Use `serverNow()` wherever a deadline is *read*: `draftDeadlineTiming`'s
   default argument and the clock interval. Offline the offset is 0, so
   `nosync` behaves exactly as today.

Only the read sites need it — 59 `Date.now()` calls in `app.js`, but the
draft-clock-critical ones are a short list, and the write sites are all
offline-only paths.

**Server (`functions/index.js`)** — belt and braces, so no client clock can
ever drive the room:
- Make `draftAutopick` require the server's own `overdue` for **timer-fired**
  calls from anyone, commissioner included. Keep voluntary self-autopick
  ("pick for me now") allowed at any time by passing a reason on the payload
  and only enforcing `overdue` when `reason === 'timer'`.

**One thing I'd resist.** A client-side "that's implausibly overdue, ignore it"
heuristic. A genuinely stale deadline — your phone slept ten minutes — *should*
fire on wake, and the code deliberately provides that recovery. Clamping it
would break the sleeping-phone path. The offset is the correct fix.

### Note on Marc's timezone theory

Being abroad **cannot** cause this on its own. `Date.now()` is UTC epoch
milliseconds and is identical on every correctly-set device; the timezone is a
display offset applied last (`js/app.js:889` renders deadlines in each reader's
own zone deliberately). It only bites if "set time automatically" is **off** —
manually set, or back from abroad and not resynced. Worth telling both
travelling managers to check that setting either way, since it costs nothing
and the fix needs a deploy.

---

## Already done

Pushed to `claude/committee-awards-count-week-4uo6bz`:

- Ceremony acknowledgement fires on sight; live count on the barrier card.
- `ceremonyTick()` closes the pomp when the room moves on.
- `test/ceremony.smoke.js` (10 assertions) pins both rules, including Marc's
  exact scenario: sit on the barrier, let the room fill, let two picks land,
  assert it closes. Runs with sync **on** so `netOn()` is genuinely true, with
  every off-localhost request aborted — no Firebase league is touched.

Not started, pending your call: everything under "Decisions for you", the
`serverNow()` plumbing (needs `sync.js`, which Marc's onboarding tells him to
leave alone), and the `draftAutopick` guard (needs your deploy).

---

## Where the clock stands

**Diagnosed and evidenced; nothing built.** Deliberately — it is the most
timing-critical code in the app, and half of it is yours to deploy.

Established so far:

- The deadline is **already correct and shared**: server-stamped, and no client
  can write it (`pushShared` is a hard no-op online).
- The fault is confined to the **read** side — `draftDeadlineTiming`
  (`js/app.js:4938`) uses raw local `Date.now()`, and there is no server-time
  offset anywhere in the codebase.
- **Threshold rule:** because every pick arms a fresh deadline, an enforcing
  device must be fast by **more than the whole pick timer** to skip picks
  back-to-back. Seconds are harmless; this is why 9 Aug was not skew.
- **Your device alone enforces the clock**, at zero, with no grace, for whoever
  is on the clock — and the server exempts you from its own overdue check.

The fix, in the order it should land:

1. `js/sync.js` — subscribe to `/.info/serverTimeOffset` and publish it. Two
   lines, yours.
2. `js/app.js` — `serverNow()` and swap it in at the deadline **read** sites.
   Inert until step 1 exists (offset defaults to 0), so it can land first and
   safely. Marc can do this on request.
3. `functions/index.js` — `draftAutopick` requires the server's own `overdue`
   for **timer-fired** calls from everyone, commissioner included; voluntary
   "autopick me now" stays unrestricted via a `reason` on the payload. Yours.

Step 3 is the one that actually makes it impossible for a bad client clock to
drive the room, whatever else drifts. Steps 1–2 make the countdown everyone
*sees* agree.

**Zero-deploy mitigation available today:** both travelling managers check
"Set time automatically" is on. Timezone alone is harmless — `Date.now()` is
UTC — so this only bites when that setting is off.
