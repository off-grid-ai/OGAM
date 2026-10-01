import { useAppStore } from '@offgrid/core/stores/appStore';
import { useChatStore } from '@offgrid/core/stores/chatStore';
import type { Conversation, Message } from '@offgrid/core/types';
import type { MobileSharedFileRecord } from '../../../pro/sync/sharedFileStore';
import {
  materializeSharedFile,
  removeMaterializedSharedFile,
} from '../../../pro/sync/sharedFileMaterializer';

/**
 * Making a file that arrived over the mesh show up where the user expects it.
 *
 * A transferred file on disk is not yet a thing the user can find. A picture generated on the Mac has to
 * appear in the phone's gallery; a file the Mac attached to a message has to appear on THAT message in
 * THAT conversation. This is the step that puts it there, and it runs against the app's real stores.
 *
 * Both directions are asserted through the stores rather than through the writer, because the failures
 * that matter are shaped like store state: an image added twice when a transfer is retried, an attachment
 * grafted onto the wrong message, or a rebuilt conversation object that quietly re-renders every chat.
 *
 * Metadata rides along as JSON written by another device on another version, so every field it carries is
 * treated as untrusted and has a defined fallback.
 */
describe('making a transferred file appear in the app', () => {
  const record = (
    overrides: Partial<MobileSharedFileRecord> = {},
  ): MobileSharedFileRecord =>
    ({
      syncId: 'shared-1',
      kind: 'generated_media',
      name: 'a lighthouse at dusk.png',
      mimeType: 'image/png',
      fileSize: 4096,
      createdAt: '2026-08-01T10:00:00.000Z',
      localPath: '/docs/shared_files/lighthouse.png',
      ...overrides,
    } as MobileSharedFileRecord);

  const message = (overrides: Partial<Message> = {}): Message => ({
    id: 'row-1',
    uuid: 'message-1',
    role: 'assistant',
    content: 'here it is',
    timestamp: 1_700_000_000_000,
    ...overrides,
  });

  const conversation = (
    overrides: Partial<Conversation> = {},
  ): Conversation => ({
    id: 'chat-7',
    title: 'Lighthouses',
    modelId: 'gemma',
    messages: [message()],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:30:00.000Z',
    ...overrides,
  });

  const gallery = () => useAppStore.getState().generatedImages;
  const chats = () => useChatStore.getState().conversations;
  const attachmentsOn = (conversationId: string, messageUuid: string) =>
    chats()
      .find(({ id }) => id === conversationId)
      ?.messages.find(({ uuid }) => uuid === messageUuid)?.attachments ?? [];

  beforeEach(() => {
    useAppStore.setState({ generatedImages: [], generatedVideos: [] });
    useChatStore.setState({ conversations: [] });
  });

  describe('a video generated on another device', () => {
    const video = () => record({
      mimeType: 'video/mp4', name: 'lake.mp4', localPath: '/docs/shared_files/lake.mp4',
      conversationId: 'chat-7', messageId: 'message-1', width: 320, height: 192,
      durationSeconds: 2.125,
      metadataJson: JSON.stringify({ prompt: 'A moving lake', steps: 20, guidance: 6, seed: 42, modelId: 'wan', fps: 8, frames: 17 }),
    });
    it('appears once in the video gallery and on its message after repeated delivery', () => {
      useChatStore.setState({ conversations: [conversation()] });
      materializeSharedFile(video());
      materializeSharedFile(video());
      expect(gallery()).toEqual([]);
      expect(useAppStore.getState().generatedVideos).toHaveLength(1);
      expect(useAppStore.getState().generatedVideos[0]).toMatchObject({ prompt: 'A moving lake', durationSeconds: 2.125, fps: 8, seed: 42 });
      expect(attachmentsOn('chat-7', 'message-1')).toHaveLength(1);
      expect(attachmentsOn('chat-7', 'message-1')[0]).toMatchObject({ type: 'video', mimeType: 'video/mp4' });
    });
    it('removes the gallery entry and chat attachment when the shared video is deleted', () => {
      useChatStore.setState({ conversations: [conversation()] });
      materializeSharedFile(video());
      removeMaterializedSharedFile(video());
      expect(useAppStore.getState().generatedVideos).toEqual([]);
      expect(attachmentsOn('chat-7', 'message-1')).toEqual([]);
    });
  });

  describe('a picture generated on another device', () => {
    it('appears in the gallery, with the prompt that made it', () => {
      materializeSharedFile(
        record({
          width: 768,
          height: 512,
          conversationId: 'chat-7',
          metadataJson: JSON.stringify({
            prompt: 'a lighthouse at dusk',
            negativePrompt: 'daylight',
            steps: 24,
            seed: 99,
            modelId: 'sdxl-turbo',
          }),
        }),
      );

      // The gallery entry is the point: the file is on disk either way, but until this row exists there is
      // nothing for the user to tap.
      expect(gallery()).toEqual([
        {
          id: 'shared-1',
          provenance: undefined,
          prompt: 'a lighthouse at dusk',
          negativePrompt: 'daylight',
          imagePath: '/docs/shared_files/lighthouse.png',
          // The name the MESH knows, which is deliberately not this path's basename. Deriving it from
          // the path put the local `<syncId>-` storage prefix onto the wire, so the name grew another
          // syncId on every hop.
          fileName: 'a lighthouse at dusk.png',
          width: 768,
          height: 512,
          steps: 24,
          seed: 99,
          modelId: 'sdxl-turbo',
          createdAt: '2026-08-01T10:00:00.000Z',
          conversationId: 'chat-7',
        },
      ]);
    });

    it('keeps the record of which device it came from', () => {
      materializeSharedFile(
        record({
          provenance: { originDeviceId: 'the-mac', originDeviceName: 'Mac' },
        }),
      );

      // Attribution is why the gallery can say where a picture came from - and it is the only copy of that
      // fact, since the file itself carries none.
      expect(gallery()[0].provenance).toEqual({
        originDeviceId: 'the-mac',
        originDeviceName: 'Mac',
      });
    });

    it('does not add it twice when the same file arrives again', () => {
      materializeSharedFile(record());
      materializeSharedFile(record({ localPath: '/docs/re-transferred.png' }));

      // A retried or re-announced transfer is normal. Two rows would be two identical pictures in the
      // gallery with no way to tell which is real.
      expect(gallery()).toHaveLength(1);
      expect(gallery()[0].imagePath).toBe('/docs/shared_files/lighthouse.png');
    });

    it.each([
      ['no metadata at all', undefined],
      ['metadata truncated in transfer', '{"prompt":'],
      ['metadata that is not an object', '5'],
      ['metadata that is literally null', 'null'],
      [
        'metadata whose fields are the wrong types',
        '{"prompt":7,"steps":"24"}',
      ],
    ])(
      'still shows the picture when it arrives with %s',
      (_label, metadataJson) => {
        materializeSharedFile(record({ metadataJson }));

        // Metadata is written by another device on another version, so it is optional by definition. The
        // picture appearing at all matters more than the prompt being right.
        expect(gallery()).toHaveLength(1);
        expect(gallery()[0]).toMatchObject({
          prompt: 'a lighthouse at dusk.png',
          negativePrompt: undefined,
          steps: 0,
          seed: 0,
          modelId: 'synced',
          // Not zero: a zero-sized image is undisplayable, so an unknown size becomes the smallest real one.
          width: 1,
          height: 1,
        });
      },
    );
  });

  describe('a file attached to a message', () => {
    it('appears on that message, in that conversation', () => {
      useChatStore.setState({ conversations: [conversation()] });

      materializeSharedFile(
        record({
          kind: 'message_attachment',
          name: 'contract.pdf',
          mimeType: 'application/pdf',
          conversationId: 'chat-7',
          messageId: 'message-1',
          metadataJson: JSON.stringify({ attachmentType: 'document' }),
        }),
      );

      expect(attachmentsOn('chat-7', 'message-1')).toEqual([
        {
          id: 'shared-1',
          type: 'document',
          // Prefixed for the renderer: an attachment uri without a scheme resolves to nothing.
          uri: 'file:///docs/shared_files/lighthouse.png',
          mimeType: 'application/pdf',
          fileName: 'contract.pdf',
          fileSize: 4096,
          width: undefined,
          height: undefined,
          audioDurationSeconds: undefined,
          audioFormat: undefined,
        },
      ]);
      // The gallery is not involved: an attachment is not a generated picture.
      expect(gallery()).toEqual([]);
    });

    it('carries the numbers the player and the image view need', () => {
      useChatStore.setState({ conversations: [conversation()] });

      materializeSharedFile(
        record({
          kind: 'message_attachment',
          conversationId: 'chat-7',
          messageId: 'message-1',
          width: 1024,
          height: 768,
          durationSeconds: 12.5,
          metadataJson: JSON.stringify({
            attachmentType: 'audio',
            audioFormat: 'wav',
          }),
        }),
      );

      expect(attachmentsOn('chat-7', 'message-1')[0]).toMatchObject({
        type: 'audio',
        width: 1024,
        height: 768,
        audioDurationSeconds: 12.5,
        audioFormat: 'wav',
      });
    });

    it.each([
      ['a type this build does not know', 'video', 'image'],
      ['no type at all', undefined, 'image'],
      ['an image', 'image', 'image'],
      ['audio', 'audio', 'audio'],
    ])('treats %s as %s', (_label, attachmentType, expected) => {
      useChatStore.setState({ conversations: [conversation()] });

      materializeSharedFile(
        record({
          kind: 'message_attachment',
          conversationId: 'chat-7',
          messageId: 'message-1',
          metadataJson: JSON.stringify({ attachmentType }),
        }),
      );

      // With no usable declared type, the FILE decides - this record is a PNG. Falling straight to
      // 'document' hung a picture in the chat as a file row, which is how a synced generated image
      // arrived. An unknown type would render as nothing at all, so there is still always a fallback.
      expect(attachmentsOn('chat-7', 'message-1')[0].type).toBe(expected);
    });

    it('falls back to a document when the file is not one it can show', () => {
      useChatStore.setState({ conversations: [conversation()] });

      materializeSharedFile(
        record({
          kind: 'message_attachment',
          conversationId: 'chat-7',
          messageId: 'message-1',
          mimeType: 'application/pdf',
          metadataJson: JSON.stringify({}),
        }),
      );

      expect(attachmentsOn('chat-7', 'message-1')[0].type).toBe('document');
    });

    it.each([
      ['an unknown audio format', 'ogg'],
      ['no audio format', undefined],
    ])('leaves the format unset for %s', (_label, audioFormat) => {
      useChatStore.setState({ conversations: [conversation()] });

      materializeSharedFile(
        record({
          kind: 'message_attachment',
          conversationId: 'chat-7',
          messageId: 'message-1',
          metadataJson: JSON.stringify({
            attachmentType: 'audio',
            audioFormat,
          }),
        }),
      );

      // Unset rather than passed through: the player is asked to decode only what it can decode.
      expect(
        attachmentsOn('chat-7', 'message-1')[0].audioFormat,
      ).toBeUndefined();
    });

    it('does not attach it twice when the same file arrives again', () => {
      useChatStore.setState({ conversations: [conversation()] });
      const arriving = record({
        kind: 'message_attachment',
        conversationId: 'chat-7',
        messageId: 'message-1',
      });

      materializeSharedFile(arriving);
      materializeSharedFile(arriving);

      expect(attachmentsOn('chat-7', 'message-1')).toHaveLength(1);
    });

    it('adds it alongside an attachment the message already had', () => {
      useChatStore.setState({
        conversations: [
          conversation({
            messages: [
              message({
                attachments: [
                  {
                    id: 'already-here',
                    type: 'image',
                    uri: 'file:///docs/existing.png',
                  },
                ],
              }),
            ],
          }),
        ],
      });

      materializeSharedFile(
        record({
          kind: 'message_attachment',
          conversationId: 'chat-7',
          messageId: 'message-1',
        }),
      );

      expect(attachmentsOn('chat-7', 'message-1').map(({ id }) => id)).toEqual([
        'already-here',
        'shared-1',
      ]);
    });

    it('leaves every other message and conversation untouched', () => {
      const otherChat = conversation({ id: 'chat-9' });
      const otherMessage = message({ id: 'row-2', uuid: 'message-2' });
      useChatStore.setState({
        conversations: [
          conversation({ messages: [message(), otherMessage] }),
          otherChat,
        ],
      });

      materializeSharedFile(
        record({
          kind: 'message_attachment',
          conversationId: 'chat-7',
          messageId: 'message-1',
        }),
      );

      // Identity, not equality: a rebuilt object re-renders. On a long chat list that is every row
      // flickering because one file arrived.
      expect(chats()[1]).toBe(otherChat);
      expect(chats()[0].messages[1]).toBe(otherMessage);
    });

    it('changes nothing when the conversation it names is not on this device', () => {
      const existing = conversation();
      useChatStore.setState({ conversations: [existing] });

      materializeSharedFile(
        record({
          kind: 'message_attachment',
          conversationId: 'a-chat-that-was-deleted',
          messageId: 'message-1',
        }),
      );

      // Not a crash and not a stray attachment: the file stays on disk, findable through the file list.
      expect(chats()[0]).toBe(existing);
    });

    it('changes nothing when the message it names is gone', () => {
      useChatStore.setState({ conversations: [conversation()] });

      materializeSharedFile(
        record({
          kind: 'message_attachment',
          conversationId: 'chat-7',
          messageId: 'a-message-that-was-deleted',
        }),
      );

      expect(attachmentsOn('chat-7', 'message-1')).toEqual([]);
    });
  });

  it('leaves a plain file alone - it belongs to the file list, not the gallery or a chat', () => {
    const existing = conversation();
    useChatStore.setState({ conversations: [existing] });

    materializeSharedFile(record({ kind: 'file' }));

    expect(gallery()).toEqual([]);
    expect(chats()[0]).toBe(existing);
  });
});

