import type { Message } from '../types';

/** A reply the person can see: words, a picture or video, or tool work still on screen. */
function hasVisibleReply(message: Message): boolean {
  return Boolean(
    message.content?.trim() ||
      message.attachments?.length ||
      message.toolArtifacts?.length ||
      message.isStreaming ||
      message.isThinking,
  );
}

/**
 * The id of the question that ends the chat with no answer, or undefined.
 *
 * A question has no answer when nothing follows it, or when only an empty reply follows it
 * (Stop before the first word saves one). Either way the person needs a visible way to ask again.
 */
export function unansweredQuestionId(messages: readonly Message[]): string | undefined {
  const last = messages.at(-1);
  if (!last) return undefined;
  if (last.role === 'user') return last.id;
  const before = messages.at(-2);
  if (last.role === 'assistant' && before?.role === 'user' && !hasVisibleReply(last)) return before.id;
  return undefined;
}
