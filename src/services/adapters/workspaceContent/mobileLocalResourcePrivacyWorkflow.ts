import type { DB } from '@op-engineering/op-sqlite';
import type { MobileWorkspaceContentLocalResourceReleaseOwner } from './mobileWorkspaceContentLocalResourceReleaseOwner';

export type MobileLocalResourcePrivacyScope = 'images' | 'all';
export type MobileLocalResourcePrivacyPhase =
  | 'release_settlement'
  | 'canonical_image_deletion'
  | 'owned_directory_cleanup'
  | 'owned_directory_verification';

export type MobileLocalResourcePrivacySnapshot =
  | { readonly status: 'idle' | 'completed' }
  | {
      readonly status: 'running';
      readonly scope: MobileLocalResourcePrivacyScope;
      readonly phase: MobileLocalResourcePrivacyPhase;
    }
  | {
      readonly status: 'failed';
      readonly scope: MobileLocalResourcePrivacyScope;
      readonly phase: MobileLocalResourcePrivacyPhase;
      readonly message: string;
      readonly canRetry: true;
    };

export type MobileLocalResourcePrivacyResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly snapshot: Extract<
        MobileLocalResourcePrivacySnapshot,
        { status: 'failed' }
      >;
    };

export interface MobileOwnedDirectoryPrivacyPort {
  cleanup(input: {
    readonly scope: MobileLocalResourcePrivacyScope;
    readonly operationId: string;
  }): Promise<void>;
  verify(input: {
    readonly scope: MobileLocalResourcePrivacyScope;
    readonly operationId: string;
  }): Promise<void>;
}

export interface MobileCanonicalImagePrivacyPort {
  deleteAll(operationId: string): Promise<void>;
  verifyEmpty(operationId: string): Promise<void>;
}

interface MobileLocalResourcePrivacyWorkflowOptions {
  readonly db: DB;
  readonly releases: MobileWorkspaceContentLocalResourceReleaseOwner;
  readonly directories: () => MobileOwnedDirectoryPrivacyPort | null;
  readonly images: () => MobileCanonicalImagePrivacyPort | null;
  readonly newOperationId: () => string;
}

type IntentRow = {
  scope: MobileLocalResourcePrivacyScope;
  phase: MobileLocalResourcePrivacyPhase;
  operation_id: string;
  last_error: string | null;
};

const CREATE_INTENT = `CREATE TABLE IF NOT EXISTS mobile_local_resource_privacy_intent (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  scope TEXT NOT NULL CHECK (scope IN ('images', 'all')),
  phase TEXT NOT NULL CHECK (phase IN
    ('release_settlement', 'canonical_image_deletion',
     'owned_directory_cleanup', 'owned_directory_verification')),
  operation_id TEXT NOT NULL CHECK (trim(operation_id) != ''),
  updated_at TEXT NOT NULL, last_error TEXT)`;

function ensureIntentSchema(db: DB): void {
  const existing = db.executeSync(
    `SELECT sql FROM sqlite_master
     WHERE type = 'table' AND name = 'mobile_local_resource_privacy_intent'`,
  ).rows[0]?.sql;
  if (typeof existing !== 'string') {
    db.executeSync(CREATE_INTENT);
    return;
  }
  if (existing.includes('canonical_image_deletion')) return;
  db.executeSync('BEGIN IMMEDIATE');
  try {
    db.executeSync(
      `ALTER TABLE mobile_local_resource_privacy_intent
       RENAME TO mobile_local_resource_privacy_intent_m8g`,
    );
    db.executeSync(CREATE_INTENT);
    db.executeSync(
      `INSERT INTO mobile_local_resource_privacy_intent
        (id, scope, phase, operation_id, updated_at, last_error)
       SELECT id, scope,
         CASE WHEN phase = 'release_settlement'
           THEN phase ELSE 'canonical_image_deletion' END,
         operation_id, updated_at, last_error
       FROM mobile_local_resource_privacy_intent_m8g`,
    );
    db.executeSync('DROP TABLE mobile_local_resource_privacy_intent_m8g');
    db.executeSync('COMMIT');
  } catch (cause) {
    db.executeSync('ROLLBACK');
    throw cause;
  }
}

/** One restart-safe owner for Mobile Images/All local-resource privacy settlement. */
export class MobileLocalResourcePrivacyWorkflow {
  private snapshot: MobileLocalResourcePrivacySnapshot = { status: 'idle' };
  private readonly listeners = new Set<() => void>();
  private active: Promise<MobileLocalResourcePrivacyResult> | null = null;
  private suspensionHeld = false;

  private readonly db: DB;
  private readonly releases: MobileWorkspaceContentLocalResourceReleaseOwner;
  private readonly directories: () => MobileOwnedDirectoryPrivacyPort | null;
  private readonly images: () => MobileCanonicalImagePrivacyPort | null;
  private readonly newOperationId: () => string;

