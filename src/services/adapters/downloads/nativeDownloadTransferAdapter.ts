import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import {
  DownloadAbortedError,
  type DownloadTransferStopOutcome,
  type DownloadTransferPort,
  type DownloadTransferStopDisposition,
} from '@offgrid/models';
import logger from '../../../utils/logger';

const native = NativeModules.DownloadManagerModule;

type Progress = { downloadId: string; bytesDownloaded: number; totalBytes: number };
type Complete = { downloadId: string };
type Failure = { downloadId: string; reason?: string; reasonCode?: string };

interface ListenerSet {
  progress: (event: Progress) => void;
  complete: (event: Complete, completionWon?: boolean) => void;
  completionWon: () => void;
  aborted: () => void;
  error: (event: Failure) => void;
}

interface WaitForTransferInput {
  transferId: string;
  destination: string;
  signal: AbortSignal;
  onProgress: (progress: { bytesDownloaded: number; totalBytes: number }) => void;
}

type TerminalOperation =
  | {
    kind: 'stop';
    disposition: DownloadTransferStopDisposition;
    promise: Promise<{ outcome: DownloadTransferStopOutcome }>;
  }
  | { kind: 'move'; promise: Promise<void> };

export class NativeDownloadTransferAdapter implements DownloadTransferPort {
  private readonly listeners = new Map<string, ListenerSet>();
  private readonly terminalOperations = new Map<string, TerminalOperation>();
  private readonly subscriptions: Array<{ remove(): void }> = [];

  constructor() {
    if (!native) return;
    const emitter = new NativeEventEmitter(native);
    this.subscriptions.push(
      emitter.addListener('DownloadProgress', (event: Progress) => this.listeners.get(event.downloadId)?.progress(event)),
      emitter.addListener('DownloadComplete', (event: Complete) => this.listeners.get(event.downloadId)?.complete(event)),
      emitter.addListener('DownloadError', (event: Failure) => this.listeners.get(event.downloadId)?.error(event)),
    );
  }

  isAvailable(): boolean {
    return Boolean(native && typeof native.startDownload === 'function');
  }

  async start(input: Parameters<DownloadTransferPort['start']>[0]): Promise<{ transferId?: string }> {
    this.assertAvailable();
    if (input.signal.aborted) throw new DownloadAbortedError();
    if (Platform.OS === 'android' && typeof native.requestNotificationPermission === 'function') {
      try { native.requestNotificationPermission(); } catch { /* permission is optional */ }
    }
    const fileName = input.destination.split('/').pop() ?? input.id;
    const parent = input.destination.slice(0, Math.max(0, input.destination.lastIndexOf('/')));
    if (parent) await RNFS.mkdir(parent);
    const result = await native.startDownload({
      url: input.url,
      fileName,
      modelId: input.id,
      modelKey: input.id,
      modelType: 'artifact',
      totalBytes: input.expectedBytes ?? 0,
      hideNotification: false,
      // Shared resumes a paused download with a fresh start(resume: true). Native retained the
      // bytes when the pause cancelled it; this flag is what tells it to continue from them.
      resume: input.resume === true,
    });
    const transferId = String(result.downloadId);
    input.onStarted?.(transferId);
    await this.waitForTransfer({
      transferId,
      destination: input.destination,
      signal: input.signal,
      onProgress: input.onProgress,
    });
    return { transferId };
  }

  async attach(input: Parameters<NonNullable<DownloadTransferPort['attach']>>[0]): Promise<void> {
    this.assertAvailable();
    await this.waitForTransfer(input);
  }

  async isActive(transferId: string): Promise<boolean> {
    if (!native) return false;
    const rows = await native.getActiveDownloads();
    return (rows ?? []).some((row: { downloadId?: string; id?: string; status?: string }) => {
      const id = String(row.downloadId ?? row.id);
      const status = row.status?.toLowerCase();
      return id === transferId && status !== undefined && [
        'pending',
        'queued',
        'running',
        'retrying',
        'waiting_for_network',
        // Native completion still owns a staged file until Shared attaches and promotes it.
        'completed',
      ].includes(status);
    });
  }

  /**
   * Return the native system's durable transfer rows.
   *
   * The shared coordinator owns downloads started in this JS process. The native
   * system remains the source of truth after a process restart, before those
   * handles can be reconstructed. The Mobile composition layer uses this narrow
   * projection to reconcile both sets without moving platform row shapes into
   * shared policy.
   */
  async listActiveDownloads(): Promise<Array<Record<string, unknown>>> {
    if (!native || typeof native.getActiveDownloads !== 'function') return [];
    return (await native.getActiveDownloads()) ?? [];
  }

