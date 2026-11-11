/**
 * Search everything: type a few letters, see chats (and what was said in them), settings pages and models, open one.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNav = { navigate: jest.fn(), goBack: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
}));

import { SearchScreen } from '../../../src/search/SearchScreen';
import { useChatStore } from '../../../src/stores';
import { useAppStore } from '../../../src/stores/appStore';
import { createDownloadedModel } from '../../utils/factories';

beforeEach(() => mockNav.navigate.mockClear());

it('finds a chat by what was said in it and opens it', () => {
  const id = useChatStore.getState().createConversation('m', 'Weekend ideas');
  useChatStore.getState().addMessage(id, { role: 'user', content: 'Where can I find sourdough starter near me?' });
  const screen = render(<SearchScreen />);
  fireEvent.changeText(screen.getByTestId('search-input'), 'sourdough');
  fireEvent.press(screen.getByTestId(`search-hit-chat-${id}`));
  expect(mockNav.navigate).toHaveBeenCalledWith('Chat', { conversationId: id });
  expect(useChatStore.getState().activeConversationId).toBe(id);
});

it('finds a settings page by what people call it, a model by name, and says when nothing matches', () => {
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'q1', name: 'Qwen Tiny 0.5B' })] });
  const screen = render(<SearchScreen />);
  fireEvent.changeText(screen.getByTestId('search-input'), 'dark mode');
  fireEvent.press(screen.getByTestId('search-hit-screen-Appearance'));
  expect(mockNav.navigate).toHaveBeenCalledWith('Appearance', undefined);
  fireEvent.changeText(screen.getByTestId('search-input'), 'qwen');
  expect(screen.getByTestId('search-hit-model-q1')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('search-input'), 'zzzzqq');
  expect(screen.getByTestId('search-empty')).toBeTruthy();
});
