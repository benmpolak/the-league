/* The Transfers desk across a redraw, and what it tells you (15 Oct 2026).
 * Any save, and every other manager's move landing over the wire, redraws
 * the whole page. Pins:
 *   1. the Trough search survives a redraw and a shared-snapshot echo
 *      (Ian, 13 Oct: "it then resets to main list")
 *   2. the man going out stays marked after a claim (Marc, 13 Oct)
 *   3. the Trade desk squad card stays open across a redraw
 *   4. a marked man who has left the squad is unmarked
 *   5. the desktop pitch shows the subs' fixtures (Ben and Ian, 13 Oct)
 *   6. a claim that drops a dead line still says so once "Saved" lands,
 *      and never says "Saved" before the league has it
 *   7. Sign says how many waiver requests it kills
 *   8. an old press answer with no question of its own is paired by its id
 * Items 6-8 are from Fable's review of the day. Stubbed-sync harness as
 * claimsave.smoke.js. */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the service worker would fetch sync.js past the request block (5458de9)
const noLiveFirebase = pg => pg.evaluate(() => !performance.getEntriesByType('resource').some(e => /gstatic\.com\/firebasejs/.test(e.name)));
let fail = 0, n = 0;
const chk = (name, cond, extra = '') => { n++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !extra ? '' : ' — ' + extra}`); if (!cond) fail++; };
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const p = await browser.newPage();
  await p.setBypassServiceWorker(true);
  p.on('pageerror', e => { fail++; console.log('PAGEERROR', e.message.split('\n')[0]); });
  await p.setViewport({ width: 1100, height: 900 });
  await p.setRequestInterception(true);
  p.on('request', req => req.url().endsWith('/js/sync.js') ? req.abort() : req.continue());
  await p.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined');
  await p.evaluate(() => {
    // claimSet can be held so the test sees the screen before the league answers
    window._calls = []; window._hold = false; window._held = [];
    window.WCSync = {
      league: 'the-league-2627',
      call: (action, data) => new Promise(resolve => {
        window._calls.push({ action, data });
        if (window._hold && action === 'claimSet') window._held.push(resolve); else resolve({ ok: true, tgw: transferGw() });
      }),
      auth: { user: () => ({ uid: 'u-test', email: 'ben@example.com' }), sendLink: () => Promise.resolve(), completeLink: () => Promise.resolve(false), signOut: () => Promise.resolve() },
    };
    const s = freshState(); s.phase = 'season'; s.draft.order = s.managers.map(m => m.id);
    let k = 0;
    for (const [pos, want] of [['GK', 2], ['DF', 5], ['MF', 5], ['FW', 2]]) {
      for (const q of PLAYERS.filter(x => x.pos === pos).slice(0, want)) s.draft.picks.push({ managerId: 1, playerId: q.id, code: q.code ?? null, n: ++k });
    }
    window._snap = JSON.parse(JSON.stringify({ phase: s.phase, managers: s.managers, settings: s.settings, draft: s.draft, lineups: {}, transfers: [], trades: [], covenants: [], waiverMeta: s.waiverMeta, adjustments: {}, shirtNums: {}, draftPool: null, windowDraft: null, tradeBlock: {}, benchOrders: {}, lobus: {}, hamCup: null }));
    window.onSharedSnapshot(window._snap);
    window.onAuthChanged({ uid: 'u-test', email: 'ben@example.com' });
    window.onMembershipSnapshot({ managerId: 1, role: 'commissioner' });
    window.onPrivateSnapshot({});
    window.__autoConfirm = true;
    // every free man claim-only, whatever today's fixture clock says
    troughWindow = () => ({ open: false, why: 'test' });
    state.view = 'transfers'; transfersView.tab = 'trough'; render();
  });
  await sleep(300);
  const ids = await p.evaluate(() => {
    const sq = squadAt(1, transferGw());
    const owned = ownedIdsAt(transferGw());
    const free = pos => PLAYERS.filter(x => x.pos === pos && !owned.has(x.id) && !arrivalLocked(x) && !hasLeft(x));
    return { mf: free('MF').slice(0, 3).map(x => x.id), myMf: sq.filter(x => x.pos === 'MF').map(x => x.id), gone: PLAYERS.find(x => !owned.has(x.id) && x.pos === 'MF').id };
  });

  /* 1 — the search survives a redraw and an echo */
  const name = await p.evaluate(id => PLAYER_BY_ID[id].name, ids.mf[0]);
  await p.evaluate(q => { const s = document.querySelector('#trSearch'); s.value = q; s.dispatchEvent(new Event('input')); }, name);
  await p.evaluate(() => render());
  await p.evaluate(() => window.onSharedSnapshot(JSON.parse(JSON.stringify(window._snap))));
  await sleep(150);
  const s1 = await p.evaluate(id => ({ box: document.querySelector('#trSearch')?.value, row: !!document.querySelector(`#trResults [data-trin="${id}"]`), rows: document.querySelectorAll('#trResults tbody tr').length }), ids.mf[0]);
  chk('the search text survives a redraw and an echo from the league', s1.box === name, JSON.stringify(s1));
  chk('and the list stays filtered to it', s1.row && s1.rows >= 1 && s1.rows < 20, JSON.stringify(s1));

  /* 2 — the man going out stays marked after a claim */
  await p.evaluate(out => document.querySelector(`[data-trout="${out}"]`).click(), ids.myMf[0]);
  await p.evaluate(id => document.querySelector(`#trResults [data-trin="${id}"]`).click(), ids.mf[0]);
  await sleep(250);
  const s2 = await p.evaluate(out => ({ out: transfersView.out, lit: document.querySelector(`[data-trout="${out}"]`)?.classList.contains('sel'), claims: myClaims(1).map(c => [c.in, c.out]), box: document.querySelector('#trSearch')?.value }), ids.myMf[0]);
  chk('after a claim the man going out is still marked', s2.out === ids.myMf[0] && s2.lit === true, JSON.stringify(s2));
  chk('and the claim went in with him', JSON.stringify(s2.claims) === JSON.stringify([[ids.mf[0], ids.myMf[0]]]), JSON.stringify(s2.claims));
  chk('and the search is still there for the next one', s2.box === name, s2.box);

  /* 3 — the Trade desk squad card stays open */
  const s3 = await p.evaluate(() => {
    transfersView.tab = 'trades'; render();
    const d = document.querySelector('#trMySquad'); if (!d) return 'no card';
    d.open = true; d.dispatchEvent(new Event('toggle'));
    render();
    return document.querySelector('#trMySquad')?.open;
  });
  chk('the Trade desk squad card stays open across a redraw', s3 === true, String(s3));

  /* 4 — a marked man who has left is unmarked */
  const s4 = await p.evaluate(gone => { transfersView.tab = 'trough'; transfersView.out = gone; render(); return transfersView.out; }, ids.gone);
  chk('a marked man no longer in the squad is unmarked on the next redraw', s4 === null, String(s4));

  /* 5 — the desktop pitch shows the subs' fixtures */
  const s5 = await p.evaluate(() => [...document.querySelectorAll('.bench-strip [data-trout]')].map(c => !!c.querySelector('.pitch-vs')));
  chk('every sub on the desktop Transfers pitch carries his fixture', s5.length > 0 && s5.every(Boolean), JSON.stringify(s5));

  /* 6 — the dropped-line warning survives the Saved line, which waits for the league */
  await p.evaluate(ids => {
    // a ladder line whose drop man has left the squad: it can never land
    window.onPrivateSnapshot({ claims: { [currentGwIndex()]: [{ in: ids.mf[2], out: ids.gone, t: 1 }] } });
    transfersView.out = ids.myMf[1]; transfersView.q = PLAYER_BY_ID[ids.mf[1]].name; render();
    window._hold = true;
    document.querySelector(`#trResults [data-trin="${ids.mf[1]}"]`).click();
  }, ids);
  await sleep(250);
  const before = await p.evaluate(() => document.querySelector('#toast')?.textContent || '');
  chk('before the league answers there is no "Saved"', !/Saved with the league/.test(before), before);
  chk('the dropped line is named straight away', /Dropped a request that can no longer land/.test(before), before);
  await p.evaluate(() => { window._hold = false; window._held.shift()({ ok: true }); });
  await sleep(250);
  const after = await p.evaluate(() => ({ text: document.querySelector('#toast')?.textContent || '', shown: document.querySelector('#toast')?.classList.contains('show') }));
  chk('once the league has it, Saved lands and the dropped warning is still in the same line', /Saved with the league/.test(after.text) && /Dropped a request that can no longer land/.test(after.text) && after.shown, JSON.stringify(after));

  /* 7 — Sign says how many waiver requests it kills */
  const note = await p.evaluate(ids => {
    window.onPrivateSnapshot({ claims: { [currentGwIndex()]: [{ in: ids.mf[0], out: ids.myMf[0], t: 1 }, { in: ids.mf[1], out: ids.myMf[0], t: 2 }] } });
    troughWindow = () => ({ open: true });
    window._lastConfirm = null;
    confirmSheet = o => { window._lastConfirm = o; return Promise.resolve(false); };
    transfersView.out = ids.myMf[0]; transfersView.q = PLAYER_BY_ID[ids.mf[2]].name; render();
    document.querySelector(`#trResults [data-trin="${ids.mf[2]}"]`).click();
    return new Promise(r => setTimeout(() => r(window._lastConfirm?.note || ''), 150));
  }, ids);
  chk('Sign warns that two waiver requests name him as the drop', /2 of your waiver requests name him as the drop and will not land/.test(note), note);

  /* 8 — an old press answer is paired by its id, not its position */
  const pq = await p.evaluate(() => {
    const qs = [{ id: 'opp', q: 'Q-OPP' }, { id: 'transfer', q: 'Q-TRANSFER' }, { id: 'squad', q: 'Q-SQUAD' }];
    return {
      own: answerQ({ id: 'form', q: 'As he saw it', text: 'x' }, qs, 1),
      sameRound: answerQ({ id: 'squad', text: 'x' }, qs, 1),
      otherSpec: answerQ({ id: 'form', text: 'x' }, qs, 1),
      noId: answerQ({ text: 'x' }, qs, 1),
    };
  });
  chk('an answer with its own question keeps it', pq.own === 'As he saw it', JSON.stringify(pq));
  chk('an answer without one finds its spec among this round\'s questions by id', pq.sameRound === 'Q-SQUAD', JSON.stringify(pq));
  chk('and otherwise takes that spec\'s plain wording, never the question at its old position', pq.otherSpec !== 'Q-TRANSFER' && pq.otherSpec !== 'The press asked.' && !/\{/.test(pq.otherSpec), JSON.stringify(pq));
  chk('with no id at all it falls back by position as before', pq.noId === 'Q-TRANSFER', JSON.stringify(pq));

  chk('no page loaded the live Firebase SDK', await noLiveFirebase(p));
  await browser.close();
  console.log(`\n[transfers-desk] ${n - fail} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
