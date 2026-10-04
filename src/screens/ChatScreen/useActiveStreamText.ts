import { useMemo } from 'react';
import { useChatStore } from '../../stores';

/**
 * The live reply's text, as its own narrow projection.
 *
 * The token flush writes `streamingMessage` / `streamingReasoningContent` roughly every 50 ms. Any
 * component that subscribes to those fields re-renders at that rate, so exactly ONE leaf is allowed
 * to: the row that draws the in-progress bubble. Everything else - the screen model, the header, the
 * composer, the committed rows - reads only WHETHER text has arrived (`useHasActiveStreamText`),
 * which flips at most once per turn.
 *
 * These fields are excluded from the chat store's `partialize`, so a token is never persisted; the
 * durable record is written once, by `finalizeStreamingMessage`.
 */
export type ActiveStreamText = {
  content: string;
  reasoningContent?: string;
};

export function useActiveStreamText(): ActiveStreamText {
  const content = useChatStore(state => state.streamingMessage);
  const reasoning = useChatStore(state => state.streamingReasoningContent);
  return useMemo(
    () => ({ content, reasoningContent: reasoning || undefined }),
    [content, reasoning],
  );
}

/**
 * Has the live reply produced anything yet? A boolean, so the screen model can decide WHICH row to
 * show without subscribing to the text that fills it.
 */
export function useHasActiveStreamText(): boolean {
  return useChatStore(
    state =>
      state.streamingMessage.length > 0 ||
      state.streamingReasoningContent.length > 0,
  );
}
