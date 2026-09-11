import {
  testVoiceModeJourney,
  usingVoiceScenarios,
} from './voiceModeJourney.shared';

testVoiceModeJourney(
  usingVoiceScenarios({
    platform: 'ios',
    textEngine: 'remote',
    remoteProvider: 'offgrid-desktop',
  }),
);
