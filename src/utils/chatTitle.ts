/** An untitled chat's name, in sentence case like every other label. */
export const NEW_CHAT_TITLE = 'New chat';

/** Earlier builds (and other devices on Sync) stored "New Conversation"; it still means untitled. */
const OLD_UNTITLED = 'New Conversation';

export const isUntitledChat = (title: string): boolean => title === NEW_CHAT_TITLE || title === OLD_UNTITLED;

/** How a chat's title is shown: an old untitled name reads as today's, without rewriting stored chats. */
export const chatTitle = (title: string): string => (title === OLD_UNTITLED ? NEW_CHAT_TITLE : title);
