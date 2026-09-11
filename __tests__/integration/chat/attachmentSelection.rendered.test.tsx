import {
  CHAT_DOCUMENT_ATTACHMENT_SCENARIOS,
  CHAT_PHOTO_ATTACHMENT_SCENARIOS,
  startChatScreen,
} from '../../harness/chatHarness';

describe.each(CHAT_PHOTO_ATTACHMENT_SCENARIOS)(
  'Mobile photo attachment journey on $label',
  scenario => {
    it('shows the selected photo in the real Chat composer', async () => {
      const h = await startChatScreen(scenario);

      expect(h.assertions.isAttachedPhotoVisible()).toBe(true);
    });
  },
);

describe.each(CHAT_DOCUMENT_ATTACHMENT_SCENARIOS)(
  'Mobile document attachment journey on $label',
  scenario => {
    it('shows the selected document in the real Chat composer', async () => {
      const h = await startChatScreen(scenario);

      expect(h.assertions.isAttachedDocumentVisible()).toBe(true);
      expect(h.assertions.isDocumentNameVisible('document.txt')).toBe(true);
    });
  },
);
