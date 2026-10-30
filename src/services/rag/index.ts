// The project knowledge base on the phone: which files belong to a project, kept and synced. The
// files themselves are read, indexed, searched and cited by the shared document engine
// (services/documents), exactly like documents attached to a chat. Nothing here reads text.

import RNFS from 'react-native-fs';
import type { DocumentSource } from '@offgrid/rag/documents';
import { ragDatabase, type KnowledgeDocument } from './database';
import { documentService } from '../documentService';
import { writePastedNote } from './pastedNote';
import {
  knowledgeDocumentIds,
  knowledgeDocumentKind,
  knowledgeSources,
  localPath,
  resolveDocumentIds,
} from '../documents/project';
import {
  emitKnowledgeDocumentMutation,
  type KnowledgeDocumentSnapshot,
} from '../sync/knowledgeDocument';
import { itemDeleted } from '../analytics/analytics';

export type { KnowledgeDocument } from './database';

interface AddFileParams {
  projectId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  syncId?: string;
  createdAt?: string;
  enabled?: boolean;
  origin?: 'local' | 'sync';
}

/** Kept copies of added files live here (documentService.attachDocument). Only these are removed. */
const KEPT_COPIES_DIRECTORY = `${RNFS.DocumentDirectoryPath}/attachments/`;


/** Loaded lazily: the document services read this knowledge base. */
function documentServices() {
  return import('../documents');
}

class KnowledgeBase {
  async ensureReady(): Promise<void> {
    await ragDatabase.ensureReady();
  }

  /**
   * Add a file to a project. The file is kept, hashed and read in the background by the document
   * engine; the row appears at once and shows its reading progress.
   */
  async addFile(params: AddFileParams): Promise<number> {
    const { projectId, filePath, fileName, fileSize } = params;
    await this.ensureReady();
    const existing = ragDatabase.getDocumentsByProject(projectId);
    if (existing.some(d => d.path === filePath || d.name === fileName)) {
      throw new Error(`Document "${fileName}" is already in the knowledge base`);
    }
    const attachment = await documentService.attachDocument(filePath, fileName);
    const documentId = attachment.documentId;
    if (!documentId) throw new Error(`Could not read "${fileName}"`);
    if (
      params.origin !== 'sync' &&
      existing.some(d => d.document_id === documentId)
    ) {
      await this.removeKeptCopy(attachment.uri);
      throw new Error(`"${fileName}" is already in the knowledge base`);
    }
    const docId = ragDatabase.insertDocument({
      projectId,
      name: fileName,
      path: attachment.uri,
      size: attachment.fileSize ?? fileSize,
      documentId,
      syncId: params.syncId,
      createdAt: params.createdAt,
      enabled: params.enabled,
    });
    const added = ragDatabase.getDocument(docId);
    if (added && params.origin !== 'sync') {
      emitKnowledgeDocumentMutation({
        kind: 'indexed',
        document: this.snapshot(added),
      });
    }
    return docId;
  }

  /**
   * Add text the user pasted in, as a document of its own: written to a .txt, then added like any
   * file, so a note gets the same dedupe, reading, citations and sync.
   */
  async addPastedText(params: {
    projectId: string;
    title: string;
    text: string;
  }): Promise<number> {
    const trimmed = params.text.trim();
    if (!trimmed) throw new Error('There is no text to save.');
    const note = await writePastedNote(params.title, trimmed);
    let keptPath: string | undefined;
    try {
      const docId = await this.addFile({
        projectId: params.projectId,
        filePath: note.filePath,
        fileName: note.fileName,
        fileSize: note.fileSize,
      });
      keptPath = ragDatabase.getDocument(docId)?.path;
      return docId;
    } finally {
      // The kept copy is what the knowledge base uses; the written note is only its source.
      if (keptPath !== note.filePath) RNFS.unlink(note.filePath).catch(() => {});
    }
  }

  async deleteDocument(docId: number): Promise<void> {
    await this.ensureReady();
    const document = ragDatabase.getDocument(docId);
    ragDatabase.deleteDocument(docId);
    if (!document) return;
    itemDeleted('document');
    emitKnowledgeDocumentMutation({ kind: 'deleted', syncId: document.sync_id });
    await this.afterRemoval([document]);
  }

  /**
   * A project's files, newest first. Rows made before documents had ids are hashed here, and files
   * whose reading stopped (the app closed) carry on, so every row can show where it stands.
   */
  async getDocumentsByProject(projectId: string): Promise<KnowledgeDocument[]> {
    await this.ensureReady();
    const rows = ragDatabase.getDocumentsByProject(projectId);
    await this.resolveDocumentIds(rows);
    this.resumeReading(rows).catch(() => undefined);
    return rows;
  }

