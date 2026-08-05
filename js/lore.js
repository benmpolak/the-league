// ================= League lore — feeds the weekly preview =================
// Manager ids: 1 Ben Polak · 2 Toby Levy · 3 Ben Levy · 4 Adam Jackson ·
// 5 Ian Tussie · 6 Alex Singer · 7 Ric Blank · 8 Marc Conway ·
// 9 Alex Duckett · 10 Lee Warner · 11 Daniel Geller · 12 Wilko Wilkowski
//
// RIVALRIES: petty history between pairs. `pair` is two manager ids (order
// irrelevant). `line` is what the preview prints when they meet. Add as many
// per pair as you like — one is chosen per meeting, deterministically.
const RIVALRIES = [
  { pair: [2, 3], line: 'The Levy derby. One writes the circulars; the other has historically not read them.' },
  { pair: [2, 5], line: 'The Chairman meets the constitutional opposition. The format remains subject to change.' },
  { pair: [4, 10], line: 'The M23 derby: Brighton–Palace energy, born from nothing and sustained by half-and-half scarves.' },
  { pair: [5, 8], line: 'The Cheadle derby. Neighbours for an afternoon, opposing counsel for the rest of the season.' },
  { pair: [8, 10], line: 'The cup-policy derby: Marc proposed 38 separate cups; Lee quite liked the existing one.' },
];

// One-liners about individual managers, used to colour previews. Keyed by id.
const MANAGER_LORE = {
  1: 'won the 2019–20 title after beginning League life as the man expected to draft Tony Hibbert',
  2: 'won the inaugural title, became Chairman and has been adding cups and circulars ever since',
  3: 'has built Atlético Benfield while treating the Chairman\'s circulars as optional pre-match reading',
  4: 'is the reigning champion and regards democracy as an administrative delay between trophies',
  5: 'has two titles, a standing claim on Manchester City and the constitutional opposition front bench',
  6: 'is the League\'s only back-to-back champion and its foremost scout of promoted-club obscurities',
  7: 'won the 2024–25 title despite periodically declaring the entire competition over by GW10',
  8: 'has two titles and still believes 38 separate cup competitions would be administratively cleaner',
  9: 'won in 2022–23 and remains open to offers involving Eze, future considerations or an Everton defender',
  10: 'runs Celta Leigh-Go, the M23 rivalry and the League\'s unexpectedly conservative cup-policy wing',
  11: 'served ten years on the waiting list, formed Geldog FC and immediately identified a Mickey Mouse cup',
  12: 'topped the 2025–26 table, lost the playoffs and would still like to keep his suspiciously excellent demo team',
};

// Opening-ceremony walkouts. These are affectionate character sketches
// distilled from eleven years of League-only chat, not verbatim quotations.
const MANAGER_ENTRANCES = {
  1: 'the 2019–20 champion arrives from the Draft Fantasy South office carrying a laptop and the Tony Hibbert shortlist everyone expected him to need in 2015.',
  2: 'the inaugural champion and permanent Chairman emerges with the velvet bag, a revised six-page circular and sole authority to explain either of them.',
  3: 'Atlético Benfield come through with eleven years of service and no recollection of the Chairman sending anything important. Several messages are produced in evidence.',
  4: 'the reigning champion walks out in the Interjacksonale medal and moves that voting rights be curtailed until somebody takes it from him.',
  5: 'the two-time champion enters beneath a guard of honour made entirely of Manchester City shirts. He calls himself the constitutional opposition; the trophy cabinet suggests the constitution has generally suited him.',
  6: 'the League\'s only back-to-back champion walks out insisting none of this really matters, accompanied by three promoted players nobody else considered draftable. The Spartans have seen something in them.',
  7: 'the 2024–25 champion announces that the entire exercise becomes irrelevant after GW10. Asterick\'s title medal makes this harder to dismiss than usual.',
  8: 'the two-time champion pushes a trolley containing 38 small cups, one for every gameweek. This is described as the simpler option.',
  9: 'the 2022–23 champion offers the mascot, a future pick and Eze for any eligible Everton defender before Mighty Duck reaches the halfway line.',
  10: 'Celta Leigh-Go unfurl the M23 half-and-half scarf and take their place as the only established League institution still broadly satisfied with the existing cup.',
  11: 'Geldog FC complete a ten-year walk from the waiting list, survey eleven seasons of silverware and call the first cup Mickey Mouse.',
  12: 'last season\'s table-topper brings the barbecue, Haaland and the demo squad he has again been told he cannot keep. The playoff runners-up medal is left in the car.',
};

