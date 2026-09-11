import RNFS from 'react-native-fs';
import {
  clearVisionProjector,
  isModelProjectorFile,
  linkVisionProjectors,
  markVisionCapability,
  repairVisionModel,
  saveVisionProjector,
  type VisionRepairLifecyclePorts,
  type VisionRepairOutcome,
} from '@offgrid/models';
import { modelsFailureMessage } from '@offgrid/application';
import type { DownloadedModel, ModelFile } from '../../../../types';
import { statFile } from '../../../../utils/fileStat';
import { commitModelsList } from './modelRegistryStorageAdapter';
import { huggingFaceService } from '../../../huggingface';
import type { DownloadProgressCallback } from './types';
import { applicationFacade } from '../../../applicationFacade';
import { generateId } from '../../../../utils/generateId';
import logger from '../../../../utils/logger';

export interface RepairOpts {
  onProgress?: DownloadProgressCallback;
  onDownloadIdReady?: (id: string) => void;
}

/** The projector is durable, but the facade could not reconcile its inventory projection yet. */
export class VisionRepairReconciliationPendingError extends Error {
  readonly installed = true;

  constructor(message: string) {
    super(message);
    this.name = 'VisionRepairReconciliationPendingError';
  }
}

export interface VisionRepairContext {
  modelsDir: string;
  initialize(): Promise<void>;
  getDownloadedModels(): Promise<DownloadedModel[]>;
  saveModelWithMmproj(modelId: string, mmProjPath: string): Promise<void>;
  linkOrphanMmProj(): Promise<void>;
  repairMmProj(target: MmProjTarget, opts?: RepairOpts): Promise<void>;
}

function documentLocalName(path: string): string {
  const prefix = `${RNFS.DocumentDirectoryPath}/`;
  if (!path.startsWith(prefix)) throw new Error('The model is outside app storage.');
  return path.slice(prefix.length);
}

async function downloadProjector(input: {
  readonly model: DownloadedModel;
  readonly file: ModelFile;
  readonly repositoryId?: string;
  readonly onProgress?: DownloadProgressCallback;
  readonly onDownloadIdReady?: (id: string) => void;
}): Promise<string> {
  const projector = input.file.mmProjFile;
  if (!projector) throw new Error('Model file has no associated mmproj.');
  const operationId = generateId();
  input.onDownloadIdReady?.(operationId);
  const models = applicationFacade().models;
  const release = models.events(event => {
    if (event.type !== 'model_projector_repair_progress' || event.operationId !== operationId) return;
    input.onProgress?.({
      downloadId: operationId,
      modelId: input.model.id,
      fileName: projector.name,
      bytesDownloaded: event.bytesDownloaded,
      totalBytes: event.totalBytes,
      progress: event.totalBytes > 0 ? event.bytesDownloaded / event.totalBytes : 0,
    });
  });
  try {
    const outcome = await models.repairProjector({
      operationId,
      modelId: input.model.id,
      primary: {
        fileName: input.model.fileName,
        localName: documentLocalName(input.model.filePath),
      },
      projector: {
        fileName: projector.name,
        url: projector.downloadUrl || huggingFaceService.getDownloadUrl(
          input.model.origin?.repoId ?? input.repositoryId
            ?? input.model.id.split('/').slice(0, 2).join('/'),
          projector.name,
        ),
        totalBytes: projector.size,
        sha256: projector.sha256,
      },
    });
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    if (outcome.value.reconciliationFailure) {
      const message = modelsFailureMessage(outcome.value.reconciliationFailure);
      logger.warn('[VisionRepair] Projector installed; inventory reconciliation must retry', {
        modelId: input.model.id,
        error: message,
      });
      throw new VisionRepairReconciliationPendingError(
        `The vision file is installed, but the model list could not refresh: ${message}`,
      );
    }
    return outcome.value.localUri;
  } finally {
    release();
  }
}

function lifecyclePorts(
  ctx: VisionRepairContext,
  target?: DownloadedModel,
): VisionRepairLifecyclePorts<DownloadedModel, ModelFile> {
  return {
    listModels: () => ctx.getDownloadedModels(),
    saveModels: commitModelsList,
    async listProjectors() {
      const entries = await RNFS.readDir(ctx.modelsDir).catch(() => []);
      return entries
        .filter(entry => entry.isFile() && isModelProjectorFile(entry.name))
        .map(entry => ({
          name: entry.name,
          path: entry.path,
          size: typeof entry.size === 'string' ? Number.parseInt(entry.size, 10) : entry.size,
        }));
    },
    fileExists: path => RNFS.exists(path).catch(() => false),
    search: fileName => huggingFaceService.findReposPublishing(fileName),
    catalogFiles: (repoId, revision) => huggingFaceService.getModelFiles(repoId, revision),
    projectorFor: file => file.mmProjFile,
    async downloadProjector(input) {
      await ctx.initialize();
      const installed = target ?? (await ctx.getDownloadedModels()).find(model =>
        model.id === input.repoId || model.id === `${input.repoId}/${input.file.name}`,
      );
      if (!installed) throw new Error('The projector repair target is not installed.');
      const path = await downloadProjector({
        model: installed,
        file: input.file,
        repositoryId: input.repoId,
        onProgress: input.onProgress as DownloadProgressCallback | undefined,
        onDownloadIdReady: input.onDownloadIdReady,
      });
      return {
        path,
        name: path.split('/').pop() ?? path,
        size: (await statFile(path))?.size ?? 0,
      };
    },
  };
}

export function linkOrphanMmProj(ctx: VisionRepairContext): Promise<void> {
  return linkVisionProjectors(lifecyclePorts(ctx));
}

export function repairVision(
  ctx: VisionRepairContext,
  model: DownloadedModel,
  opts?: RepairOpts,
): Promise<VisionRepairOutcome> {
  return repairVisionModel(lifecyclePorts(ctx, model), model, opts as any);
}

export interface MmProjTarget {
  modelId: string;
  file: ModelFile;
}

export async function repairMmProj(
  ctx: VisionRepairContext,
  { modelId, file }: MmProjTarget,
  opts?: RepairOpts,
): Promise<void> {
  if (!file.mmProjFile) throw new Error('Model file has no associated mmproj');
  await ctx.initialize();
  const installed = (await ctx.getDownloadedModels()).find(model =>
    model.id === modelId || model.id === `${modelId}/${file.name}`,
  );
  if (!installed) throw new Error('The projector repair target is not installed.');
  await downloadProjector({
    model: installed,
    file,
    repositoryId: modelId,
    ...opts,
  });
}

export function markVisionModel(
  ctx: VisionRepairContext,
  modelId: string,
): Promise<boolean> {
  return markVisionCapability(lifecyclePorts(ctx), modelId);
}

export async function saveModelWithMmproj(
  ctx: VisionRepairContext,
  modelId: string,
  mmProjPath: string,
): Promise<void> {
  await saveVisionProjector(lifecyclePorts(ctx), modelId, {
    path: mmProjPath,
    name: mmProjPath.split('/').pop() ?? mmProjPath,
    size: (await statFile(mmProjPath))?.size ?? 0,
  });
}

export function clearMmProjLink(
  ctx: VisionRepairContext,
  modelId: string,
): Promise<void> {
  return clearVisionProjector(lifecyclePorts(ctx), modelId);
}
