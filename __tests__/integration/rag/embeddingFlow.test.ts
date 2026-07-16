/**
 * Integration Tests: Embedding Flow
 *
 * Tests the full embedding pipeline:
 * - Index document → generate embeddings → store in DB
 * - Semantic search via cosine similarity
 * - Fallback when no embeddings exist
 * - Backfill embeddings for existing documents
 * - Delete cascades to embeddings
 */

const mockExecuteSync = jest.fn();
const mockDb = {
  executeSync: mockExecuteSync,
  execute: jest.fn(() => Promise.resolve({ rows: [], insertId: 0, rowsAffected: 0 })),
  close: jest.fn(),
};

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => mockDb),
}));

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../src/services/documentService', () => ({
  documentService: {
    processDocumentFromPath: jest.fn(),
  },
}));

// Deterministic embedding function for testing
const deterministicEmbed = (text: string): number[] => {
  const vec = new Array(8).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 8] += (text.codePointAt(i) ?? 0) / 1000;
  }
  // Normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? vec.map(v => v / norm) : vec;
};

jest.mock('../../../src/services/rag/embedding', () => ({
  embeddingService: {
    load: jest.fn(() => Promise.resolve()),
    embed: jest.fn((text: string) => Promise.resolve(deterministicEmbed(text))),
    embedBatch: jest.fn((texts: string[]) => Promise.resolve(texts.map(deterministicEmbed))),
    isLoaded: jest.fn(() => true),
    unload: jest.fn(() => Promise.resolve()),
    getDimension: jest.fn(() => 8),
  },
}));

import { ragService, retrievalService } from '../../../src/services/rag';
import { ragDatabase } from '../../../src/services/rag/database';
import { embeddingService } from '../../../src/services/rag/embedding';
import { cosineSimilarity } from '../../../src/services/rag/vectorMath';
import { documentService } from '../../../src/services/documentService';

const mockDocService = documentService as jest.Mocked<typeof documentService>;

