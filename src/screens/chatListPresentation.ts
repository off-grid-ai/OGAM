import {
  chatListPreviewLine,
  type ConversationRecord,
  type WorkspaceContentSnapshot,
} from '@offgrid/application';
import { portableMessageText } from '../utils/portableMessageText';

type ProjectRecord = WorkspaceContentSnapshot['projects'][number];
type MessageRecord = WorkspaceContentSnapshot['messages'][number];

export function createChatListPresentation(
  conversations: readonly ConversationRecord[],
  projects: readonly ProjectRecord[],
  messages: readonly MessageRecord[],
) {
  const projectsById = new Map(projects.map(project => [project.id, project]));
  const lastMessageByConversation = new Map<string, MessageRecord>();
  for (const message of messages) {
    const current = lastMessageByConversation.get(message.conversationId);
    if (!current || message.position > current.position) {
      lastMessageByConversation.set(message.conversationId, message);
    }
  }

  const searchTextByConversation = new Map<string, string>();
  for (const conversation of conversations) {
    const lastMessage = lastMessageByConversation.get(conversation.id);
    const preview = chatListPreviewLine(
      lastMessage?.portable.role,
      portableMessageText(lastMessage?.portable.content),
    );
    const projectName = conversation.projectId
      ? projectsById.get(conversation.projectId)?.name ?? ''
      : '';
    searchTextByConversation.set(
      conversation.id,
      `${conversation.title}\n${preview}\n${projectName}`.toLocaleLowerCase(),
    );
  }

  return { projectsById, lastMessageByConversation, searchTextByConversation };
}

export function filterChatListConversations(
  conversations: readonly ConversationRecord[],
  searchQuery: string,
  searchTextByConversation: ReadonlyMap<string, string>,
): readonly ConversationRecord[] {
  const query = searchQuery.trim().toLocaleLowerCase();
  if (!query) return conversations;
  return conversations.filter(conversation =>
    searchTextByConversation.get(conversation.id)?.includes(query),
  );
}
