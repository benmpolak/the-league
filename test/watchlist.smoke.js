/* The Trough watchlist (Marc, 20 Aug) is a private lens, never an action.
 * Lee, 19 Oct 2026: taken players must leave the scouting list. The visible
 * list/count now follow landing-gameweek ownership, with Owned and Unowned
 * views (Ben, 19 Oct). Preferences survive both views and releases. All
 * ownership and sync here are synthetic.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';
const origin = new URL(baseUrl).origin;

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
};
const report = rows => rows.forEach(({ name, ok, detail }) => chk(name, ok, detail));

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const pageErrors = [];
  const contexts = [];
  // A fresh context isolates localStorage. Bypass the worker as well: it can
  // otherwise fetch sync.js beyond request interception (authui, 15 Oct).
  const localPage = async suffix => {
    const context = await browser.createBrowserContext();
    contexts.push(context);
    const page = await context.newPage();
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = new URL(req.url());
      if (url.pathname === '/js/sync.js' || (url.protocol !== 'data:' && url.origin !== origin)) req.abort();
      else req.continue();
    });
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(baseUrl + suffix, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);
    return page;
  };
  try {
    const page = await localPage('?sandbox&nosync');
    report(await page.evaluate(async () => {
      const out = [];
      const ok = (name, condition, detail = '') => out.push({ name, ok: !!condition, detail });
      const rows = () => [...document.querySelectorAll('#trResults tbody [data-watch]')].map(el => +el.dataset.watch);
      const tally = () => document.querySelector('[data-trscope="watch"]')?.textContent.trim() || '';
      window.__autoConfirm = true;
      state = buildDemoState(); state.phase = 'season'; state.transfers = [];
      demoGwOverride = 0;
      GAMEWEEKS[0].from = new Date(Date.now() - 60000).toISOString();
      whoami = state.managers[0].id;
      const mid = whoami, other = state.managers[1].id;
      const owned = ownedIdsAt(transferGw());
      const theirs = squadAt(other, transferGw())[0];
      const own = squadAt(mid, transferGw())[0];
      const free = PLAYERS.find(p => p.pos === theirs.pos && !owned.has(p.id) && !hasLeft(p));
      const before = JSON.stringify({ picks: state.draft.picks, transfers: state.transfers, claims: state.claims, autolists: state.autolists, lineups: state.lineups, block: state.tradeBlock });

      ok('a new manager watches nobody', watchIds(mid).length === 0);
      toggleWatch(mid, free.id); toggleWatch(mid, theirs.id); toggleWatch(mid, own.id);
      ok('can save a free-agent preference', isWatched(mid, free.id), free.name);
      ok('existing owned preferences are preserved', isWatched(mid, theirs.id) && isWatched(mid, own.id));
      ok('raw private list retains all three preferences', watchIds(mid).length === 3);
      toggleWatch(mid, free.id);
      ok('tapping again stops watching', !isWatched(mid, free.id));
      toggleWatch(mid, free.id);
      ok('watching does not sign, claim, draft, shortlist, list or change an XI',
        JSON.stringify({ picks: state.draft.picks, transfers: state.transfers, claims: state.claims, autolists: state.autolists, lineups: state.lineups, block: state.tradeBlock }) === before);
      ok('only the unowned target is available', JSON.stringify(availableWatchIds(mid)) === JSON.stringify([free.id]));

      state.view = 'transfers'; transfersView.tab = 'trough'; transfersView.scope = 'watch';
      transfersView.owner = null; transfersView.q = ''; transfersView.pos = []; transfersView.club = '';
      render();
      ok('legacy own and opponent-owned entries disappear from Watchlist', JSON.stringify(rows()) === JSON.stringify([free.id]));
      ok('the Watchlist tally counts only available targets', /Watchlist \(1\)$/.test(tally()), tally());
      ok('Available is not selected alongside Watchlist', document.querySelector('[data-trscope="avail"]')?.classList.contains('ghost'));
      ok('Watchlist defaults to Unowned', transfersView.watchScope === 'unowned' && document.querySelector('[data-watchscope="unowned"]')?.getAttribute('aria-pressed') === 'true');
      ok('both ownership controls show their counts', document.querySelector('[data-watchscope="unowned"]')?.textContent.trim() === 'Unowned (1)' && document.querySelector('[data-watchscope="owned"]')?.textContent.trim() === 'Owned (2)');
      const preferences = JSON.stringify(watchIds(mid));
      document.querySelector('[data-watchscope="owned"]').click();
      ok('Owned shows both own and opponent-owned watched players', JSON.stringify(rows().sort((a, b) => a - b)) === JSON.stringify([own.id, theirs.id].sort((a, b) => a - b)));
      ok('Owned changes the top tally and active control', /Watchlist \(2\)$/.test(tally()) && document.querySelector('[data-watchscope="owned"]')?.getAttribute('aria-pressed') === 'true');
      document.querySelector('[data-watchscope="unowned"]').click();
      ok('toggle returns to only the unowned target', JSON.stringify(rows()) === JSON.stringify([free.id]) && /Watchlist \(1\)$/.test(tally()));
      ok('ownership toggles leave all saved preferences intact', JSON.stringify(watchIds(mid)) === preferences);

      // The owner selector must not turn Watchlist into another club's squad.
      transfersView.scope = 'all'; transfersView.owner = other; render();
      ok('owner-filter precondition has a full squad', rows().length === squadAt(other, transferGw()).length);
      document.querySelector('[data-trscope="watch"]').click();
      ok('choosing Watchlist clears the old owner filter', transfersView.owner === null);
      ok('choosing Watchlist shows watched available targets only', JSON.stringify(rows()) === JSON.stringify([free.id]));

      // A settled next-GW signing is already unavailable now, even though the
      // current GW still belongs to the outgoing player.
      const landing = transferGw();
      ok('test signing lands after the current gameweek', landing > currentGwIndex());
      state.transfers.push({ managerId: other, inId: free.id, outId: theirs.id, gw: landing, n: 1, t: Date.now() });
      render();
      ok('picked-up target is still unowned in the current GW', !ownedIdsAt(currentGwIndex()).has(free.id));
      ok('next-GW pickup disappears immediately', !rows().includes(free.id) && !availableWatchIds(mid).includes(free.id));
      ok('newly released watched player appears', rows().includes(theirs.id));
      document.querySelector('[data-watchscope="owned"]').click();
      ok('picked-up target moves into Owned while released player leaves it', rows().includes(free.id) && rows().includes(own.id) && !rows().includes(theirs.id));
      document.querySelector('[data-watchscope="unowned"]').click();
      state.transfers.push({ managerId: other, inId: theirs.id, outId: free.id, gw: landing, n: 2, t: Date.now() + 1 });
      render();
      ok('release restores the saved target without another watch action', JSON.stringify(rows()) === JSON.stringify([free.id]));
      ok('ownership updates never delete saved preferences', watchIds(mid).length === 3);

      // Search/filter exclusions should not claim that the list is empty.
      const search = document.querySelector('#trSearch');
      search.value = '__no_watched_target__'; search.dispatchEvent(new Event('input'));
      ok('filtered-out targets have an honest empty message', /No watched targets match these filters/.test(document.querySelector('#trResults')?.textContent || ''));
      ok('search does not change available target count', /Watchlist \(1\)$/.test(tally()));
      transfersView.q = '';

      state.watchlists[mid] = [own.id, theirs.id]; render();
      const empty = document.querySelector('#trResults')?.textContent || '';
      ok('all-owned list shows no player rows', rows().length === 0);
      ok('all-owned explanation mentions pickup and release', /picked up/i.test(empty) && /return.*released/i.test(empty), empty.slice(-180));
      ok('all-owned tally does not retain the old count', !/Watchlist \(\d+\)/.test(tally()));
      document.querySelector('[data-watchscope="owned"]').click();
      ok('Owned still makes all taken preferences accessible', rows().length === 2 && /Watchlist \(2\)$/.test(tally()));
      state.watchlists[mid] = [free.id]; render();
      ok('empty Owned view explains the Unowned alternative', rows().length === 0 && /None of your watched players are owned.*Check Unowned/.test(document.querySelector('#trResults')?.textContent || ''));
      document.querySelector('[data-watchscope="unowned"]').click();
      ok('Unowned restores the available preference after empty Owned', JSON.stringify(rows()) === JSON.stringify([free.id]));
      state.watchlists[mid] = [own.id, theirs.id];

      /* ---- tapping the eye, as a manager would ---- */
      state.transfers = []; transfersView.scope = 'free';
      troughWindow = () => ({ open: true });
      render();
      const eye = document.querySelector('#trResults [data-watch]');
      ok('free-agent eye precondition is present', !!eye);
      if (eye) {
        const pid = +eye.dataset.watch, wasWatched = isWatched(mid, pid);
        eye.click();
        ok('tapping the eye toggles the saved preference', isWatched(mid, pid) !== wasWatched);
        ok('the eye lights up in place', !!document.querySelector(`#trResults [data-watch="${pid}"].watch-on`) === isWatched(mid, pid));
        const count = availableWatchIds(mid).length;
        ok('tally updates in place using available count', count ? tally().endsWith(`Watchlist (${count})`) : !/Watchlist \(\d+\)/.test(tally()), tally());
      }
      watchIds(mid).slice().forEach(id => toggleWatch(mid, id));
      transfersView.scope = 'watch'; render();
      ok('a genuinely empty watchlist says how to fill it', /Nothing on your watchlist yet/.test(document.querySelector('#trResults')?.textContent || ''));
      return out;
    }));

    // Exercise real callback ordering with a stub, without loading Firebase.
    const online = await localPage('/index.html');
    report(await online.evaluate(async () => {
      const out = [];
      const ok = (name, condition, detail = '') => out.push({ name, ok: !!condition, detail });
      const tick = () => new Promise(resolve => setTimeout(resolve, 30));
      const rows = () => [...document.querySelectorAll('#trResults tbody [data-watch]')].map(el => +el.dataset.watch);
      const tally = () => document.querySelector('[data-trscope="watch"]')?.textContent || '';
      ok('real sync module never loaded', !window.WCSync);
      const calls = [];
      window.WCSync = {
        call: (action, data) => { calls.push({ action, data }); return Promise.resolve({ ok: true }); },
        auth: { user: () => ({ uid: 'watchlist-test' }), signOut: () => Promise.resolve() },
      };
      demoGwOverride = 0;
      GAMEWEEKS[0].from = new Date(Date.now() - 60000).toISOString();
      const seed = buildDemoState(); seed.transfers = []; seed.phase = 'season';
      const mid = seed.managers[0].id, other = seed.managers[1].id;
      const own = seed.draft.picks.find(p => p.managerId === mid).playerId;
      const theirs = seed.draft.picks.find(p => p.managerId === other).playerId;
      const drafted = new Set(seed.draft.picks.map(p => p.playerId));
      const free = PLAYERS.find(p => p.pos === PLAYER_BY_ID[theirs].pos && !drafted.has(p.id) && !hasLeft(p)).id;
      const watched = [free, own, theirs];
      // Deliver private before membership/public: projection must not rewrite
      // or discard preferences against an old cached ownership snapshot.
      window.onAuthChanged({ uid: 'watchlist-test', email: 'watchlist@example.test' });
      window.onPrivateSnapshot({ watchlist: watched });
      window.onMembershipSnapshot({ managerId: mid, role: 'manager' });
      ok('private-first startup preserves every saved preference', JSON.stringify(watchIds(mid)) === JSON.stringify(watched));
      const snapshot = JSON.parse(JSON.stringify(seed));
      delete snapshot.watchlists; delete snapshot.autolists; delete snapshot.claims; delete snapshot.windowClaims;
      state.view = 'transfers'; transfersView.tab = 'trough'; transfersView.scope = 'watch';
      transfersView.owner = null; transfersView.q = ''; transfersView.pos = []; transfersView.club = '';
      window.onSharedSnapshot(snapshot); await tick();
      ok('shared snapshot makes legacy ownership visible immediately', JSON.stringify(rows()) === JSON.stringify([free]));
      ok('public snapshot preserves owner-private watchlist', JSON.stringify(watchIds(mid)) === JSON.stringify(watched));
      ok('online initial tally excludes owned preferences', /Watchlist \(1\)/.test(tally()));

      const landing = transferGw();
      // Pick up the watched free agent while dropping an unwatched teammate:
      // all watched names are now owned, so the available count reaches zero.
      const dropped = seed.draft.picks.find(p => p.managerId === other && p.playerId !== theirs).playerId;
      snapshot.transfers.push({ managerId: other, inId: free, outId: dropped, gw: landing, n: 1, t: Date.now() });
      window.onSharedSnapshot(JSON.parse(JSON.stringify(snapshot))); await tick();
      ok('realtime pickup removes the row without another click', rows().length === 0);
      ok('realtime pickup removes the available tally', !/Watchlist \(\d+\)/.test(tally()));
      ok('next-GW realtime pickup does not change current-GW ownership', landing > currentGwIndex() && !ownedIdsAt(currentGwIndex()).has(free));

      window.onPrivateSnapshot({ watchlist: watched });
      ok('private snapshot echo cannot reshow an owned player in Unowned', rows().length === 0);
      document.querySelector('[data-watchscope="owned"]').click();
      ok('realtime pickup is accessible in Owned', rows().length === 3 && rows().includes(free) && /Watchlist \(3\)/.test(tally()));
      ok('realtime ownership counts update in both controls', document.querySelector('[data-watchscope="unowned"]')?.textContent.trim() === 'Unowned (0)' && document.querySelector('[data-watchscope="owned"]')?.textContent.trim() === 'Owned (3)');
      window.onPrivateSnapshot({ watchlist: watched });
      ok('private echo preserves selected Owned view and its rows', transfersView.watchScope === 'owned' && rows().length === 3);
      ok('private echo still retains the saved preferences', JSON.stringify(watchIds(mid)) === JSON.stringify(watched));
      snapshot.transfers.push({ managerId: other, inId: dropped, outId: free, gw: landing, n: 2, t: Date.now() + 1 });
      window.onSharedSnapshot(JSON.parse(JSON.stringify(snapshot))); await tick();
      ok('realtime release removes target from Owned without a click', !rows().includes(free) && rows().length === 2 && /Watchlist \(2\)/.test(tally()));
      document.querySelector('[data-watchscope="unowned"]').click();
      ok('realtime release restores the Unowned row and tally', JSON.stringify(rows()) === JSON.stringify([free]) && /Watchlist \(1\)/.test(tally()));
      ok('automatic visibility updates generate no server mutations', calls.length === 0, JSON.stringify(calls));
      ok('no Firebase scripts were fetched', !performance.getEntriesByType('resource').some(e => /gstatic\.com\/firebasejs/.test(e.name)));
      return out;
    }));
    chk('no page errors while watching', pageErrors.length === 0, pageErrors.join(' | '));
    console.log(`\n[watchlist] ${pass} passed, ${fail} failed`);
    process.exitCode = fail ? 1 : 0;
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
