/* eslint-disable max-lines -- One normalized repository keeps commit and receipt transactions atomic. */
import type {
  ChatTurnRecord,
  ConversationRecord,
  MessageRecord,
  ProjectRecord,
  WorkspaceContentChange,
  WorkspaceContentCommitResult,
  WorkspaceContentMigrationStatus,
  WorkspaceContentOutboxClaim,
  WorkspaceContentOutboxEntry,
  WorkspaceContentOutboxOrigin,
  WorkspaceContentOutboxTransitionResult,
  WorkspaceContentRepositoryPort,
  WorkspaceContentRepositorySnapshot,
  WorkspaceContentTransaction,
} from '@offgrid/application';
import type { DB, Scalar } from '@op-engineering/op-sqlite';
import {
  parseMessageOrderToken,
  serializeMessageOrderToken,
} from '@offgrid/application';
import { generateId } from '../../../utils/generateId';
import {
  decodeWorkspaceMessageContent,
  encodeWorkspaceMessageContent,
  openWorkspaceContentDatabase,
  WORKSPACE_CONTENT_SCHEMA_VERSION,
} from './workspaceContentDatabase';
import { MobileWorkspaceContentOutboxStore } from './mobileWorkspaceContentOutboxStore';
import { MobileWorkspaceContentLocalResourceReleaseOwner } from './mobileWorkspaceContentLocalResourceReleaseOwner';
import {
  MobileLocalResourcePrivacyWorkflow,
  type MobileCanonicalImagePrivacyPort,
  type MobileOwnedDirectoryPrivacyPort,
} from './mobileLocalResourcePrivacyWorkflow';
import {
  projectMobileWorkspaceContentAttachmentByteIdentities,
} from './mobileWorkspaceContentAttachmentIdentity';

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  icon: string | null;
  include_memory: number;
  created_at: string;
  updated_at: string;
};

type ConversationRow = {
  id: string;
  title: string;
  model_id: string | null;
  project_id: string | null;
  compaction_summary: string | null;
  compaction_cutoff_message_id: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  turn_id: string | null;
  position: number;
  role: MessageRecord['portable']['role'];
  content: string;
  context_json: string | null;
  legacy_order_created_at: string | null;
  order_token_json: string | null;
  state_json: string | null;
  created_at: string;
  updated_at: string;
};

const MESSAGE_ROW_SELECT = `SELECT m.id, m.conversation_id, m.turn_id, m.position, m.role,
  m.content, m.context_json, m.legacy_order_created_at, m.order_token_json, l.state_json,
  m.created_at, m.updated_at
  FROM workspace_content_messages m
  LEFT JOIN workspace_content_local_message_state l ON l.message_id = m.id`;

export { projectMobileMessageContent } from './mobileWorkspaceMessageContentProjection';

export interface WorkspaceMessageHolderReceipt {
  readonly messageId: string;
  readonly deletionOperationId: string;
  readonly syncId: string;
  readonly status: 'removed' | 'absent';
  readonly preimage: MessageRecord['local'] | null;
  readonly postimage: MessageRecord['local'] | null;
  readonly postDeleteRevision: string;
  readonly restoreRevision?: string;
}

export type WorkspaceMessageHolderRestoreResult =
  | {
      readonly ok: true;
      readonly status: 'restored' | 'already_restored';
      readonly revision: string;
    }
  | { readonly ok: false; readonly kind: 'conflict'; readonly message: string };

type TurnRow = { turns_json: string };
type MigrationRow = {
  target_version: number;
  status: 'started' | 'completed' | 'failed';
  failure_message: string | null;
};

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Mobile SQLite mechanics for the Shared workspace-content owner. */
export class MobileWorkspaceContentRepository implements WorkspaceContentRepositoryPort {
  private readonly deletionCommitFences = new Map<string, () => boolean>();

  private readonly outbox: MobileWorkspaceContentOutboxStore;
  readonly localResourceReleases: MobileWorkspaceContentLocalResourceReleaseOwner;

  constructor(private readonly db: DB = openWorkspaceContentDatabase()) {
    this.outbox = new MobileWorkspaceContentOutboxStore(db);
    this.localResourceReleases =
      new MobileWorkspaceContentLocalResourceReleaseOwner(db);
  }

