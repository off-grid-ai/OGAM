import type { QueueView } from '../../components/ChatInput/Toolbar';
import type { GenerationState, QueuedMessage } from '../../services/generationService';
import type { ArrivingChatModel } from '../../services/arrivingChatModel';

/** What a waiting message says while its model downloads, or that the download stopped. */
export function waitingLabel(model: ArrivingChatModel): string {
  return model.failed
    ? `${model.name} stopped downloading`
    : `${Math.round(model.progress * 100)}% · sends when ${model.name} is ready`;
}

/** The queue as one chat shows it: only the messages written in that chat. */
export function chatQueueView(
  queued: readonly QueuedMessage[],
  hold: GenerationState['queueHold'],
  conversationId: string | null,
  /** The first chat model on its way, which messages sent before it arrives wait for. */
  arriving?: ArrivingChatModel | null,
): QueueView {
  const mine = conversationId ? queued.filter(message => message.conversationId === conversationId) : [];
  return {
    items: mine.map(({ id, text, now }) => ({ id, text, now })),
    hold,
    ...(arriving && mine.some(message => message.waitsForModel)
      ? { waiting: { label: waitingLabel(arriving), failed: arriving.failed } }
      : {}),
  };
}
