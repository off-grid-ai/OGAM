/**
 * ADVERSARIAL intersection matrix: CHAT SEND across engine × input modality.
 *
 * Axes exercised here:
 *   engine   = { llama (GGUF), litert (LiteRT), remote (gateway) }
 *   modality = { typed text, image attachment }
 *   flow     = plain chat
 *
 * We drive the REAL generationService + REAL chatStore and assert the TERMINAL
 * artifact the user sees — the finalized assistant message content in the chat
 * store — and, for the image-attachment modality, the EXACT input the engine
 * received (llama gets the message array with attachments; litert gets the
 * image URIs threaded through sendMessage). Asserting only "was called" would
 * pass over a caller that finalizes the wrong content, so every case asserts
 * the store outcome.
 *
 * These sit alongside generationFlow.test.ts (llama-only) — the point of this
 * file is that the engine axis is NEVER left at its llama default: litert and
 * remote are where the wiring bugs hide.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { useRemoteServerStore } from '../../../src/stores';
import { generationService } from '../../../src/services/generationService';
import { llmService } from '../../../src/services/llm';
import { liteRTService } from '../../../src/services/litert';
import { providerRegistry } from '../../../src/services/providers';
import type { LLMProvider } from '../../../src/services/providers/types';
import {
  resetStores,
  resetRemoteServerStore,
  setupWithActiveModel,
  setupWithConversation,
  flushPromises,
  getChatState,
} from '../../utils/testHelpers';
import { createMessage } from '../../utils/factories';

jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/litert');

const mockLlmService = llmService as jest.Mocked<typeof llmService>;
const mockLiteRTService = liteRTService as jest.Mocked<typeof liteRTService>;

type Engine = 'llama' | 'litert' | 'remote';

const REMOTE_SERVER_ID = 'remote-server-1';

/**
 * Configure the active TEXT engine so getActiveEngineService() /
 * isUsingRemoteProvider() dispatch to the intended path. This is the seam under
 * test — a bug that ignores the active engine shows up as the wrong dispatch.
 */
function setupActiveTextModel(engine: Engine): string {
  if (engine === 'remote') {
    // Remote: NO local model loaded, an active remote server, a registered provider.
    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLiteRTService.isModelLoaded.mockReturnValue(false);
    const conversationId = setupWithConversation();
    useAppStore.setState({ downloadedModels: [], activeModelId: null });
    return conversationId;
  }
  const modelId = setupWithActiveModel({
    engine,
    id: `${engine}-model`,
    name: `${engine} model`,
    filePath: engine === 'litert' ? '/mock/model.litertlm' : '/mock/model.gguf',
  });
  if (engine === 'litert') {
    // liteRTVision is not a createDownloadedModel field — set it on the stored model
    // directly so assertLiteRTImageSupport sees the vision capability.
    useAppStore.setState({
      downloadedModels: useAppStore.getState().downloadedModels.map(m =>
        m.id === modelId ? ({ ...m, liteRTVision: true } as any) : m,
      ),
    });
    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLiteRTService.isModelLoaded.mockReturnValue(true);
  } else {
    mockLlmService.isModelLoaded.mockReturnValue(true);
    mockLiteRTService.isModelLoaded.mockReturnValue(false);
  }
  return setupWithConversation({ modelId });
}

/** A fake remote provider that streams a fixed reply then completes. */
function installRemoteProvider(reply: string): { lastMessages: any[] } {
  const captured: { lastMessages: any[] } = { lastMessages: [] };
  const provider: Partial<LLMProvider> = {
    type: 'remote' as any,
    capabilities: { supportsThinking: false, supportsVision: true, supportsToolCalling: false } as any,
    isReady: jest.fn().mockResolvedValue(true),
    generate: jest.fn(async (messages: any[], _opts: any, cbs: any) => {
      captured.lastMessages = messages;
      cbs.onToken?.(reply);
      cbs.onComplete?.({ content: reply } as any);
    }),
  };
  providerRegistry.registerProvider(REMOTE_SERVER_ID, provider as LLMProvider);
  useRemoteServerStore.setState({
    activeServerId: REMOTE_SERVER_ID,
    servers: [{ id: REMOTE_SERVER_ID, name: 'Gateway', url: 'http://x', type: 'openai-compatible' } as any],
  } as any);
  return captured;
}

/** Drive one llama completion deterministically: stream `reply`, then complete. */
function primeLlama(reply: string): void {
  mockLlmService.generateResponse.mockImplementation(async (_messages, onStream, onComplete) => {
    onStream?.(reply as any);
    onComplete?.('' as any);
    return reply;
  });
}

