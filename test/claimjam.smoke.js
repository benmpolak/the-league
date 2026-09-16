/* Tom Wilkowski's lockout, 16 Sept 2026, 11:10 — "It won't let me set any new
 * waivers", "I've dropped a player that I had a waiver set on for Friday and it
 * will not let me cancel it".
 *
 * One stale line on the WEEKLY ladder — its drop man had left his squad on an
 * earlier move — and the desk refused the whole list for it. Every edit sends
 * the whole list, so he could not add, could not delete, and the refusal named
 * a player he was not touching.
 *
 * This is Toby's bug of 2 Sept, which was fixed on the Window ladder and never
 * ported to this one. So the file pins the fix on the ladder that was missed:
 *   - a line whose drop man has gone is RECOGNISED as dead, by name and reason
 *   - it is pruned rather than allowed to lock the list, and the manager is told
 *   - adding still works, deleting still works, with a stale line present
 *   - the line the manager is actually adding is checked FIRST, so pruning can
 *     only ever remove something already dead and never what was just asked for
 *   - a refusal from the desk is reported as the desk's words, not as a network
 *     fault, which is what sent Tom and Pol looking at their own machines
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
  await page.goto(baseUrl + '?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  const log = await page.evaluate(() => {
    const log = [];
    const t = (name, ok, detail = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);

    state = buildDemoState();
    state.phase = 'season';
    const mid = state.managers[0].id;
    whoami = myId = mid;
    const tgw = transferGw();
    const squad = squadAt(mid, tgw);
    const owned = ownedIdsAt(tgw);
    const free = pos => PLAYERS.filter(p => p.pos === pos && !owned.has(p.id) && !arrivalLocked(p));
    const mine = pos => squad.filter(p => p.pos === pos);

    /* ----- Tom's position: a claim whose drop man he then moved on ----- */
    const goneMan = mine('DF')[0];                       // the man he dropped
    const staleIn = free('DF')[0];                       // who that claim was for
    const liveIn = free('MF')[0], liveOut = mine('MF')[0];
    if (!goneMan || !staleIn || !liveIn || !liveOut) {
      t('setup: a squad to work with', false, 'demo squad too thin');
      return log;
    }
    const stale = { in: staleIn.id, out: goneMan.id };
    const live = { in: liveIn.id, out: liveOut.id };
    state.claims = { [currentGwIndex()]: { [mid]: [live, stale] } };

    t('(setup) both lines are healthy before he moves anybody on',
      !deadClaim(live, mid) && !deadClaim(stale, mid),
      deadClaim(stale, mid) || 'both fine');

    // now he does exactly what he told the group: drops that man from the Trough
    const replacement = free('DF')[1];
    state.transfers = [...toArr(state.transfers),
      { managerId: mid, inId: replacement.id, outId: goneMan.id, gw: tgw, t: Date.now(), n: 1 }];
    t('(setup) the drop man on the stale line has left his squad',
      !squadAt(mid, tgw).some(p => p.id === goneMan.id), goneMan.name);

    /* ----- 1. the line is recognised as dead, and says why ----- */
    t('the stale line is recognised as dead', !!deadClaim(stale, mid), deadClaim(stale, mid));
    t('and it names the man and the reason, not a generic refusal',
      /no longer in your squad/.test(deadClaim(stale, mid))
      && deadClaim(stale, mid).includes(goneMan.name), deadClaim(stale, mid));
    t('(control) the healthy line is not called dead', !deadClaim(live, mid), deadClaim(live, mid));

    /* ----- 2. the list is not held hostage by it ----- */
    (() => {
      const addIn = free('FW')[0], addOut = mine('FW')[0];
      if (!addIn || !addOut) { t('setup: a forward to swap', false); return; }
      const added = { in: addIn.id, out: addOut.id };
      setClaims(mid, [...myClaims(mid), added]);
      const now = myClaims(mid);
      t('he can still add a request with a stale line on the list',
        now.some(c => c.in === added.in && c.out === added.out), `${now.length} on the list`);
      t('and the stale line was dropped rather than locking it',
        !now.some(c => c.in === stale.in && c.out === stale.out));
      t('the healthy line he did not touch is untouched',
        now.some(c => c.in === live.in && c.out === live.out));
      t('and he is told what was dropped and why',
        /no longer in your squad/.test(document.querySelector('#toast')?.textContent || ''),
        document.querySelector('#toast')?.textContent || 'no toast');
    })();

    /* ----- 3. and deleting works too — the other half of his report ----- */
    (() => {
      state.claims = { [currentGwIndex()]: { [mid]: [live, stale] } };
      const arr = [...myClaims(mid)];
      arr.splice(arr.findIndex(c => c.in === live.in), 1);   // withdraw the healthy one
      setClaims(mid, arr);
      t('he can withdraw a request with a stale line on the list',
        !myClaims(mid).some(c => c.in === live.in), `${myClaims(mid).length} left`);
      t('and the stale line goes with it rather than blocking the delete',
        myClaims(mid).length === 0, JSON.stringify(myClaims(mid)));
    })();

    /* ----- 4. pruning must never eat the line just asked for -----
       The prune is for lines that were ALREADY dead. A line the manager is
       lodging now is checked first and refused to his face, or he would get a
       receipt saying "Claim lodged" for something silently thrown away. */
    (() => {
      const src = (window.bindTransfers || function () {}).toString();
      t('the claim button checks the new line before lodging it',
        /const bad = deadClaim\(\{ in: inId, out: outId \}, mid\)/.test(src)
        && /if \(bad\) \{ toast\(bad\); return; \}/.test(src));
      // and the order matters: checked before the list is sent, not after
      t('and it does so before setClaims is called',
        src.indexOf('const bad = deadClaim(') < src.indexOf('await setClaims('));
    })();

    /* ----- 5. a dead line is visible on the ladder, not just on save ----- */
    (() => {
      state.claims = { [currentGwIndex()]: { [mid]: [live, stale] } };
      state.view = 'transfers'; transfersView.tab = 'claims'; render();
      const rows = [...document.querySelectorAll('.claim-row')];
      const deadRows = rows.filter(r => r.classList.contains('claim-dead'));
      t('the jammed line is flagged on the Waiver list itself',
        rows.length === 2 && deadRows.length === 1, `${deadRows.length} of ${rows.length} flagged`);
      t('and the flag explains it rather than just marking it',
        /no longer in your squad/.test(deadRows[0]?.querySelector('.claim-dead-tag')?.title || ''),
        deadRows[0]?.querySelector('.claim-dead-tag')?.title || 'no tag');
    })();

    /* ----- 6. the desk's reason reaches the manager ----- */
    (() => {
      const sheet = claimFailedSheet.toString();
      t('the failure sheet can carry the league\'s own reason',
        /function claimFailedSheet\(inP, outP, why = ''\)/.test(sheet) && /The league refused this request/.test(sheet));
      t('and only blames the connection when nobody gave a reason',
        /Usually a dropped connection/.test(sheet) && /\$\{why\s*\n?\s*\?/.test(sheet.replace(/\r/g, '')));
      // rendered with a reason, it must show the reason and NOT the network guess
      claimFailedSheet(PLAYER_BY_ID[live.in], PLAYER_BY_ID[live.out], 'the drop player is not in your squad');
      const ov = document.querySelector('#claimFailed');
      const txt = ov ? ov.textContent.replace(/\s+/g, ' ') : '';
      t('a refusal shows what the league said',
        /The league refused this request: the drop player is not in your squad/.test(txt), txt.slice(0, 140));
      t('and does not blame the connection for it',
        !/Usually a dropped connection/.test(txt));
      t('it points him at the list where the jammed line is marked',
        /Waiver list tab/.test(txt) && /will not land/.test(txt));
      closeOv(ov);
      // with no reason, the old network advice is still the right advice
      claimFailedSheet(PLAYER_BY_ID[live.in], PLAYER_BY_ID[live.out], '');
      const ov2 = document.querySelector('#claimFailed');
      t('a genuine dropped connection still reads as one',
        /Usually a dropped connection/.test(ov2 ? ov2.textContent : ''));
      closeOv(ov2);
    })();

    /* ----- 7. the weekly test now asks everything the desk asks -----
       functions/index.js refuses a claim on four counts: unknown player, one
       you already own, a drop man who is not yours, and a swap that leaves an
       illegal squad. Anything the client does not ask, the desk asks for it —
       and that is a lockout, because the desk refuses the WHOLE list. */
    (() => {
      const ownedIn = { in: mine('MF')[1].id, out: mine('MF')[0].id };
      t('a man you already own is refused', /already been signed/.test(deadClaim(ownedIn, mid)),
        deadClaim(ownedIn, mid));
      t('an unknown player is refused', /no longer in the feed/.test(deadClaim({ in: -1, out: mine('DF')[0].id }, mid)));
      /* A swap that leaves an illegal squad. Rather than assume a shape the
         demo happens to have — a conditional assertion that quietly does not
         run is worth nothing — hunt for a pair the rules genuinely refuse and
         insist deadClaim refuses it for that reason and no other. */
      const sq = squadAt(mid, tgw);
      let illegal = null;
      for (const out of sq) {
        for (const inP of PLAYERS) {
          if (owned.has(inP.id) || arrivalLocked(inP)) continue;
          if (squadShapeOk([...sq.filter(x => x.id !== out.id), inP])) continue;
          illegal = { in: inP.id, out: out.id };
          break;
        }
        if (illegal) break;
      }
      t('(setup) the rules do refuse some swap out of this squad', !!illegal);
      t('a swap that would leave an illegal squad is refused',
        !!illegal && /would leave an illegal squad/.test(deadClaim(illegal, mid)),
        illegal ? deadClaim(illegal, mid) : 'none found');
    })();

    return log;
  });

  for (const line of log) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors while unjamming the ladder', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[claim-jam] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
