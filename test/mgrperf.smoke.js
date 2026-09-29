/* Managerial Performance (Marc, 29 Sept 2026: "a manager performance ranking
 * into the league section... based on three factors. All weighted 33.3% each.
 * I want each persons performance to be normalized to a total of 100 possible
 * points based on those three things, NOT WEIGHTED BY THE RANKING, weighted by
 * the actual score on that element relative to the best and worst on that
 * topic. 1 - 14 man draft team score. 2. Bench wastage (only when a player on
 * the bench scores more than a starting player). 3. Trading."), widened the
 * same day to "trades, waiver and trough picks".
 *
 * The emphasis is his and it is the whole design, so it is what gets attacked
 * hardest here. A rank-weighted table hands out the same ladder of marks
 * whether the field is strung out over two hundred points or packed into three,
 * and that is exactly what he asked not to have. So:
 *
 *   - every score is checked against the min-max formula on the REAL spread,
 *     which a rank-based score could not satisfy
 *   - and two managers who are close on an element must score close on it even
 *     when several places separate them, which is the behaviour a ladder gets
 *     wrong and the one Marc actually wants
 *
 * The other trap is direction: bench wastage is a COST, so low must be good. A
 * sign error there would quietly reward the worst manager in the league.
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
  await page.setViewport({ width: 390, height: 844 });   // a phone, deliberately
  await page.goto(baseUrl + '?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const log = await page.evaluate(() => {
    const log = [];
    const t = (name, ok, detail = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
    const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
    // the Data Room's tab strip is a .card of its own and renders first
    const perfCard = () => [...document.querySelectorAll('.card')]
      .find(c => /Managerial Performance/.test(c.querySelector('h2')?.textContent || ''));

    state = buildDemoState(); state.phase = 'season';
    myId = whoami = state.managers[0].id;

    /* five settled rounds and a couple of trades, so all three elements have a
       real spread rather than a dead heat */
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 1; i < 6 && i < GAMEWEEKS.length; i++) {
      const gwN = GAMEWEEKS[i].n, ps = {};
      for (const pk of state.draft.picks) {
        const pl = PLAYER_BY_ID[pk.playerId];
        ps[pl.id] = { min: 90, st: 1, g: rnd() < .22 ? 1 : 0, a: rnd() < .12 ? 1 : 0, cs: rnd() < .3 ? 1 : 0 };
      }
      state.matchStats['gw' + gwN] = { gw: i, label: GAMEWEEKS[i].label, final: true, playerStats: ps };
      GAMEWEEKS[i].finished = true;
      for (const f of state.fixtures) if (f.gw === gwN) f.finished = true;
    }
    const A = state.managers[0].id, B = state.managers[1].id, C = state.managers[2].id;
    const sq = mid => squadAt(mid, 0);
    state.transfers = [...state.transfers,
      { managerId: A, inId: sq(B)[0].id, outId: sq(A)[0].id, gw: 1, t: 9000, trade: 'P1' },
      { managerId: B, inId: sq(A)[0].id, outId: sq(B)[0].id, gw: 1, t: 9000, trade: 'P1' },
      { managerId: C, inId: sq(A)[1].id, outId: sq(C)[0].id, gw: 1, t: 9100, trade: 'P2' },
      { managerId: A, inId: sq(C)[0].id, outId: sq(A)[1].id, gw: 1, t: 9100, trade: 'P2' }];

    const perf = managerPerformance();
    t('(setup) every manager is scored', !!perf && perf.length === state.managers.length,
      perf ? String(perf.length) : 'null');
    if (!perf) return log;
    t('(setup) all three elements have a real spread to work with',
      PERF_ELEMENTS.every(el => !perf.scales[el.key].flat),
      PERF_ELEMENTS.map(el => `${el.label} ${perf.scales[el.key].lo}..${perf.scales[el.key].hi}`).join(' | '));

    /* ----- the three elements are the ones Marc named, off the pages that own them ----- */
    (() => {
      const board = draftBoard();
      /* Marc, 29 Sept 2026: "by trades i mean trades, waiver and trough picks"
         — so the element is ALL completed business, not the trade-only reading
         the Trade Record opens on. Reading the wrong scope here would silently
         drop every waiver claim and Trough signing in the league. */
      const tally = tradeTally('all');
      const tradesOnly = tradeTally('trades');
      t('the draft figure is the Draft Console\'s own By Team total',
        perf.every(r => r.draft === board.find(x => x.m.id === r.m.id).pts));
      t('the bench figure is the season bench wastage, not a fresh reading',
        perf.every(r => r.bench === seasonBenchWaste(r.m.id)));
      t('the business figure is the Trade Record\'s own net, over ALL moves',
        perf.every(r => r.trade === (tally[r.m.id]?.net ?? 0)));
      t('(control) that is a wider net than trades alone', (() => {
        const wider = perf.some(r => (tally[r.m.id]?.n ?? 0) > (tradesOnly[r.m.id]?.n ?? 0));
        return wider;
      })(), `all-moves deals ${Object.values(tally).reduce((t2, r) => t2 + r.n, 0)} vs trades-only ${Object.values(tradesOnly).reduce((t2, r) => t2 + r.n, 0)}`);
      t('and a manager who has done no business scores the same as one who came out level', (() => {
        // nought is nought however you arrive at it (Marc, 29 Sept 2026)
        const zeros = perf.filter(r => r.trade === 0);
        return zeros.length < 2 || new Set(zeros.map(r => r.score.trade.toFixed(9))).size === 1;
      })());
      t('and there are exactly three elements, 33.3 each',
        PERF_ELEMENTS.length === 3 && close(PERF_WEIGHT * 3, 100),
        `${PERF_ELEMENTS.length} x ${PERF_WEIGHT}`);
    })();

    /* ----- NOT BY THE RANKING. The headline requirement. ----- */
    (() => {
      let ok = 0, n = 0;
      for (const el of PERF_ELEMENTS) {
        const { lo, hi } = perf.scales[el.key];
        for (const r of perf) {
          n++;
          const frac = el.hi ? (r[el.key] - lo) / (hi - lo) : (hi - r[el.key]) / (hi - lo);
          if (close(r.score[el.key], frac * PERF_WEIGHT, 1e-9)) ok++;
        }
      }
      t('every score is the actual figure scaled between best and worst', ok === n, `${ok}/${n}`);
      // and it is NOT the ladder: an evenly-spaced ladder would put the second
      // man a fixed step below the first on every element, whatever the numbers
      const ladderStep = PERF_WEIGHT / (perf.length - 1);
      const draftOrder = [...perf].sort((a, b) => b.draft - a.draft);
      const gaps = draftOrder.slice(1).map((r, i) => draftOrder[i].score.draft - r.score.draft);
      t('(control) the steps between managers are UNEVEN, as real numbers are',
        new Set(gaps.map(g => Math.round(g * 100))).size > 2,
        `${gaps.length} steps, ${new Set(gaps.map(g => Math.round(g * 100))).size} distinct, a ladder would give 1 of ${ladderStep.toFixed(2)}`);
      /* The behaviour that matters: two men close on an element score close on
         it, even if the table puts several places between them. */
      const byDraft = [...perf].sort((a, b) => b.draft - a.draft);
      let found = null;
      for (let i = 0; i < byDraft.length - 1; i++) {
        const gapRaw = byDraft[i].draft - byDraft[i + 1].draft;
        const spread = perf.scales.draft.hi - perf.scales.draft.lo;
        if (gapRaw <= spread * 0.06) { found = [byDraft[i], byDraft[i + 1], gapRaw]; break; }
      }
      t('two managers close on an element score close on it, whatever their places',
        !!found && Math.abs(found[0].score.draft - found[1].score.draft) < ladderStep,
        found ? `${found[2]} pts apart -> ${Math.abs(found[0].score.draft - found[1].score.draft).toFixed(2)} of a possible ${PERF_WEIGHT.toFixed(1)} (a ladder would force ${ladderStep.toFixed(2)})` : 'no close pair found');
    })();

    /* ----- the ends of each scale, and the direction of each one ----- */
    (() => {
      for (const el of PERF_ELEMENTS) {
        const { lo, hi } = perf.scales[el.key];
        const bestRaw = el.hi ? hi : lo, worstRaw = el.hi ? lo : hi;
        const best = perf.find(r => r[el.key] === bestRaw), worst = perf.find(r => r[el.key] === worstRaw);
        t(`${el.label}: the best figure takes the full ${PERF_WEIGHT.toFixed(1)}`,
          close(best.score[el.key], PERF_WEIGHT), `${bestRaw} -> ${best.score[el.key].toFixed(2)}`);
        t(`${el.label}: the worst figure takes nought`,
          close(worst.score[el.key], 0), `${worstRaw} -> ${worst.score[el.key].toFixed(2)}`);
      }
      /* The sign trap. Bench wastage is a cost, so the man who threw away LEAST
         must score most. Inverted by accident and this page would crown the
         worst manager in the league. */
      const leastWaste = perf.reduce((a, b) => (b.bench < a.bench ? b : a), perf[0]);
      const mostWaste = perf.reduce((a, b) => (b.bench > a.bench ? b : a), perf[0]);
      t('bench wastage runs backwards: least wasted scores most',
        leastWaste.score.bench > mostWaste.score.bench
        && close(leastWaste.score.bench, PERF_WEIGHT) && close(mostWaste.score.bench, 0),
        `${leastWaste.bench} -> ${leastWaste.score.bench.toFixed(1)} vs ${mostWaste.bench} -> ${mostWaste.score.bench.toFixed(1)}`);
    })();

    /* ----- the total ----- */
    (() => {
      t('the total is the three elements added up',
        perf.every(r => close(r.total, PERF_ELEMENTS.reduce((s, el) => s + r.score[el.key], 0))));
      t('nobody can score above 100 or below 0',
        perf.every(r => r.total >= -1e-9 && r.total <= 100 + 1e-9),
        `${Math.min(...perf.map(r => r.total)).toFixed(1)}..${Math.max(...perf.map(r => r.total)).toFixed(1)}`);
      t('the table is ordered by total, best first',
        perf.every((r, i) => i === 0 || perf[i - 1].total >= r.total));
      t('level totals share a place', (() => {
        const by = {};
        for (const r of perf) (by[r.total.toFixed(6)] = by[r.total.toFixed(6)] || []).push(r.rank);
        return Object.values(by).every(v => new Set(v).size === 1);
      })());
      // a man top of all three would score exactly 100; nobody here should
      t('(control) nobody is top of everything, so no perfect hundred',
        !perf.some(r => close(r.total, 100)), perf[0].total.toFixed(1));
    })();

    /* ----- a dead heat on an element ----- */
    (() => {
      const keep = state.transfers;
      /* Clearing only the TRADES no longer makes a dead heat: the element counts
         all business, so waiver claims and Trough signings keep it alive. Empty
         the ledger entirely (Marc, 29 Sept 2026 widened the scope). */
      state.transfers = [];
      const flatPerf = managerPerformance();
      t('an element nobody differs on is flagged rather than faked',
        flatPerf.scales.trade.flat === true);
      t('and everybody takes full marks on it instead of an invented winner',
        flatPerf.every(r => close(r.score.trade, PERF_WEIGHT)));
      dataView.tab = 'managers'; state.view = 'data'; render();
      t('the card admits when an element is separating nobody',
        /separates nobody yet/.test(perfCard().textContent));
      state.transfers = keep;
    })();

    /* ----- the card: headline first, then the three beneath ----- */
    (() => {
      dataView.tab = 'managers'; state.view = 'data'; render();
      const card = perfCard();
      const tables = [...card.querySelectorAll('table')];
      t('one headline table and one per element', tables.length === 4, String(tables.length));
      const heads = [...tables[0].querySelectorAll('thead th')].map(x => x.textContent.trim());
      t('the headline carries the three elements and a total',
        PERF_ELEMENTS.every(el => heads.includes(el.label)) && heads.includes('Total'), heads.join('|'));
      t('a row per manager in the headline',
        tables[0].querySelectorAll('tbody tr').length === perf.length);
      // the printed totals are the computed ones
      t('the totals on screen are the totals computed', (() => {
        return [...tables[0].querySelectorAll('tbody tr')].every((tr, i) =>
          Math.abs(parseFloat(tr.cells[tr.cells.length - 1].textContent) - perf[i].total) < 0.06);
      })());
      // and each element gets its raw figures and its own ranking below
      const txt = card.textContent;
      t('each element has its own section, raw and ranked',
        PERF_ELEMENTS.every(el => new RegExp(`${el.label}\\s*·\\s*worth`).test(txt.replace(/\s+/g, ' '))
          || txt.includes(`${el.label} · worth`)), '');
      t('the element tables show every manager\'s raw figure',
        tables.slice(1).every(tb => tb.querySelectorAll('tbody tr').length === perf.length),
        tables.slice(1).map(tb => tb.querySelectorAll('tbody tr').length).join('/'));
      t('and each element table is ranked on its own element', (() => {
        return PERF_ELEMENTS.every((el, k) => {
          const rows = [...tables[k + 1].querySelectorAll('tbody tr')];
          const order = [...perf].sort((a, b) => el.hi ? b[el.key] - a[el.key] : a[el.key] - b[el.key]);
          return rows.every((tr, i) => tr.cells[1].textContent.trim() === (order[i].m.team || order[i].m.name));
        });
      })());
      t('the card says the marks are relative to best and worst, not to position',
        /scaled between the best and worst figures in the league rather than by finishing order/.test(txt));
    })();

    /* ----- the tabs ----- */
    (() => {
      /* Marc, 29 Sept 2026: "The tab can just be a separate tab in the data
         room, not part of the league tab." So it is one of the Data Room's own
         tabs, and the league table is left exactly as it was. */
      state.view = 'data'; dataView.tab = 'players'; render();
      t('the Data Room offers a Managers tab',
        !!document.querySelector('[data-dtab="managers"]'));
      document.querySelector('[data-dtab="managers"]').click();
      t('and it opens the performance card',
        dataView.tab === 'managers'
        && !!perfCard());
      document.querySelector('[data-dtab="league"]').click();
      t('another Data Room tab still works', dataView.tab === 'league');
      // and the league table itself is untouched — no tab strip was added to it
      state.view = 'table'; render();
      t('the league table has no performance tab bolted onto it',
        !!document.querySelector('[data-mgr-row]')
        && !document.querySelector('[data-leaguetab]'));
      dataView.tab = 'managers'; state.view = 'data'; render();
    })();

    return log;
  });

  for (const line of log) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));

  // nothing settled at all: it must say so rather than divide by zero
  const virgin = await page.evaluate(() => {
    state = buildDemoState(); state.phase = 'season';
    for (let i = 0; i < GAMEWEEKS.length; i++) GAMEWEEKS[i].finished = false;
    state.matchStats = {};
    dataView.tab = 'managers'; state.view = 'data'; render();
    return [...document.querySelectorAll('.card')]
      .map(c => c.textContent).join(' ');
  });
  chk('with nothing settled it declines to judge rather than crashing',
    /No round has settled yet/.test(virgin));

  // the phone check needs a card with tables ON it — the virgin state above
  // renders the "nothing settled" line and nothing else, so rebuild a season
  const wide = await page.evaluate(() => {
    state = buildDemoState(); state.phase = 'season';
    myId = whoami = state.managers[0].id;
    dataView.tab = 'managers'; state.view = 'data'; render();
    const card = [...document.querySelectorAll('.card')]
      .find(c => /Managerial Performance/.test(c.querySelector('h2')?.textContent || ''));
    return { tables: card.querySelectorAll('table').length,
      own: !!card.querySelector('div[style*="overflow-x"]'),
      spills: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  chk('(control) the phone check is looking at a card with tables on it', wide.tables >= 4, String(wide.tables));
  chk('the tables scroll in their own boxes on a phone', wide.own);
  chk('and never drag the page sideways', !wide.spills);
  chk('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[mgr-perf] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
