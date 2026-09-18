'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { historyReader } = require('../scripts/pod_history');

const since = '2026-09-18T12:00:00Z';
const date = Date.parse(since) / 1000;
const saved = { history_item_id: 'right', date_unix: date + 30, text: 'Hello Romford', voice_id: 'romford', model_id: 'approved' };
const options = { since, key: 'synthetic-test-key', model: 'approved' };
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

test('recovery selects exact words, voice and model across pages, with GET requests only', async () => {
  const calls = [];
  const recover = await historyReader({ ...options, fetcher: async (url, init) => {
    assert.equal(init.method, undefined);
    calls.push(url);
    if (url.endsWith('/right/audio')) return new Response('saved-mp3', { headers: { 'content-type': 'audio/mpeg' } });
    if (url.includes('start_after_history_item_id=page1')) return json({ history: [saved], has_more: false });
    return json({ history: [
      { ...saved, history_item_id: 'wrong-voice', voice_id: 'other', date_unix: date + 90 },
      { ...saved, history_item_id: 'wrong-model', model_id: 'other' },
      { ...saved, history_item_id: 'wrong-words', text: 'Hello' },
      { ...saved, history_item_id: 'too-old', date_unix: date - 1 },
    ], has_more: true, last_history_item_id: 'page1' });
  } });
  assert.equal((await recover(saved.text, saved.voice_id)).toString(), 'saved-mp3');
  assert.equal(calls.length, 3);
  await assert.rejects(recover('Unrecorded words', 'romford'), /No matching/);
  assert.equal(calls.length, 3, 'missing audio must never trigger synthesis');
});

test('history access failures stop recovery', async () => {
  await assert.rejects(historyReader({ ...options, fetcher: async () => new Response('', { status: 403 }) }), /403/);
});

test('per-character model and settings must match before recording provenance', async () => {
  const recover = await historyReader({ ...options, fetcher: async url => url.endsWith('/right/audio')
    ? new Response('v3-mp3', { headers: { 'content-type': 'audio/mpeg' } })
    : json({ history: [{ ...saved, model_id: 'eleven_v3', settings: { stability: 0.5 } }], has_more: false }) });
  assert.equal((await recover(saved.text, saved.voice_id, 'eleven_v3', { stability: 0.5 })).toString(), 'v3-mp3');
  await assert.rejects(recover(saved.text, saved.voice_id, 'eleven_v3', { stability: 1 }), /No matching/);
  await assert.rejects(recover(saved.text, saved.voice_id, 'eleven_multilingual_v2', { stability: 0.5 }), /No matching/);
});

test('stalled pagination is rejected', async () => {
  await assert.rejects(historyReader({ ...options, fetcher: async () => json({ history: [], has_more: true, last_history_item_id: 'same' }) }), /stalled/);
});

test('non-audio and empty downloads are rejected', async () => {
  for (const response of [new Response('{}', { headers: { 'content-type': 'application/json' } }), new Response('', { headers: { 'content-type': 'audio/mpeg' } })]) {
    const recover = await historyReader({ ...options, fetcher: async url => url.endsWith('/audio') ? response : json({ history: [saved], has_more: false }) });
    await assert.rejects(recover(saved.text, saved.voice_id), /not audio|empty/);
  }
});
