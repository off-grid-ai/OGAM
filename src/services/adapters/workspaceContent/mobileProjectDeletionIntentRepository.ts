import type {
  ProjectDeletionIntent,
  ProjectDeletionIntentRepositoryPort,
} from '@offgrid/application';
import type { DB } from '@op-engineering/op-sqlite';
import { openWorkspaceContentDatabase } from './workspaceContentDatabase';

type IntentRow = {
  project_id: string;
  state: ProjectDeletionIntent['state'];
  phase: ProjectDeletionIntent['phase'];
  remaining_document_sync_ids_json: string;
  origin: unknown;
  remote_operation_id: string | null;
  attempt: number;
  updated_at: string;
  last_failure: string | null;
};

/** SQLite mechanics for the Shared project-deletion recovery owner. */
export class MobileProjectDeletionIntentRepository
  implements ProjectDeletionIntentRepositoryPort
{
  constructor(private readonly db: DB = openWorkspaceContentDatabase()) {}

  async read(projectId: string): Promise<ProjectDeletionIntent | undefined> {
    const row = this.db.executeSync(
      `SELECT project_id, origin, remote_operation_id, state, phase, remaining_document_sync_ids_json,
              attempt, updated_at, last_failure
       FROM workspace_content_project_deletion_intents WHERE project_id = ?`,
      [projectId],
    ).rows[0] as IntentRow | undefined;
    return row ? intentFromRow(row) : undefined;
  }

  async pending(): Promise<readonly ProjectDeletionIntent[]> {
    return (
      this.db.executeSync(
        `SELECT project_id, origin, remote_operation_id, state, phase, remaining_document_sync_ids_json,
              attempt, updated_at, last_failure
       FROM workspace_content_project_deletion_intents
       WHERE state != 'completed' ORDER BY updated_at ASC, project_id ASC`,
      ).rows as unknown as IntentRow[]
    ).map(intentFromRow);
  }

  async save(intent: ProjectDeletionIntent): Promise<void> {
    this.db.executeSync(
      `INSERT INTO workspace_content_project_deletion_intents
       (project_id, origin, remote_operation_id, state, phase, remaining_document_sync_ids_json,
        attempt, updated_at, last_failure)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         origin=excluded.origin, remote_operation_id=excluded.remote_operation_id,
         state=excluded.state, phase=excluded.phase,
         remaining_document_sync_ids_json=excluded.remaining_document_sync_ids_json,
         attempt=excluded.attempt, updated_at=excluded.updated_at,
         last_failure=excluded.last_failure`,
      [
        intent.projectId,
        intentOrigin(intent.origin, intent.projectId),
        intent.remoteOperationId ?? null,
        intent.state,
        intent.phase,
        JSON.stringify(intent.remainingDocumentSyncIds),
        intent.attempt,
        intent.updatedAt,
        intent.lastFailure ?? null,
      ],
    );
  }

  async discard(projectId: string): Promise<void> {
    this.db.executeSync(
      'DELETE FROM workspace_content_project_deletion_intents WHERE project_id = ?',
      [projectId],
    );
  }
}

function intentFromRow(row: IntentRow): ProjectDeletionIntent {
  const remainingDocumentSyncIds: unknown = JSON.parse(
    row.remaining_document_sync_ids_json,
  );
  if (
    !Array.isArray(remainingDocumentSyncIds) ||
    remainingDocumentSyncIds.some(value => typeof value !== 'string')
  ) {
    throw new Error(
      `Project deletion intent ${row.project_id} has invalid document identities.`,
    );
  }
  return {
    projectId: row.project_id,
    origin: intentOrigin(row.origin, row.project_id),
    ...(row.remote_operation_id
      ? { remoteOperationId: row.remote_operation_id }
      : {}),
    state: row.state,
    phase: row.phase,
    remainingDocumentSyncIds,
    attempt: row.attempt,
    updatedAt: row.updated_at,
    ...(row.last_failure === null ? {} : { lastFailure: row.last_failure }),
  };
}

function intentOrigin(value: unknown, id: string): 'local' | 'remote' {
  if (value === 'local' || value === 'remote') return value;
  throw new Error(
    `Project deletion intent ${id} has invalid origin ${String(value)}.`,
  );
}