  constructor(options: MobileLocalResourcePrivacyWorkflowOptions) {
    this.db = options.db;
    this.releases = options.releases;
    this.directories = options.directories;
    this.images = options.images;
    this.newOperationId = options.newOperationId;
    ensureIntentSchema(this.db);
  }

  getSnapshot = (): MobileLocalResourcePrivacySnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): Promise<MobileLocalResourcePrivacyResult> {
    return this.readIntent() ? this.run() : Promise.resolve({ ok: true });
  }

  execute(
    scope: MobileLocalResourcePrivacyScope,
  ): Promise<MobileLocalResourcePrivacyResult> {
    if (this.active) return this.active;
    const existing = this.readIntent();
    if (existing && existing.scope !== scope) {
      return Promise.resolve(
        this.fail(
          existing,
          'Another local-resource privacy operation must settle first.',
        ),
      );
    }
    if (!existing) {
      this.db.executeSync(
        `INSERT INTO mobile_local_resource_privacy_intent
          (id, scope, phase, operation_id, updated_at)
         VALUES (1, ?, 'release_settlement', ?, ?)`,
        [scope, this.newOperationId(), new Date().toISOString()],
      );
    }
    return this.run();
  }

  retry(): Promise<MobileLocalResourcePrivacyResult> {
    if (!this.readIntent()) return Promise.resolve({ ok: true });
    return this.run();
  }

  private run(): Promise<MobileLocalResourcePrivacyResult> {
    if (this.active) return this.active;
    this.active = this.settle().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  private async settle(): Promise<MobileLocalResourcePrivacyResult> {
    let intent = this.readIntent();
    if (!intent) return { ok: true };
    try {
      await this.holdReleases();
      if (intent.phase === 'release_settlement') {
        this.publish({
          status: 'running',
          scope: intent.scope,
          phase: intent.phase,
        });
        await this.releases.settleAndVerifySuspended();
        this.advance('canonical_image_deletion');
        intent = this.requiredIntent();
      }
      if (intent.phase === 'canonical_image_deletion') {
        this.publish({
          status: 'running',
          scope: intent.scope,
          phase: intent.phase,
        });
        const images = this.images();
        if (!images)
          throw new Error('Canonical image privacy is not configured.');
        await images.deleteAll(intent.operation_id);
        await images.verifyEmpty(intent.operation_id);
        this.advance('owned_directory_cleanup');
        intent = this.requiredIntent();
      }
      const directories = this.directories();
      if (!directories)
        throw new Error('Owned-directory privacy cleanup is not configured.');
      if (intent.phase === 'owned_directory_cleanup') {
        this.publish({
          status: 'running',
          scope: intent.scope,
          phase: intent.phase,
        });
        await directories.cleanup({
          scope: intent.scope,
          operationId: intent.operation_id,
        });
        this.advance('owned_directory_verification');
        intent = this.requiredIntent();
      }
      this.publish({
        status: 'running',
        scope: intent.scope,
        phase: intent.phase,
      });
      await directories.verify({
        scope: intent.scope,
        operationId: intent.operation_id,
      });
      this.db.executeSync(
        'DELETE FROM mobile_local_resource_privacy_intent WHERE id = 1',
      );
      this.releases.resume();
      this.suspensionHeld = false;
      this.publish({ status: 'completed' });
      return { ok: true };
    } catch (cause) {
      intent = this.requiredIntent();
      const message = cause instanceof Error ? cause.message : String(cause);
      this.db.executeSync(
        'UPDATE mobile_local_resource_privacy_intent SET last_error = ?, updated_at = ? WHERE id = 1',
        [message, new Date().toISOString()],
      );
      return this.fail(intent, message);
    }
  }

  private async holdReleases(): Promise<void> {
    if (this.suspensionHeld) return;
    await this.releases.suspend();
    this.suspensionHeld = true;
  }

  private advance(phase: MobileLocalResourcePrivacyPhase): void {
    this.db.executeSync(
      'UPDATE mobile_local_resource_privacy_intent SET phase = ?, last_error = NULL, updated_at = ? WHERE id = 1',
      [phase, new Date().toISOString()],
    );
  }

  private readIntent(): IntentRow | null {
    return (
      (this.db.executeSync(
        `SELECT scope, phase, operation_id, last_error
       FROM mobile_local_resource_privacy_intent WHERE id = 1`,
      ).rows[0] as IntentRow | undefined) ?? null
    );
  }

  private requiredIntent(): IntentRow {
    const intent = this.readIntent();
    if (!intent)
      throw new Error('The durable local-resource privacy intent is missing.');
    return intent;
  }

  private fail(
    intent: IntentRow,
    message: string,
  ): MobileLocalResourcePrivacyResult {
    const snapshot = {
      status: 'failed' as const,
      scope: intent.scope,
      phase: intent.phase,
      message,
      canRetry: true as const,
    };
    this.publish(snapshot);
    return { ok: false, snapshot };
  }

  private publish(snapshot: MobileLocalResourcePrivacySnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A view listener cannot interrupt durable privacy settlement.
      }
    }
  }
}
