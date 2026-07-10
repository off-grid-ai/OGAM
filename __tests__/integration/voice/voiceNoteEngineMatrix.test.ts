/**
 * ADVERSARIAL intersection matrix: a voice note is TRANSCRIPT-ONLY on EVERY engine,
 * in EVERY STT mode, for EVERY audio-capability — the audio URI NEVER reaches the model.
 *
 * This extends `generation/voiceNoteTranscriptOnly.test.ts` (which mocks BOTH engine
 * services and so can only prove the LiteRT `audioUris:[]` seam and "no throw"). That
 * test's llama branch asserts nothing about the actual message the llama engine would
 * receive — it just checks `generateResponse` was called. THAT is the blind spot: the
 * B5/B9 bug was audio leaking into the model's media parts, and the llama media-part
 * builder (`buildOAIMessages` / `buildMediaParts`) is where it would leak.
 *
 * So here we drive the REAL builders (llmMessages) and the REAL LiteRT generation seam
 * (runLiteRTResponseImpl via generationService), asserting the TERMINAL artifact:
 *   - llama:  the OAI message the engine receives carries the transcript TEXT and ZERO
 *             `input_audio` parts — even on an AUDIO-CAPABLE model (supportsAudio=true),
 *             even when the note is not-yet-transcribed. Deleting the `return []` in
 *             modelMedia/llmMessages MUST fail this (it would emit an input_audio part).
 *   - litert: the engine receives the transcript text and `audioUris === []`.
 *
 * Axes crossed (docs/TEST_MATRIX.md §2/§3.2 — modality × engine):
 *   engine {llama, litert} × STT-mode {text-mode transcript-in-content + audio attachment,
 *   full voice-mode transcript-in-content} × audio-capability {false, true}.
 */
import { useAppStore } from '../../../src/stores/appStore';
import { generationService } from '../../../src/services/generationService';
import { liteRTService } from '../../../src/services/litert';
import { activeModelService } from '../../../src/services/activeModelService';
import { buildOAIMessages, formatLlamaMessages } from '../../../src/services/llmMessages';
import { modelInputAudioUris, modelInputImageUris } from '../../../src/services/modelMedia';
import {
  resetStores,
  setupWithConversation,
  flushPromises,
} from '../../utils/testHelpers';
import { createDownloadedModel, createMessage } from '../../utils/factories';
import type { MediaAttachment, Message } from '../../../src/types';

jest.mock('../../../src/services/litert');
jest.mock('../../../src/services/activeModelService');

const mockLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockActive = activeModelService as jest.Mocked<typeof activeModelService>;

// ── Local fixtures (no shared-file edits) ────────────────────────────────────
const STALE = '/var/mobile/Containers/Data/Application/OLD-UUID/Documents/vn.wav';
const TRANSCRIPT = 'what is the capital of France';

/** A voice note whose transcript is already in message.content (the recorded shape). */
const voiceNoteWithTranscript = (): MediaAttachment =>
  ({ id: 'vn-1', type: 'audio', uri: STALE, audioFormat: 'wav', textContent: TRANSCRIPT } as MediaAttachment);

/** A voice note that has NOT been transcribed yet (textContent absent) — must ALSO
 *  never reach the model as raw audio. */
const voiceNoteNoTranscript = (): MediaAttachment =>
  ({ id: 'vn-2', type: 'audio', uri: STALE, audioFormat: 'wav' } as MediaAttachment);

type OAIPart = { type: string; input_audio?: unknown; image_url?: unknown; text?: string };
const partsOf = (content: unknown): OAIPart[] => (Array.isArray(content) ? (content as OAIPart[]) : []);
const audioParts = (msgs: ReturnType<typeof buildOAIMessages>): OAIPart[] =>
  msgs.flatMap(m => partsOf(m.content)).filter(p => p.type === 'input_audio');

