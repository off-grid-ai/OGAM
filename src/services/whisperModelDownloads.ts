import RNFS from 'react-native-fs';
import logger from '../utils/logger';
import { useDownloadStore } from '../stores/downloadStore';
import { makeModelKey } from '../utils/modelKey';
import { backgroundDownloadService } from './backgroundDownloadService';
import * as whisperModelFiles from './whisperModelFiles';
import { WHISPER_MODELS } from './whisperModels';
import { withRemoteCatalog } from '../stores/modelCatalogStore';
import type { MobileWhisperCatalogModel } from '@offgrid/models';

export interface DownloadedWhisperModel {
  modelId: string;
  fileName: string;
  sizeBytes: number;
  filePath: string;
}

interface ActiveDownloadOwner {
  readonly modelKey: string;
  cancelRequested: boolean;
  nativeDownloadId: string | null;
  nativeCancel: Promise<void> | null;
  queuePublished: boolean;
}

function createDownloadOwner(modelKey: string): ActiveDownloadOwner {
  return {
    modelKey,
    cancelRequested: false,
    nativeDownloadId: null,
    nativeCancel: null,
    queuePublished: false,
  };
}

function cancelNativeOwner(
  owner: ActiveDownloadOwner,
  downloadId: string,
): Promise<void> {
  owner.nativeCancel ??= backgroundDownloadService
    .cancelDownload(downloadId)
    .catch(() => {});
  return owner.nativeCancel;
}

interface MissingModelDownloadInput {
  model: MobileWhisperCatalogModel;
  fileName: string;
  destPath: string;
  owner: ActiveDownloadOwner;
  onProgress?: (progress: number) => void;
}

/** Owns Whisper download queue identity and native-download cleanup. */
export class WhisperModelDownloads {
  private readonly activeDownloads = new Map<string, ActiveDownloadOwner>();

  private async unlinkOwnedFile(
    modelId: string,
    owner: ActiveDownloadOwner,
    path: string,
  ): Promise<void> {
    const activeOwner = this.activeDownloads.get(modelId);
    if (activeOwner && activeOwner !== owner) return;
    await RNFS.unlink(path);
  }

  async downloadModel(
    modelId: string,
    onProgress?: (progress: number) => void,
  ): Promise<string> {
    const model = withRemoteCatalog('transcription', WHISPER_MODELS).find(candidate => candidate.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    const fileName = `ggml-${modelId}.bin`;
    const modelKey = makeModelKey(`whisper-${modelId}`, fileName);
    const owner = createDownloadOwner(modelKey);
    // Ownership exists before the first asynchronous boundary. A delete that
    // arrives during directory or file checks still waits for this exact start.
    this.activeDownloads.set(modelId, owner);

    try {
      await whisperModelFiles.ensureModelsDirExists();
      const destPath = whisperModelFiles.getModelPath(modelId);
      if (await RNFS.exists(destPath)) return destPath;
      if (owner.cancelRequested) {
        const cancelled = new Error('Download cancelled') as Error & {
          cancelled?: boolean;
        };
        cancelled.cancelled = true;
        throw cancelled;
      }

      return await this.downloadMissingModel({
        model,
        fileName,
        destPath,
        owner,
        onProgress,
      });
    } finally {
      if (this.activeDownloads.get(modelId) === owner) {
        this.activeDownloads.delete(modelId);
        if (owner.queuePublished) {
          useDownloadStore.getState().remove(owner.modelKey);
        }
      }
    }
  }

  private async downloadMissingModel({
    model,
    fileName,
    destPath,
    owner,
    onProgress,
  }: MissingModelDownloadInput): Promise<string> {
    const modelId = model.id;

    logger.log(
      `[Whisper] Downloading ${model.name} via background download service...`,
    );
    const totalBytes = model.size * 1024 * 1024;
    const { modelKey } = owner;
    const queuedId = `queued:${modelKey}`;

    // Publish the queue entry before a native concurrency slot opens. All model
    // types then use the same canonical progress store and cancellation identity.
    owner.queuePublished = true;
    useDownloadStore.getState().add({
      modelKey,
      downloadId: queuedId,
      modelId: `whisper-${modelId}`,
      fileName,
      quantization: '',
      modelType: 'stt',
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes,
      combinedTotalBytes: totalBytes,
      progress: 0,
      createdAt: Date.now(),
    });

    const { downloadIdPromise, promise } =
      backgroundDownloadService.downloadFileTo({
        params: {
          url: model.url,
          fileName,
          modelId: `whisper-${modelId}`,
          modelKey,
          modelType: 'stt',
          totalBytes,
          // Catalog sizes are rounded MB values, not byte-exact checksums.
          metadataJson: JSON.stringify({ skipSizeValidation: true }),
        },
        destPath,
        onProgress: onProgress
          ? (bytesDownloaded, total) => {
              onProgress(total > 0 ? bytesDownloaded / total : 0);
            }
          : undefined,
        silent: true,
      });
    downloadIdPromise.then(
      downloadId => {
        owner.nativeDownloadId = downloadId;
        if (owner.cancelRequested) {
          cancelNativeOwner(owner, downloadId).catch(() => {});
        }
      },
      () => undefined,
    );

    try {
      const downloadId = await downloadIdPromise;
      if (!owner.cancelRequested) {
        useDownloadStore.getState().retryEntry(modelKey, downloadId);
      }
      await promise;
    } catch (error) {
      if ((error as { cancelled?: boolean })?.cancelled) {
        logger.log(`[Whisper] Download cancelled: ${modelId}`);
      } else {
        logger.error('[Whisper] Download failed:', error);
      }
      await this.unlinkOwnedFile(modelId, owner, destPath).catch(() => {});
      throw error;
    }

    try {
      await whisperModelFiles.validateModelFile(destPath);
    } catch (validationError) {
      await this.unlinkOwnedFile(modelId, owner, destPath).catch(error =>
        logger.error('[Whisper] Failed to delete invalid model file:', error),
      );
      const reason =
        validationError instanceof Error
          ? validationError.message
          : 'unknown error';
      throw new Error(`Downloaded model file is invalid: ${reason}`);
    }

    logger.log(`[Whisper] Downloaded to ${destPath}`);
    return destPath;
  }

  listDownloadedModels(): Promise<DownloadedWhisperModel[]> {
    return whisperModelFiles.listDownloadedModels();
  }

  async deleteModel(modelId: string): Promise<void> {
    const owner = this.activeDownloads.get(modelId);
    if (owner) {
      owner.cancelRequested = true;
      // Cancel the queue owner immediately. If admission already won the race,
      // the native-id continuation above cancels that exact request as well.
      await backgroundDownloadService
        .cancelDownload(`queued:${owner.modelKey}`)
        .catch(() => {});
      if (owner.nativeDownloadId !== null) {
        await cancelNativeOwner(owner, owner.nativeDownloadId);
      }
      if (this.activeDownloads.get(modelId) === owner) {
        this.activeDownloads.delete(modelId);
        if (owner.queuePublished) {
          useDownloadStore.getState().remove(owner.modelKey);
        }
      }
    }

    const path = whisperModelFiles.getModelPath(modelId);
    if (await RNFS.exists(path)) {
      const replacement = this.activeDownloads.get(modelId);
      if (replacement && replacement !== owner) return;
      await RNFS.unlink(path);
    }
  }
}
