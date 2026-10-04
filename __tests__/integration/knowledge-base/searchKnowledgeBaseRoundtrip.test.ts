/**
 * GUARD (integration, REAL sqlite) — the search_knowledge_base tool round-trips against a real DB:
 * a user indexes a document, the model calls search_knowledge_base, and the tool returns the real
 * indexed content. Everything we own runs (indexDocument, chunking, ragDatabase SQL + BLOB storage,
 * retrieval cosine, the shared generation boundary, and the tool handler). Only the filesystem and
 * native embedding engine are device-boundary fakes. The DB is a REAL node:sqlite :memory: engine.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { doMockRealSqlite } from '../../harness/sqliteFake';

let applicationFixture: import('../../harness/mobileApplicationFixture').MobileApplicationFixture | undefined;
afterEach(async () => {
  await applicationFixture?.dispose();
  applicationFixture = undefined;
});

describe('search_knowledge_base — real RAG round-trip (guard)', () => {
  it('returns the indexed document content when the model searches the knowledge base', async () => {
    const boundary = installNativeBoundary({ fs: true, llama: true });
    doMockRealSqlite();

    const RNFS = require('react-native-fs');

    await RNFS.writeFile(
      `${boundary.fs!.DocumentDirectoryPath}/all-MiniLM-L6-v2-Q8_0.gguf`,
      'GGUF',
    );
    await RNFS.writeFile(
      '/docs/zenland.txt',
      'The capital of Zenland is Quixotic City. Bananas are a yellow fruit. Weather is mild.',
    );

    // Start the real composition root so RAG reaches the native embedding fake
    // through the same Shared GenerationService port as production.
    const { startMobileApplicationFixture } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    applicationFixture = await startMobileApplicationFixture();
    const { executeToolCall } = require('../../../src/services/tools/handlers');

    // User indexes the document into the project's knowledge base (real SQL + BLOB round-trip).
    const indexed = await applicationFixture.application.rag.addDocument({
      projectId: 'p1',
      path: '/docs/zenland.txt',
      fileName: 'zenland.txt',
      size: 512,
    });
    if (!indexed.ok) throw new Error(JSON.stringify(indexed.failure));

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
