// ConversationDocumentsPort for the phone: every document attached anywhere in a chat, read from
// the chat store, so a follow-up question days later still sees it. A document attached before
// documents had ids is identified by hashing its file, once.

import RNFS from 'react-native-fs';
import type { ConversationDocumentsPort, DocumentSource } from '@offgrid/rag/documents';
import { useChatStore } from '../../stores/chatStore';
import type { MediaAttachment } from '../../types';
import { knowledgeDocumentIds, localPath } from './project';
import { excludedDocuments } from './store';

const legacyIds = new Map<string, string>();

/** The SHA-256 of a file, hashed natively (it streams; a large PDF never enters JS memory). */
export async function hashFile(uri: string): Promise<string> {
  return RNFS.hash(localPath(uri), 'sha256');
}

function kindOf(attachment: MediaAttachment): string {
  const name = (attachment.fileName ?? attachment.uri).toLowerCase();
  if (attachment.mimeType === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  return 'text';
}

/** A chat attachment as a document source, or null if it is not a readable document here. */
export async function attachmentSource(attachment: MediaAttachment): Promise<DocumentSource | null> {
  if (attachment.type !== 'document') return null;
  const path = attachment.uri ? localPath(attachment.uri) : '';
  const onDevice = !!path && (await RNFS.exists(path).catch(() => false));
  if (!onDevice && !attachment.textContent) return null;
  let id = attachment.documentId;
  if (!id && onDevice) {
    id = legacyIds.get(path) ?? (await hashFile(path));
    legacyIds.set(path, id);
  }
  if (!id) return null;
  return {
    id,
    name: attachment.fileName ?? 'Document',
    kind: onDevice ? kindOf(attachment) : 'text',
    ...(onDevice ? { path } : { text: attachment.textContent }),
  };
}

export const conversationDocuments: ConversationDocumentsPort = {
  async list(conversationId) {
    const conversation = useChatStore.getState().conversations.find((c) => c.id === conversationId);
    const sources: DocumentSource[] = [];
    for (const message of conversation?.messages ?? []) {
      if (message.role !== 'user') continue;
      for (const attachment of message.attachments ?? []) {
        if (attachment.pending) continue;
        const source = await attachmentSource(attachment);
        if (source) sources.push(source);
      }
    }
    return sources;
  },
  async excluded(conversationId) {
    return excludedDocuments(conversationId);
  },
};

/** Every document id some chat or project knowledge base still references (for cleanup after a delete). */
export async function referencedDocumentIds(): Promise<Set<string>> {
  const ids = new Set<string>(await knowledgeDocumentIds());
  for (const conversation of useChatStore.getState().conversations) {
    for (const source of await conversationDocuments.list(conversation.id)) ids.add(source.id);
  }
  return ids;
}
