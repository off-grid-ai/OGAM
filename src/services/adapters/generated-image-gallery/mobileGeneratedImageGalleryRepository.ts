/* eslint-disable max-lines, max-lines-per-function, max-params, complexity -- One SQLite owner keeps schema upgrade, metadata, release CAS, and recovery atomic. */
import { open, type DB } from '@op-engineering/op-sqlite';
import type {
  DeletionCleanupContinuation,
  GeneratedImageGalleryRepositoryPort,
  GeneratedImageGalleryRepositorySnapshot,
  GeneratedImageRecord,
} from '@offgrid/application';
import { generateId } from '../../../utils/generateId';
import { openWorkspaceContentDatabase } from '../workspaceContent/workspaceContentDatabase';
/** Which owner is allowed to act on the bytes a removed gallery record left behind. */
type GeneratedImageReleaseOwner = 'local' | 'provenance';

function releaseOwner(value: unknown, id: string): GeneratedImageReleaseOwner {
  if (value === 'local' || value === 'provenance') return value;
  throw new Error(
    `Generated-image release intent ${id} has unknown owner kind ${String(
      value,
    )}.`,
  );
}

/**
 * A durable intent to release the bytes of a record whose metadata is already gone.
 *
 * It is written inside the SAME transaction that drops the row, so metadata removal and the intent
 * to release its bytes commit together or not at all. The intent carries everything a restart needs
 * to finish the job without the record: the path, and who owns those bytes.
 */
export interface GeneratedImageReleaseIntent {
  readonly id: string;
  readonly deletionOperationId: string;
  readonly path: string;
  readonly owner: GeneratedImageReleaseOwner;
}

/** One intent the recovery pass attempted and could not settle, kept for the next drain. */
interface GeneratedImageReleaseRetention {
  readonly id: string;
  readonly reason: string;
  readonly error: unknown;
}

export interface GeneratedImageHolderRemovalReceipt {
  readonly imageId: string;
  readonly deletionOperationId: string;
  readonly status: 'removed' | 'absent';
  readonly preimage: GeneratedImageRecord | null;
  readonly postDeleteRevision: string;
  readonly restoreRevision?: string;
}

export type GeneratedImageHolderRestoreResult =
  | {
      readonly ok: true;
      readonly status: 'restored' | 'already_restored';
      readonly revision: string;
    }
  | { readonly ok: false; readonly kind: 'conflict'; readonly message: string };

/**
 * The result of ONE global recovery pass over the durable release intents.
 *
 * `attempted` counts what the pass saw, so a caller can tell "nothing was pending" from "everything
 * settled". `retained` is the whole retry set with its normalized reasons, which lets a caller
 * report one degradation for the pass instead of one exception per intent.
 */
export interface GeneratedImageReleaseDrainResult {
  readonly attempted: number;
  readonly settled: readonly string[];
  readonly retained: readonly GeneratedImageReleaseRetention[];
}

export type GeneratedImageReleaseSettlement = void | 'fenced';

export type GeneratedImageWaiterCancellation =
  | { readonly ok: true; readonly status: 'cancelled' | 'already_cancelled' }
  | { readonly ok: false; readonly kind: 'conflict'; readonly message: string };

function releaseFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function holderReceipt(
  input: { readonly imageId: string; readonly deletionOperationId: string },
  statusValue: unknown,
  preimageValue: unknown,
  postDeleteRevisionValue: unknown,
  restoreRevisionValue: unknown,
): GeneratedImageHolderRemovalReceipt {
  if (statusValue !== 'removed' && statusValue !== 'absent')
    throw new Error(
      `Generated image ${input.imageId} has an invalid holder receipt.`,
    );
  if ((statusValue === 'removed') !== (typeof preimageValue === 'string'))
    throw new Error(
      `Generated image ${input.imageId} holder receipt is corrupt.`,
    );
  if (
    typeof postDeleteRevisionValue !== 'string' ||
    postDeleteRevisionValue === ''
  )
    throw new Error(
      `Generated image ${input.imageId} holder receipt has no post-delete revision.`,
    );
  const preimage =
    typeof preimageValue === 'string'
      ? (JSON.parse(preimageValue) as GeneratedImageRecord)
      : null;
  if (preimage && preimage.id !== input.imageId)
    throw new Error(
      `Generated image ${input.imageId} holder receipt has wrong identity.`,
    );
  return {
    ...input,
    status: statusValue,
    preimage,
    postDeleteRevision: postDeleteRevisionValue,
    restoreRevision:
      typeof restoreRevisionValue === 'string'
        ? restoreRevisionValue
        : undefined,
  };
}

const DATABASE_NAME = 'offgrid-generated-image-gallery.sqlite';

function openDatabase(): DB {
  return ensureMobileGeneratedImageGallerySchema(open({ name: DATABASE_NAME }));
}

