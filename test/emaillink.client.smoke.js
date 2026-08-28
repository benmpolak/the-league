/* completeLink against the REAL sync.js and the auth emulator (AJ's
 * prompt-on-every-refresh, HANDOFF-GW1 item 3). Every exit path of the
 * magic-link state machine:
 *   1. a fresh link signs in and the one-time code is scrubbed from the URL;
 *   2. THE AJ CASE — a signed-in device reloading the same (now spent,
 *      bookmarked) link is neither prompted nor errored, and the code is
 *      scrubbed again;
 *   3. a signed-out device with a spent code fails once and the code is
 *      scrubbed, so it can never nag again;
 *   4. cancelling the prompt leaves the URL intact for a retry this session;
 *   5. the paste-a-link rescue path still throws its friendly error.
 * Runs inside test:emu (needs auth/db/functions emulators); serves the real
 * site on a side port and drives it with ?emu, so the code under test is the
 * shipped module, not a stub. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const T = require('./testenv.js');

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SITE_PORT = 8129;
const ROOT = path.join(__dirname, '..');
const LG = 'the-league-2627';
const EMAIL = 'aj@test.local';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };
function serveSite() {
  const server = http.createServer((req, res) => {
    let rel = req.url.split('?')[0];
    if (rel === '/') rel = '/index.html';
    const p = path.join(ROOT, rel);
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  });
  return new Promise(resolve => server.listen(SITE_PORT, '127.0.0.1', () => resolve(server)));
}

// a REAL sign-in link for our app: request an oob code, read it from the
// emulator inbox, and rebuild the action params onto the app's own URL (the
// emulator's action page would do the same via continueUrl redirect)
async function freshLink() {
  await fetch(`http://${T.AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'EMAIL_SIGNIN', email: EMAIL, continueUrl: `http://127.0.0.1:${SITE_PORT}/?emu=127.0.0.1` }),
  });
  const inbox = await (await fetch(`http://${T.AUTH_HOST}/emulator/v1/projects/${T.PROJECT}/oobCodes`)).json();
  const code = [...(inbox.oobCodes || [])].reverse().find(c => c.email === EMAIL && c.requestType === 'EMAIL_SIGNIN');
  if (!code) throw new Error('no oob code for ' + EMAIL);
  return `http://127.0.0.1:${SITE_PORT}/index.html?emu=127.0.0.1&mode=signIn&oobCode=${encodeURIComponent(code.oobCode)}&apiKey=fake`;
}

(async () => {
  const run = T.makeRunner('emaillink-client');
  const { chk } = run;
  await T.wipe();
  await T.provision(LG, [
    { managerId: 1, email: 'chair@test.local', role: 'commissioner' },
    { managerId: 7, email: EMAIL },
  ]);
  const site = await serveSite();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });

  const newPage = async (ctx, { emailKey = null } = {}) => {
    const p = await ctx.newPage();
    p.on('pageerror', () => { /* app boot noise is not under test here */ });
    await p.evaluateOnNewDocument(key => {
      window.__prompts = 0;
      window.prompt = () => { window.__prompts++; return null; }; // cancel
      if (key) localStorage.setItem('tl-auth-email', key);
    }, emailKey);
    return p;
  };
  const settle = async p => {
    // wait for completeLink's boot invocation to fully resolve: either a user
    // appears, or the URL is scrubbed, or 3s pass (the cancel path changes
    // neither) — then read the state of the world
    await p.waitForFunction(
      () => window.WCSync && (WCSync.auth.user() || !/oobCode/.test(location.search) || window.__settleTimeout),
      { timeout: 8000 }
    ).catch(() => {});
    return p.evaluate(() => ({
      signedIn: !!window.WCSync?.auth.user(),
      email: window.WCSync?.auth.user()?.email || null,
      search: location.search,
      prompts: window.__prompts,
    }));
  };

  /* ── 1: a fresh link signs the device in and scrubs the code ── */
  const ctx = await browser.createBrowserContext();
  const link = await freshLink();
  const p1 = await newPage(ctx, { emailKey: EMAIL });
  await p1.goto(link, { waitUntil: 'domcontentloaded' });
  await p1.waitForFunction(() => window.WCSync && WCSync.auth.user(), { timeout: 8000 });
  const s1 = await settle(p1);
  chk('fresh link signs in as the manager', s1.signedIn && s1.email === EMAIL, JSON.stringify(s1));
  chk('fresh link: one-time code scrubbed from the URL', !/oobCode/.test(s1.search), s1.search);
  chk('fresh link: no email prompt needed', s1.prompts === 0, `prompts=${s1.prompts}`);
  await p1.close();

  /* ── 2: THE AJ CASE — same device, same (spent) link, signed in ── */
  const p2 = await newPage(ctx); // same context: persisted session, no EMAIL_KEY
  await p2.goto(link, { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => window.WCSync && WCSync.auth.user() && !/oobCode/.test(location.search), { timeout: 8000 }).catch(() => {});
  const s2 = await settle(p2);
  chk('AJ case: still signed in, NOT prompted', s2.signedIn && s2.prompts === 0, JSON.stringify(s2));
  chk('AJ case: bookmarked spent code scrubbed silently', !/oobCode/.test(s2.search), s2.search);
  // and a third load of the scrubbed URL stays quiet too
  const p2b = await newPage(ctx);
  await p2b.goto(`http://127.0.0.1:${SITE_PORT}/index.html?emu=127.0.0.1`, { waitUntil: 'domcontentloaded' });
  // A clean URL is already "scrubbed", so settle()'s generic URL condition
  // would return before Firebase's asynchronous persisted-session callback.
  // Wait for the state this case is actually proving; otherwise a fast test
  // runner invents a sign-out that never occurred.
  await p2b.waitForFunction(() => window.WCSync && WCSync.auth.user(), { timeout: 8000 }).catch(() => {});
  const s2b = await settle(p2b);
  chk('AJ case: subsequent clean loads stay quiet', s2b.signedIn && s2b.prompts === 0, JSON.stringify(s2b));
  await p2.close(); await p2b.close();

  /* ── 3: signed OUT with a spent code — fails once, scrubs, stops nagging ── */
  const ctx3 = await browser.createBrowserContext(); // fresh profile: no session
  const p3 = await newPage(ctx3, { emailKey: EMAIL }); // knows the email, so no prompt
  await p3.goto(link, { waitUntil: 'domcontentloaded' }); // link long spent
  await p3.waitForFunction(() => !/oobCode/.test(location.search), { timeout: 8000 }).catch(() => {});
  const s3 = await settle(p3);
  chk('spent code signed out: does not sign in', !s3.signedIn, JSON.stringify(s3));
  chk('spent code signed out: code scrubbed so it cannot nag again', !/oobCode/.test(s3.search), s3.search);
  await p3.close();

  /* ── 4: cancelling the prompt leaves the URL intact for a retry ── */
  const link4 = await freshLink();
  const ctx4 = await browser.createBrowserContext();
  const p4 = await newPage(ctx4); // no EMAIL_KEY → prompt → our stub cancels
  await p4.goto(link4, { waitUntil: 'domcontentloaded' });
  await p4.waitForFunction(() => window.__prompts > 0, { timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 400)); // let any (wrong) scrub land
  const s4 = await settle(p4);
  chk('cancel: prompted exactly once', s4.prompts === 1, `prompts=${s4.prompts}`);
  chk('cancel: not signed in, URL kept for an in-session retry', !s4.signedIn && /oobCode/.test(s4.search), JSON.stringify(s4));

  /* ── 4b: sol P2 — a WRONG saved email must not trap a good link ── */
  const link4b = await freshLink();
  const ctx4b = await browser.createBrowserContext();
  const p4b = await newPage(ctx4b, { emailKey: 'wrong@lt.local' });
  await p4b.goto(link4b, { waitUntil: 'domcontentloaded' });
  await p4b.waitForFunction(() => window.__prompts > 0, { timeout: 8000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 400));
  const s4b = await p4b.evaluate(() => ({
    signedIn: !!window.WCSync?.auth.user(), prompts: window.__prompts,
    search: location.search, key: localStorage.getItem('tl-auth-email'),
  }));
  chk('wrong saved email: re-prompts instead of silently looping', s4b.prompts === 1, JSON.stringify(s4b));
  chk('wrong saved email: suspect key dropped, link kept alive', s4b.key === null && /oobCode/.test(s4b.search) && !s4b.signedIn, JSON.stringify(s4b));
  await p4b.close();
  // the same link then works with the right email — it was never burned
  const p4c = await newPage(ctx4b, { emailKey: EMAIL });
  await p4c.goto(link4b, { waitUntil: 'domcontentloaded' });
  await p4c.waitForFunction(() => window.WCSync && WCSync.auth.user(), { timeout: 8000 }).catch(() => {});
  const s4c = await settle(p4c);
  chk('wrong saved email: the rescued link still signs in with the right one', s4c.signedIn && s4c.email === EMAIL, JSON.stringify(s4c));
  await p4c.close();

  /* ── 5: the paste-a-link rescue path keeps its friendly error ── */
  const s5 = await p4.evaluate(() =>
    WCSync.auth.completeLink('https://example.com/definitely-not-a-link')
      .then(() => ({ threw: false }))
      .catch(e => ({ threw: true, msg: String(e.message || e) })));
  chk('paste path: non-link throws the friendly error', s5.threw && /paste the whole link/.test(s5.msg), JSON.stringify(s5));
  await p4.close();

  await browser.close();
  site.close();
  run.done();
})().catch(e => { console.error(e); process.exit(1); });
