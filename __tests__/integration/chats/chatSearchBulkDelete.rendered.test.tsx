/**
 * The real chat store hydrates thirteen conversations from the native persistence boundary.
 * The user searches, selects all visible chats, and confirms one bulk delete through the real UI.
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
  it('selects and deletes only the chats in the filtered list', async () => {
    installNativeBoundary({ fs: true });
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const conversations = Array.from({ length: 13 }, (_, index) => {
      const position = index + 1;
      const updatedAt = new Date(Date.parse('2026-09-15T12:00:00.000Z') - index * 60_000).toISOString();
      const isAurora = index !== 2;
      return {
        id: `chat-${position}`,
        title: isAurora ? `Aurora notes ${position}` : 'Cedar notes',
        modelId: 'local-model',
        messages: [
          {
            id: `message-${position}`,
            role: 'user',
            content: isAurora ? 'Plan the aurora launch' : 'Review the cedar budget',
            timestamp: Date.parse(updatedAt),
          },
        ],
        createdAt: updatedAt,
        updatedAt,
      };
    });
    await AsyncStorage.setItem(
      'local-llm-chat-storage',
      JSON.stringify({
        state: {
          conversations,
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

    rtl.fireEvent.press(chats.getByLabelText('Select chats'));
    expect(chats.getByLabelText('Cancel selection')).toBeTruthy();
    expect(chats.queryByText('Cancel')).toBeNull();
    rtl.fireEvent.press(chats.getByTestId('conversation-item-2'));
    expect(chats.getByText('1 selected')).toBeTruthy();

    rtl.fireEvent.changeText(chats.getByTestId('chat-search-input'), 'aurora');
    expect(chats.getByText('Aurora notes 1')).toBeTruthy();
    expect(chats.queryByText('Cedar notes')).toBeNull();

    rtl.fireEvent.press(chats.getByText('Select all'));
    expect(chats.getByText('12 selected')).toBeTruthy();
    rtl.fireEvent.press(chats.getByText('Clear'));
    rtl.fireEvent.press(chats.getByTestId('conversation-item-0'));
    rtl.fireEvent.press(chats.getByTestId('conversation-item-1'));
    expect(chats.getByText('2 selected')).toBeTruthy();

    rtl.fireEvent.press(chats.getByLabelText('Delete selected chats'));
    expect(chats.getByText('Delete Chats')).toBeTruthy();
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 350)));
    // Deleting waits for each chat's image files to be removed first.
    await rtl.act(async () => { rtl.fireEvent.press(chats.getByText('Delete')); });

    await rtl.waitFor(() => expect(chats.queryByText('Aurora notes 1')).toBeNull());
    rtl.fireEvent.press(chats.getByLabelText('Clear chat search'));
    expect(chats.getByText('Cedar notes')).toBeTruthy();
    await rtl.act(() => new Promise(resolve => setTimeout(resolve, 250)));
  });
});
