/**
 * JOURNEY: pick a project on a NEW chat → send → the conversation is created WITH that
 * project → it persists across relaunch. Plus the Q11 edge: "New chat" from the context-full
 * alert drops the project.
 *
 * Cluster C (projects + settings in-flow). Crosses:
 *   ChatScreen pendingProjectId (presentation) → handleSendFn creates the conversation with it
 *   (useChatGenerationActions.ts:461 → createConversation(modelId, undefined, pendingProjectId))
 *   → chatStore.createConversation persists projectId (chatStore.ts:119) → persist middleware.
 *
 * We assert the TERMINAL artifact: the persisted conversation row's projectId, and that it
 * survives a store snapshot round-trip (relaunch). Then we assert the Q11 regression: the
 * context-full "New chat" path (createConversation(modelId) with no project) yields an
 * UNASSIGNED chat — the documented drop.
 */
import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';
import { resetStores } from '../../utils/testHelpers';

describe('JOURNEY: project picked on a new chat persists', () => {
  beforeEach(() => {
    resetStores();
  });

  it('a new chat created with a pendingProjectId carries the project (Q10 terminal artifact)', () => {
    // Seed a project the user picked before the first message.
    useProjectStore.setState({
      projects: [{ id: 'proj-1', name: 'Work', createdAt: Date.now(), updatedAt: Date.now() } as any],
    });
    const pendingProjectId = 'proj-1';

    // The send path: createConversation(modelId, undefined, pendingProjectId).
    const convId = useChatStore.getState().createConversation('model-1', undefined, pendingProjectId);

    const conv = useChatStore.getState().conversations.find(c => c.id === convId);
    expect(conv?.projectId).toBe('proj-1'); // TERMINAL: the project is on the persisted row
  });

  it('the project survives a relaunch (persist round-trip via the persisted slice)', () => {
    const convId = useChatStore.getState().createConversation('model-1', undefined, 'proj-1');

    // Simulate what the persist middleware writes + rehydrates: only conversations +
    // activeConversationId are persisted (partialize). Round-trip through JSON.
    const persisted = JSON.stringify({
      conversations: useChatStore.getState().conversations,
      activeConversationId: useChatStore.getState().activeConversationId,
    });
    resetStores(); // wipe (fresh launch)
    const rehydrated = JSON.parse(persisted);
    useChatStore.setState({
      conversations: rehydrated.conversations,
      activeConversationId: rehydrated.activeConversationId,
    });

    const conv = useChatStore.getState().conversations.find(c => c.id === convId);
    expect(conv?.projectId).toBe('proj-1'); // TERMINAL: still assigned after relaunch
  });

  it('Q11 REGRESSION: "New chat" from the context-full alert drops the project (unassigned)', () => {
    // The context-full alert's "New chat" button calls createConversation(modelId) with no
    // projectId (useChatGenerationActions.ts:382 / :553), even inside a project chat.
    const projectChatId = useChatStore.getState().createConversation('model-1', undefined, 'proj-1');
    expect(useChatStore.getState().conversations.find(c => c.id === projectChatId)?.projectId).toBe('proj-1');

    // Now the context filled up and the user tapped "New chat":
    const newChatId = useChatStore.getState().createConversation('model-1');

    const newChat = useChatStore.getState().conversations.find(c => c.id === newChatId);
    // Documented drop (Q11): the new chat is NOT in the project. Pinned so a fix that carries
    // the project forward flips this to 'proj-1' and forces the ledger updated.
    expect(newChat?.projectId).toBeUndefined();
  });
});
