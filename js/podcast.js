/* The Podcunt Network — two weekly shows, one set of facts.
 *
 * Commissioned in the group chat (16 Aug) and specified in BEN-TODO.md §5.
 * Two transcript podcasts covering identical events for opposite audiences:
 * GAZETTE FOOTBALL WEEKLY, liberal and analytical, and talkTROUGH, which is
 * neither. The joke only works if both shows read the SAME numbers and reach
 * incompatible conclusions, so every segment takes its facts from one place
 * and hands them to two registers.
 *
 * Determinism is a hard contract (Ben's rule): own hash, never the shared
 * RNG, no Date.now() and no Math.random() anywhere in content — every phone
 * must print the identical episode. Time is used ONLY to decide whether an
 * episode has been published yet, never to choose a word.
 *
 * Schedule (Marc, 17 and 18 Aug) — fixed slots, midday London, Tue and Fri:
 *   pilot    — pre-draft, introduces both casts, runs long on purpose
 *   draft    — the moment the board fills; grades, value picks, FRAUDS
 *   preview  — the last Tue/Fri midday slot before a gameweek's first kick-off
 *   review   — the first Tue/Fri midday slot after its last match settles
 *   both     — one slot carrying both: a midweek round reviewed and the next
 *              one previewed, as a single longer episode
 *
 * Escaping: this file emits PLAIN TEXT and never calls esc(). app.js escapes
 * once when it renders a block, which is the Gazette's own rule — escape at
 * the point of use. Escaping here too would double-encode every ampersand in
 * a team name, and would have the robot reading the word "amp" aloud.
 *
 * No audio backend, by design. The transcript is the artefact; app.js reads
 * it aloud with the browser's own voice and synthesises the stings.
 */
