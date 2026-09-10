import {
  createContentMigrationState,
  reduceContentMigrationState,
  type ContentMigrationEvent,
  type ContentMigrationState,
} from './contentMigrationStateMachine';
import {
  contentMigrationTarget,
  legacyContentSource,
} from './contentPersistenceAdapters';
import { preflightContentPersistenceMigration } from './contentPersistencePreflight';
import { generateId } from '../../utils/generateId';

export type ContentMigrationStatus =
  | { readonly phase: 'not-started' }
  | { readonly phase: 'running'; readonly migration: ContentMigrationState }
  | { readonly phase: 'settled'; readonly migration: ContentMigrationState };

type Listener = (status: ContentMigrationStatus) => void;
type WithoutEventMetadata<T> = T extends unknown
  ? Omit<T, 'runId' | 'sequence'>
  : never;
type LocalMigrationEvent = WithoutEventMetadata<ContentMigrationEvent>;

let status: ContentMigrationStatus = { phase: 'not-started' };
let activeRun: Promise<ContentMigrationState> | null = null;
const listeners = new Set<Listener>();

function publish(next: ContentMigrationStatus): void {
  status = next;
  for (const listener of listeners) {
    try {
      listener(status);
    } catch {
      // A presentation subscriber cannot own or interrupt the durable migration.
    }
  }
}

function runId(): string {
  return `content-migration-${generateId()}`;
}

export const contentMigrationStatus = {
  getSnapshot: (): ContentMigrationStatus => status,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** One process-wide, restart-safe migration. Concurrent callers share the same run. */
export function startContentPersistenceMigration(): Promise<ContentMigrationState> {
  if (activeRun !== null) return activeRun;
  activeRun = executeMigration().finally(() => {
    activeRun = null;
  });
  return activeRun;
}

/** Retry only a settled failure that the migration state machine marked as safe to retry. */
export function retryContentPersistenceMigration(): Promise<ContentMigrationState> | null {
  if (
    status.phase !== 'settled' ||
    status.migration.state !== 'failed' ||
    !status.migration.retryEligible
  ) {
    return null;
  }

  if (activeRun !== null) return activeRun;
  return startContentPersistenceMigration();
}

async function executeMigration(): Promise<ContentMigrationState> {
  const id = runId();
  const preflight = await preflightContentPersistenceMigration({
    legacy: legacyContentSource,
    sqlite: contentMigrationTarget,
  });
  let migration = createContentMigrationState(preflight, id);
  publish({
    phase: migration.state === 'completed' || migration.state === 'failed' ? 'settled' : 'running',
    migration,
  });
  if (migration.state !== 'idle') return migration;

  let sequence = 0;
  const send = (event: LocalMigrationEvent) => {
    migration = reduceContentMigrationState(migration, {
      ...event,
      runId: id,
      sequence: ++sequence,
    } as ContentMigrationEvent);
    publish({ phase: 'running', migration });
  };

  try {
    send({ type: 'start' });
    const snapshot = await legacyContentSource.readSnapshot();
    send({ type: 'prepared' });
    const migrate =
      preflight.state === 'needed' &&
      preflight.reason === 'legacy-attachment-recovery'
        ? contentMigrationTarget.recoverLegacyAttachments.bind(
            contentMigrationTarget,
          )
        : contentMigrationTarget.replaceWithLegacy.bind(contentMigrationTarget);
    await migrate(snapshot, {
      onProgress(copied, total) {
        send({ type: 'copy-progress', copied, total });
      },
      onCopied() {
        send({ type: 'copied' });
      },
      onVerified() {
        send({ type: 'verified' });
      },
    });
    send({ type: 'committed' });
  } catch (error) {
    send({
      type: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  publish({ phase: 'settled', migration });
  return migration;
}
