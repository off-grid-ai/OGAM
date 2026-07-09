/**
 * Batch 2 hardening — Core Chat / Text Generation (retry path)
 *
 * Drives the REAL handleRetryMessageFn (src/screens/ChatScreen/useChatMessageHandlers.ts)
 * against the REAL chatStore. Boundaries mocked:
 *   - modelResidency / hardware        (native memory diagnostics)
 *   - regenerateResponseFn             (kicks off the native LLM decode — spied, like the
 *                                       existing no-model test does)
 *   - hookRegistry.callHook            (audio-stop hook; pro side-effect boundary)
 *
 * The REAL, asserted behavior is the retry ORCHESTRATION in handleRetryMessageFn:
 *   16/17 — retry on a completed ASSISTANT message finds the preceding USER message,
 *           trims everything after it, and regenerates for that user prompt.
 *   17    — retry on a USER message trims trailing messages and regenerates.
 *   19    — retry is NOT locked out after a previous (stopped) retry: a second retry
 *           regenerates again.
 *   20    — retry with no model loaded alerts and does not regenerate (guard).
 *
 * Deleting the prev-user lookup or the deleteMessagesAfter call in handleRetryMessageFn
 * would fail these tests.
 */

jest.mock('../../src/services/modelResidency', () => ({
  modelResidencyManager: { getResidents: jest.fn(() => []), reclaimSttForGeneration: jest.fn() },
}));
jest.mock('../../src/services/hardware', () => ({
  hardwareService: { getAvailableMemoryGB: jest.fn(() => 4), getTotalMemoryGB: jest.fn(() => 8) },
}));
jest.mock('../../src/bootstrap/hookRegistry', () => ({
  HOOKS: { audioStop: 'audio.stop' },
  callHook: jest.fn(),
}));

import { handleRetryMessageFn } from '../../src/screens/ChatScreen/useChatMessageHandlers';
import * as generationActions from '../../src/screens/ChatScreen/useChatGenerationActions';
import { useChatStore } from '../../src/stores/chatStore';
import { resetStores } from '../utils/testHelpers';

const makeGenDeps = (overrides: Partial<any> = {}): any => ({
  setAlertState: jest.fn(),
  ...overrides,
});

describe('batch2 handleRetryMessageFn — retry orchestration', () => {
  let regenSpy: jest.SpyInstance;

  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    regenSpy = jest.spyOn(generationActions, 'regenerateResponseFn').mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  // Cases 16/17: retry a COMPLETED assistant message -> regenerate for the prior user.
  it('case16/17: retrying a completed assistant message trims after the prior user msg and regenerates', async () => {
    const store = useChatStore.getState();
    const convId = store.createConversation('m1');
    const userMsg = store.addMessage(convId, { role: 'user', content: 'say hi' } as any);
    const assistantMsg = store.addMessage(convId, { role: 'assistant', content: 'Hi there!' } as any);

    const deleteMessagesAfter = jest.fn((c: string, m: string) =>
      useChatStore.getState().deleteMessagesAfter(c, m),
    );

    await handleRetryMessageFn(
      assistantMsg,
      makeGenDeps({ activeConversationId: convId }),
      {
        activeConversationId: convId,
        hasActiveModel: true,
        activeConversation: useChatStore.getState().conversations.find(c => c.id === convId),
        deleteMessagesAfter,
        setDebugInfo: jest.fn(),
      },
    );

    // trimmed everything after the prior USER message (the assistant reply is removed)
    expect(deleteMessagesAfter).toHaveBeenCalledWith(convId, userMsg.id);
    const conv = useChatStore.getState().conversations.find(c => c.id === convId)!;
    expect(conv.messages.map(m => m.id)).toEqual([userMsg.id]);
    // regenerated for the prior user prompt
    expect(regenSpy).toHaveBeenCalledTimes(1);
    expect(regenSpy.mock.calls[0][1]).toMatchObject({ userMessage: expect.objectContaining({ id: userMsg.id }) });
  });

  // Case 17: retry a USER message directly -> trims trailing, regenerates for it.
  it('case17: retrying a user message trims messages after it and regenerates for it', async () => {
    const store = useChatStore.getState();
    const convId = store.createConversation('m1');
    const userMsg = store.addMessage(convId, { role: 'user', content: 'first' } as any);
    store.addMessage(convId, { role: 'assistant', content: 'reply' } as any);

    const deleteMessagesAfter = jest.fn((c: string, m: string) =>
      useChatStore.getState().deleteMessagesAfter(c, m),
    );

    await handleRetryMessageFn(
      userMsg,
      makeGenDeps({ activeConversationId: convId }),
      {
        activeConversationId: convId,
        hasActiveModel: true,
        activeConversation: useChatStore.getState().conversations.find(c => c.id === convId),
        deleteMessagesAfter,
        setDebugInfo: jest.fn(),
      },
    );

    expect(deleteMessagesAfter).toHaveBeenCalledWith(convId, userMsg.id);
    expect(regenSpy).toHaveBeenCalledTimes(1);
    expect(regenSpy.mock.calls[0][1]).toMatchObject({ userMessage: expect.objectContaining({ id: userMsg.id }) });
  });

  // Case 19: after a first retry (e.g. one that was stopped), a SECOND retry is not
  // locked out — it regenerates again.
  it('case19: a second retry after a previous one is not locked out — regenerates again', async () => {
    const store = useChatStore.getState();
    const convId = store.createConversation('m1');
    const userMsg = store.addMessage(convId, { role: 'user', content: 'go' } as any);
    const assistantMsg = store.addMessage(convId, { role: 'assistant', content: 'partial…' } as any);

    const params = () => ({
      activeConversationId: convId,
      hasActiveModel: true,
      activeConversation: useChatStore.getState().conversations.find(c => c.id === convId),
      deleteMessagesAfter: (c: string, m: string) => useChatStore.getState().deleteMessagesAfter(c, m),
      setDebugInfo: jest.fn(),
    });

    await handleRetryMessageFn(assistantMsg, makeGenDeps({ activeConversationId: convId }), params());
    // second retry on the (now sole) user message
    await handleRetryMessageFn(userMsg, makeGenDeps({ activeConversationId: convId }), params());

    expect(regenSpy).toHaveBeenCalledTimes(2);
  });

  // Case 20 guard: no model loaded -> alert, no regeneration.
  it('case20: retry with no active model alerts and does not regenerate', async () => {
    const store = useChatStore.getState();
    const convId = store.createConversation('m1');
    const userMsg = store.addMessage(convId, { role: 'user', content: 'x' } as any);
    const genDeps = makeGenDeps({ activeConversationId: convId });

    await handleRetryMessageFn(userMsg, genDeps, {
      activeConversationId: convId,
      hasActiveModel: false,
      activeConversation: useChatStore.getState().conversations.find(c => c.id === convId),
      deleteMessagesAfter: jest.fn(),
      setDebugInfo: jest.fn(),
    });

    expect(genDeps.setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No Model Selected' }),
    );
    expect(regenSpy).not.toHaveBeenCalled();
  });
});
