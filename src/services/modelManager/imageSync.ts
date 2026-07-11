import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import logger from '../../utils/logger';
import { ONNXImageModel, PersistedDownloadInfo } from '../../types';
import { backgroundDownloadService } from '../backgroundDownloadService';
import { downloadCoreMLTokenizerFiles, resolveCoreMLModelDir } from '../../utils/coreMLModelUtils';

interface SyncCompletedImageDownloadsOpts {
  imageModelsDir: string;
  persistedDownloads: Record<string, PersistedDownloadInfo>;
  clearDownloadCallback: (downloadId: string) => void;
  getDownloadedImageModels: () => Promise<ONNXImageModel[]>;
  addDownloadedImageModel: (model: ONNXImageModel) => Promise<void>;
}

function isRecoverableImageDownload(metadata: PersistedDownloadInfo | undefined): metadata is PersistedDownloadInfo {
  return !!metadata && metadata.modelId.startsWith('image:') && !!metadata.imageDownloadType;
}

function buildRecoveredImageModel(
  metadata: PersistedDownloadInfo,
  imageModelId: string,
  modelPath: string,
): ONNXImageModel {
  return {
    id: imageModelId,
    name: metadata.imageModelName || imageModelId,
    description: metadata.imageModelDescription || 'Recovered image model',
    modelPath,
    downloadedAt: new Date().toISOString(),
    size: metadata.imageModelSize || metadata.totalBytes,
    style: metadata.imageModelStyle,
    backend: metadata.imageModelBackend as ONNXImageModel['backend'],
  };
}

async function recoverZipDownload(opts: {
  metadata: PersistedDownloadInfo;
  downloadId: string;
  imageModelsDir: string;
  modelDir: string;
}): Promise<string> {
  const { metadata, downloadId, imageModelsDir, modelDir } = opts;
  const zipPath = `${imageModelsDir}/${metadata.fileName}`;
  if (!(await RNFS.exists(imageModelsDir))) await RNFS.mkdir(imageModelsDir);
  try {
    await backgroundDownloadService.moveCompletedDownload(downloadId, zipPath);
  } catch {
    if (!(await RNFS.exists(zipPath))) throw new Error('Completed image zip not found');
  }

  if (!(await RNFS.exists(modelDir))) await RNFS.mkdir(modelDir);
  await unzip(zipPath, modelDir);
  // [WIRE] real extracted image-model dir listing (name + size) — grounds the integrity/truncation fixtures.
  try {
    const entries = await RNFS.readDir(modelDir);
    logger.log(`[WIRE-UNZIP] ${JSON.stringify({ zipPath, modelDir, files: entries.map(e => ({ name: e.name, size: Number(e.size), isFile: e.isFile() })) })}`);
  } catch (e) { logger.log(`[WIRE-UNZIP] readDir failed for ${modelDir}: ${String(e)}`); }
  await RNFS.unlink(zipPath).catch(() => {});

  if (metadata.imageModelBackend === 'coreml') {
    return resolveCoreMLModelDir(modelDir);
  }
  return modelDir;
}

async function recoverMultifileDownload(
  metadata: PersistedDownloadInfo,
  modelDir: string,
): Promise<string> {
  if (metadata.imageModelBackend === 'coreml' && metadata.imageModelRepo) {
    await downloadCoreMLTokenizerFiles(modelDir, metadata.imageModelRepo);
  }
  return modelDir;
}

export async function syncCompletedImageDownloads(opts: SyncCompletedImageDownloadsOpts): Promise<ONNXImageModel[]> {
  const {
    imageModelsDir,
    persistedDownloads,
    clearDownloadCallback,
    getDownloadedImageModels,
    addDownloadedImageModel,
  } = opts;

  const activeDownloads = await backgroundDownloadService.getActiveDownloads();
  const recovered: ONNXImageModel[] = [];
  const existingModels = await getDownloadedImageModels();
  const existingIds = new Set(existingModels.map(m => m.id));

  for (const download of activeDownloads) {
    if (download.status !== 'completed') continue;
    const metadata = persistedDownloads[download.downloadId];
    if (!isRecoverableImageDownload(metadata)) continue;

    const imageModelId = metadata.modelId.replace('image:', '');
    if (existingIds.has(imageModelId)) {
      clearDownloadCallback(download.downloadId);
      continue;
    }

    try {
      const modelDir = `${imageModelsDir}/${imageModelId}`;
      const modelPath = metadata.imageDownloadType === 'zip'
        ? await recoverZipDownload({
          metadata,
          downloadId: download.downloadId,
          imageModelsDir,
          modelDir,
        })
        : await recoverMultifileDownload(metadata, modelDir);

      const imageModel = buildRecoveredImageModel(metadata, imageModelId, modelPath);
      await addDownloadedImageModel(imageModel);
      existingIds.add(imageModel.id);
      recovered.push(imageModel);
      clearDownloadCallback(download.downloadId);
    } catch {
      // Keep metadata so recovery can be retried on next app start.
    }
  }

  return recovered;
}
