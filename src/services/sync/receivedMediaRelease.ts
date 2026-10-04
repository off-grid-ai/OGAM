/**
 * The one seam through which a NON-sync feature may ask the Shared File owner to release bytes it
 * received.
 *
 * Received media has exactly one byte owner: the Shared File coordinator and its staged/committed
 * rollback. Features like project/gallery cleanup hold metadata that dies with a project, but they
 * must never unlink a received file themselves — a second owner would race that rollback. So they
 * ask, by stable content identity (the file this device actually kept), and the owner decides.
 *
 * The slot lives here in `src` because `pro/` is an optional submodule that `src` must not import.
 * `pro/sync` fills it at start-up; when Pro is absent nothing is registered and callers see
 * `undefined`, which is the honest "no owner is present to release this" answer.
 */

/** How a caller names received bytes without knowing the sync identity space. */
export interface ReceivedMediaIdentity {
  /** The on-device path the caller holds for the file. */
  readonly path: string;
}

export type ReceivedMediaReleaseOutcome =
  /** The owner recognised the bytes and recorded the release. */
  | 'released'
  /**
   * The release is SETTLED with nothing left to do: no durable received record claims these bytes
   * AND the confined file they name is proven absent. This is the only honest way to end a retry
   * for bytes a previous release (or a peer) already removed, so a caller may drop its intent.
   */
  | 'already_released'
  | 'fenced'
  /**
   * The owner cannot account for these bytes: no record claims them and their absence is NOT
   * proven — an unconfined path, or a file that is still on disk. Ownership is unknown while
   * bytes exist, so this stays a durable failure and the caller must keep its intent.
   */
  | 'not_owned';

export interface ReceivedMediaReleasePort {
  release(
    identity: ReceivedMediaIdentity,
    commitFence?: import('@offgrid/application').DeletionCleanupContinuation,
  ): Promise<ReceivedMediaReleaseOutcome>;
}

export type ReceivedMediaReleaseDrainPass =
  | 'settled'
  | 'retry'
  | 'owner_absent';

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 60_000;

/** One bounded scheduler for the durable admission drain. It owns no release facts. */
export class ReceivedMediaReleaseDrainScheduler {
  private active: Promise<void> | undefined;
  private requested = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelayMs = INITIAL_RETRY_DELAY_MS;

  constructor(
    private readonly runPass: () => Promise<ReceivedMediaReleaseDrainPass>,
    private readonly onFailure: (cause: unknown) => void,
  ) {}

  request(): void {
    if (this.active) {
      this.requested = true;
      return;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.requested = false;
    const current = this.runPass()
      .then(outcome => {
        if (outcome === 'settled') this.resetBackoff();
        if (outcome === 'retry') this.scheduleRetry();
      })
      .catch(cause => {
        this.onFailure(cause);
        this.scheduleRetry();
      })
      .finally(() => {
        if (this.active === current) this.active = undefined;
        if (this.requested) this.request();
      });
    this.active = current;
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.request();
    }, delay);
  }

  private resetBackoff(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.retryDelayMs = INITIAL_RETRY_DELAY_MS;
  }
}

let port: ReceivedMediaReleasePort | undefined;

/** Called by the Shared File owner once, at start-up. */
export function configureReceivedMediaRelease(
  next: ReceivedMediaReleasePort | undefined,
): void {
  port = next;
}

/** The registered owner, or `undefined` when no Shared File owner is running. */
export function receivedMediaRelease(): ReceivedMediaReleasePort | undefined {
  return port;
}
