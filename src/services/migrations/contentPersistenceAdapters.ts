import {recoverLegacyAttachmentContent} from '@offgrid/application';
import type { DB } from '@op-engineering/op-sqlite';
import {
  encodeWorkspaceMessageContent,
  openWorkspaceContentDatabase,
  WORKSPACE_CONTENT_SCHEMA_VERSION,
} from '../adapters/workspaceContent/workspaceContentDatabase';
import {
  getMobileWorkspaceContentRepository,
  projectMobileMessageContent,
} from '../adapters/workspaceContent/mobileWorkspaceContentRepository';
import type {
  ContentMigrationTargetFacts,
  ContentMigrationTargetPort,
  ContentRecordCounts,
} from './contentPersistencePreflight';
import {
  storedRecord as record,
  type LegacyContentSnapshot,
} from './legacyContentSource';
import {
  isoTime,
  legacyTurns,
  localMessageState,
  optionalText,
  portableContext,
  stableMessageId,
  text,
} from './legacyMessageProjection';

export { legacyContentSource } from './legacyContentSource';

// Upgrade-migration readers only. The legacy Zustand project and chat stores that wrote these two
// AsyncStorage keys are retired; Workspace Content owns projects, conversations, and messages. These
// keys are still read once, on upgrade, to copy a pre-migration device's records into the canonical
// owner. They are never written here, and nothing reads them at runtime. Remove them only when no
// supported upgrade path can still start from a device that holds them.
const TARGET_VERSION = WORKSPACE_CONTENT_SCHEMA_VERSION;
const ATTACHMENT_RECOVERY_VERSION = 1;

function rowCount(db: DB, table: string): number {
  const row = db.executeSync(`SELECT COUNT(*) AS count FROM ${table}`).rows[0];
  return typeof row?.count === 'number' ? row.count : 0;
}

class MobileContentMigrationTarget implements ContentMigrationTargetPort {
  private readonly db: DB;
  private readonly workspaceContent = getMobileWorkspaceContentRepository();

  constructor() {
    this.db = openWorkspaceContentDatabase();
  }

  async inspect(): Promise<ContentMigrationTargetFacts> {
    const row = this.db.executeSync(
      'SELECT status FROM workspace_content_migration_journal WHERE target_version = ?',
      [TARGET_VERSION],
    ).rows[0];
    const marker =
      row?.status === 'completed'
        ? 'complete'
        : row?.status === 'started' || row?.status === 'failed'
        ? 'partial'
        : 'none';
    const attachmentRecovery = this.db.executeSync(
      `SELECT 1 AS complete FROM workspace_content_legacy_attachment_recovery
       WHERE version = ?`,
      [ATTACHMENT_RECOVERY_VERSION],
    ).rows[0];
    return {
      marker,
      counts: this.counts(),
      attachmentRecoveryComplete: attachmentRecovery?.complete === 1,
    };
  }

