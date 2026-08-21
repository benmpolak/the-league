/* Asking the assistant manager back (Marc, 21 Aug: "i want to be able to have
 * a conversation with it. eg should i start osula or emersonn").
 *
 * The property that matters: he answers out of the SAME projections as the
 * briefing above him, so he can never quote a number the rest of the site
 * disagrees with. The second: when he does not understand, he says so. A No. 2
 * who bluffed would be worse than one with a narrow brief.
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

  const report = await page.evaluate(() => {
    const out = [];
    const ok = (n, c, d = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);
    const txt = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, '"').replace(/\s+/g, ' ').trim();

    state = buildDemoState(); state.phase = 'season';
    whoami = state.managers[0].id;
    const mid = whoami, gw = 0;
    // a full round, or every projection is zero and nothing is decidable
    const clubs = [...new Set(PLAYERS.map(x => x.team))];
    state.fixtures = [];
    for (let k = 0; k + 1 < clubs.length; k += 2)
      state.fixtures.push({ gw: GAMEWEEKS[0].n, home: clubs[k], away: clubs[k + 1], finished: false });

    const squad = squadAt(mid, gw);
    const [a, c] = squad.filter(x => x.pos === 'FW').slice(0, 2);
    const ask = q => txt(assistantAnswer(mid, gw, q));

    /* ---- the question Marc actually asked ---- */
    const head = ask(`should i start ${a.name} or ${c.name}`);
    const winner = assistantGwProj(a, gw) >= assistantGwProj(c, gw) ? a : c;
    ok('names both men and picks one', head.includes(a.name) && head.includes(c.name));
    ok('the pick agrees with the projections the briefing uses', head.includes(winner.name),
      `${a.name} ${assistantGwProj(a, gw).toFixed(1)} v ${c.name} ${assistantGwProj(c, gw).toFixed(1)}`);
    ok('shows its working, so the call can be argued with',
      head.includes(assistantGwProj(a, gw).toFixed(1)) && head.includes(assistantGwProj(c, gw).toFixed(1)));

    /* ---- the same question, phrased the ways a person phrases it ---- */
    const forms = [`${a.name} or ${c.name}`, `${a.name} or ${c.name}?`, `shall i play ${a.name} or ${c.name}`,
      `${a.name} vs ${c.name}`, `${a.name}/${c.name}`, `WHO SHOULD I START ${a.name} OR ${c.name}`];
    ok('understands every phrasing of the same question',
      forms.every(f => ask(f).includes(winner.name)), `${forms.length} forms`);

    /* ---- one name is a fitness question ---- */
    const solo = ask(`is ${a.name} fit`);
    ok('a single name gets a fitness read', solo.includes(a.name) && /fit|flagged|injured|suspended|fixture|left the Premier/i.test(solo));
    ok('a bare surname works too', ask(a.name).includes(a.name));

    /* ---- a man with no fixture is not a selection dilemma ---- */
    const blank = squad.find(x => !teamFixturesInGw(x.team, GAMEWEEKS[gw].n).length);
    if (blank) {
      ok('a blank gameweek is called decisively', /no fixture|cannot score from the sofa/i.test(ask(blank.name)), blank.name);
    } else {
      state.fixtures = state.fixtures.filter(f => f.home !== a.team && f.away !== a.team);
      ok('a blank gameweek is called decisively', /no fixture|cannot score from the sofa/i.test(ask(a.name)), a.name);
      for (let k = 0; k + 1 < clubs.length; k += 2)
        if (!state.fixtures.some(f => f.home === clubs[k] || f.away === clubs[k]))
          state.fixtures.push({ gw: GAMEWEEKS[0].n, home: clubs[k], away: clubs[k + 1], finished: false });
    }

    /* ---- and he admits what he cannot do ---- */
    ok('an unknown name is admitted, not guessed at', /no one called/i.test(ask('zzzznobody or alsonobody')));
    ok('an unanswerable question is refused in character', /above my pay grade/i.test(ask('what do you make of my midfield')));
    ok('an empty question says nothing at all', assistantAnswer(mid, gw, '   ') === '');
    ok('he never invents a verdict he cannot support',
      !/definitely|guaranteed|certain to score/i.test(head));
    return out.join('\n');
  });

  for (const line of report.split('\n')) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));

  /* ---- and it works as a control, not just as a function ---- */
  await page.evaluate(() => { teamView.mid = whoami; teamView.gw = 0; state.view = 'team'; render(); });
  await new Promise(r => setTimeout(r, 500));
  const names = await page.evaluate(() => squadAt(whoami, 0).filter(x => x.pos === 'FW').slice(0, 2).map(x => x.name));
  await page.type('#asstAsk', `${names[0]} or ${names[1]}`);
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 500));
  const ui = await page.evaluate(() => ({
    answered: !!document.querySelector('.asst-answer'),
    focus: document.activeElement?.id,
    kept: document.querySelector('#asstAsk')?.value || '',
  }));
  chk('Enter asks the question', ui.answered);
  chk('the question stays in the box for a follow-up', ui.kept.includes(names[0]), ui.kept);
  chk('and the cursor stays where it was', ui.focus === 'asstAsk', ui.focus);
  chk('no page errors while asking', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[assistant] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
