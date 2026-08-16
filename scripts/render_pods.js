#!/usr/bin/env node
/* Render The Podcunt Network to REAL voices.
 *
 * Marc, 18 Aug: "this joke doesnt work unless the people sound like people not
 * robots. We need to find a way to have proper voices that sound more real."
 * He is right. The browser's speech engine has a ceiling and we have hit it —
 * it can be stopped from spelling out the shouting (js/app.js, podRuns) but it
 * will never be Andy Grey. The only step change is recorded audio.
 *
 * So: this reads the episodes out of the LIVE generator (headless browser, the
 * same js/podcast.js every phone runs — no second copy of the scripts to drift
 * out of sync), sends each line to a proper text-to-speech voice, and writes
 *
 *     audio/pod/<episode-id>/<block-index>.mp3
 *     audio/pod/index.json          ← the episodes that are ready
 *
 * One file per spoken line, numbered by its index in ep.blocks. The player
 * walks blocks anyway, so the captions, the running order and the synthesised
 * stings all keep working, and a half-rendered episode still plays: any line
 * without a file falls back to the browser voice.
 *
 * ONLY BEN RUNS THIS. It needs an API key and it spends money. Nothing in the
 * app fetches from a third party — this is a build step whose OUTPUT is
 * committed, so the site itself stays same-origin and offline-capable.
 *
 *   OPENAI_API_KEY=... node scripts/render_pods.js --only gfw-pilot,tt-pilot
 *   ELEVENLABS_API_KEY=... node scripts/render_pods.js --provider elevenlabs
 *
 *   --only a,b     render just these episode ids (default: everything published)
 *   --provider     openai (default) | elevenlabs
 *   --force        re-render lines that already have a file
 *   --dry          list what it would render, spend nothing
 *   --url          site to read the episodes from (default http://localhost:8749)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'audio', 'pod');

const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PROVIDER = opt('provider', 'openai');
const ONLY = (opt('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const SITE = opt('url', 'http://localhost:8749');
const FORCE = flag('force'), DRY = flag('dry');

/* ---------- the casting ----------
   This is the whole job. A neutral voice reading Andy Grey's lines is exactly
   the robot Marc is complaining about, so every character gets a different
   voice AND a direction — how to say it, not just what. Ben: change these
   freely, that is the point of them being here rather than buried.

   openai  — voice is one of alloy/ash/ballad/coral/echo/fable/onyx/nova/sage/
             shimmer/verse; `direction` is passed as `instructions`, which the
             gpt-4o-mini-tts model actually acts on. That steering is why this
             is the default provider.
   11labs  — `id` is a voice id from your ElevenLabs library. It ignores the
             direction (the voice itself carries the character), so cast it
             with care: the shouty ones want an actual shouty voice. */
const CAST = {
  'Rax Mushden': {
    openai: 'ballad', id: '',
    direction: 'A warm, quick, slightly amused British radio host chairing a panel show. Conversational, never announcer-ish. Keeps things moving, lands the dry jokes flat rather than pushing them.',
  },
  'Donathan Bilson': {
    openai: 'sage', id: '',
    direction: 'A thoughtful, unhurried British football writer explaining tactics. Long pauses, careful clause-by-clause delivery, faintly professorial and entirely sincere. Never raises his voice.',
  },
  'Yonni Liu': {
    openai: 'shimmer', id: '',
    direction: 'A bright, earnest, youngish British journalist making an emotional point about football and meaning it. Slightly faster than the room, warm, a bit wry at her own expense.',
  },
  'Sid Lowry': {
    openai: 'echo', id: '',
    direction: 'A relaxed British correspondent phoning in from Spain on a hot afternoon. Easy, gently ironic, unbothered, like a man on a balcony.',
  },
  'Richard Keyes': {
    openai: 'onyx', id: '',
    direction: 'A booming, self-important British sports broadcaster on drivetime radio. Low, plummy, absolutely certain. Hammers key words hard, treats every opinion as settled fact.',
  },
  'Andy Grey': {
    openai: 'ash', id: '',
    direction: 'A gruff, gravelly Scottish ex-footballer turned pundit, exasperated and loud. Growls through the ordinary words and BELLOWS the ones in capitals. Contemptuous, blunt, no pauses for breath.',
  },
  'Jamie O’Hara-Hara': {
    openai: 'verse', id: '',
    direction: 'A hyped-up young Essex ex-footballer on talk radio, talking over everyone. Fast, nasal, indignant, rising at the end of every sentence, permanently on the edge of shouting.',
  },
};

