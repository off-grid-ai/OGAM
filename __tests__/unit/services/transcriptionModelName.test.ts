import { transcriptionModelName } from '../../../src/services/whisperModels';

describe('transcriptionModelName', () => {
  it('names an English-only Whisper model', () => {
    expect(transcriptionModelName('tiny.en')).toBe('Whisper Tiny (English)');
  });

  it('names a multilingual Whisper model', () => {
    expect(transcriptionModelName('large-v3')).toBe('Whisper Large v3');
  });

  it('keeps an unknown id as it is', () => {
    expect(transcriptionModelName('mystery-model')).toBe('mystery-model');
  });
});
