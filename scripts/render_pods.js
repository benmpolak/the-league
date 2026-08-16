#!/usr/bin/env node
/* Render The Podcunt Network to REAL voices.
 *
 * Marc, 18 Aug: "this joke doesnt work unless the people sound like people not
 * robots." He's right — the browser's speech engine has a ceiling and we hit
 * it. Then: "ben and i have a new approach which involves using one of the
 * paid options to improve the quality of the voices and record some of our
 * own", and "we only want to use one human recording and the others can all be
 * pre selected but i want to choose them from the 3rd party".
 *
 * So the casting lives in audio/pod/cast.json — a plain file you edit, one
 * entry per character — and this script gives you the three things you need to
 * fill it in: a list of what the provider has, an audition of them all reading
 * the same line, and the render itself.
 *
 * ── HOW TO CAST (the whole job, in order) ─────────────────────────────────
 *
 *   1. See what's on offer.            node scripts/render_pods.js --voices
 *   2. Hear them all say the same thing, so it's a fair test:
 *                                      node scripts/render_pods.js --audition
 *      → writes audio/pod/_audition/<voice>.mp3. Listen. Pick.
 *   3. Put your picks in audio/pod/cast.json — "voice" is the id from step 1.
 *   4. Render:                          node scripts/render_pods.js
 *   5. Commit audio/.
 *
 * ── A REAL PERSON'S VOICE ─────────────────────────────────────────────────
 *
 * Howard, the talkTROUGH phone-in caller, is voiced by an actual human. There
 * are two ways to do that and they mix freely.
 *
 * CLONE IT — almost always the right answer. Record the person once, a few
 * minutes of them talking, then
 *
 *     node scripts/render_pods.js --clone "Howard" sample1.m4a sample2.m4a
 *
 * which writes the cloned voice id straight into cast.json. Every line from
 * then on comes out in their voice with nobody recording again. That matters
 * because the weekly episodes are generated from that week's results, so
 * Howard's question is new every single time — expecting fresh takes twice a
 * week for eight months is how this quietly dies in October.
 * GET THEIR CONSENT FIRST. Cloning a voice without asking is not a thing this
 * league does, and ElevenLabs requires you hold the rights either way.
 *
 * RECORD THE LINES BY HAND — for the pilots, or any episode somebody fancies
 * doing properly. `--parts` prints the outstanding script and the exact
 * filenames; drop them in audio/pod/<episode>/<n>.<ext> (any format a browser
 * plays, straight off a phone is fine), then `--scan`.
 *
 * A real take ALWAYS wins over a synthesised one and is never overwritten,
 * --force or not. So the sensible setup is both: clone as the understudy,
 * real takes wherever anyone got round to it.
 *
 * ── WHAT IT WRITES ────────────────────────────────────────────────────────
 *
 *     audio/pod/<episode-id>/<block-index>.mp3
 *     audio/pod/index.json    ← { "<episode-id>": { "<block>": "<file>" } }
 *
 * One file per spoken line, numbered by its index in ep.blocks — the units the
 * player already walks, so captions, running order and the synthesised stings
 * are untouched. The manifest is per LINE, so a bought voice, a human and the
 * browser robot can all be in one episode while it's being built up: any line
 * without a file is read by the browser.
 *
 * Nothing hand-recorded is ever overwritten. Rendering skips any block that
 * already has a file unless you pass --force, and skips `human` characters
 * always.
 *
 * ONLY BEN RUNS THE RENDER — it needs an API key and it spends money. Nothing
 * in the app fetches from a third party: this is a build step whose OUTPUT is
 * committed, so the site stays same-origin and offline-capable.
 *
 *   --voices       list the provider's voices, with ids for cast.json
 *   --audition     render one test line in every voice so you can choose
 *   --line "..."   what the audition should say (default: a talkTROUGH line)
 *   --clone NAME f… clone a real voice from recordings, cast it as NAME
 *   --parts        print the lines assigned to human voices, then stop
 *   --scan         rebuild index.json from the files on disk, render nothing
 *   --only a,b     work on just these episode ids (default: all published)
 *   --provider     elevenlabs | openai — overrides cast.json
 *   --force        re-render lines that already have a file (WILL overwrite)
 *   --dry          cost the job without casting or spending anything
 *   --url          site to read the episodes from (default http://localhost:8749)
 *
 * ── ON ELEVENLABS (Ben's choice, 18 Aug) ──────────────────────────────────
 *
 * It takes no written direction: the VOICE carries the character and the
 * SETTINGS carry the performance. Both are per character in cast.json, and
 * `direction` is kept only as the brief you cast against. Low stability means
 * more variation and more shouting (Grey ~0.22); high means level and calm
 * (Bilson ~0.75). `style` pushes the voice's own manner and high can tip into
 * parody, which on talkTROUGH is the point.
 *
 * A voice id must be one in YOUR library — ids from the shared pool have to be
 * added to it first. Nothing renders until every non-human part is cast, and
 * the ids are checked against the library before a single credit is spent.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'audio', 'pod');
const CAST_FILE = path.join(OUT, 'cast.json');
const INDEX_FILE = path.join(OUT, 'index.json');

const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const ONLY = (opt('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const SITE = opt('url', 'http://localhost:8749');
const FORCE = flag('force'), DRY = flag('dry'), SCAN = flag('scan');
const PARTS = flag('parts'), VOICES = flag('voices'), AUDITION = flag('audition');
const CLONE = opt('clone', '');
const AUDITION_LINE = opt('line',
  "Right. I'll tell you what it is, Richard. It's woke nonsense, and nobody complained when you posted your transfers in with a stamp on.");
// anything a browser will play; the manifest carries the extension, so a phone
// recording goes in exactly as it came off the phone
const PLAYABLE = ['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.webm', '.flac'];

/* ---------- the casting sheet ----------
   Shipped as audio/pod/cast.json so it can be edited without touching code.
   This is only the fallback used to write that file the first time. */
