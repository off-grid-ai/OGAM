import {
  DEFAULT_RAG_EMBEDDING_DIMENSION,
  detectKind,
  type EmbeddingProvider,
  type ExtractionBridges,
  type IndexDocumentParams,
  type RagDocument,
  type VectorStore,
} from '@offgrid/rag';
import { documentService } from '../../documentService';
import { executeMobileEmbedding } from '../../mobileSidecarGeneration';
import { ragDatabase, type RagDocument as StoredDocument } from './ragDatabaseAdapter';

function document(row: StoredDocument): RagDocument {
  return {
    id: row.id,
    syncId: row.sync_id,
    projectId: row.project_id,
    name: row.name,
    path: row.path,
    size: row.size,
    kind: detectKind(row.name),
    createdAt: row.created_at,
    enabled: row.enabled === 1,
  };
}

export const mobileRagStore: VectorStore = {
  ensureReady: () => ragDatabase.ensureReady(),
  async addDocument(input) {
    return ragDatabase.insertDocument({
      projectId: input.projectId,
      name: input.name,
      path: input.path,
      size: input.size,
      syncId: input.syncId,
      createdAt: input.createdAt,
      enabled: input.enabled,
    });
  },
  async addChunks(docId, chunks, embeddings) {
    const rowIds = ragDatabase.insertChunks(docId, chunks);
    ragDatabase.insertEmbeddingsBatch(rowIds.map((chunkRowid, index) => ({
      chunkRowid,
      docId,
      embedding: embeddings[index],
    })));
  },
  async getChunkCandidates(projectId) {
    return ragDatabase.getEmbeddingsByProject(projectId).map(row => ({
      docId: row.doc_id,
      name: row.name,
      content: row.content,
      position: row.position,
      embedding: row.embedding,
    }));
  },
  async getFallbackChunks(projectId, limit) {
    return ragDatabase.getChunksByProject(projectId, limit).map(row => ({
      docId: row.doc_id,
      name: row.name,
      content: row.content,
      position: row.position,
      embedding: [],
    }));
  },
  async getUnembeddedDocuments(projectId) {
    return ragDatabase.getDocumentsByProject(projectId)
      .filter(row => !ragDatabase.hasEmbeddingsForDocument(row.id))
      .map(row => ({ document: document(row), chunks: ragDatabase.getChunksByDocument(row.id) }));
  },
  async addEmbeddings(docId, entries) {
    ragDatabase.insertEmbeddingsBatch(entries.map(entry => ({
      chunkRowid: entry.chunkId,
      docId,
      embedding: entry.embedding,
    })));
  },
  async listDocuments(projectId) {
    return ragDatabase.getDocumentsByProject(projectId).map(document);
  },
  async listDocumentPage(afterId, limit) {
    const page = ragDatabase.listDocumentPage(afterId, limit);
    return {
      documents: page.documents.map(document),
      nextAfterId: page.nextAfterId,
    };
  },
  async getDocument(docId) {
    const row = ragDatabase.getDocument(docId);
    return row ? document(row) : undefined;
  },
  async getDocumentBySyncId(syncId) {
    const row = ragDatabase.getDocumentBySyncId(syncId);
    return row ? document(row) : undefined;
  },
  async setDocumentEnabled(docId, enabled) {
    ragDatabase.toggleEnabled(docId, enabled);
  },
  async deleteDocument(docId) {
    ragDatabase.deleteDocument(docId);
  },
  async deleteDocumentsByProject(projectId, commitFence) {
    return ragDatabase.deleteDocumentsByProject(projectId, commitFence);
  },
};

export const mobileRagEmbeddings: EmbeddingProvider = {
  dimension: DEFAULT_RAG_EMBEDDING_DIMENSION,
  async embed(text) { return (await executeMobileEmbedding([text]))[0]; },
  embedBatch: executeMobileEmbedding,
};

async function extract(path: string, fileName: string): Promise<string> {
  const attachment = await documentService.processDocumentFromPath(path, fileName, 500_000);
  if (attachment?.textContent) return attachment.textContent;
  throw new Error(fileName.toLowerCase().endsWith('.pdf')
    ? 'This looks like a scanned PDF with no text layer, so there was no text to extract (OCR is not available).'
    : 'Could not extract text from document');
}

export const mobileRagExtraction: ExtractionBridges = {
  readText: path => extract(path, path.split('/').pop() ?? 'document.txt'),
  extractPdf: path => extract(path, path.split('/').pop() ?? 'document.pdf'),
};

export async function prepareMobileRagDocument(params: IndexDocumentParams) {
  const attachment = await documentService.processDocumentFromPath(params.path, params.fileName, 500_000);
  if (!attachment?.textContent) {
    throw new Error(params.fileName.toLowerCase().endsWith('.pdf')
      ? 'This looks like a scanned PDF with no text layer, so there was no text to extract (OCR is not available).'
      : 'Could not extract text from document');
  }
  return {
    text: attachment.textContent,
    kind: detectKind(params.fileName),
    path: attachment.uri || params.path,
    size: attachment.fileSize ?? params.size,
  };
}
