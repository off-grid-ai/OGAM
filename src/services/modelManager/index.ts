import { videoModelsDirectory } from '../videoModelFiles';
import RNFS from 'react-native-fs';
import logger from '../../utils/logger';
import { getMmProjFileSize } from '../../utils/modelHelpers';
import { DownloadedModel, ModelFile, BackgroundDownloadInfo, ONNXImageModel, PersistedDownloadInfo } from '../../types';
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
import {
  saveModelsList,
  saveImageModelsList,
  loadDownloadedModels,
  loadDownloadedImageModels,
} from './storage';
import type { TransferredModelManifest } from '@offgrid/sync';
import { registerTransferredModelFile } from './transferAdmission';
import {
  performBackgroundDownload,
  watchBackgroundDownload,
  syncCompletedBackgroundDownloads,
  getOrphanedTextFiles,
  getOrphanedImageDirs,
  mmProjLocalName,
} from './download';
import { syncCompletedImageDownloads as syncCompletedImageDownloadsHelper } from './imageSync';
import { restoreInProgressDownloads } from './restore';
import {
  deleteOrphanedFile as scanDeleteOrphanedFile,
  cleanupMMProjEntries as scanCleanupMMProjEntries,
  scanForUntrackedImageModels as scanUntrackedImage,
  scanForUntrackedTextModels as scanUntrackedText,
  reconcileFinishedImageDownloads as reconcileImageDownloads,
  isMMProjFile,
} from './scan';
import {
  importLocalModel as scanImportLocalModel,
  type ImportLocalModelOpts,
} from './importLocalModel';
import { resolveStoredPath, determineCredibility } from './storage';
import * as visionRepair from './visionRepairService';
import type { RepairOpts, VisionRepairContext } from './visionRepairService';
import { resolveOwnedDocumentPath } from '../../utils/resolveDocumentPath';

class ModelManager {
  private readonly modelsDir: string;
  private readonly imageModelsDir: string;
  private backgroundDownloadMetadataCallback: BackgroundDownloadMetadataCallback | null = null;
  private readonly backgroundDownloadContext: Map<string, BackgroundDownloadContext> = new Map();

  constructor() {
    this.modelsDir = `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`;
    this.imageModelsDir = `${RNFS.DocumentDirectoryPath}/image_models`;
  }

  private resolveStoredPath(p: string, d: string) { return resolveStoredPath(p, d); }
  private determineCredibility(a: string) { return determineCredibility(a); }
  private isMMProjFile(f: string) { return isMMProjFile(f); }

  async initialize(): Promise<void> {
    if (!(await RNFS.exists(this.modelsDir))) await RNFS.mkdir(this.modelsDir);
    if (!(await RNFS.exists(this.imageModelsDir))) await RNFS.mkdir(this.imageModelsDir);
    const exclude = (p: string) => backgroundDownloadService.excludeFromBackup(p);
    await Promise.all([exclude(this.modelsDir), exclude(this.imageModelsDir),
      exclude(videoModelsDirectory()),
      exclude(`${RNFS.DocumentDirectoryPath}/${APP_CONFIG.whisperStorageDir}`)]);
  }

  /**
   * What the projector lifecycle needs from the registry. Every re-entrant call routes back through
   * this object's own methods, so the manager stays the single owner of the model list.
   */
  private visionContext(): VisionRepairContext {
    return {
      modelsDir: this.modelsDir,
      initialize: () => this.initialize(),
      getDownloadedModels: () => this.getDownloadedModels(),
      saveModelWithMmproj: (id, path) => this.saveModelWithMmproj(id, path),
      linkOrphanMmProj: () => this.linkOrphanMmProj(),
      repairMmProj: (target, opts) => this.repairMmProj(target.modelId, target.file, opts),
    };
  }

