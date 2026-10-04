import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DownloadedModel, LlamaDownloadedModel, LiteRTDownloadedModel, ModelFile, ModelCredibility, ModelOrigin, ONNXImageModel } from '../../../../types';
import { getCuratedLiteRTEntry } from '@offgrid/models';
import logger from '../../../../utils/logger';
import { statFile } from '../../../../utils/fileStat';
import { parseHuggingFaceUrl } from '../../../../utils/modelOrigin';
import {
  describeModelCredibility,
  finalizeHydratedRegistry,
  modelPathBasename,
  parseRegistryRows,
  projectorRegistryMetadata,
  resolveStoredModelPath,
  upsertRegistryRow,
} from '@offgrid/models';
import { reconcilePrimaryPaths } from '../storedPathAdapter';
import { useAppStore } from '../../../../stores/appStore';
import { isLiteRTFileName } from '../../../../utils/modelHelpers';

// Re-exported because this module was the published home of these helpers before they were extracted
// into the one place both registries share.
const MODELS_STORAGE_KEY = '@local_llm/downloaded_models';
const IMAGE_MODELS_STORAGE_KEY = '@local_llm/downloaded_image_models';

export function determineCredibility(author: string): ModelCredibility {
  return describeModelCredibility(author);
}

export async function saveModelsList(models: DownloadedModel[]): Promise<void> {
  await AsyncStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models));
}

/**
 * Change the model registry: persist the list AND publish it, in that order.
 *
 * Every writer needs both halves - a list saved but not published leaves the screens reading a
 * model that no longer exists until something forces a refetch, which is how a repaired model kept
 * showing "no vision file" until the app restarted. Four call sites each wrote the pair by hand;
 * this is the one that cannot forget the second line.
 *
 * `saveModelsList` stays for the read path only, where a self-heal rewrite must NOT publish (it is
 * running inside the very load the store is waiting on).
 */
export async function commitModelsList(models: DownloadedModel[]): Promise<void> {
  await saveModelsList(models);
  useAppStore.getState().setDownloadedModels(models);
}

export async function saveImageModelsList(models: ONNXImageModel[]): Promise<void> {
  await AsyncStorage.setItem(IMAGE_MODELS_STORAGE_KEY, JSON.stringify(models));
}

/** Persist and publish one committed image-library projection. */
export async function commitImageModelsList(models: ONNXImageModel[]): Promise<void> {
  await saveImageModelsList(models);
  useAppStore.getState().setDownloadedImageModels(models);
}

async function tryResolveMmProjPath(
  model: DownloadedModel,
  modelsDir: string,
): Promise<boolean> {
  if (model.engine !== 'llama' || !model.mmProjPath) return false;
  const mmExists = await RNFS.exists(model.mmProjPath);
  if (mmExists) return false;
  const resolvedMm = resolveStoredModelPath(model.mmProjPath, modelsDir);
  if (!resolvedMm || resolvedMm === model.mmProjPath) return false;
  const mmResolvedExists = await RNFS.exists(resolvedMm);
  if (mmResolvedExists) {
    model.mmProjPath = resolvedMm;
    return true;
  }
  return false;
}

async function validateAndResolveModels(
  models: DownloadedModel[],
  modelsDir: string,
): Promise<{ validModels: DownloadedModel[]; pathsUpdated: boolean }> {
  const { verdicts, pathsUpdated: primaryUpdated } = await reconcilePrimaryPaths(models, modelsDir, {
    getPath: model => model.filePath,
    setPath: (model, path) => {
      model.filePath = path;
    },
  });

  // Only a model whose primary file is actually present can have its projector resolved - a missing
  // model has nothing to see with either.
  const withProjector = models.filter((_, i) => verdicts[i].exists);
  const mmProjResults = await Promise.all(
    withProjector.map(model => tryResolveMmProjPath(model, modelsDir)),
  );

  const pathsUpdated = primaryUpdated || mmProjResults.some(Boolean);
  return { validModels: models.filter((_, i) => verdicts[i].keep), pathsUpdated };
}

