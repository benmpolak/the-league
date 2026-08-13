# Welcome to the dev team, Marc

The Committee notes your arrival, without warmth.

This file is for you AND for your AI. If you're using Claude, point it at this
file first — everything it needs is here or in `CLAUDE.md` (the codebase map).

**Addresses (since 13 Aug 2026):** the real league lives at
**https://theleaguehq.co.uk** — a custom domain in front of the same repo;
the old benmpolak.github.io/the-league URL redirects there. On the custom
domain the app serves from the ROOT path (`/`), not `/the-league/`, so never
hardcode either path — links in code should be relative, and the one full
site URL lives in the WhatsApp copy builders. The beta/sandbox is unchanged
at benmpolak.github.io/the-league-beta.

## Getting set up (once, ~10 minutes)

You have a Claude account. That's enough — recommended path:

1. **GitHub invites** — you've been invited to `benmpolak/the-league` and
   `benmpolak/the-league-beta`. Accept both (email from GitHub, or the banner
   on the repo page).
2. **Claude Code** — go to **claude.ai/code** in your browser (zero install),
   or install the Claude desktop app. Sign in with your Claude account and
   connect your GitHub when it asks.
3. Open `benmpolak/the-league` in Claude Code and tell it what you want in
   plain English. It reads the rules itself (`CLAUDE.md` loads automatically),
   makes the changes, runs the tests, and pushes. The site updates within a
   few minutes. If something looks broken afterwards, say so in the group
   chat — Ben's AI reverts it in one command. Nothing is unfixable.

Working locally instead (optional, Mac): install git, clone the repo,
run `python3 -m http.server 8749` from the repo root, and open
`http://localhost:8749/?sandbox&nosync` — the full app, fully offline, and
you can act as any manager including the Chairman.

## Rules of the house (your AI must follow these)

- **Never touch the real league.** No production Firebase writes, no
  authenticating as anyone, no deploys. Server code (`functions/`) can be
  edited in a PR but only Ben deploys it.
- **Test in `?sandbox&nosync`** — fully local, wreck it freely. The shared
  sandbox (beta site) is Toby's test pitch; don't wipe it casually.
- **Vanilla JS, no build step, no frameworks.** Don't add npm packages,
  bundlers, React, or TypeScript. The whole site is static files.
- **Match the voice.** All user-facing copy is dry, in-world,
  Committee-voiced. Read the neighbouring strings before writing new ones.
- **Tests before every push.** `npm run check && npm run test:offline` —
  your AI does this automatically; if it reports failures, don't push.
  One idea per commit, plain-English commit messages.
- The rules PDF is canon. Squad limits, playoff format, scoring — not up for
  reinterpretation in code. Take format arguments to the group chat, where
  they will be minuted and ignored.

## Where to start

- `CLAUDE.md` — the map. Your AI should read it before touching anything.
- Good first territory: copy, UI polish, Data Room ideas, Gazette material —
  the things you've already been requesting by WhatsApp, except now you can
  build them yourself and Ben just reviews.
- Leave for later: `functions/`, `sync.js`, waiver engine — the
  server-authoritative core has seven adversarial audit rounds behind it and
  bites back.
