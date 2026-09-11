import {
  CHAT_TEXT_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_TEXT_SCENARIOS)(
  'Mobile assistant response edit journey on $label',
  scenario => {
    it('edits a response in place without resending the user message', async () => {
      const h = await startChatScreen(scenario);

      await h.send('Give me a short greeting.', {
        text: 'Hello from the original response.',
      });
      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isResponseVisible('Hello from the original response.'),
        ).toBe(true);
      });

      await h.openMessageEditor('user');
      expect(h.assertions.isSelectTextActionVisible()).toBe(false);
      await h.rtl.waitFor(() => {
        expect(h.assertions.isUserMessageEditorVisible()).toBe(true);
      });
      h.cancelOpenEditor();

      await h.openMessageEditor('assistant');
      expect(h.assertions.isSelectTextActionVisible()).toBe(false);
      expect(h.assertions.isAssistantResponseEditorVisible()).toBe(true);

      h.replaceOpenEditorText('Hello from the edited response.');
      h.saveAssistantResponseEdit();

      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isUserMessageVisible('Give me a short greeting.'),
        ).toBe(true);
        expect(
          h.assertions.isResponseVisible('Hello from the edited response.'),
        ).toBe(true);
        expect(
          h.assertions.isResponseHidden('Hello from the original response.'),
        ).toBe(true);
        expect(h.assertions.isMessageEditorClosed()).toBe(true);
        expect(h.assertions.isComposerEnabled()).toBe(true);
      });
      expect(h.assertions.isChatErrorVisible('Generation Error')).toBe(false);
      expect(h.assertions.isChatErrorVisible('Edit Error')).toBe(false);
    });
  },
);
