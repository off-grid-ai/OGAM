/**
 * ModelDownloadService — the SINGLE owner of model downloads across every type
 * (text / image / stt / tts).
 *
 * Each domain registers a DownloadProvider (see types.ts); the UI talks ONLY to
 * this service. It presents one merged list, routes every control (retry / cancel /
 * remove) to the owning provider by the download's id prefix, and is the one place
 * that observes state transitions.
 *
 * State machine: a download moves through ModelDownloadStatus
 *   queued → downloading → (paused) → completed | error
 * The service does NOT invent the status (the provider reports the real one from
 * its backend); it is the single place that DETECTS and LOGS every transition with
 * a permanent `[DL-SM]` line — so "why is this download stuck / what went wrong?"
 * is always answerable from the logs, never a guess. Same discipline as
 * [MEM-SM]/[IMG-SM]/[FAIL-SM] — these logs stay forever.
 *
 * Capability gaps are data, not branches: an op is refused (logged, no-op) when the
 * download's capabilities say it's unsupported, so a non-cancellable download can
 * never hit a dead Cancel path. No caller ever branches on the concrete model type.
 */
import logger from '../../utils/logger';
import { backgroundDownloadService } from '../backgroundDownloadService';
import type { DownloadParams } from '../backgroundDownloadTypes';
import { queuedUniformId } from './uniformId';
import {
  DownloadProvider,
  ModelDownload,
  ModelDownloadStatus,
  ModelDownloadType,
} from './types';

type Listener = () => void;
type Op = 'retry' | 'cancel' | 'remove';

/** Coalesce a burst of provider changes into one self-list (transition logging). */
const SELF_REFRESH_MS = 300;

/** Which capability flag gates each control op. */
const OP_CAPABILITY: Record<Op, keyof ModelDownload['capabilities']> = {
  retry: 'retry',
  cancel: 'cancel',
  remove: 'remove',
};

class ModelDownloadService {
  private readonly providers = new Map<ModelDownloadType, DownloadProvider>();
  private readonly providerUnsubs = new Map<ModelDownloadType, () => void>();
  private readonly listeners = new Set<Listener>();
  /** Last seen status per download id — the basis for transition detection/logging. */
  private readonly lastStatus = new Map<string, ModelDownloadStatus>();
  /** Cache of the most recent merged list, for id→provider routing + capability checks. */
  private lastList: ModelDownload[] = [];
  private selfRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** Register a domain's provider. Re-registering replaces (and re-subscribes). */
  register(provider: DownloadProvider): void {
    this.providerUnsubs.get(provider.modelType)?.();
    // Re-registering: forget this type's last-seen statuses so the next list logs
    // its downloads as 'new' rather than churning gone/new against stale ids.
    for (const id of [...this.lastStatus.keys()]) {
      if (id.startsWith(`${provider.modelType}:`)) this.lastStatus.delete(id);
    }
    this.providers.set(provider.modelType, provider);
    const unsub = provider.subscribe(() => { this.onProviderChange(); });
    this.providerUnsubs.set(provider.modelType, unsub);
    logger.log(`[DL-SM] provider registered type=${provider.modelType}`);
    this.onProviderChange(); // capture/log this provider's initial state
  }

  /**
   * A provider reported a change. Notify external subscribers AND self-drive a
   * (coalesced) list() so transitions are detected + [DL-SM]-logged even when NO UI
   * is subscribed — closing the "stuck with no transition logged" gap. The provider
   * subscriptions (downloadStore / ttsStore) fire on every progress/status change,
   * so this is event-driven, not interval polling.
   */
  private onProviderChange(): void {
    this.notify();
    // Only self-drive a list() (which does disk scans for completed models) when a
    // consumer is actually observing — otherwise, during heavy downloads, every
    // progress tick would schedule a disk scan for [DL-SM] logging that nothing
    // reads, saturating the JS thread (the "can't switch tabs while downloading"
    // lag). When the Download Manager is open it subscribes, so transitions are
    // still logged where they matter; control ops + reconcile log explicitly too.
    if (this.listeners.size === 0) return;
    if (this.selfRefreshTimer) return; // coalesce a burst
    this.selfRefreshTimer = setTimeout(() => {
      this.selfRefreshTimer = null;
      this.list().catch(() => {});
    }, SELF_REFRESH_MS);
  }

  /**
   * Reconcile after launch: each provider re-aligns persisted state with reality
   * (a download that was in-flight when the app was killed and can't resume becomes
   * an 'error' the user can retry — see DownloadProvider.reconcile). Then we re-list,
   * which logs every resulting [DL-SM] transition. Call once on app start. The
   * iOS/Android resumability difference lives behind the provider's `resumable` flag,
   * so this is platform-agnostic.
   */
  async reconcile(): Promise<void> {
    logger.log(`[DL-SM] reconcile start providers=${[...this.providers.keys()].join(',')}`);
    await Promise.all(
      [...this.providers.values()].map(p =>
        p.reconcile?.().catch(err =>
          logger.log(`[DL-SM] reconcile failed type=${p.modelType} err=${err instanceof Error ? err.message : String(err)}`),
        ),
      ),
    );
    await this.list();
    logger.log('[DL-SM] reconcile done');
  }

