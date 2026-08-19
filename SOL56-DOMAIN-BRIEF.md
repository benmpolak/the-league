# SOL 5.6 BRIEF — CUSTOM DOMAIN ROUND (13 Aug 2026, late)

You are sol 5.6, same rules of engagement as every round (read-only checkout,
run any suite, findings as P0/P1/P2/P3 with repros, one-word verdict). Your
launch-verify round 2 was GO with no findings. Since then ONE thing changed:
the real league moved to a custom domain, **https://theleaguehq.co.uk**,
seven days before draft night. This round audits that move and nothing else.

## What was done (commit `aae7993` + infrastructure)

- DNS at GoDaddy: four A records (@ → 185.199.108–111.153) + CNAME
  www → benmpolak.github.io. GoDaddy's NS/SOA/_domainconnect/_dmarc left.
- Repo Pages: custom domain `theleaguehq.co.uk`, HTTPS enforced, still the
  Actions deploy pipeline (build_type workflow).
- Firebase Auth: `theleaguehq.co.uk` ADDED to authorised domains
  (benmpolak.github.io kept — beta still signs in there).
- Code (`aae7993`): WhatsApp Minutes/preview links → new URL; sign-in email
  landing URL → new URL for the REAL league (sandbox links still land on
  benmpolak.github.io/the-league-beta/?sandbox); functions `DATA_BASE`
  fallback → new URL. Functions DEPLOYED with these changes.
- Docs: CLAUDE.md / MARC-ONBOARDING.md / README carry the new address and
  the root-path rule.

## The structural fact to attack

On the custom domain the app serves from the ROOT path (`/`), where on
github.io it served from `/the-league/`. And the ORIGIN changed, which
resets every per-origin thing: localStorage identity, service-worker
registration and caches, installed-PWA start URLs. github.io 301-redirects
to the new domain (verified: path + intact).

Attack surfaces, in the order I'd rank the risk:

1. **Path assumptions.** Anything that assumed `/the-league/` in a path —
   service worker SHELL list, manifest start_url/scope, fetch paths for
   data/stats/fixtures/history, icon paths, hash routing, the stale-build
   ETag watchdog (checkBuild), hostguard (should be INERT here — it keys on
   the beta path). Relative paths should make all of this Just Work; verify
   rather than trust, ideally by loading the REAL https://theleaguehq.co.uk
   read-only (do NOT sign in, do NOT write) and watching console/network.
2. **Origin-reset fallout.** Old-origin visitors arrive via 301 with empty
   localStorage on the new origin: boot must land them signed-out-clean, not
   wedged on stale-state reconciliation. The service worker from the old
   origin cannot interfere (different origin) — confirm no code assumes a
   registered SW exists. Installed PWAs on the old origin: their start_url
   301s — describe what actually happens rather than guessing.
3. **Sign-in.** The email's landing URL is now the new domain; Firebase
   authorised domains carries it. The completion path (oobCode in query,
   pasted-link rescue, `onAuthLinkResult` toast) must work at the root path.
   Emulator/local verification is fine; flag anything that needs Ben's live
   confirmation (he will send himself a real link — the round need not).
4. **The feed chain.** Functions fetch `DATA_BASE` at runtime (waiverTick,
   mutate validation). The fallback moved to the new domain; the env
   override story (`functions/.env` history — a stale one bit us at UAT)
   deserves a glance: confirm nothing deployed pins the OLD URL, and that a
   github.io fetch would still work anyway via the 301.
5. **Copy honesty.** WhatsApp builders now print the new URL; check no
   user-facing surface still prints the old one (grep the lot). Beta copy
   must still say beta.
6. **Tests.** Suites all green at `aae7993` locally (offline + browser +
   emu). Check none of them pinned the old URL in a way that now passes
   vacuously.

## Out of scope

Everything both launch rounds cleared. GoDaddy's registrar UI. The www
subdomain cert (still provisioning at brief time; apex is enforced-HTTPS).

## Verdict

One word: is the REAL league at theleaguehq.co.uk GO for Thursday?
