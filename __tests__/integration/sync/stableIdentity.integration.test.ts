import AsyncStorage from '@react-native-async-storage/async-storage';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadStores() {
  jest.resetModules();
  const stores =
    require('../../../src/stores') as typeof import('../../../src/stores');
  await stores.useChatStore.persist.rehydrate();
  await stores.useProjectStore.persist.rehydrate();
  return stores;
}

describe('sync identity persistence', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('backfills a legacy message once and creates UUID identities that survive relaunch', async () => {
    await AsyncStorage.setItem(
      'local-llm-chat-storage',
      JSON.stringify({
        state: {
          conversations: [
            {
              id: 'legacy-conversation',
              title: 'Before Sync',
              modelId: 'legacy-model',
              messages: [
                {
                  id: 'legacy-message',
                  role: 'user',
                  content: 'Keep this identity stable',
                  timestamp: 1,
                },
              ],
              createdAt: '2026-07-01T00:00:00.000Z',
              updatedAt: '2026-07-01T00:00:00.000Z',
            },
          ],
          activeConversationId: 'legacy-conversation',
        },
        version: 0,
      }),
    );

    const firstLaunch = await loadStores();
    const legacyConversation =
      firstLaunch.useChatStore.getState().conversations[0];
    const backfilledUuid = legacyConversation.messages[0].uuid;

    expect(legacyConversation.id).toBe('legacy-conversation');
    expect(legacyConversation.messages[0].id).toBe('legacy-message');
    expect(backfilledUuid).toMatch(UUID_V4);

    const conversationId = firstLaunch.useChatStore
      .getState()
      .createConversation('sync-model');
    const message = firstLaunch.useChatStore
      .getState()
      .addMessage(conversationId, {
        role: 'user',
        content: 'Created after the migration',
      });
    const project = firstLaunch.useProjectStore.getState().createProject({
      name: 'Synced project',
      description: '',
      systemPrompt: '',
    });

    expect(conversationId).toMatch(UUID_V4);
    expect(project.id).toMatch(UUID_V4);
    expect(message.id).toMatch(UUID_V4);
    expect(message.uuid).toBe(message.id);

    // A relaunch reads what was written: the store saves one snapshot at a time, so wait for the last.
    await require('../../../src/stores/chatStore').waitForChatPersistence();
    const secondLaunch = await loadStores();
    const restoredLegacy = secondLaunch.useChatStore
      .getState()
      .conversations.find(
        (conversation: { id: string }) =>
          conversation.id === 'legacy-conversation',
      );
    const restoredNew = secondLaunch.useChatStore
      .getState()
      .conversations.find(
        (conversation: { id: string }) => conversation.id === conversationId,
      );

    expect(restoredLegacy?.messages[0].uuid).toBe(backfilledUuid);
    expect(restoredNew?.messages[0].uuid).toBe(message.uuid);
    expect(
      secondLaunch.useProjectStore
        .getState()
        .projects.some(candidate => candidate.id === project.id),
    ).toBe(true);
  });
});
