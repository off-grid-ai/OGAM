import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { modelManager, backgroundDownloadService } from '../../services';
import { resolveCoreMLModelDir } from '../../utils/coreMLModelUtils';
import { ONNXImageModel } from '../../types';
import { useDownloadStore, DownloadEntry } from '../../stores/downloadStore';
import { ImageDownloadDeps, registerAndNotify } from './imageDownloadActions';
import { validateImageModelDir, ensureImageExtractionComplete } from '../../utils/imageModelIntegrity';
import { makeImageModelKey } from '../../utils/modelKey';
import logger from '../../utils/logger';

type ResumeCtx = { entry: DownloadEntry; modelId: string; metadata: Record<string, any>; deps: ImageDownloadDeps };

function getExpectedZipBytes(entry: DownloadEntry): number {
  return entry.totalBytes || entry.combinedTotalBytes || 0;
}

async function validateModelDir(modelDir: string, backend?: string): Promise<boolean> {
  if (!(await RNFS.exists(modelDir))) return false;
  try {
    const dirItems = await RNFS.readDir(modelDir);
    if (dirItems.length === 0) {
      return false;
    }
    // For mnn/qnn, "has files" is not enough — a partial extraction (missing pos_emb.bin
    // / a *.mnn.weight) must count as INVALID so resume cleans it up and re-extracts,
    // rather than registering a broken model that crashes at generation time.
    if (backend === 'mnn' || backend === 'qnn') {
      const { complete } = await validateImageModelDir(modelDir, backend);
      return complete;
    }
    return true;
  } catch {
    return false;
  }
}

async function validateZipArtifact(zipPath: string, expectedBytes: number): Promise<boolean> {
  if (!(await RNFS.exists(zipPath))) return false;

  let actualSize = 0;
  try {
    const zipStat = await RNFS.stat(zipPath);
    actualSize = Number(zipStat.size);
  } catch {
    return false;
  }

  if (!Number.isFinite(actualSize) || actualSize <= 0) {
    return false;
  }

  if (expectedBytes > 0) {
    const sizeDiffPercent = Math.abs(actualSize - expectedBytes) / expectedBytes;
    if (sizeDiffPercent > 0.001) {
      return false;
    }
  }

  try {
    const header = await RNFS.read(zipPath, 4, 0, 'ascii');
    if (!header.startsWith('PK')) {
      return false;
    }
  } catch {
    // RNFS.read() can be flaky on some bridges. Size validation is the stronger
    // signal here, so treat header-read failure as inconclusive rather than fatal.
  }

  return true;
}

async function cleanupInvalidArtifact(path: string): Promise<void> {
  try {
    await RNFS.unlink(path);
  } catch {
    // Best-effort cleanup only.
  }
}

