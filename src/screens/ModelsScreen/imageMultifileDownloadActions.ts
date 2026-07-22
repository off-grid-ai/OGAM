import RNFS from 'react-native-fs';
import { showAlert } from '../../components/CustomAlert';
import { backgroundDownloadService, modelManager } from '../../services';
import { useDownloadStore } from '../../stores/downloadStore';
import { getUserFacingDownloadMessage } from '../../utils/downloadErrors';
import {
  downloadCoreMLTokenizerFiles,
  resolveCoreMLModelDir,
} from '../../utils/coreMLModelUtils';
import { makeImageModelKey } from '../../utils/modelKey';
import {
  clearDownloadInProcess,
  markDownloadInProcess,
} from '../../services/inProcessDownloadRegistry';
import { ImageDownloadDeps, ImageModelDescriptor } from './types';
import {
  addImageDownloadEntry,
  buildDownloadedImageModel,
  cleanupImageModelDir,
  isCancelledDownloadError,
  registerAndNotify,
} from './imageDownloadShared';

type MultifileRuntime = {
  cancelled: boolean;
  currentDownloadId?: string;
};

type MultifileDownloadSpec = {
  relativePath: string;
  size: number;
  url: string;
};

const activeMultifileDownloads = new Map<string, MultifileRuntime>();
const USER_CANCELLED_ERROR = 'user_cancelled';

function makeMultifileId(modelId: string): string {
  return `image-multi:${modelId}`;
}

function startMultifileRuntime(modelId: string): MultifileRuntime {
  const runtime: MultifileRuntime = { cancelled: false };
  activeMultifileDownloads.set(modelId, runtime);
  // Announce this JS-driven transfer as live so a foreground hydrate does not strand it to "failed"
  // (it has no native download row while the per-file loop runs).
  markDownloadInProcess(makeImageModelKey(modelId));
  return runtime;
}

function assertNotCancelled(modelId: string, runtime: MultifileRuntime): void {
  const stillVisible =
    !!useDownloadStore.getState().downloads[makeImageModelKey(modelId)];
  if (runtime.cancelled || !stillVisible) {
    runtime.cancelled = true;
    throw new Error(USER_CANCELLED_ERROR);
  }
}

function wireCurrentDownloadPromise(
  downloadIdPromise: Promise<string> | undefined,
  runtime: MultifileRuntime,
): void {
  if (downloadIdPromise === undefined) return;
  downloadIdPromise
    .then(downloadId => {
      runtime.currentDownloadId = downloadId;
      if (runtime.cancelled) {
        backgroundDownloadService.cancelDownload(downloadId).catch(() => {});
      }
    })
    .catch(() => {});
}

export async function cancelSyntheticImageDownload(
  modelId: string,
): Promise<void> {
  const runtime = activeMultifileDownloads.get(modelId);
  if (!runtime) return;
  runtime.cancelled = true;
  backgroundDownloadService.cancelQueued(makeImageModelKey(modelId));
  if (runtime.currentDownloadId) {
    await backgroundDownloadService
      .cancelDownload(runtime.currentDownloadId)
      .catch(() => {});
  }
}

async function ensureDirectory(path: string): Promise<void> {
  if (!(await RNFS.exists(path))) await RNFS.mkdir(path);
}

async function downloadSequentialFiles(opts: {
  modelInfo: ImageModelDescriptor;
  runtime: MultifileRuntime;
  syntheticId: string;
  modelDir: string;
  files: MultifileDownloadSpec[];
}): Promise<void> {
  const { modelInfo, runtime, syntheticId, modelDir, files } = opts;
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  let downloadedSize = 0;

  for (const file of files) {
    assertNotCancelled(modelInfo.id, runtime);
    const filePath = `${modelDir}/${file.relativePath}`;
    await ensureDirectory(filePath.substring(0, filePath.lastIndexOf('/')));
    const capturedDownloadedSize = downloadedSize;
    const { downloadIdPromise, promise } =
      backgroundDownloadService.downloadFileTo({
        params: {
          url: file.url,
          fileName: `${modelInfo.id}_${file.relativePath.replaceAll('/', '_')}`,
          modelId: `image:${modelInfo.id}`,
          modelType: 'image',
          totalBytes: file.size,
        },
        destPath: filePath,
        onProgress: bytesDownloaded => {
          if (runtime.cancelled) return;
          useDownloadStore
            .getState()
            .updateProgress(
              syntheticId,
              capturedDownloadedSize + bytesDownloaded,
              totalSize,
            );
        },
      });
    wireCurrentDownloadPromise(downloadIdPromise, runtime);
    await promise;
    runtime.currentDownloadId = undefined;
    downloadedSize += file.size;
    useDownloadStore
      .getState()
      .updateProgress(syntheticId, downloadedSize, totalSize);
  }
}

async function validateMultifileComplete(
  modelDir: string,
  files: MultifileDownloadSpec[],
): Promise<void> {
  for (const file of files) {
    const stat = await RNFS.stat(`${modelDir}/${file.relativePath}`).catch(
      () => null,
    );
    const size = stat
      ? typeof stat.size === 'string'
        ? Number.parseInt(stat.size, 10)
        : stat.size
      : -1;
    if (size <= 0) {
      throw new Error(
        `Downloaded file missing or empty: ${file.relativePath} — tap retry`,
      );
    }
  }
}

