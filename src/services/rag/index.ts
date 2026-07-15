import { ragDatabase } from './database';
import { chunkDocument } from './chunking';
import { retrievalService } from './retrieval';
import { embeddingService } from './embedding';
import { documentService } from '../documentService';
import logger from '../../utils/logger';

;
export type { RagDocument, RagSearchResult } from './database';
;
export { chunkDocument } from './chunking';
export { retrievalService } from './retrieval';
;

interface IndexProgress {
  stage: 'extracting' | 'chunking' | 'indexing' | 'embedding' | 'done';
  message: string;
}

interface IndexDocumentParams {
  projectId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  onProgress?: (progress: IndexProgress) => void;
}

class RagService {
  async ensureReady(): Promise<void> {
    await ragDatabase.ensureReady();
  }

  async indexDocument(params: IndexDocumentParams): Promise<number> {
    const { projectId, filePath, fileName, fileSize, onProgress } = params;
    await this.ensureReady();

    // Prevent duplicate indexing of the same file
    const existing = ragDatabase.getDocumentsByProject(projectId);
    if (existing.some(d => d.path === filePath || d.name === fileName)) {
      throw new Error(`Document "${fileName}" is already in the knowledge base`);
    }

    onProgress?.({ stage: 'extracting', message: `Extracting text from ${fileName}...` });
    // Extract full document text for RAG — don't truncate based on context window
    const RAG_MAX_CHARS = 500_000;
    const attachment = await documentService.processDocumentFromPath(filePath, fileName, RAG_MAX_CHARS);
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
    const docId = ragDatabase.insertDocument({ projectId, name: fileName, path: filePath, size: fileSize });
    const rowIds = ragDatabase.insertChunks(docId, chunks);

    onProgress?.({ stage: 'embedding', message: 'Generating embeddings...' });
    try {
      await embeddingService.load();
      const texts = chunks.map(c => c.content);
      const embeddings = await embeddingService.embedBatch(texts);
      const entries = rowIds.map((rowId, i) => ({
        chunkRowid: rowId,
        docId,
        embedding: embeddings[i],
      }));
      ragDatabase.insertEmbeddingsBatch(entries);
      logger.log(`[RAG] Generated ${embeddings.length} embeddings for ${fileName}`);
    } catch (err) {
      // A document with zero embeddings is invisible to semantic search and never
      // auto-backfilled — a permanent dead entry. Roll back the just-inserted doc + chunks
      // and surface the failure so the KB screen reports it, rather than swallowing it.
      logger.error('[RAG] Embedding generation failed — rolling back index:', err);
      ragDatabase.deleteDocument(docId);
      throw err instanceof Error ? err : new Error('Embedding generation failed');
    }

    onProgress?.({ stage: 'done', message: 'Done' });
    logger.log(`[RAG] Indexed ${fileName}: ${chunks.length} chunks`);
    return docId;
  }

  async backfillEmbeddings(projectId: string): Promise<number> {
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
        logger.log(`[RAG] Backfilled ${embeddings.length} embeddings for ${doc.name}`);
      } catch (err) {
        logger.error(`[RAG] Backfill failed for ${doc.name}:`, err);
      }
    }

    return total;
  }

  async deleteDocument(docId: number): Promise<void> {
    await this.ensureReady();
    ragDatabase.deleteDocument(docId);
  }

  async getDocumentsByProject(projectId: string) {
    await this.ensureReady();
    return ragDatabase.getDocumentsByProject(projectId);
  }

  async toggleDocument(docId: number, enabled: boolean): Promise<void> {
    await this.ensureReady();
    ragDatabase.toggleEnabled(docId, enabled);
  }

  async searchProject(projectId: string, query: string, contextLength?: number) {
    await this.ensureReady();
    if (contextLength) {
      return retrievalService.searchWithBudget({ projectId, query, contextLength });
    }
    return retrievalService.search(projectId, query);
  }

  async deleteProjectDocuments(projectId: string): Promise<void> {
    await this.ensureReady();
    ragDatabase.deleteDocumentsByProject(projectId);
  }
}

export const ragService = new RagService();