describe('Embedding Flow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ragDatabase as any).ready = false;
    (ragDatabase as any).db = null;
    mockExecuteSync.mockReturnValue({ rows: [], insertId: 0, rowsAffected: 0 });
  });

  describe('index and embed pipeline', () => {
    it('stores embeddings alongside chunks during indexing', async () => {
      mockDocService.processDocumentFromPath.mockResolvedValue({
        id: '1', type: 'document', uri: '/docs/ml.pdf',
        fileName: 'ml.pdf', textContent: 'Machine learning is a subset of artificial intelligence.\n\nDeep learning uses neural networks with many layers.',
        fileSize: 200,
      });
      let insertIdCounter = 1;
      mockExecuteSync.mockImplementation(() => ({
        rows: [], insertId: insertIdCounter++, rowsAffected: 1,
      }));

      await ragService.indexDocument({
        projectId: 'proj-1',
        filePath: '/docs/ml.pdf',
        fileName: 'ml.pdf',
        fileSize: 200,
      });

      // Verify embedding service was called
      expect(embeddingService.load).toHaveBeenCalled();
      expect(embeddingService.embedBatch).toHaveBeenCalled();

      // Verify embeddings were inserted into the database
      const embInserts = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO rag_embeddings')
      );
      expect(embInserts.length).toBeGreaterThan(0);

      // Each embedding insert should have [chunkRowid, docId, blob]
      for (const insert of embInserts) {
        expect(insert[1]).toHaveLength(3);
        expect(insert[1][2].byteLength).toBeGreaterThan(0);
      }
    });
  });

  describe('semantic search', () => {
    it('returns semantically similar chunks ranked by cosine similarity', async () => {
      (ragDatabase as any).ready = true;
      (ragDatabase as any).db = mockDb;

      // Create embeddings for two different topics
      const mlEmbed = deterministicEmbed('machine learning algorithms');
      const cookEmbed = deterministicEmbed('chocolate cake recipe baking');

      const mlBuffer = new Float32Array(mlEmbed).buffer;
      const cookBuffer = new Float32Array(cookEmbed).buffer;

      mockExecuteSync.mockImplementation((sql: string) => {
        if (typeof sql === 'string' && sql.includes('rag_embeddings') && sql.includes('SELECT')) {
          return {
            rows: [
              { chunk_rowid: 1, doc_id: 1, name: 'ml.pdf', content: 'Machine learning algorithms', position: 0, embedding: mlBuffer },
              { chunk_rowid: 2, doc_id: 2, name: 'recipes.pdf', content: 'Chocolate cake recipe', position: 0, embedding: cookBuffer },
            ],
          };
        }
        return { rows: [], insertId: 0, rowsAffected: 0 };
      });

      const result = await retrievalService.search('proj-1', 'machine learning', 1);

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].content).toBe('Machine learning algorithms');
    });

    it('falls back to first chunks when no embeddings exist', async () => {
      (ragDatabase as any).ready = true;
      (ragDatabase as any).db = mockDb;

      mockExecuteSync.mockImplementation((sql: string) => {
        if (typeof sql === 'string' && sql.includes('rag_embeddings') && sql.includes('SELECT')) {
          return { rows: [] };
        }
        if (typeof sql === 'string' && sql.includes('rag_chunks') && sql.includes('SELECT')) {
          return {
            rows: [
              { doc_id: 1, name: 'doc.txt', content: 'Fallback content', position: 0, score: 0 },
            ],
          };
        }
        return { rows: [], insertId: 0, rowsAffected: 0 };
      });

      const result = await retrievalService.search('proj-1', 'anything');
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].content).toBe('Fallback content');
    });
  });

  describe('backfill embeddings', () => {
    it('generates embeddings for pre-existing documents', async () => {
      mockExecuteSync.mockImplementation((sql: string, _params?: any[]) => {
        if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('rag_documents')) {
          return {
            rows: [
              { id: 1, project_id: 'proj-1', name: 'old.txt', path: '/old', size: 100, created_at: '2024-01-01', enabled: 1 },
            ],
          };
        }
        if (typeof sql === 'string' && sql.includes('COUNT') && sql.includes('rag_embeddings')) {
          return { rows: [{ count: 0 }] }; // No embeddings yet
        }
        if (typeof sql === 'string' && sql.includes('SELECT') && sql.includes('rag_chunks') && sql.includes('doc_id')) {
          return {
            rows: [
              { id: 10, content: 'Old chunk one', position: 0 },
              { id: 11, content: 'Old chunk two', position: 1 },
            ],
          };
        }
        return { rows: [], insertId: 0, rowsAffected: 0 };
      });

      await ragService.ensureReady();
      const total = await ragService.backfillEmbeddings('proj-1');

      expect(total).toBe(2);
      expect(embeddingService.embedBatch).toHaveBeenCalledWith(['Old chunk one', 'Old chunk two']);

      // Verify embeddings were stored
      const embInserts = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO rag_embeddings')
      );
      expect(embInserts).toHaveLength(2);
    });
  });

  describe('delete cascade', () => {
    it('deleting a document also deletes its embeddings', async () => {
      mockExecuteSync.mockReturnValue({ rows: [], insertId: 0, rowsAffected: 0 });
      await ragService.ensureReady();

      await ragService.deleteDocument(42);

      const deleteCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE')
      );
      expect(deleteCalls).toHaveLength(3);
      // Order: embeddings, chunks, document
      expect(deleteCalls[0][0]).toContain('rag_embeddings');
      expect(deleteCalls[0][1]).toEqual([42]);
      expect(deleteCalls[1][0]).toContain('rag_chunks');
      expect(deleteCalls[2][0]).toContain('rag_documents');
    });
  });

  describe('vector math integration', () => {
    it('cosine similarity ranks similar texts higher', () => {
      const queryVec = deterministicEmbed('neural networks deep learning');
      const mlVec = deterministicEmbed('machine learning neural nets');
      const cookVec = deterministicEmbed('baking chocolate cookies');

      const mlSim = cosineSimilarity(queryVec, mlVec);
      const cookSim = cosineSimilarity(queryVec, cookVec);

      // ML-related text should be more similar to query than cooking text
      expect(mlSim).toBeGreaterThan(cookSim);
    });
  });
});
