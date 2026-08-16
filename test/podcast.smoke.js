/* The Podcunt Network — the contract, not the jokes.
 *
 * What must hold: every phone generates the identical episode (Ben's hard
 * rule), the generator emits PLAIN text so app.js can escape once, hostile
 * team names cannot break out through either the transcript or the spoken
 * line, and the schedule publishes when it says it does.
 *
 * Usage: node test/podcast.smoke.js   (TEST_BASE_URL, CHROME_BIN as usual)
 */
'use strict';
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';

let pass = 0, fail = 0;
const chk = (name, ok, detail = '') => {
  if (ok) pass++; else { fail++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(baseUrl + '?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof Podcast !== 'undefined');

  /* ---- P1: the pilot exists before a draft, for both shows ---- */
  const p1 = await page.evaluate(() => {
    const g = Podcast.episode('gfw', 'pilot', null), t = Podcast.episode('tt', 'pilot', null);
    return {
      both: !!g && !!t,
      distinctTitles: g.title !== t.title,
      hasTheme: g.blocks[0].t === 'theme' && t.blocks[0].t === 'theme',
      adsEach: [g, t].map(e => e.blocks.filter(b => b.t === 'ad').length),
      hostsDiffer: g.show.host !== t.show.host,
    };
  });
  chk('P1 both shows publish a pilot, themed, with two ad breaks each',
    p1.both && p1.distinctTitles && p1.hasTheme && p1.hostsDiffer
    && p1.adsEach.every(n => n === 2), JSON.stringify(p1));

  /* ---- P2: determinism. Same state, same bytes, every time ---- */
  const p2 = await page.evaluate(() => {
    const once = JSON.stringify(Podcast.episode('gfw', 'pilot', null));
    const twice = JSON.stringify(Podcast.episode('gfw', 'pilot', null));
    // and again after churning Math.random, which must not be involved at all
    for (let i = 0; i < 500; i++) Math.random();
    const thrice = JSON.stringify(Podcast.episode('gfw', 'pilot', null));
    return { stable: once === twice && twice === thrice, len: once.length };
  });
  chk('P2 episodes are byte-identical across calls and immune to the RNG',
    p2.stable && p2.len > 500, JSON.stringify(p2));

  /* ---- P3: the generator emits PLAIN text (app.js escapes once) ---- */
  const p3 = await page.evaluate(() => {
    const src = Podcast.episode('gfw', 'pilot', null);
    const text = src.blocks.map(b => b.text || '').join(' ');
    return { noEntities: !/&(amp|lt|gt|quot|#\d+);/.test(text), sample: text.slice(0, 40) };
  });
  chk('P3 transcripts are plain text, never pre-escaped', p3.noEntities, JSON.stringify(p3));

  /* ---- P4: a hostile team name cannot break out of the transcript ---- */
  const p4 = await page.evaluate(() => {
    whoami = state.managers[0].id; syncNow = async () => {};
    // every club, so whichever the episode happens to name is hostile
    state.managers.forEach((m, k) => {
      m.team = k % 2 ? '<img src=x onerror=alert(1)>' + k : '"><script>alert(2)</script>' + k;
    });
    state.draft.order = state.managers.map(m => m.id);
    state.phase = 'draft'; state.draft.picks = [];
    const taken = new Set(); let g = 400;
    while (g-- > 0) {
      const on = currentManagerId(); if (on == null) break;
      const best = PLAYERS.filter(p => !taken.has(p.id) && canPick(on, p)).sort((a, b) => rating(b) - rating(a))[0];
      if (!best) break;
      taken.add(best.id); state.draft.picks.push({ managerId: on, playerId: best.id, n: state.draft.picks.length + 1 });
    }
    state.phase = 'season';
    const ep = Podcast.episode('tt', 'draft', null);
    const raw = ep.blocks.map(b => b.text || '').join(' ');
    // the transcript carries the hostile name literally — case-insensitively,
    // because talkTROUGH SHOUTS the club names and <IMG> is every bit as live
    // an element as <img>
    const carries = /<img|<script/i.test(raw);
    // ...and the rendered sheet must contain no live element from it
    podcastSheet(ep.id);
    const room = document.querySelector('.pod-room');
    const escaped = !!room && !room.querySelector('img[src="x"]') && !room.querySelector('script');
    const shown = !!room && /<img src=x|<script>alert/i.test(room.textContent);
    document.querySelectorAll('.pod-room').forEach(x => x.closest('.overlay')?.remove());
    return { carries, escaped, shown };
  });
  chk('P4 hostile team names render as text, never as elements',
    p4.carries && p4.escaped && p4.shown, JSON.stringify(p4));

  /* ---- P5: the schedule. Friday 17:00 London, and an hour after full time ---- */
  const p5 = await page.evaluate(() => {
    const at = Podcast._previewAt(0), rv = Podcast._reviewAt(0);
    const k = gwKicks(0);
    const london = ms => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return {
      previewIsFriday5: /Fri/.test(london(at)) && /17:00/.test(london(at)),
      previewBeforeKickoff: at < k.first,
      reviewAfterLastKick: rv > k.last,
      reviewGapHours: Math.round((rv - k.last) / 3600e3),
    };
  });
  chk('P5 preview lands Friday 17:00 London before kick-off; review lands after the last match',
    p5.previewIsFriday5 && p5.previewBeforeKickoff && p5.reviewAfterLastKick && p5.reviewGapHours === 3,
    JSON.stringify(p5));

  /* ---- P6: nothing is published before its time ---- */
  const p6 = await page.evaluate(() => {
    const k = gwKicks(0);
    const early = Podcast.published(k.first - 30 * 24 * 3600e3).filter(e => e.kind === 'preview');
    const late = Podcast.published(Podcast._previewAt(0) + 1000).filter(e => e.kind === 'preview' && e.gw === 0);
    return { noneEarly: early.length === 0, someLate: late.length === 2 };
  });
  chk('P6 an episode appears only once its publish time has passed',
    p6.noneEarly && p6.someLate, JSON.stringify(p6));

  /* ---- P7: the two registers genuinely differ on the same facts ---- */
  const p7 = await page.evaluate(() => {
    const g = Podcast.episode('gfw', 'draft', null), t = Podcast.episode('tt', 'draft', null);
    const gt = g.blocks.map(b => b.text).join(' '), tt = t.blocks.map(b => b.text).join(' ');
    const shouty = s => (s.match(/[A-Z]{4,}/g) || []).length;
    return { ttShouts: shouty(tt), gfwShouts: shouty(gt), sameGrader: g.blocks.length > 0 && t.blocks.length > 0 };
  });
  chk('P7 talkTROUGH shouts and Gazette Football Weekly does not',
    p7.ttShouts > p7.gfwShouts * 2 && p7.sameGrader, JSON.stringify(p7));

  /* ---- P8: the media desk reaches the reading room ---- */
  const p8 = await page.evaluate(() => {
    const html = mediaSection();
    return { has: /Media Desk/.test(html), bothShows: /Gazette Football Weekly/.test(html) && /talkTROUGH/.test(html) };
  });
  chk('P8 the reading room lists both shows', p8.has && p8.bothShows, JSON.stringify(p8));

  chk('P9 no page errors across the run', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n[podcast] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
