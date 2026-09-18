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
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8125';
// the league state the shipped audio was cut from (written by render_pods
// --state). The audio checks regenerate episodes from THIS state — a fresh
// page invents its own league and every real-state line reads as an orphan.
const SEED_FILE = path.join(__dirname, '..', 'audio', 'pod', 'league-state.json');

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

  /* The audio checks run HERE, before P4 rewrites every team name to something
     hostile. The pilots quote real team names, so once P4 has been through the
     state the transcripts no longer match the audio that was rendered from
     them — and the coverage check would report a wall of false gaps. */
  /* ---- P13: the audio on disk still belongs to the words on screen.

     Recordings are filed by line key — a hash of what is said — so the hard
     contract is that every file the manifest ships corresponds to a line that
     still exists. An ORPHAN means a script changed and left audio behind: at
     best money spent on a line nobody will hear, at worst the first sign that
     the mapping has drifted. That is a failure.

     A line with no audio is NOT a failure. It is the normal state between a
     script edit and Ben's next render, and the player just reads it aloud. So
     the outstanding lines are reported rather than failed — the number is what
     the next render will cost. ---- */
  let audioPage = page;
  if (fs.existsSync(SEED_FILE)) {
    audioPage = await browser.newPage();
    audioPage.on('dialog', d => d.accept());
    await audioPage.evaluateOnNewDocument(s => localStorage.setItem('tl2627sb-league', s), fs.readFileSync(SEED_FILE, 'utf8'));
    await audioPage.goto(baseUrl + '?sandbox&nosync', { waitUntil: 'networkidle2' });
    await audioPage.waitForFunction(() => typeof Podcast !== 'undefined' && typeof podRecordings !== 'undefined');
  }
  const p13 = await audioPage.evaluate(async () => {
    _podRec = null;
    const rec = await podRecordings();
    const out = { shipped: Object.keys(rec).length, orphans: [], outstanding: [], chars: 0 };
    for (const epId of Object.keys(rec)) {
      const m = epId.match(/^(gfw|tt)-(pilot|draft)$/);
      if (!m) continue; // weekly episodes move with league state; pilots are fixed
      const ep = Podcast.episode(m[1], m[2], null);
      if (!ep) continue;
      const live = new Set(ep.blocks.map(b => Podcast.lineKey(b)).filter(Boolean));
      for (const key of Object.keys(rec[epId])) {
        if (!live.has(key)) out.orphans.push(`${epId}/${key}`);
      }
      for (const b of ep.blocks) {
        const key = Podcast.lineKey(b);
        if (!key || podLineSrc(rec, epId, key)) continue;
        out.outstanding.push(`${epId} ${b.who || b.t}`);
        out.chars += (b.t === 'ad' ? `${b.brand}. ${b.text}` : b.text).length;
      }
    }
    return out;
  });
  chk('P13 no shipped recording is orphaned from the script it was cut for',
    p13.shipped > 0 && p13.orphans.length === 0,
    p13.shipped ? 'orphans: ' + p13.orphans.join(', ') : 'no audio shipped at all');
  if (p13.outstanding.length) {
    console.log(`      note: ${p13.outstanding.length} line(s) awaiting a render (~${p13.chars} chars) — ${[...new Set(p13.outstanding)].join(', ')}`);
  }
  const stableDraft = await audioPage.evaluate(() => {
    const scripts = () => ['gfw', 'tt'].map(show => JSON.stringify(Podcast.episode(show, 'draft', null)));
    const before = scripts(), saved = PLAYERS.map(p => p.pts);
    try {
      PLAYERS.forEach(p => { p.pts = (p.pts || 0) + 10000; });
      return scripts().every((s, i) => s === before[i]);
    } finally { PLAYERS.forEach((p, i) => { p.pts = saved[i]; }); }
  });
  chk('draft recordings cannot be rewritten by current-season points', stableDraft);

  // ...and the files the manifest names are really there and really audio
  const p13b = await page.evaluate(async () => {
    _podRec = null;
    const rec = await podRecordings();
    const bad = [];
    for (const [epId, lines] of Object.entries(rec)) {
      for (const n of Object.keys(lines)) {
        const src = podLineSrc(rec, epId, n);
        const r = await fetch(src, { method: 'HEAD' });
        const len = +(r.headers.get('content-length') || 0);
        // a truncated or error-page response is the tell of a failed render
        if (!r.ok) bad.push(`${src} → ${r.status}`);
        else if (len < 2048) bad.push(`${src} → only ${len} bytes`);
      }
    }
    return bad;
  });
  chk('P13b every file the manifest names is present and not a stub',
    p13b.length === 0, p13b.slice(0, 5).join('; '));


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
    // ...the sheet must not print it as a transcript at all (it is a player),
    // and the live caption must show it as text rather than build an element
    podcastSheet(ep.id);
    const room = document.querySelector('.pod-room');
    const noTranscript = !!room && room.querySelectorAll('.pod-line').length === 0;
    const now = room && room.querySelector('#podNow');
    const w = now && now.querySelector('.pod-now-who');
    const l = now && now.querySelector('.pod-now-line');
    // drive the caption the way playback does
    if (w && l) { w.textContent = 'Andy Grey'; l.textContent = raw.slice(0, 200); }
    const escaped = !!now && !now.querySelector('img') && !now.querySelector('script');
    const shownAsText = !!l && /<img|<script/i.test(l.textContent);
    document.querySelectorAll('.pod-room').forEach(x => x.closest('.overlay')?.remove());
    return { carries, noTranscript, escaped, shownAsText };
  });
  chk('P4 the sheet prints no transcript, and captions show hostile names as text',
    p4.carries && p4.noTranscript && p4.escaped && p4.shownAsText, JSON.stringify(p4));

  /* ---- P5: the schedule. Previews keep Marc's fixed Tuesday/Friday middays
     (18 Aug), bound to the gameweek rather than the calendar. Reviews publish
     at SETTLEMENT — last kick-off + 150 minutes, the same instant the table
     stamps (Ben, 24 Aug: "when the league updates") ---- */
  const p5 = await page.evaluate(() => {
    const londonDay = ms => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
    const londonHM = ms => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
    const bad = [];
    let midweek = 0;
    for (let i = 0; i < GAMEWEEKS.length; i++) {
      const k = gwKicks(i); if (!k) continue;
      const pv = Podcast._previewAt(i), rv = Podcast._reviewAt(i);
      if (pv == null || rv == null) { bad.push(`GW${i + 1} has no slot`); continue; }
      // previews: Tuesday or Friday, midday London, all year
      if (!['Tue', 'Fri'].includes(londonDay(pv))) bad.push(`GW${i + 1} preview on a ${londonDay(pv)}`);
      if (londonHM(pv) !== '12:00') bad.push(`GW${i + 1} preview at ${londonHM(pv)}`);
      // reviews: the settlement moment, in step with the engine's grace
      if (rv !== k.last + 150 * 60000) bad.push(`GW${i + 1} review not at settlement`);
      // ...and it still has to make sense as broadcasting
      if (!(pv < k.first)) bad.push(`GW${i + 1} preview lands after kick-off`);
      if (!(rv > k.last)) bad.push(`GW${i + 1} review lands before full time`);
      const nk = gwKicks(i + 1);
      if (nk && rv > nk.first) bad.push(`GW${i + 1} review lands after the next round starts`);
      if (!['Fri', 'Sat', 'Sun'].includes(londonDay(k.first))) midweek++;
    }
    return { bad, midweek };
  });
  chk('P5 previews hold Tue/Fri midday, reviews drop at settlement, each bounds its own gameweek',
    p5.bad.length === 0 && p5.midweek > 0, JSON.stringify(p5).slice(0, 300));

  /* ---- P5b: the double bill. Marc, 18 Aug: "when there is a midweek gameweek
     you can just do the review and the preview as one slightly longer episode".
     One programme per slot, one opening, one sign-off, one ad break, and one
     phone-in — not two of each stitched together ---- */
  const p5b = await page.evaluate(() => {
    // find a slot that genuinely carries both (the midweek rounds)
    let pv = null;
    for (let i = 1; i < GAMEWEEKS.length; i++) {
      const at = Podcast._previewAt(i);
      for (let r = Math.max(0, i - 3); r < i; r++) {
        if (Podcast._reviewAt(r) === at) { pv = { i, r }; break; }
      }
      if (pv) break;
    }
    if (!pv) return { none: true };
    const ep = Podcast.episode('tt', 'both', pv.i);
    if (!ep) return { built: false };
    const single = Podcast.episode('tt', 'preview', pv.i);
    const text = ep.blocks.map(b => b.text || '').join(' ');
    return {
      built: true,
      // both rounds are actually covered
      namesBoth: ep.title.includes('GW' + GAMEWEEKS[pv.r].n) && ep.title.includes('GW' + GAMEWEEKS[pv.i].n),
      // ...as one programme, not two welded together
      oneOpen: (text.match(/GAMEWEEK \d+\. DONE/g) || []).length === 1,
      // the sign-off comes from the PREVIEW half; the review's own must be gone
      oneClose: !/Back in the next slot/.test(text)
        && /GOODBYE\.$/.test((ep.blocks.filter(b => b.t === 'speech').pop() || {}).text || ''),
      oneAdBreak: (() => { const a = ep.blocks.map((b, n) => [b, n]).filter(([b]) => b.t === 'ad').map(([, n]) => n);
        return a.length === 2 && a[1] === a[0] + 1; })(),
      oneCaller: ep.blocks.filter(b => b.who === 'Howard').length === 1,
      hasBridge: /That's the midweek/.test(text),
      // and it is longer than a single episode, which is the whole point
      longer: ep.words > single.words,
    };
  });
  chk('P5b a midweek slot ships one longer double bill, not two episodes',
    p5b.none || (p5b.built && Object.values(p5b).every(v => v !== false)), JSON.stringify(p5b));

  /* ---- P6: nothing is published before its time ---- */
  const p6 = await page.evaluate(() => {
    const k = gwKicks(0);
    const early = Podcast.published(k.first - 30 * 24 * 3600e3).filter(e => e.kind === 'preview');
    const late = Podcast.published(Podcast._previewAt(0) + 1000).filter(e => e.kind === 'preview' && e.gw === 0);
    return { noneEarly: early.length === 0, someLate: late.length === 2 };
  });
  chk('P6 an episode appears only once its publish time has passed',
    p6.noneEarly && p6.someLate, JSON.stringify(p6));

  const studioTiming = await page.evaluate(() => {
    const at = Podcast._previewAt(0), hour = 3600000;
    const preview = rows => rows.some(e => e.show === 'tt' && e.kind === 'preview' && e.gw === 0);
    const status = gwStatus;
    try {
      // Synthetic settlement: a future review must not enter the paid queue
      // just because previews have look-ahead, even if its feed says final.
      gwStatus = () => 'final';
      const reviewAt = Podcast._reviewAt(0);
      return {
        summerMorning: preview(Podcast.renderQueue(at - hour, 3 * hour)),
        winterMorning: preview(Podcast.renderQueue(at - 2 * hour, 3 * hour)),
        notDaysAhead: !preview(Podcast.renderQueue(at - 4 * hour, 3 * hour)),
        notPublishedEarly: !preview(Podcast.published(at - hour)),
        noEarlyReview: !Podcast.renderQueue(reviewAt - hour, 3 * hour)
          .some(e => e.kind === 'review' && e.gw === 0),
        settledReview: Podcast.renderQueue(reviewAt, 3 * hour)
          .some(e => e.kind === 'review' && e.gw === 0),
        pausedShowStaysPaused: !Podcast.renderQueue(Podcast._previewAt(4) - hour, 3 * hour)
          .some(e => e.show === 'gfw' && e.gw >= 1),
      };
    } finally { gwStatus = status; }
  });
  chk('studio prepares imminent previews without publishing early or pre-empting settlement',
    Object.values(studioTiming).every(Boolean), JSON.stringify(studioTiming));

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
    return { has: /Media Desk|On the wireless/.test(html), bothShows: /Gazette Football Weekly/.test(html) && /talkTROUGH/.test(html) };
  });
  chk('P8 the reading room lists both shows', p8.has && p8.bothShows, JSON.stringify(p8));

  /* ---- P9: listen-only. The script must not be readable ahead of the hosts ---- */
  const p9 = await page.evaluate(() => {
    // whatever is actually published in the state P4 left behind — the pilot
    // has retired by now, which is itself correct
    const pub = Podcast.published()[0];
    const ep = Podcast.episode(pub.show, pub.kind, pub.gw);
    podcastSheet(ep.id);
    const room = document.querySelector('.pod-room');
    const txt = room ? room.textContent : '';
    // a distinctive line from deep in the episode must NOT be on the page
    const buried = ep.blocks.filter(b => b.t === 'speech').slice(-1)[0].text.slice(0, 30);
    const out = {
      noTranscript: !!room && room.querySelectorAll('.pod-line').length === 0,
      hasPlay: !!room && !!room.querySelector('#podPlay'),
      hasCast: !!room && room.querySelectorAll('.pod-chip').length >= 3,
      leaksEnding: txt.includes(buried),
    };
    document.querySelectorAll('.pod-room').forEach(x => x.closest('.overlay')?.remove());
    return out;
  });
  chk('P9 the sheet is a player: cast and a play button, no readable script',
    p9.noTranscript && p9.hasPlay && p9.hasCast && !p9.leaksEnding, JSON.stringify(p9));

  /* ---- P10: the speech desk. Marc, 18 Aug: a shouted word must not be
     spelled out like an acronym, and the splitter must not bite a word in
     half ("talkTROUGH", "I'll") on the way there ---- */
  const p10 = await page.evaluate(() => {
    const say = s => podRuns(s).map(r => (r.shout ? '[' + r.say + ']' : r.say)).join('');
    const shouts = s => podRuns(s).filter(r => r.shout).map(r => r.say);
    return {
      // abbreviations become what a broadcaster would actually say
      expands: say('Emersonn of IPS against Ballard of SUN in GW3, 12.4 pts')
        === 'Emersonn of Ipswich against Ballard of Sunderland in gameweek 3, 12.4 points',
      // a shout is handed over in lower case, so it is read as words
      lowered: shouts('It is WOKE NONSENSE and I mean it.')[0] === 'woke nonsense',
      // ...and an apostrophe inside a word is not a boundary
      apostrophe: !/\[/.test(say("I'll tell you what it is, Richard.")),
      // ...nor is a capital in the middle of one
      midWord: say('Right. talkTROUGH. Richard Keyes here.') === 'Right. talk Trough. Richard Keyes here.',
      // adjacent shouted words are ONE shout, single-letter words included
      phrase: shouts('And the FRAUD OF THE WEEK is that lot.')[0] === 'fraud of the week',
      article: shouts('A CREST. Lovely.')[0] === 'a crest',
      // a genuine initialism stays spelled
      initialism: !/\[/.test(say('VAR again.')) && /V A R/.test(say('VAR again.')),
      // no utterance is bare punctuation — an engine handed a lone "." reads
      // out its NAME, which is why the hosts kept saying "full stop"
      noBarePunctuation: Podcast.published().flatMap(p => Podcast.episode(p.show, p.kind, p.gw).blocks)
        .map(b => b.text || '').filter(Boolean)
        .every(t => podRuns(t).every(r => /[A-Za-z0-9]/.test(r.say))),
      fullStopRides: podRuns("It's WOKE NONSENSE.").slice(-1)[0].say === 'woke nonsense.',
      // and nothing is ever dropped on the floor
      lossless: (() => {
        const src = Podcast.published().flatMap(p => Podcast.episode(p.show, p.kind, p.gw).blocks)
          .map(b => b.text || '').filter(Boolean);
        return src.every(t => {
          const said = podRuns(t).map(r => r.say).join('').replace(/\s+/g, '').toLowerCase();
          const want = POD_SAY.reduce((x, [re, to]) => x.replace(re, to), t).replace(/\s+/g, '').toLowerCase();
          return said === want;
        });
      })(),
    };
  });
  chk('P10 shouted runs are spoken, not spelled, and no word is split or lost',
    Object.values(p10).every(Boolean), JSON.stringify(p10));

  /* ---- P11: recorded audio. Real voices where they exist, browser voice
     where they don't, and never a request off this origin ---- */
  const p11 = await page.evaluate(async () => {
    await _podRecPending;
    // whatever is published in the state the earlier checks left behind — the
    // pilot has retired by now, which is itself correct
    const pub = Podcast.published()[0];
    const ep = Podcast.episode(pub.show, pub.kind, pub.gw);
    const real = window.fetch;
    const asked = [];
    const spoken = ep.blocks.map((b, n) => [b, n]).filter(([b]) => b.t !== 'theme');
    /* No manifest at all — an offline copy, or a checkout from before the
       audio was cut — and every line falls to the browser voice. Stubbed
       rather than assumed: real recordings are shipped now (Ben cut both
       pilots, 18 Aug), so this can no longer be tested by looking at disk. */
    _podRec = null;
    window.fetch = () => Promise.resolve(new Response('', { status: 404 }));
    const bare = await podRecordings();
    window.fetch = real;
    const none = Object.keys(bare).length;
    const noneSrc = spoken.every(([b]) => podLineSrc(bare, ep.id, Podcast.lineKey(b)) === null);
    // now pretend ONE line has been cut by hand — the shape Howard creates
    const oneN = Podcast.lineKey(spoken[1][0]);
    _podRec = null;
    window.fetch = u => { asked.push(String(u)); return Promise.resolve(new Response(JSON.stringify({ [ep.id]: { [oneN]: oneN + '.m4a' } }), { status: 200 })); };
    const rec = await podRecordings();
    const src = podLineSrc(rec, ep.id, oneN);
    // a part-cut episode says so, rather than claiming to be fully recorded
    podcastSheet(ep.id);
    await new Promise(r => setTimeout(r, 60));
    const meta = document.querySelector('.pod-room #podMeta');
    const said = !!meta && /part recorded/.test(meta.textContent);
    window.fetch = real;
    document.querySelectorAll('.pod-room').forEach(x => x.closest('.overlay')?.remove());
    _podRec = null;
    return {
      emptyByDefault: none === 0 && noneSrc,
      // the recorded line plays its file, keeping the extension it was given
      readsManifest: src === `audio/pod/${encodeURIComponent(ep.id)}/${oneN}.m4a`,
      revisedAudio: podLineSrc({ [ep.id]: { [oneN]: { file: oneN + '.mp3', revision: 'abcdef123456' } } }, ep.id, oneN) === `audio/pod/${encodeURIComponent(ep.id)}/${oneN}.mp3?v=abcdef123456`,
      noRevisedEscape: podLineSrc({ [ep.id]: { [oneN]: { file: '../bad.mp3', revision: 'abcdef123456' } } }, ep.id, oneN) === null,
      // ...and every other line still falls through to the browser voice
      restFallBack: spoken.filter(([b]) => Podcast.lineKey(b) !== oneN).every(([b]) => podLineSrc(rec, ep.id, Podcast.lineKey(b)) === null),
      // a manifest cannot point the player outside the episode's own folder
      noEscape: podLineSrc({ [ep.id]: { 0: '../../../etc/passwd' } }, ep.id, 0) === null,
      manifestIsLocal: asked.every(u => !/^https?:\/\//i.test(u) || u.startsWith(location.origin)),
      sameOrigin: new URL(src, location.href).origin === location.origin,
      said,
    };
  });
  chk('P11 a hand-recorded line plays its file; the rest fall back to the browser',
    Object.values(p11).every(Boolean), JSON.stringify(p11));

  const recordingLoad = await page.evaluate(async () => {
    await _podRecPending;
    const realFetch = window.fetch, saved = _podRec, timelines = _podTl;
    const manifest = { 'tt-test': { line: 'line.mp3' } };
    const answer = () => new Response(JSON.stringify(manifest), { status: 200 });
    try {
      _podRec = null;
      let release, requests = 0, finished = false;
      window.fetch = () => { requests++; return new Promise(r => { release = r; }); };
      const opening = podRecordings(true);
      const playing = podRecordings(true).then(r => { finished = true; return r; });
      await Promise.resolve();
      const waitsForManifest = !finished && requests === 1;
      release(answer());
      const [a, b] = await Promise.all([opening, playing]);

      _podRec = null;
      requests = 0;
      window.fetch = async () => ++requests === 1 ? new Response('', { status: 503 }) : answer();
      await podRecordings();
      const retry = await podRecordings();
      const retriesFailure = requests === 2 && !!retry['tt-test'];

      // An episode which was missing its audio gains it during this page's
      // lifetime. Opening/playing again must also discard its null timeline.
      _podRec = {};
      _podTl = { 'tt-test': Promise.resolve(null) };
      window.fetch = async () => answer();
      const fresh = await podRecordings(true);
      const newCutAppears = !!fresh['tt-test'] && !('tt-test' in _podTl);
      window.fetch = async () => { throw Error('offline'); };
      const offline = await podRecordings(true);
      return {
        waitsForManifest,
        bothGetAudio: !!a['tt-test'] && !!b['tt-test'],
        retriesFailure,
        newCutAppears,
        preservesLastGoodIndex: !!offline['tt-test'],
      };
    } finally { window.fetch = realFetch; _podRec = saved; _podTl = timelines; }
  });
  chk('audio loads atomically, retries failures and discovers new recordings without a reload',
    Object.values(recordingLoad).every(Boolean), JSON.stringify(recordingLoad));

  const playbackLoad = await page.evaluate(async () => {
    await _podRecPending;
    const saved = { fetch: window.fetch, Audio: window.Audio, timeline: podEpTimeline,
      synth: Object.getOwnPropertyDescriptor(window, 'speechSynthesis'), rec: _podRec };
    const played = [], spoken = [];
    const block = { t: 'speech', who: 'Richard Keyes', text: 'A synthetic playback test.' };
    const ep = { id: 'tt-test', show: { host: 'Richard Keyes' }, blocks: [block] };
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    try {
      _podRec = null;
      let release;
      window.fetch = () => new Promise(r => { release = r; });
      podEpTimeline = async () => null;
      window.Audio = class { constructor(src) { this.src = src; } play() { played.push(this.src); return Promise.resolve(); } pause() {} };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true,
        value: { getVoices: () => [], speak: u => spoken.push(u.text), cancel() {}, addEventListener() {} } });
      const opening = podRecordings(true);
      const playing = podPlay(ep, btn, null);
      await Promise.resolve();
      const waits = played.length === 0 && spoken.length === 0;
      release(new Response(JSON.stringify({ 'tt-test': { [Podcast.lineKey(block)]: 'cast.mp3' } })));
      await Promise.all([opening, playing]);
      return { waits, recordedVoice: played[0] === 'audio/pod/tt-test/cast.mp3', noSubstitute: spoken.length === 0 };
    } finally {
      podStopSpeaking(); btn.remove();
      window.fetch = saved.fetch; window.Audio = saved.Audio; podEpTimeline = saved.timeline; _podRec = saved.rec;
      if (saved.synth) Object.defineProperty(window, 'speechSynthesis', saved.synth);
      else delete window.speechSynthesis;
    }
  });
  chk('pressing play during the index load plays the cast recording instead of browser speech',
    Object.values(playbackLoad).every(Boolean), JSON.stringify(playbackLoad));

  /* ---- P12: the phone-in. Marc, 18 Aug gave us Howard — one caller, one
     question, talkTROUGH only, and the part a human records. Marc, 17 Sept
     2026 opened the switchboard: "use some different callers... id like those
     characters to be on rotation as the caller."

     So every property Howard had is now a property of whoever is ON, and two
     new ones matter more than any of them: the rotation must never put
     somebody else on an episode whose audio is already cut, and each caller
     needs its own browser voice or four callers arrive as one man. ---- */
  const p12 = await page.evaluate(() => {
    const ROSTER = ['Howard', 'Raymond', 'Yakolo'];
    const callersIn = ep => (ep ? ep.blocks.filter(b => ROSTER.includes(b.who)) : []);
    const kinds = [['pilot', null], ['draft', null], ['preview', 0], ['review', 0]];
    const tt = kinds.map(([k, g]) => callersIn(Podcast.episode('tt', k, g)));
    const gfw = kinds.map(([k, g]) => callersIn(Podcast.episode('gfw', k, g)));
    const ep = Podcast.episode('tt', 'review', 0);
    const who = callersIn(ep)[0];
    return {
      // exactly one call per talkTROUGH episode, every kind — never two voices
      // on the line and never a silent switchboard
      onceEachTT: tt.every(l => l.length === 1),
      // and never on the Gazette — a phone-in is a talkTROUGH thing
      neverGfw: gfw.every(l => l.length === 0),
      // Keys takes the call and answers it, so it plays as a phone-in
      framed: (() => {
        const i = ep.blocks.findIndex(b => ROSTER.includes(b.who));
        return i > 0 && ep.blocks[i - 1].who === 'Richard Keyes'
          && !!ep.blocks[i + 1] && ep.blocks[i + 1].who === 'Richard Keyes';
      })(),
      // ...and introduced the way callers are: name, then where from
      namedAndPlaced: kinds.every(([k, g]) => {
        const e = Podcast.episode('tt', k, g);
        const i = e.blocks.findIndex(b => ROSTER.includes(b.who));
        const lead = e.blocks[i - 1].text, name = e.blocks[i].who;
        const place = { Howard: 'Prestwich', Raymond: 'Romford', Yakolo: 'Abidjan' }[name];
        return lead.includes(name) && lead.includes(place);
      }),
      // he says something about THIS gameweek, not a stock line
      fromState: state.managers.some(m => m.team && who.text.includes(m.team)),
      // and the player lists the caller with the cast, so his chip is on the sheet
      onTheBill: [...new Set(ep.blocks.filter(b => b.t === 'speech').map(b => b.who))].includes(who.who),
      // every caller has its own pitch and rate: with no recording the browser
      // speaks the line, and without these the roster is one man four times
      allVoiced: ROSTER.every(n => !!Podcast.VOICES[n]),
      distinctVoices: new Set(ROSTER.map(n => `${Podcast.VOICES[n].pitch}/${Podcast.VOICES[n].rate}`)).size === ROSTER.length,
    };
  });
  chk('P12 one caller an episode on talkTROUGH, never the Gazette, named and placed',
    Object.values(p12).every(Boolean), JSON.stringify(p12));

  /* ---- P12b: the rotation itself, and the audio it must not disturb.
     A line's recording is keyed to a hash of its text, so putting a different
     caller on an episode that has already been cut orphans real takes —
     including the hand-recorded ones a render is forbidden to replace. The
     pilots, the draft and GW1 are cut. They stay Howard's. ---- */
  const p12b = await page.evaluate(() => {
    const ROSTER = ['Howard', 'Raymond', 'Yakolo'];
    const caller = (kind, gw) => {
      const ep = Podcast.episode('tt', kind, gw);
      const c = ep ? ep.blocks.filter(b => ROSTER.includes(b.who)) : [];
      return c.length === 1 ? c[0].who : null;
    };
    const weeks = [];
    for (let g = 0; g < 20; g++) weeks.push([caller('preview', g), caller('review', g)]);
    const seen = new Set(weeks.flat().filter(Boolean));
    return {
      // the episodes that already have audio keep the caller that recorded them
      pilotIsHoward: caller('pilot', null) === 'Howard',
      draftIsHoward: caller('draft', null) === 'Howard',
      // every round with audio already cut stays Howard's: GW1 both ways, and
      // GW4's review, which Ben rendered on 16 Sept
      gw1IsHoward: weeks[0][0] === 'Howard' && weeks[0][1] === 'Howard',
      gw4ReviewIsHoward: weeks[3][1] === 'Howard',
      // Marc, 17 Sept: "Starting Raymond on the next one" — GW5's preview
      raymondOpens: weeks[4][0] === 'Raymond',
      // ...and from GW2 the rest of the switchboard gets a turn
      rotates: seen.size === ROSTER.length,
      everyoneUsed: ROSTER.every(n => seen.has(n)),
      // a given week is the same caller however many times it is drawn, or the
      // audio for that week would change under the renderer's feet
      stable: [2, 5, 9, 14].every(g => caller('preview', g) === caller('preview', g)
        && caller('review', g) === caller('review', g)),
      // Howard keeps his running joke and nobody else claims it
      howardFirstTimes: (() => {
        for (let g = 4; g < 20; g++) for (const k of ['preview', 'review']) {
          const ep = Podcast.episode('tt', k, g);
          const c = ep.blocks.find(b => ROSTER.includes(b.who));
          if (!c) return false;
          const claims = /first[ -]?time/i.test(c.text);
          if (claims && c.who !== 'Howard') return false;      // stolen
          if (c.who === 'Howard' && !claims) return false;     // dropped
        }
        return true;
      })(),
      // each caller sounds like a different KIND of call, not one shape reworded
      ownShapes: (() => {
        const shapes = {};
        for (let g = 4; g < 30; g++) for (const k of ['preview', 'review']) {
          const ep = Podcast.episode('tt', k, g);
          const c = ep.blocks.find(b => ROSTER.includes(b.who));
          if (c) (shapes[c.who] = shapes[c.who] || new Set()).add(c.text.slice(0, 40));
        }
        // more than one opening per caller: the lines vary within a character
        return Object.values(shapes).every(v => v.size > 1);
      })(),
    };
  });
  chk('P12b the rota spares the recorded episodes and gives everyone a turn',
    Object.values(p12b).every(Boolean), JSON.stringify(p12b));

  /* ---- P12e: Raymond and Yakolo. Marc, 17 Sept 2026 — Raymond (Romford, corrected by Ben on 18 Sept) "should preface every call talking about a night out he has had /
     is having", and Yakolo from Abidjan "should always ask about the
     contribution of a particular african player in the week". ---- */
  const p12e = await page.evaluate(() => {
    const callOf = (kind, gw, name) => {
      const ep = Podcast.episode('tt', kind, gw);
      const c = ep && ep.blocks.find(b => b.who === name);
      return c ? c.text : null;
    };
    // walk a season and collect every call each of them makes
    const grab = name => {
      const out = [];
      for (let g = 4; g < 33; g++) for (const k of ['preview', 'review']) {
        const t = callOf(k, g, name);
        if (t) out.push({ g, k, t });
      }
      return out;
    };
    const ray = grab('Raymond'), yak = grab('Yakolo');
    const NIGHT = /Romford|Hornchurch|pub|social club|pint|session|just up|darts/i;
    const africans = PLAYERS.filter(p => AFRICAN_NAT.has(p.nat)).map(p => p.name);
    return {
      // both of them actually get on the air
      bothOnAir: ray.length > 3 && yak.length > 3,
      // ...and both take previews AND reviews, which an even rota prevents
      rayBothKinds: new Set(ray.map(x => x.k)).size === 2,
      yakBothKinds: new Set(yak.map(x => x.k)).size === 2,
      // Raymond leads with the night out, EVERY time, which is the brief
      rayAlwaysBeenOut: ray.every(x => NIGHT.test(x.t)),
      // and it is a different night, not one anecdote on a loop
      rayVariesIt: new Set(ray.map(x => x.t.slice(0, 60))).size > 3,
      // Yakolo names a real player from the feed's own African cohort
      yakNamesAnAfrican: yak.every(x => africans.some(n => x.t.includes(n))),
      // ...and asks after his contribution, which is the whole brief
      yakAsksContribution: yak.every(x => /contribution|what did he actually do|explain his afternoon|he was not quiet/i.test(x.t)),
      // he never claims a nationality on air — a wrong cohort must cost a bad
      // joke, not a false statement about somebody
      yakClaimsNoNationality: yak.every(x => !/Niger|Ghan|Senegal|Ivor|Moroc|Congo|Algeri|Cameroon|Malian|African/i.test(x.t)),
      // and he is right about the panel: nobody on the desk said the name
      yakPanelMissedHim: yak.every(x => {
        const ep = Podcast.episode('tt', x.k, x.g);
        const man = africans.find(n => x.t.includes(n));
        return ep.blocks.filter(b => b.who !== 'Yakolo').every(b => !String(b.text).includes(man));
      }),
      /* Raymond is cheerful, never sorry for itself — the register is the
         whole reason he works. Phrases only, and specific ones: the first
         version of this matched /liver/ and went red on the word Liverpool
         in a state-derived question, which is a worse test than none. */
      rayNeverMaudlin: ray.every(x => !/drink problem|drinks too much|shouldn.t drink|alcoholic|ashamed of myself|wasted my life|liver is/i.test(x.t)),
    };
  });
  chk('P12e Raymond has always been out, and Yakolo always names a man the panel missed',
    Object.values(p12e).every(Boolean), JSON.stringify(p12e));

  /* ---- P12f: the African cohort behind Yakolo. It is read off the feed's own
     region ids, so it has to actually resolve — an empty cohort would make him
     a caller with no question. ---- */
  const p12f = await page.evaluate(() => {
    const pool = PLAYERS.filter(p => AFRICAN_NAT.has(p.nat));
    const byNat = {};
    for (const p of pool) (byNat[p.nat] = byNat[p.nat] || []).push(p.name);
    return {
      cohortResolves: pool.length > 20,
      everyIdMatchesSomebody: [...AFRICAN_NAT].every(id => (byNat[id] || []).length > 0),
      // a sanity anchor: the Nigeria cohort should contain recognisable names,
      // so a renumbering of FPL's regions shows up here rather than on air
      nigeriaLooksRight: (byNat[157] || []).some(n => /Iwobi|Aina|Bassey|Ajayi|Onyeka/.test(n)),
      ghanaLooksRight: (byNat[81] || []).some(n => /Semenyo|Fatawu|Thomas-Asante/.test(n)),
      // and no cohort is the England-sized one, which would mean a wrong id
      noneIsHuge: Object.values(byNat).every(v => v.length < 25),
      size: pool.length,
    };
  });
  chk('P12f the African cohort resolves off the feed and still looks like itself',
    p12f.cohortResolves && p12f.everyIdMatchesSomebody && p12f.nigeriaLooksRight
      && p12f.ghanaLooksRight && p12f.noneIsHuge, JSON.stringify(p12f));

  /* ---- P12g: and a DIFFERENT man each week, which is the actual brief.
     Against the live feed only GW1-4 have stats, so every call Yakolo has yet
     to make falls back to the season's best and he names one player over and
     over. That reads fine today and would be a dud all season, so settle some
     rounds and insist he moves on. ---- */
  const p12g = await page.evaluate(() => {
    let seed = 31;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 4; i < 20; i++) {
      const gwN = GAMEWEEKS[i].n, ps = {};
      for (const q of PLAYERS) {
        if (rnd() < 0.5) continue;
        ps[q.id] = { min: 90, st: 1, g: rnd() < 0.15 ? 1 : 0, a: rnd() < 0.1 ? 1 : 0, cs: rnd() < 0.3 ? 1 : 0 };
      }
      state.matchStats['gw' + gwN] = { gw: i, label: GAMEWEEKS[i].label, final: true, playerStats: ps };
      GAMEWEEKS[i].finished = true;
    }
    const names = PLAYERS.filter(p => AFRICAN_NAT.has(p.nat)).map(p => p.name);
    const named = [];
    for (let g = 5; g < 20; g++) for (const k of ['preview', 'review']) {
      const ep = Podcast.episode('tt', k, g);
      const c = ep && ep.blocks.find(x => x.who === 'Yakolo');
      if (c) named.push(names.find(n => c.text.includes(n)) || null);
    }
    return {
      calls: named.length,
      allNamed: named.length > 3 && named.every(Boolean),
      // a different man essentially every time, not one name on a loop
      distinct: new Set(named).size,
      varies: new Set(named).size >= Math.max(3, named.length - 1),
      who: [...new Set(named)].slice(0, 6),
    };
  });
  chk('P12g Yakolo names a different man as the rounds settle',
    p12g.allNamed && p12g.varies, JSON.stringify(p12g));

  /* ---- P12c: a caller waiting for a voice must not cost anything or break
     anything. render_pods refuses a run outright if a non-human character has
     no voice id, so a new caller ships as `human` with none: the renderer skips
     it, the browser speaks it, and Ben casts it when he likes. ---- */
  const p12c = await page.evaluate(async () => {
    const ROSTER = ['Howard', 'Raymond', 'Yakolo'];
    const cast = await (await fetch('audio/pod/cast.json', { cache: 'no-cache' })).json();
    const c = cast.cast || {};
    return {
      allCast: ROSTER.every(n => !!c[n]),
      // Exact takes approved by Ben on 17 Sept, left unwired until this fix.
      approvedRaymond: c.Raymond.voice === 'RDLen3xJimHO2jSEf3qL' && c.Raymond.model === 'eleven_v3',
      approvedYakolo: c.Yakolo.voice === 'LWOILCwreWREl2TqLwXv',
      // the gate render_pods applies: !human && !voice halts the whole render
      noneHaltsTheRender: ROSTER.every(n => c[n].human || String(c[n].voice || '').trim()),
      // and each one says what it is meant to sound like, which is what you
      // cast against
      allDirected: ROSTER.every(n => (c[n].direction || '').length > 40),
      // every SPEAKING part in the shows has a chair, or a render throws
      everySpeakerCast: (() => {
        const specs = [['gfw', 'pilot', null], ['tt', 'pilot', null], ['gfw', 'draft', null], ['tt', 'draft', null]]
          .concat([0, 1, 2, 3, 4].flatMap(g => [['gfw', 'preview', g], ['tt', 'preview', g], ['gfw', 'review', g], ['tt', 'review', g]]));
        const who = new Set();
        for (const [s, k, g] of specs) {
          const ep = Podcast.episode(s, k, g);
          if (ep) for (const b of ep.blocks) if (b.t === 'speech') who.add(b.who);
        }
        return [...who].every(n => !!c[n]);
      })(),
    };
  });
  chk('P12c a caller with no voice yet is cast, directed, and harmless to a render',
    Object.values(p12c).every(Boolean), JSON.stringify(p12c));

  /* ---- P12d: the advert book. Marc, 17 Sept 2026: "I want new adverts each
     time." Two run per episode off one hash, so a small book repeats fast. ---- */
  const p12d = await page.evaluate(() => {
    const ads = ep => (ep ? ep.blocks.filter(b => b.t === 'ad') : []);
    const runs = [];
    for (const s of ['gfw', 'tt']) for (let g = 0; g < 20; g++) for (const k of ['preview', 'review']) {
      const a = ads(Podcast.episode(s, k, g));
      if (a.length) runs.push({ show: s, brands: a.map(x => x.brand) });
    }
    const brandsOf = s => new Set(runs.filter(r => r.show === s).flatMap(r => r.brands));
    return {
      // a break always carries two, and never the same advert twice
      twoEach: runs.every(r => r.brands.length === 2),
      neverRepeatsInABreak: runs.every(r => r.brands[0] !== r.brands[1]),
      // and over a season each station gets through a real spread of its book
      gfwSpread: brandsOf('gfw').size >= 12,
      ttSpread: brandsOf('tt').size >= 12,
      // the two stations never share an advertiser — the ads are how you tell
      // the registers apart
      noCrossover: [...brandsOf('gfw')].every(b => !brandsOf('tt').has(b)),
    };
  });
  chk('P12d the ad book is deep enough that a listener is not sold the same thing weekly',
    Object.values(p12d).every(Boolean), JSON.stringify(p12d));

  /* ---- P13c: the provenance store matches the audio it describes. It is what
     lets a stand-in be replaced while a real human take is untouchable, so if
     it drifts out of step with the files the protection silently stops
     meaning anything ---- */
  const prov = await page.evaluate(async () => {
    const r = await fetch('audio/pod/rendered.json', { cache: 'no-cache' });
    if (!r.ok) return { ok: false, why: 'no rendered.json (' + r.status + ')' };
    const p = await r.json();
    _podRec = null;
    const rec = await podRecordings();
    const orphan = [], mismatched = [];
    for (const [epId, lines] of Object.entries(p)) {
      for (const [n, meta] of Object.entries(lines)) {
        // every claim must point at a file the manifest actually serves
        const src = podLineSrc(rec, epId, n);
        if (!src) { orphan.push(`${epId}/${n}`); continue; }
        if (!src.split('?')[0].endsWith('/' + meta.file)) mismatched.push(`${epId}/${n}`);
        if (!meta.voice) mismatched.push(`${epId}/${n} has no voice recorded`);
      }
    }
    return { ok: !orphan.length && !mismatched.length, orphan, mismatched };
  });
  chk('P13c provenance lines up with the audio on disk',
    prov.ok, prov.why || `orphans: ${(prov.orphan || []).join(', ')} mismatched: ${(prov.mismatched || []).join(', ')}`);

  /* ---- P13d: scheduled renders must harvest the current public board. A
     fresh local league publishes only the pilots; after a real GW it can say
     "nothing due" while every weekly episode is absent. The workflow fetches
     a read-only public snapshot and passes it to BOTH the cost and render
     steps, so the preflight and paid job judge the same scripts. ---- */
  const podWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'render-pods.yml'), 'utf8');
  const stateArgs = podWorkflow.match(/render_pods\.js[^\n]*--state|--state "\$RUNNER_TEMP\/league-state\.json"/g) || [];
  chk('P13d scheduled podcast cost and render both use the current public league state',
    /Fetch the current public league state/.test(podWorkflow)
      && /the-league-2627\/public\.json/.test(podWorkflow)
      && stateArgs.length >= 2,
    `${stateArgs.length} state-aware render command(s)`);

  /* ---- P15: the 18 Aug tweaks. One ad break, in the middle, hosted in and
     out; Howard's fixed phrase structure; and "trough" said as a pig trough
     rather than however the engine fancies ---- */
  const p15 = await page.evaluate(() => {
    const kinds = [['pilot', null], ['draft', null], ['preview', 0], ['review', 0]];
    const eps = [];
    for (const [k, g] of kinds) for (const s of ['gfw', 'tt']) {
      const e = Podcast.episode(s, k, g); if (e) eps.push(e);
    }
    const adsOf = e => e.blocks.map((b, n) => [b, n]).filter(([b]) => b.t === 'ad').map(([, n]) => n);
    return {
      // one break per episode: every ad block adjacent to the next
      contiguous: eps.every(e => { const a = adsOf(e); return a.length < 2 || a.every((n, i) => !i || n === a[i - 1] + 1); }),
      // ...roughly in the middle, never stranded at either end
      central: eps.every(e => { const a = adsOf(e); return a.length && a[0] / e.blocks.length > 0.3 && a[0] / e.blocks.length < 0.7; }),
      // ...and a host takes us in and brings us back, so they don't just appear
      hosted: eps.every(e => {
        const a = adsOf(e); if (!a.length) return false;
        const before = e.blocks[a[0] - 1], after = e.blocks[a[a.length - 1] + 1];
        return before && before.t === 'speech' && after && after.t === 'speech';
      }),
      // the same advert twice in one break would read as a bug
      noRepeat: eps.every(e => { const b = adsOf(e).map(n => e.blocks[n].brand); return new Set(b).size === b.length; }),
      // Howard always opens the same way: an idle moment, then the thought
      howardShape: eps.filter(e => e.show.id === 'tt').every(e => {
        const h = e.blocks.find(b => b.who === 'Howard');
        return h && /\bI was .+ when I thought, /.test(h.text);
      }),
      // ...and it is a different idle moment each time, not one stock line
      howardVaries: new Set(eps.filter(e => e.show.id === 'tt')
        .map(e => (e.blocks.find(b => b.who === 'Howard').text.match(/I was (.+?) when I thought/) || [])[1])).size > 1,
      // spelling for the eye, pronunciation for the ear — and only for the ear
      // lower case: capitals mark shouting in this codebase, and an all-caps
      // token gets spelled out or bellowed by both engines
      saidAsTroff: Podcast.sayable('talkTROUGH and the Trough') === 'talk troff and the Troff',
      // the browser says a standalone dash out loud; a paid voice does not, so
      // this cleanup must NOT reach the line key
      dashesForBrowser: Podcast.browserSay('So — a run — 12–9 and head-to-head')
        === 'So, a run, 12 to 9 and head-to-head',
      dashesNotKeyed: /—/.test(Podcast.sayable('So — a run')),
      captionUntouched: Podcast.episode('tt', 'pilot', null).blocks
        .some(b => /talkTROUGH/.test(b.text || '')),
    };
  });
  chk('P15 one hosted ad break mid-episode, Howard to a fixed shape, trough said as troff',
    Object.values(p15).every(Boolean), JSON.stringify(p15));

  /* ---- P17: where the shows sit. Marc, 18 Aug: "id like the two pilots to be
     positioned in the season preview page. The post draft episode and then the
     normal schedule should be positioned alongside the gazette."

     The hinge is the draft, not the edition — straight after draft night the
     Gazette is still printing edition zero, but the stations have moved on ---- */
  const p17 = await page.evaluate(() => {
    const read = () => {
      const room = document.querySelector('.gazette-room');
      const head = [...room.querySelectorAll('.prog-sec')].map(x => x.textContent)
        .find(t => /wireless|Media Desk|Cunthanger|in the group/i.test(t)) || '';
      // desk rows only — the back catalogue is .pod-row too (added 21 Aug)
      const deskRows = [...room.querySelectorAll('.pod-row')].filter(x => !x.closest('.pod-archive'));
      const rows = deskRows.length;
      const titles = deskRows.map(x => x.querySelector('.pod-main')?.textContent || '');
      document.querySelectorAll('.gazette-room').forEach(x => x.closest('.overlay')?.remove());
      return { head, rows, titles };
    };
    // the state left by the earlier checks is post-draft
    gazetteSheet();
    const after = read();
    // ...now put the draft back in the box and look again
    const keep = state.draft.picks;
    state.draft.picks = [];
    gazetteSheet();
    const before = read();
    state.draft.picks = keep;
    return {
      // edition zero carries both pilots, framed as part of that edition
      launchHeading: /wireless/i.test(before.head),
      launchBothShows: before.rows === Podcast.ON_AIR.length,
      launchIsPilots: before.titles.every(t => /Season Preview|SEASON PREVIEW/.test(t)),
      // ...and once the draft has happened the desk moves on with the Gazette
      deskHeading: /Media Desk|Cunthanger|wireless|in the group/i.test(after.head),
      deskBothShows: after.rows === Podcast.ON_AIR.length,
      deskNotPilots: after.titles.every(t => !/edition zero/.test(t)),
      // ...showing whatever the schedule says is CURRENT for each show. This
      // used to assert the word "Draft", which only held in the window between
      // draft night and the next preview slot — it expired at noon the day
      // after the real draft and reddened CI (21 Aug). Ask the schedule.
      deskIsCurrent: Podcast.ON_AIR.every(id => {
        const ep = Podcast.published().find(e => e.show === id);
        const title = ep && Podcast.episode(ep.show, ep.kind, ep.gw)?.title;
        return !!title && after.titles.some(t => t.includes(title));
      }),
    };
  });
  chk('P17 pilots sit with the season preview; everything after sits with the Gazette',
    Object.values(p17).every(Boolean), JSON.stringify(p17));

  chk('P16 no page errors across the run', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n[podcast] ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
