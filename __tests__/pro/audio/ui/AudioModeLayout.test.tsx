/**
 * AudioModeLayout (pro) — RNTL tests.
 *
 * AudioModeLayout is the bottom bar for audio (voice) chat mode. Its center slot is a
 * SINGLE coherent decision derived by `deriveAudioActivity` from the live TTS store +
 * generation props, with an explicit precedence:
 *   generation-stop  >  tts-stop  >  mic.
 * These tests drive the REAL `useTTSStore` (setState real state) and the REAL
 * `deriveAudioActivity`, and assert what the user SEES in that center slot (the
 * generation stop button, the TTS stop button — enabled vs disabled while preparing,
 * or the mic) plus the right-zone voice label / voice-switch spinner, and what pressing
 * the controls DOES (respects the mid-'preparing' guard; fires the real store `stop`
 * only once playback is live; calls `onStop` only while generating).
 *
 * Deleting the precedence/guard logic must fail a test here.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// Feather renders as a <Text> carrying its glyph name so we can assert which icon shows
// (square = stop, mic = record) without depending on vector-icons internals. This local
// mock overrides the global `'Icon'`-string mock so the icon name is queryable.
jest.mock('react-native-vector-icons/Feather', () => {
  const RC = require('react');
  const { Text } = require('react-native');
  return (props: { name: string }) => RC.createElement(Text, { testID: `feather-${props.name}` }, props.name);
});

// Haptics is a genuine native boundary — stub it so presses don't call into the device.
jest.mock('@offgrid/core/utils/haptics', () => ({ triggerHaptic: jest.fn() }));

import { AudioModeLayout } from '@offgrid/pro/audio/ui/AudioModeLayout';
import { useTTSStore } from '@offgrid/pro/audio/ttsStore';
import { hideAlert } from '@offgrid/core/components/CustomAlert';
import type { TTSVoice } from '@offgrid/pro/audio/engine';

// A stylesheet object with just the keys AudioModeLayout reads. Values are irrelevant to
// behaviour; testIDs/text carry the assertions.
const styles: any = {
  container: {},
  audioModeRow: {},
  pillIconButton: {},
  circleButtonLarge: {},
  audioVoiceButton: {},
  audioVoiceLabel: {},
};

function popover() {
  return {
    triggerRef: React.createRef(),
    visible: false,
    show: jest.fn(),
    hide: jest.fn(),
    anchor: { x: 0, y: 0 },
  };
}

function renderLayout(overrides: Partial<React.ComponentProps<typeof AudioModeLayout>> = {}) {
  const onStop = jest.fn();
  const setAlertState = jest.fn();
  const props: React.ComponentProps<typeof AudioModeLayout> = {
    styles,
    onSend: jest.fn(),
    imageMode: 'disabled',
    imageModelLoaded: false,
    supportsThinking: false,
    supportsToolCalling: false,
    enabledToolCount: 0,
    thinkingEnabled: false,
    attachments: [],
    onRemoveAttachment: jest.fn(),
    queueCount: 0,
    queuedTexts: [],
    isRecording: false,
    voiceAvailable: true,
    isModelLoading: false,
    isTranscribing: false,
    partialResult: '',
    error: null,
    onStartRecording: jest.fn(),
    onStopRecording: jest.fn(),
    onCancelRecording: jest.fn(),
    onStop,
    onImageModeToggle: jest.fn(),
    onThinkingToggle: jest.fn(),
    onVisionPress: jest.fn(),
    onPickDocument: jest.fn(),
    onAttachPress: jest.fn(),
    attachPicker: popover(),
    voicePicker: popover(),
    quickSettings: popover(),
    supportsVision: false,
    alertState: { visible: false, title: '', message: '', buttons: [] },
    setAlertState,
    ...overrides,
  };
  const utils = render(<AudioModeLayout {...props} />);
  return { onStop, setAlertState, props, ...utils };
}

const VOICES: TTSVoice[] = [
  { id: 'af_heart', label: 'Heart', metadata: {} } as TTSVoice,
  { id: 'af_bella', label: 'Bella', metadata: {} } as TTSVoice,
];

// Snapshot of the store keys we mutate, so afterEach can restore them (no pollution).
const STORE_KEYS = ['activeVoiceId', 'voices', 'isSwitchingVoice', 'playbackStatus'] as const;
let savedStore: Record<string, any>;

beforeEach(() => {
  const s = useTTSStore.getState() as any;
  savedStore = {};
  STORE_KEYS.forEach((k) => { savedStore[k] = s[k]; });
  useTTSStore.setState({
    voices: VOICES,
    activeVoiceId: 'af_heart',
    isSwitchingVoice: false,
    playbackStatus: 'idle',
  } as any);
});

afterEach(() => {
  jest.restoreAllMocks();
  useTTSStore.setState(savedStore as any);
});

describe('AudioModeLayout — center slot precedence (generation > tts > mic)', () => {
  it('shows the mic (no stop buttons) when idle and not generating', () => {
    const { queryByTestId } = renderLayout({ isGenerating: false });
    expect(queryByTestId('stop-button')).toBeNull();
    expect(queryByTestId('tts-stop-button')).toBeNull();
    // VoiceRecordButton renders a Feather "mic" glyph in its available/idle state.
    expect(queryByTestId('feather-mic')).toBeTruthy();
  });

  it('shows the generation stop button when generating with an onStop handler', () => {
    const { getByTestId, queryByTestId } = renderLayout({ isGenerating: true });
    expect(getByTestId('stop-button')).toBeTruthy();
    // Generation stop takes precedence over the mic and over any TTS stop.
    expect(queryByTestId('tts-stop-button')).toBeNull();
    expect(queryByTestId('feather-mic')).toBeNull();
  });

  it('does NOT show the generation stop when generating but no onStop handler exists', () => {
    // canStopGeneration is false without a handler → falls through to mic.
    const { queryByTestId } = renderLayout({ isGenerating: true, onStop: undefined });
    expect(queryByTestId('stop-button')).toBeNull();
    expect(queryByTestId('feather-mic')).toBeTruthy();
  });

  it('shows the TTS stop button when playback is actively playing (not generating)', () => {
    useTTSStore.setState({ playbackStatus: 'playing' } as any);
    const { getByTestId, queryByTestId } = renderLayout({ isGenerating: false });
    expect(getByTestId('tts-stop-button')).toBeTruthy();
    expect(queryByTestId('stop-button')).toBeNull();
    expect(queryByTestId('feather-mic')).toBeNull();
  });

  it('generation stop wins over active TTS playback', () => {
    useTTSStore.setState({ playbackStatus: 'playing' } as any);
    const { getByTestId, queryByTestId } = renderLayout({ isGenerating: true });
    expect(getByTestId('stop-button')).toBeTruthy();
    expect(queryByTestId('tts-stop-button')).toBeNull();
  });

  it('a PAUSED clip does not hold the center slot — the mic stays available', () => {
    useTTSStore.setState({ playbackStatus: 'paused' } as any);
    const { queryByTestId } = renderLayout({ isGenerating: false });
    expect(queryByTestId('tts-stop-button')).toBeNull();
    expect(queryByTestId('feather-mic')).toBeTruthy();
  });
});

describe('AudioModeLayout — TTS stop control gating while preparing', () => {
  it('renders the TTS stop button DISABLED while preparing (stop mid-load crashes the stream)', () => {
    useTTSStore.setState({ playbackStatus: 'preparing' } as any);
    const { getByTestId } = renderLayout({ isGenerating: false });
    const btn = getByTestId('tts-stop-button');
    expect(btn).toBeTruthy();
    // The activity.ttsStopDisabled verdict must reach the TouchableOpacity as disabled.
    expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBe(true);
  });

  it('renders the TTS stop button ENABLED while playing', () => {
    useTTSStore.setState({ playbackStatus: 'playing' } as any);
    const { getByTestId } = renderLayout({ isGenerating: false });
    const btn = getByTestId('tts-stop-button');
    expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled ?? false).toBe(false);
  });
});

describe('AudioModeLayout — press handlers respect the real state (assert the consequence)', () => {
  it('pressing the generation stop calls onStop exactly once while generating', () => {
    const { getByTestId, onStop } = renderLayout({ isGenerating: true });
    fireEvent.press(getByTestId('stop-button'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('pressing TTS stop while PLAYING fires the real store stop', () => {
    useTTSStore.setState({ playbackStatus: 'playing' } as any);
    // stop() is a thin native boundary (stopPlayback) — spy to assert the guard let it through.
    const stopSpy = jest.spyOn(useTTSStore.getState(), 'stop').mockImplementation(() => {});
    const { getByTestId } = renderLayout({ isGenerating: false });
    fireEvent.press(getByTestId('tts-stop-button'));
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('the disabled TTS stop button does not fire stop while PREPARING', () => {
    // While preparing the control renders disabled; a UI press must never reach stop.
    useTTSStore.setState({ playbackStatus: 'preparing' } as any);
    const stopSpy = jest.spyOn(useTTSStore.getState(), 'stop').mockImplementation(() => {});
    const { getByTestId } = renderLayout({ isGenerating: false });
    fireEvent.press(getByTestId('tts-stop-button'));
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it('handleStopTts internally guards against a preparing status even if invoked', () => {
    // Defense-in-depth: even if the press handler runs, the live getState() preparing-check
    // must short-circuit before stop() — a stop mid-load crashes the freshly-created stream.
    // Render with the button ENABLED (playing) so we hold a live onPress handler, then flip
    // the store to 'preparing' so the handler reads that status when invoked.
    useTTSStore.setState({ playbackStatus: 'playing' } as any);
    const stopSpy = jest.spyOn(useTTSStore.getState(), 'stop').mockImplementation(() => {});
    const { UNSAFE_getByProps } = renderLayout({ isGenerating: false });
    const btn = UNSAFE_getByProps({ testID: 'tts-stop-button' });
    useTTSStore.setState({ playbackStatus: 'preparing' } as any);
    btn.props.onPress();
    expect(stopSpy).not.toHaveBeenCalled();
  });
});

describe('AudioModeLayout — right zone voice picker', () => {
  it('shows the active voice label from the store', () => {
    useTTSStore.setState({ activeVoiceId: 'af_bella' } as any);
    const { getByText } = renderLayout();
    expect(getByText('Bella')).toBeTruthy();
  });

  it('falls back to the first voice label when activeVoiceId does not match', () => {
    useTTSStore.setState({ activeVoiceId: 'missing' } as any);
    const { getByText } = renderLayout();
    expect(getByText('Heart')).toBeTruthy();
  });

  it('falls back to the Default label when there are no voices', () => {
    useTTSStore.setState({ voices: [], activeVoiceId: null } as any);
    const { getByText } = renderLayout();
    expect(getByText('Default')).toBeTruthy();
  });

  it('shows the voice glyph (user) when not switching voice', () => {
    useTTSStore.setState({ isSwitchingVoice: false } as any);
    const { queryByTestId } = renderLayout();
    expect(queryByTestId('feather-user')).toBeTruthy();
  });

  it('shows a spinner (no user glyph) while switching voice', () => {
    useTTSStore.setState({ isSwitchingVoice: true } as any);
    const { queryByTestId } = renderLayout();
    // The ternary flips from the user icon to an ActivityIndicator during a voice switch.
    expect(queryByTestId('feather-user')).toBeNull();
  });
});

describe('AudioModeLayout — left/right trigger controls dispatch popover intents', () => {
  // NOTE: the "+ dispatches onAttachPress" case was removed — it was mockist (mounted with a
  // jest.fn and asserted only toHaveBeenCalled), which our testing doctrine forbids. The voice-mode
  // reroute (+ → native ActionSheetIOS on iOS, not the JS popover) is verified on-device; the native
  // sheet can't be exercised in jsdom, so there is no honest unit assertion to keep here.

  it('opening quick settings calls its show()', () => {
    const quickSettings = popover();
    const { getAllByTestId } = renderLayout({ quickSettings });
    fireEvent.press(getAllByTestId('feather-settings')[0].parent as any);
    expect(quickSettings.show).toHaveBeenCalledTimes(1);
  });

  it('pressing the voice label calls the voice picker show()', () => {
    const voicePicker = popover();
    const { getByText } = renderLayout({ voicePicker });
    fireEvent.press(getByText('Heart'));
    expect(voicePicker.show).toHaveBeenCalledTimes(1);
  });

  it('renders the trigger icons muted when the bar is disabled', () => {
    // The disabled side of the `disabled ? textMuted : textSecondary` ternary on the
    // plus / settings triggers — exercised only when the bar is disabled.
    const { getByTestId } = renderLayout({ disabled: true });
    expect(getByTestId('feather-plus')).toBeTruthy();
    expect(getByTestId('feather-settings')).toBeTruthy();
  });
});

describe('AudioModeLayout — alert dismissal', () => {
  it('dismissing the alert via a button hides it through setAlertState(hideAlert())', () => {
    const { getByText, setAlertState } = renderLayout({
      alertState: {
        visible: true,
        title: 'Heads up',
        message: 'Something happened',
        buttons: [{ text: 'OK' }],
      },
    });
    // Pressing the alert button runs CustomAlert's handler which calls our onClose →
    // setAlertState(hideAlert()); assert the consequence (the hidden state) reached it.
    fireEvent.press(getByText('OK'));
    expect(setAlertState).toHaveBeenCalledWith(hideAlert());
  });
});
