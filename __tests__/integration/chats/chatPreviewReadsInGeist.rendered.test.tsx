/**
 * A chat row reads as one line: its title in Geist (reading text) and when it was last active in Geist
 * Mono (brand/DESIGN_PHILOSOPHY.md: Mono for timestamps), under its date heading.
 *
 * Real ChatsListScreen and the real chat store, rehydrated from storage.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { withNavigator } from '../../harness/realNavigation';
import { FONTS } from '../../../src/constants';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

it('sets the title in Geist and the time in Geist Mono', async () => {
  installNativeBoundary({ fs: true });
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  // Active today, so the row shows its clock time (an older chat reads Last week, N weeks ago, a date).
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
  // The time stays on the row, so chats with the same title can be told apart.
  const time = chats.getByText(/^\d{1,2}[:.]\d{2}/);
  expect(StyleSheet.flatten(time.props.style).fontFamily).toBe(FONTS.mono);
});
