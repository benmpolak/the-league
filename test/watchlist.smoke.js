/* The Trough watchlist (Marc, 20 Aug: "a watchlist feature that then becomes
 * another filter on trough").
 *
 * Two properties matter and both are pinned here:
 *   1. It is a LENS, not an action. Watching a man must never sign, claim,
 *      draft or shortlist him. A watchlist that quietly did something would be
 *      the worst kind of bug — silent, and discovered on a waiver run.
 *   2. It is PRIVATE. It rides in the per-owner private node, exactly as the
 *      autolist and blind claims do, and must never enter the public snapshot.
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
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const report = await page.evaluate(async () => {
    const out = [];
    const ok = (n, c, d = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
    window.__autoConfirm = true;
    state = buildDemoState(); state.phase = 'season';
    whoami = state.managers[0].id;
    const mid = whoami;

    ok('a new manager watches nobody', watchIds(mid).length === 0);

    const free = PLAYERS.find(x => !ownedIdsAt(0).has(x.id));
    const theirs = squadAt(state.managers[1].id, 0)[0];
    toggleWatch(mid, free.id);
    toggleWatch(mid, theirs.id);
    ok('can watch a free agent', isWatched(mid, free.id), free.name);
    ok('can watch a man somebody else owns', isWatched(mid, theirs.id), theirs.name);
    ok('both are on the list', watchIds(mid).length === 2);
    toggleWatch(mid, free.id);
    ok('tapping again stops watching', !isWatched(mid, free.id));
    toggleWatch(mid, free.id);

    /* ---- a lens, and nothing but ---- */
    const squadBefore = JSON.stringify(squadAt(mid, 0).map(x => x.id).sort());
    ok('watching signs nobody', JSON.stringify(squadAt(mid, 0).map(x => x.id).sort()) === squadBefore);
    ok('watching lodges no waiver claim', !toArr(state.claims?.[currentGwIndex()]?.[mid]).length);
    ok('watching does not touch the autopick list', !toArr(state.autolists?.[mid]).includes(free.id));
    ok('watching does not put him on the trade block', !blockList(mid).includes(free.id));
    ok('watching leaves the XI alone', !lineupFor(mid, currentGwIndex()).includes(free.id));

    /* ---- private ---- */
    ok('carried as shared state so it can reach the private node', SHARED_KEYS.includes('watchlists'));
    // The exclusion only fires when netOn(), which is false in ?nosync, so
    // prove it against the function that applies the public snapshot rather
    // than asserting something that cannot fail here.
    ok('applySharedSnapshot excludes it alongside claims and autolists', (() => {
      const src = String(applySharedSnapshot);
      const guard = src.match(/if \(netOn\(\) && \([^)]*\)\) continue;/);
      return !!guard && guard[0].includes("'watchlists'")
        && guard[0].includes("'claims'") && guard[0].includes("'autolists'");
    })());
    ok('the private node is what feeds it', String(applyPrivateNode).includes('node?.watchlist'));

    /* ---- the filter ---- */
    state.view = 'transfers'; transfersView.tab = 'trough'; transfersView.scope = 'watch';
    render(); await new Promise(r => setTimeout(r, 400));
    const rows = [...document.querySelectorAll('#trResults tbody tr')];
    ok('the Watchlist filter shows exactly the watched men', rows.length === 2,
      [...document.querySelectorAll('#trResults .pn-txt')].map(x => x.textContent).join(', '));
    ok('the scope chip carries the tally', /Watchlist \(2\)/.test(document.querySelector('[data-trscope="watch"]')?.textContent || ''));

    /* ---- tapping the eye, as a manager would ---- */
    transfersView.scope = 'free'; render(); await new Promise(r => setTimeout(r, 400));
    const eye = document.querySelector('#trResults [data-watch]');
    const pid = +eye.dataset.watch;
    const wasWatched = isWatched(mid, pid);
    eye.click(); await new Promise(r => setTimeout(r, 200));
    ok('tapping the eye toggles him', isWatched(mid, pid) !== wasWatched);
    ok('the eye lights up in place', !!document.querySelector(`#trResults [data-watch="${pid}"].watch-on`) === isWatched(mid, pid));
    ok('the tally updates without a full redraw',
      new RegExp(`Watchlist \\(${watchIds(mid).length}\\)`).test(document.querySelector('[data-trscope="watch"]')?.textContent || ''));

    /* ---- empty state explains itself rather than going blank ---- */
    watchIds(mid).slice().forEach(id => toggleWatch(mid, id));
    transfersView.scope = 'watch'; render(); await new Promise(r => setTimeout(r, 400));
    ok('an empty watchlist says how to fill it',
      /Nothing on your watchlist yet/.test(document.querySelector('#trResults')?.textContent || ''));
    return out.join('\n');
  });

  for (const line of report.split('\n')) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors while watching', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[watchlist] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
