/**
 * AudioEmptyState (Voice-mode welcome hero) — RNTL tests.
 *
 * Drives the REAL recordingController (the single owner of the record phase the
 * hero reads and writes) and asserts what the user SEES (mic vs stop glyph, the
 * "Tap to speak" / "Recording you now" title) and what a tap DOES (dispatches
 * toggle() → the controller's real handlers fire in the right lifecycle order,
 * proving the second-tap-stops fix, not the old write-only start-only bug).
 */
import React from 'react';
import { render, fireEvent, screen, act } from '@testing-library/react-native';

// Vector-icons render shim: emit a Text carrying the Feather name so tests can
// assert which glyph shows (mic vs square) without the native icon internals.
jest.mock('react-native-vector-icons/Feather', () => {
  const RC = require('react');
  const { Text } = require('react-native');
  return (props: { name: string }) => RC.createElement(Text, { testID: `icon-${props.name}` }, props.name);
});

import { AudioEmptyState } from '@offgrid/pro/audio/ui/AudioEmptyState';
import { recordingController } from '@offgrid/core/services/recordingController';
import { voiceSession } from '@offgrid/core/services/voiceSession';
import { useWhisperStore } from '@offgrid/core/stores/whisperStore';

// The hero records only with a speech model on the phone, as the footer mic does.
beforeEach(() => {
  useWhisperStore.setState({ downloadedModelId: 'small.en' });
});

afterEach(() => {
  // No pollution: the controller is a module singleton — reset phase/handlers/listeners.
  recordingController._reset();
    voiceSession._resetForTesting();
});

function registerRecorder() {
  const start = jest.fn(() => (voiceSession.dispatch('userStart'), voiceSession.dispatch('speechHeard')));
  const stop = jest.fn(() => voiceSession.dispatch('turnCaptured'));
  const cancel = jest.fn();
  const unregister = recordingController.registerHandlers({ start, stop, cancel });
  return { start, stop, cancel, unregister };
}

describe('AudioEmptyState', () => {
  it('renders the idle hero: mic glyph, "Tap to speak", privacy tagline', () => {
    render(<AudioEmptyState />);
    expect(screen.getByTestId('audio-hero-mic')).toBeTruthy();
    expect(screen.getByTestId('icon-mic')).toBeTruthy();
    expect(screen.queryByTestId('icon-square')).toBeNull();
    expect(screen.getByText('Tap to speak')).toBeTruthy();
    expect(screen.getByText('Everything runs on your device')).toBeTruthy();
  });

  it('tapping the mic while idle dispatches toggle() → the recorder START fires and the phase becomes recording', () => {
    const { start, stop } = registerRecorder();
    render(<AudioEmptyState />);

    fireEvent.press(screen.getByTestId('audio-hero-mic'));

    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(recordingController.getPhase()).toBe('recording');
  });

  it('reflects the authoritative recording phase: shows the stop glyph and "Recording you now" after START', () => {
    registerRecorder();
    render(<AudioEmptyState />);

    fireEvent.press(screen.getByTestId('audio-hero-mic'));

    expect(screen.getByTestId('icon-square')).toBeTruthy();
    expect(screen.queryByTestId('icon-mic')).toBeNull();
    expect(screen.getByText('Recording you now')).toBeTruthy();
    expect(screen.queryByText('Tap to speak')).toBeNull();
  });

  it('a SECOND tap STOPS (the fix): toggle() from the recording phase calls stop, not a second start', () => {
    const { start, stop } = registerRecorder();
    render(<AudioEmptyState />);

    fireEvent.press(screen.getByTestId('audio-hero-mic')); // start
    fireEvent.press(screen.getByTestId('audio-hero-mic')); // stop

    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(recordingController.getPhase()).toBe('transcribing');
  });

  it('subscribes to external phase changes: the controller flipping to recording re-renders the hero to the stop state', () => {
    render(<AudioEmptyState />);
    expect(screen.getByTestId('icon-mic')).toBeTruthy();

    // A phase change from ANOTHER mic (footer) — the hero reads the same source.
    act(() => {
      (voiceSession.dispatch('userStart'), voiceSession.dispatch('speechHeard'));
    });

    expect(screen.getByTestId('icon-square')).toBeTruthy();
    expect(screen.getByText('Recording you now')).toBeTruthy();
  });

  it('unsubscribes on unmount: a later phase change does not throw or update a torn-down tree', () => {
    const { unmount } = render(<AudioEmptyState />);
    unmount();
    // Would throw "update on unmounted" if the effect cleanup did not unsubscribe.
    expect(() => act(() => (voiceSession.dispatch('userStart'), voiceSession.dispatch('speechHeard')))).not.toThrow();
  });

  it('with no speech model, says so with Get a model, and a tap does not start recording', () => {
    act(() => { useWhisperStore.setState({ downloadedModelId: null }); });
    const { start } = registerRecorder();
    render(<AudioEmptyState />);

    expect(screen.getByText('Needs a speech model.')).toBeTruthy();
    expect(screen.getByTestId('audio-hero-readiness-get-model')).toBeTruthy();
    expect(screen.queryByText('Everything runs on your device')).toBeNull();

    fireEvent.press(screen.getByTestId('audio-hero-mic'));

    expect(start).not.toHaveBeenCalled();
    expect(recordingController.getPhase()).not.toBe('recording');
  });
});
