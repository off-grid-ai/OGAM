import RNFS from 'react-native-fs';
import logger from '../../utils/logger';
import { getMmProjFileSize } from '../../utils/modelHelpers';
import {
  DownloadedModel,
  ModelFile,
  BackgroundDownloadInfo,
  ONNXImageModel,
  PersistedDownloadInfo,
} from '../../types';
import { APP_CONFIG } from '../../constants';
import { useAppStore } from '../../stores';
import { backgroundDownloadService } from '../backgroundDownloadService';
import {
  BackgroundDownloadMetadataCallback,
  BackgroundDownloadContext,
  DownloadProgressCallback,
  DownloadCompleteCallback,
  DownloadErrorCallback,
} from './types';
import { saveModelsList, loadDownloadedModels } from './storage';
import {
  performBackgroundDownload,
  watchBackgroundDownload,
  syncCompletedBackgroundDownloads,
  getOrphanedTextFiles,
  getOrphanedImageDirs,
  mmProjLocalName,
  performMmProjRepairDownload,
} from './download';
import { syncCompletedImageDownloads as syncCompletedImageDownloadsHelper } from './imageSync';
import { restoreInProgressDownloads } from './restore';
import {
  deleteOrphanedFile as scanDeleteOrphanedFile,
  cleanupMMProjEntries as scanCleanupMMProjEntries,
  scanForUntrackedImageModels as scanUntrackedImage,
  scanForUntrackedTextModels as scanUntrackedText,
  importLocalModel as scanImportLocalModel,
  reconcileFinishedImageDownloads as reconcileImageDownloads,
  ImportLocalModelOpts,
} from './scan';
import {
  addDownloadedImageModel,
  deleteImageModel,
  getDownloadedImageModels,
  getImageModelPath,
  getImageModelsStorageUsed,
} from './imageModelStorage';
import { linkOrphanMmProj } from './mmProjLinker';
import { initializeModelDirectories } from './directories';

class ModelManager {
  private readonly modelsDir: string;
  private readonly imageModelsDir: string;
  private backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null =
    null;
  private readonly backgroundDownloadContext: Map<
    string,
    BackgroundDownloadContext
  > = new Map();

  constructor() {
    this.modelsDir = `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`;
    this.imageModelsDir = `${RNFS.DocumentDirectoryPath}/image_models`;
  }

  async initialize(): Promise<void> {
    return initializeModelDirectories(this.modelsDir, this.imageModelsDir);
  }

  async linkOrphanMmProj(): Promise<void> {
    return linkOrphanMmProj({
      modelsDir: this.modelsDir,
      getModels: () => this.getDownloadedModels(),
      saveModelWithMmproj: (modelId, path) =>
        this.saveModelWithMmproj(modelId, path),
    });
  }

  async getDownloadedModels(): Promise<DownloadedModel[]> {
    try {
      return await loadDownloadedModels(this.modelsDir);
    } catch {
      return [];
    }
  }

  async deleteModel(modelId: string): Promise<void> {
    const models = await this.getDownloadedModels();
    const model = models.find(m => m.id === modelId);

    if (!model) throw new Error('Model not found');
    if (!model.filePath.startsWith(this.modelsDir)) {
      throw new Error('Invalid model path: outside app directory');
    }
    const llamaModel = model.engine === 'llama' ? model : null;
    if (
      llamaModel?.mmProjPath &&
      !llamaModel.mmProjPath.startsWith(this.modelsDir)
    ) {
      throw new Error('Invalid mmproj path: outside app directory');
    }
    await RNFS.unlink(model.filePath);

    // Only delete mmproj if no other models reference it
    if (llamaModel?.mmProjPath) {
      const otherModelsUsingMmproj = models.some(
        m =>
          m.engine === 'llama' &&
          m.id !== modelId &&
          m.mmProjPath === llamaModel.mmProjPath,
      );
      if (!otherModelsUsingMmproj) {
        await RNFS.unlink(llamaModel.mmProjPath).catch(() => {});
      }
    }

    await saveModelsList(models.filter(m => m.id !== modelId));
  }

  async getModelPath(modelId: string): Promise<string | null> {
    const models = await this.getDownloadedModels();
    return models.find(m => m.id === modelId)?.filePath || null;
  }

