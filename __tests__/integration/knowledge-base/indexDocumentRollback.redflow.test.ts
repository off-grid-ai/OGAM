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
 * work. The only faked boundaries are the filesystem, SQLite driver, and llama.rn embedding runtime.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { doMockRealSqlite } from '../../harness/sqliteFake';

let applicationFixture: import('../../harness/mobileApplicationFixture').MobileApplicationFixture | undefined;
afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = undefined;
});

describe('PR#452 — KB indexDocument leaves a dead entry on embed failure (red-flow)', () => {
  it('rolls back the document (no silent non-searchable entry) when embedding fails', async () => {
    const boundary = installNativeBoundary({ fs: true, llama: true });
    doMockRealSqlite();
    const RNFS = require('react-native-fs');
    await RNFS.writeFile('/docs/report.txt', 'The quarterly report. '.repeat(200));
    boundary.llama!.module.initLlama.mockResolvedValue({
      embedding: jest.fn().mockRejectedValue(new Error('OOM: embedding model ran out of memory')),
      release: jest.fn().mockResolvedValue(undefined),
    });
    const { startMobileApplicationFixture } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    applicationFixture = await startMobileApplicationFixture();

    const indexed = await applicationFixture.application.rag.addDocument({
      projectId: 'p1', path: '/docs/report.txt', fileName: 'report.txt', size: 4096,
    });
    const docs = await applicationFixture.application.rag.listDocuments('p1');

    // The facade reports the embed failure and the transaction leaves no dead KB entry.
    expect(indexed.ok).toBe(false);
    expect(docs.ok).toBe(true);
    if (docs.ok) expect(docs.value).toHaveLength(0);
  });
});
