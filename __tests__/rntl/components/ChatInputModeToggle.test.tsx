/**
 * ChatInputModeToggle tests
 *
 * The pro-only Chat→Voice interface toggle in the chat-input pill row. It's a chip
 * that opens a dropdown; choosing "Voice":
 *  - when the voice model is NOT downloaded → routes to the Models Voice tab
 *  - when downloaded → flips interfaceMode inline (chat→audio)
 *  - when the chip is disabled → does nothing (menu never opens)
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

jest.mock('@offgrid/core/utils/haptics', () => ({
  triggerHaptic: jest.fn(),
}));

import { ChatInputModeToggle } from '../../../pro/audio/ui/ChatInputModeToggle';
import { useTTSStore } from '../../../pro/audio/ttsStore';

// The chip opens its dropdown via chipRef.measureInWindow(...) → setOpen(true).
// Host instances don't implement it under jest, so shim it to fire the callback.
beforeAll(() => {
  (require('react-native').View.prototype as any).measureInWindow = (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, 0, 100, 40);
});

// isReady drives the `downloaded` gate (modelDownloaded ?? isReady) the component uses.
const setDownloaded = (downloaded: boolean, mode: 'chat' | 'audio' = 'chat') => {
  useTTSStore.setState((s) => ({
    isReady: downloaded,
    settings: { ...s.settings, interfaceMode: mode },
  }));
};

describe('ChatInputModeToggle', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    setDownloaded(false, 'chat');
  });

  it('prompts to download and routes to the Models Voice tab when no voice model', () => {
    // Force Android: the alert shows inline. On iOS the component defers it to
    // the dropdown's onDismiss (to avoid presenting two modals at once), which
    // jest's Modal can't fire — that sequencing is an on-device concern.
    const { Platform } = require('react-native');
    const prevOS = Platform.OS;
    Platform.OS = 'android';
    try {
      setDownloaded(false);
      const { getByTestId, getByText } = render(<ChatInputModeToggle />);

      fireEvent.press(getByTestId('chat-mode-toggle'));
      fireEvent.press(getByTestId('mode-option-audio'));

      // No silent switch — a prompt appears and the mode stays on chat.
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(useTTSStore.getState().settings.interfaceMode).toBe('chat');

      // Tapping "Get voice model" routes to the nested Models Voice tab.
      fireEvent.press(getByText('Get voice model'));
      expect(mockNavigate).toHaveBeenCalledWith('Main', { screen: 'ModelsTab', params: { initialTab: 'voice' } });
      expect(useTTSStore.getState().settings.interfaceMode).toBe('chat');
    } finally {
      Platform.OS = prevOS;
    }
  });

  it('flips interfaceMode to audio inline when the model is downloaded', () => {
    setDownloaded(true, 'chat');
    const { getByTestId } = render(<ChatInputModeToggle />);

    fireEvent.press(getByTestId('chat-mode-toggle'));
    fireEvent.press(getByTestId('mode-option-audio'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useTTSStore.getState().settings.interfaceMode).toBe('audio');
  });

  it('does not open the menu when disabled', () => {
    setDownloaded(true, 'chat');
    const { getByTestId, queryByTestId } = render(<ChatInputModeToggle disabled />);

    fireEvent.press(getByTestId('chat-mode-toggle'));

    expect(queryByTestId('mode-option-audio')).toBeNull();
    expect(useTTSStore.getState().settings.interfaceMode).toBe('chat');
  });
});
