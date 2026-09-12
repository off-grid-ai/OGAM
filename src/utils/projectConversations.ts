import type { Conversation } from '../types';
import { byRecentActivity } from './conversationOrdering';

export function projectChatCounts(
  conversations: readonly Conversation[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const conversation of conversations) {
    if (conversation.projectId) {
      counts[conversation.projectId] =
        (counts[conversation.projectId] ?? 0) + 1;
    }
  }
  return counts;
}

export function conversationsForProject(
  conversations: readonly Conversation[],
  projectId: string,
): Conversation[] {
  return byRecentActivity(
    conversations.filter(conversation => conversation.projectId === projectId),
  );
}
