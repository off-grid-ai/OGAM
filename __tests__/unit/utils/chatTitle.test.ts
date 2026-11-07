import { chatTitle, isUntitledChat, NEW_CHAT_TITLE } from '../../../src/utils/chatTitle';

describe('chat titles: one rule for an untitled chat', () => {
  it('names an untitled chat "New chat"', () => {
    expect(NEW_CHAT_TITLE).toBe('New chat');
  });

  it('shows an old "New Conversation" title as "New chat", and any other title as written', () => {
    expect(chatTitle('New Conversation')).toBe('New chat');
    expect(chatTitle('New chat')).toBe('New chat');
    expect(chatTitle('Trip to Lisbon')).toBe('Trip to Lisbon');
  });

  it('treats both the old and the new untitled names as untitled, and nothing else', () => {
    expect(isUntitledChat('New chat')).toBe(true);
    expect(isUntitledChat('New Conversation')).toBe(true);
    expect(isUntitledChat('new chat about tea')).toBe(false);
    expect(isUntitledChat('')).toBe(false);
  });
});
