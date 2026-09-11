import { RagApplication, type ChunkCandidate, type ExtractionBridges, type VectorStore } from '@offgrid/rag';

interface StoredChunk extends ChunkCandidate { projectId: string }
const chunks: StoredChunk[] = [];
const getChunkCandidates = jest.fn(async (projectId: string) => chunks.filter(chunk => chunk.projectId === projectId));
const getFallbackChunks = jest.fn(async (projectId: string, limit: number) =>
  chunks.filter(chunk => chunk.projectId === projectId).slice(0, limit));

const store: VectorStore = {
  ensureReady: async () => undefined,
  addDocument: async () => 1,
  addChunks: async () => undefined,
  getChunkCandidates,
  getFallbackChunks,
  listDocuments: async () => [],
  listDocumentPage: async () => ({ documents: [], nextAfterId: null }),
  setDocumentEnabled: async () => undefined,
  deleteDocument: async () => undefined,
};
const extraction: ExtractionBridges = {
  readText: async () => { throw new Error('Not used by retrieval'); },
};
const embeddings = {
  dimension: 3,
  embed: async (text: string) => {
    const normalized = text.toLowerCase();
    if (normalized.includes('cat')) return [1, 0, 0];
    if (normalized.includes('dog')) return [0, 1, 0];
    return [0, 0, 1];
  },
};
const CAT_VEC = [1, 0, 0];
const DOG_VEC = [0, 1, 0];

function seed(): void {
  chunks.length = 0;
  chunks.push(
    { projectId: 'alpha', docId: 1, name: 'alpha-cats.txt', content: 'ALPHA cat chunk', position: 0, embedding: CAT_VEC },
    { projectId: 'alpha', docId: 1, name: 'alpha-cats.txt', content: 'ALPHA more cat', position: 1, embedding: CAT_VEC },
    { projectId: 'beta', docId: 2, name: 'beta-dogs.txt', content: 'BETA dog secret', position: 0, embedding: DOG_VEC },
  );
}

describe('RAG retrieval project scoping through the Shared application', () => {
  let rag: RagApplication;
  beforeEach(() => {
    getChunkCandidates.mockClear();
    getFallbackChunks.mockClear();
    seed();
    rag = new RagApplication({ store, embeddings, extraction });
  });

  it('returns chunks only from the requested project', async () => {
    const result = await rag.search('alpha', 'tell me about cat', { topK: 5 });
    expect(result.chunks).not.toHaveLength(0);
    expect(result.chunks.every(chunk => chunk.name === 'alpha-cats.txt')).toBe(true);
    expect(result.chunks.map(chunk => chunk.content).join(' ')).not.toContain('BETA');
    expect(getChunkCandidates).toHaveBeenCalledWith('alpha');
    expect(getChunkCandidates).not.toHaveBeenCalledWith('beta');
  });

  it('keeps the same query inside a different project', async () => {
    const result = await rag.search('beta', 'tell me about cat', { topK: 5 });
    expect(result.chunks.every(chunk => chunk.name === 'beta-dogs.txt')).toBe(true);
    expect(result.chunks.some(chunk => chunk.content.includes('ALPHA'))).toBe(false);
  });

  it('caps results with the Shared topK option', async () => {
    expect((await rag.search('alpha', 'cat', { topK: 1 })).chunks).toHaveLength(1);
  });

  it('ranks the closest chunk first inside the project', async () => {
    chunks.length = 0;
    chunks.push(
      { projectId: 'alpha', docId: 1, name: 'a.txt', content: 'cat content', position: 0, embedding: CAT_VEC },
      { projectId: 'alpha', docId: 1, name: 'a.txt', content: 'dog content', position: 1, embedding: DOG_VEC },
    );
    expect((await rag.search('alpha', 'about a cat', { topK: 2 })).chunks[0].content).toBe('cat content');
  });

  it('keeps fallback chunks inside the requested project', async () => {
    chunks.length = 0;
    chunks.push(
      { projectId: 'alpha', docId: 1, name: 'a.txt', content: 'ALPHA fallback', position: 0, embedding: [] },
      { projectId: 'beta', docId: 2, name: 'b.txt', content: 'BETA fallback', position: 0, embedding: [] },
    );
    getChunkCandidates.mockResolvedValueOnce([]);
    const result = await rag.search('alpha', 'anything', { topK: 5 });
    expect(getFallbackChunks).toHaveBeenCalledWith('alpha', 5);
    expect(result.chunks.every(chunk => !chunk.content.includes('BETA'))).toBe(true);
  });

  it('does not read project chunks for an empty query', async () => {
    expect(await rag.search('alpha', '   ', { topK: 5 })).toEqual({ chunks: [], query: '   ' });
    expect(getChunkCandidates).not.toHaveBeenCalled();
  });
});
