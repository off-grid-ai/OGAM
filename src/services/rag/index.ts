import { ragDatabase, type EmbeddingModelSelection } from './database';
import { chunkDocument } from './chunking';
import { retrievalService } from './retrieval';
import { embeddingService } from './embedding';
import { documentService } from '../documentService';
import { writePastedNote } from './pastedNote';
import {
  emitKnowledgeDocumentMutation,
  type KnowledgeDocumentSnapshot,
} from '../sync/knowledgeDocument';
import logger from '../../utils/logger';

export type { RagDocument, RagSearchResult } from './database';
export { retrievalService } from './retrieval';
interface IndexProgress {
  stage: 'extracting' | 'chunking' | 'indexing' | 'embedding' | 'done';
  message: string;
}

interface IndexDocumentParams {
  projectId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  syncId?: string;
  createdAt?: string;
  enabled?: boolean;
  origin?: 'local' | 'sync';
  onProgress?: (progress: IndexProgress) => void;
}

class RagService {
  private embeddingChange = { busy: false, message: '', error: '' };
  private embeddingListeners = new Set<() => void>();
  private embeddingAbort: AbortController | null = null;
  getEmbeddingChange = () => this.embeddingChange;
  subscribeEmbeddingChange = (listener: () => void) => {
    this.embeddingListeners.add(listener);
    return () => { this.embeddingListeners.delete(listener); };
  };
  private reportEmbeddingChange(busy: boolean, message: string, error = '') {
    this.embeddingChange = { busy, message, error };
    this.embeddingListeners.forEach(listener => listener());
  }
  cancelEmbeddingChange = () => { this.embeddingAbort?.abort(); };

  async installEmbeddingModel(candidate: {
    id: string; name: string; size: number; downloadUrl: string; sha256?: string;
  } | null): Promise<void> {
    if (this.embeddingChange.busy) throw new Error('An embedding model change is already in progress.');
    const controller = new AbortController();
    this.embeddingAbort = controller;
    const progress = (message: string) => this.reportEmbeddingChange(true, message);
    progress('Preparing model change...');
    let model: EmbeddingModelSelection | null = null;
    try {
      await this.ensureReady();
      model = candidate ? await embeddingService.downloadModel(candidate, progress, controller.signal) : null;
      await this.switchEmbeddingModel(model, progress, controller.signal);
      this.reportEmbeddingChange(false, 'Indexing complete');
    } catch (error) {
      this.reportEmbeddingChange(false, '', controller.signal.aborted
        ? 'Model change cancelled. The previous model and indexes are still active.'
        : `${error instanceof Error ? error.message : String(error)} The previous model and indexes are still active.`);
      throw error;
    } finally {
      this.embeddingAbort = null;
    }
  }

  async ensureReady(): Promise<void> {
    await ragDatabase.ensureReady();
  }

  async indexDocument(params: IndexDocumentParams): Promise<number> {
    return embeddingService.runExclusive(() => this.indexDocumentUnlocked(params));
  }

