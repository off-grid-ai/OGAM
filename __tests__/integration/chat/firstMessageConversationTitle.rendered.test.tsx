import {
  CHAT_TEXT_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_TEXT_SCENARIOS)(
  'Mobile first-message conversation title journey on $label',
  scenario => {
    it('uses the first sent message as the visible conversation title', async () => {
      const h = await startChatScreen(scenario);
      const firstMessage = 'Plan a mountain trip';

      expect(h.assertions.isNewChatTitleVisible()).toBe(true);

      await h.send(firstMessage, { text: 'Where would you like to go?' });
      await h.rtl.waitFor(() => {
        expect(h.assertions.isFirstMessageUsedAsTitle(firstMessage)).toBe(true);
      });
    });
  },
);
