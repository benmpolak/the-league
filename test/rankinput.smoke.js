/* Type the number to reorder a waiver list.
 *
 * Marc, 30 Aug 2026: "can you also add the ability to type the number on the
 * waiver list in the same way that you could on the draft. its quite awkward
 * to reorder your list if it is too long as it is."
 *
 * The arrows nudge one place at a time, which is fine for a list of three and
 * hopeless for moving #12 to #2. The Draft Console's autolist has taken a
 * typed rank since mock night; this pins the same behaviour on BOTH waiver
 * lists — the weekly one and the Window Waiver's — including the parts that
 * are easy to get wrong: the shift is an insert (everybody else closes up
 * behind him), a number off the end clamps instead of throwing, and rubbish
 * in the box changes nothing.
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

  const report = await page.evaluate(() => {
    const out = [];
    const ok = (n, c, d = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
    window.__autoConfirm = true; window.confirm = () => true;
    state = buildDemoState(); state.phase = 'season';
    const mid = state.managers[0].id;
    whoami = mid;

    // five claims off my own squad, so every row is legal and the only thing
    // moving is the order
    const gw = transferGw();
    const squad = squadAt(mid, gw);
    const spare = PLAYERS.filter(p => !ownedIdsAt(gw).has(p.id));
    const list = [0, 1, 2, 3, 4].map(k => ({ in: spare[k].id, out: squad[k].id }));
    const names = ids => ids.map(c => PLAYER_BY_ID[c.in].name);

    // ---------- one list, one bucket (Wilko, 1 Sept 2026) ----------
    // A weekend claim lived in last week's bucket, resolved FIRST, and had
    // vanished from the screen when the week rolled — the list said Damsgaard
    // was #1 while a hidden Nunes line outranked it. The list must show every
    // live claim in resolver order, and an edit must consolidate the lot.
    (() => {
      const cur = currentGwIndex();
      state.claims = { [cur - 1]: { [mid]: [{ in: spare[9].id, out: squad[0].id }] },
        [cur]: { [mid]: [{ in: spare[8].id, out: squad[1].id }] } };
      ok('the list shows the rolled-over claim, and ahead (resolver order)',
        names(myClaims(mid)).join(',') === `${spare[9].name},${spare[8].name}`, names(myClaims(mid)).join(','));
      setClaims(mid, [...myClaims(mid)].reverse());
      ok('an edit consolidates every bucket into the current one',
        !Object.keys(state.claims[cur - 1]?.[mid] || {}).length && myClaims(mid).length === 2,
        JSON.stringify(state.claims));
      ok('and the visible order is now the whole truth',
        names(myClaims(mid)).join(',') === `${spare[8].name},${spare[9].name}`, names(myClaims(mid)).join(','));
      state.claims = {};
    })();

    // ---------- the weekly waiver list ----------
    setClaims(mid, list);
    transfersView.tab = 'claims';
    state.view = 'transfers'; render();

    const boxes = () => [...document.querySelectorAll('[data-claimrank]')];
    ok('every claim row carries a rank box', boxes().length === 5, String(boxes().length));
    ok('the boxes read 1..5 in order',
      boxes().map(b => b.value).join(',') === '1,2,3,4,5', boxes().map(b => b.value).join(','));

    const before = names(myClaims(mid));
    const type = (sel, k, v) => {
      const b = document.querySelector(`[data-${sel}="${k}"]`);
      b.value = String(v);
      b.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // #5 to #2 — the whole point of the exercise
    type('claimrank', 4, 2);
    const after = names(myClaims(mid));
    ok('typing 2 on the fifth claim puts him second',
      after[1] === before[4], after.join(' > '));
    ok('and the men he jumped shuffle down without losing anyone',
      JSON.stringify(after) === JSON.stringify([before[0], before[4], before[1], before[2], before[3]]),
      after.join(' > '));
    ok('the re-render renumbers the boxes 1..5 again',
      boxes().map(b => b.value).join(',') === '1,2,3,4,5', boxes().map(b => b.value).join(','));

    // going the other way, and off the end
    const a2 = names(myClaims(mid));
    type('claimrank', 0, 99);
    const a3 = names(myClaims(mid));
    ok('a number past the end clamps to last rather than throwing',
      a3[4] === a2[0] && a3.length === 5, a3.join(' > '));
    type('claimrank', 0, 0);
    const a4 = names(myClaims(mid));
    ok('and zero clamps to first', a4[0] === a3[0], a4.join(' > '));
    type('claimrank', 2, '');
    ok('an empty box leaves the list exactly as it was',
      JSON.stringify(names(myClaims(mid))) === JSON.stringify(a4), names(myClaims(mid)).join(' > '));
    type('claimrank', 2, 3);
    ok('typing a man\'s own number is a no-op too',
      JSON.stringify(names(myClaims(mid))) === JSON.stringify(a4), names(myClaims(mid)).join(' > '));

    // ---------- the Window Waiver list ----------
    // Marc, 30 Aug 2026: "id make it a separate list with a button at the top"
    // — separate list, same reordering.
    // the demo season has no draft-night snapshot, so nothing is penned. Build
    // one the way the real league's is built — everyone at the club the
    // snapshot recorded — then move three unowned men, which is precisely what
    // puts a man in the pen.
    const snap = Object.fromEntries(PLAYERS.map(p => [p.id, p.club]));
    for (const p of spare.slice(5, 8)) snap[p.id] = 'ZZZ';
    state.draftPool = { at: Date.now(), ids: snap };
    const pen = lockedArrivals();
    if (pen.length >= 3) {
      setWindowClaims(mid, pen.slice(0, 3).map((p, k) => ({ in: p.id, out: squad[k].id })));
      transfersView.tab = 'window'; render();
      const wboxes = () => [...document.querySelectorAll('[data-wcrank]')];
      ok('the window list gets rank boxes of its own', wboxes().length === 3, String(wboxes().length));
      const wb = names(myWindowClaims(mid));
      type('wcrank', 2, 1);
      const wa = names(myWindowClaims(mid));
      ok('typing 1 on the third window claim makes him the first name lodged',
        JSON.stringify(wa) === JSON.stringify([wb[2], wb[0], wb[1]]), wa.join(' > '));
      ok('and the weekly list was not touched by the window list',
        myClaims(mid).length === 5, String(myClaims(mid).length));
    } else {
      ok('the window list gets rank boxes of its own (SKIPPED: pen has ' + pen.length + ')', false);
    }

    // the two lists are genuinely separate boxes, not one control on two tabs
    transfersView.tab = 'claims'; render();
    ok('the weekly tab shows only weekly boxes',
      document.querySelectorAll('[data-claimrank]').length === 5 &&
      document.querySelectorAll('[data-wcrank]').length === 0);

    return out.join('\n');
  });
  for (const line of report.split('\n')) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors while reordering', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[rank-input] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
