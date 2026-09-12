import { useMemo } from 'react';
import { useChatStore } from '../../stores';

export function useActiveStreamText(): {
  content: string;
  reasoningContent?: string;
} {
  const content = useChatStore(state => state.streamingMessage);
  const reasoning = useChatStore(state => state.streamingReasoningContent);
  return useMemo(
    () => ({ content, reasoningContent: reasoning || undefined }),
    [content, reasoning],
  );
}

export function useHasActiveStreamText(): boolean {
  return useChatStore(
    state =>
      state.streamingMessage.length > 0 ||
      state.streamingReasoningContent.length > 0,
  );
}
