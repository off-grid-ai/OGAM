jest.mock('../../../../src/services/rag/database', () => ({
  ragDatabase: {
    ensureReady: jest.fn(() => Promise.resolve()),
    insertDocument: jest.fn((_doc: any) => 1),
    insertChunks: jest.fn(() => [1, 2]),
    deleteDocument: jest.fn(),
    getDocumentsByProject: jest.fn(() => []),
    toggleEnabled: jest.fn(),
    getChunksByProject: jest.fn(() => []),
    getEmbeddingsByProject: jest.fn(() => []),
    insertEmbeddingsBatch: jest.fn(),
    hasEmbeddingsForDocument: jest.fn(() => false),
    getChunksByDocument: jest.fn(() => []),
    deleteDocumentsByProject: jest.fn(),
  },
}));

jest.mock('../../../../src/services/rag/embedding', () => ({
  embeddingService: {
    load: jest.fn(() => Promise.resolve()),
    embedBatch: jest.fn(() => Promise.resolve([[0.1, 0.2], [0.3, 0.4]])),
    isLoaded: jest.fn(() => false),
  },
}));

jest.mock('../../../../src/services/documentService', () => ({
  documentService: {
    processDocumentFromPath: jest.fn(() => Promise.resolve({
      id: '1',
      type: 'document',
      uri: '/path/to/doc',
      fileName: 'test.txt',
      textContent: 'This is a long enough test document content that should be chunked properly by the service.',
      fileSize: 100,
    })),
  },
}));

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { ragService } from '../../../../src/services/rag';
import { ragDatabase } from '../../../../src/services/rag/database';
import { embeddingService } from '../../../../src/services/rag/embedding';
import { documentService } from '../../../../src/services/documentService';

const mockDb = ragDatabase as jest.Mocked<typeof ragDatabase>;
const mockDocService = documentService as jest.Mocked<typeof documentService>;
const mockEmbedding = embeddingService as jest.Mocked<typeof embeddingService>;

