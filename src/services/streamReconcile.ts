import { useChatStore } from '../stores';
import { stripStreamingControlTokens } from '../utils/messageContent';

/**
 * Streaming can only append, so a parser revision mid-stream can leave a stale character
 * in the shown text. Replace it with llama.rn's final parsed answer before it is stored.
 */
export function reconcileStreamedAnswer(parsedContent: string | undefined): void {
  if (!parsedContent) return;
  const store = useChatStore.getState();
  const final = stripStreamingControlTokens(parsedContent);
  if (final.trim() && final !== store.streamingMessage) store.setStreamingMessage(final);
}
