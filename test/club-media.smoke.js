'use strict';
const assert = require('assert/strict');
const puppeteer = require('puppeteer-core');
const base = process.env.TEST_BASE_URL || 'http://localhost:8125';
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', r => {
      if (r.url().endsWith('/js/sync.js')) return r.respond({ status: 200, contentType: 'application/javascript', body: 'window.WCSync = {};' });
      if (r.url().includes('cloudfunctions.net') || r.url().includes('firebasedatabase.app')) return r.abort();
      r.continue();
    });
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(base + '/?sandbox&demo', { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof ClubMedia !== 'undefined' && state.phase === 'season');
    await page.evaluate(() => {
      window._chDemoSeeded = true;
      demoGwOverride = 2; whoami = state.managers[0].id;
      state.mediaCases = {}; state.pressers = {}; state.posts = [];
      state.pressers[whoami] = { '1:pre': { t: Date.now(), answers: [{ tone: 'confident', text: '<img src=x onerror="window.XSS=1"> We go again.' }] } };
      state.view = 'media'; render();
    });
    assert.equal(await page.$$eval('.club-inbox', xs => xs.length), 1);
    assert.equal(await page.$eval('#clubMediaSend', b => b.disabled), true);
    assert.equal(await page.$eval('.club-letter', e => e.querySelectorAll('img').length), 0);
    await page.click('input[value="ban"]');
    // An incoming snapshot/render must not lose the selected answer.
    await page.evaluate(() => render());
    assert.equal(await page.$eval('input[value="ban"]', e => e.checked), true);
    const before = await page.evaluate(() => JSON.stringify({ draft: state.draft, transfers: state.transfers, lineups: state.lineups, settings: state.settings }));
    await page.click('#clubMediaSend');
    await page.waitForFunction(() => !!state.mediaCases?.[whoami]?.[2]);
    assert.match(await page.$eval('.club-reply', e => e.textContent), /car park/);
    assert.equal(await page.evaluate(() => JSON.stringify({ draft: state.draft, transfers: state.transfers, lineups: state.lineups, settings: state.settings })), before);
    assert.ok(await page.evaluate(() => cunthangerPosts().some(p => p.key.startsWith('clubcase:') && p.text.includes('Ornsteak'))));
    assert.ok(await page.evaluate(() => clubMediaPaper(2).includes('Ornsteak')));
    assert.equal(await page.evaluate(() => !!window.XSS), false);
    await page.evaluate(() => { demoGwOverride = 3; render(); });
    assert.match(await page.$eval('.club-inbox h2', e => e.textContent), /car park/);
    assert.ok(await page.$('.club-correspondence'));
    // A rejected server request retains the choice and enables retry. The
    // stub makes no network write; the page remains a local demo throughout.
    await page.evaluate(() => { window.__mediaAct = serverAct; demoMode = false; serverAct = async () => { throw Error('Test: connection lost'); }; });
    await page.click('input[value="apologise"]');
    await page.click('#clubMediaSend');
    await page.waitForFunction(() => document.querySelector('#clubMediaError')?.textContent.includes('connection lost'));
    assert.equal(await page.$eval('input[value="apologise"]', e => e.checked), true);
    assert.equal(await page.$eval('#clubMediaSend', e => e.disabled), false);
    await page.evaluate(() => { demoMode = true; serverAct = window.__mediaAct; });
    await page.click('#clubMediaSend');
    await page.waitForFunction(() => state.mediaCases?.[whoami]?.[3]?.choice === 'apologise');
    await page.evaluate(() => { demoGwOverride = 4; state.pressers = {}; state.transfers = []; state.matchStats = {}; render(); });
    assert.equal(await page.$('#clubMediaSend'), null);
    assert.ok(await page.$('.club-correspondence'));
    // Both small and full-width layouts must keep the letter and radio
    // controls within the viewport, including user-entered names/quotes.
    for (const width of [320, 390, 1280]) {
      await page.setViewport({ width, height: 900 });
      await page.evaluate(() => { demoGwOverride = 3; delete state.mediaCases[whoami][3]; render(); });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'overflow at ' + width);
    }
    if (process.env.MEDIA_SCREENSHOT) {
      await page.setViewport({ width: 390, height: 844 });
      await page.$eval('.club-inbox', e => e.scrollIntoView());
      await page.screenshot({ path: process.env.MEDIA_SCREENSHOT });
    }
    assert.deepEqual(errors, []);
    console.log('[club-media-browser] passed: response, render survival, next-week follow-up, failed-send retry, feed/paper, XSS, game unchanged, 320/390/1280px');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
