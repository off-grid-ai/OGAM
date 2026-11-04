import { create } from 'zustand';
import type { MediaStyleKind } from '@offgrid/models';
import { useChatStore } from './chatStore';
import { shownMessages } from '../utils/chatThread';

/** A finished picture or clip someone wants again in another style. */
export interface RestyleRequest {
  kind: MediaStyleKind;
  /** The words the person typed for that turn, without any style. */
  prompt: string;
  conversationId: string;
  /** The style the turn was made with, if any. */
  styleId?: string;
}

interface RestyleState {
  request: RestyleRequest | null;
  open: (request: RestyleRequest) => void;
  close: () => void;
}

/** Restyle on a picture or a clip card opens the chat's style sheet; core and Pro both open it here. */
export const useRestyleStore = create<RestyleState>(set => ({
  request: null,
  open: request => set({ request }),
  close: () => set({ request: null }),
}));

/** The turn behind a result: the person's own prompt and style, from the user message before it. */
export function restyleRequestFor(
  conversationId: string,
  resultMessageId: string,
  kind: MediaStyleKind,
): RestyleRequest | null {
  // The thread as shown: a retried answer is stored after later turns, so storage order can name the wrong prompt.
  const messages = shownMessages(useChatStore.getState().conversations.find(c => c.id === conversationId)?.messages ?? []);
  const at = messages.findIndex(message => message.id === resultMessageId);
  for (let i = at - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'user') continue;
    if (!message.content.trim()) return null;
    return {
      kind,
      prompt: message.content,
      conversationId,
      ...(message.mediaStyleId ? { styleId: message.mediaStyleId } : {}),
    };
  }
  return null;
}