const DEFAULT_CAST = {
  provider: 'openai',
  _README: [
    'One entry per character. "voice" is an id from `--voices`.',
    '"direction" is how to say it — openai acts on this, elevenlabs ignores it.',
    'Set "human": true on a character you are voicing yourselves; they are',
    'never rendered and never overwritten. Use `--parts` to get their script.',
  ],
  cast: {
    'Rax Mushden': {
      voice: 'ballad', human: false,
      direction: 'A warm, quick, slightly amused British radio host chairing a panel show. Conversational, never announcer-ish. Keeps things moving, lands the dry jokes flat rather than pushing them.',
    },
    'Donathan Bilson': {
      voice: 'sage', human: false,
      direction: 'A thoughtful, unhurried British football writer explaining tactics. Long pauses, careful clause-by-clause delivery, faintly professorial and entirely sincere. Never raises his voice.',
    },
    'Yonni Liu': {
      voice: 'shimmer', human: false,
      direction: 'A bright, earnest, youngish British journalist making an emotional point about football and meaning it. Slightly faster than the room, warm, a bit wry at her own expense.',
    },
    'Sid Lowry': {
      voice: 'echo', human: false,
      direction: 'A relaxed British correspondent phoning in from Spain on a hot afternoon. Easy, gently ironic, unbothered, like a man on a balcony.',
    },
    'Richard Keyes': {
      voice: 'onyx', human: false,
      direction: 'A booming, self-important British sports broadcaster on drivetime radio. Low, plummy, absolutely certain. Hammers key words hard, treats every opinion as settled fact.',
    },
    'Andy Grey': {
      voice: 'ash', human: false,
      direction: 'A gruff, gravelly Scottish ex-footballer turned pundit, exasperated and loud. Growls through the ordinary words and BELLOWS the ones in capitals. Contemptuous, blunt, no pauses for breath.',
    },
    'Jamie O’Hara-Hara': {
      voice: 'verse', human: false,
      direction: 'A hyped-up young Essex ex-footballer on talk radio, talking over everyone. Fast, nasal, indignant, rising at the end of every sentence, permanently on the edge of shouting.',
    },
  },
  /* An advert read in the presenter's normal voice is the one thing no radio
     station has ever done, so the ad breaks get their own direction. */
  adDirection: {
    gfw: 'Read as a gentle, sincere public-service sponsorship message. Soft, unhurried, slightly wistful.',
    tt: 'Read as a LOUD, hard-sell local radio advert. Fast, aggressive, delighted with itself, shouting the product name.',
  },
};

