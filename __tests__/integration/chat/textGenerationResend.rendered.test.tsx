import {
  CHAT_TEXT_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_TEXT_SCENARIOS)(
  'Mobile text generation resend journey on $label',
  scenario => {
    it('resends the original message and shows its replacement reply', async () => {
      const h = await startChatScreen(scenario);

      await h.send('Give me a short greeting.', {
        text: 'Hello from the first reply.',
      });
      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isResponseVisible('Hello from the first reply.'),
        ).toBe(true);
      });

      await h.resendLastUserMessage({
        text: 'Hello from the resent reply.',
      });

      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isUserMessageVisible('Give me a short greeting.'),
        ).toBe(true);
        expect(
          h.assertions.isResponseVisible('Hello from the resent reply.'),
        ).toBe(true);
        expect(
          h.assertions.isResponseHidden('Hello from the first reply.'),
        ).toBe(true);
        expect(h.assertions.isComposerEnabled()).toBe(true);
        expect(h.assertions.isActionMenuVisible()).toBe(false);
      });
      expect(h.assertions.isChatErrorVisible('Generation Error')).toBe(false);
    });

    it('removes the failed attempt when resend succeeds', async () => {
      const h = await startChatScreen(scenario);

      await h.send('Try this again.', {
        throwMessage: 'The first attempt failed.',
      });
      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isResponseVisible('The first attempt failed.'),
        ).toBe(true);
      });
      h.dismissAlert();

      await h.resendLastUserMessage({ text: 'The retry worked.' });

      await h.rtl.waitFor(() => {
        expect(h.assertions.isResponseVisible('The retry worked.')).toBe(true);
        expect(h.assertions.isResponseHidden('The first attempt failed.')).toBe(
          true,
        );
      });
    });
  },
);
