/* Match highlights on Sky Sports Football.
 *
 * Marc, 22 Aug: "the highlights are just giving a generic link to youtube, not
 * the youtube links to the specific match." The link WAS pointed at Sky's
 * channel search — but four of our club names are FPL abbreviations that appear
 * in no video title anywhere ("Man Utd", "Spurs", "Nott'm Forest", "Man City"),
 * so those searches returned nothing and read as a generic channel page.
 *
 * The failure is silent by nature: a bad query still renders a perfectly valid
 * link. So this pins the query text rather than the markup, and guards against
 * a future feed introducing another abbreviation nobody notices for a month.
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
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof skyName === 'function');

  const report = await page.evaluate(() => {
    const out = [];
    const ok = (n, c, d = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

    // the four that were actually broken
    const fixed = { 'Man Utd': 'Manchester United', 'Man City': 'Manchester City', 'Spurs': 'Tottenham', "Nott'm Forest": 'Nottingham Forest' };
    for (const [ours, theirs] of Object.entries(fixed)) {
      ok(`"${ours}" is asked for as "${theirs}"`, skyName(ours) === theirs, skyName(ours));
    }

    // and nothing else in the league still carries a form a title would not use
    const suspect = TEAMS.map(t => t.name).filter(n => {
      const s = skyName(n);
      return /['’]/.test(s) || /\b(Utd|Spurs|Nott)\b/.test(s);
    });
    ok('no club is still searched for by an FPL abbreviation', suspect.length === 0, suspect.join(', ') || 'all clean');

    // a real fixture, end to end
    const f = state.fixtures.find(x => x.hs != null && x.as != null) || state.fixtures[0];
    const url = highlightsUrl(f);
    const q = decodeURIComponent((url.split('query=')[1] || ''));
    ok('the link goes to Sky Sports Football, not YouTube at large', url.startsWith('https://www.youtube.com/@SkySportsFootball/search?query='), url.split('?')[0]);
    ok('the query names both clubs', q.includes(skyName(f.home)) && q.includes(skyName(f.away)), q);
    ok('the query carries the score, which is what pins the exact video',
      f.hs == null || q.includes(`${f.hs}-${f.as}`), q);
    ok('the query is encoded, so a club with a space survives', !/ /.test(url.split('query=')[1] || ''));

    // The two call sites — the fixture list and the match centre — must not
    // drift. Force a finished fixture on screen rather than accepting "none
    // rendered", which would pass without testing anything.
    const shown = state.fixtures.filter(x => x.gw === f.gw);
    shown.forEach(x => { x.started = true; x.finished = true; });
    state.phase = 'season'; // the fixture grid stays empty in setup phase
    state.view = 'fixtures'; fxView.gw = f.gw; render();
    const links = [...document.querySelectorAll('.fx-yt')].map(a => a.getAttribute('href'));
    ok('every finished fixture on the list carries a link', links.length === shown.length, `${links.length}/${shown.length}`);
    ok('and each is exactly what the builder produces',
      links.length > 0 && shown.every(x => links.includes(highlightsUrl(x))),
      links.length ? 'all match' : 'none rendered');
    // decode first: "Nottingham" contains "Nott", so testing the raw href
    // would flag the very name we just corrected
    const queries = links.map(h => decodeURIComponent(h.split('query=')[1] || ''));
    const bad = queries.filter(q => /\bMan Utd\b|\bMan City\b|\bSpurs\b|Nott'm/.test(q));
    ok('no link still asks for an FPL abbreviation', bad.length === 0, bad[0] || queries[0]);
    return out.join('\n');
  });

  for (const line of report.split('\n')) chk(line.replace(/^(PASS|FAIL)\s+/, ''), line.startsWith('PASS'));
  chk('no page errors building highlight links', pageErrors.length === 0, pageErrors.join(' | '));

  console.log(`\n[highlights] ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
