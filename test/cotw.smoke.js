/* The Committee's C*** of the Week charge sheet (Marc's ledger #9).
 * Every charge must fire on evidence the app actually holds, and — just as
 * important — a league that behaved itself must be charged with nothing.
 * Run against any side-port server with TEST_BASE_URL=http://127.0.0.1:8135.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' \u2014 ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const log = await page.evaluate(() => {

    const log = [];
    function baseline() {
      state = buildDemoState();
      const ps = state.matchStats.gw1.playerStats;
      state.transfers = []; state.trades = []; state.claims = {};
      state.covenants = []; state.suggestions = [];
      state.fixtures = [];
      const clubs = [...new Set(PLAYERS.map(x => x.team))];
      for (let k = 0; k + 1 < clubs.length; k += 2)
        state.fixtures.push({ gw: GAMEWEEKS[0].n, home: clubs[k], away: clubs[k + 1], finished: true });
      state.hamCup = { gw: 0, drawnAt: '', entries: {} };
      for (const m of state.managers) {
        const sq = squadAt(m.id, 0);
        for (const pl of sq) ps[pl.id] = { min: 90, st: 1, sub: 0, g: 0, a: 0, cs: 0, gc: 0, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0 };
        state.lineups[m.id] = { 0: autoXI(sq) };
        state.lobus[m.id] = sq[0].id;
        state.hamCup.entries[m.id] = autoXI(sq);
        state.benchOrders[m.id] = { 0: sq.map(x => x.id) };
        state.autolists[m.id] = sq.map(x => x.id);
        state.ready[m.id] = { t: 1, self: true };
        state.heckles[m.id] = { line: 0, t: 1 };
        state.tradeBlock[m.id] = [sq[sq.length - 1].id];
        state.draft.timewastes[m.id] = 0;
      }
    }
    // a charge is proven if it appears anywhere on that manager's sheet —
    // standing offences legitimately co-occur with weekly ones
    const t = (name, mid, wantGravity, wantText, setup, gw = 0) => {
      baseline();
      try { setup(); } catch (e) { log.push(`FAIL  ${String(wantGravity).padStart(2)} ${name} — setup threw: ${e.message}`); return; }
      const mine = cotwCharges(gw).filter(c => c.id === mid);
      const got = mine.find(c => c.gravity === wantGravity);
      const ok = !!got && got.why.includes(wantText);
      log.push(`${ok ? 'PASS' : 'FAIL'}  ${String(wantGravity).padStart(2)} ${name}${ok ? ` — "${got.why}"` : ` — got ${JSON.stringify(mine.map(c => c.gravity + ':' + c.why))}`}`);
    };

    baseline();
    const clean = cotwCharges(0);
    log.push(`${clean.length === 0 ? 'PASS' : 'FAIL'}   0 a league that behaved itself is charged with nothing${clean.length ? ' — ' + JSON.stringify(clean.slice(0, 3)) : ''}`);

    const M = state.managers.map(m => m.id);
    const sqOf = mid => squadAt(mid, 0);
    const dl = Date.parse(GAMEWEEKS[0].from);
    const free = pos => PLAYERS.find(x => !ownedIdsAt(0).has(x.id) && x.pos === pos);
    const benched = mid => sqOf(mid).find(x => !state.lineups[mid][0].includes(x.id));
    const setStat = (pid, o) => { state.matchStats.gw1.playerStats[pid] = { min: 90, st: 1, sub: 0, g: 0, a: 0, cs: 0, gc: 0, og: 0, ps: 0, pm: 0, yc: 0, rc: 0, sv: 0, ...o }; };

    t('blank gameweek', M[0], 1, 'not playing', () => {
      const victim = PLAYER_BY_ID[state.lineups[M[0]][0][0]];
      state.fixtures = state.fixtures.filter(f => f.home !== victim.team && f.away !== victim.team);
    });
    t('revolving door', M[1], 2, 'having seen enough', () => {
      const pl = sqOf(M[1])[0], spare = free(pl.pos);
      state.transfers.push({ managerId: M[1], outId: spare.id, inId: pl.id, gw: 0, n: 1, t: 100 });
      state.transfers.push({ managerId: M[1], outId: pl.id, inId: spare.id, gw: 0, n: 2, t: 200 });
    });
    t('turned up short', M[2], 3, 'who actually kicked a ball', () => {
      for (const pid of state.lineups[M[2]][0]) setStat(pid, { min: 0, st: 0 });
    });
    t('binned a hauler', M[3], 4, 'the same week', () => {
      const pl = sqOf(M[3]).find(x => x.pos === 'FW');
      setStat(pl.id, { g: 3, a: 1 });
      state.transfers.push({ managerId: M[3], outId: pl.id, inId: free('FW').id, gw: 0, n: 1, t: 100 });
    });
    t('sent off', M[4], 5, 'who was sent off', () => setStat(state.lineups[M[4]][0][0], { rc: 1 }));
    t('own goal', M[5], 6, 'wrong end', () => setStat(state.lineups[M[5]][0][0], { og: 1 }));
    t('missed penalty', M[6], 7, 'declined it', () => setStat(state.lineups[M[6]][0][0], { pm: 1 }));
    t('short team sheet', M[7], 8, 'leaving the Committee to finish it', () => {
      state.lineups[M[7]][0] = state.lineups[M[7]][0].slice(0, 9);
    });
    t('wasted waiver claim', M[8], 9, 'did not record a minute', () => {
      const out = benched(M[8]), spare = free(out.pos);
      setStat(spare.id, { min: 0, st: 0 });
      state.transfers.push({ managerId: M[8], outId: out.id, inId: spare.id, gw: 0, n: 1, t: 100, waiver: true });
    });
    t('sold their Lobus', M[9], 10, 'klaxon has been disconnected', () => {
      const lob = state.lobus[M[9]];
      state.transfers.push({ managerId: M[9], outId: lob, inId: free(PLAYER_BY_ID[lob].pos).id, gw: 0, n: 1, t: 100 });
    });
    t('deadline faffing', M[10], 11, 'before the deadline', () => {
      const out = benched(M[10]);
      state.transfers.push({ managerId: M[10], outId: out.id, inId: free(out.pos).id, gw: 0, n: 1, t: dl - 4 * 60000 });
    });
    t('offers all returned', M[11], 12, 'having all 3 returned', () => {
      for (let k = 0; k < 3; k++) state.trades.push({ id: 'x' + k, from: M[11], to: M[0], give: [], get: [], status: 'rejected', t: dl - 86400000 });
    });
    t('unattended squad', M[0], 13, 'not troubling the waiver list', () => {
      for (const pl of sqOf(M[0]).slice(0, 5)) setStat(pl.id, { min: 0, st: 0 });
    });
    t('churn', M[1], 14, 'transfers in a single week', () => {
      for (let k = 0; k < 4; k++) {
        const out = sqOf(M[1])[k], spare = PLAYERS.filter(x => !ownedIdsAt(0).has(x.id) && x.pos === out.pos)[k];
        state.transfers.push({ managerId: M[1], outId: out.id, inId: spare.id, gw: 0, n: k + 1, t: 100 + k });
      }
    });
    t('auto-subs, no bench order', M[2], 15, 'never set a bench order', () => {
      delete state.benchOrders[M[2]];
      // an outfield victim: a keeper cannot be subbed without a spare keeper
      const victim = state.lineups[M[2]][0].find(pid => PLAYER_BY_ID[pid].pos !== 'GK');
      setStat(victim, { min: 0, st: 0 });
    });
    t('no team sheet', M[3], 16, 'letting last week', () => { delete state.lineups[M[3]][0]; });
    t('Ham Cup no-show', M[4], 17, 'Palwin Ham Cup', () => { delete state.hamCup.entries[M[4]]; });
    t('never named a side', M[5], 18, 'never once naming a side all season', () => { state.lineups[M[5]] = {}; });
    // a manager who actually drafted two keepers — not everyone does
    const twoGk = M.find(mid => squadAt(mid, 0).filter(x => x.pos === 'GK').length > 1);
    t('idle second keeper', twoGk, 19, 'has not played a minute all season', () => {
      const gks = sqOf(twoGk).filter(x => x.pos === 'GK');
      const idle = gks.find(g => !state.lineups[twoGk][0].includes(g.id)) || gks[1];
      setStat(idle.id, { min: 0, st: 0 });
    }, 10);
    t('club hoarding', M[7], 20, 'remains the problem', () => {
      const club = [...new Set(PLAYERS.map(x => x.team))].find(c => PLAYERS.filter(x => x.team === c).length >= 5);
      const pool = PLAYERS.filter(x => x.team === club).slice(0, 5);
      const picks = state.draft.picks.filter(pk => pk.managerId === M[7]);
      pool.forEach((pl, k) => { if (picks[k]) picks[k].playerId = pl.id; });
    });
    t('draft timewasting', M[8], 21, 'timewasting on draft night', () => { state.draft.timewastes[M[8]] = 1; });
    t('empty trade block', M[9], 22, 'listing nobody on the trade block', () => { delete state.tradeBlock[M[9]]; });
    t('stale covenant', M[10], 23, 'never mentioned again', () => {
      state.covenants.push({ id: 'c1', from: M[10], to: M[0], text: 'the loan-back', t: 1, gw: 0 });
    }, 10);
    t('suggestion box', M[11], 24, 'still marked', () => {
      for (let k = 0; k < 3; k++) state.suggestions.push({ id: 's' + k, by: M[11], text: 'x', t: 1, status: 'noted' });
    });
    t('no autopick list', M[0], 25, 'without an autopick list', () => { delete state.autolists[M[0]]; });
    t('missed the roll call', M[1], 26, 'pre-draft roll call', () => { delete state.ready[M[1]]; });
    t('no Lobus declared', M[2], 27, 'not having declared a Lobus', () => { delete state.lobus[M[2]]; });
    t('never heckled', M[3], 28, 'without heckling anybody', () => { delete state.heckles[M[3]]; });

    // guards: a gap in the data must never be read as negligence
    baseline();
    for (const k of Object.keys(state.matchStats.gw1.playerStats)) state.matchStats.gw1.playerStats[k].min = 0;
    const noMins = cotwCharges(0).filter(c => [3, 9, 13].includes(c.gravity)).length;
    log.push(`${noMins === 0 ? 'PASS' : 'FAIL'}   – a feed with no minutes accuses nobody — ${noMins} minute-based charges`);
    baseline();
    state.fixtures = [];
    const noFx = cotwCharges(0).filter(c => c.gravity === 1).length;
    log.push(`${noFx === 0 ? 'PASS' : 'FAIL'}   – an empty fixture list accuses nobody — ${noFx} blank-gameweek charges`);

    // the verdict must be stable and must not rotate: the same evidence twice
    // running names the same man
    baseline();
    delete state.lineups[M[6]][0];
    const a = cotwFor(0), b2 = cotwFor(0);
    log.push(`${a.id === b2.id && a.why === b2.why ? 'PASS' : 'FAIL'}   – the same evidence names the same man twice`);
    return log;
    return log;
  });
  for (const line of log) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors while charging the league', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[cotw] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