  createLocalResourcePrivacyWorkflow(
    directories: () => MobileOwnedDirectoryPrivacyPort | null,
    images: () => MobileCanonicalImagePrivacyPort | null,
    newOperationId: () => string,
  ): MobileLocalResourcePrivacyWorkflow {
    return new MobileLocalResourcePrivacyWorkflow({
      db: this.db,
      releases: this.localResourceReleases,
      directories,
      images,
      newOperationId,
    });
  }

  async read(): Promise<WorkspaceContentRepositorySnapshot> {
    const projects = rows<ProjectRow>(
      this.db,
      `SELECT id, name, description, system_prompt, icon, include_memory, created_at, updated_at
       FROM workspace_content_projects ORDER BY updated_at DESC, id ASC`,
    ).map(projectFromRow);
    const conversations = rows<ConversationRow>(
      this.db,
      `SELECT id, title, model_id, project_id, compaction_summary,
              compaction_cutoff_message_id, created_at, updated_at
       FROM workspace_content_conversations ORDER BY updated_at DESC, id ASC`,
    ).map(conversationFromRow);
    const messages = rows<MessageRow>(
      this.db,
      `${MESSAGE_ROW_SELECT} ORDER BY m.position ASC, m.id ASC`,
    ).map(messageFromRow);
    const chatTurns = rows<TurnRow>(
      this.db,
      `SELECT turns_json FROM workspace_content_chat_turns
       ORDER BY conversation_id ASC`,
    )
      .flatMap(({ turns_json }) => parseJson<ChatTurnRecord[]>(turns_json))
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );

    return {
      revision: this.currentRevision(),
      migration: this.migrationStatus(),
      projects,
      conversations,
      messages,
      chatTurns,
    };
  }

  /** Read one canonical message and the revision that protects its next commit. */
  async readMessageAtCurrentRevision(messageId: string): Promise<{
    readonly revision: string;
    readonly message?: MessageRecord;
  }> {
    const revision = this.currentRevision();
    const row = rows<MessageRow>(
      this.db,
      `${MESSAGE_ROW_SELECT} WHERE m.id = ? LIMIT 1`,
      [messageId],
    )[0];
    return {
      revision,
      ...(row ? {message: messageFromRow(row)} : {}),
    };
  }

  async commit(
    transaction: WorkspaceContentTransaction,
  ): Promise<WorkspaceContentCommitResult> {
    const fencedDeletion = transaction.changes.find(
      change =>
        change.kind === 'delete' &&
        (change.entity === 'project' || change.entity === 'conversation'),
    );
    if (fencedDeletion && 'id' in fencedDeletion) {
      const fence = this.deletionCommitFences.get(
        `${fencedDeletion.entity}\u0000${fencedDeletion.id}`,
      );
      // The SQLite transaction below is synchronous. This final check is therefore at the commit
      // boundary: no newer JS op can enter between the check and COMMIT.
      if (fence && !fence())
        return { committed: false, reason: 'revision_conflict' };
    }
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      const current = this.currentRevision();
      if (current !== transaction.expectedRevision) {
        this.db.executeSync('ROLLBACK');
        return { committed: false, reason: 'revision_conflict' };
      }
      if (transaction.changes.length === 0) {
        this.db.executeSync('COMMIT');
        return { committed: true, revision: current };
      }

      const revision = generateId();
      const createdAt = new Date().toISOString();
      for (const [order, change] of transaction.changes.entries()) {
        this.apply(change);
        if (transaction.outbox === 'skip') continue;
        const entityId = change.kind === 'put' ? change.record.id : change.id;
        const outboxId = generateId();
        this.outbox.insert({
          id: outboxId,
          syncOperationId: transaction.outboxOperationIds?.[order] ?? outboxId,
          transactionId: revision,
          transactionOrder: order,
          entityType: change.entity,
          entityId,
          operation: change.kind,
          payloadJson: JSON.stringify(
            change.kind === 'put' ? change.record : { id: change.id },
          ),
          // `outbox === 'enqueue'` is Shared's guarantee that this origin is never `remote`.
          origin: transaction.origin as WorkspaceContentOutboxOrigin,
          createdAt,
        });
      }
      this.insertLocalResourceReleases(
        revision,
        transaction.localResourceReleases ?? [],
        createdAt,
      );
      this.db.executeSync(
        'UPDATE workspace_content_revision SET revision = ? WHERE id = 1',
        [revision],
      );
      this.db.executeSync('COMMIT');
      this.localResourceReleases.request();
      return { committed: true, revision };
    } catch (error) {
      this.db.executeSync('ROLLBACK');
      throw error;
    }
  }

  private insertLocalResourceReleases(
    transactionId: string,
    releases: NonNullable<WorkspaceContentTransaction['localResourceReleases']>,
    createdAt: string,
  ): void {
    const identities = new Set<string>();
    releases.forEach((release, order) => {
      const identity = `${release.messageId}\u0000${release.contentId}`;
      if (
        !release.messageId.trim() ||
        !release.contentId.trim() ||
        identities.has(identity)
      )
        throw new Error(
          'Workspace Content local resource release identity is ambiguous.',
        );
      const hasUri =
        typeof release.uri === 'string' && release.uri.trim().length > 0;
      const hasData =
        typeof release.data === 'string' && release.data.trim().length > 0;
      if (hasUri === hasData)
        throw new Error(
          `Local resource ${release.contentId} must name exactly one byte source.`,
        );
      identities.add(identity);
      this.db.executeSync(
        `INSERT INTO workspace_content_local_resource_releases
          (id, transaction_id, transaction_order, message_id, content_id,
           uri, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${transactionId}:release:${String(order)}`,
          transactionId,
          order,
          release.messageId,
          release.contentId,
          release.uri ?? null,
          release.data ?? null,
          createdAt,
        ],
      );
    });
  }

  async removeMessageHolderWithReceipt(input: {
    readonly messageId: string;
    readonly deletionOperationId: string;
    readonly syncId: string;
    readonly expectedRevision: string;
    readonly expectedPreimage: MessageRecord['local'] | null;
  }): Promise<WorkspaceMessageHolderReceipt> {
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      const prior = this.readHolderReceipt(
        input.messageId,
        input.deletionOperationId,
      );
      if (prior) {
        if (
          prior.syncId !== input.syncId ||
          (stableJson(prior.preimage) !== stableJson(input.expectedPreimage) &&
            stableJson(prior.postimage) !== stableJson(input.expectedPreimage))
        )
          throw new Error(
            `Message ${input.messageId} holder receipt conflicts.`,
          );
        this.db.executeSync('COMMIT');
        return prior;
      }
      if (this.currentRevision() !== input.expectedRevision)
        throw new Error(
          `Message ${input.messageId} changed before holder removal.`,
        );
      const row = rows<MessageRow>(
        this.db,
        `SELECT m.id, m.conversation_id, m.turn_id, m.position, m.role, m.content,
                m.context_json, m.legacy_order_created_at, m.order_token_json,
                l.state_json, m.created_at, m.updated_at
         FROM workspace_content_messages m
         LEFT JOIN workspace_content_local_message_state l ON l.message_id = m.id
         WHERE m.id = ?`,
        [input.messageId],
      )[0];
      if (!row) throw new Error(`Message ${input.messageId} was not found.`);
      const message = messageFromRow(row);
      const content = decodeWorkspaceMessageContent(String(row.content));
      if (
        typeof content === 'string' ||
        !content.some(
          part => part.type !== 'text' && part.contentId === input.syncId,
        )
      )
        throw new Error(
          `Message ${input.messageId} does not own ${input.syncId}.`,
        );
      const current = row.state_json
        ? (parseJson<MessageRecord['local']>(String(row.state_json)) ?? null)
        : null;
      if (stableJson(current) !== stableJson(input.expectedPreimage))
        throw new Error(`Message ${input.messageId} local preimage changed.`);
      const identities =
        projectMobileWorkspaceContentAttachmentByteIdentities(message);
      if (!identities.ok) throw new Error(identities.failure.message);
      const targetIndexes = identities.value.flatMap((identity, index) =>
        identity.contentId === input.syncId ? [index] : [],
      );
      if (targetIndexes.length > 1)
        throw new Error(
          `Message ${input.messageId} has duplicate target holders.`,
        );
      const hadHolder = targetIndexes.length === 1;
      const postimage = hadHolder
        ? {
            ...(current ?? {}),
            contentLocations: (current?.contentLocations ?? []).filter(
              (_, index) => index !== targetIndexes[0],
            ),
          }
        : current;
      const revision = generateId();
      const receipt = this.insertHolderReceipt({
        messageId: input.messageId,
        deletionOperationId: input.deletionOperationId,
        syncId: input.syncId,
        status: hadHolder ? 'removed' : 'absent',
        preimage: input.expectedPreimage,
        postimage,
        postDeleteRevision: revision,
      });
      if (postimage)
        this.db.executeSync(
          `INSERT INTO workspace_content_local_message_state (message_id, state_json)
         VALUES (?, ?) ON CONFLICT(message_id) DO UPDATE SET state_json = excluded.state_json`,
          [input.messageId, JSON.stringify(postimage)],
        );
      else
        this.db.executeSync(
          'DELETE FROM workspace_content_local_message_state WHERE message_id = ?',
          [input.messageId],
        );
      this.db.executeSync(
        'UPDATE workspace_content_revision SET revision = ? WHERE id = 1',
        [revision],
      );
      this.db.executeSync('COMMIT');
      return receipt;
    } catch (cause) {
      this.db.executeSync('ROLLBACK');
      throw cause;
    }
  }

  /** Restore an exact message-local preimage only while its receipt post-state is unchanged. */
  async restoreMessageHolderFromReceipt(input: {
    readonly messageId: string;
    readonly deletionOperationId: string;
    readonly syncId: string;
    readonly preimage: MessageRecord['local'] | null;
  }): Promise<WorkspaceMessageHolderRestoreResult> {
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      const receipt = this.readHolderReceipt(
        input.messageId,
        input.deletionOperationId,
      );
      if (!receipt || receipt.syncId !== input.syncId)
        return this.rollbackHolderRestore(
          `Message ${input.messageId} has no matching receipt.`,
        );
      if (stableJson(receipt.preimage) !== stableJson(input.preimage))
        return this.rollbackHolderRestore(
          `Message ${input.messageId} restore preimage conflicts.`,
        );
      const message = this.db.executeSync(
        'SELECT id FROM workspace_content_messages WHERE id = ?',
        [input.messageId],
      ).rows[0];
      if (!message)
        return this.rollbackHolderRestore(
          `Message ${input.messageId} no longer exists.`,
        );
      const localRow = this.db.executeSync(
        'SELECT state_json FROM workspace_content_local_message_state WHERE message_id = ?',
        [input.messageId],
      ).rows[0];
      const currentLocal = localRow?.state_json
        ? parseJson<MessageRecord['local']>(String(localRow.state_json))
        : null;
      const currentRevision = this.currentRevision();
      if (receipt.restoreRevision) {
        if (stableJson(currentLocal) !== stableJson(receipt.preimage))
          return this.rollbackHolderRestore(
            `Message ${input.messageId} changed after restore.`,
          );
        this.db.executeSync('COMMIT');
        return {
          ok: true,
          status: 'already_restored',
          revision: currentRevision,
        };
      }
      if (stableJson(currentLocal) !== stableJson(receipt.postimage))
        return this.rollbackHolderRestore(
          `Message ${input.messageId} changed after removal.`,
        );
      const restoreRevision = generateId();
      if (receipt.preimage)
        this.db.executeSync(
          `INSERT INTO workspace_content_local_message_state (message_id, state_json)
         VALUES (?, ?) ON CONFLICT(message_id) DO UPDATE SET state_json = excluded.state_json`,
          [input.messageId, JSON.stringify(receipt.preimage)],
        );
      else
        this.db.executeSync(
          'DELETE FROM workspace_content_local_message_state WHERE message_id = ?',
          [input.messageId],
        );
      this.db.executeSync(
        'UPDATE workspace_content_revision SET revision = ? WHERE id = 1',
        [restoreRevision],
      );
      const updated = this.db.executeSync(
        `UPDATE workspace_content_message_holder_receipts SET restore_revision = ?
         WHERE message_id = ? AND deletion_operation_id = ? AND restore_revision IS NULL`,
        [restoreRevision, input.messageId, input.deletionOperationId],
      );
      if (Number(updated.rowsAffected ?? 0) !== 1)
        throw new Error(
          `Message ${input.messageId} restore receipt changed during commit.`,
        );
      this.db.executeSync('COMMIT');
      return { ok: true, status: 'restored', revision: restoreRevision };
    } catch (cause) {
      this.db.executeSync('ROLLBACK');
      throw cause;
    }
  }

  private rollbackHolderRestore(
    message: string,
  ): WorkspaceMessageHolderRestoreResult {
    this.db.executeSync('ROLLBACK');
    return { ok: false, kind: 'conflict', message };
  }

  async withDeletionCommitFence<Result>(input: {
    entity: 'project' | 'conversation';
    entityId: string;
    isCurrentWinner: () => boolean;
    work: () => Promise<Result>;
  }): Promise<Result> {
    const { entity, entityId, isCurrentWinner, work } = input;
    const key = `${entity}\u0000${entityId}`;
    if (this.deletionCommitFences.has(key)) {
      throw new Error(
        `A deletion commit fence already owns ${entity} ${entityId}.`,
      );
    }
    this.deletionCommitFences.set(key, isCurrentWinner);
    try {
      return await work();
    } finally {
      if (this.deletionCommitFences.get(key) === isCurrentWinner) {
        this.deletionCommitFences.delete(key);
      }
    }
  }

  /** Delegates to `MobileWorkspaceContentOutboxStore` - see that file for the claim mechanics. */
  claimOutbox(
    claim: WorkspaceContentOutboxClaim,
  ): Promise<readonly WorkspaceContentOutboxEntry[]> {
    return this.outbox.claimOutbox(claim);
  }

  acknowledgeOutbox(input: {
    readonly entryId: string;
    readonly claimId: string;
    readonly deliveredAt: string;
  }): Promise<WorkspaceContentOutboxTransitionResult> {
    return this.outbox.acknowledgeOutbox(input);
  }

  failOutboxAttempt(input: {
    readonly entryId: string;
    readonly claimId: string;
    readonly failedAt: string;
    readonly retryAt: string;
    readonly message: string;
  }): Promise<WorkspaceContentOutboxTransitionResult> {
    return this.outbox.failOutboxAttempt(input);
  }

  private insertHolderReceipt(
    receipt: WorkspaceMessageHolderReceipt,
  ): WorkspaceMessageHolderReceipt {
    this.db.executeSync(
      `INSERT INTO workspace_content_message_holder_receipts
        (message_id, deletion_operation_id, sync_id, status, preimage_json,
         postimage_json, post_delete_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.messageId,
        receipt.deletionOperationId,
        receipt.syncId,
        receipt.status,
        receipt.preimage ? JSON.stringify(receipt.preimage) : null,
        receipt.postimage ? JSON.stringify(receipt.postimage) : null,
        receipt.postDeleteRevision,
      ],
    );
    return receipt;
  }

  private readHolderReceipt(
    messageId: string,
    deletionOperationId: string,
  ): WorkspaceMessageHolderReceipt | undefined {
    const row = this.db.executeSync(
      `SELECT sync_id, status, preimage_json, postimage_json,
              post_delete_revision, restore_revision
       FROM workspace_content_message_holder_receipts
       WHERE message_id = ? AND deletion_operation_id = ?`,
      [messageId, deletionOperationId],
    ).rows[0];
    if (!row) return undefined;
    if (row.status !== 'removed' && row.status !== 'absent')
      throw new Error(`Message ${messageId} has an invalid holder receipt.`);
    if (
      typeof row.post_delete_revision !== 'string' ||
      row.post_delete_revision === ''
    )
      throw new Error(
        `Message ${messageId} holder receipt has no post-delete revision.`,
      );
    const preimage = row.preimage_json
      ? (parseJson<MessageRecord['local']>(String(row.preimage_json)) ?? null)
      : null;
    const postimage = row.postimage_json
      ? (parseJson<MessageRecord['local']>(String(row.postimage_json)) ?? null)
      : null;
    const portableRow = rows<MessageRow>(
      this.db,
      `SELECT m.id, m.conversation_id, m.turn_id, m.position, m.role, m.content,
              m.context_json, m.legacy_order_created_at, m.order_token_json,
              NULL AS state_json, m.created_at, m.updated_at
       FROM workspace_content_messages m WHERE m.id = ?`,
      [messageId],
    )[0];
    if (!portableRow)
      throw new Error(
        `Message ${messageId} receipt has no persisted portable content.`,
      );
    const portable = messageFromRow(portableRow).portable;
    const ownsTarget = (local: MessageRecord['local'] | null): boolean => {
      const projected = projectMobileWorkspaceContentAttachmentByteIdentities({
        portable,
        local: local ?? undefined,
      });
      if (!projected.ok) throw new Error(projected.failure.message);
      return projected.value.some(
        identity => identity.contentId === row.sync_id,
      );
    };
    const preimageOwnsTarget = ownsTarget(preimage);
    const postimageOwnsTarget = ownsTarget(postimage);
    if (
      row.status === 'removed' &&
      (!preimageOwnsTarget || postimageOwnsTarget)
    )
      throw new Error(
        `Message ${messageId} removed-holder receipt is corrupt.`,
      );
    if (
      row.status === 'absent' &&
      (preimageOwnsTarget ||
        postimageOwnsTarget ||
        stableJson(preimage) !== stableJson(postimage))
    )
      throw new Error(`Message ${messageId} absent-holder receipt is corrupt.`);
    return {
      messageId,
      deletionOperationId,
      syncId: String(row.sync_id),
      status: row.status,
      preimage: row.preimage_json ? preimage : null,
      postimage,
      postDeleteRevision: row.post_delete_revision,
      restoreRevision:
        typeof row.restore_revision === 'string'
          ? row.restore_revision
          : undefined,
    };
  }

  private currentRevision(): string {
    const row = this.db.executeSync(
      'SELECT revision FROM workspace_content_revision WHERE id = 1',
    ).rows[0];
    return typeof row?.revision === 'string' ? row.revision : '0';
  }

  private migrationStatus(): WorkspaceContentMigrationStatus {
    const row = this.db.executeSync(
      `SELECT target_version, status, failure_message
       FROM workspace_content_migration_journal
       ORDER BY target_version DESC LIMIT 1`,
    ).rows[0] as unknown as MigrationRow | undefined;
    if (!row) {
      return {
        phase: 'not_started',
        targetVersion: WORKSPACE_CONTENT_SCHEMA_VERSION,
      };
    }
    if (row.status === 'completed') {
      return { phase: 'current', version: row.target_version };
    }
    if (row.status === 'failed') {
      return {
        phase: 'failed',
        targetVersion: row.target_version,
        message: row.failure_message ?? 'Workspace content migration failed.',
      };
    }
    return {
      phase: 'migrating',
      targetVersion: row.target_version,
      completed: 0,
      total: 1,
    };
  }

  private apply(change: WorkspaceContentChange): void {
    if (change.kind === 'delete') {
      this.applyDelete(change.entity, change.id);
    } else if (change.entity === 'project') {
      this.putProject(change.record);
    } else if (change.entity === 'conversation') {
      this.putConversation(change.record);
    } else if (change.entity === 'message') {
      this.putMessage(change.record);
    } else {
      this.putTurn(change.record);
    }
  }

  private applyDelete(
    entity: WorkspaceContentChange['entity'],
    id: string,
  ): void {
    const tables = {
      project: 'workspace_content_projects',
      conversation: 'workspace_content_conversations',
      message: 'workspace_content_messages',
    } as const;
    if (entity !== 'chat_turns') {
      this.db.executeSync(`DELETE FROM ${tables[entity]} WHERE id = ?`, [id]);
      return;
    }
    for (const row of rows<{ conversation_id: string; turns_json: string }>(
      this.db,
      'SELECT conversation_id, turns_json FROM workspace_content_chat_turns',
    )) {
      const turns = parseJson<ChatTurnRecord[]>(row.turns_json);
      const next = turns.filter(turn => turn.id !== id);
      if (next.length !== turns.length)
        this.writeTurns(row.conversation_id, next);
    }
  }

  private putProject(record: ProjectRecord): void {
    this.db.executeSync(
      `INSERT INTO workspace_content_projects
       (id, name, description, system_prompt, icon, include_memory, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
         system_prompt=excluded.system_prompt, icon=excluded.icon,
         include_memory=excluded.include_memory, created_at=excluded.created_at,
         updated_at=excluded.updated_at`,
      [
        record.id,
        record.name,
        record.description,
        record.systemPrompt,
        record.icon ?? null,
        record.includeMemory ? 1 : 0,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private putConversation(record: ConversationRecord): void {
    this.db.executeSync(
      `INSERT INTO workspace_content_conversations
       (id, title, model_id, project_id, compaction_summary,
        compaction_cutoff_message_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, model_id=excluded.model_id,
         project_id=excluded.project_id, compaction_summary=excluded.compaction_summary,
         compaction_cutoff_message_id=excluded.compaction_cutoff_message_id,
         created_at=excluded.created_at, updated_at=excluded.updated_at`,
      [
        record.id,
        record.title,
        record.modelId,
        record.projectId,
        record.compactionSummary ?? null,
        record.compactionCutoffMessageId ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  private putMessage(record: MessageRecord): void {
    this.db.executeSync(
      `INSERT INTO workspace_content_messages
       (id, conversation_id, turn_id, position, role, content, context_json,
        legacy_order_created_at, order_token_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id,
         turn_id=excluded.turn_id, position=excluded.position, role=excluded.role,
         content=excluded.content, context_json=excluded.context_json,
         legacy_order_created_at=excluded.legacy_order_created_at,
         order_token_json=excluded.order_token_json,
         created_at=excluded.created_at, updated_at=excluded.updated_at`,
      [
        record.id,
        record.conversationId,
        record.turnId,
        record.position,
        record.portable.role,
        encodeWorkspaceMessageContent(record.portable.content),
        record.portable.context
          ? JSON.stringify(record.portable.context)
          : null,
        record.legacyOrder?.createdAt ?? null,
        record.orderToken
          ? serializeMessageOrderToken(record.orderToken)
          : null,
        record.createdAt,
        record.updatedAt,
      ],
    );
    if (record.local) {
      this.db.executeSync(
        `INSERT INTO workspace_content_local_message_state (message_id, state_json)
         VALUES (?, ?)
         ON CONFLICT(message_id) DO UPDATE SET state_json=excluded.state_json`,
        [record.id, JSON.stringify(record.local)],
      );
    } else {
      this.db.executeSync(
        'DELETE FROM workspace_content_local_message_state WHERE message_id = ?',
        [record.id],
      );
    }
  }

  private putTurn(record: ChatTurnRecord): void {
    const row = this.db.executeSync(
      `SELECT turns_json FROM workspace_content_chat_turns
       WHERE conversation_id = ?`,
      [record.conversationId],
    ).rows[0] as TurnRow | undefined;
    const turns = row ? parseJson<ChatTurnRecord[]>(row.turns_json) : [];
    const next = [...turns.filter(turn => turn.id !== record.id), record].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
    this.writeTurns(record.conversationId, next);
  }

  private writeTurns(
    conversationId: string,
    turns: readonly ChatTurnRecord[],
  ): void {
    if (turns.length === 0) {
      this.db.executeSync(
        'DELETE FROM workspace_content_chat_turns WHERE conversation_id = ?',
        [conversationId],
      );
      return;
    }
    const updatedAt = turns.reduce(
      (latest, turn) => (turn.updatedAt > latest ? turn.updatedAt : latest),
      '',
    );
    this.db.executeSync(
      `INSERT INTO workspace_content_chat_turns
       (conversation_id, turns_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET turns_json=excluded.turns_json,
         updated_at=excluded.updated_at`,
      [conversationId, JSON.stringify(turns), updatedAt],
    );
  }
}

let canonicalWorkspaceContentRepository: MobileWorkspaceContentRepository | null = null;

/** The one Mobile repository used by startup migration and the application composition. */
export function getMobileWorkspaceContentRepository(): MobileWorkspaceContentRepository {
  canonicalWorkspaceContentRepository ??= new MobileWorkspaceContentRepository();
  return canonicalWorkspaceContentRepository;
}

function rows<T>(db: DB, statement: string, params?: Scalar[]): T[] {
  return db.executeSync(statement, params).rows as unknown as T[];
}

function projectFromRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    ...(row.icon ? { icon: row.icon } : {}),
    includeMemory: row.include_memory === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function conversationFromRow(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    modelId: row.model_id,
    projectId: row.project_id,
    ...(row.compaction_summary
      ? { compactionSummary: row.compaction_summary }
      : {}),
    ...(row.compaction_cutoff_message_id
      ? { compactionCutoffMessageId: row.compaction_cutoff_message_id }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageFromRow(row: MessageRow): MessageRecord {
  const context = row.context_json
    ? parseJson<MessageRecord['portable']['context']>(row.context_json)
    : undefined;
  const local = row.state_json
    ? parseJson<MessageRecord['local']>(row.state_json)
    : undefined;
  const orderToken = row.order_token_json
    ? parseMessageOrderToken(JSON.parse(row.order_token_json) as unknown)
    : null;
  if (row.order_token_json && !orderToken) {
    throw new Error(`Workspace message ${row.id} has an invalid order token`);
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    position: row.position,
    ...(orderToken ? { orderToken } : {}),
    portable: {
      role: row.role,
      content: decodeWorkspaceMessageContent(row.content),
      ...(context ? { context } : {}),
    },
    ...(row.legacy_order_created_at
      ? {
          legacyOrder: {
            source: 'positionless_sync' as const,
            createdAt: row.legacy_order_created_at,
          },
        }
      : {}),
    ...(local ? { local } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