/** Drive one litert completion deterministically via the callback bag. */
function primeLiteRT(reply: string): { captured: { text: string; imageUris?: string[]; audioUris?: string[] } } {
  const captured = { text: '', imageUris: undefined as string[] | undefined, audioUris: undefined as string[] | undefined };
  mockLiteRTService.prepareConversation.mockResolvedValue(undefined as any);
  mockLiteRTService.sendMessage.mockImplementation(async (text: string, cbs: any, media?: any) => {
    captured.text = text;
    captured.imageUris = media?.imageUris;
    captured.audioUris = media?.audioUris;
    cbs.onToken?.(reply);
    cbs.onComplete?.(reply, '', undefined);
  });
  return { captured };
}

describe('chatMatrix — send across engine × modality', () => {
  beforeEach(async () => {
    resetStores();
    resetRemoteServerStore();
    jest.clearAllMocks();
    providerRegistry.unregisterProvider(REMOTE_SERVER_ID);

    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.isCurrentlyGenerating.mockReturnValue(false);
    mockLlmService.stopGeneration.mockResolvedValue();
    mockLlmService.getGpuInfo.mockReturnValue({ gpu: false, gpuBackend: 'CPU', gpuLayers: 0, reasonNoGPU: '' } as any);
    mockLlmService.getPerformanceStats.mockReturnValue({
      lastTokensPerSecond: 10, lastDecodeTokensPerSecond: 8,
      lastTimeToFirstToken: 0.5, lastGenerationTime: 1, lastTokenCount: 5,
    } as any);

    mockLiteRTService.isModelLoaded.mockReturnValue(false);
    mockLiteRTService.stopGeneration.mockResolvedValue();
    mockLiteRTService.getActiveBackend.mockReturnValue('gpu' as any);
    mockLiteRTService.getLastBenchmarkStats.mockReturnValue(undefined);

    await generationService.stopGeneration().catch(() => {});
  });

  describe.each<Engine>(['llama', 'litert', 'remote'])('engine=%s', (engine) => {
    it('typed text → finalizes the assistant reply as the terminal chat message', async () => {
      const conversationId = setupActiveTextModel(engine);
      const reply = `reply-from-${engine}`;
      let remote: { lastMessages: any[] } | undefined;
      if (engine === 'llama') primeLlama(reply);
      else if (engine === 'litert') primeLiteRT(reply);
      else remote = installRemoteProvider(reply);

      const messages = [createMessage({ role: 'user', content: 'Hello there' })];
      await generationService.generateResponse(conversationId, messages);
      await flushPromises();

      // Terminal artifact: the finalized assistant message the user sees.
      const conv = getChatState().conversations.find(c => c.id === conversationId);
      expect(conv?.messages).toHaveLength(1);
      expect(conv?.messages[0].role).toBe('assistant');
      expect(conv?.messages[0].content).toBe(reply);

      if (engine === 'remote') {
        // Remote actually received the user turn (not a dropped/empty prompt).
        expect(remote!.lastMessages.some(m => m.content === 'Hello there')).toBe(true);
      }
    });

    it('image attachment → the image URI reaches the engine AND the reply finalizes', async () => {
      const conversationId = setupActiveTextModel(engine);
      const reply = `vision-${engine}`;
      let liteRTCap: { captured: { text: string; imageUris?: string[]; audioUris?: string[] } } | undefined;
      let remote: { lastMessages: any[] } | undefined;
      if (engine === 'llama') primeLlama(reply);
      else if (engine === 'litert') liteRTCap = primeLiteRT(reply);
      else remote = installRemoteProvider(reply);

      const messages = [createMessage({
        role: 'user',
        content: 'What is in this picture?',
        attachments: [{ id: 'img-1', type: 'image', uri: 'file:///pic.png' }],
      } as any)];

      await generationService.generateResponse(conversationId, messages);
      await flushPromises();

      const conv = getChatState().conversations.find(c => c.id === conversationId);
      expect(conv?.messages[0]?.content).toBe(reply);

      if (engine === 'litert') {
        // litert threads image URIs through sendMessage — the exact vision input.
        expect(liteRTCap!.captured.imageUris).toEqual(['file:///pic.png']);
      } else if (engine === 'llama') {
        // llama receives the message array carrying the attachment.
        const [passedMessages] = mockLlmService.generateResponse.mock.calls[0];
        const userMsg = (passedMessages as any[]).find(m => m.role === 'user');
        expect(userMsg.attachments?.[0]?.uri).toBe('file:///pic.png');
      } else {
        const userMsg = remote!.lastMessages.find(m => m.role === 'user');
        expect(userMsg.attachments?.[0]?.uri).toBe('file:///pic.png');
      }
    });
  });
});
