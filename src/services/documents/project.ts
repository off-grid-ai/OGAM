// ProjectDocumentsPort for the phone: a project's knowledge base, read by the shared turn service
// before the chat's own attachments, so every chat in the project answers from it. Reads the
// knowledge-base rows (rag.db) directly: the knowledge-base service sits above this layer.

import RNFS from 'react-native-fs';
import type { DocumentSource, ProjectDocumentsPort } from '@offgrid/rag/documents';
import { useChatStore } from '../../stores/chatStore';
import { ragDatabase, type KnowledgeDocument } from '../rag/database';
import logger from '../../utils/logger';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';

/**
 * A stored document path as a file path on this install. iOS moves the app to a new container on
 * update and reinstall, so a path saved by an earlier install names a folder that no longer exists;
 * it is re-based onto the current one, where the file now is.
 */
export function localPath(path: string): string {
  return resolveDocumentPath(path);
}

/** How the document engine reads a knowledge-base file. The phone knowledge base holds PDFs and text. */
export function knowledgeDocumentKind(name: string): 'pdf' | 'text' {
  return name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text';
}

/** Legacy rows being hashed, so two readers never hash the same file twice. */
const hashing = new Map<number, Promise<string | null>>();

async function hashLegacyRow(row: KnowledgeDocument): Promise<string | null> {
  const path = localPath(row.path);
  try {
    if (!(await RNFS.exists(path))) return null;
    const documentId = await RNFS.hash(path, 'sha256');
    ragDatabase.setDocumentId(row.id, documentId);
    return documentId;
  } catch (error) {
    logger.warn('[Knowledge] Could not identify a knowledge-base file:', error);
    return null;
  }
}

/**
 * Give rows added before files had document ids their id (the SHA-256 of the kept file), in place.
 * Returns the rows that were newly identified, for the caller to start reading.
 */
export async function resolveDocumentIds(rows: KnowledgeDocument[]): Promise<KnowledgeDocument[]> {
  const identified: KnowledgeDocument[] = [];
  for (const row of rows) {
    if (row.document_id) continue;
    let pending = hashing.get(row.id);
    if (!pending) {
      pending = hashLegacyRow(row).finally(() => hashing.delete(row.id));
      hashing.set(row.id, pending);
    }
    const documentId = await pending;
    if (documentId) {
      row.document_id = documentId;
      identified.push(row);
    }
  }
  return identified;
}

/** A project's enabled knowledge-base files as document sources (the turn reads any not yet indexed). */
export async function knowledgeSources(projectId: string): Promise<DocumentSource[]> {
  await ragDatabase.ensureReady();
  const rows = ragDatabase.getEnabledDocumentsByProject(projectId);
  await resolveDocumentIds(rows);
  return rows
    .filter((row): row is KnowledgeDocument & { document_id: string } => Boolean(row.document_id))
    .map(row => ({
      id: row.document_id,
      name: row.name,
      kind: knowledgeDocumentKind(row.name),
      path: localPath(row.path),
    }));
}

/** Every document id any knowledge base uses (the document index must keep them). */
export async function knowledgeDocumentIds(): Promise<string[]> {
  await ragDatabase.ensureReady();
  return ragDatabase.getAllDocumentIds();
}

export const projectDocuments: ProjectDocumentsPort = {
  async forProject(projectId) {
    return knowledgeSources(projectId);
  },
  async forConversation(conversationId) {
    const projectId = useChatStore
      .getState()
      .conversations.find(c => c.id === conversationId)?.projectId;
    return projectId ? knowledgeSources(projectId) : [];
  },
};