  async getStorageUsed(): Promise<number> {
    const models = await this.getDownloadedModels();
    return models.reduce(
      (total, model) => total + model.fileSize + getMmProjFileSize(model),
      0,
    );
  }

  async getAvailableStorage(): Promise<number> {
    const freeSpace = await RNFS.getFSInfo();
    return freeSpace.freeSpace;
  }

  async getOrphanedFiles(): Promise<
    Array<{ name: string; path: string; size: number }>
  > {
    await this.initialize();
    try {
      // A completion can move its file into modelsDir before registration has
      // finished. Protect every live context's destination so a storage scan
      // cannot label (and let the user delete) an in-flight/processing model.
      const activeTextPaths = [...this.backgroundDownloadContext.values()]
        .filter(ctx => 'file' in ctx)
        .flatMap(ctx =>
          [ctx.localPath, ctx.mmProjLocalPath].filter(
            (path): path is string => !!path,
          ),
        );
      const textOrphans = await getOrphanedTextFiles(
        this.modelsDir,
        () => this.getDownloadedModels(),
        activeTextPaths,
      );
      const imageOrphans = await getOrphanedImageDirs(this.imageModelsDir, () =>
        this.getDownloadedImageModels(),
      );
      return [...textOrphans, ...imageOrphans];
    } catch {
      return [];
    }
  }

  async deleteOrphanedFile(filePath: string): Promise<void> {
    await scanDeleteOrphanedFile(filePath);
  }

  setBackgroundDownloadMetadataCallback(
    callback: BackgroundDownloadMetadataCallback,
  ): void {
    this.backgroundDownloadMetadataCallback = callback;
  }

  isBackgroundDownloadSupported(): boolean {
    return backgroundDownloadService.isAvailable();
  }

  async downloadModelBackground(
    modelId: string,
    file: ModelFile,
    onProgress?: DownloadProgressCallback,
  ): Promise<BackgroundDownloadInfo> {
    if (!this.isBackgroundDownloadSupported()) {
      throw new Error('Background downloads not supported on this platform');
    }
    await this.initialize();
    return performBackgroundDownload({
      modelId,
      file,
      modelsDir: this.modelsDir,
      backgroundDownloadContext: this.backgroundDownloadContext,
      backgroundDownloadMetadataCallback:
        this.backgroundDownloadMetadataCallback,
      onProgress,
    });
  }

  watchDownload(
    downloadId: string,
    onComplete?: DownloadCompleteCallback,
    onError?: DownloadErrorCallback,
  ): void {
    watchBackgroundDownload({
      downloadId,
      modelsDir: this.modelsDir,
      backgroundDownloadContext: this.backgroundDownloadContext,
      backgroundDownloadMetadataCallback:
        this.backgroundDownloadMetadataCallback,
      onComplete,
      onError,
    });
  }

  // Called after retrying a failed mmproj sidecar. The mmproj error handler
  // sets ctx.mmProjCompleted=true and nulls ctx.mmProjLocalPath so finalization
  // can proceed as text-only. If the user then retries and the native mmproj
  // download restarts, these flags must be reset so watchBackgroundDownload
  // registers a fresh onComplete listener and tryFinalize waits for the sidecar.
  resetMmProjForRetry(downloadId: string): void {
    const ctx = this.backgroundDownloadContext.get(downloadId);
    if (!ctx || !('file' in ctx) || !ctx.mmProjDownloadId) return;
    ctx.mmProjCompleted = false;
    ctx.mmProjCompleteHandled = false;
    if (!ctx.mmProjLocalPath && ctx.file.mmProjFile) {
      ctx.mmProjLocalPath = `${this.modelsDir}/${mmProjLocalName(
        ctx.file.name,
        ctx.file.mmProjFile?.name,
      )}`;
    }
  }

