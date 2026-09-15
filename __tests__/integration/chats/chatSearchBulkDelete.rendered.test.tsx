/**
 * The real chat store hydrates two conversations from the native persistence boundary.
 * The user searches, selects the visible chats, and confirms one bulk delete through the real UI.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('Chats list search and bulk delete', () => {
  it('finds chat content and deletes the selected chats together', async () => {
    installNativeBoundary({ fs: true });
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem(
      'local-llm-chat-storage',
      JSON.stringify({
        state: {
          conversations: [
            {
              id: 'aurora-chat',
              title: 'Launch notes',
              modelId: 'local-model',
              messages: [
                {
                  id: 'aurora-message',
                  role: 'user',
                  content: 'Plan the aurora launch',
                  timestamp: Date.parse('2026-09-15T10:00:00.000Z'),
                },
              ],
              createdAt: '2026-09-15T10:00:00.000Z',
              updatedAt: '2026-09-15T10:00:00.000Z',
            },
            {
              id: 'cedar-chat',
              title: 'Budget notes',
              modelId: 'local-model',
              messages: [
                {
                  id: 'cedar-message',
                  role: 'user',
                  content: 'Review the cedar budget',
                  timestamp: Date.parse('2026-09-15T09:00:00.000Z'),
                },
              ],
              createdAt: '2026-09-15T09:00:00.000Z',
              updatedAt: '2026-09-15T09:00:00.000Z',
            },
          ],
          activeConversationId: null,
        },
        version: 2,
      }),
    );

    const React = require('react');
    const rtl = requireRTL();
    const { useChatStore } = require('../../../src/stores/chatStore');
    await useChatStore.persist.rehydrate();
    const { ChatsListScreen } = require('../../../src/screens/ChatsListScreen');
    const chats = rtl.render(React.createElement(ChatsListScreen));

    rtl.fireEvent.changeText(chats.getByTestId('chat-search-input'), 'aurora');
    expect(chats.getByText('Launch notes')).toBeTruthy();
    expect(chats.queryByText('Budget notes')).toBeNull();

    rtl.fireEvent.press(chats.getByLabelText('Clear chat search'));
    rtl.fireEvent.press(chats.getByText('Select'));
    rtl.fireEvent.press(chats.getByText('Select all'));
    expect(chats.getByText('2 selected')).toBeTruthy();

    rtl.fireEvent.press(chats.getByText('Delete'));
    expect(chats.getByText('Delete Chats')).toBeTruthy();
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 350)));
    const deleteButtons = chats.getAllByText('Delete');
    rtl.fireEvent.press(deleteButtons[deleteButtons.length - 1]!);

    await rtl.waitFor(() =>
      expect(chats.getByText('No Chats Yet')).toBeTruthy(),
    );
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 250)));
  });
});