  private async indexDocumentUnlocked(params: IndexDocumentParams): Promise<number> {
    const { projectId, filePath, fileName, fileSize, onProgress } = params;
    await this.ensureReady();

    // Prevent duplicate indexing of the same file
    const existing = ragDatabase.getDocumentsByProject(projectId);
    if (existing.some(d => d.path === filePath || d.name === fileName)) {
      throw new Error(
        `Document "${fileName}" is already in the knowledge base`,
      );
    }

    onProgress?.({
      stage: 'extracting',
      message: `Extracting text from ${fileName}...`,
    });
    // Extract full document text for RAG — don't truncate based on context window
    const RAG_MAX_CHARS = 500_000;
    const attachment = await documentService.processDocumentFromPath(
      filePath,
      fileName,
      RAG_MAX_CHARS,
    );
    if (!attachment?.textContent) {
      // A PDF that extracts to zero text is a scanned / image-only PDF (no text layer);
      // there is no on-device OCR, so name that cause instead of a generic failure (B-KB).
      const isPdf = fileName.toLowerCase().endsWith('.pdf');
      throw new Error(
        isPdf
          ? 'This looks like a scanned PDF with no text layer, so there was no text to extract (OCR is not available).'
          : 'Could not extract text from document',
      );
    }

    onProgress?.({ stage: 'chunking', message: 'Splitting into chunks...' });
    const chunks = chunkDocument(attachment.textContent);
    if (chunks.length === 0) {
      throw new Error('Document produced no indexable content');
    }

    onProgress?.({ stage: 'indexing', message: 'Indexing chunks...' });
    const docId = ragDatabase.insertDocument({
      projectId,
      name: fileName,
      path: attachment.uri || filePath,
      size: attachment.fileSize ?? fileSize,
      syncId: params.syncId,
      createdAt: params.createdAt,
      enabled: params.enabled,
    });
    const rowIds = ragDatabase.insertChunks(docId, chunks);

    onProgress?.({ stage: 'embedding', message: 'Generating embeddings...' });
    try {
      await embeddingService.load();
      const texts = chunks.map(c => c.content);
      const embeddings: number[][] = [];
      for (const text of texts) {
        embeddings.push(await embeddingService.embed(text));
        onProgress?.({ stage: 'embedding', message: `Indexing ${embeddings.length} of ${texts.length} chunks...` });
      }
      const entries = rowIds.map((rowId, i) => ({
        chunkRowid: rowId,
        docId,
        embedding: embeddings[i],
      }));
      ragDatabase.insertEmbeddingsBatch(entries);
      logger.log(
        `[RAG] Generated ${embeddings.length} embeddings for ${fileName}`,
      );
    } catch (err) {
      // A document with zero embeddings is invisible to semantic search and never
      // auto-backfilled — a permanent dead entry. Roll back the just-inserted doc + chunks
      // and surface the failure so the KB screen reports it, rather than swallowing it.
      logger.error(
        '[RAG] Embedding generation failed — rolling back index:',
        err,
      );
      ragDatabase.deleteDocument(docId);
      throw err instanceof Error
        ? err
        : new Error('Embedding generation failed');
    }

    onProgress?.({ stage: 'done', message: 'Done' });
    logger.log(`[RAG] Indexed ${fileName}: ${chunks.length} chunks`);
    const indexed = ragDatabase.getDocument(docId);
    if (indexed && params.origin !== 'sync') {
      emitKnowledgeDocumentMutation({
        kind: 'indexed',
        document: this.snapshot(indexed),
      });
    }
    return docId;
  }

  /**
   * Index text the user pasted in, as a document of its own.
   *
   * Written to a .txt first and then handed to indexDocument, so a note gets the same dedupe,
   * chunking, embedding, rollback-on-failure and sync emission as an imported file. Nothing here
   * knows it was pasted.
   */
  async indexPastedText(params: {
    projectId: string;
    title: string;
    text: string;
    onProgress?: (progress: IndexProgress) => void;
  }): Promise<number> {
    const trimmed = params.text.trim();
    if (!trimmed) throw new Error('There is no text to save.');
    const note = await writePastedNote(params.title, trimmed);
    return this.indexDocument({
      projectId: params.projectId,
      filePath: note.filePath,
      fileName: note.fileName,
      fileSize: note.fileSize,
      onProgress: params.onProgress,
    });
  }

  async backfillEmbeddings(projectId: string): Promise<number> {
    return embeddingService.runExclusive(() => this.backfillEmbeddingsUnlocked(projectId));
  }

  private async backfillEmbeddingsUnlocked(projectId: string): Promise<number> {
    await this.ensureReady();
    const docs = ragDatabase.getDocumentsByProject(projectId);
    let total = 0;

    for (const doc of docs) {
      if (ragDatabase.hasEmbeddingsForDocument(doc.id)) continue;

      const chunks = ragDatabase.getChunksByDocument(doc.id);
      if (chunks.length === 0) continue;

      try {
        await embeddingService.load();
        const texts = chunks.map(c => c.content);
        const embeddings = await embeddingService.embedBatch(texts);
        const entries = chunks.map((chunk, i) => ({
          chunkRowid: chunk.id,
          docId: doc.id,
          embedding: embeddings[i],
        }));
        ragDatabase.insertEmbeddingsBatch(entries);
        total += embeddings.length;
        logger.log(
          `[RAG] Backfilled ${embeddings.length} embeddings for ${doc.name}`,
        );
      } catch (err) {
        logger.error(`[RAG] Backfill failed for ${doc.name}:`, err);
      }
    }

    return total;
  }

