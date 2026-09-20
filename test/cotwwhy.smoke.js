/* The C*** of the Week working (Marc, 20 Sept 2026: "Ian has cunt of the week
 * 5 times and i want to see why").
 *
 * The danger in a "show the working" feature is that it becomes a second
 * opinion: a routine that explains a verdict some other routine reached, and
 * drifts from it. So the first thing tested here is that the sheet on screen
 * is the sheet that decided, not a re-derivation of it.
 *
 * After that, the thing Marc actually needs: most weeks are NOT settled by the
 * charge printed at the top, and the working has to say which rule really did
 * it — otherwise a man reads the headline charge and thinks that was the
 * reason. The standing charges are marked for the same reason: a sheet that is
 * three-quarters permanent explains a man collecting this over and over
 * without doing anything new, and no count of "other matters" ever could.
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

    state = buildDemoState(); state.phase = 'season';
    myId = whoami = state.managers[0].id;

    // a run of rounds, so the tiebreaks are actually exercised rather than
    // one week's luck being mistaken for the rule
    let seed = 987;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ROUNDS = 12;
    for (let i = 1; i < ROUNDS && i < GAMEWEEKS.length; i++) {
      const gwN = GAMEWEEKS[i].n; const ps = {};
      for (const pk of state.draft.picks) {
        const pl = PLAYER_BY_ID[pk.playerId];
        const st = rnd() < 0.8; const min = st ? (rnd() < .85 ? 90 : 55) : (rnd() < .6 ? 25 : 0);
        ps[pl.id] = { min, st: st && min ? 1 : 0,
          g: rnd() < ({ FW: .35, MF: .2, DF: .07, GK: .005 }[pl.pos]) ? 1 : 0, a: rnd() < .12 ? 1 : 0,
          cs: pl.pos !== 'FW' && min >= 60 && rnd() < .35 ? 1 : 0,
          rc: rnd() < .02 ? 1 : 0, og: rnd() < .015 ? 1 : 0, pm: rnd() < .01 ? 1 : 0 };
      }
      state.matchStats['gw' + gwN] = { gw: i, label: GAMEWEEKS[i].label, final: true, playerStats: ps };
      GAMEWEEKS[i].finished = true;
      for (const f of state.fixtures) if (f.gw === gwN) f.finished = true;
    }
    const weeks = [];
    for (let i = 0; i < ROUNDS && i < GAMEWEEKS.length; i++) if (gwStatus(i) === 'final' && roundHeldWhole(i)) weeks.push(i);
    t('(setup) a run of settled rounds to judge', weeks.length >= 8, `${weeks.length} rounds`);

    /* ----- the working IS the verdict, not a second opinion ----- */
    (() => {
      let same = 0, checked = 0;
      for (const i of weeks) {
        const w = cotwWorking(i), v = cotwFor(i);
        if (!w || !v) continue;
        checked++;
        if (w.id === v.id && w.why === v.why) same++;
      }
      t('every week, the working names the man the verdict names', same === checked, `${same}/${checked}`);
    })();
    (() => {
      // the charge shown at the top of his sheet must BE the charge he was done
      // for — not merely one of his
      let ok = 0, n = 0;
      for (const i of weeks) {
        const w = cotwWorking(i);
        if (!w || !w.proven) continue;
        n++;
        if (w.mine.length && w.mine[0].why === w.why && w.mine.every(c => c.id === w.id)) ok++;
      }
      t('his sheet is his alone, and opens with the charge he was done for', ok === n, `${ok}/${n}`);
    })();
    (() => {
      const w = cotwWorking(weeks[0]);
      t('"and N other matters" agrees with the sheet length',
        w.also === w.mine.length - 1, `also ${w.also}, sheet ${w.mine.length}`);
    })();

    /* ----- which rule actually decided it ----- */
    (() => {
      const stages = {};
      for (const i of weeks) {
        const w = cotwWorking(i);
        if (w?.proven) stages[w.stage] = (stages[w.stage] || 0) + 1;
      }
      t('every proven week names the rule that decided it',
        Object.values(stages).reduce((a, b) => a + b, 0) === weeks.filter(i => cotwWorking(i)?.proven).length,
        JSON.stringify(stages));
      t('and each named rule has copy to print', Object.keys(stages).every(s => COTW_STAGES[s]),
        Object.keys(stages).join(','));
      /* The control for the whole feature. If the gravest charge settled every
         week there would be nothing to explain — the point is that it does not,
         so if this ever stops being true the working has lost its reason to
         exist and someone should know. */
      t('(control) the top charge does NOT decide most weeks',
        (stages.gravity || 0) < weeks.length, `gravity decided ${stages.gravity || 0} of ${weeks.length}`);
    })();
    (() => {
      // when it went to the last rung, the men who got there must be named —
      // that is the bit that shows a verdict was not about the offence at all
      const late = weeks.map(i => cotwWorking(i)).filter(w => w?.proven && w.stage !== 'gravity');
      t('a week settled by tiebreak names who was level',
        late.length > 0 && late.every(w => w.level.length >= 1 && w.level.includes(w.id)),
        `${late.length} tiebreak weeks`);
    })();

    /* ----- standing charges are marked, because that is the real answer ----- */
    (() => {
      const w = weeks.map(i => cotwWorking(i)).find(x => x?.proven && x.mine.some(c => c.gravity >= COTW_STANDING_FROM));
      t('a sheet carrying permanent charges can be told apart from this week\'s',
        !!w && w.mine.some(c => c.gravity < COTW_STANDING_FROM),
        w ? `${w.mine.filter(c => c.gravity >= COTW_STANDING_FROM).length} standing of ${w.mine.length}` : 'none found');
      t('and the rap sheet counts them separately',
        !!w && w.rap[w.id].standing > 0 && w.rap[w.id].standing <= w.rap[w.id].n);
    })();

    /* ----- the overlay ----- */
    (() => {
      const i = weeks.find(j => cotwWorking(j)?.proven);
      const w = cotwWorking(i);
      showCotwSheet(i);
      const ov = document.querySelector('#cotwOverlay');
      t('the sheet opens', !!ov);
      const txt = ov ? ov.textContent.replace(/\s+/g, ' ') : '';
      t('it names the convicted man', txt.includes(teamName(w.id)));
      t('it prints every charge against him, not a count',
        w.mine.every(c => txt.includes(c.why.slice(0, 40))), `${w.mine.length} charges`);
      t('it says which rule decided it', txt.includes(COTW_STAGES[w.stage].slice(0, 30)));
      t('it explains what a standing charge is',
        !w.mine.some(c => c.gravity >= COTW_STANDING_FROM) || /true again next week/.test(txt));
      // and it must not leak anyone else's charges into his sheet
      const others = cotwCharges(i).filter(c => c.id !== w.id && !w.mine.some(m => m.why === c.why));
      t('it does not print other managers\' charges as his',
        others.every(c => !txt.includes(c.why.slice(0, 40))), `${others.length} foreign charges checked`);
      ov.remove();
    })();

    /* ----- a drawn week has no sheet, and must not pretend to ----- */
    (() => {
      const keep = cotwCharges;
      cotwCharges = () => [];            // a week nobody offended in
      const i = weeks[0];
      const w = cotwWorking(i);
      t('a drawn week is honest about having no sheet',
        w && w.proven === false && w.mine.length === 0);
      showCotwSheet(i);
      const ov = document.querySelector('#cotwOverlay');
      const txt = ov ? ov.textContent : '';
      t('and the overlay says lots were drawn rather than showing an empty table',
        /drew lots/.test(txt) && !ov.querySelector('tbody tr'));
      ov?.remove();
      cotwCharges = keep;
    })();

    return log;
  });

  for (const line of log) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));

  // the table is three columns on a 390px phone and must not drag the page
  const wide = await page.evaluate(() => {
    let i = -1;
    for (let j = 0; j < GAMEWEEKS.length; j++) if (gwStatus(j) === 'final' && roundHeldWhole(j)) { i = j; break; }
    showCotwSheet(i);
    const spills = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    const own = !!document.querySelector('#cotwOverlay div[style*="overflow-x"]');
    document.querySelector('#cotwOverlay')?.remove();
    return { spills, own };
  });
  chk('the charge table scrolls in its own box', wide.own);
  chk('and never drags the page sideways', !wide.spills);
  chk('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[cotw-why] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
