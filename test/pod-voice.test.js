'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { elevenBody, voiceProfile, shouldRender } = require('../scripts/pod_voice');
const casting = { model: 'eleven_multilingual_v2' };
const raymond = { voice: 'approved-romford', human: true, model: 'eleven_v3', settings: { stability: 0.5 } };
const old = { voice: raymond.voice, provider: 'elevenlabs' };
const due = (got, mine, chair = raymond, force = false) => shouldRender(got, mine, chair.voice, force, 'elevenlabs', casting, chair);

test('Raymond uses v3 Natural without v2 settings or other speakers context', () => {
  assert.deepEqual(elevenBody('Hello Romford', casting, raymond, { prev: 'Other host', next: 'Other caller' }), {
    text: 'Hello Romford', model_id: 'eleven_v3', voice_settings: { stability: 0.5 },
  });
  const v2 = elevenBody('Hello', casting, { settings: { stability: 0.22, style: 0.8 } }, { prev: 'Before' });
  assert.equal(v2.model_id, 'eleven_multilingual_v2');
  assert.equal(v2.voice_settings.style, 0.8);
  assert.equal(v2.previous_text, 'Before');
});

test('same voice rendered with the wrong model is due, but other old recordings are preserved', () => {
  assert.equal(due('line.mp3', old), true);
  assert.equal(due('line.mp3', old, { voice: raymond.voice }), false);
  const current = { ...old, profile: voiceProfile(casting, raymond) };
  assert.equal(due('line.mp3', current), false);
  assert.equal(due('line.mp3', current, { ...raymond, settings: { stability: 1 } }), true);
  assert.equal(due('line.mp3', current, raymond, true), true);
});

test('real takes are never overwritten and missing voices never trigger synthesis', () => {
  assert.equal(due('human.wav', null, raymond, true), false);
  assert.equal(due('human.wav', null, { ...raymond, human: false }, true), false);
  assert.equal(due(null, null, { human: true, voice: '' }), false);
  assert.equal(due(null, null), true);
});

test('invalid v3 settings stop before any synthesis request', () => {
  assert.throws(() => elevenBody('Hello', casting, { ...raymond, settings: { stability: 0.45 } }), /stability/);
});
