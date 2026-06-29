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
import {
  DownloadProvider,
  ModelDownload,
  ModelDownloadStatus,
  ModelDownloadType,
} from './types';

type Listener = () => void;
type Op = 'retry' | 'cancel' | 'remove';

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

  /** Register a domain's provider. Re-registering replaces (and re-subscribes). */
  register(provider: DownloadProvider): void {
    this.providerUnsubs.get(provider.modelType)?.();
    this.providers.set(provider.modelType, provider);
    const unsub = provider.subscribe(() => { this.notify(); });
    this.providerUnsubs.set(provider.modelType, unsub);
    logger.log(`[DL-SM] provider registered type=${provider.modelType}`);
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
          (d.error ? ` error="${d.error}"` : ''),
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

  /** Route a control op to the owning provider, gated by the download's capability. */
  private async dispatch(op: Op, id: string): Promise<void> {
    const type = this.typeOf(id);
    const provider = type ? this.providers.get(type) : undefined;
    if (!provider) {
      logger.log(`[DL-SM] ${op} ${id} REFUSED: no provider`);
      return;
    }
    // Capability gate: refuse (log, no-op) rather than calling an unsupported op.
    const download = this.lastList.find(d => d.id === id);
    if (download && !download.capabilities[OP_CAPABILITY[op]]) {
      logger.log(`[DL-SM] ${op} ${id} REFUSED: capability ${OP_CAPABILITY[op]}=false`);
      return;
    }
    logger.log(`[DL-SM] ${op} ${id} → dispatch type=${type}`);
    try {
      await provider[op](id);
    } catch (err) {
      logger.log(`[DL-SM] ${op} ${id} FAILED err=${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    this.notify();
  }

  /** id is provider-scoped `${modelType}:${modelId}` — the prefix is the owner. */
  private typeOf(id: string): ModelDownloadType | undefined {
    const prefix = id.split(':', 1)[0] as ModelDownloadType;
    return this.providers.has(prefix) ? prefix : undefined;
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
    this.providers.clear();
    this.providerUnsubs.clear();
    this.listeners.clear();
    this.lastStatus.clear();
    this.lastList = [];
  }
}

export const modelDownloadService = new ModelDownloadService();
export type { DownloadProvider, ModelDownload, ModelDownloadStatus, ModelDownloadType } from './types';
