import RNFS from 'react-native-fs';
import logger from '../../../utils/logger';
import {
  DownloadedModel,
  ModelFile,
  ONNXImageModel,
} from '../../../types';
import { APP_CONFIG } from '../../../constants';
import { useAppStore } from '../../../stores/appStore';
import { nativeDownloadTransferAdapter } from '../../adapters/downloads/nativeDownloadTransferAdapter';
import type { TransferredModelManifest } from '@offgrid/sync';
import { registerTransferredModelFile } from '../../adapters/models/library/transferAdmissionAdapter';
import {
  getOrphanedTextFiles,
  getOrphanedImageDirs,
} from '../../adapters/models/library/orphanedModelScan';
import {
  deleteOrphanedFile as scanDeleteOrphanedFile,
  cleanupMMProjEntries as scanCleanupMMProjEntries,
  scanForUntrackedImageModels as scanUntrackedImage,
  scanForUntrackedTextModels as scanUntrackedText,
  reconcileFinishedImageDownloads as reconcileImageDownloads,
  ModelLibraryScanDegradedError,
} from '../../adapters/models/library/modelScanAdapter';
import { reportModelFailure } from '../../modelFailureHandler';
import {
  importLocalModel as scanImportLocalModel,
  type ImportLocalModelOpts,
} from '../../adapters/models/library/localModelImportAdapter';
import {
  type VisionRepairApplicationIntent,
  type VisionRepairOutcome,
} from '@offgrid/models';
import type { ModelLibraryRegistryService } from '@offgrid/models';
import * as visionRepair from '../../adapters/models/library/visionRepairAdapter';
import type {
  RepairOpts,
  VisionRepairContext,
} from '../../adapters/models/library/visionRepairAdapter';
import { VisionRepairReconciliationPendingError } from '../../adapters/models/library/visionRepairAdapter';
import { modelLibraryRegistry } from '../../composition/model-library-services';
class ModelLibraryBootstrap {
  private readonly modelsDir: string;
  private readonly imageModelsDir: string;
  private readonly registry: ModelLibraryRegistryService<
    DownloadedModel,
    ONNXImageModel
  >;

  constructor() {
    this.modelsDir = `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`;
    this.imageModelsDir = `${RNFS.DocumentDirectoryPath}/image_models`;
    this.registry = modelLibraryRegistry(this.modelsDir, this.imageModelsDir);
  }

