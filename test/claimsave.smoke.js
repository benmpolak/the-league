/* Waivergate (Lee, 8 Sept 2026). Thirteen claims lodged on an offline laptop;
 * every one answered "Claim lodged"; none reached the league. Pins:
 *   1. a lodged list is PROVISIONAL on screen until the private node echoes it
 *   2. a failed write rolls the screen back and reports false to the caller
 *   3. a confirmed list shows a tick per request
 *   4. a browser that KNOWS it is offline is refused before any request
 *   5. the claim flow waits for the league before printing a receipt
 * Same stubbed-sync harness as offline.ux.test.js. */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fail = 0, n = 0;
const chk = (name, cond, extra = '') => { n++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !extra ? '' : ' — ' + extra}`); if (!cond) fail++; };
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const p = await browser.newPage();
  p.on('pageerror', e => { fail++; console.log('PAGEERROR', e.message.split('\n')[0]); });
  await p.setRequestInterception(true);
  p.on('request', req => req.url().endsWith('/js/sync.js') ? req.abort() : req.continue());
  await p.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined');
  await p.evaluate(() => {
    window._calls = []; window._resolvers = [];
    window.WCSync = {
      league: 'the-league-2627',
      call: (action, data) => new Promise((resolve, reject) => { window._calls.push({ action, data }); window._resolvers.push({ resolve, reject }); }),
      auth: { user: () => ({ uid: 'u-test', email: 'ben@example.com' }), sendLink: () => Promise.resolve(), completeLink: () => Promise.resolve(false), signOut: () => Promise.resolve() },
    };
    const s = freshState(); s.phase = 'season'; s.draft.order = s.managers.map(m => m.id);
    window.onSharedSnapshot(JSON.parse(JSON.stringify({ phase: s.phase, managers: s.managers, settings: s.settings, draft: s.draft, lineups: {}, transfers: [], trades: [], covenants: [], waiverMeta: s.waiverMeta, adjustments: {}, shirtNums: {}, draftPool: null, windowDraft: null, tradeBlock: {}, benchOrders: {}, lobus: {}, hamCup: null })));
    window.onAuthChanged({ uid: 'u-test', email: 'ben@example.com' });
    window.onMembershipSnapshot({ managerId: 1, role: 'commissioner' });
    window.onPrivateSnapshot({});
    window.__autoConfirm = true;
  });
  await sleep(300);
  const ids = await p.evaluate(() => [PLAYERS[0].id, PLAYERS[1].id, PLAYERS[2].id, PLAYERS[3].id]);

  /* 1 — provisional until echoed */
  await p.evaluate(ids => { window._save1 = setClaims(1, [{ in: ids[0], out: ids[1] }]); }, ids);
  await sleep(50);
  const prov = await p.evaluate(() => ({ calls: window._calls.filter(c => c.action === 'claimSet').length, pend: myClaims(1).map(c => !!c.pending), payloadClean: !('pending' in (window._calls.at(-1).data.claims[0] || {})) }));
  chk('a claimSet request is dispatched', prov.calls === 1, JSON.stringify(prov));
  chk('the list on screen is marked provisional meanwhile', prov.pend.length === 1 && prov.pend[0] === true, JSON.stringify(prov));
  chk('the provisional mark never travels to the server', prov.payloadClean);
  await p.evaluate(() => { transfersView.tab = 'claims'; state.view = 'transfers'; render(); });
  const html1 = await p.evaluate(() => document.body.innerHTML);
  chk('Waiver list shows "saving…" and an amber warning while unconfirmed', /claim-unsaved/.test(html1) && /not yet confirmed by the league/.test(html1));

  /* 2 — failure rolls back and reports false */
  await p.evaluate(() => window._resolvers.shift().reject(new Error('Failed to fetch')));
  await sleep(100);
  const after = await p.evaluate(async () => ({ res: await window._save1, left: myClaims(1).length, toast: document.querySelector('#toast')?.textContent || '' }));
  chk('a failed write reports false to the caller', after.res === false, JSON.stringify(after));
  chk('and the list on screen rolls back to what the league holds (nothing)', after.left === 0, JSON.stringify(after));
  chk('the failure is toasted', /fetch|did not save/i.test(after.toast), after.toast);

  /* 3 — success + echo = ticks */
  await p.evaluate(ids => { window._save2 = setClaims(1, [{ in: ids[0], out: ids[1] }, { in: ids[2], out: ids[3] }]); }, ids);
  await sleep(50);
  await p.evaluate(() => window._resolvers.shift().resolve({ ok: true }));
  const res2 = await p.evaluate(() => window._save2);
  chk('a confirmed write reports true', res2 === true);
  await p.evaluate(ids => window.onPrivateSnapshot({ claims: { [currentGwIndex()]: [{ in: ids[0], out: ids[1], t: 1 }, { in: ids[2], out: ids[3], t: 2 }] } }), ids);
  await sleep(50);
  const html3 = await p.evaluate(() => document.body.innerHTML);
  chk('once echoed, every request carries a saved tick', (html3.match(/claim-saved/g) || []).length === 2 && !/claim-unsaved/.test(html3));
  chk('and the status line says all are saved with the league', /All 2 on this list are saved with the league/.test(html3));

  /* 4 — a browser that knows it is offline is refused before any request */
  const before = await p.evaluate(() => window._calls.length);
  await p.setOfflineMode(true);
  const off = await p.evaluate(() => serverAct('claimSet', { gwIndex: 0, claims: [] }).then(() => 'ok', e => e.message));
  await p.setOfflineMode(false);
  chk('offline browser is refused with a plain message', /offline/i.test(off), off);
  chk('and no request is even attempted', (await p.evaluate(() => window._calls.length)) === before);

  /* 5 — the claim flow itself waits for the league before any receipt */
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const flow = src.slice(src.indexOf("title: 'Lodge this claim?'"), src.indexOf("title: 'Lodge this claim?'") + 900);
  chk('the Claim button awaits setClaims and shows the red sheet on failure before any receipt',
    /const saved = await setClaims\(/.test(flow) && /if \(!saved\) \{ claimFailedSheet\(/.test(flow) && flow.indexOf('claimFailedSheet(') < flow.indexOf('receiptSheet('));
  chk('the red sheet exists and says NOT lodged', /function claimFailedSheet/.test(src) && /Claim NOT lodged/.test(src));

  await browser.close();
  console.log(`\n${n - fail}/${n} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
