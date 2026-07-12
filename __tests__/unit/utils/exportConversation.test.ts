import { Share } from 'react-native';
import RNShare from 'react-native-share';
import RNFS from 'react-native-fs';
import { formatConversationAsText, shareConversationAsText } from '../../../src/utils/exportConversation';
import { Conversation, Message } from '../../../src/types';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello there',
    timestamp: 1750000000000,
    ...overrides,
  };
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 'Trip planning',
    modelId: 'llama-3-8b',
    messages: [makeMessage()],
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-02T12:30:00.000Z',
    ...overrides,
  };
}

describe('formatConversationAsText', () => {
  it('includes title, model, created and updated in the header', () => {
    const text = formatConversationAsText(makeConversation());
    expect(text).toContain('Trip planning');
    expect(text).toContain('Model: llama-3-8b');
    expect(text).toContain(`Created: ${new Date('2026-01-01T10:00:00.000Z').toLocaleString()}`);
    expect(text).toContain(`Updated: ${new Date('2026-01-02T12:30:00.000Z').toLocaleString()}`);
  });

  it('renders only the header (with trailing newline) when there are no messages', () => {
    const text = formatConversationAsText(makeConversation({ messages: [] }));
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('You:');
  });

  it('labels each role correctly', () => {
    const conversation = makeConversation({
      messages: [
        makeMessage({ id: '1', role: 'user', content: 'hi' }),
        makeMessage({ id: '2', role: 'assistant', content: 'hello' }),
        makeMessage({ id: '3', role: 'system', content: 'sys note' }),
        makeMessage({ id: '4', role: 'tool', content: 'tool output' }),
      ],
    });
    const text = formatConversationAsText(conversation);
    expect(text).toContain('You:\nhi');
    expect(text).toContain('Assistant:\nhello');
    expect(text).toContain('System:\nsys note');
    expect(text).toContain('Tool:\ntool output');
  });

  it('omits the attachment note when a message has no attachments field', () => {
    const text = formatConversationAsText(makeConversation({
      messages: [makeMessage({ attachments: undefined })],
    }));
    expect(text).not.toContain('attachment');
  });

  it('omits the attachment note when attachments is an empty array', () => {
    const text = formatConversationAsText(makeConversation({
      messages: [makeMessage({ attachments: [] })],
    }));
    expect(text).not.toContain('attachment');
  });

  it('uses singular "attachment" for exactly one attachment', () => {
    const text = formatConversationAsText(makeConversation({
      messages: [makeMessage({ attachments: [{ type: 'image', uri: 'file://a.png' } as any] })],
    }));
    expect(text).toContain('[1 attachment]');
  });

  it('uses plural "attachments" for more than one attachment', () => {
    const text = formatConversationAsText(makeConversation({
      messages: [makeMessage({
        attachments: [
          { type: 'image', uri: 'file://a.png' } as any,
          { type: 'image', uri: 'file://b.png' } as any,
        ],
      })],
    }));
    expect(text).toContain('[2 attachments]');
  });

  it('joins multiple messages with a blank line between them', () => {
    const text = formatConversationAsText(makeConversation({
      messages: [
        makeMessage({ id: '1', content: 'first' }),
        makeMessage({ id: '2', content: 'second' }),
      ],
    }));
    expect(text).toContain('first\n\n[');
    expect(text).toContain('second');
  });
});

describe('shareConversationAsText', () => {
  let shareSpy: jest.SpiedFunction<typeof Share.share>;
  const openSpy = RNShare.open as jest.Mock;
  const writeFileSpy = RNFS.writeFile as jest.Mock;

  beforeEach(() => {
    shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as any);
    openSpy.mockReset().mockResolvedValue({ success: true, message: '' });
    writeFileSpy.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    shareSpy.mockRestore();
  });

  it('uses the inline Share sheet for a short conversation', async () => {
    await shareConversationAsText(makeConversation());
    expect(shareSpy).toHaveBeenCalledWith({
      message: expect.stringContaining('Trip planning'),
      title: 'Trip planning',
    });
    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('writes a .txt file and opens the native share sheet for a long conversation', async () => {
    const longMessages = Array.from({ length: 20 }, (_, i) =>
      makeMessage({ id: `m${i}`, content: `line ${i}` }));
    await shareConversationAsText(makeConversation({ title: 'Long Chat!!', messages: longMessages }));

    expect(writeFileSpy).toHaveBeenCalledWith(
      '/mock/caches/Long_Chat.txt',
      expect.stringContaining('line 0'),
      'utf8',
    );
    expect(openSpy).toHaveBeenCalledWith({
      url: 'file:///mock/caches/Long_Chat.txt',
      type: 'text/plain',
      filename: 'Long_Chat',
      title: 'Long Chat!!',
      failOnCancel: false,
    });
    expect(shareSpy).not.toHaveBeenCalled();
  });

  it('falls back to "conversation" as the file name when the title sanitizes to empty', async () => {
    const longMessages = Array.from({ length: 20 }, (_, i) =>
      makeMessage({ id: `m${i}`, content: `line ${i}` }));
    await shareConversationAsText(makeConversation({ title: '!!!   ***', messages: longMessages }));

    expect(writeFileSpy).toHaveBeenCalledWith(
      '/mock/caches/conversation.txt',
      expect.any(String),
      'utf8',
    );
    expect(openSpy).toHaveBeenCalledWith(expect.objectContaining({ filename: 'conversation' }));
  });

  it('swallows errors from the inline share sheet (e.g. user cancelled)', async () => {
    shareSpy.mockRejectedValue(new Error('User did not share'));
    await expect(shareConversationAsText(makeConversation())).resolves.toBeUndefined();
  });

  it('swallows errors from the file-based share path', async () => {
    const longMessages = Array.from({ length: 20 }, (_, i) =>
      makeMessage({ id: `m${i}`, content: `line ${i}` }));
    writeFileSpy.mockRejectedValue(new Error('disk full'));
    await expect(
      shareConversationAsText(makeConversation({ messages: longMessages })),
    ).resolves.toBeUndefined();
  });
});
