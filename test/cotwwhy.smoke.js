/* Marc's award explanation, 20 Sept; rebased and checked for Ben, 4 Nov 2026.
 * Synthetic evidence only. Compare against the pre-change verdict, exercise
 * each deciding rule, then use the real card/dialog with keyboard and history.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';
let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  try {
    const page = await browser.newPage();
    const pageErrors = [], externalRequests = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = new URL(req.url());
      if (u.pathname.endsWith('/js/sync.js')) return req.abort();
      if (u.origin === new URL(baseUrl).origin || ['data:', 'blob:'].includes(u.protocol)) return req.continue();
      externalRequests.push(req.url());
      return req.abort();
    });
    await page.evaluateOnNewDocument(() => {
      // No worker can make an out-of-band fetch outside interception.
      if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('Disabled in synthetic test'));
    });
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(baseUrl + '/?sandbox&nosync', { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => typeof cotwWorking === 'function' && state.managers.length === 12);
    const checks = await page.evaluate(() => {
      const log = [];
      const test = (name, ok, detail = '') => log.push({ name, ok, detail });
      state = buildDemoState();
      state.fixtures = [];
      // Frozen compatibility oracle: the verdict algorithm before this change.
      function originalVerdict(i) {
        if (!state.managers.length || !roundHeldWhole(i)) return null;
        const sheet = cotwCharges(i);
        if (sheet.length) {
          const rap = {};
          for (const c of sheet) {
            const r = rap[c.id] = rap[c.id] || { n: 0, w: 0 };
            r.n++; r.w += c.weight;
          }
          sheet.sort((a, b) => a.gravity - b.gravity || b.weight - a.weight
            || rap[b.id].n - rap[a.id].n || rap[b.id].w - rap[a.id].w || a.id - b.id);
          const top = sheet[0];
          return { id: top.id, why: top.why, proven: true, also: rap[top.id].n - 1 };
        }
        const seed = (i * 2246822519 + 3266489917) >>> 0;
        const m = state.managers[seed % state.managers.length];
        return m ? { id: m.id, why: COTW_DRAWS[(seed >>> 8) % COTW_DRAWS.length], proven: false } : null;
      }
      test('unchanged verdict on the demo’s real charge sheet', JSON.stringify(cotwFor(0)) === JSON.stringify(originalVerdict(0)));
      const realCharges = cotwCharges, realWhole = roundHeldWhole;
      window.__cotwSheet = [];
      cotwCharges = () => window.__cotwSheet.map(c => ({ ...c }));
      const charge = (id, gravity, weight = 1, why = `charge ${gravity} against ${id}`) => ({ id, gravity, weight, why });
      const cases = [
        ['gravity', [charge(2, 2), charge(1, 3)], 2, []],
        ['weight', [charge(1, 2, 1), charge(2, 2, 2)], 2, [1, 2]],
        ['rapCount', [charge(1, 2), charge(2, 2), charge(2, 20)], 2, [1, 2]],
        ['rapWeight', [charge(1, 2), charge(1, 20, 2), charge(2, 2), charge(2, 20, 6)], 2, [1, 2]],
        ['managerId', [charge(2, 2), charge(1, 2)], 1, [1, 2]],
      ];
      state.managers.reverse(); // final tie uses fixed IDs, not current display order
      for (const [stage, sheet, winner, level] of cases) {
        window.__cotwSheet = sheet;
        const w = cotwWorking(0);
        test(`${stage}: correct unchanged winner and deciding rule`, w.id === winner && w.stage === stage
          && JSON.stringify(cotwFor(0)) === JSON.stringify(originalVerdict(0)));
        test(`${stage}: retains the contenders before the deciding rule`, JSON.stringify([...w.level].sort()) === JSON.stringify(level));
      }
      window.__cotwSheet = [charge(2, 2), charge(2, 2), charge(1, 3)];
      test('multiple leading charges for one manager need no tiebreak', cotwWorking(0).stage === 'gravity');
      window.__cotwSheet = [charge(2, 2), charge(2, 17), charge(2, 28), charge(1, 3)];
      const standing = cotwWorking(0);
      test('winner’s sheet includes every charge and counts standing charges', standing.mine.length === 3
        && standing.mine.every(c => c.id === 2) && standing.rap[2].standing === 2 && standing.also === 2);

      let seed = 8741, same = 0;
      const rnd = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
      for (let k = 0; k < 160; k++) {
        window.__cotwSheet = Array.from({ length: rnd(48) }, (_, j) => charge(1 + rnd(12), 1 + rnd(28), 1 + rnd(12), `case ${k} charge ${j}`));
        if (JSON.stringify(cotwFor(k % 12)) === JSON.stringify(originalVerdict(k % 12))) same++;
      }
      test('160 varied synthetic sheets preserve the complete original verdict', same === 160, `${same}/160`);
      window.__cotwSheet = [];
      test('empty sheet preserves the seeded draw without inventing charges', JSON.stringify(cotwFor(3)) === JSON.stringify(originalVerdict(3))
        && !cotwWorking(3).proven && cotwWorking(3).mine.length === 0);
      roundHeldWhole = () => false;
      test('incomplete round offers neither verdict nor explanation', cotwFor(0) === null && cotwWorking(0) === null);
      roundHeldWhole = realWhole;
      const managers = state.managers;
      state.managers = [];
      test('empty manager list remains safe', cotwWorking(0) === null && cotwFor(0) === null);
      state.managers = managers;

      // The actual card and binding, with a hostile name/reason and long sheet.
      state = buildDemoState(); state.fixtures = [];
      window.__cotwHostile = '<img src=x onerror="window.__cotwXss=1">';
      state.managers.find(m => m.id === 1).team = window.__cotwHostile;
      state.managers.find(m => m.id === 2).team = '<b>Rival & club</b>';
      window.__cotwSheet = [charge(1, 2, 2, window.__cotwHostile), charge(2, 2, 1, 'Rival-only charge'),
        ...Array.from({ length: 27 }, (_, j) => charge(1, 17 + j % 12, 1,
          j === 0 ? 'Unbroken'.repeat(30) : `Standing charge ${j} with enough text to fill a phone screen.`))];
      lastFinalGw = () => 0;
      document.querySelector('#main').innerHTML = awardsCard();
      bindAwardsBits();
      window.__cotwRealCharges = realCharges;
      return log;
    });
    for (const c of checks) chk(c.name, c.ok, c.detail);
    const open = async () => {
      await page.focus('#cotwWhy');
      await page.click('#cotwWhy');
      await page.waitForSelector('#cotwOverlay [role="dialog"]');
    };
    const settledClosed = async () => {
      await page.waitForFunction(() => !document.querySelector('#cotwOverlay') && !ovSkipClose);
      return page.evaluate(() => document.activeElement?.id === 'cotwWhy');
    };
    await open();
    chk('card opens a named modal with a labelled close control and initial focus', await page.evaluate(() => {
      const dialog = document.querySelector('#cotwOverlay [role="dialog"]');
      return dialog?.getAttribute('aria-modal') === 'true' && dialog.getAttribute('aria-labelledby') === 'cotwTitle'
        && document.querySelector('#cotwClose')?.getAttribute('aria-label') === 'Close award explanation'
        && document.activeElement?.id === 'cotwClose';
    }));
    chk('names and charges are escaped; rival charges stay off the winner’s sheet', await page.evaluate(() => {
      const ov = document.querySelector('#cotwOverlay');
      return !window.__cotwXss && !ov.querySelector('img, b') && ov.textContent.includes(window.__cotwHostile)
        && ov.textContent.includes('<b>Rival & club</b>') && !ov.textContent.includes('Rival-only charge')
        && ov.querySelectorAll('tbody tr').length === 28;
    }));
    chk('explains rank, weight and recurring circumstances without claiming permanence', await page.evaluate(() => {
      const txt = document.querySelector('#cotwOverlay').textContent;
      return /Lower rank/.test(txt) && /greater weight wins/.test(txt) && /while unchanged/.test(txt) && !/whatever he does/.test(txt);
    }));
    chk('reopening cannot add a duplicate dialog or history entry', await page.evaluate(() => {
      const before = history.length, depth = ovDepth;
      showCotwSheet(0);
      return history.length === before && ovDepth === depth && document.querySelectorAll('#cotwOverlay').length === 1;
    }));
    await page.keyboard.press('Tab');
    chk('Tab reaches the scrollable charge sheet', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Full charge sheet'));
    await page.keyboard.press('Tab');
    chk('Tab wraps to the close button', await page.evaluate(() => document.activeElement?.id === 'cotwClose'));
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    chk('Shift-Tab wraps within the dialog', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Full charge sheet'));
    await page.setViewport({ width: 320, height: 568 });
    const narrow = await page.evaluate(() => {
      const ov = document.querySelector('#cotwOverlay'), card = ov.querySelector('[role="dialog"]');
      const region = ov.querySelector('[role="region"]'), rect = card.getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight,
        documentWidth: document.documentElement.scrollWidth, regionHeight: region.clientHeight, regionContent: region.scrollHeight };
    });
    chk('long sheet fits a 320px phone and scrolls within its own region', narrow.left >= 0 && narrow.right <= narrow.width + 1
      && narrow.bottom <= narrow.height + 1 && narrow.documentWidth <= narrow.width + 1
      && narrow.regionContent > narrow.regionHeight, JSON.stringify(narrow));
    await page.keyboard.press('Escape');
    chk('Escape closes and restores focus', await settledClosed());
    await open(); await page.click('#cotwClose');
    chk('close button closes and restores focus', await settledClosed());
    await open(); await page.evaluate(() => document.querySelector('#cotwOverlay').click());
    chk('backdrop closes and restores focus', await settledClosed());
    await open(); await page.evaluate(() => history.back());
    chk('browser Back closes and restores focus', await settledClosed());
    if (process.env.TEST_SCREENSHOT_DIR) {
      await page.evaluate(() => {
        state.managers.find(m => m.id === 1).team = 'Test United';
        state.managers.find(m => m.id === 2).team = 'Demo Rovers';
        window.__cotwSheet = [
          { id: 1, gravity: 11, weight: 60, why: 'for conducting business 1 minute before the deadline, as is traditional' },
          { id: 2, gravity: 11, weight: 55, why: 'for conducting business 6 minutes before the deadline, as is traditional' },
          { id: 1, gravity: 20, weight: 5, why: 'for carrying 5 Arsenal players, which is permitted, and remains the problem' },
          { id: 1, gravity: 25, weight: 1, why: 'for arriving at the draft without an autopick list, and expecting sympathy' },
        ];
        document.querySelector('#main').innerHTML = awardsCard();
        bindAwardsBits();
      });
      await open();
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({ path: require('path').join(process.env.TEST_SCREENSHOT_DIR, 'league-awards-mobile-20261104.png') });
      await page.setViewport({ width: 1280, height: 900 });
      await page.screenshot({ path: require('path').join(process.env.TEST_SCREENSHOT_DIR, 'league-awards-desktop-20261104.png') });
      await page.keyboard.press('Escape'); await settledClosed();
    }
    await page.evaluate(() => { window.__cotwSheet = []; });
    await open();
    chk('drawn award shows an honest explanation without an empty charge table', await page.evaluate(() => {
      const ov = document.querySelector('#cotwOverlay');
      return /drew lots/.test(ov.textContent) && !ov.querySelector('table');
    }));
    await page.keyboard.press('Tab');
    chk('drawn award’s single control retains keyboard focus', await page.evaluate(() => document.activeElement?.id === 'cotwClose'));
    await page.keyboard.press('Escape'); await settledClosed();
    chk('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
    chk('no live Firebase loaded', await page.evaluate(() => !performance.getEntriesByType('resource').some(e => /firebasejs|firebasedatabase|cloudfunctions/.test(e.name))));
    console.log(`External requests blocked: ${externalRequests.length}`);
    console.log(`\n[cotw-why] ${pass} passed, ${fail} failed`);
    process.exitCode = fail ? 1 : 0;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
