import { open, type DB } from '@op-engineering/op-sqlite';
import type {
  ReceivedMediaReleaseAdmission,
  ReceivedMediaReleaseAdmissionPort,
} from '../../sync/receivedMediaReleaseAdmission';

/**
 * SQLite owner of the durable release tombstones.
 *
 * It lives in its OWN database file so it can be opened by the composition root before anything
 * else - it must be available earlier than every transport, and earlier than the gallery's own
 * lifecycle - and so the tombstones survive a gallery database rebuild.
 */
const DATABASE_NAME = 'offgrid-received-media-release.sqlite';

function ensureReceivedMediaReleaseAdmissionSchema(db: DB): void {
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS received_media_release_admissions (
      id TEXT PRIMARY KEY NOT NULL, local_path TEXT NOT NULL,
      admitted_at TEXT NOT NULL, continuation_json TEXT, authority TEXT)`,
  );
  const columns = db.executeSync(
    'PRAGMA table_info(received_media_release_admissions)',
  ).rows;
  if (!columns.some(column => column.name === 'continuation_json')) {
    db.executeSync(
      'ALTER TABLE received_media_release_admissions ADD COLUMN continuation_json TEXT',
    );
  }
  if (!columns.some(column => column.name === 'authority')) {
    db.executeSync(
      'ALTER TABLE received_media_release_admissions ADD COLUMN authority TEXT',
    );
  }
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS received_media_release_admission_quarantine (
      id TEXT PRIMARY KEY NOT NULL, row_json TEXT NOT NULL,
      reason TEXT NOT NULL, quarantined_at TEXT NOT NULL)`,
  );
}

function openDatabase(): DB {
  const db = open({ name: DATABASE_NAME });
  ensureReceivedMediaReleaseAdmissionSchema(db);
  return db;
}

type AdmissionRow = {
  id: unknown;
  local_path: unknown;
  continuation_json: unknown;
  authority: unknown;
  admitted_at: unknown;
};

const AUTHORITIES = [
  'local_unconditional',
  'remote_conditional',
  'legacy_unknown',
] as const;
const PROJECT_PHASES = [
  'sync_documents',
  'rag',
  'artifacts',
  'media',
  'workspace_content',
  'completed',
] as const;
const CONVERSATION_PHASES = [
  'workspace_content',
  'generated_images',
  'image_bytes',
  'completed',
] as const;

function decodeContinuation(
  value: unknown,
): ReceivedMediaReleaseAdmission['continuation'] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Conditional release continuation is invalid.');
  const item = value as Record<string, unknown>;
  const winner = item.expectedWinner as Record<string, unknown> | undefined;
  const entity = item.entity;
  const phases = entity === 'project' ? PROJECT_PHASES : CONVERSATION_PHASES;
  if (
    (entity !== 'project' && entity !== 'conversation') ||
    typeof item.operationId !== 'string' ||
    item.operationId.length === 0 ||
    typeof item.entityId !== 'string' ||
    item.entityId.length === 0 ||
    !winner ||
    winner.operationId !== item.operationId ||
    winner.entity !== entity ||
    winner.entityId !== item.entityId ||
    typeof item.phase !== 'string' ||
    !(phases as readonly string[]).includes(item.phase)
  )
    throw new Error('Conditional release continuation identity is invalid.');
  return value as ReceivedMediaReleaseAdmission['continuation'];
}