async function resumeZipDownload(ctx: ResumeCtx): Promise<void> {
  const { entry, modelId, metadata, deps } = ctx;
  const imageModelsDir = modelManager.getImageModelsDirectory();
  const modelDir = `${imageModelsDir}/${modelId}`;
  const zipPath = `${imageModelsDir}/${entry.fileName}`;
  const isCoreml = metadata.imageModelBackend === 'coreml';
  const expectedZipBytes = getExpectedZipBytes(entry);

  const buildModel = async (dir: string): Promise<ONNXImageModel> => {
    const resolvedDir = isCoreml ? await resolveCoreMLModelDir(dir) : dir;
    return {
      id: modelId, name: metadata.imageModelName, description: metadata.imageModelDescription,
      modelPath: resolvedDir, downloadedAt: new Date().toISOString(),
      size: metadata.imageModelSize, style: metadata.imageModelStyle,
      backend: metadata.imageModelBackend, attentionVariant: metadata.imageModelAttentionVariant,
    };
  };

  const modelDirExists = await RNFS.exists(modelDir);
  const zipExists = await RNFS.exists(zipPath);
  const modelDirValid = await validateModelDir(modelDir, metadata.imageModelBackend);
  const zipValid = await validateZipArtifact(zipPath, expectedZipBytes);

  if (modelDirExists && !modelDirValid) {
    await cleanupInvalidArtifact(modelDir);
  }
  if (zipExists && !zipValid) {
    await cleanupInvalidArtifact(zipPath);
  }

  if (modelDirValid) {
    const existingModels = await modelManager.getDownloadedImageModels();
    if (existingModels.some(m => m.id === modelId)) {
      // Already registered — stale native row caused a spurious processing entry.
      // Remove the download entry silently without re-alerting the user.
      logger.log(`[ImageDownload] resumeImageDownload zip - already registered, removing stale entry ${modelId}`);
      useDownloadStore.getState().remove(makeImageModelKey(modelId));
      return;
    }
    logger.log(`[ImageDownload] resumeImageDownload zip - model dir exists, registering ${modelId}`);
    await registerAndNotify(deps, { imageModel: await buildModel(modelDir), modelName: metadata.imageModelName });
    return;
  }

  if (zipValid) {
    if (!(await RNFS.exists(modelDir))) await RNFS.mkdir(modelDir);
    await RNFS.writeFile(`${modelDir}/_zip_name`, entry.fileName, 'utf8').catch(() => {});
    try {
      await unzip(zipPath, modelDir);
      await ensureImageExtractionComplete({ backend: metadata.imageModelBackend, modelDir, zipPath, modelId });
    } catch (error) {
      await RNFS.unlink(modelDir).catch(() => {});
      throw error;
    }
    await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
    await RNFS.unlink(zipPath).catch(() => {});
    logger.log(`[ImageDownload] resumeImageDownload zip - zip found, unzipping ${modelId}`);
    await registerAndNotify(deps, { imageModel: await buildModel(modelDir), modelName: metadata.imageModelName });
    return;
  }

  if (!(await RNFS.exists(imageModelsDir))) await RNFS.mkdir(imageModelsDir);
  try {
    await backgroundDownloadService.moveCompletedDownload(entry.downloadId, zipPath);
  } catch (error) {
    const recoveredModelDirValid = await validateModelDir(modelDir, metadata.imageModelBackend);
    const recoveredZipValid = await validateZipArtifact(zipPath, expectedZipBytes);
    if (recoveredModelDirValid) {
      await registerAndNotify(deps, { imageModel: await buildModel(modelDir), modelName: metadata.imageModelName });
      return;
    }
    if (!recoveredZipValid) throw error;
  }
  if (!(await RNFS.exists(modelDir))) await RNFS.mkdir(modelDir);
  await RNFS.writeFile(`${modelDir}/_zip_name`, entry.fileName, 'utf8').catch(() => {});
  try {
    await unzip(zipPath, modelDir);
    await ensureImageExtractionComplete({ backend: metadata.imageModelBackend, modelDir, zipPath, modelId });
  } catch (error) {
    await RNFS.unlink(modelDir).catch(() => {});
    throw error;
  }
  await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
  await RNFS.unlink(zipPath).catch(() => {});
  logger.log(`[ImageDownload] resumeImageDownload zip - moved from WorkManager, unzipping ${modelId}`);
  await registerAndNotify(deps, { imageModel: await buildModel(modelDir), modelName: metadata.imageModelName });
}

async function resumeMultifileDownload(ctx: ResumeCtx): Promise<void> {
  const { entry, modelId, metadata, deps } = ctx;
  const modelDir = `${modelManager.getImageModelsDirectory()}/${modelId}`;
  const modelDirExists = await RNFS.exists(modelDir);
  if (!modelDirExists) {
    logger.warn(`[ImageDownload] resumeImageDownload multifile - model dir missing, marking failed ${modelId}`);
    useDownloadStore.getState().setStatus(entry.downloadId, 'failed', { message: 'Download files missing. Please retry.' });
    return;
  }
  const imageModel: ONNXImageModel = {
    id: modelId, name: metadata.imageModelName, description: metadata.imageModelDescription,
    modelPath: modelDir, downloadedAt: new Date().toISOString(),
    size: metadata.imageModelSize, style: metadata.imageModelStyle,
    backend: metadata.imageModelBackend,
  };
  logger.log(`[ImageDownload] resumeImageDownload multifile - registering ${modelId}`);
  await registerAndNotify(deps, { imageModel, modelName: metadata.imageModelName });
}

export async function resumeImageDownload(entry: DownloadEntry, deps: ImageDownloadDeps): Promise<void> {
  const modelId = entry.modelId.replace('image:', '');
  logger.log(`[ImageDownload] resumeImageDownload modelId=${modelId} downloadId=${entry.downloadId}`);

  let metadata: Record<string, any> | null = null;
  try { metadata = entry.metadataJson ? JSON.parse(entry.metadataJson) : null; } catch { /* ignore */ }

  if (!metadata?.imageDownloadType) {
    logger.warn(`[ImageDownload] resumeImageDownload no metadata for ${modelId} - marking failed`);
    useDownloadStore.getState().setStatus(entry.downloadId, 'failed', { message: 'Could not resume: missing download metadata' });
    return;
  }

  try {
    if (metadata.imageDownloadType === 'zip') {
      await resumeZipDownload({ entry, modelId, metadata, deps });
    } else if (metadata.imageDownloadType === 'multifile') {
      await resumeMultifileDownload({ entry, modelId, metadata, deps });
    }
  } catch (error: any) {
    logger.error(`[ImageDownload] resumeImageDownload failed for ${modelId}`, error?.message);
    useDownloadStore.getState().setStatus(entry.downloadId, 'failed', { message: error?.message || 'Could not resume download after restart' });
  }
}
