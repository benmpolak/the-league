/* The quieter feed (64fa800; Ben, 13 Oct 2026: "Cunthanger media is a bit
 * overwhelming"). Pins, against a real round's stats in the stubbed harness:
 *   1. assists and yellow cards no longer post
 *   2. a goal by a man nobody owns (the Trough) no longer posts; goals for
 *      the twelve squads, hauls and reds still do
 *   3. team news posts while it is three days old or less, not ten
 * Fable's review, 15 Oct 2026, asked for the fixture. Harness as
 * transfers-desk.smoke.js: twelve squads drafted by rating, the real season's
 * stats pulled in by syncNow, so the round has real assists, bookings and
 * Trough goals to stay quiet about. */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';
// the service worker would fetch sync.js past the request block (5458de9)
const noLiveFirebase = pg => pg.evaluate(() => !performance.getEntriesByType('resource').some(e => /gstatic\.com\/firebasejs/.test(e.name)));
let fail = 0, n = 0;
const chk = (name, cond, extra = '') => { n++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond || !extra ? '' : ' — ' + extra}`); if (!cond) fail++; };
const J = x => JSON.stringify(x);
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const p = await browser.newPage();
  await p.setBypassServiceWorker(true);
  p.on('pageerror', e => { fail++; console.log('PAGEERROR', e.message.split('\n')[0]); });
  await p.setViewport({ width: 1100, height: 900 });
  await p.setRequestInterception(true);
  p.on('request', req => req.url().endsWith('/js/sync.js') ? req.abort() : req.continue());
  await p.goto(baseUrl + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof state !== 'undefined' && typeof Cunthanger !== 'undefined');
  const seeded = await p.evaluate(async () => {
    window.WCSync = {
      league: 'the-league-2627',
      call: () => Promise.resolve({ ok: true }),
      auth: { user: () => ({ uid: 'u-test', email: 'ben@example.com' }), sendLink: () => Promise.resolve(), completeLink: () => Promise.resolve(false), signOut: () => Promise.resolve() },
    };
    const s = freshState(); s.phase = 'season'; s.draft.order = s.managers.map(m => m.id);
    const byPos = { GK: [], DF: [], MF: [], FW: [] };
    for (const q of PLAYERS) if (!hasLeft(q) && !arrivalLocked(q)) byPos[q.pos].push(q);
    for (const pos of Object.keys(byPos)) byPos[pos].sort((a, b) => rating(b) - rating(a));
    const need = { GK: 2, DF: 5, MF: 4, FW: 3 };
    let k = 0;
    s.managers.forEach((m, i) => {
      for (const pos of Object.keys(need)) for (let j = 0; j < need[pos]; j++) {
        const q = byPos[pos][i * need[pos] + j];
        s.draft.picks.push({ managerId: m.id, playerId: q.id, code: q.code ?? null, n: ++k });
      }
    });
    window.onSharedSnapshot(JSON.parse(JSON.stringify({ phase: s.phase, managers: s.managers, settings: s.settings, draft: s.draft, lineups: {}, transfers: [], trades: [], covenants: [], waiverMeta: s.waiverMeta, adjustments: {}, shirtNums: {}, draftPool: null, windowDraft: null, tradeBlock: {}, benchOrders: {}, lobus: {}, hamCup: null })));
    await new Promise(r => setTimeout(r, 50));
    window.onAuthChanged({ uid: 'u-test', email: 'ben@example.com' });
    window.onMembershipSnapshot({ managerId: 1, role: 'commissioner' });
    window.onPrivateSnapshot({});
    window.__autoConfirm = true;
    await syncNow(false); // the snapshot carries no stats; the real season's land here
    // Ben, 19 Oct 2026: a live GW7 made the settled-round precondition fail.
    // Keep this synthetic fixture through the latest completed round, so the
    // feed assertions exercise settled data even while today's games are live.
    const settled = lastFinalGw();
    for (let g = settled + 1; g < GAMEWEEKS.length; g++) delete state.matchStats[`gw${GAMEWEEKS[g].n}`];
    state.liveStats = null;
    return { round: vidiRound(), status: vidiRound() != null ? gwStatus(vidiRound()) : null };
  });
  chk('a settled round with stats to post about', seeded.round != null && seeded.status === 'final', J(seeded));

  /* 1 and 2 — match events */
  const feed = await p.evaluate(() => {
    const g = vidiRound();
    const owned = ownedIdsAt(g);
    const v = Object.entries(gwEvent(g).playerStats);
    const raw = {
      assists: v.filter(([, s]) => s.a).length,
      yellows: v.filter(([, s]) => s.yc && !s.rc).length,
      troughGoals: v.filter(([pid, s]) => s.g && !owned.has(+pid)).length,
      ownedGoals: v.filter(([pid, s]) => s.g && owned.has(+pid)).length,
      reds: v.filter(([, s]) => s.rc).length,
    };
    const ev = cunthangerEvents();
    const types = {};
    for (const e of ev) types[e.type] = (types[e.type] || 0) + 1;
    const posts = cunthangerPosts();
    return { g, raw, types,
      troughGoals: ev.filter(e => e.type === 'goal' && e.role === 'trough').length,
      troughHauls: ev.filter(e => e.type === 'haul' && e.role === 'trough').length,
      quietPosts: posts.filter(x => /:(assist|yellow)(:|$)/.test(x.key)).length, posts: posts.length };
  });
  chk('the round has assists, bookings and Trough goals to stay quiet about', feed.raw.assists > 0 && feed.raw.yellows > 0 && feed.raw.troughGoals > 0, J(feed.raw));
  chk('no assist and no yellow card posts', !feed.types.assist && !feed.types.yellow, J(feed.types));
  chk('no goal by a man nobody owns posts; every owned scorer still does', feed.troughGoals === 0 && feed.types.goal === feed.raw.ownedGoals, J([feed.types.goal, feed.raw]));
  chk('reds still post whoever owns the man; hauls only for the twelve squads', (feed.types.red || 0) === feed.raw.reds && feed.troughHauls === 0, J([feed.types, feed.raw.reds]));
  chk('nothing on the composed timeline is an assist or a booking', feed.quietPosts === 0 && feed.posts > 0, J([feed.quietPosts, feed.posts]));

  /* 3 — team news, three days and no more */
  const news = await p.evaluate(() => {
    const g = vidiRound(), now = Date.now(), H = 3600e3, D = 24 * H;
    // four fit men in one squad, flagged at four ages either side of the line
    const [fresh, edgeIn, edgeOut, stale] = squadAt(1, g).filter(p => p.status === 'a');
    const flag = (p, status, news, age) => { Object.assign(p, { status, news, newsAdded: new Date(now - age).toISOString() }); return p.id; };
    const ids = {
      fresh: flag(fresh, 'i', 'Hamstring injury - Expected back 24 Oct', 2 * D),
      edgeIn: flag(edgeIn, 'd', 'Knock - 75% chance of playing', 3 * D - H),
      edgeOut: flag(edgeOut, 'd', 'Illness - 50% chance of playing', 3 * D + H),
      stale: flag(stale, 'i', 'Ankle injury - Expected back 7 Nov', 5 * D),
    };
    const inj = cunthangerEvents().filter(e => e.type === 'injury');
    const posted = inj.map(e => +e.key.split(':')[1]);
    return { ids, posted, allFresh: inj.every(e => e.sortKick > now - 3 * D), n: inj.length };
  });
  chk('team news two days old posts, and so does news just inside three', news.posted.includes(news.ids.fresh) && news.posted.includes(news.ids.edgeIn), J(news));
  chk('news just past three days is skipped', !news.posted.includes(news.ids.edgeOut), J(news));
  chk('five-day-old news, which the old ten-day window posted, is skipped', !news.posted.includes(news.ids.stale), J(news));
  chk('every team-news post is three days old or less', news.allFresh && news.n >= 2, J(news));

  chk('no page loaded the live Firebase SDK', await noLiveFirebase(p));
  await browser.close();
  console.log(`\n[feedtrim] ${n - fail} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
