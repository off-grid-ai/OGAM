import {
  CHAT_VOICE_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';
import type { ChatScenario } from '../../harness/chatScenario';

type VoiceScenarioSelection = {
  platform: 'android' | 'ios';
  textEngine: 'litert' | 'llama' | 'remote';
  remoteProvider?: 'lmstudio' | 'ollama' | 'offgrid-desktop';
};

export function usingVoiceScenarios({
  platform,
  textEngine,
  remoteProvider,
}: VoiceScenarioSelection): ChatScenario[] {
  return CHAT_VOICE_SCENARIOS.filter(
    scenario =>
      scenario.platform === platform &&
      scenario.engine === textEngine &&
      scenario.remoteTextProvider === remoteProvider,
  );
}

export function testVoiceModeJourney(scenarios: readonly ChatScenario[]): void {
  describe.each(scenarios)('Mobile voice chat journey on $label', scenario => {
    it('transcribes speech, sends it, and shows a playable spoken response', async () => {
      const h = await startChatScreen(scenario);

      await h.voiceSend('Tell me about Off Grid.', {
        text: 'Off Grid keeps your work private.',
      });

      await h.rtl.waitFor(
        () => {
          expect(
            h.assertions.isResponseVisible(
              'Off Grid keeps your work private.',
            ),
          ).toBe(true);
          expect(h.assertions.isVoicePlaybackControlVisible()).toBe(true);
        },
        { timeout: 5000 },
      );
      expect(
        await h.assertions.isVoiceTranscriptClickable(
          'Off Grid keeps your work private.',
        ),
      ).toBe(true);
    });
  });
}
