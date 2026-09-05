/* A transfer listing dies with the ownership that gave it meaning.
 *
 * Marc, 5 Sept 2026, on a Trough row: "this player in trough is incorrectly
 * marked as transfer listed. He was transfer listed and then released but now
 * he has a new owner and isnt transfer listed."
 *
 * onBlock asked only "is he on ANYBODY's list", never "does that manager still
 * own him". The pill is drawn immediately after the CURRENT owner's name, so a
 * listing left behind by a previous owner reads as the new one having listed a
 * player he has just signed. Worse than cosmetic: the trade desk's whole point
 * is telling you who is available, and this offers you a man nobody is
 * offering.
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
    const seller = state.managers[1].id, buyer = state.managers[2].id;
    whoami = state.managers[0].id;
    const gw = transferGw();

    /* Stage it the way it ends up rather than by fabricating the two transfers
       that got there: a listing sitting under manager A for a man manager B
       owns. That IS the end state of "listed, released, signed by someone
       else", and it does not depend on my guessing the transfer record shape. */
    const owners = new Map();
    for (const m of state.managers) for (const q of managerSquad(m.id)) owners.set(q.id, m.id);
    const man = managerSquad(seller)[3];                 // the seller really owns him
    ok('(setup) the seller owns him', owners.get(man.id) === seller, teamName(owners.get(man.id)));

    state.tradeBlock = { [seller]: [man.id] };
    ok('(setup) a listed man reads as listed', onBlock(man.id), man.name);

    // ...and now somebody else owns him, with the seller's entry left behind
    const movedMan = managerSquad(buyer)[3];
    state.tradeBlock = { [seller]: [movedMan.id] };
    ok('(setup) he now belongs to somebody else entirely',
      owners.get(movedMan.id) === buyer, teamName(owners.get(movedMan.id)));
    ok('(setup) and the seller\'s stale entry is still sitting there',
      blockList(seller).includes(movedMan.id));

    ok('he no longer reads as transfer-listed', !onBlock(movedMan.id), movedMan.name);

    /* ---- and the check has teeth in both directions ---- */
    // the new owner listing him himself must still read as listed
    state.tradeBlock = { [seller]: [movedMan.id], [buyer]: [movedMan.id] };
    ok('(control: if the NEW owner lists him, he is listed again)', onBlock(movedMan.id));

    // a man the seller still owns and has listed is unaffected, side by side
    const kept = managerSquad(seller)[0];
    state.tradeBlock = { [seller]: [movedMan.id, kept.id] };
    ok('(control: a listing on a man he STILL owns is untouched)', onBlock(kept.id), kept.name);
    ok('...while the stale one beside it stays dead', !onBlock(movedMan.id));

    /* ---- and it is right on the page, not just in the function ---- */
    transfersView.tab = 'trough'; transfersView.owner = buyer; transfersView.limit = 300;
    state.view = 'transfers'; render();
    const row = [...document.querySelectorAll('.pcell')].find(el => el.textContent.includes(movedMan.name));
    ok('the Trough row for him carries no transfer-listed pill',
      !!row && !/transfer-listed/.test(row.textContent), row ? row.textContent.replace(/\s+/g, ' ').slice(0, 90) : 'row not found');
    const keptRow = [...document.querySelectorAll('.pcell')].find(el => el.textContent.includes(kept.name));
    ok('(control: the genuinely listed man still shows his pill)',
      !keptRow || /transfer-listed/.test(keptRow.textContent),
      keptRow ? keptRow.textContent.replace(/\s+/g, ' ').slice(0, 90) : 'not on this page');
    transfersView.owner = null; transfersView.limit = 20;

    return out.join('\n');
  });
  for (const line of report.split('\n')) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[trade-block] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
