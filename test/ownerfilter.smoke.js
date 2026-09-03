/* Filter the Trough and the Data Room to one manager's squad.
 *
 * Marc, 3 Sept 2026: "can you add a filter button on the trough and data room
 * that allows you to filter on the players in any specific persons team
 * including your own".
 *
 * The thing worth pinning is not that the control exists — it is that picking a
 * squad shows THAT squad and nothing else, on both surfaces, and that it beats
 * the ownership chips rather than intersecting with them. "Show me Toby's
 * squad" and "show me free agents" are the same question asked two ways, and
 * answering both at once gives an empty table, which reads as a broken filter.
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
    const me = state.managers[0].id, him = state.managers[4].id;
    whoami = me;
    const squadOf = m => squadAt(m, transferGw());

    /* ---- the control, on both surfaces ---- */
    state.view = 'data'; render();
    const dxo = document.querySelector('#dxOwner');
    ok('the Data Room has the filter', !!dxo);
    ok('it offers every manager plus an off switch',
      dxo && dxo.querySelectorAll('option').length === state.managers.length + 1,
      dxo && String(dxo.querySelectorAll('option').length));
    ok('your own club is grouped first, where you will look for it',
      dxo && dxo.querySelector('optgroup')?.label === 'Mine',
      dxo && dxo.querySelector('optgroup')?.label);
    ok('and it is off by default — the filter must not change what people already see',
      dataView.owner == null && dxo && dxo.value === '');

    /* ---- picking a squad shows that squad, and only that squad ---- */
    const dxRows = () => [...document.querySelectorAll('[data-cmp]')].map(i => +i.dataset.cmp);
    dataView = { ...dataView, owner: him, limit: 300 }; render();
    const his = new Set(squadOf(him).map(p => p.id));
    ok('the Data Room shows his whole squad',
      dxRows().length === his.size && his.size > 0, `${dxRows().length} of ${his.size}`);
    ok('and nobody who is not in it', dxRows().every(id => his.has(id)));

    // ...including your own, which is the commonest use
    dataView = { ...dataView, owner: me }; render();
    const mine = new Set(squadOf(me).map(p => p.id));
    ok('your own squad works the same way',
      dxRows().length === mine.size && dxRows().every(id => mine.has(id)),
      `${dxRows().length} of ${mine.size}`);

    /* ---- it beats the ownership chips rather than intersecting ---- */
    // scope 'free' plus a squad would be empty if the two were ANDed together
    dataView = { ...dataView, owner: him, scope: 'free' }; render();
    ok('a squad beats the Trough/free-agent scope instead of cancelling it out',
      dxRows().length === his.size, `${dxRows().length} rows with scope=free`);
    dataView = { ...dataView, owner: null, scope: 'all', limit: 40 }; render();
    ok('(control: turning it off restores everyone)', dxRows().length > his.size, String(dxRows().length));

    /* ---- the Trough ---- */
    transfersView.tab = 'trough'; transfersView.owner = null;
    state.view = 'transfers'; render();
    ok('the Trough has the same filter', !!document.querySelector('#trOwner'));
    const trText = () => (document.querySelector('#trResults') || document.body).textContent || '';
    transfersView.owner = me; transfersView.limit = 300; render();
    const myMen = squadOf(me);
    ok('it lists every man in the chosen squad', myMen.every(p => trText().includes(p.name)),
      myMen.filter(p => !trText().includes(p.name)).map(p => p.name).join(', ') || 'all present');
    const outsider = PLAYERS.find(p => !mine.has(p.id) && (p.pts || 0) > 20);
    ok('and nobody outside it', outsider ? !trText().includes(outsider.name) : true,
      outsider ? outsider.name : 'no outsider to test with');
    // a squad the Trough would normally hide entirely: owned men are not free agents
    transfersView.owner = him; render();
    ok('another manager\'s squad shows even though the Trough hides owned men by default',
      squadOf(him).every(p => trText().includes(p.name)),
      squadOf(him).filter(p => !trText().includes(p.name)).map(p => p.name).join(', ') || 'all present');
    transfersView.owner = null; transfersView.limit = 20; render();
    ok('(control: off again and the Trough is the Trough)',
      !squadOf(him).every(p => trText().includes(p.name)));

    return out.join('\n');
  });
  for (const line of report.split('\n')) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[owner-filter] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
