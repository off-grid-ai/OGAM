/**
 * RED-FLOW (integration) — PR#452: a document whose embedding fails is left as a silent, non-searchable
 * "indexed" entry instead of being rolled back.
 *
 * indexDocument inserts the document + chunks, then generates embeddings inside a try/catch that swallows
 * any failure "(non-fatal)" and still returns the docId (rag/index.ts:62-79). The document then shows in
 * the Knowledge Base but has zero embeddings — semantic search skips it, and there's no auto-backfill, so
 * it's stranded permanently. Correct: on embed failure, roll back the just-inserted doc + chunks and throw
 * so the KB screen surfaces the error.
 *
 * Real ragService.indexDocument runs over a REAL in-memory sqlite (node:sqlite) — the DB does the hard
 * work. The only faked boundaries are the native doc-extraction (documentService) and the embedding model
 * (embeddingService, made to OOM).
 */
import { installRealSqlite } from '../../harness/sqliteFake';

describe('PR#452 — KB indexDocument leaves a dead entry on embed failure (red-flow)', () => {
  it('rolls back the document (no silent non-searchable entry) when embedding fails', async () => {
    installRealSqlite();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { ragService } = require('../../../src/services/rag');
    const { embeddingService } = require('../../../src/services/rag/embedding');
    const { documentService } = require('../../../src/services/documentService');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // Native doc extraction → real text (so chunking produces chunks against the real DB).
    jest.spyOn(documentService, 'processDocumentFromPath').mockResolvedValue({
      type: 'document', textContent: 'The quarterly report. '.repeat(200),
    } as never);
    // Embedding model boundary: load ok, but the batch OOMs (the real device failure).
    jest.spyOn(embeddingService, 'load').mockResolvedValue(undefined as never);
    jest.spyOn(embeddingService, 'embedBatch').mockRejectedValue(new Error('OOM: embedding model ran out of memory'));

    let threw = false;
    await ragService.indexDocument({ projectId: 'p1', filePath: '/docs/report.pdf', fileName: 'report.pdf', fileSize: 4096 })
      .catch(() => { threw = true; });

    const docs = await ragService.getDocumentsByProject('p1');

    // Correct: the embed failure rolls back the insert and throws → no dead entry in the KB.
    // Today it swallows the failure and returns success → the doc IS listed (real sqlite inserted it)
    // but has zero embeddings, so it's not searchable → RED (received length 1) + no throw.
    expect(docs).toHaveLength(0);
    expect(threw).toBe(true);
  });
});
