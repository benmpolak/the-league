/* Ben, 18 Sept 2026: recover paid recordings after a failed upload. GET only;
   exact words, voice and model must match. Never fall back to paid synthesis. */
'use strict';

async function historyReader({ since, key, model, fetcher = fetch }) {
  const date = Date.parse(since);
  if (!Number.isFinite(date)) throw Error('Invalid recovery date');
  if (!key) throw Error('ELEVENLABS_API_KEY is not set');
  const headers = { 'xi-api-key': key };
  const items = [];
  const seen = new Set();
  let cursor = '';
  for (let page = 0; page < 50; page++) {
    const query = new URLSearchParams({ page_size: '100', date_after_unix: String(Math.floor(date / 1000)), source: 'TTS' });
    if (cursor) query.set('start_after_history_item_id', cursor);
    const response = await fetcher('https://api.elevenlabs.io/v1/history?' + query, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error('ElevenLabs history: HTTP ' + response.status);
    const body = await response.json();
    if (!Array.isArray(body.history)) throw Error('Invalid ElevenLabs history response');
    items.push(...body.history.filter(item => item.date_unix >= Math.floor(date / 1000)));
    if (!body.has_more) {
      return async (text, voice) => {
        const item = items.filter(row => row.text === text && row.voice_id === voice && row.model_id === model)
          .sort((a, b) => b.date_unix - a.date_unix)[0];
        if (!item) throw Error('No matching saved recording for voice ' + voice);
        const audio = await fetcher('https://api.elevenlabs.io/v1/history/' + encodeURIComponent(item.history_item_id) + '/audio', { headers, signal: AbortSignal.timeout(30000) });
        if (!audio.ok) throw Error('ElevenLabs saved audio: HTTP ' + audio.status);
        if (!/^audio\//i.test(audio.headers.get('content-type') || '')) throw Error('Saved recording is not audio');
        const buffer = Buffer.from(await audio.arrayBuffer());
        if (!buffer.length) throw Error('Saved recording is empty');
        return buffer;
      };
    }
    cursor = body.last_history_item_id;
    if (!cursor || seen.has(cursor)) throw Error('ElevenLabs history pagination stalled');
    seen.add(cursor);
  }
  throw Error('ElevenLabs history exceeds recovery limit');
}

module.exports = { historyReader };
