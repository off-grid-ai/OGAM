/**
 * PlayButton (audio message bubble) tests.
 *
 * Regression: a message whose TTS is paused/playing must ALWAYS be controllable,
 * even while the bubble's message is still flagged `isLoading`. Before the fix the
 * loading state rendered a non-touchable View, so a paused message could never be
 * resumed ("play not clickable") — the tap reached nothing.
 */
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { render, fireEvent, renderHook } from '@testing-library/react-native';

// Render the icon as a Text carrying its Feather name, so tests can assert which glyph
// shows (play / pause / square-stop) without depending on the vector-icons internals.
jest.mock('react-native-vector-icons/Feather', () => {
  const RC = require('react');
  const { Text } = require('react-native');
  return (props: { name: string }) => RC.createElement(Text, { testID: `icon-${props.name}` }, props.name);
});

import { PlayButton, usePlaybackState } from '../../../pro/audio/ui/AudioMessageBubble/PlaybackControls';
import { useTTSStore } from '../../../pro/audio/ttsStore';

const colors = { primary: '#0f0' } as any;
const styles = { playButton: {}, playButtonDisabled: {} } as any;

function renderButton(props: Partial<React.ComponentProps<typeof PlayButton>>) {
  const onPlayPause = jest.fn();
  const utils = render(
    <PlayButton
      isLoading={false}
      isThisLoading={false}
      isThisPlaying={false}
      isThisPaused={false}
      isThisSynth={false}
      onPlayPause={onPlayPause}
      colors={colors}
      styles={styles}
      {...props}
    />,
  );
  return { onPlayPause, ...utils };
}