function decodeRow(row: AdmissionRow): ReceivedMediaReleaseAdmission {
  const authority = row.authority === null ? 'legacy_unknown' : row.authority;
  if (
    typeof authority !== 'string' ||
    !(AUTHORITIES as readonly string[]).includes(authority)
  )
    throw new Error(
      `Release admission authority ${String(authority)} is unsupported.`,
    );
  if (
    typeof row.id !== 'string' ||
    row.id.length === 0 ||
    typeof row.local_path !== 'string' ||
    row.local_path.length === 0
  )
    throw new Error('Release admission identity or path is invalid.');
  let continuation: ReceivedMediaReleaseAdmission['continuation'];
  if (row.continuation_json !== null) {
    if (typeof row.continuation_json !== 'string')
      throw new Error('Release admission continuation is invalid.');
    continuation = decodeContinuation(JSON.parse(row.continuation_json));
  }
  if (
    (authority === 'remote_conditional') !== (continuation !== undefined) ||
    (authority === 'legacy_unknown' && continuation !== undefined)
  )
    throw new Error(`Release admission ${row.id} has corrupt authority.`);
  return {
    id: row.id,
    path: row.local_path,
    authority: authority as ReceivedMediaReleaseAdmission['authority'],
    ...(continuation ? { continuation } : {}),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map(key => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',');
    return `{${fields}}`;
  }
  return JSON.stringify(value);
}

export class MobileReceivedMediaReleaseAdmissions
  implements ReceivedMediaReleaseAdmissionPort
{
  constructor(
    private readonly db: DB = openDatabase(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    ensureReceivedMediaReleaseAdmissionSchema(db);
  }

  /**
   * Write the tombstone and prove it is there before answering.
   *
   * The read-back is the whole point: `admit` resolving is what lets the caller delete its release
   * intent, so a mutation that silently changed nothing must surface as a rejection instead of a
   * settled release.
   */
  async admit(admission: ReceivedMediaReleaseAdmission): Promise<void> {
    if (
      (admission.authority === 'remote_conditional') !==
        (admission.continuation !== undefined) ||
      admission.authority === 'legacy_unknown'
    ) {
      throw new Error(
        `Release admission ${admission.id} has invalid authority.`,
      );
    }
    this.db.executeSync(
      `INSERT OR IGNORE INTO received_media_release_admissions
        (id, local_path, admitted_at, continuation_json, authority) VALUES (?, ?, ?, ?, ?)`,
      [
        admission.id,
        admission.path,
        this.now(),
        admission.continuation ? JSON.stringify(admission.continuation) : null,
        admission.authority,
      ],
    );
    const stored = this.db.executeSync(
      `SELECT id, local_path, continuation_json, authority, admitted_at
       FROM received_media_release_admissions WHERE id = ?`,
      [admission.id],
    ).rows[0] as AdmissionRow | undefined;
    if (!stored || canonical(decodeRow(stored)) !== canonical(admission)) {
      throw new Error(
        `Release admission for image ${admission.id} was not persisted.`,
      );
    }
  }

  async pending(): Promise<readonly ReceivedMediaReleaseAdmission[]> {
    const rows = this.db.executeSync(
      `SELECT id, local_path, continuation_json, authority, admitted_at
         FROM received_media_release_admissions
          ORDER BY admitted_at ASC, id ASC`,
    ).rows as AdmissionRow[];
    const valid: ReceivedMediaReleaseAdmission[] = [];
    for (const row of rows) {
      try {
        valid.push(decodeRow(row));
      } catch (cause) {
        this.quarantine(row, cause);
      }
    }
    return valid;
  }

  async settle(id: string): Promise<void> {
    this.db.executeSync(
      'DELETE FROM received_media_release_admissions WHERE id = ?',
      [id],
    );
  }

  private quarantine(row: AdmissionRow, cause: unknown): void {
    const id =
      typeof row.id === 'string' && row.id.length > 0
        ? row.id
        : `corrupt:${this.now()}`;
    const reason = cause instanceof Error ? cause.message : String(cause);
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      this.db.executeSync(
        `INSERT OR IGNORE INTO received_media_release_admission_quarantine
          (id, row_json, reason, quarantined_at) VALUES (?, ?, ?, ?)`,
        [id, JSON.stringify(row), reason, this.now()],
      );
      this.db.executeSync(
        'DELETE FROM received_media_release_admissions WHERE id = ?',
        [id],
      );
      this.db.executeSync('COMMIT');
    } catch (error) {
      this.db.executeSync('ROLLBACK');
      throw error;
    }
  }
}
