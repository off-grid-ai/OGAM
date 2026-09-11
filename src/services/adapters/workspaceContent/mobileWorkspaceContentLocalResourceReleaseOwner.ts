import RNFS from 'react-native-fs';
import type { DB } from '@op-engineering/op-sqlite';
import logger from '../../../utils/logger';
import {
  deleteConfinedRegularFile,
  type AppOwnedFileRoot,
} from '../native/confinedRegularFileDeletion';

type ReleaseRow = { id: string; uri: string | null; data: string | null };

const roots = (): ReadonlyArray<readonly [AppOwnedFileRoot, string]> => {
  const candidates: ReadonlyArray<
    readonly [AppOwnedFileRoot, string | undefined]
  > = [
    ['documents', RNFS.DocumentDirectoryPath] as const,
    ['cache', RNFS.CachesDirectoryPath] as const,
    ['temporary', RNFS.TemporaryDirectoryPath] as const,
  ];
  return candidates.filter(
    (entry): entry is readonly [AppOwnedFileRoot, string] =>
      typeof entry[1] === 'string' && entry[1].length > 0,
  );
};

function ownedPath(uri: string): { path: string; root: AppOwnedFileRoot } {
  let candidate: string;
  try {
    candidate = decodeURIComponent(
      uri.startsWith('file://') ? uri.slice(7) : uri,
    );
  } catch {
    throw new Error('Local resource URI is not valid UTF-8.');
  }
  if (
    !candidate.startsWith('/') ||
    candidate.includes('/../') ||
    candidate.endsWith('/..')
  )
    throw new Error('Local resource path is not a confined absolute path.');
  const ownedRoot = roots().find(([, root]) =>
    candidate.startsWith(`${root.replace(/\/$/, '')}/`),
  );
  if (!ownedRoot)
    throw new Error('Local resource path is outside Mobile-owned storage.');
  return {
    path: candidate,
    root: ownedRoot[0],
  };
}

/** Serialized post-commit byte settlement for Shared S19 release intents. */
export class MobileWorkspaceContentLocalResourceReleaseOwner {
  private active: Promise<void> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private suspensions = 0;

  constructor(private readonly db: DB) {}

  request(): void {
    this.drain().catch(cause =>
      logger.error(
        '[WorkspaceContent] Local resource release drain failed.',
        cause,
      ),
    );
  }

  start(): Promise<void> {
    this.running = true;
    return this.drain();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearRetry();
    await this.active?.catch(() => undefined);
  }

  async suspend(): Promise<void> {
    this.suspensions += 1;
    this.clearRetry();
    await this.active?.catch(() => undefined);
  }

  /** Settle and prove the complete durable queue while an exclusive privacy hold is active. */
  async settleAndVerifySuspended(): Promise<void> {
    if (this.suspensions === 0)
      throw new Error('Local resource release settlement is not suspended.');
    if (this.active) await this.active;
    this.active = this.drainOnce().finally(() => {
      this.active = null;
    });
    await this.active;
    const residue = this.db.executeSync(
      `SELECT id, last_error FROM workspace_content_local_resource_releases
       ORDER BY transaction_id, transaction_order LIMIT 1`,
    ).rows[0];
    if (residue) {
      const detail =
        typeof residue.last_error === 'string' ? `: ${residue.last_error}` : '';
      throw new Error(
        `Local resource release ${String(residue.id)} remains${detail}`,
      );
    }
  }

  resume(): void {
    if (this.suspensions > 0) this.suspensions -= 1;
    this.request();
  }

  private drain(): Promise<void> {
    if (!this.running || this.suspensions > 0) return Promise.resolve();
    if (this.active) return this.active;
    this.active = this.drainOnce().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  private async drainOnce(): Promise<void> {
    let retained = false;
    const rows = this.db.executeSync(
      `SELECT id, uri, data FROM workspace_content_local_resource_releases
       ORDER BY transaction_id, transaction_order`,
    ).rows as unknown as ReleaseRow[];
    for (const row of rows) {
      try {
        await this.settle(row);
      } catch (cause) {
        retained = true;
        const message = cause instanceof Error ? cause.message : String(cause);
        this.db.executeSync(
          `UPDATE workspace_content_local_resource_releases
           SET attempt_count = attempt_count + 1, last_error = ? WHERE id = ?`,
          [message, row.id],
        );
        logger.warn(
          `[WorkspaceContent] Local resource ${row.id} retained: ${message}`,
        );
      }
    }
    if (retained && this.running && this.suspensions === 0 && !this.retry) {
      this.retry = setTimeout(() => {
        this.retry = null;
        this.request();
      }, 2_000);
    }
  }

  private async settle(row: ReleaseRow): Promise<void> {
    if ((row.uri === null) === (row.data === null))
      throw new Error('Local resource release has an ambiguous byte source.');
    if (row.uri !== null) {
      const target = ownedPath(row.uri);
      const outcome = await deleteConfinedRegularFile({
        root: target.root,
        expectedPath: target.path,
        operationId: row.id,
      });
      if (outcome.status === 'refused')
        throw new Error(`${outcome.code}: ${outcome.message}`);
    }
    const deleted = this.db.executeSync(
      `DELETE FROM workspace_content_local_resource_releases
       WHERE id = ? AND uri IS ? AND data IS ?`,
      [row.id, row.uri, row.data],
    );
    if (Number(deleted.rowsAffected ?? 0) !== 1)
      throw new Error('Local resource release changed during settlement.');
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }
}
