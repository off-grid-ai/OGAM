import type { MessageRecord } from '@offgrid/application';
import { projectWorkspaceMessage } from '../../../../src/services/adapters/workspaceContent/projectWorkspaceMessage';

function imageMessage(uri: string): MessageRecord {
  return {
    id: 'message-1',
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    position: 0,
    portable: {
      role: 'assistant',
      content: [
        {
          type: 'image',
          contentId: 'image-1',
          mimeType: 'image/png',
          width: 512,
          height: 512,
        },
      ],
    },
    local: {
      contentLocations: [{ contentId: 'image-1', uri }],
    },
    createdAt: '2026-09-09T16:00:00.000Z',
    updatedAt: '2026-09-09T16:00:00.000Z',
  };
}

describe('projectWorkspaceMessage attachment locations', () => {
  it('presents an Android absolute image path as a file URI', () => {
    const projected = projectWorkspaceMessage(
      imageMessage('/data/user/0/ai.offgridmobile.dev/files/generated_media/image-1.png'),
    );

    expect(projected.attachments?.[0]?.uri).toBe(
      'file:///data/user/0/ai.offgridmobile.dev/files/generated_media/image-1.png',
    );
  });

  it('does not add a second scheme to an existing file URI', () => {
    const projected = projectWorkspaceMessage(
      imageMessage('file:///data/user/0/ai.offgridmobile.dev/files/image-1.png'),
    );

    expect(projected.attachments?.[0]?.uri).toBe(
      'file:///data/user/0/ai.offgridmobile.dev/files/image-1.png',
    );
  });

  it('preserves a content URI', () => {
    const projected = projectWorkspaceMessage(
      imageMessage('content://ai.offgridmobile.dev/image-1'),
    );

    expect(projected.attachments?.[0]?.uri).toBe(
      'content://ai.offgridmobile.dev/image-1',
    );
  });
});
