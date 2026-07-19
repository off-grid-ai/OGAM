/**
 * Integration Tests: RAG Flow
 *
 * Tests the integration between:
 * - ragService → ragDatabase (index, search, delete lifecycle)
 * - chunkDocument → ragDatabase (chunking feeds into indexing)
 * - retrievalService → ragDatabase (search + formatting)
 * - ragService → documentService (text extraction)
 * - embeddingService → ragDatabase (embedding generation + storage)
 *
 * Uses mocked SQLite and llama.rn but tests the full flow through all RAG layers.
 */

const mockExecuteSync = jest.fn();
const mockDb = {
  executeSync: mockExecuteSync,
  execute: jest.fn(() =>
    Promise.resolve({ rows: [], insertId: 0, rowsAffected: 0 }),
  ),
  close: jest.fn(),
};

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => mockDb),
}));

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../src/services/documentService', () => ({
  documentService: {
    processDocumentFromPath: jest.fn(),
  },
}));

jest.mock('../../../src/services/rag/embedding', () => ({
  embeddingService: {
    load: jest.fn(() => Promise.resolve()),
    embed: jest.fn((text: string) =>
      Promise.resolve(
        new Array(384).fill(0).map((_, i) => Math.sin(i + text.length * 0.1)),
      ),
    ),
    embedBatch: jest.fn((texts: string[]) =>
      Promise.resolve(
        texts.map(t =>
          new Array(384).fill(0).map((_, i) => Math.sin(i + t.length * 0.1)),
        ),
      ),
    ),
    isLoaded: jest.fn(() => true),
    unload: jest.fn(() => Promise.resolve()),
    getDimension: jest.fn(() => 384),
  },
}));

import { ragService, retrievalService } from '../../../src/services/rag';
import { chunkDocument } from '../../../src/services/rag/chunking';
import { ragDatabase } from '../../../src/services/rag/database';
import { documentService } from '../../../src/services/documentService';

const mockDocService = documentService as jest.Mocked<typeof documentService>;

