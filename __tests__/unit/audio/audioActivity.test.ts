/**
 * deriveAudioActivity — the single bottom-bar audio view-model. Verifies the explicit
 * precedence (generation > TTS playback > mic) so the View can never render
 * contradictory loaders, and that voice-switch is reported alongside the center action.
 */
import { deriveAudioActivity } from '../../../pro/audio/audioActivity';

const base = { canStopGeneration: false, playbackStatus: 'idle' as const, isSwitchingVoice: false };

describe('deriveAudioActivity', () => {
  it('is mic when nothing is happening', () => {
    const a = deriveAudioActivity(base);
    expect(a.action).toBe('mic');
    expect(a.ttsBusy).toBe(false);
    expect(a.ttsStopDisabled).toBe(false);
    expect(a.switchingVoice).toBe(false);
  });

  it('shows tts-stop while actively playing (busy)', () => {
    const a = deriveAudioActivity({ ...base, playbackStatus: 'playing' });
    expect(a.action).toBe('tts-stop');
    expect(a.ttsBusy).toBe(true);
  });

  it('a PAUSED clip is dormant → mic, not a stop button (the paused-shows-stop bug)', () => {
    const a = deriveAudioActivity({ ...base, playbackStatus: 'paused' });
    expect(a.action).toBe('mic');
    expect(a.ttsBusy).toBe(false);
  });

  it('disables the tts stop only while preparing (stop mid-load crashes the stream)', () => {
    expect(deriveAudioActivity({ ...base, playbackStatus: 'preparing' }).ttsStopDisabled).toBe(true);
    expect(deriveAudioActivity({ ...base, playbackStatus: 'playing' }).ttsStopDisabled).toBe(false);
  });

  it('generation stop OUTRANKS tts playback (precedence)', () => {
    const a = deriveAudioActivity({ ...base, canStopGeneration: true, playbackStatus: 'playing' });
    expect(a.action).toBe('generating-stop');
  });

  it('reports switchingVoice alongside any center action, never competing with it', () => {
    expect(deriveAudioActivity({ ...base, isSwitchingVoice: true }).switchingVoice).toBe(true);
    const playing = deriveAudioActivity({ ...base, playbackStatus: 'playing', isSwitchingVoice: true });
    expect(playing.action).toBe('tts-stop');
    expect(playing.switchingVoice).toBe(true);
  });
});
