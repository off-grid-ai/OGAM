import { open, type DB } from '@op-engineering/op-sqlite';
import type { MessageRecord } from '@offgrid/application';

const PORTABLE_CONTENT_JSON_PREFIX = 'offgrid-content-json:';

/** Store typed content in the existing TEXT column without changing legacy plain-text rows. */
export function encodeWorkspaceMessageContent(
  content: MessageRecord['portable']['content'],
): string {
  return typeof content === 'string'
    ? content
    : `${PORTABLE_CONTENT_JSON_PREFIX}${JSON.stringify(content)}`;
}

export function decodeWorkspaceMessageContent(
  content: string,
): MessageRecord['portable']['content'] {
  return content.startsWith(PORTABLE_CONTENT_JSON_PREFIX)
    ? (JSON.parse(
        content.slice(PORTABLE_CONTENT_JSON_PREFIX.length),
      ) as MessageRecord['portable']['content'])
    : content;
}

const WORKSPACE_CONTENT_DATABASE_NAME =
  'offgrid-workspace-content.sqlite';
export const WORKSPACE_CONTENT_SCHEMA_VERSION = 2;

const WORKSPACE_CONTENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS workspace_content_projects (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
    system_prompt TEXT NOT NULL, icon TEXT, include_memory INTEGER NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS workspace_content_conversations (
    id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, model_id TEXT, project_id TEXT,
    compaction_summary TEXT, compaction_cutoff_message_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES workspace_content_projects(id) ON DELETE SET NULL)`,
  `CREATE TABLE IF NOT EXISTS workspace_content_messages (
    id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL, turn_id TEXT,
    position INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
    context_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    legacy_order_created_at TEXT,
    order_token_json TEXT,
    FOREIGN KEY (conversation_id) REFERENCES workspace_content_conversations(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS workspace_content_chat_turns (
    conversation_id TEXT PRIMARY KEY NOT NULL, turns_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES workspace_content_conversations(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS workspace_content_local_message_state (
    message_id TEXT PRIMARY KEY NOT NULL, state_json TEXT NOT NULL,
    FOREIGN KEY (message_id) REFERENCES workspace_content_messages(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS workspace_content_message_holder_receipts (
    message_id TEXT NOT NULL, deletion_operation_id TEXT NOT NULL,
    sync_id TEXT NOT NULL, status TEXT NOT NULL, preimage_json TEXT,
    postimage_json TEXT, post_delete_revision TEXT, restore_revision TEXT,
    PRIMARY KEY (message_id, deletion_operation_id),
    CHECK (message_id != '' AND deletion_operation_id != '' AND sync_id != ''),
    CHECK (status IN ('removed', 'absent')))`,
  `CREATE TABLE IF NOT EXISTS workspace_content_local_resource_releases (
    id TEXT PRIMARY KEY NOT NULL CHECK (trim(id) != ''),
    transaction_id TEXT NOT NULL CHECK (trim(transaction_id) != ''),
    transaction_order INTEGER NOT NULL CHECK (transaction_order >= 0),
    message_id TEXT NOT NULL CHECK (trim(message_id) != ''),
    content_id TEXT NOT NULL CHECK (trim(content_id) != ''),
    uri TEXT, data TEXT, created_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT,
    UNIQUE(transaction_id, transaction_order),
    CHECK ((uri IS NOT NULL AND data IS NULL) OR
           (uri IS NULL AND data IS NOT NULL)))`,
  `CREATE TABLE IF NOT EXISTS workspace_content_migration_journal (
    target_version INTEGER PRIMARY KEY NOT NULL, status TEXT NOT NULL,
    started_at TEXT NOT NULL, finished_at TEXT, failure_message TEXT)`,
  `CREATE TABLE IF NOT EXISTS workspace_content_legacy_attachment_recovery (
    version INTEGER PRIMARY KEY NOT NULL, completed_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS workspace_content_outbox (
    id TEXT PRIMARY KEY NOT NULL, sync_operation_id TEXT NOT NULL, transaction_id TEXT NOT NULL,
    transaction_order INTEGER NOT NULL, entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL, operation TEXT NOT NULL, payload_json TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL, delivered_at TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
    claim_id TEXT, claimed_at TEXT, retry_at TEXT,
    last_error TEXT, UNIQUE(transaction_id, transaction_order))`,
  `CREATE TABLE IF NOT EXISTS workspace_content_revision (
    id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS workspace_content_project_deletion_intents (
    project_id TEXT PRIMARY KEY NOT NULL,
    origin TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local', 'remote')),
    remote_operation_id TEXT,
    state TEXT NOT NULL, phase TEXT NOT NULL,
    remaining_document_sync_ids_json TEXT NOT NULL, attempt INTEGER NOT NULL,
    updated_at TEXT NOT NULL, last_failure TEXT)`,
  `CREATE TABLE IF NOT EXISTS workspace_content_conversation_deletion_intents (
    conversation_id TEXT PRIMARY KEY NOT NULL,
    origin TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local', 'remote')),
    remote_operation_id TEXT,
    state TEXT NOT NULL, phase TEXT NOT NULL,
    image_ids_json TEXT NOT NULL, attempt INTEGER NOT NULL,
    updated_at TEXT NOT NULL, last_failure TEXT)`,
];

const WORKSPACE_CONTENT_INDEXES = [
  `CREATE INDEX IF NOT EXISTS workspace_content_projects_order
    ON workspace_content_projects(updated_at DESC, id ASC)`,
  `CREATE INDEX IF NOT EXISTS workspace_content_conversations_order
    ON workspace_content_conversations(updated_at DESC, id ASC)`,
  `CREATE INDEX IF NOT EXISTS workspace_content_outbox_pending
    ON workspace_content_outbox(delivered_at, claim_id, retry_at)`,
  `CREATE INDEX IF NOT EXISTS workspace_content_project_deletion_pending
    ON workspace_content_project_deletion_intents(state, updated_at, project_id)`,
  `CREATE INDEX IF NOT EXISTS workspace_content_conversation_deletion_pending
    ON workspace_content_conversation_deletion_intents(state, updated_at, conversation_id)`,
  `CREATE INDEX IF NOT EXISTS workspace_content_local_resource_release_pending
    ON workspace_content_local_resource_releases(attempt_count, transaction_id, transaction_order)`,
];

/**
 * Additive-only upgrade for a database created before the M59 outbox claim contract.
 *
 * `CREATE TABLE IF NOT EXISTS` never widens an existing table, so a pre-existing
 * `workspace_content_outbox` from an older build is missing `origin`, `claim_id`, `claimed_at`, and
 * `retry_at`. Adding them here, once, preserves every existing outbox row instead of dropping or
 * recreating the table. Idempotent: `PRAGMA table_info` is checked before each `ADD COLUMN`, so
 * calling this on an already-upgraded or freshly created database is a no-op.
 */
function ensureOutboxClaimColumns(db: DB): void {
  const existing = db.executeSync('PRAGMA table_info(workspace_content_outbox)')
    .rows as unknown as ReadonlyArray<{ name: string }>;
  const hasColumn = (name: string) =>
    existing.some(column => column.name === name);
  if (!hasColumn('origin')) {
    db.executeSync(
      "ALTER TABLE workspace_content_outbox ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'",
    );
  }
  if (!hasColumn('claim_id')) {
    db.executeSync(
      'ALTER TABLE workspace_content_outbox ADD COLUMN claim_id TEXT',
    );
  }
  if (!hasColumn('claimed_at')) {
    db.executeSync(
      'ALTER TABLE workspace_content_outbox ADD COLUMN claimed_at TEXT',
    );
  }
  if (!hasColumn('retry_at')) {
    db.executeSync(
      'ALTER TABLE workspace_content_outbox ADD COLUMN retry_at TEXT',
    );
  }
  if (!hasColumn('sync_operation_id')) {
    db.executeSync(
      'ALTER TABLE workspace_content_outbox ADD COLUMN sync_operation_id TEXT',
    );
    db.executeSync(`UPDATE workspace_content_outbox SET sync_operation_id = id
      WHERE sync_operation_id IS NULL OR trim(sync_operation_id) = ''`);
  }
  const missingOrigin = db.executeSync(
    "SELECT 1 FROM workspace_content_outbox WHERE origin IS NULL OR origin = '' LIMIT 1",
  ).rows[0];
  if (missingOrigin) {
    db.executeSync(
      "UPDATE workspace_content_outbox SET origin = 'local' WHERE origin IS NULL OR origin = ''",
    );
  }
}

function ensureDeletionIntentOriginColumns(db: DB): void {
  for (const table of [
    'workspace_content_project_deletion_intents',
    'workspace_content_conversation_deletion_intents',
  ]) {
    const columns = db.executeSync(`PRAGMA table_info(${table})`).rows;
    if (columns.some(column => column.name === 'origin')) continue;
    db.executeSync(
      `ALTER TABLE ${table} ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'
       CHECK (origin IN ('local', 'remote'))`,
    );
  }
}

function ensureDeletionIntentOperationColumns(db: DB): void {
  for (const table of [
    'workspace_content_project_deletion_intents',
    'workspace_content_conversation_deletion_intents',
  ]) {
    const columns = db.executeSync(`PRAGMA table_info(${table})`).rows;
    if (columns.some(column => column.name === 'remote_operation_id')) continue;
    db.executeSync(`ALTER TABLE ${table} ADD COLUMN remote_operation_id TEXT`);
  }
}

function ensureMessageLegacyOrderColumn(db: DB): void {
  const columns = db.executeSync(
    'PRAGMA table_info(workspace_content_messages)',
  ).rows;
  if (columns.some(column => column.name === 'legacy_order_created_at')) return;
  db.executeSync(
    'ALTER TABLE workspace_content_messages ADD COLUMN legacy_order_created_at TEXT',
  );
}

function ensureMessageOrderTokenColumn(db: DB): void {
  const columns = db.executeSync(
    'PRAGMA table_info(workspace_content_messages)',
  ).rows;
  if (!columns.some(column => column.name === 'order_token_json')) {
    db.executeSync(
      'ALTER TABLE workspace_content_messages ADD COLUMN order_token_json TEXT',
    );
  }
  db.executeSync(`UPDATE workspace_content_messages SET order_token_json = CASE
    WHEN legacy_order_created_at IS NOT NULL THEN json_object('source','positionless_sync','createdAt',legacy_order_created_at,'messageId',id)
    ELSE json_object('source','explicit_sync','position',position,'messageId',id) END
    WHERE order_token_json IS NULL`);
}

function ensureMessageHolderReceiptColumns(db: DB): void {
  const columns = db.executeSync(
    'PRAGMA table_info(workspace_content_message_holder_receipts)',
  ).rows;
  const has = (name: string) => columns.some(column => column.name === name);
  if (!has('postimage_json'))
    db.executeSync(
      'ALTER TABLE workspace_content_message_holder_receipts ADD COLUMN postimage_json TEXT',
    );
  if (!has('post_delete_revision')) {
    db.executeSync(
      'ALTER TABLE workspace_content_message_holder_receipts ADD COLUMN post_delete_revision TEXT',
    );
  }
  if (!has('restore_revision'))
    db.executeSync(
      'ALTER TABLE workspace_content_message_holder_receipts ADD COLUMN restore_revision TEXT',
    );
}

/**
 * Seed the singleton revision row once, from whatever the pre-M59 revision signal (the last
 * outbox row's `transaction_id`) already was. Revision tracking must survive a remote-origin
 * commit that skips the outbox entirely, so it can no longer be derived from that table - but an
 * existing install's current revision must not silently reset to `'0'` on upgrade.
 */
function ensureRevisionSeed(db: DB): void {
  const seeded = db.executeSync(
    'SELECT revision FROM workspace_content_revision WHERE id = 1',
  ).rows[0];
  if (seeded) return;
  const priorRevision = db.executeSync(
    'SELECT transaction_id FROM workspace_content_outbox ORDER BY rowid DESC LIMIT 1',
  ).rows[0]?.transaction_id;
  db.executeSync(
    'INSERT INTO workspace_content_revision (id, revision) VALUES (1, ?)',
    [typeof priorRevision === 'string' ? priorRevision : '0'],
  );
}

/** Open the one normalized Mobile workspace-content database. */
export function openWorkspaceContentDatabase(): DB {
  const db = open({ name: WORKSPACE_CONTENT_DATABASE_NAME });
  db.executeSync('PRAGMA foreign_keys = ON');
  for (const statement of WORKSPACE_CONTENT_SCHEMA) db.executeSync(statement);
  ensureOutboxClaimColumns(db);
  ensureDeletionIntentOriginColumns(db);
  ensureDeletionIntentOperationColumns(db);
  ensureMessageLegacyOrderColumn(db);
  ensureMessageOrderTokenColumn(db);
  ensureRevisionSeed(db);
  ensureMessageHolderReceiptColumns(db);
  for (const statement of WORKSPACE_CONTENT_INDEXES) db.executeSync(statement);
  return db;
}
