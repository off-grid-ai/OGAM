// DocumentIndexStore and KeywordSearchPort for documents attached to chat, on op-sqlite. The same
// tables and FTS5 keyword search as desktop (desktop/src/main/documents/sqlite-store.ts), so the
// shared engine (@offgrid/rag/documents) behaves the same on both. FTS5 needs `"op-sqlite":
// {"fts5": true}` (package.json); without it keyword search returns nothing and vectors still answer.

import { open, type DB } from '@op-engineering/op-sqlite';
import {
  contentTerms,
  indexedText,
  type DocumentChunk,
  type DocumentIndexStore,
  type DocumentPage,
  type KeywordHit,
  type KeywordSearchPort,
  type StoredDocument,
} from '@offgrid/rag/documents';
import logger from '../../utils/logger';

/**
 * FTS5's unicode61 tokenizer cuts Indian-script words at every vowel sign. The Indic blocks are
 * token characters (with zero-width joiners); the danda stays a separator. Same rule as desktop.
 */
function indicTokenChars(): string {
  const chars: number[] = [];
  for (let code = 0x0900; code <= 0x0d7f; code++) if (code !== 0x0964 && code !== 0x0965) chars.push(code);
  chars.push(0x200c, 0x200d);
  return String.fromCodePoint(...chars).replace(/'/g, "''");
}

let database: DB | null = null;
let ftsAvailable = false;

function db(): DB {
  if (database) return database;
  const opened = open({ name: 'documents.db' });
  opened.executeSync(`CREATE TABLE IF NOT EXISTS attached_documents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
    page_count INTEGER NOT NULL DEFAULT 0, chunk_count INTEGER NOT NULL DEFAULT 0,
    embedded_count INTEGER NOT NULL DEFAULT 0, unreadable_pages INTEGER NOT NULL DEFAULT 0,
    embedder TEXT NOT NULL DEFAULT 'none', schema_version INTEGER NOT NULL DEFAULT 0,
    error TEXT, map TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL)`);
  opened.executeSync(`CREATE TABLE IF NOT EXISTS attached_document_pages (
    document_id TEXT NOT NULL, page INTEGER NOT NULL, label TEXT, text TEXT NOT NULL,
    needs_ocr INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (document_id, page))`);
  opened.executeSync(`CREATE TABLE IF NOT EXISTS attached_document_chunks (
    document_id TEXT NOT NULL, position INTEGER NOT NULL, page INTEGER NOT NULL, label TEXT,
    heading TEXT, text TEXT NOT NULL, tokens INTEGER NOT NULL, vector BLOB,
    PRIMARY KEY (document_id, position))`);
  opened.executeSync(`CREATE TABLE IF NOT EXISTS conversation_document_exclusions (
    conversation_id TEXT NOT NULL, document_id TEXT NOT NULL,
    PRIMARY KEY (conversation_id, document_id))`);
  // The primary keys cover lookups by document (pages, chunks) and by conversation (exclusions);
  // removing a document also deletes its exclusions by document_id, which needs its own index.
  opened.executeSync(
    'CREATE INDEX IF NOT EXISTS idx_conversation_document_exclusions_document_id ON conversation_document_exclusions(document_id)',
  );
  try {
    opened.executeSync(
      `CREATE VIRTUAL TABLE IF NOT EXISTS attached_document_fts USING fts5(
        body, document_id UNINDEXED, position UNINDEXED,
        tokenize = "unicode61 remove_diacritics 0 tokenchars '${indicTokenChars()}'")`,
    );
    ftsAvailable = true;
  } catch (error) {
    logger.warn('[Documents] FTS5 unavailable; keyword search is off:', error);
  }
  database = opened;
  return opened;
}

type Row = Record<string, unknown>;

function rows(sql: string, params: unknown[] = []): Row[] {
  return (db().executeSync(sql, params as never[]).rows ?? []) as Row[];
}

function run(sql: string, params: unknown[] = []): void {
  db().executeSync(sql, params as never[]);
}

function inTransaction(work: () => void): void {
  run('BEGIN');
  try {
    work();
    run('COMMIT');
  } catch (error) {
    run('ROLLBACK');
    throw error;
  }
}

const COLUMNS: Record<keyof Omit<StoredDocument, 'id'>, string> = {
  name: 'name',
  kind: 'kind',
  state: 'state',
  pageCount: 'page_count',
  chunkCount: 'chunk_count',
  embeddedCount: 'embedded_count',
  unreadablePages: 'unreadable_pages',
  embedder: 'embedder',
  schemaVersion: 'schema_version',
  error: 'error',
  createdAt: 'created_at',
  lastUsedAt: 'last_used_at',
};

function toDocument(row: Row): StoredDocument {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind),
    state: row.state as StoredDocument['state'],
    pageCount: Number(row.page_count),
    chunkCount: Number(row.chunk_count),
    embeddedCount: Number(row.embedded_count),
    unreadablePages: Number(row.unreadable_pages),
    embedder: String(row.embedder),
    schemaVersion: Number(row.schema_version),
    ...(row.error ? { error: String(row.error) } : {}),
    createdAt: Number(row.created_at),
    lastUsedAt: Number(row.last_used_at),
  };
}

