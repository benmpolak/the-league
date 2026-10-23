// Quiet media. Ben, 13 Oct 2026: "Cunthanger media is a bit overwhelming".
// One media line on the dashboard instead of a stack, a Media tab that puts
// your own press room first and the feed forty at a time, and a per-device
// switch that quietens the dashboard and the takeover alert. Local demo only:
// sync.js is stubbed and every Firebase request is refused.
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
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof Cunthanger !== 'undefined' && state.phase === 'season');
    // a busy week: two press conferences open, a Club Inbox letter, a new
    // paper, a post aimed at you and a live feed
    const scene = () => page.evaluate(() => {
      window._chDemoSeeded = true;
      demoGwOverride = 6; whoami = state.managers[0].id; state.view = 'dash';
      /* Two press conferences open means one BEFORE a round and one AFTER the
         last finished one — and whether a round has kicked off is read off the
         real clock, not demoGwOverride. Pinned to the calendar, this passed
         until GW8's deadline went by on 23 Oct 2026 and then failed for good:
         both candidate rounds counted as started, so only the post-match one
         was open. Hold the next round in the future and the scene means the
         same thing whatever day it is run. */
      const soon = new Date(Date.now() + 3 * 864e5).toISOString();
      GAMEWEEKS[7].from = soon; GAMEWEEKS[7].deadline = soon;
      GAMEWEEKS[7].to = new Date(Date.now() + 10 * 864e5).toISOString();
      GAMEWEEKS[7].finished = false;
      const me = whoami;
      state.mediaCases = {};
      state.posts = [{ mid: state.managers[3].id, to: me, text: 'A charity with a kit deal.', t: Date.now() - 3600e3, gw: 6 }];
      state.pressers = { [me]: { '5:pre': { t: Date.now() - 4 * 864e5, answers: [{ tone: 'confident', text: 'We go again.' }] } } };
      localStorage.removeItem(GZ_SEEN_KEY);
      anyMatchLive = () => true;
      render();
    });
    await page.evaluate(() => setQuietMedia(false));
    await scene();
    const dash = await page.evaluate(() => ({
      nudges: [...document.querySelectorAll('.dash-attention .gz-nudge')].map(b => b.id),
      copy: document.querySelector('#gzNudge')?.textContent.replace(/\s+/g, ' ') || '',
      stale: /PRESS ROOM|SAID ABOUT YOU|CLUB INBOX/.test(document.querySelector('.dash-attention').textContent),
      feedTile: !!document.querySelector('.prog-card .ch-tile-feed'),
    }));
    assert.deepEqual(dash.nudges, ['gzNudge'], 'one media line, led by the new paper: ' + JSON.stringify(dash.nudges));
    assert.match(dash.copy, /Also in Media: two press conferences, the Club Inbox, a remark from Adam and the live feed\./);
    assert.equal(dash.stale, false, 'the old stacked nudges are gone');
    assert.equal(dash.feedTile, true, 'the feed tile stays on the dashboard by default');
    // the paper leads and opens; afterwards the line points at the Media tab
    await page.click('#gzNudge');
    assert.ok(await page.$('.gazette-room'), 'the line opens the paper while it is unread');
    await page.evaluate(() => { document.querySelectorAll('.overlay').forEach(o => o.remove()); render(); });
    assert.equal(await page.$('#gzNudge'), null);
    assert.match(await page.$eval('#mediaNudge', b => b.textContent), /Waiting in Media: two press conferences/);
    await page.click('#mediaNudge');
    const media = await page.evaluate(() => ({
      view: state.view,
      order: [...document.querySelectorAll('#main .ch-tile-press, #main .club-inbox, #main .ch-room-inline')].map(e => e.className.split(' ').find(c => /ch-tile-press|club-inbox|ch-room-inline/.test(c))),
      historyShut: document.querySelector('#chPcHistory')?.open === false,
      posts: document.querySelectorAll('.ch-room-inline .ch-post').length,
      total: cunthangerPosts().length,
    }));
    assert.equal(media.view, 'media');
    assert.deepEqual(media.order, ['ch-tile-press', 'club-inbox', 'ch-room-inline'], 'your press room, then the Club Inbox, then the feed');
    assert.equal(media.historyShut, true, 'every press conference is folded away by default');
    assert.equal(media.posts, Math.min(40, media.total), 'the feed opens at forty');
    if (media.total > 40) {
      await page.$eval('#chMore', b => b.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await page.click('#chMore');
      assert.equal(await page.$$eval('.ch-room-inline .ch-post', xs => xs.length), Math.min(80, media.total), 'show more adds forty');
    }
    await page.evaluate(() => { const d = document.querySelector('#chPcHistory'); d.open = true; d.dispatchEvent(new Event('toggle')); render(); });
    assert.equal(await page.$eval('#chPcHistory', d => d.open), true, 'an opened history survives a render');
    // the switch, in Settings, this device only
    await page.evaluate(() => { state.view = 'settings'; render(); });
    assert.equal(await page.$eval('#quietMediaToggle', i => i.checked), false);
    await page.click('#quietMediaToggle');
    assert.equal(await page.evaluate(() => localStorage.getItem(`${LS_NS}-quiet-media`)), '1');
    await scene();
    const quiet = await page.evaluate(() => ({
      nudges: document.querySelectorAll('.dash-attention .gz-nudge').length,
      feedTile: !!document.querySelector('.prog-card .ch-tile-feed'),
      paperTile: !!document.querySelector('.prog-card .ch-tile-paper'),
    }));
    assert.deepEqual(quiet, { nudges: 0, feedTile: false, paperTile: true }, 'quiet: no media line, no feed, the paper stays');
    // the takeover needs a live league; demo off for one call, sync stubbed
    const alert = await page.evaluate(() => {
      document.querySelectorAll('.overlay').forEach(o => o.remove());
      localStorage.removeItem(`${LS_NS}-ch-takeover`); window._chAlertShown = false;
      const auto = window.__autoConfirm; window.__autoConfirm = false; demoMode = false;
      const mute = localStorage.getItem('tl2627-mute'); localStorage.setItem('tl2627-mute', '1');
      cunthangerTakeover();
      const whenQuiet = !!document.querySelector('.ch-alert-ov');
      setQuietMedia(false);
      cunthangerTakeover();
      const whenLoud = !!document.querySelector('.ch-alert-ov');
      document.querySelectorAll('.overlay').forEach(o => o.remove());
      demoMode = true; window.__autoConfirm = auto;
      if (mute == null) localStorage.removeItem('tl2627-mute'); else localStorage.setItem('tl2627-mute', mute);
      return { whenQuiet, whenLoud };
    });
    assert.deepEqual(alert, { whenQuiet: false, whenLoud: true }, 'quiet media holds back the takeover alert');
    await page.evaluate(() => { setQuietMedia(true); state.view = 'media'; render(); });
    assert.ok(await page.$('.ch-room-inline .ch-post'), 'the Media tab carries on under quiet media');
    for (const width of [320, 1280]) {
      await page.setViewport({ width, height: 900 });
      await page.evaluate(() => { setQuietMedia(false); state.view = 'dash'; render(); });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'overflow at ' + width);
    }
    assert.deepEqual(errors, []);
    console.log('[quiet-media] passed: one media line, paper first, Media tab order, feed of forty with show more, folded history, quiet switch, takeover held back, 320/1280px');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
