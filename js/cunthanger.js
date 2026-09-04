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
    ],
    foot: 'No action is required. You may return to your squad.',
  };

  /* ---------- accounts ---------- */

  // the club office allows *° and emoji in a team name; a tweet does not
  // (the duck stays — Ben, 3 Sep: "why is mighty just mighty not mighty ducks")
  const cleanTeam = (t) => String(t || '').replace(/[*°]/g, '').replace(/\s+/g, ' ').trim();

  // what a fan calls the club: lore first, then the team name with the
  // punctuation and the "FC" taken off
  function shortName(mid, teamName) {
    const lore = FANS()[mid];
    if (lore?.short) return lore.short;
    const clean = String(teamName || '').replace(/[*°]/g, '').replace(/\bFC\b/g, '').trim();
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
  // the managers themselves, under the club handle: the only accounts on
  // here that a real person types into
  function manager(mid, teamName, managerName, handle) {
    const clean = cleanTeam(teamName);
    const stem = clean.replace(/[^A-Za-z0-9]/g, '') || `Club${mid}`;
    return { h: String(handle || '').replace(/[^A-Za-z0-9_]/g, '') || `${stem}Official`, n: String(managerName || `Manager ${mid}`), kind: 'manager', mid, short: shortName(mid, teamName) };
  }
  function press(beat, key = '') {
    const pool = PRESS().filter(x => x.beat === beat);
    const p = pool.length ? pool[hash(String(key) + ':press') % pool.length] : (PRESS()[0] || { h: 'Cunthanger', n: 'Cunthanger', beat });
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
    // Jacobean does not say here we go. Jacobean can reveal.
    signing_jacobean: [
      'EXCLUSIVE: {P} to {team}. Deal done in the Trough overnight. Understand {mgr} led the talks personally. More soon.',
      'Can reveal {P} has joined {team}. Told the move came together fast. {mgr} pushed hard. Story developing.',
      '{P} ➡️ {team}. Confirmed by sources on both sides, one of which is {mgr}, the other of which is also {mgr}.',
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

  /* ---------- the press room ----------
     Ben, 3 Sep: "I'm thinking Football Manager style". Before a round, three
     questions from the press corps built from real facts; after it, two.
     Each has four canned answers in a tone — humble, confident, dismissive,
     unhinged — and a box for your own words. Everything you pick goes on the
     feed under the club handle and into the paper. Deterministic per
     manager per round, so the paper can quote the question back. */
  const TONES = [['humble', 'Humble'], ['confident', 'Confident'], ['dismissive', 'Dismissive'], ['unhinged', 'Unhinged']];
  const Q = {
    // ctx: mgr, team, short, opp, oppMgr, oppShort, pos, oppPos, last {r, my, th, opp}, doubt {name, news}, star {name, pts}, result {my, th}, worst {name, pts}, best {name, pts}, gw
    pre: [
      { id: 'opp', q: [
          '{opp} this week. {oppMgr} has already been talking. What do you make of them?',
          'It’s {opp} next. Do you fear anyone in this league?',
          '{oppMgr} says {short} are there for the taking. Your response?',
        ], a: {
          humble: ['{opp} are a good side. We respect them, we prepare properly, we see where we are on Monday.', 'Every game in this league is hard. {oppMgr} has done well. We’ll focus on ourselves.'],
          confident: ['We’re not worried about {opp}. If we play our game, we win. Simple as that.', 'I’ve watched {opp}. I’ve seen enough. We’ll be fine.'],
          dismissive: ['Who? No, I know who. Next question.', '{oppMgr} talks a lot for a man in {oppPos} place.'],
          unhinged: ['{opp} are a charity. {oppMgr} is a charity. I am going to win this match by forty points and then I am going to ring his mum.', 'I’ve not slept. I’ve watched every {opp} lineup since 2015. I know what he’s going to do before he does. He’s going to lose.'],
        } },
      { id: 'form', q: [
          'You {lastWord} last time out. Where does that leave you going into this one?',
          '{pos} in the table. Is that where {short} belong?',
          'Some of the fans are asking questions. Are you feeling the pressure?',
        ], a: {
          humble: ['We take it a week at a time. The table sorts itself out.', 'There are things to improve. We know that. We’re working on it.'],
          confident: ['{pos} is a snapshot. Come back in May.', 'Pressure is a privilege. We’re exactly where I expected to be.'],
          dismissive: ['I don’t read the table. I don’t read the group. I don’t read.', 'Fans? Which fans. Name one.'],
          unhinged: ['I have never felt pressure. I have felt rage, and I am feeling it now, at you, for asking.', 'The table is fake. I’ve said this to the Committee. They know what they did.'],
        } },
      { id: 'transfer', q: [
          'You went into the Trough and came out with {signedName}. Talk us through that.',
          '{signedName} in from {signedFrom}, {droppedName} out. Is that an upgrade?',
          'You’ve let {droppedName} go. Why?',
        ], a: {
          humble: ['{signedName} gives us something we didn’t have. {droppedName} was unlucky, honestly.', 'It’s a squad game. You make a call and you live with it.'],
          confident: ['{signedName} is the best player in the Trough and everyone else left him there. Their problem.', 'Upgrade? It’s a different sport now.'],
          dismissive: ['It was a Tuesday. I did a transfer. That is the whole story.', 'I don’t discuss the Trough. Nobody should discuss the Trough.'],
          unhinged: ['{droppedName} knows what he did. {signedName} has been told what will happen if he does it too.', 'I found {signedName} in the Trough at four in the morning. I was the only one there. Ask yourself why.'],
        } },
      { id: 'selection', q: [
          '{benchedName} on the bench again. What has he done?',
          '{axedName} started last week and he’s out of the eleven. Is he dropped?',
          '{recalledName} is back in the side. What’s changed?',
        ], a: {
          humble: ['Selection is the hardest part of the job. He knows the situation and he’s been brilliant about it.', 'Nobody’s dropped. It’s rotation. The fixtures decide.'],
          confident: ['I pick the team that wins. If he doesn’t like it, he can score more points.', 'He’s back because he’s earned it. Everyone in my squad earns it.'],
          dismissive: ['He’s on the bench because that is where I put him.', 'Is he dropped? He’s not in the eleven. You do the maths, you’re the journalist.'],
          unhinged: ['He is on the bench because I dreamt he would score an own goal, and I do not ignore the dreams.', 'Dropped? DROPPED? He can consider himself lucky he is still in the building.'],
        } },
      { id: 'squad', q: [
          '{doubtName} is a doubt — {doubtNews}. Does he play?',
          '{starName} has {starPts} points already. Is he the best player in the league?',
          'Any team news for us?',
        ], a: {
          humble: ['We’ll see how he is. The medical team make that call, not me.', 'He’s been good. The whole squad has. We win as a group.'],
          confident: ['He plays. Of course he plays. Write it down.', 'Best player in the league? He’s the best player in the world and he’s ours.'],
          dismissive: ['Team news is on Saturday. You’ll find out with everyone else.', 'I don’t discuss individuals. Or teams. Or news.'],
          unhinged: ['He plays if I have to carry him onto the pitch myself. I have carried men before.', 'He’s not a doubt. The doubt is you, and your paper, and the vidiprinter.'],
        } },
    ],
    post: [
      { id: 'result', q: [
          '{resultLine} Talk us through it.',
          'That result. What went {resultWent}?',
        ], a: {
          humble: { won: ['Pleased with the three points. We move on.', 'Credit to {opp}, they made it hard. We got there.'], lost: ['Not good enough. That’s on me.', 'They deserved it. We regroup and go again.'], drew: ['A point is a point. It felt like a loss, but it counts as a point.'] },
          confident: { won: ['Never in doubt. The plan worked. It always works.', 'I said we would win. We won. What else is there.'], lost: ['We were the better side. The scoreboard disagrees, and the scoreboard is wrong.', 'We lost to a bench. That won’t happen twice.'], drew: ['We should have won that, and next time we will.'] },
          dismissive: { won: ['It was fine. Next.', 'Three points. Yes. Anything else?'], lost: ['Lost. Whatever. It’s September.', 'I’ve already forgotten it. So should you.'], drew: ['A draw. Fine. Get on with it.'] },
          unhinged: { won: ['I want it on record that I have DESTROYED {oppMgr} and I would like a trophy for this individual match.', 'Forty points. FORTY. Put that in your paper. Put it on the front.'], lost: ['The vidiprinter was wrong, the app was wrong, and I will be raising this with the Committee, who are also wrong.', 'I don’t accept the result. I don’t accept the points. I don’t accept you.'], drew: ['A draw is a conspiracy. Two men cannot score the same number of points. Explain that.'] },
        } },
      { id: 'bench', q: [
          '{benchBurnName} scored {benchBurnPts} for you. From the bench. Explain.',
          'You left {benchBurnPts} points on the bench. Whose decision was that?',
        ], a: {
          humble: ['Mine. Entirely mine. I got it wrong and I’ll look at it.', 'That’s football. Sometimes the man you leave out has his day.'],
          confident: ['We won anyway. Or we lost anyway. Either way the bench is not the story.', 'Hindsight picks a perfect team every week. I pick on Friday.'],
          dismissive: ['I’ve seen the number. Next.', 'The bench is part of the squad. He was part of the squad. It counted for the squad.'],
          unhinged: ['He was told to sit. He sat. Then he scored out of spite. I will be dealing with it internally.', 'I left him out because the vidiprinter told me to and now you’re telling me the vidiprinter was wrong. Which is it.'],
        } },
      { id: 'player', q: [
          '{bestName} got you {bestPts}. Where would you be without him?',
          '{worstName} with {worstPts}. Time to move him on?',
        ], a: {
          humble: ['He’s a big player for us. But it’s a squad game.', 'He’ll bounce back. Good players do.'],
          confident: ['I drafted him. That’s where I’d be. Same place, because I’d have drafted someone else just as good.', 'He stays. I don’t move on players because of one week. I move on journalists.'],
          dismissive: ['I don’t single out players. Even good ones. Even bad ones.', 'Next question.'],
          unhinged: ['He is my son. Not legally. Not yet.', 'He is going in the Trough tonight and I will be waiting at the gates to make sure he goes in.'],
        } },
    ],
  };
  const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || 'the gaffer';
  const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));

  /* ---------- the timeline ----------
     events: [{ type, key, at, live, sortKick, ... }] built by app.js from
     public state. Returns posts newest-story-first, identical everywhere. */
  function compose(events, ctx = {}) {
    const teamName = ctx.teamName || (mid => `Club ${mid}`);
    const managerName = ctx.managerName || (mid => `Manager ${mid}`);
    const handleOf = ctx.handleOf || (() => '');
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
            add(press(beat, k), k, pick(B[beat === 'wire' ? 'goal_trough_wire' : 'goal_trough_transfers'], k), vars(e), { ...meta, w: 3 });
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
          { const who = press('transfers', k); add(who, k, pick(who.h === 'BenJacobean' ? B.signing_jacobean : B.signing_transfers, k), vars(e), { ...meta, w: 4 }); }
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
        case 'manager': {
          // a real person's words, verbatim, under the club handle
          const acct = manager(e.mid, tn, e.mgrName, handleOf(e.mid));
          if (e.text) add(acct, k, '{text}', { text: e.text }, { ...meta, at: e.oppMid != null && e.aimed ? `→ ${cleanTeam(teamName(e.oppMid))}` : meta.at, w: 6 });
          // a post (not a press conference) gets picked up on the wire — by
          // a different desk each time, with a different mix of reactions
          // (Ben, 4 Sep: "would be a shame if it is the same every single time")
          if (e.text && e.aimed) {
            const pv = vars(e, { mgr: firstName(managerName(e.mid)), oppMgr: e.oppMid != null ? firstName(managerName(e.oppMid)) : '', quote: e.text });
            const desk = pickupDesk(e.text, k);
            const pool = e.oppMid != null ? PICKUP[desk] : PICKUP_ALL[desk];
            const who = PRESS().find(p => p.h === desk);
            const acct = who ? { h: who.h, n: who.n, kind: 'press', beat: who.beat, bio: who.bio } : press('wire', k);
            const base = meta.sortKick || 0;
            add(acct, k + ':wire', pick(pool, k + ':pickup'), pv, { ...meta, at: 'The wire', sortKick: base + 2, w: 5 });
            if (e.oppMid != null) {
              const r = hash(k + ':mix');
              const oppTeam = teamName(e.oppMid);
              // the club statement, two posts in five
              if (r % 5 < 2) add(fan(e.oppMid, 'sage', oppTeam), k + ':stmt', pick(STATEMENT, k + ':stmt'), pv, { ...meta, at: 'Club statement', sortKick: base + 4, w: 5 });
              // the calm supporter, one in three
              else if (r % 3 === 0) add(fan(e.oppMid, 'sage', oppTeam), k + ':sage', pick(REPLY_SAGE, k + ':sage'), vars({ ...e, mid: e.oppMid, oppMid: e.mid }, { mgr: pv.mgr, oppMgr: pv.oppMgr, oppPos: e.oppPos ?? '' }), { ...meta, at: meta.at, sortKick: base + 3, w: 4 });
              // the poster's own lot, one in two
              if ((r >>> 3) % 2 === 0) add(fan(e.mid, (r >>> 5) % 4 === 0 ? 'sage' : 'melt', tn), k + ':back', pick((r >>> 5) % 4 === 0 ? BACKING_SAGE : BACKING, k + ':back'), pv, { ...meta, at: meta.at, sortKick: base + 5, w: 4 });
              // the fringe, one in four
              if ((r >>> 7) % 4 === 0) { const fh = (r >>> 9) % 2 ? 'MattLeTus' : 'BenSuppery'; const fp = PRESS().find(p => p.h === fh); if (fp) add({ h: fp.h, n: fp.n, kind: 'press', beat: fp.beat, bio: fp.bio }, k + ':fringe', pick(FRINGE[fh], k + ':fringe'), pv, { ...meta, at: fh === 'BenSuppery' ? 'Team news' : 'Thread', sortKick: base + 6, w: 3 }); }
            }
          }
          // and the other lot's supporter, straight back — but only when
          // there is something to bite on; humility gets ignored, like life
          if (e.oppMid != null && e.text && e.tone !== 'humble' && e.tone !== 'dismissive') {
            const opp = fan(e.oppMid, 'melt', teamName(e.oppMid));
            const tone = REPLY[e.tone] ? e.tone : 'unhinged';
            add(opp, k + ':reply', pick(REPLY[tone], k + ':reply'), vars({ ...e, oppMid: e.mid, mid: e.oppMid }, { mgr: firstName(managerName(e.mid)), oppMgr: firstName(managerName(e.oppMid)), oppPos: e.oppPos ?? '' }), { ...meta, at: meta.at, sortKick: (meta.sortKick || 0) + 1, w: 5 });
          }
          break;
        }
        default: break;
      }
    }
    // live matches on top, then the most recent kickoff, then the biggest
    // story; the tail settled by key so the order is total and identical
    out.sort((a, b) => (b.live - a.live) || (b.sortKick - a.sortKick) || (b.w - a.w) || a.key.localeCompare(b.key));
    return out;
  }

  // the questions a manager faces this round. ctx comes from app.js facts.
  function questions(ctx, phase = 'pre') {
    const key = `presser:${ctx.gw}:${ctx.mid}:${phase}`;
    const roster = typeof GAZETTE_PRESS !== 'undefined' ? GAZETTE_PRESS : [];
    const by = i => roster.length ? roster[hash(key + ':by' + i) % roster.length].n : 'the Gazette';
    const v = {
      mgr: firstName(ctx.mgr), team: cleanTeam(ctx.team), short: ctx.short || cleanTeam(ctx.team),
      opp: cleanTeam(ctx.opp || 'the opposition'), oppMgr: firstName(ctx.oppMgr || 'the other manager'),
      pos: ctx.pos || '—', oppPos: ctx.oppPos || '—',
      lastWord: ctx.last ? (ctx.last.r === 'W' ? 'won' : ctx.last.r === 'L' ? 'lost' : 'drew') : 'played',
      doubtName: ctx.doubt?.name, doubtNews: ctx.doubt?.news ? String(ctx.doubt.news).replace(/\.$/, '').toLowerCase() : '',
      starName: ctx.star?.name, starPts: ctx.star?.pts,
      resultLine: ctx.result ? `${ctx.result.my}–${ctx.result.th} against ${cleanTeam(ctx.opp || '')}.` : 'The result.',
      resultWent: ctx.result ? (ctx.result.my > ctx.result.th ? 'right' : 'wrong') : 'on',
      bestName: ctx.best?.name, bestPts: ctx.best?.pts, worstName: ctx.worst?.name, worstPts: ctx.worst?.pts,
      signedName: ctx.signed?.name, signedFrom: ctx.signed?.from, droppedName: ctx.dropped?.name,
      benchedName: ctx.benched?.name, axedName: ctx.axed?.name, recalledName: ctx.recalled?.name,
      benchBurnName: ctx.benchBurn?.name, benchBurnPts: ctx.benchBurn?.pts,
    };
    const res = ctx.result ? (ctx.result.my > ctx.result.th ? 'won' : ctx.result.my < ctx.result.th ? 'lost' : 'drew') : 'won';
    const out = [];
    const resolves = t => [...t.matchAll(/\{(\w+)\}/g)].every(m => v[m[1]] != null && v[m[1]] !== '');
    const specs = (Q[phase] || []);
    const lead = specs[0];
    // fact-backed = at least one wording whose facts exist; the last wording of
    // 'form', 'squad' and 'player' is generic, so those are always askable
    const backed = specs.slice(1).filter(sp => sp.q.some(resolves));
    const want = phase === 'post' ? 2 : 2;
    // the specific stuff first (transfer, selection), then the rest, in a
    // per-round order so two managers do not get the same paper
    const specific = backed.filter(sp => ['transfer', 'selection', 'bench'].includes(sp.id));
    const generic = backed.filter(sp => !specific.includes(sp));
    const rot = a => a.length ? a.slice(hash(key + ':rot') % a.length).concat(a.slice(0, hash(key + ':rot') % a.length)) : a;
    const chosen = [lead, ...rot(specific).concat(rot(generic)).slice(0, want)];
    chosen.forEach((spec, i) => {
      // pick a wording whose facts exist; fall back down the list
      let qs = spec.q.filter(resolves);
      if (!qs.length) qs = [spec.q[spec.q.length - 1]];
      const q = fill(pick(qs, key + ':q' + i), v);
      const options = TONES.map(([tone, label]) => {
        const bank = Array.isArray(spec.a[tone]) ? spec.a[tone] : (spec.a[tone][res] || spec.a[tone].won);
        return { tone, label, text: fill(pick(bank, key + ':a' + i + tone), v) };
      });
      out.push({ id: spec.id, by: by(i), q, options });
    });
    return out;
  }

  // what the opponent's supporter fires back when a manager posts. Keyed by
  // the tone the manager chose; a free-text post reads as 'unhinged'.
  const REPLY = {
    humble: ['Classy from {mgr}. Which is exactly what a man who is about to lose would say.', 'Very humble. Very nice. Very {oppPos}th in the table.', 'Humble. Because he knows.'],
    confident: ['Bookmarked. See you Monday, {mgr}.', '“Simple as that.” Screenshot taken. Framed.', 'Confidence from {mgr}. Lovely. We collect those.'],
    dismissive: ['Rattled. Absolutely rattled.', 'That’s a man who has read the group chat and pretended he hasn’t.', 'Doesn’t care. Posted about it. Doesn’t care.'],
    unhinged: [
      'He’s lost it. He has actually lost it. Somebody check on {mgr}.',
      'Print this. Frame it. Read it to him after the match.',
      'This is the best thing that has ever been posted on here and I want him banned.',
      '{mgr} has posted this at a time when he should be doing his lineup. Says everything.',
      'Imagine being {mgr}. Imagine typing that. Imagine pressing post. Incredible scenes.',
      'Not reading that. Read it. Not reading it again. Reading it again.',
      'Screenshot sent to the group. Screenshot sent to his mum. Screenshot sent to the Committee.',
      'We have {oppMgr}. They have {mgr}. That is the whole tweet.',
    ],
  };
  // the calmer supporter's view of the same post
  const REPLY_SAGE = [
    'Interesting from {mgr}. Underlying numbers say {short} should be fine. The underlying numbers have not read the post.',
    'Noted. Filed. Will be revisited on Monday with the score attached.',
    'Not going to engage with this. Engaging with this: he’s wrong.',
    'Context: {mgr} is {oppPos}th. That is the context. That is all the context.',
  ];
  // the fringe, when it notices
  const FRINGE = {
    MattLeTus: [
      'Notice how quickly the media picked that up. Minutes. Ask yourself who benefits.',
      'They want you arguing about {mgr}. While you argue, they are moving the waiver deadline. Wake up.',
    ],
    BenSuppery: [
      'Update: {oppMgr} ({opp}) — blood pressure. Our understanding: elevated, following a post. Return: to be assessed after he has read it once more.',
      '{mgr} ({team}) — no injury concerns. Sources close to the physio say the thumbs are “in excellent shape”.',
    ],
  };

  // when a manager posts about another, the wire picks it up — that is the
  // fun (Ben, 3 Sep: "it appears on everyone's feed"). The journalist quotes
  // it back, names the target, and the target's supporters find out.
  const PICKUP = {
    DavidOrnsteak: [
      'Understand {mgr} ({team}) has said this of {opp} ahead of the weekend: “{quote}” {oppMgr} is aware. More to follow.',
      'Can confirm {mgr} said the following, on the record, about {opp}: “{quote}” The {opp} camp has been made aware.',
      'Told {mgr} ({team}) has gone public on {opp}: “{quote}” No response yet from {oppMgr}. There will be.',
      '{mgr} on {opp}: “{quote}” Understand this was not cleared with anyone. Understand nothing {mgr} says is.',
      'Sources: {mgr} has been “very clear” about {opp} this week. Those sources quote him as follows. “{quote}”',
    ],
    SimonScone: [
      '{mgr}, the {team} manager, has criticised {opp} ahead of Saturday. “{quote}” {opp} have not responded. BBC Sport has contacted {oppMgr} for comment and will update this page.',
      'Comments attributed to {mgr} regarding {opp} — “{quote}” — are understood to be genuine. A spokesperson for {team} said the manager “stands by them”, before adding “unfortunately”.',
      '{team} manager {mgr} on {opp}: “{quote}” Asked whether he regretted the remark, {mgr} is understood to have said no, then asked when it would be published.',
      'Live: {mgr} has made remarks about {opp}. “{quote}” More as we get it. We will not be getting much.',
    ],
    BenJacobean: [
      'EXCLUSIVE: {mgr} has told people close to him what he thinks of {opp}. Can reveal: “{quote}” Understand {oppMgr} has seen it. Story developing.',
      'Can reveal {mgr} ({team}) said this about {opp} in the last hour: “{quote}” Told it was said “calmly”. Told that by {mgr}.',
    ],
    FabrizioRotondo: [
      '🚨 {mgr} ({team}) on {opp}: “{quote}” Message sent. Message received. Here we go. 🤝',
      '{mgr} has gone public. “{quote}” Understand {opp} are “monitoring the situation”, which is what clubs say when they have read a tweet.',
    ],
  };
  const PICKUP_ALL = {
    DavidOrnsteak: [
      '{mgr} ({team}), on the record this morning: “{quote}” The league has been made aware.',
      'Understand {mgr} has said this, to nobody in particular and therefore everybody: “{quote}”',
    ],
    SimonScone: [
      '{team} manager {mgr} has issued a statement of sorts. “{quote}” It is not clear who it was aimed at. BBC Sport understands it was aimed at everyone.',
    ],
    BenJacobean: ['Can reveal {mgr} said this today: “{quote}” Told it was unprompted. Told it was not the first time.'],
    FabrizioRotondo: ['🚨 {mgr}: “{quote}” No club named. Every club informed. 🤝'],
  };
  // which desk picks a post up: the wire by default; transfer talk goes to the transfer men
  function pickupDesk(text, key) {
    const t = String(text || '').toLowerCase();
    if (/\b(trade|trough|waiver|sign|signing|swap|offer)\b/.test(t)) return hash(key + ':desk') % 2 ? 'FabrizioRotondo' : 'BenJacobean';
    // one time in five a transfer man grabs a story that is not his
    if (hash(key + ':desk') % 5 === 0) return 'BenJacobean';
    return hash(key + ':desk2') % 2 ? 'DavidOrnsteak' : 'SimonScone';
  }
  // the target club's official line, when it bothers to issue one
  const STATEMENT = [
    '{opp} statement: The club is aware of comments made by {mgr} and will not be dignifying them with a response. This is the response.',
    '{opp} statement: The club notes remarks attributed to the {team} manager. The club has nothing further to add, and has added it.',
    '{opp} statement: We are aware of the comments. We are aware of the man. We will see him on Saturday.',
    '{opp} statement: {oppMgr} has been made aware of the remarks and is “focused entirely on the weekend”. He has read them eleven times.',
    '{opp} club statement: The club will be making no comment. The club has, however, screenshotted it.',
  ];
  // the poster's own supporters
  const BACKING = [
    'THAT is our manager. That is why we sing.',
    '{mgr} said what we were all thinking and now {opp} are crying in the replies. Beautiful.',
    'He’s not wrong though. {short} til I die.',
    'Gaffer’s gone full send. Season’s on. Everything’s on.',
    'Our manager: says it. Their manager: reads it. That’s the difference.',
  ];
  const BACKING_SAGE = [
    'Not sure the gaffer needed to say that. He’s right, but he didn’t need to say it.',
    'Statement from the gaffer. I’d have gone with silence and thirty points, but here we are.',
  ];

  // the roster, for the bio strip: every fan account plus the press
  function accounts(managers, teamName, managerName, handleOf) {
    const rows = [];
    for (const m of managers || []) {
      const t = teamName ? teamName(m.id) : m.team;
      if (managerName) rows.push({ ...manager(m.id, t, managerName(m.id), handleOf ? handleOf(m.id) : ''), bio: `Official account of ${cleanTeam(t)}. Views are the manager’s own, regrettably.` });
      rows.push(fan(m.id, 'melt', t), fan(m.id, 'sage', t));
    }
    for (const p of PRESS()) rows.push({ h: p.h, n: p.n, kind: 'press', beat: p.beat, bio: p.bio });
    return rows;
  }

  return { compose, accounts, fan, press, manager, questions, shortName, TAKEOVER, BANKS: B, TONES, hash };
})();
