import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';
import type { Chunk } from '@offgrid/rag';
import logger from '../../../utils/logger';
import { generateId } from '../../../utils/generateId';

export interface RagDocument {
  id: number;
  sync_id: string;
  project_id: string;
  name: string;
  path: string;
  size: number;
  created_at: string;
  enabled: number;
}

interface RagSearchResult {
  doc_id: number;
  name: string;
  content: string;
  position: number;
  score: number;
}

interface StoredEmbedding {
  chunk_rowid: number;
  doc_id: number;
  name: string;
  content: string;
  position: number;
  embedding: number[];
}

function rowNumber(row: Record<string, unknown>, field: string, index: number): number {
  const value = row[field];
  if (typeof value !== 'number') {
    throw new Error(`Invalid RAG document row at index ${index}: invalid ${field}.`);
  }
  return value;
}

function rowText(row: Record<string, unknown>, field: string, index: number): string {
  const value = row[field];
  if (typeof value !== 'string') {
    throw new Error(`Invalid RAG document row at index ${index}: invalid ${field}.`);
  }
  return value;
}

function decodeRagDocument(value: unknown, index: number): RagDocument {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid RAG document row at index ${index}: expected an object.`);
  }
  const row = value as Record<string, unknown>;
  return {
    id: rowNumber(row, 'id', index),
    sync_id: rowText(row, 'sync_id', index),
    project_id: rowText(row, 'project_id', index),
    name: rowText(row, 'name', index),
    path: rowText(row, 'path', index),
    size: rowNumber(row, 'size', index),
    created_at: rowText(row, 'created_at', index),
    enabled: rowNumber(row, 'enabled', index),
  };
}

function decodeRagDocuments(value: unknown): RagDocument[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid RAG document query result: expected rows.');
  }
  return value.map((row, index) => decodeRagDocument(row, index));
}

class RagDatabase {
  private db: DB | null = null;
  private ready = false;

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    try {
      this.db = open({ name: 'rag.db' });
      this.db.executeSync(
        `CREATE TABLE IF NOT EXISTS rag_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sync_id TEXT,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1
        )`,
      );
      const columns = this.db.executeSync(
        "SELECT name FROM pragma_table_info('rag_documents')",
      );
      const hasSyncId = (
        (columns.rows ?? []) as unknown as { name: string }[]
      ).some(column => column.name === 'sync_id');
      if (!hasSyncId) {
        this.db.executeSync(
          'ALTER TABLE rag_documents ADD COLUMN sync_id TEXT',
        );
      }
      const legacyDocuments = this.db.executeSync(
        "SELECT id FROM rag_documents WHERE sync_id IS NULL OR sync_id = ''",
      );
      for (const document of (legacyDocuments.rows ?? []) as unknown as {
        id: number;
      }[]) {
        this.db.executeSync(
          'UPDATE rag_documents SET sync_id = ? WHERE id = ?',
          [generateId(), document.id],
        );
      }
      this.db.executeSync(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_documents_sync_id ON rag_documents(sync_id)',
      );
      this.db.executeSync(
        `CREATE TABLE IF NOT EXISTS rag_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          doc_id INTEGER NOT NULL,
          position INTEGER NOT NULL,
          FOREIGN KEY (doc_id) REFERENCES rag_documents(id)
        )`,
      );
      this.db.executeSync(
        `CREATE TABLE IF NOT EXISTS rag_embeddings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chunk_rowid INTEGER NOT NULL,
          doc_id INTEGER NOT NULL,
          embedding BLOB NOT NULL,
          FOREIGN KEY (chunk_rowid) REFERENCES rag_chunks(id),
          FOREIGN KEY (doc_id) REFERENCES rag_documents(id)
        )`,
      );
      this.ready = true;
    } catch (error) {
      logger.error('[RagDB] Failed to initialize:', error);
      throw error;
    }
  }

  private getDb(): DB {
    if (!this.db)
      throw new Error('RagDatabase not initialized. Call ensureReady() first.');
    return this.db;
  }

  insertDocument(doc: {
    projectId: string;
    name: string;
    path: string;
    size: number;
    syncId?: string;
    createdAt?: string;
    enabled?: boolean;
  }): number {
    const db = this.getDb();
    const result = db.executeSync(
      `INSERT INTO rag_documents
        (sync_id, project_id, name, path, size, created_at, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        doc.syncId ?? generateId(),
        doc.projectId,
        doc.name,
        doc.path,
        doc.size,
        doc.createdAt ?? new Date().toISOString(),
        doc.enabled === false ? 0 : 1,
      ],
    );
    if (result.insertId == null)
      throw new Error('Failed to insert document: no insertId returned');
    return result.insertId;
  }

  insertChunks(docId: number, chunks: Chunk[]): number[] {
    const db = this.getDb();
    const rowIds: number[] = [];
    db.executeSync('BEGIN');
    try {
      for (const chunk of chunks) {
        const result = db.executeSync(
          'INSERT INTO rag_chunks (content, doc_id, position) VALUES (?, ?, ?)',
          [chunk.content, docId, chunk.position],
        );
        if (result.insertId == null)
          throw new Error(
            `Failed to insert chunk at position ${chunk.position}`,
          );
        rowIds.push(result.insertId);
      }
      db.executeSync('COMMIT');
    } catch (e) {
      db.executeSync('ROLLBACK');
      throw e;
    }
    return rowIds;
  }

  private embeddingToBlob(embedding: number[]): ArrayBuffer {
    return new Float32Array(embedding).buffer;
  }

  private blobToEmbedding(blob: any): number[] {
    if (blob instanceof ArrayBuffer) return Array.from(new Float32Array(blob));
    if (blob?.buffer instanceof ArrayBuffer)
      return Array.from(new Float32Array(blob.buffer));
    return [];
  }

  insertEmbeddingsBatch(
    entries: { chunkRowid: number; docId: number; embedding: number[] }[],
  ): void {
    const db = this.getDb();
    db.executeSync('BEGIN');
    try {
      for (const entry of entries) {
        db.executeSync(
          'INSERT INTO rag_embeddings (chunk_rowid, doc_id, embedding) VALUES (?, ?, ?)',
          [
            entry.chunkRowid,
            entry.docId,
            this.embeddingToBlob(entry.embedding),
          ],
        );
      }
      db.executeSync('COMMIT');
    } catch (e) {
      db.executeSync('ROLLBACK');
      throw e;
    }
  }

  getEmbeddingsByProject(projectId: string): StoredEmbedding[] {
    const db = this.getDb();
    const result = db.executeSync(
      `SELECT e.chunk_rowid, e.doc_id, d.name, c.content, c.position, e.embedding
       FROM rag_embeddings e
       JOIN rag_chunks c ON e.chunk_rowid = c.id
       JOIN rag_documents d ON e.doc_id = d.id
       WHERE d.project_id = ? AND d.enabled = 1`,
      [projectId],
    );
    return ((result.rows ?? []) as unknown as any[]).map(row => ({
      ...row,
      embedding: this.blobToEmbedding(row.embedding),
    }));
  }

  hasEmbeddingsForDocument(docId: number): boolean {
    const db = this.getDb();
    const result = db.executeSync(
      'SELECT COUNT(*) as count FROM rag_embeddings WHERE doc_id = ?',
      [docId],
    );
    const rows = (result.rows ?? []) as unknown as { count: number }[];
    return rows.length > 0 && rows[0].count > 0;
  }

  getChunksByDocument(
    docId: number,
  ): { id: number; content: string; position: number }[] {
    const db = this.getDb();
    const result = db.executeSync(
      'SELECT id, content, position FROM rag_chunks WHERE doc_id = ? ORDER BY position',
      [docId],
    );
    return (result.rows ?? []) as unknown as {
      id: number;
      content: string;
      position: number;
    }[];
  }

  deleteDocument(docId: number): void {
    const db = this.getDb();
    db.executeSync('DELETE FROM rag_embeddings WHERE doc_id = ?', [docId]);
    db.executeSync('DELETE FROM rag_chunks WHERE doc_id = ?', [docId]);
    db.executeSync('DELETE FROM rag_documents WHERE id = ?', [docId]);
  }

  getDocumentsByProject(projectId: string): RagDocument[] {
    const db = this.getDb();
    const result = db.executeSync(
      'SELECT id, sync_id, project_id, name, path, size, created_at, enabled FROM rag_documents WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    );
    return decodeRagDocuments(result.rows ?? []);
  }

  listDocumentPage(
    afterId: number | null,
    limit: number,
  ): { documents: RagDocument[]; nextAfterId: number | null } {
    const db = this.getDb();
    const result = db.executeSync(
      `SELECT id, sync_id, project_id, name, path, size, created_at, enabled
       FROM rag_documents
       WHERE id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [afterId ?? 0, limit],
    );
    const documents = decodeRagDocuments(result.rows ?? []);
    return {
      documents,
      nextAfterId:
        documents.length === limit
          ? (documents[documents.length - 1]?.id ?? null)
          : null,
    };
  }

  getDocument(docId: number): RagDocument | undefined {
    const db = this.getDb();
    const result = db.executeSync(
      'SELECT id, sync_id, project_id, name, path, size, created_at, enabled FROM rag_documents WHERE id = ?',
      [docId],
    );
    return decodeRagDocuments(result.rows ?? [])[0];
  }

  getDocumentBySyncId(syncId: string): RagDocument | undefined {
    const db = this.getDb();
    const result = db.executeSync(
      'SELECT id, sync_id, project_id, name, path, size, created_at, enabled FROM rag_documents WHERE sync_id = ?',
      [syncId],
    );
    return decodeRagDocuments(result.rows ?? [])[0];
  }

  toggleEnabled(docId: number, enabled: boolean): void {
    const db = this.getDb();
    db.executeSync('UPDATE rag_documents SET enabled = ? WHERE id = ?', [
      enabled ? 1 : 0,
      docId,
    ]);
  }

  getChunksByProject(projectId: string, topK: number = 5): RagSearchResult[] {
    const db = this.getDb();
    const result = db.executeSync(
      `SELECT c.doc_id, d.name, c.content, c.position, 0 as score
       FROM rag_chunks c JOIN rag_documents d ON c.doc_id = d.id
       WHERE d.project_id = ? AND d.enabled = 1
       ORDER BY c.position LIMIT ?`,
      [projectId, topK],
    );
    return (result.rows ?? []) as unknown as RagSearchResult[];
  }

  deleteDocumentsByProject(
    projectId: string,
    commitFence?: () => boolean,
  ): void | 'fenced' {
    const db = this.getDb();
    // All statements after this exact winner check are one synchronous transaction. No newer JS
    // operation can enter between the fence and COMMIT.
    if (commitFence && !commitFence()) return 'fenced';
    db.executeSync('BEGIN IMMEDIATE');
    try {
      db.executeSync(
        'DELETE FROM rag_embeddings WHERE doc_id IN (SELECT id FROM rag_documents WHERE project_id = ?)',
        [projectId],
      );
      db.executeSync(
        'DELETE FROM rag_chunks WHERE doc_id IN (SELECT id FROM rag_documents WHERE project_id = ?)',
        [projectId],
      );
      db.executeSync('DELETE FROM rag_documents WHERE project_id = ?', [projectId]);
      db.executeSync('COMMIT');
    } catch (cause) {
      db.executeSync('ROLLBACK');
      throw cause;
    }
  }
}

export const ragDatabase = new RagDatabase();
