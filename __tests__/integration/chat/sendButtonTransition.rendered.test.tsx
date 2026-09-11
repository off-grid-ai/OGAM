import {
  CHAT_TEXT_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_TEXT_SCENARIOS)(
  'Mobile chat send control transition on $label',
  scenario => {
    it('shows the existing loading indicator immediately, then shows Stop while the reply is running', async () => {
      const h = await startChatScreen(scenario);

      h.scriptTextTurn({
        text: 'This reply must stay in progress.',
        holdBeforeStream: true,
      });

      await h.tapSend('Send this now');

      expect(h.assertions.isSendLoadingVisible()).toBe(true);
      expect(h.assertions.isSendControlVisible()).toBe(false);

      await h.rtl.waitFor(() => {
        expect(h.assertions.isStopControlVisible()).toBe(true);
        expect(h.assertions.isSendLoadingVisible()).toBe(false);
      });

      h.stopGeneration();
      await h.rtl.waitFor(() => {
        expect(h.assertions.isUserMessageVisible('Send this now')).toBe(true);
        expect(h.assertions.isComposerEnabled()).toBe(true);
        expect(h.assertions.isStopControlVisible()).toBe(false);
        expect(h.assertions.isChatErrorVisible('Generation Error')).toBe(false);
      });
    });
  },
);
