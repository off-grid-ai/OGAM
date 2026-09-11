import type {
  WorkspaceContentChange,
  WorkspaceContentEntity,
  WorkspaceContentOutboxClaim,
  WorkspaceContentOutboxEntry,
  WorkspaceContentOutboxOrigin,
  WorkspaceContentOutboxTransitionResult,
} from '@offgrid/application';
import type { DB, Scalar } from '@op-engineering/op-sqlite';

type OutboxRow = {
  id: string;
  sync_operation_id: string;
  transaction_id: string;
  transaction_order: number;
  entity_type: WorkspaceContentEntity;
  entity_id: string;
  operation: 'put' | 'delete';
  payload_json: string;
  origin: WorkspaceContentOutboxOrigin;
  created_at: string;
  attempt_count: number;
  claim_id: string | null;
  claimed_at: string | null;
  retry_at: string | null;
};

export interface OutboxInsert {
  readonly id: string;
  readonly syncOperationId: string;
  readonly transactionId: string;
  readonly transactionOrder: number;
  readonly entityType: WorkspaceContentEntity;
  readonly entityId: string;
  readonly operation: 'put' | 'delete';
  readonly payloadJson: string;
  readonly origin: WorkspaceContentOutboxOrigin;
  readonly createdAt: string;
}

/**
 * Mobile SQLite mechanics for the Shared `WorkspaceContentOutboxRepositoryPort` half of the
 * workspace-content contract: durable claim, acknowledgement, and failed-attempt transitions.
 * Split out of `MobileWorkspaceContentRepository` (which composes this by construction, on the
 * same `db` connection so both share one transaction boundary) to keep that file under the
 * project's line-count gate.
 */
export class MobileWorkspaceContentOutboxStore {
  constructor(private readonly db: DB) {}

  /** Runs inside the caller's already-open commit transaction; never opens its own. */
  insert(entry: OutboxInsert): void {
    this.db.executeSync(
      `INSERT INTO workspace_content_outbox
       (id, sync_operation_id, transaction_id, transaction_order, entity_type, entity_id, operation,
        payload_json, origin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.syncOperationId,
        entry.transactionId,
        entry.transactionOrder,
        entry.entityType,
        entry.entityId,
        entry.operation,
        entry.payloadJson,
        entry.origin,
        entry.createdAt,
      ],
    );
  }

  /**
   * Atomically claims due pending entries and stale in-flight claims, in canonical transaction
   * order (row insertion order, which already reflects Shared's commit and change ordering).
   */
  async claimOutbox(
    claim: WorkspaceContentOutboxClaim,
  ): Promise<readonly WorkspaceContentOutboxEntry[]> {
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      const candidates = rows<OutboxRow>(
        this.db,
        `SELECT id, sync_operation_id, transaction_id, transaction_order, entity_type, entity_id, operation,
                payload_json, origin, created_at, attempt_count, claim_id, claimed_at, retry_at
         FROM workspace_content_outbox
         WHERE delivered_at IS NULL
         ORDER BY rowid ASC
         LIMIT ?`,
        [claim.limit],
      );
      const blockedAt = candidates.findIndex(
        row => !outboxEntryIsDue(row, claim),
      );
      const due = candidates.slice(
        0,
        blockedAt === -1 ? candidates.length : blockedAt,
      );
      if (due.length === 0) {
        this.db.executeSync('COMMIT');
        return [];
      }
      const placeholders = due.map(() => '?').join(', ');
      this.db.executeSync(
        `UPDATE workspace_content_outbox
         SET claim_id = ?, claimed_at = ?, attempt_count = attempt_count + 1
         WHERE id IN (${placeholders})`,
        [claim.claimId, claim.claimedAt, ...due.map(row => row.id)],
      );
      this.db.executeSync('COMMIT');
      return due.map(row =>
        outboxEntryFromRow(row, {
          claimId: claim.claimId,
          claimedAt: claim.claimedAt,
          attempt: row.attempt_count + 1,
        }),
      );
    } catch (error) {
      this.db.executeSync('ROLLBACK');
      throw error;
    }
  }

  async acknowledgeOutbox(input: {
    readonly entryId: string;
    readonly claimId: string;
    readonly deliveredAt: string;
  }): Promise<WorkspaceContentOutboxTransitionResult> {
    return this.applyOutboxTransition(
      `UPDATE workspace_content_outbox
       SET delivered_at = ?, claim_id = NULL, claimed_at = NULL
       WHERE id = ? AND claim_id = ? AND delivered_at IS NULL`,
      [input.deliveredAt, input.entryId, input.claimId],
    );
  }

  async failOutboxAttempt(input: {
    readonly entryId: string;
    readonly claimId: string;
    readonly failedAt: string;
    readonly retryAt: string;
    readonly message: string;
  }): Promise<WorkspaceContentOutboxTransitionResult> {
    return this.applyOutboxTransition(
      `UPDATE workspace_content_outbox
       SET claim_id = NULL, claimed_at = NULL, retry_at = ?, last_error = ?
       WHERE id = ? AND claim_id = ? AND delivered_at IS NULL`,
      [input.retryAt, input.message, input.entryId, input.claimId],
    );
  }

  /**
   * Both transitions share one shape: touch exactly the row still holding `claimId`. Zero rows
   * affected means a newer claim (stale-claim recovery, or a second worker) already moved the entry,
   * so this stale worker must not overwrite that newer state.
   */
  private applyOutboxTransition(
    statement: string,
    params: Scalar[],
  ): WorkspaceContentOutboxTransitionResult {
    this.db.executeSync('BEGIN IMMEDIATE');
    try {
      const result = this.db.executeSync(statement, params);
      this.db.executeSync('COMMIT');
      return (result.rowsAffected ?? 0) > 0
        ? { applied: true }
        : { applied: false, reason: 'stale_claim' };
    } catch (error) {
      this.db.executeSync('ROLLBACK');
      throw error;
    }
  }
}

function outboxEntryIsDue(
  row: OutboxRow,
  claim: WorkspaceContentOutboxClaim,
): boolean {
  if (row.claim_id === null)
    return row.retry_at === null || row.retry_at <= claim.claimedAt;
  return row.claimed_at !== null && row.claimed_at <= claim.staleBefore;
}

function rows<T>(db: DB, statement: string, params?: Scalar[]): T[] {
  return db.executeSync(statement, params).rows as unknown as T[];
}

function outboxEntryFromRow(
  row: OutboxRow,
  claimed: {
    readonly claimId: string;
    readonly claimedAt: string;
    readonly attempt: number;
  },
): WorkspaceContentOutboxEntry {
  const change: WorkspaceContentChange =
    row.operation === 'delete'
      ? { kind: 'delete', entity: row.entity_type, id: row.entity_id }
      : ({
          kind: 'put',
          entity: row.entity_type,
          record: JSON.parse(row.payload_json),
        } as WorkspaceContentChange);
  return {
    id: row.id,
    syncOperationId: row.sync_operation_id,
    transactionId: row.transaction_id,
    transactionOrder: row.transaction_order,
    origin: row.origin,
    change,
    createdAt: row.created_at,
    attempt: claimed.attempt,
    claimId: claimed.claimId,
    claimedAt: claimed.claimedAt,
  };
}