/**
 * A BLOB can arrive as an ArrayBuffer from another JS realm, or as a typed-array view into a larger
 * buffer. Only the view's own bytes are the vector, so they are copied out by offset and length.
 */
function toVector(value: unknown): Float32Array | null {
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
    return new Float32Array((value as ArrayBuffer).slice(0));
  }
  if (!ArrayBuffer.isView(value)) return null;
  const { buffer, byteOffset, byteLength } = value;
  if (byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return null;
  // Copy first: the offset into a pooled buffer need not be 4-byte aligned.
  return new Float32Array(new Uint8Array(buffer, byteOffset, byteLength).slice().buffer);
}

export const documentStore: DocumentIndexStore = {
  async getDocument(id) {
    const [row] = rows('SELECT * FROM attached_documents WHERE id = ?', [id]);
    return row ? toDocument(row) : null;
  },

  async putDocument(document) {
    run(
      `INSERT INTO attached_documents (id, name, kind, state, page_count, chunk_count, embedded_count,
         unreadable_pages, embedder, schema_version, error, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, state = excluded.state,
         page_count = excluded.page_count, chunk_count = excluded.chunk_count,
         embedded_count = excluded.embedded_count, unreadable_pages = excluded.unreadable_pages,
         embedder = excluded.embedder, schema_version = excluded.schema_version, error = excluded.error,
         last_used_at = excluded.last_used_at`,
      [
        document.id,
        document.name,
        document.kind,
        document.state,
        document.pageCount,
        document.chunkCount,
        document.embeddedCount,
        document.unreadablePages,
        document.embedder,
        document.schemaVersion,
        document.error ?? null,
        document.createdAt,
        document.lastUsedAt,
      ],
    );
  },

  async updateDocument(id, patch) {
    const entries = Object.entries(patch).filter(([key]) => key !== 'id' && key in COLUMNS);
    if (!entries.length) return;
    const sets = entries.map(([key]) => `${COLUMNS[key as keyof typeof COLUMNS]} = ?`).join(', ');
    run(`UPDATE attached_documents SET ${sets} WHERE id = ?`, [...entries.map(([, value]) => value ?? null), id]);
  },

  async putPages(id, pages) {
    inTransaction(() => {
      for (const page of pages) {
        run(
          `INSERT INTO attached_document_pages (document_id, page, label, text, needs_ocr) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(document_id, page) DO UPDATE SET label = excluded.label, text = excluded.text,
             needs_ocr = excluded.needs_ocr`,
          [id, page.page, page.label ?? null, page.text, page.needsOcr ? 1 : 0],
        );
      }
    });
  },

  async readPages(id) {
    return rows(
      'SELECT page, label, text, needs_ocr FROM attached_document_pages WHERE document_id = ? ORDER BY page',
      [id],
    ).map(
      (row): DocumentPage => ({
        page: Number(row.page),
        text: String(row.text),
        ...(row.label ? { label: String(row.label) } : {}),
        ...(Number(row.needs_ocr) ? { needsOcr: true } : {}),
      }),
    );
  },

  async clearChunks(id) {
    inTransaction(() => {
      run('DELETE FROM attached_document_chunks WHERE document_id = ?', [id]);
      if (ftsAvailable) run('DELETE FROM attached_document_fts WHERE document_id = ?', [id]);
      run('UPDATE attached_documents SET map = NULL WHERE id = ?', [id]);
    });
  },

  async appendChunks(id, chunks) {
    const [named] = rows('SELECT name FROM attached_documents WHERE id = ?', [id]);
    const name = named ? String(named.name) : '';
    inTransaction(() => {
      for (const chunk of chunks) {
        run(
          `INSERT OR REPLACE INTO attached_document_chunks (document_id, position, page, label, heading, text, tokens)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, chunk.position, chunk.page, chunk.label ?? null, chunk.heading ?? null, chunk.text, chunk.tokens],
        );
        if (ftsAvailable) {
          run('INSERT INTO attached_document_fts (body, document_id, position) VALUES (?, ?, ?)', [
            indexedText(name, chunk),
            id,
            chunk.position,
          ]);
        }
      }
    });
  },

  async readChunks(id) {
    return rows(
      'SELECT position, page, label, heading, text, tokens FROM attached_document_chunks WHERE document_id = ? ORDER BY position',
      [id],
    ).map(
      (row): DocumentChunk => ({
        documentId: id,
        position: Number(row.position),
        page: Number(row.page),
        ...(row.label ? { label: String(row.label) } : {}),
        ...(row.heading ? { heading: String(row.heading) } : {}),
        text: String(row.text),
        tokens: Number(row.tokens),
      }),
    );
  },

  async putVectors(id, from, vectors) {
    inTransaction(() => {
      vectors.forEach((vector, i) => {
        run('UPDATE attached_document_chunks SET vector = ? WHERE document_id = ? AND position = ?', [
          new Float32Array(vector).buffer,
          id,
          from + i,
        ]);
      });
    });
  },

  async readVectors(id) {
    const vectors = new Map<number, Float32Array>();
    for (const row of rows(
      'SELECT position, vector FROM attached_document_chunks WHERE document_id = ? AND vector IS NOT NULL',
      [id],
    )) {
      const vector = toVector(row.vector);
      if (vector) vectors.set(Number(row.position), vector);
    }
    return vectors;
  },

  async putMap(id, positions) {
    run('UPDATE attached_documents SET map = ? WHERE id = ?', [JSON.stringify(positions), id]);
  },

  async readMap(id) {
    const [row] = rows('SELECT map FROM attached_documents WHERE id = ?', [id]);
    if (!row?.map) return null;
    try {
      const positions = JSON.parse(String(row.map));
      return Array.isArray(positions) ? positions.filter((p): p is number => typeof p === 'number') : null;
    } catch {
      return null;
    }
  },

  async deleteDocument(id) {
    inTransaction(() => {
      if (ftsAvailable) run('DELETE FROM attached_document_fts WHERE document_id = ?', [id]);
      run('DELETE FROM attached_document_chunks WHERE document_id = ?', [id]);
      run('DELETE FROM attached_document_pages WHERE document_id = ?', [id]);
      run('DELETE FROM conversation_document_exclusions WHERE document_id = ?', [id]);
      run('DELETE FROM attached_documents WHERE id = ?', [id]);
    });
  },

  async listDocuments() {
    return rows('SELECT id, last_used_at FROM attached_documents').map((row) => ({
      id: String(row.id),
      lastUsedAt: Number(row.last_used_at),
    }));
  },
};

/** An FTS5 MATCH expression from free text: quoted phrases kept, every other term OR-ed. */
function ftsQuery(text: string): string | null {
  const quote = (term: string): string => `"${term.replace(/"/g, '""')}"`;
  const phrases = [...text.matchAll(/"([^"]{3,})"/g)].map((match) => quote(match[1]!.trim()));
  const terms = contentTerms(text.replace(/"[^"]*"/g, ' ')).map(quote);
  const all = [...phrases, ...terms];
  return all.length ? all.join(' OR ') : null;
}

export const documentKeywordSearch: KeywordSearchPort = {
  async search(documentIds, query, limit) {
    db();
    const match = ftsQuery(query);
    if (!ftsAvailable || !match || !documentIds.length) return [];
    const placeholders = documentIds.map(() => '?').join(', ');
    return rows(
      `SELECT document_id AS documentId, position, bm25(attached_document_fts) AS rank
       FROM attached_document_fts
       WHERE attached_document_fts MATCH ? AND document_id IN (${placeholders})
       ORDER BY rank LIMIT ?`,
      [match, ...documentIds, limit],
    ).map((row): KeywordHit => ({
      documentId: String(row.documentId),
      position: Number(row.position),
      score: -Number(row.rank),
    }));
  },
};

export function excludedDocuments(conversationId: string): Set<string> {
  return new Set(
    rows('SELECT document_id FROM conversation_document_exclusions WHERE conversation_id = ?', [
      conversationId,
    ]).map((row) => String(row.document_id)),
  );
}

export function setDocumentExcluded(conversationId: string, documentId: string, excluded: boolean): void {
  if (excluded) {
    run('INSERT OR IGNORE INTO conversation_document_exclusions (conversation_id, document_id) VALUES (?, ?)', [
      conversationId,
      documentId,
    ]);
  } else {
    run('DELETE FROM conversation_document_exclusions WHERE conversation_id = ? AND document_id = ?', [
      conversationId,
      documentId,
    ]);
  }
}

export function forgetConversationExclusions(conversationId: string): void {
  run('DELETE FROM conversation_document_exclusions WHERE conversation_id = ?', [conversationId]);
}