function loadCast() {
  if (!fs.existsSync(CAST_FILE)) {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(CAST_FILE, JSON.stringify(DEFAULT_CAST, null, 2) + '\n');
    console.log(`Wrote a starter casting sheet to ${path.relative(ROOT, CAST_FILE)} — edit it and run again.\n`);
    return DEFAULT_CAST;
  }
  const c = JSON.parse(fs.readFileSync(CAST_FILE, 'utf8'));
  c.cast = c.cast || {};
  c.adDirection = c.adDirection || DEFAULT_CAST.adDirection;
  return c;
}
const CASTING = loadCast();
const PROVIDER = opt('provider', CASTING.provider || 'openai');
const chairFor = who => CASTING.cast[who] || { voice: PROVIDER === 'openai' ? 'ballad' : '', direction: '', human: false };

/* ---------- what the provider has ---------- */
// OpenAI publishes no list endpoint, so this is the documented set
const OPENAI_VOICES = [
  ['alloy', 'neutral, even, unremarkable — a safe narrator'],
  ['ash', 'low, gravelly, weathered — the closest thing to an angry ex-pro'],
  ['ballad', 'warm, lilting, British-leaning — good for a host'],
  ['coral', 'bright and friendly, a touch presentational'],
  ['echo', 'dry, laid-back, unhurried'],
  ['fable', 'expressive and storytelling, British-leaning'],
  ['onyx', 'deep, plummy, authoritative — the broadcaster voice'],
  ['nova', 'light, quick, youthful'],
  ['sage', 'measured and thoughtful, slightly academic'],
  ['shimmer', 'clear and earnest, a shade brighter than nova'],
  ['verse', 'animated, nasal, chatty — good for somebody interrupting'],
];
async function listVoices() {
  if (PROVIDER === 'elevenlabs') {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
    const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    if (!r.ok) throw new Error('elevenlabs ' + r.status + ' ' + (await r.text()).slice(0, 300));
    return (await r.json()).voices.map(v => {
      const l = v.labels || {};
      const bits = [l.gender, l.age, l.accent, l.descriptive || l.description, l.use_case].filter(Boolean);
      return { id: v.voice_id, name: v.name, note: bits.join(', ') };
    });
  }
  return OPENAI_VOICES.map(([id, note]) => ({ id, name: id, note }));
}

/* ---------- the voices ---------- */
async function ttsOpenAI(text, voice, direction) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, instructions: direction, response_format: 'mp3' }),
  });
  if (!r.ok) throw new Error('openai ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return Buffer.from(await r.arrayBuffer());
}
/* ElevenLabs takes no written direction — the voice carries the character and
   the SETTINGS carry the performance, so they are the equivalent knob and they
   live per character in cast.json:

     stability   low = more variation and more shouting; high = level and calm.
                 Grey wants ~0.25, Bilson wants ~0.75.
     style       how hard it pushes the voice's own manner. High is theatrical
                 and can tip into parody, which for talkTROUGH is the point.
     similarity  how tightly it hugs the original sample. Leave near 0.8.

   `previous_text`/`next_text` give it the lines either side so it knows where
   it is in the conversation. Rendering line by line without them is why
   line-by-line TTS usually sounds like a set of unrelated announcements. */
