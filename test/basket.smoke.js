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
 *   7. active lines cannot be removed while the queue is still signing them
 *   8. receipts use the server gameweek and its XI, even across a deadline
 * Same stubbed-sync harness as claimsave.smoke.js. */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fail = 0, n = 0;
const chk = (name, cond, extra = '') => { n++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !extra ? '' : ' — ' + extra}`); if (!cond) fail++; };
// The sync.js block only holds while requests reach puppeteer. Once the first
// page has registered sw.js, the service worker controls every later page in
// this browser and fetches sync.js itself: the second page below, which loads
// the real league, then connected to it read-only (Ben, 15 Oct 2026, the same
// hole that made authui.smoke.js flaky). Every page bypasses the worker.
const noLiveFirebase = pg => pg.evaluate(() => !performance.getEntriesByType('resource').some(e => /gstatic\.com\/firebasejs/.test(e.name)));
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const p = await browser.newPage();
  await p.setBypassServiceWorker(true);
  p.on('pageerror', e => { fail++; console.log('PAGEERROR', e.message.split('\n')[0]); });
  await p.setViewport({ width: 1100, height: 900 });
  await p.setRequestInterception(true);
  p.on('request', req => req.url().endsWith('/js/sync.js') ? req.abort() : req.continue());
  // the basket is sandbox-only until Marc has tried it (Ben, 15 Oct 2026)
  await p.goto(baseUrl + '/index.html?sandbox', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined');
  await p.evaluate(() => {
    // troughSign answers at once, unless told to hold or to refuse one call
    window._calls = []; window._hold = false; window._held = []; window._refuseCall = 0; window._serverGws = [];
    window.WCSync = {
      league: 'the-league-2627',
      call: (action, data) => new Promise((resolve, reject) => {
        window._calls.push({ action, data });
        const k = window._calls.filter(c => c.action === 'troughSign').length;
        if (action === 'troughSign' && k === window._refuseCall) { reject(new Error('Toby got there first')); return; }
        const answer = { ok: true, tgw: window._serverGws.length ? window._serverGws.shift() : transferGw() };
        if (window._hold) window._held.push(() => resolve(answer)); else resolve(answer);
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

  /* 0 — it says what it is (Ben, 15 Oct 2026: "needs to be a little more obvious") */
  const empty = await p.evaluate(id => {
    state.view = 'transfers'; transfersView.tab = 'trough'; transfersView.q = PLAYER_BY_ID[id].name; render();
    return { hint: document.querySelector('.basket-hint')?.textContent || '', label: document.querySelector(`#trResults [data-trbasket="${id}"]`)?.textContent.trim(), bar: !!document.querySelector('.basket-bar') };
  }, ids.mf[0]);
  chk('an empty basket explains itself above the search', /Signing more than one\?/.test(empty.hint) && /\+ Basket/.test(empty.hint), empty.hint);
  chk('the button says + Basket, not a bare +', empty.label === '+ Basket', empty.label);
  chk('and no bar while the basket is empty', empty.bar === false);

  /* 1 — the marked man goes into the line, and is unmarked */
  await p.evaluate(out => { transfersView.out = out; }, ids.myMf[0]);
  chk('a free man has a + Basket beside Sign', await plus(ids.mf[0]) === 'ok');
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
  chk('his row now reads In basket, not + Basket', await p.evaluate(id => document.querySelector(`#trResults [data-trbasket="${id}"]`)?.textContent.trim() === '✓ In basket', ids.mf[0]));
  const bar1 = await p.evaluate(() => ({ text: document.querySelector('.basket-bar')?.textContent.replace(/\s+/g, ' ').trim() || '', pos: document.querySelector('.basket-bar') && getComputedStyle(document.querySelector('.basket-bar')).position, hint: !!document.querySelector('.basket-hint') }));
  chk('a bar pinned to the foot of the screen counts the basket and offers Sign all', bar1.pos === 'fixed' && /1 in your basket/.test(bar1.text) && /Sign all 1/.test(bar1.text), JSON.stringify(bar1));
  chk('and the explainer steps aside', bar1.hint === false);

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
  await p.evaluate(() => { window._calls = []; window._hold = true; document.querySelector('#bkGoBar').click(); });
  await sleep(150);
  const firstOnly = await p.evaluate(() => window._calls.filter(c => c.action === 'troughSign').map(c => [c.data.inId, c.data.outId]));
  chk('Sign all sends the first line and waits for the league', firstOnly.length === 1 && firstOnly[0][0] === ids.mf[0] && firstOnly[0][1] === ids.myMf[0], JSON.stringify(firstOnly));
  chk('meanwhile the card says it is working, with no buttons to press twice', await p.evaluate(() => /Signing your basket/.test(document.querySelector('#trBasket')?.textContent || '') && !document.querySelector('#bkGo') && !document.querySelector('#bkGoBar') && /Signing your basket/.test(document.querySelector('.basket-bar')?.textContent || '')));
  // The row remains on screen during the run. It must not offer to remove a
  // line that the already-confirmed queue will still submit (Ben, 19 Oct).
  await plus(ids.mf[1]);
  const during = await p.evaluate(id => ({
    disabled: document.querySelector(`#trResults [data-trbasket="${id}"]`)?.disabled,
    basket: transfersView.basket.length,
    calls: window._calls.filter(c => c.action === 'troughSign').length,
  }), ids.mf[1]);
  chk('the active basket locks row edits until its confirmed signings finish', during.disabled === true && during.basket === 2 && during.calls === 1, JSON.stringify(during));
  await p.evaluate(() => { window._hold = false; window._held.shift()(); });
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

  /* 4b — server receipts win over the old client clock, one line at a time */
  await p.evaluate(ids => {
    window._basketNow = Date.now;
    window._basketLineupFor = lineupFor;
    const receiptClock = new Date(gwFrom(1)).getTime() + 1000;
    Date.now = () => receiptClock;
    // Distinct starters pin the impact to the actual round, not whichever
    // gameweek was on the client when the manager pressed Sign all.
    lineupFor = (mid, g) => g === 2 ? [ids.myMf[0]] : g === 3 ? [ids.myMf[1]] : [];
    transfersView.basket = [{ in: ids.mf[0], out: ids.myMf[0] }, { in: ids.mf[1], out: ids.myMf[1] }];
    window._calls = []; window._serverGws = [2, 3]; render();
    document.querySelector('#bkGo').click();
  }, ids);
  await sleep(250);
  const rounds = await p.evaluate(ids => ({
    paragraphs: [...document.querySelectorAll('[aria-label="Basket receipt"] p')].map(x => x.textContent.replace(/\s+/g, ' ')),
    names: ids.myMf.slice(0, 2).map(id => PLAYER_BY_ID[id].name),
    weeks: [GAMEWEEKS[2].n, GAMEWEEKS[3].n],
    remaining: transfersView.basket.length,
  }), ids);
  chk('a basket crossing a deadline reports each actual server gameweek', rounds.weeks.every(g => rounds.paragraphs.some(x => x.includes(`Counts from GW${g}.`))) && rounds.remaining === 0, JSON.stringify(rounds));
  chk('each receipt names the starters from its actual gameweek', rounds.weeks.every((g, i) => rounds.paragraphs.some(x => x.includes(`Counts from GW${g}.`) && x.includes(rounds.names[i]) && x.includes(`in your GW${g} XI`))), JSON.stringify(rounds));
  await p.evaluate(() => {
    Date.now = window._basketNow; lineupFor = window._basketLineupFor;
    document.querySelectorAll('.overlay').forEach(o => o.remove()); render();
  });

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
    go: document.querySelector('#bkGo')?.disabled && document.querySelector('#bkGoBar')?.disabled,
    text: document.querySelector('#trBasket')?.textContent.replace(/\s+/g, ' ') || '',
  }));
  chk('a line beaten to the punch says it will not land', dead.tag && /signed by somebody else/.test(dead.text), dead.text);
  chk('and Sign all waits until it is taken out', dead.go === true);
  await p.evaluate(() => document.querySelector('[data-bkdel="0"]').click());
  chk('taking it out empties the basket and the card goes', await p.evaluate(() => !document.querySelector('#trBasket') && transfersView.basket.length === 0));

  /* 6b — a man dropped further up the basket is not "signed by somebody else" */
  const reSign = await p.evaluate(ids => {
    // line 1 drops one of his midfielders; line 2 tries to sign that same man back
    transfersView.basket = [{ in: ids.mf[1], out: ids.myMf[0] }, { in: ids.myMf[0], out: ids.myMf[1] }]; // mf[0] went to manager 2 in step 6
    return basketCheck(1).map(l => l.why);
  }, ids);
  chk('signing back a man the basket drops further up says so', reSign[0] === '' && /goes out further up this basket/.test(reSign[1]), JSON.stringify(reSign));
  await p.evaluate(() => { transfersView.basket = []; render(); });

  /* 7 — the real league sees it too */
  const live = await browser.newPage();
  await live.setBypassServiceWorker(true);
  await live.setRequestInterception(true);
  live.on('request', req => req.url().endsWith('/js/sync.js') ? req.abort() : req.continue());
  await live.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await live.waitForFunction(() => typeof state !== 'undefined');
  const gated = await live.evaluate(() => {
    state = buildDemoState(); state.phase = 'season'; whoami = state.managers[0].id;
    troughWindow = () => ({ open: true });
    state.view = 'transfers'; transfersView.tab = 'trough'; render();
    return { on: BASKET_ON, sign: document.querySelectorAll('#trResults [data-trin]').length, plus: document.querySelectorAll('#trResults [data-trbasket]').length };
  });
  // open to everyone since Ben, 16 Oct 2026
  chk('the real league (no ?sandbox) has the basket too', gated.on === true && gated.sign > 0 && gated.plus > 0, JSON.stringify(gated));
  chk('no page loaded the live Firebase SDK', await noLiveFirebase(p) && await noLiveFirebase(live));

  await browser.close();
  console.log(`\n[basket] ${n - fail} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
