/* eslint-disable max-lines -- cohesive download admission-control service: the concurrency cap, FIFO queue, slot accounting, native-bridge calls, and event fan-out are one tightly-coupled unit; splitting it would scatter the shared activeIds/startQueue state. */
import { NativeModules, NativeEventEmitter, Platform, Alert } from 'react-native';
import { BackgroundDownloadInfo, BackgroundDownloadStatus } from '../types';
import logger from '../utils/logger';
import { serializeQueue, saveQueuedDownloads } from './queuedDownloadPersistence';
import type {
  DownloadParams,
  DownloadProgressEvent, DownloadCompleteEvent, DownloadErrorEvent,
  DownloadProgressCallback, DownloadCompleteCallback, DownloadErrorCallback,
} from './backgroundDownloadTypes';
const { DownloadManagerModule } = NativeModules;

/**
 * Most concurrent downloads we ever hand to the native layer at once. Firing dozens
 * splits bandwidth across all of them and, with multi-GB models, drove iOS into a
 * freeze (25 concurrent observed on device). Extra starts wait in a FIFO queue and
 * begin as running downloads finish, fail, or are cancelled. Because we never start
 * more than this, the native store never holds more than this either, so a relaunch
 * cannot resume a storm.
 */
const MAX_CONCURRENT_DOWNLOADS = 3;

interface QueuedStart {
  params: DownloadParams;
  /** Stable per-model key, used to coalesce a double-tap on an already-queued model. */
  key: string;
  promise: Promise<BackgroundDownloadInfo>;
  resolve: (info: BackgroundDownloadInfo) => void;
  reject: (err: unknown) => void;
}

class BackgroundDownloadService {
  private eventEmitter: NativeEventEmitter | null = null;
  private progressListeners: Map<string, DownloadProgressCallback> = new Map();
  private completeListeners: Map<string, DownloadCompleteCallback> = new Map();
  private errorListeners: Map<string, DownloadErrorCallback> = new Map();
  private subscriptions: { remove: () => void }[] = [];
  private isPolling = false;
  /** Download ids occupying a concurrency slot — started natively OR reserved mid-start. */
  private activeIds = new Set<string>();
  /** Starts waiting for a free slot, in FIFO order. */
  private startQueue: QueuedStart[] = [];
  /** Monotonic counter for unique in-flight reservation tokens. */
  private startSeq = 0;
  /** Set once cleanup() runs, so a beginDownload() still awaiting the native start can't
   *  re-add its id to the just-cleared activeIds (its release listeners are gone → the
   *  slot would leak permanently). */
  private shutDown = false;

  constructor() {
    if (this.isAvailable()) {
      this.eventEmitter = new NativeEventEmitter(DownloadManagerModule);
      this.setupEventListeners();
    }
  }

  isAvailable(): boolean {
    return DownloadManagerModule != null;
  }

