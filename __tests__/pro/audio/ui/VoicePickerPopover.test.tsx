/**
 * VoicePickerPopover tests
 *
 * The TTS voice selector popover shown from the audio-mode input row. Drives the
 * REAL useTTSStore (voices/activeVoiceId set via setState) and asserts what the
 * user sees (voice labels, personas, the active check + primary color) and what
 * pressing a row DOES (dispatches the real setVoice action -> activeVoiceId in the
 * store actually changes; a speaking voice is stopped first; onClose fires).
 *
 * Mocks only genuine boundaries: the icon shim, theme, haptics, and the native
 * TTS engine registry (setVoice would otherwise hit native). The store under
 * assertion is NOT mocked.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

const mockColors = {
  text: '#000000', textMuted: '#999999', primary: '#00FF00',
  background: '#FFFFFF', surface: '#F5F5F5', border: '#E0E0E0',
};

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name, color }: any) => <Text testID={`feather-${name}`} style={{ color }}>{name}</Text>;
});

jest.mock('@offgrid/core/theme', () => ({
  useTheme: () => ({ colors: mockColors }),
}));

jest.mock('@offgrid/core/utils/haptics', () => ({ triggerHaptic: jest.fn() }));

// The active engine is a native boundary: setVoice() forwards to engine.setVoice.
// Keep the stub dumb (resolve immediately) so the REAL store logic runs on top.
const mockEngine = {
  setVoice: jest.fn(() => Promise.resolve()),
  // The stop() path (taken when playbackStatus !== 'idle') reads these off the
  // active engine; keep them as dumb boundary stubs so the REAL store/playback
  // logic runs on top and lands the store back in the 'idle' state we assert.
  getPhase: jest.fn(() => 'idle'),
  stop: jest.fn(),
};
jest.mock('../../../../pro/audio/engine', () => ({
  ttsRegistry: { getActiveEngine: () => mockEngine },
}));

import { VoicePickerPopover } from '@offgrid/pro/audio/ui/VoicePickerPopover';
import { useTTSStore } from '@offgrid/pro/audio/ttsStore';
import { triggerHaptic } from '@offgrid/core/utils/haptics';
import type { TTSVoice } from '@offgrid/pro/audio/engine/types';

const VOICES: TTSVoice[] = [
  { id: 'af_heart', label: 'Heart', metadata: { persona: 'Warm narrator' } },
  { id: 'am_puck', label: 'Puck', metadata: { persona: 'Playful' } },
  { id: 'zh_1', label: 'Ling', metadata: {} },
];

const baseProps = { visible: true, onClose: jest.fn(), anchorY: 0, anchorX: 0 };

/** Snapshot of the store fields we mutate, so afterEach can restore them exactly. */
const INITIAL = useTTSStore.getState();

afterEach(() => {
  useTTSStore.setState({
    voices: INITIAL.voices,
    activeVoiceId: INITIAL.activeVoiceId,
    isSpeaking: INITIAL.isSpeaking,
    playbackStatus: INITIAL.playbackStatus,
  });
  jest.clearAllMocks();
});

describe('VoicePickerPopover', () => {
  it('renders nothing when not visible', () => {
    const { queryByText } = render(<VoicePickerPopover {...baseProps} visible={false} />);
    expect(queryByText('Heart')).toBeNull();
  });

  it('renders every voice label and its persona when visible', () => {
    useTTSStore.setState({ voices: VOICES, activeVoiceId: 'af_heart' });
    const { getByText } = render(<VoicePickerPopover {...baseProps} />);
    expect(getByText('Heart')).toBeTruthy();
    expect(getByText('Puck')).toBeTruthy();
    expect(getByText('Ling')).toBeTruthy();
    expect(getByText('Warm narrator')).toBeTruthy();
    expect(getByText('Playful')).toBeTruthy();
  });

  it('renders an empty popover (no rows) when the store has no voices', () => {
    useTTSStore.setState({ voices: [], activeVoiceId: null });
    const { queryByText } = render(<VoicePickerPopover {...baseProps} />);
    expect(queryByText('Heart')).toBeNull();
  });

  it('shows a check icon and primary-colored label only for the active voice', () => {
    useTTSStore.setState({ voices: VOICES, activeVoiceId: 'am_puck' });
    const { getByText, getAllByTestId, queryAllByTestId } = render(<VoicePickerPopover {...baseProps} />);

    // Exactly one check icon (the active row).
    expect(getAllByTestId('feather-check')).toHaveLength(1);

    // Active label uses primary; an inactive one uses the plain text color.
    expect(getByText('Puck').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: mockColors.primary })]),
    );
    expect(getByText('Heart').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: mockColors.text })]),
    );

    // One user icon per voice row.
    expect(queryAllByTestId('feather-user')).toHaveLength(3);
  });

  it('renders empty-string persona (no crash) when metadata has no persona', () => {
    useTTSStore.setState({ voices: [VOICES[2]], activeVoiceId: 'zh_1' });
    const { getByText } = render(<VoicePickerPopover {...baseProps} />);
    expect(getByText('Ling')).toBeTruthy();
  });

  it('pressing a voice dispatches setVoice -> the real store activeVoiceId changes', async () => {
    useTTSStore.setState({ voices: VOICES, activeVoiceId: 'af_heart', isSpeaking: false, playbackStatus: 'idle' });
    const onClose = jest.fn();
    const { getByText } = render(<VoicePickerPopover {...baseProps} onClose={onClose} />);

    await act(async () => {
      fireEvent.press(getByText('Puck'));
    });

    // Real store state changed (setVoice reflects activeVoiceId immediately).
    expect(useTTSStore.getState().activeVoiceId).toBe('am_puck');
    // The native engine was actually asked to switch.
    expect(mockEngine.setVoice).toHaveBeenCalledWith('am_puck');
    expect(triggerHaptic).toHaveBeenCalledWith('impactLight');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops playback first when speaking, then switches voice', async () => {
    // playbackStatus !== idle is what setVoice's stop() branch actually checks.
    useTTSStore.setState({ voices: VOICES, activeVoiceId: 'af_heart', isSpeaking: true, playbackStatus: 'playing' });
    const { getByText } = render(<VoicePickerPopover {...baseProps} />);

    await act(async () => {
      fireEvent.press(getByText('Ling'));
    });

    // The switch still happens, and the store is no longer left in a playing state.
    expect(useTTSStore.getState().activeVoiceId).toBe('zh_1');
    expect(useTTSStore.getState().playbackStatus).toBe('idle');
  });
});
