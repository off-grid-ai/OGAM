import type { QueueView } from '../../components/ChatInput/Toolbar';
import type { GenerationState, QueuedMessage } from '../../services/generationService';

/** The queue as one chat shows it: only the messages written in that chat. */
export function chatQueueView(
  queued: readonly QueuedMessage[],
  hold: GenerationState['queueHold'],
  conversationId: string | null,
): QueueView {
  return {
    items: conversationId
      ? queued
          .filter(message => message.conversationId === conversationId)
          .map(({ id, text, now }) => ({ id, text, now }))
      : [],
    hold,
  };
}