describe('PlayButton — touchability (always controllable when this is the active target)', () => {
  it('is touchable and resumes when paused, even while the message is loading', () => {
    const { onPlayPause, UNSAFE_getAllByType } = renderButton({ isThisPaused: true, isLoading: true });
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    expect(touchables).toHaveLength(1);
    fireEvent.press(touchables[0]);
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it('is touchable while actively playing (shows pause)', () => {
    const { onPlayPause, UNSAFE_getAllByType } = renderButton({ isThisPlaying: true, isLoading: true });
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    expect(touchables).toHaveLength(1);
    fireEvent.press(touchables[0]);
    expect(onPlayPause).toHaveBeenCalled();
  });

  it('is touchable while a live synth, even mid-generation loading (stop must never be dead)', () => {
    // The device bug: while streaming/synthesising the control rendered dead. A synth is
    // ALWAYS controllable so the user can stop it.
    const { onPlayPause, UNSAFE_getAllByType } = renderButton({ isThisSynth: true, isLoading: true });
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    expect(touchables).toHaveLength(1);
    fireEvent.press(touchables[0]);
    expect(onPlayPause).toHaveBeenCalledTimes(1);
  });

  it('renders a non-touchable placeholder while loading when NOT the active target', () => {
    const { UNSAFE_queryAllByType } = renderButton({ isLoading: true });
    expect(UNSAFE_queryAllByType(TouchableOpacity)).toHaveLength(0);
  });

  it('renders a spinner (non-touchable) while THIS is preparing but not yet playing/synth', () => {
    const { UNSAFE_queryAllByType } = renderButton({ isThisLoading: true });
    expect(UNSAFE_queryAllByType(TouchableOpacity)).toHaveLength(0);
  });

  it('is touchable in the normal idle state', () => {
    const { onPlayPause, UNSAFE_getAllByType } = renderButton({});
    fireEvent.press(UNSAFE_getAllByType(TouchableOpacity)[0]);
    expect(onPlayPause).toHaveBeenCalled();
  });
});

describe('PlayButton — which glyph shows (stop for fileless synth, else play/pause)', () => {
  it('idle → play', () => {
    const { getByTestId } = renderButton({});
    expect(getByTestId('icon-play')).toBeTruthy();
  });

  it('file-backed playing → pause (real pause/resume is honest here)', () => {
    const { getByTestId, queryByTestId } = renderButton({ isThisPlaying: true });
    expect(getByTestId('icon-pause')).toBeTruthy();
    expect(queryByTestId('icon-square')).toBeNull();
  });

  it('file-backed paused → play (resume from position)', () => {
    const { getByTestId } = renderButton({ isThisPaused: true });
    expect(getByTestId('icon-play')).toBeTruthy();
  });

  it('fileless synth playing → STOP (square), never pause', () => {
    const { getByTestId, queryByTestId } = renderButton({ isThisSynth: true, isThisPlaying: true });
    expect(getByTestId('icon-square')).toBeTruthy();
    expect(queryByTestId('icon-pause')).toBeNull();
  });

  it('fileless synth while preparing (not yet playing) → STOP (square)', () => {
    const { getByTestId } = renderButton({ isThisSynth: true });
    expect(getByTestId('icon-square')).toBeTruthy();
  });

  it('synth flag wins over playing → STOP, not pause (a synth also reads as playing)', () => {
    const { getByTestId, queryByTestId } = renderButton({ isThisSynth: true, isThisPlaying: true });
    expect(queryByTestId('icon-pause')).toBeNull();
    expect(getByTestId('icon-square')).toBeTruthy();
  });
});

// usePlaybackState is the single projection the bubble reads. isThisSynth must be true
// for any fileless live synth (streaming auto-speak OR whole-message re-synth) and false
// for seekable file/PCM playback — that is what flips the control between STOP and pause.
describe('usePlaybackState — isThisSynth derivation', () => {
  const MID = 'msg-1';
  beforeEach(() => {
    useTTSStore.setState({ currentMessageId: null, playbackStatus: 'idle', currentAudioPath: null, isStreaming: false });
  });

  it('streaming auto-speak (isStreaming) → isThisSynth true', () => {
    useTTSStore.setState({ currentMessageId: MID, playbackStatus: 'playing', isStreaming: true, currentAudioPath: null });
    const { result } = renderHook(() => usePlaybackState(MID));
    expect(result.current.isThisSynth).toBe(true);
  });

  it('streaming while still preparing (not yet playing) → isThisSynth true', () => {
    useTTSStore.setState({ currentMessageId: MID, playbackStatus: 'preparing', isStreaming: true, currentAudioPath: null });
    const { result } = renderHook(() => usePlaybackState(MID));
    expect(result.current.isThisSynth).toBe(true);
  });

  it('fileless re-synth (playing, no audioPath) → isThisSynth true', () => {
    useTTSStore.setState({ currentMessageId: MID, playbackStatus: 'playing', isStreaming: false, currentAudioPath: null });
    const { result } = renderHook(() => usePlaybackState(MID));
    expect(result.current.isThisSynth).toBe(true);
  });

  it('fileless re-synth PAUSED (no audioPath) → still isThisSynth true (can not resume from position)', () => {
    useTTSStore.setState({ currentMessageId: MID, playbackStatus: 'paused', isStreaming: false, currentAudioPath: null });
    const { result } = renderHook(() => usePlaybackState(MID));
    expect(result.current.isThisSynth).toBe(true);
  });

  it('file-backed playback (audioPath set) → isThisSynth false (real pause/resume is honest)', () => {
    useTTSStore.setState({ currentMessageId: MID, playbackStatus: 'playing', isStreaming: false, currentAudioPath: '/tmp/clip.wav' });
    const { result } = renderHook(() => usePlaybackState(MID));
    expect(result.current.isThisSynth).toBe(false);
    expect(result.current.isThisPlaying).toBe(true);
  });

  it('a DIFFERENT message is the target → isThisSynth false for this bubble', () => {
    useTTSStore.setState({ currentMessageId: 'other', playbackStatus: 'playing', isStreaming: true, currentAudioPath: null });
    const { result } = renderHook(() => usePlaybackState(MID));
    expect(result.current.isThisSynth).toBe(false);
  });

  it('idle → isThisSynth false', () => {
    useTTSStore.setState({ currentMessageId: MID, playbackStatus: 'idle', isStreaming: false, currentAudioPath: null });
    const { result } = renderHook(() => usePlaybackState(MID));
    expect(result.current.isThisSynth).toBe(false);
  });
});