  /** Restore attachment identities that an old text-only Sync replay removed after migration. */
  async recoverLegacyAttachments(
    snapshot: LegacyContentSnapshot,
    lifecycle: {
      onProgress(copied: number, total: number): void;
      onCopied(): void;
      onVerified(): void;
    },
  ): Promise<void> {
    const messages = snapshot.conversations.flatMap(conversation => {
      const conversationId = text(conversation.id, 'conversation.id');
      return (Array.isArray(conversation.messages)
        ? conversation.messages
        : []
      ).map((value, index) => ({
        conversationId,
        message: record(value, `conversation.messages[${index}]`),
      }));
    });
    const candidates = messages.filter(({message}) =>
      Array.isArray(message.attachments) && message.attachments.length > 0,
    );
    let inspected = 0;
    for (const {conversationId, message} of candidates) {
      const messageId = stableMessageId(message);
      const currentAtRevision =
        await this.workspaceContent.readMessageAtCurrentRevision(messageId);
      const current = currentAtRevision.message;
      if (
        current &&
        current.conversationId === conversationId &&
        current.portable.role === message.role
      ) {
        const rich = projectMobileMessageContent({
          content: message.content,
          attachments: message.attachments,
        });
        const recovered = recoverLegacyAttachmentContent(
          current.portable.content,
          rich.content,
        );
        if (recovered) {
          const local = {
            ...current.local,
            ...(rich.locations?.length
              ? {contentLocations: rich.locations}
              : {}),
          };
          const committed = await this.workspaceContent.commit({
            expectedRevision: currentAtRevision.revision,
            origin: 'migration',
            outbox: 'enqueue',
            changes: [{
              kind: 'put',
              entity: 'message',
              record: {
                ...current,
                portable: {...current.portable, content: recovered},
                local,
              },
            }],
          });
          if (!committed.committed) {
            throw new Error(
              `Message ${messageId} changed during attachment recovery.`,
            );
          }
        }
      }
      lifecycle.onProgress(++inspected, candidates.length);
    }
    lifecycle.onCopied();
    this.db.executeSync(
      `INSERT OR REPLACE INTO workspace_content_legacy_attachment_recovery
       (version, completed_at) VALUES (?, ?)`,
      [ATTACHMENT_RECOVERY_VERSION, new Date().toISOString()],
    );
    lifecycle.onVerified();
  }