  /** Merged, uniform view of every type's downloads. Detects + logs transitions. */
  async list(): Promise<ModelDownload[]> {
    const results = await Promise.all(
      [...this.providers.values()].map(p =>
        p.list().catch(err => {
          logger.log(`[DL-SM] list failed type=${p.modelType} err=${err instanceof Error ? err.message : String(err)}`);
          return [] as ModelDownload[];
        }),
      ),
    );
    const merged = results.flat();
    this.logTransitions(merged);
    this.lastList = merged;
    return merged;
  }

  /** Compare each download's status to what we last saw and log every change. */
  private logTransitions(downloads: ModelDownload[]): void {
    const seen = new Set<string>();
    for (const d of downloads) {
      seen.add(d.id);
      const prev = this.lastStatus.get(d.id);
      if (prev !== d.status) {
        logger.log(
          `[DL-SM] ${d.id} ${prev ?? 'new'} → ${d.status}` +
          ` bytes=${d.bytesDownloaded}/${d.sizeBytes} progress=${(d.progress * 100).toFixed(0)}%` +
          `${d.error ? ` error="${d.error}"` : ''}`,
        );
        this.lastStatus.set(d.id, d.status);
      }
    }
    // Forget downloads that disappeared (removed) so a re-add logs as 'new' again.
    for (const id of [...this.lastStatus.keys()]) {
      if (!seen.has(id)) {
        logger.log(`[DL-SM] ${id} ${this.lastStatus.get(id)} → gone (removed)`);
        this.lastStatus.delete(id);
      }
    }
  }

  retry(id: string): Promise<void> { return this.dispatch('retry', id); }
  cancel(id: string): Promise<void> { return this.dispatch('cancel', id); }
  remove(id: string): Promise<void> { return this.dispatch('remove', id); }

  /**
   * Route a control op to the owning provider, AUTHORITATIVELY: look the download up
   * (refreshing the list if the cache is cold) and route by its own modelType — the
   * service never parses/encodes the id scheme. The capability gate then refuses
   * (log, no-op) an unsupported op, and a not-found id is refused, never a silent
   * fall-through that dispatches.
   */
  private async dispatch(op: Op, id: string): Promise<void> {
    let download = this.lastList.find(d => d.id === id);
    if (!download) { await this.list(); download = this.lastList.find(d => d.id === id); }
    if (!download) {
      // A start still waiting for a concurrency slot is not in any provider's list —
      // it lives only in the queue owner (no native downloadId, no store row yet). A
      // cancel/remove of a "Queued" row must reach it there, or it stays stuck until a
      // slot frees. (retry is meaningless for a not-yet-started item.)
      if ((op === 'cancel' || op === 'remove') && this.cancelQueuedStart(id)) {
        logger.log(`[DL-SM] ${op} ${id} → cancelled queued start`);
        this.notify();
        return;
      }
      logger.log(`[DL-SM] ${op} ${id} REFUSED: not found`);
      return;
    }
    const provider = this.providers.get(download.modelType);
    if (!provider) {
      logger.log(`[DL-SM] ${op} ${id} REFUSED: no provider for type=${download.modelType}`);
      return;
    }
    if (!download.capabilities[OP_CAPABILITY[op]]) {
      logger.log(`[DL-SM] ${op} ${id} REFUSED: capability ${OP_CAPABILITY[op]}=false`);
      return;
    }
    logger.log(`[DL-SM] ${op} ${id} → dispatch type=${download.modelType}`);
    try {
      await provider[op](id);
    } catch (err) {
      logger.log(`[DL-SM] ${op} ${id} FAILED err=${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    this.notify();
  }

  /**
   * Match a uniform id against the queue owner's waiting starts and cancel the one that
   * shares it. The queue is keyed by the platform-level modelKey (which knows nothing
   * about the uniform-id scheme), so the mapping is owned HERE — the same uniformDownloadId
   * the providers' list() and the View's dispatch use, so queued and started rows route
   * identically. Returns true if a queued start was cancelled.
   */
  private cancelQueuedStart(id: string): boolean {
    const queued = backgroundDownloadService
      .getQueuedItems()
      .find(q => queuedUniformId({ modelType: q.modelType as ModelDownloadType, modelId: q.modelId, modelKey: q.modelKey }) === id);
    return queued ? backgroundDownloadService.cancelQueued(queued.modelKey) : false;
  }

  /**
   * Re-issue a QUEUED start (from its persisted params) after a relaunch, routing to the owning
   * provider by `params.modelType` — the service never branches on the concrete type. Refuses (logs,
   * no-op) if the type has no provider or the provider can't re-issue. Used by restoreQueuedDownloads().
   */
  async reissue(params: DownloadParams): Promise<void> {
    const type = (params.modelType ?? 'text') as ModelDownloadType;
    const provider = this.providers.get(type);
    if (!provider?.reissue) {
      logger.log(`[DL-SM] reissue REFUSED: no reissue for type=${type}`);
      return;
    }
    const idLabel = params.modelKey ?? params.modelId;
    logger.log(`[DL-SM] reissue ${type}:${idLabel} → dispatch`);
    await provider.reissue(params);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** Test helper. */
  _reset(): void {
    for (const unsub of this.providerUnsubs.values()) unsub();
    if (this.selfRefreshTimer) { clearTimeout(this.selfRefreshTimer); this.selfRefreshTimer = null; }
    this.providers.clear();
    this.providerUnsubs.clear();
    this.listeners.clear();
    this.lastStatus.clear();
    this.lastList = [];
  }
}

export const modelDownloadService = new ModelDownloadService();
;