// Former managers verified from the group archive. The opening ceremony gives
// them one collective nod; this is deliberately not a new page or data desk.
const FORMER_MANAGERS = ['Alex Haynes', 'Harris', 'Benj Loofe', 'Dan Linton', 'Jason Stein', 'Ben Peppi'];

// Safe, paraphrased fragments from the League's own archive. The Gazette opens
// this drawer only occasionally and only for clubs actually in view.
const CHAT_ARCHIVE = [
  { year: 2015, mids: [1], line: 'Before the first draft, the room had Tony Hibbert pencilled in as Polak\'s final pick.' },
  { year: 2017, mids: [4, 10], line: 'The AJ–Lee rivalry once shifted 2,000 half-and-half scarves and a run of deeply unhelpful commemorative shirts.' },
  { year: 2025, mids: [2, 3], line: 'Ben confirmed that he did not read the Chairman\'s messages. The Chairman added that waivers had produced similar evidence.' },
  { year: 2025, mids: [2, 5], line: 'The opposition manifesto promised annual playoff changes and fresh cups nobody knew had started.' },
  { year: 2025, mids: [2, 7], line: 'A cup was already under way before most of the room knew it existed. The Chairman was reportedly informed two weeks later.' },
  { year: 2025, mids: [6], line: 'After campaigning against the second cup, Singer immediately demanded to know why it had been removed.' },
  { year: 2025, mids: [8, 10], line: 'Marc proposed 38 separate cup competitions. Lee, with impeccable timing, announced that he quite liked this cup.' },
  { year: 2025, mids: [9], line: 'The Duckett transfer desk advertised Eze and requested Pickford or any other eligible Everton defender.' },
  { year: 2025, mids: [11], line: 'After ten years on the waiting list, Geller required only weeks to diagnose a Mickey Mouse cup.' },
  { year: 2026, mids: [2], line: 'The reigning cup holder celebrated a competition nobody knew was happening and promptly proposed a Champions of Champions event.' },
  { year: 2026, mids: [12], line: 'Wilko asked whether the demo supported waivers and whether its squad could be carried into the real draft. One answer was yes.' },
];

// ================= The Gaffers =================
// Manager archetypes, Football Manager character-creation style. Picked in the
// club office; the attribute lines are the joke, keep them deadpan.
// t = archetype, e = emoji, bio = one-liner, fm = the FM profile sheet.
const GAFFERS = [
  { t: 'The Young Graduate', e: '🎓', bio: 'Bad back, anxiety, in need of an opportunity.', fm: { badges: 'UEFA Pro (online)', playing: 'None — injured at 14', media: 'Overshares' } },
  { t: 'F.O.C.', e: '👴', bio: 'Football’s Oldest Coach. Has managed everyone, remembers no one.', fm: { badges: 'Predate the badge system', playing: 'Contemporary of the ball', media: 'Asleep' } },
  { t: 'The Gilet', e: '🦺', bio: 'Never seen without it. Points at things.', fm: { badges: 'National C Licence', playing: 'Non-league (dominant)', media: 'Gestures' } },
  { t: 'The Laptop Guru', e: '💻', bio: 'Has never played the game. Has a model.', fm: { badges: 'None — sees no value', playing: 'Futsal (theoretical)', media: 'Thread guy' } },
  { t: 'The Firefighter', e: '🚒', bio: 'Keeps teams up. Somehow never his fault.', fm: { badges: 'Full set, all expired', playing: 'Centre-half, agricultural', media: 'Siege mentality' } },
  { t: 'The Special One', e: '🕶️', bio: 'Won it all. Mentions it hourly.', fm: { badges: 'Refuses to show them', playing: 'Irrelevant, apparently', media: 'Feuds' } },
  { t: 'The Interim', e: '📝', bio: 'Until the end of the season — eleven seasons running.', fm: { badges: 'Provisional', playing: 'Squad player, every squad', media: 'Non-committal' } },
  { t: 'The Club Legend', e: '🏆', bio: 'No badges, all vibes. The fans demand it.', fm: { badges: 'The shirt IS the badge', playing: '400 appearances, one good one', media: 'Beloved' } },
  { t: 'The Chairman’s Son', e: '👔', bio: 'Qualified by birth.', fm: { badges: 'Bought', playing: 'Trialist (own club)', media: 'Lawyered' } },
  { t: 'The Continental', e: '☕', bio: 'Wears a scarf indoors. Calls it “the project”.', fm: { badges: 'Studied under a genius', playing: 'Regista, allegedly', media: 'Philosophical' } },
  { t: 'The Motivator', e: '📣', bio: 'No tactics, all shouting.', fm: { badges: 'Failed the written part', playing: 'Box-to-box (both boxes)', media: 'Hoarse' } },
  { t: 'The Long-Ball Purist', e: '🎯', bio: 'Row Z is a philosophy.', fm: { badges: 'Route One Diploma', playing: 'Target man, stationary', media: 'Direct' } },
];

