import {
  CHAT_DOCUMENT_ATTACHMENT_SCENARIOS,
  CHAT_PHOTO_ATTACHMENT_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_PHOTO_ATTACHMENT_SCENARIOS)(
  'Mobile vision message journey on $label',
  scenario => {
    it('sends the selected photo and shows the visible model response', async () => {
      const h = await startChatScreen(scenario);

      expect(h.assertions.isAttachedPhotoVisible()).toBe(true);
      await h.send('What is in this photo?', {
        text: 'The photo contains a dog.',
      });

      await h.rtl.waitFor(() => {
        expect(h.assertions.isResponseVisible('The photo contains a dog.')).toBe(
          true,
        );
      });
    });
  },
);

describe.each(CHAT_DOCUMENT_ATTACHMENT_SCENARIOS)(
  'Mobile document message journey on $label',
  scenario => {
    it('sends the selected document and shows the visible model response', async () => {
      const h = await startChatScreen(scenario);

      expect(h.assertions.isAttachedDocumentVisible()).toBe(true);
      await h.send('Summarize the attached document.', {
        text: 'The document describes a selected test fixture.',
      });

      await h.rtl.waitFor(() => {
        expect(
          h.assertions.isResponseVisible(
            'The document describes a selected test fixture.',
          ),
        ).toBe(true);
      });
    });
  },
);
