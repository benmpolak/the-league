// Does the control actually narrow what the page shows?
const puppeteer = require('puppeteer-core');
// CI serves the site on 8125 (test.yml), like every other smoke. Defaulting to
// the 8749 side port refused the connection there and held every deploy, 11 Oct.
const BASE = process.env.TEST_BASE_URL || 'http://localhost:8125';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });   // a phone, deliberately
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const log = [];
  const t = (name, ok, detail = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

  // ---- the Data Room explorer ----
  await page.evaluate(() => {
    state.phase = 'season';
    // put xG on screen — sorting by a column nobody can see proves nothing
    _colPrefs = ['vs', 'xg', 'min', 'pts'];
    dataView = { ...dataView, tab: 'players', win: null, sort: 'xg', q: '' };
    state.view = 'data'; render();
  });
  await page.waitForSelector('[data-statwin]', { timeout: 5000 }).catch(() => {});

  const bar = await page.evaluate(() => {
    const b = document.querySelector('[data-statwin]');
    if (!b) return null;
    return {
      buttons: [...b.querySelectorAll('[data-win]')].map(x => x.textContent.trim()),
      selects: b.querySelectorAll('select').length,
    };
  });
  t('the explorer shows a window strip', !!bar, bar ? bar.buttons.join(' | ') : 'missing');
  t('it offers All, fixed lengths and a from/to range',
    !!bar && bar.buttons[0] === 'All' && bar.buttons.length >= 2 && bar.selects === 2,
    bar ? `${bar.buttons.length} buttons, ${bar.selects} selects` : '');

  // The explorer's body cells carry no data-stat (its headers do, unlike the
  // Trough's) — so find the xG column by its header and read that position.
  const readTop = () => page.evaluate(() => {
    const table = [...document.querySelectorAll('.card table.pool-table')]
      .find(t => t.querySelector('th[data-stat="xg"]'));
    if (!table) return [];
    const heads = [...table.querySelectorAll('thead th')];
    const col = heads.findIndex(h => h.getAttribute('data-stat') === 'xg');
    return [...table.querySelectorAll('tbody tr')].slice(0, 3).map(r => {
      const name = r.querySelector('.pn-txt, td:nth-child(2)')?.textContent.trim().split('\n')[0];
      return `${name} ${r.cells[col]?.textContent.trim()}`;
    });
  });

  const seasonTop = await readTop();
  t('(setup) the season view lists players with xG', seasonTop.length > 0 && /\d/.test(seasonTop[0] || ''), seasonTop[0]);

  // click "Last 1"
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-statwin] [data-win]')].find(x => x.getAttribute('data-win') === '1');
    if (!b) return false;
    b.click(); return true;
  });
  await new Promise(r => setTimeout(r, 400));
  const oneTop = await readTop();
  t('clicking Last 1 redraws the table', clicked && oneTop.length > 0, oneTop[0]);
  t('and the numbers are not the season numbers',
    JSON.stringify(oneTop) !== JSON.stringify(seasonTop),
    `season ${seasonTop[0]} -> last 1 ${oneTop[0]}`);
  const saysWindow = await page.evaluate(() =>
    /showing Last 1, not the season/.test(document.querySelector('[data-statwin]')?.textContent || ''));
  t('the strip says a window is on', saysWindow);
  const stateWin = await page.evaluate(() => JSON.stringify(dataView.win));
  t('and it is remembered on the view state', stateWin === '{"n":1}', stateWin);

  // the range selects
  await page.evaluate(() => {
    const b = document.querySelector('[data-statwin]');
    const from = b.querySelector('[data-winfrom]'), to = b.querySelector('[data-winto]');
    from.value = '2'; to.value = '3';
    to.dispatchEvent(new Event('change'));
  });
  await new Promise(r => setTimeout(r, 400));
  const rangeWin = await page.evaluate(() => JSON.stringify(dataView.win));
  t('picking a from/to sets a range', rangeWin === '{"from":2,"to":3}', rangeWin);
  const rangeLabel = await page.evaluate(() =>
    /showing GW2.{1,3}3, not the season/.test(document.querySelector('[data-statwin]')?.textContent || ''));
  t('and the strip names the rounds it is showing', rangeLabel);

  // back to All
  await page.evaluate(() => {
    [...document.querySelectorAll('[data-statwin] [data-win]')].find(x => x.getAttribute('data-win') === 'all').click();
  });
  await new Promise(r => setTimeout(r, 400));
  const backTop = await readTop();
  t('All puts the season numbers back exactly', JSON.stringify(backTop) === JSON.stringify(seasonTop),
    `${backTop[0]} vs ${seasonTop[0]}`);

  // ---- the Trough ----
  await page.evaluate(() => {
    transfersView = { ...transfersView, win: null, tab: 'trough', scope: 'all', limit: 20 };
    state.view = 'transfers'; render();
  });
  await new Promise(r => setTimeout(r, 600));
  const troughBar = await page.evaluate(() => !!document.querySelector('[data-statwin]'));
  t('the Trough has the same strip', troughBar);
  if (troughBar) {
    const ok = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-statwin] [data-win]')].find(x => x.getAttribute('data-win') === '3');
      if (!b) return 'no button';
      b.click();
      return JSON.stringify(transfersView.win);
    });
    await new Promise(r => setTimeout(r, 400));
    t('and it drives the Trough\'s own window, not the Data Room\'s', ok === '{"n":3}', String(ok));
    const dr = await page.evaluate(() => JSON.stringify(dataView.win));
    t('the two surfaces keep separate windows', dr === 'null', `data room still ${dr}`);
  }

  // ---- what the window unlocked, and what it replaced ----
  const cols = await page.evaluate(() => {
    const live = seasonHasStats();
    const keys = ALL_STAT_COLS(live).map(c => c.k);
    // a keeper, for the counting stats that only mean something in a window
    const gk = PLAYERS.map(x => PLAYER_BY_ID[x.id]).filter(x => x && x.pos === 'GK')
      .sort((a, b) => (metricsFor(b).sv || 0) - (metricsFor(a).sv || 0))[0];
    const season = withStatWindow(null, () => ({ ...metricsFor(gk) }));
    const idxs = playedGwIdxs();
    const summed = ['sv', 'gc', 'yc', 'rc'].map(k => [k, idxs.reduce((t, i) =>
      t + withStatWindow({ from: GAMEWEEKS[i].n, to: GAMEWEEKS[i].n }, () => metricsFor(gk)[k] || 0), 0)]);
    const form = SCOUT_PRESETS.find(v => v.id === 'form');
    return {
      keys,
      gkName: gk.full,
      season: Object.fromEntries(['sv', 'gc', 'yc', 'rc'].map(k => [k, season[k]])),
      summed: Object.fromEntries(summed),
      form,
      formWin: JSON.stringify(cleanStatWindow(form && form.win)),
      junkWindows: [cleanStatWindow({ n: -1 }), cleanStatWindow({ n: 999 }),
        cleanStatWindow({ from: 'x', to: 2 }), cleanStatWindow(null)].map(v => JSON.stringify(v)),
      backwards: JSON.stringify(cleanStatWindow({ from: 5, to: 2 })),
    };
  });

  t('saves, goals conceded and cards now have columns',
    ['sv', 'gc', 'yc', 'rc'].every(k => cols.keys.includes(k)), cols.keys.join(','));
  t('and each one sums round by round to its season total',
    ['sv', 'gc', 'yc', 'rc'].every(k => cols.summed[k] === cols.season[k]),
    `${cols.gkName}: ` + ['sv', 'gc', 'yc', 'rc'].map(k => `${k} ${cols.summed[k]}/${cols.season[k]}`).join(' '));
  t('F5 is gone — it was the window averaging five rounds', !cols.keys.includes('f5'));
  t('and so are the two single-round minute counts',
    !cols.keys.includes('minGw') && !cols.keys.includes('minPrev'));
  t('Form watch survives, as a window rather than a column',
    !!cols.form && cols.formWin === '{"n":5}' && !cols.form.cols.includes('f5'),
    cols.form ? `cols ${cols.form.cols.join('/')} sort ${cols.form.sort} win ${cols.formWin}` : 'missing');
  t('a nonsense window saved in a view reads as the whole season',
    cols.junkWindows.every(v => v === 'null'), cols.junkWindows.join(' '));
  t('a backwards range is read the way round it makes sense',
    cols.backwards === '{"from":2,"to":5}', cols.backwards);

  // picking Form watch really does set the window on the surface
  const preset = await page.evaluate(() => {
    state.view = 'data'; dataView = { ...dataView, win: null, tab: 'players' }; render();
    const ok = applyScoutView(SCOUT_PRESETS.find(v => v.id === 'form'), 'data');
    return { ok, win: JSON.stringify(dataView.win), sort: dataView.sort };
  });
  t('choosing Form watch puts the surface on the last five rounds',
    preset.ok && preset.win === '{"n":5}', `${preset.win}, sorted by ${preset.sort}`);

  // ---- the minutes floor has to measure the window, not the season ----
  const floor = await page.evaluate(() => {
    const steps = w => minMinutesSteps(w).join(',');
    // a man with minutes this season but none in the round just gone
    const idxs = playedGwIdxs();
    const last = idxs[idxs.length - 1];
    const dropped = PLAYERS.map(x => PLAYER_BY_ID[x.id]).filter(Boolean).find(p =>
      (p.mp || 0) >= 180 && !(gwEvent(last)?.playerStats?.[p.id]?.min));
    const inWindow = dropped ? withStatWindow({ n: 1 }, () => metricsFor(dropped).min) : null;
    return {
      caps: [windowMinutesCap(null), windowMinutesCap({ n: 1 }), windowMinutesCap({ n: 3 })],
      stepsAll: steps(null), steps1: steps({ n: 1 }), steps3: steps({ n: 3 }),
      droppedName: dropped && dropped.full, droppedSeason: dropped && dropped.mp, inWindow,
    };
  });
  t('the floor knows how many minutes a window can hold',
    floor.caps[1] === 90 && floor.caps[2] === 270 && floor.caps[0] > floor.caps[2],
    floor.caps.join(' / '));
  t('and only offers steps that window can reach',
    floor.steps1 === '0,90' && floor.steps3 === '0,90,270'
      && floor.stepsAll.split(',').length > 3,
    `all ${floor.stepsAll} | last1 ${floor.steps1} | last3 ${floor.steps3}`);

  // the trap: a 900+ floor chosen on the season view, then window to one round
  const stale = await page.evaluate(() => {
    dataView = { ...dataView, tab: 'players', minMin: 900, win: null, q: '', owner: null, scope: 'all', pos: '', club: '' };
    state.view = 'data'; render();
    const season = document.querySelectorAll('.card table.pool-table tbody tr').length;
    dataView = { ...dataView, win: { n: 1 } }; render();
    return { season, windowed: document.querySelectorAll('.card table.pool-table tbody tr').length };
  });
  t('a 900+ floor left over from the season view does not empty a one-round table',
    stale.windowed > 0, `season ${stale.season} rows, last-1 ${stale.windowed} rows`);
  t('(and the man who played none of that round is screened out by it)',
    floor.inWindow === 0 || floor.droppedName == null,
    floor.droppedName ? `${floor.droppedName}: ${floor.droppedSeason} season, ${floor.inWindow} in the window` : 'nobody fits the shape');

  // ---- the player card tells the round-by-round story, xG included ----
  const card = await page.evaluate(() => {
    const idxs = playedGwIdxs();
    const scorer = PLAYERS.map(x => PLAYER_BY_ID[x.id]).filter(Boolean)
      .find(p => idxs.some(i => (gwEvent(i)?.playerStats?.[p.id]?.xg || 0) > 0));
    if (!scorer) return { none: true };
    showPlayerCard(scorer.id);
    const txt = document.querySelector('#pcardOverlay')?.textContent || '';
    document.querySelector('#pcardOverlay')?.remove();
    return { name: scorer.full, hasXg: /xG \d+\.\d\d/.test(txt), rounds: (txt.match(/GW\d+/g) || []).length };
  });
  t('the player card breaks xG down round by round',
    card.none || (card.hasXg && card.rounds > 1),
    card.none ? 'no player with per-round xG' : `${card.name}: ${card.rounds} rounds, xG shown ${card.hasXg}`);

  t('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log(log.join('\n'));
  const bad = log.filter(l => l.startsWith('FAIL')).length;
  console.log(`\n[statwindow] ${log.length - bad} passed, ${bad} failed`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