'use strict';
window.Podcast = (() => {

  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const pick = (arr, key) => arr[hash(key) % arr.length];
  // n distinct members of arr, deterministically
  const pickN = (arr, key, n) => {
    const out = [], seen = new Set();
    for (let i = 0; out.length < Math.min(n, arr.length); i++) {
      const k = hash(key + ':' + i) % arr.length;
      if (seen.has(k)) continue;
      seen.add(k); out.push(arr[k]);
    }
    return out;
  };

  const SHOWS = {
    gfw: {
      id: 'gfw', name: 'Gazette Football Weekly',
      dek: 'considered, tactical, faintly guilty about the whole enterprise',
      host: 'Rax Mushden', ads: 'gfw', theme: 'gfw',
      voice: { pitch: 1, rate: 0.96 },
    },
    tt: {
      id: 'tt', name: 'talkTROUGH',
      dek: 'drivetime. Opinions at volume, from men who were there',
      host: 'Richard Keyes', ads: 'tt', theme: 'tt',
      voice: { pitch: 0.8, rate: 1.06 },
    },
  };
  // per-speaker voice tweaks so three men are three men, not one man thrice
  const VOICES = {
    'Rax Mushden': { pitch: 1, rate: 0.96 },
    'Donathan Bilson': { pitch: 0.92, rate: 0.88 },   // slower: he is thinking
    'Yonni Liu': { pitch: 1.12, rate: 0.94 },
    'Sid Lowry': { pitch: 1.04, rate: 1 },
    'Richard Keyes': { pitch: 0.8, rate: 1.06 },
    'Andy Grey': { pitch: 0.7, rate: 1.1 },
    'Jamie O’Hara-Hara': { pitch: 0.88, rate: 1.14 },
    // Howard is on a hands-free in a van, not in the studio: slower, flatter,
    // and a touch lower than the professionals talking over him
    'Howard': { pitch: 0.86, rate: 0.9 },
  };

  /* ---------- station idents ----------
     Drawn, not fetched: inline SVG like the kits in app.js, so they are crisp
     at any size, cost no request and cannot trip the CSP. The two must be
     legible as a pair at 34 pixels in a list — hence one round and quiet, one
     square and shouting. */
  function logoSvg(showId, size = 34) {
    const s = Number(size) || 34;
    // below ~44px a wordmark is a smear, so the small ident is symbol-only and
    // the symbol grows into the space the text vacates
    const wm = s >= 44;
    if (showId === 'tt') {
      if (!wm) return `<svg viewBox="0 0 64 64" width="${s}" height="${s}" role="img" aria-label="talkTROUGH" focusable="false">
        <rect x="0" y="0" width="64" height="64" rx="9" fill="#2a0d04"/>
        <rect x="0" y="0" width="64" height="64" rx="9" fill="none" stroke="#e2601f" stroke-width="4"/>
        <path d="M9 40 L30 24 L30 56 Z" fill="#ffb37a"/>
        <rect x="30" y="29" width="12" height="22" rx="3" fill="#ffb37a"/>
        <path d="M47 24 q10 16 0 32" fill="none" stroke="#e2601f" stroke-width="5" stroke-linecap="round"/>
        <rect x="9" y="8" width="46" height="9" rx="2" fill="#e2601f"/>
      </svg>`;
      return `<svg viewBox="0 0 64 64" width="${s}" height="${s}" role="img" aria-label="talkTROUGH" focusable="false">
        <rect x="0" y="0" width="64" height="64" rx="9" fill="#2a0d04"/>
        <rect x="0" y="0" width="64" height="64" rx="9" fill="none" stroke="#e2601f" stroke-width="3"/>
        <rect x="7" y="9" width="50" height="11" rx="2" fill="#e2601f"/>
        <text x="32" y="18" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="8" font-weight="bold" fill="#2a0d04" letter-spacing="1.6">ON AIR</text>
        <path d="M14 40 L30 30 L30 50 Z" fill="#ffb37a"/>
        <rect x="30" y="33" width="9" height="14" rx="2" fill="#ffb37a"/>
        <path d="M43 31 q7 9 0 18" fill="none" stroke="#e2601f" stroke-width="3.4" stroke-linecap="round"/>
        <path d="M50 27 q10 13 0 26" fill="none" stroke="#e2601f" stroke-width="3" stroke-linecap="round" opacity=".72"/>
        <text x="32" y="61" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="7.5" font-weight="bold" fill="#ffb37a" letter-spacing=".4">talkTROUGH</text>
      </svg>`;
    }
    if (!wm) return `<svg viewBox="0 0 64 64" width="${s}" height="${s}" role="img" aria-label="Gazette Football Weekly" focusable="false">
      <rect x="0" y="0" width="64" height="64" rx="9" fill="#0f2019"/>
      <circle cx="32" cy="32" r="25" fill="none" stroke="#5fd0a0" stroke-width="2.4"/>
      <rect x="26" y="15" width="12" height="22" rx="6" fill="#5fd0a0"/>
      <path d="M19 33 q13 14 26 0" fill="none" stroke="#5fd0a0" stroke-width="3" stroke-linecap="round"/>
      <line x1="32" y1="42" x2="32" y2="50" stroke="#5fd0a0" stroke-width="3"/>
    </svg>`;
    return `<svg viewBox="0 0 64 64" width="${s}" height="${s}" role="img" aria-label="Gazette Football Weekly" focusable="false">
      <rect x="0" y="0" width="64" height="64" rx="9" fill="#0f2019"/>
      <circle cx="32" cy="29" r="21" fill="none" stroke="#5fd0a0" stroke-width="1.3"/>
      <circle cx="32" cy="29" r="17.5" fill="none" stroke="#2f6b52" stroke-width=".8"/>
      <rect x="28" y="17" width="8" height="15" rx="4" fill="#5fd0a0"/>
      <path d="M24 30 q8 9 16 0" fill="none" stroke="#5fd0a0" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="32" y1="36" x2="32" y2="41" stroke="#5fd0a0" stroke-width="1.8"/>
      <line x1="14" y1="47" x2="50" y2="47" stroke="#2f6b52" stroke-width=".9"/>
      <text x="32" y="60" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="11" fill="#cfe9dd" letter-spacing="2.2">GFW</text>
    </svg>`;
  }

  /* ---------- the platform desk ----------
     What actually changed, with a take from each register. Hand-authored,
     because "what did we ship" is not derivable from league state — and a
     podcast that invented its own release notes would be worse than useless. */
  const PLATFORM_CHANGES = [
    { what: 'waivers moved to a fixed clock — ten o\'clock, Tuesdays and Fridays',
      gfw: 'which is, if we\'re honest, a quietly progressive act. A fixed time is an accessible time. Everybody plans around the same two moments in the week, and the manager who happens to be free on a Sunday evening no longer has a structural advantage over the manager who is putting children to bed.',
      tt: 'TEN O\'CLOCK? On a TUESDAY? What is anybody doing at ten o\'clock on a Tuesday, son? WORKING. That is what. In my day the deadline was THE LAST POST. You wrote your team on the coupon, you got a STAMP on it, and if it arrived late THAT WAS YOUR PROBLEM.' },
    { what: 'the Chairman can now skip a waiver run by exception',
      gfw: 'a discretionary power, and I know that makes some of our listeners nervous. But it exists for double gameweeks and for rounds that finish on a Wednesday night, and the claims roll over untouched. Discretion exercised transparently is not the same thing as discretion abused.',
      tt: 'SO HE CAN JUST CANCEL IT. One man. CANCELS THE WAIVERS. That is not a league, that is a MONARCHY, and I will tell you something else for nothing — nobody needed a Chairman when you POSTED YOUR TRANSFERS IN and took whatever you were given.' },
    { what: 'a player explorer with every stat and a head-to-head comparison',
      gfw: 'and this is where I get slightly evangelical, because per-ninety numbers with a minutes floor is genuinely how you should be reading a squad. It stops you being seduced by a lad who had one good afternoon in October.',
      tt: 'EXPECTED GOALS. Expected. GOALS. Andy, did you ever expect a goal? You SCORED them. Nobody in the history of the game has ever been beaten by a spreadsheet.' },
    { what: 'the autopick queue now filters by club and position, and you can type a rank to move a man',
      gfw: 'small, but it\'s the sort of interface work that disproportionately helps the manager who has twenty minutes rather than two hours. Time poverty is the real inequality in this league.',
      tt: 'A QUEUE. For a draft. Just KNOW WHO YOU WANT, son. Write it on a bit of paper like a MAN.' },
    { what: 'every club has a crest now, drawn in the club office',
      gfw: 'and there\'s something rather moving about it. Identity in this league has always been improvised — a name, a joke, a sponsor nobody agreed to. A crest makes it feel inherited.',
      tt: 'A CREST. Lovely. Does it WIN YOU ANYTHING? Does it get you a defender who can HEAD IT? No. It does not.' },
    { what: 'the Gazette hired a full press corps',
      gfw: 'colleagues, obviously, so I\'ll declare an interest. But a league that writes about itself is a league that remembers itself, and the archive is the point of all this.',
      tt: 'THIRTEEN WRITERS. For twelve blokes. And not ONE of them has ever been in a dressing room at half past four in the afternoon when it has gone badly.' },
  ];

  /* ---------- house phrasebook per register ---------- */
  const GFW_HEDGE = ['and I think that\'s the interesting thing', 'though I\'d want to see more of it', 'and we should be careful here', 'which tells us something, possibly', 'and I say this as an admirer'];
  const TT_ROAR = ['SIMPLE AS THAT', 'AND THAT IS A FACT', 'DON\'T GIVE ME THAT', 'I\'VE SEEN IT A THOUSAND TIMES', 'WRITE IT DOWN'];

  /* ---------- scheduling (time decides IF, never WHAT) ---------- */
  function londonOffsetMin(ms) {
    const s = new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const m = s.match(/(\d+)\/(\d+)\/(\d+),? (\d+):(\d+)/);
    return m ? Math.round((Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] % 24, +m[5]) - ms) / 60000) : 0;
  }
  function londonAt(ms, dayOffset, hour) {
    const wall = new Date(ms + londonOffsetMin(ms) * 60000);
    const naive = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + dayOffset, hour, 0);
    return naive - londonOffsetMin(naive) * 60000;
  }
  const londonDay = ms => new Date(ms + londonOffsetMin(ms) * 60000).getUTCDay();

  /* ---------- the slots ----------
     Marc, 18 Aug: "why not just have the twice weekly schedule to be Tuesday
     at midday and friday at midday and have the time fixed".

     Right — a show people can't predict is a show people forget. Midday
     Tuesday and Friday, London, all year. It also sits two hours after the
     waiver run on the same two days, so the review can talk about claims that
     have actually settled.

     What it is NOT is a calendar. Five gameweeks this season start on a
     WEDNESDAY, and a naive "Friday preview, Tuesday review" would preview
     GW13 six days early and review it six days late — by which point GW14 has
     been and gone. So the times are fixed and the BINDING is to the gameweek:
     a preview goes out in the last slot before the first kick-off, a review in
     the first slot after the last whistle. Weekend rounds land on Friday and
     Tuesday exactly as asked; midweek rounds shuffle to the slot that still
     makes sense. */
  const SLOT_DAYS = [2, 5];        // Tuesday, Friday
  const SLOT_HOUR = 12;            // midday, London, year-round
  const isSlot = at => SLOT_DAYS.includes(londonDay(at));
  // the last slot strictly before ms
  function slotBefore(ms) {
    for (let back = 0; back < 14; back++) {
      const at = londonAt(ms, -back, SLOT_HOUR);
      if (at < ms && isSlot(at)) return at;
    }
    return null;
  }
  // the first slot at or after ms
  function slotAfter(ms) {
    for (let fwd = 0; fwd < 14; fwd++) {
      const at = londonAt(ms, fwd, SLOT_HOUR);
      if (at >= ms && isSlot(at)) return at;
    }
    return null;
  }
  const previewAt = i => { const k = gwKicks(i); return k ? slotBefore(k.first) : null; };
  // which day a slot actually falls on — the copy used to say "FRIDAY" out
  // loud, which was true until midweek rounds moved previews to a Tuesday
  const dayName = ms => ms == null ? 'today'
    : new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'long' });
  // the last match has to have finished, not merely started: a 20:00 kick-off
  // is done by 22:00, and the slot is hours later in any case
  const reviewAt = i => { const k = gwKicks(i); return k ? slotAfter(k.last + 2 * 3600e3) : null; };

  /* Every episode currently published, newest first. Time enters HERE and
     nowhere else. */
  function published(now = Date.now()) {
    const out = [];
    const drafted = state.phase === 'season' && (state.draft?.picks || []).length > 0;
    for (const id of ['gfw', 'tt']) {
      if (!drafted) { out.push({ show: id, kind: 'pilot', gw: null, at: null }); continue; }
      /* A slot that carries BOTH a review and a preview ships one double
         bill rather than two episodes racing each other into the same
         minute (Marc, 18 Aug). Only happens around midweek rounds. */
      const paired = new Set();
      for (let i = 0; i < REGULAR_GWS; i++) {
        const r = reviewSharingSlotWith(i);
        if (r != null && gwStatus(r) === 'final') paired.add(r);
      }
      for (let i = 0; i < REGULAR_GWS; i++) {
        const p = previewAt(i);
        if (p != null && now >= p) {
          const r = reviewSharingSlotWith(i);
          const double = r != null && paired.has(r);
          out.push({ show: id, kind: double ? 'both' : 'preview', gw: i, at: p });
        }
        const r = reviewAt(i);
        if (r != null && now >= r && gwStatus(i) === 'final' && !paired.has(i)) {
          out.push({ show: id, kind: 'review', gw: i, at: r });
        }
      }
      out.push({ show: id, kind: 'draft', gw: null, at: null });
    }
    return out.map(e => ({ ...e, id: `${e.show}-${e.kind}${e.gw != null ? '-gw' + (e.gw + 1) : ''}` }))
      .sort((a, b) => (b.at || 0) - (a.at || 0));
  }
  const latestFor = (showId, now = Date.now()) => published(now).find(e => e.show === showId) || null;

  /* ---------- fact desk ---------- */
  const squadOf = mid => (typeof managerSquad === 'function' ? managerSquad(mid) : []);
  const lastSeasonPts = p => { const ls = typeof lastSeasonOf === 'function' ? lastSeasonOf(p) : null; return ls ? (ls.pts || 0) : (p.pts || 0); };
  // squad strength on last season's evidence — the only measure that exists
  // before a ball is kicked, and the one the grades rest on
  const squadScore = mid => squadOf(mid).reduce((t, p) => t + lastSeasonPts(p), 0);
  const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D'];
  function draftTable() {
    return state.managers.map(m => ({ mid: m.id, score: squadScore(m.id) }))
      .sort((a, b) => b.score - a.score)
      .map((r, i) => ({ ...r, grade: GRADES[Math.min(i, GRADES.length - 1)], rank: i + 1 }));
  }
  // a pick taken far later than his last-season standing = value; far earlier
  // = a reach. Both measured against the draft's own order, so it is fair.
  function draftOutliers() {
    const picks = (state.draft?.picks || []).map((pk, n) => ({ ...pk, n: n + 1, p: PLAYER_BY_ID[pk.playerId] })).filter(x => x.p);
    const board = [...picks].sort((a, b) => lastSeasonPts(b.p) - lastSeasonPts(a.p)).map((x, i) => [x.playerId, i + 1]);
    const rankOf = Object.fromEntries(board);
    const withDelta = picks.map(x => ({ ...x, delta: (rankOf[x.playerId] || 0) - x.n }));
    return {
      value: [...withDelta].sort((a, b) => a.delta - b.delta).filter(x => x.delta < -8).slice(0, 3),
      reach: [...withDelta].sort((a, b) => b.delta - a.delta).filter(x => x.delta > 8).slice(0, 3),
    };
  }
  /* The matchup desk (Marc, 17 Aug): how two squads actually collide this
     week. Two kinds of collision, both real and both checkable —
       shared: both managers own men from the same Premier League club
       duel:   one manager's forward plays against the other's defender */
  function matchups(a, b, i) {
    const gwN = GAMEWEEKS[i]?.n;
    const sa = squadOf(a), sb = squadOf(b);
    const clubsA = new Set(sa.map(p => p.team)), clubsB = new Set(sb.map(p => p.team));
    const shared = [...clubsA].filter(c => clubsB.has(c));
    const fx = (state.fixtures || []).filter(f => f && f.gw === gwN);
    const duels = [];
    for (const f of fx) {
      for (const [x, y] of [[sa, sb], [sb, sa]]) {
        const att = x.filter(p => p.pos === 'FW' && (p.team === f.home || p.team === f.away));
        const def = y.filter(p => (p.pos === 'DF' || p.pos === 'GK') && (p.team === f.home || p.team === f.away) && p.team !== att[0]?.team);
        if (att.length && def.length) duels.push({ att: att[0], def: def[0], own: x === sa ? a : b });
      }
    }
    return { shared, duels: duels.slice(0, 2) };
  }

  /* ---------- how it's said, as opposed to how it's spelt ----------
     Marc, 18 Aug: "the word TalkTrough isnt pronounced correctly, its trough
     as in a pig trough and needs to be said that way."

     Every engine we've tried reads "trough" as "throo" or "trow" — it's a
     genuinely irregular English spelling and the -ough words all disagree with
     each other. The fix is to hand the SPEAKER a respelling while the reader
     still sees the real word: captions, titles and the page are untouched,
     only the audio changes. Applies to the free-agent pool too, since that's
     the same word and the same joke.

     Anything added here should be a pronunciation, not a rewrite. If a line
     needs different words, change the line. */
  const SAY_AS = [
    // lower case on purpose. Capitals are how this file marks SHOUTING, and
    // both the browser and the paid voices treat an all-caps token as either a
    // shout or an initialism — "TROFF" got spelled out. The show is said as
    // two ordinary words, the way talkSPORT is.
    [/\btalkTROUGH\b/g, 'talk troff'],
    [/\btalkTrough\b/g, 'talk troff'],
    [/\bTROUGH\b/g, 'troff'],
    [/\bTrough\b/g, 'Troff'],
    [/\btrough\b/g, 'troff'],
    /* Marc, 18 Aug: "the team name 10110111 sounds weird, just say the
       numbers." Any voice reads a long run of digits as one enormous number —
       a hundred and one million, eleven thousand, one hundred and one — which
       is nobody's team name. Spacing the digits makes it read them out one at
       a time. Five or more, so scores and points totals are untouched. */
    [/\b\d{5,}\b/g, m => m.split('').join(' ')],
  ];
  const sayable = t => SAY_AS.reduce((s, [re, to]) => s.replace(re, to), String(t == null ? '' : t));

  /* ---------- what the BROWSER voice needs on top ----------
     Marc, 18 Aug: "you need to remove - from the script as they are spoken and
     it sounds weird." Right — the browser reads a standalone em dash out loud
     as the word "dash". A paid voice treats it as the pause it is, so this
     cleanup is deliberately NOT part of sayable(): sayable feeds the line key,
     and folding it in would orphan the twelve already-rendered lines that
     contain a dash and re-bill them to fix something they never had wrong.

     Punctuation for the eye, timing for the ear. Hyphens INSIDE a word stay —
     "head-to-head" and "ex-footballer" are read correctly and always were. */
  const browserSay = t => sayable(t)
    // a score reads as a score, not "twelve dash nine"
    .replace(/(\d)\s*[—–-]\s*(\d)/g, '$1 to $2')
    // a standalone dash is a pause; a comma is how you spell a pause
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    // ...and one left stranded at either end is just noise
    .replace(/^\s*[—–-]\s*/, '').replace(/\s*[—–-]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/,\s*,/g, ',');

  /* A line's identity is WHAT IS SAID, not where it sits in the running order.
     Recordings used to be filed by block index, which meant moving the ad
     break — a one-line change (Marc, 18 Aug) — silently re-pointed every
     rendered file at somebody else's words. Keying on the text instead means
     re-ordering is free, and re-wording a line re-cuts that line and nothing
     else. Worth real money: a full re-render is ~6,000 characters, a changed
     line is about 100. */
  const lineKey = b => (!b || b.t === 'theme') ? null
    : hash(sayable(b.t === 'ad' ? `${b.brand}. ${b.text}` : b.text)).toString(36);

  /* ---------- episode assembly ---------- */
  const theme = show => ({ t: 'theme', show, text: show === 'tt' ? '[BRASS STING. AIRHORN. A MAN SHOUTING OVER BOTH]' : '[SPARSE PIANO. A SINGLE CELLO. SOMEBODY SIGHS]' });
  function adBreak(show, key, n) {
    const inv = (typeof POD_ADS !== 'undefined' && POD_ADS[SHOWS[show].ads]) || [];
    if (!inv.length) return null;
    const ad = inv[hash(key + ':ad' + n) % inv.length];
    return { t: 'ad', show, brand: ad.brand, text: ad.read };
  }

  /* ---- the ad break ----
     Marc, 18 Aug: "the adverts need to be introduced with something like 'now
     for an ad break and well be back after' or something better than that. i
     think the adds should be back to back and in the middle."

     Right on both counts. Adverts that arrive unannounced read as a glitch,
     and one advert stranded in each half reads as two glitches. Real radio
     goes into a break, plays the lot, and comes back — so: a host takes us
     in, both ads run together, a host brings us back. One break, in the
     middle, exactly where a listener expects to be sold something.

     The in and out are in each show's own voice, because the way a station
     handles its adverts says more about it than the adverts do. */
  const AD_IN = {
    gfw: [
      'We\'ll pause there for a moment. This programme is supported by advertising, which we\'d rather it wasn\'t, and we\'ll be back straight after.',
      'A short break now, and I should say we don\'t choose these. Back in a moment.',
      'Let\'s take our break there. Two messages, and then the second half.',
    ],
    tt: [
      'RIGHT. Adverts. Don\'t go anywhere, we\'ll be back in two minutes and we\'ve got a LOT more to get through.',
      'We\'ll take a quick break. STAY WITH US, because after this we\'re going STRAIGHT back into it.',
      'Adverts now. Two of them, back to back, and then we\'re straight back. DON\'T TOUCH THAT DIAL.',
    ],
  };
  const AD_OUT = {
    gfw: [
      'And we\'re back. Thank you for your patience with that.',
      'Right — back with us, and back to the football.',
      'That\'s the advertising done. On we go.',
    ],
    tt: [
      'AND WE\'RE BACK.',
      'RIGHT. We\'re back, and I\'ve not calmed down.',
      'Back with you. Where were we? I\'ll tell you where we were.',
    ],
  };
  // one break, both ads, host in and host out
  function adPod(showId, key) {
    const a1 = adBreak(showId, key, 1), a2 = adBreak(showId, key, 2);
    if (!a1 && !a2) return [];
    const host = SHOWS[showId].host;
    const out = [say(host, pick(AD_IN[showId] || AD_IN.gfw, key + ':adin'))];
    if (a1) out.push(a1);
    // two ads from a two-ad inventory can collide; one advert twice is worse
    // than one advert once
    if (a2 && (!a1 || a2.brand !== a1.brand)) out.push(a2);
    out.push(say(host, pick(AD_OUT[showId] || AD_OUT.gfw, key + ':adout')));
    return out;
  }
  /* Drop the break into the middle of a finished episode. Measured across the
     spoken blocks, and kept clear of the opening exchange and the sign-off so
     it never lands on "and that's the show". */
  function insertAdPod(showId, key, B) {
    const pod = adPod(showId, key);
    if (!pod.length) return;
    let at = Math.max(3, Math.min(B.length - 2, Math.round(B.length / 2)));
    /* Don't cut a one-word reaction away from the line it answers. Jamie's
       "FRAUD." means nothing three minutes later on the other side of a patio
       advert, and the same goes for Grey's "Richard." */
    const short = b => b && b.t === 'speech' && String(b.text).split(/\s+/).length <= 4;
    for (let n = 0; n < 3 && short(B[at]); n++) at++;
    B.splice(Math.min(at, B.length - 1), 0, ...pod);
  }
  const say = (who, text) => ({ t: 'speech', who, text });

  /* ---------- the phone-in ----------
     Marc, 18 Aug: "the human recording is for a new character i want to
     introduce on talkTROUGH, as it is shorter we want to introduce a character
     called howard who calls in and asks a question each episode in the style
     of a phone in."

     So Howard is ONE spoken line an episode, on talkTROUGH only, and he is the
     part being recorded by a real human — which is exactly the right shape for
     it: a proper phone-in caller is the one voice on a station that isn't a
     broadcaster, and the join shows least when the amateur is the amateur.

     The running joke is that he is a first-time caller every single week. He
     never quite asks a question, he mentions something nobody asked about, and
     he hangs up to listen. The FACTS he gets wrong come from real league state,
     so he is wrong about something different each time. */
  const HOWARD_OPENER = [
    'Yeah, hello Richard, long-time listener, first-time caller.',
    'Hello Richard, first time calling in, long-time listener.',
    'Richard. Howard, Prestwich. Long-time listener. First time I\'ve rung.',
    'Yeah, alright Richard. Long-time listener this end. First-time caller.',
  ];
  // ...and the hinge into the point itself, which he never quite makes cleanly
  const HOWARD_THOUGHT = [
    'I\'ll ring them, because somebody has to say it.',
    'that\'s it, I\'m ringing in.',
    'nobody on that show has mentioned this once.',
    'I bet not one of them has thought about that.',
    'somebody wants to tell them.',
    'I\'ll have to say something, because they won\'t.',
    'why has nobody said this?',
    'that needs saying on the radio, that does.',
  ];
  const HOWARD_SIGNOFF = [
    'Anyway, I\'ll hang up and listen.',
    'I\'ll take my answer off air.',
    'That\'s all I wanted to say. I\'ll listen to what you make of it.',
    'Anyway. I\'ll get off the line, you\'ve got a show to do.',
    'I\'ll hang up now. Don\'t cut me off, I\'m going anyway.',
  ];
  /* Marc, 18 Aug: "id like howard to introduce his question comment with a
     standard phrase structure, essentially that he was doimg an inane activity
     (with a north manchester, possibly jewish reference) when he thought the
     thing he has called up to say."

     So it is always the same shape — I was DOING SOMETHING DULL SOMEWHERE
     SPECIFIC when I thought X — and the something and the somewhere change
     every time. The specificity is the joke: nobody has ever had a thought
     about fantasy football at a more ordinary moment than Howard. Prestwich
     and the roads around it, real places, ordinary errands, said fondly.
     Keep it that way if you add more — it works because it is affectionate
     and precise, and it stops working the second it is a caricature. */
  const HOWARD_DOING = [
    'walking past the Shrubberies',
    'queuing in Kosher King on Bury Old Road',
    'waiting for the wife outside Titanics',
    'putting the bins out',
    'parked up on Sedgley Park Road doing nothing in particular',
    'walking the dog round Heaton Park',
    'stood in the queue at the bagel place on Kings Road',
    'defrosting the freezer',
    'sat in the car outside shul waiting for my son to come out',
    'looking for a parking space on Bury New Road',
    'up a ladder doing the gutters',
    'having my tea',
    'on the 135 going into town',
    'waiting in for a delivery that never came',
    'picking up a prescription in Prestwich village',
    'watching the wife\'s programme with the sound off',
  ];
  /* Keys taking the call. He remembers him, which is the joke. */
  function howardIn(key, kind, question) {
    const first = kind === 'pilot';
    // introduced the way a phone-in caller always is: name, then where he's
    // ringing from, then straight to him (Marc, 18 Aug)
    const intro = first
      ? 'Right, let\'s get to the phones, because the lines have not stopped all afternoon. We\'ve got Howard from Prestwich. Howard in Prestwich, you\'re on talkTROUGH.'
      : pick([
        'Let\'s go to the phones. Howard in Prestwich. Howard, you\'re on talkTROUGH.',
        'To the phones, and it\'s Howard from Prestwich again. Howard, you\'re on talkTROUGH.',
        'Line one, Howard in Prestwich. Howard, go ahead, you\'re on talkTROUGH.',
        'Howard\'s back. Howard from Prestwich, you\'re on talkTROUGH.',
        'We\'ll take one call. Howard, Prestwich. You\'re on talkTROUGH.',
      ], key + ':hi');
    // always the same shape: I was [dull thing] when I thought [the point]
    const body = [
      pick(HOWARD_OPENER, key + ':ho'),
      `I was ${pick(HOWARD_DOING, key + ':hd')} when I thought, ${pick(HOWARD_THOUGHT, key + ':ht')}`,
      question,
      pick(HOWARD_SIGNOFF, key + ':hs'),
    ].join(' ');
    const answer = first
      ? 'Well he\'s not wrong, Howard, and that\'s the thing — the people who actually WATCH the football know. Good caller, Prestwich.'
      : pick([
        'Howard, you said that last week. You are not a first-time caller. You have NEVER been a first-time caller.',
        'Every week, Howard. EVERY WEEK he rings up from Prestwich and says first-time caller.',
        'Good call, Howard, and he\'s right, and nobody in that league will listen to him.',
        'That is the best point anyone has made on this show all season and it came from a man in a van in Prestwich.',
        'Howard. Howard. He\'s gone. He always goes.',
      ], key + ':ha');
    return [say('Richard Keyes', intro), say('Howard', body), say('Richard Keyes', answer)];
  }

  function panel(key) {
    const roster = typeof GAZETTE_PRESS !== 'undefined' ? GAZETTE_PRESS : [];
    const named = n => (roster.find(p => p.n === n) || { n }).n;
    return { tactics: named('Donathan Bilson'), colour: named('Yonni Liu'), spain: named('Sid Lowry') };
  }

  function build(showId, kind, gw) {
    const show = SHOWS[showId];
    if (!show) return null;
    const key = `${showId}:${kind}:${gw == null ? 'x' : gw}`;
    const B = [theme(showId)];
    const meta = { pilot: pilotBody, draft: draftBody, preview: previewBody, review: reviewBody, both: bothBody }[kind];
    if (!meta) return null;
    const built = meta(showId, key, gw, B);
    if (!built) return null;
    /* The break goes in HERE rather than inside each body, so all eight
       episodes get it in the same place and no future segment can quietly
       drift it back to a third of the way through. */
    insertAdPod(showId, key, B);
    return { id: `${showId}-${kind}${gw != null ? '-gw' + (gw + 1) : ''}`, show, kind, gw,
      title: built.title, dek: built.dek, blocks: B, words: B.reduce((t, b) => t + String(b.text || '').split(/\s+/).length, 0) };
  }

  /* ---- the pilot: pre-draft, and the only episode that introduces people ---- */
  function pilotBody(showId, key, _gw, B) {
    const P = panel(key);
    const changes = pickN(PLATFORM_CHANGES, key + ':chg', 3);
    const gfw = showId === 'gfw';
    // last season, from the archive
    const arch = [...PLAYERS].map(p => ({ p, pts: lastSeasonPts(p) })).sort((a, b) => b.pts - a.pts);
    const top = arch.slice(0, 3);
    const winners = [1, 4, 6, 7, 8, 9].map(id => (state.managers.find(m => m.id === id) || {}));
    const favs = pickN(winners.filter(w => w.id), key + ':fav', 2);

    if (gfw) {
      B.push(say('Rax Mushden', `Hello and welcome to Gazette Football Weekly. I'm Rax Mushden, and this is the season preview — the draft has not happened, nobody has done anything wrong yet, and the table is a perfect and beautiful blank. With me, as ever: ${P.tactics}, who has read more about the half-space than is medically advisable.`));
      B.push(say(P.tactics, 'Hello. I want to say at the outset that I intend to talk about structure rather than personnel, because personnel is what people talk about when they have not understood the structure.'));
      B.push(say('Rax Mushden', `${P.colour} is here.`));
      B.push(say(P.colour, 'I am. I have been thinking about what it means that twelve men have organised their late summer around a spreadsheet, and I think the answer is love, expressed badly.'));
      B.push(say('Rax Mushden', `And ${P.spain}, in Spain.`));
      B.push(say(P.spain, 'It is thirty-one degrees here and nobody has mentioned the draft once. It has been very restful.'));
      B.push(say('Rax Mushden', 'Let\'s start with the platform, because a great deal has changed and I think it deserves engaging with seriously.'));
      for (const c of changes) B.push(say(c === changes[0] ? P.tactics : (c === changes[1] ? P.colour : 'Rax Mushden'), `So — ${c.what} — ${c.gfw}`));
      B.push(say('Rax Mushden', `Something we should say plainly: this game evolves every single year, and that's healthy. A league that refuses to change its own rules isn't preserving tradition, it's just refusing to look at itself, ${pick(GFW_HEDGE, key + ':h1')}.`));
      B.push(say('Rax Mushden', `Last season, then. ${top[0].p.name} finished top of the pile on ${top[0].pts} — with ${top[1].p.name} and ${top[2].p.name} behind him.`));
      B.push(say(P.tactics, `And the warning attached to those numbers is that they are a record of what happened, not a promise about what will. A forward on ${top[0].pts} is being priced by this room as though last season were a season ticket. It is not. It is a receipt.`));
      B.push(say(P.colour, 'There\'s also the matter of who these men play for, and who pays for the shirts they play in. Half this league\'s squads will be sponsored by a betting company or a petrostate before the first kick-off, and we will all say nothing, because the alternative is having to think about it on a Saturday.'));
      B.push(say('Rax Mushden', 'We will come back to that, and I mean it.'));
      B.push(say('Rax Mushden', `Favourites. ${favs.map(f => f.team || f.name).join(' and ')} — both previous champions, both entirely capable of it again.`));
      B.push(say(P.spain, 'Though I would gently point out that the previous champion has won this league from the middle of the draft order more than once, which suggests the order matters less than the room believes.'));
      B.push(say('Rax Mushden', 'That\'s the show. Draft well, be kind to each other, and remember that it is August and nothing has gone wrong yet. Goodbye.'));
      return { title: 'The Season Preview', dek: 'edition zero · the draft has not happened and hope is undefeated' };
    }
    B.push(say('Richard Keyes', 'RIGHT. talkTROUGH. Richard Keyes with you, and alongside me, as always, a man who scored goals for a living — Andy Grey.'));
    B.push(say('Andy Grey', 'Richard.'));
    B.push(say('Richard Keyes', 'And a young man who played at a very good level and will not let it go — Jamie.'));
    B.push(say('Jamie O’Hara-Hara', 'I played at a VERY GOOD LEVEL, Richard, and I\'ll tell you now, this league has gone SOFT. SOFT!'));
    B.push(say('Richard Keyes', 'Well let\'s get into it, because they have CHANGED THINGS AGAIN.'));
    for (const c of changes) B.push(say(c === changes[0] ? 'Andy Grey' : (c === changes[1] ? 'Jamie O’Hara-Hara' : 'Richard Keyes'), `${c.what.toUpperCase()}. ${c.tt}`));
    B.push(say('Andy Grey', 'I\'ll tell you what it is, Richard. It\'s WOKE NONSENSE. You used to fill your team in on a coupon, put a STAMP on it, and POST IT. Transfers and all, off to an address in Essex. Then you waited for the paper on Monday to find out how you\'d done. If it never got there, you had a WORD WITH YOURSELF and you didn\'t do it again.'));
    B.push(say('Richard Keyes', `And nobody died, Andy. NOBODY DIED. ${pick(TT_ROAR, key + ':r1')}.`));
    B.push(say('Richard Keyes', `Last season. ${top[0].p.name}, ${top[0].pts} points. Best in the league by a MILE.`));
    B.push(say('Andy Grey', `And he did it WITHOUT a computer telling him where to stand. ${top[1].p.name} and ${top[2].p.name} behind him and I\'d take all three tomorrow.`));
    B.push(say('Jamie O’Hara-Hara', 'See FOR ME, and I played at a good level, the problem with this league is there\'s not enough BRITISH players getting drafted. Managers should have to pick FIVE. FIVE. MINIMUM.'));
    B.push(say('Andy Grey', 'And they should show a bit more RESPECT around Remembrance weekend, but nobody wants to hear it from me.'));
    howardIn(key, 'pilot', `My question is about this draft. Everyone keeps going on about ${top[0].p.name} — ${top[0].pts} points, marvellous, well done. But he was ${top[0].pts} points LAST year, wasn't he. You can't draft last year. My lad's got him top of his list and I've told him, I said, you'll be the one paying for that in November. Nobody ever won anything drafting a man off a receipt.`)
      .forEach(b => B.push(b));
    B.push(say('Richard Keyes', `Who wins it? I'll tell you who wins it. ${(favs[0] || {}).team || 'somebody'}. Previous champion, knows how to get over the line, WRITE IT DOWN.`));
    B.push(say('Jamie O’Hara-Hara', `I'll go ${(favs[1] || {}).team || 'the other lot'}, and if I'm wrong I'll come on here and say I was wrong, which I WON'T BE.`));
    B.push(say('Richard Keyes', 'Draft\'s coming. We\'ll be here the moment it finishes. Don\'t go anywhere. Actually do, we\'re off air.'));
    return { title: 'THE BIG SEASON PREVIEW', dek: 'they have changed things again and the lads have views' };
  }

  /* ---- draft reaction ---- */
  function draftBody(showId, key, _gw, B) {
    const table = draftTable();
    if (!table.length) return null;
    const P = panel(key);
    const best = table[0], worst = table[table.length - 1];
    const { value, reach } = draftOutliers();
    const gfw = showId === 'gfw';
    if (gfw) {
      B.push(say('Rax Mushden', 'Gazette Football Weekly, and the draft is done. Twelve squads exist that did not exist this morning.'));
      B.push(say(P.tactics, `The headline, and I'd put it carefully: ${teamName(best.mid)} have assembled the strongest paper squad — a grade A, on last season's evidence. Whether that survives contact with a Tuesday in November is a separate question.`));
      if (value.length) B.push(say(P.tactics, `The pick of the draft for me was ${value[0].p.name} at number ${value[0].n}. On last season's returns he had no business being there, and ${teamName(value[0].managerId)} simply waited.`));
      if (reach.length) B.push(say(P.colour, `Whereas ${teamName(reach[0].managerId)} took ${reach[0].p.name} at ${reach[0].n}, which is early, and which I suspect was an act of the heart rather than the head. I don't say that unkindly. Most of the good things people do are.`));
      B.push(say('Rax Mushden', 'Grades, then, and with the caveat that grading a draft in August is a form of entertainment rather than analysis.'));
      B.push(say(P.tactics, table.slice(0, 4).map(r => `${teamName(r.mid)}, ${r.grade}`).join('. ') + '. Those four have depth as well as a top end, which is the thing that survives an injury.'));
      B.push(say(P.tactics, table.slice(4, 8).map(r => `${teamName(r.mid)}, ${r.grade}`).join('. ') + '. All perfectly sound, all one bad month from a rebuild.'));
      B.push(say(P.colour, table.slice(8).map(r => `${teamName(r.mid)}, ${r.grade}`).join('. ') + '. And I want to be careful with that bottom group, because a low grade in August is a story about last season, not this one.'));
      B.push(say(P.colour, `At the other end, ${teamName(worst.mid)} have had what we would traditionally call a difficult evening. I would encourage everyone to remember that it is a game about a game.`));
      const topMan = squadOf(best.mid).slice().sort((x, y) => lastSeasonPts(y) - lastSeasonPts(x))[0];
      const lowMan = squadOf(worst.mid).slice().sort((x, y) => lastSeasonPts(y) - lastSeasonPts(x))[0];
      if (topMan) B.push(say(P.tactics, `${teamName(best.mid)} are built around ${topMan.name}, and that is both the strength and the risk. A squad with one obvious best player is a squad with one obvious way to fail.`));
      if (lowMan) B.push(say(P.colour, `Whereas ${teamName(worst.mid)} lead with ${lowMan.name}, which is a perfectly respectable place to start and a difficult place to finish.`));
      B.push(say(P.spain, 'From Spain, the only observation worth making: every one of these squads will be unrecognisable by Christmas. The draft is the beginning of the argument, not the end of it.'));
      B.push(say('Rax Mushden', 'Well said. Enjoy your squads while they are still theoretical. Goodbye.'));
      return { title: 'Draft Night: the twelve squads', dek: 'grades, value, and one act of the heart' };
    }
    B.push(say('Richard Keyes', 'THE DRAFT IS OVER and I can tell you now who has WON it.'));
    B.push(say('Andy Grey', `${(teamName(best.mid) || '').toUpperCase()}. Not close, Richard. NOT CLOSE. That is the best squad in this league and everybody watching knows it.`));
    B.push(say('Richard Keyes', `And who has FLOPPED, Andy? Because somebody always does.`));
    B.push(say('Andy Grey', `${(teamName(worst.mid) || '').toUpperCase()}. What was that? WHAT WAS THAT. I've seen some drafts, Richard, and that is a shambles.`));
    B.push(say('Jamie O’Hara-Hara', `He's a FRAUD, Andy. I'll SAY IT. FRAUD.`));
    if (value.length) B.push(say('Andy Grey', `${value[0].p.name} at pick ${value[0].n} though — THAT is a proper bit of business. ${pick(TT_ROAR, key + ':r2')}.`));
    if (value[1]) B.push(say('Jamie O’Hara-Hara', `And ${value[1].p.name} at ${value[1].n}?! I'd have gone THREE ROUNDS EARLIER and I'd have been RIGHT.`));
    if (reach.length) B.push(say('Richard Keyes', `And ${reach[0].p.name} at ${reach[0].n}?! WHAT ARE YOU DOING. You could have had him THREE ROUNDS LATER and everybody in that room knew it.`));
    if (reach[1]) B.push(say('Andy Grey', `${reach[1].p.name} at ${reach[1].n} as well. They've panicked, Richard. You can SMELL a panic pick.`));
    B.push(say('Richard Keyes', `And the ones in the middle? ${table.slice(4, 8).map(r => (teamName(r.mid) || '').toUpperCase()).join(', ')}. NOTHING SIDES. Not good enough to win it, not bad enough to be interesting.`));
    B.push(say('Jamie O’Hara-Hara', 'That\'s where you get RELEGATED from. MENTALLY.'));
    howardIn(key, 'draft', `You've spent twenty minutes telling everyone ${teamName(best.mid)} have won the draft. They haven't won anything. They've won a LIST. ${reach.length ? `And you had a go at whoever took ${reach[0].p.name} at ${reach[0].n} — well, he wanted him, didn't he. That's the whole point of having a go.` : 'Nobody has kicked a ball yet.'} I've been doing this thirty-odd years and the fella who wins the draft never wins the league. Never.`)
      .forEach(b => B.push(b));
    B.push(say('Jamie O’Hara-Hara', 'And NOT ENOUGH BRITISH LADS. AGAIN. I COUNTED.'));
    B.push(say('Andy Grey', `And I'll say this for nothing — the lad who's WON this draft has done it by taking the OBVIOUS player every single time. No cleverness. No spreadsheet. Just the best one left. ${pick(TT_ROAR, key + ':r5')}.`));
    B.push(say('Richard Keyes', 'That is what everybody has forgotten, Andy. TAKE THE BEST PLAYER.'));
    B.push(say('Richard Keyes', 'Gameweek one Friday. We\'ll be here. GET IN.'));
    return { title: 'WHO WON THE DRAFT', dek: 'somebody is a fraud and the lads have identified him' };
  }

  /* ---- weekly preview ---- */
  function previewBody(showId, key, i, B, seg = { open: true, close: true, phone: true }) {
    const gwN = GAMEWEEKS[i]?.n;
    if (gwN == null) return null;
    const prs = typeof pairingsFor === 'function' ? pairingsFor(i) : [];
    if (!prs.length) return null;
    const P = panel(key);
    const tie = prs[hash(key + ':tie') % prs.length];
    const [a, b] = tie;
    const mu = matchups(a, b, i);
    const others = prs.filter(pr => pr !== tie).slice(0, 3);
    // the table as it stands GOING IN — settled rounds only, never this one
    let tbl = [];
    try { tbl = (typeof standingsBefore === 'function' ? standingsBefore(i) : []) || []; } catch { tbl = []; }
    const bestOf = mid => squadOf(mid).slice().sort((x, y) => lastSeasonPts(y) - lastSeasonPts(x))[0] || null;
    const starA = bestOf(a), starB = bestOf(b);
    const gfw = showId === 'gfw';
    if (gfw) {
      if (seg.open) B.push(say('Rax Mushden', `Gazette Football Weekly, gameweek ${gwN}, and it's ${dayName(previewAt(i))}, which means we are all briefly optimistic. ${teamName(a)} against ${teamName(b)} is the one we've been asked about.`));
      if (mu.shared.length) {
        B.push(say(P.tactics, `The structural curiosity is ${mu.shared[0]}. Both managers own men there, which means the fixture is partly a wash — whatever happens at that club happens to both of them at once. You are not playing each other so much as playing the difference between you.`));
      } else {
        B.push(say(P.tactics, 'No shared clubs at all between these two squads, which is rarer than it sounds. Every point one of them scores is a point the other genuinely does not have.'));
      }
      if (mu.duels.length) {
        const d = mu.duels[0];
        B.push(say(P.tactics, `And the duel that decides it: ${d.att.name} of ${d.att.club} against ${d.def.name} of ${d.def.club}, in the same match, on opposite sides. One of those two men is going to have a very good afternoon at the other's direct expense, ${pick(GFW_HEDGE, key + ':h2')}.`));
      }
      if (starA && starB) {
        B.push(say(P.colour, `And the two men carrying the weight of it: ${starA.name} for ${teamName(a)}, ${starB.name} for ${teamName(b)}. Both will be watched this weekend by somebody who has no other stake in the match and will feel it far too personally.`));
      }
      B.push(say('Rax Mushden', 'Round the rest of the round, then.'));
      for (const [x, y] of others) {
        const m2 = matchups(x, y, i);
        const line = m2.duels.length
          ? `${teamName(x)} against ${teamName(y)}, where ${m2.duels[0].att.name} and ${m2.duels[0].def.name} are on opposite sides of the same match — a small private war inside a larger one.`
          : m2.shared.length
            ? `${teamName(x)} against ${teamName(y)}, who between them own half of ${m2.shared[0]}. A fixture that partly cancels itself out, which is its own kind of tension.`
            : `${teamName(x)} against ${teamName(y)}, with no overlap at all between the squads. Cleanly opposed, which is rarer than you would think.`;
        B.push(say(hash(key + ':o' + teamName(x)) % 2 ? P.tactics : 'Rax Mushden', line));
      }
      if (tbl.length) {
        B.push(say(P.tactics, `And the table, for those who insist on looking at it in ${gwN < 6 ? 'August' : 'a week like this'}: ${tbl.slice(0, 3).map((r, n) => `${n + 1}, ${teamName(r.id)}`).join('; ')}. I would not read it as a hierarchy yet. I would read it as a mood.`));
      }
      B.push(say(P.colour, 'The rest of the round is the usual quiet violence of a Saturday: eleven other men picking a goalkeeper on a hunch and then not sleeping about it.'));
      B.push(say(P.spain, 'From here it looks like a weekend where the bench decides three of the six. It usually is, and nobody ever believes it until Sunday evening.'));
      if (seg.close) B.push(say('Rax Mushden', 'Set your line-ups, be honest with yourselves about your bench, and we\'ll be back when it\'s all gone wrong. Goodbye.'));
      return { title: `GW${gwN} preview`, dek: 'the fixture, the overlap, and the duel that settles it' };
    }
    if (seg.open) B.push(say('Richard Keyes', `${dayName(previewAt(i)).toUpperCase()}. Gameweek ${gwN}. And the big one: ${(teamName(a) || '').toUpperCase()} against ${(teamName(b) || '').toUpperCase()}.`));
    if (mu.duels.length) {
      const d = mu.duels[0];
      B.push(say('Andy Grey', `And it's a proper old-fashioned tear-up, Richard. ${d.att.name} against ${d.def.name}. Centre-forward against a defender. THAT is football. None of your overlaps. TWO MEN AND A BALL.`));
    }
    if (mu.shared.length) B.push(say('Richard Keyes', `They've BOTH got ${mu.shared[0]} players, Andy. What's the point of that? WHAT IS THE POINT.`));
    B.push(say('Jamie O’Hara-Hara', 'For me, and I played at a good level, whoever benches the wrong man here gets absolutely BURIED and DESERVES IT.'));
    if (starA && starB) B.push(say('Richard Keyes', `${(starA.name || '').toUpperCase()} for one, ${(starB.name || '').toUpperCase()} for the other. Two players. That is the whole game, Andy, and everything else is NOISE.`));
    for (const [x, y] of others) {
      const m2 = matchups(x, y, i);
      const line = m2.duels.length
        ? `${(teamName(x) || '').toUpperCase()} against ${(teamName(y) || '').toUpperCase()} — and they've got ${m2.duels[0].att.name} against ${m2.duels[0].def.name} IN THE SAME GAME. That is your afternoon right there.`
        : m2.shared.length
          ? `${(teamName(x) || '').toUpperCase()} against ${(teamName(y) || '').toUpperCase()}, both loaded up with ${m2.shared[0]}. What is the POINT of that? They cancel each other out and we all have to watch it.`
          : `${(teamName(x) || '').toUpperCase()} against ${(teamName(y) || '').toUpperCase()}. Not one player in common. PROPER fixture, that.`;
      B.push(say(hash(key + ':t' + teamName(x)) % 2 ? 'Andy Grey' : 'Richard Keyes', line));
    }
    B.push(say('Andy Grey', 'And I\'ll be honest with you Richard, half of them will lose it on the BENCH. Not the eleven. The BENCH. It is the same every week and they never learn.'));
    if (tbl.length) B.push(say('Jamie O’Hara-Hara', `Top of the table: ${(teamName(tbl[0].id) || '').toUpperCase()}. And I'm not having it. I'm just NOT HAVING IT.`));
    if (seg.phone !== false) howardIn(key, 'preview', `It's about this ${teamName(a)} and ${teamName(b)} game you keep calling the big one. ${mu.shared.length ? `They've both got ${mu.shared[0]} men in, you said so yourself, so it cancels out and we're all sat here watching a draw happen slowly.` : 'There\'s not a single player in common between them, and nobody has mentioned that all week.'} ${starA ? `And everyone's on about ${starA.name}. He's one man. ONE. You don't win a gameweek with one man, you win it with the four nobody talks about.` : 'It\'ll be decided by somebody nobody has heard of, it always is.'}`)
      .forEach(b => B.push(b));
    B.push(say('Richard Keyes', 'HOT TAKE TIME.'));
    B.push(say('Andy Grey', `HOT TAKE: ${(teamName(b) || '').toUpperCase()} do not have the bottle for this and I have been saying it since August. ${pick(TT_ROAR, key + ':r3')}.`));
    if (seg.close) B.push(say('Richard Keyes', 'Team news before kick-off. Don\'t be a mug. GOODBYE.'));
    return { title: `GW${gwN}: THE BIG PREVIEW`, dek: 'one hot take, one tear-up, no overlaps' };
  }

  /* ---- weekly review ---- */
  function reviewBody(showId, key, i, B, seg = { open: true, close: true, phone: true }) {
    const gwN = GAMEWEEKS[i]?.n;
    if (gwN == null) return null;
    const prs = typeof pairingsFor === 'function' ? pairingsFor(i) : [];
    if (!prs.length) return null;
    const P = panel(key);
    const scored = state.managers.map(m => ({ mid: m.id, pts: gwManagerPoints(m.id, i) })).sort((x, y) => y.pts - x.pts);
    const top = scored[0], bottom = scored[scored.length - 1];
    const results = prs.map(([x, y]) => {
      const px = gwManagerPoints(x, i), py = gwManagerPoints(y, i);
      return { w: px >= py ? x : y, l: px >= py ? y : x, hi: Math.max(px, py), lo: Math.min(px, py) };
    });
    const closest = [...results].sort((r, s) => (r.hi - r.lo) - (s.hi - s.lo))[0];
    const widest = [...results].sort((r, s) => (s.hi - s.lo) - (r.hi - r.lo))[0];
    // the single biggest individual haul of the round, across every squad
    let manOf = null;
    for (const m of state.managers) {
      for (const p of squadOf(m.id)) {
        const pts = (typeof gwPlayerPoints === 'function') ? gwPlayerPoints(p.id, i) : 0;
        if (!manOf || pts > manOf.pts) manOf = { p, pts, mid: m.id };
      }
    }
    if (manOf && manOf.pts <= 0) manOf = null;
    const gfw = showId === 'gfw';
    if (gfw) {
      if (seg.open) B.push(say('Rax Mushden', `Gameweek ${gwN} is settled. ${teamName(top.mid)} top-scored with ${top.pts}.`));
      B.push(say(P.tactics, `Which is a good number, and I'd note it came in a week where the median was considerably lower — so this is a genuine outlier rather than everybody having a nice time at once.`));
      B.push(say('Rax Mushden', `The closest tie: ${teamName(closest.w)} beat ${teamName(closest.l)}, ${closest.hi} to ${closest.lo}.`));
      B.push(say(P.colour, `A ${closest.hi - closest.lo}-point margin is not a result, it is a rounding error with a winner attached. Somewhere a man is looking at his bench and doing arithmetic he will not enjoy.`));
      if (manOf) B.push(say(P.tactics, `The individual return of the week was ${manOf.p.name}, ${manOf.pts} points on his own. One player, in one weekend, worth more than some entire benches.`));
      B.push(say('Rax Mushden', `The round in full: ${results.map(r => `${teamName(r.w)} ${r.hi}, ${teamName(r.l)} ${r.lo}`).join('; ')}.`));
      B.push(say(P.tactics, `${widest.hi - widest.lo} points between ${teamName(widest.w)} and ${teamName(widest.l)} is the widest of the week, and margins that size are almost never about selection. They are about who happened to own a striker who scored twice.`));
      B.push(say(P.spain, `${teamName(bottom.mid)} finished bottom of the week on ${bottom.pts}. I would counsel against reading very much into one round. I would also counsel against saying that to him this evening.`));
      if (seg.close) B.push(say('Rax Mushden', 'Waivers run Tuesday and Friday at ten. Be reasonable with yourselves until then. Goodbye.'));
      return { title: `GW${gwN} reviewed`, dek: 'an outlier, a rounding error, and a difficult evening' };
    }
    if (seg.open) B.push(say('Richard Keyes', `GAMEWEEK ${gwN}. DONE. And ${(teamName(top.mid) || '').toUpperCase()} have put ${top.pts} on the board.`));
    B.push(say('Andy Grey', `That is a PROPER score, Richard. That is a man who picked his best eleven and didn't get clever.`));
    B.push(say('Richard Keyes', `${(teamName(closest.w) || '').toUpperCase()} nick it ${closest.hi}–${closest.lo}. By ${closest.hi - closest.lo}. ${pick(TT_ROAR, key + ':r4')}.`));
    B.push(say('Jamie O’Hara-Hara', 'And that\'s the BENCH, that. That is ENTIRELY THE BENCH.'));
    B.push(say('Richard Keyes', `The rest of it: ${results.map(r => `${(teamName(r.w) || '').toUpperCase()} ${r.hi}, ${teamName(r.l)} ${r.lo}`).join('; ')}.`));
    B.push(say('Andy Grey', `And ${(teamName(widest.w) || '').toUpperCase()} by ${widest.hi - widest.lo}. That is not a defeat, Richard, that is a MESSAGE.`));
    if (manOf) B.push(say('Richard Keyes', `${(manOf.p.name || '').toUpperCase()}. ${manOf.pts} POINTS. On his own. THAT is a footballer and I don't care what the numbers men say about him.`));
    B.push(say('Jamie O’Hara-Hara', 'HOT TAKE: half these lads are not even WATCHING the games. They are watching the APP. WATCH THE FOOTBALL, SON.'));
    if (seg.phone !== false) howardIn(key, 'review', `You're about to do your Fraud of the Week, and I know who you're going to say. ${teamName(bottom.mid)}. ${bottom.pts} points. Well — he's had the same eleven out as the fella who won it, near enough, and one of them scored and one of them didn't. That's not fraud, Richard, that's a SATURDAY. ${manOf ? `And you gave ${manOf.p.name} all that praise for ${manOf.pts}. He was on the bench of three squads in that league. THREE.` : 'Half of this is luck and none of you will say it.'}`)
      .forEach(b => B.push(b));
    B.push(say('Richard Keyes', 'RIGHT. FRAUD OF THE WEEK.'));
    B.push(say('Andy Grey', `${(teamName(bottom.mid) || '').toUpperCase()}. ${bottom.pts} points. In a full gameweek. I don't want to hear about injuries, I don't want to hear about fixtures — FRAUD OF THE WEEK, and he knows it.`));
    B.push(say('Jamie O’Hara-Hara', 'FRAUD.'));
    if (seg.close) B.push(say('Richard Keyes', 'Waivers ten o\'clock, which is STILL RIDICULOUS. Back in the next slot. GET IN.'));
    return { title: `GW${gwN}: FRAUD OF THE WEEK`, dek: 'somebody has been identified and it is not going away' };
  }

  /* ---- the double bill ----
     Marc, 18 Aug: "when there is a midweek gameweek you can just do the review
     and the preview as one slightly longer episode on the tuesday and the
     friday to cover both."

     Which is how every real football podcast handles a midweek round: look
     back at Wednesday, look ahead to Saturday, same programme. It also fixes
     something the fixed slots would otherwise have caused — a Friday with a
     review AND a preview due would have shipped two episodes per show into the
     same minute, competing with each other.

     One opening, one sign-off, one ad break, a bridge in the middle. The two
     halves are the existing bodies with their own top and tail suppressed, so
     there is no second copy of the copy to drift. */
  const BRIDGE = {
    gfw: 'That\'s where we leave the round just gone. Which brings us, neatly enough, to the next one.',
    tt: 'RIGHT. That\'s the midweek. FORGET IT. Because there\'s another one coming and it starts in a DAY AND A HALF.',
  };
  // the gameweek whose review shares a slot with gameweek i's preview
  function reviewSharingSlotWith(i) {
    const at = previewAt(i);
    if (at == null) return null;
    for (let r = Math.max(0, i - 3); r < i; r++) if (reviewAt(r) === at) return r;
    return null;
  }
  function bothBody(showId, key, i, B) {
    const r = reviewSharingSlotWith(i);
    if (r == null) return null;
    const rv = reviewBody(showId, key, r, B, { open: true, close: false, phone: true });
    if (!rv) return null;
    B.push(say(SHOWS[showId].host, BRIDGE[showId] || BRIDGE.gfw));
    const pv = previewBody(showId, key, i, B, { open: false, close: true, phone: false });
    if (!pv) return null;
    const rn = GAMEWEEKS[r]?.n, pn = GAMEWEEKS[i]?.n;
    return showId === 'tt'
      ? { title: `GW${rn} JUDGED, GW${pn} CALLED`, dek: 'a fraud identified and another one lined up' }
      : { title: `GW${rn} reviewed, GW${pn} previewed`, dek: 'a midweek round settled, a weekend already arriving' };
  }

  const episode = (showId, kind, gw) => build(showId, kind, gw);
  const latest = (showId, now) => { const e = latestFor(showId, now); return e ? build(e.show, e.kind, e.gw) : null; };

  return { SHOWS, VOICES, logoSvg, published, latest, episode, sayable, browserSay, lineKey, _previewAt: previewAt, _reviewAt: reviewAt, _matchups: matchups, _draftTable: draftTable };
})();
