import {
  CHAT_TEXT_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_TEXT_SCENARIOS)(
  'Mobile text streaming visibility on $label',
  scenario => {
    it('shows the assistant bubble while text is still streaming', async () => {
      const h = await startChatScreen(scenario);
      const partial = 'The first part is visible';
      const complete = `${partial}, and then the reply finishes.`;

      h.scriptTextTurn({
        text: complete,
        pauseAfter: partial,
      });
      await h.tapSend('Stream a reply');

      await h.rtl.waitFor(() => {
        expect(h.assertions.isResponseVisible(partial)).toBe(true);
        expect(h.assertions.isStopControlVisible()).toBe(true);
        expect(h.assertions.isResponseHidden(complete)).toBe(true);
      });

      h.releaseTextStream();
      await h.rtl.waitFor(() => {
        expect(h.assertions.isResponseVisible(complete)).toBe(true);
        expect(h.assertions.isComposerEnabled()).toBe(true);
        expect(h.assertions.isStopControlVisible()).toBe(false);
        expect(h.assertions.isChatErrorVisible('Generation Error')).toBe(false);
      });
    });
  },
);
