/**
 * The real Mobile Kokoro catalog uses the shared customer-facing names and
 * language metadata, so Desktop and Mobile do not rename the same voice.
 */
import {
  getKokoroAssetSources,
  getKokoroTTSVoices,
} from '../../../pro/audio/engine/tts/engines/kokoro/voices';
import { models } from 'react-native-executorch/legacy';

describe('Kokoro voice catalog', () => {
  it('uses shared voice names and language labels', () => {
    const voices = getKokoroTTSVoices();

    const runtimeVoiceCount = Object.values(models.text_to_speech.kokoro)
      .reduce((count, language) => count + Object.keys(language).length, 0);
    expect(voices).toHaveLength(runtimeVoiceCount);

    expect(voices.find(voice => voice.id === 'af_heart')).toMatchObject({
      label: 'Heart',
      metadata: { language: 'English (US)' },
    });
    expect(voices.find(voice => voice.id === 'bf_emma')).toMatchObject({
      label: 'Emma',
      metadata: { language: 'English (UK)' },
    });
    expect(voices.find(voice => voice.id === 'hf_alpha')).toMatchObject({
      label: 'Alpha',
      metadata: { language: 'Hindi' },
    });
    expect(voices.find(voice => voice.id === 'df_anna')).toMatchObject({
      label: 'Anna',
      metadata: { language: 'German' },
    });
  });

  it('resolves a complete downloadable asset package for every voice', () => {
    for (const voice of getKokoroTTSVoices()) {
      const sources = getKokoroAssetSources(voice.id as Parameters<typeof getKokoroAssetSources>[0]);
      expect(sources.length).toBeGreaterThanOrEqual(3);
      expect(sources.every(source => source.startsWith('https://'))).toBe(true);
      expect(sources.some(source => source.includes(`/voices/${voice.id}.bin`))).toBe(true);
    }
  });
});
