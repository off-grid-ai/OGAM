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

// Vector-icons render shim: emit a Text carrying the Feather name so tests can
// assert which glyph shows (mic vs square) without the native icon internals.
jest.mock('react-native-vector-icons/Feather', () => {
  const RC = require('react');
  const { Text } = require('react-native');
  return (props: { name: string }) => RC.createElement(Text, { testID: `icon-${props.name}` }, props.name);
});

import type {MobileApplicationFixture} from '../../../harness/mobileApplicationFixture';
import {installNativeBoundary, requireRTL} from '../../../harness/nativeBoundary';

let applicationFixture: MobileApplicationFixture;
let AudioEmptyState: typeof import('@offgrid/pro/audio/ui/AudioEmptyState').AudioEmptyState;
let recordingController: typeof import('@offgrid/core/services/recordingController').recordingController;
let voiceSession: typeof import('@offgrid/core/services/voiceSession').voiceSession;
let rtl: typeof import('@testing-library/react-native');

beforeAll(async () => {
  installNativeBoundary();
  rtl = requireRTL();
  ({AudioEmptyState} = require('@offgrid/pro/audio/ui/AudioEmptyState') as typeof import('@offgrid/pro/audio/ui/AudioEmptyState'));
  ({recordingController} = require('@offgrid/core/services/recordingController') as typeof import('@offgrid/core/services/recordingController'));
  ({voiceSession} = require('@offgrid/core/services/voiceSession') as typeof import('@offgrid/core/services/voiceSession'));
  const {startMobileApplicationFixture} = require('../../../harness/mobileApplicationFixture') as typeof import('../../../harness/mobileApplicationFixture');
  applicationFixture = await startMobileApplicationFixture({pro: true});
});

afterAll(async () => {
  await applicationFixture.dispose();
});

afterEach(() => {
  rtl.cleanup();
  // No pollution: the controller is a module singleton — reset phase/handlers/listeners.
  recordingController._reset();
  voiceSession._resetForTesting();
});

function registerRecorder() {
  const start = jest.fn(() => {
    voiceSession.dispatch('userStart');
    voiceSession.dispatch('speechHeard');
  });
  const stop = jest.fn(() => voiceSession.dispatch('turnCaptured'));
  const cancel = jest.fn();
  const unregister = recordingController.registerHandlers({ start, stop, cancel });
  return { start, stop, cancel, unregister };
}

describe('AudioEmptyState', () => {
  it('renders the idle hero: mic glyph, "Tap to speak", privacy tagline', () => {
    rtl.render(<AudioEmptyState />);
    expect(rtl.screen.getByTestId('audio-hero-mic')).toBeTruthy();
    expect(rtl.screen.getByTestId('icon-mic')).toBeTruthy();
    expect(rtl.screen.queryByTestId('icon-square')).toBeNull();
    expect(rtl.screen.getByText('Tap to speak')).toBeTruthy();
    expect(rtl.screen.getByText('Everything runs on your device')).toBeTruthy();
  });

  it('tapping the mic while idle dispatches toggle() → the recorder START fires and the phase becomes recording', () => {
    const { start, stop } = registerRecorder();
    rtl.render(<AudioEmptyState />);

    rtl.fireEvent.press(rtl.screen.getByTestId('audio-hero-mic'));

    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(recordingController.getPhase()).toBe('recording');
  });

  it('reflects the authoritative recording phase: shows the stop glyph and "Recording you now" after START', () => {
    registerRecorder();
    rtl.render(<AudioEmptyState />);

    rtl.fireEvent.press(rtl.screen.getByTestId('audio-hero-mic'));

    expect(rtl.screen.getByTestId('icon-square')).toBeTruthy();
    expect(rtl.screen.queryByTestId('icon-mic')).toBeNull();
    expect(rtl.screen.getByText('Recording you now')).toBeTruthy();
    expect(rtl.screen.queryByText('Tap to speak')).toBeNull();
  });

  it('a SECOND tap STOPS (the fix): toggle() from the recording phase calls stop, not a second start', () => {
    const { start, stop } = registerRecorder();
    rtl.render(<AudioEmptyState />);

    rtl.fireEvent.press(rtl.screen.getByTestId('audio-hero-mic')); // start
    rtl.fireEvent.press(rtl.screen.getByTestId('audio-hero-mic')); // stop

    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(recordingController.getPhase()).toBe('transcribing');
  });

  it('subscribes to external phase changes: the controller flipping to recording re-renders the hero to the stop state', () => {
    rtl.render(<AudioEmptyState />);
    expect(rtl.screen.getByTestId('icon-mic')).toBeTruthy();

    // A phase change from ANOTHER mic (footer) — the hero reads the same source.
    rtl.act(() => {
      voiceSession.dispatch('userStart');
      voiceSession.dispatch('speechHeard');
    });

    expect(rtl.screen.getByTestId('icon-square')).toBeTruthy();
    expect(rtl.screen.getByText('Recording you now')).toBeTruthy();
  });

  it('unsubscribes on unmount: a later phase change does not throw or update a torn-down tree', () => {
    const { unmount } = rtl.render(<AudioEmptyState />);
    unmount();
    // Would throw "update on unmounted" if the effect cleanup did not unsubscribe.
    expect(() => rtl.act(() => {
      voiceSession.dispatch('userStart');
      voiceSession.dispatch('speechHeard');
    })).not.toThrow();
  });
});
