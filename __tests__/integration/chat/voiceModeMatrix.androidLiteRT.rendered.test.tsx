import {
  testVoiceModeJourney,
  usingVoiceScenarios,
} from './voiceModeJourney.shared';

testVoiceModeJourney(
  usingVoiceScenarios({ platform: 'android', textEngine: 'litert' }),
);
