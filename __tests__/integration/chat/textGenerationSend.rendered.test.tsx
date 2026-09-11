import {
  CHAT_TEXT_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_TEXT_SCENARIOS)(
  'Mobile text generation send journey on $label',
  scenario => {
    it('sends one message and shows the completed reply', async () => {
      const h = await startChatScreen(scenario);

      await h.send('Give me a short greeting.', {
        text: 'Hello from the first reply.',
      });
      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isResponseVisible('Hello from the first reply.'),
        ).toBe(true);
        expect(h.assertions.isComposerEnabled()).toBe(true);
      });

      expect(h.assertions.isChatErrorVisible('Generation Error')).toBe(false);
    });
  },
);
