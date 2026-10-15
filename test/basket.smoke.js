/* The basket (Marc, 13 Oct 2026: "you should be able to do multiple trough
 * picks at the same time"). Pins:
 *   1. + puts a line in the basket with the man marked on the pitch, and
 *      unmarks him; his chip and the row say so
 *   2. + with nobody marked asks who makes way, from the squad the basket
 *      leaves — a man already going out is not offered twice
 *   3. a line that breaks the squad limits is refused at the door
 *   4. Sign all sends one troughSign per line, top first, one at a time
 *   5. a refusal stops the run: what landed stands, the rest stays in the
 *      basket, the receipt says where it stopped
 *   6. a line that can no longer land blocks Sign all until it is taken out
 * Same stubbed-sync harness as claimsave.smoke.js. */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fail = 0, n = 0;
const chk = (name, cond, extra = '') => { n++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !extra ? '' : ' — ' + extra}`); if (!cond) fail++; };
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const p = await browser.newPage();
  p.on('pageerror', e => { fail++; console.log('PAGEERROR', e.message.split('\n')[0]); });
  await p.setViewport({ width: 1100, height: 900 });
  await p.setRequestInterception(true);
  p.on('request', req => req.url().endsWith('/js/sync.js') ? req.abort() : req.continue());
  await p.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined');
  await p.evaluate(() => {
    // troughSign answers at once, unless told to hold or to refuse one call
    window._calls = []; window._hold = false; window._held = []; window._refuseCall = 0;
    window.WCSync = {
      league: 'the-league-2627',
      call: (action, data) => new Promise((resolve, reject) => {
        window._calls.push({ action, data });
        const k = window._calls.filter(c => c.action === 'troughSign').length;
        if (action === 'troughSign' && k === window._refuseCall) { reject(new Error('Toby got there first')); return; }
        if (window._hold) window._held.push(resolve); else resolve({ ok: true, tgw: transferGw() });
      }),
      auth: { user: () => ({ uid: 'u-test', email: 'ben@example.com' }), sendLink: () => Promise.resolve(), completeLink: () => Promise.resolve(false), signOut: () => Promise.resolve() },
    };
    const s = freshState(); s.phase = 'season'; s.draft.order = s.managers.map(m => m.id);
    let n = 0;
    for (const [pos, want] of [['GK', 2], ['DF', 5], ['MF', 5], ['FW', 2]]) {
      for (const q of PLAYERS.filter(x => x.pos === pos).slice(0, want)) {
        s.draft.picks.push({ managerId: 1, playerId: q.id, code: q.code ?? null, n: ++n });
      }
    }
    window.onSharedSnapshot(JSON.parse(JSON.stringify({ phase: s.phase, managers: s.managers, settings: s.settings, draft: s.draft, lineups: {}, transfers: [], trades: [], covenants: [], waiverMeta: s.waiverMeta, adjustments: {}, shirtNums: {}, draftPool: null, windowDraft: null, tradeBlock: {}, benchOrders: {}, lobus: {}, hamCup: null })));
    window.onAuthChanged({ uid: 'u-test', email: 'ben@example.com' });
    window.onMembershipSnapshot({ managerId: 1, role: 'commissioner' });
    window.onPrivateSnapshot({});
    window.__autoConfirm = true;
    // the Trough open, whatever today's date makes of the fixture clock
    troughWindow = () => ({ open: true });
  });
  await sleep(300);
  const ids = await p.evaluate(() => {
    const sq = squadAt(1, transferGw());
    const owned = ownedIdsAt(transferGw());
    const free = pos => PLAYERS.filter(x => x.pos === pos && !owned.has(x.id) && !arrivalLocked(x) && !hasLeft(x));
    const mine = pos => sq.filter(x => x.pos === pos);
    return { mf: free('MF').slice(0, 3).map(x => x.id), fw: free('FW')[0].id, myMf: mine('MF').map(x => x.id), myGk: mine('GK').map(x => x.id), myFw: mine('FW').map(x => x.id) };
  });
  // put one man on screen and press his + (or ✓)
  const plus = id => p.evaluate(async id => {
    state.view = 'transfers'; transfersView.tab = 'trough'; transfersView.scope = 'avail';
    transfersView.q = PLAYER_BY_ID[id].name; render();
    const b = document.querySelector(`#trResults [data-trbasket="${id}"]`);
    if (!b) return 'no button';
    b.click(); await new Promise(r => setTimeout(r, 120));
    return 'ok';
  }, id);

  /* 1 — the marked man goes into the line, and is unmarked */
  await p.evaluate(out => { transfersView.out = out; }, ids.myMf[0]);
  chk('a free man has a + beside Sign', await plus(ids.mf[0]) === 'ok');
  const one = await p.evaluate(out => ({
    basket: transfersView.basket.map(l => [l.in, l.out]), out: transfersView.out,
    chip: document.querySelector(`[data-trout="${out}"]`)?.classList.contains('in-basket'),
    card: document.querySelector('#trBasket')?.textContent.replace(/\s+/g, ' ') || '',
  }), ids.myMf[0]);
  chk('+ lodges the line with the man marked on the pitch', JSON.stringify(one.basket) === JSON.stringify([[ids.mf[0], ids.myMf[0]]]), JSON.stringify(one));
  chk('and unmarks him — he is spoken for', one.out === null);
  chk('his chip shows he is going out in the basket', one.chip === true);
  chk('the basket card appears with a Sign all button', /Your basket/.test(one.card) && /Sign all 1/.test(one.card), one.card);
  await p.evaluate(id => { transfersView.q = PLAYER_BY_ID[id].name; render(); }, ids.mf[0]);
  chk('his row now carries the tick, not the +', await p.evaluate(id => document.querySelector(`#trResults [data-trbasket="${id}"]`)?.textContent.trim() === '✓', ids.mf[0]));

  /* 2 — nobody marked: ask, but never offer a man already going out */
  await plus(ids.mf[1]);
  const two = await p.evaluate(() => transfersView.basket.map(l => [l.in, l.out]));
  chk('+ with nobody marked still lodges a line', two.length === 2 && two[1][0] === ids.mf[1], JSON.stringify(two));
  chk('and does not send the same man out twice', two[1][1] !== ids.myMf[0], JSON.stringify(two));

  /* 3 — a line that breaks the limits is refused */
  // two forwards is the floor, and nothing in the basket brings one in
  await p.evaluate(fw => { transfersView.out = fw; }, ids.myFw[0]);
  await plus(ids.mf[2]);
  const three = await p.evaluate(() => ({ n: transfersView.basket.length, toast: document.querySelector('#toast')?.textContent || '' }));
  chk('a line that breaks the squad limits is refused', three.n === 2, JSON.stringify(three));
  chk('and says why', /position limits/.test(three.toast), three.toast);
  await p.evaluate(() => { transfersView.out = null; });

  /* 4 — Sign all: one troughSign per line, top first, one at a time */
  await p.evaluate(() => { window._calls = []; window._hold = true; document.querySelector('#bkGo').click(); });
  await sleep(150);
  const firstOnly = await p.evaluate(() => window._calls.filter(c => c.action === 'troughSign').map(c => [c.data.inId, c.data.outId]));
  chk('Sign all sends the first line and waits for the league', firstOnly.length === 1 && firstOnly[0][0] === ids.mf[0] && firstOnly[0][1] === ids.myMf[0], JSON.stringify(firstOnly));
  chk('meanwhile the card says it is working, with no buttons to press twice', await p.evaluate(() => /Signing your basket/.test(document.querySelector('#trBasket')?.textContent || '') && !document.querySelector('#bkGo')));
  await p.evaluate(() => { window._hold = false; window._held.shift()({ ok: true }); });
  await sleep(250);
  const all = await p.evaluate(() => ({
    calls: window._calls.filter(c => c.action === 'troughSign').map(c => [c.data.inId, c.data.outId]),
    basket: transfersView.basket.length,
    receipt: document.querySelector('[aria-label="Basket receipt"]')?.textContent.replace(/\s+/g, ' ') || '',
  }));
  chk('then the second, in the order the basket was built', all.calls.length === 2 && all.calls[1][0] === ids.mf[1], JSON.stringify(all.calls));
  chk('a clean run empties the basket', all.basket === 0, JSON.stringify(all));
  chk('and the receipt says all were signed', /All 2 signed/.test(all.receipt), all.receipt);
  await p.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.remove()));

  /* 5 — a refusal stops the run where it happens */
  await p.evaluate(ids => {
    transfersView.basket = [{ in: ids.mf[0], out: ids.myMf[0] }, { in: ids.mf[1], out: ids.myMf[1] }, { in: ids.mf[2], out: ids.myMf[2] }];
    window._calls = []; window._refuseCall = 2; render();
    document.querySelector('#bkGo').click();
  }, ids);
  await sleep(400);
  const part = await p.evaluate(() => ({
    calls: window._calls.filter(c => c.action === 'troughSign').length,
    left: transfersView.basket.map(l => l.in),
    receipt: document.querySelector('[aria-label="Basket receipt"]')?.textContent.replace(/\s+/g, ' ') || '',
  }));
  chk('a refusal stops the run — the third line is never sent', part.calls === 2, JSON.stringify(part));
  chk('what landed leaves the basket, the refused and untried lines stay', JSON.stringify(part.left) === JSON.stringify([ids.mf[1], ids.mf[2]]), JSON.stringify(part.left));
  chk('the receipt says how many went through and where it stopped', /1 of 3 signed/.test(part.receipt) && /Toby got there first/.test(part.receipt) && /not tried/.test(part.receipt), part.receipt);
  await p.evaluate(() => { window._refuseCall = 0; document.querySelectorAll('.overlay').forEach(o => o.remove()); });

  /* 6 — a line that can no longer land blocks Sign all */
  await p.evaluate(ids => {
    transfersView.basket = [{ in: ids.mf[0], out: ids.myMf[0] }];
    const gone = state.draft.picks.find(x => x.managerId !== 1)?.playerId;
    // somebody else signs our man before we press the button
    state.transfers = [...toArr(state.transfers), { managerId: 2, outId: gone ?? ids.myGk[1], inId: ids.mf[0], gw: transferGw(), n: 1, t: Date.now() }];
    render();
  }, ids);
  const dead = await p.evaluate(() => ({
    tag: !!document.querySelector('#trBasket .claim-dead-tag'),
    go: document.querySelector('#bkGo')?.disabled,
    text: document.querySelector('#trBasket')?.textContent.replace(/\s+/g, ' ') || '',
  }));
  chk('a line beaten to the punch says it will not land', dead.tag && /signed by somebody else/.test(dead.text), dead.text);
  chk('and Sign all waits until it is taken out', dead.go === true);
  await p.evaluate(() => document.querySelector('[data-bkdel="0"]').click());
  chk('taking it out empties the basket and the card goes', await p.evaluate(() => !document.querySelector('#trBasket') && transfersView.basket.length === 0));

  await browser.close();
  console.log(`\n[basket] ${n - fail} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