/* Directions are per character; the ad reads want their own energy, because
   an advert read in the presenter's normal voice is the one thing no radio
   station has ever done. */
const AD_DIRECTION = {
  gfw: 'Read as a gentle, sincere public-service sponsorship message. Soft, unhurried, slightly wistful.',
  tt: 'Read as a LOUD, hard-sell local radio advert. Fast, aggressive, delighted with itself, shouting the product name.',
};

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
  return eps;
}

/* ---------- the voices ---------- */
async function ttsOpenAI(text, voice, direction) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts', voice, input: text,
      instructions: direction, response_format: 'mp3',
    }),
  });
  if (!r.ok) throw new Error('openai ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return Buffer.from(await r.arrayBuffer());
}

async function ttsEleven(text, voiceId) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  if (!voiceId) throw new Error('no ElevenLabs voice id cast for this character — fill in CAST[].id');
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text, model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.5 },
    }),
  });
  if (!r.ok) throw new Error('elevenlabs ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return Buffer.from(await r.arrayBuffer());
}

const say = (text, who, showId, isAd) => {
  const c = CAST[who] || CAST['Rax Mushden'];
  const direction = isAd ? (AD_DIRECTION[showId] || c.direction) : c.direction;
  return PROVIDER === 'elevenlabs' ? ttsEleven(text, c.id) : ttsOpenAI(text, c.openai, direction);
};

(async () => {
  const eps = (await harvest()).filter(e => !ONLY.length || ONLY.includes(e.id));
  if (!eps.length) { console.error('nothing to render — check --only against Podcast.published()'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const ready = new Set(JSON.parse(fs.existsSync(path.join(OUT, 'index.json'))
    ? fs.readFileSync(path.join(OUT, 'index.json'), 'utf8') : '[]'));

  let made = 0, skipped = 0, chars = 0;
  for (const ep of eps) {
    const dir = path.join(OUT, ep.id);
    fs.mkdirSync(dir, { recursive: true });
    let whole = true;
    for (let n = 0; n < ep.blocks.length; n++) {
      const b = ep.blocks[n];
      if (b.t === 'theme') continue; // the stings are synthesised in the app
      const text = b.t === 'ad' ? `${b.brand}. ${b.text}` : b.text;
      const who = b.t === 'ad' ? ep.host : b.who;
      const file = path.join(dir, n + '.mp3');
      if (!FORCE && fs.existsSync(file)) { skipped++; continue; }
      chars += text.length;
      if (DRY) { console.log(`  would render ${ep.id}/${n}.mp3  ${who}  ${text.length} chars`); made++; continue; }
      try {
        fs.writeFileSync(file, await say(text, who, ep.show, b.t === 'ad'));
        made++;
        process.stdout.write(`  ${ep.id}/${n}.mp3  ${who}\n`);
      } catch (e) {
        whole = false;
        console.error(`  FAILED ${ep.id}/${n}: ${e.message}`);
      }
    }
    // an episode counts as recorded once every line is cut; a partial one is
    // left off the manifest so the app doesn't promise a read it can't give
    if (whole) ready.add(ep.id); else ready.delete(ep.id);
  }
  if (!DRY) fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify([...ready].sort(), null, 2) + '\n');
  console.log(`\n${made} line${made === 1 ? '' : 's'} rendered, ${skipped} already cut, ${chars} characters billed.`);
  console.log(`${ready.size} episode${ready.size === 1 ? '' : 's'} listed in audio/pod/index.json.`);
  if (DRY) console.log('(dry run — nothing was written and nothing was spent)');
})().catch(e => { console.error(e); process.exit(1); });
