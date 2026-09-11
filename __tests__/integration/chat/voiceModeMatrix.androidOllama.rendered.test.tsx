import {
  testVoiceModeJourney,
  usingVoiceScenarios,
} from './voiceModeJourney.shared';

testVoiceModeJourney(
  usingVoiceScenarios({
    platform: 'android',
    textEngine: 'remote',
    remoteProvider: 'ollama',
  }),
);
