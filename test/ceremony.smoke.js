/* The opening-ceremony barrier (Marc, 9 Aug: "the draft is still starting
 * before everyone has finished the opening ceremony" — he was sat on the
 * REPORT TO THE DRAFT ROOM card, uncounted, while pick two landed).
 *
 * Two rules, both pinned here:
 *   1. "You are through" must be TRUE the moment that card is on screen —
 *      the acknowledgement goes out on sight, not on the button press.
 *   2. The overlay must notice the room opening underneath it. The pick clock
 *      refuses to tick while the pomp is up, so a frozen barrier is the only
 *      thing the manager can see.
 * Runs with sync ON (netOn() must be true) but every off-localhost request
 * aborted, so no Firebase league — staging or otherwise — is ever touched.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' \u2014 ' + detail : ''}`);
  if (ok) pass++; else fail++;
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.setRequestInterception(true);
  page.on('request', r => (r.url().startsWith(baseUrl) ? r.continue() : r.abort()));
  await page.goto(baseUrl + '?sandbox', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const report = await page.evaluate(() => {
    const out = [];
    state.phase = 'draft';
    state.draft.order = state.managers.map(m => m.id);
    state.draft.picks = [];
    state.draft.ceremonyReady = {};
    whoami = state.managers[3].id;
    localStorage.removeItem(`${LS_NS}-ceremony-seen`);
    // stand in for the networked room so the barrier logic is exercised
    let acks = 0;
    window.serverAct = async (op, d) => { if (d && d.op === 'ceremonyReady') acks++; return { ok: true }; };

    showCeremony();
    // walk to the final REPORT TO THE DRAFT ROOM card without clicking through it
    for (let k = 0; k < 40 && !document.querySelector('#cerWait'); k++) document.querySelector('#cerNext')?.click();
    out.push(`${document.querySelector('#cerWait') ? 'PASS' : 'FAIL'}  the barrier card is reached`);
    out.push(`${acks === 1 ? 'PASS' : 'FAIL'}  acknowledged on sight, without clicking through — acks=${acks}`);
    out.push(`${localStorage.getItem(`${LS_NS}-ceremony-seen`) === ceremonyKey() ? 'PASS' : 'FAIL'}  the ceremony is stamped seen while the card is still up`);
    const before = document.querySelector('#cerWait').textContent;
    out.push(`${/0\/12 are in|1\/12 are in/.test(before) ? 'PASS' : 'FAIL'}  the card states the live count — "${before.slice(-22)}"`);

    // the room fills up around him
    state.draft.ceremonyReady = Object.fromEntries(state.managers.map(m => [m.id, true]));
    ceremonyTick();
    const after = document.querySelector('#cerWait')?.textContent || '';
    out.push(`${/12\/12 are in/.test(after) ? 'PASS' : 'FAIL'}  the count updates on a shared tick — "${after.slice(-22)}"`);
    out.push(`${document.querySelector('#ceremony') ? 'PASS' : 'FAIL'}  the barrier stays up while pick one has not landed`);

    // ...and now the draft starts underneath him, exactly as Marc saw it
    state.draft.picks.push({ managerId: state.draft.order[0], playerId: PLAYERS[0].id, n: 1 });
    state.draft.picks.push({ managerId: state.draft.order[1], playerId: PLAYERS[1].id, n: 2 });
    ceremonyTick();
    out.push(`${!document.querySelector('#ceremony') ? 'PASS' : 'FAIL'}  the barrier closes itself once picks land`);
    out.push(`${state.view === 'draft' ? 'PASS' : 'FAIL'}  and drops him on the draft console — view=${state.view}`);
    out.push(`${netOn() ? 'PASS' : 'FAIL'}  the room is in networked mode for this test`);
    return out.join('\n');
  });
  for (const line of report.split('\n')) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors through the ceremony', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[ceremony] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
