/**
 * QuickSettingsAudioRow tests
 *
 * The "Voice" toggle row in the chat-input quick-settings popover. Drives the
 * REAL useTTSStore and asserts what the user sees (badge label/text, icon) and
 * what pressing the row DOES:
 *  - not ready  → closes the popover, routes to the Models Voice tab, leaves mode unchanged
 *  - ready+chat → closes, flips interfaceMode to 'audio'
 *  - ready+audio→ closes, flips interfaceMode to 'chat'
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

// Render shim for the vector-icon so we can read the icon name the user sees.
jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: { name: string }) => <Text testID="tts-icon">{name}</Text>;
});

import { QuickSettingsAudioRow } from '@offgrid/pro/audio/ui/QuickSettingsAudioRow';
import { useTTSStore } from '@offgrid/pro/audio/ttsStore';

// popoverStyles shape core passes in (plain style objects; only presence matters).
const styles = {
  row: { flexDirection: 'row' as const },
  rowLabel: { fontSize: 14 },
  badge: { paddingHorizontal: 6 },
  badgeText: { fontSize: 10 },
};

const setTTS = (isReady: boolean, mode: 'chat' | 'audio') => {
  useTTSStore.setState((s) => ({
    isReady,
    settings: { ...s.settings, interfaceMode: mode },
  }));
};

describe('QuickSettingsAudioRow', () => {
  const initialState = useTTSStore.getState();

  beforeEach(() => {
    mockNavigate.mockClear();
  });

  afterEach(() => {
    // Restore the store so we never leak state into other suites.
    useTTSStore.setState(initialState, true);
  });

  it('shows the N/A badge and muted volume-1 icon when the engine is not ready', () => {
    setTTS(false, 'chat');
    const onClose = jest.fn();
    const { getByTestId, getByText } = render(
      <QuickSettingsAudioRow styles={styles} onClose={onClose} />,
    );

    expect(getByText('Voice')).toBeTruthy();
    expect(getByText('N/A')).toBeTruthy();
    expect(getByTestId('tts-icon').props.children).toBe('volume-1');
  });

  it('shows the Chat badge when ready in chat mode', () => {
    setTTS(true, 'chat');
    const { getByText, getByTestId } = render(
      <QuickSettingsAudioRow styles={styles} onClose={jest.fn()} />,
    );

    expect(getByText('Chat')).toBeTruthy();
    expect(getByTestId('tts-icon').props.children).toBe('volume-1');
  });

  it('shows the Audio badge and volume-2 icon when ready in audio mode', () => {
    setTTS(true, 'audio');
    const { getByText, getByTestId } = render(
      <QuickSettingsAudioRow styles={styles} onClose={jest.fn()} />,
    );

    expect(getByText('Audio')).toBeTruthy();
    expect(getByTestId('tts-icon').props.children).toBe('volume-2');
  });

  it('when not ready, pressing closes the popover and routes to the Models Voice tab without changing mode', () => {
    setTTS(false, 'chat');
    const onClose = jest.fn();
    const { getByTestId } = render(
      <QuickSettingsAudioRow styles={styles} onClose={onClose} />,
    );

    fireEvent.press(getByTestId('quick-tts-mode'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Main', {
      screen: 'ModelsTab',
      params: { initialTab: 'voice' },
    });
    // Mode is untouched — the not-ready path only navigates.
    expect(useTTSStore.getState().settings.interfaceMode).toBe('chat');
  });

  it('when ready in chat mode, pressing flips interfaceMode to audio and closes', () => {
    setTTS(true, 'chat');
    const onClose = jest.fn();
    const { getByTestId } = render(
      <QuickSettingsAudioRow styles={styles} onClose={onClose} />,
    );

    fireEvent.press(getByTestId('quick-tts-mode'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useTTSStore.getState().settings.interfaceMode).toBe('audio');
  });

  it('when ready in audio mode, pressing flips interfaceMode back to chat and closes', () => {
    setTTS(true, 'audio');
    const onClose = jest.fn();
    const { getByTestId } = render(
      <QuickSettingsAudioRow styles={styles} onClose={onClose} />,
    );

    fireEvent.press(getByTestId('quick-tts-mode'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(useTTSStore.getState().settings.interfaceMode).toBe('chat');
  });
});
