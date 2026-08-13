# SOL 5.6 BRIEF — LAUNCH READINESS: DRAFT NIGHT AND GAMEWEEK 1 (13 Aug 2026)

Same rules of engagement as always: read-only checkout, run any suite,
findings as P0/P1/P2/P3 with repros, one-word verdicts at the end. Your
test-night R3 asks were all closed at `ec0f709` and deployed. Since then a
LOT has landed in three days. This is the last full audit before the league
goes live: draft pick order is chosen Sunday, the draft follows, then GW1.

**The question:** is this build ready to run a real draft night and a real
gameweek for twelve managers who will never read a runbook? Verdict for the
REAL league; verdict for the sandbox; and your list of anything the Chairman
must do by hand before Sunday.

**Priorities (Ben, 13 Aug):** THE DRAFT, THE WAIVERS and THE MATCHES are
the league. Spend your depth on §2 and §6 — the full arc from draft night
through a played gameweek to the run that clears it: lineups locking at
kickoff, live scores landing, auto-subs off the ordered bench, the round
settling FINAL with the right points for all twelve, H2H table updating,
then Tuesday's waiver run adjudicating on those settled scores. Every
interleaving you can construct. Everything else (§1, §3, §4, §5) is audited
to ONE standard: can it corrupt, block or mis-score the draft, the matches,
the waiver ledger, squads or points? Cosmetic findings in those sections are
P3s at best; a crest that can wedge `render()` on draft night is a P0.

Suites: `npm run check`, `npm run test:offline` (needs `python3 -m http.server
8125` for parity), `npm run test:browser`, and the emulator suite with
`PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npm run test:emu`. All green at
this commit: functions 318, rules 22, backup 23, provision 13, emaillink 18,
waiverclock 35 (rewritten — see §2), browser smokes full.

State of production: functions deployed 13 Aug (all four), Pages current,
beta mirrors automatically (`.github/workflows/mirror.yml`). All twelve
managers provisioned on BOTH leagues with their real emails.

---

## 1. Marc's transfers batch (merged `6057b6e`, server half deployed)

Four fixes from Toby's sandbox session: the transfer-out dropdown follows
pitch taps (`transfersView.out` is what signs, the select used to lie);
delist works after selling a listed player (`blockToggle` gates LISTING only
now); an unknown player id in a cloud snapshot stubs instead of killing
`render()` (the load path always stubbed, the snapshot path never did); Free
agents means signable-now, not merely unowned.

Attack: the dropdown/pitch/sign three-way for a desync that still ships the
wrong player out; delist of a player you never owned (should still refuse);
whether the stub path leaves a repairable save or a permanently stubbed one
after the feed catches up; the Free agents / On waivers / Everyone filter
boundaries in the hours after a gameweek.

## 2. THE WAIVER CLOCK V2 + the Chairman's skip (`589d63c`, deployed) — biggest change, hardest look

Committee decision 12 Aug: runs are now 10:00 Europe/London every TUESDAY
and FRIDAY (was fixture-anchored 8pm post/pre). One-shot skip: `waiverSkip`
action writes `waiverMeta.skip = 'wv-YYYY-MM-DD'`; the scheduled runner marks
that slot done-`skipped: chairman` in the ledger and clears the flag; claims
roll over; the trough stays SHUT until a real run (deliberate — reopening
would let free signings jump the rolled-over queue); `resolveWaivers` spends
a stale skip a real run has overtaken. `WAIVER_EPOCH` (13 Aug) stops the
14-day lookback resurrecting anything at deploy; first-ever slot is Fri 14
Aug 09:00Z. Trough clearing anchor is now `gwClearAt` = first slot after a
gameweek's last kick-off. Engine exports changed (`postRunAt`/`preRunAt`
gone). `test/waiverclock.test.js` was REWRITTEN for the new clock — audit the
new pins for honesty, they were written by the same hand as the code.