  async linkOrphanMmProj(): Promise<void> {
    return visionRepair.linkOrphanMmProj(this.visionContext());
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
    const modelPath = resolveOwnedDocumentPath(model.filePath, this.modelsDir);
    if (!modelPath) {
      throw new Error('Invalid model path: outside app directory');
    }
    const llamaModel = model.engine === 'llama' ? model : null;
    const mmProjPath = llamaModel?.mmProjPath
      ? resolveOwnedDocumentPath(llamaModel.mmProjPath, this.modelsDir)
      : null;
    if (llamaModel?.mmProjPath && !mmProjPath) {
      throw new Error('Invalid mmproj path: outside app directory');
    }
    await RNFS.unlink(modelPath);

    // Only delete mmproj if no other models reference it
    if (llamaModel?.mmProjPath && mmProjPath) {
      const otherModelsUsingMmproj = models.some(
        m => m.engine === 'llama' && m.id !== modelId && m.mmProjPath === llamaModel.mmProjPath,
      );
      if (!otherModelsUsingMmproj) {
        await RNFS.unlink(mmProjPath).catch(() => {});
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
    return models.reduce((total, model) => total + model.fileSize + getMmProjFileSize(model), 0);
  }

  async getAvailableStorage(): Promise<number> {
    const freeSpace = await RNFS.getFSInfo();
    return freeSpace.freeSpace;
  }

  async getOrphanedFiles(): Promise<Array<{ name: string; path: string; size: number }>> {
    await this.initialize();
    try {
      const textOrphans = await getOrphanedTextFiles(this.modelsDir, () => this.getDownloadedModels());
      const imageOrphans = await getOrphanedImageDirs(this.imageModelsDir, () => this.getDownloadedImageModels());
      return [...textOrphans, ...imageOrphans];
    } catch {
      return [];
    }
  }

  async deleteOrphanedFile(filePath: string): Promise<void> {
    await scanDeleteOrphanedFile(filePath);
  }

  setBackgroundDownloadMetadataCallback(callback: BackgroundDownloadMetadataCallback): void {
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
      backgroundDownloadMetadataCallback: this.backgroundDownloadMetadataCallback,
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
      backgroundDownloadMetadataCallback: this.backgroundDownloadMetadataCallback,
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
      ctx.mmProjLocalPath = `${this.modelsDir}/${mmProjLocalName(ctx.file.name, ctx.file.mmProjFile?.name)}`;
    }
  }

  private async cleanupCancelledTextArtifacts(ctx: Extract<BackgroundDownloadContext, { file: ModelFile }>): Promise<void> {
    const cleanupTargets = [ctx.localPath, ctx.mmProjLocalPath].filter((path): path is string => !!path);

    await Promise.all(cleanupTargets.map(async targetPath => {
      try {
        const exists = await RNFS.exists(targetPath);
        if (!exists) return;
        await RNFS.unlink(targetPath);
        logger.warn(`[ModelManagerDownload] removed cancelled artifact ${targetPath}`);
      } catch (error) {
        logger.warn(`[ModelManagerDownload] failed to remove cancelled artifact ${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }

  async cancelBackgroundDownload(downloadId: string): Promise<void> {
    if (!this.isBackgroundDownloadSupported()) {
      throw new Error('Background downloads not supported on this platform');
    }
    const ctx = this.backgroundDownloadContext.get(downloadId);
    if (ctx && 'file' in ctx && ctx.mmProjDownloadId) {
      await backgroundDownloadService.cancelDownload(ctx.mmProjDownloadId).catch(() => {});
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
    return syncCompletedBackgroundDownloads({ persistedDownloads, modelsDir: this.modelsDir, clearDownloadCallback });
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
      addDownloadedImageModel: (model) => this.addDownloadedImageModel(model),
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
      backgroundDownloadMetadataCallback: this.backgroundDownloadMetadataCallback,
      onProgress,
    });
  }

  async getActiveBackgroundDownloads(): Promise<BackgroundDownloadInfo[]> {
    if (!this.isBackgroundDownloadSupported()) return [];
    return backgroundDownloadService.getActiveDownloads();
  }
  startBackgroundDownloadPolling(): void {
    if (this.isBackgroundDownloadSupported()) backgroundDownloadService.startProgressPolling();
  }

  stopBackgroundDownloadPolling(): void {
    if (this.isBackgroundDownloadSupported()) backgroundDownloadService.stopProgressPolling();
  }
  /** @see visionRepairService.repairVision - the one rule every surface repairs a model through. */
  async repairVision(
    model: DownloadedModel,
    opts?: RepairOpts,
  ): Promise<visionRepair.VisionRepairOutcome> {
    return visionRepair.repairVision(this.visionContext(), model, opts);
  }

  async repairMmProj(modelId: string, file: ModelFile, opts?: RepairOpts): Promise<void> {
    return visionRepair.repairMmProj(this.visionContext(), { modelId, file }, opts);
  }

  async markVisionModel(modelId: string): Promise<boolean> {
    return visionRepair.markVisionModel(this.visionContext(), modelId);
  }

  async saveModelWithMmproj(modelId: string, mmProjPath: string): Promise<void> {
    return visionRepair.saveModelWithMmproj(this.visionContext(), modelId, mmProjPath);
  }

  async clearMmProjLink(modelId: string): Promise<void> {
    return visionRepair.clearMmProjLink(this.visionContext(), modelId);
  }

  async cleanupMMProjEntries(): Promise<number> {
    return scanCleanupMMProjEntries(this.modelsDir);
  }

  async importLocalModel(opts: Omit<ImportLocalModelOpts, 'modelsDir'>): Promise<DownloadedModel> {
    await this.initialize();
    return scanImportLocalModel({ ...opts, modelsDir: this.modelsDir });
  }

  getModelsDirectory(): string {
    return this.modelsDir;
  }

  async registerTransferredModel(manifest: TransferredModelManifest): Promise<DownloadedModel> {
    const model = await registerTransferredModelFile(manifest, this.modelsDir);
    useAppStore.getState().setDownloadedModels(await this.getDownloadedModels());
    return model;
  }

  async getDownloadedImageModels(): Promise<ONNXImageModel[]> {
    try {
      return await loadDownloadedImageModels(this.imageModelsDir);
    } catch {
      return [];
    }
  }

  async addDownloadedImageModel(model: ONNXImageModel): Promise<void> {
    const models = await this.getDownloadedImageModels();
    const idx = models.findIndex(m => m.id === model.id);
    if (idx >= 0) models[idx] = model;
    else models.push(model);
    await saveImageModelsList(models);
  }

  async deleteImageModel(modelId: string): Promise<void> {
    const models = await this.getDownloadedImageModels();
    const model = models.find(m => m.id === modelId);
    if (!model) throw new Error('Image model not found');
    const topLevelDir = `${this.imageModelsDir}/${modelId}`;
    if (!topLevelDir.startsWith(`${this.imageModelsDir}/`)) {
      throw new Error('Invalid image model path: outside app directory');
    }
    if (await RNFS.exists(topLevelDir)) await RNFS.unlink(topLevelDir);
    await saveImageModelsList(models.filter(m => m.id !== modelId));
  }

  async getImageModelPath(modelId: string): Promise<string | null> {
    const models = await this.getDownloadedImageModels();
    return models.find(m => m.id === modelId)?.modelPath || null;
  }

  async getImageModelsStorageUsed(): Promise<number> {
    const models = await this.getDownloadedImageModels();
    return models.reduce((total, model) => total + model.size, 0);
  }

  getImageModelsDirectory(): string {
    return this.imageModelsDir;
  }

  async scanForUntrackedImageModels(): Promise<ONNXImageModel[]> {
    await this.initialize();
    return scanUntrackedImage({
      imageModelsDir: this.imageModelsDir,
      getImageModels: () => this.getDownloadedImageModels(),
      addImageModel: (model) => this.addDownloadedImageModel(model),
    });
  }

  async reconcileFinishedImageDownloads(activeModelIds: Set<string>): Promise<ONNXImageModel[]> {
    await this.initialize();
    return reconcileImageDownloads({
      imageModelsDir: this.imageModelsDir,
      getImageModels: () => this.getDownloadedImageModels(),
      addImageModel: (model) => this.addDownloadedImageModel(model),
      activeModelIds,
    });
  }

  async scanForUntrackedTextModels(): Promise<DownloadedModel[]> {
    await this.initialize();
    return scanUntrackedText(this.modelsDir, () => this.getDownloadedModels());
  }

  async refreshModelLists(): Promise<{ textModels: DownloadedModel[]; imageModels: ONNXImageModel[] }> {
    await this.scanForUntrackedTextModels();
    await this.scanForUntrackedImageModels();
    return {
      textModels: await this.getDownloadedModels(),
      imageModels: await this.getDownloadedImageModels(),
    };
  }
}

export const modelManager = new ModelManager();
