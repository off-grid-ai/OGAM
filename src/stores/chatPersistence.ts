import { generateId } from '../utils/generateId';
import type { Message } from '../types';

export interface PersistedChatState {
  conversations: unknown[];
  activeConversationId: string | null;
}

export const CHAT_STORAGE_VERSION = 2;

export function createPersistedMessage(
  data: Omit<Message, 'id' | 'timestamp'>,
): Message {
  const id = generateId();
  return { id, ...data, uuid: data.uuid ?? id, timestamp: Date.now() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function migrateMessage(message: unknown, version: number): unknown {
  if (!isRecord(message)) return message;
  const migrated: Record<string, unknown> = { ...message };

  if (version < 1 && typeof migrated.uuid !== 'string') {
    migrated.uuid = generateId();
  }

  if (version < 2 && Array.isArray(migrated.attachments)) {
    migrated.attachments = migrated.attachments.map(attachment => {
      if (!isRecord(attachment)) return attachment;
      return typeof attachment.id === 'string' && UUID_V4.test(attachment.id)
        ? attachment
        : { ...attachment, id: generateId() };
    });
  }

  return migrated;
}

/**
 * Version 1 gives every legacy persisted message the wire identity desktop uses
 * for `rag_messages.uuid`. Conversation/message local ids stay unchanged, so
 * active-chat references and compaction cutoffs remain valid. Version 2 gives
 * every persisted media attachment a stable UUID while preserving native
 * generated-image UUIDs that also key the gallery record and PNG.
 */
export function migratePersistedChatState(
  persistedState: unknown,
  version: number,
): PersistedChatState {
  if (
    !isRecord(persistedState) ||
    !Array.isArray(persistedState.conversations) ||
    !(persistedState.activeConversationId === null || typeof persistedState.activeConversationId === 'string')
  ) {
    return { conversations: [], activeConversationId: null };
  }
  if (version >= CHAT_STORAGE_VERSION) {
    return {
      conversations: persistedState.conversations,
      activeConversationId: persistedState.activeConversationId,
    };
  }

  return {
    activeConversationId: persistedState.activeConversationId,
    conversations: persistedState.conversations.map(conversation => {
      if (!isRecord(conversation) || !Array.isArray(conversation.messages)) {
        return conversation;
      }
      return {
        ...conversation,
        messages: conversation.messages.map(message =>
          migrateMessage(message, version),
        ),
      };
    }),
  };
}
