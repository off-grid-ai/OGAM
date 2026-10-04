import type {
  ConversationDeletionIntent,
  ConversationDeletionIntentRepositoryPort,
} from '@offgrid/application';
import type { DB } from '@op-engineering/op-sqlite';
import { openWorkspaceContentDatabase } from './workspaceContentDatabase';

type Row = {
  conversation_id: string;
  state: ConversationDeletionIntent['state'];
  phase: ConversationDeletionIntent['phase'];
  image_ids_json: string;
  origin: unknown;
  remote_operation_id: string | null;
  attempt: number;
  updated_at: string;
  last_failure: string | null;
};

const fromRow = (row: Row): ConversationDeletionIntent => {
  const imageIds: unknown = JSON.parse(row.image_ids_json);
  if (!Array.isArray(imageIds) || imageIds.some(id => typeof id !== 'string')) {
    throw new Error(
      `Conversation deletion intent ${row.conversation_id} has invalid image identities.`,
    );
  }
  return {
    conversationId: row.conversation_id,
    origin: intentOrigin(row.origin, row.conversation_id),
    ...(row.remote_operation_id
      ? { remoteOperationId: row.remote_operation_id }
      : {}),
    imageIds,
    state: row.state,
    phase: row.phase,
    attempt: row.attempt,
    updatedAt: row.updated_at,
    ...(row.last_failure === null ? {} : { lastFailure: row.last_failure }),
  };
};

export class MobileConversationDeletionIntentRepository
  implements ConversationDeletionIntentRepositoryPort
{
  constructor(private readonly db: DB = openWorkspaceContentDatabase()) {}

  async read(id: string): Promise<ConversationDeletionIntent | undefined> {
    const row = this.db.executeSync(
      'SELECT * FROM workspace_content_conversation_deletion_intents WHERE conversation_id = ?',
      [id],
    ).rows[0] as Row | undefined;
    return row ? fromRow(row) : undefined;
  }

  async pending(): Promise<readonly ConversationDeletionIntent[]> {
    return (
      this.db.executeSync(
        "SELECT * FROM workspace_content_conversation_deletion_intents WHERE state != 'completed' ORDER BY updated_at, conversation_id",
      ).rows as unknown as Row[]
    ).map(fromRow);
  }

  async save(intent: ConversationDeletionIntent): Promise<void> {
    this.db.executeSync(
      `INSERT INTO workspace_content_conversation_deletion_intents
       (conversation_id, origin, remote_operation_id, state, phase, image_ids_json, attempt, updated_at, last_failure)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET origin=excluded.origin,
       remote_operation_id=excluded.remote_operation_id,
       state=excluded.state, phase=excluded.phase,
       image_ids_json=excluded.image_ids_json, attempt=excluded.attempt,
       updated_at=excluded.updated_at, last_failure=excluded.last_failure`,
      [
        intent.conversationId,
        intentOrigin(intent.origin, intent.conversationId),
        intent.remoteOperationId ?? null,
        intent.state,
        intent.phase,
        JSON.stringify(intent.imageIds),
        intent.attempt,
        intent.updatedAt,
        intent.lastFailure ?? null,
      ],
    );
  }

  async discard(conversationId: string): Promise<void> {
    this.db.executeSync(
      'DELETE FROM workspace_content_conversation_deletion_intents WHERE conversation_id = ?',
      [conversationId],
    );
  }
}

function intentOrigin(value: unknown, id: string): 'local' | 'remote' {
  if (value === 'local' || value === 'remote') return value;
  throw new Error(
    `Conversation deletion intent ${id} has invalid origin ${String(value)}.`,
  );
}
