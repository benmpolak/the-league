/* Team of the Week, Team of the Season, and the best XI the Trough was
 * offering (Marc, 15 Sept 2026: "Ideally id like to be able to go back and do
 * this retrospectively from week 1 and use that as a test").
 *
 * Nothing about these is stored, so the test is the same job the card does:
 * wind back to GW1 and recompute. What is pinned here:
 *   - the eleven is LEGAL — 1 keeper, 3-5 at the back, 2-5 in midfield,
 *     1-3 up front, eleven different men
 *   - the eleven is OPTIMAL, not merely good, checked against a brute-force
 *     search over every combination that could possibly beat it
 *   - the Trough XI contains nobody a manager already owned at kick-off, and
 *     can never out-score the open field it is a subset of
 *   - ownership is read as the whistle goes. A deal always lands in the
 *     UPCOMING round, so squadAt(mid, i) is the side that plays round i: a man
 *     signed in the run-up to a week is owned for it, and was in the Trough
 *     only the week before
 * Run against any side-port server with TEST_BASE_URL=http://127.0.0.1:8135.
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
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const log = await page.evaluate(() => {
    const log = [];
    const t = (name, ok, detail = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

    // three settled rounds, so the retrospective walk has something to walk
    // and the season XI is a genuine accumulation rather than one week twice
    state = buildDemoState();
    const WEEKS = 3;
    let seed = 99;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < WEEKS; i++) {
      const gwN = GAMEWEEKS[i].n;
      const ps = {};
      // everybody who might play, owned or not — the Trough has to have talent
      for (const p of PLAYERS) {
        if (rnd() < 0.45) continue;
        const gp = { FW: 0.34, MF: 0.18, DF: 0.06, GK: 0.01 }[p.pos];
        ps[p.id] = { min: 90, st: 1, g: rnd() < gp ? 1 + (rnd() < 0.25 ? 1 : 0) : 0,
          a: rnd() < 0.12 ? 1 : 0, cs: rnd() < 0.3 ? 1 : 0, sv: p.pos === 'GK' ? Math.floor(rnd() * 6) : 0 };
      }
      state.matchStats['gw' + gwN] = { gw: i, label: GAMEWEEKS[i].label, final: true, playerStats: ps };
      GAMEWEEKS[i].finished = true;
    }
    window.gwStatus = i => (i < WEEKS ? 'final' : 'upcoming');

    const shapeOf = xi => {
      const c = { GK: 0, DF: 0, MF: 0, FW: 0 };
      xi.forEach(p => c[p.pos]++);
      return c;
    };
    const legal = xi => {
      const c = shapeOf(xi);
      return xi.length === XI_RULES.size && new Set(xi.map(p => p.id)).size === XI_RULES.size
        && ['GK', 'DF', 'MF', 'FW'].every(q => c[q] >= XI_RULES[q][0] && c[q] <= XI_RULES[q][1]);
    };
    // the optimum cannot contain anybody outside the top eleven of his own
    // position, so a search over those can be trusted to find it
    const combos = (arr, k) => (k === 0 ? [[]] : arr.flatMap((x, i) => combos(arr.slice(i + 1), k - 1).map(r => [x, ...r])));
    const bruteBest = (pool, sc) => {
      const top = q => pool.filter(x => x.pos === q).sort((a, b) => sc(b) - sc(a)).slice(0, 6);
      const P = { GK: top('GK'), DF: top('DF'), MF: top('MF'), FW: top('FW') };
      let best = -1;
      for (let df = XI_RULES.DF[0]; df <= XI_RULES.DF[1]; df++)
        for (let mf = XI_RULES.MF[0]; mf <= XI_RULES.MF[1]; mf++) {
          const fw = XI_RULES.size - 1 - df - mf;
          if (fw < XI_RULES.FW[0] || fw > XI_RULES.FW[1]) continue;
          if (P.GK.length < 1 || P.DF.length < df || P.MF.length < mf || P.FW.length < fw) continue;
          for (const g of combos(P.GK, 1)) for (const d of combos(P.DF, df))
            for (const m of combos(P.MF, mf)) for (const f of combos(P.FW, fw))
              best = Math.max(best, [...g, ...d, ...m, ...f].reduce((s, x) => s + sc(x), 0));
        }
      return best;
    };

    /* ----- every settled week, wound back from the first ----- */
    for (let i = 0; i < WEEKS; i++) {
      const gwN = GAMEWEEKS[i].n;
      const sc = p => gwPlayerPoints(p.id, i);
      const open = bestXIFrom(PLAYERS, sc);
      t(`GW${gwN}: the best eleven is a legal side`, !!open && legal(open.xi),
        open ? `${open.shape}, ${open.total} pts` : 'none');
      t(`GW${gwN}: and no other combination beats it`, !!open && open.total === bruteBest(PLAYERS, sc),
        open ? `solver ${open.total} vs brute force ${bruteBest(PLAYERS, sc)}` : 'none');

      const ownedAtKickoff = ownedIdsAt(i);
      const free = PLAYERS.filter(p => !ownedAtKickoff.has(p.id));
      const trough = bestXIFrom(free, sc);
      t(`GW${gwN}: the Trough eleven is legal and owns nobody`,
        !!trough && legal(trough.xi) && trough.xi.every(p => !ownedAtKickoff.has(p.id)),
        trough ? `${trough.shape}, ${trough.total} pts` : 'none');
      t(`GW${gwN}: the Trough cannot beat the open field it sits inside`,
        !!trough && trough.total <= open.total, `${trough && trough.total} vs ${open.total}`);
      t(`GW${gwN}: and it is the best the Trough had`,
        !!trough && trough.total === bruteBest(free, sc), `solver ${trough && trough.total}`);
    }

    /* ----- ownership is read as the whistle goes, not a week earlier ----- */
    // A deal can never land in a round already under way: transferGw always
    // sends it to the UPCOMING week. So squadAt(mid, i) is the side that plays
    // round i, and a man signed in the run-up to it is NOT a Trough player for
    // it — he was one the week before. Marc, 15 Sept 2026, asking exactly this.
    (() => {
      const i = 1;
      const mid = state.managers[0].id;
      const target = PLAYERS.find(p => !ownedIdsAt(i - 1).has(p.id) && p.pos === 'MF');
      const drop = squadAt(mid, i - 1).find(p => p.pos === 'MF');
      if (!target || !drop) { t('setup: a midfielder to sign before the round', false, 'none'); return; }
      state.transfers.push({ managerId: mid, outId: drop.id, inId: target.id, gw: i, t: Date.now(), n: state.transfers.length + 1 });
      t('a man signed before the round is owned for it, and was free the week before',
        ownedIdsAt(i).has(target.id) && !ownedIdsAt(i - 1).has(target.id), `${target.name}`);
      t('and the man he replaced is back in the Trough for that round',
        !ownedIdsAt(i).has(drop.id) && ownedIdsAt(i - 1).has(drop.id), `${drop.name}`);
      const sc = p => gwPlayerPoints(p.id, i);
      const free = PLAYERS.filter(p => !ownedIdsAt(i).has(p.id));
      const trough = bestXIFrom(free, sc);
      t('the Trough eleven never contains a man owned when the whistle went',
        !!trough && trough.xi.every(p => !ownedIdsAt(i).has(p.id)));
      state.transfers.pop();
    })();

    /* ----- the season side ----- */
    (() => {
      const season = p => [0, 1, 2].reduce((s, i) => s + gwPlayerPoints(p.id, i), 0);
      const best = bestXIFrom(PLAYERS, season);
      t('the season eleven is legal', !!best && legal(best.xi), best ? `${best.shape}, ${best.total} pts` : 'none');
      t('and no other combination beats it over the three weeks',
        !!best && best.total === bruteBest(PLAYERS, season), `solver ${best && best.total}`);
      // a cumulative side must be worth at least the best single week
      const wk = Math.max(...[0, 1, 2].map(i => bestXIFrom(PLAYERS, p => gwPlayerPoints(p.id, i)).total));
      t('and it is worth at least the best single week', !!best && best.total >= wk, `${best && best.total} vs ${wk}`);
    })();

    /* ----- the card itself ----- */
    (() => {
      myId = state.managers[0].id; state.view = 'data'; dataView.tab = 'league'; dataView.totwGw = 0; render();
      const card = [...document.querySelectorAll('.card')].find(c => /Team of the Week/.test(c.querySelector('h2')?.textContent || ''));
      const txt = card ? card.textContent.replace(/\s+/g, ' ') : '';
      t('the card renders all three elevens', !!card && /Team of the season/i.test(txt)
        && /The gameweek/i.test(txt) && /From the Trough/i.test(txt));
      const opts = card ? [...card.querySelectorAll('#totwGw option')].map(o => o.textContent.trim()) : [];
      t('and offers every settled week back to the first',
        opts.length === WEEKS && opts[0] === 'GW1', opts.join(', '));
      t('the card lives in the Data Room, not on its own page',
        !!card && !!document.querySelector('[data-dtab="league"]'));
    })();
    return log;
  });

  for (const line of log) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors while picking the teams', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[team-of-the-week] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
