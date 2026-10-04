import { isGgufFile } from '@offgrid/models';
import RNFS from 'react-native-fs';
import { statFile } from '../../../../utils/fileStat';
import { unzip } from 'react-native-zip-archive';
import { DownloadedModel, LlamaDownloadedModel, ONNXImageModel } from '../../../../types';
import { loadDownloadedModels, saveModelsList } from './modelRegistryStorageAdapter';
import {
  inferMobileImageBackend,
  findRegisteredArtifact,
  imageDirectoryRecoveryAction,
  modelPathBasename,
  parseArtifactSize,
  planRecoveredTextModel,
  recoveredImageModelIdentity,
  recoveredModelBaseName,
} from '@offgrid/models';
import { resolveCoreMLModelDir } from '../../../../utils/coreMLModelUtils';
import { ensureImageExtractionComplete } from '../../../../utils/imageModelIntegrity';
import {
  isModelProjectorFile as isMMProjFile,
  pickProjectorForModel as pickMmProjForModel,
} from '@offgrid/models';


async function getDirSize(dirPath: string): Promise<number> {
  try {
    const dirFiles = await RNFS.readDir(dirPath);
    let total = 0;
    for (const f of dirFiles) {
      if (f.isFile()) {
        total += parseArtifactSize(f.size);
      } else if (f.isDirectory()) {
        total += await getDirSize(f.path);
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export async function deleteOrphanedFile(filePath: string): Promise<void> {
  const exists = await RNFS.exists(filePath);
  if (exists) {
    await RNFS.unlink(filePath);
  }
}

// The model base name (name + variant, quant stripped) used to NAME a downloaded projector. Matching a
// projector TO a model is done by the shared strict rule (pickMmProjForModel), NOT this.
export function extractBaseName(fileName: string): string {
  return recoveredModelBaseName(fileName);
}

function linkMmProjToModel(model: DownloadedModel, mmProjFiles: RNFS.ReadDirResItemT[]): void {
  if (model.engine !== 'llama') return;
  if (model.mmProjPath) return;
  // Link ONLY a projector that strictly belongs to this model (same name+variant stem). The physical
  // presence of a belonging projector IS the vision signal — no fragile name heuristic that excluded models
  // like gemma whose name has no "vl"/"vision" token.
  const chosen = pickMmProjForModel(model.fileName, mmProjFiles.map(f => f.name));
  const match = chosen ? mmProjFiles.find(f => f.name === chosen) : undefined;
  if (match) {
    model.mmProjPath = match.path;
    model.mmProjFileName = match.name;
    model.mmProjFileSize = parseArtifactSize(match.size);
    model.isVisionModel = true;
  }
}

export async function cleanupMMProjEntries(modelsDir: string): Promise<number> {
  const models = await loadDownloadedModels(modelsDir);
  const cleanedModels = models.filter(m => !isMMProjFile(m.fileName));
  const removedCount = models.length - cleanedModels.length;

  try {
    const dirExists = await RNFS.exists(modelsDir);
    if (dirExists) {
      const files = await RNFS.readDir(modelsDir);
      const mmProjFiles = files.filter(f => f.isFile() && isMMProjFile(f.name));
      for (const model of cleanedModels) {
        linkMmProjToModel(model, mmProjFiles);
      }
    }
  } catch {
    // Scan errors are non-fatal
  }

  await saveModelsList(cleanedModels);
  return removedCount;
}

export interface ScanImageModelsOpts {
  imageModelsDir: string;
  getImageModels: () => Promise<ONNXImageModel[]>;
  addImageModel: (model: ONNXImageModel) => Promise<void>;
}

export interface ReconcileImageModelsOpts {
  imageModelsDir: string;
  getImageModels: () => Promise<ONNXImageModel[]>;
  addImageModel: (model: ONNXImageModel) => Promise<void>;
  activeModelIds: Set<string>;
  onDegraded?: (error: ModelLibraryScanDegradedError) => void;
}

export class ModelLibraryScanDegradedError extends Error {
  constructor(
    readonly operation: string,
    readonly cause: unknown,
    readonly recoveredCount: number,
  ) {
    super(`Model library scan degraded during ${operation}.`);
    this.name = 'ModelLibraryScanDegradedError';
  }
}

async function isValidZip(zipPath: string): Promise<boolean> {
  if (!(await RNFS.exists(zipPath))) return false;
  try {
    const stat = await statFile(zipPath);
    const size = stat?.size ?? 0;
    if (!Number.isFinite(size) || size <= 0) return false;
  } catch {
    return false;
  }
  try {
    const header = await RNFS.read(zipPath, 4, 0, 'ascii');
    if (!header.startsWith('PK')) return false;
  } catch {
    // header check is best-effort
  }
  return true;
}

/** Build the ONNXImageModel record for a recovered on-disk dir (coreml resolves its inner model dir). */
async function buildRecoveredImageModel(
  item: { name: string; path: string },
  backend: 'mnn' | 'qnn' | 'coreml',
): Promise<ONNXImageModel> {
  let modelPath = item.path;
  if (backend === 'coreml') modelPath = await resolveCoreMLModelDir(item.path).catch(() => item.path);
  const totalSize = await getDirSize(item.path);
  return {
    id: item.name,
    name: item.name.replaceAll('_', ' '),
    description: '',
    modelPath,
    size: totalSize,
    downloadedAt: new Date().toISOString(),
    backend,
  };
}

/**
 * Recover an image model from a `_zip_name` remnant (a mid-unzip kill): re-unzip and register it —
 * but ONLY if the extraction is complete. isValidZip checks the PK header + size>0 only, so a
 * truncated-but-PK zip yields a PARTIAL mnn/qnn tree that crashes natively at generation (G7). Run
 * the same completeness gate the live/resume paths run; on a still-incomplete extraction, clean up
 * and return null so the dir resurfaces as re-downloadable. Returns null (and cleans up) on any
 * unrecoverable state; never marks `_ready` for a partial model.
 */
async function recoverImageModelFromZipRemnant(
  item: { name: string; path: string },
  imageModelsDir: string,
): Promise<ONNXImageModel | null> {
  const zipFileName = (await RNFS.readFile(`${item.path}/_zip_name`, 'utf8')).trim();
  const zipPath = `${imageModelsDir}/${zipFileName}`;
  if (!(await isValidZip(zipPath))) {
    await RNFS.unlink(item.path).catch(() => {}); // zip gone or corrupt — partial dir unrecoverable
    return null;
  }
  await unzip(zipPath, item.path);
  const backend = inferMobileImageBackend(item.name);
  try {
    await ensureImageExtractionComplete({ backend, modelDir: item.path, zipPath, modelId: item.name });
  } catch {
    await RNFS.unlink(item.path).catch(() => {});
    await RNFS.unlink(zipPath).catch(() => {});
    return null;
  }
  await RNFS.unlink(zipPath).catch(() => {});
  await RNFS.writeFile(`${item.path}/_ready`, '', 'utf8').catch(() => {});
  return buildRecoveredImageModel(item, backend);
}

export async function reconcileFinishedImageDownloads(opts: ReconcileImageModelsOpts): Promise<ONNXImageModel[]> {
  const { imageModelsDir, getImageModels, addImageModel, activeModelIds, onDegraded } = opts;
  const recovered: ONNXImageModel[] = [];

  try {
    const dirExists = await RNFS.exists(imageModelsDir);
    if (!dirExists) return recovered;

    const registeredModels = await getImageModels();
    const registeredIds = new Set(registeredModels.map(m => m.id));
    // Index by path so we can detect legacy recovered_<name>_<ts> entries whose
    // ID doesn't match the directory name but whose modelPath still points here.
    const registeredPaths = new Set(registeredModels.map(m => m.modelPath));

    const items = await RNFS.readDir(imageModelsDir);

    for (const item of items) {
      if (!item.isDirectory()) continue;
      const legacyEntry = registeredModels.find(
        m => m.modelPath === item.path && m.id.startsWith('recovered_'),
      );
      const registeredId = registeredIds.has(item.name);
      const active = activeModelIds.has(item.name);
      if (registeredId || active) continue;
      const action = imageDirectoryRecoveryAction({
        registeredId,
        active,
        registeredPath: registeredPaths.has(item.path),
        legacyPath: Boolean(legacyEntry),
        ready: await RNFS.exists(`${item.path}/_ready`),
        archiveMarker: await RNFS.exists(`${item.path}/_zip_name`),
      });
      if (action === 'skip') continue;

      if (action === 'migrate-legacy' && legacyEntry) {
        try {
          await RNFS.writeFile(`${item.path}/_ready`, '', 'utf8').catch(() => {});
          const backend = inferMobileImageBackend(item.name);
          let modelPath = item.path;
          if (backend === 'coreml') modelPath = await resolveCoreMLModelDir(item.path).catch(() => item.path);
          const totalSize = await getDirSize(item.path);
          const migrated: ONNXImageModel = {
            id: item.name, name: legacyEntry.name || item.name.replaceAll('_', ' '),
            description: legacyEntry.description || '', modelPath,
            size: totalSize, downloadedAt: legacyEntry.downloadedAt || new Date().toISOString(),
            backend, style: legacyEntry.style, attentionVariant: legacyEntry.attentionVariant,
          };
          await addImageModel(migrated);
          recovered.push(migrated);
        } catch (error) {
          onDegraded?.(new ModelLibraryScanDegradedError('legacy-image-migration', error, recovered.length));
        }
        continue;
      }

      if (action === 'register-ready') {
        // Unzip completed but registerAndNotify was killed — register now.
        const newModel = await buildRecoveredImageModel(item, inferMobileImageBackend(item.name));
        await addImageModel(newModel);
        recovered.push(newModel);
        continue;
      }

      if (action === 'recover-archive') {
        // Non-fatal on unexpected error: leave the dir for the next startup attempt.
        let model: ONNXImageModel | null = null;
        try {
          model = await recoverImageModelFromZipRemnant(item, imageModelsDir);
        } catch (error) {
          onDegraded?.(new ModelLibraryScanDegradedError('image-archive-recovery', error, recovered.length));
        }
        if (model) {
          await addImageModel(model);
          recovered.push(model);
        }
      } else if (action === 'delete-stale') {
        await RNFS.unlink(item.path).catch(() => {});
      }
    }
  } catch (error) {
    onDegraded?.(new ModelLibraryScanDegradedError('image-reconciliation', error, recovered.length));
  }

  return recovered;
}

export async function scanForUntrackedImageModels(opts: ScanImageModelsOpts): Promise<ONNXImageModel[]> {
  const { imageModelsDir, getImageModels, addImageModel } = opts;
  const discoveredModels: ONNXImageModel[] = [];
  const registeredModels = await getImageModels();
  /**
   * Index by DIRECTORY NAME, not by absolute path — the same conclusion the text scan below reached.
   *
   * `loadDownloadedImageModels` rebases a stale container path onto the current dir, so the common
   * reinstall case never reaches here. It cannot rebase a path that doesn't contain the current base
   * dir name, and it returns nothing at all if the load threw. In both cases a path comparison calls a
   * directory we already own "untracked" and adopts a second row for it. A directory name is unique
   * within the models dir, so it is the identity that survives a container move.
   */
  const registeredDirNames = new Set(registeredModels.map(m => modelPathBasename(m.modelPath)));

  const dirExists = await RNFS.exists(imageModelsDir);
  if (!dirExists) return discoveredModels;

  const items = await RNFS.readDir(imageModelsDir);

  for (const item of items) {
    if (!item.isDirectory() || registeredDirNames.has(item.name)) continue;

    const totalSize = await getDirSize(item.path);
    if (totalSize === 0) continue;

    const identity = recoveredImageModelIdentity(item.name);
    const newModel: ONNXImageModel = {
      // Derived from the directory name and NOTHING else. `Date.now()` meant the same directory
      // adopted twice produced two ids nothing downstream could reconcile, and anything holding the
      // previous id (the selected image model) dangled. A name is unique here, so this id is stable
      // across every scan, reinstall and container move.
      id: identity.id,
      name: identity.name,
      description: `Recovered ${item.name} model`,
      modelPath: item.path,
      size: totalSize,
      downloadedAt: new Date().toISOString(),
      backend: identity.backend,
    };

    await addImageModel(newModel);
    discoveredModels.push(newModel);
  }

  return discoveredModels;
}

export async function scanForUntrackedTextModels(
  modelsDir: string,
  getModels: () => Promise<DownloadedModel[]>,
  onDegraded?: (error: ModelLibraryScanDegradedError) => void,
): Promise<DownloadedModel[]> {
  const discoveredModels: DownloadedModel[] = [];

  try {
    return await doScanForUntrackedTextModels(modelsDir, getModels);
  } catch (error) {
    onDegraded?.(new ModelLibraryScanDegradedError('text-model-scan', error, discoveredModels.length));
    return discoveredModels;
  }
}

async function doScanForUntrackedTextModels(
  modelsDir: string,
  getModels: () => Promise<DownloadedModel[]>,
): Promise<DownloadedModel[]> {
  const discoveredModels: DownloadedModel[] = [];
  const registeredModels = await getModels();
  /**
   * Index by FILE NAME, not by absolute path.
   *
   * The absolute path is not an identity. On iOS the models dir lives under
   * /var/mobile/Containers/Data/Application/<UUID>/, and that UUID changes on every reinstall - so a
   * path stored yesterday matches nothing today, this scan called the file untracked, and adopted it
   * again under a fresh `recovered_<name>_<timestamp>` id while the old row stayed behind. One 508 MB
   * download had accumulated 35 rows across 29 app starts before anyone opened the list.
   *
   * A file name is unique within the models dir, which is why it is the stable key - the same
   * conclusion `useTextModels.ts` had already reached for its own display matching, applied here where
   * the rows are actually created.
   */
  let repairedPaths = false;

  const dirExists = await RNFS.exists(modelsDir);
  if (!dirExists) return discoveredModels;

  const items = await RNFS.readDir(modelsDir);
  // The projectors sitting in this same directory. An adopted model has to be offered them, or a
  // vision model comes back from recovery as text - the primary alone, 508 MB where the whole package
  // is 706 MB, and a transfer that ships something which loads and cannot see.
  const mmProjFiles = items.filter(entry => entry.isFile() && isMMProjFile(entry.name.toLowerCase()));

  for (const item of items) {
    const lowerName = item.name.toLowerCase();
    const isMmProj = isMMProjFile(lowerName);
    if (!item.isFile() || !isGgufFile(item.name) || isMmProj) {
      continue;
    }

    // Already known. REPAIR the row's path rather than adding a second row for the same file: that is
    // the whole difference between a registry that survives a reinstall and one that grows a duplicate
    // on every launch.
    const known = findRegisteredArtifact(registeredModels, item);
    if (known) {
      if (known.filePath !== item.path) {
        known.filePath = item.path;
        repairedPaths = true;
      }
      // A row that arrived without its projector gets it here. linkMmProjToModel is a no-op when one is
      // already linked, and only links a projector that STRICTLY belongs to this model by name and
      // variant - the same rule the loader uses, so link time and load time cannot disagree.
      // Narrowed because only a llama record has a projector at all; LiteRT has no such concept, and
      // linkMmProjToModel returns early for it.
      const hadProjector = known.engine === 'llama' && Boolean(known.mmProjPath);
      linkMmProjToModel(known, mmProjFiles);
      if (!hadProjector && known.engine === 'llama' && known.mmProjPath) repairedPaths = true;
      continue;
    }

    const plan = planRecoveredTextModel(item.name, item.size);
    if (!plan) continue;

    const newModel: LlamaDownloadedModel = {
      // Derived from the file name and NOTHING else. `Date.now()` in an id meant the same file adopted
      // twice produced two different ids, so nothing downstream could ever tell them apart - and the
      // registry had no way back to one row per file. A name is unique in this directory, so this id is
      // stable across every scan, reinstall and container move.
      id: plan.id,
      name: plan.name,
      author: plan.author,
      filePath: item.path,
      fileName: item.name,
      fileSize: plan.fileSize,
      quantization: plan.quantization,
      downloadedAt: new Date().toISOString(),
      credibility: { source: 'community', isOfficial: false, isVerifiedQuantizer: false },
      engine: 'llama',
    };

    // Adopted WITH its projector, so a recovered vision model is a vision model.
    linkMmProjToModel(newModel, mmProjFiles);
    registeredModels.push(newModel);
    repairedPaths = true;
    discoveredModels.push(newModel);
  }

  // One write for the whole scan. It used to re-read the list and save inside the loop, which is why a
  // path repaired in memory could not survive: the next iteration reloaded the stored copy over it.
  if (repairedPaths) await saveModelsList(registeredModels);

  return discoveredModels;
}
