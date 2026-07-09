/**
 * Batch 2 hardening — Core Chat / Text Generation (send path)
 *
 * Drives the REAL handleSendFn (src/screens/ChatScreen/useChatGenerationActions.ts)
 * against the REAL chatStore and the REAL generationService queue. The only mocked
 * things are genuine boundaries:
 *   - modelPreloader.abortPreload        (background native warm-up)
 *   - modelResidency.reclaimSttForGeneration (native memory reclaim)
 *   - the `startGeneration` callback passed IN by the caller (this is where the native
 *     LLM decode happens — it is a parameter, so stubbing it is a boundary, not the
 *     thing under test).
 *
 * Cases covered:
 *   5  — submitting with no active conversation creates a NEW chat + sets it active,
 *        and the user message lands in that new conversation.
 *   10 — a very long (600+ char) message is stored intact and generation begins.
 *   14 — sending a new message while a generation is in flight enqueues it (interrupt/
 *        serialize) instead of starting a second concurrent generation.
 *   35 — the "new chat" entry point (Home spotlight / New button navigates to Chat with
 *        no conversationId, which resets active to null) ALWAYS produces a brand-new
 *        conversation, never reusing the most-recently-viewed one.
 *
 * Deleting the create-new-conversation branch, the enqueue branch, or the addMessage
 * call in handleSendFn would fail these tests.
 */

// --- boundary mocks (native / background side-effects only) -----------------
jest.mock('../../src/services/modelPreloader', () => ({
  abortPreload: jest.fn(),
}));
jest.mock('../../src/services/modelResidency', () => ({
  modelResidencyManager: {
    reclaimSttForGeneration: jest.fn(() => Promise.resolve()),
    getResidents: jest.fn(() => []),
  },
}));

import { handleSendFn, GenerationDeps } from '../../src/screens/ChatScreen/useChatGenerationActions';
import { generationService } from '../../src/services/generationService';
import { useChatStore } from '../../src/stores/chatStore';
import { resetStores, getChatState } from '../utils/testHelpers';

// Build a deps object wired to the REAL chatStore actions. Only startGeneration is a stub.
function makeSendDeps(startGeneration: jest.Mock, overrides: Partial<GenerationDeps> = {}): GenerationDeps {
  const store = useChatStore.getState();
  return {
    activeModelId: 'text-model-1',
    activeModel: { id: 'text-model-1', engine: 'llama' } as any,
    activeModelInfo: { isRemote: false, model: null, modelId: 'text-model-1', modelName: 'Test LLM' },
    hasActiveModel: true,
    hasTextModel: true,
    supportsToolCalling: false,
    activeConversationId: getChatState().activeConversationId,
    activeConversation: null,
    activeProject: null,
    activeImageModel: null, // no image model -> text route only
    imageModelLoaded: false,
    isStreaming: false,
    isGeneratingImage: false,
    imageGenState: { isGenerating: false } as any,
    settings: {
      showGenerationDetails: false,
      imageGenerationMode: 'auto',
      autoDetectMethod: 'pattern',
    },
    downloadedModels: [],
    setAlertState: jest.fn(),
    setIsClassifying: jest.fn(),
    setAppImageGenerationStatus: jest.fn(),
    setAppIsGeneratingImage: jest.fn(),
    // REAL store actions:
    addMessage: (convId, msg) => store.addMessage(convId, msg),
    clearStreamingMessage: () => store.clearStreamingMessage(),
    deleteConversation: (convId) => store.deleteConversation(convId),
    setActiveConversation: (convId) => store.setActiveConversation(convId),
    removeImagesByConversationId: () => [],
    navigation: { navigate: jest.fn(), goBack: jest.fn() },
    ensureModelLoaded: jest.fn(() => Promise.resolve('ready' as any)),
    ensureTextModelForChat: jest.fn(() => Promise.resolve(true)),
    createConversation: (modelId, title, projectId) => store.createConversation(modelId, title, projectId),
    ...overrides,
  } as GenerationDeps;
}

