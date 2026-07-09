/**
 * BATCH 7 (Projects) hardening — RAG retrieval is project-scoped.
 *
 * The existing retrieval.test.ts mocks ragDatabase per-call, so it never proves
 * that a query for project A cannot surface project B's chunks: the mock just
 * returns whatever a single test told it, regardless of the projectId argument.
 *
 * These tests drive the REAL retrievalService against a fake DB that actually
 * HOLDS both projects' embeddings/chunks in one store and honors the projectId
 * filter (the same WHERE d.project_id = ? contract the real SQLite implements).
 * That makes "a query only retrieves THIS project's chunks" a genuine property:
 * if retrievalService dropped the projectId or the DB stopped filtering, these
 * fail. Only the sqlite-native and embedding-native boundaries are faked; the
 * retrieval logic (embedding, cosine ranking, topK slice, project routing) is
 * the real code under test.
 */

// A real in-memory store the fake DB reads from, honoring projectId. Declared
// with `var` (hoisted) and `mock`-prefixed so the jest.mock factory — which is
// itself hoisted above these lines — can safely reference it at import time.
// The array is only mutated (never reassigned), so the reference stays valid.
var mockStore: {
  projectId: string;
  docId: number;
  name: string;
  content: string;
  position: number;
  embedding: number[];
}[] = [];

jest.mock('../../src/services/rag/database', () => ({
  ragDatabase: {
    ensureReady: jest.fn(() => Promise.resolve()),
    getEmbeddingsByProject: jest.fn((projectId: string) =>
      mockStore
        .filter((r) => r.projectId === projectId)
        .map((r) => ({
          chunk_rowid: r.docId * 100 + r.position,
          doc_id: r.docId,
          name: r.name,
          content: r.content,
          position: r.position,
          embedding: r.embedding,
        })),
    ),
    getChunksByProject: jest.fn((projectId: string, topK: number) =>
      mockStore
        .filter((r) => r.projectId === projectId)
        .slice(0, topK)
        .map((r) => ({ doc_id: r.docId, name: r.name, content: r.content, position: r.position, score: 0 })),
    ),
  },
}));

// Embedding native boundary: deterministic, direction-preserving unit vectors.
jest.mock('../../src/services/rag/embedding', () => ({
  embeddingService: {
    isLoaded: jest.fn(() => true),
    load: jest.fn(() => Promise.resolve()),
    embed: jest.fn((text: string) => {
      const t = text.toLowerCase();
      if (t.includes('cat')) return Promise.resolve([1, 0, 0]);
      if (t.includes('dog')) return Promise.resolve([0, 1, 0]);
      return Promise.resolve([0, 0, 1]);
    }),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { retrievalService } from '../../src/services/rag/retrieval';
import { ragDatabase } from '../../src/services/rag/database';

const mockGetEmbeddings = ragDatabase.getEmbeddingsByProject as jest.Mock;
const mockGetChunks = ragDatabase.getChunksByProject as jest.Mock;

const CAT_VEC = [1, 0, 0];
const DOG_VEC = [0, 1, 0];

function seed() {
  mockStore.length = 0;
  // Project alpha: two chunks about cats.
  mockStore.push({ projectId: 'alpha', docId: 1, name: 'alpha-cats.txt', content: 'ALPHA cat chunk', position: 0, embedding: CAT_VEC });
  mockStore.push({ projectId: 'alpha', docId: 1, name: 'alpha-cats.txt', content: 'ALPHA more cat', position: 1, embedding: CAT_VEC });
  // Project beta: a chunk about dogs and a distinctly-worded secret.
  mockStore.push({ projectId: 'beta', docId: 2, name: 'beta-dogs.txt', content: 'BETA dog secret', position: 0, embedding: DOG_VEC });
}

describe('BATCH7 RAG retrieval project scoping (real retrievalService)', () => {
  beforeEach(() => {
    mockGetEmbeddings.mockClear();
    mockGetChunks.mockClear();
    seed();
  });

  it('a query only retrieves THIS project\'s chunks (case 34/36 semantics)', async () => {
    const result = await retrievalService.search('alpha', 'tell me about cat', 5);
    expect(result.chunks.length).toBeGreaterThan(0);
    // Every returned chunk belongs to alpha; beta's content never leaks.
    for (const chunk of result.chunks) {
      expect(chunk.name).toBe('alpha-cats.txt');
      expect(chunk.content.startsWith('ALPHA')).toBe(true);
    }
    const joined = result.chunks.map((c) => c.content).join(' ');
    expect(joined).not.toContain('BETA');
    expect(joined).not.toContain('dog secret');
    // The DB was asked ONLY for alpha's embeddings.
    expect(mockGetEmbeddings).toHaveBeenCalledWith('alpha');
    expect(mockGetEmbeddings).not.toHaveBeenCalledWith('beta');
  });

  it('the SAME query against a different project returns that project\'s chunks only', async () => {
    const result = await retrievalService.search('beta', 'tell me about cat', 5);
    // beta has no cat chunk, but semantic search still returns beta's own chunks
    // (ranked), never alpha's.
    for (const chunk of result.chunks) {
      expect(chunk.name).toBe('beta-dogs.txt');
    }
    expect(result.chunks.some((c) => c.content.includes('ALPHA'))).toBe(false);
  });

  it('topK caps the number of returned chunks', async () => {
    // alpha has 2 chunks; asking for 1 must return exactly 1.
    const result = await retrievalService.search('alpha', 'cat', 1);
    expect(result.chunks).toHaveLength(1);
  });

  it('ranks the more semantically-similar chunk first within the project', async () => {
    // Give alpha one cat chunk and one dog chunk; a cat query should rank cat first.
    mockStore.length = 0;
    mockStore.push({ projectId: 'alpha', docId: 1, name: 'a.txt', content: 'cat content', position: 0, embedding: CAT_VEC });
    mockStore.push({ projectId: 'alpha', docId: 1, name: 'a.txt', content: 'dog content', position: 1, embedding: DOG_VEC });

    const result = await retrievalService.search('alpha', 'about a cat', 2);
    expect(result.chunks[0].content).toBe('cat content');
  });

  it('falls back to this project\'s first chunks when it has no embeddings — still scoped', async () => {
    // No embeddings for anyone -> getEmbeddingsByProject returns [] -> fallback to
    // getChunksByProject, which is also project-scoped.
    mockStore.length = 0;
    mockStore.push({ projectId: 'alpha', docId: 1, name: 'a.txt', content: 'ALPHA fallback', position: 0, embedding: [] });
    mockStore.push({ projectId: 'beta', docId: 2, name: 'b.txt', content: 'BETA fallback', position: 0, embedding: [] });
    // getEmbeddingsByProject returns [] because no rows carry a usable embedding
    // for the query path; force the empty-embeddings branch explicitly.
    mockGetEmbeddings.mockReturnValueOnce([]);

    const result = await retrievalService.search('alpha', 'anything', 5);
    expect(mockGetChunks).toHaveBeenCalledWith('alpha', 5);
    for (const chunk of result.chunks) {
      expect(chunk.content).not.toContain('BETA');
    }
  });

  it('an empty query returns nothing (no cross-project leak on empty input)', async () => {
    const result = await retrievalService.search('alpha', '   ', 5);
    expect(result.chunks).toEqual([]);
    // No DB read attempted for an empty query.
    expect(mockGetEmbeddings).not.toHaveBeenCalled();
  });
});
