/**
 * JOURNEY: voice note → transcript → generate, across BOTH engines. The voice note's AUDIO
 * must NEVER reach the model as media (B5/B9); only its transcript (in message.content) goes.
 * Images, by contrast, DO reach a vision model.
 *
 * Cluster B (multimodal turn). Crosses the two media-builder seams that MUST share one rule:
 *   - llama / OAI path: buildOAIMessages / formatLlamaMessages (src/services/llmMessages.ts)
 *   - litert path:      modelInputAudioUris / modelInputImageUris (src/services/modelMedia.ts)
 *
 * We assert the TERMINAL artifact each engine hands the native generator: for llama, the
 * media PARTS array; for litert, the {imageUris, audioUris} tuple. The bug this guards:
 * B5/B9 landed on the llama path first, so LiteRT still shipped the stale audio path and
 * hard-failed the turn ("File does not exist" / "does not support audio input").
 *
 * Edge attacked: a voice-MODE note whose audio attachment has NO textContent (the transcript
 * lives in message.content). The naive "exclude only attachments with textContent" filter let
 * this through — the exact B9 sibling. The unconditional rule must still exclude it.
 */
import { buildOAIMessages, formatLlamaMessages } from '../../../src/services/llmMessages';
import { modelInputAudioUris, modelInputImageUris } from '../../../src/services/modelMedia';
import type { Message, MediaAttachment } from '../../../src/types';

// A persisted voice-mode turn: the audio attachment carries NO transcript text (the transcript
// is the message content), and its uri is a stale absolute container path (post-reinstall).
const staleVoiceNote: MediaAttachment = {
  id: 'vn-1',
  type: 'audio',
  uri: 'file:///var/mobile/Containers/Data/Application/OLD-UUID/Documents/vn.wav',
  audioFormat: 'wav',
} as any;

const image: MediaAttachment = { id: 'img-1', type: 'image', uri: 'file:///photo.png' } as any;

const voiceTurn: Message[] = [
  { id: 's', role: 'system', content: 'You are helpful.', timestamp: 0 } as Message,
  {
    id: 'u1',
    role: 'user',
    content: 'what did I just say?', // the transcript
    attachments: [staleVoiceNote],
    timestamp: 1,
  } as Message,
];

const imagePlusVoiceTurn: Message[] = [
  {
    id: 'u2',
    role: 'user',
    content: 'describe this',
    attachments: [image, staleVoiceNote],
    timestamp: 2,
  } as Message,
];

describe('JOURNEY: voice note is transcript-only across llama + litert', () => {
  describe('litert engine media tuple', () => {
    it('excludes the voice-note audio even when the model reports audio support', () => {
      // The litert path computes {imageUris, audioUris} from the same rule regardless of caps.
      const audioUris = modelInputAudioUris([staleVoiceNote]);
      expect(audioUris).toEqual([]); // TERMINAL: no audio path reaches the native generator
    });

    it('still lets a real image through to a vision model', () => {
      const imageUris = modelInputImageUris([image, staleVoiceNote]);
      expect(imageUris).toEqual(['file:///photo.png']); // image kept, audio dropped
    });
  });

  describe('llama / OAI engine media parts', () => {
    it('never emits an input_audio part for the voice note (even with supportsAudio=true)', () => {
      const oai = buildOAIMessages(voiceTurn, /* supportsAudio */ true);
      const userMsg = oai.find(m => m.role === 'user');
      // The user message must be a plain string (transcript), not a media-parts array with audio.
      if (typeof userMsg?.content === 'string') {
        expect(userMsg?.content).toBe('what did I just say?');
      } else {
        const parts = (userMsg?.content ?? []) as any[];
        expect(parts.some(p => p.type === 'input_audio')).toBe(false);
      }
    });

    it('the llama text prompt contains the transcript but no audio media marker', () => {
      const prompt = formatLlamaMessages(voiceTurn, /* supportsVision */ false, /* supportsAudio */ true);
      expect(prompt).toContain('what did I just say?');
      // No <__media__> marker was emitted for the audio (it would be, if audio were attached).
      expect(prompt).not.toContain('<__media__>');
    });

    it('image + voice: the OAI parts include the image but NOT the audio', () => {
      const oai = buildOAIMessages(imagePlusVoiceTurn, /* supportsAudio */ true);
      const userMsg = oai.find(m => m.role === 'user');
      const parts = (userMsg?.content ?? []) as any[];
      expect(Array.isArray(parts)).toBe(true);
      expect(parts.some(p => p.type === 'image_url')).toBe(true);  // image reaches the model
      expect(parts.some(p => p.type === 'input_audio')).toBe(false); // audio does not
    });
  });

  it('BOTH engines agree: for the same turn, zero audio reaches either generator', () => {
    // Cross-engine invariant — the single rule can never drift between the two paths.
    const litertAudio = modelInputAudioUris([staleVoiceNote]);
    const oai = buildOAIMessages(voiceTurn, true);
    const llamaParts = oai
      .filter(m => typeof m.content !== 'string')
      .flatMap(m => m.content as any[]);
    const llamaAudioParts = llamaParts.filter(p => p.type === 'input_audio');

    expect(litertAudio).toHaveLength(0);
    expect(llamaAudioParts).toHaveLength(0);
  });
});
