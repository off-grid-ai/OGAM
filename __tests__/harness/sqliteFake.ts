/**
 * installRealSqlite — back the @op-engineering/op-sqlite boundary with a REAL in-memory sqlite engine
 * (node:sqlite DatabaseSync), so ragDatabase / RAG / embeddings / search_knowledge_base run their actual
 * SQL — the "fake sqlite does the hard work" tier, not the dumb global op-sqlite mock (which returns
 * empty and hides real behavior). The DB is PREFER-REAL, above the fake line.
 *
 * Call at the top of a test body; it jest.resetModules() + doMock('@op-engineering/op-sqlite'), then the
 * test require()s the rag modules so they open the real :memory: db. Each install = a fresh empty db.
 */
export function installRealSqlite(setupSql?: string): void {
  jest.resetModules();
  doMockRealSqlite(setupSql);
}

/**
 * The op-sqlite doMock WITHOUT jest.resetModules — so it can COMPOSE with another boundary installer that
 * already reset modules (e.g. installNativeBoundary for a mounted-screen RAG test). Call AFTER that installer,
 * before requiring the rag modules. installRealSqlite = resetModules + this.
 */
export function doMockRealSqlite(
  setupSql?: string,
  options: { withoutFts5?: boolean } & RealSqliteDiskOptions = {},
): void {
  jest.doMock('@op-engineering/op-sqlite', () =>
    realSqliteModule({ setupSql, ...options }),
  );
}

/** Opt-in device variations of the op-sqlite boundary. Leaving both out keeps the default behavior. */
export interface RealSqliteDiskOptions {
  /**
   * Keep each database in a file in this directory (named by its op-sqlite `name`), the way the app's
   * databases live on the phone's disk, so a relaunch (a fresh module graph that opens them again)
   * finds what the first run wrote. Default: a fresh :memory: database per open().
   */
  persistAt?: string;
  /**
   * Hand each BLOB back as a Uint8Array view at a non-zero byteOffset into ONE ArrayBuffer shared by
   * every BLOB of that result (the other rows' bytes sit beside it), as a pooled allocator does. Code
   * that decodes `blob.buffer` instead of the view's own bytes reads a neighbour's values.
   * Default: each BLOB is an ArrayBuffer that owns its bytes (op-sqlite 15's shape).
   */
  pooledBlobs?: boolean;
}

/** Copy every BLOB of one result into one shared buffer and answer with views into it. */
function poolBlobs(rows: Record<string, unknown>[]): void {
  const blobs: Array<{ row: Record<string, unknown>; key: string; bytes: Uint8Array }> = [];
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (ArrayBuffer.isView(value)) blobs.push({ row, key, bytes: value as Uint8Array });
    }
  }
  if (!blobs.length) return;
  // Start off a 4-byte boundary and leave a gap between neighbours, so neither the offset nor the
  // whole-buffer length matches any one BLOB.
  const LEAD = 3;
  const GAP = 5;
  const total = blobs.reduce((sum, blob) => sum + blob.bytes.byteLength + GAP, LEAD);
  const pool = new ArrayBuffer(total);
  new Uint8Array(pool).fill(0x7f);
  let offset = LEAD;
  for (const blob of blobs) {
    new Uint8Array(pool, offset, blob.bytes.byteLength).set(blob.bytes);
    blob.row[blob.key] = new Uint8Array(pool, offset, blob.bytes.byteLength);
    offset += blob.bytes.byteLength + GAP;
  }
}

/**
 * The op-sqlite module itself, backed by real :memory: databases, for a hoisted
 * `jest.mock('@op-engineering/op-sqlite', () => require(<this file>).realSqliteModule(...))` in a test
 * that imports the app statically. `only` names the databases that get a real engine; any other open()
 * gets the same inert database as the global mock, so code a test is not about keeps its old boundary.
 */
export function realSqliteModule(
  options: {
    setupSql?: string;
    only?: readonly string[];
    /** A SQLite build without the FTS5 module (op-sqlite built without `"fts5": true`). */
    withoutFts5?: boolean;
  } & RealSqliteDiskOptions = {},
): { open: (config?: { name?: string }) => unknown } {
  const { DatabaseSync } = require('node:sqlite');

  const wrap = (db: any) => ({
    executeSync: (sql: string, params: unknown[] = []) => {
      if (options.withoutFts5 && /USING\s+fts5/i.test(sql)) {
        throw new Error('no such module: fts5');
      }
      const bind = (params ?? []).map(p =>
        // op-sqlite accepts ArrayBuffer for BLOBs; node:sqlite wants a Uint8Array/Buffer. Use a
        // realm-safe check (Object.prototype.toString) because a composed harness (installNativeBoundary
        // + doMockRealSqlite) can hand us an ArrayBuffer from a different realm where `instanceof` fails.
        p instanceof ArrayBuffer ||
        Object.prototype.toString.call(p) === '[object ArrayBuffer]'
          ? new Uint8Array(p as ArrayBuffer)
          : p,
      );
      // Transaction / DDL control statements: no params, run via exec.
      if (
        /^\s*(BEGIN|COMMIT|ROLLBACK|CREATE|PRAGMA|DROP)/i.test(sql) &&
        bind.length === 0
      ) {
        db.exec(sql);
        return { rows: [], insertId: undefined, rowsAffected: 0 };
      }
      const stmt = db.prepare(sql);
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
        // op-sqlite hands a BLOB column back as an ArrayBuffer; node:sqlite returns a Uint8Array.
        // Answer with the device's shape so code reading vectors sees what it sees on a phone.
        const all = stmt.all(...bind) as Record<string, unknown>[];
        if (options.pooledBlobs) {
          poolBlobs(all);
          return { rows: all, insertId: undefined, rowsAffected: 0 };
        }
        const rows = all.map((row: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(row)) {
            // isView, not instanceof: node:sqlite builds its Uint8Array in another JS realm.
            if (ArrayBuffer.isView(value)) {
              const bytes = value as Uint8Array;
              row[key] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            }
          }
          return row;
        });
        return { rows, insertId: undefined, rowsAffected: 0 };
      }
      const info = stmt.run(...bind);
      return {
        rows: [],
        insertId:
          info.lastInsertRowid != null
            ? Number(info.lastInsertRowid)
            : undefined,
        rowsAffected: Number(info.changes ?? 0),
      };
    },
    execute: async function (this: any, sql: string, params: unknown[] = []) {
      return this.executeSync(sql, params);
    },
    close: () => db.close(),
    delete: () => {},
  });

  const inert = () => {
    const result = { rows: [], insertId: 0, rowsAffected: 0 };
    return {
      executeSync: () => result,
      execute: () => Promise.resolve(result),
      close: () => {},
      delete: () => {},
    };
  };
  return {
    open: (config?: { name?: string }) => {
      if (options.only && !options.only.includes(config?.name ?? ''))
        return inert();
      const db = new DatabaseSync(
        options.persistAt ? require('node:path').join(options.persistAt, config?.name ?? 'default.db') : ':memory:',
      );
      if (options.setupSql) db.exec(options.setupSql);
      return wrap(db);
    },
  };
}
