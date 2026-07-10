/**
 * Interrupt + mode-switch edges for the two-mode audio journeys.
 *
 * Two seams:
 *  1. deriveAudioActivity — the bottom-bar center-action precedence
 *     (generation > TTS playback > mic) and the paused-is-not-busy rule that lets
 *     a recording supersede a paused clip. Pure; asserted on its verdict.
 *  2. ttsStore.updateSettings — switching interface mode (chat <-> audio) mid-turn
 *     MUST stop in-progress playback so audio from the old mode doesn't bleed into
 *     the new one. Driven against the REAL store; we assert stop() ran.
 */
import { deriveAudioActivity } from '../../../pro/audio/audioActivity';

describe('deriveAudioActivity — center-slot precedence', () => {
  const base = { canStopGeneration: false, playbackStatus: 'idle' as const, isSwitchingVoice: false };

  it('generation streaming wins over everything (even active TTS)', () => {
    const a = deriveAudioActivity({ ...base, canStopGeneration: true, playbackStatus: 'playing' });
    expect(a.action).toBe('generating-stop');
  });

  it('TTS playing → tts-stop when no generation', () => {
    expect(deriveAudioActivity({ ...base, playbackStatus: 'playing' }).action).toBe('tts-stop');
  });

  it('TTS preparing → tts-stop but the stop is DISABLED (mid-load crash guard)', () => {
    const a = deriveAudioActivity({ ...base, playbackStatus: 'preparing' });
    expect(a.action).toBe('tts-stop');
    expect(a.ttsStopDisabled).toBe(true);
  });

  it('PAUSED clip is NOT busy → the mic is available (recording can supersede it)', () => {
    const a = deriveAudioActivity({ ...base, playbackStatus: 'paused' });
    expect(a.action).toBe('mic');
    expect(a.ttsBusy).toBe(false);
  });

  it('idle → mic', () => {
    expect(deriveAudioActivity(base).action).toBe('mic');
  });

  it('voice-switch is reported alongside, never competing with the center action', () => {
    const a = deriveAudioActivity({ ...base, playbackStatus: 'playing', isSwitchingVoice: true });
    expect(a.action).toBe('tts-stop');
    expect(a.switchingVoice).toBe(true);
  });
});

describe('ttsStore.updateSettings — switching interface mode stops playback', () => {
  // Reset the persisted real store between tests.
  afterEach(() => {
    jest.resetModules();
  });

  it('chat -> audio while playing stops the current playback', () => {
    const { useTTSStore } = require('../../../pro/audio/ttsStore');
    const stopSpy = jest.fn();
    useTTSStore.setState({
      settings: { ...useTTSStore.getState().settings, interfaceMode: 'chat' },
      stop: stopSpy,
    });
    useTTSStore.getState().updateSettings({ interfaceMode: 'audio' });
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(useTTSStore.getState().settings.interfaceMode).toBe('audio');
  });

  it('a settings change that does NOT change the mode does not stop playback', () => {
    const { useTTSStore } = require('../../../pro/audio/ttsStore');
    const stopSpy = jest.fn();
    useTTSStore.setState({
      settings: { ...useTTSStore.getState().settings, interfaceMode: 'audio' },
      stop: stopSpy,
    });
    useTTSStore.getState().updateSettings({ interfaceMode: 'audio' });
    expect(stopSpy).not.toHaveBeenCalled();
  });
});
