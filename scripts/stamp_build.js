#!/usr/bin/env node
/* Stamp a content hash onto every script and stylesheet in index.html.
 *
 * Marc, 17 Sept 2026: "i just see the previous version, the draft list and
 * positions and nothing more" — hours after the deploy had gone green. The
 * tags were plain `js/app.js`, so a browser holding a cached copy kept running
 * it, and the stale-build watchdog could not tell: it compared the SERVER's
 * etag against the server's etag from ten minutes ago and never against the
 * build actually executing. A manager sent to look at something new could be
 * shown the old thing with no signal at all.
 *
 * With `js/app.js?v=<hash of js/app.js>` that cannot happen. A changed file has
 * a URL nobody has ever cached, so the new build is fetched on the next load,
 * always, whatever any cache thinks.
 *
 * The hash is PER FILE and not the commit sha, which matters more than it
 * looks: the FPL refresh deploys every five minutes around the clock, and a
 * commit-sha stamp would give all 800KB of app.js a new URL on every one of
 * them — every manager re-downloading the whole app dozens of times a day on
 * mobile data. Per file, a deploy that only touched data/stats.json leaves
 * every asset URL exactly as it was, and nothing is re-fetched.
 *
 * Runs on the deploy runner AFTER the release gate, which requires a clean
 * checkout — so this must never be run before it, and never committed.
 *
 *   node scripts/stamp_build.js            stamp index.html in place
 *   node scripts/stamp_build.js --check    report what it would do, change nothing
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'index.html');
const CHECK = process.argv.includes('--check');

// src="js/app.js" or href="css/style.css" — same-origin, relative, unstamped.
// Anything absolute or already carrying a query is left alone.
const ASSET = /\b(src|href)="((?!https?:|\/\/|data:)[^"?#]+\.(?:js|css))"/g;

function stamp(html, read) {
  const seen = [];
  const out = html.replace(ASSET, (whole, attr, rel) => {
    let bytes;
    try { bytes = read(rel); } catch { return whole; }   // not ours to stamp
    const v = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    seen.push({ rel, v });
    return `${attr}="${rel}?v=${v}"`;
  });
  return { out, seen };
}

if (require.main === module) {
  const html = fs.readFileSync(PAGE, 'utf8');
  const { out, seen } = stamp(html, rel => fs.readFileSync(path.join(ROOT, rel)));
  if (!seen.length) {
    console.error('[stamp] nothing stamped — index.html has no plain .js/.css tags. Refusing to ship an unstamped build.');
    process.exit(1);
  }
  for (const { rel, v } of seen) console.log(`  ${rel}?v=${v}`);
  if (CHECK) { console.log(`[stamp] ${seen.length} asset(s) would be stamped`); return; }
  fs.writeFileSync(PAGE, out, 'utf8');
  console.log(`[stamp] ${seen.length} asset(s) stamped into index.html`);
}

module.exports = { stamp, ASSET };
