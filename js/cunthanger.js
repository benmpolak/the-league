/* Cunthanger — the League's own social network.
 *
 * Commissioned in the group chat, 3 Sep 2026. Marc: "a live matchday twitter
 * feed full of nonsense characters tweeting the sort of things melty fans
 * tweet". Ric named it. Ian wanted the spoof press and Matt Le Tus. The
 * Gazette and both stations now sit under it; the app itself is untouched.
 *
 * Same contract as the Gazette and the Podcunt Network: DETERMINISTIC. Every
 * post is a function of the events app.js hands in — own hash, no Math.random,
 * no Date.now() in content — so every phone shows the identical timeline and
 * a goal that happened before you opened the app is on it. This file emits
 * PLAIN TEXT; app.js escapes at the point of use.
 *
 * Accounts are never the managers. Fans and hacks only. Manager posts (the
 * press-conference feature) are phase two and arrive through the server.
 */
'use strict';
window.Cunthanger = (() => {

  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const pick = (arr, key) => arr[hash(key) % arr.length];

  const FANS = () => (typeof CUNTHANGER_FANS !== 'undefined' ? CUNTHANGER_FANS : {});
  const PRESS = () => (typeof CUNTHANGER_PRESS !== 'undefined' ? CUNTHANGER_PRESS : []);
  // top-level consts from lore.js are not window properties, so name them
  const DX = () => (typeof CUNTHANGER_DIAGNOSES !== 'undefined' ? CUNTHANGER_DIAGNOSES : ['a knock']);
  const RET = () => (typeof CUNTHANGER_RETURNS !== 'undefined' ? CUNTHANGER_RETURNS : ['soon']);
  const LETUS = () => (typeof CUNTHANGER_LETUS !== 'undefined' ? CUNTHANGER_LETUS : ['Do your own research.']);

  const TAKEOVER = {
    tag: 'Emergency alert',
    head: 'This is a test of the Cunthanger Alert System.',
    lines: [
      'The League Gazette and talkTROUGH have been acquired by Cunthanger.',
      'More media assets to be launched in due cunt.',
      'Ownership of Cunthanger remains undisclosed.',
    ],
    foot: 'No action is required. Do not push your mum down the stairs to test it.',
  };

  /* ---------- accounts ---------- */

  // what a fan calls the club: lore first, then the team name with the
  // punctuation and the "FC" taken off
  function shortName(mid, teamName) {
    const lore = FANS()[mid];
    if (lore?.short) return lore.short;
    const clean = String(teamName || '').replace(/[*°]/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\bFC\b/g, '').trim();
    return clean.replace(/\s+/g, ' ') || `Club ${mid}`;
  }
  function fan(mid, mood, teamName) {
    const lore = FANS()[mid];
    const a = lore?.[mood];
    const short = shortName(mid, teamName);
    if (a) return { h: a.h, n: a.n, kind: 'fan', mood, mid, short };
    const stem = short.replace(/[^A-Za-z0-9]/g, '');
    return mood === 'melt'
      ? { h: `${stem}TilIDie`, n: `${short} Loyal`, kind: 'fan', mood, mid, short }
      : { h: `${stem}Watch`, n: `${short} Watch`, kind: 'fan', mood, mid, short };
  }
  function press(beat) {
    const p = PRESS().find(x => x.beat === beat) || PRESS()[0] || { h: 'Cunthanger', n: 'Cunthanger', beat };
    return { h: p.h, n: p.n, kind: 'press', beat: p.beat, bio: p.bio };
  }

  /* ---------- phrase banks ----------
     {P} player, {club} his PL club, {wor} 'wor ' for a Newcastle man, {team} the fantasy club's full name,
     {short} what the fan calls it, {mgr} manager's first name, {opp} opponent
     fantasy club, {n} count, {pts} points, {gw} gameweek number. */
  const B = {
    goal_xi_melt: [
      '{P} SCORES. {short} ARE BACK. WE GO AGAIN.',
      '{P}. Class that, from a {short} fan.',
      'I said in August {P} was the pick and got laughed at. Where are you all now.',
      'IN. {P}. {mgr} knows ball. Never doubted him. Delete my tweets from Tuesday.',
      '{P} has just scored and I have knocked a full pint over my son.',
      '{P}. {club}. {short}. Sing it. SING IT.',
      'Goal {P}. Not reading the replies. Not reading anything. {short} til I die.',
    ],
    goal_xi_multi_melt: [
      '{P} {n} GOALS. {n}. I am on the ceiling. I am not coming down.',
      '{n} for {P}. Deleting every tweet I have ever sent about him.',
      '{P} has {n} and my neighbour has called the police. Worth it.',
    ],
    goal_xi_sage: [
      '{P} goal. The underlying numbers said this was coming. Patience.',
      'Good finish from {P}. Won’t change my view that the squad is thin.',
      '{P} was always going to score in this fixture. Told you in the group. Screenshot it.',
      '{P}. Fine. Now let’s see him do it when it matters. (It does not matter.)',
    ],
    goal_bench_melt: [
      '{P} SCORES. ON THE BENCH. {mgr} OUT.',
      'BENCHED. {P}. BENCHED. I am actually done with this club.',
      'Can someone explain why {P} was on the bench. Genuinely. I’ll wait.',
      '{P} goal. From the bench. {pts} points rotting. {mgr} has lost the dressing room and the dressing room is me.',
      '{P} scores while {mgr} plays a man with a broken foot. Not a football club. A charity.',
    ],
    goal_bench_sage: [
      '{P} from the bench. The selection process at {team} needs looking at, calmly.',
      'Hindsight is easy. Benching {P} was also easy, and wrong.',
      '{P} scores unpicked. I raised this on Thursday. Nobody listens on Thursday.',
    ],
    goal_trough_wire: [
      'Understand {P} ({club}) — currently unattached in the Trough — has scored. Interest from several League clubs expected. More to follow.',
      'Can confirm {P} ({club}) scored today and is available for nothing. Sources say “nothing” is the sticking point.',
    ],
    goal_trough_transfers: [
      '🚨 {P} ({club}) has scored and is FREE in the Trough. Clubs informed. Here we go soon? 🤝',
      '{P} 🔴⚪ scored today. Unattached. Twelve clubs monitoring, eleven of them asleep.',
    ],
    assist_melt: [
      '{P} assist. Quietly the best signing {mgr} made. Not so quiet now.',
      'ASSIST. {P}. He was NEVER a waste of a pick. Never.',
      '{P} with the assist. That’s a {short} player. That’s what we do.',
    ],
    assist_sage: [
      '{P} assist. The creative numbers were always there for anyone who looked.',
      '{P} laid it on. Underrated at draft, still underrated now, by everyone but me.',
    ],
    red_melt: [
      '{P} SENT OFF. {short} points GONE. I hate this club.',
      'Red card {P}. Absolute disgrace. Referees have hated {short} since 2015.',
      '{P}. Off. Cheers. Cheers for that. Lovely stuff.',
      'RED. {P}. Turned the telly off. Turned the lights off. Sat in the dark.',
    ],
    red_sage: [
      '{P} red. Discipline has been a concern since pre-season. Not surprised, not angry.',
      '{P} sent off. He was on a yellow. Everybody could see he was on a yellow.',
    ],
    penmiss_melt: [
      '{P} MISSED A PEN. Not watching any more football this year.',
      'How do you miss that. {P}. HOW.',
      '{P} penalty. Saved. I have thrown my phone and I am typing this on my wife’s.',
    ],
    penmiss_sage: [
      '{P} penalty miss. Keeper guessed right. It happens. It happens to {short} more than most, statistically.',
    ],
    owngoal_melt: [
      '{P} own goal. Of course. OF COURSE.',
      '{P} scores. Wrong end. Typical {short}. Typical.',
    ],
    owngoal_sage: [
      '{P} own goal. Unlucky deflection, whatever the lads in the replies say.',
    ],
    pensave_melt: [
      '{P} SAVES A PEN. BEST KEEPER IN THE WORLD. DON’T @ ME.',
      'PENALTY SAVED. {P}. Sign him up for life. Sign his kids up.',
    ],
    pensave_sage: [
      '{P} penalty save. Elite positioning. Been saying it.',
    ],
    yellow_melt: [
      '{P} booked. Minus one. The officials had this planned before kick-off.',
      'Yellow for {P}. For breathing. For being a {short} player.',
    ],
    haul_melt: [
      '{P} {pts} POINTS. {pts}. I am screaming. My wife has left the room.',
      '{pts} for {P}. Put him in the Louvre.',
      '{P}. {pts}. If you doubted him you are not welcome at this account.',
    ],
    haul_sage: [
      '{P} with {pts}. As predicted by literally nobody except me. Receipts on request.',
      '{pts} for {P}. The model had 9. The model is broken, and so is everyone else.',
    ],
    injury_press: [
      '{wor}{P} ({club}). Club line: “{news}.” Our understanding: {diag}. Return: {ret}.',
      'Update on {wor}{P} ({club}) — {news}. Sources close to the physio: {diag}. Timescale: {ret}.',
      '{wor}{P} ({club}). Official: {news}. Unofficial: {diag}. Back {ret}.',
      '{wor}{P} out {ret} with {diag}. Club say “{news}”. Club would.',
    ],
    injury_melt: [
      '{P} injured. {short}’s season over in week {gw}. Every year. EVERY YEAR.',
      '{P} out. {mgr} will not sign a replacement because {mgr} does not care. Sad.',
      '{P} injured and I have had a text from my mum asking if I’m ok. No.',
    ],
    injury_sage: [
      '{P} injury. Depth was the question in August. Still the question.',
    ],
    signing_transfers: [
      '🚨 Here we go! {P} to {team}, done deal. {mgr} convinced him with one phone call and a lasagne. 🤝',
      '{P} ➡️ {team}. Here we go. Personal terms agreed in the Trough. Medical waived, as tradition. 🤝',
      'EXCL: {P} to {team}. Confirmed. {mgr} personally drove him there. Here we go 🤝',
    ],
    signing_melt: [
      '{P} IN. {mgr} has FINALLY listened. Title on.',
      '{P}. Signed. {short} mean business. Stop laughing.',
      '{P} in. Do not care what anyone says. Best bit of business in the League. Squad is done. Squad is DONE.',
    ],
    signing_sage: [
      '{P} to {team}. Sensible. Fills a need. Won’t change much.',
      '{P} in for {team}. A depth signing, being sold as a statement. Fine.',
    ],
    pre_melt: [
      '{opp} this week. I am not nervous. I am NOT nervous.',
      'Beat {opp} or {mgr} needs to have a long look at himself.',
      '{opp}. Sunday. My whole week depends on eleven men I have never met.',
      'If {short} lose to {opp} I am not coming back on here. (I am coming back on here.)',
    ],
    pre_sage: [
      '{team} v {opp}. On paper we should win. Football is not played on paper, it is played on my mental health.',
      '{opp} this week. Projection says close. Projection has never watched {short}.',
    ],
    live_up_melt: [
      '{short} {my}–{their} up on {opp}. Don’t say it. DON’T SAY IT.',
      '{my}–{their}. Up. Not celebrating. Sat very still. Not moving until Monday.',
    ],
    live_down_melt: [
      '{my}–{their} down to {opp}. Same old {short}.',
      'Losing to {opp}. {mgr} out. Board out. Kit man out. Kit man’s dog out.',
    ],
    live_level_melt: [
      'Level with {opp}. My heart cannot take level.',
    ],
    live_sage: [
      '{short} {my}–{their} {opp}, plenty still to play. Keep it calm. Nobody keeps it calm.',
    ],
    won_melt: [
      'THREE POINTS. {short}. FROM THE TOP. WE GO AGAIN.',
      '{my}–{their}. Beat {opp}. Never in doubt. (Massively in doubt.)',
      '{opp} done. {short} were {short}. That’s it, that’s the tweet.',
      'Won. {my}–{their}. Not going to gloat. Going to gloat. {opp} where are you.',
      '{mgr} MASTERCLASS. {my}–{their} over {opp}. Give him the keys. Give him the whole building.',
      'Beat {opp} and my kids have never seen me like this. Good.',
    ],
    won_sage: [
      '{team} {my}–{their} {opp}. Deserved, on the numbers. The numbers I have. Nobody else has them.',
    ],
    lost_melt: [
      'Lost to {opp}. I’m out. Deleting the app. (Not deleting the app.)',
      '{my}–{their} to {opp}. Every. Single. Year.',
      'Beaten by {opp}. {mgr} out. I mean it this time. I always mean it.',
      '{my}–{their}. Lost to {opp}. Not angry. Just tired. Just so tired.',
      'How have we lost to {opp}. HOW. Somebody at {short} needs to answer for this and it is {mgr}.',
      'Lost. To {opp}. Of all people. Going for a walk. A long one. In the sea.',
    ],
    lost_sage: [
      '{my}–{their} to {opp}. Bench points would have won it. Structural, not bad luck.',
    ],
    drew_melt: [
      'A draw with {opp}. Feels like a loss. Everything feels like a loss.',
      '{my}–{their}. Drew with {opp}. One point each and I want none of it.',
    ],
    drew_sage: [
      '{my}–{their}. A draw with {opp} is a fair result, which is the worst kind of result.',
    ],
  };

  const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || 'the gaffer';
  // the club office allows *° and emoji in a team name; a tweet does not
  const cleanTeam = (t) => String(t || '').replace(/[*°]/g, '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();
  const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));

  /* ---------- the timeline ----------
     events: [{ type, key, at, live, sortKick, ... }] built by app.js from
     public state. Returns posts newest-story-first, identical everywhere. */
  function compose(events, ctx = {}) {
    const teamName = ctx.teamName || (mid => `Club ${mid}`);
    const managerName = ctx.managerName || (mid => `Manager ${mid}`);
    const out = [];
    const add = (acct, key, tpl, vars, meta) => {
      if (!tpl) return;
      out.push({ key, who: acct, text: fill(tpl, vars), at: meta.at || '', live: !!meta.live, w: meta.w || 0, sortKick: meta.sortKick || 0 });
    };
    const vars = (e, extra = {}) => {
      const mid = e.mid;
      const t = mid != null ? teamName(mid) : '';
      // Ben Suppery is a Newcastle man (Ian: "wor Joelinton out for 2-4 weeks")
      return { P: e.player || '', club: e.club || '', wor: e.club === 'NEW' ? 'wor ' : '', team: cleanTeam(t), short: mid != null ? shortName(mid, t) : '',
        mgr: mid != null ? firstName(managerName(mid)) : '', opp: e.oppMid != null ? cleanTeam(teamName(e.oppMid)) : '',
        n: e.n ?? '', pts: e.pts ?? '', gw: e.gwN ?? '', my: e.my ?? '', their: e.their ?? '', ...extra };
    };
    for (const e of events || []) {
      const k = e.key || `${e.type}:${e.player || ''}:${e.mid ?? ''}:${e.gwN ?? ''}`;
      const meta = { at: e.at, live: e.live, sortKick: e.sortKick, w: e.w };
      const tn = e.mid != null ? teamName(e.mid) : '';
      const melt = e.mid != null ? fan(e.mid, 'melt', tn) : null;
      const sage = e.mid != null ? fan(e.mid, 'sage', tn) : null;
      // which supporter speaks: the melt most of the time, the sage when the hash says so
      const voice = hash(k + ':voice') % 3 === 0 ? 'sage' : 'melt';
      const who = voice === 'sage' ? sage : melt;
      switch (e.type) {
        case 'goal': {
          if (e.role === 'trough') {
            const beat = hash(k) % 2 ? 'wire' : 'transfers';
            add(press(beat), k, pick(B[beat === 'wire' ? 'goal_trough_wire' : 'goal_trough_transfers'], k), vars(e), { ...meta, w: 3 });
            break;
          }
          if (e.role === 'bench') { add(who, k, pick(voice === 'sage' ? B.goal_bench_sage : B.goal_bench_melt, k), vars(e), { ...meta, w: 7 }); break; }
          const multi = (e.n || 1) > 1 && voice === 'melt';
          add(who, k, pick(multi ? B.goal_xi_multi_melt : voice === 'sage' ? B.goal_xi_sage : B.goal_xi_melt, k), vars(e), { ...meta, w: 8 });
          break;
        }
        case 'haul': add(who, k, pick(voice === 'sage' ? B.haul_sage : B.haul_melt, k), vars(e), { ...meta, w: 9 }); break;
        case 'assist': if (e.role !== 'trough') add(who, k, pick(voice === 'sage' ? B.assist_sage : B.assist_melt, k), vars(e), { ...meta, w: 5 }); break;
        case 'red': if (e.role !== 'trough') add(who, k, pick(voice === 'sage' ? B.red_sage : B.red_melt, k), vars(e), { ...meta, w: 7 }); break;
        case 'penmiss': if (e.role !== 'trough') add(who, k, pick(voice === 'sage' ? B.penmiss_sage : B.penmiss_melt, k), vars(e), { ...meta, w: 6 }); break;
        case 'owngoal': if (e.role !== 'trough') add(who, k, pick(voice === 'sage' ? B.owngoal_sage : B.owngoal_melt, k), vars(e), { ...meta, w: 6 }); break;
        case 'pensave': if (e.role !== 'trough') add(who, k, pick(voice === 'sage' ? B.pensave_sage : B.pensave_melt, k), vars(e), { ...meta, w: 6 }); break;
        case 'yellow': if (e.role === 'xi' && hash(k + ':yc') % 3 === 0) add(melt, k, pick(B.yellow_melt, k), vars(e), { ...meta, w: 1 }); break;
        case 'injury': {
          const diag = pick(DX(), k + ':dx'), ret = pick(RET(), k + ':ret');
          const news = String(e.news || 'unavailable').replace(/\.\s*$/, '');
          add(press('injury'), k, pick(B.injury_press, k), vars(e, { news, diag, ret }), { ...meta, w: 4 });
          if (e.mid != null && hash(k + ':fan') % 2 === 0) add(who, k + ':fan', pick(voice === 'sage' ? B.injury_sage : B.injury_melt, k), vars(e), { ...meta, w: 3 });
          break;
        }
        case 'signing': {
          add(press('transfers'), k, pick(B.signing_transfers, k), vars(e), { ...meta, w: 4 });
          if (hash(k + ':fan') % 2 === 0) add(who, k + ':fan', pick(voice === 'sage' ? B.signing_sage : B.signing_melt, k), vars(e), { ...meta, w: 3 });
          break;
        }
        case 'fixture': {
          const v = vars(e);
          if (e.state === 'pre') add(who, k, pick(voice === 'sage' ? B.pre_sage : B.pre_melt, k), v, { ...meta, w: 2 });
          else if (e.state === 'live') {
            const my = +e.my || 0, th = +e.their || 0;
            const tpl = voice === 'sage' ? pick(B.live_sage, k) : pick(my > th ? B.live_up_melt : my < th ? B.live_down_melt : B.live_level_melt, k);
            add(who, k, tpl, v, { ...meta, w: 6 });
          } else if (e.state === 'over') {
            const my = +e.my || 0, th = +e.their || 0;
            const res = my > th ? 'won' : my < th ? 'lost' : 'drew';
            add(who, k, pick(B[`${res}_${voice}`], k), v, { ...meta, w: 5 });
          }
          break;
        }
        case 'letus': add(press('conspiracy'), k, pick(LETUS(), k), vars(e), { ...meta, w: 2 }); break;
        default: break;
      }
    }
    // live matches on top, then the most recent kickoff, then the biggest
    // story; the tail settled by key so the order is total and identical
    out.sort((a, b) => (b.live - a.live) || (b.sortKick - a.sortKick) || (b.w - a.w) || a.key.localeCompare(b.key));
    return out;
  }

  // the roster, for the bio strip: every fan account plus the press
  function accounts(managers, teamName) {
    const rows = [];
    for (const m of managers || []) {
      const t = teamName ? teamName(m.id) : m.team;
      rows.push(fan(m.id, 'melt', t), fan(m.id, 'sage', t));
    }
    for (const p of PRESS()) rows.push({ h: p.h, n: p.n, kind: 'press', beat: p.beat, bio: p.bio });
    return rows;
  }

  return { compose, accounts, fan, press, shortName, TAKEOVER, BANKS: B, hash };
})();