describe('batch2 handleSendFn — new chat, long message, interrupt/queue', () => {
  beforeEach(async () => {
    resetStores();
    // clear any leftover generation state / queue between tests
    await generationService.stopGeneration().catch(() => {});
    generationService.clearQueue();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // Case 5 / 35: no active conversation -> a NEW conversation is created + set active.
  it('case5: creates a new conversation and sets it active when none exists', async () => {
    expect(getChatState().conversations).toHaveLength(0);
    expect(getChatState().activeConversationId).toBeNull();

    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeSendDeps(startGeneration, { activeConversationId: null });

    await handleSendFn(deps, {
      text: 'What is the capital of France?',
      imageMode: 'disabled', // force pure text route, no image classifier
      startGeneration,
      setDebugInfo: jest.fn(),
    });

    const state = getChatState();
    expect(state.conversations).toHaveLength(1);
    const conv = state.conversations[0];
    // the new conversation is the active one
    expect(state.activeConversationId).toBe(conv.id);
    // the user message landed in the new conversation
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0]).toMatchObject({ role: 'user', content: 'What is the capital of France?' });
    // generation was kicked off for the new conversation
    expect(startGeneration).toHaveBeenCalledTimes(1);
    expect((startGeneration.mock.calls[0] as any[])[0]).toBe(conv.id);
  });

  // Case 35: even when a prior conversation is the most-recently-viewed one, the
  // "new chat" entry resets active to null first, so a brand-new conversation is
  // created rather than appending to the old one.
  it('case35: with active reset to null (new-chat entry), a brand-new conversation is created — not the recent one', async () => {
    // Simulate a previously-viewed conversation.
    const oldId = useChatStore.getState().createConversation('text-model-1');
    useChatStore.getState().addMessage(oldId, { role: 'user', content: 'earlier chat' } as any);
    // "New chat" navigation resets active to null (ChatScreen mount with empty params).
    useChatStore.getState().setActiveConversation(null);

    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeSendDeps(startGeneration, { activeConversationId: null });

    await handleSendFn(deps, {
      text: 'Explain quantum entanglement',
      imageMode: 'disabled',
      startGeneration,
      setDebugInfo: jest.fn(),
    });

    const state = getChatState();
    // a second, distinct conversation now exists
    expect(state.conversations).toHaveLength(2);
    expect(state.activeConversationId).not.toBe(oldId);
    const newConv = state.conversations.find(c => c.id === state.activeConversationId)!;
    // the new conversation contains ONLY the new message — none of the old chat's
    expect(newConv.messages).toHaveLength(1);
    expect(newConv.messages[0].content).toBe('Explain quantum entanglement');
    // the old conversation is untouched
    const oldConv = state.conversations.find(c => c.id === oldId)!;
    expect(oldConv.messages).toHaveLength(1);
    expect(oldConv.messages[0].content).toBe('earlier chat');
  });

  // Case 10: a 600+ character message is stored intact and generation starts.
  it('case10: a very long (600+ char) message is stored intact and generation begins', async () => {
    const longText = 'the quick brown fox jumps over the lazy dog. '.repeat(20); // ~900 chars
    expect(longText.length).toBeGreaterThan(600);

    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeSendDeps(startGeneration, { activeConversationId: null });

    await handleSendFn(deps, {
      text: longText,
      imageMode: 'disabled',
      startGeneration,
      setDebugInfo: jest.fn(),
    });

    const conv = getChatState().conversations[0];
    expect(conv.messages[0].content).toBe(longText); // stored verbatim, not truncated
    expect(startGeneration).toHaveBeenCalledTimes(1);
  });

  // Case 14: sending mid-generation enqueues the new message instead of launching a
  // second concurrent generation. getState() is a query boundary we control to place
  // the service in the "already generating" state; enqueueMessage runs for real.
  it('case14: enqueues the new message (does not start a 2nd generation) while one is in flight', async () => {
    const convId = useChatStore.getState().createConversation('text-model-1');

    // Put the real service in the generating state (query boundary).
    jest.spyOn(generationService, 'getState').mockReturnValue({
      isGenerating: true,
      isThinking: false,
      conversationId: convId,
      streamingContent: 'a long story about a pirate',
      startTime: Date.now(),
      queuedMessages: [],
    });
    const enqueueSpy = jest.spyOn(generationService, 'enqueueMessage');

    const startGeneration = jest.fn(() => Promise.resolve());
    const deps = makeSendDeps(startGeneration, { activeConversationId: convId });

    await handleSendFn(deps, {
      text: 'Actually, just say hi.',
      imageMode: 'disabled',
      startGeneration,
      setDebugInfo: jest.fn(),
    });

    // The new message was queued for serialized handling...
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0][0]).toMatchObject({
      conversationId: convId,
      text: 'Actually, just say hi.',
    });
    // ...and NO second generation was dispatched (startGeneration untouched).
    expect(startGeneration).not.toHaveBeenCalled();
  });

  // Case 9-adjacent guard: send with no active model alerts and does not generate.
  it('does not generate and alerts when no model is loaded', async () => {
    const startGeneration = jest.fn(() => Promise.resolve());
    const setAlertState = jest.fn();
    const deps = makeSendDeps(startGeneration, {
      activeConversationId: null,
      hasActiveModel: false,
      setAlertState,
    });

    await handleSendFn(deps, {
      text: 'hello',
      imageMode: 'disabled',
      startGeneration,
      setDebugInfo: jest.fn(),
    });

    expect(setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No Model Selected' }),
    );
    expect(getChatState().conversations).toHaveLength(0);
    expect(startGeneration).not.toHaveBeenCalled();
  });
});
