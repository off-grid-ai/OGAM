/** Standalone async image download handlers - no hooks. All download state flows through
 *  useDownloadStore via the stable image:<id> modelKey (single source of truth). */
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import { showAlert } from '../../components/CustomAlert';
import {
  hardwareService,
  backgroundDownloadService,
  modelManager,
} from '../../services';
import { resolveCoreMLModelDir } from '../../utils/coreMLModelUtils';
import { getUserFacingDownloadMessage } from '../../utils/downloadErrors';
import { useDownloadStore, isActiveStatus } from '../../stores/downloadStore';
import { makeImageModelKey } from '../../utils/modelKey';
import { ImageModelDescriptor, ImageDownloadDeps } from './types';
import { getQnnWarningMessage, showQnnWarningAlert } from './imageDownloadQnn';
import { wireZipFinalization } from './imageZipFinalization';
import {
  ensureImageExtractionComplete,
  isImageModelDirUsable,
} from '../../utils/imageModelIntegrity';
import logger from '../../utils/logger';
import {
  addImageDownloadEntry,
  buildDownloadedImageModel,
  cleanupImageModelDir,
  ImageDownloadMetadata,
  isCancelledDownloadError,
  registerAndNotify,
  removeImageDownloadEntry,
} from './imageDownloadShared';
import {
  cancelSyntheticImageDownload,
  downloadCoreMLMultiFile,
  downloadHuggingFaceModel,
} from './imageMultifileDownloadActions';

// Re-export the shared dependency type for existing importers.
export type { ImageDownloadDeps };
export { cancelSyntheticImageDownload, registerAndNotify };

