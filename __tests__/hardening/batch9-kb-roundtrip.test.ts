/**
 * BATCH 9 — Knowledge Base add → indexed → searchable round-trip (REAL sqlite semantics).
 *
 * on-device test-plan lines 1409-1549 (Knowledge Base cases 11-30). The existing RAG suites
 * (__tests__/unit/services/rag/*, __tests__/integration/rag/ragFlow.test.ts) mock
 * `db.executeSync` by feeding canned rows back per SQL string — the DB never actually
 * stores anything, so retrieval "finds" whatever the mock was told to return. That is a
 * FALSE-GREEN for the round-trip: deleting `insertDocument`/`insertChunks`/
 * `insertEmbeddingsBatch` from the source would NOT fail those tests, because the SELECT
 * mock still returns rows regardless.
 *
 * This file closes that gap. It stands up a tiny in-memory SQL engine that actually
 * executes the exact statements RagDatabase issues (INSERT/SELECT/UPDATE/DELETE across
 * rag_documents/rag_chunks/rag_embeddings, with the JOINs + WHERE d.enabled=1 the
 * retrieval path depends on), stores real rows, assigns real autoincrement ids, and
 * round-trips the Float32Array embedding BLOB. Everything above the DB is REAL:
 * RagService, RetrievalService, cosineSimilarity/vectorMath, chunkDocument. The ONLY
 * mocked boundaries are:
 *   - `@op-engineering/op-sqlite` — the native DB (replaced by the in-memory engine)
 *   - the embedding-native call (`embeddingService.embed`/`embedBatch`) — returns a
 *     DETERMINISTIC vector so cosine ordering is asserted for real, not a canned row.
 *   - `documentService.processDocumentFromPath` for the happy round-trip (returns plain
 *     text); the REAL DocumentService validation is exercised in the rejection cases via
 *     the mocked RNFS boundary only.
 *
 * A deleted insert/select in RagDatabase, a broken toggle WHERE, or a delete that skips a
 * table WILL fail these tests — that is the point.
 *
 * NOTE: KB embed rollback (#452) and embedding-dimension (#453) are covered elsewhere and
 * are NOT duplicated here.
 */

// ── Real SQLite standing in for op-sqlite ─────────────────────────────────────
//
// This used to be a hand-rolled engine that pattern-matched the exact statements RagDatabase issued and
// threw on anything else. It did store real rows, which was the point - but it had to be taught every
// statement, and the moment the schema gained a `sync_id` column with a pragma_table_info migration
// behind it, seven tests failed on `unhandled SQL` rather than on anything about the knowledge base.
//
// Node ships a real SQLite. Adapting it to op-sqlite's tiny surface is less code than the matcher was,
// it cannot fall behind the schema, and it makes this file's own promise - REAL sqlite semantics - true
// rather than aspirational: autoincrement, foreign keys, JOINs, ORDER BY, blob round-trips and the
// migrations are all the database's own behaviour now.
import { DatabaseSync } from 'node:sqlite';
import { defaultNativeFileSystemBoundary } from '../harness/nativeFileSystem';

jest.mock('react-native-fs', () => {
  const { defaultNativeFileSystemBoundary: boundary } = require('../harness/nativeFileSystem');
  return { __esModule: true, default: boundary.module, ...boundary.module };
});

type OpSqliteResult = { rows: Record<string, unknown>[]; insertId: number; rowsAffected: number };

