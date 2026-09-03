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
// Jason Stein: the Snake of the League, mired in controversies (Ben, 16 Aug) —
// the Gazette's designated returning-villain; the snake draft is "a coincidence"
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

// ================= The classics shelf =================
// Real shirt sponsors of the old football (Lee, 13 Aug: "your Brothers, your
// JVCs, your Autoglasses"). Strictly 90s–00s (Ben, 13 Aug: "doesnt need to be
// too heavy on everton, just keep it 90s-00s"; then "can have one or two
// everton still" — One2One and Kejian it is). Chest text only — the kit
// renderer prints whatever it's given. No Liverpool. Obviously.
const RETRO_SPONSORS = [
  'BROTHER', 'JVC', 'AUTOGLASS', 'SHARP', 'SANDERSON', 'HOLSTEN', 'SEGA',
  'DREAMCAST', 'WALKERS', "McEWAN'S LAGER", 'NEWCASTLE BROWN ALE',
  'DR. MARTENS', 'PACKARD BELL', 'ONE2ONE', 'KEJIAN', 'CHUPA CHUPS',
  'TDK', 'PEUGEOT', 'DAGENHAM MOTORS', 'CELLNET',
];

// ================= The College of Arms =================
// Crest heraldry (Lee, 12 Aug: "should be able to upload your own club badge
// IMO" — the Committee counters with a College of Arms; nobody is hosting
// twelve JPEGs). Shapes and divisions are the shield's architecture; charges
// are the symbol on it, drawn in a 24×24 box, __C__ = charge colour, __F__ =
// field colour. Counts are pinned by functions.test.js against cleanCrest's
// bounds in functions/index.js — grow them together or the suite fails.
const CREST_SHAPES = [
  { t: 'heater', d: 'M4 4 H36 V22 Q36 35 20 42 Q4 35 4 22 Z' },
  { t: 'kite', d: 'M4 4 H36 V26 L20 42 L4 26 Z' },
  { t: 'roundel', d: 'M20 5 a17.5 17.5 0 1 0 0.01 0 Z' },
  { t: 'banner', d: 'M4 4 H36 V38 L28 33 L20 41 L12 33 L4 38 Z' },
];
const CREST_DIVISIONS = [
  { t: 'clean', m: '' },
  { t: 'the chief', m: '<rect x="0" y="0" width="40" height="13"/>' },
  { t: 'the fess', m: '<rect x="0" y="17" width="40" height="10"/>' },
  { t: 'the pale', m: '<rect x="14" y="0" width="12" height="44"/>' },
  { t: 'the bend', m: '<rect x="16" y="-10" width="9" height="64" transform="rotate(35 20 22)"/>' },
  { t: 'per pale', m: '<rect x="20" y="0" width="20" height="44"/>' },
];
const CREST_CHARGES = [
  { t: 'The Star of the Show', m: '<path fill="__C__" d="M12 1 L14.7 8.28 L22.46 8.6 L16.37 13.42 L18.47 20.9 L12 16.6 L5.53 20.9 L7.63 13.42 L1.54 8.6 L9.3 8.28 Z"/>' },
  { t: 'The Match Ball', m: '<circle cx="12" cy="12" r="10.5" fill="__C__"/><path fill="__F__" d="M12 7.5 L16.3 10.6 L14.7 15.6 L9.3 15.6 L7.7 10.6 Z"/><path fill="none" stroke="__F__" stroke-width="1.2" d="M12 7.5 L12 2.2 M16.3 10.6 L21 8.6 M14.7 15.6 L17.6 20 M9.3 15.6 L6.4 20 M7.7 10.6 L3 8.6"/>' },
  { t: 'The Crown', m: '<path fill="__C__" d="M2 18.5 V7.5 L7 11.5 L12 3.5 L17 11.5 L22 7.5 V18.5 Z"/><rect fill="__C__" x="2" y="20" width="20" height="2.6"/>' },
  { t: 'The Bolt', m: '<path fill="__C__" d="M14 1 L4 14 L10.5 14 L8 23 L20 9 L13 9 Z"/>' },
  { t: 'The Celebratory Pint', m: '<path fill="__C__" d="M4 5 H16 V22 H4 Z"/><path fill="__C__" d="M16 7.5 H19 Q22.5 7.5 22.5 12.5 Q22.5 17.5 19 17.5 H16 V15 H18.8 Q20 14.6 20 12.5 Q20 10.4 18.8 10 H16 Z"/><circle fill="__C__" cx="6.5" cy="4.6" r="2.6"/><circle fill="__C__" cx="10.5" cy="3.8" r="2.9"/><circle fill="__C__" cx="14" cy="4.6" r="2.6"/><rect fill="__F__" x="5.2" y="8.6" width="9.6" height="1.5"/>' },
  { t: 'The Right Boot', m: '<path fill="__C__" d="M4 3 H11 V12 L21 17 Q22.6 18 22.4 21.5 H3 Q2.7 17 4 12 Z"/><path fill="none" stroke="__F__" stroke-width="1.1" d="M11.2 5 L14.8 6.4 M11.2 8 L14.6 9.4"/>' },
  { t: 'The Pot', m: '<path fill="__C__" d="M6 2 H18 V8 Q18 14 12 15.2 Q6 14 6 8 Z"/><path fill="none" stroke="__C__" stroke-width="2" d="M6 3.5 Q1 3.5 3 9 Q4 11.5 6.5 12.2 M18 3.5 Q23 3.5 21 9 Q20 11.5 17.5 12.2"/><path fill="__C__" d="M10.8 15 H13.2 L14 19 H10 Z"/><rect fill="__C__" x="7" y="19" width="10" height="3" rx="0.8"/>' },
  { t: 'The Loyal Paw', m: '<path fill="__C__" d="M12 12.5 Q17.2 12.5 17.6 17.3 Q17.9 21.8 12 21.8 Q6.1 21.8 6.4 17.3 Q6.8 12.5 12 12.5 Z"/><circle fill="__C__" cx="5.3" cy="9.5" r="2.4"/><circle fill="__C__" cx="9.8" cy="6.6" r="2.5"/><circle fill="__C__" cx="14.2" cy="6.6" r="2.5"/><circle fill="__C__" cx="18.7" cy="9.5" r="2.4"/>' },
  { t: 'The Mighty Duck', m: '<ellipse fill="__C__" cx="11" cy="16.5" rx="8" ry="5.2"/><path fill="__C__" d="M4.6 13.5 Q2.2 11.5 3.4 9 Q5.6 11.8 8 12 Z"/><circle fill="__C__" cx="17" cy="8" r="4.5"/><rect fill="__C__" x="13.5" y="9" width="5" height="5"/><path fill="__C__" d="M21 6.4 L24.4 7.8 L21 9.2 Z"/><circle fill="__F__" cx="18.3" cy="7" r="0.95"/>' },
  { t: 'The Trough King', m: '<circle fill="__C__" cx="12" cy="12.5" r="9.8"/><path fill="__C__" d="M4.5 6 L9 3 L9.8 7.8 Z M19.5 6 L15 3 L14.2 7.8 Z"/><ellipse fill="__F__" cx="12" cy="14.8" rx="4.1" ry="3"/><circle fill="__C__" cx="10.4" cy="14.8" r="0.95"/><circle fill="__C__" cx="13.6" cy="14.8" r="0.95"/><circle fill="__F__" cx="8.4" cy="9.4" r="1.15"/><circle fill="__F__" cx="15.6" cy="9.4" r="1.15"/>' },
  { t: 'The Crossed Swords', m: '<g fill="__C__" transform="rotate(45 12 12)"><rect x="11" y="0" width="2" height="18.5"/><rect x="7.6" y="15" width="8.8" height="1.8" rx="0.6"/><rect x="10.7" y="16.8" width="2.6" height="4.6" rx="1"/></g><g fill="__C__" transform="rotate(-45 12 12)"><rect x="11" y="0" width="2" height="18.5"/><rect x="7.6" y="15" width="8.8" height="1.8" rx="0.6"/><rect x="10.7" y="16.8" width="2.6" height="4.6" rx="1"/></g>' },
  { t: 'The Draft Snake', m: '<path fill="none" stroke="__F__" stroke-width="5.4" stroke-linecap="round" d="M5 4.5 H16 Q20 4.5 20 8.25 Q20 12 16 12 H8 Q4 12 4 15.75 Q4 19.5 8 19.5 H18.5"/><path fill="none" stroke="__C__" stroke-width="3.4" stroke-linecap="round" d="M5 4.5 H16 Q20 4.5 20 8.25 Q20 12 16 12 H8 Q4 12 4 15.75 Q4 19.5 8 19.5 H18.5"/><circle fill="__C__" cx="19.8" cy="19.5" r="2.7"/><path fill="none" stroke="__C__" stroke-width="1.1" d="M22.3 19.5 L24.3 18.6 M22.3 19.5 L24.3 20.4"/>' },
  { t: 'The Long Season', m: '<path fill="__C__" d="M12 2 Q20.5 2 20.5 10 Q20.5 14.5 17.5 16 V19.5 H6.5 V16 Q3.5 14.5 3.5 10 Q3.5 2 12 2 Z"/><rect fill="__C__" x="8" y="19.5" width="8" height="3" rx="1"/><circle fill="__F__" cx="8.6" cy="10.5" r="2.2"/><circle fill="__F__" cx="15.4" cy="10.5" r="2.2"/><path fill="__F__" d="M12 13 L13.5 15.8 H10.5 Z"/>' },
  { t: 'The Crossed Hammers', m: '<g fill="__C__" transform="rotate(40 12 12)"><rect x="10.8" y="2.5" width="2.4" height="19" rx="1"/><rect x="6.4" y="1.2" width="11.2" height="4.6" rx="1.2"/></g><g fill="__C__" transform="rotate(-40 12 12)"><rect x="10.8" y="2.5" width="2.4" height="19" rx="1"/><rect x="6.4" y="1.2" width="11.2" height="4.6" rx="1.2"/></g>' },
  { t: 'The Corner Flag', m: '<rect fill="__C__" x="6.2" y="2" width="1.9" height="19"/><path fill="__C__" d="M8.1 2.4 L20.5 5.2 L8.1 8.4 Z"/><path fill="__C__" d="M2.5 22.5 Q7 19 11.8 22.5 Z"/>' },
  { t: 'The Anchor', m: '<circle fill="__C__" cx="12" cy="4" r="3.1"/><circle fill="__F__" cx="12" cy="4" r="1.5"/><rect fill="__C__" x="10.9" y="6.6" width="2.2" height="12.8"/><rect fill="__C__" x="6.6" y="9.2" width="10.8" height="2.1" rx="0.8"/><path fill="__C__" d="M12 21.5 Q5.6 21.2 3.4 15.2 L6.6 14.6 Q8.2 18.4 12 18.8 Q15.8 18.4 17.4 14.6 L20.6 15.2 Q18.4 21.2 12 21.5 Z"/>' },
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
// `mid` is optional: leave it off and the klaxon fires for whoever picks him.
// `codes` are FPL's immutable player codes — the right key when a klaxon must
// name particular men, because the feed's `id` is positional and shifts on
// every rebuild (that is what produced Toby's "#579 (unknown)").
const KLAXONS = [
  // "if someone drafts max dowman or rio ngumoha" (Marc, 13 Aug). Fires for
  // any manager — this one is not about whose team it is.
  { label: '\u{1F4EF} UNDERAGE PLAYER KLAXON',
    line: 'is a child. Get Jason Stein on the phone: this needs a reputational comms strategy before somebody works out he has school in the morning.',
    codes: [616077, 611922] }, // Max Dowman (ARS), Rio Ngumoha (LIV)
  // "should be for EVERY dmc drafted" (Ben, UAT night) — the feed carries no
  // role field, so the register below is the league's official DMC taxonomy.
  // Committee amendments to the register are accepted in the group chat.
  // Marc, 13 Aug: "andrey santos, manuel fernandes and sandro tonali for this
  // list", plus the register brought up to the 26/27 feed. NOTE the surnames
  // are deliberately over-specified — a bare 'fernandes' would fire on Bruno,
  // which is why 'enzo fern' and 'mateus fern' are written the long way. Same
  // reason 'rodri' is quoted: the feed spells him "Rodrigo 'Rodri' Hernandez",
  // and the bare stem was quietly dragging in Coventry's Borges Rodrigues, a
  // winger. Bentancur, who WAS riding in on that stem, now stands on his own.
  { mid: 3, label: '\u{1F4EF} DEFENSIVE MIDFIELDER KLAXON', line: 'Atlético Benfield add another sitter to the collection.',
    pos: 'MF', names: ['tielemans', 'enzo fern', 'mac allister', 'declan rice', 'xhaka', "'rodri'", 'bentancur', 'caicedo', 'casemiro', 'ugarte',
      'gravenberch', 'palhinha', 'wharton', 'baleba', 'onana', 'anderson', 'gomes', 'bruno guimar', 'lokonga', 'ndidi',
      'douglas luiz', 'wieffer', 'veiga', 'garner', 'berge', 'yarmoliuk', 'mubama', 'endo', 'lavia', 'mangala', 'soucek',
      'andrey santos', 'mateus fern', 'tonali',
      'zubimendi', 'nørgaard', 'gruev', 'ampadu', 'stach', 'lukić', 'matusiwa', 'florentino', 'kovačić', 'harrison reed',
      'palacios', 'grimes', 'ayari', 'janelt', 'sangaré', 'yates', 'schlager', 'habib diarra', 'sadiki', 'morita',
      'matazo', 'bajcetic', 'iroegbunam', 'mainoo', 'essugo',
      // Marc, 13 Aug: the two clubs the register had missed entirely
      'scott', 'cook', 'christie', 'joelinton', 'miley'] },
  /* Ian drafts a surname and then wonders which one he has got (Marc, 13 Aug:
     "isnt sure if he has drafted the player he means to... the new brentford
     midfielder sangare"). The register is not a guess: every man on it is
     new to the Premier League and shares his surname with somebody else in
     it, or carries a name generic enough in his own country to be a coin
     toss. There really are two Sangarés — Mamadou at Brentford and Ibrahim
     at Forest — and two Kamaras, both midfielders. Codes, not names, because
     the whole point is that the names collide. */
  { mid: 5, label: '\u{1F4EF} AM I SURE THAT’S THE RIGHT ONE KLAXON',
    line: 'Ian: check the first name, the club and the photograph. There is more than one of him, and you have form.',
    codes: [
      513545, // Mamadou Sangaré (BRE) — Ibrahim Sangaré is at Forest
      490161, // Abu Kamara (HUL) — the other Kamara is at Villa, also a midfielder
      494928, // Juanlu Sánchez (BOU) — Robert Sánchez keeps goal for Chelsea
      483067, // António Silva (BOU) — one of four Silvas in the league
      551466, // Gonzalo García (FUL) — listed as "Gonzalo", a García among Garcías
      543968, // Emersonn (IPS) — two Ns, and a Silva underneath
      501390, // Marcelino Núñez (IPS) — not that Núñez
      611665, // Bazoumana Touré (NEW) — a Touré
      606930, // Nobel Mendy (HUL) — a Mendy
      561245, // Álvaro Rodríguez (BOU) — a Rodríguez
      451490, // Costinha (BHA) — whose full name opens "João Pedro"
      492498, // Raphael Borges Rodrigues (COV) — another Rodrigues entirely
    ] },
  { mid: 5, label: '\u{1F4EF} CITY PLAYER KLAXON', line: 'Champagne Khusanova remain constitutionally committed to the project.',
    club: 'Man City' },
  // "same for promoted alex singer klaxon" — ANY player from the promoted
  // three counts now, not just Coventry forwards
  { mid: 6, label: '\u{1F4EF} PROMOTED TEAM KLAXON', line: 'The Spartans have seen something in him. Nobody else has.',
    names: ['mcburnie'] },
  { mid: 6, label: '\u{1F4EF} PROMOTED TEAM KLAXON', line: 'The Spartans have seen something in him. Nobody else has.',
    clubs: ['Coventry City', 'Hull City', 'Ipswich Town'] },
];

// The Gazette's press corps — Pro Evolution Soccer bootleg edition (the group
// chat, 16 Aug: journos we all know, one letter wrong). Beats: 'match' writes
// reports, 'colour' writes features, 'tactics' does the negligence column,
// 'wire' breaks transfers. Names are the joke; do not correct the spellings.
const GAZETTE_PRESS = [
  { n: 'Martin Said', beat: 'match' },        // chief football writer
  { n: 'Harold Summer', beat: 'match' },
  { n: 'Henry Wanton', beat: 'match' },
  { n: 'Henrique Invierno', beat: 'match' },  // continental affairs
  { n: 'Oliver Quay', beat: 'match' },
  { n: 'Miguel Delano', beat: 'match' },
  { n: 'Sid Lowry', beat: 'match' },
  { n: 'Guillermo Balaguer', beat: 'match' },
  { n: 'Alyson Unrudd', beat: 'colour' },
  { n: 'Barney Ronaldo', beat: 'colour' },
  { n: 'Rory Smyth', beat: 'colour' },
  { n: 'Aimee Lawrenson', beat: 'colour' },
  { n: 'Donathan Bilson', beat: 'tactics' },  // Marc's commission, 16 Aug
  { n: 'Yonni Liu', beat: 'colour' },         // florid sociocultural essays
  { n: 'Gabriel Marcotto', beat: 'tactics' },
  { n: 'David Ornberg', beat: 'wire' },       // understands
  { n: 'Fabrizio Marano', beat: 'wire' },     // here we go
  // The Podcunt Network (Marc, 16–17 Aug). Bootleg names are canon — do not
  // correct the spellings. Bilson, Liu and Lowry appear as panellists from
  // their existing beats above; these are the broadcast staff.
  { n: 'Rax Mushden', beat: 'pod' },          // host, Gazette Football Weekly
  { n: 'Richard Keyes', beat: 'pod' },        // talkTROUGH, has the folder
  { n: 'Andy Grey', beat: 'pod' },            // talkTROUGH, has the telestrator
  { n: 'Jamie O’Hara-Hara', beat: 'pod' }, // talkTROUGH, played at a good level
  // Marc, 18 Aug: "a character called howard who calls in and asks a question
  // each episode in the style of a phone in". Not staff — he is the audience,
  // and he is on the register because he is on the show every single week.
  { n: 'Howard', beat: 'pod' },               // talkTROUGH, first-time caller since August
];

/* ================= Meet the Managers =================
   Ian's commission (25 Aug 2026): the lads' ten standard questions, put to
   one manager at a time, roughly two a month. Answers are the manager's own
   words from the group chat, lightly subbed; the footnotes are the
   Committee's. `gw` is the GAMEWEEKS index whose matchday edition carries
   the issue — it prints at that Friday's deadline and stays in the week's
   review edition, so the archive keeps every issue for good. Rendered by
   Gazette.interview() in js/gazette.js. */
const GAZETTE_INTERVIEWS = [
  {
    gw: 1, // GW2 — the Friday 28 Aug paper (Ben, 26 Aug: answers in, "gazette issue to go out on friday")
    who: /jackson/i,
    kicker: 'MEET THE MANAGERS · No. 1 · THE REIGNING CHAMPION',
    head: 'ATTACK IS OVERRATED. DEFENCE FIRST.',
    by: 'Adam Jackson of Interjacksonale, in conversation with Alyson Unrudd',
    // Ric's paywall (25 Aug chat: "I pay full subscription £"; would pause it
    // "for the Ben Levy month"). The tease sits above the fold, per the plan.
    paywall: 'GAZETTE PREMIUM — Meet the Managers is a subscriber-exclusive feature. A subscription costs nothing and is billed never; Ric Blank pays full price anyway, and the circulation desk thanks him. One request to pause a subscription “for the Ben Levy month” is under review.',
    intro: [
      'The first in a series of twelve. Over the season the Gazette will sit down with every manager in The League, beginning — by order of silverware — with the reigning champion. Our ten questions were sent to Interjacksonale and, per club policy, “forwarded to our press team”. The answers below arrived from the same phone.',
    ],
    qa: [
      ['How many years have you been a manager?',
        'I think this is season 9.†'],
      ['Describe your managerial style in five words.',
        'Attack is overrated. Defence first.'],
      ['Who is your managerial inspiration?',
        'I’m cut from the same cloth as some of the greats — Tony Pulis, Big Sam, Sean Dyche. No nonsense, lump it up to the big lad, chaos in the box.'],
      ['Who is your biggest rival in the league, and why?',
        'You can’t help but love it when you beat The Chairman. Going to The Great Hall of the People and pinching a win brings a huge amount of satisfaction, and gives us hope that one day we’ll be released from the shackles of dictatorship.'],
      ['Which manager in The League do you have the best trading relationship with?',
        'Trading, what’s that?‡'],
      ['What is your go-to formation?',
        'If I could play six at the back with no striker, that would be ideal. Sadly football (Dev) hasn’t progressed enough for my methods yet.'],
      ['What is your favourite regional newspaper for team news?',
        'Used to be the Blackpool Gazette — is Charlie Adam starting? Will Ian Evatt be fit for the weekend? Sadly those days are long gone, so now I rely on our chief ITK, Alex Singer. With X notifications on every player, there is no team news he doesn’t know.'],
      ['What sort of victory gives you more satisfaction: winning with under 30 points, or getting over 50?',
        'Over 50 lets me enjoy my weekend more. Get the points on the board early and sit back and relax whilst your opponent wonders if Jaidon Antony will be starting for Brentford vs Ipswich on MNF.'],
      ['Which former manager would you like to see back in The League?',
        'Jason would be pure box office, however I think by the first international window I’d be fed up of him. Haynesy, on the other hand — proper mensch. Would welcome him back in a heartbeat.*'],
      ['What’s harder to win: the league, or The League?',
        'Do people even celebrate the league?'],
    ],
    // the Committee footnote goes where he is most wrong (the plan, 25 Aug);
    // the walkout detail is Ben's (26 Aug: "walked away for a bit and returned")
    notes: [
      '† The register records this as the twelfth season of The League. The Committee accepts nine as accurate only under Mr Jackson’s personal accounting, which omits the seasons after he walked out. The walkout is noted. It is always noted.',
      '* For the Gazette’s continuing coverage of the Stein situation, see every edition this paper has ever printed.',
    ],
    tradeCheck: true, // ‡ — the ledger answers the trading question itself
    tail: 'Meet the Managers continues through the season. The press teams of the remaining eleven clubs have been notified, whether they know it or not.',
  },
];

/* ================= The Podcunt Network — advertising =================
   Two shows, two audiences, two utterly different commercial departments.
   The ads are the fastest way to tell the registers apart, so they are held
   here as inventory rather than buried in the generator. `read` is the ad as
   the host reads it; keep GFW ads worthy and slightly apologetic, and
   talkTROUGH ads loud, physical and priced. */
const POD_ADS = {
  gfw: [
    { brand: 'The Mind Of A Midfielder', read: 'a new eight-part series on the inner lives of holding midfielders, supported by the players’ union. No transfer gossip. No scores. Just men, sitting.' },
    { brand: 'Headroom', read: 'the mental health charity asking football to talk before it shouts. Their helpline is open all season, including during the international break, when it is busiest.' },
    { brand: 'The Co-operative Ground Share', read: 'community ownership for the ordinary supporter. One member, one vote, one increasingly long annual general meeting.' },
    { brand: 'Fair Kit', read: 'organic cotton shirts made in a factory the makers will name, with a wage they will also name. Available in away, and in a third kit nobody asked for.' },
    { brand: 'The Sunday Long Read', read: 'four thousand words on a full-back you have never seen play, filed from a train. Cancel any time, though nobody does.' },
    { brand: 'Allotment Weekly', read: 'because the season is long and the soil does not have an opinion about your bench.' },
  ],
  tt: [
    { brand: 'BRICKO POWER TOOLS', read: 'EIGHTEEN VOLTS OF PROPER BRITISH TORQUE. If it does not go through the wall, son, YOU ARE NOT PUSHING HARD ENOUGH. Bricko. GET IT DONE.' },
    { brand: 'MEGA-SHED DIRECT', read: 'SHEDS. ENORMOUS ONES. Delivered flat, assembled never. Twelve foot by eight, NINETY-NINE POUNDS, and that is me doing you a favour.' },
    { brand: 'THE FULL ENGLISH APP', read: 'ORDER A BREAKFAST THE SIZE OF A DINNER PLATE, to your door, before eleven. None of your smashed avocado. BEANS ARE A VEGETABLE.' },
    { brand: 'GAFFER TAPE PLUS', read: 'ONE ROLL. FIXES EVERYTHING. Your gutter, your bumper, your hamstring — WE ARE NOT DOCTORS. Gaffer Tape Plus. TAPE IT AND FORGET IT.' },
    { brand: 'DRIVE-THRU CAR VALET', read: 'YOUR MOTOR, IMMACULATE, IN ELEVEN MINUTES. We do the alloys. We do them PROPERLY. Twenty-two pounds, cash, no appointment, no nonsense.' },
    { brand: 'BIG RON’S PATIO WORLD', read: 'SLABS. THOUSANDS OF THEM. Laid by men who have never once discussed their feelings and are, frankly, THRIVING.' },
  ],
};

/* ================= Cunthanger =================
   The League's own social network (Ric, 3 Sep 2026: "Cunthanger. Done.").
   Marc wanted "a live matchday twitter feed full of nonsense characters
   tweeting the sort of things melty fans tweet — 'class that, from a Benfield
   fan'". Two invented supporters per club: one who melts, one who explains
   calmly why everyone else is wrong. Handles are lore about the manager, not
   the manager, so they survive a club rename. `short` is what the fan calls
   the club in a tweet. Ownership of the network itself is undisclosed. */
const CUNTHANGER_FANS = {
  1:  { short: 'Polaks',      melt: { h: 'PolaksTilIDie', n: 'Big Kev' },          sage: { h: 'DogsPolaksData', n: 'Polaks Analytics' } },
  2:  { short: 'Mao',         melt: { h: 'ChairmanMaoUltras', n: 'Little Red Booker' }, sage: { h: 'PeoplesDailyFPL', n: 'The People’s Daily' } },
  3:  { short: 'Benfield',    melt: { h: 'BenfieldBarmy', n: 'Deano' },            sage: { h: 'VamosBenfield', n: 'Atlético Insider' } },
  4:  { short: 'Inter',       melt: { h: 'CurvaJacksonale', n: 'Ultra Gaz' },      sage: { h: 'NerazzurriJax', n: 'Interjacksonale Watch' } },
  5:  { short: 'Khusanova',   melt: { h: 'KhusanovaKop', n: 'Blue Moon Baz' },     sage: { h: 'ChampagneSocialist', n: 'Champagne Analysis' } },
  6:  { short: 'Spartans',    melt: { h: 'SpartanHelmet', n: 'Big Leon' },         sage: { h: 'ThisIsSparta300', n: 'Spartan Scout' } },
  7:  { short: 'Asterick',    melt: { h: 'AsterickUltras', n: 'Footnote Phil' },   sage: { h: 'AsteriskAndSpan', n: 'Asterick Insider' } },
  8:  { short: '101011101',   melt: { h: 'BinaryBarmy', n: 'Nige (1 of 12)' },      sage: { h: 'OneZeroOneXG', n: '101011101 xG' } },
  9:  { short: 'the Ducks',   melt: { h: 'QuackAttackFPL', n: 'Duck Dave' },       sage: { h: 'MightyDuckSage', n: 'Pond Life' } },
  10: { short: 'Celta',       melt: { h: 'CeltaLeighGoLoco', n: 'Tony from Leigh' }, sage: { h: 'BalaidosLeigh', n: 'Celta Leigh-Go Watch' } },
  11: { short: 'Geldog',      melt: { h: 'GeldogDawgs', n: 'Dawg Pound Del' },      sage: { h: 'GeldogPatrol', n: 'Geldog Patrol' } },
  12: { short: 'WA',          melt: { h: 'WAWanderersWay', n: 'Wanderer Wayne' },  sage: { h: 'WanderersWisdom', n: 'Wanderers Wisdom' } },
};

/* The spoof press. Parodies of the accounts the lads actually follow (Ian,
   3 Sep: "a few favourites in the feed but spoof versions"). Real injury news
   from the FPL feed, invented diagnosis. Real signings from the ledger,
   invented lasagne. */
const CUNTHANGER_PRESS = [
  { h: 'BenSuppery', n: 'Ben Suppery', beat: 'injury', bio: 'Premier Injuries. Not a doctor. Not even close.' },
  { h: 'FabrizioRotondo', n: 'Fabrizio Rotondo', beat: 'transfers', bio: 'Here we go. 🤝 Always here we go.' },
  { h: 'DavidOrnsteak', n: 'David Ornsteak', beat: 'wire', bio: 'Understand things. Can confirm other things. More to follow.' },
  { h: 'MattLeTus', n: 'Matt Le Tus', beat: 'conspiracy', bio: 'Former footballer. Current thinker. Do your own research.' },
];

// Ben Suppery's second opinions. Ian, 3 Sep: "wor Joelinton out for 2-4
// weeks with a sprained vagina". The bar was set; these clear it.
const CUNTHANGER_DIAGNOSES = [
  'sprained vagina', 'a tight groin, emotionally', 'ligament damage to the ego',
  'a pulled hamstring sustained walking to the ice bath', 'concussion from reading his own ratings',
  'a knock picked up in the tunnel, from a door', 'fractured confidence, non-displaced',
  'a stress reaction to the manager’s tactics', 'a dead leg from the physio’s stool',
  'mild whiplash, celebrating', 'a bruised heel and a bruised heart', 'rolled ankle stepping off a treadmill that was not on',
  'tonsillitis, but a bad one', 'inflammation of the everything', 'a hip flexor strain — the other hip',
  'illness. The club says illness. Our understanding: illness.',
];
const CUNTHANGER_RETURNS = [
  '2–4 weeks', '3–5 days, or never', 'after the international break, which is his favourite', 'Tuesday, probably', 'to be assessed by someone who knows what they are looking at',
  'when the swelling goes down, and the swelling is his pride', 'no timescale. He is not that kind of player', 'in time for the Trough window, conveniently',
];

/* Matt Le Tus. Ian, 3 Sep: "just spreading conspiracy theories... Michael and
   Janet Jackson are the same person or Princess Di and Elvis are still alive".
   One thread per gameweek. Nobody has ever reached tweet 2. */
const CUNTHANGER_LETUS = [
  'Thread 🧵 1/47. Michael and Janet Jackson are the same person. Look at the footage. Nobody in the media will say it.',
  'Not saying Princess Di and Elvis are alive. Just saying nobody has shown me a photo of them NOT alive. Think about it.',
  'The Premier League fixture list is “random”. Funny how every club plays 38 games. Do your own research.',
  'They tell you VAR is in Stockley Park. Have you been to Stockley Park? Have you? Exactly.',
  'Clean sheets were introduced in 1992. Before that, sheets were filthy and nobody died. Wake up.',
  'A “double gameweek” is when they double the games. Ask yourself who benefits. Ask yourself who’s counting.',
  'The waiver run is at 10am “London time”. London doesn’t have a time. Time is a construct. I’ve said this since 2004.',
  'The Trough is a real place. I have seen it. They keep it behind the Data Room and they do not want you to know.',
  'They say the Committee is one man. I have it on good authority the Committee is three men in a coat.',
  'Expected goals are not goals. They are expectations. Since when do we score expectations. Since 2016, apparently. Convenient.',
  'Every league table in the country updates at the same moment. The same MOMENT. Nobody asks how.',
  'The Gazette is printed. Where. Where is it printed. Show me the printer. You can’t.',
  'They rebranded the vidiprinter and nobody noticed. What else have they rebranded. What else.',
  'A man once told me the playoffs decide the title. The table decides the title. The man was from the Committee.',
];