  async replaceWithLegacy(
    snapshot: LegacyContentSnapshot,
    lifecycle: {
      onProgress(copied: number, total: number): void;
      onCopied(): void;
      onVerified(): void;
    },
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    this.db.executeSync(
      `INSERT INTO workspace_content_migration_journal
       (target_version, status, started_at, finished_at, failure_message)
       VALUES (?, 'started', ?, NULL, NULL)
       ON CONFLICT(target_version) DO UPDATE SET status = 'started', started_at = excluded.started_at,
       finished_at = NULL, failure_message = NULL`,
      [TARGET_VERSION, startedAt],
    );

    const total =
      snapshot.projects.length +
      snapshot.conversations.length +
      snapshot.conversations.reduce(
        (sum, conversation) =>
          sum +
          (Array.isArray(conversation.messages)
            ? conversation.messages.length
            : 0),
        0,
      );
    let copied = 0;
    const now = new Date().toISOString();

    try {
      await this.db.transaction(async tx => {
        await tx.execute('DELETE FROM workspace_content_local_message_state');
        await tx.execute('DELETE FROM workspace_content_chat_turns');
        await tx.execute('DELETE FROM workspace_content_messages');
        await tx.execute('DELETE FROM workspace_content_conversations');
        await tx.execute('DELETE FROM workspace_content_projects');

        for (const project of snapshot.projects) {
          await tx.execute(
            `INSERT INTO workspace_content_projects
             (id, name, description, system_prompt, icon, include_memory, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              text(project.id, 'project.id'),
              text(project.name, 'project.name'),
              typeof project.description === 'string'
                ? project.description
                : '',
              typeof project.systemPrompt === 'string'
                ? project.systemPrompt
                : '',
              optionalText(project.icon),
              project.includeMemory === false ? 0 : 1,
              isoTime(project.createdAt, now),
              isoTime(project.updatedAt, now),
            ],
          );
          lifecycle.onProgress(++copied, total);
        }

        for (const conversation of snapshot.conversations) {
          const conversationId = text(conversation.id, 'conversation.id');
          await tx.execute(
            `INSERT INTO workspace_content_conversations
             (id, title, model_id, project_id, compaction_summary,
              compaction_cutoff_message_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
            [
              conversationId,
              typeof conversation.title === 'string' ? conversation.title : '',
              optionalText(conversation.modelId),
              optionalText(conversation.projectId),
              optionalText(conversation.compactionSummary),
              isoTime(conversation.createdAt, now),
              isoTime(conversation.updatedAt, now),
            ],
          );
          lifecycle.onProgress(++copied, total);

          const messages = Array.isArray(conversation.messages)
            ? conversation.messages.map((value, index) =>
                record(value, `conversation.messages[${index}]`),
              )
            : [];
          const { turns, turnIds } = legacyTurns({
            conversation,
            conversationId,
            messages,
            now,
          });
          const stableIds = new Map<string, string>();
          for (const [position, message] of messages.entries()) {
            const localId = text(message.id, 'message.id');
            const stableId = stableMessageId(message);
            stableIds.set(localId, stableId);
            const createdAt = isoTime(message.timestamp, now);
            const rich = projectMobileMessageContent({
              content: message.content,
              ...(message.attachments === undefined
                ? {}
                : { attachments: message.attachments }),
            });
            const local = localMessageState(message, rich.locations);
            await tx.execute(
              `INSERT INTO workspace_content_messages
               (id, conversation_id, turn_id, position, role, content, context_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                stableId,
                conversationId,
                turnIds.get(localId) ?? null,
                position,
                text(message.role, 'message.role'),
                encodeWorkspaceMessageContent(rich.content),
                portableContext(message, `conversation.messages[${position}]`),
                createdAt,
                createdAt,
              ],
            );
            if (Object.keys(local).length > 0) {
              await tx.execute(
                `INSERT INTO workspace_content_local_message_state (message_id, state_json)
                 VALUES (?, ?)`,
                [stableId, JSON.stringify(local)],
              );
            }
            lifecycle.onProgress(++copied, total);
          }
          await tx.execute(
            `INSERT INTO workspace_content_chat_turns
             (conversation_id, turns_json, updated_at) VALUES (?, ?, ?)`,
            [
              conversationId,
              JSON.stringify(turns),
              isoTime(conversation.updatedAt, now),
            ],
          );
          const cutoff = optionalText(conversation.compactionCutoffMessageId);
          if (cutoff) {
            await tx.execute(
              `UPDATE workspace_content_conversations
               SET compaction_cutoff_message_id = ? WHERE id = ?`,
              [stableIds.get(cutoff) ?? cutoff, conversationId],
            );
          }
        }

        lifecycle.onCopied();
        const projectCount = await tx.execute(
          'SELECT COUNT(*) AS count FROM workspace_content_projects',
        );
        const conversationCount = await tx.execute(
          'SELECT COUNT(*) AS count FROM workspace_content_conversations',
        );
        const messageCount = await tx.execute(
          'SELECT COUNT(*) AS count FROM workspace_content_messages',
        );
        const counts = {
          projects:
            typeof projectCount.rows[0]?.count === 'number'
              ? projectCount.rows[0].count
              : 0,
          conversations:
            typeof conversationCount.rows[0]?.count === 'number'
              ? conversationCount.rows[0].count
              : 0,
          messages:
            typeof messageCount.rows[0]?.count === 'number'
              ? messageCount.rows[0].count
              : 0,
        };
        if (
          counts.projects !== snapshot.projects.length ||
          counts.conversations !== snapshot.conversations.length ||
          counts.messages !==
            total - snapshot.projects.length - snapshot.conversations.length
        ) {
          throw new Error(
            'SQLite verification counts do not match the legacy source',
          );
        }
        lifecycle.onVerified();
        await tx.execute(
          `INSERT OR REPLACE INTO workspace_content_legacy_attachment_recovery
           (version, completed_at) VALUES (?, ?)`,
          [ATTACHMENT_RECOVERY_VERSION, new Date().toISOString()],
        );
        await tx.execute(
          `UPDATE workspace_content_migration_journal
           SET status = 'completed', finished_at = ?, failure_message = NULL
           WHERE target_version = ?`,
          [new Date().toISOString(), TARGET_VERSION],
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.executeSync(
        `UPDATE workspace_content_migration_journal
         SET status = 'failed', finished_at = ?, failure_message = ?
         WHERE target_version = ?`,
        [new Date().toISOString(), message, TARGET_VERSION],
      );
      throw error;
    }
  }

  private counts(): ContentRecordCounts {
    return {
      projects: rowCount(this.db, 'workspace_content_projects'),
      conversations: rowCount(this.db, 'workspace_content_conversations'),
      messages: rowCount(this.db, 'workspace_content_messages'),
    };
  }
}

export const contentMigrationTarget = new MobileContentMigrationTarget();
