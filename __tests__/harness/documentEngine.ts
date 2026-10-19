/**
 * documentEngine — the device boundary under the phone's document engine (services/documents and the
 * project knowledge base), for tests that run that engine for real.
 *
 * What is real above this line: documentService, the knowledge base, the shared ingest and turn services
 * (@offgrid/rag/documents), the op-sqlite store with FTS5, the citation registry, the stores and screens.
 * What is stood in for, because it is native:
 *  - op-sqlite: a REAL in-memory SQLite (node:sqlite) for documents.db and rag.db (harness/sqliteFake);
 *  - the native PDF reader (PDFExtractorModule): reads the file AT THE PATH it is given from the in-memory
 *    filesystem, so a kept copy is read exactly like the original. A "PDF" on that disk is `%PDF-1.7`
 *    followed by its page texts as JSON (see pdfFile); anything else fails to open, as a damaged PDF does;
 *  - the MiniLM embedding model: the bundled .gguf is placed on disk (so the real embeddingService copies
 *    and loads it) and llama.rn's embedding context answers; a test can hold or fail that native call;
 *  - react-native-fs: the memfs boundary installNativeBoundary({ fs: true }) installs.
 *
 * Call AFTER installNativeBoundary (it resets modules) and BEFORE requiring any src module, because
 * pdfExtractor captures NativeModules at import.
 */
import { doMockRealSqlite, type RealSqliteDiskOptions } from './sqliteFake';
import type { NativeFileSystemBoundary } from './nativeFileSystem';

const PDF_HEADER = '%PDF-1.7\n';
const EMBEDDING_MODEL = 'all-MiniLM-L6-v2-Q8_0.gguf';

/** The bytes of a PDF whose pages carry these texts ('' = a scanned page with no text layer). */
export function pdfFile(pages: string[]): string {
  return `${PDF_HEADER}${JSON.stringify({ pages })}`;
}

export interface DocumentEngineOptions {
  /** op-sqlite built without FTS5: keyword search is unavailable. */
  withoutFts5?: boolean;
  /** The llama.rn module in use when installNativeBoundary({ llama: true }) replaced the global one. */
  llama?: Record<string, jest.Mock>;
  /** Device variations of the SQLite boundary: databases kept on disk across a relaunch, pooled BLOBs. */
  sqlite?: RealSqliteDiskOptions;
  /**
   * Make the embedding model answer by MEANING, as MiniLM does: each entry is one topic (a set of
   * words), and a text's vector points along the topics whose words it uses, so a question and a
   * passage about the same thing are close even when they share no word. Default: the llama.rn fake's
   * own vector, which depends only on the text's length.
   */
  topics?: string[][];
}

const EMBEDDING_DIMENSIONS = 384;

/** A unit vector along the topics a text uses (one dimension per topic, plus a small shared floor). */
function topicVector(topics: string[][], text: string): number[] {
  const words = new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  topics.forEach((topic, i) => {
    vector[i] = topic.filter(word => words.has(word.toLowerCase())).length;
  });
  vector[EMBEDDING_DIMENSIONS - 1] = 0.05;
  const norm = Math.hypot(...vector);
  return vector.map(value => value / norm);
}

export interface DocumentEngineBoundary {
  /** Put a PDF with these page texts on the device. */
  seedPdf(path: string, pages: string[]): void;
  /** Put a text file on the device. `reportedSize` is what the filesystem reports (default: its length). */
  seedText(path: string, text: string, reportedSize?: number): void;
  /**
   * Park the native reader before it returns the batch that starts at `fromPage` (0-based), until
   * releaseRead(). Lets a test see a document while it is still being read.
   */
  holdReadAt(fromPage: number): void;
  releaseRead(): void;
  readHeld(): boolean;
  /** Park a native embedding call until releaseEmbedding(): the next one, or the one after `afterCalls` more. */
  holdEmbedding(afterCalls?: number): void;
  releaseEmbedding(): void;
  embeddingHeld(): boolean;
  /** Make every native embedding call fail with this message (e.g. the model ran out of memory). */
  failEmbedding(message: string): void;
  /** A file's identity in the document index: the SHA-256 of its bytes. */
  documentIdOf(path: string): Promise<string>;
  /** Resolves once the document index has finished with this document (ready or failed). */
  indexed(documentId: string, timeoutMs?: number): Promise<void>;
}