async function ttsEleven(text, voiceId, chair, around) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  if (!voiceId) throw new Error('no ElevenLabs voice id cast for this character — run --voices and paste the id into audio/pod/cast.json');
  const s = chair.settings || {};
  const body = {
    text,
    model_id: CASTING.model || 'eleven_multilingual_v2',
    voice_settings: {
      stability: s.stability ?? 0.4,
      similarity_boost: s.similarity ?? 0.8,
      style: s.style ?? 0.5,
      use_speaker_boost: s.speakerBoost ?? true,
    },
  };
  if (around && around.prev) body.previous_text = around.prev;
  if (around && around.next) body.next_text = around.next;
  const fmt = CASTING.format || 'mp3_44100_64';
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${encodeURIComponent(fmt)}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('elevenlabs ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return Buffer.from(await r.arrayBuffer());
}
const render = (text, chair, direction, around) =>
  PROVIDER === 'elevenlabs' ? ttsEleven(text, chair.voice, chair, around)
    : ttsOpenAI(text, chair.voice, direction);

/* ---------- getting the scripts ----------
   Out of the real generator, not a copy of it. */
async function harvest() {
  const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' });
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(SITE + '/?sandbox&nosync', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => typeof Podcast !== 'undefined');
  const eps = await page.evaluate(() => Podcast.published().map(p => {
    const e = Podcast.episode(p.show, p.kind, p.gw);
    return { id: e.id, show: e.show.id, host: e.show.host, title: e.title, blocks: e.blocks };
  }));
  await browser.close();
  return eps.filter(e => !ONLY.length || ONLY.includes(e.id));
}

/* ---------- the manifest ----------
   Rebuilt from what is actually on disk, so hand-recorded files need no
   bookkeeping: drop them in, run --scan, commit. */
function scanManifest() {
  const index = {};
  if (!fs.existsSync(OUT)) return index;
  for (const ep of fs.readdirSync(OUT)) {
    const dir = path.join(OUT, ep);
    if (ep.startsWith('_') || !fs.statSync(dir).isDirectory()) continue;
    const lines = {};
    for (const f of fs.readdirSync(dir)) {
      const n = path.basename(f, path.extname(f));
      if (!/^\d+$/.test(n) || !PLAYABLE.includes(path.extname(f).toLowerCase())) continue;
      lines[n] = f;
    }
    if (Object.keys(lines).length) index[ep] = lines;
  }
  return index;
}
const writeManifest = index => {
  const sorted = {};
  for (const ep of Object.keys(index).sort()) {
    sorted[ep] = {};
    for (const n of Object.keys(index[ep]).sort((a, b) => a - b)) sorted[ep][n] = index[ep][n];
  }
  fs.writeFileSync(INDEX_FILE, JSON.stringify(sorted, null, 2) + '\n');
  const lines = Object.values(sorted).reduce((s, o) => s + Object.keys(o).length, 0);
  console.log(`\naudio/pod/index.json: ${Object.keys(sorted).length} episode(s), ${lines} recorded line(s).`);
};
/* ---------- provenance ----------
   Which files THIS script wrote, and with which voice. Two jobs, both of
   which matter once real money and real people are involved:

   - It tells a rendered file apart from one a human recorded, so a stand-in
     stays replaceable while a real take is untouchable.
   - It records the voice, so recasting somebody re-cuts only THEIR lines.
     Change Grey's id because he doesn't shout enough, run it again, and you
     pay for Grey and nobody else.

   Kept beside the audio and committed with it, because it describes what is
   in those files. Losing it is not fatal: an unknown file is treated as a
   human take, which is the cautious way round. */
