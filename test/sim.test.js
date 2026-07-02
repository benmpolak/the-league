// Full World Cup simulation through the real app — draft, 7 gameweeks of results,
// lineups, waivers, a trade, auto-subs, H2H finals. Runs against ?nosync (no cloud).
const puppeteer = require('puppeteer-core');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
  });
  const p = await browser.newPage();
  const pageErrors = [];
  p.on('pageerror', e => pageErrors.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8123?nosync', { waitUntil: 'networkidle2' });

  // ---------- 1. start the draft ----------
  await p.waitForSelector('#startDraft');
  await p.click('#startDraft');
  await new Promise(r => setTimeout(r, 400));
  check('draft starts', await p.evaluate(() => state.phase === 'draft' && state.draft.order.length === 4));

  // ---------- 2. country limit enforced ----------
  const limitOk = await p.evaluate(() => {
    const mid = currentManagerId();
    const max = state.settings.maxPerCountryGroup;
    const france = PLAYERS.filter(pl => pl.team === 'France').slice(0, max + 1);
    // fill to the country limit then test one more via canPick
    state.draft.picks.push(...france.slice(0, max).map((pl, i) => ({ managerId: mid, playerId: pl.id, n: i + 1 })));
    const blocked = !canPick(mid, france[max]);
    state.draft.picks = [];
    return blocked;
  });
  check('country limit blocks one-over-the-max from same nation', limitOk);

  // ---------- 3. run the full 60-pick draft (engine path) ----------
  await p.evaluate(() => {
    while (state.phase === 'draft') {
      const mid = currentManagerId();
      const taken = draftedIds();
      const best = PLAYERS.filter(pl => !taken.has(pl.id) && canPick(mid, pl))
        .sort((a, b) => rating(b) - rating(a))[0];
      state.draft.picks.push({ managerId: mid, playerId: best.id, n: pickNo() + 1 });
      if (pickNo() >= totalPicks()) state.phase = 'season';
    }
    save(); render();
  });
  const draftAudit = await p.evaluate(() => {
    const out = { squads: [], quotaOk: true, countryOk: true };
    for (const m of state.managers) {
      const sq = managerSquad(m.id);
      out.squads.push(sq.length);
      const c = posCount(m.id), q = state.settings.quotas;
      for (const pos of ['GK', 'DF', 'MF', 'FW']) if (c[pos] !== q[pos]) out.quotaOk = false;
      const nat = {};
      sq.forEach(pl => nat[pl.team] = (nat[pl.team] || 0) + 1);
      if (Object.values(nat).some(n => n > state.settings.maxPerCountryGroup)) out.countryOk = false;
    }
    return out;
  });
  check('all squads have 23', draftAudit.squads.every(n => n === 23), JSON.stringify(draftAudit.squads));
  check('position quotas exact (3/7/7/6)', draftAudit.quotaOk);
  check('country limit respected in full draft', draftAudit.countryOk);
  check('phase flips to season', await p.evaluate(() => state.phase === 'season'));

  // ---------- 4. simulate each gameweek ----------
  const GW_NOW = ['2026-06-14', '2026-06-20', '2026-06-25', '2026-06-30', '2026-07-05', '2026-07-10', '2026-07-14', '2026-07-18'];
  for (let gw = 0; gw < 8; gw++) {
    await p.evaluate((gw, nowStr) => {
      Date.now = () => new Date(nowStr + 'T12:00Z').getTime();
      // fabricate results for this GW for all owned players
      let seed = 1000 + gw;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const ps = {};
      for (const m of state.managers) {
        for (const pl of squadAt(m.id, gw)) {
          if (rnd() < 0.15) continue; // ~15% don't play at all → auto-sub fodder
          const started = rnd() < 0.85;
          const gc = { FW: 0.3, MF: 0.18, DF: 0.06, GK: 0.005 }[pl.pos];
          ps[pl.id] = {
            st: started ? 1 : 0, sub: started ? 0 : 1,
            g: rnd() < gc ? 1 : 0, a: rnd() < 0.15 ? 1 : 0,
            cs: (pl.pos === 'GK' || pl.pos === 'DF') && rnd() < 0.35 ? 1 : 0,
          };
        }
      }
      const mid = new Date((new Date(gwFrom(gw)).getTime() + new Date(GAMEWEEKS[gw].to).getTime()) / 2).toISOString();
      state.matchStats['sim' + gw] = { label: `Sim GW${gw + 1}`, date: mid, final: true, playerStats: ps };
      save(); render();
    }, gw, GW_NOW[gw]);

    // trough/waivers: behave per mode (open / redraft / ordered)
    const waiverResult = await p.evaluate(gw => {
      const cur = currentGwIndex();
      if (cur !== gw) return { err: `currentGwIndex ${cur} != ${gw}` };
      const doSwap = wmid => {
        const squad = squadAt(wmid, cur);
        const out = [...squad].sort((a, b) => rating(a) - rating(b))[0];
        const owned = ownedIdsAt(cur);
        const after = squad.filter(x => x.id !== out.id);
        const cand = PLAYERS.filter(x => !owned.has(x.id) && x.pos === out.pos
          && countryCount(after, x.team) < countryCapNow(cur))
          .sort((a, b) => rating(b) - rating(a))[0];
        if (!cand) return false;
        state.transfers.push({ managerId: wmid, outId: out.id, inId: cand.id, gw: cur, n: state.transfers.length + 1 });
        (state.waivers[cur] = state.waivers[cur] || { actions: [] }).actions.push({ mid: wmid, outId: out.id, inId: cand.id });
        const lu = state.lineups[wmid]?.[cur];
        if (lu) state.lineups[wmid][cur] = lu.filter(id => id !== out.id);
        return true;
      };
      const pass = wmid => (state.waivers[cur] = state.waivers[cur] || { actions: [] }).actions.push({ mid: wmid, pass: true });
      const mode = waiverMode(cur);
      const did = [];
      if (mode === 'open') {
        for (const m of [...state.managers].reverse()) did.push(doSwap(m.id) ? 'swap' : 'skip');
      } else {
        let guard = 0;
        const swapsLeft = {};
        while (!waiverState(cur).complete && guard++ < 80) {
          const wv = waiverState(cur);
          const wmid = wv.turnMid;
          if (wmid == null) return { err: 'null turn before complete' };
          swapsLeft[wmid] = swapsLeft[wmid] ?? (mode === 'redraft' ? 2 : 1);
          if (swapsLeft[wmid] > 0 && Math.random() > 0.3 && doSwap(wmid)) { swapsLeft[wmid]--; did.push('swap'); }
          else { pass(wmid); did.push('pass'); }
        }
        if (!waiverState(cur).complete) return { err: 'round never completed' };
      }
      save(); render();
      return { did, mode };
    }, gw);
    check(`GW${gw + 1} trough/waivers (${waiverResult.mode || '?'}) resolve`, !waiverResult.err && waiverResult.did.length > 0, JSON.stringify(waiverResult.err || (waiverResult.did.length + ' actions')));

    // squads still legal after waivers
    const legal = await p.evaluate(() => {
      for (const m of state.managers) {
        if (managerSquad(m.id).length !== state.settings.squadSize) return false;
        const nat = {};
        managerSquad(m.id).forEach(pl => nat[pl.team] = (nat[pl.team] || 0) + 1);
        if (Object.values(nat).some(n => n > countryCapNow(currentGwIndex()))) return false;
      }
      return true;
    });
    check(`GW${gw + 1} squads legal after trough swaps`, legal);
  }

  // ---------- 5. auto-sub: engineered case ----------
  const autoSub = await p.evaluate(() => {
    const mid = state.managers[0].id;
    const gw = 6;
    const xi = lineupFor(mid, gw);
    const squad = squadAt(mid, gw);
    const benchDF = squad.find(pl => !xi.includes(pl.id) && pl.pos === 'DF');
    const startDF = xi.map(id => PLAYER_BY_ID[id]).find(pl => pl.pos === 'DF');
    if (!benchDF || !startDF) return { skip: true };
    const ps = state.matchStats.sim6.playerStats;
    delete ps[startDF.id];                                  // starter never plays
    ps[benchDF.id] = { st: 1, sub: 0, g: 1, a: 0, cs: 1 };  // bench DF has a blinder
    const eff = effectiveXI(mid, gw);
    const sub = eff.subs.find(s => s.out === startDF.id);
    const c = xiCounts(eff.xi);
    return {
      subbedOut: !eff.xi.includes(startDF.id),
      replaced: !!sub,
      replacementPlayed: sub ? appearedInGw(sub.in, gw) : false,
      shapeOk: ['GK', 'DF', 'MF', 'FW'].every(pos => c[pos] >= XI_RULES[pos][0] && c[pos] <= XI_RULES[pos][1]),
      fullXI: eff.xi.length === 11,
    };
  });
  check('auto-sub: absent starter replaced by a bench player who played, XI stays legal',
    autoSub.skip || (autoSub.subbedOut && autoSub.replaced && autoSub.replacementPlayed && autoSub.shapeOk && autoSub.fullXI), JSON.stringify(autoSub));

  // ---------- 6. trade via the actual UI ----------
  await p.evaluate(() => { state.view = 'team'; teamView.mid = state.managers[0].id; render(); });
  await new Promise(r => setTimeout(r, 200));
  const tradeOk = await p.evaluate(async () => {
    const mid = state.managers[0].id, other = state.managers[1].id;
    document.querySelector('#tradeWith').value = other;
    document.querySelector('#tradeWith').dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 100));
    const mine = document.querySelector('#tradeMine'), theirs = document.querySelector('#tradeTheirs');
    // find same-position pair to avoid quota complications
    const myOpts = [...mine.options].slice(1), thOpts = [...theirs.options].slice(1);
    const cur0 = currentGwIndex();
    let pair = null;
    for (const mo of myOpts) {
      const mp = PLAYER_BY_ID[+mo.value];
      for (const to of thOpts) {
        const tp = PLAYER_BY_ID[+to.value];
        if (tp.pos !== mp.pos) continue;
        const aAfter = squadAt(mid, cur0).filter(x => x.id !== mp.id);
        const bAfter = squadAt(other, cur0).filter(x => x.id !== tp.id);
        if (countryCount(aAfter, tp.team) >= countryCapNow(cur0)) continue;
        if (countryCount(bAfter, mp.team) >= countryCapNow(cur0)) continue;
        pair = [mo.value, to.value]; break;
      }
      if (pair) break;
    }
    if (!pair) return { skip: true };
    mine.value = pair[0]; theirs.value = pair[1];
    document.querySelector('#tradeGo').click();
    await new Promise(r => setTimeout(r, 200));
    const cur = currentGwIndex();
    return {
      aHasB: squadAt(mid, cur).some(pl => pl.id === +pair[1]),
      bHasA: squadAt(other, cur).some(pl => pl.id === +pair[0]),
    };
  });
  check('trade via UI swaps both squads', tradeOk.skip || (tradeOk.aHasB && tradeOk.bHasA), JSON.stringify(tradeOk));

  // ---------- 7. end of tournament — final tables ----------
  await p.evaluate(() => { Date.now = () => new Date('2026-07-21T12:00Z').getTime(); render(); });
  const finals = await p.evaluate(() => {
    const st = h2hStandings();
    const statuses = GAMEWEEKS.map((g, i) => gwStatus(i));
    const totals = state.managers.map(m => ({ name: m.name, pts: managerPoints(m.id) }));
    const sane = st.every(r => r.p === 8 && r.w + r.d + r.l === r.p && r.pts === 3 * r.w + r.d);
    return { statuses, table: st.map(r => `${r.name} P${r.p} W${r.w} D${r.d} L${r.l} = ${r.pts}`), totals, sane };
  });
  check('all 8 gameweeks final', finals.statuses.every(s => s === 'final'), finals.statuses.join(','));
  check('H2H table arithmetic sane (P=8, pts=3W+D)', finals.sane, finals.table.join(' | '));
  check('overall points positive for all', finals.totals.every(t => t.pts > 0), JSON.stringify(finals.totals));

  // ---------- 8. every view renders without errors at season end ----------
  for (const v of ['draft', 'team', 'h2h', 'table', 'fixtures', 'rules', 'settings']) {
    await p.evaluate(v => { state.view = v; render(); }, v);
    await new Promise(r => setTimeout(r, 120));
    const r = await p.$eval('#main', el => ({ len: el.innerHTML.length, empty: el.textContent.includes('No fixtures loaded') }));
    check(`view "${v}" renders`, r.len > 500 || (v === 'fixtures' && r.empty), `${r.len} chars`);
  }

  check('zero page errors across whole simulation', pageErrors.length === 0, pageErrors.slice(0, 3).join(' ; '));
  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e.message); process.exit(2); });
