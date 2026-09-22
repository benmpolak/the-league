/* The trade record, when you don't keep what you took (Marc, 22 Sept 2026:
 * "it doesnt account for when a player you transfer in is then released. you
 * have ian taking murillo for simms as plus 10 but he barely owned murillo").
 *
 * The bug was that the review window summed six gameweeks of the incoming man
 * whether or not he was still on the books, so a manager could take a player,
 * bin him a week later, and be credited with everything he scored for somebody
 * else afterwards.
 *
 * The first test here is Marc's case, built to order: take a man, hold him one
 * week, let him go, and have him haul for the rest of the window. Under the old
 * rule that deal read as a triumph. It must not any more.
 *
 * The second thing tested is the trap in the fix: truncating only the INCOMING
 * half would swing the lie the other way round, marking one week of the man you
 * took against six of the man you shipped and calling every sale a disaster.
 * Both sides have to be read over the same shortened window.
 *
 * Run against any side-port server with TEST_BASE_URL=http://127.0.0.1:8749.
 */
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
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const log = await page.evaluate(() => {
    const log = [];
    const t = (name, ok, detail = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

    state = buildDemoState(); state.phase = 'season';
    myId = whoami = state.managers[0].id;

    /* Seven settled rounds, every player on zero, so any points in this test
       are ones the test itself awarded and nothing is luck. */
    const ROUNDS = 8;
    for (let i = 0; i < ROUNDS && i < GAMEWEEKS.length; i++) {
      const gwN = GAMEWEEKS[i].n;
      state.matchStats['gw' + gwN] = { gw: i, label: GAMEWEEKS[i].label, final: true, playerStats: {} };
      GAMEWEEKS[i].finished = true;
      for (const f of state.fixtures) if (f.gw === gwN) f.finished = true;
    }
    const score = (pid, i, pts) => {
      // a start plus enough goals to land on the points we want, roughly —
      // exact value does not matter, only that it is the same for both men
      state.matchStats['gw' + GAMEWEEKS[i].n].playerStats[pid] = { min: 90, st: 1, g: pts, a: 0, cs: 0 };
    };
    const ptsOf = (pid, i) => gwPlayerPoints(pid, i);

    const mid = state.managers[4].id;           // Ian's seat, as it happens
    const squad = squadAt(mid, 0);
    const keep = squad[0].id;                   // the man he ships out
    // somebody else's player to take in
    const theirs = squadAt(state.managers[5].id, 0)[0].id;

    // GW1: the trade. He takes `theirs`, ships `keep`.
    state.transfers = [
      { managerId: mid, inId: theirs, outId: keep, gw: 1, t: 1000, trade: 'T1' },
      { managerId: state.managers[5].id, inId: keep, outId: theirs, gw: 1, t: 1000, trade: 'T1' },
      // GW2: he bins the man he just took
      { managerId: mid, inId: squad[1].id === theirs ? squad[2].id : squad[1].id, outId: theirs, gw: 2, t: 2000 },
    ];
    // the man he took scores nothing for him, then hauls once he is gone
    score(theirs, 1, 0);
    for (let i = 2; i < 7; i++) score(theirs, i, 4);
    // and the man he shipped scores steadily throughout
    for (let i = 1; i < 7; i++) score(keep, i, 1);

    const deal = state.transfers[0];
    const wf = transferWindowFacts(deal, 6);
    t('(setup) the six-gameweek window is complete', !!wf, wf ? `${wf.full} gws` : 'null');
    if (!wf) return log;

    /* ----- Marc's case ----- */
    const afterLeaving = [2, 3, 4, 5, 6].reduce((a, i) => a + ptsOf(theirs, i), 0);
    t('(control) the man he took really did haul after leaving', afterLeaving > 0, `${afterLeaving} pts`);
    t('the window closes when the man he took leaves',
      wf.live === 1 && wf.shortened, `judged over ${wf.live} of ${wf.full}`);
    t('his points after leaving are NOT credited to the deal',
      wf.inPts === ptsOf(theirs, 1), `deal credits ${wf.inPts}, he scored ${afterLeaving} more after going`);
    t('and the deal does not read as a triumph',
      wf.diff <= 0, `net ${wf.diff >= 0 ? '+' : ''}${wf.diff}`);
    t('the working still remembers what he went on to score',
      wf.inn[0].after === afterLeaving, `${wf.inn[0].after} vs ${afterLeaving}`);
    t('and records how long he was actually held', wf.inn[0].held === 1, String(wf.inn[0].held));

    /* ----- the trap: don't swing the lie the other way ----- */
    t('the man he shipped is judged over the SAME shortened window, not the full six',
      wf.outPts === ptsOf(keep, 1),
      `out ${wf.outPts}, his full six would be ${[1,2,3,4,5,6].reduce((a,i)=>a+ptsOf(keep,i),0)}`);
    t('so a sale is not automatically a disaster',
      wf.diff > -[2,3,4,5,6].reduce((a,i)=>a+ptsOf(keep,i),0), `net ${wf.diff}`);

    /* ----- a deal he DID keep is untouched by any of this ----- */
    (() => {
      state.transfers = [{ managerId: mid, inId: theirs, outId: keep, gw: 1, t: 1000, trade: 'T2' },
        { managerId: state.managers[5].id, inId: keep, outId: theirs, gw: 1, t: 1000, trade: 'T2' }];
      const w = transferWindowFacts(state.transfers[0], 6);
      const full = [1,2,3,4,5,6].reduce((a,i)=>a+ptsOf(theirs,i),0);
      t('a man kept for the whole window still counts for the whole window',
        w.live === w.full && !w.shortened && w.inPts === full, `${w.inPts} of ${full} over ${w.live}/${w.full}`);
      t('and nothing is marked as scored after leaving', w.inn[0].after === 0);
      t('he is recorded as held for every gameweek', w.inn[0].held === w.full);
    })();

    /* ----- a man flipped on immediately ----- */
    (() => {
      state.transfers = [{ managerId: mid, inId: theirs, outId: keep, gw: 1, t: 1000, trade: 'T3' },
        { managerId: state.managers[5].id, inId: keep, outId: theirs, gw: 1, t: 1000, trade: 'T3' },
        { managerId: mid, inId: squad[3].id, outId: theirs, gw: 1, t: 1500 }];
      const w = transferWindowFacts(state.transfers[0], 6);
      t('a man moved on inside the same week credits the deal nothing',
        w && w.live === 0 && w.inPts === 0 && w.outPts === 0, w ? `live ${w.live}, net ${w.diff}` : 'null');
      t('and that is said plainly rather than shown as a blank', w && w.inn[0].held === 0);
    })();

    /* ----- and it reaches the card ----- */
    (() => {
      state.transfers = [{ managerId: mid, inId: theirs, outId: keep, gw: 1, t: 1000, trade: 'T4' },
        { managerId: state.managers[5].id, inId: keep, outId: theirs, gw: 1, t: 1000, trade: 'T4' },
        { managerId: mid, inId: squad[1].id === theirs ? squad[2].id : squad[1].id, outId: theirs, gw: 2, t: 2000 }];
      const host = document.createElement('div');
      host.innerHTML = reportCardHtml(state.transfers[0]);
      const txt = host.textContent.replace(/\s+/g, ' ');
      t('the report card says the window was cut short',
        /judged over the 1 gameweek he held him, not 6/.test(txt), txt.slice(0, 200));
      t('and names what he scored after leaving',
        new RegExp(`scored ${afterLeaving} after leaving`).test(txt), txt.slice(0, 220));
      // the trade record card must agree with the report card
      tradeView.scope = 'trades';
      const rec = document.createElement('div');
      rec.innerHTML = tradeRecordCard();
      const rtxt = rec.textContent.replace(/\s+/g, ' ');
      t('the trade record explains that a man moved on counts only while held',
        /counts only for the weeks you actually held him/.test(rtxt));
      t('and the net it prints is the net the facts carry',
        rtxt.includes(`${wf.diff >= 0 ? '+' : ''}${wf.diff}`), `looking for ${wf.diff}`);
    })();

    return log;
  });

  for (const line of log) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[trade-release] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