describe('RagService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ensureReady', () => {
    it('calls ragDatabase.ensureReady', async () => {
      await ragService.ensureReady();
      expect(mockDb.ensureReady).toHaveBeenCalled();
    });
  });

  describe('indexDocument', () => {
    it('extracts text, chunks, stores, and generates embeddings', async () => {
      const onProgress = jest.fn();
      const docId = await ragService.indexDocument({ projectId: 'proj1', filePath: '/path/test.txt', fileName: 'test.txt', fileSize: 100, onProgress });

      expect(mockDocService.processDocumentFromPath).toHaveBeenCalledWith('/path/test.txt', 'test.txt', 500_000);
      expect(mockDb.insertDocument).toHaveBeenCalledWith({ projectId: 'proj1', name: 'test.txt', path: '/path/test.txt', size: 100 });
      expect(mockDb.insertChunks).toHaveBeenCalled();
      expect(docId).toBe(1);

      // Progress callbacks include new 'embedding' stage
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'extracting' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'chunking' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'indexing' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'embedding' }));
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'done' }));

      // Verify embeddings were generated
      expect(mockEmbedding.load).toHaveBeenCalled();
      expect(mockEmbedding.embedBatch).toHaveBeenCalled();
      expect(mockDb.insertEmbeddingsBatch).toHaveBeenCalled();
    });

    it('throws when no text content extracted', async () => {
      mockDocService.processDocumentFromPath.mockResolvedValueOnce(null);
      await expect(ragService.indexDocument({ projectId: 'proj1', filePath: '/p', fileName: 'f', fileSize: 0 })).rejects.toThrow('Could not extract text');
    });

    it('throws when document produces no chunks', async () => {
      mockDocService.processDocumentFromPath.mockResolvedValueOnce({
        id: '1', type: 'document', uri: '/p', fileName: 'f', textContent: 'tiny', fileSize: 5,
      });
      await expect(ragService.indexDocument({ projectId: 'proj1', filePath: '/p', fileName: 'f', fileSize: 0 })).rejects.toThrow('no indexable content');
    });

    it('throws if document with same path already exists', async () => {
      mockDb.getDocumentsByProject.mockReturnValueOnce([
        { id: 1, project_id: 'proj1', name: 'test.txt', path: '/path/test.txt', size: 100, created_at: '', enabled: 1 },
      ]);
      await expect(ragService.indexDocument({ projectId: 'proj1', filePath: '/path/test.txt', fileName: 'test.txt', fileSize: 100 }))
        .rejects.toThrow('already in the knowledge base');
    });

    it('throws if document with same name already exists', async () => {
      mockDb.getDocumentsByProject.mockReturnValueOnce([
        { id: 1, project_id: 'proj1', name: 'test.txt', path: '/other/path', size: 100, created_at: '', enabled: 1 },
      ]);
      await expect(ragService.indexDocument({ projectId: 'proj1', filePath: '/new/path', fileName: 'test.txt', fileSize: 100 }))
        .rejects.toThrow('already in the knowledge base');
    });

    it('ABORTS and rolls back the just-inserted doc when embedding fails (no half-indexed entry)', async () => {
      // Product decision (user-ratified): an embedding failure mid-index must ABORT — roll back the
      // doc + chunks and propagate the error — never silently "continue without embeddings" (that left
      // a permanent, non-searchable dead entry). Assert the rejection AND the rollback consequence.
      mockEmbedding.embedBatch.mockRejectedValueOnce(new Error('OOM: embedding model ran out of memory'));

      await expect(
        ragService.indexDocument({ projectId: 'proj1', filePath: '/p', fileName: 'test.txt', fileSize: 100 }),
      ).rejects.toThrow('OOM: embedding model ran out of memory');

      // Rollback: the doc inserted before the failed embed is deleted, and no embeddings were persisted.
      expect(mockDb.deleteDocument).toHaveBeenCalledWith(1);
      expect(mockDb.insertEmbeddingsBatch).not.toHaveBeenCalled();
    });
  });

  describe('backfillEmbeddings', () => {
    it('generates embeddings for documents without them', async () => {
      mockDb.getDocumentsByProject.mockReturnValue([
        { id: 1, project_id: 'proj1', name: 'a.txt', path: '/a', size: 100, created_at: '', enabled: 1 },
      ]);
      mockDb.hasEmbeddingsForDocument.mockReturnValue(false);
      mockDb.getChunksByDocument.mockReturnValue([
        { id: 10, content: 'chunk one', position: 0 },
        { id: 11, content: 'chunk two', position: 1 },
      ]);

      const total = await ragService.backfillEmbeddings('proj1');
      expect(total).toBe(2);
      expect(mockEmbedding.embedBatch).toHaveBeenCalled();
      expect(mockDb.insertEmbeddingsBatch).toHaveBeenCalled();
    });

    it('skips documents that already have embeddings', async () => {
      mockDb.getDocumentsByProject.mockReturnValue([
        { id: 1, project_id: 'proj1', name: 'a.txt', path: '/a', size: 100, created_at: '', enabled: 1 },
      ]);
      mockDb.hasEmbeddingsForDocument.mockReturnValue(true);

      const total = await ragService.backfillEmbeddings('proj1');
      expect(total).toBe(0);
      expect(mockEmbedding.embedBatch).not.toHaveBeenCalled();
    });
  });

  describe('deleteDocument', () => {
    it('delegates to ragDatabase', async () => {
      await ragService.deleteDocument(42);
      expect(mockDb.deleteDocument).toHaveBeenCalledWith(42);
    });
  });

  describe('getDocumentsByProject', () => {
    it('returns documents from database', async () => {
      const mockDocs = [{ id: 1, project_id: 'proj1', name: 'a.txt', path: '/a', size: 100, created_at: '', enabled: 1 }];
      mockDb.getDocumentsByProject.mockReturnValue(mockDocs);

      const docs = await ragService.getDocumentsByProject('proj1');
      expect(docs).toEqual(mockDocs);
    });
  });

  describe('toggleDocument', () => {
    it('delegates to ragDatabase', async () => {
      await ragService.toggleDocument(1, false);
      expect(mockDb.toggleEnabled).toHaveBeenCalledWith(1, false);
    });
  });

  describe('searchProject', () => {
    it('calls search without contextLength', async () => {
      const result = await ragService.searchProject('proj1', 'query');
      expect(result.chunks).toEqual([]);
    });

    it('calls searchWithBudget with contextLength', async () => {
      const result = await ragService.searchProject('proj1', 'query', 2048);
      expect(result.chunks).toEqual([]);
    });
  });

  describe('deleteProjectDocuments', () => {
    it('delegates to ragDatabase', async () => {
      await ragService.deleteProjectDocuments('proj1');
      expect(mockDb.deleteDocumentsByProject).toHaveBeenCalledWith('proj1');
    });
  });
});
