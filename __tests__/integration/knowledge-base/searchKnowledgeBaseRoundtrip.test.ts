/**
 * GUARD (integration, REAL sqlite) — the search_knowledge_base tool round-trips against a real DB:
 * a user indexes a document, the model calls search_knowledge_base, and the tool returns the real
 * indexed content. Everything we own runs (indexDocument, chunking, ragDatabase SQL + BLOB storage,
 * retrieval cosine, the tool handler); only the native doc-extraction and the embedding MODEL are faked
 * (deterministic keyword vectors so ranking is genuine). The DB is a REAL node:sqlite :memory: engine
 * doing the hard work — not the dumb op-sqlite mock.
 */
import { installRealSqlite } from '../../harness/sqliteFake';

const KEYWORDS = ['zenland', 'quixotic', 'capital', 'weather', 'banana', 'dog'];
const toVec = (text: string): number[] => KEYWORDS.map(k => (text.toLowerCase().includes(k) ? 1 : 0));

describe('search_knowledge_base — real RAG round-trip (guard)', () => {
  it('returns the indexed document content when the model searches the knowledge base', async () => {
    installRealSqlite();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { ragService } = require('../../../src/services/rag');
    const { embeddingService } = require('../../../src/services/rag/embedding');
    const { documentService } = require('../../../src/services/documentService');
    const { executeToolCall } = require('../../../src/services/tools/handlers');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // Native doc extraction → a document with a distinctive fact + a distractor sentence.
    jest.spyOn(documentService, 'processDocumentFromPath').mockResolvedValue({
      type: 'document',
      textContent: 'The capital of Zenland is Quixotic City. Bananas are a yellow fruit. Weather is mild.',
    } as never);
    // Embedding MODEL boundary: deterministic keyword vectors so cosine ranking is real.
    jest.spyOn(embeddingService, 'load').mockResolvedValue(undefined as never);
    jest.spyOn(embeddingService, 'getDimension').mockReturnValue(KEYWORDS.length);
    jest.spyOn(embeddingService, 'embed').mockImplementation((async (t: unknown) => toVec(String(t))) as never);
    jest.spyOn(embeddingService, 'embedBatch').mockImplementation((async (ts: unknown) => (ts as string[]).map(toVec)) as never);

    // User indexes the document into the project's knowledge base (real SQL + BLOB round-trip).
    await ragService.indexDocument({ projectId: 'p1', filePath: '/docs/zenland.pdf', fileName: 'zenland.pdf', fileSize: 512 });

    // The model calls the tool during a project chat.
    const result = await executeToolCall({
      id: 'tc1', name: 'search_knowledge_base', arguments: { query: 'what is the capital of Zenland?' },
      context: { projectId: 'p1' },
    });

    // The tool returns the real indexed content the retrieval ranked highest — the KB actually works.
    expect(result.error).toBeFalsy();
    expect(result.content).toMatch(/Quixotic City/);
  });
});