function ensureMobileGeneratedImageGallerySchema(db: DB): DB {
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS generated_image_gallery (
      id TEXT PRIMARY KEY NOT NULL, record_json TEXT NOT NULL, release_scope TEXT)`,
  );
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS generated_image_byte_deletions (
      id TEXT PRIMARY KEY NOT NULL, local_path TEXT NOT NULL,
      owner_kind TEXT NOT NULL DEFAULT 'local', release_scope TEXT,
      record_json TEXT, owner_operation_id TEXT)`,
  );
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS generated_image_release_waiters (
      scope TEXT NOT NULL, image_id TEXT NOT NULL,
      owner_operation_id TEXT,
      PRIMARY KEY (scope, image_id))`,
  );
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS generated_image_waiter_cancellations (
      scope TEXT NOT NULL, image_id TEXT NOT NULL,
      deletion_operation_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (scope, image_id, deletion_operation_id),
      CHECK (scope != '' AND image_id != '' AND deletion_operation_id != ''))`,
  );
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS generated_image_holder_removal_receipts (
      image_id TEXT NOT NULL, deletion_operation_id TEXT NOT NULL,
      status TEXT NOT NULL, preimage_json TEXT, post_delete_revision TEXT,
      restore_revision TEXT,
      PRIMARY KEY (image_id, deletion_operation_id),
      CHECK (image_id != '' AND deletion_operation_id != ''),
      CHECK (status IN ('removed', 'absent')),
      CHECK ((status = 'removed' AND preimage_json IS NOT NULL) OR
             (status = 'absent' AND preimage_json IS NULL)))`,
  );
  const holderReceiptColumns = db.executeSync(
    'PRAGMA table_info(generated_image_holder_removal_receipts)',
  ).rows;
  if (
    !holderReceiptColumns.some(column => column.name === 'post_delete_revision')
  ) {
    db.executeSync(
      'ALTER TABLE generated_image_holder_removal_receipts ADD COLUMN post_delete_revision TEXT',
    );
  }
  if (
    !holderReceiptColumns.some(column => column.name === 'restore_revision')
  ) {
    db.executeSync(
      'ALTER TABLE generated_image_holder_removal_receipts ADD COLUMN restore_revision TEXT',
    );
  }
  // Installs written before the intent carried an owner hold local-generation rows only, so the
  // column default is the truth for every row that already exists.
  const intentColumns = db.executeSync(
    'PRAGMA table_info(generated_image_byte_deletions)',
  ).rows;
  const initialWaiterColumns = db.executeSync(
    'PRAGMA table_info(generated_image_release_waiters)',
  ).rows;
  const columns = intentColumns.map(row => String(row.name));
  const waiterColumnNames = initialWaiterColumns.map(row => String(row.name));
  const canonical =
    [
      'id',
      'deletion_operation_id',
      'local_path',
      'owner_kind',
      'record_json',
    ].every(name => columns.includes(name)) &&
    ['scope', 'image_id', 'deletion_operation_id'].every(name =>
      initialWaiterColumns.some(column => column.name === name),
    ) &&
    intentColumns.filter(column => Number(column.pk) > 0).length === 2 &&
    initialWaiterColumns.filter(column => Number(column.pk) > 0).length === 3;
  if (!canonical) {
    if (!columns.includes('owner_kind')) {
      db.executeSync(
        `ALTER TABLE generated_image_byte_deletions
        ADD COLUMN owner_kind TEXT NOT NULL DEFAULT 'local'`,
      );
    }
    if (!columns.includes('release_scope')) {
      db.executeSync(
        `ALTER TABLE generated_image_byte_deletions ADD COLUMN release_scope TEXT`,
      );
    }
    if (!columns.includes('record_json')) {
      db.executeSync(
        `ALTER TABLE generated_image_byte_deletions ADD COLUMN record_json TEXT`,
      );
    }
    if (!columns.includes('owner_operation_id')) {
      db.executeSync(
        `ALTER TABLE generated_image_byte_deletions ADD COLUMN owner_operation_id TEXT`,
      );
    }
    if (!waiterColumnNames.includes('owner_operation_id')) {
      db.executeSync(
        `ALTER TABLE generated_image_release_waiters ADD COLUMN owner_operation_id TEXT`,
      );
    }
    const galleryColumns = db
      .executeSync('PRAGMA table_info(generated_image_gallery)')
      .rows.map(row => String(row.name));
    if (!galleryColumns.includes('release_scope')) {
      db.executeSync(
        `ALTER TABLE generated_image_gallery ADD COLUMN release_scope TEXT`,
      );
    }
    // Move every old single-scope claim to the additive waiter set. Clear the old columns so a later
    // open cannot resurrect a waiter that already settled.
    db.executeSync('BEGIN IMMEDIATE');
    try {
      // A mixed-version database can already have the new intent identity while its waiter table
      // still needs migration. Keep that identity first; deriving `legacy:<id>` for every row would
      // collapse multiple operations for one image under the destination composite key.
      const intentOperation = columns.includes('deletion_operation_id')
        ? "COALESCE(NULLIF(deletion_operation_id, ''), NULLIF(owner_operation_id, ''), 'legacy:' || id)"
        : "COALESCE(NULLIF(owner_operation_id, ''), 'legacy:' || id)";
      const waiterOperation = waiterColumnNames.includes(
        'deletion_operation_id',
      )
        ? `COALESCE(NULLIF(deletion_operation_id, ''), NULLIF(owner_operation_id, ''),
             (SELECT deletion_operation_id
              FROM generated_image_byte_deletions_v2
              WHERE id = generated_image_release_waiters.image_id
              ORDER BY deletion_operation_id LIMIT 1),
             'legacy:' || image_id)`
        : `COALESCE(NULLIF(owner_operation_id, ''),
             (SELECT deletion_operation_id
              FROM generated_image_byte_deletions_v2
              WHERE id = generated_image_release_waiters.image_id
              ORDER BY deletion_operation_id LIMIT 1),
             'legacy:' || image_id)`;
      db.executeSync(
        `CREATE TABLE IF NOT EXISTS generated_image_release_migration_quarantine (
        source_kind TEXT NOT NULL, source_key TEXT NOT NULL,
        reason TEXT NOT NULL,
        PRIMARY KEY (source_kind, source_key))`,
      );
      db.executeSync(
        `INSERT OR IGNORE INTO generated_image_release_migration_quarantine
        (source_kind, source_key, reason)
       SELECT 'intent', COALESCE(id, '<null>'), 'blank image identity or path'
       FROM generated_image_byte_deletions
       WHERE COALESCE(id, '') = '' OR COALESCE(local_path, '') = ''`,
      );
      db.executeSync(
        `INSERT OR IGNORE INTO generated_image_release_migration_quarantine
        (source_kind, source_key, reason)
       SELECT 'waiter', COALESCE(scope, '<null>') || ':' || COALESCE(image_id, '<null>'),
              'blank scope or image identity'
       FROM generated_image_release_waiters
       WHERE COALESCE(scope, '') = '' OR COALESCE(image_id, '') = ''`,
      );
      db.executeSync(
        `CREATE TABLE IF NOT EXISTS generated_image_byte_deletions_v2 (
        id TEXT NOT NULL, deletion_operation_id TEXT NOT NULL,
        local_path TEXT NOT NULL, owner_kind TEXT NOT NULL DEFAULT 'local',
        record_json TEXT,
        PRIMARY KEY (id, deletion_operation_id),
        CHECK (id != '' AND deletion_operation_id != '' AND local_path != ''))`,
      );
      db.executeSync(
        `INSERT OR IGNORE INTO generated_image_byte_deletions_v2
        (id, deletion_operation_id, local_path, owner_kind, record_json)
       SELECT id, ${intentOperation},
              local_path, owner_kind, record_json
       FROM generated_image_byte_deletions
       WHERE id != '' AND local_path != ''`,
      );
      db.executeSync(
        `CREATE TABLE IF NOT EXISTS generated_image_release_waiters_v2 (
        scope TEXT NOT NULL, image_id TEXT NOT NULL,
        deletion_operation_id TEXT NOT NULL,
        PRIMARY KEY (scope, image_id, deletion_operation_id),
        CHECK (scope != '' AND image_id != '' AND deletion_operation_id != ''))`,
      );
      db.executeSync(
        `INSERT OR IGNORE INTO generated_image_release_waiters_v2
        (scope, image_id, deletion_operation_id)
       SELECT scope, image_id, ${waiterOperation}
       FROM generated_image_release_waiters
       WHERE scope != '' AND image_id != ''`,
      );
      db.executeSync(
        `INSERT OR IGNORE INTO generated_image_release_waiters_v2
        (scope, image_id, deletion_operation_id)
       SELECT release_scope, id, 'legacy:' || id
       FROM generated_image_gallery WHERE release_scope IS NOT NULL`,
      );
      db.executeSync(
        `INSERT OR IGNORE INTO generated_image_release_waiters_v2
        (scope, image_id, deletion_operation_id)
       SELECT release_scope, id,
              COALESCE(NULLIF(owner_operation_id, ''), 'legacy:' || id)
       FROM generated_image_byte_deletions WHERE release_scope IS NOT NULL`,
      );
      const sourceIntentCount = Number(
        db.executeSync(
          `SELECT COUNT(*) AS count FROM generated_image_byte_deletions
       WHERE id != '' AND local_path != ''`,
        ).rows[0]?.count ?? -1,
      );
      const destinationIntentCount = Number(
        db.executeSync(
          'SELECT COUNT(*) AS count FROM generated_image_byte_deletions_v2',
        ).rows[0]?.count ?? -2,
      );
      if (sourceIntentCount !== destinationIntentCount) {
        throw new Error('Generated-image intent migration count mismatch.');
      }
      const invalidDestination = db.executeSync(
        `SELECT 1 FROM generated_image_byte_deletions_v2
       WHERE id = '' OR deletion_operation_id = '' OR local_path = '' LIMIT 1`,
      ).rows[0];
      if (invalidDestination) {
        throw new Error(
          'Generated-image intent migration produced an empty identity.',
        );
      }
      const sourceWaiterCount = Number(
        db.executeSync(
          `SELECT COUNT(*) AS count FROM (
         SELECT scope, image_id FROM generated_image_release_waiters
         WHERE scope != '' AND image_id != ''
         UNION SELECT release_scope, id FROM generated_image_gallery
         WHERE release_scope IS NOT NULL
         UNION SELECT release_scope, id FROM generated_image_byte_deletions
         WHERE release_scope IS NOT NULL)`,
        ).rows[0]?.count ?? -1,
      );
      const destinationWaiterCount = Number(
        db.executeSync(
          'SELECT COUNT(*) AS count FROM generated_image_release_waiters_v2',
        ).rows[0]?.count ?? -2,
      );
      if (destinationWaiterCount < sourceWaiterCount) {
        throw new Error('Generated-image waiter migration count mismatch.');
      }
      db.executeSync('UPDATE generated_image_gallery SET release_scope = NULL');
      db.executeSync(
        `ALTER TABLE generated_image_byte_deletions
       RENAME TO generated_image_byte_deletions_legacy_backup`,
      );
      db.executeSync(
        `ALTER TABLE generated_image_release_waiters
       RENAME TO generated_image_release_waiters_legacy_backup`,
      );
      db.executeSync(
        `ALTER TABLE generated_image_byte_deletions_v2
       RENAME TO generated_image_byte_deletions`,
      );
      db.executeSync(
        `ALTER TABLE generated_image_release_waiters_v2
       RENAME TO generated_image_release_waiters`,
      );
      db.executeSync('COMMIT');
    } catch (error) {
      db.executeSync('ROLLBACK');
      throw error;
    }
  }
  db.executeSync(
    'DROP INDEX IF EXISTS generated_image_release_waiters_by_image',
  );
  db.executeSync(
    `CREATE INDEX IF NOT EXISTS generated_image_release_waiters_by_image
     ON generated_image_release_waiters(image_id, deletion_operation_id, scope)`,
  );
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS generated_image_release_settlements (
      image_id TEXT NOT NULL, deletion_operation_id TEXT NOT NULL,
      PRIMARY KEY (image_id, deletion_operation_id))`,
  );
  const settlementColumns = db
    .executeSync('PRAGMA table_info(generated_image_release_settlements)')
    .rows.map(row => String(row.name));
  if (!settlementColumns.includes('record_generation')) {
    db.executeSync(
      `ALTER TABLE generated_image_release_settlements
       RENAME TO generated_image_release_settlements_legacy_backup`,
    );
    db.executeSync(
      `CREATE TABLE generated_image_release_settlements (
        image_id TEXT NOT NULL, deletion_operation_id TEXT NOT NULL,
        record_generation TEXT NOT NULL,
        PRIMARY KEY (image_id, deletion_operation_id, record_generation))`,
    );
  }
  db.executeSync(
    `CREATE TABLE IF NOT EXISTS generated_image_gallery_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL,
      legacy_imported INTEGER NOT NULL DEFAULT 0, schema_version INTEGER NOT NULL DEFAULT 2)`,
  );
  const stateColumns = db
    .executeSync('PRAGMA table_info(generated_image_gallery_state)')
    .rows.map(row => String(row.name));
  if (!stateColumns.includes('schema_version')) {
    db.executeSync(
      `ALTER TABLE generated_image_gallery_state
       ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 2`,
    );
  }
  db.executeSync(
    `INSERT OR IGNORE INTO generated_image_gallery_state
      (id, revision, legacy_imported, schema_version) VALUES (1, '0', 0, 2)`,
  );
  db.executeSync(
    'UPDATE generated_image_gallery_state SET schema_version = 2 WHERE id = 1',
  );
  const finalIntent = db.executeSync(
    'PRAGMA table_info(generated_image_byte_deletions)',
  ).rows;
  const finalWaiters = db.executeSync(
    'PRAGMA table_info(generated_image_release_waiters)',
  ).rows;
  const indexSql = String(
    db.executeSync(
      `SELECT sql FROM sqlite_master WHERE type = 'index'
     AND name = 'generated_image_release_waiters_by_image'`,
    ).rows[0]?.sql ?? '',
  ).replace(/\s+/g, ' ');
  const tableSql = (name: string) =>
    String(
      db.executeSync(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        [name],
      ).rows[0]?.sql ?? '',
    ).replace(/\s+/g, ' ');
  const intentSql = tableSql('generated_image_byte_deletions');
  const waiterSql = tableSql('generated_image_release_waiters');
  const intentPk = finalIntent
    .filter(column => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map(column => column.name);
  const waiterPk = finalWaiters
    .filter(column => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map(column => column.name);
  const requiredNotNull = (
    tableColumns: typeof finalIntent,
    names: readonly string[],
  ) =>
    names.every(name =>
      tableColumns.some(
        column => column.name === name && Number(column.notnull) === 1,
      ),
    );
  if (
    JSON.stringify(intentPk) !==
      JSON.stringify(['id', 'deletion_operation_id']) ||
    JSON.stringify(waiterPk) !==
      JSON.stringify(['scope', 'image_id', 'deletion_operation_id']) ||
    !requiredNotNull(finalIntent, [
      'id',
      'deletion_operation_id',
      'local_path',
    ]) ||
    !requiredNotNull(finalWaiters, [
      'scope',
      'image_id',
      'deletion_operation_id',
    ]) ||
    finalIntent.some(column =>
      ['owner_operation_id', 'release_scope'].includes(String(column.name)),
    ) ||
    finalWaiters.some(column => column.name === 'owner_operation_id') ||
    !intentSql.includes(
      "CHECK (id != '' AND deletion_operation_id != '' AND local_path != '')",
    ) ||
    !waiterSql.includes(
      "CHECK (scope != '' AND image_id != '' AND deletion_operation_id != '')",
    ) ||
    !indexSql.includes('(image_id, deletion_operation_id, scope)') ||
    db.executeSync(
      'SELECT schema_version FROM generated_image_gallery_state WHERE id = 1',
    ).rows[0]?.schema_version !== 2
  ) {
    throw new Error('Generated-image gallery schema verification failed.');
  }
  return db;
}

export class MobileGeneratedImageGalleryRepository
  implements GeneratedImageGalleryRepositoryPort
{
  private readonly activeSettlements = new Map<
    string,
    Promise<GeneratedImageReleaseSettlement>
  >();
  private readonly physicalSettlementTails = new Map<
    string,
    Promise<GeneratedImageReleaseSettlement>
  >();
  private readonly removalFences = new Map<string, () => boolean>();

  constructor(private readonly db: DB = openDatabase()) {
    ensureMobileGeneratedImageGallerySchema(db);
  }

  async read(): Promise<GeneratedImageGalleryRepositorySnapshot> {
    const revision = this.db.executeSync(
      'SELECT revision FROM generated_image_gallery_state WHERE id = 1',
    ).rows[0]?.revision;
    const images = this.db
      .executeSync(
        'SELECT record_json FROM generated_image_gallery ORDER BY id ASC',
      )
      .rows.map(
        row => JSON.parse(String(row.record_json)) as GeneratedImageRecord,
      );
    return { revision: String(revision ?? '0'), images };
  }

  /** Atomically remove one holder and retain its exact operation-scoped preimage. */
  async removeHolderWithReceipt(input: {
    readonly imageId: string;
    readonly deletionOperationId: string;
  }): Promise<GeneratedImageHolderRemovalReceipt> {
    if (!input.imageId || !input.deletionOperationId)
      throw new Error(
        'Generated-image holder removal requires stable identities.',
      );
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      const prior = this.db.executeSync(
        `SELECT status, preimage_json, post_delete_revision, restore_revision
         FROM generated_image_holder_removal_receipts
         WHERE image_id = ? AND deletion_operation_id = ?`,
        [input.imageId, input.deletionOperationId],
      ).rows[0];
      if (prior) {
        const current = this.db.executeSync(
          'SELECT record_json FROM generated_image_gallery WHERE id = ?',
          [input.imageId],
        ).rows[0]?.record_json;
        if (prior.status === 'removed' && current !== undefined)
          throw new Error(
            `Generated image ${input.imageId} changed after holder removal.`,
          );
        this.db.executeSync('COMMIT');
        return holderReceipt(
          input,
          prior.status,
          prior.preimage_json,
          prior.post_delete_revision,
          prior.restore_revision,
        );
      }
      const row = this.db.executeSync(
        'SELECT record_json FROM generated_image_gallery WHERE id = ?',
        [input.imageId],
      ).rows[0];
      const rawPreimage =
        typeof row?.record_json === 'string' ? row.record_json : null;
      const status = rawPreimage === null ? 'absent' : 'removed';
      const postDeleteRevision =
        rawPreimage === null
          ? String(
              this.db.executeSync(
                'SELECT revision FROM generated_image_gallery_state WHERE id = 1',
              ).rows[0]?.revision ?? '0',
            )
          : generateId();
      if (rawPreimage !== null) {
        const removed = this.db.executeSync(
          `DELETE FROM generated_image_gallery
           WHERE id = ? AND record_json = ?`,
          [input.imageId, rawPreimage],
        );
        if (Number(removed.rowsAffected ?? 0) !== 1)
          throw new Error(
            `Generated image ${input.imageId} changed before holder removal.`,
          );
        this.db.executeSync(
          'UPDATE generated_image_gallery_state SET revision = ? WHERE id = 1',
          [postDeleteRevision],
        );
      }
      this.db.executeSync(
        `INSERT INTO generated_image_holder_removal_receipts
          (image_id, deletion_operation_id, status, preimage_json, post_delete_revision)
         VALUES (?, ?, ?, ?, ?)`,
        [
          input.imageId,
          input.deletionOperationId,
          status,
          rawPreimage,
          postDeleteRevision,
        ],
      );
      this.db.executeSync('COMMIT');
      return holderReceipt(
        input,
        status,
        rawPreimage,
        postDeleteRevision,
        null,
      );
    } catch (cause) {
      this.db.executeSync('ROLLBACK');
      throw cause;
    }
  }

  /** Restore only the exact holder removed by one receipt and only from its exact post-state. */
  async restoreHolderFromReceipt(input: {
    readonly imageId: string;
    readonly deletionOperationId: string;
    readonly preimage: GeneratedImageRecord | null;
  }): Promise<GeneratedImageHolderRestoreResult> {
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      const row = this.db.executeSync(
        `SELECT status, preimage_json, post_delete_revision, restore_revision
         FROM generated_image_holder_removal_receipts
         WHERE image_id = ? AND deletion_operation_id = ?`,
        [input.imageId, input.deletionOperationId],
      ).rows[0];
      if (!row)
        return this.rollbackRestoreConflict(
          `Generated image ${input.imageId} has no matching removal receipt.`,
        );
      const receipt = holderReceipt(
        input,
        row.status,
        row.preimage_json,
        row.post_delete_revision,
        row.restore_revision,
      );
      if (JSON.stringify(receipt.preimage) !== JSON.stringify(input.preimage))
        return this.rollbackRestoreConflict(
          `Generated image ${input.imageId} restore preimage conflicts.`,
        );
      const revision = String(
        this.db.executeSync(
          'SELECT revision FROM generated_image_gallery_state WHERE id = 1',
        ).rows[0]?.revision ?? '0',
      );
      const current = this.db.executeSync(
        'SELECT record_json FROM generated_image_gallery WHERE id = ?',
        [input.imageId],
      ).rows[0]?.record_json;
      if (receipt.restoreRevision) {
        if (
          receipt.preimage === null
            ? current !== undefined
            : current !== JSON.stringify(receipt.preimage)
        )
          return this.rollbackRestoreConflict(
            `Generated image ${input.imageId} changed after holder restore.`,
          );
        this.db.executeSync('COMMIT');
        return { ok: true, status: 'already_restored', revision };
      }
      if (current !== undefined)
        return this.rollbackRestoreConflict(
          `Generated image ${input.imageId} changed after holder removal.`,
        );
      const restoreRevision =
        receipt.preimage === null ? revision : generateId();
      if (receipt.preimage) {
        this.db.executeSync(
          'INSERT INTO generated_image_gallery (id, record_json) VALUES (?, ?)',
          [input.imageId, JSON.stringify(receipt.preimage)],
        );
        this.db.executeSync(
          'UPDATE generated_image_gallery_state SET revision = ? WHERE id = 1',
          [restoreRevision],
        );
      }
      const updated = this.db.executeSync(
        `UPDATE generated_image_holder_removal_receipts SET restore_revision = ?
         WHERE image_id = ? AND deletion_operation_id = ? AND restore_revision IS NULL`,
        [restoreRevision, input.imageId, input.deletionOperationId],
      );
      if (Number(updated.rowsAffected ?? 0) !== 1)
        throw new Error(
          `Generated image ${input.imageId} restore receipt changed during commit.`,
        );
      this.db.executeSync('COMMIT');
      return { ok: true, status: 'restored', revision: restoreRevision };
    } catch (cause) {
      this.db.executeSync('ROLLBACK');
      throw cause;
    }
  }

  private rollbackRestoreConflict(
    message: string,
  ): GeneratedImageHolderRestoreResult {
    this.db.executeSync('ROLLBACK');
    return { ok: false, kind: 'conflict', message };
  }

  async replace(input: {
    readonly expectedRevision: string;
    readonly images: readonly GeneratedImageRecord[];
    readonly createConversationIds?: readonly string[];
  }): Promise<boolean> {
    if ((input.createConversationIds?.length ?? 0) > 0) {
      const workspaceContentDb = openWorkspaceContentDatabase();
      for (const conversationId of input.createConversationIds ?? []) {
        const deleting = workspaceContentDb.executeSync(
          `SELECT 1 FROM workspace_content_conversation_deletion_intents
           WHERE conversation_id = ? AND state != 'completed' LIMIT 1`,
          [conversationId],
        ).rows[0];
        if (deleting) return false;
      }
    }
    const currentIdsForFence = new Set(
      this.db
        .executeSync('SELECT id FROM generated_image_gallery')
        .rows.map(row => String(row.id)),
    );
    const nextIdsForFence = new Set(input.images.map(image => image.id));
    for (const id of currentIdsForFence) {
      if (nextIdsForFence.has(id)) continue;
      const fence = this.removalFences.get(id);
      // Everything after this check is synchronous SQLite work. A newer Sync winner cannot enter
      // between this exact fence and COMMIT.
      if (fence && !fence()) return false;
    }
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      const current = String(
        this.db.executeSync(
          'SELECT revision FROM generated_image_gallery_state WHERE id = 1',
        ).rows[0]?.revision ?? '0',
      );
      if (current !== input.expectedRevision) {
        this.db.executeSync('ROLLBACK');
        return false;
      }
      const nextIds = new Set(input.images.map(image => image.id));
      const currentRows = this.db.executeSync(
        'SELECT id, record_json FROM generated_image_gallery',
      ).rows;
      const currentIds = new Set(currentRows.map(row => String(row.id)));
      const blockedReplacement = input.images.find(image => {
        if (currentIds.has(image.id)) return false;
        const deletion = this.db.executeSync(
          `SELECT owner_kind, record_json, deletion_operation_id
           FROM generated_image_byte_deletions
           WHERE id = ?`,
          [image.id],
        ).rows[0];
        if (!deletion) return false;
        // Generic create/replace has no deletion-operation authority. Any pending operation blocks
        // it; only the operation-scoped fenced compensation below may cancel release work.
        return deletion !== undefined;
      });
      // A removed identity cannot be recreated until its old byte-release intent settles. The
      // inbound coordinator treats this revision refusal as retryable and restores the arriving
      // bytes to staging, so an already-running release can only act on the old destination.
      if (blockedReplacement) {
        this.db.executeSync('ROLLBACK');
        return false;
      }
      for (const row of currentRows) {
        const id = String(row.id);
        if (nextIds.has(id)) continue;
        const record = JSON.parse(
          String(row.record_json),
        ) as GeneratedImageRecord;
        // Every removed record leaves a durable intent naming the path AND which owner may act on
        // it. A received image's bytes still belong to the Shared File coordinator - the intent
        // records that fact so a restart can still ask it, instead of losing the provenance.
        for (const deletionOperationId of deletionOperationIdsFor(
          this.db,
          id,
        )) {
          this.db.executeSync(
            `INSERT OR IGNORE INTO generated_image_byte_deletions
              (id, local_path, owner_kind, record_json, deletion_operation_id)
             VALUES (?, ?, ?, ?, ?)`,
            [
              id,
              record.local.path,
              record.provenance ? 'provenance' : 'local',
              JSON.stringify(record),
              deletionOperationId,
            ],
          );
          const intent = this.db.executeSync(
            `SELECT local_path, owner_kind, record_json
             FROM generated_image_byte_deletions
             WHERE id = ? AND deletion_operation_id = ?`,
            [id, deletionOperationId],
          ).rows[0];
          if (
            intent?.local_path !== record.local.path ||
            intent?.owner_kind !==
              (record.provenance ? 'provenance' : 'local') ||
            intent?.record_json !== JSON.stringify(record)
          ) {
            throw new Error(
              `Generated image ${id} deletion operation conflicts.`,
            );
          }
        }
      }
      this.db.executeSync('DELETE FROM generated_image_gallery');
      for (const image of input.images) {
        this.db.executeSync(
          'INSERT INTO generated_image_gallery (id, record_json) VALUES (?, ?)',
          [image.id, JSON.stringify(image)],
        );
      }
      this.db.executeSync(
        'UPDATE generated_image_gallery_state SET revision = ? WHERE id = 1',
        [generateId()],
      );
      this.db.executeSync('COMMIT');
      return true;
    } catch (error) {
      this.db.executeSync('ROLLBACK');
      throw error;
    }
  }

  async withRemovalFence<Result>(input: {
    readonly imageId: string;
    readonly isCurrentWinner: () => boolean;
    readonly work: () => Promise<Result>;
  }): Promise<Result> {
    const { imageId, isCurrentWinner, work } = input;
    if (this.removalFences.has(imageId)) {
      throw new Error(`A gallery removal fence already owns image ${imageId}.`);
    }
    this.removalFences.set(imageId, isCurrentWinner);
    try {
      return await work();
    } finally {
      if (this.removalFences.get(imageId) === isCurrentWinner) {
        this.removalFences.delete(imageId);
      }
    }
  }

  legacyImportCompleted(): boolean {
    return (
      this.db.executeSync(
        'SELECT legacy_imported FROM generated_image_gallery_state WHERE id = 1',
      ).rows[0]?.legacy_imported === 1
    );
  }

  markLegacyImportCompleted(): void {
    this.db.executeSync(
      'UPDATE generated_image_gallery_state SET legacy_imported = 1 WHERE id = 1',
    );
  }

  /** Add durable waiters without replacing another workflow's claim on the same image. */
  captureByteDeletionScope(
    scope: string,
    ids: readonly string[],
    deletionOperationId: string = scope,
  ): void {
    if (!scope.trim())
      throw new Error('A generated-image release scope is required.');
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      for (const id of [...new Set(ids)].sort()) {
        const metadataExists = this.db.executeSync(
          'SELECT 1 FROM generated_image_gallery WHERE id = ?',
          [id],
        ).rows[0];
        if (metadataExists) {
          this.db.executeSync(
            `DELETE FROM generated_image_waiter_cancellations
             WHERE scope = ? AND image_id = ? AND deletion_operation_id = ?`,
            [scope, id, deletionOperationId],
          );
        }
        this.db.executeSync(
          `INSERT OR IGNORE INTO generated_image_release_waiters
            (scope, image_id, deletion_operation_id)
           SELECT ?, ?, ? WHERE NOT EXISTS (
             SELECT 1 FROM generated_image_waiter_cancellations
             WHERE scope = ? AND image_id = ? AND deletion_operation_id = ?)`,
          [scope, id, deletionOperationId, scope, id, deletionOperationId],
        );
      }
      this.db.executeSync('COMMIT');
    } catch (error) {
      this.db.executeSync('ROLLBACK');
      throw error;
    }
  }

  cancelUnresolvableWaiter(input: {
    readonly scope: string;
    readonly imageId: string;
    readonly deletionOperationId: string;
  }): GeneratedImageWaiterCancellation {
    if (!input.scope || !input.imageId || !input.deletionOperationId) {
      return {
        ok: false,
        kind: 'conflict',
        message:
          'Generated-image waiter cancellation requires exact identities.',
      };
    }
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      const metadata = this.db.executeSync(
        'SELECT 1 FROM generated_image_gallery WHERE id = ?',
        [input.imageId],
      ).rows[0];
      const byteIntent = this.db.executeSync(
        `SELECT 1 FROM generated_image_byte_deletions
         WHERE id = ? AND deletion_operation_id = ?`,
        [input.imageId, input.deletionOperationId],
      ).rows[0];
      if (metadata || byteIntent) {
        this.db.executeSync('ROLLBACK');
        return {
          ok: false,
          kind: 'conflict',
          message: `Generated image ${input.imageId} still has canonical deletion work.`,
        };
      }
      const prior = this.db.executeSync(
        `SELECT 1 FROM generated_image_waiter_cancellations
         WHERE scope = ? AND image_id = ? AND deletion_operation_id = ?`,
        [input.scope, input.imageId, input.deletionOperationId],
      ).rows[0];
      this.db.executeSync(
        `DELETE FROM generated_image_release_waiters
         WHERE scope = ? AND image_id = ? AND deletion_operation_id = ?`,
        [input.scope, input.imageId, input.deletionOperationId],
      );
      this.db.executeSync(
        `INSERT OR IGNORE INTO generated_image_waiter_cancellations
          (scope, image_id, deletion_operation_id, created_at)
         VALUES (?, ?, ?, ?)`,
        [
          input.scope,
          input.imageId,
          input.deletionOperationId,
          new Date().toISOString(),
        ],
      );
      this.db.executeSync('COMMIT');
      return { ok: true, status: prior ? 'already_cancelled' : 'cancelled' };
    } catch (cause) {
      this.db.executeSync('ROLLBACK');
      throw cause;
    }
  }

  clearWaiterCancellations(deletionOperationId: string): void {
    this.db.executeSync(
      `DELETE FROM generated_image_waiter_cancellations
       WHERE deletion_operation_id = ?`,
      [deletionOperationId],
    );
  }

  /**
   * Settle EVERY durable release intent in one pass, oldest first, and report the pass once.
   *
   * `settle` is only allowed to return for an intent that is FULLY settled; the row is removed
   * after it returns and not before, so a crash or a rejected settlement leaves the intent - path,
   * owner kind and all - for the next drain.
   *
   * This is the global recovery drain, and its failure rule differs from the scope drain on
   * purpose. One unreachable path used to abort the whole pass at the first rejection, so every
   * LATER pending image was never attempted and its bytes stayed on disk until a restart happened
   * to order that row first. A recovery pass therefore attempts each intent independently: a
   * success settles and clears its own row and waiters, a failure retains all of its durable work,
   * and the pass returns ONE aggregate result naming every retained identity. No intent is
   * silently dropped and no intent is starved by another one's failure.
   */
  async drainByteDeletions(
    settle: (intent: GeneratedImageReleaseIntent) => Promise<void>,
  ): Promise<GeneratedImageReleaseDrainResult> {
    const rows = this.db.executeSync(
      `SELECT id, deletion_operation_id FROM generated_image_byte_deletions
       ORDER BY id ASC, deletion_operation_id ASC`,
    ).rows;
    const settled: string[] = [];
    const retained: GeneratedImageReleaseRetention[] = [];
    for (const row of rows) {
      const id = String(row.id);
      try {
        await this.settleImage(id, String(row.deletion_operation_id), settle);
        settled.push(id);
      } catch (error) {
        retained.push({ id, reason: releaseFailureReason(error), error });
      }
    }
    return { attempted: rows.length, settled, retained };
  }

  verifyByteDeletionsSettled(): void {
    const residue = this.db.executeSync(
      `SELECT id, deletion_operation_id, 'intent' AS kind
       FROM generated_image_byte_deletions
       UNION ALL
       SELECT image_id AS id, deletion_operation_id, 'waiter' AS kind
       FROM generated_image_release_waiters
       ORDER BY id ASC, deletion_operation_id ASC LIMIT 1`,
    ).rows[0];
    if (residue) {
      throw new Error(
        `Generated image ${String(
          residue.id,
        )} still has a pending byte ${String(residue.kind)}.`,
      );
    }
  }

  /** Await every image claimed by this scope without consuming another scope's waiter. */
  async drainByteDeletionsForScope(
    scope: string,
    settle: (
      intent: GeneratedImageReleaseIntent,
      commitFence?: DeletionCleanupContinuation,
    ) => Promise<GeneratedImageReleaseSettlement>,
    commitFence?: DeletionCleanupContinuation,
  ): Promise<GeneratedImageReleaseSettlement> {
    if (!scope.trim())
      throw new Error('A generated-image release scope is required.');
    const rows = this.db.executeSync(
      `SELECT image_id, deletion_operation_id FROM generated_image_release_waiters
       WHERE scope = ? ORDER BY image_id ASC`,
      [scope],
    ).rows;
    for (const row of rows) {
      const result = await this.settleImage(
        String(row.image_id),
        String(row.deletion_operation_id),
        settle,
        commitFence,
      );
      if (result === 'fenced') return result;
    }
  }

  private async settleImage(
    id: string,
    deletionOperationId: string,
    settle: (
      intent: GeneratedImageReleaseIntent,
      commitFence?: DeletionCleanupContinuation,
    ) => Promise<GeneratedImageReleaseSettlement>,
    commitFence?: DeletionCleanupContinuation,
  ): Promise<GeneratedImageReleaseSettlement> {
    const settlementKey = `${id}\u0000${deletionOperationId}`;
    const active = this.activeSettlements.get(settlementKey);
    if (active) return active;
    const prior = this.physicalSettlementTails.get(id) ?? Promise.resolve();
    const task = prior
      .catch(() => undefined)
      .then(() =>
        this.settleImageOnce(id, deletionOperationId, settle, commitFence),
      );
    this.activeSettlements.set(settlementKey, task);
    this.physicalSettlementTails.set(id, task);
    try {
      return await task;
    } finally {
      if (this.activeSettlements.get(settlementKey) === task) {
        this.activeSettlements.delete(settlementKey);
      }
      if (this.physicalSettlementTails.get(id) === task) {
        this.physicalSettlementTails.delete(id);
      }
    }
  }

  private async settleImageOnce(
    id: string,
    deletionOperationId: string,
    settle: (
      intent: GeneratedImageReleaseIntent,
      commitFence?: DeletionCleanupContinuation,
    ) => Promise<GeneratedImageReleaseSettlement>,
    commitFence?: DeletionCleanupContinuation,
  ): Promise<GeneratedImageReleaseSettlement> {
    const row = this.db.executeSync(
      `SELECT id, local_path, owner_kind, record_json, deletion_operation_id
       FROM generated_image_byte_deletions
       WHERE id = ? AND deletion_operation_id = ?`,
      [id, deletionOperationId],
    ).rows[0];
    if (row) {
      const settlement = await settle(
        {
          id,
          deletionOperationId,
          path: String(row.local_path),
          owner: releaseOwner(row.owner_kind, id),
        },
        commitFence,
      );
      if (settlement === 'fenced') {
        this.restoreFencedRemoval(id, deletionOperationId, row.record_json);
        return settlement;
      }
    }
    if (!row) {
      const metadataExists = this.db.executeSync(
        'SELECT 1 FROM generated_image_gallery WHERE id = ?',
        [id],
      ).rows[0];
      throw new Error(
        metadataExists
          ? `Generated image ${id} still has metadata and cannot settle byte release.`
          : `Generated image ${id} operation ${deletionOperationId} has no durable byte intent.`,
      );
    }
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      const removed = this.db.executeSync(
        `DELETE FROM generated_image_byte_deletions
         WHERE id = ? AND deletion_operation_id = ? AND local_path = ?
           AND owner_kind = ? AND record_json IS ?`,
        [
          id,
          deletionOperationId,
          row.local_path,
          row.owner_kind,
          row.record_json,
        ],
      );
      if (Number(removed.rowsAffected ?? 0) !== 1) {
        throw new Error(
          `Generated image ${id} deletion operation changed during settlement.`,
        );
      }
      this.db.executeSync(
        `INSERT OR IGNORE INTO generated_image_release_settlements
          (image_id, deletion_operation_id, record_generation) VALUES (?, ?, ?)`,
        [
          id,
          deletionOperationId,
          recordGeneration({
            local_path: row.local_path,
            record_json: row.record_json,
          }),
        ],
      );
      this.db.executeSync(
        `DELETE FROM generated_image_release_waiters
         WHERE image_id = ? AND deletion_operation_id = ?`,
        [id, deletionOperationId],
      );
      this.clearSettledArbitrationIfUnclaimed(id);
      this.db.executeSync('COMMIT');
    } catch (error) {
      this.db.executeSync('ROLLBACK');
      throw error;
    }
  }

  private restoreFencedRemoval(
    id: string,
    deletionOperationId: string,
    rawRecord: unknown,
  ): void {
    if (typeof rawRecord !== 'string') {
      throw new Error(
        `Generated image ${id} cannot restore metadata after a fenced byte release.`,
      );
    }
    const record = JSON.parse(rawRecord) as GeneratedImageRecord;
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      const removed = this.db.executeSync(
        `DELETE FROM generated_image_byte_deletions
         WHERE id = ? AND deletion_operation_id = ? AND record_json = ?`,
        [id, deletionOperationId, rawRecord],
      );
      if (Number(removed.rowsAffected ?? 0) !== 1) {
        throw new Error(
          `Generated image ${id} fenced operation changed before compensation.`,
        );
      }
      const anotherClaim = this.db.executeSync(
        `SELECT 1 FROM generated_image_byte_deletions
         WHERE id = ? AND deletion_operation_id != ?
         UNION ALL
         SELECT 1 FROM generated_image_release_settlements
         WHERE image_id = ? AND deletion_operation_id != ?
           AND record_generation = ? LIMIT 1`,
        [
          id,
          deletionOperationId,
          id,
          deletionOperationId,
          recordGeneration({
            local_path: record.local.path,
            record_json: rawRecord,
          }),
        ],
      ).rows[0];
      if (!anotherClaim) {
        this.db.executeSync(
          `INSERT OR IGNORE INTO generated_image_gallery (id, record_json)
           VALUES (?, ?)`,
          [id, JSON.stringify(record)],
        );
      }
      this.db.executeSync(
        `DELETE FROM generated_image_release_waiters
         WHERE image_id = ? AND deletion_operation_id = ?`,
        [id, deletionOperationId],
      );
      this.clearSettledArbitrationIfUnclaimed(id);
      this.db.executeSync(
        'UPDATE generated_image_gallery_state SET revision = ? WHERE id = 1',
        [generateId()],
      );
      this.db.executeSync('COMMIT');
    } catch (error) {
      this.db.executeSync('ROLLBACK');
      throw error;
    }
  }

  private clearSettledArbitrationIfUnclaimed(id: string): void {
    const claim = this.db.executeSync(
      'SELECT 1 FROM generated_image_byte_deletions WHERE id = ? LIMIT 1',
      [id],
    ).rows[0];
    if (!claim)
      this.db.executeSync(
        'DELETE FROM generated_image_release_settlements WHERE image_id = ?',
        [id],
      );
  }
}

function recordGeneration(row: {
  local_path: unknown;
  record_json: unknown;
}): string {
  return `${String(row.local_path)}\u0000${String(row.record_json ?? '')}`;
}

function deletionOperationIdsFor(db: DB, imageId: string): readonly string[] {
  const waiters = db
    .executeSync(
      `SELECT deletion_operation_id FROM generated_image_release_waiters
     WHERE image_id = ?
     ORDER BY deletion_operation_id ASC`,
      [imageId],
    )
    .rows.map(row => String(row.deletion_operation_id));
  return waiters.length > 0 ? [...new Set(waiters)] : [`local:${generateId()}`];
}
