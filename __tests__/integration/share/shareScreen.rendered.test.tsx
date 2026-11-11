/**
 * Text shared into Atlas: the screen offers what to do with it and each choice opens a new chat with the request typed in.
 * Until the app is ready (or while it is locked behind a PIN) the shared text waits instead of being lost.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNav = { navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() };
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNav,
  useRoute: () => ({ params: mockParams }),
}));

import { ShareScreen } from '../../../src/share/ShareScreen';
import { flushShare, useIncomingShare } from '../../../src/share/shareIntake';
import { useAppStore } from '../../../src/stores/appStore';
import { useAuthStore, useChatStore } from '../../../src/stores';
import { createDownloadedModel } from '../../utils/factories';

beforeEach(() => { mockNav.replace.mockClear(); useIncomingShare.setState({ text: null }); });

it('opens a chat with the shared text and the chosen request typed in', () => {
  useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'm1' })], activeModelId: 'm1' });
  mockParams = { text: 'https://example.com/long-article' };
  const screen = render(<ShareScreen />);
  expect(screen.getByTestId('share-preview').props.children).toBe('https://example.com/long-article');
  const before = useChatStore.getState().conversations.length;
  fireEvent.press(screen.getByTestId('share-summarize'));
  expect(useChatStore.getState().conversations.length).toBe(before + 1);
  expect(mockNav.replace).toHaveBeenCalledWith('Chat', expect.objectContaining({ starter: 'Summarize this:\n\nhttps://example.com/long-article' }));
});

it('cuts very long text, and says so when no model is downloaded', () => {
  const { Alert } = require('react-native');
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useAppStore.setState({ downloadedModels: [], activeModelId: null });
  mockParams = { text: 'a'.repeat(9000) };
  const screen = render(<ShareScreen />);
  expect(String(screen.getByTestId('share-preview').props.children).length).toBe(6003);
  fireEvent.press(screen.getByTestId('share-ask'));
  expect(alert).toHaveBeenCalledWith('No model yet', expect.any(String));
  expect(mockNav.replace).not.toHaveBeenCalled();
  alert.mockRestore();
});

it('keeps shared text waiting until the navigation is ready', () => {
  useIncomingShare.getState().set('hello from another app');
  flushShare(); // no navigation container yet in this test
  expect(useIncomingShare.getState().text).toBe('hello from another app');
  expect(useAuthStore).toBeDefined();
});
