# SOL 5.6 — GW1 DEADLINE VERIFICATION (SCOPED)

**This is NOT a re-audit.** You cleared the matchday machinery — lineup lock,
trough shutter, vidiprinter, live lane, auto-subs, settle, the Tuesday waiver
seam — in SOL56-GW1-EVE-BRIEF.md, and none of that code has changed since.
Do not re-walk it except where §3 points you at it.

**Clock.** GW1 lineups lock 18:30 London today (21 Aug), first kick 20:00,
GW1 ends Mon 24th ~22:00, first waiver run Tue 25th 10:00.

**What has landed since your audit at `3d99a94`,** all live, and the two
functions items are **DEPLOYED TO PRODUCTION**:

| ref | what | risk surface |
|---|---|---|
| e59140c | Marc's Trough watchlist — new `watchlistSet` callable, private per uid, `watchlists` added to SHARED_KEYS | server, private data |
| bccb33e | my `importState` fix: `watchlists` allowed, shape-checked, fanned to private nodes, **excluded from the public node** | server, restore path |
| 5c8e674 | identity race: `onAuthChanged` now fires BEFORE the private/membership reads attach | sign-in |
| ecc3a03, f885dd5, 4b1c389 | Gazette: Warner lead, Dev & Dev, front-page order | presentation |
| a5009ce, e84e6ff | podcast: GW1 previews rendered, back catalogue, 8 orphaned takes deleted | presentation, assets |
| 6470e27 | Gazette unread nudge / nav dot / share button, `${LS_NS}-gazette-seen` | presentation, localStorage |

## 1. The deployed server changes (priority)
- `watchlistSet`: can a manager write another's watchlist? Can a watchlist
  reach `public/` by ANY route — import, export, draftAdmin:start, reset,
  restore stash, backup? A watchlist is a lens and must grant nothing:
  prove no read path lets it influence a sign, claim, draft or trade.
- `importState` with `watchlists`: round-trip an export end to end. My pins
  cover private landing, unknown player, dupes, oversize and never-in-public
  (functions 334). Attack what they miss — array-coercion of the map,
  managers whose uid is absent from `managerUid`, a 300-entry list per
  manager × 12, and interaction with `resetLeague` / `resetRestore`.
- **The honest gap:** Marc could not run the emulator (house rules put
  `functions/` off-limits to him), which is exactly why the import break
  shipped. Assume there are more consequences of `watchlists` joining
  SHARED_KEYS that neither of us has thought of.

## 2. THE TROUGH CONTROL — the Chairman's question, answer it explicitly
Live state is `waiverMeta.control = "open"`. In `onWaiversServer` (and the
client mirror `onWaivers`) the manual-open branch is evaluated BEFORE the
gameweek shutter:

```
if (ctl === 'open') return false;   // signable
if (!tw.open) return true;          // never reached
```

So a standing "thrown open" appears to **survive the gameweek shutter** —
signings would remain possible after 18:30 and throughout GW1, while the
mock/chamber clock DOES outrank it (sol mock-night P1) and fresh drops stay
waiver-locked (Toby, 9 Aug).

Rule on it: (a) is that reading correct, (b) is it intended — should a manual
open be a standing override or a one-session convenience that a gameweek
start cancels, (c) what else does `control: 'open'` bypass that the Committee
has not considered (Ham Cup freeze, arrival locks, waiver order, the Tue run
clearing `lastRun`)? If it is a bug, fix it; if it is a policy choice, say so
plainly so the Chairman can decide before 18:30. **The immediate mitigation
— setting control back to `auto` — is already with Ben; do not write to the
live league yourself.**

## 3. Narrow re-checks of already-cleared machinery
Only these, only because today's commits touch their neighbourhood:
- Sign-in on a cold device and a second concurrent device (5c8e674 reordered
  auth callbacks; a manager who cannot sign in before 18:30 cannot set a
  team). Include the iOS PWA-vs-Safari separate-storage case and a
  single-use link reused on a second device.
- The dashboard at 390px with the new nudge present AND absent, benches on
  both mini pitches, no layout regression in "Needs your attention".
- `${LS_NS}-gazette-seen`: can a stale or hostile value wedge the dashboard?
  Does the nudge ever promise a headline the edition does not carry?

## 4. Assets
- 8 audio files were deleted as orphans after a re-render changed draft-episode
  wording. Confirm nothing in `index.json` / `rendered.json` now points at a
  missing file, the back catalogue opens every episode it lists, and P13/P13b/
  P13c are honest.
- **Known design smell, not yet fixed:** episode scripts re-derive from live
  state, so a transfer can silently orphan paid-for audio and drop lines back
  to the robot voice. Assess severity and propose the fix (pin published
  episodes to a snapshot?) — do NOT build it today.

## Rules of engagement
Fix what you find, one finding per commit, full suites green before each push
(`npm run check`, `test:offline`, `test:browser`, and **`test:emu` for
anything touching `functions/`** — Java needs
`PATH="/opt/homebrew/opt/openjdk/bin:$PATH"`). You may edit `functions/` but
**never deploy** — list deploys owed. Never write to the live Firebase league
or any secret. Anything you are not certain is a clean fix, write up instead.

## Verdicts wanted, in this order
1. **Is anything shipped today capable of stopping a manager setting their
   team before 18:30, or corrupting GW1 scoring?** This is the only question
   that matters in the next three hours — answer it first and separately.
2. Is the Trough control behaviour a bug or a policy choice?
3. Is the live client safe through the weekend to Tuesday's waiver run?