describe('taking a transferred file back out of the app', () => {
  const gallery = () => useAppStore.getState().generatedImages;
  const chats = () => useChatStore.getState().conversations;

  const attachment = (id: string) => ({
    id,
    type: 'document' as const,
    uri: `file:///docs/${id}`,
  });

  beforeEach(() => {
    useAppStore.setState({
      generatedImages: [
        {
          id: 'shared-1',
          prompt: 'a lighthouse',
          imagePath: '/docs/a.png',
          width: 1,
          height: 1,
          steps: 0,
          seed: 0,
          modelId: 'synced',
          createdAt: '2026-08-01T10:00:00.000Z',
        },
        {
          id: 'made-here',
          prompt: 'mine',
          imagePath: '/docs/b.png',
          width: 1,
          height: 1,
          steps: 0,
          seed: 0,
          modelId: 'sdxl',
          createdAt: '2026-08-01T11:00:00.000Z',
        },
      ],
    });
    useChatStore.setState({
      conversations: [
        {
          id: 'chat-7',
          title: 'Lighthouses',
          modelId: 'gemma',
          createdAt: '2026-08-01T09:00:00.000Z',
          updatedAt: '2026-08-01T09:30:00.000Z',
          messages: [
            {
              id: 'row-1',
              uuid: 'message-1',
              role: 'assistant',
              content: 'here it is',
              timestamp: 1,
              attachments: [attachment('shared-1'), attachment('kept')],
            },
          ],
        },
      ],
    });
  });

  const record = (overrides: Partial<MobileSharedFileRecord> = {}) =>
    ({
      syncId: 'shared-1',
      kind: 'generated_media',
      name: 'a.png',
      mimeType: 'image/png',
      fileSize: 1,
      createdAt: '2026-08-01T10:00:00.000Z',
      localPath: '/docs/a.png',
      ...overrides,
    } as MobileSharedFileRecord);

  it('takes a synced picture out of the gallery and leaves the local ones', () => {
    removeMaterializedSharedFile(record());

    // The bytes are being deleted, so a row pointing at them would open onto nothing.
    expect(gallery().map(({ id }) => id)).toEqual(['made-here']);
  });

  it('strips the attachment from the message and leaves the others', () => {
    removeMaterializedSharedFile(record({ kind: 'message_attachment' }));

    expect(chats()[0].messages[0].attachments?.map(({ id }) => id)).toEqual([
      'kept',
    ]);
  });

  it('searches every conversation, because the record does not say which one', () => {
    useChatStore.setState(state => ({
      conversations: [
        {
          ...state.conversations[0],
          id: 'chat-1',
          messages: [
            {
              ...state.conversations[0].messages[0],
              attachments: [attachment('shared-1')],
            },
          ],
        },
        { ...state.conversations[0], id: 'chat-2' },
      ],
    }));

    removeMaterializedSharedFile(record({ kind: 'message_attachment' }));

    // A file forwarded into two chats has to leave both, or one of them keeps a row onto deleted bytes.
    expect(chats()[0].messages[0].attachments).toEqual([]);
    expect(chats()[1].messages[0].attachments?.map(({ id }) => id)).toEqual([
      'kept',
    ]);
  });

  it('leaves a message that never had attachments alone', () => {
    useChatStore.setState(state => ({
      conversations: [
        {
          ...state.conversations[0],
          messages: [
            { ...state.conversations[0].messages[0], attachments: undefined },
          ],
        },
      ],
    }));

    removeMaterializedSharedFile(record({ kind: 'message_attachment' }));

    // Still undefined, not an empty list: a message that never had attachments should not start having a
    // list of none.
    expect(chats()[0].messages[0].attachments).toBeUndefined();
  });

  it('touches nothing for a plain file', () => {
    const before = chats();

    removeMaterializedSharedFile(record({ kind: 'file' }));

    expect(gallery()).toHaveLength(2);
    expect(chats()).toBe(before);
  });
});
