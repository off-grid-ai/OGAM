/**
 * What retrieval is allowed to put in the prompt: how much, and whose.
 *
 * Two things decide whether a project chat works at all, and neither is about finding text:
 *
 *  - THE BUDGET. Retrieved chunks are prepended to the user's question, so a retrieval that ignores the
 *    context window pushes the question itself out of the window. The user watches the model answer a
 *    different question, or answer nothing, with no error anywhere.
 *  - THE SCOPE. A project's knowledge base must return that project's documents and no others. A leak here
 *    means one client's contract quoted into another client's chat - the worst failure this app can have,
 *    and completely silent.
 *
 * Everything runs for real over a REAL in-memory SQLite (harness/sqliteFake) driven through the REAL
 * Mobile composition root (harness/mobileApplicationFixture) - the same `applicationFacade().rag` seam
 * production uses. Documents are genuinely extracted, chunked, embedded and selected back with the actual
 * SQL, including the WHERE that scopes a search to one project. Only the device boundary is stood in for:
 * the filesystem and the native embedding engine (harness/nativeBoundary).
 *
 * REPLACES the budget + project-scope + tool-error cases from `ragFlow.test.ts`, which are deleted. That
 * file mocked the DATABASE by matching SQL strings, so retrieval "found" whatever the matcher was told to
 * hand back and deleting insertDocument from the source would not have failed a single one of those tests.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { doMockRealSqlite } from '../../harness/sqliteFake';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

type ToolCallResult = { error?: unknown; content?: string };
type ExecuteToolCall = (call: Record<string, unknown>) => Promise<ToolCallResult>;

let fixture: MobileApplicationFixture | undefined;

afterEach(async () => {
  await fixture?.dispose();
  fixture = undefined;
});

/**
 * Stand up the real application over a fresh real DB with only the device boundary faked, and index
 * `docs` through the production RAG facade.
 */
async function withIndexedDocs(
  docs: ReadonlyArray<{ projectId: string; fileName: string; text: string }>,
): Promise<{ application: MobileApplicationFixture['application']; executeToolCall: ExecuteToolCall }> {
  const boundary = installNativeBoundary({ fs: true, llama: true });
  doMockRealSqlite();

  const RNFS = require('react-native-fs');
  await RNFS.writeFile(
    `${boundary.fs!.DocumentDirectoryPath}/all-MiniLM-L6-v2-Q8_0.gguf`,
    'GGUF',
  );
  for (const doc of docs) {
    await RNFS.writeFile(`/docs/${doc.fileName}`, doc.text);
  }

  const { startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  fixture = await startMobileApplicationFixture();
  const { executeToolCall } = require('../../../src/services/tools/handlers');

  for (const doc of docs) {
    const indexed = await fixture.application.rag.addDocument({
      projectId: doc.projectId,
      path: `/docs/${doc.fileName}`,
      fileName: doc.fileName,
      size: doc.text.length,
    });
    if (!indexed.ok) throw new Error(JSON.stringify(indexed.failure));
  }

  return { application: fixture.application, executeToolCall };
}

/** Unwrap the production Outcome the way `requireRagSuccess` does at the real call sites. */
function searchOrThrow(outcome: Awaited<ReturnType<MobileApplicationFixture['application']['rag']['search']>>) {
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.failure));
  return outcome.value;
}

describe('what retrieval puts in the prompt', () => {
  it('stops adding chunks once the context budget is spent, and says it truncated', async () => {
    // One document far larger than a small model's whole window, indexed for real.
    const huge = `Zenland ledger. ${'quarterly ledger entry. '.repeat(400)}`;
    const { application } = await withIndexedDocs([
      { projectId: 'p1', fileName: 'huge.txt', text: huge },
      { projectId: 'p1', fileName: 'small.txt', text: 'Zenland capital note.' },
    ]);

    const result = searchOrThrow(
      await application.rag.search('p1', 'zenland ledger', { contextLength: 512 }),
    );

    // Truncated is the honest signal, and the chunks that DID come back have to fit. Returning everything
    // and letting the prompt builder overflow is how the user's own question gets pushed out of the window.
    expect(result.truncated).toBe(true);
    const returnedChars = result.chunks.reduce((sum, c) => sum + c.content.length, 0);
    expect(returnedChars).toBeLessThan(huge.length);
  });

  it('returns everything when it all fits, and does not claim truncation', async () => {
    const { application } = await withIndexedDocs([
      { projectId: 'p1', fileName: 'a.txt', text: 'Zenland capital is Quixotic City.' },
      { projectId: 'p1', fileName: 'b.txt', text: 'The quarterly ledger balanced.' },
    ]);

    const result = searchOrThrow(
      await application.rag.search('p1', 'zenland capital', { contextLength: 8192 }),
    );

    // A false "truncated" is not harmless: the UI tells the user their knowledge base was too big to use,
    // so they go and delete documents that were fitting perfectly well.
    expect(result.truncated).toBe(false);
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it("never returns another project's documents", async () => {
    const { application } = await withIndexedDocs([
      { projectId: 'client-a', fileName: 'a.txt', text: 'Zenland capital is Quixotic City.' },
      { projectId: 'client-b', fileName: 'b.txt', text: 'Zenland capital is A SECRET FROM CLIENT B.' },
    ]);

    const result = searchOrThrow(
      await application.rag.search('client-a', 'zenland capital', { contextLength: 8192 }),
    );

    // The query matches BOTH documents on content - only the project scope keeps them apart. This is the
    // one failure in this file that is silent AND unrecoverable: the other client's text is already in the
    // prompt by the time anybody could notice.
    const joined = result.chunks.map(c => c.content).join(' ');
    expect(joined).toMatch(/Quixotic City/);
    expect(joined).not.toMatch(/SECRET FROM CLIENT B/);
  });
});

describe('the search_knowledge_base tool when there is nothing to give the model', () => {
  it('says it found nothing rather than failing', async () => {
    const { executeToolCall } = await withIndexedDocs([
      { projectId: 'p1', fileName: 'a.txt', text: 'Zenland capital is Quixotic City.' },
    ]);

    const result = await executeToolCall({
      id: 'tc1',
      name: 'search_knowledge_base',
      arguments: { query: 'quarterly banana ledger audit' },
      context: { projectId: 'p1' },
    });

    // An empty knowledge base is not an error. A tool error makes the model apologise for a broken tool
    // instead of simply answering from what it knows.
    expect(result.error).toBeFalsy();
  });

  it('tells the model there is no knowledge base when no project is open', async () => {
    const { executeToolCall } = await withIndexedDocs([
      { projectId: 'p1', fileName: 'a.txt', text: 'Zenland capital is Quixotic City.' },
    ]);

    const result = await executeToolCall({
      id: 'tc2',
      name: 'search_knowledge_base',
      arguments: { query: 'zenland capital' },
      context: {},
    });

    // Outside a project there is no KB to search, and the model is TOLD so in prose rather than handed a
    // tool error. That distinction is the right one and worth pinning: an error makes the model apologise
    // for a broken tool, while returning nothing would let it conclude the knowledge base is EMPTY and tell
    // the user their documents are missing.
    expect(result.error).toBeFalsy();
    expect(result.content).toMatch(/no project context/i);
  });
});
