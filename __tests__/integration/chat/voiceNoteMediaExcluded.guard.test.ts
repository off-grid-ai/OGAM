/**
 * GUARD (integration) — B5/B9 seam: a voice note's AUDIO is never sent to the model as media (only its
 * transcript, already in message.content, reaches the model). This is the SINGLE source of truth
 * (modelMedia.ts) every engine path inherits — locking it green guards against the B5/B9 regression where
 * a voice-mode note (transcript in content, no textContent on the attachment) was sent as input_audio and
 * the LLM failed on the stale/gone file. Runs the REAL modelMedia builders (no faking — pure our-code).
 */
import { modelInputAudioUris, modelInputImageUris } from '../../../src/services/modelMedia';
import type { MediaAttachment } from '../../../src/types';

describe('B5/B9 — voice note audio excluded from model media (guard)', () => {
  it('excludes a voice note\'s audio (even with no attachment.textContent) but keeps images', () => {
    // A voice-MODE note: transcript lives in message.content, NOT on the attachment (the exact B9 shape).
    const voiceNote: MediaAttachment = { id: 'a1', type: 'audio', uri: '/stale/vn.wav', audioFormat: 'wav' } as MediaAttachment;
    const image: MediaAttachment = { id: 'i1', type: 'image', uri: '/img/cat.png' } as MediaAttachment;

    // Correct: audio is display/playback only — never model input on any engine.
    expect(modelInputAudioUris([voiceNote, image])).toEqual([]);
    // Images are still real model input.
    expect(modelInputImageUris([voiceNote, image])).toEqual(['/img/cat.png']);
  });
});