// ================= The assistant managers =================
// The No. 2s (Ben, UAT night: famous number twos from down the years and
// around the world, comical — same real-name parody licence as the punditry
// desk). Every club gets a house-issue one by default; swap him in the club
// office or invent your own. He fronts the briefing on My Team.
const ASSISTANTS = [
  { t: 'Lawrie McMenemy', e: '🎖️', bio: 'Guardsman’s bearing, brigadier’s voice. Served on the Impossible Job. Do not mention turnips.' },
  { t: 'Phil Neal', e: '🦜', bio: '“Yes boss. Whatever you say, boss.” Eight league titles of agreeing.' },
  { t: 'Peter Taylor', e: '🧥', bio: 'Clough was the shop window; he was the goods in the back. Knows a player, knows a punchline.' },
  { t: 'Tord Grip', e: '🪗', bio: 'Sven’s man. Scouts with an accordion. Hears a 4-4-2 in every folk song.' },
  { t: 'Pat Rice', e: '🤫', bio: 'Fourteen years beside Wenger. Said nothing. Saw everything.' },
  { t: 'Terry McDermott', e: '🍾', bio: 'Job description: being Keegan’s mate. Would love it if we beat them. LOVE IT.' },
  { t: 'Rui Faria', e: '🕶️', bio: 'Seventeen years in Mourinho’s shadow. Warms up the grievances as well as the players.' },
  { t: 'Željko Buvač', e: '🧩', bio: '“The Brain.” Ran Klopp’s tactics for years, then vanished mid-season. May vanish again.' },
  { t: 'Mike Phelan', e: '🚜', bio: 'Fergie’s right hand. Now mostly tweets about combine harvesters. Available.' },
  { t: 'Carlos Queiroz', e: '📋', bio: 'Built Fergie’s back four twice. Left to manage Real Madrid. Came back quieter.' },
  { t: 'Ray Lewington', e: '🧯', bio: 'Hodgson’s eternal No. 2. Has seen every relegation scrap since decimalisation.' },
  { t: 'Steve McClaren', e: '☂️', bio: 'The Wally with the Brolly, back in the passenger seat where it’s safe. Brings his own umbrella.' },
];

