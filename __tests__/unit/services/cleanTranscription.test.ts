/**
 * cleanTranscription — strips Whisper's no-speech markers so a silent/too-short
 * clip never surfaces "[BLANK_AUDIO]" (or similar) as message text. The single
 * source for "is there real speech here", used by the file + realtime paths.
 */
import { cleanTranscription } from '../../../src/services/whisperService';

describe('cleanTranscription', () => {
  it('returns empty for whisper no-speech markers', () => {
    for (const m of ['[BLANK_AUDIO]', '[ Silence ]', '[silence]', '[MUSIC]', '(silence)', '(speaking foreign language)']) {
      expect(cleanTranscription(m)).toBe('');
    }
  });

  it('returns empty for blank / punctuation-only results', () => {
    expect(cleanTranscription('')).toBe('');
    expect(cleanTranscription('   ')).toBe('');
    expect(cleanTranscription('...')).toBe('');
    expect(cleanTranscription('* * *')).toBe('');
  });

  it('keeps real speech', () => {
    expect(cleanTranscription('hello world')).toBe('hello world');
    expect(cleanTranscription('  draw a horse  ')).toBe('draw a horse');
  });

  it('strips a leading marker but keeps the speech after it', () => {
    expect(cleanTranscription('[BLANK_AUDIO] draw a horse')).toBe('draw a horse');
    expect(cleanTranscription('hello [ Silence ] world')).toBe('hello world');
  });
});
