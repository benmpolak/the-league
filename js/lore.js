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

// ================= Pitch-side advertising boards =================
// Official partners of The League. A rotating selection appears on every
// pitch — real workplaces first, then the commercial portfolio.
// t = wordmark, s = strapline, c = brand colour, bg = board background.
const AD_BOARDS = [
  { t: 'HERTILITY', s: 'know your body', c: '#ff9ec6', bg: '#1c0f16' },
  { t: 'T8', s: 'ask Iain what it does', c: '#7dd8ff', bg: '#0c1620' },
  { t: 'GELT & CO.', s: 'wealth management, allegedly', c: '#e8b64c', bg: '#171106' },
  { t: 'OY VEY INSURANCE', s: 'you should worry', c: '#f4f4f4', bg: '#5a1414' },
  { t: 'BUBBE’S SOUP CO.', s: 'jewish penicillin since 1936', c: '#ffd98a', bg: '#26190a' },
  { t: 'KOSHER NOSTRA', s: 'a deli you can’t refuse', c: '#e0e0e0', bg: '#101010' },
  { t: 'CHALLAH BACK BOYS', s: 'artisan bakery · est. 5784', c: '#f2c179', bg: '#1d130a' },
  { t: 'GOLDSTEIN & SONS', s: 'we schlep so you don’t have to', c: '#c9d6ff', bg: '#101528' },
  { t: 'MENSCH CAPITAL', s: 'nice boys, aggressive returns', c: '#9fe8c5', bg: '#0a1c14' },
  { t: 'L’CHAIM WINES', s: 'to life. to a 2-1 win.', c: '#e88aa0', bg: '#1e0a10' },
  { t: 'THE SCHMEAR CAMPAIGN', s: 'bagels · lox · public relations', c: '#ffe0b3', bg: '#211405' },
  { t: 'SHABBAT ENERGY', s: 'we’re off saturdays', c: '#fff3a0', bg: '#1c1a05' },
  { t: 'POLAK & LEVY LLP', s: 'no win, no schmear', c: '#b7e4f7', bg: '#0b1a22' },
  { t: 'NICE JEWISH BOY™', s: 'the dating app your mum chose', c: '#f7b7d0', bg: '#20101a' },
  // commissioned by the group chat, 27 Jul 2026
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