function makeInMemoryDb() {
  const db = new DatabaseSync(':memory:');

  /** op-sqlite hands blobs to the app as something with a .buffer; SQLite gives back a Uint8Array. */
  const toParam = (value: unknown): unknown => {
    // Embeddings travel as a Float32Array's ArrayBuffer. SQLite binds a byte view, so the float data is
    // reinterpreted as bytes here and read back the same way - the round trip is the real one, which is
    // what makes the cosine ordering assertions mean anything.
    if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
    }
    if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
      return new Uint8Array(value as ArrayBuffer);
    }
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value === undefined) return null;
    return value;
  };

  const executeSync = (sql: string, params: unknown[] = []): OpSqliteResult => {
    const bound = params.map(toParam);
    const statement = sql.trim();
    // Transaction control and schema changes take no parameters and return no rows, and SQLite's
    // prepare/run path refuses some of them - insertChunks and insertEmbeddingsBatch both wrap their
    // work in BEGIN/COMMIT, so this is the ordinary path and not an edge case.
    if (/^(begin|commit|rollback|create|alter|drop)\b/i.test(statement)) {
      db.exec(statement);
      return { rows: [], insertId: 0, rowsAffected: 0 };
    }
    // A statement that answers with rows is read; everything else is written. PRAGMA is included
    // because the schema migration reads pragma_table_info to decide whether to add a column.
    if (/^(select|pragma|with)\b/i.test(statement)) {
      const rows = db.prepare(statement).all(...(bound as never[])) as Record<string, unknown>[];
      return { rows: rows.map(row => ({ ...row })), insertId: 0, rowsAffected: 0 };
    }
    let result;
    try {
      result = db.prepare(statement).run(...(bound as never[]));
    } catch (cause) {
      // Surface the database's own words. The service above catches and rethrows as "Embedding
      // generation failed", which says nothing about a constraint or a missing column.
      throw new Error(
        `sqlite refused: ${cause instanceof Error ? cause.message : String(cause)}\n${statement}`,
      );
    }
    return {
      rows: [],
      insertId: Number(result.lastInsertRowid ?? 0),
      rowsAffected: Number(result.changes ?? 0),
    };
  };

  return {
    /** Read the tables directly, so a test can assert what was actually stored. */
    _rows: (table: string): Record<string, unknown>[] =>
      db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[],
    executeSync: jest.fn(executeSync),
    execute: jest.fn(async (sql: string, params: unknown[] = []) => executeSync(sql, params)),
    close: jest.fn(() => db.close()),
    delete: jest.fn(),
  };
}

let mockMemDb = makeInMemoryDb();

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => mockMemDb),
}));

// Deterministic embedding boundary: a 4-dim vector derived from the text so cosine
// similarity ordering is REAL and asserted (not a canned score). Queries closer in this
// toy space rank higher. This is the ONLY stand-in for the llama.rn native embedding.
function mockDeterministicVector(text: string): number[] {
  const t = text.toLowerCase();
  return [
    t.includes('solar') ? 1 : 0,
    t.includes('battery') ? 1 : 0,
    t.includes('wind') ? 1 : 0,
    t.length % 7 === 0 ? 0.2 : 0.1,
  ];
}
import { RagApplication, type IndexDocumentParams } from '@offgrid/rag';
import { ragDatabase } from '../../src/services/adapters/rag/ragDatabaseAdapter';
import {
  mobileRagEmbeddings,
  mobileRagExtraction,
  mobileRagStore,
} from '../../src/services/adapters/rag/mobileRagPorts';
import { installSidecarExecutionBoundary } from '../harness/sidecarExecution';

const disposeSidecarExecution = installSidecarExecutionBoundary({
  embedding: async inputs => inputs.map(mockDeterministicVector),
});

let prepared: { text: string; path: string; size: number } | null = null;
async function prepareDocument(_params: IndexDocumentParams) {
  if (!prepared) throw new Error('Could not extract text from document');
  return { ...prepared, kind: 'text' as const };
}

/** Reset the in-memory DB + force RagDatabase to re-open against the fresh engine. */
function resetDb() {
  mockMemDb = makeInMemoryDb();
  (ragDatabase as any).ready = false;
  (ragDatabase as any).db = null;
}

const PROJECT = 'proj-kb-1';
// Longer than DEFAULT_MIN_CHUNK_LENGTH (20) so it survives chunking; contains "solar".
const SOLAR_DOC = 'A detailed guide to solar panel installation and roof mounting for off-grid homes.';
const BATTERY_DOC = 'Battery storage sizing and charge controller wiring for a home energy system setup.';