  async startDownload(params: DownloadParams): Promise<BackgroundDownloadInfo> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }
    // A sidecar (e.g. a vision model's mmproj) is a dependent sub-download of a main
    // file — it is NOT admission-controlled and does not occupy a concurrency slot. The
    // cap governs logical model downloads (the mains); the sidecar rides alongside its
    // main. (Counting it consumed a second slot per vision file, so only one file could
    // download at a time.) Start it immediately, uncounted.
    if (params.isSidecar) {
      return this.beginDownload(params, false);
    }
    // Under the cap → start immediately. At the cap → queue and resolve when a slot
    // frees. Callers `await` this and only then attach onComplete/onError to the
    // returned downloadId, so a queued start simply resolves later — listeners still
    // bind to the real download once it actually begins.
    if (this.activeIds.size < MAX_CONCURRENT_DOWNLOADS) {
      return this.beginDownload(params);
    }
    const key = this.keyFor(params);
    const dup = this.startQueue.find((q) => q.key === key);
    if (dup) return dup.promise; // coalesce a double-tap on an already-queued model
    let resolve!: (info: BackgroundDownloadInfo) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<BackgroundDownloadInfo>((res, rej) => { resolve = res; reject = rej; });
    this.startQueue.push({ params, key, promise, resolve, reject });
    this.persistQueue();
    return promise;
  }

  /**
   * Durably persist the SERIALIZABLE projection of the queue (params only — never the
   * promise/resolve/reject) so a queued start survives an app kill. Called on every queue mutation
   * (enqueue / admit-to-start / cancel / cleanup). Fire-and-forget: the write must never block the
   * queue, and a failure is logged, not thrown (see queuedDownloadPersistence).
   */
  private persistQueue(): void {
    saveQueuedDownloads(serializeQueue(this.startQueue)).catch(() => { /* best-effort; adapter logs */ });
  }

  private keyFor(p: DownloadParams): string {
    return p.modelKey ?? p.modelId ?? p.fileName ?? p.url;
  }

  /** Actually start a native download. When `counted` (the default) it occupies one
   *  concurrency slot; an uncounted start (a sidecar) begins immediately and never
   *  touches activeIds, so it neither consumes a slot nor blocks the queue. */
  private async beginDownload(params: DownloadParams, counted = true): Promise<BackgroundDownloadInfo> {
    if (!counted) return this.startNativeDownload(params); // sidecar: no slot bookkeeping
    // Reserve the slot synchronously (before the first await) so a burst of
    // startDownload() calls in the same tick can't all pass the size check and
    // over-admit past the cap.
    const token = `reserve:${++this.startSeq}`;
    this.activeIds.add(token);
    try {
      const info = await this.startNativeDownload(params);
      // Swap the reservation for the real download id (still one slot). If cleanup() ran
      // while we awaited the native start, don't re-add — the release listeners are gone,
      // so this id could never be freed and would leak a slot for the service's life.
      this.activeIds.delete(token);
      if (this.shutDown) { DownloadManagerModule.cancelDownload(info.downloadId).catch(() => {}); return { ...info, status: 'failed' }; }
      this.activeIds.add(info.downloadId);
      return info;
    } catch (e) {
      this.activeIds.delete(token); // free the reservation, let the queue try the next
      this.pump();
      throw e;
    }
  }

  /** The raw native start + BackgroundDownloadInfo mapping — no concurrency accounting.
   *  Sidecars call this directly; the counted path wraps it in slot bookkeeping. */
  private async startNativeDownload(params: DownloadParams): Promise<BackgroundDownloadInfo> {
    // Android 13+: prompt for notification permission so the foreground-service download
    // notification is visible (the download still runs as an FGS if denied). Best-effort.
    if (Platform.OS === 'android' && typeof DownloadManagerModule.requestNotificationPermission === 'function') {
      try { DownloadManagerModule.requestNotificationPermission(); } catch { /* non-fatal */ }
    }
    const result = await DownloadManagerModule.startDownload({
      url: params.url,
      fileName: params.fileName,
      modelId: params.modelId,
      modelKey: params.modelKey,
      modelType: params.modelType ?? 'text',
      quantization: params.quantization,
      combinedTotalBytes: params.combinedTotalBytes ?? 0,
      mmProjDownloadId: params.mmProjDownloadId,
      metadataJson: params.metadataJson,
      totalBytes: params.totalBytes ?? 0,
      sha256: params.sha256,
      hideNotification: params.hideNotification ?? false,
    });
    return {
      downloadId: result.downloadId,
      fileName: result.fileName,
      modelId: result.modelId,
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes: params.totalBytes ?? 0,
      startedAt: Date.now(),
    };
  }

  /** Free a slot when a download reaches a terminal state, and admit queued starts. */
  private release(downloadId: string): void {
    if (this.activeIds.delete(downloadId)) {
      this.pump();
    }
  }

  private pump(): void {
    let admitted = false;
    while (this.activeIds.size < MAX_CONCURRENT_DOWNLOADS && this.startQueue.length > 0) {
      const next = this.startQueue.shift()!;
      admitted = true;
      // beginDownload reserves the slot synchronously, so the loop condition sees the
      // updated size before considering the next queued item.
      this.beginDownload(next.params).then(next.resolve, next.reject);
    }
    // An admitted item leaves the queue → it now has (or is starting) a native row, so it must drop
    // out of the persisted queue projection or a relaunch would re-issue a download that already began.
    if (admitted) this.persistQueue();
  }

  /**
   * Reconcile the concurrency accounting against the native truth and pump the queue.
   *
   * A slot leaks when an id in `activeIds` no longer maps to a live native transfer but
   * never got a terminal event to release it — most notably a vision model's mmproj
   * sidecar, whose separate downloadId reserves a slot here but whose task the native
   * layer folds into the main download's fileTasks (so only the main emits
   * DownloadComplete). Left unfixed, `pump()` keeps seeing the cap as full and the
   * effective concurrency collapses toward 1 (one leak per vision model downloaded).
   *
   * We drop only REAL ids the native active set no longer contains — never a `reserve:`
   * token (a start still mid-flight, before it has a native id). A freshly-started
   * download is already in the native active set by the time startDownload() resolves,
   * so this cannot drop a live start; the worst case (a native poll lagging a terminal
   * event) is at most one extra concurrent download that the next reconcile corrects —
   * strictly better than being wedged at one.
   */
  async reconcileActiveIds(): Promise<void> {
    if (!this.isAvailable() || this.activeIds.size === 0) return;
    let nativeIds: Set<string>;
    try {
      const active = await DownloadManagerModule.getActiveDownloads();
      nativeIds = new Set<string>((active ?? []).map((d: any) => String(d.downloadId ?? d.id)));
    } catch {
      return; // bridge unavailable — leave accounting untouched
    }
    let freed = false;
    for (const id of [...this.activeIds]) {
      if (id.startsWith('reserve:')) continue; // mid-start reservation, no native id yet
      if (!nativeIds.has(id)) {
        this.activeIds.delete(id);
        freed = true;
      }
    }
    if (freed) this.pump();
  }

  /**
   * Count restored downloads against the cap after a relaunch. restore re-attaches to
   * downloads the native layer resumed on its own (they did not go through
   * startDownload this session); without adopting them the cap would admit a fresh
   * batch on top of the resumed ones. Their terminal events then free the slot.
   */
  adoptActive(downloadIds: string[]): void {
    downloadIds.forEach((id) => this.activeIds.add(id));
  }

  /** Number of starts waiting for a slot (for a "queued" UI count). */
  getQueuedCount(): number {
    return this.startQueue.length;
  }

  /**
   * Starts waiting for a slot, projected for the UI so the Download Manager can show
   * them as "Queued". These have no native downloadId yet (they haven't started), so
   * they live only here — the queue's owner is the single source of truth for them.
   */
  getQueuedItems(): Array<{ modelKey: string; modelId: string; fileName: string; modelType: string; totalBytes: number }> {
    return this.startQueue.map((q) => ({
      modelKey: q.key,
      modelId: q.params.modelId,
      fileName: q.params.fileName,
      modelType: q.params.modelType ?? 'text',
      totalBytes: q.params.totalBytes ?? 0,
    }));
  }

  /**
   * Cancel a start that is still waiting for a concurrency slot. A queued start has NO
   * native downloadId yet (it never reached DownloadManagerModule.startDownload), so
   * cancelDownload can't reach it — it lives only here, in startQueue. Remove it and
   * settle its promise as a user cancellation (the same `.cancelled` convention the
   * onError path uses) so the awaiting startDownload() caller cleans up quietly instead
   * of surfacing a "download failed". Returns true if a queued start matched the key.
   */
  cancelQueued(key: string): boolean {
    const idx = this.startQueue.findIndex((q) => q.key === key);
    if (idx === -1) return false;
    const [removed] = this.startQueue.splice(idx, 1);
    this.persistQueue(); // a cancelled queued start must not resurrect on relaunch
    const error = new Error('Download cancelled') as Error & { cancelled?: boolean };
    error.cancelled = true;
    removed.reject(error);
    return true;
  }

  async retryDownload(downloadId: string): Promise<void> {
    if (!this.isAvailable() || Platform.OS !== 'android') {
      throw new Error('retryDownload is only available on Android');
    }
    await DownloadManagerModule.retryDownload(downloadId);
    // The failure that preceded this retry already released the slot (DownloadError ->
    // release). Re-reserve it so the retried transfer counts against the cap and its
    // eventual terminal event pumps the queue; without this, retry runs uncounted
    // (concurrency can exceed the cap) and its completion can't promote a queued start.
    // Set.add is idempotent, so re-reserving an id still present is a no-op.
    this.activeIds.add(downloadId);
  }

  async cancelDownload(downloadId: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }
    // A `queued:<modelKey>` id is a placeholder for a start that is still waiting for a
    // concurrency slot — it has NO native download, and lives only in startQueue. Route it
    // to cancelQueued (keyed by modelKey) so cancelling a *queued* item actually removes it;
    // otherwise the native cancel is a no-op and the download would start later anyway.
    if (String(downloadId).startsWith('queued:')) {
      this.cancelQueued(String(downloadId).slice('queued:'.length));
      return;
    }
    try {
      await DownloadManagerModule.cancelDownload(downloadId);
    } catch (e) {
      logger.log('[BackgroundDownload] cancelDownload failed (bridge may be torn down):', e);
    }
    // Free the concurrency slot and admit the next queued start. Native cancel emits
    // no terminal event, so the slot would otherwise leak.
    this.release(downloadId);
    // Native cancel emits no complete/error event and tears down its observer, so
    // anything awaiting this download via downloadFileTo() would hang forever.
    // Synthesize a cancellation so that promise settles and callers can clean up
    // (e.g. whisperService clears its in-flight progress, the transcription screen
    // stops showing the model as downloading). reasonCode marks it user-cancelled
    // so callers treat it as a cancel, not a download failure.
    this.dispatchToListeners(this.errorListeners, 'error', {
      downloadId,
      fileName: '',
      modelId: '',
      status: 'failed',
      reason: 'Download cancelled',
      reasonCode: 'user_cancelled',
    });
  }

  /**
   * Drop a lingering native download record WITHOUT signalling a cancellation.
   *
   * Used by the idempotent finalize path: when a model is finalized from an
   * already-on-disk file (native move skipped), the stale native record must be purged
   * so restore can't re-adopt and re-finalize it every foreground. Unlike cancelDownload,
   * this must NOT synthesize a DownloadError — the download SUCCEEDED, and the global
   * onAnyError handler would otherwise briefly mark the just-finalized model as failed.
   * It still frees the concurrency slot (native cancel emits no terminal event). Reuses
   * the existing native cancel, so no new native method / contract change is needed.
   */
  async purgeNativeRecord(downloadId: string): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await DownloadManagerModule.cancelDownload(downloadId);
    } catch (e) {
      logger.log('[BackgroundDownload] purgeNativeRecord failed (bridge may be torn down):', e);
    }
    this.release(downloadId);
  }

  async getActiveDownloads(): Promise<BackgroundDownloadInfo[]> {
    if (!this.isAvailable()) {
      return [];
    }
    const downloads = await DownloadManagerModule.getActiveDownloads();
    logger.log(`[WIRE-DOWNLOAD] ${JSON.stringify({ ev: 'getActiveDownloads', downloads })}`); // [WIRE] raw active/queued/parallel download rows (relaunch reconcile)
    return downloads.map((d: any) => ({
      downloadId: d.downloadId ?? d.id,
      fileName: d.fileName,
      modelId: d.modelId,
      status: d.status as BackgroundDownloadStatus,
      bytesDownloaded: d.bytesDownloaded,
      totalBytes: d.totalBytes,
      localUri: d.localUri || undefined,
      startedAt: d.createdAt,
      reason: d.reason || undefined,
      reasonCode: d.reasonCode || undefined,
      // v3 columns
      modelKey: d.modelKey || undefined,
      modelType: d.modelType || 'text',
      quantization: d.quantization || undefined,
      combinedTotalBytes: d.combinedTotalBytes || 0,
      mmProjDownloadId: d.mmProjDownloadId || undefined,
      metadataJson: d.metadataJson || undefined,
      createdAt: d.createdAt,
    }));
  }

  async moveCompletedDownload(downloadId: string, targetPath: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }
    return DownloadManagerModule.moveCompletedDownload(downloadId, targetPath);
  }

  private registerListener<T>(listeners: Map<string, T>, key: string, callback: T): () => void {
    listeners.set(key, callback);
    return () => listeners.delete(key);
  }

  onProgress(downloadId: string, callback: DownloadProgressCallback): () => void {
    return this.registerListener(this.progressListeners, `progress_${downloadId}`, callback);
  }
  onComplete(downloadId: string, callback: DownloadCompleteCallback): () => void {
    return this.registerListener(this.completeListeners, `complete_${downloadId}`, callback);
  }
  onError(downloadId: string, callback: DownloadErrorCallback): () => void {
    return this.registerListener(this.errorListeners, `error_${downloadId}`, callback);
  }
  onAnyProgress(callback: DownloadProgressCallback): () => void {
    return this.registerListener(this.progressListeners, 'progress_all', callback);
  }
  onAnyComplete(callback: DownloadCompleteCallback): () => void {
    return this.registerListener(this.completeListeners, 'complete_all', callback);
  }
  onAnyError(callback: DownloadErrorCallback): () => void {
    return this.registerListener(this.errorListeners, 'error_all', callback);
  }

  startProgressPolling(): void {
    if (!this.isAvailable() || this.isPolling) return;
    this.isPolling = true;
    DownloadManagerModule.startProgressPolling();
  }

  stopProgressPolling(): void {
    if (!this.isAvailable() || !this.isPolling) return;
    this.isPolling = false;
    DownloadManagerModule.stopProgressPolling();
  }

  async isBatteryOptimizationIgnored(): Promise<boolean> {
    if (Platform.OS !== 'android' || !this.isAvailable()) return true;
    try {
      return await DownloadManagerModule.isBatteryOptimizationIgnored();
    } catch {
      return true;
    }
  }

  requestBatteryOptimizationIgnore(): void {
    if (Platform.OS !== 'android' || !this.isAvailable()) return;
    try {
      DownloadManagerModule.requestBatteryOptimizationIgnore();
    } catch (e) {
      logger.log('[BackgroundDownload] requestBatteryOptimizationIgnore failed:', e);
    }
  }

  async checkAndPromptBatteryOptimization(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const ignored = await this.isBatteryOptimizationIgnored();
    if (ignored) return;
    return new Promise<void>(resolve => {
      Alert.alert(
        'Keep downloads running',
        'To prevent Android from pausing large model downloads when your screen is off, allow this app to run without battery restrictions.',
        [
          { text: 'Not now', style: 'cancel', onPress: () => resolve() },
          {
            text: 'Allow',
            onPress: () => {
              this.requestBatteryOptimizationIgnore();
              resolve();
            },
          },
        ],
        { cancelable: false },
      );
    });
  }

  downloadFileTo(opts: {
    params: Pick<DownloadParams, 'url' | 'fileName' | 'modelId' | 'totalBytes' | 'modelType' | 'metadataJson' | 'modelKey'>;
    destPath: string;
    onProgress?: (bytesDownloaded: number, totalBytes: number) => void;
    silent?: boolean;
  }): { downloadIdPromise: Promise<string>; promise: Promise<void> } {
    if (!this.isAvailable()) throw new Error('Background downloads not available on this platform');
    let resolveId!: (id: string) => void;
    let rejectId!: (err: unknown) => void;
    const downloadIdPromise = new Promise<string>((res, rej) => { resolveId = res; rejectId = rej; });

    const promise = (async () => {
      const info = await this.startDownload({
        ...opts.params,
        hideNotification: opts.silent,
      });
      resolveId(info.downloadId);
      await new Promise<void>((resolve, reject) => {
        const removeProgress = this.onProgress(info.downloadId, (event) => {
          opts.onProgress?.(event.bytesDownloaded, event.totalBytes);
        });
        const done = () => { removeProgress(); removeComplete(); removeError(); };
        const removeComplete = this.onComplete(info.downloadId, async () => {
          done();
          try { await this.moveCompletedDownload(info.downloadId, opts.destPath); } catch { /* may already be moved */ }
          resolve();
        });
        const removeError = this.onError(info.downloadId, (err) => {
          done();
          const error = new Error(err.reason || 'Download failed') as Error & { cancelled?: boolean };
          // Let callers distinguish a user cancel from a real failure so they can
          // clean up quietly instead of surfacing a "download failed" error.
          if (err.reasonCode === 'user_cancelled') error.cancelled = true;
          reject(error);
        });
        this.startProgressPolling();
      });
    })();

    promise.catch(err => rejectId(err));
    return { downloadIdPromise, promise };
  }

  async excludeFromBackup(path: string): Promise<boolean> {
    if (!this.isAvailable() || typeof DownloadManagerModule.excludePathFromBackup !== 'function') return false;
    return DownloadManagerModule.excludePathFromBackup(path).catch(() => false);
  }

  cleanup(): void {
    this.shutDown = true;
    this.stopProgressPolling();
    this.subscriptions.forEach(sub => sub.remove());
    this.subscriptions = [];
    this.progressListeners.clear();
    this.completeListeners.clear();
    this.errorListeners.clear();
    // Settle any still-queued starts so awaiting callers don't hang forever.
    this.startQueue.forEach((q) => q.reject(new Error('Download service cleaned up')));
    this.startQueue = [];
    this.activeIds.clear();
  }

  private dispatchToListeners<T extends { downloadId: string }>(
    listeners: Map<string, (e: T) => void>,
    prefix: string,
    event: T,
  ): void {
    listeners.get(`${prefix}_${event.downloadId}`)?.(event);
    listeners.get(`${prefix}_all`)?.(event);
  }

  private setupEventListeners(): void {
    if (!this.eventEmitter) return;
    const push = (s: { remove: () => void }) => this.subscriptions.push(s);
    // [WIRE] raw native download events from-device (progress is throttled to one-per-downloadId to avoid
    // flooding; complete/error always logged). Grounds the download/relaunch adversarial fixtures.
    const __wireSeen = new Set<string>();
    push(this.eventEmitter.addListener('DownloadProgress', (e: DownloadProgressEvent) => {
      const pct = e.totalBytes ? e.bytesDownloaded / e.totalBytes : 0;
      const key = `${e.downloadId}:${Math.floor(pct * 10)}`; // ~10 samples per download
      if (!__wireSeen.has(key)) { __wireSeen.add(key); logger.log(`[WIRE-DOWNLOAD] ${JSON.stringify({ ev: 'progress', ...e })}`); }
      this.dispatchToListeners(this.progressListeners, 'progress', e);
    }));
    push(this.eventEmitter.addListener('DownloadComplete', (e: DownloadCompleteEvent) => {
      logger.log(`[WIRE-DOWNLOAD] ${JSON.stringify({ ev: 'complete', ...e })}`); // [WIRE]
      this.release(e.downloadId);
      this.dispatchToListeners(this.completeListeners, 'complete', e);
    }));
    push(this.eventEmitter.addListener('DownloadError', (e: DownloadErrorEvent) => {
      logger.log(`[WIRE-DOWNLOAD] ${JSON.stringify({ ev: 'error', ...e })}`); // [WIRE]
      this.release(e.downloadId);
      this.dispatchToListeners(this.errorListeners, 'error', e);
    }));
  }
}

export const backgroundDownloadService = new BackgroundDownloadService();
