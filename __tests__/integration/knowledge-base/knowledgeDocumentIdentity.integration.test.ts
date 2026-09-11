import { installRealSqlite } from '../../harness/sqliteFake';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('knowledge document Sync identity', () => {
  it('backfills legacy rows once and assigns stable UUIDs to new documents', async () => {
    installRealSqlite(`
      CREATE TABLE rag_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO rag_documents
        (project_id, name, path, size, created_at, enabled)
      VALUES
        ('project-1', 'legacy.txt', '/docs/legacy.txt', 12, '2026-07-01T00:00:00.000Z', 1);
    `);

    const { ragDatabase } =
      require('../../../src/services/adapters/rag/ragDatabaseAdapter') as typeof import('../../../src/services/adapters/rag/ragDatabaseAdapter');
    await ragDatabase.ensureReady();

    const firstRead = ragDatabase.getDocumentsByProject('project-1');
    expect(firstRead).toHaveLength(1);
    expect(firstRead[0].sync_id).toMatch(UUID_V4);

    const legacySyncId = firstRead[0].sync_id;
    const newDocumentId = ragDatabase.insertDocument({
      projectId: 'project-1',
      name: 'new.txt',
      path: '/docs/new.txt',
      size: 7,
    });
    const newDocument = ragDatabase.getDocument(newDocumentId);

    expect(newDocument?.sync_id).toMatch(UUID_V4);
    expect(newDocument?.sync_id).not.toBe(legacySyncId);
    expect(ragDatabase.getDocumentBySyncId(legacySyncId)?.name).toBe(
      'legacy.txt',
    );

    await ragDatabase.ensureReady();
    expect(ragDatabase.getDocument(firstRead[0].id)?.sync_id).toBe(
      legacySyncId,
    );
  });
});