describe('BATCH 9 — KB add → indexed → searchable round-trip (real sqlite semantics)', () => {
  let ragService: RagApplication;
  afterAll(disposeSidecarExecution);
  beforeEach(() => {
    jest.restoreAllMocks(); // undo any jest.spyOn from a prior test (clearMocks doesn't)
    jest.clearAllMocks();
    resetDb();
    prepared = null;
    ragService = new RagApplication({
      store: mobileRagStore,
      embeddings: mobileRagEmbeddings,
      extraction: mobileRagExtraction,
      prepareDocument,
    });
  });

  // Case 14/15/16/17: add a document → it is indexed (chunks + embeddings persisted) and
  // appears in the list with its real filename/size.
  it('indexes a document: persists rag_documents, rag_chunks AND rag_embeddings rows (case 14/17)', async () => {
    prepared = { text: SOLAR_DOC, path: '/docs/solar.txt', size: 4200 };

    const stages: string[] = [];
    const { docId } = await ragService.addDocument({
      projectId: PROJECT, path: '/docs/solar.txt', fileName: 'solar.txt', size: 4200,
    }, stage => stages.push(stage));

    // Real rows actually landed in the in-memory tables (not just SQL asserted).
    expect(mockMemDb._rows('rag_documents')).toHaveLength(1);
    expect(mockMemDb._rows('rag_documents')[0]).toMatchObject({ id: docId, project_id: PROJECT, name: 'solar.txt', size: 4200, enabled: 1 });
    expect(mockMemDb._rows('rag_chunks').length).toBeGreaterThan(0);
    expect(mockMemDb._rows('rag_embeddings').length).toBe(mockMemDb._rows('rag_chunks').length);
    // Embeddings are computed before the atomic chunk/index write, so a failed
    // embedding cannot leave indexed chunks without vectors.
    expect(stages).toEqual(['extracting', 'chunking', 'embedding', 'indexing', 'done']);

    // Case 15/16: the real filename + size come back from the list query.
    const docs = await ragService.listDocuments(PROJECT);
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('solar.txt');
    expect(docs[0].size).toBe(4200);
  });

  // Case 14+: retrieval ranks docs by REAL cosine similarity over the stored embeddings.
  //
  // The store→persist round-trip above is exercised for real by the in-memory engine.
  // Here we assert the RANKING logic (RetrievalService + cosineSimilarity + sort), which
  // is the behaviour a KB search depends on. The op-sqlite BLOB→Float32Array decode
  // (RagDatabase.blobToEmbedding) relies on `instanceof ArrayBuffer`, which the RN jest
  // environment breaks across module realms (a jest-only artifact — on device there is
  // one JS realm, so it decodes fine; the real device path is proven by the on-device
  // journey). So we substitute ONLY that decode boundary with the already-decoded
  // number[] embeddings a real device returns, and let the REAL retrieval rank them.
  it('retrieval ranks the closer doc first by real cosine similarity (case 14)', async () => {
    prepared = { text: SOLAR_DOC, path: '/solar', size: 100 };
    await ragService.addDocument({ projectId: PROJECT, path: '/solar', fileName: 'solar.txt', size: 100 });
    prepared = { text: BATTERY_DOC, path: '/battery', size: 100 };
    await ragService.addDocument({ projectId: PROJECT, path: '/battery', fileName: 'battery.txt', size: 100 });
    const result = await ragService.search(PROJECT, 'solar panel roof');

    expect(result.chunks.length).toBe(2);
    // The solar doc must rank first — real cosine over the real stored vectors.
    expect(result.chunks[0].name).toBe('solar.txt');
    expect(result.chunks[0].score).toBeGreaterThan(result.chunks[1].score);
    expect(result.chunks[0].score).toBeGreaterThan(0);
  });

  // Case 19/20: disabling a document excludes it from retrieval; re-enabling restores it.
  it('toggling a doc disabled removes it from retrieval; re-enabling restores it (case 19/20)', async () => {
    prepared = { text: SOLAR_DOC, path: '/a', size: 100 };
    const { docId } = await ragService.addDocument({ projectId: PROJECT, path: '/a', fileName: 'solar.txt', size: 100 });

    // Enabled → found.
    expect((await ragService.search(PROJECT, 'solar')).chunks.length).toBeGreaterThan(0);

    // Disabled → excluded (the WHERE d.enabled = 1 clause is exercised for real).
    await ragService.setDocumentEnabled(docId, false);
    expect(mockMemDb._rows('rag_documents')[0].enabled).toBe(0);
    expect((await ragService.search(PROJECT, 'solar')).chunks).toHaveLength(0);

    // Re-enabled → found again.
    await ragService.setDocumentEnabled(docId, true);
    expect(mockMemDb._rows('rag_documents')[0].enabled).toBe(1);
    expect((await ragService.search(PROJECT, 'solar')).chunks.length).toBeGreaterThan(0);
  });

  // Case 25/26: deleting a doc removes its chunks AND embeddings AND the document row;
  // deleting the last doc restores the empty state.
  it('deleteDocument removes the doc row + its chunks + its embeddings (case 25/26)', async () => {
    prepared = { text: SOLAR_DOC, path: '/a', size: 100 };
    const { docId } = await ragService.addDocument({ projectId: PROJECT, path: '/a', fileName: 'solar.txt', size: 100 });
    expect(mockMemDb._rows('rag_chunks').length).toBeGreaterThan(0);
    expect(mockMemDb._rows('rag_embeddings').length).toBeGreaterThan(0);

    await ragService.removeDocument(docId);

    // All three tables cleared for that doc — nothing orphaned.
    expect(mockMemDb._rows('rag_documents').filter(d => d.id === docId)).toHaveLength(0);
    expect(mockMemDb._rows('rag_chunks').filter(c => c.doc_id === docId)).toHaveLength(0);
    expect(mockMemDb._rows('rag_embeddings').filter(e => e.doc_id === docId)).toHaveLength(0);

    // Case 26: empty state — list is empty and search returns nothing.
    expect(await ragService.listDocuments(PROJECT)).toHaveLength(0);
    expect((await ragService.search(PROJECT, 'solar')).chunks).toHaveLength(0);
  });

  // Case 27: add a document after the list was fully cleared — reload-after-index works
  // from a blank slate.
  it('can add a document after the list was fully cleared (case 27)', async () => {
    prepared = { text: SOLAR_DOC, path: '/a', size: 100 };
    const first = await ragService.addDocument({ projectId: PROJECT, path: '/a', fileName: 'first.txt', size: 100 });
    await ragService.removeDocument(first.docId);
    expect(await ragService.listDocuments(PROJECT)).toHaveLength(0);

    prepared = { text: BATTERY_DOC, path: '/b', size: 200 };
    await ragService.addDocument({ projectId: PROJECT, path: '/b', fileName: 'second.txt', size: 200 });

    const docs = await ragService.listDocuments(PROJECT);
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('second.txt');
  });

  // Case 28: the list persists across a "reload" — RagDatabase re-opens the SAME store
  // (ready reset, same in-memory tables) and the doc is still there. Models a
  // background/resume where the DB is re-opened.
  it('KB list persists after a DB re-open (backgrounded/resumed) (case 28)', async () => {
    prepared = { text: SOLAR_DOC, path: '/a', size: 100 };
    await ragService.addDocument({ projectId: PROJECT, path: '/a', fileName: 'persist.txt', size: 100 });

    // Simulate resume: force ensureReady to run again WITHOUT wiping the backing tables.
    (ragDatabase as any).ready = false;
    (ragDatabase as any).db = null;

    await ragService.start();
    const docs = await ragService.listDocuments(PROJECT);
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('persist.txt');
  });

  // Duplicate guard (RagService.indexDocument): re-adding the same file/name is rejected.
  it('rejects re-indexing a document already in the KB (dedupe guard)', async () => {
    prepared = { text: SOLAR_DOC, path: '/a', size: 100 };
    await ragService.addDocument({ projectId: PROJECT, path: '/a', fileName: 'dup.txt', size: 100 });

    await expect(
      ragService.addDocument({ projectId: PROJECT, path: '/a', fileName: 'dup.txt', size: 100 }),
    ).rejects.toThrow('already in the knowledge base');
    // No second row was created.
    expect(mockMemDb._rows('rag_documents')).toHaveLength(1);
  });

  // Case 13-adjacent: a doc that extracts no text is rejected and nothing is persisted.
  it('rejects a document with no extractable text and persists nothing', async () => {
    prepared = null;
    await expect(
      ragService.addDocument({ projectId: PROJECT, path: '/x', fileName: 'empty.bin', size: 0 }),
    ).rejects.toThrow('Could not extract text');
    expect(mockMemDb._rows('rag_documents')).toHaveLength(0);
  });
});

