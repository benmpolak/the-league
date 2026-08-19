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

### Decisions for you

**1. `roomOpen` — the Chairman's force-start** (`functions/index.js:555`).
Marks *every* manager ceremony-ready and arms the clock in one transaction.
Built so a no-show can't wedge the room forever, and that reason is still good.
Marc's suggestion is to make the ceremony mandatory. Straight removal is the
one option I'd argue against — it leaves no escape hatch on a night when
someone's phone dies.

*Recommended:* keep it, but make it loud and narrow.
- Only mark through the managers who have **not** acknowledged, and name them
  in the confirm sheet ("Start without Marc and Ian?").
- Record who was force-started, and say so on everyone's screen — right now
  the other eleven get no explanation for why the pomp vanished.
- Absentees still autopick when their clock dies, which already works.

**2. `autoComplete` — sandbox "Skip the draft"** (`functions/index.js:577`).
Has **no ceremony check at all**; it fills the board regardless. This is what
Toby hit. Sandbox-only so the stakes are low, but it should either refuse
before the ceremony completes or mark everyone through the way `roomOpen`
does, so the state stays coherent.

**3. A question only you and Marc can settle.** "Everyone has *reported*" and
"everyone has *seen* it" are different rules. **Skip ceremony (Ian's button)**
still counts you as through — you just didn't watch. If mandatory means
mandatory, Ian's button goes. If it means "nobody starts without you", it can
stay. The code currently implements the second.

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

### This also explains Marc's "first pick manual, then it started skipping"

While *your* device still had the ceremony overlay up, its clock interval
returned early (`js/app.js:4979`) and **nothing enforced the clock** — so
Marc's first pick was unhurried and worked. The moment you clicked through your
pomp, your device started policing every deadline, and skew turned "at zero"
into "immediately". Same root as Issue 1(b), seen from the other side.

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
