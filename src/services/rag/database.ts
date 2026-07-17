import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';
import type { Chunk } from './chunking';
import logger from '../../utils/logger';

export interface RagDocument {
  id: number;
  project_id: string;
  name: string;
  path: string;
  size: number;
  created_at: string;
  enabled: number;
  portable_id?: string | null;
}

export interface RagSearchResult {
  doc_id: number;
  name: string;
  content: string;
  position: number;
  score: number;
}

export interface PortableRagDocumentInput {
  portableId: string;
  projectId: string;
  name: string;
  path: string;
  size: number;
  createdAt: string;
  enabled: boolean;
  chunks: Array<{ content: string; position: number; embedding: number[] }>;
}

interface StoredEmbedding {
  chunk_rowid: number;
  doc_id: number;
  name: string;
  content: string;
  position: number;
  embedding: number[];
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
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1
        )`
      );
      const columns = (this.db.executeSync('PRAGMA table_info(rag_documents)').rows ?? []) as unknown as Array<{ name: string }>;
      if (!columns.some(column => column.name === 'portable_id')) {
        this.db.executeSync('ALTER TABLE rag_documents ADD COLUMN portable_id TEXT');
      }
      this.db.executeSync(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_documents_portable_id ON rag_documents(portable_id) WHERE portable_id IS NOT NULL'
      );
      this.db.executeSync(
        `CREATE TABLE IF NOT EXISTS rag_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          doc_id INTEGER NOT NULL,
          position INTEGER NOT NULL,
          FOREIGN KEY (doc_id) REFERENCES rag_documents(id)
        )`
      );
      this.db.executeSync(
        `CREATE TABLE IF NOT EXISTS rag_embeddings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chunk_rowid INTEGER NOT NULL,
          doc_id INTEGER NOT NULL,
          embedding BLOB NOT NULL,
          FOREIGN KEY (chunk_rowid) REFERENCES rag_chunks(id),
          FOREIGN KEY (doc_id) REFERENCES rag_documents(id)
        )`
      );
      this.ready = true;
    } catch (error) {
      logger.error('[RagDB] Failed to initialize:', error);
      throw error;
    }
  }

  private getDb(): DB {
    if (!this.db) throw new Error('RagDatabase not initialized. Call ensureReady() first.');
    return this.db;
  }

  insertDocument(doc: { projectId: string; name: string; path: string; size: number }): number {
    const db = this.getDb();
    const result = db.executeSync(
      'INSERT INTO rag_documents (project_id, name, path, size, created_at) VALUES (?, ?, ?, ?, ?)',
      [doc.projectId, doc.name, doc.path, doc.size, new Date().toISOString()]
    );
    if (result.insertId == null) throw new Error('Failed to insert document: no insertId returned');
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
          [chunk.content, docId, chunk.position]
        );
        if (result.insertId == null) throw new Error(`Failed to insert chunk at position ${chunk.position}`);
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
    if (blob?.buffer instanceof ArrayBuffer) return Array.from(new Float32Array(blob.buffer));
    return [];
  }

  insertEmbeddingsBatch(entries: { chunkRowid: number; docId: number; embedding: number[] }[]): void {
    const db = this.getDb();
    db.executeSync('BEGIN');
    try {
      for (const entry of entries) {
        db.executeSync(
          'INSERT INTO rag_embeddings (chunk_rowid, doc_id, embedding) VALUES (?, ?, ?)',
          [entry.chunkRowid, entry.docId, this.embeddingToBlob(entry.embedding)]
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
      [projectId]
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
      [docId]
    );
    const rows = (result.rows ?? []) as unknown as { count: number }[];
    return rows.length > 0 && rows[0].count > 0;
  }

  getChunksByDocument(docId: number): { id: number; content: string; position: number }[] {
    const db = this.getDb();
    const result = db.executeSync(
      'SELECT id, content, position FROM rag_chunks WHERE doc_id = ? ORDER BY position',
      [docId]
    );
    return (result.rows ?? []) as unknown as { id: number; content: string; position: number }[];
  }

  /**
   * Transaction controls used by the portable-workspace adapter. The adapter
   * spans SQLite, Zustand, and files, so it owns the compensating transaction;
   * keeping the SQL primitives here avoids leaking the DB handle.
   */
  beginPortableImport(): void {
    this.getDb().executeSync('BEGIN');
  }

  commitPortableImport(): void {
    this.getDb().executeSync('COMMIT');
  }

  rollbackPortableImport(): void {
    this.getDb().executeSync('ROLLBACK');
  }

  insertPortableDocument(document: PortableRagDocumentInput): void {
    const db = this.getDb();
    const result = db.executeSync(
      `INSERT INTO rag_documents
        (portable_id, project_id, name, path, size, created_at, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        document.portableId,
        document.projectId,
        document.name,
        document.path,
        document.size,
        document.createdAt,
        document.enabled ? 1 : 0,
      ],
    );
    if (result.insertId == null) {
      throw new Error('Failed to insert portable document');
    }
    for (const chunk of document.chunks) {
      const chunkResult = db.executeSync(
        'INSERT INTO rag_chunks (content, doc_id, position) VALUES (?, ?, ?)',
        [chunk.content, result.insertId, chunk.position],
      );
      if (chunkResult.insertId == null) throw new Error('Failed to insert portable document chunk');
      db.executeSync(
        'INSERT INTO rag_embeddings (chunk_rowid, doc_id, embedding) VALUES (?, ?, ?)',
        [chunkResult.insertId, result.insertId, this.embeddingToBlob(chunk.embedding)],
      );
    }
  }

  deletePortableDocuments(portableIds: readonly string[]): void {
    if (portableIds.length === 0) return;
    const db = this.getDb();
    for (const portableId of portableIds) {
      db.executeSync('DELETE FROM rag_embeddings WHERE doc_id IN (SELECT id FROM rag_documents WHERE portable_id = ?)', [portableId]);
      db.executeSync('DELETE FROM rag_chunks WHERE doc_id IN (SELECT id FROM rag_documents WHERE portable_id = ?)', [portableId]);
      db.executeSync('DELETE FROM rag_documents WHERE portable_id = ?', [portableId]);
    }
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
      'SELECT id, portable_id, project_id, name, path, size, created_at, enabled FROM rag_documents WHERE project_id = ? ORDER BY created_at DESC',
      [projectId]
    );
    return (result.rows ?? []) as unknown as RagDocument[];
  }

  toggleEnabled(docId: number, enabled: boolean): void {
    const db = this.getDb();
    db.executeSync('UPDATE rag_documents SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, docId]);
  }

  getChunksByProject(projectId: string, topK: number = 5): RagSearchResult[] {
    const db = this.getDb();
    const result = db.executeSync(
      `SELECT c.doc_id, d.name, c.content, c.position, 0 as score
       FROM rag_chunks c JOIN rag_documents d ON c.doc_id = d.id
       WHERE d.project_id = ? AND d.enabled = 1
       ORDER BY c.position LIMIT ?`,
      [projectId, topK]
    );
    return (result.rows ?? []) as unknown as RagSearchResult[];
  }

  deleteDocumentsByProject(projectId: string): void {
    const db = this.getDb();
    db.executeSync('DELETE FROM rag_embeddings WHERE doc_id IN (SELECT id FROM rag_documents WHERE project_id = ?)', [projectId]);
    db.executeSync('DELETE FROM rag_chunks WHERE doc_id IN (SELECT id FROM rag_documents WHERE project_id = ?)', [projectId]);
    db.executeSync('DELETE FROM rag_documents WHERE project_id = ?', [projectId]);
  }
}

export const ragDatabase = new RagDatabase();