// ═════════════════════════════════════════════════════════════════════════════
// PART A — the SEAM builders (pure, real). Proves audio never becomes model media
// on the llama/OAI path, for BOTH capabilities and BOTH STT modes.
// ═════════════════════════════════════════════════════════════════════════════
describe.each([false, true])('llama media builders — supportsAudio=%s', (supportsAudio) => {
  describe.each([
    { mode: 'text-mode (transcribed)', att: voiceNoteWithTranscript },
    { mode: 'text-mode (NOT yet transcribed)', att: voiceNoteNoTranscript },
    { mode: 'voice-mode (transcribed)', att: voiceNoteWithTranscript },
  ])('STT $mode', ({ att }) => {
    const userMsg = (): Message =>
      createMessage({ role: 'user', content: TRANSCRIPT, attachments: [att()] });

    it('buildOAIMessages emits the transcript text and ZERO input_audio parts', () => {
      const msgs = buildOAIMessages([userMsg()], supportsAudio);

      // TERMINAL artifact: no audio ever becomes an OAI media part, on either capability.
      expect(audioParts(msgs)).toEqual([]);

      // And the transcript survives — either as plain string content (no media) or as a
      // text part (if some other media forced parts). Here there's no image, so it's a
      // plain string on both capabilities.
      const flat = msgs
        .map(m => (typeof m.content === 'string' ? m.content : partsOf(m.content).map(p => p.text ?? '').join('')))
        .join('');
      expect(flat).toContain(TRANSCRIPT);
    });

    it('formatLlamaMessages emits no audio <__media__> marker', () => {
      const prompt = formatLlamaMessages([userMsg()], /*supportsVision*/ false, supportsAudio);
      // The only content between the user tags is the transcript — no media marker was
      // prepended for the audio attachment (image markers gated off too here).
      expect(prompt).toContain(`<|im_start|>user\n${TRANSCRIPT}<|im_end|>`);
      expect(prompt).not.toContain('<__media__>');
    });
  });
});

// The single seam itself: audioUris is empty by rule; imageUris is unaffected.
describe('modelMedia seam — the single source of truth', () => {
  it('modelInputAudioUris is ALWAYS empty, even for a transcribed audio note', () => {
    expect(modelInputAudioUris([voiceNoteWithTranscript()])).toEqual([]);
    expect(modelInputAudioUris([voiceNoteNoTranscript()])).toEqual([]);
    expect(modelInputAudioUris(undefined)).toEqual([]);
  });
  it('a co-attached image still passes through (voice note does not suppress images)', () => {
    const img = { id: 'i1', type: 'image', uri: 'file:///x/pic.jpg' } as MediaAttachment;
    expect(modelInputImageUris([voiceNoteWithTranscript(), img])).toEqual(['file:///x/pic.jpg']);
    expect(modelInputAudioUris([voiceNoteWithTranscript(), img])).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PART B — the LiteRT generation JOURNEY (real runLiteRTResponseImpl via the
// service). Proves the transcript reaches the engine and audioUris===[] end-to-end,
// on a NON-audio AND an AUDIO-capable LiteRT model, in text-mode and voice-mode.
// ═════════════════════════════════════════════════════════════════════════════
describe.each([
  { audioCapable: false, label: 'NON-audio' },
  { audioCapable: true, label: 'audio-capable' },
])('LiteRT journey — $label model', ({ audioCapable }) => {
  describe.each([
    { stt: 'text-mode', att: voiceNoteWithTranscript },
    { stt: 'voice-mode', att: voiceNoteNoTranscript },
  ])('STT $stt', ({ att }) => {
    beforeEach(() => {
      resetStores();
      jest.clearAllMocks();

      mockActive.getActiveModels.mockReturnValue({
        text: { model: null, isLoaded: true, isLoading: false },
        image: { model: null, isLoaded: false, isLoading: false },
      });

      mockLiteRT.isModelLoaded.mockReturnValue(true);
      mockLiteRT.stopGeneration.mockResolvedValue();
      mockLiteRT.prepareConversation.mockResolvedValue(undefined as never);
      mockLiteRT.sendMessage.mockImplementation(async (_text, handlers) => {
        handlers.onComplete?.('Paris', '', undefined as never);
      });

      const model = createDownloadedModel({ id: 'lr-1', engine: 'litert', liteRTAudio: audioCapable });
      useAppStore.setState({ downloadedModels: [model], activeModelId: 'lr-1' });
    });

    it('sends the transcript text and audioUris===[] (never throws, never leaks audio)', async () => {
      const userMsg: Message = createMessage({ role: 'user', content: TRANSCRIPT, attachments: [att()] });
      const conversationId = setupWithConversation({ messages: [] });

      await expect(generationService.generateResponse(conversationId, [userMsg])).resolves.not.toThrow();
      await flushPromises();

      expect(mockLiteRT.sendMessage).toHaveBeenCalledTimes(1);
      const [text, , media] = mockLiteRT.sendMessage.mock.calls[0];
      // TERMINAL: transcript text in, ZERO audio uris out — on BOTH capabilities.
      expect(text).toBe(TRANSCRIPT);
      expect((media as { audioUris?: string[] })?.audioUris ?? []).toEqual([]);
      expect((media as { imageUris?: string[] })?.imageUris ?? []).toEqual([]);
      expect(generationService.getState().isGenerating).toBe(false);
    });
  });
});
