/* Ben, 23 Sept 2026: publication boundary, incomplete interview, archive and
 * escaping. Synthetic copy/state only; browser blocks every external request.
 * node test/gazette-break.test.js [--browser] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const start = Date.parse('2026-09-25T11:00:00Z');
const returnDate = Date.parse('2026-10-10T10:00:00Z');
const specimen = () => ({
  id: 'international-break-2026-09', publishAt: new Date(start).toISOString(), ready: true,
  edition: 'international-break special', headline: 'Synthetic headline', standfirst: 'Synthetic standfirst',
  articles: [{ id: 'ian', head: 'Synthetic headline', by: 'Test correspondent', intro: ['Synthetic introduction'],
    sections: [{ head: 'The interview', qa: [['Synthetic question?', 'A supplied synthetic answer.']] }] },
  { id: 'panel', head: 'Panel', sections: [{ answers: [{ by: 'Test writer', text: 'Synthetic opinion.' }] }] }]
});
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const context = vm.createContext({ GAZETTE_BREAK_CONTENT: specimen(), GAMEWEEKS: [
  { from: '2026-09-18T17:30:00Z' }, { from: new Date(returnDate).toISOString() }
], esc: escapeHtml });
vm.runInContext(fs.readFileSync(path.join(root, 'js/gazette-break.js'), 'utf8') + '\nthis.subject = GazetteBreak;', context);
const subject = context.subject;
assert.equal(subject.published(start - 1), false);
assert.equal(subject.archive(start - 1), null);
assert.equal(subject.live(start), true);
assert.equal(subject.archive(start).key, specimen().id);
assert.equal(subject.live(returnDate - 1), true);
assert.equal(subject.live(returnDate), false);
assert.equal(subject.archive(returnDate).key, specimen().id);
context.GAZETTE_BREAK_CONTENT.ready = false;
assert.equal(subject.archive(start), null);
assert.match(subject.render(), /Synthetic headline/);
context.GAZETTE_BREAK_CONTENT.ready = true;
context.GAZETTE_BREAK_CONTENT.articles[0].sections[0].qa = [];
assert.equal(subject.publicationReady(), false);
context.GAZETTE_BREAK_CONTENT.articles[0].sections[0].qa = [['Question', '   ']];
assert.equal(subject.publicationReady(), false);
context.GAZETTE_BREAK_CONTENT = specimen();
context.GAZETTE_BREAK_CONTENT.expectedAnswers = 12;
assert.equal(subject.publicationReady(), false);
context.GAZETTE_BREAK_CONTENT = specimen();
context.GAZETTE_BREAK_CONTENT.publishAt = 'invalid';
assert.equal(subject.publicationReady(), false);
context.GAZETTE_BREAK_CONTENT = specimen();
context.GAMEWEEKS = [];
assert.equal(subject.live(start), false);
context.GAZETTE_BREAK_CONTENT.articles[0].intro = ['<img src=x onerror="alert(1)"> & friends'];
assert.ok(!subject.render().includes('<img'));
assert.match(subject.render(), /&lt;img/);
console.log('PASS Gazette break publication, archive, incomplete-copy and escaping gates');

async function browserChecks() {
  const http = require('node:http');
  const puppeteer = require('puppeteer-core');
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/js/gazette-break-content.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(`const GAZETTE_BREAK_CONTENT = ${JSON.stringify(specimen())};`);
    }
    const file = path.resolve(root, '.' + (urlPath === '/' ? '/index.html' : urlPath));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (error, body) => {
      if (error) { res.writeHead(404); return res.end(); }
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
      res.end(body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const chrome = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(candidate => fs.existsSync(candidate));
    if (!chrome) throw new Error('Chrome was not found; set CHROME_BIN to run the browser checks.');
    browser = await puppeteer.launch({ executablePath: chrome, headless: true });
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith(origin + '/') ? request.continue() : request.abort());
    await page.goto(origin + '/?sandbox&nosync', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => typeof GazetteBreak !== 'undefined');
    const result = await page.evaluate(({ start, returnDate }) => {
      // Fresh browser profile, isolated sandbox namespace, no save or network.
      state = freshState();
      const originalNow = Date.now;
      const results = {};
      try {
        Date.now = () => start - 1;
        results.before = progTodays()?.edition !== 'international-break special' && !gazetteEditions().some(e => e.kind === 'break');
        Date.now = () => start;
        results.atBoundary = progTodays()?.edition === 'international-break special';
        gazetteSheet();
        results.rendered = document.querySelector('.gazette-room .prog-head')?.textContent === 'Synthetic headline';
        results.singleColumn = getComputedStyle(document.querySelector('.prog-break')).columnCount === 'auto';
        GAZETTE_BREAK_CONTENT.ready = false;
        results.incomplete = progTodays()?.edition !== 'international-break special' && !gazetteEditions().some(e => e.kind === 'break');
        GAZETTE_BREAK_CONTENT.ready = true;
        const qa = GAZETTE_BREAK_CONTENT.articles[0].sections[0].qa;
        GAZETTE_BREAK_CONTENT.articles[0].sections[0].qa = [];
        results.noAnswers = !GazetteBreak.publicationReady() && !gazetteEditions().some(e => e.kind === 'break');
        GAZETTE_BREAK_CONTENT.articles[0].sections[0].qa = qa;
        Date.now = () => returnDate;
        results.after = progTodays()?.edition !== 'international-break special' && gazetteEditions().some(e => e.kind === 'break');
        gazetteSheet('international-break-2026-09');
        results.archive = document.querySelector('.gazette-room .prog-date')?.textContent.includes('from the archive') && document.querySelector('[data-progw="international-break-2026-09"]')?.disabled;
        document.querySelector('[data-progw="today"]')?.click();
        results.back = !document.querySelector('.gazette-room .prog-date')?.textContent.includes('from the archive') && document.querySelectorAll('.gazette-room').length === 1;
        GAZETTE_BREAK_CONTENT.articles[0].head = '<img src=x onerror="window.injected=true">';
        const holder = document.createElement('div');
        holder.innerHTML = GazetteBreak.render();
        results.escaping = !holder.querySelector('img') && holder.querySelector('.prog-head').textContent.startsWith('<img');
      } finally { Date.now = originalNow; }
      return results;
    }, { start, returnDate });
    for (const [name, passed] of Object.entries(result)) assert.equal(passed, true, name);
    console.log('PASS Gazette break browser routing, archive open/back, layout and escaping', Object.keys(result).length);
    const beforeContents = await page.evaluate(start => {
      const originalNow = Date.now;
      try { Date.now = () => start; gazetteSheet(); }
      finally { Date.now = originalNow; }
      // Guarantee that the target needs a scroll, without loading real copy.
      document.querySelector('[data-break-article="ian"]').style.minHeight = '1400px';
      return { hash: location.hash, entries: history.length };
    }, start);
    await page.click('.prog-break-nav a[href="#gazette-break-panel"]');
    const contents = await page.evaluate(() => {
      const room = document.querySelector('.gazette-room');
      const target = document.getElementById('gazette-break-panel');
      return { open: !!room, scrolled: !!room && room.scrollTop > 100,
        targetVisible: !!room && !!target && target.getBoundingClientRect().top >= room.getBoundingClientRect().top && target.getBoundingClientRect().top < room.getBoundingClientRect().bottom - 80,
        hash: location.hash, entries: history.length };
    });
    assert.equal(contents.open, true, 'contents click keeps reading room open');
    assert.equal(contents.scrolled, true, 'contents click scrolls the reading room');
    assert.equal(contents.targetVisible, true, 'contents target is visible in the reading room');
    assert.equal(contents.hash, beforeContents.hash, 'contents click preserves app route');
    assert.equal(contents.entries, beforeContents.entries, 'contents click does not add overlay history');
    console.log('PASS real contents click scrolls within the paper without closing it or changing app history');
    await page.reload({ waitUntil: 'networkidle0' });
    const identities = await page.evaluate(start => {
      window.gzTestRealNow = Date.now;
      window.gzTestClock = start - 1;
      Date.now = () => window.gzTestClock;
      state = buildDemoState(); // synthetic local squads and scores; no cloud state
      demoMode = true; demoGwOverride = 0; state.view = 'dash';
      const checks = state.managers.map(manager => {
        whoami = manager.id;
        window.gzTestClock = start - 1;
        markGazetteRead(); render();
        gazetteNoticeEdition = gazetteEditionId();
        const before = !gazetteUnread() && !document.querySelector('#gzNudge') && gazetteEditionId() !== GAZETTE_BREAK_CONTENT.id;
        window.gzTestClock = start;
        refreshGazetteReleaseNotice();
        return { id: manager.id, before, after: gazetteUnread() && gazetteEditionId() === GAZETTE_BREAK_CONTENT.id &&
          !!document.querySelector('#nav [data-view="dash"] .nav-dot') && document.querySelector('#gzNudge')?.textContent.includes('Synthetic headline') };
      });
      return checks;
    }, start);
    assert.equal(identities.length, 12);
    assert.ok(identities.every(manager => manager.before && manager.after), JSON.stringify(identities));
    console.log('PASS all 12 synthetic manager identities receive the special unread notice only after release');
    await page.evaluate(start => {
      document.querySelectorAll('.overlay').forEach(node => node.remove());
      window.gzTestClock = start - 50;
      markGazetteRead(); render();
      gazetteNoticeEdition = gazetteEditionId();
      const input = document.createElement('input');
      input.id = 'gazetteTypingProbe'; input.value = 'Unsent manager note';
      document.querySelector('#main').appendChild(input); input.focus();
      const overlay = document.createElement('div'); overlay.className = 'overlay'; overlay.id = 'gazetteOverlayProbe';
      document.body.appendChild(overlay);
      window.gzTestInput = input; window.gzTestOverlay = overlay;
      scheduleGazetteReleaseNotice();
      window.gzTestClock = start; // the real scheduled timeout now crosses the fake clock boundary
    }, start);
    await page.waitForFunction(() => gazetteNoticeEdition === GAZETTE_BREAK_CONTENT.id && !!document.querySelector('#gzNudge'));
    const activated = await page.evaluate(() => ({
      notice: document.querySelector('#gzNudge')?.textContent.includes('Synthetic headline'),
      input: document.getElementById('gazetteTypingProbe') === window.gzTestInput && window.gzTestInput.value === 'Unsent manager note' && document.activeElement === window.gzTestInput,
      overlay: document.getElementById('gazetteOverlayProbe') === window.gzTestOverlay,
      timerFinished: gazetteReleaseTimer === null
    }));
    assert.ok(Object.values(activated).every(Boolean), JSON.stringify(activated));
    await page.evaluate(() => document.getElementById('gazetteOverlayProbe').remove());
    await page.click('#gzNudge');
    const read = await page.evaluate(() => {
      refreshGazetteReleaseNotice(); scheduleGazetteReleaseNotice();
      document.dispatchEvent(new Event('visibilitychange'));
      return { seen: localStorage.getItem(GZ_SEEN_KEY) === GAZETTE_BREAK_CONTENT.id,
        paper: document.querySelector('.gazette-room .prog-head')?.textContent === 'Synthetic headline',
        quiet: !gazetteUnread() && !document.querySelector('#gzNudge') && !document.querySelector('#nav [data-view="dash"] .nav-dot'),
        noTimer: gazetteReleaseTimer === null };
    });
    assert.ok(Object.values(read).every(Boolean), JSON.stringify(read));
    console.log('PASS scheduled release updates an open page without disturbing typing/overlays; click opens and marks read without repeat alerts');
    const returned = await page.evaluate(start => {
      document.querySelectorAll('.overlay').forEach(node => node.remove());
      window.gzTestClock = start - 1;
      markGazetteRead(); render(); gazetteNoticeEdition = gazetteEditionId();
      window.gzTestHidden = true;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.gzTestHidden });
      window.gzTestClock = start;
      refreshGazetteReleaseNotice();
      const deferred = gazetteNoticeEdition !== GAZETTE_BREAK_CONTENT.id && !document.querySelector('#gzNudge');
      window.gzTestHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      const notified = gazetteNoticeEdition === GAZETTE_BREAK_CONTENT.id && !!document.querySelector('#gzNudge') && gazetteUnread();
      delete document.hidden;
      Date.now = window.gzTestRealNow;
      clearTimeout(gazetteReleaseTimer);
      return { deferred, notified };
    }, start);
    assert.ok(returned.deferred && returned.notified, JSON.stringify(returned));
    console.log('PASS backgrounded page receives the release notice on visibility return');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
if (process.argv.includes('--browser')) browserChecks().catch(error => { console.error(error); process.exitCode = 1; });
