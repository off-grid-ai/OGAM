import { create } from 'zustand';
import type { Message } from '../types';

/** What a message shows while it is still being written, before its final text is saved. */
export type LiveMessage = Pick<Message, 'content' | 'isThinking'>;

interface LiveMessageState {
  byId: Record<string, LiveMessage>;
  show: (messageId: string, live: LiveMessage) => void;
  clear: (messageId: string) => void;
}

/**
 * Text a saved message shows while it is still being written (image prompt enhancement streams into
 * its card token by token). Never persisted: the chat store is saved whole on every change, and saving
 * a phone's chats once per token churned the disk and memory. The message itself is saved once, when
 * its text is final, and then cleared from here.
 */
export const useLiveMessageStore = create<LiveMessageState>()(set => ({
  byId: {},
  show: (messageId, live) => set(state => ({ byId: { ...state.byId, [messageId]: live } })),
  clear: messageId =>
    set(state => {
      if (!(messageId in state.byId)) return state;
      const { [messageId]: _cleared, ...rest } = state.byId;
      return { byId: rest };
    }),
}));

/** The messages as they show now: a message still being written shows its live text. */
export function withLiveMessages(messages: Message[], live: Record<string, LiveMessage>): Message[] {
  if (Object.keys(live).length === 0) return messages;
  return messages.map(message => (live[message.id] ? { ...message, ...live[message.id] } : message));
}
