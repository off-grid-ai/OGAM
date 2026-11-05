/**
 * A chat's preview line is reading text, so it is set in Geist, not in the Mono face kept for labels,
 * numbers and timestamps (brand/DESIGN_PHILOSOPHY.md).
 *
 * Real ChatsListScreen and the real chat store, rehydrated from storage.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { withNavigator } from '../../harness/realNavigation';
import { FONTS } from '../../../src/constants';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

it('sets the preview and the title in Geist', async () => {
  installNativeBoundary({ fs: true });
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const updatedAt = '2026-10-27T12:00:00.000Z';
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

  const preview = await rtl.waitFor(() => chats.getByText(/A cabin by the lake/));
  expect(StyleSheet.flatten(preview.props.style).fontFamily).toBe(FONTS.sans);
  expect(StyleSheet.flatten(chats.getByText('Weekend trip').props.style).fontFamily).toBe(FONTS.sans);
});