  async switchEmbeddingModel(
    model: EmbeddingModelSelection | null,
    onProgress: (message: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return embeddingService.runExclusive(async () => {
      await this.ensureReady();
      if (signal?.aborted) throw new Error('Model change cancelled');
      onProgress('Checking model compatibility...');
      await embeddingService.withRebuildModel(model, async () => {
        const documents = ragDatabase.getAllDocuments();
        const total = documents.reduce((count, doc) => count + ragDatabase.getChunksByDocument(doc.id).length, 0);
        let completed = 0;
        ragDatabase.beginEmbeddingRebuild();
        try {
          for (const doc of documents) {
            for (const chunk of ragDatabase.getChunksByDocument(doc.id)) {
              if (signal?.aborted) throw new Error('Model change cancelled');
              onProgress(`Rebuilding search and project knowledge: ${completed} of ${total} chunks`);
              ragDatabase.stageEmbedding({ chunkRowid: chunk.id, docId: doc.id, embedding: await embeddingService.embed(chunk.content) });
              completed += 1;
            }
          }
          onProgress(`Saving ${completed} chunks...`);
          if (signal?.aborted) throw new Error('Model change cancelled');
          ragDatabase.commitEmbeddingRebuild(model);
        } finally {
          // Cleanup must not turn a committed switch into an apparent failed switch.
          try { ragDatabase.discardEmbeddingRebuild(); } catch (error) { logger.warn('Could not clear temporary embedding index', error); }
        }
      });
      onProgress('Indexing complete');
    });
  }

  async deleteDocument(docId: number): Promise<void> {
    return embeddingService.runExclusive(() => this.deleteDocumentUnlocked(docId));
  }

  private async deleteDocumentUnlocked(docId: number): Promise<void> {
    await this.ensureReady();
    const document = ragDatabase.getDocument(docId);
    ragDatabase.deleteDocument(docId);
    if (document) {
      emitKnowledgeDocumentMutation({
        kind: 'deleted',
        syncId: document.sync_id,
      });
    }
  }

  async getDocumentsByProject(projectId: string) {
    await this.ensureReady();
    return ragDatabase.getDocumentsByProject(projectId);
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

  async searchProject(
    projectId: string,
    query: string,
    contextLength?: number,
  ) {
    await this.ensureReady();
    if (contextLength) {
      return retrievalService.searchWithBudget({
        projectId,
        query,
        contextLength,
      });
    }
    return retrievalService.search(projectId, query);
  }

  async deleteProjectDocuments(projectId: string): Promise<void> {
    return embeddingService.runExclusive(() => this.deleteProjectDocumentsUnlocked(projectId));
  }

  private async deleteProjectDocumentsUnlocked(projectId: string): Promise<void> {
    await this.ensureReady();
    const documents = ragDatabase.getDocumentsByProject(projectId);
    ragDatabase.deleteDocumentsByProject(projectId);
    for (const document of documents) {
      emitKnowledgeDocumentMutation({
        kind: 'deleted',
        syncId: document.sync_id,
      });
    }
  }

  async getAllDocumentsForSync(): Promise<KnowledgeDocumentSnapshot[]> {
    await this.ensureReady();
    return ragDatabase
      .getAllDocuments()
      .map(document => this.snapshot(document));
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

    return this.indexDocument({
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
    return embeddingService.runExclusive(() => this.deleteSyncedDocumentUnlocked(syncId));
  }

  private async deleteSyncedDocumentUnlocked(syncId: string): Promise<void> {
    await this.ensureReady();
    const document = ragDatabase.getDocumentBySyncId(syncId);
    if (document) ragDatabase.deleteDocument(document.id);
  }

  private snapshot(
    document: import('./database').RagDocument,
  ): KnowledgeDocumentSnapshot {
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

export const ragService = new RagService();
