// rag.db: which files belong to which project's knowledge base. Only membership lives here (name,
// kept copy, enabled, sync identity, and `document_id`, the file's SHA-256). Reading, chunks,
// vectors and search live in the shared document index (services/documents), the same one chat
// attachments use.

import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';
import logger from '../../utils/logger';
import { generateId } from '../../utils/generateId';

export interface KnowledgeDocument {
  id: number;
  sync_id: string;
  project_id: string;
  name: string;
  path: string;
  size: number;
  created_at: string;
  enabled: number;
  /** SHA-256 of the file: its id in the document index. Null for a row made before ids existed. */
  document_id: string | null;
}

const COLUMNS =
  'id, sync_id, project_id, name, path, size, created_at, enabled, document_id';

class RagDatabase {
  private db: DB | null = null;
  private ready = false;

  /** Where the document index lives on disk, once it is open (Storage shows its size). */
  filePath(): string | null {
    return this.db?.getDbPath() ?? null;
  }

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    try {
      const db = open({ name: 'rag.db' });
      this.db = db;
      db.executeSync(
        `CREATE TABLE IF NOT EXISTS rag_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sync_id TEXT,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          document_id TEXT
        )`,
      );
      const columns = (
        (db.executeSync("SELECT name FROM pragma_table_info('rag_documents')")
          .rows ?? []) as unknown as { name: string }[]
      ).map(column => column.name);
      if (!columns.includes('sync_id')) {
        db.executeSync('ALTER TABLE rag_documents ADD COLUMN sync_id TEXT');
      }
      if (!columns.includes('document_id')) {
        db.executeSync('ALTER TABLE rag_documents ADD COLUMN document_id TEXT');
      }
      const legacyDocuments = db.executeSync(
        "SELECT id FROM rag_documents WHERE sync_id IS NULL OR sync_id = ''",
      );
      for (const document of (legacyDocuments.rows ?? []) as unknown as {
        id: number;
      }[]) {
        db.executeSync('UPDATE rag_documents SET sync_id = ? WHERE id = ?', [
          generateId(),
          document.id,
        ]);
      }
      db.executeSync(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_rag_documents_sync_id ON rag_documents(sync_id)',
      );
      // Covers every lookup by project (project_id is its leading column) and the enabled filter.
      db.executeSync(
        'CREATE INDEX IF NOT EXISTS idx_rag_documents_project_id_enabled ON rag_documents(project_id, enabled)',
      );
      db.executeSync(
        'CREATE INDEX IF NOT EXISTS idx_rag_documents_document_id ON rag_documents(document_id)',
      );
      this.dropOldIndex(db);
      this.ready = true;
    } catch (error) {
      logger.error('[RagDB] Failed to initialize:', error);
      throw error;
    }
  }

  /** The old engine's chunks and vectors: the document index replaced them. Freed once. */
  private dropOldIndex(db: DB): void {
    const old = (db.executeSync(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('rag_chunks', 'rag_embeddings')",
    ).rows ?? []) as unknown as { name: string }[];
    if (!old.length) return;
    db.executeSync('DROP TABLE IF EXISTS rag_embeddings');
    db.executeSync('DROP TABLE IF EXISTS rag_chunks');
  }

  private getDb(): DB {
    if (!this.db)
      throw new Error('RagDatabase not initialized. Call ensureReady() first.');
    return this.db;
  }

  private rows(sql: string, params: unknown[] = []): KnowledgeDocument[] {
    return (this.getDb().executeSync(sql, params as never[]).rows ??
      []) as unknown as KnowledgeDocument[];
  }

  insertDocument(doc: {
    projectId: string;
    name: string;
    path: string;
    size: number;
    documentId: string;
    syncId?: string;
    createdAt?: string;
    enabled?: boolean;
  }): number {
    const result = this.getDb().executeSync(
      `INSERT INTO rag_documents
        (sync_id, project_id, name, path, size, created_at, enabled, document_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        doc.syncId ?? generateId(),
        doc.projectId,
        doc.name,
        doc.path,
        doc.size,
        doc.createdAt ?? new Date().toISOString(),
        doc.enabled === false ? 0 : 1,
        doc.documentId,
      ],
    );
    if (result.insertId == null)
      throw new Error('Failed to insert document: no insertId returned');
    return result.insertId;
  }

  setDocumentId(docId: number, documentId: string): void {
    this.getDb().executeSync(
      'UPDATE rag_documents SET document_id = ? WHERE id = ?',
      [documentId, docId],
    );
  }

  deleteDocument(docId: number): void {
    this.getDb().executeSync('DELETE FROM rag_documents WHERE id = ?', [docId]);
  }

  deleteDocumentsByProject(projectId: string): void {
    this.getDb().executeSync('DELETE FROM rag_documents WHERE project_id = ?', [
      projectId,
    ]);
  }

  getDocumentsByProject(projectId: string): KnowledgeDocument[] {
    return this.rows(
      `SELECT ${COLUMNS} FROM rag_documents WHERE project_id = ? ORDER BY created_at DESC`,
      [projectId],
    );
  }

  getEnabledDocumentsByProject(projectId: string): KnowledgeDocument[] {
    return this.rows(
      `SELECT ${COLUMNS} FROM rag_documents WHERE project_id = ? AND enabled = 1 ORDER BY created_at ASC`,
      [projectId],
    );
  }

  getAllDocuments(): KnowledgeDocument[] {
    return this.rows(
      `SELECT ${COLUMNS} FROM rag_documents ORDER BY created_at ASC`,
    );
  }

  getDocument(docId: number): KnowledgeDocument | undefined {
    return this.rows(`SELECT ${COLUMNS} FROM rag_documents WHERE id = ?`, [
      docId,
    ])[0];
  }

  getDocumentBySyncId(syncId: string): KnowledgeDocument | undefined {
    return this.rows(`SELECT ${COLUMNS} FROM rag_documents WHERE sync_id = ?`, [
      syncId,
    ])[0];
  }

  /** Every document id a knowledge base uses, so the document index keeps them. */
  getAllDocumentIds(): string[] {
    return (
      (this.getDb().executeSync(
        'SELECT DISTINCT document_id FROM rag_documents WHERE document_id IS NOT NULL',
      ).rows ?? []) as unknown as { document_id: string }[]
    ).map(row => row.document_id);
  }

  /** Other rows still pointing at this kept copy (normally none). */
  countByPath(path: string): number {
    const [row] = (this.getDb().executeSync(
      'SELECT COUNT(*) AS count FROM rag_documents WHERE path = ?',
      [path],
    ).rows ?? []) as unknown as { count: number }[];
    return Number(row?.count ?? 0);
  }

  toggleEnabled(docId: number, enabled: boolean): void {
    this.getDb().executeSync(
      'UPDATE rag_documents SET enabled = ? WHERE id = ?',
      [enabled ? 1 : 0, docId],
    );
  }
}

export const ragDatabase = new RagDatabase();