const PROV_FILE = path.join(OUT, 'rendered.json');
let PROV = (() => {
  try { return JSON.parse(fs.readFileSync(PROV_FILE, 'utf8')); } catch { return {}; }
})();
const provenance = (epId, n) => (PROV[epId] || {})[n] || (PROV[epId] || {})[String(n)] || null;
function noteRendered(epId, n, file, voice) {
  (PROV[epId] = PROV[epId] || {})[n] = { file, voice, provider: PROVIDER, at: new Date().toISOString().slice(0, 10) };
}
function saveProvenance() {
  // drop anything whose file has since gone, so the store can't rot
  for (const epId of Object.keys(PROV)) {
    for (const n of Object.keys(PROV[epId])) {
      if (!fs.existsSync(path.join(OUT, epId, PROV[epId][n].file))) delete PROV[epId][n];
    }
    if (!Object.keys(PROV[epId]).length) delete PROV[epId];
  }
  fs.writeFileSync(PROV_FILE, JSON.stringify(PROV, null, 2) + '\n');
}

// the file already on disk for this line, whoever made it
const existing = (epId, n) => {
  const dir = path.join(OUT, epId);
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).find(f => path.basename(f, path.extname(f)) === String(n)
    && PLAYABLE.includes(path.extname(f).toLowerCase())) || null;
};

/* ---------- the jobs ---------- */
/* ---------- cloning a real voice ----------
   Marc, 18 Aug: "can we not use a synthesized voice from a pre recorded
   voice?" Yes, and it is the right answer for Howard. Record the man ONCE,
   clone it, and every week's line comes out in his own voice with nobody
   having to do anything again. It turns a fortnightly obligation into an
   afternoon.

   CONSENT IS NOT OPTIONAL. ElevenLabs requires you hold the rights to a voice
   you clone, and quite apart from the terms, cloning someone's voice without
   asking is not a thing this league does. Get a clear yes from him first. */
async function doClone(name, files) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  if (!name || !files.length) throw new Error('usage: --clone "Howard" sample1.m4a [sample2.m4a ...]');
  const missing = files.filter(f => !fs.existsSync(f));
  if (missing.length) throw new Error('no such file: ' + missing.join(', '));
  const form = new FormData();
  form.append('name', name);
  form.append('description', (CASTING.cast[name] || {}).direction || '');
  for (const f of files) {
    form.append('files', new Blob([fs.readFileSync(f)]), path.basename(f));
  }
  console.log(`\nCloning "${name}" from ${files.length} sample(s)…`);
  const r = await fetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST', headers: { 'xi-api-key': key }, body: form,
  });
  if (!r.ok) throw new Error('elevenlabs ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const id = (await r.json()).voice_id;
  console.log(`\n  voice id: ${id}`);
  // write it straight into the casting sheet — the id is the whole point
  if (CASTING.cast[name]) {
    CASTING.cast[name].voice = id;
    fs.writeFileSync(CAST_FILE, JSON.stringify(CASTING, null, 2) + '\n');
    console.log(`  written into ${path.relative(ROOT, CAST_FILE)} as ${name}'s voice.`);
    console.log(`\nRender a sample before trusting it:  node scripts/render_pods.js --audition --line "..."\n`);
  } else {
    console.log(`  "${name}" is not in cast.json — paste the id in by hand.\n`);
  }
}

async function doVoices() {
  const vs = await listVoices();
  console.log(`\n${PROVIDER} has ${vs.length} voice(s). Put the id in the "voice" field in audio/pod/cast.json.\n`);
  const w = Math.max(...vs.map(v => v.id.length));
  for (const v of vs) console.log(`  ${v.id.padEnd(w)}  ${v.name === v.id ? '' : v.name + ' — '}${v.note || ''}`);
  console.log(`\nThen hear them: node scripts/render_pods.js --audition\n`);
}

