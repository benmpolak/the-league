/* UX trio regression: Surprise Me, Club Directory, Global Player Search.
 *
 * Honesty rules: every negative assertion is preceded by a positive
 * precondition (the surface exists, the values genuinely differ, the card
 * actually opened) so a missing feature cannot pass a test.
 *
 * Usage: python3 -m http.server 8125 &   node test/ux3.smoke.js */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
// a real 1x1 png for deterministic photo-chain tests — no live network needed
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// the r3ui seeding pattern: hermetic season, 12 seeded squads, frozen clock
const SEED_SEASON = `(() => {
  window.__autoConfirm = true;
  syncNow = async () => {};
  const t0 = new Date(GAMEWEEKS[0].from).getTime() - 7 * 86400000;
  Date.now = () => t0;
  state.matchStats = {}; state.fixtures = state.fixtures || [];
  for (const g of GAMEWEEKS) g.finished = false;
  const byPos = { GK: [], DF: [], MF: [], FW: [] };
  for (const pl of PLAYERS) byPos[pl.pos]?.push(pl);
  for (const k in byPos) byPos[k].sort((a, b) => b.pts - a.pts);
  const NEED = { GK: 2, DF: 5, MF: 4, FW: 3 };
  state.phase = 'season';
  state.draft.order = state.managers.map(m => m.id);
  state.draft.picks = [];
  state.lineups = {}; state.transfers = []; state.claims = {};
  let n = 1;
  state.managers.forEach((m, k) => {
    for (const pos in NEED) for (let j = 0; j < NEED[pos]; j++) {
      state.draft.picks.push({ managerId: m.id, playerId: byPos[pos][k * NEED[pos] + j].id, n: n++ });
    }
  });
  save(); render();
  return 'ok';
})()`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const allErrors = [];
  const newPage = async (ctx, url, viewport) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => allErrors.push(url + ': ' + e.message));
    p.on('dialog', d => d.accept());
    if (viewport) await p.setViewport(viewport);
    await p.goto(url, { waitUntil: 'networkidle2' });
    await p.waitForFunction(() => typeof state !== 'undefined' && state.managers.length);
    return p;
  };

  /* ═══════════════ SURPRISE ME ═══════════════ */
  const sCtx = await browser.createBrowserContext();
  const sp = await newPage(sCtx, baseUrl + '?nosync');

  /* S1 — first click populates every eligible field (fresh manager) */
  const s1 = await sp.evaluate(() => {
    let s = 42; window.__surpriseRand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const m = state.managers[0];
    delete m.kit; delete m.sponsor; delete m.boards; delete m.gaffer; delete m.stadium;
    clubEditor(m.id);
    const ov = document.querySelector('.club-office').closest('.overlay');
    const rivalState = () => [...ov.querySelectorAll('[data-rival]')].filter(c => c.checked).map(c => c.dataset.rival).join(',');
    const before = { stadium: ov.querySelector('#clubStadium').value, name: ov.querySelector('#clubName').value, rival: rivalState() };
    ov.querySelector('#clubLuck').click();
    return {
      before,
      line: ov.querySelector('#luckLine').textContent,
      pat: ov.querySelector('[data-pat].active')?.dataset.pat || null,
      c1: ov.querySelector('#clubC1').value, c2: ov.querySelector('#clubC2').value,
      sponsor: ov.querySelector('#clubSpSel').value,
      stadium: ov.querySelector('#clubStadium').value,
      boards: [...ov.querySelectorAll('[data-board].active')].map(b => +b.dataset.board),
      gaffers: [...ov.querySelectorAll('[data-gaffer].active')].length,
      name: ov.querySelector('#clubName').value,
      rival: rivalState(),
    };
  });
  chk('S1: surprise fills kit pattern, colours, sponsor, boards, gaffer, stadium',
    !!s1.pat && s1.c1 !== '' && s1.sponsor !== '' && s1.gaffers === 1
      && s1.boards.length >= 1 && s1.stadium !== s1.before.stadium,
    JSON.stringify(s1));
  chk('S1: the recruitment department announces itself',
    s1.line === 'The recruitment department has improvised.', s1.line);
  chk('S1: team name and rival are untouched',
    s1.name === s1.before.name && s1.rival === s1.before.rival, JSON.stringify({ name: s1.name, rival: s1.rival }));

  /* S4 — hoardings distinct, max three */
  chk('S4: generated hoardings are distinct and at most three',
    s1.boards.length <= 3 && new Set(s1.boards).size === s1.boards.length, JSON.stringify(s1.boards));

  /* S5 — generated colours have real contrast */
  const contrast = await sp.evaluate((c1, c2) => kitContrast(c1, c2), s1.c1, s1.c2);
  chk('S5: generated shirt/trim contrast ratio >= 2',
    s1.c1 !== s1.c2 && contrast >= 2, `${s1.c1} vs ${s1.c2} = ${contrast.toFixed(2)}`);

  /* S3 — manual edit protects a generated field; reroll changes others */
  const s3 = await sp.evaluate(() => {
    const ov = document.querySelector('.club-office').closest('.overlay');
    ov.querySelector('[data-pat]').click(); // manually choose the first pattern → kit is now HIS
    const pinned = { pat: ov.querySelector('[data-pat].active').dataset.pat, c1: ov.querySelector('#clubC1').value };
    const beforeStadium = ov.querySelector('#clubStadium').value;
    ov.querySelector('#clubLuck').click(); // reroll
    return {
      pinned,
      pat: ov.querySelector('[data-pat].active').dataset.pat,
      c1: ov.querySelector('#clubC1').value,
      stadiumChanged: ov.querySelector('#clubStadium').value !== beforeStadium,
      stadium: ov.querySelector('#clubStadium').value,
    };
  });
  chk('S3: reroll leaves the manually-edited kit alone (pattern AND colours)',
    s3.pat === s3.pinned.pat && s3.c1 === s3.pinned.c1, JSON.stringify(s3));
  chk('S3: reroll genuinely changes a still-generated field (stadium)',
    s3.stadiumChanged, s3.stadium);

  /* S6 — cancel persists nothing */
  const s6 = await sp.evaluate(() => {
    document.querySelector('#clubCancel').click();
    const m = state.managers[0];
    return { kit: !!m.kit, sponsor: !!m.sponsor, boards: !!m.boards, gaffer: m.gaffer != null, stadium: !!m.stadium, officeGone: !document.querySelector('.club-office') };
  });
  chk('S6: cancel discards the draft — nothing persisted', s6.officeGone && !s6.kit && !s6.sponsor && !s6.boards && !s6.gaffer && !s6.stadium, JSON.stringify(s6));

  /* S2 — saved fields and manual edits survive a surprise */
  const s2 = await sp.evaluate(() => {
    const m = state.managers[1];
    m.sponsor = AD_BOARDS[0].t;   // saved-custom sponsor (a real stock title)
    delete m.kit; delete m.boards; delete m.gaffer; delete m.stadium;
    clubEditor(m.id);
    const ov = document.querySelector('.club-office').closest('.overlay');
    const st = ov.querySelector('#clubStadium');
    st.value = 'Handwritten Lane'; st.dispatchEvent(new Event('input')); // manual edit this session
    ov.querySelector('#clubLuck').click();
    const out = {
      sponsor: ov.querySelector('#clubSpSel').value,
      want: AD_BOARDS[0].t,
      stadium: st.value,
      kitFilled: !!ov.querySelector('[data-pat].active'),
    };
    ov.querySelector('#clubCancel').click();
    delete state.managers[1].sponsor;
    return out;
  });
  chk('S2: saved sponsor and manually-typed stadium survive; untouched kit still fills',
    s2.sponsor === s2.want && s2.stadium === 'Handwritten Lane' && s2.kitFilled, JSON.stringify(s2));

  /* S11 — nothing eligible: says so, changes nothing */
  const s11 = await sp.evaluate(() => {
    const m = state.managers[2];
    m.kit = { pattern: 'plain', c1: '#101010', c2: '#ffffff' };
    m.sponsor = 'T8'; m.boards = [1]; m.gaffer = 0; m.assistant = 0; m.stadium = 'Saved Park';
    m.crest = { shape: 0, div: 1, charge: 3, c1: '#101010', c2: '#ffffff' }; // College of Arms joined the luck fields, 12 Aug
    clubEditor(m.id);
    const ov = document.querySelector('.club-office').closest('.overlay');
    ov.querySelector('#clubLuck').click();
    const out = {
      line: ov.querySelector('#luckLine').textContent,
      stadium: ov.querySelector('#clubStadium').value,
      sponsor: ov.querySelector('#clubSpSel').value,
    };
    ov.querySelector('#clubCancel').click();
    return out;
  });
  chk('S11: fully-customised club → "nothing to improvise", zero changes',
    /Nothing to improvise/.test(s11.line) && s11.stadium === 'Saved Park' && s11.sponsor === 'T8', JSON.stringify(s11));

  /* S7/S8/S9 — save contract on a REAL net-mode page (authui recipe: sync.js
     aborted, WCSync stubbed, membership granted) so netOn() is genuinely true */
  const nCtx = await browser.createBrowserContext(); // own context: the ?nosync page's saved league must not wedge this boot
  const np = await nCtx.newPage();
  np.on('pageerror', e => allErrors.push('netpage: ' + e.message));
  np.on('dialog', d => d.accept());
  await np.setRequestInterception(true);
  np.on('request', req => req.url().endsWith('/js/sync.js') ? req.abort() : req.continue());
  await np.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await np.waitForFunction(() => typeof state !== 'undefined');
  const s7 = await np.evaluate(async () => {
    window.__acts = [];
    window.WCSync = {
      league: 'the-league-e2e-test',
      call: (action, data) => {
        window.__acts.push({ action, data });
        return new Promise((res, rej) => { window.__resolve = res; window.__reject = rej; });
      },
      auth: { user: () => ({ uid: 'u', email: 'e@e' }), sendLink: () => Promise.resolve(), completeLink: () => Promise.resolve(false), signOut: () => Promise.resolve() },
    };
    window.onSyncConnection(true);
    const s = freshState();
    s.phase = 'season';
    s.draft.order = s.managers.map(m => m.id);
    window.onSharedSnapshot(JSON.parse(JSON.stringify({
      phase: s.phase, managers: s.managers, settings: s.settings, draft: s.draft,
      lineups: {}, transfers: [], trades: [], covenants: [], waiverMeta: s.waiverMeta,
      adjustments: {}, shirtNums: {}, draftPool: null, windowDraft: null,
      tradeBlock: {}, benchOrders: {}, lobus: {}, hamCup: null,
    })));
    window.onAuthChanged({ uid: 'u', email: 'e@e' });
    window.onMembershipSnapshot({ managerId: 1, role: 'commissioner' });
    await new Promise(r => setTimeout(r, 350));
    if (!netOn()) return { fail: 'netOn is false' };
    let seed = 7; window.__surpriseRand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    clubEditor(1);
    const ov = document.querySelector('.club-office').closest('.overlay');
    ov.querySelector('#clubLuck').click();
    const genStadium = ov.querySelector('#clubStadium').value;
    ov.querySelector('#clubSave').click();
    await new Promise(r => setTimeout(r, 30));
    const midFlight = {
      calls: window.__acts.length,
      saveTxt: ov.querySelector('#clubSave').textContent,
      saveDisabled: ov.querySelector('#clubSave').disabled,
      cancelDisabled: ov.querySelector('#clubCancel').disabled,
    };
    ov.onclick({ target: ov }); // backdrop mid-flight
    ov.querySelector('#clubCancel').click();
    const stillOpenMidFlight = !!document.querySelector('.club-office');
    window.__reject(new Error('no'));
    await new Promise(r => setTimeout(r, 50));
    const afterReject = {
      open: !!document.querySelector('.club-office'),
      saveEnabled: !ov.querySelector('#clubSave').disabled,
      stadiumKept: ov.querySelector('#clubStadium').value === genStadium,
    };
    ov.querySelector('#clubSave').click();
    await new Promise(r => setTimeout(r, 30));
    window.__resolve({ ok: true });
    await new Promise(r => setTimeout(r, 50));
    const afterResolve = { open: !!document.querySelector('.club-office'), calls: window.__acts.length };
    return { midFlight, stillOpenMidFlight, afterReject, afterResolve, payload: window.__acts[0] };
  });
  chk('S7 precondition: net-mode page established', !s7.fail, s7.fail || '');
  chk('S7: Save dispatches exactly one clubSet with the full draft payload',
    s7.midFlight.calls === 1 && s7.payload.action === 'clubSet'
      && !!s7.payload.data.kit && !!s7.payload.data.sponsor && !!s7.payload.data.stadium && !!s7.payload.data.boards,
    JSON.stringify(s7.payload && { action: s7.payload.action, keys: Object.keys(s7.payload.data) }));
  chk('S7: mid-flight — Saving…, Save+Cancel disabled, backdrop inert',
    s7.midFlight.saveTxt === 'Saving…' && s7.midFlight.saveDisabled && s7.midFlight.cancelDisabled && s7.stillOpenMidFlight,
    JSON.stringify(s7.midFlight));
  chk('S8: rejected save keeps the office open with the generated draft intact and Save re-armed',
    s7.afterReject.open && s7.afterReject.saveEnabled && s7.afterReject.stadiumKept, JSON.stringify(s7.afterReject));
  chk('S9: successful save closes the office (second, final clubSet dispatched)',
    !s7.afterResolve.open && s7.afterResolve.calls === 2, JSON.stringify(s7.afterResolve));

  /* S10 — 320px layout */
  const s320 = await newPage(sCtx, baseUrl + '?nosync', { width: 320, height: 650 });
  const s10 = await s320.evaluate(() => {
    clubEditor(state.managers[0].id);
    const luck = document.querySelector('#clubLuck');
    return { luck: !!luck, luckVisible: luck && luck.offsetParent !== null, scrollW: document.documentElement.scrollWidth };
  });
  chk('S10: club office with Surprise me fits 320px (button visible, no overflow)',
    s10.luck && s10.luckVisible && s10.scrollW <= 320, JSON.stringify(s10));
  await s320.close();

  /* ═══════════════ CLUB DIRECTORY ═══════════════ */
  const dCtx = await browser.createBrowserContext();
  const dp = await newPage(dCtx, baseUrl + '?nosync');
  const seeded = await dp.evaluate(SEED_SEASON);
  chk('directory: season seeds cleanly', seeded === 'ok', seeded);

  /* D1/D2/D3 — twelve cards, pre-season constitutional order (verified as a tie-state) */
  const d1 = await dp.evaluate(() => {
    state.view = 'directory'; render();
    const mids = [...document.querySelectorAll('[data-dirmid]')].map(b => +b.dataset.dirmid);
    return { mids, anyPlayed: h2hStandings(false).some(r => r.p > 0), constitutional: state.managers.map(m => m.id) };
  });
  chk('D1: exactly twelve cards', d1.mids.length === 12, `${d1.mids.length}`);
  chk('D2/D3: zero results played (precondition) → constitutional order, stable',
    !d1.anyPlayed && JSON.stringify(d1.mids) === JSON.stringify(d1.constitutional), JSON.stringify(d1.mids));

  /* D4 — "Office unopened" comes from shared state, not localStorage */
  const d4 = await dp.evaluate(() => {
    localStorage.setItem(`${LS_NS}-founded-${state.managers[0].id}`, '1'); // device lies: says founded
    delete state.managers[0].kit;                                          // shared truth: never saved
    state.managers[1].kit = { pattern: 'plain', c1: '#101010', c2: '#ffffff' }; // shared truth: saved
    render();
    const card = mid => document.querySelector(`[data-dirmid="${mid}"]`).textContent;
    return {
      c1HasLabel: /Office unopened/.test(card(state.managers[0].id)),
      c2HasLabel: /Office unopened/.test(card(state.managers[1].id)),
    };
  });
  chk('D4: unopened label follows shared kit data — LS founded flag is ignored',
    d4.c1HasLabel && !d4.c2HasLabel, JSON.stringify(d4));

  /* D5 — hostile manager text is escaped in cards and profiles */
  const d5 = await dp.evaluate(() => {
    const m = state.managers[2];
    m.team = '<img src=x onerror=window.__xss1=1>';
    m.stadium = '"><script>window.__xss2=1</script>';
    m.gaffer = { t: '<b onmouseover=window.__xss3=1>G</b>', bio: '<svg onload=window.__xss4=1>' };
    render();
    const card = document.querySelector(`[data-dirmid="${m.id}"]`);
    card.click();
    const prof = document.querySelector('#clubProfileOverlay');
    const out = {
      cardShowsLiteral: card.textContent.includes('<img src=x'),
      profExists: !!prof,
      profShowsLiteral: prof.textContent.includes('<img src=x'),
      injected: !!(card.querySelector('img:not(.club-kit)') || prof.querySelector('script') || prof.querySelector('svg[onload]')),
      xss: !!(window.__xss1 || window.__xss2 || window.__xss3 || window.__xss4),
    };
    prof.remove(); history.back();
    delete m.stadium; m.team = 'Restored FC'; m.gaffer = null;
    return out;
  });
  chk('D5: hostile team/stadium/gaffer text renders literally — no injected elements',
    d5.cardShowsLiteral && d5.profExists && d5.profShowsLiteral && !d5.injected && !d5.xss, JSON.stringify(d5));

  /* D6/D7/D8 — profile editability and empty states */
  const d6 = await sleep(80).then(() => dp.evaluate(() => {
    whoami = state.managers[0].id; // local mode: this device IS manager 1
    render();
    const other = state.managers[4].id;
    document.querySelector(`[data-dirmid="${other}"]`).click();
    const profOther = document.querySelector('#clubProfileOverlay');
    const out = {
      otherOpened: !!profOther && profOther.textContent.includes(teamName(other)),
      otherHasEditor: !!profOther.querySelector('#clubEdit'),
      otherHasMood: /Supporters/.test(profOther.textContent),
      otherPreSeason: /Pre-season optimism/.test(profOther.textContent),
      otherEmptyRecords: /record books open at GW1/i.test(profOther.textContent),
    };
    profOther.remove(); history.back();
    return out;
  }));
  chk('D6: another manager\'s profile opens read-only — records+mood shown, NO office button',
    d6.otherOpened && d6.otherHasMood && !d6.otherHasEditor, JSON.stringify(d6));
  /* D8b — a manager with NO squad at all: the truly-empty records copy */
  const d8b = await sleep(80).then(() => dp.evaluate(() => {
    const strip = state.managers[5].id;
    const stash = state.draft.picks;
    state.draft.picks = stash.filter(pk => pk.managerId !== strip);
    document.querySelector(`[data-dirmid="${strip}"]`).click();
    const prof = document.querySelector('#clubProfileOverlay');
    const out = {
      opened: !!prof,
      emptyRecords: /record books open at GW1/i.test(prof.textContent),
      preSeason: /Pre-season optimism/.test(prof.textContent),
      clean: !/NaN|undefined|Infinity/.test(prof.textContent),
    };
    prof.remove(); history.back();
    state.draft.picks = stash;
    return out;
  }));
  chk('D8: squadded club shows a real record row pre-season; squadless club shows the empty copy — both with pre-season mood, no NaN',
    !d6.otherEmptyRecords && d8b.opened && d8b.emptyRecords && d6.otherPreSeason && d8b.preSeason && d8b.clean,
    JSON.stringify(d8b));
  const d7 = await sleep(80).then(() => dp.evaluate(() => {
    document.querySelector(`[data-dirmid="${whoami}"]`).click();
    const prof = document.querySelector('#clubProfileOverlay');
    const hasEdit = !!prof.querySelector('#clubEdit');
    prof.querySelector('#clubEdit')?.click();
    const officeOpened = !!document.querySelector('.club-office');
    document.querySelector('#clubCancel')?.click();
    return { hasEdit, officeOpened };
  }));
  chk('D7: own profile offers the club office and it opens', d7.hasEdit && d7.officeOpened, JSON.stringify(d7));

  /* D9 — card → profile → Back returns to the directory, scroll intact */
  const d9 = await sleep(120).then(() => dp.evaluate(async () => {
    document.querySelectorAll('.overlay').forEach(o => o.remove());
    state.view = 'directory'; render();
    window.scrollTo(0, 300);
    await new Promise(r => setTimeout(r, 50));
    const preScroll = window.scrollY;
    document.querySelector('[data-dirmid]').click();
    const opened = !!document.querySelector('#clubProfileOverlay');
    history.back();
    await new Promise(r => setTimeout(r, 150));
    return { preScroll, opened, gone: !document.querySelector('#clubProfileOverlay'), view: state.view, scroll: window.scrollY };
  }));
  chk('D9: Back closes the profile, stays on the directory, keeps scroll',
    d9.opened && d9.gone && d9.view === 'directory' && d9.preScroll > 0 && Math.abs(d9.scroll - d9.preScroll) < 60,
    JSON.stringify(d9));

  /* D2b — once results exist, order = league position (demo has a full season) */
  const demoP = await newPage(dCtx, baseUrl + '?demo');
  const d2b = await demoP.evaluate(() => {
    state.view = 'directory'; render();
    const mids = [...document.querySelectorAll('[data-dirmid]')].map(b => +b.dataset.dirmid);
    const table = h2hStandings(false);
    return { mids, tableIds: table.map(r => r.id), anyPlayed: table.some(r => r.p > 0) };
  });
  chk('D2: with results (precondition: games played) cards follow league position',
    d2b.anyPlayed && JSON.stringify(d2b.mids) === JSON.stringify(d2b.tableIds), JSON.stringify(d2b.mids));
  await demoP.close();

  /* D10 — 320px: one column, no overflow */
  const d320 = await newPage(dCtx, baseUrl + '?demo', { width: 320, height: 650 });
  const d10 = await d320.evaluate(() => {
    state.view = 'directory'; render();
    const cards = [...document.querySelectorAll('.dir-card')];
    const grid = document.querySelector('.dir-grid');
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    return { cards: cards.length, cols, scrollW: document.documentElement.scrollWidth };
  });
  chk('D10: 320px directory — 12 cards, one column, no horizontal overflow',
    d10.cards === 12 && d10.cols === 1 && d10.scrollW <= 320, JSON.stringify(d10));
  await d320.close();

  /* ═══════════════ GLOBAL PLAYER SEARCH ═══════════════ */
  const gp = dp; // same seeded season page: known squads + free agents
  await gp.evaluate(() => { document.querySelectorAll('.overlay').forEach(o => o.remove()); state.view = 'dash'; render(); });

  /* G12 setup — record every WCSync call for the whole search session */
  await gp.evaluate(() => {
    window.__wcCalls = [];
    window.WCSync = { call: (...a) => { window.__wcCalls.push(a); return Promise.resolve({}); } };
  });

  /* G1 — header button opens */
  const g1 = await gp.evaluate(() => {
    const btn = document.getElementById('gSearchBtn');
    btn?.click();
    const ov = document.getElementById('searchOverlay');
    const out = { btn: !!btn, open: !!ov, focused: document.activeElement.id, hint: ov?.querySelector('.gs-hint')?.textContent.slice(0, 20) || '' };
    if (ov) closeOv(ov);
    return out;
  });
  chk('G1: header search button exists, opens the palette, focus lands in the box',
    g1.btn && g1.open && g1.focused === 'gsq' && g1.hint.length > 0, JSON.stringify(g1));

  /* G2 — Ctrl+K and "/" open it */
  const g2 = await sleep(100).then(() => gp.evaluate(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    const viaK = !!document.getElementById('searchOverlay');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); // toggles closed
    await new Promise(r => setTimeout(r, 100));
    const closedAgain = !document.getElementById('searchOverlay');
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    const viaSlash = !!document.getElementById('searchOverlay');
    return { viaK, closedAgain, viaSlash };
  }));
  chk('G2: Ctrl+K opens (and toggles closed); "/" opens', g2.viaK && g2.closedAgain && g2.viaSlash, JSON.stringify(g2));

  /* G3 — "/" typed inside another input must NOT open the palette */
  const g3 = await sleep(100).then(() => gp.evaluate(async () => {
    const ov = document.getElementById('searchOverlay');
    if (ov) { closeOv(ov); await new Promise(r => setTimeout(r, 100)); }
    state.view = 'transfers'; transfersView.tab = 'trough'; render();
    const inp = document.getElementById('trSearch');
    inp.focus();
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    return { inputExists: !!inp, opened: !!document.getElementById('searchOverlay') };
  }));
  chk('G3: "/" inside the Trough search box does not hijack (precondition: box exists)',
    g3.inputExists && !g3.opened, JSON.stringify(g3));

  /* G4/G5/G6/G7/G8 — ranking, normalisation, coverage, labels, no-results */
  const g4 = await gp.evaluate(() => {
    state.view = 'dash'; render();
    openPlayerSearch();
    const ov = document.getElementById('searchOverlay');
    const q = ov.querySelector('#gsq');
    const type = v => { q.value = v; q.dispatchEvent(new Event('input')); };
    const names = () => [...ov.querySelectorAll('.gs-row .gs-name')].map(el => el.textContent.trim());
    // an owned player (manager 1's first pick) and a definitely-free player
    const ownedP = PLAYER_BY_ID[state.draft.picks[0].playerId];
    const ownedIds = new Set(state.draft.picks.map(pk => pk.playerId));
    const freeP = [...PLAYERS].sort((a, b) => b.pts - a.pts).find(p => !ownedIds.has(p.id));
    const accented = PLAYERS.find(p => /[^\x00-\x7f]/.test(p.name) && normName(p.name) !== p.name.toLowerCase());

    type(ownedP.name);
    const exactFirst = names()[0]?.includes(ownedP.name);
    const ownedLabel = ov.querySelector('.gs-row .gs-sub:last-of-type')?.textContent || '';

    // ranking property: with a 3-letter query, every prefix match (short OR
    // full name — the same fields the palette ranks on) precedes every
    // partial-only match
    const pre = normName(ownedP.name).slice(0, 3);
    type(pre);
    const rowPids = [...ov.querySelectorAll('.gs-row')].map(r => +r.dataset.pcard);
    const ranks = rowPids.map(pid => {
      const pl = PLAYER_BY_ID[pid];
      const nm = normName(pl.name), fl = normName(pl.full || '');
      return (nm === pre || fl === pre) ? 0 : (nm.startsWith(pre) || fl.startsWith(pre)) ? 1 : 2;
    });
    const rankedOk = ranks.every((r, i) => i === 0 || r >= ranks[i - 1]);
    const hasBoth = ranks.some(r => r <= 1) && ranks.includes(2);

    type(freeP.name);
    const freeLabel = ov.querySelector('.gs-row .gs-sub:last-of-type')?.textContent || '';
    const freeFound = names()[0]?.includes(freeP.name);

    let accentOk = null, accentName = null;
    if (accented) {
      accentName = accented.name;
      type(normName(accented.name)); // ascii-stripped
      accentOk = names().some(nm => nm.includes(accented.name));
    }
    type(`  ${ownedP.name.toLowerCase()}..  `); // punctuation + case + spaces
    const punctOk = names()[0]?.includes(ownedP.name);

    type('zzz nobody plays here');
    const noRes = ov.querySelector('.gs-hint')?.textContent || '';

    return { exactFirst, ownedLabel, rankedOk, hasBoth, freeFound, freeLabel, accented: !!accented, accentName, accentOk, punctOk, noRes, ownedName: ownedP.name, freeName: freeP.name };
  });
  chk('G4: exact-name query puts that player first; prefix matches precede partials',
    g4.exactFirst && g4.rankedOk && g4.hasBoth, JSON.stringify({ rankedOk: g4.rankedOk, hasBoth: g4.hasBoth }));
  chk('G5: accent-stripped query finds the accented name (precondition: one exists)',
    g4.accented && g4.accentOk === true, `${g4.accentName}`);
  chk('G5: case/punctuation/extra-space query still hits', g4.punctOk, '');
  chk('G6/G7: owned player found and labelled with owner; free agent found and labelled free',
    g4.exactFirst && /Owned by/.test(g4.ownedLabel) && g4.freeFound && /free agent|on waivers/.test(g4.freeLabel),
    JSON.stringify({ ownedLabel: g4.ownedLabel, freeLabel: g4.freeLabel }));
  chk('G8: no-results state renders', /No one matches/.test(g4.noRes), g4.noRes.slice(0, 40));

  /* G7b — a locked new arrival is labelled from the draft-pool snapshot */
  const g7b = await gp.evaluate(() => {
    const ov = document.getElementById('searchOverlay');
    const q = ov.querySelector('#gsq');
    const ownedIds = new Set(state.draft.picks.map(pk => pk.playerId));
    const freeP = [...PLAYERS].sort((a, b) => b.pts - a.pts).find(p => !ownedIds.has(p.id));
    // an arrival is a man the draft-night snapshot never saw. Changing his
    // club used to do it, but moving between two PL clubs is no longer
    // arriving — he was already on the game (Marc, 21 Aug) — so leave him out
    // of the snapshot entirely, which is what a genuine new arrival looks like
    state.draftPool = { at: 1, ids: Object.fromEntries(PLAYERS.filter(p => p.id !== freeP.id).map(p => [p.id, p.club])) };
    q.value = freeP.name; q.dispatchEvent(new Event('input'));
    const label = ov.querySelector('.gs-row .gs-sub:last-of-type')?.textContent || '';
    state.draftPool = null;
    return { isArr: label };
  });
  chk('G7: post-draft arrival shows locked "new arrival" label', /new arrival/.test(g7b.isArr), g7b.isArr);

  /* G9/G10 — card over palette: query survives; Escape and Back peel layers in order */
  const g9 = await gp.evaluate(async () => {
    const ov = document.getElementById('searchOverlay');
    const q = ov.querySelector('#gsq');
    q.value = state.managers[0].name ? PLAYER_BY_ID[state.draft.picks[0].playerId].name : 'x';
    q.dispatchEvent(new Event('input'));
    document.querySelector('.gs-row').click();
    const cardOpen = !!document.getElementById('pcardOverlay');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 120));
    const afterEsc1 = { card: !!document.getElementById('pcardOverlay'), search: !!document.getElementById('searchOverlay'), query: document.getElementById('gsq')?.value };
    document.querySelector('.gs-row').click();
    const cardOpen2 = !!document.getElementById('pcardOverlay');
    history.back();
    await new Promise(r => setTimeout(r, 150));
    const afterBack = { card: !!document.getElementById('pcardOverlay'), search: !!document.getElementById('searchOverlay') };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 120));
    const afterEsc2 = { search: !!document.getElementById('searchOverlay') };
    return { cardOpen, afterEsc1, cardOpen2, afterBack, afterEsc2 };
  });
  chk('G9: player card opened from a result; closing returns to palette with query intact',
    g9.cardOpen && !g9.afterEsc1.card && g9.afterEsc1.search && (g9.afterEsc1.query || '').length > 0,
    JSON.stringify(g9.afterEsc1));
  chk('G10: browser Back closes the card, not the palette; Escape then closes the palette',
    g9.cardOpen2 && !g9.afterBack.card && g9.afterBack.search && !g9.afterEsc2.search, JSON.stringify({ afterBack: g9.afterBack, afterEsc2: g9.afterEsc2 }));

  /* G11 — contextual actions deep-link without touching league state */
  const g11 = await sleep(100).then(() => gp.evaluate(async () => {
    const transfersBefore = state.transfers.length;
    const ownedIds = new Set(state.draft.picks.map(pk => pk.playerId));
    const freeP = [...PLAYERS].sort((a, b) => b.pts - a.pts).find(p => !ownedIds.has(p.id));
    openPlayerSearch();
    let ov = document.getElementById('searchOverlay');
    let q = ov.querySelector('#gsq');
    q.value = freeP.name; q.dispatchEvent(new Event('input'));
    const troughBtn = ov.querySelector('[data-gsact="trough"]');
    troughBtn?.click();
    await new Promise(r => setTimeout(r, 150));
    const afterTrough = { view: state.view, tab: transfersView.tab, prefill: document.getElementById('trSearch')?.value, palGone: !document.getElementById('searchOverlay') };
    // owner deep link
    openPlayerSearch();
    ov = document.getElementById('searchOverlay');
    q = ov.querySelector('#gsq');
    const otherOwned = PLAYER_BY_ID[state.draft.picks.find(pk => pk.managerId !== whoami).playerId];
    q.value = otherOwned.name; q.dispatchEvent(new Event('input'));
    const ownerMid = +ov.querySelector('[data-gsact="owner"]').dataset.gsmid;
    ov.querySelector('[data-gsact="owner"]').click();
    await new Promise(r => setTimeout(r, 150));
    const afterOwner = { view: state.view, teamMid: teamView.mid, ownerMid };
    return { hadTroughBtn: !!troughBtn, afterTrough, afterOwner, mutated: state.transfers.length !== transfersBefore };
  }));
  chk('G11: "Open in Transfers" lands on the Trough with the player pre-searched',
    g11.hadTroughBtn && g11.afterTrough.view === 'transfers' && g11.afterTrough.tab === 'trough'
      && (g11.afterTrough.prefill || '').length > 0 && g11.afterTrough.palGone,
    JSON.stringify(g11.afterTrough));
  chk('G11: "View owner" lands on that owner\'s team page',
    g11.afterOwner.view === 'team' && g11.afterOwner.teamMid === g11.afterOwner.ownerMid, JSON.stringify(g11.afterOwner));
  chk('G11: no transfer/waiver/trade was performed by search actions', !g11.mutated, '');

  /* G12 — zero WCSync mutation calls across the whole search session */
  const g12 = await gp.evaluate(() => window.__wcCalls.length);
  chk('G12: search made zero WCSync calls', g12 === 0, `${g12} calls`);

  /* ═══════ photo chain (deterministic via request interception) ═══════ */
  const photoPage = async rules => {
    const ctx = await browser.createBrowserContext();
    const p = await ctx.newPage();
    p.on('pageerror', e => allErrors.push('photo: ' + e.message));
    await p.setRequestInterception(true);
    p.on('request', req => {
      const u = req.url();
      if (u.includes('resources.premierleague.com')) {
        const verdict = rules(u);
        if (verdict === 'ok') return req.respond({ status: 200, contentType: 'image/png', body: PNG });
        return req.respond({ status: 403, contentType: 'text/plain', body: 'no' });
      }
      req.continue();
    });
    await p.goto(baseUrl + '?nosync', { waitUntil: 'networkidle2' });
    await p.waitForFunction(() => typeof state !== 'undefined' && state.managers.length);
    return { ctx, p };
  };
  const probe = (p) => p.evaluate(async () => {
    const img = document.createElement('img');
    img.className = 'headshot';
    img.dataset.code = '424242';
    img.src = PHOTO_NEW('424242');
    document.body.appendChild(img);
    await new Promise(r => setTimeout(r, 900));
    const first = { fbk: img.dataset.fbk || null, src: img.src };
    await new Promise(r => setTimeout(r, 500));
    return { first, stable: img.src === first.src && (img.dataset.fbk || null) === first.fbk };
  });

  /* G13 — current library present: loads directly, chain never fires */
  const c13 = await photoPage(u => u.includes('premierleague25') ? 'ok' : 'no');
  const g13 = await probe(c13.p);
  chk('G13: current-library photo loads directly (no fallback stage)',
    g13.first.fbk === null && g13.first.src.includes('premierleague25') && g13.stable, JSON.stringify(g13));
  /* G16 — Zubimendi (current-only, sol\'s repro): player card starts on the new library */
  const g16 = await c13.p.evaluate(async () => {
    const zubi = PLAYERS.find(p => /zubimendi/i.test(p.name) || /zubimendi/i.test(p.full || ''));
    if (!zubi) return { found: false };
    showPlayerCard(zubi.id);
    const img = document.querySelector('#pcardOverlay .pcard-photo');
    await new Promise(r => setTimeout(r, 700));
    return { found: true, src: img.src, code: img.dataset.code, want: String(zubi.code), fbk: img.dataset.fbk || null };
  });
  chk('G16: Zubimendi exists (precondition) and his card photo is the current library with data-code',
    g16.found && g16.src.includes('premierleague25') && g16.code === g16.want && g16.fbk === null, JSON.stringify(g16));
  await c13.ctx.close();

  /* G14 — legacy-only player: exactly one fallback, stops at fbk=1 */
  const c14 = await photoPage(u => u.includes('premierleague25') ? 'no' : 'ok');
  const g14 = await probe(c14.p);
  chk('G14: current 403 → legacy loads, chain rests at fbk=1',
    g14.first.fbk === '1' && /premierleague\/photos/.test(g14.first.src) && g14.stable, JSON.stringify(g14));
  await c14.ctx.close();

  /* G15 — missing from both: silhouette once at fbk=2, no loop */
  const c15 = await photoPage(u => u.includes('Photo-Missing') ? 'ok' : 'no');
  const g15 = await probe(c15.p);
  chk('G15: missing everywhere → silhouette exactly once at fbk=2, src stable (no loop)',
    g15.first.fbk === '2' && g15.first.src.includes('Photo-Missing') && g15.stable, JSON.stringify(g15));
  await c15.ctx.close();

  /* G18 — 320px search palette */
  const g320 = await newPage(dCtx, baseUrl + '?demo', { width: 320, height: 650 });
  const g18 = await g320.evaluate(async () => {
    const home = document.getElementById('homeBtn');
    const homeRect = home.getBoundingClientRect();
    document.getElementById('gSearchBtn').click();
    const ov = document.getElementById('searchOverlay');
    const q = ov.querySelector('#gsq');
    q.value = 'a'; q.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 100));
    return {
      open: !!ov, rows: ov.querySelectorAll('.gs-row').length,
      scrollW: document.documentElement.scrollWidth,
      home: {
        w: homeRect.width, h: homeRect.height,
        label: home.getAttribute('aria-label'),
        textVisible: getComputedStyle(home.querySelector('.sync-txt')).display !== 'none',
      },
    };
  });
  chk('G1b/G18: 320px header is compact; search fits and Home remains accessible',
    g18.open && g18.rows > 0 && g18.scrollW <= 320
      && g18.home.w >= 36 && g18.home.h >= 36
      && g18.home.label === 'Dashboard' && !g18.home.textVisible,
    JSON.stringify(g18));
  await g320.close();

  /* G17 — no uncaught page errors anywhere */
  chk('G17: no uncaught page errors across all pages', allErrors.length === 0, allErrors.join(' | ').slice(0, 200));

  await browser.close();
  console.log(`\nux3.smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
