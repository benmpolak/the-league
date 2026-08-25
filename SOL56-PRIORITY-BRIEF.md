# Sol brief — waiver priority costs, and Tuesday's UX batch (25 Aug 2026, commits through bbc7e3f, functions deployed)

## The one that matters: using your waiver priority costs it

After the first real run (Tue 25 Aug, 10:07, 23 deals) Marc flagged that
Friday's order had reset to pure reverse-table — a manager who landed three
players walked back in with full priority. His ruling (the league's DF
inheritance): non-takers first in reverse league position, then takers,
fewest takes first.

Implementation (`js/engine.js` waiverOrder, mirrored in `js/app.js`):
reverse-table base, then stable sort by count of ledger transfers with
`waiver: true && gw === transferGw(state)`. Derived, not stored — the count
resets naturally when a round settles and deals start landing in the next
gameweek. Verified against live state: Friday's queue reproduces Marc's
spelled-out list exactly (Duckett, Geller, AJ, Ben, Wilko, BenLevy, Singer,
Lee, Blank, Tussie, Marc, Toby). Five unit checks in
`test/settlement.test.js`; the sim oracle now reads the queue pre-run
(post-run reads were harmless only while the order ignored the ledger).

### Attack it

1. **The gw-bucket boundary.** Takes are keyed on `t.gw === transferGw(state)`.
   Walk a double gameweek, a midweek round, and the window where a round has
   settled but the next deadline hasn't passed. Can a take land in a gw
   bucket that transferGw no longer returns at the NEXT run — wiping the
   cost early, or conversely charging a manager for a take from a previous
   window?
2. **resolveWaivers' internal rotation vs the new starting order.** The run
   rotates winners to the back per landed claim, starting from waiverOrder().
   Are the two composable — i.e., does Tuesday's post-run rotation compose
   with Friday's derived order to the same result the rotation alone would
   have produced? (My check says yes for the live data; break it in general.)
3. **The Friday run itself lands deals in the SAME tgw** those takes are
   counted in. During one run, do early-landed claims alter later priority
   WITHIN the run correctly (they should — that's the rotation), and does
   the ledger-derived count double-charge on the run AFTER Friday (both
   Tuesday's and Friday's takes count while deals still land GW2 — correct
   per Marc's rule? He specified within-window accumulation; confirm the
   Committee reading before flagging it as a bug).
4. **Window Draft records** carry `windowDraft: true` — confirm none also
   carry `waiver: true`, or September's Window Draft will silently charge
   waiver priority.
5. **Server/client parity**: engine takes `toArr(state.transfers)`, app
   iterates the raw array. RTDB array-vs-object shapes — any state where
   the two disagree?

## Also in this batch (client-side)

- Waiver list on its own tab (`tab === 'claims'`, canon name "Waiver list"),
  chip on the Trough page, both signing orders taught in the explainer.
  Handlers were already document-scoped; product smoke #4 re-pinned earlier
  today for the either-way picker.
- Matches page default rolls only after the post-round waiver run
  (`gwStatus final && lastWaiverRun() >= gwClearAt(g)`); My Team still rolls
  at settlement. Check the never-ran edge (lastWaiverRun 0) and the DGW case.
- Vidiprinter dedupe: line identity = gw + pid + cumulative counters for the
  kinds that ticked; vidiPush skips keys already on the 60-line tape. Check:
  a genuine repeat event AFTER the key scrolls off the tape re-prints (fine),
  and a goal+assist in the same diff vs separate diffs produce distinct keys
  that still dedupe their own re-emissions.
- Latest Business card folds at 4 rows (window._bizOpen).

## Verification already run

All offline suites (settlement 19), full browser suite, emulator
rules/functions/livetick 22/341/26 green. Functions deployed post-change.
Friday 10:07 is the next live run.

## Verdict wanted

GO / NO-GO on the priority rule as deployed, before Friday's run.
