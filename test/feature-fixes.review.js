/* Adversarial pins for the post-UAT feature review fixes: receipts preserve
 * pre-deal XI truth, Gazette archives do not drift or trap phone Back,
 * report cards batch by trade id, settled reporting follows auto-subs, and
 * the smaller record/archetype/streak facts remain honest. Needs port 8125. */
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.TEST_BASE_URL || 'http://localhost:8125';
let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — ${detail}`}`);
  ok ? pass++ : fail++;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const fresh = async () => {
    await page.goto(`${BASE}/?demo`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof Gazette !== 'undefined' && state.managers?.length);
  };

  await fresh();
  const receipt = await page.evaluate(async () => {
    window.__autoConfirm = true;
    // mid-gameweek the Trough is shut and nobody is signable — force it open,
    // the receipt flow is what's under test (22 Aug: inP came back undefined)
    state.waiverMeta = { ...(state.waiverMeta || {}), control: 'open' };
    const mid = state.managers[0].id, tgw = transferGw();
    state.lineups[mid] = state.lineups[mid] || {};
    state.lineups[mid][tgw] = [...lineupFor(mid, tgw)];
    const outP = state.lineups[mid][tgw].map(id => PLAYER_BY_ID[id]).find(p => p?.pos === 'MF');
    const owned = ownedIdsAt(tgw);
    const inP = PLAYERS.find(p => p.pos === outP.pos && !owned.has(p.id) && !arrivalLocked(p) && !onWaivers(p));
    const before = lineupFor(mid, tgw).includes(outP.id);
    state.view = 'transfers'; transfersView.tab = 'trough'; transfersView.out = outP.id; render();
    const search = document.querySelector('#trSearch');
    search.value = inP.name; search.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 80));
    document.querySelector(`[data-trin="${inP.id}"]`)?.click();
    await new Promise(r => setTimeout(r, 250));
    const text = document.querySelector('.overlay .card')?.innerText || '';
    return { before, after: lineupFor(mid, tgw).includes(outP.id), text, out: outP.name };
  });
  chk('executed signing receipt remembers that the outgoing player was in the XI',
    receipt.before && !receipt.after && /was in your GW\d+ XI — pick his replacement/.test(receipt.text)
      && !/XI is untouched/.test(receipt.text), JSON.stringify(receipt));

  const pending = await page.evaluate(() => {
    document.querySelectorAll('.overlay').forEach(x => x.remove());
    const mid = state.managers[0].id, gw = transferGw(), sq = squadAt(mid, gw);
    receiptSheet({ title: 'Claim lodged', inP: sq[1], outP: sq[0], gw, mid, pending: true });
    return document.querySelector('.overlay .card')?.innerText || '';
  });
  chk('pending waiver receipt says no XI change has happened',
    /Would count from GW\d+/.test(pending) && /No XI change yet/.test(pending) && /unless the waiver goes through/.test(pending), pending);

  await fresh();
  const archive = await page.evaluate(async () => {
    const before = Gazette.review(0);
    for (let i = 1; i < 8; i++) state.matchStats[`gw${i + 1}`] = { ...state.matchStats.gw1, gw: i, label: `GW${i + 1}`, final: true };
    const after = Gazette.review(0);
    state.view = 'dash'; render();
    const h0 = history.length;
    document.querySelector('#progRead')?.click();
    document.querySelector('[data-progw="0"]')?.click();
    document.querySelector('[data-progw="1"]')?.click();
    const opened = { delta: history.length - h0, depth: ovDepth, overlays: document.querySelectorAll('.overlay').length };
    const popped = new Promise(resolve => addEventListener('popstate', () => setTimeout(resolve, 30), { once: true }));
    history.back(); await popped;
    return { same: before === after, opened, afterBack: { depth: ovDepth, overlays: document.querySelectorAll('.overlay').length } };
  });
  chk('later settled gameweeks do not rewrite the GW1 Gazette', archive.same, JSON.stringify(archive));
  chk('browsing Gazette editions uses one history entry and one Back closes it',
    archive.opened.delta === 1 && archive.opened.depth === 1 && archive.opened.overlays === 1
      && archive.afterBack.depth === 0 && archive.afterBack.overlays === 0, JSON.stringify(archive));

  await fresh();
  const ledger = await page.evaluate(() => {
    const base = { sa: 70, sb: 40, ws: 70, ls: 40, margin: 30, derby: false, posW: 10, posL: 1,
      cut: false, benchL: 0, avgW: 50, stW: { w: 1 }, stL: { l: 1 } };
    const bottle = Gazette._classify(base);
    const mid = state.managers[0].id;
    const [p1, p2, p3, p4] = PLAYERS.slice(0, 4);
    const a = { managerId: mid, outId: p1.id, inId: p2.id, gw: 0, t: 100000, trade: 'trade-A' };
    const b = { managerId: mid, outId: p3.id, inId: p4.id, gw: 0, t: 101000, trade: 'trade-B' };
    state.transfers = [a, b];
    const batch = tradeBatchOf(a).map(t => t.trade);
    const m2 = state.managers[1].id;
    state.transfers = [
      { managerId: mid, outId: p1.id, inId: p2.id, gw: 0, t: 1, trade: 'swap' },
      { managerId: m2, outId: p2.id, inId: p1.id, gw: 0, t: 1, trade: 'swap' },
    ];
    // records only exist once a gameweek is settled, and a fresh demo has
    // none until the real calendar does (22 Aug) — settle GW1 for the probe
    state.matchStats['gw' + GAMEWEEKS[0].n] = { gw: 0, label: GAMEWEEKS[0].label, final: true, playerStats: { [p1.id]: { min: 90, st: 1 } } };
    const shuttle = seasonRecordsNow(0).find(r => r.key === 'shuttle');
    return { bottle, batch, shuttle: shuttle && { value: shuttle.value, holders: shuttle.holders.map(h => h.pid) } };
  });
  chk('basement beating a top-two side reaches the bottle-job archetype', ledger.bottle === 'bottle-job', JSON.stringify(ledger));
  chk('report cards never merge distinct trade ids accepted seconds apart',
    JSON.stringify(ledger.batch) === '["trade-A"]', JSON.stringify(ledger));
  chk('a reciprocal trade counts as one ownership move per player',
    ledger.shuttle?.value === 1 && ledger.shuttle.holders.length === 2, JSON.stringify(ledger));

  await fresh();
  const autosub = await page.evaluate(() => {
    const mid = state.managers[0].id, xi = [...lineupFor(mid, 0)], bench = benchFor(mid, 0);
    const sub = bench.find(p => xi.some(id => PLAYER_BY_ID[id]?.pos === p.pos));
    const out = xi.find(id => PLAYER_BY_ID[id]?.pos === sub.pos);
    state.lineups[mid] = state.lineups[mid] || {};
    for (let g = 0; g < 3; g++) {
      state.lineups[mid][g] = [...xi];
      const ps = {};
      for (const id of xi) ps[id] = { min: id === out ? 0 : 90 };
      ps[sub.id] = { min: 90, g: 3, b: 3 };
      state.matchStats[`gw${g + 1}`] = { gw: g, label: `GW${g + 1}`, final: true, playerStats: ps };
    }
    const table = h2hStandings(false, 1), pos = Object.fromEntries(table.map((r, k) => [r.id, k]));
    const pair = pairingsFor(0).find(x => x.includes(mid));
    const facts = Gazette._facts(pair[0], pair[1], 0, table, pos);
    const star = facts.w === mid ? facts.starW : facts.starL;
    const perf = seasonRecordsNow(0).find(r => r.key === 'perf');
    const t = { managerId: mid, inId: sub.id, outId: out, gw: 0, t: 1 };
    const wf = transferWindowFacts(t, 3);
    return { sub: { id: sub.id, pts: gwPlayerPoints(sub.id, 0) }, effective: effectiveXI(mid, 0),
      star: star && { id: star.p.id, pts: star.pts }, perf: perf && { value: perf.value, hasSub: perf.holders.some(h => h.pid === sub.id) },
      realised: wf?.inn[0]?.xi };
  });
  chk('Gazette, Record Book and transfer realised-points all follow the settled auto-sub XI',
    autosub.effective.subs.length === 1 && autosub.star?.id === autosub.sub.id
      && autosub.perf?.value === autosub.sub.pts && autosub.perf.hasSub
      && autosub.realised === autosub.sub.pts * 3, JSON.stringify(autosub));

  await fresh();
  const streak = await page.evaluate(() => {
    const mid = state.managers[0].id;
    const make = (g, win) => {
      const pair = pairingsFor(g).find(x => x.includes(mid)), op = pair[0] === mid ? pair[1] : pair[0], ps = {};
      for (const m of [mid, op]) for (const id of lineupFor(m, g)) ps[id] = { min: 90 };
      if (win) ps[lineupFor(mid, g).find(id => ['MF', 'FW'].includes(PLAYER_BY_ID[id].pos))].g = 1;
      state.matchStats[`gw${g + 1}`] = { gw: g, label: `GW${g + 1}`, final: true, playerStats: ps };
    };
    make(0, false); make(1, true);
    const table = h2hStandings(false, 2), pos = Object.fromEntries(table.map((r, k) => [r.id, k]));
    const pair = pairingsFor(1).find(x => x.includes(mid));
    const f = Gazette._facts(pair[0], pair[1], 1, table, pos);
    return f.w === mid ? f.stW : f.stL;
  });
  chk('a win after a draw is correctly two unbeaten', streak.w === 1 && streak.unbeaten === 2, JSON.stringify(streak));

  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  chk('Record Book no longer claims twelve years from a one-season archive',
    !src.includes('since records began (25/26') && src.includes('loaded 25/26–26/27 archive'));

  // Marc's draft-room repro: a pick, heckle and klaxon landing together used
  // to occupy the same top-centre rectangle. Pick stays there; optional noise
  // moves low and serialises at both supported phone widths.
  for (const width of [320, 390]) {
    await page.setViewport({ width, height: width === 320 ? 568 : 844 });
    await fresh();
    const barrier = await page.evaluate(async () => {
      // Once we leave demoMode this becomes a real-network page. Silence the
      // already-attached listeners for this crafted client-only state or a
      // slow CI snapshot can replace it between render() and the assertion.
      window.onSharedSnapshot = () => {};
      window.onPrivateSnapshot = () => {};
      window.onMembershipSnapshot = () => {};
      window.onAuthChanged = () => {};
      window.onSyncConnection = () => {};
      demoMode = false; membership = { managerId: state.managers[0].id, role: 'commissioner' };
      whoami = membership.managerId; syncConnected = true;
      state.phase = 'draft'; state.view = 'draft'; state.settings.pickTimer = 30;
      state.draft.order = state.managers.map(m => m.id); state.draft.picks = [];
      state.draft.deadline = null; state.draft.ceremonyReady = {};
      document.querySelectorAll('.overlay').forEach(x => x.remove()); render();
      // the clock is repainted by a timer, not by render(): wait for its first
      // tick rather than a fixed 450ms, which lost the race under a full local
      // suite run on 29 Aug (read '–:––' at 390px, passed alone twice)
      for (let k = 0; k < 30 && !/\d+\/12/.test(document.getElementById('pickClock')?.textContent || ''); k++) await new Promise(r => setTimeout(r, 100));
      const card = document.querySelector('.ceremony-wait');
      const before = { text: card?.innerText || '', right: card?.getBoundingClientRect().right,
        viewport: innerWidth, auto: !!document.getElementById('autoPick'),
        dimPicks: [...document.querySelectorAll('[data-pick]')].every(b => b.classList.contains('dim')),
        clock: document.getElementById('pickClock')?.textContent };
      state.draft.ceremonyReady = Object.fromEntries(state.draft.order.map(id => [id, true])); render();
      return { before, open: !document.querySelector('.ceremony-wait') && !!document.getElementById('autoPick') };
    });
    chk(`${width}px: shared ceremony barrier is readable, locked and within the phone viewport`,
      /first pick is locked/i.test(barrier.before.text) && /0\/12/.test(barrier.before.text)
        && barrier.before.right <= barrier.before.viewport && !barrier.before.auto && barrier.before.dimPicks
        && barrier.before.clock === '0/12' && barrier.open, JSON.stringify(barrier));

    await fresh();
    const alerts = await page.evaluate(async () => {
      state.phase = 'draft'; state.view = 'draft'; state.settings.pickTimer = 0;
      state.draft.order = state.managers.map(m => m.id); state.draft.picks = [];
      whoami = state.managers[0].id;
      document.querySelectorAll('.overlay,.heckle-flash').forEach(x => x.remove());
      _draftShoutQueue = []; _draftShoutEl = null; _draftShoutCurrent = null;
      clearTimeout(_draftShoutTimer); _draftShoutTimer = null; clearTimeout(_pickFlashTimer); _pickFlashTimer = null;
      render();
      const p = PLAYERS[0], pk = { n: 1, managerId: state.managers[1].id, playerId: p.id };
      pickFlash(pk, p);
      heckleFlash(state.managers[2].id, { text: 'MOVE ALONG', t: Date.now() });
      klaxonFlash({ label: 'KLAXON', line: 'The room has opinions.' }, p);
      await new Promise(r => setTimeout(r, 320)); // measure settled positions, not the entrance translate
      const pick = document.querySelector('.pick-flash')?.getBoundingClientRect();
      const silentDuringPick = !document.querySelector('.draft-shout');
      const queuedDuringPick = _draftShoutQueue.map(x => x.kind);
      document.querySelector('.pick-flash')?.remove(); clearTimeout(_pickFlashTimer); _pickFlashTimer = null; pumpDraftShouts();
      const shout = document.querySelector('.draft-shout')?.getBoundingClientRect();
      const firstKind = !document.querySelector('.draft-shout')?.classList.contains('klaxon-flash');
      const queued = _draftShoutQueue.map(x => x.kind);
      _draftShoutEl?.remove(); pumpDraftShouts();
      const second = document.querySelector('.draft-shout');
      return {
        pick: pick && { top: pick.top, bottom: pick.bottom },
        shout: shout && { top: shout.top, bottom: shout.bottom },
        silentDuringPick, queuedDuringPick, firstKind, queued,
        secondKlaxon: second?.classList.contains('klaxon-flash'),
        simultaneousShouts: document.querySelectorAll('.draft-shout').length,
        viewportH: innerHeight,
      };
    });
    chk(`${width}px: pick alert keeps the top billboard while room noise sits clear below`,
      alerts.pick?.top >= 70 && alerts.pick?.top < 90 && alerts.silentDuringPick
        && JSON.stringify(alerts.queuedDuringPick) === '["heckle","klaxon"]' && alerts.shout?.top > alerts.viewportH / 2
        && alerts.pick.bottom < alerts.shout.top, JSON.stringify(alerts));
    chk(`${width}px: heckle and klaxon queue instead of overlapping`,
      alerts.firstKind && JSON.stringify(alerts.queued) === '["klaxon"]'
        && alerts.secondKlaxon && alerts.simultaneousShouts === 1, JSON.stringify(alerts));
  }

  await browser.close();
  console.log(`\n[feature-fixes] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Error', e); process.exit(1); });
