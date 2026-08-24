/* Scouting Desk regression: saved views, player comparison and queue controls.
 *
 * Honesty rules:
 * - every negative assertion has a positive surface/data precondition;
 * - shared-state immutability is checked before the intentional queue write;
 * - the bulk test instruments the existing setAutolist path and requires one
 *   call, so three rows cannot quietly become three racing writes.
 *
 * Usage: python3 -m http.server 8125 &   node test/scouting.smoke.js */
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
  await page.goto(baseUrl + '?nosync&scouting-test=1', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length);

  const seeded = await page.evaluate(() => {
    state = freshState();
    state.phase = 'draft';
    state.view = 'draft';
    state.settings.pickTimer = 0;
    state.draft.order = state.managers.map(m => m.id);
    whoami = state.managers[0].id;
    localStorage.setItem(WHO_KEY, whoami);
    localStorage.removeItem(scoutViewsKey());
    state.autolists[whoami] = [];
    render();
    return {
      managers: state.managers.length,
      desk: !!document.querySelector('.scout-desk'),
      tools: !!document.querySelector('.scout-tools'),
      compares: document.querySelectorAll('[data-compare]').length,
      stars: document.querySelectorAll('[data-auto]').length,
      bulkControls: document.querySelectorAll('[data-bulk-pid], [data-bulk-add], [data-bulk-all]').length,
      sort: poolFilter.sort,
    };
  });
  chk('SC1 live draft pool opens by Rate with one queue control per player',
    seeded.managers === 12 && seeded.desk && seeded.tools && seeded.compares > 3 && seeded.stars > 3
      && seeded.bulkControls === 0 && seeded.sort === 'rate',
    JSON.stringify(seeded));

  const preset = await page.evaluate(() => {
    const sel = document.querySelector('[data-scout-view]');
    const hadForm = [...sel.options].some(o => o.value === 'preset:form');
    sel.value = 'preset:form';
    sel.dispatchEvent(new Event('change'));
    const heads = [...document.querySelectorAll('.pool-table thead th')].map(x => x.textContent.trim());
    return {
      hadForm,
      sort: poolFilter.sort,
      cols: visibleColKeys(seasonHasStats()),
      formSorted: heads.includes('F5 ▾'),
      selected: document.querySelector('[data-scout-view]').value,
      outputGone: !heads.some(h => h === 'G' || h === 'A' || h === 'xGI'),
    };
  });
  chk('SC2: Form watch is a real preset, not a decorative option',
    preset.hadForm && preset.sort === 'f5' && preset.formSorted && preset.selected === 'preset:form'
      && JSON.stringify(preset.cols) === JSON.stringify(['vs', 'f5', 'gw', 'ppg', 'pts'])
      && preset.outputGone,
    JSON.stringify(preset));

  const saved = await page.evaluate(() => {
    const before = JSON.stringify(sharedSnapshot());
    window.__scoutXss = 0;
    window.prompt = () => '<img src=x onerror=1>';
    document.querySelector('[data-scout-save]').click();
    const views = scoutViews();
    const select = document.querySelector('[data-scout-view]');
    const option = [...select.options].find(o => o.value.startsWith('saved:'));
    const after = JSON.stringify(sharedSnapshot());
    return {
      count: views.length,
      name: views[0]?.name,
      optionText: option?.textContent,
      injected: !!document.querySelector('.scout-desk img'),
      xss: window.__scoutXss,
      sharedUntouched: before === after,
      hasDelete: !!document.querySelector('[data-scout-delete]'),
      deleteEnabled: !document.querySelector('[data-scout-delete]')?.disabled,
    };
  });
  chk('SC3: a named view persists locally and does not mutate shared league state',
    saved.count === 1 && saved.sharedUntouched && saved.hasDelete && saved.deleteEnabled, JSON.stringify(saved));
  chk('SC4: manager-typed view names stay literal (no HTML injection)',
    saved.name === '<img src=x onerror=1>' && saved.optionText === saved.name && !saved.injected && !saved.xss,
    JSON.stringify(saved));

  const availableView = await page.evaluate(() => {
    transfersView.scope = 'avail';
    const snap = { ...scoutSnapshot('transfers'), id: 'available-roundtrip', name: 'Available men' };
    writeScoutViews([snap]);
    const stored = scoutViews()[0];
    transfersView.scope = 'free';
    const transferApplied = applyScoutView(stored, 'transfers');
    dataView.scope = 'all';
    const dataApplied = applyScoutView(stored, 'data');
    const legacy = cleanScoutView({ id: 'legacy-mf', name: 'Legacy MF', pos: 'MF', scope: 'free' });
    return {
      snap: snap.scope,
      stored: stored?.scope,
      transferApplied,
      transferScope: transfersView.scope,
      dataApplied,
      dataScope: dataView.scope,
      legacyPos: legacy?.pos,
    };
  });
  chk('SC4b: Available survives a saved Trough view without leaking into surfaces that lack it',
    availableView.snap === 'avail' && availableView.stored === 'avail'
      && availableView.transferApplied && availableView.transferScope === 'avail'
      && availableView.dataApplied && availableView.dataScope === 'free'
      && JSON.stringify(availableView.legacyPos) === JSON.stringify(['MF']),
    JSON.stringify(availableView));

  const comparison = await page.evaluate(() => {
    const before = JSON.stringify(sharedSnapshot());
    const buttons = [...document.querySelectorAll('.pool-table [data-compare]')];
    const ids = buttons.slice(0, 4).map(b => +b.dataset.compare);
    buttons[0].click();
    buttons[1].click();
    const fabReady = document.querySelector('#scoutCompareFab')?.textContent === 'Compare 2/3';
    showScoutCompare();
    const ov = document.querySelector('#scoutCompareOverlay');
    // one shared comparison body now: a column per player, metrics down the side
    const head = [...(ov?.querySelectorAll('.compare-card thead th') || [])];
    const twoCards = head.length === 3 // Metric + two players
      && ids.slice(0, 2).every(id => head.some(h => h.textContent.includes(PLAYER_BY_ID[id].name)));
    const rowText = [...(ov?.querySelectorAll('.compare-card tbody tr') || [])].map(tr => tr.textContent);
    const runway = rowText.some(t => /fixtures/.test(t) && /GW\d/.test(t));
    toggleScoutCompare(ids[2]);
    toggleScoutCompare(ids[3]); // a fourth replaces the oldest rather than being refused
    const capped = scoutCompare.length === 3 && scoutCompare.includes(ids[3]) && !scoutCompare.includes(ids[0]);
    const after = JSON.stringify(sharedSnapshot());
    scoutCompare = [];
    paintScoutCompare();
    return { ids, fabReady, twoCards, runway, capped, sharedUntouched: before === after };
  });
  chk('SC5: compare opens both players as columns, with the fixture runway',
    comparison.ids.length === 4 && comparison.fabReady && comparison.twoCards && comparison.runway,
    JSON.stringify(comparison));
  chk('SC6: compare is read-only and capped at three (a fourth pushes the oldest out)',
    comparison.capped && comparison.sharedUntouched, JSON.stringify(comparison));

  // the overlay builds its DOM detached, so its pickers must be bound against
  // the overlay itself — bound against the document they were dead on arrival
  // (found in the 13 Aug post-merge audit; the tick-boxes share the fate)
  const overlayPickers = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.pool-table [data-compare]')];
    buttons[0].click();
    buttons[1].click();
    showScoutCompare();
    const pick = document.querySelector('#scoutCompareOverlay #cmpFwd');
    if (!pick) return { pick: false };
    pick.value = '3';
    pick.dispatchEvent(new Event('change'));
    const reopened = document.querySelector('#scoutCompareOverlay');
    const windowTook = dataView.fwdWeeks === 3
      && !![...reopened.querySelectorAll('tbody tr td')].find(td => /next 3/.test(td.textContent));
    const box = reopened.querySelector('[data-cmpcol="g"]');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    const tickTook = !(dataView.compareCols || []).includes('g')
      && ![...document.querySelectorAll('#scoutCompareOverlay tbody tr td:first-child')].some(td => /^Goals/.test(td.textContent));
    document.querySelector('#scoutCompareOverlay')?.remove();
    scoutCompare = [];
    dataView = { ...dataView, fwdWeeks: 6, compareCols: null };
    paintScoutCompare();
    return { pick: true, windowTook, tickTook };
  });
  chk('SC6b: the overlay\'s window picker and metric ticks are live, not dead controls',
    overlayPickers.pick && overlayPickers.windowTook && overlayPickers.tickTook,
    JSON.stringify(overlayPickers));

  // removing a player until fewer than two remain closes the overlay THROUGH
  // closeOv, consuming its history entry — a bare remove() left one ghost
  // Back press that swallowed the first tap (sol launch-verify P3, 13 Aug)
  // earlier checks may leave their own entries on the stack, so the assertion
  // is RELATIVE: opening pushes exactly one entry, closing consumes exactly it
  const ghostBack = await page.evaluate(() => {
    scoutCompare = [];
    const beforeOv = (history.state && history.state.ov) || 0;
    const buttons = [...document.querySelectorAll('.pool-table [data-compare]')];
    buttons[0].click();
    buttons[1].click();
    showScoutCompare(true); // real open: pushes the overlay history entry
    const openedOv = (history.state && history.state.ov) || 0;
    const opened = !!document.getElementById('scoutCompareOverlay') && openedOv > beforeOv;
    toggleScoutCompare(+buttons[0].dataset.compare); // down to one → closes
    return { beforeOv, openedOv, opened, closed: !document.getElementById('scoutCompareOverlay') };
  });
  await page.waitForFunction(
    b => ((history.state && history.state.ov) || 0) === b, {}, ghostBack.beforeOv).catch(() => {});
  const entryConsumed = await page.evaluate(b => {
    const consumed = ((history.state && history.state.ov) || 0) === b;
    scoutCompare = [];
    paintScoutCompare();
    return consumed;
  }, ghostBack.beforeOv);
  chk('SC6c: closing the overlay by removal consumes its Back entry (no ghost press)',
    ghostBack.opened && ghostBack.closed && entryConsumed, JSON.stringify({ ...ghostBack, entryConsumed }));

  const singleAdd = await page.evaluate(() => {
    const button = document.querySelector('[data-auto]');
    const pid = +button.dataset.auto;
    const original = setAutolist;
    let calls = 0;
    setAutolist = (mid, arr) => { calls++; return original(mid, arr); };
    button.click();
    setAutolist = original;
    return {
      pid,
      calls,
      queued: state.autolists[whoami],
      bulkControls: document.querySelectorAll('[data-bulk-pid], [data-bulk-add], [data-bulk-all]').length,
    };
  });
  chk('SC7: the single star action makes one ranked queue update',
    singleAdd.pid > 0 && singleAdd.calls === 1
      && JSON.stringify(singleAdd.queued) === JSON.stringify([singleAdd.pid])
      && singleAdd.bulkControls === 0,
    JSON.stringify(singleAdd));

  const scoring = await page.evaluate(() => {
    const p = PLAYERS.find(x => x.pos === 'DF');
    const base = { min: 90, st: 1 };
    const plain = statPoints(p, base);
    const smuggled = statPoints(p, { ...base, dc: 99, defcon: 99, defensiveContribution: 99 });
    state.view = 'rules'; render();
    const text = document.querySelector('#main').textContent;
    return {
      plain,
      smuggled,
      saysNoDefcon: /No defensive-contribution \(DEFCON\) points/i.test(text),
      noDefconSetting: !Object.keys(state.settings.scoring).some(k => /def|contribution/i.test(k)),
    };
  });
  chk('SC8: DEFCON is explicitly rejected in copy and ignored by scoring',
    scoring.saysNoDefcon && scoring.noDefconSetting && scoring.plain === scoring.smuggled,
    JSON.stringify(scoring));

  const mobile = await ctx.newPage();
  mobile.on('pageerror', e => errors.push('320px: ' + e.message));
  await mobile.setViewport({ width: 320, height: 650 });
  await mobile.goto(baseUrl + '?demo&nosync&scouting-mobile=1', { waitUntil: 'networkidle2' });
  await mobile.waitForFunction(() => typeof state !== 'undefined' && state.managers.length);
  const m320 = await mobile.evaluate(() => {
    state.view = 'transfers';
    transfersView.tab = 'trough';
    render();
    const tools = document.querySelector('.scout-tools');
    if (tools) tools.open = true;
    const buttons = [...document.querySelectorAll('[data-compare]')].slice(0, 2);
    buttons.forEach(b => b.click());
    showScoutCompare();
    const card = document.querySelector('.compare-card');
    const desk = document.querySelector('.scout-desk');
    return {
      tools: !!tools && tools.offsetParent !== null,
      desk: !!desk && desk.offsetParent !== null,
      card: !!card && card.offsetParent !== null,
      compareCards: (card?.querySelectorAll('thead th').length || 1) - 1, // minus the Metric column
      scrollW: document.documentElement.scrollWidth,
      viewport: innerWidth,
    };
  });
  chk('SC9: Scouting Desk and two-player compare fit a real 320px viewport',
    m320.tools && m320.desk && m320.card && m320.compareCards === 2 && m320.viewport === 320 && m320.scrollW <= 320,
    JSON.stringify(m320));

  /* SC11 — a column that is the sum of two others must agree with them.
     Bobby Thomas read xG 0.02, xA 0.01, xGI 0.0, because xGI alone printed to
     one decimal place while its own inputs printed to two (Marc, 24 Aug 2026). */
  const sums = await page.evaluate(() => {
    const cols = ALL_STAT_COLS(true);
    const col = k => cols.find(c => c.k === k);
    const bad = [];
    let checked = 0;
    for (const p of PLAYERS) {
      const m = metricsFor(p);
      if (!(m.xg > 0 || m.xa > 0)) continue;      // nothing to contradict
      checked++;
      const xg = +col('xg').v(m), xa = +col('xa').v(m), xgi = +col('xgi').v(m);
      if (Math.abs(xg + xa - xgi) > 0.005) bad.push(`${p.name} ${xg}+${xa}!=${xgi}`);
    }
    const t = PLAYERS.find(x => x.full === 'Bobby Thomas');
    const tm = t ? metricsFor(t) : null;
    return {
      checked, bad: bad.slice(0, 6), badCount: bad.length,
      thomas: tm ? { xg: col('xg').v(tm), xa: col('xa').v(tm), xgi: col('xgi').v(tm) } : null,
    };
  });
  chk('SC11: the test has players with expected numbers to check (not vacuous)',
    sums.checked > 20, `${sums.checked} players`);
  /* SC12 — both seasons, in two columns rather than one that changes meaning.
     Marc, 24 Aug 2026: "it needs both for now and eventually we remove last
     seasons numbers." */
  const seasons = await page.evaluate(() => {
    const cols = ALL_STAT_COLS(true);
    const col = k => cols.find(c => c.k === k);
    const saka = PLAYERS.find(x => x.full === 'Bukayo Saka');
    const m = saka ? metricsFor(saka) : null;
    const ls = saka ? lastSeasonOf(saka) : null;
    return {
      header: col('xgiLs') ? col('xgiLs').h : null,
      sortable: SCOUT_SORTS.has('xgiLs'),
      onPreset: SCOUT_PRESETS.find(v => v.id === 'output').cols.includes('xgiLs'),
      thisSeason: m ? col('xgi').v(m) : null,
      lastSeason: m ? col('xgiLs').v(m) : null,
      archive: ls ? ls.xgi : null,
    };
  });
  chk('SC12: last season\'s xGI is its own column, named for its season',
    /^xGI \d\d\/\d\d$/.test(seasons.header || ''), String(seasons.header));
  chk('SC12: it carries the archive figure, not this season\'s',
    +seasons.lastSeason === seasons.archive && +seasons.lastSeason !== +seasons.thisSeason,
    JSON.stringify(seasons));
  chk('SC12: sortable, and on the goals-and-assists view so both are visible at once',
    seasons.sortable && seasons.onPreset, JSON.stringify({ s: seasons.sortable, p: seasons.onPreset }));
  chk('SC11: printed xGI equals printed xG + printed xA for every one of them',
    sums.badCount === 0, `${sums.badCount} disagree: ${sums.bad.join(', ')}`);
  if (sums.thomas) {
    chk('SC11: Bobby Thomas reads 0.02 + 0.01 = 0.03, not 0.0',
      sums.thomas.xgi === '0.03', JSON.stringify(sums.thomas));
  }

  chk('SC10: no uncaught browser errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n[scouting] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(async e => {
  console.error(e);
  process.exit(1);
});