export async function proceedWithDownload(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  deps.setAlertState({
    ...showAlert(
      'Download Started',
      'Keep app open while image model processes',
    ),
    closeLabel: '',
  });
  if (modelInfo.huggingFaceRepo && modelInfo.huggingFaceFiles) {
    await downloadHuggingFaceModel(modelInfo, deps);
    return;
  }
  if (modelInfo.coremlFiles && modelInfo.coremlFiles.length > 0) {
    await downloadCoreMLMultiFile(modelInfo, deps);
    return;
  }

  // Zip flow: native WorkManager downloads; useDownloads routes progress; we wire completion.
  const fileName = `${modelInfo.id}.zip`;
  const metadata: ImageDownloadMetadata = {
    imageDownloadType: 'zip',
    imageModelName: modelInfo.name,
    imageModelDescription: modelInfo.description,
    imageModelSize: modelInfo.size,
    imageModelStyle: modelInfo.style,
    imageModelBackend: modelInfo.backend,
    imageModelAttentionVariant: modelInfo.attentionVariant,
    imageModelDownloadUrl: modelInfo.downloadUrl,
  };
  const modelKey = makeImageModelKey(modelInfo.id);
  const existing = useDownloadStore.getState().downloads[modelKey];
  if (existing && isActiveStatus(existing.status)) return;

  // Register an existing directory only after the integrity owner proves it is
  // usable. A failed/interrupted extraction can leave a non-empty partial tree;
  // publishing it here turns Retry into a false success and defers the failure to
  // native generation. Invalid remnants are discarded before the clean download.
  const imageModelsDir = modelManager.getImageModelsDirectory();
  const modelDir = `${imageModelsDir}/${modelInfo.id}`;
  if (await RNFS.exists(modelDir)) {
    if (await isImageModelDirUsable(modelDir, modelInfo.backend)) {
      const resolvedModelDir =
        modelInfo.backend === 'coreml'
          ? await resolveCoreMLModelDir(modelDir)
          : modelDir;
      logger.log(
        `[ImageDownload] proceedWithDownload zip - validated files exist on disk, registering directly modelId=${modelInfo.id}`,
      );
      await registerAndNotify(deps, {
        imageModel: buildDownloadedImageModel(modelInfo, resolvedModelDir),
        modelName: modelInfo.name,
      });
      return;
    }
    logger.warn(
      `[ImageDownload] proceedWithDownload zip - removing incomplete model dir modelId=${modelInfo.id}`,
    );
    await cleanupImageModelDir(modelInfo.id);
  }

  // Publish a QUEUED row IMMEDIATELY, before awaiting the (slot-limited) native start (same
  // pattern as text) — else a queued image download has no store entry until a slot frees.
  const placeholderId = `queued:${modelKey}`; // reconciled to the real id on start
  const created = addImageDownloadEntry({
    modelId: modelInfo.id,
    downloadId: placeholderId,
    fileName,
    totalBytes: modelInfo.size,
    metadata,
  });
  if (!created) return; // an active entry already owns this key (coalesced double-tap)
  try {
    const downloadInfo = await backgroundDownloadService.startDownload({
      url: modelInfo.downloadUrl,
      fileName,
      modelId: `image:${modelInfo.id}`,
      modelKey,
      modelType: 'image',
      totalBytes: modelInfo.size,
      metadataJson: JSON.stringify(metadata),
    });
    // Reconcile the queued placeholder row to the real native downloadId so progress /
    // complete / error events (routed via downloadIdIndex) reach this entry.
    useDownloadStore.getState().retryEntry(modelKey, downloadInfo.downloadId);
    wireZipFinalization(
      { downloadId: downloadInfo.downloadId, modelId: modelInfo.id, deps },
      async () => {
        const zipPath = `${imageModelsDir}/${fileName}`;
        try {
          useDownloadStore.getState().setProcessing(downloadInfo.downloadId);
          if (!(await RNFS.exists(imageModelsDir)))
            await RNFS.mkdir(imageModelsDir);
          const t0 = Date.now();
          await backgroundDownloadService.moveCompletedDownload(
            downloadInfo.downloadId,
            zipPath,
          );
          logger.log(
            `[ImageDownload] moveCompletedDownload took ${
              Date.now() - t0
            }ms modelId=${modelInfo.id}`,
          );
          if (!(await RNFS.exists(modelDir))) await RNFS.mkdir(modelDir);
          await RNFS.writeFile(`${modelDir}/_zip_name`, fileName, 'utf8').catch(
            () => {},
          );
          const t1 = Date.now();
          await unzip(zipPath, modelDir);
          logger.log(
            `[ImageDownload] unzip took ${Date.now() - t1}ms modelId=${
              modelInfo.id
            }`,
          );
          // A partial unzip must NEVER be marked _ready (see ensureImageExtractionComplete).
          await ensureImageExtractionComplete({
            backend: modelInfo.backend,
            modelDir,
            zipPath,
            modelId: modelInfo.id,
          });
          const resolvedModelDir =
            modelInfo.backend === 'coreml'
              ? await resolveCoreMLModelDir(modelDir)
              : modelDir;
          await RNFS.writeFile(`${modelDir}/_ready`, '', 'utf8').catch(
            () => {},
          );
          await RNFS.unlink(zipPath).catch(() => {});
          await registerAndNotify(deps, {
            imageModel: buildDownloadedImageModel(modelInfo, resolvedModelDir),
            modelName: modelInfo.name,
          });
        } catch (e) {
          await RNFS.unlink(zipPath).catch(() => {});
          await RNFS.unlink(modelDir).catch(() => {});
          throw e;
        }
      },
    );
    backgroundDownloadService.startProgressPolling();
  } catch (error: any) {
    // Cancelled while still queued (no slot) rejects with `.cancelled` — a user
    // cancellation, not a failure: drop the placeholder row quietly.
    if (isCancelledDownloadError(error)) {
      removeImageDownloadEntry(modelInfo.id);
      return;
    }
    // Native start failed: fail the placeholder row so the card/Manager offer retry.
    useDownloadStore.getState().setStatus(placeholderId, 'failed', {
      message: error?.message || 'Download failed',
    });
    deps.setAlertState(
      showAlert(
        'Download Failed',
        getUserFacingDownloadMessage(error?.message),
      ),
    );
  }
}

export async function handleDownloadImageModel(
  modelInfo: ImageModelDescriptor,
  deps: ImageDownloadDeps,
): Promise<void> {
  if (modelInfo.backend === 'qnn' && Platform.OS === 'android') {
    const socInfo = await hardwareService.getSoCInfo();
    const warningMessage = getQnnWarningMessage(modelInfo, socInfo);
    if (warningMessage) {
      showQnnWarningAlert(
        {
          warningMessage,
          hasNPU: socInfo.hasNPU,
          modelInfo,
          onDownloadAnyway: () => {
            proceedWithDownload(modelInfo, deps).catch(() => {});
          },
        },
        deps,
      );
      return;
    }
  }
  await proceedWithDownload(modelInfo, deps);
}
