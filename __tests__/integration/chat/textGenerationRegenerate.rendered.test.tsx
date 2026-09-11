import {
  CHAT_TEXT_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_TEXT_SCENARIOS)(
  'Mobile text generation regenerate journey on $label',
  scenario => {
    it('regenerates an assistant response and shows its replacement', async () => {
      const h = await startChatScreen(scenario);

      await h.send('Give me a short greeting.', {
        text: 'Hello from the first reply.',
      });
      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isResponseVisible('Hello from the first reply.'),
        ).toBe(true);
      });

      await h.regenerateLast(
        { text: 'Hello from the regenerated reply.' },
        'dots',
      );

      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isUserMessageVisible('Give me a short greeting.'),
        ).toBe(true);
        expect(
          h.assertions.isResponseVisible('Hello from the regenerated reply.'),
        ).toBe(true);
        expect(
          h.assertions.isResponseHidden('Hello from the first reply.'),
        ).toBe(true);
        expect(h.assertions.isComposerEnabled()).toBe(true);
        expect(h.assertions.isActionMenuVisible()).toBe(false);
      });
      expect(h.assertions.isChatErrorVisible('Generation Error')).toBe(false);
    });
  },
);
