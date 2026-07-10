/**
 * B5/B9 PARITY on the LiteRT TOOL-CALLING path.
 *
 * modelMedia.ts is the SINGLE seam that enforces "a voice note is transcript-only,
 * its audio is NEVER model input" on every engine. Its docstring says both the
 * llama/OAI builders AND the LiteRT generation path go through it so they cannot
 * drift.
 *
 * This test targets the LiteRT TOOL-CALLING path (generationToolLoop.callLiteRTForLoop),
 * which computes its media URIs INLINE from lastUser.attachments instead of through
 * modelInputAudioUris. It is the same class of bug B5/B9 fixed on the non-tool path:
 * a voice-note turn with tools enabled sends the audio to LiteRT as media.
 *
 * The assertion is the terminal artifact: the audioUris the tool-loop would hand
 * liteRTService.generateRaw for a voice-note attachment, vs what the rule
 * (modelInputAudioUris) mandates ([]).
 */
import { modelInputAudioUris } from '../../../src/services/modelMedia';
import type { MediaAttachment } from '../../../src/types';

// The EXACT inline filter generationToolLoop.ts:471-473 applies to build audioUris.
// Kept verbatim so this test tracks the real code; when the source is fixed to call
// modelInputAudioUris, replace this with a real drive of callLiteRTForLoop.
function toolLoopAudioUris(attachments: MediaAttachment[] | undefined): string[] | undefined {
  return attachments
    ?.filter((a: any) => a.type === 'audio' && typeof a.uri === 'string' && a.uri.trim().length > 0)
    .map((a: any) => a.uri);
}

const voiceNote: MediaAttachment = {
  id: 'audio-1',
  type: 'audio',
  uri: 'file:///var/mobile/Containers/.../voice.wav',
  audioFormat: 'wav',
  // transcript lives in message.content (transcript-only), NOT on the attachment
} as MediaAttachment;

describe('LiteRT tool-loop voice-note audio parity', () => {
  it('the rule (modelInputAudioUris) excludes the voice-note audio', () => {
    expect(modelInputAudioUris([voiceNote])).toEqual([]);
  });

  it('BUG: the tool-loop inline filter INCLUDES the voice-note audio (drift from the rule)', () => {
    const drifted = toolLoopAudioUris([voiceNote]);
    // The tool-loop path sends the stale absolute-path audio to LiteRT as media —
    // exactly the B9 "File does not exist" / B5 "Failed to load media" failure the
    // modelMedia seam was created to prevent, but this path bypasses it.
    expect(drifted).toEqual(['file:///var/mobile/Containers/.../voice.wav']);
    // The two disagree — that IS the drift.
    expect(drifted).not.toEqual(modelInputAudioUris([voiceNote]));
  });
});
