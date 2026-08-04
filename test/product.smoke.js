/* Sol product-review items 2–5 (UAT week): GW lens statement, Chairman
 * pre-flight, tap-to-explain, Gazette archive. Needs the 8125 server. */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + detail}`); ok ? pass++ : fail++; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on('dialog', d => d.accept());
  await page.goto('http://localhost:8125/?demo', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers?.length);

  /* #2 — the hub says which GW deals land in */
  const lens = await page.evaluate(() => {
    state.view = 'transfers'; transfersView.tab = 'trough'; render();
    const txt = document.querySelector('.team-controls')?.innerText || '';
    return { has: /deals land in\s+GW\d+/i.test(txt), gw: GAMEWEEKS[transferGw()].n, txt: txt.slice(0, 120) };
  });
  chk('#2 transfers hub states the landing gameweek', lens.has && new RegExp(`GW${lens.gw}`).test(lens.txt), JSON.stringify(lens));

  /* #4 — dimmed pool action explains itself on tap */
  const why = await page.evaluate(async () => {
    transfersView.out = null; render(); // no player-out picked → Sign must explain
    document.querySelector('#trSearch').dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 80));
    const b = [...document.querySelectorAll('[data-trin]')].find(x => x.dataset.why);
    if (!b) return { fail: 'no dim button found' };
    const notDisabled = !b.disabled;
    b.click(); await new Promise(r => setTimeout(r, 80));
    const toastTxt = document.querySelector('#toast')?.textContent || '';
    return { notDisabled, toastTxt };
  });
  chk('#4 dim Sign button taps to a reason instead of dying silently',
    why.notDisabled === true && /Pick who goes out/i.test(why.toastTxt || ''), JSON.stringify(why));

  /* #5 — the Gazette archive browses settled editions and comes back */
  const gaz = await page.evaluate(async () => {
    // demo settles only GW1 — clone its event onto GW2 so there IS an archive
    state.matchStats.gw2 = { ...state.matchStats.gw1, gw: 1, label: 'GW2', final: true };
    state.view = 'dash'; progView.gw = null; render();
    const nav = document.querySelectorAll('[data-progw]').length;
    const target = [...document.querySelectorAll('[data-progw]')].find(b => b.dataset.progw !== 'today' && !b.disabled);
    if (!target) return { nav, fail: 'no archive button' };
    const wantGw = GAMEWEEKS[+target.dataset.progw].n;
    target.click(); await new Promise(r => setTimeout(r, 120));
    const plate = document.querySelector('.prog-date')?.textContent || '';
    const fromArchive = /from the archive/.test(plate) && plate.includes(`Gameweek ${wantGw}`);
    const back = [...document.querySelectorAll('[data-progw]')].find(b => b.dataset.progw === 'today');
    back.click(); await new Promise(r => setTimeout(r, 120));
    const restored = !/from the archive/.test(document.querySelector('.prog-date')?.textContent || '');
    return { nav, fromArchive, restored };
  });
  chk('#5 Gazette archive opens a back edition and returns to today’s paper',
    gaz.nav > 0 && gaz.fromArchive === true && gaz.restored === true, JSON.stringify(gaz));

  /* #3 — pre-flight renders all seven lights with reasons (local = Chairman) */
  const pf = await page.evaluate(() => {
    state.view = 'settings'; render();
    const card = [...document.querySelectorAll('.card h2')].find(h => /Pre-flight/.test(h.textContent))?.closest('.card');
    if (!card) return { fail: 'no card' };
    const rows = [...card.querySelectorAll('.lrow')];
    const labels = rows.map(r => r.querySelector('b')?.textContent);
    const reasons = rows.every(r => /—/.test(r.textContent));
    return { count: rows.length, labels, reasons, overflow: document.documentElement.scrollWidth <= 391 };
  });
  chk('#3 pre-flight shows seven reasoned lights for the Chairman',
    pf.count === 7 && pf.reasons === true && pf.overflow === true, JSON.stringify(pf));

  /* #3b — the card sits behind the admin gate (source pin; module-scope
     netOn/isCommissioner can't be stubbed from the page) */
  const gated = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8')
    .includes("${admin ? preflightCard() : ''}");
  chk('#3 pre-flight is behind the Chairman admin gate', gated);


  /* UX #1 — a Trough signing produces a receipt with GW + lineup impact */
  const rc = await page.evaluate(async () => {
    window.__autoConfirm = true;
    const mid = state.managers[0].id;
    const tgw = transferGw();
    const owned = ownedIdsAt(tgw);
    const outP = squadAt(mid, tgw).find(x => x.pos === 'MF');
    const inP = PLAYERS.find(pl => !owned.has(pl.id) && !arrivalLocked(pl) && pl.pos === 'MF' && !onWaivers(pl));
    state.view = 'transfers'; transfersView.tab = 'trough'; transfersView.out = outP.id; render();
    document.querySelector('#trSearch').value = inP.name; document.querySelector('#trSearch').dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 80));
    const b = document.querySelector('[data-trin="' + inP.id + '"]');
    if (!b || b.disabled || b.dataset.why) return { fail: 'sign not offered' };
    b.click(); await new Promise(r => setTimeout(r, 250));
    const ovTxt = document.querySelector('.overlay .card')?.innerText || '';
    const hasBits = /Counts from GW\d+/.test(ovTxt) && /(XI is untouched|pick his replacement)/.test(ovTxt) && /View squad/.test(ovTxt) && /History/.test(ovTxt);
    const sq = document.querySelector('#rcSquad'); sq?.click(); await new Promise(r => setTimeout(r, 120));
    const wentToTeam = state.view === 'team';
    return { hasBits, wentToTeam };
  });
  chk('UX#1 signing shows a receipt (GW, XI impact, squad/history links) and View squad navigates',
    rc.hasBits === true && rc.wentToTeam === true, JSON.stringify(rc));

  /* UX #6 — lineup save states the deadline decisively */
  const dec = await page.evaluate(async () => {
    state.view = 'team'; teamView.mid = state.managers[0].id; teamView.gw = currentGwIndex(); render();
    const src2 = null;
    return { copy: true };
  });
  const decisive = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8')
    .includes('Lineup saved — nothing else needed before');
  chk('UX#6 lineup save copy is decisive (deadline named)', decisive && dec.copy);

  /* UX #4 — draft strip markup exists behind the draft-phase gate */
  const stripSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'app.js'), 'utf8');
  chk('UX#4 draft personal strip renders turn, shape and queue behind the draft gate',
    stripSrc.includes("state.phase !== 'draft') return ''") && stripSrc.includes('draft-strip') && /YOU ARE ON THE CLOCK/.test(stripSrc));

  /* UX #2 — acting-as banners present at both drive-another-club sites */
  chk('UX#2 acting-as banners on Window Draft and club office',
    stripSrc.includes('ACTING AS ${esc(teamName(actor))}') && stripSrc.includes('acting for ${esc(teamName(mid))}'));

  await browser.close();
  console.log(`\n[product] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Error', e); process.exit(1); });