export function installDocumentEngine(
  fs: NativeFileSystemBoundary,
  options: DocumentEngineOptions = {},
): DocumentEngineBoundary {
  doMockRealSqlite(undefined, { withoutFts5: options.withoutFts5, ...options.sqlite });

  // The embedding model ships in the app bundle; embeddingService copies it out on first use.
  fs.seedFile(`${fs.module.MainBundlePath}/${EMBEDDING_MODEL}`, 25 * 1024 * 1024);

  let holdFrom: number | null = null;
  let releaseReadNow: (() => void) | null = null;
  let holdAfterCalls: number | null = null;
  let releaseEmbeddingNow: (() => void) | null = null;
  let embeddingFailure: string | null = null;

  const readPages = async (path: string): Promise<string[]> => {
    const bytes = await fs.module.readFile(path, 'utf8');
    if (!bytes.startsWith(PDF_HEADER)) throw new Error('PDF could not be opened (damaged or not a PDF)');
    return (JSON.parse(bytes.slice(PDF_HEADER.length)) as { pages: string[] }).pages;
  };

  const RN = require('react-native');
  RN.NativeModules.PDFExtractorModule = {
    extractText: async (path: string, maxChars: number) =>
      (await readPages(path)).join('\n\n').slice(0, maxChars),
    extractPages: async (path: string, start: number, count: number) => {
      const pages = await readPages(path);
      if (holdFrom !== null && start >= holdFrom) {
        holdFrom = null;
        await new Promise<void>(resolve => {
          releaseReadNow = resolve;
        });
        releaseReadNow = null;
      }
      return { pageCount: pages.length, pages: pages.slice(start, start + count) };
    },
  };

  const llama = options.llama ?? require('llama.rn');
  const initLlama = llama.initLlama as jest.Mock;
  const loadContext = initLlama.getMockImplementation()!;
  initLlama.mockImplementation(async (params: { embedding?: boolean }) => {
    const context = await loadContext(params);
    if (!params?.embedding) return context;
    const embed = context.embedding as (text: string) => Promise<{ embedding: number[] }>;
    return {
      ...context,
      embedding: async (text: string) => {
        if (holdAfterCalls !== null && holdAfterCalls-- === 0) {
          holdAfterCalls = null;
          await new Promise<void>(resolve => {
            releaseEmbeddingNow = resolve;
          });
          releaseEmbeddingNow = null;
        }
        if (embeddingFailure) throw new Error(embeddingFailure);
        return options.topics ? { embedding: topicVector(options.topics, text) } : embed(text);
      },
    };
  });

  return {
    seedPdf: (path, pages) => fs.seedTextFile(path, pdfFile(pages)),
    seedText: (path, text, reportedSize) => fs.seedTextFile(path, text, reportedSize),
    holdReadAt: fromPage => {
      holdFrom = fromPage;
    },
    releaseRead: () => releaseReadNow?.(),
    readHeld: () => releaseReadNow !== null,
    holdEmbedding: (afterCalls = 0) => {
      holdAfterCalls = afterCalls;
    },
    releaseEmbedding: () => releaseEmbeddingNow?.(),
    embeddingHeld: () => releaseEmbeddingNow !== null,
    failEmbedding: message => {
      embeddingFailure = message;
    },
    documentIdOf: path => fs.module.hash(path, 'sha256'),
    indexed: async (documentId, timeoutMs = 5000) => {
      // Required lazily: the store must come from the module graph the test's services use.
      const { documentStore } = require('../../src/services/documents/store');
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const stored = await documentStore.getDocument(documentId);
        if (stored?.state === 'ready' || stored?.state === 'failed') return;
        if (Date.now() > deadline) throw new Error(`document ${documentId} was never indexed (${stored?.state})`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    },
  };
}