describe('RAG Flow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ragDatabase as any).ready = false;
    (ragDatabase as any).db = null;
    mockExecuteSync.mockReturnValue({ rows: [], insertId: 0, rowsAffected: 0 });
  });

  // ============================================================================
  // Full indexing pipeline
  // ============================================================================
  describe('document indexing pipeline', () => {
    it('extracts text, chunks it, stores chunks and embeddings', async () => {
      const longText = Array.from(
        { length: 10 },
        (_, i) =>
          `Paragraph ${i}: This is a detailed section about topic ${i} with enough content to form a chunk.`,
      ).join('\n\n');

      mockDocService.processDocumentFromPath.mockResolvedValue({
        id: '1',
        type: 'document',
        uri: '/docs/guide.pdf',
        fileName: 'guide.pdf',
        textContent: longText,
        fileSize: 5000,
      });
      mockExecuteSync.mockReturnValue({
        rows: [],
        insertId: 42,
        rowsAffected: 1,
      });

      const progressStages: string[] = [];
      await ragService.indexDocument({
        projectId: 'proj-1',
        filePath: '/docs/guide.pdf',
        fileName: 'guide.pdf',
        fileSize: 5000,
        onProgress: p => progressStages.push(p.stage),
      });

      // Verify progress callbacks fired in order including embedding stage
      expect(progressStages).toEqual([
        'extracting',
        'chunking',
        'indexing',
        'embedding',
        'done',
      ]);

      // Verify document was inserted
      const docInserts = mockExecuteSync.mock.calls.filter(
        (c: any[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('INSERT INTO rag_documents'),
      );
      expect(docInserts).toHaveLength(1);
      expect(docInserts[0][1]).toEqual(
        expect.arrayContaining(['proj-1', 'guide.pdf']),
      );

      // Verify chunks were inserted
      const chunkInserts = mockExecuteSync.mock.calls.filter(
        (c: any[]) =>
          typeof c[0] === 'string' && c[0].includes('INSERT INTO rag_chunks'),
      );
      expect(chunkInserts.length).toBeGreaterThan(0);

      // Verify embeddings were inserted
      const embInserts = mockExecuteSync.mock.calls.filter(
        (c: any[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('INSERT INTO rag_embeddings'),
      );
      expect(embInserts.length).toBeGreaterThan(0);
    });

    it('rejects documents with no extractable text', async () => {
      mockDocService.processDocumentFromPath.mockResolvedValue(null);

      await expect(
        ragService.indexDocument({
          projectId: 'proj-1',
          filePath: '/f',
          fileName: 'empty.bin',
          fileSize: 0,
        }),
      ).rejects.toThrow('Could not extract text');
    });

    it('rejects documents that produce no chunks', async () => {
      mockDocService.processDocumentFromPath.mockResolvedValue({
        id: '1',
        type: 'document',
        uri: '/f',
        fileName: 'tiny.txt',
        textContent: 'hi',
        fileSize: 2,
      });

      await expect(
        ragService.indexDocument({
          projectId: 'proj-1',
          filePath: '/f',
          fileName: 'tiny.txt',
          fileSize: 2,
        }),
      ).rejects.toThrow('no indexable content');
    });
  });

  // ============================================================================
  // Chunking → Retrieval pipeline
  // ============================================================================
  describe('chunking produces searchable content', () => {
    it('chunks a document and retrieval formats results for prompt', () => {
      const text =
        'Introduction to machine learning.\n\nSupervised learning uses labeled data to train models.\n\nUnsupervised learning finds patterns in unlabeled data.';
      const chunks = chunkDocument(text, { chunkSize: 500 });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].content).toContain('machine learning');

      // Simulate search results matching the chunks
      const searchResult = {
        chunks: chunks.map((c, i) => ({
          doc_id: 1,
          name: 'ml-guide.txt',
          content: c.content,
          position: c.position,
          score: 1 - i * 0.1,
        })),
        truncated: false,
      };

      const formatted = retrievalService.formatForPrompt(searchResult);
      expect(formatted).toContain('<knowledge_base>');
      expect(formatted).toContain('</knowledge_base>');
      expect(formatted).toContain('[Source: ml-guide.txt');
      expect(formatted).toContain('machine learning');
    });
  });

  // ============================================================================
  // Search with budget
  // ============================================================================
  describe('search with budget truncation', () => {
    it('respects character budget and truncates lower-ranked results', async () => {
      const longContent = 'x'.repeat(2000);
      const shortContent = 'Short relevant chunk.';

      // No embeddings → falls back to getChunksByProject
      mockExecuteSync.mockImplementation((sql: string) => {
        if (
          typeof sql === 'string' &&
          sql.includes('rag_embeddings') &&
          sql.includes('SELECT')
        ) {
          return { rows: [] };
        }
        if (
          typeof sql === 'string' &&
          sql.includes('rag_chunks') &&
          sql.includes('SELECT')
        ) {
          return {
            rows: [
              {
                doc_id: 1,
                name: 'big.txt',
                content: longContent,
                position: 0,
                score: 0,
              },
              {
                doc_id: 2,
                name: 'small.txt',
                content: shortContent,
                position: 0,
                score: 0,
              },
            ],
          };
        }
        return { rows: [], insertId: 0, rowsAffected: 0 };
      });

      // Initialize DB first
      (ragDatabase as any).ready = true;
      (ragDatabase as any).db = mockDb;

      // Budget = 1024 tokens * 4 * 0.25 = 1024 chars. longContent is 2000.
      const result = await retrievalService.searchWithBudget({
        projectId: 'proj-1',
        query: 'test',
        contextLength: 1024,
      });

      expect(result.truncated).toBe(true);
      expect(result.chunks).toHaveLength(0); // First chunk exceeds budget
    });

    it('includes all results when within budget', async () => {
      mockExecuteSync.mockImplementation((sql: string) => {
        if (
          typeof sql === 'string' &&
          sql.includes('rag_embeddings') &&
          sql.includes('SELECT')
        ) {
          return { rows: [] };
        }
        if (
          typeof sql === 'string' &&
          sql.includes('rag_chunks') &&
          sql.includes('SELECT')
        ) {
          return {
            rows: [
              {
                doc_id: 1,
                name: 'a.txt',
                content: 'short chunk one',
                position: 0,
                score: 0,
              },
              {
                doc_id: 2,
                name: 'b.txt',
                content: 'short chunk two',
                position: 0,
                score: 0,
              },
            ],
          };
        }
        return { rows: [], insertId: 0, rowsAffected: 0 };
      });

      (ragDatabase as any).ready = true;
      (ragDatabase as any).db = mockDb;

      const result = await retrievalService.searchWithBudget({
        projectId: 'proj-1',
        query: 'test',
        contextLength: 4096,
      });

      expect(result.truncated).toBe(false);
      expect(result.chunks).toHaveLength(2);
    });
  });

  // ============================================================================
  // Project-scoped document lifecycle
  // ============================================================================
  describe('project-scoped document lifecycle', () => {
    beforeEach(async () => {
      mockExecuteSync.mockReturnValue({
        rows: [],
        insertId: 0,
        rowsAffected: 0,
      });
      await ragService.ensureReady();
    });

    it("getDocumentsByProject returns only that project's documents", async () => {
      const mockDocs = [
        {
          id: 1,
          project_id: 'proj-1',
          name: 'a.txt',
          path: '/a',
          size: 100,
          created_at: '2024-01-01',
          enabled: 1,
        },
      ];
      mockExecuteSync.mockReturnValue({ rows: mockDocs });

      const docs = await ragService.getDocumentsByProject('proj-1');
      expect(docs).toEqual(mockDocs);

      // Verify query was scoped to project
      const selectCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('SELECT') &&
          c[0].includes('project_id'),
      );
      expect(selectCalls.length).toBeGreaterThan(0);
      expect(selectCalls[0][1]).toContain('proj-1');
    });

    it('toggleDocument changes enabled state', async () => {
      await ragService.toggleDocument(1, false);

      const updateCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE'),
      );
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0][1]).toEqual([0, 1]); // enabled=0, docId=1
    });

    it('deleteDocument removes embeddings, chunks and document', async () => {
      await ragService.deleteDocument(42);

      const deleteCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE'),
      );
      expect(deleteCalls).toHaveLength(3);
      expect(deleteCalls[0][0]).toContain('rag_embeddings');
      expect(deleteCalls[1][0]).toContain('rag_chunks');
      expect(deleteCalls[2][0]).toContain('rag_documents');
    });

    it('deleteProjectDocuments cleans up all docs for a project', async () => {
      await ragService.deleteProjectDocuments('proj-1');

      const deleteCalls = mockExecuteSync.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('DELETE'),
      );
      // 1 embeddings delete + 1 chunks delete + 1 docs delete
      expect(deleteCalls).toHaveLength(3);
      expect(deleteCalls[0][0]).toContain('rag_embeddings');
      expect(deleteCalls[1][0]).toContain('rag_chunks');
      expect(deleteCalls[2][0]).toContain('rag_documents');
    });
  });

  // ============================================================================
  // KB tool integration
  // ============================================================================
  describe('search_knowledge_base tool integration', () => {
    it('tool handler searches project KB and returns formatted results', async () => {
      const {
        executeToolCall,
      } = require('../../../src/services/tools/handlers');

      // No embeddings → fallback to chunks
      mockExecuteSync.mockImplementation((sql: string) => {
        if (
          typeof sql === 'string' &&
          sql.includes('rag_embeddings') &&
          sql.includes('SELECT')
        ) {
          return { rows: [] };
        }
        if (
          typeof sql === 'string' &&
          sql.includes('rag_chunks') &&
          sql.includes('SELECT')
        ) {
          return {
            rows: [
              {
                doc_id: 1,
                name: 'guide.pdf',
                content: 'Solar panel installation guide',
                position: 0,
                score: 0,
              },
            ],
          };
        }
        return { rows: [], insertId: 0, rowsAffected: 0 };
      });
      (ragDatabase as any).ready = true;
      (ragDatabase as any).db = mockDb;

      const result = await executeToolCall({
        id: 'tc-1',
        name: 'search_knowledge_base',
        arguments: { query: 'solar panel' },
        context: { projectId: 'proj-1' },
      });

      expect(result.error).toBeUndefined();
      expect(result.content).toContain('guide.pdf');
      expect(result.content).toContain('Solar panel installation guide');
    });

    it('tool handler returns no results for unmatched query', async () => {
      const {
        executeToolCall,
      } = require('../../../src/services/tools/handlers');

      mockExecuteSync.mockReturnValue({ rows: [] });
      (ragDatabase as any).ready = true;
      (ragDatabase as any).db = mockDb;

      const result = await executeToolCall({
        id: 'tc-2',
        name: 'search_knowledge_base',
        arguments: { query: 'quantum physics' },
        context: { projectId: 'proj-1' },
      });

      expect(result.error).toBeUndefined();
      expect(result.content).toContain('No results found');
    });

    it('tool handler returns error without project context', async () => {
      const {
        executeToolCall,
      } = require('../../../src/services/tools/handlers');

      const result = await executeToolCall({
        id: 'tc-3',
        name: 'search_knowledge_base',
        arguments: { query: 'test' },
      });

      expect(result.error).toBeUndefined();
      expect(result.content).toContain('No project context');
    });
  });

  // ============================================================================
  // Edge cases
  // ============================================================================
  describe('edge cases', () => {
    it('search returns empty for projects with no documents', async () => {
      mockExecuteSync.mockReturnValue({ rows: [] });
      await ragService.ensureReady();

      const result = await ragService.searchProject('proj-no-docs', 'anything');
      expect(result.chunks).toEqual([]);
    });

    it('formatForPrompt returns empty string when no chunks', () => {
      expect(
        retrievalService.formatForPrompt({ chunks: [], truncated: false }),
      ).toBe('');
    });

    it('chunking handles single long paragraph with overlap', () => {
      const longParagraph =
        'The quick brown fox jumps over the lazy dog. '.repeat(50);
      const chunks = chunkDocument(longParagraph, {
        chunkSize: 200,
        overlap: 50,
      });

      expect(chunks.length).toBeGreaterThan(1);
      // Verify overlap: end of chunk N should overlap with start of chunk N+1
      if (chunks.length >= 2) {
        const overlap = chunks[0].content.slice(-50);
        expect(chunks[1].content).toContain(overlap.slice(0, 10));
      }
    });

    it('chunking handles empty paragraphs gracefully', () => {
      const text =
        'First paragraph is here.\n\n\n\n\n\nSecond paragraph is here.';
      const chunks = chunkDocument(text, { chunkSize: 500 });
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toContain('First');
      expect(chunks[0].content).toContain('Second');
    });
  });
});