async function doAudition() {
  const vs = await listVoices();
  const dir = path.join(OUT, '_audition');
  fs.mkdirSync(dir, { recursive: true });
  console.log(`\nAuditioning ${vs.length} voice(s) on the same line, so it's a fair test:\n  "${AUDITION_LINE}"\n`);
  if (DRY) { console.log(`  would write ${vs.length} files to ${path.relative(ROOT, dir)}`); return; }
  for (const v of vs) {
    const file = path.join(dir, v.id.replace(/[^\w.-]/g, '_') + '.mp3');
    try {
      // no direction and no tuning here on purpose — you are judging the VOICE
      fs.writeFileSync(file, await render(AUDITION_LINE, { voice: v.id }, ''));
      console.log(`  ${path.relative(ROOT, file)}   ${v.name}`);
    } catch (e) { console.error(`  FAILED ${v.id}: ${e.message}`); }
  }
  console.log(`\nListen, pick, and put the ids in audio/pod/cast.json.`);
  console.log(`audio/pod/_audition/ is scratch — delete it before committing.\n`);
}

function doParts(eps) {
  const humans = Object.entries(CASTING.cast).filter(([, c]) => c.human).map(([n]) => n);
  if (!humans.length) {
    console.log('\nNobody is marked "human": true in audio/pod/cast.json, so there is nothing to record.\n');
    return;
  }
  console.log(`\nLines to record — ${humans.join(', ')}.`);
  console.log('Save each one in the folder shown, named by its number, in any format a browser plays.');
  console.log('A phone voice memo is fine, and for a phone-in caller it is better than a studio.\n');
  let n = 0, covered = 0;
  for (const ep of eps) {
    const mine = ep.blocks.map((b, i) => ({ b, i }))
      .filter(({ b }) => b.t === 'speech' && humans.includes(b.who));
    if (!mine.length) continue;
    console.log(`── ${ep.id}  (${ep.title})   →  audio/pod/${ep.id}/`);
    for (const { b, i } of mine) {
      const got = existing(ep.id, i);
      // an understudy means this one is already covered — recording it is an
      // upgrade, not a blocker, which is the difference between a nice ritual
      // and a fortnightly obligation
      const under = !got && String(chairFor(b.who).voice || '').trim();
      const tag = got ? '[recorded: ' + got + ']' : under ? '[ optional — understudy is covering it ]' : '[ TO DO ]';
      if (under) covered++;
      console.log(`   ${String(i).padStart(3)}.mp3  ${tag}  ${b.who}`);
      console.log(`        “${b.text}”\n`);
      n++;
    }
  }
  console.log(`${n} line(s) in total${covered ? `, ${covered} already covered by an understudy` : ''}.`);
  console.log(`When they're in: node scripts/render_pods.js --scan\n`);
}