// ================= Pitch-side advertising boards =================
// Official partners of The League. A rotating selection appears on every
// pitch — real workplaces first, then the commercial portfolio.
// t = wordmark, s = strapline, c = brand colour, bg = board background.
const AD_BOARDS = [
  // real workplaces first
  { t: 'HERTILITY', s: 'know your body', c: '#ff9ec6', bg: '#1c0f16' },
  { t: 'T8', s: 'ask Iain what it does', c: '#7dd8ff', bg: '#0c1620' },
  // the commercial portfolio - commissioned live by the group chat, 27 Jul 2026
  { t: 'VODAFONE NEWBURY', s: 'signal not guaranteed', c: '#ff8a8a', bg: '#260808' },
  { t: 'BRANDSMITHS', s: 'see you in court', c: '#e8e8e8', bg: '#141414' },
  { t: 'HOME REIT', s: 'residential property, broadly', c: '#d9c9a3', bg: '#1c150a' },
  { t: 'REVOLUT', s: 'sorry about the Monzo Cup, Geller', c: '#9fc4ff', bg: '#0a1226' },
  { t: 'NECK OIL', s: 'the official pre-waiver pint', c: '#7de8d8', bg: '#0a1f1c' },
  { t: 'BEER52', s: 'cancel anytime. you won’t.', c: '#ffb36b', bg: '#241204' },
  { t: 'SWIZZELS', s: 'love hearts & drumsticks since 1928', c: '#ffc2dd', bg: '#220e18' },
  { t: 'CLAUDE', s: 'built the site. supports all twelve equally.', c: '#f0b8a4', bg: '#211008' },
  { t: 'PADDY POWER', s: 'odds on a one-sided derby', c: '#a8e8a0', bg: '#0a1f0c' },
  { t: 'KIA', s: 'official car of the school run', c: '#dedede', bg: '#101418' },
  { t: 'ARAMCO', s: 'proud partners of a 12-man league', c: '#8ee8c9', bg: '#062018' },
  { t: 'HIGH PERFORMANCE PODCAST', s: 'what does defeat mean to YOU?', c: '#ffd98a', bg: '#1f1502' },
  { t: 'MGS', s: 'sapere aude, lads', c: '#a9c4e8', bg: '#0a1220' },
  { t: 'VICTORIA PLUMBING', s: 'taps for the treble winners', c: '#b8e0f7', bg: '#081722' },
  { t: 'KENDALS', s: 'the Harrods of the north, allegedly', c: '#c9b8f0', bg: '#140f24' },
  { t: 'SLATTERY', s: 'patissier to the playoffs', c: '#e8c9b0', bg: '#1f130a' },
  // Jewish Manchester, past and present - for the lads
  { t: 'TITANICS', s: 'unsinkable since 1912', c: '#b8d4f0', bg: '#0a1420' },
  { t: 'SWERSKY’S', s: 'the bagel benchmark, Prestwich', c: '#f0dcb0', bg: '#1e1706' },
  { t: 'DELI KING', s: 'royalty. Prestwich royalty.', c: '#ffd98a', bg: '#221604' },
  { t: 'M&S PENNY BAZAAR', s: 'don’t ask the price, it’s a penny', c: '#a8e0c9', bg: '#062016' },
  { t: 'GT UNIVERSAL STORES', s: 'everything, by catalogue, from Manchester', c: '#d4c4f0', bg: '#130f22' },
  { t: 'RAKUSEN’S', s: 'official matzo of the title run-in', c: '#f2e8d0', bg: '#1a1608' },
  { t: 'HYMAN’S DELI', s: 'salt beef for the semi-finals', c: '#ffd6a8', bg: '#221204' },
  { t: 'STATE FAYRE', s: 'bagels since time immemorial', c: '#f2e2b8', bg: '#1c1608' },
  { t: 'GATLEY TANDOORI', s: 'the post-match curry of champions', c: '#ffb88a', bg: '#241004' },
];

