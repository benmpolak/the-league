// ================= League lore — feeds the weekly preview =================
// Manager ids: 1 Ben Polak · 2 Toby Levy · 3 Ben Levy · 4 Adam Jackson ·
// 5 Ian Tussie · 6 Alex Singer · 7 Ric Blank · 8 Marc Conway ·
// 9 Alex Duckett · 10 Lee Warner · 11 Daniel Geller · 12 Wilko Wilkowski
//
// RIVALRIES: petty history between pairs. `pair` is two manager ids (order
// irrelevant). `line` is what the preview prints when they meet. Add as many
// per pair as you like — one is chosen per meeting, deterministically.
const RIVALRIES = [
  // { pair: [2, 3], line: 'The Levy derby. Mum has asked them not to discuss it at dinner.' },
  // { pair: [5, 7], line: 'Tussie v Blanky — two titles each…' },
];

// One-liners about individual managers, used to colour previews. Keyed by id.
const MANAGER_LORE = {
  // 3: 'has fucked it with Haaland two years running',
  // 11: 'waited ten years on the waiting list for this',
};

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
];

// Player klaxons — commissioned live in the group chat, 2 Aug 2026. Fired
// when one of these managers drafts a matching player. Names are lowercase
// substring matches on the player's full name; club and pos are exact.
const KLAXONS = [
  { mid: 3, label: '\u{1F4EF} DEFENSIVE MIDFIELDER KLAXON', line: 'Atlético Benfield add another sitter to the collection.',
    pos: 'MF', names: ['tielemans', 'enzo fern', 'mac allister', 'declan rice', 'xhaka', 'rodri', 'caicedo', 'casemiro', 'ugarte', 'gravenberch', 'palhinha', 'wharton', 'baleba', 'onana'] },
  { mid: 5, label: '\u{1F4EF} CITY PLAYER KLAXON', line: 'Champagne Khusanova remain constitutionally committed to the project.',
    club: 'Man City' },
  { mid: 6, label: '\u{1F4EF} PROMOTED TEAM LOBUS KLAXON', line: 'The Spartans have seen something in him. Nobody else has.',
    names: ['mcburnie'] },
  { mid: 6, label: '\u{1F4EF} PROMOTED TEAM LOBUS KLAXON', line: 'The Spartans have seen something in him. Nobody else has.',
    club: 'Coventry City', pos: 'FW' },
];
