/**
 * Model download abstraction — the single uniform contract for downloading ANY
 * model type (text / image / stt / tts).
 *
 * Today each type downloads its own way (text+image-zip via the robust native
 * backgroundDownloadService; image multi-file via an in-process loop; STT via
 * downloadFileTo/RNFS; TTS via executorch's own fetcher) and the Download Manager
 * branches per type to list/cancel/delete them. That per-type wiring is why each
 * type breaks differently and downloads "get stuck for days".
 *
 * This is the seam: every domain exposes a `DownloadProvider`; the UI talks ONLY
 * to `ModelDownloadService`, which presents one list and one set of controls and
 * dispatches to the right provider by `modelType`. Adding a model type = register
 * a provider; the UI never changes.
 *
 * See docs/design/MODEL_DOWNLOAD_SERVICE.md.
 */

export type ModelDownloadType = 'text' | 'image' | 'stt' | 'tts';

export type ModelDownloadStatus =
  | 'queued'        // accepted, not yet transferring
  | 'downloading'   // bytes moving
  | 'paused'        // interrupted (e.g. waiting for network / app was killed) — resumable
  | 'completed'     // on disk + registered in its domain store
  | 'error';        // failed; retryable

/**
 * What a given download supports RIGHT NOW. This is how the abstraction handles
 * capability gaps gracefully instead of letting them become bugs (Liskov +
 * interface segregation): a backend that can't do something declares it here, the
 * UI renders controls from these flags (a non-cancellable download simply shows no
 * Cancel affordance — never a dead button), and the service refuses to dispatch an
 * op a download doesn't support. No caller ever branches on the concrete type.
 *
 * Examples of gaps modeled, not stubbed:
 *  - Kokoro (executorch fetcher) → `cancel: false` (no abort API).
 *  - Kokoro → `determinateProgress: false` (only a 0..1 fraction, no byte counts) →
 *    UI shows a percentage/spinner, not "X MB / Y MB".
 *  - the STT RNFS path → `resumable: false` (dies with the app) → a 'paused' such
 *    download surfaces as needing a manual retry, not a phantom "resuming".
 */
interface DownloadCapabilities {
  cancel: boolean;     // can an in-progress transfer be aborted + cleaned up?
  retry: boolean;      // can a failed/stuck download be restarted?
  remove: boolean;     // can the on-disk model be deleted?
  resumable: boolean;  // does it survive an app kill and continue on its own?
  determinateProgress: boolean; // are byteDownloaded/sizeBytes real (vs fraction-only)?
}

/** One uniform view of a model's download, independent of type or backend. */
export interface ModelDownload {
  /** Stable unique key for this download (provider-scoped, e.g. `${modelType}:${modelId}`). */
  id: string;
  modelType: ModelDownloadType;
  /** Human label shown in the UI. */
  name: string;
  /** Total expected bytes (0 only when `capabilities.determinateProgress` is false). */
  sizeBytes: number;
  bytesDownloaded: number;
  /** 0..1. Fraction-only backends (Kokoro) set bytesDownloaded from progress*sizeBytes. */
  progress: number;
  status: ModelDownloadStatus;
  /** What this download supports — the UI reads this; it never branches on modelType. */
  capabilities: DownloadCapabilities;
  /** Final on-disk path once completed (when the provider can give one). */
  filePath?: string;
  /** Human-readable failure reason when status === 'error'. */
  error?: string;
}

/**
 * Each model domain implements ONE provider. It knows how to enumerate, control,
 * and observe its own downloads — but exposes them through the uniform shape so
 * the service (and the UI) never branch on the concrete type. A provider may be
 * backed by the native background service, a store, or an external fetcher; that
 * detail stays inside the provider.
 */
export interface DownloadProvider {
  readonly modelType: ModelDownloadType;

  /** Current downloads for this type — both in-progress and completed. */
  list(): Promise<ModelDownload[]>;

  /** Cancel an in-progress download (and clean up partial files). */
  cancel(id: string): Promise<void>;

  /** Retry a failed/stuck download. */
  retry(id: string): Promise<void>;

  /** Delete a completed (or partially-downloaded) model from disk + its store. */
  remove(id: string): Promise<void>;

  /**
   * Subscribe to "something changed" for this type so the service can re-list.
   * Return an unsubscribe fn. A provider with no reactive source (e.g. an external
   * fetcher) may return a no-op and rely on the service's polling fallback.
   */
  subscribe(onChange: () => void): () => void;

  /**
   * Reconcile persisted download state with reality after a possible app kill.
   * Called once on launch by ModelDownloadService.reconcile(). A download that was
   * `downloading` when the app was killed and whose backend is NOT `resumable`
   * (iOS URLSession dies on app-kill; the STT RNFS path dies) is stranded: the
   * provider must move it to `error` ("interrupted — retry") so it surfaces as
   * needing a manual retry, NEVER a phantom "downloading"/"resuming" that hangs
   * forever. A `resumable` backend (Android WorkManager) instead reports the
   * genuinely-continuing download. Optional: a provider with no persisted in-flight
   * state can omit it.
   */
  reconcile?(): Promise<void>;

  /**
   * Re-issue a QUEUED start that never began before an app kill, from its persisted DownloadParams.
   * A queued item had no native row (it was waiting for a concurrency slot), so hydrate can't recover
   * it; restoreQueuedDownloads() replays it through THIS — which must go through the SAME real start
   * path the UI uses (creating the `pending` store row + completion watch), NOT a bare
   * backgroundDownloadService.startDownload (that skips the store row + watch). Reconstructs the
   * provider's domain input from params and calls its own start. Optional: a provider whose type is
   * never admission-controlled/queued can omit it. `params` is passed as the shared shape so the
   * service never branches on the concrete type.
   */
  reissue?(params: import('../backgroundDownloadTypes').DownloadParams): Promise<void>;
}
