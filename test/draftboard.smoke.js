/* The Draft Console's By Team tab (Marc, 28 Sept 2026: "a tab that shows a
 * league table of points scored by each teams 14 drafted players to date...
 * click on each team and see which player is getting those points as we have
 * in the season ledger").
 *
 * Two things here could quietly be wrong and look right:
 *
 *   1. The total could disagree with the Draft Archive. Both tabs sit in the
 *      same console and describe the same fourteen men, so a manager who adds
 *      up the archive by hand must land on the table's number. They are read
 *      off one computation for exactly that reason, and this checks it.
 *
 *   2. The number could quietly become the Season Ledger's. It must not: a man
 *      counts for whoever DRAFTED him, whether or not he is still there. That
 *      is the opposite rule from the trade record (Marc, 22 Sept), which had
 *      to stop counting a man after he was released — different question, so
 *      the test pins the difference rather than assuming nobody will "fix" it.
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

    /* ----- the table ----- */
    const board = draftBoard();
    t('every manager who drafted gets a row', board.length === state.managers.length,
      `${board.length} of ${state.managers.length}`);
    t('and each row carries his whole draft', board.every(r => r.picks.length === 14),
      [...new Set(board.map(r => r.picks.length))].join('/'));
    t('a team total is the sum of its own picks',
      board.every(r => r.pts === r.picks.reduce((s, x) => s + x.pts, 0)));
    t('the table is ordered by points, best first',
      board.every((r, i) => i === 0 || board[i - 1].pts >= r.pts));
    t('level totals share a place', (() => {
      const byPts = {};
      for (const r of board) (byPts[r.pts] = byPts[r.pts] || []).push(r.rank);
      return Object.values(byPts).every(v => new Set(v).size === 1);
    })());
    t('and a better total never takes a worse place',
      board.every((r, i) => i === 0 || board[i - 1].rank <= r.rank));

    /* ----- it agrees with the Draft Archive, pick for pick ----- */
    (() => {
      const rows = draftDelivery();
      t('the board totals to exactly what the archive totals to',
        board.reduce((s, r) => s + r.pts, 0) === rows.reduce((s, r) => s + r.pts, 0),
        `${board.reduce((s, r) => s + r.pts, 0)} vs ${rows.reduce((s, r) => s + r.pts, 0)}`);
      t('every pick appears exactly once across the board',
        board.reduce((s, r) => s + r.picks.length, 0) === rows.length);
      // and each man's points and swing are the archive's, not a second reading
      const flat = new Map();
      for (const r of board) for (const x of r.picks) flat.set(x.p.id, x);
      t('each man carries the archive\'s own points and swing',
        rows.every(r => flat.get(r.p.id)?.pts === r.pts && flat.get(r.p.id)?.move === r.move));
    })();

    /* ----- a man you drafted and shipped out STILL counts here ----- */
    (() => {
      const mine = board[0], theirs = board[board.length - 1];
      const moved = mine.picks.find(x => x.pts > 0);
      if (!moved) { t('(skipped: no scoring pick to trade)', true); return; }
      const was = draftBoard().find(r => r.m.id === mine.m.id);
      const before = was.pts, keptBefore = was.kept;
      /* APPEND, do not replace. The demo ships with transfers of its own, so
         assigning over state.transfers un-trades whatever it had already
         traded — which put a pick back on the books at the same moment this
         took one off, and the kept count sat still for two opposite reasons. */
      const keep = state.transfers;
      state.transfers = [...keep,
        { managerId: mine.m.id, inId: theirs.picks[0].p.id, outId: moved.p.id, gw: 1, t: 9000, trade: 'X1' },
        { managerId: theirs.m.id, inId: moved.p.id, outId: theirs.picks[0].p.id, gw: 1, t: 9000, trade: 'X1' }];
      const after = draftBoard().find(r => r.m.id === mine.m.id);
      t('trading a pick away does not take his points off your draft',
        after.pts === before, `${before} -> ${after.pts}`);
      t('but he is marked Gone rather than Owned',
        after.picks.find(x => x.p.id === moved.p.id)?.owned === false);
      t('and the kept count drops', after.kept === keptBefore - 1, `${keptBefore} -> ${after.kept}`);
      // the man arriving does NOT join the receiving team's draft — he was not
      // drafted by them, and this tab is about drafts
      const got = draftBoard().find(r => r.m.id === theirs.m.id);
      t('and he does not appear in the receiving team\'s draft',
        !got.picks.some(x => x.p.id === moved.p.id));
      state.transfers = keep;
    })();

    /* ----- and it is NOT the Season Ledger's number ----- */
    (() => {
      const differs = board.filter(r => r.pts !== r.banked).length;
      t('(control) the draft total and the banked total really do differ',
        differs > 0, `${differs} of ${board.length} teams differ`);
      t('every team\'s draft total is tracked separately from what it banked',
        board.every(r => Number.isFinite(r.pts) && Number.isFinite(r.banked)));
    })();

    /* ----- the card, and the tap-through ----- */
    (() => {
      recapView = 'table';
      state.view = 'draft'; render();
      const card = document.querySelector('.card');
      const rows = [...document.querySelectorAll('[data-dbrow]')];
      t('the tab renders a row per team', rows.length === board.length, String(rows.length));
      const txt = card.textContent.replace(/\s+/g, ' ');
      t('it says the number is about the draft, not the season',
        /whether you still hold him or shipped him out/.test(txt));
      const first = board[0];
      const detail = document.querySelector(`#db-${first.m.id}`);
      t('the breakdown starts hidden', detail && detail.style.display === 'none');
      rows[0].click();
      t('and opens on a tap', detail.style.display !== 'none');
      t('it lists all fourteen men', detail.querySelectorAll('.squad-row').length === 15,
        `${detail.querySelectorAll('.squad-row').length} rows incl. header`);
      const dtxt = detail.textContent;
      t('every one of his picks is named', first.picks.every(x => dtxt.includes(x.p.name)));
      t('biggest earner first',
        first.picks.every((x, i) => i === 0 || first.picks[i - 1].pts >= x.pts));
      t('and the men are his, nobody else\'s', (() => {
        const others = board.slice(1).flatMap(r => r.picks).filter(x => !first.picks.some(y => y.p.id === x.p.id));
        // by id, not by name: a name can be a substring of another name
        const shown = new Set([...detail.querySelectorAll('[data-pcard]')].map(e => +e.dataset.pcard));
        return first.picks.every(x => shown.has(x.p.id)) && !others.some(x => shown.has(x.p.id));
      })());
      rows[0].click();
      t('and closes again', detail.style.display === 'none');
    })();

    /* ----- the two tabs ----- */
    (() => {
      recapView = 'table'; state.view = 'draft'; render();
      t('both tabs are offered', document.querySelectorAll('[data-recaptab]').length === 2);
      const archiveBtn = document.querySelector('[data-recaptab="archive"]');
      archiveBtn.click();
      t('the archive tab switches to the archive',
        recapView === 'archive' && /pick by pick/.test(document.querySelector('.card').textContent));
      t('and the archive still lists every pick',
        document.querySelectorAll('.pool-table tbody tr').length === state.draft.picks.length,
        String(document.querySelectorAll('.pool-table tbody tr').length));
      document.querySelector('[data-recaptab="table"]').click();
      t('and back again', recapView === 'table' && !!document.querySelector('[data-dbrow]'));
    })();

    /* ----- an empty draft is said plainly ----- */
    (() => {
      const keep = state.draft.picks;
      state.draft.picks = [];
      t('no picks on record does not crash either tab',
        draftBoard() === null && /No picks on record/.test(viewDraftLeague()));
      recapView = 'archive';
      t('nor the archive', /No picks on record/.test(viewDraftRecap()));
      recapView = 'table';
      state.draft.picks = keep;
    })();

    return log;
  });

  for (const line of log) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));

  // four columns on a 390px phone
  const wide = await page.evaluate(() => {
    recapView = 'table'; state.view = 'draft'; render();
    document.querySelector('[data-dbrow]').click();
    return { own: !!document.querySelector('.card div[style*="overflow-x"]'),
      spills: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  chk('the table scrolls in its own box on a phone', wide.own);
  chk('and never drags the page sideways', !wide.spills);
  chk('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[draft-board] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
