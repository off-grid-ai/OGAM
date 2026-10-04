import type { MessageRecord } from '@offgrid/application';
import { retainedMobileMessageByteIdentities } from '../../../../src/services/adapters/workspaceContent/mobileLocalContentOwnership';

function message(
  local: NonNullable<MessageRecord['local']>,
): MessageRecord {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    turnId: null,
    position: 0,
    portable: {
      role: 'user',
      content: [
        { type: 'text', text: 'Image' },
        { type: 'image', contentId: 'image-1' },
      ],
    },
    local,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
  };
}

describe('Mobile local content ownership', () => {
  it.each([
    ['canonical identity and file URI', { contentId: 'image-1' }, 'file:///images/image-1.png'],
    ['canonical identity and legacy absolute path', { contentId: 'image-1' }, '/images/image-1.png'],
    ['legacy index and file URI', { index: 1 }, 'file:///images/image-1.png'],
    ['legacy index and absolute path', { index: 1 }, '/images/image-1.png'],
  ] as const)('resolves %s through the shared identity policy', (_, identity, uri) => {
    const locations = [{ ...identity, uri }];

    expect(
      retainedMobileMessageByteIdentities([
        message({ contentLocations: locations }),
      ]),
    ).toEqual(
      new Set([
        'gallery:image-1',
        'file:/images/image-1.png',
      ]),
    );
  });

  it('rejects a legacy index that does not resolve to portable media', () => {
    expect(() =>
      retainedMobileMessageByteIdentities([
        message({
          contentLocations: [
            { index: 0, uri: 'file:///images/image-1.png' },
          ],
        }),
      ]),
    ).toThrow('Attachment bytes do not have a stable contentId.');
  });
});
