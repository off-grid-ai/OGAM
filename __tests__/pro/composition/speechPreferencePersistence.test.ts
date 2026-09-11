import {
  decodePersistedSpeechPreferences,
  encodePersistedSpeechPreferences,
} from '@offgrid/pro/composition/speechPreferencePersistence';
import type { VoicePreferences } from '@offgrid/application';

describe('speech preference persistence', () => {
  it('restores hands-free turn settings from the durable speech record', () => {
    const saved: VoicePreferences = {
      voiceMode: true,
      turnMode: 'handsfree',
      silenceAfterSpeechMs: 2000,
      speakerDrainMs: 2000,
      ttsEnabled: true,
      speed: 1.25,
      transcriptionLanguage: 'auto',
    };

    const restored = decodePersistedSpeechPreferences(
      encodePersistedSpeechPreferences(saved),
      {},
    );

    expect(restored).toEqual(saved);
  });
});