function setMultifileFailed(
  syntheticId: string,
  deps: ImageDownloadDeps,
  message?: string,
): void {
  deps.setAlertState(
    showAlert('Download Failed', getUserFacingDownloadMessage(message)),
  );
  useDownloadStore.getState().setStatus(syntheticId, 'failed', {
    message: message || 'Multi-file download failed',
  });
}

export async function downloadHuggingFaceModel(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (!modelInfo.huggingFaceRepo || !modelInfo.huggingFaceFiles) {
    deps.setAlertState(
      showAlert('Error', 'Invalid HuggingFace model configuration'),
    );
    return;
  }
  const syntheticId = makeMultifileId(modelInfo.id);
  const created = addImageDownloadEntry({
    modelId: modelInfo.id,
    downloadId: syntheticId,
    fileName: modelInfo.id,
    totalBytes: modelInfo.size,
    metadata: {
      imageDownloadType: 'multifile',
      imageModelName: modelInfo.name,
      imageModelDescription: modelInfo.description,
      imageModelSize: modelInfo.size,
      imageModelStyle: modelInfo.style,
      imageModelBackend: modelInfo.backend,
      imageModelRepo: modelInfo.huggingFaceRepo,
      imageModelHuggingFaceFiles: modelInfo.huggingFaceFiles,
    },
  });
  if (!created) return;
  const runtime = startMultifileRuntime(modelInfo.id);
  try {
    const modelDir = `${modelManager.getImageModelsDirectory()}/${
      modelInfo.id
    }`;
    await ensureDirectory(modelManager.getImageModelsDirectory());
    await ensureDirectory(modelDir);
    const files = modelInfo.huggingFaceFiles.map(file => ({
      relativePath: file.path,
      size: file.size,
      url: `https://huggingface.co/${modelInfo.huggingFaceRepo}/resolve/main/${file.path}`,
    }));
    await downloadSequentialFiles({
      modelInfo,
      runtime,
      syntheticId,
      modelDir,
      files,
    });
    assertNotCancelled(modelInfo.id, runtime);
    await validateMultifileComplete(modelDir, files);
    useDownloadStore.getState().setProcessing(syntheticId);
    assertNotCancelled(modelInfo.id, runtime);
    await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
    await registerAndNotify(deps, {
      imageModel: buildDownloadedImageModel(modelInfo, modelDir),
      modelName: modelInfo.name,
    });
  } catch (error: any) {
    if (isCancelledDownloadError(error)) {
      await cleanupImageModelDir(modelInfo.id);
      return;
    }
    setMultifileFailed(syntheticId, deps, error?.message);
    await cleanupImageModelDir(modelInfo.id);
  } finally {
    activeMultifileDownloads.delete(modelInfo.id);
    clearDownloadInProcess(makeImageModelKey(modelInfo.id));
  }
}

export async function downloadCoreMLMultiFile(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (!modelInfo.coremlFiles?.length) return;
  const syntheticId = makeMultifileId(modelInfo.id);
  const created = addImageDownloadEntry({
    modelId: modelInfo.id,
    downloadId: syntheticId,
    fileName: modelInfo.id,
    totalBytes: modelInfo.size,
    metadata: {
      imageDownloadType: 'multifile',
      imageModelName: modelInfo.name,
      imageModelDescription: modelInfo.description,
      imageModelSize: modelInfo.size,
      imageModelStyle: modelInfo.style,
      imageModelBackend: modelInfo.backend,
      imageModelRepo: modelInfo.repo,
      imageModelAttentionVariant: modelInfo.attentionVariant,
      imageModelCoremlFiles: modelInfo.coremlFiles,
    },
  });
  if (!created) return;
  const runtime = startMultifileRuntime(modelInfo.id);
  try {
    const modelDir = `${modelManager.getImageModelsDirectory()}/${
      modelInfo.id
    }`;
    await ensureDirectory(modelManager.getImageModelsDirectory());
    await ensureDirectory(modelDir);
    const files = modelInfo.coremlFiles.map(file => ({
      relativePath: file.relativePath,
      size: file.size,
      url: file.downloadUrl,
    }));
    await downloadSequentialFiles({
      modelInfo,
      runtime,
      syntheticId,
      modelDir,
      files,
    });
    assertNotCancelled(modelInfo.id, runtime);
    await validateMultifileComplete(modelDir, files);
    useDownloadStore.getState().setProcessing(syntheticId);
    assertNotCancelled(modelInfo.id, runtime);
    await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(() => {});
    const resolvedModelDir = await resolveCoreMLModelDir(modelDir);
    await registerAndNotify(deps, {
      imageModel: buildDownloadedImageModel(modelInfo, resolvedModelDir),
      modelName: modelInfo.name,
    });
    if (modelInfo.repo) {
      downloadCoreMLTokenizerFiles(resolvedModelDir, modelInfo.repo).catch(
        () => {},
      );
    }
  } catch (error: any) {
    await cleanupImageModelDir(modelInfo.id);
    if (isCancelledDownloadError(error)) return;
    deps.setAlertState(
      showAlert(
        'Download Failed',
        getUserFacingDownloadMessage(error?.message),
      ),
    );
    useDownloadStore.getState().setStatus(syntheticId, 'failed', {
      message: error?.message || 'CoreML download failed',
    });
  } finally {
    activeMultifileDownloads.delete(modelInfo.id);
    clearDownloadInProcess(makeImageModelKey(modelInfo.id));
  }
}
