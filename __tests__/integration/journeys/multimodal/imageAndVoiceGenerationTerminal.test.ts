/**
 * MULTIMODAL TURN JOURNEY (cluster B): non-tool generation with an image attachment vs a voice note,
 * driven through the REAL generationService + REAL stores (only the litert native boundary mocked).
 *
 * Attacks the input-modality → model-input seam (modelMedia is the single source of truth):
 *   - an image attachment reaches a VISION LiteRT model as an image uri (images ARE model input);
 *   - the SAME image on a NON-vision LiteRT model is rejected with the friendly "does not support
 *     images" message (not a raw native crash), and the turn does not leave a blank streaming state;
 *   - a voice note (transcript in message.content) sends the TRANSCRIPT and ZERO audio uris, and the
 *     turn finalizes to the model's answer as the stored assistant message (terminal artifact).
 */
import { useAppStore } from '../../../../src/stores/appStore';
import { useChatStore } from '../../../../src/stores/chatStore';
import { generationService } from '../../../../src/services/generationService';
import { llmService } from '../../../../src/services/llm';
import { liteRTService } from '../../../../src/services/litert';
import { resetStores, setupWithConversation, flushPromises } from '../../../utils/testHelpers';
import { createDownloadedModel, createMessage } from '../../../utils/factories';
import type { MediaAttachment, Message } from '../../../../src/types';

jest.mock('../../../../src/services/llm');
jest.mock('../../../../src/services/litert');

const mockLlm = llmService as jest.Mocked<typeof llmService>;
const mockLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;

const image = (uri: string): MediaAttachment => ({ id: `i-${uri}`, type: 'image', uri } as MediaAttachment);
const voiceNote = (uri: string, transcript: string): MediaAttachment =>
  ({ id: `a-${uri}`, type: 'audio', uri, audioFormat: 'wav', textContent: transcript } as MediaAttachment);

function setupLiteRT(opts: { vision?: boolean; audio?: boolean } = {}) {
  resetStores();
  jest.clearAllMocks();
  mockLlm.isModelLoaded.mockReturnValue(false);
  mockLlm.stopGeneration.mockResolvedValue();
  mockLiteRT.isModelLoaded.mockReturnValue(true);
  mockLiteRT.stopGeneration.mockResolvedValue();
  mockLiteRT.getActiveBackend?.mockReturnValue?.('cpu' as never);
  mockLiteRT.getLastBenchmarkStats?.mockReturnValue?.(undefined as never);
  mockLiteRT.prepareConversation.mockResolvedValue(undefined as never);
  mockLiteRT.sendMessage.mockImplementation(async (_text, handlers) => {
    handlers.onToken?.('It is a dog.');
    handlers.onComplete?.('It is a dog.', '', undefined as never);
  });
  const model = createDownloadedModel({
    id: 'litert-1', engine: 'litert', liteRTVision: !!opts.vision, liteRTAudio: !!opts.audio,
  });
  useAppStore.setState({ downloadedModels: [model], activeModelId: 'litert-1' });
}

describe('image / voice non-tool generation — terminal artifact', () => {
  it('image on a VISION model → image uri reaches the engine, answer is stored', async () => {
    setupLiteRT({ vision: true });
    const userMsg: Message = createMessage({ role: 'user', content: 'what is this?', attachments: [image('file:///photo.png')] });
    const conversationId = setupWithConversation({ messages: [] });

    await generationService.generateResponse(conversationId, [userMsg]);
    await flushPromises();

    expect(mockLiteRT.sendMessage).toHaveBeenCalled();
    const [, , media] = mockLiteRT.sendMessage.mock.calls[0];
    expect((media as { imageUris?: string[] })?.imageUris).toEqual(['file:///photo.png']);

    const conv = useChatStore.getState().conversations.find(c => c.id === conversationId);
    expect(conv?.messages.find(m => m.role === 'assistant')?.content).toBe('It is a dog.');
  });

  it('image on a NON-vision model → friendly rejection, no native send, clean state', async () => {
    setupLiteRT({ vision: false });
    const userMsg: Message = createMessage({ role: 'user', content: 'what is this?', attachments: [image('file:///photo.png')] });
    const conversationId = setupWithConversation({ messages: [] });

    await expect(generationService.generateResponse(conversationId, [userMsg]))
      .rejects.toThrow(/does not support images/i);

    // Terminal artifact: the model was NEVER handed the image, and the turn ended cleanly.
    expect(mockLiteRT.sendMessage).not.toHaveBeenCalled();
    expect(generationService.getState().isGenerating).toBe(false);
    const conv = useChatStore.getState().conversations.find(c => c.id === conversationId);
    expect(conv?.messages.some(m => m.role === 'assistant')).toBe(false);
  });

  it('voice note (transcript in content) → transcript text sent, ZERO audio, answer stored', async () => {
    setupLiteRT({ audio: true }); // even an audio-capable model must NOT get the stale voice note
    const userMsg: Message = createMessage({
      role: 'user', content: 'what animal is this',
      attachments: [voiceNote('/stale/container/vn.wav', 'what animal is this')],
    });
    const conversationId = setupWithConversation({ messages: [] });

    await generationService.generateResponse(conversationId, [userMsg]);
    await flushPromises();

    const [text, , media] = mockLiteRT.sendMessage.mock.calls[0];
    expect(text).toBe('what animal is this');
    expect((media as { audioUris?: string[] })?.audioUris ?? []).toEqual([]);
    const conv = useChatStore.getState().conversations.find(c => c.id === conversationId);
    expect(conv?.messages.find(m => m.role === 'assistant')?.content).toBe('It is a dog.');
  });
});
