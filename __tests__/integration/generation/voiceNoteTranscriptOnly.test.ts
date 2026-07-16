/**
 * Intersection journey: a voice note is TRANSCRIPT-ONLY on EVERY text engine (B5/B9 parity).
 *
 * Product rule (single source of truth): every voice note is transcribed and ONLY its transcript
 * (already in message.content) is sent to the model. The audio attachment is display/playback only,
 * NEVER model input — sending it is redundant AND its absolute path goes stale on reinstall
 * ("File does not exist" — B9), and a non-audio model rejects it ("Failed to load media" — B5).
 *
 * Why this test exists: the B5/B9 fix was applied to the llama/OAI path (llmMessages.ts) but the
 * LiteRT generation path (runLiteRTResponseImpl) extracted audioUris independently and either sent
 * the audio to an audio-capable model OR THREW "does not support audio input" for a non-audio one —
 * the same bug, on the other engine, uncaught because no test crossed voice-note × litert. This is
 * the engine × modality intersection (see docs/TEST_MATRIX.md).
 */
import { useAppStore } from '../../../src/stores/appStore';
import { generationService } from '../../../src/services/generationService';
import { llmService } from '../../../src/services/llm';
import { liteRTService } from '../../../src/services/litert';
import { activeModelService } from '../../../src/services/activeModelService';
import {
  resetStores,
  setupWithConversation,
  flushPromises,
} from '../../utils/testHelpers';
import { createDownloadedModel, createMessage } from '../../utils/factories';
import type { MediaAttachment, Message } from '../../../src/types';

jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/litert');
jest.mock('../../../src/services/activeModelService');

const mockLlm = llmService as jest.Mocked<typeof llmService>;
const mockLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockActive = activeModelService as jest.Mocked<typeof activeModelService>;

const voiceNote = (uri: string, transcript: string): MediaAttachment =>
  ({ id: `a-${uri}`, type: 'audio', uri, audioFormat: 'wav', textContent: transcript } as MediaAttachment);

type EngineCase = { engine: 'llama' | 'litert'; audioCapable: boolean; label: string };
const ENGINE_CASES: EngineCase[] = [
  { engine: 'llama', audioCapable: false, label: 'llama (GGUF)' },
  { engine: 'litert', audioCapable: false, label: 'litert, NON-audio model' },
  { engine: 'litert', audioCapable: true, label: 'litert, audio-capable model' },
];

describe.each(ENGINE_CASES)('voice note is transcript-only — engine=$label', ({ engine, audioCapable }) => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();

    mockActive.getActiveModels.mockReturnValue({
      text: { model: null, isLoaded: true, isLoading: false },
      image: { model: null, isLoaded: false, isLoading: false },
    });

    // llama boundary
    mockLlm.isModelLoaded.mockReturnValue(engine === 'llama');
    mockLlm.getGpuInfo.mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0, reasonNoGPU: '' } as any);
    mockLlm.getPerformanceStats.mockReturnValue({
      lastTokensPerSecond: 10, lastDecodeTokensPerSecond: 12, lastTimeToFirstToken: 0.3,
      lastGenerationTime: 1, lastTokenCount: 5,
    } as any);
    mockLlm.stopGeneration.mockResolvedValue();
    mockLlm.generateResponse.mockImplementation(async (_m, { onComplete } = {}) => {
      onComplete?.({ content: 'ok', reasoningContent: '' });
      return 'ok';
    });

    // litert boundary
    mockLiteRT.isModelLoaded.mockReturnValue(engine === 'litert');
    mockLiteRT.stopGeneration.mockResolvedValue();
    mockLiteRT.prepareConversation.mockResolvedValue(undefined as never);
    mockLiteRT.sendMessage.mockImplementation(async (_text, handlers) => {
      handlers.onComplete?.('ok', '', undefined as never);
    });

    const model = createDownloadedModel({ id: 'text-1', engine, liteRTAudio: audioCapable });
    useAppStore.setState({ downloadedModels: [model], activeModelId: 'text-1' });
  });

  it('sends the TRANSCRIPT and never the audio as model input (no throw for non-audio models)', async () => {
    const attachment = voiceNote('/stale/container/abc/Documents/vn.wav', 'what is the capital of France');
    const userMsg: Message = createMessage({
      role: 'user',
      content: 'what is the capital of France', // the transcript lives in content
      attachments: [attachment],
    });
    const conversationId = setupWithConversation({ messages: [] });

    // Must NOT throw (the non-audio litert model used to reject the voice note outright).
    await expect(
      generationService.generateResponse(conversationId, [userMsg]),
    ).resolves.not.toThrow();
    await flushPromises();

    if (engine === 'litert') {
      // Terminal artifact: the LiteRT engine received the transcript text and ZERO audio uris.
      expect(mockLiteRT.sendMessage).toHaveBeenCalled();
      const [text, , media] = mockLiteRT.sendMessage.mock.calls[0];
      expect(text).toBe('what is the capital of France');
      expect((media as { audioUris?: string[] })?.audioUris ?? []).toEqual([]);
    } else {
      // llama: the message list reaches the engine (audio-media stripping is unit-tested in
      // llmMessages); the point here is the turn COMPLETES without a media-load failure.
      expect(mockLlm.generateResponse).toHaveBeenCalled();
    }
    // The turn finalized (no clearStreamingMessage-and-bail from an audio rejection).
    expect(generationService.getState().isGenerating).toBe(false);
  });
});
