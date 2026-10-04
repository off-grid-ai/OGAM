import { useSyncExternalStore } from 'react';
import {
  mobileChatQueueSnapshot,
  subscribeMobileChatQueue,
} from '../services/adapters/models/mobileChatHostPort';

/**
 * Which conversation a reply is running for, read from the shared chat rules.
 *
 * The screen used to keep its own mark, written when a turn started and cleared when it ended. A
 * restart replaced the chat session but not that mark, so the composer went on offering Stop for a
 * reply that no longer existed. The shared queue is the only thing that knows a turn is running,
 * and it is rebuilt with the session, so nothing can outlive its own turn.
 */
export function useGeneratingConversationId(): string | null {
  return useSyncExternalStore(
    cb => subscribeMobileChatQueue(() => cb()),
    () =>
      mobileChatQueueSnapshot().entries.find(
        entry => entry.status === 'running',
      )?.conversationId ?? null,
  );
}
