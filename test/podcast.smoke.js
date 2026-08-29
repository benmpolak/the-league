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
    window.fetch = real;
    const src = podLineSrc(rec, ep.id, oneN);
    // a part-cut episode says so, rather than claiming to be fully recorded
    podcastSheet(ep.id);
    await new Promise(r => setTimeout(r, 60));
    const meta = document.querySelector('.pod-room #podMeta');
    const said = !!meta && /part recorded/.test(meta.textContent);
    document.querySelectorAll('.pod-room').forEach(x => x.closest('.overlay')?.remove());
    _podRec = null;
    return {
      emptyByDefault: none === 0 && noneSrc,
      // the recorded line plays its file, keeping the extension it was given
      readsManifest: src === `audio/pod/${encodeURIComponent(ep.id)}/${oneN}.m4a`,
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

  /* ---- P12: Howard. Marc, 18 Aug — one caller, one question, talkTROUGH
     only, and he is the part a human records ---- */
  const p12 = await page.evaluate(() => {
    const lines = (show, kind, gw) => {
      const ep = Podcast.episode(show, kind, gw);
      return ep ? ep.blocks.filter(b => b.who === 'Howard') : null;
    };
    const kinds = [['pilot', null], ['draft', null], ['preview', 0], ['review', 0]];
    const tt = kinds.map(([k, g]) => lines('tt', k, g));
    const gfw = kinds.map(([k, g]) => lines('gfw', k, g));
    const ep = Podcast.episode('tt', 'review', 0);
    return {
      // exactly one call per talkTROUGH episode, every kind
      onceEachTT: tt.every(l => l && l.length === 1),
      // and never on the Gazette — he is a talkTROUGH caller
      neverGfw: gfw.every(l => l && l.length === 0),
      // Keys takes the call and answers it, so it plays as a phone-in
      framed: (() => {
        const i = ep.blocks.findIndex(b => b.who === 'Howard');
        return i > 0 && ep.blocks[i - 1].who === 'Richard Keyes'
          && !!ep.blocks[i + 1] && ep.blocks[i + 1].who === 'Richard Keyes';
      })(),
      // ...and he is introduced the way callers are: name, then where from
      fromPrestwich: kinds.every(([k, g]) => {
        const e = Podcast.episode('tt', k, g);
        const i = e.blocks.findIndex(b => b.who === 'Howard');
        return /Howard/.test(e.blocks[i - 1].text) && /Prestwich/.test(e.blocks[i - 1].text);
      }),
      // he is a first-time caller, permanently
      firstTimer: /first[ -]time|first time/i.test(ep.blocks.find(b => b.who === 'Howard').text),
      // he says something about THIS gameweek, not a stock line
      fromState: (() => {
        const t = ep.blocks.find(b => b.who === 'Howard').text;
        return state.managers.some(m => m.team && t.includes(m.team));
      })(),
      // and the player lists him with the cast, so his chip is on the sheet
      onTheBill: [...new Set(ep.blocks.filter(b => b.t === 'speech').map(b => b.who))].includes('Howard'),
      hasVoice: !!Podcast.VOICES['Howard'],
    };
  });
  chk('P12 Howard phones talkTROUGH once an episode, never the Gazette',
    Object.values(p12).every(Boolean), JSON.stringify(p12));

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
        if (!src.endsWith('/' + meta.file)) mismatched.push(`${epId}/${n}`);
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
        .find(t => /wireless|Media Desk/i.test(t)) || '';
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
      deskHeading: /Media Desk/i.test(after.head),
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