async function doRender(eps) {
  /* Fail before spending anything. On ElevenLabs a voice id is a long opaque
     string, so an empty or copied-across-from-OpenAI one is easy to miss and
     would otherwise show up as a wall of 400s halfway through a render. */
  const uncast = Object.entries(CASTING.cast)
    .filter(([, c]) => !c.human && !String(c.voice || '').trim()).map(([n]) => n);
  if (uncast.length) {
    // --dry is how you cost the job BEFORE casting, so it only warns
    console.error(`\n${DRY ? 'Note: no' : 'No'} voice cast for: ${uncast.join(', ')}.`);
    console.error(`Run  node scripts/render_pods.js --voices  and paste the ids into audio/pod/cast.json.\n`);
    if (!DRY) process.exit(1);
  }
  if (PROVIDER === 'elevenlabs' && !DRY) {
    const known = new Set((await listVoices()).map(v => v.id));
    const wrong = Object.entries(CASTING.cast)
      .filter(([, c]) => !c.human && !known.has(String(c.voice).trim()));
    if (wrong.length) {
      console.error(`\nThese voice ids are not in your ElevenLabs library:`);
      for (const [n, c] of wrong) console.error(`  ${n} → "${c.voice}"`);
      console.error(`Run --voices for the real ids. (Add a voice to your library first if it is from the shared pool.)\n`);
      process.exit(1);
    }
  }
  let made = 0, skipped = 0, human = 0, stood = 0, chars = 0;
  for (const ep of eps) {
    const dir = path.join(OUT, ep.id);
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 0; n < ep.blocks.length; n++) {
      const b = ep.blocks[n];
      if (b.t === 'theme') continue; // the stings are synthesised in the app
      const who = b.t === 'ad' ? ep.host : b.who;
      const chair = chairFor(who);
      const got = existing(ep.id, n);
      const mine = provenance(ep.id, n);   // did WE write that file, and with what voice
      const voice = String(chair.voice || '').trim();
      if (chair.human) {
        /* A hand-recorded line is NEVER overwritten, --force or not: the whole
           point is that a render can't destroy a take somebody drove to a
           quiet room to make. A file we rendered ourselves is a different
           thing, and has to stay replaceable — otherwise a stand-in voice put
           in today would permanently block the real cloned one arriving next
           week, which is exactly the Howard case.

           Marc, 18 Aug: "im not recording for howard, someone else is." The
           pilots are fixed scripts and can be recorded once, but the weekly
           episodes are generated from that week's results, so his question is
           new every time. So a human part may ALSO carry a voice id: the
           stand-in. It is used only where no real take exists, and the moment
           one is dropped in, --scan makes it win. */
        if (got && !mine) { skipped++; continue; }        // a real take. hands off.
        if (!voice) { human++; continue; }                 // nobody cast, nothing to do
        if (got && mine && mine.voice === voice && !FORCE) { skipped++; continue; }
        stood++;
      } else if (got && !FORCE && (!mine || mine.voice === voice)) {
        // already cut by the voice currently cast — nothing to gain by paying again
        skipped++; continue;
      }
      const text = b.t === 'ad' ? `${b.brand}. ${b.text}` : b.text;
      const direction = b.t === 'ad' ? (CASTING.adDirection[ep.show] || chair.direction) : chair.direction;
      // the lines either side, so it knows where it is in the conversation
      const spoken = k => (ep.blocks[k] && ep.blocks[k].t !== 'theme')
        ? (ep.blocks[k].t === 'ad' ? `${ep.blocks[k].brand}. ${ep.blocks[k].text}` : ep.blocks[k].text) : '';
      const around = { prev: spoken(n - 1), next: spoken(n + 1) };
      chars += text.length;
      if (DRY) { console.log(`  would render ${ep.id}/${n}.mp3  ${who} as ${chair.voice || '(NO VOICE CAST)'}  ${text.length} chars`); made++; continue; }
      try {
        fs.writeFileSync(path.join(dir, n + '.mp3'), await render(text, chair, direction, around));
        noteRendered(ep.id, n, n + '.mp3', chair.voice);
        made++;
        process.stdout.write(`  ${ep.id}/${n}.mp3  ${who}${mine && mine.voice !== voice ? '  (recast)' : ''}\n`);
      } catch (e) {
        console.error(`  FAILED ${ep.id}/${n}: ${e.message}`);
      }
    }
  }
  console.log(`\n${made} line(s) rendered${stood ? ` (${stood} by an understudy, waiting on a real take)` : ''}, ${skipped} already cut, ${human} left for a human, ${chars} characters billed.`);
  if (DRY) { console.log('(dry run — nothing written, nothing spent)'); return; }
  saveProvenance();
  writeManifest(scanManifest());
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  if (CLONE) return doClone(CLONE, argv.slice(argv.indexOf('--clone') + 2).filter(a => !a.startsWith('--')));
  if (VOICES) return doVoices();
  if (AUDITION) return doAudition();
  if (SCAN) { writeManifest(scanManifest()); return; }
  const eps = await harvest();
  if (!eps.length) { console.error('nothing to work on — check --only against Podcast.published()'); process.exit(1); }
  if (PARTS) return doParts(eps);
  await doRender(eps);
})().catch(e => { console.error(e.message || e); process.exit(1); });