  async initialize(): Promise<void> {
    if (!(await RNFS.exists(this.modelsDir))) await RNFS.mkdir(this.modelsDir);
    if (!(await RNFS.exists(this.imageModelsDir)))
      await RNFS.mkdir(this.imageModelsDir);
    const exclude = (p: string) =>
      nativeDownloadTransferAdapter.excludeFromBackup(p);
    await Promise.all([
      exclude(this.modelsDir),
      exclude(this.imageModelsDir),
      exclude(`${RNFS.DocumentDirectoryPath}/${APP_CONFIG.whisperStorageDir}`),
    ]);
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
      repairMmProj: (target, opts) =>
        this.repairMmProj(target.modelId, target.file, opts),
    };
  }

  async linkOrphanMmProj(): Promise<void> {
    return visionRepair.linkOrphanMmProj(this.visionContext());
  }

  async getDownloadedModels(): Promise<DownloadedModel[]> {
    return this.registry.listText();
  }

  async deleteModel(modelId: string): Promise<void> {
    await this.registry.deleteText(modelId);
  }

  async getModelPath(modelId: string): Promise<string | null> {
    return this.registry.textPath(modelId);
  }

  async getStorageUsed(): Promise<number> {
    return this.registry.textStorageUsed();
  }

  async getAvailableStorage(): Promise<number> {
    return this.registry.availableStorage();
  }

  async getOrphanedFiles(): Promise<
    Array<{ name: string; path: string; size: number }>
  > {
    await this.initialize();
    try {
      const textOrphans = await getOrphanedTextFiles(this.modelsDir, () =>
        this.getDownloadedModels(),
      );
      const imageOrphans = await getOrphanedImageDirs(this.imageModelsDir, () =>
        this.getDownloadedImageModels(),
      );
      return [...textOrphans, ...imageOrphans];
    } catch (cause) {
      this.projectDegradedScan(new ModelLibraryScanDegradedError('orphan-scan', cause, 0));
      return [];
    }
  }

  async deleteOrphanedFile(filePath: string): Promise<void> {
    await scanDeleteOrphanedFile(filePath);
  }

  /** @see visionRepairService.repairVision - the one rule every surface repairs a model through. */
  async repairVision(
    model: DownloadedModel,
    opts?: RepairOpts,
  ): Promise<VisionRepairOutcome> {
    return visionRepair.repairVision(this.visionContext(), model, opts);
  }

  async repairMmProj(
    modelId: string,
    file: ModelFile,
    opts?: RepairOpts,
  ): Promise<void> {
    return visionRepair.repairMmProj(
      this.visionContext(),
      { modelId, file },
      opts,
    );
  }

  /** Typed application boundary used by every UI repair surface. */
  async executeVisionRepair(
    intent: VisionRepairApplicationIntent<DownloadedModel, ModelFile>,
  ): Promise<
    | { status: 'completed'; outcome: VisionRepairOutcome; projection: DownloadedModel[] }
    | { status: 'installed-reconciliation-pending'; message: string; projection: DownloadedModel[] }
    | { status: 'failed'; error: string }
  > {
    try {
      const outcome = intent.type === 'repair-model'
        ? await this.repairVision(intent.model)
        : await this.repairProjectorIntent(intent.modelId, intent.file);
      const projection = await this.getDownloadedModels();
      useAppStore.getState().setDownloadedModels(projection);
      return { status: 'completed', outcome, projection };
    } catch (cause) {
      if (cause instanceof VisionRepairReconciliationPendingError) {
        const projection = await this.getDownloadedModels();
        useAppStore.getState().setDownloadedModels(projection);
        return {
          status: 'installed-reconciliation-pending',
          message: cause.message,
          projection,
        };
      }
      return {
        status: 'failed',
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }

  private async repairProjectorIntent(
    modelId: string,
    file: ModelFile,
  ): Promise<VisionRepairOutcome> {
    await this.repairMmProj(modelId, file);
    return { kind: 'repaired', repoId: modelId };
  }

  async markVisionModel(modelId: string): Promise<boolean> {
    return visionRepair.markVisionModel(this.visionContext(), modelId);
  }

  async saveModelWithMmproj(
    modelId: string,
    mmProjPath: string,
  ): Promise<void> {
    return visionRepair.saveModelWithMmproj(
      this.visionContext(),
      modelId,
      mmProjPath,
    );
  }

  async clearMmProjLink(modelId: string): Promise<void> {
    return visionRepair.clearMmProjLink(this.visionContext(), modelId);
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

  getModelsDirectory(): string {
    return this.modelsDir;
  }

  async registerTransferredModel(
    manifest: TransferredModelManifest,
  ): Promise<DownloadedModel> {
    const model = await registerTransferredModelFile(manifest, this.modelsDir);
    useAppStore
      .getState()
      .setDownloadedModels(await this.getDownloadedModels());
    return model;
  }

  async getDownloadedImageModels(): Promise<ONNXImageModel[]> {
    return this.registry.listImages();
  }

  async addDownloadedImageModel(model: ONNXImageModel): Promise<void> {
    await this.registry.upsertImage(model);
  }

  async deleteImageModel(modelId: string): Promise<void> {
    await this.registry.deleteImage(modelId);
  }

  async getImageModelPath(modelId: string): Promise<string | null> {
    return this.registry.imagePath(modelId);
  }

  async getImageModelsStorageUsed(): Promise<number> {
    return this.registry.imageStorageUsed();
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
      onDegraded: error => this.projectDegradedScan(error),
    });
  }

  async scanForUntrackedTextModels(): Promise<DownloadedModel[]> {
    await this.initialize();
    return scanUntrackedText(
      this.modelsDir,
      () => this.getDownloadedModels(),
      error => this.projectDegradedScan(error),
    );
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

  private projectDegradedScan(error: ModelLibraryScanDegradedError): void {
    logger.error('[ModelLibrary] Degraded model scan:', error);
    reportModelFailure('text', error, {
      id: 'model-library-scan', severity: 'warning',
      title: 'Model library scan incomplete',
      message: 'Some model files could not be checked. Your registered models are still available.',
    });
  }
}
export const modelLibrary = new ModelLibraryBootstrap();