// Per-manager hoardings — commissioned by the group chat, 22 Jul 2026.
// A manager's home fixtures lead with one of THEIR sponsors; the general
// boards fill the rest. (Ben vetoed Liverpool sponsors for his own ground.)
const MANAGER_BOARDS = {
  2: [ // Chairman Mao — Tussie's nomination
    { t: 'ALWAYS ULTRA', s: 'official partner of heavy gameweeks', c: '#9fe8c5', bg: '#0a1c14' },
    { t: 'TAMPAX', s: 'proud sponsors of the Chairman', c: '#f7b7d0', bg: '#20101a' },
  ],
  3: [ // Atlético Benfield — London estate agents
    { t: 'FOXTONS', s: 'we valued your squad. ambitiously.', c: '#b7e4f7', bg: '#0b1a22' },
    { t: 'WINKWORTH', s: 'chain-free since the Haaland curse', c: '#e8b64c', bg: '#171106' },
    { t: 'PURPLEBRICKS', s: 'commissie? what commissie?', c: '#d0b3ff', bg: '#160b26' },
  ],
  7: [ // Asterick — defunct national treasures, and one national treasure
    { t: 'WOOLWORTHS', s: 'pick n mix. like his midfield.', c: '#ffd98a', bg: '#26190a' },
    { t: 'LITTLE CHEF', s: 'olympic breakfast, relegation form', c: '#e88aa0', bg: '#1e0a10' },
    { t: 'TERI HATCHER', s: 'by popular demand', c: '#ffe0b3', bg: '#211405' },
  ],
  9: [ // Mighty 🦆 — the north remembers
    { t: 'GREGGS', s: 'official sausage roll of the Mighty', c: '#f2c179', bg: '#1d130a' },
    { t: 'MICHELLE KEEGAN', s: 'appearing in Ewan’s search history', c: '#f7b7d0', bg: '#20101a' },
    { t: 'BODDINGTONS', s: 'the cream of the gameweek', c: '#fff3a0', bg: '#1c1a05' },
  ],
};

// Draft-night heckles — one button, a randomised barb, sent to every screen
// with pride of place on the picker's. Server stores only the line index.
const HECKLES = [
  'HURRY UP.',
  'The clock is not decorative.',
  'We’ve all got work in the morning.',
  'He’s googling “good defenders”.',
  'The Committee notes your dithering.',
  'Tick tock. Tick tock.',
  'Your autopick list is right there.',
  'This is why your team’s like that.',
  'Somewhere, a waiver claim is aging.',
  'The pizza went cold an hour ago.',
  'He’s asking his wife again.',
  'DF never took this long. Just saying.',
  'Is this the start of the fourth cup?',
  'The Trough opens at 11.03 precisely.',
  'Draft Fantasy South is reviewing the footage.',
  'It’s called a draft. You cannot keep the demo team.',
];

// Player klaxons — commissioned live in the group chat, 2 Aug 2026. Fired
// when one of these managers drafts a matching player. Names are lowercase
// substring matches on the player's full name; club and pos are exact.
const KLAXONS = [
  // "should be for EVERY dmc drafted" (Ben, UAT night) — the feed carries no
  // role field, so the register below is the league's official DMC taxonomy.
  // Committee amendments to the register are accepted in the group chat.
  { mid: 3, label: '\u{1F4EF} DEFENSIVE MIDFIELDER KLAXON', line: 'Atlético Benfield add another sitter to the collection.',
    pos: 'MF', names: ['tielemans', 'enzo fern', 'mac allister', 'declan rice', 'xhaka', 'rodri', 'caicedo', 'casemiro', 'ugarte',
      'gravenberch', 'palhinha', 'wharton', 'baleba', 'onana', 'anderson', 'gomes', 'bruno guimar', 'lokonga', 'ndidi',
      'douglas luiz', 'wieffer', 'veiga', 'garner', 'berge', 'yarmoliuk', 'mubama', 'endo', 'lavia', 'mangala', 'soucek'] },
  { mid: 5, label: '\u{1F4EF} CITY PLAYER KLAXON', line: 'Champagne Khusanova remain constitutionally committed to the project.',
    club: 'Man City' },
  // "same for promoted alex singer klaxon" — ANY player from the promoted
  // three counts now, not just Coventry forwards
  { mid: 6, label: '\u{1F4EF} PROMOTED TEAM KLAXON', line: 'The Spartans have seen something in him. Nobody else has.',
    names: ['mcburnie'] },
  { mid: 6, label: '\u{1F4EF} PROMOTED TEAM KLAXON', line: 'The Spartans have seen something in him. Nobody else has.',
    clubs: ['Coventry City', 'Hull City', 'Ipswich Town'] },
];
