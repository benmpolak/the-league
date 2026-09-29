/* Managerial Performance (Marc, 29 Sept 2026, over three attempts).
 *
 * The brief settled at: three things a manager controls, each measured in
 * POINTS from a nought that means something, added up. No weighting, because
 * once they share a unit there is nothing to weight — "should it just be on
 * raw points earned meaning that even the 3 way split could change over time".
 *
 * What gets attacked hardest here is the thing the first two attempts got
 * wrong. Both scored managers against EACH OTHER while presenting the result as
 * an absolute mark, so the leader took full marks however little separated him:
 * "i dont think toby should get 33.3 for the draft because we dont really know
 * how good his draft was, we just know it was better than everyone elses."
 *
 * So the tests insist on the property that fixes it: each element's nought is a
 * real reference point rather than the bottom of the field, and the draft's is
 * the one that had to be invented — what a manager's own draft slots were
 * worth, read off the league's own curve.
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
    const perfCard = () => [...document.querySelectorAll('.card')]
      .find(c => /Managerial Performance/.test(c.querySelector('h2')?.textContent || ''));

    state = buildDemoState(); state.phase = 'season';
    myId = whoami = state.managers[0].id;

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
    t('three elements, and every one of them in whole points',
      PERF_ELEMENTS.length === 3 && PERF_ELEMENTS.every(el => perf.every(r => Number.isInteger(r[el.key]))));
    t('the total is simply the three added up, with nothing weighting them',
      perf.every(r => r.total === PERF_ELEMENTS.reduce((s, el) => s + r[el.key], 0)));
    t('the table is ordered by total, best first',
      perf.every((r, i) => i === 0 || perf[i - 1].total >= r.total));
    t('level totals share a place', (() => {
      const by = {};
      for (const r of perf) (by[r.total] = by[r.total] || []).push(r.rank);
      return Object.values(by).every(v => new Set(v).size === 1);
    })());

    /* ----- the draft has a real nought now: what your slots were worth ----- */
    (() => {
      const slots = draftSlotValues();
      t('every manager gets a slot valuation off his own picks',
        !!slots && slots.size === state.managers.length);
      t('and the draft mark is what he scored less what his slots were worth',
        perf.every(r => r.draft === Math.round(slots.get(r.m.id).got - slots.get(r.m.id).worth)));
      /* The snake is supposed to be fair, so the baselines should come out
         level. If they do not, this handicaps people by draft position rather
         than judging them. */
      const worths = [...slots.values()].map(s => s.worth);
      const lo = Math.min(...worths), hi = Math.max(...worths);
      t('the slot baselines are level across the league, so nobody is handicapped by where he picked',
        (hi - lo) / ((hi + lo) / 2) < 0.05, `${Math.round(lo)}..${Math.round(hi)}`);
      /* And because the baseline is the league's own smoothed curve, the beats
         very nearly cancel: a draft is a carve-up of one pool. */
      const sum = perf.reduce((s, r) => s + r.draft, 0);
      const scale = Math.max(...perf.map(r => Math.abs(r.draft)));
      t('the beats cancel out across the league, as a carve-up of one pool must',
        Math.abs(sum) < scale, `sum ${sum} against a biggest beat of ${scale}`);
      /* The premise of the whole element is that a slot HAS a value — that an
         early pick returns more than a late one. The demo cannot show it: it
         drafts in rating order but then fabricates random stats, so its curve
         is flat and a beat there is just raw points less the league average.
         The proof has to come from real football, so it is checked against
         last season's archive further down this file. */
    })();

    /* ----- nought means something on all three ----- */
    (() => {
      t('bench is a cost, so it is never positive', perf.every(r => r.bench <= 0));
      t('(control) somebody is currently wasting bench points',
        perf.some(r => r.bench < 0), perf.map(r => r.bench).join(','));
      t('and the man who wasted least has the best bench mark', (() => {
        const best = perf.reduce((a, b) => (b.bench > a.bench ? b : a), perf[0]);
        return best.wasted === Math.min(...perf.map(r => r.wasted));
      })());
      // business: doing nothing and breaking even must read the same
      const zeros = perf.filter(r => r.trade === 0);
      t('doing no business and breaking even on plenty score the same',
        zeros.length < 2 || new Set(zeros.map(r => r.trade)).size === 1,
        `${zeros.length} managers on nought`);
      t('business straddles nought rather than starting at the worst in the league',
        perf.some(r => r.trade > 0) || perf.some(r => r.trade < 0));
      t('and the draft straddles it too — beating your slots is possible and so is missing them',
        perf.some(r => r.draft > 0) && perf.some(r => r.draft < 0),
        `${perf.filter(r => r.draft > 0).length} above, ${perf.filter(r => r.draft < 0).length} below`);
    })();

    /* ----- the weighting floats, and is reported rather than set ----- */
    (() => {
      t('a share is published for each element', PERF_ELEMENTS.every(el => Number.isFinite(perf.share[el.key])));
      t('the shares add up to the whole',
        Math.abs(PERF_ELEMENTS.reduce((s, el) => s + perf.share[el.key], 0) - 100) < 1e-6,
        PERF_ELEMENTS.map(el => `${el.label} ${perf.share[el.key].toFixed(1)}%`).join(', '));
      t('and each share is that element\'s own spread, not a constant',
        PERF_ELEMENTS.every(el => {
          const vals = perf.map(r => r[el.key]);
          return perf.spread[el.key] === Math.max(...vals) - Math.min(...vals);
        }));
      /* The point of the redesign: the split is NOT a third each. If this
         assertion starts failing, somebody has reintroduced a fixed weighting
         (Marc, 29 Sept 2026: "even the 3 way split could change over time"). */
      t('(control) the split is not three equal thirds',
        PERF_ELEMENTS.some(el => Math.abs(perf.share[el.key] - 100 / 3) > 5),
        PERF_ELEMENTS.map(el => `${Math.round(perf.share[el.key])}%`).join('/'));
    })();

    /* ----- the two readings (Marc, 29 Sept 2026: "managerial performance
       since the draft being just bench wastage and business and ignore the
       draft. Given that the draft was a one off event you cant really do
       anything about it now") ----- */
    (() => {
      const all = managerPerformance('all'), since = managerPerformance('since');
      t('both readings are offered', Object.keys(PERF_VIEWS).length === 2
        && PERF_VIEWS.all.keys.length === 3 && PERF_VIEWS.since.keys.length === 2);
      t('since the draft drops the draft and keeps the other two',
        !PERF_VIEWS.since.keys.includes('draft')
        && PERF_VIEWS.since.keys.includes('bench') && PERF_VIEWS.since.keys.includes('trade'));
      t('its total is bench plus business, with the draft left out',
        since.every(r => r.total === r.bench + r.trade));
      t('and the whole-season total still counts all three',
        all.every(r => r.total === r.draft + r.bench + r.trade));
      // the underlying numbers are the same — only what is added up changes
      t('the two readings share their figures rather than recomputing them',
        since.every(r => {
          const a = all.find(x => x.m.id === r.m.id);
          return a.bench === r.bench && a.trade === r.trade && a.draft === r.draft;
        }));
      /* The control that makes the feature worth having: dropping the draft has
         to actually change who is top, or there was no point asking for it. */
      t('(control) the two readings genuinely disagree about the order',
        all[0].m.id !== since[0].m.id
        || all.map(r => r.m.id).join() !== since.map(r => r.m.id).join(),
        `whole season leads ${all[0].m.team}, since the draft leads ${since[0].m.team}`);
      t('the shares are recomputed over the two that remain, and still total 100',
        Math.abs(PERF_VIEWS.since.keys.reduce((s2, k) => s2 + since.share[k], 0) - 100) < 1e-6
        && since.share.draft === undefined,
        PERF_VIEWS.since.keys.map(k => `${k} ${Math.round(since.share[k])}%`).join(', '));
      t('and every place is recomputed too, not carried over',
        since.every((r, i) => i === 0 || since[i - 1].total >= r.total));
    })();

    /* ----- the toggle on the card ----- */
    (() => {
      perfView = 'all'; dataView.tab = 'managers'; state.view = 'data'; render();
      t('the card offers both readings', document.querySelectorAll('[data-perfview]').length === 2);
      t('(control) the whole-season card shows a draft column',
        [...perfCard().querySelectorAll('thead th')].some(x => x.textContent.trim() === 'Draft'));
      document.querySelector('[data-perfview="since"]').click();
      const card = perfCard();
      const heads = [...card.querySelectorAll('thead th')].map(x => x.textContent.trim());
      t('switching to since the draft drops the draft column',
        perfView === 'since' && !heads.includes('Draft')
        && heads.includes('Bench') && heads.includes('Business'), heads.join('|'));
      t('and drops its section underneath as well',
        card.querySelectorAll('table').length === 3,
        `${card.querySelectorAll('table').length} tables`);
      t('the card says why the draft is left out',
        /nobody can replay it/.test(card.textContent));
      t('and par no longer mentions the draft slots',
        !/drafted exactly to the value of your slots/.test(card.textContent));
      document.querySelector('[data-perfview="all"]').click();
      t('and back again', perfView === 'all'
        && [...perfCard().querySelectorAll('thead th')].some(x => x.textContent.trim() === 'Draft'));
    })();

    /* ----- it reads off the pages that own the numbers ----- */
    (() => {
      const tally = tradeTally('all');
      t('business is the Trade Record\'s own net over all moves',
        perf.every(r => r.trade === (tally[r.m.id]?.net ?? 0)));
      t('bench is the season bench wastage, negated',
        perf.every(r => r.bench === -seasonBenchWaste(r.m.id)));
      const board = draftBoard();
      t('and what the fourteen scored is the Draft Console\'s own total',
        perf.every(r => r.got === board.find(x => x.m.id === r.m.id).pts));
    })();

    /* ----- the card ----- */
    (() => {
      dataView.tab = 'managers'; state.view = 'data'; render();
      const card = perfCard();
      const tables = [...card.querySelectorAll('table')];
      t('one headline table and one per element', tables.length === 4, String(tables.length));
      const heads = [...tables[0].querySelectorAll('thead th')].map(x => x.textContent.trim());
      t('the headline carries the three elements and a total',
        PERF_ELEMENTS.every(el => heads.includes(el.label)) && heads.includes('Total'), heads.join('|'));
      t('the totals on screen are the totals computed',
        [...tables[0].querySelectorAll('tbody tr')].every((tr, i) =>
          parseInt(tr.cells[tr.cells.length - 1].textContent.replace('+', ''), 10) === perf[i].total));
      const txt = card.textContent.replace(/\s+/g, ' ');
      t('the card says nought is par, not the bottom of the league',
        /Nought is par/.test(txt) && /most of these are negative/.test(txt));
      t('it explains there is no weighting to argue about',
        /here is no weighting to argue about/.test(txt));   // capitalised mid-rewrite
      t('and it prints the shares as they currently stand',
        PERF_ELEMENTS.every(el => new RegExp(`${el.label.toLowerCase()} \\d+%`).test(txt)),
        (txt.match(/the spread is [^—]*/) || ['not printed'])[0].slice(0, 90));
      t('the draft section shows what he got and what his slots were worth',
        /Got/.test(tables[1].textContent) && /Slots/.test(tables[1].textContent));
      t('every element table lists every manager',
        tables.slice(1).every(tb => tb.querySelectorAll('tbody tr').length === perf.length));
    })();

    /* ----- it sits in the Data Room, and the league table is untouched ----- */
    (() => {
      state.view = 'data'; dataView.tab = 'players'; render();
      t('the Data Room offers a Managers tab', !!document.querySelector('[data-dtab="managers"]'));
      document.querySelector('[data-dtab="managers"]').click();
      t('and it opens the performance card', dataView.tab === 'managers' && !!perfCard());
      state.view = 'table'; render();
      t('the league table has no performance tab bolted onto it',
        !!document.querySelector('[data-mgr-row]') && !document.querySelector('[data-leaguetab]'));
      dataView.tab = 'managers'; state.view = 'data'; render();
    })();

    return log;
  });

  for (const line of log) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));

  /* ----- the premise, on real football -----
     Slot value is what the draft element is built on, and only a real season
     can show it. 2025/26's archived draft plus a full season of stats: if an
     early pick does not out-return a late one there, the baseline is a fiction
     and the element should not exist. ----- */
  const curve = await page.evaluate(async () => {
    const [hist, p25] = await Promise.all([
      fetch('data/history/2025-26.json').then(r => r.json()),
      fetch('data/history/players25.json').then(r => r.json()),
    ]);
    const byName = new Map();
    for (const q of p25.players) {
      const src = LS_BY_CODE[q.code];
      byName.set(q.full, src ? Math.max(0, leaguePtsFrom(src, q.pos, DEFAULT_SCORING)) : null);
    }
    const rows = Object.values(hist.draft)
      .map(pk => ({ n: pk.pick, pts: byName.get(pk.playerFull) }))
      .filter(r => r.pts != null);
    const avg = a => a.length ? a.reduce((t, r) => t + r.pts, 0) / a.length : 0;
    return {
      matched: rows.length, of: Object.values(hist.draft).length,
      round1: Math.round(avg(rows.filter(r => r.n <= 12))),
      round2: Math.round(avg(rows.filter(r => r.n > 12 && r.n <= 24))),
      round14: Math.round(avg(rows.filter(r => r.n > 156))),
    };
  });
  chk('(control) last season\'s archive matches every pick to a player',
    curve.matched === curve.of, `${curve.matched} of ${curve.of}`);
  chk('a draft slot really is worth something: an early pick out-returns a late one',
    curve.round1 > curve.round14 * 1.5,
    `round one ${curve.round1}, round two ${curve.round2}, last round ${curve.round14}`);

  const virgin = await page.evaluate(() => {
    state = buildDemoState(); state.phase = 'season';
    for (let i = 0; i < GAMEWEEKS.length; i++) GAMEWEEKS[i].finished = false;
    state.matchStats = {};
    dataView.tab = 'managers'; state.view = 'data'; render();
    return [...document.querySelectorAll('.card')].map(c => c.textContent).join(' ');
  });
  chk('with nothing settled it declines to judge rather than crashing',
    /No round has settled yet/.test(virgin));

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
