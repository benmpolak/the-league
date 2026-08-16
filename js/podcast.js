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
 * Schedule (Marc, 17 Aug):
 *   pilot    — pre-draft, introduces both casts, runs long on purpose
 *   draft    — the moment the board fills; grades, value picks, FRAUDS
 *   preview  — 17:00 London the Friday before a gameweek's first kick-off
 *   review   — one hour after the gameweek's last match settles
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
  };

  /* ---------- the platform desk ----------
     What actually changed, with a take from each register. Hand-authored,
     because "what did we ship" is not derivable from league state — and a
     podcast that invented its own release notes would be worse than useless. */
  const PLATFORM_CHANGES = [
    { what: 'waivers moved to a fixed clock — ten o\'clock, Tuesdays and Fridays',
      gfw: 'which is, if we\'re honest, a quietly progressive act. A fixed time is an accessible time. Everybody plans around the same two moments in the week, and the manager who happens to be free on a Sunday evening no longer has a structural advantage over the manager who is putting children to bed.',
      tt: 'TEN O\'CLOCK? On a TUESDAY? What is anybody doing at ten o\'clock on a Tuesday, son? WORKING. That is what. In my day you posted your team to an address in Essex and if it arrived late THAT WAS YOUR PROBLEM.' },
    { what: 'the Chairman can now skip a waiver run by exception',
      gfw: 'a discretionary power, and I know that makes some of our listeners nervous. But it exists for double gameweeks and for rounds that finish on a Wednesday night, and the claims roll over untouched. Discretion exercised transparently is not the same thing as discretion abused.',
      tt: 'SO HE CAN JUST CANCEL IT. One man. CANCELS THE WAIVERS. That is not a league, that is a MONARCHY, and I will tell you something else for nothing — nobody complained when it was a bloke in Essex with a biro.' },
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
  // 17:00 London on the Friday on or before a gameweek's first kick-off. A
  // Friday-night opener still gets its preview that afternoon.
  function previewAt(i) {
    const k = gwKicks(i);
    if (!k) return null;
    for (let back = 0; back < 8; back++) {
      const at = londonAt(k.first, -back, 17);
      if (at <= k.first && londonDay(at) === 5) return at;
    }
    return londonAt(k.first, -1, 17);
  }
  // an hour after the last match ends — kick-off plus two hours of football
  const reviewAt = i => { const k = gwKicks(i); return k ? k.last + 3 * 3600e3 : null; };

  /* Every episode currently published, newest first. Time enters HERE and
     nowhere else. */
  function published(now = Date.now()) {
    const out = [];
    const drafted = state.phase === 'season' && (state.draft?.picks || []).length > 0;
    for (const id of ['gfw', 'tt']) {
      if (!drafted) { out.push({ show: id, kind: 'pilot', gw: null, at: null }); continue; }
      for (let i = 0; i < REGULAR_GWS; i++) {
        const p = previewAt(i);
        if (p != null && now >= p) out.push({ show: id, kind: 'preview', gw: i, at: p });
        const r = reviewAt(i);
        if (r != null && now >= r && gwStatus(i) === 'final') out.push({ show: id, kind: 'review', gw: i, at: r });
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

  /* ---------- episode assembly ---------- */
  const theme = show => ({ t: 'theme', show, text: show === 'tt' ? '[BRASS STING. AIRHORN. A MAN SHOUTING OVER BOTH]' : '[SPARSE PIANO. A SINGLE CELLO. SOMEBODY SIGHS]' });
  function adBreak(show, key, n) {
    const inv = (typeof POD_ADS !== 'undefined' && POD_ADS[SHOWS[show].ads]) || [];
    if (!inv.length) return null;
    const ad = inv[hash(key + ':ad' + n) % inv.length];
    return { t: 'ad', show, brand: ad.brand, text: ad.read };
  }
  const say = (who, text) => ({ t: 'speech', who, text });

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
    const meta = { pilot: pilotBody, draft: draftBody, preview: previewBody, review: reviewBody }[kind];
    if (!meta) return null;
    const built = meta(showId, key, gw, B);
    if (!built) return null;
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
      const ad1 = adBreak(showId, key, 1); if (ad1) B.push(ad1);
      B.push(say('Rax Mushden', `Last season, then. ${top[0].p.name} finished top of the pile on ${top[0].pts} — with ${top[1].p.name} and ${top[2].p.name} behind him.`));
      B.push(say(P.tactics, `And the warning attached to those numbers is that they are a record of what happened, not a promise about what will. A forward on ${top[0].pts} is being priced by this room as though last season were a season ticket. It is not. It is a receipt.`));
      B.push(say(P.colour, 'There\'s also the matter of who these men play for, and who pays for the shirts they play in. Half this league\'s squads will be sponsored by a betting company or a petrostate before the first kick-off, and we will all say nothing, because the alternative is having to think about it on a Saturday.'));
      B.push(say('Rax Mushden', 'We will come back to that, and I mean it.'));
      const ad2 = adBreak(showId, key, 2); if (ad2) B.push(ad2);
      B.push(say('Rax Mushden', `Favourites. ${favs.map(f => f.team || f.name).join(' and ')} — both previous champions, both entirely capable of it again.`));
      B.push(say(P.spain, 'Though I would gently point out that the previous champion has won this league from the middle of the draft order more than once, which suggests the order matters less than the room believes.'));
      B.push(say('Rax Mushden', 'That\'s the show. Draft well, be kind to each other, and remember that it is August and nothing has gone wrong yet. Goodbye.'));
      return { title: 'The Season Preview', dek: 'edition zero · the draft has not happened and hope is undefeated' };
    }
    B.push(say('Richard Keyes', 'RIGHT. talkTROUGH. Richard Keyes with you, and alongside me, as always, a man who scored goals for a living — Andy Grey.'));
    B.push(say('Andy Grey', 'Richard.'));
    B.push(say('Richard Keyes', 'And a young man who played at a very good level and will not let it go — Jamie.'));
    B.push(say('Jamie O’Hara-Hara', 'I played at a VERY good level, Richard, and I\'ll tell you now, this league has gone SOFT.'));
    B.push(say('Richard Keyes', 'Well let\'s get into it, because they have CHANGED THINGS AGAIN.'));
    for (const c of changes) B.push(say(c === changes[0] ? 'Andy Grey' : (c === changes[1] ? 'Jamie O’Hara-Hara' : 'Richard Keyes'), `${c.what.toUpperCase()}. ${c.tt}`));
    B.push(say('Andy Grey', 'I\'ll tell you what it is, Richard. It\'s WOKE NONSENSE. You used to write your team on a piece of paper and POST IT to an address in Essex. If it got there, it got there. If it didn\'t, you had a WORD WITH YOURSELF and you didn\'t do it again.'));
    B.push(say('Richard Keyes', `And nobody died, Andy. NOBODY DIED. ${pick(TT_ROAR, key + ':r1')}.`));
    const a1 = adBreak(showId, key, 1); if (a1) B.push(a1);
    B.push(say('Richard Keyes', `Last season. ${top[0].p.name}, ${top[0].pts} points. Best in the league by a MILE.`));
    B.push(say('Andy Grey', `And he did it WITHOUT a computer telling him where to stand. ${top[1].p.name} and ${top[2].p.name} behind him and I\'d take all three tomorrow.`));
    B.push(say('Jamie O’Hara-Hara', 'See for me, and I played at a good level, the problem with this league is there\'s not enough BRITISH players getting drafted. Managers should have to pick FIVE. Minimum.'));
    B.push(say('Andy Grey', 'And they should show a bit more RESPECT around Remembrance weekend, but nobody wants to hear it from me.'));
    const a2 = adBreak(showId, key, 2); if (a2) B.push(a2);
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
      const ad1 = adBreak(showId, key, 1); if (ad1) B.push(ad1);
      B.push(say('Rax Mushden', 'Grades, then, and with the caveat that grading a draft in August is a form of entertainment rather than analysis.'));
      B.push(say(P.tactics, table.slice(0, 4).map(r => `${teamName(r.mid)}, ${r.grade}`).join('. ') + '. Those four have depth as well as a top end, which is the thing that survives an injury.'));
      B.push(say(P.tactics, table.slice(4, 8).map(r => `${teamName(r.mid)}, ${r.grade}`).join('. ') + '. All perfectly sound, all one bad month from a rebuild.'));
      B.push(say(P.colour, table.slice(8).map(r => `${teamName(r.mid)}, ${r.grade}`).join('. ') + '. And I want to be careful with that bottom group, because a low grade in August is a story about last season, not this one.'));
      B.push(say(P.colour, `At the other end, ${teamName(worst.mid)} have had what we would traditionally call a difficult evening. I would encourage everyone to remember that it is a game about a game.`));
      const topMan = squadOf(best.mid).slice().sort((x, y) => lastSeasonPts(y) - lastSeasonPts(x))[0];
      const lowMan = squadOf(worst.mid).slice().sort((x, y) => lastSeasonPts(y) - lastSeasonPts(x))[0];
      if (topMan) B.push(say(P.tactics, `${teamName(best.mid)} are built around ${topMan.name}, and that is both the strength and the risk. A squad with one obvious best player is a squad with one obvious way to fail.`));
      if (lowMan) B.push(say(P.colour, `Whereas ${teamName(worst.mid)} lead with ${lowMan.name}, which is a perfectly respectable place to start and a difficult place to finish.`));
      const ad2 = adBreak(showId, key, 2); if (ad2) B.push(ad2);
      B.push(say(P.spain, 'From Spain, the only observation worth making: every one of these squads will be unrecognisable by Christmas. The draft is the beginning of the argument, not the end of it.'));
      B.push(say('Rax Mushden', 'Well said. Enjoy your squads while they are still theoretical. Goodbye.'));
      return { title: 'Draft Night: the twelve squads', dek: 'grades, value, and one act of the heart' };
    }
    B.push(say('Richard Keyes', 'THE DRAFT IS OVER and I can tell you now who has WON it.'));
    B.push(say('Andy Grey', `${(teamName(best.mid) || '').toUpperCase()}. Not close, Richard. NOT CLOSE. That is the best squad in this league and everybody watching knows it.`));
    B.push(say('Richard Keyes', `And who has FLOPPED, Andy? Because somebody always does.`));
    B.push(say('Andy Grey', `${(teamName(worst.mid) || '').toUpperCase()}. What was that? WHAT WAS THAT. I've seen some drafts, Richard, and that is a shambles.`));
    B.push(say('Jamie O’Hara-Hara', `He's a FRAUD, Andy. I'll say it. FRAUD.`));
    const a1 = adBreak(showId, key, 1); if (a1) B.push(a1);
    if (value.length) B.push(say('Andy Grey', `${value[0].p.name} at pick ${value[0].n} though — THAT is a proper bit of business. ${pick(TT_ROAR, key + ':r2')}.`));
    if (value[1]) B.push(say('Jamie O’Hara-Hara', `And ${value[1].p.name} at ${value[1].n}. I'd have gone THREE ROUNDS EARLIER and I'd have been right.`));
    if (reach.length) B.push(say('Richard Keyes', `And ${reach[0].p.name} at ${reach[0].n}?! WHAT ARE YOU DOING. You could have had him THREE ROUNDS LATER and everybody in that room knew it.`));
    if (reach[1]) B.push(say('Andy Grey', `${reach[1].p.name} at ${reach[1].n} as well. They've panicked, Richard. You can SMELL a panic pick.`));
    B.push(say('Richard Keyes', `And the ones in the middle? ${table.slice(4, 8).map(r => (teamName(r.mid) || '').toUpperCase()).join(', ')}. NOTHING SIDES. Not good enough to win it, not bad enough to be interesting.`));
    B.push(say('Jamie O’Hara-Hara', 'That\'s where you get relegated from. MENTALLY.'));
    const a2 = adBreak(showId, key, 2); if (a2) B.push(a2);
    B.push(say('Jamie O’Hara-Hara', 'And not enough British lads. AGAIN. I counted.'));
    B.push(say('Andy Grey', `And I'll say this for nothing — the lad who's WON this draft has done it by taking the OBVIOUS player every single time. No cleverness. No spreadsheet. Just the best one left. ${pick(TT_ROAR, key + ':r5')}.`));
    B.push(say('Richard Keyes', 'That is what everybody has forgotten, Andy. TAKE THE BEST PLAYER.'));
    B.push(say('Richard Keyes', 'Gameweek one Friday. We\'ll be here. GET IN.'));
    return { title: 'WHO WON THE DRAFT', dek: 'somebody is a fraud and the lads have identified him' };
  }

  /* ---- weekly preview ---- */
  function previewBody(showId, key, i, B) {
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
      B.push(say('Rax Mushden', `Gazette Football Weekly, gameweek ${gwN}, and it's Friday, which means we are all briefly optimistic. ${teamName(a)} against ${teamName(b)} is the one we've been asked about.`));
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
      const ad1 = adBreak(showId, key, 1); if (ad1) B.push(ad1);
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
      const ad2 = adBreak(showId, key, 2); if (ad2) B.push(ad2);
      B.push(say('Rax Mushden', 'Set your line-ups, be honest with yourselves about your bench, and we\'ll be back when it\'s all gone wrong. Goodbye.'));
      return { title: `GW${gwN} preview`, dek: 'the fixture, the overlap, and the duel that settles it' };
    }
    B.push(say('Richard Keyes', `FRIDAY. Gameweek ${gwN}. And the big one: ${(teamName(a) || '').toUpperCase()} against ${(teamName(b) || '').toUpperCase()}.`));
    if (mu.duels.length) {
      const d = mu.duels[0];
      B.push(say('Andy Grey', `And it's a proper old-fashioned tear-up, Richard. ${d.att.name} against ${d.def.name}. Centre-forward against a defender. THAT is football. None of your overlaps. TWO MEN AND A BALL.`));
    }
    if (mu.shared.length) B.push(say('Richard Keyes', `They've BOTH got ${mu.shared[0]} players, Andy. What's the point of that? WHAT IS THE POINT.`));
    B.push(say('Jamie O’Hara-Hara', 'For me, and I played at a good level, whoever benches the wrong man here gets absolutely BURIED and deserves it.'));
    if (starA && starB) B.push(say('Richard Keyes', `${(starA.name || '').toUpperCase()} for one, ${(starB.name || '').toUpperCase()} for the other. Two players. That is the whole game, Andy, and everything else is NOISE.`));
    const a1 = adBreak(showId, key, 1); if (a1) B.push(a1);
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
    B.push(say('Richard Keyes', 'HOT TAKE TIME.'));
    B.push(say('Andy Grey', `HOT TAKE: ${(teamName(b) || '').toUpperCase()} do not have the bottle for this and I have been saying it since August. ${pick(TT_ROAR, key + ':r3')}.`));
    const a2 = adBreak(showId, key, 2); if (a2) B.push(a2);
    B.push(say('Richard Keyes', 'Team news Saturday. Don\'t be a mug. GOODBYE.'));
    return { title: `GW${gwN}: THE BIG PREVIEW`, dek: 'one hot take, one tear-up, no overlaps' };
  }

  /* ---- weekly review ---- */
  function reviewBody(showId, key, i, B) {
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
      B.push(say('Rax Mushden', `Gameweek ${gwN} is settled. ${teamName(top.mid)} top-scored with ${top.pts}.`));
      B.push(say(P.tactics, `Which is a good number, and I'd note it came in a week where the median was considerably lower — so this is a genuine outlier rather than everybody having a nice time at once.`));
      B.push(say('Rax Mushden', `The closest tie: ${teamName(closest.w)} beat ${teamName(closest.l)}, ${closest.hi} to ${closest.lo}.`));
      B.push(say(P.colour, `A ${closest.hi - closest.lo}-point margin is not a result, it is a rounding error with a winner attached. Somewhere a man is looking at his bench and doing arithmetic he will not enjoy.`));
      const ad1 = adBreak(showId, key, 1); if (ad1) B.push(ad1);
      if (manOf) B.push(say(P.tactics, `The individual return of the week was ${manOf.p.name}, ${manOf.pts} points on his own. One player, in one weekend, worth more than some entire benches.`));
      B.push(say('Rax Mushden', `The round in full: ${results.map(r => `${teamName(r.w)} ${r.hi}, ${teamName(r.l)} ${r.lo}`).join('; ')}.`));
      B.push(say(P.tactics, `${widest.hi - widest.lo} points between ${teamName(widest.w)} and ${teamName(widest.l)} is the widest of the week, and margins that size are almost never about selection. They are about who happened to own a striker who scored twice.`));
      B.push(say(P.spain, `${teamName(bottom.mid)} finished bottom of the week on ${bottom.pts}. I would counsel against reading very much into one round. I would also counsel against saying that to him this evening.`));
      const ad2 = adBreak(showId, key, 2); if (ad2) B.push(ad2);
      B.push(say('Rax Mushden', 'Waivers run Tuesday at ten. Be reasonable with yourselves until then. Goodbye.'));
      return { title: `GW${gwN} reviewed`, dek: 'an outlier, a rounding error, and a difficult evening' };
    }
    B.push(say('Richard Keyes', `GAMEWEEK ${gwN}. DONE. And ${(teamName(top.mid) || '').toUpperCase()} have put ${top.pts} on the board.`));
    B.push(say('Andy Grey', `That is a PROPER score, Richard. That is a man who picked his best eleven and didn't get clever.`));
    B.push(say('Richard Keyes', `${(teamName(closest.w) || '').toUpperCase()} nick it ${closest.hi}–${closest.lo}. By ${closest.hi - closest.lo}. ${pick(TT_ROAR, key + ':r4')}.`));
    B.push(say('Jamie O’Hara-Hara', 'And that\'s the bench, that. That is ENTIRELY the bench.'));
    const a1 = adBreak(showId, key, 1); if (a1) B.push(a1);
    B.push(say('Richard Keyes', `The rest of it: ${results.map(r => `${(teamName(r.w) || '').toUpperCase()} ${r.hi}, ${teamName(r.l)} ${r.lo}`).join('; ')}.`));
    B.push(say('Andy Grey', `And ${(teamName(widest.w) || '').toUpperCase()} by ${widest.hi - widest.lo}. That is not a defeat, Richard, that is a MESSAGE.`));
    if (manOf) B.push(say('Richard Keyes', `${(manOf.p.name || '').toUpperCase()}. ${manOf.pts} POINTS. On his own. THAT is a footballer and I don't care what the numbers men say about him.`));
    B.push(say('Jamie O’Hara-Hara', 'HOT TAKE: half these lads are not even watching the games. They are watching the APP. Watch the FOOTBALL, son.'));
    B.push(say('Richard Keyes', 'RIGHT. FRAUD OF THE WEEK.'));
    B.push(say('Andy Grey', `${(teamName(bottom.mid) || '').toUpperCase()}. ${bottom.pts} points. In a full gameweek. I don't want to hear about injuries, I don't want to hear about fixtures — FRAUD OF THE WEEK, and he knows it.`));
    B.push(say('Jamie O’Hara-Hara', 'FRAUD.'));
    const a2 = adBreak(showId, key, 2); if (a2) B.push(a2);
    B.push(say('Richard Keyes', 'Waivers Tuesday, ten o\'clock, which is STILL RIDICULOUS. See you Friday. GET IN.'));
    return { title: `GW${gwN}: FRAUD OF THE WEEK`, dek: 'somebody has been identified and it is not going away' };
  }

  const episode = (showId, kind, gw) => build(showId, kind, gw);
  const latest = (showId, now) => { const e = latestFor(showId, now); return e ? build(e.show, e.kind, e.gw) : null; };

  return { SHOWS, VOICES, published, latest, episode, _previewAt: previewAt, _reviewAt: reviewAt, _matchups: matchups, _draftTable: draftTable };
})();
