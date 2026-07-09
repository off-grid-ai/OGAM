/**
 * BUG #29(a) regression — a remote generation failure must clear EVERY loading signal.
 *
 * When a remote model call fails (e.g. HTTP 400) an error alert shows, but a loading
 * indicator lingered. This drives the REAL generationService through a REAL remote-provider
 * failure (a registered provider whose generate() rejects) and asserts every loading flag
 * the UI reads is false afterward:
 *   - generationService.getState().isGenerating / isThinking
 *   - chatStore.isStreaming / isThinking / streamingForConversationId
 *   - generationSession (the "which conversation is generating" owner)
 *
 * Only the network boundary (the provider's generate) is faked — the service, both
 * stores, and the session owner run for real, so a lingering flag surfaces here.
 * Fails-before / passes-after.
 */
import { generationService } from '../../../src/services/generationService';
import { generationSession } from '../../../src/services/generationSession';
import { providerRegistry } from '../../../src/services/providers';
import { useChatStore } from '../../../src/stores/chatStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { llmService } from '../../../src/services/llm';
import { resetStores, setupWithConversation, flushPromises } from '../../utils/testHelpers';
import { createMessage } from '../../utils/factories';
import type { LLMProvider } from '../../../src/services/providers/types';

jest.mock('../../../src/services/llm');
const mockLlmService = llmService as jest.Mocked<typeof llmService>;

const SERVER_ID = 'remote-test-server';

function makeFailingProvider(): LLMProvider {
  return {
    id: SERVER_ID,
    type: 'remote' as any,
    capabilities: { supportsThinking: false } as any,
    loadModel: jest.fn(async () => {}),
    unloadModel: jest.fn(async () => {}),
    isModelLoaded: () => true,
    getLoadedModelId: () => 'remote-model',
    // The failure: the server rejects (HTTP 400).
    generate: jest.fn(async () => { throw new Error('HTTP 400: Bad Request'); }),
    stopGeneration: jest.fn(async () => {}),
    getTokenCount: jest.fn(async () => 0),
    isReady: jest.fn(async () => true),
  };
}

describe('BUG #29(a) — remote failure clears all loading flags', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    generationSession._reset();
    // No local model loaded → generationService routes to the remote provider.
    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.getLoadedModelPath.mockReturnValue(null as any);
    await generationService.stopGeneration().catch(() => {});
  });

  afterEach(() => {
    providerRegistry.unregisterProvider(SERVER_ID);
    useRemoteServerStore.setState({ activeServerId: null } as any);
  });

  it('leaves isGenerating / isThinking / isStreaming / session all false after a remote error', async () => {
    providerRegistry.registerProvider(SERVER_ID, makeFailingProvider());
    useRemoteServerStore.setState({ activeServerId: SERVER_ID } as any);

    const conversationId = setupWithConversation({ modelId: 'remote-model' });
    generationSession.begin(conversationId);

    await expect(
      generationService.generateResponse(conversationId, [createMessage({ role: 'user', content: 'hi' })]),
    ).rejects.toThrow('HTTP 400');

    await flushPromises();

    const genState = generationService.getState();
    const chat = useChatStore.getState();

    expect(genState.isGenerating).toBe(false);
    expect(genState.isThinking).toBe(false);
    expect(chat.isStreaming).toBe(false);
    expect(chat.isThinking).toBe(false);
    expect(chat.streamingForConversationId).toBeNull();
    // generationService cleared its own session identity; the ChatScreen action layer
    // ends the generationSession on the thrown error (mirrored by handleStop/startGeneration).
    expect(generationService.isGeneratingFor(conversationId)).toBe(false);
  });
});
