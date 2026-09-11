import {
  CHAT_THINKING_DISABLED_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_THINKING_DISABLED_SCENARIOS)(
  'Mobile chat send with Thinking disabled on $label',
  scenario => {
    it('disables Thinking in quick settings and shows the clean reply to the next message', async () => {
      const h = await startChatScreen(scenario);

      await h.send('Give me a short greeting.', {
        text: 'Hello without thinking.',
        thinkingText: 'Reasoning that must stay hidden.',
      });
      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isUserMessageVisible('Give me a short greeting.'),
        ).toBe(true);
        expect(h.assertions.isResponseVisible('Hello without thinking.')).toBe(
          true,
        );
        expect(h.assertions.isComposerEnabled()).toBe(true);
      });

      expect(h.assertions.isThinkingVisible()).toBe(false);
      expect(
        h.assertions.isResponseHidden('Reasoning that must stay hidden.'),
      ).toBe(true);
      expect(h.assertions.isChatErrorVisible('Generation Error')).toBe(false);
    });
  },
);
