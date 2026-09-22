/* The Draft Archive's verdict column (Marc, 17 Sept 2026: "add the current
 * points scored, current rank, the difference between where a player was
 * drafted and their current rank, and a green or red arrow showing if they are
 * delivering over the draft position, below the draft position or a grey flat
 * line if they are in exactly the same position... updated after every
 * gameweek").
 *
 * The arithmetic is the whole feature, so it is what gets attacked:
 *   - the place is over the DRAFTED men only, which is the only comparison
 *     that says anything about a pick
 *   - level scores SHARE a place, because two men on the same points cannot
 *     be one place apart
 *   - the swing is the pick less the place, and the arrow's direction and
 *     magnitude both follow it — a bare direction tells you the sign, not
 *     the size
 *   - and it moves when a round settles, which is the part Marc asked for
 *     last and which nothing stores
 * Run against any side-port server with TEST_BASE_URL=http://127.0.0.1:8135.
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

    state = buildDemoState();
    state.phase = 'season';
    myId = whoami = state.managers[0].id;

    /* ----- the standing ----- */
    const rows = draftDelivery();
    t('every pick on record gets a verdict',
      !!rows && rows.length === state.draft.picks.length, `${rows && rows.length} of ${state.draft.picks.length}`);
    t('the swing is the pick less the place, for every man',
      rows.every(r => r.move === r.pk.n - r.rank));
    t('the best scorer stands first',
      rows.find(r => r.rank === 1).pts === Math.max(...rows.map(r => r.pts)));
    t('nobody is placed beyond the field itself',
      rows.every(r => r.rank >= 1 && r.rank <= PLAYERS.length),
      `1..${Math.max(...rows.map(r => r.rank))} of ${PLAYERS.length}`);
    /* Marc, 18 Sept 2026: "I want the ranking to include undrafted players."
       It used to rank a pick among the other picks; it now ranks him among
       everybody, which is the harsher and more useful reading — a pick is
       only as good as what you could have had instead. */
    t('the place counts the WHOLE feed, not just the men taken',
      rows.fieldSize === PLAYERS.length && PLAYERS.length > rows.length,
      `field ${rows.fieldSize}, drafted ${rows.length}`);
    /* This used to hunt the demo for a drafted man who happened to be outscored
       by free agents. He does not exist: the demo only fabricates stats for men
       who were DRAFTED, so every free agent sits on nought and the precondition
       could never be met — it failed CI on 22 Sept and blocked every deploy.
       Prove the mechanism instead of waiting for the data to show it: push
       undrafted men above a pick and watch him fall by exactly that many. */
    t('and a pick outscored by free agents is placed below them',
      (() => {
        const draftedIds = new Set(rows.map(r => r.p.id));
        const mark = rows.find(r => r.rank > 1 && r.pts > 0) || rows[0];
        const free = PLAYERS.filter(p => !draftedIds.has(p.id)).slice(0, 5);
        if (!free.length) return false;
        const gwN = GAMEWEEKS[0].n;
        const ps = state.matchStats['gw' + gwN].playerStats;
        const before = mark.rank;
        for (const p of free) ps[p.id] = { min: 90, st: 1, g: 20, a: 20, cs: 1 };
        const after = draftDelivery().find(r => r.p.id === mark.p.id).rank;
        for (const p of free) delete ps[p.id];
        const restored = draftDelivery().find(r => r.p.id === mark.p.id).rank;
        return after === before + free.length && restored === before;
      })(), 'five free agents leapfrogging a pick push him exactly five places down');
    // level scores share a place, and a better score never gets a worse one
    (() => {
      const byPts = {};
      for (const r of rows) (byPts[r.pts] = byPts[r.pts] || []).push(r.rank);
      const shared = Object.values(byPts).every(v => new Set(v).size === 1);
      const order = [...rows].sort((a, b) => b.pts - a.pts);
      const mono = order.every((r, i) => i === 0 || order[i - 1].rank <= r.rank);
      t('men on level points share a place', shared);
      t('and a higher score never takes a worse place', mono);
      const tie = Object.entries(byPts).find(([, v]) => v.length > 1);
      t('(control: the demo does contain a tie to share)', !!tie,
        tie ? `${tie[1].length} men on ${tie[0]} pts` : 'no ties');
    })();

    /* ----- the arrow ----- */
    (() => {
      const box = document.createElement('div');
      const read = move => { box.innerHTML = deliveryArrow(move); return box.firstElementChild; };
      const up = read(7), down = read(-4), level = read(0);
      t('a man outscoring his pick gets a green up arrow',
        up.classList.contains('up') && /▲/.test(up.textContent) && /7/.test(up.textContent), up.textContent);
      t('a man behind his pick gets a red down arrow',
        down.classList.contains('down') && /▼/.test(down.textContent) && /4/.test(down.textContent), down.textContent);
      t('a man exactly where he was taken gets a grey flat line',
        level.classList.contains('level') && /─/.test(level.textContent) && /0/.test(level.textContent), level.textContent);
      t('the arrow carries the size, not just the direction',
        /7/.test(up.textContent) && /4/.test(down.textContent));
      // and the three are told apart by colour, not only by glyph
      document.body.appendChild(box);
      box.innerHTML = `${deliveryArrow(3)}${deliveryArrow(-3)}${deliveryArrow(0)}`;
      const cols = [...box.querySelectorAll('.deliver')].map(e => getComputedStyle(e).color);
      t('green, red and grey are three different colours', new Set(cols).size === 3, cols.join(' '));
      box.remove();
    })();

    /* ----- the card ----- */
    (() => {
      const host = document.createElement('div');
      host.innerHTML = viewDraftRecap();
      document.body.appendChild(host);
      const card = host.querySelector('.card');
      const cols = [...card.querySelectorAll('thead th')].map(x => x.textContent.trim());
      t('the card carries all four new columns',
        ['Pts', 'Now', 'Swing'].every(c => cols.includes(c)) && cols.includes('Pick'), cols.join('|'));
      t('a row per pick', card.querySelectorAll('tbody tr').length === rows.length,
        String(card.querySelectorAll('tbody tr').length));
      // the numbers on screen are the numbers computed, not a second reading
      const first = rows[0];
      const cells = [...card.querySelector('tbody tr').cells].map(c => c.textContent.replace(/\s+/g, ' ').trim());
      t('the first row prints its own pick, points and place',
        cells[0] === `#${first.pk.n}` && cells[3] === String(first.pts) && cells[4] === String(first.rank),
        cells.join(' | '));
      // the card must SAY what the places are over, or the column reads as a
      // league-wide rank to one man and a draft rank to the next
      t('and it says the places are over the whole league, not just the picks',
        /among all \d+ players in the league/.test(card.textContent)
        && new RegExp(`among all ${PLAYERS.length} players`).test(card.textContent),
        (card.textContent.match(/Places are among[^.]*\./) || ['no line'])[0]);
      host.remove();
    })();

    /* ----- it moves when a round settles. Nothing is stored, so this is the
       whole of "updated after every gameweek" ----- */
    (() => {
      const before = draftDelivery();
      const beforePts = Object.fromEntries(before.map(r => [r.p.id, r.pts]));
      const beforeRank = Object.fromEntries(before.map(r => [r.p.id, r.rank]));
      // settle another round: give the man drafted LAST a huge score
      const last = before.reduce((a, b) => (b.pk.n > a.pk.n ? b : a), before[0]);
      const gwN = GAMEWEEKS[1].n;
      state.matchStats['gw' + gwN] = { gw: 1, label: GAMEWEEKS[1].label, final: true,
        playerStats: { [last.p.id]: { min: 90, st: 1, g: 5, a: 5, cs: 1 } } };
      GAMEWEEKS[1].finished = true;
      const after = draftDelivery();
      const now = after.find(r => r.p.id === last.p.id);
      t('a new round changes his points', now.pts > beforePts[last.p.id],
        `${beforePts[last.p.id]} -> ${now.pts}`);
      t('and lifts his place', now.rank < beforeRank[last.p.id],
        `${beforeRank[last.p.id]} -> ${now.rank}`);
      t('and swings his arrow with it', now.move > last.move, `${last.move} -> ${now.move}`);
      t('the swing still equals pick less place after the round',
        after.every(r => r.move === r.pk.n - r.rank));
      // the last pick in the draft outscoring the field is the steal, and the
      // card should say so rather than leave the reader to find it
      const host = document.createElement('div');
      host.innerHTML = viewDraftRecap();
      t('the card names the steal of the draft',
        new RegExp('steal so far is ' + last.p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(host.textContent),
        host.textContent.match(/The steal so far is [^,]+/)?.[0] || 'not named');
      delete state.matchStats['gw' + gwN];
      GAMEWEEKS[1].finished = false;
    })();

    /* ----- and an empty archive is not an error ----- */
    (() => {
      const keep = state.draft.picks;
      state.draft.picks = [];
      t('no picks on record is said plainly, not crashed on',
        draftDelivery() === null && /No picks on record/.test(viewDraftRecap()));
      state.draft.picks = keep;
    })();

    return log;
  });

  for (const line of log) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));

  // the table is six columns wide on a 390px phone: it may scroll in its own
  // box, but it must never take the page with it
  const wide = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = viewDraftRecap();
    document.body.appendChild(host);
    const own = !!host.querySelector('div[style*="overflow-x"]');
    const spills = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    host.remove();
    return { own, spills };
  });
  chk('the table scrolls in its own box on a phone', wide.own);
  chk('and never drags the page sideways with it', !wide.spills);
  chk('no page errors reading the archive', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[draft-delivery] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
