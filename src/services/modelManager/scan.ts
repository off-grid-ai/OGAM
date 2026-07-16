import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { DownloadedModel, LlamaDownloadedModel, LiteRTDownloadedModel, ModelFile, ONNXImageModel, ModelEngine } from '../../types';
import { buildDownloadedModel, persistDownloadedModel, loadDownloadedModels, saveModelsList } from './storage';
import { copyFileWithProgress } from './copyFile';
import { resolveCoreMLModelDir } from '../../utils/coreMLModelUtils';
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

function detectBackend(dirName: string): 'mnn' | 'qnn' | 'coreml' {
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
    const stat = await RNFS.stat(zipPath);
    const size = parseSizeInt(stat.size);
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
        // Unzip completed but registerAndNotify was killed — register now.
        const backend = detectBackend(item.name);
        let modelPath = item.path;
        if (backend === 'coreml') {
          modelPath = await resolveCoreMLModelDir(item.path).catch(() => item.path);
        }
        const totalSize = await getDirSize(item.path);
        const newModel: ONNXImageModel = {
          id: item.name,
          name: item.name.replaceAll('_', ' '),
          description: '',
          modelPath,
          size: totalSize,
          downloadedAt: new Date().toISOString(),
          backend,
        };
        await addImageModel(newModel);
        recovered.push(newModel);
        continue;
      }

      // No _ready — check if a zip exists to re-unzip (mid-unzip kill).
      const zipNamePath = `${item.path}/_zip_name`;
      const hasZipName = await RNFS.exists(zipNamePath);

      if (hasZipName) {
        try {
          const zipFileName = (await RNFS.readFile(zipNamePath, 'utf8')).trim();
          const zipPath = `${imageModelsDir}/${zipFileName}`;
          const zipOk = await isValidZip(zipPath);

          if (zipOk) {
            await unzip(zipPath, item.path);
            await RNFS.unlink(zipPath).catch(() => {});
            await RNFS.writeFile(readyPath, '', 'utf8').catch(() => {});
            const backend = detectBackend(item.name);
            let modelPath = item.path;
            if (backend === 'coreml') {
              modelPath = await resolveCoreMLModelDir(item.path).catch(() => item.path);
            }
            const totalSize = await getDirSize(item.path);
            const newModel: ONNXImageModel = {
              id: item.name,
              name: item.name.replaceAll('_', ' '),
              description: '',
              modelPath,
              size: totalSize,
              downloadedAt: new Date().toISOString(),
              backend,
            };
            await addImageModel(newModel);
            recovered.push(newModel);
          } else {
            // Zip is gone or corrupt — partial dir is unrecoverable, clean up.
            await RNFS.unlink(item.path).catch(() => {});
          }
        } catch {
          // Non-fatal: leave for the next startup attempt.
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
  const registeredPaths = new Set(registeredModels.map(m => m.modelPath));

  const dirExists = await RNFS.exists(imageModelsDir);
  if (!dirExists) return discoveredModels;

  const items = await RNFS.readDir(imageModelsDir);

  for (const item of items) {
    if (!item.isDirectory() || registeredPaths.has(item.path)) continue;

    const totalSize = await getDirSize(item.path);
    if (totalSize === 0) continue;

    const newModel: ONNXImageModel = {
      id: `recovered_${item.name}_${Date.now()}`,
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
  const registeredPaths = new Set(registeredModels.map(m => m.filePath));

  const dirExists = await RNFS.exists(modelsDir);
  if (!dirExists) return discoveredModels;

  const items = await RNFS.readDir(modelsDir);

  for (const item of items) {
    const lowerName = item.name.toLowerCase();
    const isMmProj = isMMProjFile(lowerName);
    if (!item.isFile() || !item.name.endsWith('.gguf') || registeredPaths.has(item.path) || isMmProj) {
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
      id: `recovered_${item.name}_${Date.now()}`,
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

    const models = await getModels();
    models.push(newModel);
    await saveModelsList(models);
    discoveredModels.push(newModel);
  }

  return discoveredModels;
}

export interface ImportLocalModelOpts {
  sourceUri: string;
  fileName: string;
  modelsDir: string;
  sourceSize?: number | null;
  engine?: ModelEngine;
  liteRTVision?: boolean;
  onProgress?: (progress: { fraction: number; fileName: string }) => void;
  mmProjSourceUri?: string;
  mmProjFileName?: string;
  mmProjSourceSize?: number | null;
}

function resolveUri(uri: string): string {
  // Android content:// URIs are passed directly to RNFS.copyFile — no cache copy needed.
  // iOS file:// URIs need decoding (%20 → space) so RNFS can find the file on disk.
  if (uri.startsWith('content://')) {
    return uri;
  }
  return decodeURIComponent(uri);
}


export async function importLocalModel(opts: ImportLocalModelOpts): Promise<DownloadedModel> { // NOSONAR
  const { sourceUri, fileName, modelsDir, sourceSize, engine: _engine, liteRTVision, onProgress, mmProjSourceUri, mmProjFileName, mmProjSourceSize } = opts;

  const isLitert = fileName.toLowerCase().endsWith('.litertlm');
  if (!fileName.toLowerCase().endsWith('.gguf') && !isLitert) {
    throw new Error('Only .gguf and .litertlm files can be imported');
  }

  const resolvedSource = resolveUri(sourceUri);
  const resolvedMmProjSource = mmProjSourceUri ? resolveUri(mmProjSourceUri) : undefined;

  const destPath = `${modelsDir}/${fileName}`;
  const destExists = await RNFS.exists(destPath);
  if (destExists) throw new Error(`A model file named "${fileName}" already exists`);
  if (mmProjFileName && await RNFS.exists(`${modelsDir}/${mmProjFileName}`)) {
    throw new Error(`A file named "${mmProjFileName}" already exists`);
  }

  // Copy main model: progress 0→0.5 when mmproj present, 0→1 otherwise
  const mainProgressScale = mmProjFileName ? 0.5 : 1;
  await copyFileWithProgress(resolvedSource, destPath, {
    knownTotalBytes: sourceSize ?? null,
    onProgress: onProgress ? (fraction: number) => onProgress({ fraction: fraction * mainProgressScale, fileName }) : undefined,
  });

  const quantMatch = fileName.match(/[_-](Q\d+[_\w]*|f16|f32)/i);
  const quantization = quantMatch ? quantMatch[1].toUpperCase() : 'Unknown';
  const modelName = fileName.replace(/\.gguf$/i, '').replace(/\.litertlm$/i, '').replace(/[_-]Q\d+.*/i, '');
  const destStat = await RNFS.stat(destPath);
  const fileSize = parseSizeInt(destStat.size);

  const pseudoFile: ModelFile = { name: fileName, size: fileSize, quantization, downloadUrl: '' };
  const baseModel = await buildDownloadedModel({ modelId: 'local_import', file: pseudoFile, resolvedLocalPath: destPath });
  const baseFields = {
    id: `local_import/${fileName}`,
    name: modelName,
    author: 'Local Import',
    credibility: { source: 'community' as const, isOfficial: false, isVerifiedQuantizer: false },
  };

  if (isLitert) {
    const liteRTModel: LiteRTDownloadedModel = {
      ...baseModel, ...baseFields, engine: 'litert', liteRTVision: liteRTVision ?? false,
    };
    await persistDownloadedModel(liteRTModel, modelsDir);
    return liteRTModel;
  }

  const llamaModel: LlamaDownloadedModel = { ...baseModel, ...baseFields, engine: 'llama' };

  // Copy mmproj and link it to the model: progress 0.5→1
  if (mmProjFileName && resolvedMmProjSource) {
    const mmProjDestPath = `${modelsDir}/${mmProjFileName}`;
    await copyFileWithProgress(resolvedMmProjSource, mmProjDestPath, {
      knownTotalBytes: mmProjSourceSize ?? null,
      onProgress: onProgress
        ? (fraction: number) => onProgress({ fraction: 0.5 + fraction * 0.5, fileName: mmProjFileName })
        : undefined,
    });
    const mmProjStat = await RNFS.stat(mmProjDestPath);
    llamaModel.mmProjPath = mmProjDestPath;
    llamaModel.mmProjFileName = mmProjFileName;
    llamaModel.mmProjFileSize = parseSizeInt(mmProjStat.size);
    llamaModel.isVisionModel = true;
  }

  await persistDownloadedModel(llamaModel, modelsDir);
  return llamaModel;
}
