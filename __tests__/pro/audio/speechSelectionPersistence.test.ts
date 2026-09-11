import {
  decodeLegacyVoiceSelections,
  decodeVoiceSelections,
} from '@offgrid/pro/audio/speechSelectionPersistence';

describe('speech voice selection persistence', () => {
  it('restores the selected voice for each model route', () => {
    expect(
      decodeVoiceSelections(
        JSON.stringify({
          voiceByRoute: {
            'mobile:remote:gateway:voice:flux': 'flux-alexis-en',
          },
        }),
      ),
    ).toEqual({
      'mobile:remote:gateway:voice:flux': 'flux-alexis-en',
    });
  });

  it('migrates voice choices from the legacy TTS settings record', () => {
    expect(
      decodeLegacyVoiceSelections(
        JSON.stringify({
          state: {
            settings: {
              engineId: 'kokoro',
              selectedVoiceId: 'af_heart',
              voiceByEngine: { remoteRoute: 'flux-alexis-en' },
            },
          },
        }),
      ),
    ).toEqual({
      kokoro: 'af_heart',
      remoteRoute: 'flux-alexis-en',
    });
  });
});
