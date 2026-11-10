/**
 * A chat row reads as one line: its title in Geist (reading text), under its day heading. The row
 * shows no reply and no time: the heading says when.
 *
 * Real ChatsListScreen and the real chat store, rehydrated from storage.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { withNavigator } from '../../harness/realNavigation';
import { FONTS } from '../../../src/constants';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

it('sets the one-line title in Geist, under Today, with no reply and no time', async () => {
  installNativeBoundary({ fs: true });
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  // Active today, so the chat sits under the Today heading.
  const updatedAt = new Date().toISOString();
  await AsyncStorage.setItem(
    'local-llm-chat-storage',
    JSON.stringify({
      state: {
        conversations: [{
          id: 'chat-trip', title: 'Weekend trip', modelId: 'm',
          messages: [
            { id: 'm1', role: 'user', content: 'Plan a weekend', timestamp: Date.parse(updatedAt) },
            { id: 'm2', role: 'assistant', content: 'A cabin by the lake', timestamp: Date.parse(updatedAt) },
          ],
          createdAt: updatedAt, updatedAt,
        }],
        activeConversationId: null,
      },
      version: 2,
    }),
  );
  const React = require('react');
  const { StyleSheet } = require('react-native');
  const rtl = requireRTL();
  const { useChatStore } = require('../../../src/stores/chatStore');
  await useChatStore.persist.rehydrate();

  const { ChatsListScreen } = require('../../../src/screens/ChatsListScreen');
  const chats = rtl.render(withNavigator(React.createElement(ChatsListScreen)));

  const title = await rtl.waitFor(() => chats.getByText('Weekend trip'));
  expect(StyleSheet.flatten(title.props.style).fontFamily).toBe(FONTS.sans);
  expect(title.props.numberOfLines).toBe(1);
  expect(chats.getByText('Today')).toBeTruthy();
  // The row is the title alone: no reply preview, no clock time.
  const rowTexts = rtl.within(chats.getByTestId('conversation-item-0')).queryAllByText(/./);
  expect(rowTexts.map(node => String(node.props.children))).toEqual(['Weekend trip']);
  expect(chats.queryByText(/A cabin by the lake/)).toBeNull();
  expect(chats.queryByText(/^\d{1,2}[:.]\d{2}/)).toBeNull();
});