Attack: DST arithmetic either side of the October clock change; a Tuesday
slot falling MID double-gameweek (runs anyway by design — claims lodged
before kickoff process mid-round: is `transferGw` clamping actually right for
that?); skip set for a slot that is already due-but-unticked; skip + manual
run-now the same morning; skip + control flipped off auto (which wins the
ledger entry); two skips in a row (flag is one-shot — second skip needs a
second press, does the UI make that true?); the old `gwN-post` ledger ids
coexisting with `wv-` ids; the CLIENT mirror in app.js drifting from the
engine (they are separate implementations — diff them line by line); the
legacy CI runner `.github/workflows/waivers.yml` (gated off `LEGACY_WAIVERS`,
variable unset — confirm it cannot fire on the old Tue/Fri cron it still
carries). And the calendar truth: with the REAL 26/27 fixture list, is there
any gameweek whose first kick-off is before Friday 10am on its own Friday?

## 3. The crest builder (`8c90b0b`, deployed)

The College of Arms: `crest = {shape 0-3, div 0-5, charge 0-15|null, c1, c2}`
on `public/managers`, null = house-issue monogram. Catalogues in `js/lore.js`
(charges carry raw SVG markup with `__C__`/`__F__` tokens); `crestSvgRaw` in
app.js renders them inside a hairline field-colour outline; `cleanCrest` in
functions mirrors the bounds, counts pinned by the suite; `importState`
validates crests too.

Attack: the injection surface — charge markup is catalogue-only, but confirm
nothing user-controlled reaches the SVG unescaped (monogram comes from team
name; colours regex-validated; svg clipPath ids are derived — collisions
between two crests on one page?); a crest with `charge: 16` or `div: -1` via
raw `mutate` call; an imported state carrying a hostile crest; RTDB dropping
`charge: null` on write (render must treat missing as monogram).

## 4. Sandbox identity + navigation (cherry-picked 13 Aug)

The sandbox app installs as League SANDBOX with a cyan crest (manifest
swapped by `hostguard.js` before the browser reads it); "Go to the real
site" on the beta host now leaves the host instead of looping; the sign-in
and not-linked cards name WHICH league you are standing at (separate
membership lists, shared sign-in — being known in one looked like a broken
login in the other); the paste-the-link rescue is always on the sign-in card.

Attack: hostguard regressions above all — it runs during parse on every
load; any path where the new URLSearchParams logic redirect-loops or strips
`?demo`/`?emu`; the manifest swap under CSP; whether an installed OLD sandbox
app (pre-rename) still lands in the sandbox after the changes.

## 5. Ops changes to verify cold

All twelve managers provisioned live with real emails (two commissioners:
Ben, Toby). Ric's email was CORRECTED after first provisioning — his old
auth user was pruned and a new uid provisioned. Confirm the prune left
nothing stranded: no membership, no `private/` tree, no claims, and the
`managerUid` map rebuilt, in BOTH leagues. Then the boring gold: sign-in
link delivery paths (`requestSignInLink` rate limits), the email-link tests,
and whether a manager who has never opened the site can get from a WhatsApp
link to a named, linked manager on one phone with zero Chairman
intervention.

## 6. The launch question itself

Draft night: twelve devices, the ready room, the ceremony, the clock, picks,
undo, autodraft for whoever's phone dies. GW1: lineups lock at kickoff,
live scores, the Tuesday run after it. You have GO'd the real league before
(R7, 26 Jul) — but that was two hundred commits ago. Walk the whole
draft-to-first-waiver arc on the emulator plus the sandbox and either GO it
again or name the blocker. List every runbook item the Chairman must do by
hand before Sunday (the R7 list had: all twelve signed in on their draft
device BEFORE the ceremony — does anything new join that list? e.g. kill the
demo button? confirm the skip button is Chairman-only on every path?).

Findings as always. One-word verdicts: REAL LEAGUE / SANDBOX. Then the
runbook.
