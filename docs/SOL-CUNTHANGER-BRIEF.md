# Sol audit brief — Cunthanger Media (live 4 Sep 2026)

You are auditing a feature that went LIVE on https://theleaguehq.co.uk this morning
for twelve real managers. Repo: ~/the-league, branch main (commits 80628ea..HEAD).
Read CLAUDE.md first. Do NOT read app.js top to bottom; grep.

## What shipped
- js/cunthanger.js — the engine: deterministic feed (fan accounts, 14 spoof journalists,
  Matt Le Tus), the press-room question generator, reaction mix for manager posts.
- js/lore.js — CUNTHANGER_* banks.
- app.js — cunthangerEvents/Posts/Block/Sheet/Takeover, the Cunthanger Media card
  (programmeCard), press room (presserCtx, pressRoomSheet, sendPresser, sendPost,
  pressersOpen), pressConferenceSection + pressReceipts in the paper, meId(),
  handleOf()/cleanHandle(), club-office handle field, dashboard nudges, SHARED_KEYS
  now include 'pressers' and 'posts'. cunthanger.js loads BEFORE app.js.
- functions/index.js — ACTIONS.post, ACTIONS.presser, clubSet accepts `handle`.
- gazette.js — managerInFocus, sackRace, pressReceipts hook. COMMISSIONS[3].

## Verdict wanted: GO / NO-GO for the twelve, P0/P1/P2 list. Focus, in order:
1. Real-league sync: a post or presser written by the server under public/posts and
   public/pressers — does every other phone receive it (applySharedSnapshot, SHARED_KEYS,
   sync.js)? Is there any path where the client's local save() clobbers or drops them?
2. Identity: meId() and the press room. Can a spectator, the Chairman acting-as, or a
   signed-out visitor post as someone else? Can a manager redo a presser client-side?
3. The takeover alert (cunthangerTakeover): once per device, never in demo/nosync/test,
   never over another overlay. Check interaction with the sign-in card and the PWA.
4. Determinism: same state → identical feed on every device (no Date.now()/Math.random
   in content). cunthangerEvents uses Date.now() for WINDOWS only — confirm nothing else.
5. Escaping: every manager-typed string (posts, presser own words, handle) is esc()'d at
   render, in the feed, the nudges, the paper, the club office.
6. The paper: pressConferenceSection/pressReceipts/managerInFocus/sackRace must never
   throw (they wrap in try) and never claim a fact state does not support.
7. Mobile at 390px: the Cunthanger Media card, the feed sheet, the press-room sheet.
8. Performance: cunthangerPosts() is cached per render (_chCache); check it is not
   rebuilt in loops (e.g. inside programmeCard + nudge + sheet on one render).

Tests: npm run check && npm run test:offline (8125 server needed for sim) and
npm run test:emu (PATH=/opt/homebrew/opt/openjdk/bin, python3 -m http.server 8126).
Write findings to docs/SOL-CUNTHANGER-VERDICT.md. Fix nothing on main yourself.
