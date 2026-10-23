/* The press room shows the round being PLAYED.
 *
 * Marc, 23 Oct 2026: "why cant i see gw 8 news conferences". GW8's deadline
 * had passed three hours earlier and it did not finish for another eight days,
 * and in that window his own pre-match answers were nowhere on the page: the
 * "before" block stopped being built the moment the round kicked off, and the
 * "after" block does not exist until it is over. Nothing was lost — the
 * pressers were keyed under the round the whole time and simply never asked
 * for — but a week of saying nothing you can see is a week of saying nothing.
 *
 * CI serves the site on 8125, like every other smoke in here. Defaulting to a
 * side port passes locally, fails there, and the release gate then refuses
 * every deploy (11 Oct 2026, two hours of frozen data on a match day).
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
  await page.goto(baseUrl + '?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && state.managers.length === 12);

  // Marc's exact shape: earlier rounds done, one kicked off hours ago and not
  // due to finish for days, the next not started.
  const report = await page.evaluate(() => {
    const out = [];
    const ok = (n, c, d = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
    state = buildDemoState(); state.phase = 'season';
    myId = whoami = state.managers[0].id;

    const PLAY = 7;                                  // the round being played
    for (let i = 0; i < GAMEWEEKS.length; i++) GAMEWEEKS[i].finished = i < PLAY;
    const started = new Date(Date.now() - 3 * 3600e3).toISOString();
    const ends = new Date(Date.now() + 8 * 864e5).toISOString();
    GAMEWEEKS[PLAY].from = started; GAMEWEEKS[PLAY].deadline = started; GAMEWEEKS[PLAY].to = ends;
    GAMEWEEKS[PLAY + 1].from = ends; GAMEWEEKS[PLAY + 1].deadline = ends;
    demoGwOverride = PLAY;
    const said = 'Its a shame Newcastle are shite';
    state.pressers = {};
    state.pressers[myId] = { [presserKey(PLAY, 'pre')]: { answers: [{ id: 'q1', q: 'Talk us through it.', tone: 'blunt', text: said }] } };

    ok('(setup) the round has kicked off and has not finished',
      gwHasStarted(PLAY) && gwStatus(PLAY) !== 'final',
      `started ${gwHasStarted(PLAY)}, status ${gwStatus(PLAY)}`);

    const html = pressConferencesRoom();
    const labels = [...html.matchAll(/class="ch-tile-label">([^<]*)/g)].map(m => m[1].trim());
    const n = GAMEWEEKS[PLAY].n;
    ok(`the round being played has a block of its own (GW${n})`,
      labels.some(l => l.includes(`Before Gameweek ${n}`)), labels.join(' | '));
    ok('and it carries what was actually said', html.includes(said));
    ok('it says why that round has no after-match block yet',
      labels.some(l => /Before Gameweek \d+ — this round is being played/.test(l)),
      labels.find(l => l.includes(`Before Gameweek ${n}`)) || 'no such label');
    ok('the next round still gets its own before-match block',
      labels.some(l => l.includes(`Before Gameweek ${GAMEWEEKS[PLAY + 1].n}`)), labels.join(' | '));
    ok('no round is listed twice',
      new Set(labels).size === labels.length, labels.join(' | '));

    /* (control) once the round finishes it must NOT appear twice — the
       in-play block and the last-finished block would both claim it. */
    // gwStatus only reads 'final' once the round has stats on the board, so
    // flipping the flag alone leaves it 'underway' and proves nothing
    GAMEWEEKS[PLAY].finished = true;
    GAMEWEEKS[PLAY].to = new Date(Date.now() - 3600e3).toISOString();
    const ps = {};
    for (const pk of state.draft.picks) ps[pk.playerId] = { min: 90, st: 1, g: 0, a: 0, cs: 0 };
    state.matchStats['gw' + GAMEWEEKS[PLAY].n] = { gw: PLAY, label: GAMEWEEKS[PLAY].label, final: true, playerStats: ps };
    ok('(setup) and now it really has gone final', gwStatus(PLAY) === 'final', gwStatus(PLAY));
    const after = [...pressConferencesRoom().matchAll(/class="ch-tile-label">([^<]*)/g)].map(m => m[1].trim());
    ok('(control) when it finishes it is listed once, not twice',
      after.filter(l => l.includes(`Before Gameweek ${n}`)).length === 1, after.join(' | '));
    ok('(control) and it stops claiming to be in play',
      !after.some(l => /this round is being played/.test(l) && l.includes(`Gameweek ${n}`)), after.join(' | '));

    demoGwOverride = null;
    return out;
  });

  for (const line of report) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log(`\n[press-room] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
