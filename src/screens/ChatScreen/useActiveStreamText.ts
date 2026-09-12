import { useMemo } from 'react';
import { useChatStore } from '../../stores';

export type ActiveStreamText = {
  content: string;
  reasoningContent?: string;
};

/** The only subscription that reads per-token local reply text. */
export function useActiveStreamText(): ActiveStreamText {
  const content = useChatStore(state => state.streamingMessage);
  const reasoning = useChatStore(state => state.streamingReasoningContent);
  return useMemo(
    () => ({ content, reasoningContent: reasoning || undefined }),
    [content, reasoning],
  );
}

/** Let the screen add one stable live row without reading its changing text. */
export function useHasActiveStreamText(): boolean {
  return useChatStore(
    state =>
      state.streamingMessage.length > 0 ||
      state.streamingReasoningContent.length > 0,
  );
}