export async function loadDownloadedModels(modelsDir: string): Promise<DownloadedModel[]> {
  const stored = await AsyncStorage.getItem(MODELS_STORAGE_KEY);
  if (!stored) return [];

  let models: DownloadedModel[];
  try {
    // Backfill engine: 'llama' for records written before the discriminated union.
    // LiteRT records always had engine: 'litert' set explicitly, so this is safe.
    // For LiteRT, consult the curated registry by fileName — this rescues
    // already-downloaded curated models whose row was written before liteRTVision
    // was being set correctly. Locally-imported .litertlm files aren't in the
    // registry and keep whatever flag they were saved with.
    models = parseRegistryRows(stored, (value): DownloadedModel => {
      const m = value as any;
      if (m.engine === 'litert') {
        const curated = getCuratedLiteRTEntry(m.fileName);
        const liteRTVision = curated?.liteRTVision ?? m.liteRTVision ?? false;
        const liteRTAudio = curated?.liteRTAudio ?? m.liteRTAudio ?? false;
        return { ...m, liteRTVision, liteRTAudio } as LiteRTDownloadedModel;
      }
      return { ...m, engine: 'llama' as const } as LlamaDownloadedModel;
    });
  } catch (error) {
    // Corrupt AsyncStorage should not prevent the app from loading other state.
    logger.error('[ModelManagerStorage] Failed to parse downloaded models JSON', {
      storageKey: MODELS_STORAGE_KEY,
      length: stored.length,
      preview: stored.slice(0, 100),
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const { validModels, pathsUpdated } = await validateAndResolveModels(models, modelsDir);
  const hydrated = finalizeHydratedRegistry({
    originalCount: models.length,
    validRows: validModels,
    pathsUpdated,
    keyOf: model => model.fileName,
  });

  if (hydrated.shouldPersist) {
    await saveModelsList(hydrated.rows);
  }

  return hydrated.rows;
}

export async function loadDownloadedImageModels(imageModelsDir: string): Promise<ONNXImageModel[]> {
  const stored = await AsyncStorage.getItem(IMAGE_MODELS_STORAGE_KEY);
  if (!stored) return [];

  let models: ONNXImageModel[];
  try {
    models = parseRegistryRows(stored, value => value as ONNXImageModel);
  } catch (error) {
    // Corrupt AsyncStorage should not prevent the app from loading other state.
    logger.error('[ModelManagerStorage] Failed to parse downloaded image models JSON', {
      storageKey: IMAGE_MODELS_STORAGE_KEY,
      length: stored.length,
      preview: stored.slice(0, 100),
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const { verdicts, pathsUpdated } = await reconcilePrimaryPaths(models, imageModelsDir, {
    getPath: model => model.modelPath,
    setPath: (model, path) => {
      model.modelPath = path;
    },
  });

  const validModels = models.filter((_, i) => verdicts[i].keep);
  // Repairs a registry that already grew duplicates under the old `Date.now()` ids, exactly as the
  // text registry does one function above.
  const hydrated = finalizeHydratedRegistry({
    originalCount: models.length,
    validRows: validModels,
    pathsUpdated,
    keyOf: model => modelPathBasename(model.modelPath) || undefined,
  });

  if (hydrated.shouldPersist) {
    await saveImageModelsList(hydrated.rows);
  }

  return hydrated.rows;
}

export interface BuildModelOpts {
  modelId: string;
  file: ModelFile;
  resolvedLocalPath: string;
  mmProjPath?: string;
  /** Kept even when mmProjPath is absent (download failed) so needsVisionRepair can detect the gap */
  expectedMmProjFileName?: string;
  /** Provenance the caller already knows (a device transfer carries the sender's). Wins over the URL. */
  origin?: ModelOrigin;
}

/**
 * The projector's size on disk, falling back to the size the catalog advertised.
 *
 * The file wins when it is there: a resumed or repaired sidecar can differ from the metadata, and
 * the storage figures the user reads come from this number.
 */
async function resolveMmProjFileSize(
  mmProjPath: string | undefined,
  mmProjFile: ModelFile['mmProjFile'],
): Promise<number | undefined> {
  if (!mmProjPath) return undefined;
  try {
    return (await statFile(mmProjPath))?.size ?? mmProjFile?.size;
  } catch {
    // Keep the fallback size from metadata.
    return mmProjFile?.size;
  }
}

/**
 * Registry wins for curated LiteRT artifacts: the display name comes from a single source of truth
 * keyed by fileName. Falls back to the file's own name for locally-imported .litertlm files, then to
 * the modelId basename for everything else.
 */
function resolveDisplayName(
  modelId: string,
  file: ModelFile,
  curatedDisplayName: string | undefined,
): string {
  if (curatedDisplayName) return curatedDisplayName;
  if (isLiteRTFileName(file.name)) return file.name.replace(/\.litertlm$/i, '');
  return modelId.split('/').pop() || modelId;
}

export async function buildDownloadedModel(opts: BuildModelOpts): Promise<DownloadedModel> {
  const { modelId, file, resolvedLocalPath, mmProjPath, expectedMmProjFileName } = opts;
  // Through the safe reader. `RNFS.stat` here ABORTED the app three seconds after every launch: the
  // startup scan calls this for each stored model, an absolute container path goes stale on reinstall,
  // and iOS raises an uncatchable NSInvalidArgumentException for a path whose type it cannot resolve.
  // A missing file is now a size of 0 - the model reads as present-but-empty, which the caller already
  // handles - instead of taking the process down. See utils/fileStat.
  const stat = await statFile(resolvedLocalPath);
  const author = modelId.split('/')[0] || 'Unknown';
  const isLiteRT = isLiteRTFileName(file.name);
  const mmProjFile = file.mmProjFile;
  const mmProjFileSize = await resolveMmProjFileSize(mmProjPath, mmProjFile);
  const projector = projectorRegistryMetadata({
    projectorPath: mmProjPath,
    projectorSourceName: mmProjFile?.name,
    expectedProjectorName: expectedMmProjFileName,
    projectorSize: mmProjFileSize,
  });

  const curatedLiteRT = isLiteRT ? getCuratedLiteRTEntry(file.name) : undefined;
  const derivedName = resolveDisplayName(modelId, file, curatedLiteRT?.displayName);

  // Provenance, taken from the URL we actually fetched. This is the ONE moment it is known for
  // certain; everything downstream (vision repair) reads it instead of guessing from the id.
  // `opts.origin` wins when a caller already knows better - a device transfer passes on the
  // origin the sending device recorded, which the receiver cannot derive from the bytes alone.
  const origin = opts.origin ?? parseHuggingFaceUrl(file.downloadUrl) ?? undefined;

  const commonFields = {
    id: `${modelId}/${file.name}`,
    name: derivedName,
    author,
    filePath: resolvedLocalPath,
    fileName: file.name,
    fileSize: stat?.size ?? 0,
    quantization: file.quantization,
    downloadedAt: new Date().toISOString(),
    credibility: determineCredibility(author),
    ...(origin ? { origin } : {}),
  };

  if (isLiteRT) {
    const liteRTVision = curatedLiteRT?.liteRTVision ?? file.liteRTVision ?? false;
    const liteRTAudio = curatedLiteRT?.liteRTAudio ?? file.liteRTAudio ?? false;
    const liteRTModel: LiteRTDownloadedModel = {
      ...commonFields,
      engine: 'litert',
      liteRTVision,
      liteRTAudio,
    };
    return liteRTModel;
  }

  const llamaModel: LlamaDownloadedModel = {
    ...commonFields,
    engine: 'llama',
    isVisionModel: !!mmProjPath,
    mmProjPath: projector.projectorPath,
    mmProjFileName: projector.projectorName,
    mmProjFileSize: projector.projectorSize,
  };
  return llamaModel;
}

export async function persistDownloadedModel(
  model: DownloadedModel,
  modelsDir: string,
): Promise<void> {
  const models = await loadDownloadedModels(modelsDir);
  await saveModelsList(upsertRegistryRow(models, model, value => value.id));
}
