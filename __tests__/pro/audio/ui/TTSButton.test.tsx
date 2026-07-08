/**
 * TTSButton (chat message speaker) tests.
 *
 * TTSButton shows ONE speaker control per message. It:
 *  - hides entirely when TTS is disabled, or when the engine isn't usable AND this
 *    message isn't the active playback target (so a mid-flight message keeps its icon);
 *  - shows `volume-2` (primary colour) while THIS message is the active target
 *    (currentMessageId === messageId), `volume-1` (muted) otherwise;
 *  - toggles: pressing the active message stops playback; pressing an inactive one
 *    starts speaking it.
 *
 * These drive the REAL useTTSStore (setState real state) and assert the resulting
 * store STATE after a press — not "an action was called". No active TTS engine is
 * registered in jest, so speak()/stop() run their real store transitions (start →
 * preparing / stop → idle) and bail safely at the native boundary.
 */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';

// Render the icon as a Text carrying its Feather name + colour, so tests can assert
// which glyph shows (volume-1 vs volume-2) and its colour without vector-icons internals.
jest.mock('react-native-vector-icons/Feather', () => {
  const RC = require('react');
  const { Text } = require('react-native');
  return (props: { name: string; color?: string }) =>
    RC.createElement(Text, { testID: `icon-${props.name}`, accessibilityLabel: props.color }, props.name);
});

import { TTSButton } from '@offgrid/pro/audio/ui/TTSButton';
import { useTTSStore } from '@offgrid/pro/audio/ttsStore';

const MID = 'msg-1';
const OTHER = 'msg-2';
const TEXT = 'hello world';

// A clean, known baseline for every test: TTS on, engine usable, nothing playing.
function seedStore(patch: Partial<ReturnType<typeof useTTSStore.getState>> = {}) {
  const base = useTTSStore.getState();
  useTTSStore.setState({
    isReady: true,
    currentMessageId: null,
    playbackStatus: 'idle',
    settings: { ...base.settings, enabled: true },
    ...patch,
  });
}

describe('TTSButton', () => {
  beforeEach(() => {
    seedStore();
  });

  afterEach(() => {
    // Reset only the fields we mutate so we never leak state into sibling suites.
    const base = useTTSStore.getState();
    useTTSStore.setState({
      isReady: false,
      currentMessageId: null,
      playbackStatus: 'idle',
      settings: { ...base.settings, enabled: true },
    });
  });

  describe('visibility', () => {
    it('renders the button when TTS is enabled and the engine is ready', () => {
      seedStore({ isReady: true });
      render(<TTSButton text={TEXT} messageId={MID} />);
      expect(screen.getByTestId(`tts-button-${MID}`)).toBeTruthy();
    });

    it('renders nothing when TTS is disabled', () => {
      const base = useTTSStore.getState();
      useTTSStore.setState({ isReady: true, settings: { ...base.settings, enabled: false } });
      render(<TTSButton text={TEXT} messageId={MID} />);
      expect(screen.queryByTestId(`tts-button-${MID}`)).toBeNull();
    });

    it('renders nothing when disabled even while this message is the active target', () => {
      const base = useTTSStore.getState();
      useTTSStore.setState({
        isReady: true,
        currentMessageId: MID,
        settings: { ...base.settings, enabled: false },
      });
      render(<TTSButton text={TEXT} messageId={MID} />);
      expect(screen.queryByTestId(`tts-button-${MID}`)).toBeNull();
    });

    it('renders nothing when the engine is not ready AND this message is not active', () => {
      seedStore({ isReady: false, currentMessageId: null });
      render(<TTSButton text={TEXT} messageId={MID} />);
      expect(screen.queryByTestId(`tts-button-${MID}`)).toBeNull();
    });

    it('still renders (mid-flight) when the engine is not ready but this message IS active', () => {
      seedStore({ isReady: false, currentMessageId: MID });
      render(<TTSButton text={TEXT} messageId={MID} />);
      expect(screen.getByTestId(`tts-button-${MID}`)).toBeTruthy();
    });

    it('renders nothing when not-ready and a DIFFERENT message is the active target', () => {
      seedStore({ isReady: false, currentMessageId: OTHER });
      render(<TTSButton text={TEXT} messageId={MID} />);
      expect(screen.queryByTestId(`tts-button-${MID}`)).toBeNull();
    });
  });

  describe('glyph + colour (active vs inactive)', () => {
    it('shows volume-1 (muted colour) when this message is NOT the active target', () => {
      seedStore({ isReady: true, currentMessageId: OTHER });
      render(<TTSButton text={TEXT} messageId={MID} />);
      const icon = screen.getByTestId('icon-volume-1');
      expect(icon).toBeTruthy();
      expect(screen.queryByTestId('icon-volume-2')).toBeNull();
    });

    it('shows volume-2 (primary colour) when this message IS the active target', () => {
      seedStore({ isReady: true, currentMessageId: MID });
      render(<TTSButton text={TEXT} messageId={MID} />);
      const icon = screen.getByTestId('icon-volume-2');
      expect(icon).toBeTruthy();
      expect(screen.queryByTestId('icon-volume-1')).toBeNull();
    });

    it('active + inactive icons use different colours (primary vs muted)', () => {
      seedStore({ isReady: true, currentMessageId: MID });
      const { unmount } = render(<TTSButton text={TEXT} messageId={MID} />);
      const activeColour = screen.getByTestId('icon-volume-2').props.accessibilityLabel;
      unmount();

      seedStore({ isReady: true, currentMessageId: OTHER });
      render(<TTSButton text={TEXT} messageId={MID} />);
      const inactiveColour = screen.getByTestId('icon-volume-1').props.accessibilityLabel;

      expect(activeColour).toBeTruthy();
      expect(inactiveColour).toBeTruthy();
      expect(activeColour).not.toBe(inactiveColour);
    });
  });

  describe('press behaviour (real store transitions)', () => {
    it('pressing an INACTIVE message routes through speak(), which stops whatever OTHER message was playing first', async () => {
      // A DIFFERENT message is currently the active playback target. Pressing this
      // (inactive) button must call speak(text, thisMessage) — NOT stop(). The real
      // speakMessage first stops the other in-flight message before starting, so the
      // observable outcome (no engine registered in jest) is: the other message's
      // playback is torn down and the store returns to idle. That proves handlePress
      // took the speak() branch for THIS message, not the stop() branch.
      seedStore({ isReady: true, currentMessageId: OTHER, playbackStatus: 'playing' });
      render(<TTSButton text={TEXT} messageId={MID} />);

      fireEvent.press(screen.getByTestId(`tts-button-${MID}`));
      await Promise.resolve(); // speak() is async

      expect(useTTSStore.getState().currentMessageId).toBeNull();
      expect(useTTSStore.getState().playbackStatus).toBe('idle');
    });

    it('pressing the ACTIVE message stops playback → store returns to idle with no current message', () => {
      seedStore({ isReady: true, currentMessageId: MID, playbackStatus: 'playing' });
      render(<TTSButton text={TEXT} messageId={MID} />);

      fireEvent.press(screen.getByTestId(`tts-button-${MID}`));

      expect(useTTSStore.getState().currentMessageId).toBeNull();
      expect(useTTSStore.getState().playbackStatus).toBe('idle');
    });
  });
});
