import { NativeModules, NativeEventEmitter, Platform, Alert } from 'react-native';
import { BackgroundDownloadInfo, BackgroundDownloadStatus } from '../types';
import logger from '../utils/logger';
import type {
  DownloadParams,
  DownloadProgressEvent, DownloadCompleteEvent, DownloadErrorEvent,
  DownloadProgressCallback, DownloadCompleteCallback, DownloadErrorCallback,
} from './backgroundDownloadTypes';
const { DownloadManagerModule } = NativeModules;

class BackgroundDownloadService {
  private eventEmitter: NativeEventEmitter | null = null;
  private progressListeners: Map<string, DownloadProgressCallback> = new Map();
  private completeListeners: Map<string, DownloadCompleteCallback> = new Map();
  private errorListeners: Map<string, DownloadErrorCallback> = new Map();
  private subscriptions: { remove: () => void }[] = [];
  private isPolling = false;

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

  async retryDownload(downloadId: string): Promise<void> {
    if (!this.isAvailable() || Platform.OS !== 'android') {
      throw new Error('retryDownload is only available on Android');
    }
    await DownloadManagerModule.retryDownload(downloadId);
  }

  async cancelDownload(downloadId: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Background downloads not available on this platform');
    }
    try {
      await DownloadManagerModule.cancelDownload(downloadId);
    } catch (e) {
      logger.log('[BackgroundDownload] cancelDownload failed (bridge may be torn down):', e);
    }
  }

  async getActiveDownloads(): Promise<BackgroundDownloadInfo[]> {
    if (!this.isAvailable()) {
      return [];
    }
    const downloads = await DownloadManagerModule.getActiveDownloads();
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
    params: Pick<DownloadParams, 'url' | 'fileName' | 'modelId' | 'totalBytes' | 'modelType'>;
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
          reject(new Error(err.reason || 'Download failed'));
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
    this.stopProgressPolling();
    this.subscriptions.forEach(sub => sub.remove());
    this.subscriptions = [];
    this.progressListeners.clear();
    this.completeListeners.clear();
    this.errorListeners.clear();
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
    push(this.eventEmitter.addListener('DownloadProgress', (e: DownloadProgressEvent) => {
      this.dispatchToListeners(this.progressListeners, 'progress', e);
    }));
    push(this.eventEmitter.addListener('DownloadComplete', (e: DownloadCompleteEvent) => {
      this.dispatchToListeners(this.completeListeners, 'complete', e);
    }));
    push(this.eventEmitter.addListener('DownloadError', (e: DownloadErrorEvent) => {
      this.dispatchToListeners(this.errorListeners, 'error', e);
    }));
  }
}

export const backgroundDownloadService = new BackgroundDownloadService();
