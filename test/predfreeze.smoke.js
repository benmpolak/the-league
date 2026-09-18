/* A frozen round cannot move (Marc, 18 Sept 2026: "why does the prediction
 * tracker keep changing, that shouldnt be possible").
 *
 * This is the test the whole fix exists for, and it is written as an
 * experiment rather than an assertion: shove the live feed around underneath a
 * settled round and watch what happens to its prediction.
 *
 *   - unfrozen, it moves. That is the CONTROL, and it has to pass, or the
 *     rest of this file is proving nothing — a test that shows a frozen
 *     number holding still is worthless if the unfrozen one holds still too.
 *   - frozen, it does not move. Not "moves less": not at all.
 *
 * The shove is the real one. Over thirty ordinary hours the FPL feed changed
 * ten injury flags, eleven availability figures and seventeen prices, and that
 * moved three of GW1's six ties, the worst by 5.1 points across the 50% line.
 * So the mutation here is injuries, availability and prices — the same three.
 *
 * And the card has to stay honest about it: a reconstruction that has been
 * frozen is not the same thing as what the Committee said at the deadline, and
 * the reader is owed the difference.
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

    state = buildDemoState();
    state.phase = 'season';
    myId = whoami = state.managers[0].id;

    const settled = [];
    for (let i = 0; i < Math.min(REGULAR_GWS, GAMEWEEKS.length); i++) if (gwStatus(i) === 'final') settled.push(i);
    t('(setup) there is a settled round to freeze', settled.length > 0, `${settled.length} settled`);
    if (!settled.length) return log;
    const gwIdx = settled[0];
    const gwN = GAMEWEEKS[gwIdx].n;

    const readOdds = () => { PRED_CACHE.clear(); return predictionsFor(gwIdx).map(r => r.o.win); };
    // the same three fields the real feed moved, shoved hard enough to bite
    const shove = () => {
      let n = 0;
      for (const p of PLAYERS) {
        if (p.id % 3 !== 0) continue;
        p.status = p.status === 'a' ? 'd' : 'a';
        p.chance = p.chance === 100 || p.chance == null ? 50 : 100;
        p.price = Math.round((+p.price + 0.3) * 10) / 10;
        n++;
      }
      return n;
    };
    const spread = (x, y) => x.reduce((m, v, k) => Math.max(m, Math.abs(v - y[k])), 0);

    /* ----- CONTROL: unfrozen, the feed moves it ----- */
    delete state.predictions;
    const loose1 = readOdds();
    const touched = shove();
    const loose2 = readOdds();
    const drift = spread(loose1, loose2);
    t('(control) with nothing recorded, moving the feed moves the prediction',
      drift > 1e-9, `${touched} players shoved, worst tie moved ${(drift * 100).toFixed(2)}pp`);

    /* ----- FROZEN: the same shove, and nothing moves ----- */
    // freeze what it currently says, exactly as the backfill writes it
    const frozen = predictionsFor(gwIdx).map(r => ({
      a: r.a, b: r.b, w: +r.o.win.toFixed(4), d: +r.o.draw.toFixed(4), l: +r.o.loss.toFixed(4),
      pa: 40, pb: 38,
    }));
    state.predictions = { rounds: { [String(gwN)]: {
      deadline: GAMEWEEKS[gwIdx].deadline || null, taken: '2026-09-18T12:00:00Z',
      rebuilt: true, newsGap: !newsKnownAt(gwIdx), games: frozen } } };

    const fixed1 = readOdds();
    shove();
    const fixed2 = readOdds();
    shove();
    const fixed3 = readOdds();
    t('once frozen, the same shove moves nothing at all',
      spread(fixed1, fixed2) === 0 && spread(fixed1, fixed3) === 0,
      `worst movement ${(Math.max(spread(fixed1, fixed2), spread(fixed1, fixed3)) * 100).toFixed(4)}pp over two shoves`);
    t('and the frozen numbers are the ones that were written down',
      fixed1.every((v, k) => Math.abs(v - frozen[k].w) < 5e-5), `${fixed1[0]} vs ${frozen[0].w}`);
    t('the frozen round reads back as recorded', predictionsFor(gwIdx).every(r => r.recorded));
    t('and says it was rebuilt, not caught at the deadline',
      predictionsFor(gwIdx).every(r => r.rebuilt === true));

    /* a tie published the other way up must read back the other way up, or
       freezing would silently swap two managers' chances round */
    (() => {
      const g = frozen[0];
      state.predictions.rounds[String(gwN)].games = [{ a: g.b, b: g.a, w: g.l, d: g.d, l: g.w, pa: 38, pb: 40 },
        ...frozen.slice(1)];
      PRED_CACHE.clear();
      const flipped = predictionsFor(gwIdx);
      t('a tie stored the other way round is read back the right way round',
        Math.abs(flipped[0].o.win - g.w) < 5e-5, `${flipped[0].o.win.toFixed(4)} vs ${g.w}`);
      state.predictions.rounds[String(gwN)].games = frozen;
      PRED_CACHE.clear();
    })();

    /* half a round is never half-trusted: one missing tie falls back to a
       rebuild entire, so a card cannot mix a record and a reconstruction */
    (() => {
      state.predictions.rounds[String(gwN)].games = frozen.slice(1);
      PRED_CACHE.clear();
      t('a round missing one of its ties falls back to a rebuild, not a mixture',
        predictionsFor(gwIdx).every(r => !r.recorded));
      state.predictions.rounds[String(gwN)].games = frozen;
      PRED_CACHE.clear();
    })();

    /* ----- and the card tells the reader which kind it is ----- */
    (() => {
      const host = document.createElement('div');
      host.innerHTML = predictionCard();
      document.body.appendChild(host);
      const txt = host.textContent;
      t('the card says the frozen round was rebuilt and can no longer move',
        /rebuilt afterwards and frozen/.test(txt) && /no longer move/.test(txt),
        (txt.match(/GW[^.]*no longer move/) || ['not said'])[0].slice(0, 90));
      t('it calls it a reconstruction rather than something the Committee claimed',
        /a reconstruction rather than a claim/.test(txt)
        && !/the Committee's own words/.test(txt));
      // a round with no team news of its own must carry that caveat
      if (!newsKnownAt(gwIdx)) {
        t('a round predating the team-news record says so',
          /predates the team-news record/.test(txt),
          (txt.match(/GW\d+ predates[^.]*\./) || ['not said'])[0].slice(0, 120));
      }
      host.remove();
    })();

    /* ----- a round still being rebuilt is still named as such ----- */
    (() => {
      delete state.predictions;
      PRED_CACHE.clear();
      const host = document.createElement('div');
      host.innerHTML = predictionCard();
      const txt = host.textContent;
      t('with nothing frozen, the card admits the numbers can still shift',
        /still rebuilt on every visit/.test(txt) && /can still shift/.test(txt),
        (txt.match(/GW[^.]*can still shift/) || ['not said'])[0].slice(0, 90));
      // nothing is frozen here, so nothing may be described as a fixed record
      t('and it does not claim any round below was recorded at the deadline',
        !/recorded at the deadline and never touched since/.test(txt)
        && !/rebuilt afterwards and frozen/.test(txt));
    })();

    return log;
  });

  for (const line of log) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[pred-freeze] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