  private async cleanupCancelledTextArtifacts(
    ctx: Extract<BackgroundDownloadContext, { file: ModelFile }>,
  ): Promise<void> {
    const cleanupTargets = [ctx.localPath, ctx.mmProjLocalPath].filter(
      (path): path is string => !!path,
    );

    await Promise.all(
      cleanupTargets.map(async targetPath => {
        try {
          const exists = await RNFS.exists(targetPath);
          if (!exists) return;
          await RNFS.unlink(targetPath);
          logger.warn(
            `[ModelManagerDownload] removed cancelled artifact ${targetPath}`,
          );
        } catch (error) {
          logger.warn(
            `[ModelManagerDownload] failed to remove cancelled artifact ${targetPath}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
    );
  }

  async cancelBackgroundDownload(downloadId: string): Promise<void> {
    if (!this.isBackgroundDownloadSupported()) {
      throw new Error('Background downloads not supported on this platform');
    }
    const ctx = this.backgroundDownloadContext.get(downloadId);
    if (ctx && 'file' in ctx && ctx.mmProjDownloadId) {
      await backgroundDownloadService
        .cancelDownload(ctx.mmProjDownloadId)
        .catch(() => {});
    }

    await backgroundDownloadService.cancelDownload(downloadId);
    if (ctx && 'file' in ctx) {
      await this.cleanupCancelledTextArtifacts(ctx);
    }
    this.backgroundDownloadMetadataCallback?.(downloadId, null);
  }

  async syncBackgroundDownloads(
    persistedDownloads: Record<string, PersistedDownloadInfo>,
    clearDownloadCallback: (downloadId: string) => void,
  ): Promise<DownloadedModel[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    await this.initialize();
    return syncCompletedBackgroundDownloads({
      persistedDownloads,
      modelsDir: this.modelsDir,
      clearDownloadCallback,
    });
  }
  async syncCompletedImageDownloads(
    persistedDownloads: Record<string, PersistedDownloadInfo>,
    clearDownloadCallback: (downloadId: string) => void,
  ): Promise<ONNXImageModel[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    await this.initialize();
    return syncCompletedImageDownloadsHelper({
      imageModelsDir: this.imageModelsDir,
      persistedDownloads,
      clearDownloadCallback,
      getDownloadedImageModels: () => this.getDownloadedImageModels(),
      addDownloadedImageModel: model => this.addDownloadedImageModel(model),
    });
  }

  async restoreInProgressDownloads(
    onProgress?: DownloadProgressCallback,
  ): Promise<string[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    await this.initialize();
    return restoreInProgressDownloads({
      modelsDir: this.modelsDir,
      backgroundDownloadContext: this.backgroundDownloadContext,
      backgroundDownloadMetadataCallback:
        this.backgroundDownloadMetadataCallback,
      onProgress,
    });
  }

  async getActiveBackgroundDownloads(): Promise<BackgroundDownloadInfo[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    return backgroundDownloadService.getActiveDownloads();
  }
  startBackgroundDownloadPolling(): void {
    if (this.isBackgroundDownloadSupported())
      backgroundDownloadService.startProgressPolling();
  }

  stopBackgroundDownloadPolling(): void {
    if (this.isBackgroundDownloadSupported())
      backgroundDownloadService.stopProgressPolling();
  }
  async repairMmProj(
    modelId: string,
    file: ModelFile,
    opts?: {
      onProgress?: DownloadProgressCallback;
      onDownloadIdReady?: (id: string) => void;
    },
  ): Promise<void> {
    if (!file.mmProjFile)
      throw new Error('Model file has no associated mmproj');
    await this.initialize();
    // download.ts owns background-download orchestration: it starts the sidecar,
    // drives the SAME download-store rows the normal download writes (so the existing
    // determinate progress bar lights up during the ~900MB fetch — BUG OD2), moves the
    // file, and tears the transient row down. We just persist the resolved path.
    const resolvedPath = await performMmProjRepairDownload({
      modelId,
      file,
      modelsDir: this.modelsDir,
      ...opts,
    });
    await this.saveModelWithMmproj(`${modelId}/${file.name}`, resolvedPath);
  }

  /**
   * Heal the DURABLE vision flag on a record from the authoritative catalog (the repo ships an mmproj).
   * The old link cleanup wiped isVisionModel on some records, so the Download Manager — which has no catalog —
   * showed them as plain text. Persisting the truth here makes the record the SINGLE source both surfaces
   * read. No-op if already set (so it's safe to call on render/focus). Returns true if it changed anything.
   */
  async markVisionModel(modelId: string): Promise<boolean> {
    const models = await this.getDownloadedModels();
    const target = models.find(m => m.id === modelId);
    if (!target || target.engine !== 'llama' || target.isVisionModel)
      return false;
    const updated = models.map(m =>
      m.id === modelId ? { ...m, isVisionModel: true } : m,
    );
    await saveModelsList(updated);
    useAppStore.getState().setDownloadedModels(updated);
    return true;
  }

  async saveModelWithMmproj(
    modelId: string,
    mmProjPath: string,
  ): Promise<void> {
    const mmProjFileName = mmProjPath.split('/').pop() || mmProjPath;
    const stat = await RNFS.stat(mmProjPath);
    const mmProjFileSize =
      typeof stat.size === 'string'
        ? Number.parseInt(stat.size, 10)
        : stat.size;

    const models = await this.getDownloadedModels();
    const updated = models.map(m =>
      m.id === modelId
        ? {
            ...m,
            mmProjPath,
            mmProjFileName,
            mmProjFileSize,
            isVisionModel: true,
          }
        : m,
    );
    await saveModelsList(updated);
    // Also update the in-memory Zustand store so UI reflects the change immediately.
    useAppStore.getState().setDownloadedModels(updated);
  }

  async clearMmProjLink(modelId: string): Promise<void> {
    const models = await this.getDownloadedModels();
    const updated = models.map(m =>
      m.id === modelId
        ? {
            ...m,
            mmProjPath: undefined,
            mmProjFileName: undefined,
            mmProjFileSize: undefined,
            isVisionModel: false,
          }
        : m,
    );
    await saveModelsList(updated);
    useAppStore.getState().setDownloadedModels(updated);
  }

  async cleanupMMProjEntries(): Promise<number> {
    return scanCleanupMMProjEntries(this.modelsDir);
  }

  async importLocalModel(
    opts: Omit<ImportLocalModelOpts, 'modelsDir'>,
  ): Promise<DownloadedModel> {
    await this.initialize();
    return scanImportLocalModel({ ...opts, modelsDir: this.modelsDir });
  }

  async getDownloadedImageModels(): Promise<ONNXImageModel[]> {
    return getDownloadedImageModels(this.imageModelsDir);
  }

  async addDownloadedImageModel(model: ONNXImageModel): Promise<void> {
    return addDownloadedImageModel(this.imageModelsDir, model);
  }

  async deleteImageModel(modelId: string): Promise<void> {
    return deleteImageModel(this.imageModelsDir, modelId);
  }

  async getImageModelPath(modelId: string): Promise<string | null> {
    return getImageModelPath(this.imageModelsDir, modelId);
  }

  async getImageModelsStorageUsed(): Promise<number> {
    return getImageModelsStorageUsed(this.imageModelsDir);
  }

  getImageModelsDirectory(): string {
    return this.imageModelsDir;
  }

  async scanForUntrackedImageModels(): Promise<ONNXImageModel[]> {
    await this.initialize();
    return scanUntrackedImage({
      imageModelsDir: this.imageModelsDir,
      getImageModels: () => this.getDownloadedImageModels(),
      addImageModel: model => this.addDownloadedImageModel(model),
    });
  }

  async reconcileFinishedImageDownloads(
    activeModelIds: Set<string>,
  ): Promise<ONNXImageModel[]> {
    await this.initialize();
    return reconcileImageDownloads({
      imageModelsDir: this.imageModelsDir,
      getImageModels: () => this.getDownloadedImageModels(),
      addImageModel: model => this.addDownloadedImageModel(model),
      activeModelIds,
    });
  }

  async scanForUntrackedTextModels(): Promise<DownloadedModel[]> {
    await this.initialize();
    return scanUntrackedText(this.modelsDir, () => this.getDownloadedModels());
  }

  async refreshModelLists(): Promise<{
    textModels: DownloadedModel[];
    imageModels: ONNXImageModel[];
  }> {
    await this.scanForUntrackedTextModels();
    await this.scanForUntrackedImageModels();
    return {
      textModels: await this.getDownloadedModels(),
      imageModels: await this.getDownloadedImageModels(),
    };
  }
}

export const modelManager = new ModelManager();
