import {
  CHAT_TEXT_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_TEXT_SCENARIOS)(
  'Mobile text generation edit journey on $label',
  scenario => {
    it('keeps a start-of-message edit through a keyboard render and resends it', async () => {
      const h = await startChatScreen(scenario);

      await h.send('Give me a short greeting.', {
        text: 'Hello from the first reply.',
      });
      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isResponseVisible('Hello from the first reply.'),
        ).toBe(true);
      });

      await h.openMessageEditor('user');
      await h.focusOpenEditorAtStartWithKeyboardVisible();
      h.replaceOpenEditorText('Please give me a short greeting.');
      expect(
        h.assertions.isEditorTextVisible('Please give me a short greeting.'),
      ).toBe(true);

      h.saveUserEditAndResend({
        text: 'Hello from the edited reply.',
      });

      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isUserMessageVisible('Please give me a short greeting.'),
        ).toBe(true);
        expect(
          h.assertions.isResponseVisible('Hello from the edited reply.'),
        ).toBe(true);
        expect(
          h.assertions.isUserMessageVisible('Give me a short greeting.'),
        ).toBe(false);
        expect(
          h.assertions.isResponseHidden('Hello from the first reply.'),
        ).toBe(true);
        expect(h.assertions.isMessageEditorClosed()).toBe(true);
        expect(h.assertions.isComposerEnabled()).toBe(true);
      });
      expect(h.assertions.isChatErrorVisible('Generation Error')).toBe(false);
    });
  },
);
