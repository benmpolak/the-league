/* Pre-draft scouting floor (Marc's ask, 2 Aug): build and order your autopick
 * list BEFORE draft night, from the setup-phase Draft Console — DF parity
 * ("If your clock expires, Draft Fantasy selects the first valid player in
 * your auto-pick list", usable as a shortlist).
 *
 * Honesty rules:
 * - every negative assertion (no Draft buttons pre-draft) sits next to a
 *   positive one on the same surface (stars/pool rows ARE there);
 * - the carry-through check ends with a REAL local autoPick() taking the
 *   queue head, not just markup survival;
 * - reload persistence is checked against a fresh page load, not the same DOM.
 *
 * Usage: python3 -m http.server 8125 &   node test/prep.smoke.js */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const errors = [];
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?nosync&prep-test=1', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length);

  // ---- P1: setup phase exposes the Draft Console tab + waiting-room signpost
  const p1 = await page.evaluate(() => {
    window.__autoConfirm = true;
    state = freshState();
    state.view = 'home';
    whoami = state.managers[0].id;
    localStorage.setItem(WHO_KEY, whoami);
    state.autolists[whoami] = [];
    render();
    const tabs = [...document.querySelectorAll('#nav button[data-view]')].map(b => b.dataset.view);
    return { phase: state.phase, tabs, prepGo: !!document.getElementById('prepGo') };
  });
  chk('P1 setup nav carries the Draft Console + waiting room signposts it',
    p1.phase === 'setup' && p1.tabs.includes('draft') && p1.tabs.length === 4 && p1.prepGo,
    JSON.stringify(p1));

  // ---- P2: signpost opens the scouting floor — pool without Draft buttons
  await page.click('#prepGo');
  const p2 = await page.evaluate(() => ({
    view: state.view,
    pool: !!document.getElementById('poolCard'),
    rows: document.querySelectorAll('.pool-table tbody tr').length,
    stars: document.querySelectorAll('[data-auto]').length,
    checks: document.querySelectorAll('[data-bulk-pid]').length,
    draftBtns: document.querySelectorAll('[data-pick]').length,
    clock: !!document.querySelector('.on-clock'),
    hash: location.hash,
  }));
  chk('P2 scouting floor: pool + stars + bulk, no Draft buttons, no clock',
    p2.view === 'draft' && p2.pool && p2.rows > 3 && p2.stars > 3 && p2.checks > 3 &&
    p2.draftBtns === 0 && !p2.clock && p2.hash === '#draft',
    JSON.stringify(p2));

  // ---- P3: star two players -> ranked queue in added order
  const p3 = await page.evaluate(() => {
    const stars = [...document.querySelectorAll('[data-auto]')];
    const ids = stars.slice(0, 2).map(b => +b.dataset.auto);
    stars[0].click();
    const second = document.querySelector(`[data-auto="${ids[1]}"]`); // re-render replaced nodes
    second.click();
    return { ids, list: toArr(state.autolists[whoami]), rows: document.querySelectorAll('.qrow').length };
  });
  chk('P3 starring builds the ranked list in added order',
    p3.list.length === 2 && p3.list[0] === p3.ids[0] && p3.list[1] === p3.ids[1] && p3.rows >= 2,
    JSON.stringify(p3));

  // ---- P4: reorder with the arrows; ends disabled
  const p4 = await page.evaluate(() => {
    const before = [...toArr(state.autolists[whoami])];
    const firstUp = document.querySelector('[data-autoup="0"]');
    const lastDown = document.querySelector(`[data-autodown="${before.length - 1}"]`);
    document.querySelector('[data-autodown="0"]').click();
    const after = [...toArr(state.autolists[whoami])];
    document.querySelector('[data-autoup="1"]').click();
    return {
      endsDisabled: firstUp?.disabled && lastDown?.disabled,
      swapped: after[0] === before[1] && after[1] === before[0],
      restored: JSON.stringify(toArr(state.autolists[whoami])) === JSON.stringify(before),
    };
  });
  chk('P4 arrows reorder both ways, end buttons disabled',
    p4.endsDisabled && p4.swapped && p4.restored, JSON.stringify(p4));

  // ---- P4b: drag a pool player into the queue card (synthetic HTML5 DnD)
  const p4b = await page.evaluate(() => {
    const before = [...toArr(state.autolists[whoami])];
    const tr = [...document.querySelectorAll('tr[data-drag]')].find(t => !before.includes(+t.dataset.drag));
    const pid = +tr.dataset.drag;
    const started = typeof tr.ondragstart === 'function';
    const dt = new DataTransfer();
    dt.setData('text/plain', `pool:${pid}`);
    document.querySelector('.queue-card').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const after = toArr(state.autolists[whoami]);
    return { started, pid, appended: after[after.length - 1] === pid && after.length === before.length + 1 };
  });
  chk('P4b dragging a pool player into the list appends him',
    p4b.started && p4b.appended, JSON.stringify(p4b));

  // ---- P4c: drag a queue row onto the top row's upper half -> moves to #1
  const p4c = await page.evaluate(() => {
    const before = [...toArr(state.autolists[whoami])];
    const rows = document.querySelectorAll('.queue-card [data-qdrag]');
    const target = rows[0], r = target.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.setData('text/plain', `queue:${before.length - 1}`);
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: r.top + 1 }));
    const after = toArr(state.autolists[whoami]);
    return { moved: after[0] === before[before.length - 1], intact: after.length === before.length };
  });
  chk('P4c dragging the last queue row onto the top slot reorders to #1',
    p4c.moved && p4c.intact, JSON.stringify(p4c));

  // ---- P4d: the star is a toggle — second tap removes, filled state shown
  const p4d = await page.evaluate(() => {
    const head = toArr(state.autolists[whoami])[0];
    const btn = document.querySelector(`[data-auto="${head}"]`);
    const filled = btn && btn.classList.contains('star-on');
    btn.click();
    const after = toArr(state.autolists[whoami]);
    const btn2 = document.querySelector(`[data-auto="${head}"]`);
    const cleared = btn2 && !btn2.classList.contains('star-on');
    btn2.click(); // put him back for the later checks
    return { filled, removed: !after.includes(head), cleared };
  });
  chk('P4d star toggles: filled when listed, second tap removes',
    p4d.filled && p4d.removed && p4d.cleared, JSON.stringify(p4d));

  // ---- P5: bulk select-page -> add to queue works pre-draft
  const p5 = await page.evaluate(() => {
    const before = toArr(state.autolists[whoami]).length;
    document.querySelector('[data-bulk-all]').click();
    const add = document.querySelector('[data-bulk-add]');
    const enabled = add && !add.disabled;
    add.click();
    return { enabled, before, after: toArr(state.autolists[whoami]).length };
  });
  chk('P5 bulk add fills the queue pre-draft (no draft-state crash)',
    p5.enabled && p5.after > p5.before + 10, JSON.stringify(p5));

  // ---- P6: compare works on the scouting floor
  const p6 = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[data-compare]')].slice(0, 2);
    btns.forEach(b => b.click());
    return { fab: !!document.getElementById('scoutCompareFab'), n: scoutCompare.length };
  });
  chk('P6 player comparison available pre-draft', p6.fab && p6.n === 2, JSON.stringify(p6));
  await page.evaluate(() => { scoutCompare = []; paintScoutCompare(); });

  // ---- P7: the list survives a reload (fresh page, saved local state)
  const savedList = await page.evaluate(() => { save(); return toArr(state.autolists[whoami]); });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length);
  const p7 = await page.evaluate(() => ({
    phase: state.phase, view: state.view,
    list: toArr(state.autolists[whoami]),
    rows: document.querySelectorAll('.qrow').length,
  }));
  chk('P7 list + scouting floor survive a reload',
    p7.phase === 'setup' && p7.view === 'draft' && p7.rows > 10 &&
    JSON.stringify(p7.list) === JSON.stringify(savedList),
    `rows=${p7.rows} list=${p7.list.length}/${savedList.length}`);

  // ---- P8: draft night — the prep list drives the real autopick
  const p8 = await page.evaluate(() => {
    window.__autoConfirm = true;
    const head = toArr(state.autolists[whoami])[0];
    state.phase = 'draft';
    state.view = 'draft';
    state.settings.pickTimer = 0;
    state.draft.order = state.managers.map(m => m.id); // whoami picks first
    render();
    const queueIntact = document.querySelectorAll('.qrow').length > 10;
    const draftBtns = document.querySelectorAll('[data-pick]').length;
    autoPick();
    return { head, queueIntact, draftBtns, picked: state.draft.picks[0]?.playerId };
  });
  chk('P8 on the night: queue intact, Draft buttons back, autopick takes the prep head',
    p8.queueIntact && p8.draftBtns > 3 && p8.picked === p8.head, JSON.stringify(p8));

  // ---- P8b: heckle desk — sheet opens, random barb flashes, cooldown holds,
  // custom text goes through verbatim (mock-draft round: sheet replaced the
  // one-shot button)
  const p8b = await page.evaluate(async () => {
    const btn = document.getElementById('heckleBtn');
    if (!btn) return { btn: false };
    btn.click();
    const sheet = !!document.getElementById('heckleSheet');
    document.getElementById('hkRandom')?.click();
    await new Promise(r => setTimeout(r, 100));
    const flash = !!document.querySelector('.heckle-flash');
    const stamp = state.heckles?.[whoami]?.t;
    btn.click(); // sheet again, inside the cooldown — send must not restamp
    document.getElementById('hkRandom')?.click();
    const stamp2 = state.heckles?.[whoami]?.t;
    const closed = !document.getElementById('heckleSheet');
    return { btn: true, sheet, flash, stamped: !!stamp, cooled: stamp === stamp2, closed };
  });
  chk('P8b heckle desk: sheet opens, barb flashes, cooldown holds', p8b.btn && p8b.sheet && p8b.flash && p8b.stamped && p8b.cooled && p8b.closed, JSON.stringify(p8b));
  // custom words render escaped through the flash
  const p8hx = await page.evaluate(async () => {
    state.heckles = {}; window._hecklesSeen = {};
    document.querySelectorAll('.heckle-flash').forEach(el => el.remove()); // p8b's flash may still be up
    document.getElementById('heckleBtn')?.click();
    const inp = document.getElementById('hkText');
    if (!inp) return { inp: false };
    inp.value = 'GET ON WITH IT <b>x</b>';
    document.getElementById('hkSend')?.click();
    await new Promise(r => setTimeout(r, 100));
    const fl = document.querySelector('.heckle-flash');
    return { inp: true, fired: !!fl, text: fl?.textContent || '', safe: !fl?.querySelector('b') };
  });
  chk('P8hx custom heckle: text lands, HTML stays escaped', p8hx.inp && p8hx.fired && p8hx.text.includes('GET ON WITH IT') && p8hx.safe, JSON.stringify(p8hx));

  // ---- P8e: the Ben Levy DM klaxon fires on a listed sitter
  const p8e = await page.evaluate(async () => {
    const dm = PLAYERS.find(p => p.pos === 'MF' && /rice|caicedo|rodri|mac allister|tielemans|enzo fern/i.test((p.full || '') + p.name));
    if (!dm) return { dm: false };
    state.draft.picks.push({ n: state.draft.picks.length + 1, managerId: 3, playerId: dm.id });
    render();
    await new Promise(r => setTimeout(r, 80));
    const flash = document.querySelector('.klaxon-flash');
    return { dm: dm.name, fired: !!flash, label: flash?.textContent?.includes('KLAXON') };
  });
  chk('P8e Ben Levy DM klaxon fires on a listed sitter', !!p8e.dm && p8e.fired && p8e.label, JSON.stringify(p8e));

  // ---- P8f: projected points columns are fixture-count aware and optional
  const p8f = await page.evaluate(() => {
    state.fixtures = [
      { gw: 1, home: 'Liverpool', away: 'Everton', date: '2026-08-21', finished: false },
      { gw: 2, home: 'Arsenal', away: 'Liverpool', date: '2026-08-28', finished: false },
      { gw: 3, home: 'Liverpool', away: 'Chelsea', date: '2026-09-04', finished: false },
    ];
    const p = PLAYERS.find(x => x.team === 'Liverpool' && x.pos === 'MF');
    const m = metricsFor(p);
    const one = projPts(p, 1), three = projPts(p, 3);
    const cols = ALL_STAT_COLS(false).map(c => c.k);
    return { one, ratio: one > 0 && Math.abs(three - 3 * one) < 0.001, inMenu: cols.includes('xp1') && cols.includes('xp3') && cols.includes('xp6'), inMetrics: typeof m.xp6 === 'number' };
  });
  chk('P8f projected points: fixture-count aware, in the column menu', p8f.one > 0 && p8f.ratio && p8f.inMenu && p8f.inMetrics, JSON.stringify(p8f));

  // ---- P8c: fixture-difficulty tints read the new 1–5 strength scale
  const p8c = await page.evaluate(() => ({
    hard: fdrCls('Liverpool'), easy: fdrCls('Hull City'), mid: fdrCls('Everton'),
  }));
  chk('P8c FDR tints fire on the 26/27 1–5 strength scale',
    p8c.hard === 'fdr-hard' && p8c.easy === 'fdr-easy' && p8c.mid === '', JSON.stringify(p8c));

  // ---- P8d: the projected playoff bracket lives in the Data Room
  const p8d = await page.evaluate(() => {
    state = buildDemoState();
    state.view = 'data';
    whoami = state.managers[0].id;
    render();
    const card = [...document.querySelectorAll('.card h2')].find(h => h.textContent.includes('Playoff Bracket'));
    const ties = document.querySelectorAll('.br-tie').length;
    const seeds = [...document.querySelectorAll('.br-col:first-child .br-seed')].map(e => e.textContent);
    return {
      card: !!card, projected: card ? /projected/i.test(card.textContent) : false,
      ties, hcaps: document.querySelectorAll('.br-hcap').length,
      topSeed: seeds[0], tbd: document.querySelectorAll('.br-tbd').length,
    };
  });
  chk('P8d projected bracket: 7 ties, seeds from the table, handicaps shown',
    p8d.card && p8d.projected && p8d.ties === 7 && p8d.topSeed === '1' && p8d.hcaps >= 1 && p8d.tbd === 6,
    JSON.stringify(p8d));

  // ---- P8g: the Matchday Programme prints an article on the demo dashboard
  const p8g = await page.evaluate(() => {
    state.view = 'dash';
    render();
    const card = document.querySelector('.prog-card');
    // the dash shows a front page; the full edition lives in the reading room
    card?.querySelector('#progRead')?.click();
    const room = document.querySelector('.gazette-room');
    const art = room?.querySelector('.prog-art');
    const out = {
      card: !!card, mast: !!card?.querySelector('.prog-plate .prog-title'),
      teaser: !!card?.querySelector('.prog-head-lead'), room: !!room,
      words: art ? art.textContent.trim().split(/\s+/).length : 0,
      edition: room?.querySelector('.prog-date')?.textContent || '',
    };
    room?.closest('.overlay')?.remove();
    return out;
  });
  chk('P8g Gazette front page teases; the reading room prints the real article',
    p8g.card && p8g.mast && p8g.teaser && p8g.room && p8g.words > 40 && /edition/.test(p8g.edition), JSON.stringify(p8g));

  // ---- P8h: multiple rivals — mutual clásico, one-sided mockery, legacy field honoured
  const p8h = await page.evaluate(() => {
    const [m1, m2, m3, m4] = state.managers;
    m1.rivals = [m2.id, m3.id]; m2.rivals = [m1.id]; m3.rivals = null; m3.rival = null;
    m4.rival = m1.id; m4.rivals = null;
    return {
      both: rivalsOf(m1.id).length === 2,
      clasico: /CL/.test(derbyTag(m1.id, m2.id)),
      oneSided: /one/.test(derbyTag(m1.id, m3.id)),
      legacy: rivalsOf(m4.id)[0] === m1.id && /one/.test(derbyTag(m4.id, m1.id)),
    };
  });
  chk('P8h multi-rivals: clásico both ways, one-sided mocked, legacy single honoured',
    p8h.both && p8h.clasico && p8h.oneSided && p8h.legacy, JSON.stringify(p8h));

  // ---- P9: signed-out visitor still SEES the list card (with the how-to),
  // but gets no live queue controls
  const p9 = await page.evaluate(() => {
    state = freshState();
    state.view = 'draft';
    whoami = null;
    localStorage.removeItem(WHO_KEY);
    render();
    const qc = document.querySelector('.queue-card');
    return {
      rows: document.querySelectorAll('.pool-table tbody tr').length,
      stars: document.querySelectorAll('[data-auto]').length,
      checks: document.querySelectorAll('[data-bulk-pid]').length,
      fab: !!document.getElementById('queueFab'),
      card: !!qc,
      pitch: qc ? /start yours/.test(qc.textContent) : false,
      qrows: document.querySelectorAll('.qrow').length,
    };
  });
  chk('P9 signed-out visitor sees the list card + pitch, no live controls',
    p9.rows > 3 && p9.stars === 0 && p9.checks === 0 && !p9.fab && p9.card && p9.pitch && p9.qrows === 0,
    JSON.stringify(p9));

  // ---- same-session group-chat fixes (Marc + Toby, 2 Aug) ----

  // P10: transfer list — list YOUR OWN player straight from the card
  const p10 = await page.evaluate(() => {
    state = buildDemoState();
    state.view = 'transfers';
    transfersView.tab = 'trades';
    whoami = state.managers[0].id;
    localStorage.setItem(WHO_KEY, whoami);
    render();
    const addBtn = document.getElementById('blockAdd');
    if (!addBtn) return { addBtn: false };
    addBtn.click();
    const rows = document.querySelectorAll('[data-blockpick]').length;
    const before = toArr(state.tradeBlock?.[whoami]).length;
    const first = document.querySelector('[data-blockpick]');
    const pid = +first.dataset.blockpick;
    first.click();
    const after = toArr(state.tradeBlock?.[whoami]);
    const delist = !!document.querySelector(`[data-unblock="${pid}"]`);
    return { addBtn: true, rows, before, listed: after.includes(pid), grew: after.length === before + 1, delist, pickerClosed: !document.querySelector('[data-blockpick]') };
  });
  chk('P10 own player listable from the Transfer List card, delist appears',
    p10.addBtn && p10.rows > 10 && p10.listed && p10.grew && p10.delist && p10.pickerClosed,
    JSON.stringify(p10));

  // P11: search palette — flag emoji never clipped mid-glyph by the name ellipsis
  await page.setViewport({ width: 320, height: 700, isMobile: true, hasTouch: true });
  const p11 = await page.evaluate(() => {
    openPlayerSearch();
    const q = document.getElementById('gsq');
    q.value = 'tonali';
    q.dispatchEvent(new Event('input'));
    const flags = [...document.querySelectorAll('.gs-name .nat-flag')];
    if (!flags.length) return { flags: 0 };
    const bad = flags.filter(f => {
      const fr = f.getBoundingClientRect(), pr = f.parentElement.getBoundingClientRect();
      return fr.width < 10 || fr.right > pr.right + 0.5;
    }).length;
    const nm = !!document.querySelector('.gs-name .gs-nm');
    document.getElementById('searchOverlay')?.remove();
    return { flags: flags.length, bad, nm };
  });
  chk('P11 search flags laid out whole at 320px (no half-Italy Algeria)',
    p11.flags > 0 && p11.bad === 0 && p11.nm, JSON.stringify(p11));

  // P11b: trough pool at 320 — flag leads the name and clears the sticky action column
  const p11b = await page.evaluate(() => {
    transfersView = { ...transfersView, tab: 'trough', scope: 'free' };
    state.view = 'transfers'; render();
    const flag = document.querySelector('.pool-table .nat-flag');
    if (!flag) return { flag: false };
    const fr = flag.getBoundingClientRect();
    const act = flag.closest('tr').querySelector('td.act').getBoundingClientRect();
    const txt = flag.closest('.pname').querySelector('.pn-txt');
    return { flag: true, clear: fr.right < act.left, first: fr.left <= txt.getBoundingClientRect().left, w: fr.width };
  });
  chk('P11b trough flags lead the name and clear the sticky Sign column at 320px',
    p11b.flag && p11b.clear && p11b.first && p11b.w > 10, JSON.stringify(p11b));

  chk('P12 no page errors across the run', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\nprep.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