  async toggleDocument(docId: number, enabled: boolean): Promise<void> {
    await this.ensureReady();
    ragDatabase.toggleEnabled(docId, enabled);
    const document = ragDatabase.getDocument(docId);
    if (document) {
      emitKnowledgeDocumentMutation({
        kind: 'enabled',
        syncId: document.sync_id,
        enabled,
      });
    }
  }

  async deleteProjectDocuments(projectId: string): Promise<void> {
    await this.ensureReady();
    const documents = ragDatabase.getDocumentsByProject(projectId);
    ragDatabase.deleteDocumentsByProject(projectId);
    for (const document of documents) {
      emitKnowledgeDocumentMutation({ kind: 'deleted', syncId: document.sync_id });
    }
    await this.afterRemoval(documents);
  }

  /** The enabled files of a project, as the document engine reads them. */
  async sourcesForProject(projectId: string): Promise<DocumentSource[]> {
    return knowledgeSources(projectId);
  }

  /** Every document id any knowledge base uses (the document index must keep them). */
  async documentIds(): Promise<string[]> {
    return knowledgeDocumentIds();
  }

  async getAllDocumentsForSync(): Promise<KnowledgeDocumentSnapshot[]> {
    await this.ensureReady();
    return ragDatabase
      .getAllDocuments()
      .map(document => this.snapshot(document));
  }

  async getDocumentBySyncId(
    syncId: string,
  ): Promise<KnowledgeDocumentSnapshot | undefined> {
    await this.ensureReady();
    const document = ragDatabase.getDocumentBySyncId(syncId);
    return document ? this.snapshot(document) : undefined;
  }

  async indexSyncedDocument(
    document: KnowledgeDocumentSnapshot,
  ): Promise<number> {
    await this.ensureReady();
    const existing = ragDatabase.getDocumentBySyncId(document.syncId);
    if (existing) {
      if (existing.enabled !== (document.enabled ? 1 : 0)) {
        ragDatabase.toggleEnabled(existing.id, document.enabled);
      }
      return existing.id;
    }
    return this.addFile({
      projectId: document.projectId,
      filePath: document.filePath,
      fileName: document.name,
      fileSize: document.fileSize,
      syncId: document.syncId,
      createdAt: document.createdAt,
      enabled: document.enabled,
      origin: 'sync',
    });
  }

  async setSyncedDocumentEnabled(
    syncId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.ensureReady();
    const document = ragDatabase.getDocumentBySyncId(syncId);
    if (document) ragDatabase.toggleEnabled(document.id, enabled);
  }

  async deleteSyncedDocument(syncId: string): Promise<void> {
    await this.ensureReady();
    const document = ragDatabase.getDocumentBySyncId(syncId);
    if (!document) return;
    ragDatabase.deleteDocument(document.id);
    await this.afterRemoval([document]);
  }

  /** Rows added before files had document ids get their id now, and their reading starts. */
  private async resolveDocumentIds(rows: KnowledgeDocument[]): Promise<void> {
    const identified = await resolveDocumentIds(rows);
    if (!identified.length) return;
    const { startDocumentIngest } = await documentServices();
    for (const row of identified) {
      startDocumentIngest({
        id: row.document_id!,
        name: row.name,
        kind: knowledgeDocumentKind(row.name),
        path: localPath(row.path),
      });
    }
  }

  /** Files whose reading has not finished (or whose index entry is gone) carry on reading. */
  private async resumeReading(rows: KnowledgeDocument[]): Promise<void> {
    const { documentIngest, documentStore, startDocumentIngest } =
      await documentServices();
    for (const row of rows) {
      if (!row.document_id || documentIngest.isRunning(row.document_id)) continue;
      const stored = await documentStore.getDocument(row.document_id);
      if (stored && (stored.state === 'ready' || stored.state === 'failed')) continue;
      startDocumentIngest({
        id: row.document_id,
        name: row.name,
        kind: knowledgeDocumentKind(row.name),
        path: localPath(row.path),
      });
    }
  }

  /** Removed rows: delete their kept copies and the index entries nothing else uses. */
  private async afterRemoval(documents: KnowledgeDocument[]): Promise<void> {
    for (const document of documents) await this.removeKeptCopy(document.path);
    (await documentServices()).forgetUnreferencedDocuments().catch(() => undefined);
  }

  private async removeKeptCopy(uri: string): Promise<void> {
    const path = localPath(uri);
    if (!path.startsWith(KEPT_COPIES_DIRECTORY)) return;
    if (ragDatabase.countByPath(uri) > 0) return;
    await RNFS.unlink(path).catch(() => undefined);
  }

  private snapshot(document: KnowledgeDocument): KnowledgeDocumentSnapshot {
    return {
      syncId: document.sync_id,
      projectId: document.project_id,
      name: document.name,
      filePath: document.path,
      fileSize: document.size,
      createdAt: document.created_at,
      enabled: document.enabled === 1,
    };
  }
}

export const knowledgeBase = new KnowledgeBase();
