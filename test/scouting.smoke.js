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
      compares: document.querySelectorAll('[data-compare]').length,
      stars: document.querySelectorAll('[data-auto]').length,
      bulkControls: document.querySelectorAll('[data-bulk-pid], [data-bulk-add], [data-bulk-all]').length,
      sort: poolFilter.sort,
    };
  });
  chk('SC1 live draft pool opens by Rate with one queue control per player',
    seeded.managers === 12 && seeded.desk && seeded.compares > 3 && seeded.stars > 3
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

  const comparison = await page.evaluate(() => {
    const before = JSON.stringify(sharedSnapshot());
    const buttons = [...document.querySelectorAll('.pool-table [data-compare]')];
    const ids = buttons.slice(0, 4).map(b => +b.dataset.compare);
    buttons[0].click();
    buttons[1].click();
    const fabReady = document.querySelector('#scoutCompareFab')?.textContent === 'Compare 2/3';
    showScoutCompare();
    const ov = document.querySelector('#scoutCompareOverlay');
    const twoCards = ov?.querySelectorAll('.compare-player').length === 2;
    const runway = ov?.querySelectorAll('.compare-runway').length === 2
      && ov.textContent.includes('Next six') && ov.textContent.includes('GW1');
    toggleScoutCompare(ids[2]);
    toggleScoutCompare(ids[3]); // refused: the tray is already at three
    const capped = scoutCompare.length === 3 && !scoutCompare.includes(ids[3]);
    const after = JSON.stringify(sharedSnapshot());
    scoutCompare = [];
    paintScoutCompare();
    return { ids, fabReady, twoCards, runway, capped, sharedUntouched: before === after };
  });
  chk('SC5: compare tray opens two genuine player cards with Next Six data',
    comparison.ids.length === 4 && comparison.fabReady && comparison.twoCards && comparison.runway,
    JSON.stringify(comparison));
  chk('SC6: compare is read-only and hard-capped at three players',
    comparison.capped && comparison.sharedUntouched, JSON.stringify(comparison));

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
    const buttons = [...document.querySelectorAll('[data-compare]')].slice(0, 2);
    buttons.forEach(b => b.click());
    showScoutCompare();
    const card = document.querySelector('.compare-card');
    const desk = document.querySelector('.scout-desk');
    return {
      desk: !!desk && desk.offsetParent !== null,
      card: !!card && card.offsetParent !== null,
      compareCards: card?.querySelectorAll('.compare-player').length,
      scrollW: document.documentElement.scrollWidth,
      viewport: innerWidth,
    };
  });
  chk('SC9: Scouting Desk and two-player compare fit a real 320px viewport',
    m320.desk && m320.card && m320.compareCards === 2 && m320.viewport === 320 && m320.scrollW <= 320,
    JSON.stringify(m320));

  chk('SC10: no uncaught browser errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n[scouting] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(async e => {
  console.error(e);
  process.exit(1);
});
