/* Ben, 18 Sept 2026: the Romford audition is a v3 remix. A matching voice
   id alone does not mean an older model reproduces the approved performance. */
'use strict';

function voiceProfile(casting, chair) {
  const model = chair.model || casting.model || 'eleven_multilingual_v2';
  const s = chair.settings || {};
  const settings = model === 'eleven_v3' ? { stability: s.stability ?? 0.5 } : {
    stability: s.stability ?? 0.4,
    similarity_boost: s.similarity ?? 0.8,
    style: s.style ?? 0.5,
    use_speaker_boost: s.speakerBoost ?? true,
  };
  if (model === 'eleven_v3' && ![0, 0.5, 1].includes(settings.stability)) {
    throw Error('Eleven v3 stability must be 0, 0.5 or 1');
  }
  return { model, settings };
}

function elevenBody(text, casting, chair, around) {
  const profile = voiceProfile(casting, chair);
  const body = { text, model_id: profile.model, voice_settings: profile.settings };
  // v3 does not support request stitching; keep the caller's own text alone.
  if (profile.model !== 'eleven_v3') {
    if (around?.prev) body.previous_text = around.prev;
    if (around?.next) body.next_text = around.next;
  }
  return body;
}

function currentRecording(mine, voice, provider, casting, chair) {
  if (!mine || mine.voice !== voice || mine.provider !== provider) return false;
  if (provider !== 'elevenlabs') return true;
  const profile = voiceProfile(casting, chair);
  // Old recordings predate profile tracking and all used Multilingual v2.
  // Preserve them unless this character explicitly changes model.
  if (!mine.profile) return profile.model === 'eleven_multilingual_v2';
  return JSON.stringify(mine.profile) === JSON.stringify(profile);
}

function shouldRender(got, mine, voice, force, provider, casting, chair) {
  if (!voice || (got && !mine)) return false; // preserve real recordings
  return !got || force || !currentRecording(mine, voice, provider, casting, chair);
}

module.exports = { voiceProfile, elevenBody, currentRecording, shouldRender };