  async stop(input: {
    transferId: string;
    disposition: DownloadTransferStopDisposition;
  }): Promise<{ outcome: DownloadTransferStopOutcome }> {
    this.assertAvailable();
    logger.log('[ModelDownloadNative] stop requested', input);
    const existing = this.terminalOperations.get(input.transferId);
    if (existing?.kind === 'move') {
      this.listeners.get(input.transferId)?.completionWon();
      await existing.promise;
      return { outcome: 'completed' };
    }
    if (existing?.kind === 'stop') {
      if (existing.disposition !== input.disposition) {
        throw new Error('Transfer already has a different stop disposition');
      }
      return existing.promise;
    }
    if (typeof native.stopDownload !== 'function') {
      throw new Error('Native download stop policy is unavailable');
    }
    const stop = Promise.resolve()
      .then(() => native.stopDownload(input.transferId, input.disposition === 'retain-partial'))
      .then((outcome: unknown): { outcome: DownloadTransferStopOutcome } => {
        if (outcome !== 'stopped' && outcome !== 'completed' && outcome !== 'not-found') {
          throw new Error('Native download stop did not return a terminal verdict');
        }
        // Retain-partial is used for pause and shutdown. If native has already lost the row,
        // the requested terminal state is nevertheless true: no transfer remains and no bytes
        // may be deleted. Report `stopped` to the Shared owner and settle the waiter through the
        // typed abort below. Delete-partial keeps `not-found` so an interactive cancel is refused.
        return {
          outcome: outcome === 'not-found' && input.disposition === 'retain-partial'
            ? 'stopped'
            : outcome,
        };
      });
    const terminal: TerminalOperation = {
      kind: 'stop',
      disposition: input.disposition,
      promise: stop,
    };
    this.terminalOperations.set(input.transferId, terminal);
    try {
      const result = await stop;
      logger.log('[ModelDownloadNative] stop settled', {
        transferId: input.transferId,
        disposition: input.disposition,
        outcome: result.outcome,
      });
      if (this.terminalOperations.get(input.transferId) === terminal) {
        this.terminalOperations.delete(input.transferId);
      }
      if (result.outcome === 'stopped') {
        this.listeners.get(input.transferId)?.aborted();
      } else if (result.outcome === 'completed') {
        this.listeners.get(input.transferId)?.complete({ downloadId: input.transferId }, true);
      } else {
        this.listeners.get(input.transferId)?.error({
          downloadId: input.transferId,
          reason: 'Native transfer was not found',
        });
      }
      return result;
    } finally {
      if (this.terminalOperations.get(input.transferId) === terminal) {
        this.terminalOperations.delete(input.transferId);
      }
    }
  }

  async excludeFromBackup(path: string): Promise<boolean> {
    if (!native || typeof native.excludePathFromBackup !== 'function') return false;
    return native.excludePathFromBackup(path).catch(() => false);
  }

  async isBatteryOptimizationIgnored(): Promise<boolean> {
    if (!native || Platform.OS !== 'android') return true;
    return native.isBatteryOptimizationIgnored?.().catch(() => true) ?? true;
  }

  requestBatteryOptimizationIgnore(): void {
    if (native && Platform.OS === 'android') native.requestBatteryOptimizationIgnore?.();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions.length = 0;
    this.listeners.clear();
    this.terminalOperations.clear();
  }

  private waitForTransfer({
    transferId,
    destination,
    signal,
    onProgress,
  }: WaitForTransferInput): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DownloadAbortedError());
        return;
      }
      let settled = false;
      let abortRequested = false;
      const cleanup = () => {
        this.listeners.delete(transferId);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        if (settled) return;
        abortRequested = true;
        // Shared owns the stop disposition and calls `stop`. An AbortSignal alone cannot say
        // whether bytes must be retained or deleted, so this listener only records the request.
      };
      const aborted = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DownloadAbortedError());
      };
      this.listeners.set(transferId, {
        progress: event => onProgress({
          bytesDownloaded: event.bytesDownloaded,
          totalBytes: event.totalBytes,
        }),
        complete: (_event, completionWon = false) => {
          if (settled || this.terminalOperations.has(transferId)) return;
          if (completionWon) abortRequested = false;
          // Register the terminal operation before invoking the native move so
          // abort and explicit cancellation always observe the same promise.
          const terminalMove = Promise.resolve()
            .then(() => native.moveCompletedDownload(transferId, destination))
            .then(() => undefined);
          const terminal: TerminalOperation = { kind: 'move', promise: terminalMove };
          this.terminalOperations.set(transferId, terminal);
          terminalMove.then(() => {
            if (this.terminalOperations.get(transferId) === terminal) {
              this.terminalOperations.delete(transferId);
            }
            if (settled) return;
            settled = true;
            cleanup();
            if (abortRequested) reject(new DownloadAbortedError());
            else resolve();
          }, cause => {
            if (this.terminalOperations.get(transferId) === terminal) {
              this.terminalOperations.delete(transferId);
            }
            if (settled) return;
            settled = true;
            cleanup();
            reject(cause);
          });
        },
        completionWon: () => { abortRequested = false; },
        aborted,
        error: event => {
          if (settled || this.terminalOperations.has(transferId)) return;
          settled = true;
          cleanup();
          reject(new Error(event.reason ?? 'Download failed'));
        },
      });
      signal.addEventListener('abort', abort, { once: true });
      try {
        native.startProgressPolling();
      } catch (cause) {
        settled = true;
        cleanup();
        reject(cause);
        return;
      }
      Promise.resolve(native.getActiveDownloads()).then((rows: Array<{ downloadId?: string; id?: string; status?: string }> = []) => {
        if (settled) return;
        const row = rows.find(item => String(item.downloadId ?? item.id) === transferId);
        if (row?.status === 'completed') this.listeners.get(transferId)?.complete({ downloadId: transferId });
        else if (row?.status === 'failed') this.listeners.get(transferId)?.error({ downloadId: transferId, reason: 'Download failed' });
      }).catch(cause => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(cause);
      });
    });
  }

  private assertAvailable(): void {
    if (!native) throw new Error('Background downloads not available on this platform');
  }
}

export const nativeDownloadTransferAdapter = new NativeDownloadTransferAdapter();
