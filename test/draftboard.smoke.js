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
      /* Marc, 29 Sept 2026: "a column showing actual score and another showing
         the difference between the 2". Actual must be the league's own number,
         not a third one computed here — if this drifts from the standings, the
         two pages accuse each other of lying. */
      t('Actual is exactly what the rest of the site calls a season total',
        board.every(r => r.banked === managerPoints(r.m.id)));
    })();

    /* ----- the gap cell ----- */
    (() => {
      const box = document.createElement('div');
      document.body.appendChild(box);
      const read = n => { box.innerHTML = draftGap(n); return box.firstElementChild; };
      const up = read(7), down = read(-4), level = read(0);
      t('a team that banked more than it drafted reads positive',
        up.classList.contains('up') && /\+7/.test(up.textContent), up.textContent);
      t('a team that banked less reads negative, with the sign',
        down.classList.contains('down') && /-4/.test(down.textContent), down.textContent);
      t('and dead level reads nought', level.classList.contains('level') && /^0$/.test(level.textContent.trim()));
      box.innerHTML = `${draftGap(3)}${draftGap(-3)}${draftGap(0)}`;
      const cols = [...box.querySelectorAll('.deliver')].map(e => getComputedStyle(e).color);
      t('the three are told apart by colour, not only by sign', new Set(cols).size === 3, cols.join(' '));
      box.remove();
    })();

    /* ----- the diff is Actual less Draft, and POSITIVE is reachable -----
       In an ordinary week every gap is negative: fourteen drafted, eleven
       fielded. That makes it easy to ship a column that only ever goes one way
       and never notice it could not go the other, so force it. */
    (() => {
      t('the diff on screen is Actual less Draft for every team', (() => {
        recapView = 'table'; state.view = 'draft'; render();
        return [...document.querySelectorAll('[data-dbrow]')].every(tr => {
          const r = board.find(x => x.m.id === +tr.dataset.dbrow);
          const shown = parseInt(tr.cells[5].textContent.replace('+', ''), 10);
          return shown === r.banked - r.pts && parseInt(tr.cells[4].textContent, 10) === r.banked;
        });
      })());
      t('(control) an ordinary season leaves every team short of its own draft',
        board.every(r => r.banked - r.pts <= 0),
        board.map(r => r.banked - r.pts).join(','));
      // now hand one team a big signing it never drafted, and the gap must flip
      const victim = board[board.length - 1];
      const undrafted = PLAYERS.find(p => !state.draft.picks.some(k => k.playerId === p.id));
      const keep = state.transfers, keepL = JSON.stringify(state.lineups[victim.m.id] || {});
      state.transfers = [...keep,
        { managerId: victim.m.id, inId: undrafted.id, outId: victim.picks[victim.picks.length - 1].p.id, gw: 0, t: 500 }];
      const gwN = GAMEWEEKS[0].n;
      state.matchStats['gw' + gwN].playerStats[undrafted.id] = { min: 90, st: 1, g: 40, a: 40, cs: 1 };
      state.lineups[victim.m.id] = { 0: legalizeXI([undrafted.id], squadAt(victim.m.id, 0)) };
      const after = draftBoard().find(r => r.m.id === victim.m.id);
      t('a big signing he never drafted pushes the gap positive',
        after.banked - after.pts > 0, `${victim.banked - victim.pts} -> ${after.banked - after.pts}`);
      delete state.matchStats['gw' + gwN].playerStats[undrafted.id];
      state.transfers = keep;
      state.lineups[victim.m.id] = JSON.parse(keepL);
    })();

    /* ----- Squad: the same fourteen, bench included -----
       Marc, 29 Sept 2026: "total actual points including those left on the
       bench, this is actually the better comparison because if you retained
       your squad you dont know what team you would have picked." So Squad has
       to count men a manager HELD whether or not he picked them, and the gap to
       Draft has to move when the squad stops being the drafted squad. */
    (() => {
      t('Squad counts the bench, so it is never less than the XI banked',
        board.every(r => r.squad >= r.banked),
        board.map(r => `${r.squad}>=${r.banked}`).slice(0, 3).join(' '));
      t('and it agrees with a walk of the squad, week by week', (() => {
        const r = board[0];
        let sum = 0;
        for (let i = 0; i < GAMEWEEKS.length; i++) {
          if (!gwUnderway(i)) continue;
          for (const p of squadAt(r.m.id, i)) sum += gwPlayerPoints(p.id, i);
        }
        return r.squad === sum;
      })());
      /* Before anyone has traded, the squad IS the drafted fourteen, so the gap
         is nought — which makes it easy to ship a column that is always nought
         and never notice. Settle some rounds, trade a scorer away, and it has
         to move: his later points stay on the DRAFT and leave the SQUAD. */
      let seed = 5;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const touched = [];
      for (let i = 1; i < 4 && i < GAMEWEEKS.length; i++) {
        const gwN = GAMEWEEKS[i].n, ps = {};
        for (const pk of state.draft.picks) {
          const pl = PLAYER_BY_ID[pk.playerId];
          ps[pl.id] = { min: 90, st: 1, g: rnd() < .2 ? 1 : 0, a: rnd() < .1 ? 1 : 0, cs: rnd() < .3 ? 1 : 0 };
        }
        state.matchStats['gw' + gwN] = { gw: i, label: GAMEWEEKS[i].label, final: true, playerStats: ps };
        GAMEWEEKS[i].finished = true;
        for (const f of state.fixtures) if (f.gw === gwN) f.finished = true;
        touched.push({ i, gwN });
      }
      const mid = state.managers[0].id, other = state.managers[1].id;
      const was = draftBoard().find(r => r.m.id === mid);
      t('(control) with nobody traded, the squad IS the draft',
        was.squad === was.pts, `squad ${was.squad} vs draft ${was.pts}`);
      const give = was.picks.find(x => x.pts > 0);
      const get = draftBoard().find(r => r.m.id === other).picks.slice(-1)[0];
      const keep = state.transfers;
      state.transfers = [...keep,
        { managerId: mid, inId: get.p.id, outId: give.p.id, gw: 2, t: 9000, trade: 'T9' },
        { managerId: other, inId: give.p.id, outId: get.p.id, gw: 2, t: 9000, trade: 'T9' }];
      const now = draftBoard().find(r => r.m.id === mid);
      t('trading a scorer away leaves the DRAFT total alone',
        now.pts === was.pts, `${was.pts} -> ${now.pts}`);
      t('but takes his later points off the SQUAD total',
        now.squad < was.squad, `${was.squad} -> ${now.squad}`);
      t('so Squad diff goes negative — the fourteen you have are worth less than the fourteen you took',
        now.squad - now.pts < 0, `${was.squad - was.pts} -> ${now.squad - now.pts}`);
      // and the man he received counts toward HIS squad, though he never drafted him
      const them = draftBoard().find(r => r.m.id === other);
      t('a man arriving counts on the receiving team\'s squad without joining its draft',
        them.squad > 0 && !them.picks.some(x => x.p.id === give.p.id));
      // the column is on screen and equals squad less draft
      recapView = 'table'; state.view = 'draft'; render();
      t('the Squad and Squad diff columns print those numbers', (() => {
        const fresh = draftBoard();
        return [...document.querySelectorAll('[data-dbrow]')].every(tr => {
          const r = fresh.find(x => x.m.id === +tr.dataset.dbrow);
          return parseInt(tr.cells[6].textContent, 10) === r.squad
            && parseInt(tr.cells[7].textContent.replace('+', ''), 10) === r.squad - r.pts;
        });
      })());
      t('and the card says which comparison is the fairer one',
        /the comparison worth having/.test(document.querySelector('.card').textContent));
      state.transfers = keep;
      for (const { i, gwN } of touched) { delete state.matchStats['gw' + gwN]; GAMEWEEKS[i].finished = false;
        for (const f of state.fixtures) if (f.gw === gwN) f.finished = false; }
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
