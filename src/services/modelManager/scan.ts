import { getSDImageModels, getSDImagePackFiles, isSDImageWeight } from '../huggingFaceModelBrowser';
import RNFS from 'react-native-fs';
import { statFile } from '../../utils/fileStat';
import { unzip } from 'react-native-zip-archive';
import { DownloadedModel, LlamaDownloadedModel, ONNXImageModel } from '../../types';
import { loadDownloadedModels, saveModelsList } from './storage';
import { basenameOf } from './reconcileStoredPaths';
import { resolveCoreMLModelDir } from '../../utils/coreMLModelUtils';
import { ensureImageExtractionComplete, validateMultifileComplete, validateImageModelDir } from '../../utils/imageModelIntegrity';
// Single source of truth for projector detection + model↔projector matching (see src/services/mmproj.ts).
import { isMMProjFile, pickMmProjForModel } from '../mmproj';

export { isMMProjFile };

function parseSizeInt(size: string | number): number {
  return typeof size === 'string' ? Number.parseInt(size, 10) : size;
}

async function getDirSize(dirPath: string): Promise<number> {
  try {
    const dirFiles = await RNFS.readDir(dirPath);
    let total = 0;
    for (const f of dirFiles) {
      if (f.isFile()) {
        total += parseSizeInt(f.size);
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
  const match = fileName.match(/^(.+?)[-_](?:Q\d|q\d|F\d|f\d)/i);
  return match ? match[1].toLowerCase() : fileName.toLowerCase().replace('.gguf', '');
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
    model.mmProjFileSize = parseSizeInt(match.size);
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

function detectBackend(dirName: string): 'mnn' | 'qnn' | 'coreml' | 'sd' {
  if (dirName.startsWith('sd-')) return 'sd';
  if (dirName.includes('qnn') || dirName.includes('8gen') || dirName.includes('npu')) return 'qnn';
  if (dirName.includes('coreml')) return 'coreml';
  return 'mnn';
}

const MIN_RECOVERED_TEXT_MODEL_BYTES = 100 * 1024 * 1024;

function isUnknownLike(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized === 'unknown';
}

function shouldSkipSuspiciousRecoveredTextModel(author: string, quantization: string): boolean {
  if (isUnknownLike(author) || isUnknownLike(quantization)) {
    return true;
  }
  return false;
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
  backend: 'mnn' | 'qnn' | 'coreml' | 'sd',
): Promise<ONNXImageModel> {
  let modelPath = item.path;
  if (backend === 'coreml') modelPath = await resolveCoreMLModelDir(item.path).catch(() => item.path);
  const totalSize = await getDirSize(item.path);
  const sdWeight = backend === 'sd' ? (await RNFS.readDir(item.path)).find(file => file.isFile() && isSDImageWeight(file.name))?.name : undefined;
  return {
    id: item.name,
    name: getSDImageModels().find(model => model.id === item.name)?.displayName ?? (sdWeight ? sdWeight.replace(/\.(gguf|safetensors)$/i, '') : item.name.replaceAll('_', ' ')),
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
  const backend = detectBackend(item.name);
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
  const { imageModelsDir, getImageModels, addImageModel, activeModelIds } = opts;
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
      if (registeredIds.has(item.name)) continue;
      if (activeModelIds.has(item.name)) continue;

      // Legacy recovered_ entry: path matches but ID has recovered_<name>_<ts> prefix.
      // Migrate to a real ID so the model shows in the UI after the appStore filter lands.
      const legacyEntry = registeredModels.find(
        m => m.modelPath === item.path && m.id.startsWith('recovered_'),
      );
      if (legacyEntry) {
        try {
          await RNFS.writeFile(`${item.path}/_ready`, '', 'utf8').catch(() => {});
          const backend = detectBackend(item.name);
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
        } catch {
          // Non-fatal — leave the old entry in place; at least files are safe.
        }
        continue;
      }

      // Directory is referenced by a properly-registered model — nothing to do.
      if (registeredPaths.has(item.path)) continue;

      const readyPath = `${item.path}/_ready`;
      const hasReady = await RNFS.exists(readyPath);

      if (hasReady) {
        if (detectBackend(item.name) === 'sd' && !(await validateImageModelDir(item.path, 'sd')).complete) continue;
        // Unzip completed but registerAndNotify was killed — register now.
        const newModel = await buildRecoveredImageModel(item, detectBackend(item.name));
        await addImageModel(newModel);
        recovered.push(newModel);
        continue;
      }

      // A complete SD pack can survive a stop between its last file and _ready.
      // Keep partial known packs so the normal download can reuse valid parts.
      const sdFiles = item.name.startsWith('sd-') ? getSDImagePackFiles((await RNFS.readDir(item.path)).filter(file => file.isFile()).map(file => file.name), item.name) : null;
      if (item.name.startsWith('sd-')) {
        try {
          // A remote variant's expected weight bytes/hash live in its download
          // metadata, not the catalog. Let Resume validate that descriptor; a
          // nonempty partial GGUF alone cannot prove this pack is complete.
          if (!sdFiles || sdFiles.some(file => !file.sha256)) continue;
          await validateMultifileComplete(item.path, sdFiles.map(file => ({
            relativePath: file.path, sha256: file.sha256,
          })));
          await RNFS.writeFile(readyPath, '', 'utf8');
          const model = await buildRecoveredImageModel(item, 'sd');
          await addImageModel(model);
          recovered.push(model);
        } catch {
          // Incomplete or damaged parts stay unregistered until Download repairs them.
        }
        continue;
      }

      // No _ready — check if a zip exists to re-unzip (mid-unzip kill).
      if (await RNFS.exists(`${item.path}/_zip_name`)) {
        // Non-fatal on unexpected error: leave the dir for the next startup attempt.
        const model = await recoverImageModelFromZipRemnant(item, imageModelsDir).catch(() => null);
        if (model) {
          await addImageModel(model);
          recovered.push(model);
        }
      } else {
        // No _ready and no _zip_name — stale artifact from a cancelled or
        // pre-sentinel download. Delete to free space.
        await RNFS.unlink(item.path).catch(() => {});
      }
    }
  } catch {
    // Reconciliation errors must not crash startup.
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
  const registeredDirNames = new Set(registeredModels.map(m => basenameOf(m.modelPath)));

  const dirExists = await RNFS.exists(imageModelsDir);
  if (!dirExists) return discoveredModels;

  const items = await RNFS.readDir(imageModelsDir);

  for (const item of items) {
    if (!item.isDirectory() || registeredDirNames.has(item.name)) continue;

    const totalSize = await getDirSize(item.path);
    if (totalSize === 0) continue;

    const newModel: ONNXImageModel = {
      // Derived from the directory name and NOTHING else. `Date.now()` meant the same directory
      // adopted twice produced two ids nothing downstream could reconcile, and anything holding the
      // previous id (the selected image model) dangled. A name is unique here, so this id is stable
      // across every scan, reinstall and container move.
      id: `recovered_${item.name}`,
      name: item.name.replaceAll('_', ' ').replaceAll(/\.(zip|tar|gz)$/gi, ''),
      description: `Recovered ${item.name} model`,
      modelPath: item.path,
      size: totalSize,
      downloadedAt: new Date().toISOString(),
      backend: detectBackend(item.name),
    };

    await addImageModel(newModel);
    discoveredModels.push(newModel);
  }

  return discoveredModels;
}

export async function scanForUntrackedTextModels(
  modelsDir: string,
  getModels: () => Promise<DownloadedModel[]>,
): Promise<DownloadedModel[]> {
  const discoveredModels: DownloadedModel[] = [];

  try {
    return await doScanForUntrackedTextModels(modelsDir, getModels);
  } catch {
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
  const registeredByFileName = new Map(
    registeredModels
      .filter(model => model.fileName)
      .map(model => [model.fileName, model] as const),
  );
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
    if (!item.isFile() || !item.name.endsWith('.gguf') || isMmProj) {
      continue;
    }

    // Already known. REPAIR the row's path rather than adding a second row for the same file: that is
    // the whole difference between a registry that survives a reinstall and one that grows a duplicate
    // on every launch.
    const known = registeredByFileName.get(item.name);
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

    const fileSize = parseSizeInt(item.size);
    if (fileSize < 1_000_000) continue;

    const quantMatch = item.name.match(/[_-](Q\d+[_\w]*|f16|f32)/i);
    const quantization = quantMatch ? quantMatch[1].toUpperCase() : 'Unknown';
    const author = 'Unknown';

    if (shouldSkipSuspiciousRecoveredTextModel(author, quantization) && fileSize < MIN_RECOVERED_TEXT_MODEL_BYTES) {
      continue;
    }

    const newModel: LlamaDownloadedModel = {
      // Derived from the file name and NOTHING else. `Date.now()` in an id meant the same file adopted
      // twice produced two different ids, so nothing downstream could ever tell them apart - and the
      // registry had no way back to one row per file. A name is unique in this directory, so this id is
      // stable across every scan, reinstall and container move.
      id: `recovered_${item.name}`,
      name: item.name.replace(/\.gguf$/i, '').replace(/[_-]Q\d+.*/i, ''),
      author,
      filePath: item.path,
      fileName: item.name,
      fileSize,
      quantization,
      downloadedAt: new Date().toISOString(),
      credibility: { source: 'community', isOfficial: false, isVerifiedQuantizer: false },
      engine: 'llama',
    };

    // Adopted WITH its projector, so a recovered vision model is a vision model.
    linkMmProjToModel(newModel, mmProjFiles);
    registeredModels.push(newModel);
    registeredByFileName.set(newModel.fileName, newModel);
    repairedPaths = true;
    discoveredModels.push(newModel);
  }

  // One write for the whole scan. It used to re-read the list and save inside the loop, which is why a
  // path repaired in memory could not survive: the next iteration reloaded the stored copy over it.
  if (repairedPaths) await saveModelsList(registeredModels);

  return discoveredModels;
}