// ── Real DocumentService validation (unsupported / oversized rejection) ────────
// These drive the REAL DocumentService (no mock of it) through the RNFS boundary, so a
// deleted validateFileType / size check WOULD fail. This is the data-layer proof behind
// the KB "unsupported/oversized doc rejected" requirement.
describe('BATCH 9 — KB rejects unsupported / oversized docs (real DocumentService)', () => {
  beforeEach(() => defaultNativeFileSystemBoundary.reset());

  it('rejects an unsupported file type (.exe) before touching the filesystem', async () => {
    jest.isolateModules(() => { /* keep real module */ });
    const { documentService: realDocService } = jest.requireActual('../../src/services/documentService');
    await expect(
      realDocService.processDocumentFromPath('/downloads/malware.exe', 'malware.exe'),
    ).rejects.toThrow('Unsupported file type');
  });

  it('rejects a file larger than the 5MB max (case: oversized)', async () => {
    const realDocService = jest.requireActual('../../src/services/documentService').documentService;
    defaultNativeFileSystemBoundary.seedFile(
      '/mock/documents/big.txt',
      6 * 1024 * 1024,
    );
    await expect(
      realDocService.processDocumentFromPath('/mock/documents/big.txt', 'big.txt'),
    ).rejects.toThrow('File is too large');
  });
});
