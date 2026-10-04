import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../utils/generateId';
import type { Conversation } from '../types';
import { changedSliceStorage } from './persistence/changedSliceStorage';

export const CHAT_STORAGE_VERSION = 2;

/** The durable slice of the chat store. Streaming and loading fields are ephemeral. */
export interface PersistedChatSlice {
  conversations: Conversation[];
  activeConversationId: string | null;
}

/**
 * Streaming a reply updates the chat store once per token. Only the persisted slice is durable,
 * so the store writes when one of its fields moves - never per token.
 */
export const chatPersistStorage = changedSliceStorage<PersistedChatSlice>(
  () => AsyncStorage,
  (previous, next) =>
    previous.conversations === next.conversations &&
    previous.activeConversationId === next.activeConversationId,
);

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
): PersistedChatSlice {
  // The stored shape is what the store trusts after migration; zustand hands it over as such.
  return migrateStoredChatState(persistedState, version) as PersistedChatSlice;
}

function migrateStoredChatState(
  persistedState: unknown,
  version: number,
): unknown {
  if (version >= CHAT_STORAGE_VERSION || !isRecord(persistedState)) {
    return persistedState;
  }
  const conversations = persistedState.conversations;
  if (!Array.isArray(conversations)) return persistedState;

  return {
    ...persistedState,
    conversations: conversations.map(conversation => {
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
