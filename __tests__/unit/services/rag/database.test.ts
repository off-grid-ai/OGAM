import { open } from '@op-engineering/op-sqlite';

// We need to get a reference to the mock DB to control its return values
const mockExecuteSync = jest.fn();
const mockDb = {
  executeSync: mockExecuteSync,
  execute: jest.fn(() =>
    Promise.resolve({ rows: [], insertId: 0, rowsAffected: 0 }),
  ),
  close: jest.fn(),
  delete: jest.fn(),
};

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => mockDb),
}));

jest.mock('../../../../src/utils/logger', () => ({
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// Import after mocks
import { ragDatabase } from '../../../../src/services/adapters/rag/ragDatabaseAdapter';

function expectDeleteCascade() {
  const deleteCalls = mockExecuteSync.mock.calls.filter(
    (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE'),
  );
  expect(deleteCalls).toHaveLength(3);
  expect(deleteCalls[0][0]).toContain('rag_embeddings');
  expect(deleteCalls[1][0]).toContain('rag_chunks');
  expect(deleteCalls[2][0]).toContain('rag_documents');
}

describe('RagDatabase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ragDatabase as any).ready = false;
    (ragDatabase as any).db = null;
    mockExecuteSync.mockReturnValue({ rows: [], insertId: 0, rowsAffected: 0 });
  });

  describe('ensureReady', () => {
    it('opens the database and creates tables', async () => {
      await ragDatabase.ensureReady();
      expect(open).toHaveBeenCalledWith({ name: 'rag.db' });
      const tableCreates = mockExecuteSync.mock.calls
        .map(call => call[0])
        .filter(
          sql =>
            typeof sql === 'string' &&
            sql.includes('CREATE TABLE IF NOT EXISTS'),
        );
      expect(tableCreates).toHaveLength(3);
      expect(tableCreates[0]).toContain('rag_documents');
      expect(tableCreates[1]).toContain('rag_chunks');
      expect(tableCreates[2]).toContain('rag_embeddings');
    });

    it('does not re-initialize on second call', async () => {
      await ragDatabase.ensureReady();
      const callCount = mockExecuteSync.mock.calls.length;
      await ragDatabase.ensureReady();
      expect(mockExecuteSync.mock.calls.length).toBe(callCount);
    });
  });

  describe('insertDocument', () => {
    it('inserts a document and returns the id', async () => {
      await ragDatabase.ensureReady();
      mockExecuteSync.mockReturnValue({
        insertId: 42,
        rowsAffected: 1,
        rows: [],
      });

      const id = ragDatabase.insertDocument({
        projectId: 'proj1',
        name: 'test.txt',
        path: '/path/test.txt',
        size: 1234,
      });
      expect(id).toBe(42);
      expect(mockExecuteSync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO rag_documents'),
        expect.arrayContaining(['proj1', 'test.txt', '/path/test.txt', 1234]),
      );
    });
  });

  describe('insertChunks', () => {
    it('inserts each chunk and returns rowids', async () => {
      await ragDatabase.ensureReady();
      mockExecuteSync.mockReturnValue({
        insertId: 10,
        rowsAffected: 1,
        rows: [],
      });

      const chunks = [
        { content: 'chunk one', position: 0 },
        { content: 'chunk two', position: 1 },
      ];
      const rowIds = ragDatabase.insertChunks(42, chunks);
      expect(rowIds).toEqual([10, 10]); // mock always returns 10
      const chunkInserts = mockExecuteSync.mock.calls.filter(
        (c: any[]) =>
          typeof c[0] === 'string' && c[0].includes('INSERT INTO rag_chunks'),
      );
      expect(chunkInserts).toHaveLength(2);
      expect(chunkInserts[0][1]).toEqual(['chunk one', 42, 0]);
      expect(chunkInserts[1][1]).toEqual(['chunk two', 42, 1]);
    });
  });

  describe('insertEmbeddingsBatch', () => {
    it('inserts multiple embeddings', async () => {
      await ragDatabase.ensureReady();
      ragDatabase.insertEmbeddingsBatch([
        { chunkRowid: 1, docId: 42, embedding: [0.1] },
        { chunkRowid: 2, docId: 42, embedding: [0.2] },
      ]);

      const embInserts = mockExecuteSync.mock.calls.filter(
        (c: any[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('INSERT INTO rag_embeddings'),
      );
      expect(embInserts).toHaveLength(2);
    });
  });

  describe('getEmbeddingsByProject', () => {
    it('returns stored embeddings with chunk data', async () => {
      await ragDatabase.ensureReady();
      const embBuffer = new Float32Array([0.1, 0.2]).buffer;
      mockExecuteSync.mockReturnValue({
        rows: [
          {
            chunk_rowid: 1,
            doc_id: 42,
            name: 'doc.txt',
            content: 'hello',
            position: 0,
            embedding: embBuffer,
          },
        ],
      });

      const results = ragDatabase.getEmbeddingsByProject('proj1');
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('hello');
      expect(results[0].embedding).toBeInstanceOf(Array);
    });
  });

  describe('hasEmbeddingsForDocument', () => {
    it('returns true when embeddings exist', async () => {
      await ragDatabase.ensureReady();
      mockExecuteSync.mockReturnValue({ rows: [{ count: 5 }] });

      expect(ragDatabase.hasEmbeddingsForDocument(42)).toBe(true);
    });

    it('returns false when no embeddings', async () => {
      await ragDatabase.ensureReady();
      mockExecuteSync.mockReturnValue({ rows: [{ count: 0 }] });

      expect(ragDatabase.hasEmbeddingsForDocument(42)).toBe(false);
    });
  });

  describe('getChunksByDocument', () => {
    it('returns chunks for a document', async () => {
      await ragDatabase.ensureReady();
      mockExecuteSync.mockReturnValue({
        rows: [{ id: 1, content: 'chunk', position: 0 }],
      });

      const chunks = ragDatabase.getChunksByDocument(42);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('chunk');
    });
  });

  describe('deleteDocument', () => {
    it('deletes embeddings, chunks and document', async () => {
      await ragDatabase.ensureReady();
      ragDatabase.deleteDocument(42);
      expectDeleteCascade();
    });
  });

  describe('getDocumentsByProject', () => {
    it('returns documents for the given project', async () => {
      await ragDatabase.ensureReady();
      const mockDocs = [
        {
          id: 1,
          sync_id: 'doc-sync-1',
          project_id: 'proj1',
          name: 'doc1.txt',
          path: '/p',
          size: 100,
          created_at: '2024-01-01',
          enabled: 1,
        },
      ];
      mockExecuteSync.mockReturnValue({ rows: mockDocs });

      const docs = ragDatabase.getDocumentsByProject('proj1');
      expect(docs).toEqual(mockDocs);
    });
  });

  describe('toggleEnabled', () => {
    it('updates enabled flag', async () => {
      await ragDatabase.ensureReady();
      ragDatabase.toggleEnabled(42, false);
      const updateCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE'),
      );
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][1]).toEqual([0, 42]);
    });
  });

  describe('getChunksByProject', () => {
    it('returns chunks for a project', async () => {
      await ragDatabase.ensureReady();
      const mockResults = [
        {
          doc_id: 1,
          name: 'doc.txt',
          content: 'some content',
          position: 0,
          score: 0,
        },
      ];
      mockExecuteSync.mockReturnValue({ rows: mockResults });

      const results = ragDatabase.getChunksByProject('proj1', 5);
      expect(results).toEqual(mockResults);
    });
  });

  describe('deleteDocumentsByProject', () => {
    it('deletes all embeddings, chunks and documents for a project', async () => {
      await ragDatabase.ensureReady();

      ragDatabase.deleteDocumentsByProject('proj1');
      expectDeleteCascade();
    });
  });

  describe('error handling', () => {
    it('throws if getDb called before ensureReady', () => {
      (ragDatabase as any).ready = false;
      (ragDatabase as any).db = null;
      expect(() =>
        ragDatabase.insertDocument({
          projectId: 'p',
          name: 'n',
          path: 'path',
          size: 0,
        }),
      ).toThrow('not initialized');
    });

    it('rolls back insertChunks transaction on error', async () => {
      await ragDatabase.ensureReady();
      let callCount = 0;
      mockExecuteSync.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO rag_chunks')) {
          callCount++;
          if (callCount === 1) throw new Error('insert failed');
        }
        return { insertId: 1, rowsAffected: 1, rows: [] };
      });

      expect(() =>
        ragDatabase.insertChunks(42, [{ content: 'chunk', position: 0 }]),
      ).toThrow('insert failed');

      const rollbackCall = mockExecuteSync.mock.calls.find(
        (c: any[]) => c[0] === 'ROLLBACK',
      );
      expect(rollbackCall).toBeDefined();
    });

    it('rolls back insertEmbeddingsBatch transaction on error', async () => {
      await ragDatabase.ensureReady();
      mockExecuteSync.mockImplementation((sql: string) => {
        if (sql.includes('INSERT INTO rag_embeddings'))
          throw new Error('embed failed');
        return { insertId: 1, rowsAffected: 1, rows: [] };
      });

      expect(() =>
        ragDatabase.insertEmbeddingsBatch([
          { chunkRowid: 1, docId: 42, embedding: [0.1, 0.2] },
        ]),
      ).toThrow('embed failed');

      const rollbackCall = mockExecuteSync.mock.calls.find(
        (c: any[]) => c[0] === 'ROLLBACK',
      );
      expect(rollbackCall).toBeDefined();
    });
  });
});
