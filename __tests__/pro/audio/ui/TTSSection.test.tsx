/**
 * TTSSection tests — the pro TTS settings section (Interface Mode picker,
 * Enable-TTS toggle, Voice picker, Speed slider).
 *
 * Drives the REAL `useTTSStore` (via setState of real state) and the REAL
 * component. Asserts what the user SEES (the not-ready empty state vs the ready
 * controls; chat-mode-only toggle; the voice list; download progress vs the
 * ready check) and what pressing a control DOES to the store STATE (the mode
 * chip flips `settings.interfaceMode`; the switch flips `settings.enabled`;
 * tapping a voice sets `activeVoiceId`).
 *
 * Mocks are limited to genuine boundaries: the vector-icons render shim and the
 * native TTS registry / audio-playback singletons the store's side-effects call.
 * The store under assertion is NEVER mocked.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

// Render each Feather icon as a Text carrying its name, so a test can assert
// which glyph shows (check / check-circle / external-link) without reaching into
// the vector-icons internals.
jest.mock('react-native-vector-icons/Feather', () => {
  const RC = require('react');
  const { Text } = require('react-native');
  return (props: { name: string }) => RC.createElement(Text, { testID: `icon-${props.name}` }, props.name);
});

// Native boundaries the store's real side-effects reach into (updateSettings →
// stop() → ttsPlayback + ttsRegistry; interfaceMode='audio' → initializeEngine
// → ttsRegistry). No active engine in jest, so these are inert; mocking keeps
// the native audio/TTS singletons out of the test env. The store logic that
// mutates `settings`/`activeVoiceId` still runs for real.
// A minimal fake engine so the store's setVoice action proceeds (it bails when
// there is no active engine). setVoice does the real optimistic state update
// (activeVoiceId + voiceByEngine) before awaiting this boundary.
jest.mock('../../../../pro/audio/engine', () => {
  const engine = {
    id: 'kokoro',
    displayName: 'Kokoro TTS',
    capabilities: { peakRamMB: 82 },
    setVoice: jest.fn(async () => {}),
    stop: jest.fn(),
    getPhase: () => 'ready',
    getRequiredAssets: () => [{ id: 'a', sizeBytes: 82 * 1024 * 1024 }],
    isFullyDownloaded: () => true,
    initialize: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  };
  return {
    ttsRegistry: { getActiveEngine: () => engine, getRegisteredIds: () => ['kokoro'] },
    OuteTTSEngine: class {},
  };
});

// The residency lock/hardware are native boundaries; the mode switch's
// initializeEngine side-effect routes through them. Grant room so it proceeds
// without touching real device memory.
jest.mock('@offgrid/core/services/modelResidency', () => ({
  modelResidencyManager: {
    runExclusive: async (_label: string, fn: () => Promise<void>) => fn(),
    makeRoomFor: async () => ({ fits: true, evicted: [] as string[] }),
    register: jest.fn(),
  },
}));
jest.mock('../../../../pro/audio/ttsPlayback', () => ({
  playMessage: jest.fn(),
  seekMessage: jest.fn(),
  speakMessage: jest.fn(),
  stopPlayback: jest.fn(),
  pausePlayback: jest.fn(),
  resumePlayback: jest.fn(),
  stopStreamingPlayback: jest.fn(),
  setPlaybackSpeed: jest.fn(),
}));

import { TTSSection } from '@offgrid/pro/audio/ui/TTSSection';
import { useTTSStore } from '@offgrid/pro/audio/ttsStore';

const VOICES = [
  { id: 'af_heart', label: 'Warm', metadata: { accent: 'US', gender: 'Female', persona: 'Friendly' } },
  { id: 'bf_emma', label: 'Gentle', metadata: { accent: '', gender: '', persona: '' } },
] as any;

// Snapshot the pristine store so every test starts from the real defaults and
// leaves nothing mutated for other suites.
const INITIAL = useTTSStore.getState();

const setStore = (patch: Partial<ReturnType<typeof useTTSStore.getState>>) =>
  act(() => { useTTSStore.setState(patch); });

describe('TTSSection', () => {
  afterEach(() => {
    act(() => { useTTSStore.setState(INITIAL, true); });
    jest.clearAllMocks();
  });

  // ── Not-ready (empty) branch ─────────────────────────────────────────────
  describe('when no voice model is ready', () => {
    beforeEach(() => setStore({ ...INITIAL, isReady: false }));

    it('shows the "download in TTS Settings" empty state and none of the controls', () => {
      const { getByText, queryByTestId } = render(<TTSSection />);
      expect(getByText(/No voice models downloaded/)).toBeTruthy();
      // The ready-only controls are absent.
      expect(queryByTestId('tts-speed')).toBeNull();
      expect(queryByTestId('icon-check-circle')).toBeNull();
    });

    it('renders the TTS Settings link only when the navigate callback is provided, and pressing it calls back', () => {
      const onNavigate = jest.fn();
      const { getByText, getByTestId } = render(<TTSSection onNavigateToTTSSettings={onNavigate} />);
      // The link row shows the external-link icon + label.
      expect(getByTestId('icon-external-link')).toBeTruthy();
      fireEvent.press(getByText('TTS Settings'));
      expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    it('omits the link entirely when no navigate callback is given', () => {
      const { queryByText, queryByTestId } = render(<TTSSection />);
      expect(queryByText('TTS Settings')).toBeNull();
      expect(queryByTestId('icon-external-link')).toBeNull();
    });
  });

  // ── Ready branch ─────────────────────────────────────────────────────────
  describe('when a voice model is ready', () => {
    beforeEach(() =>
      setStore({
        ...INITIAL,
        isReady: true,
        voices: VOICES,
        activeVoiceId: 'af_heart',
        settings: { ...INITIAL.settings, interfaceMode: 'chat', enabled: true, speed: 1.0 },
      }),
    );

    it('shows the interface-mode picker, the voice list and the speed slider (not the empty state)', () => {
      const { getByText, getByTestId, queryByText } = render(<TTSSection />);
      expect(queryByText(/No voice models downloaded/)).toBeNull();
      expect(getByText('Interface Mode')).toBeTruthy();
      expect(getByText('Chat')).toBeTruthy();
      expect(getByText('Audio')).toBeTruthy();
      expect(getByText('Warm')).toBeTruthy();
      expect(getByText('Gentle')).toBeTruthy();
      expect(getByTestId('tts-speed-slider')).toBeTruthy();
    });

    it('shows the Chat-mode description and the Enable-TTS toggle while in chat mode', () => {
      const { getByText } = render(<TTSSection />);
      expect(getByText(/Chat Mode/)).toBeTruthy();
      expect(getByText('Enable TTS')).toBeTruthy();
    });

    it('hides the Enable-TTS toggle and shows the Audio-mode description while in audio mode', () => {
      act(() => {
        useTTSStore.setState({ settings: { ...useTTSStore.getState().settings, interfaceMode: 'audio' } });
      });
      const { getByText, queryByText } = render(<TTSSection />);
      expect(getByText(/Audio Mode/)).toBeTruthy();
      expect(queryByText('Enable TTS')).toBeNull();
    });

    // ── Voice picker interaction (real store action) ───────────────────────
    it('marks the active voice with a check and renders per-voice metadata', () => {
      const { getByText, getByTestId } = render(<TTSSection />);
      // Active voice (af_heart) shows the check glyph; its metadata joins accent + gender.
      expect(getByTestId('icon-check')).toBeTruthy();
      expect(getByText('US · Female')).toBeTruthy();
    });

    it('tapping a voice dispatches setVoice → activeVoiceId changes in the REAL store', async () => {
      const { getByText } = render(<TTSSection />);
      expect(useTTSStore.getState().activeVoiceId).toBe('af_heart');
      await act(async () => { fireEvent.press(getByText('Gentle')); });
      // The real setVoice action updates activeVoiceId immediately (optimistic).
      expect(useTTSStore.getState().activeVoiceId).toBe('bf_emma');
      expect(useTTSStore.getState().settings.voiceByEngine[useTTSStore.getState().settings.engineId]).toBe('bf_emma');
    });

    // ── Mode picker interaction (real store action) ────────────────────────
    it('tapping the Audio chip flips interfaceMode to "audio" in the REAL store', async () => {
      const { getByText } = render(<TTSSection />);
      expect(useTTSStore.getState().settings.interfaceMode).toBe('chat');
      await act(async () => { fireEvent.press(getByText('Audio')); });
      expect(useTTSStore.getState().settings.interfaceMode).toBe('audio');
    });

    it('tapping the Chat chip from audio mode flips interfaceMode back to "chat"', async () => {
      act(() => { useTTSStore.setState({ settings: { ...useTTSStore.getState().settings, interfaceMode: 'audio' } }); });
      const { getByText } = render(<TTSSection />);
      await act(async () => { fireEvent.press(getByText('Chat')); });
      expect(useTTSStore.getState().settings.interfaceMode).toBe('chat');
    });

    // ── Enable-TTS toggle interaction (real store action) ──────────────────
    it('toggling the Enable switch flips settings.enabled in the REAL store', async () => {
      const { UNSAFE_getByType } = render(<TTSSection />);
      const { Switch } = require('react-native');
      expect(useTTSStore.getState().settings.enabled).toBe(true);
      await act(async () => { fireEvent(UNSAFE_getByType(Switch), 'valueChange', false); });
      expect(useTTSStore.getState().settings.enabled).toBe(false);
    });

    // ── Speed slider interaction (real store action) ───────────────────────
    it('committing the speed slider updates settings.speed in the REAL store', async () => {
      const { getByTestId } = render(<TTSSection />);
      await act(async () => { fireEvent(getByTestId('tts-speed-slider'), 'slidingComplete', 1.5); });
      expect(useTTSStore.getState().settings.speed).toBe(1.5);
    });
  });

  // ── Voice-picker header status (downloading vs not-ready vs ready) ────────
  describe('voice-picker header status', () => {
    it('shows the download percentage while downloading', () => {
      setStore({
        ...INITIAL,
        isReady: true, // section body renders
        voices: VOICES,
        activeVoiceId: 'af_heart',
        isDownloading: true,
        overallDownloadProgress: 0.42,
        settings: { ...INITIAL.settings, interfaceMode: 'chat' },
      });
      const { getByText } = render(<TTSSection />);
      expect(getByText('42%')).toBeTruthy();
    });

    it('shows the ready check-circle when ready and not downloading', () => {
      setStore({
        ...INITIAL,
        isReady: true,
        voices: VOICES,
        activeVoiceId: 'af_heart',
        isDownloading: false,
        settings: { ...INITIAL.settings, interfaceMode: 'chat' },
      });
      const { getByTestId, queryByText } = render(<TTSSection />);
      expect(getByTestId('icon-check-circle')).toBeTruthy();
      expect(queryByText('42%')).toBeNull();
    });
  });
});
