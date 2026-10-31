import RNFS from 'react-native-fs';
import logger from '../utils/logger';
import { useDownloadStore } from '../stores/downloadStore';
import { makeModelKey } from '../utils/modelKey';
import { backgroundDownloadService } from './backgroundDownloadService';
import * as whisperModelFiles from './whisperModelFiles';
import { WHISPER_MODELS, findTranscriptionModel } from './whisperModels';
import { withRemoteCatalog } from '../stores/modelCatalogStore';
import type { MobileWhisperCatalogModel } from '@offgrid/models';

/** One file of a transcription model download: Whisper has one, Qwen3-ASR two. */
interface ModelDownloadFile {
  url: string;
  fileName: string;
  destPath: string;
  totalBytes: number;
  /** Exact catalog sizes are checked by the downloader; rounded MB sizes are not. */
  exactSize: boolean;
  sha256?: string;
}

/** The files to fetch for a transcription model. Qwen3-ASR's projector comes first, its weights last. */
function downloadFilesFor(model: MobileWhisperCatalogModel, fileName: string, destPath: string): ModelDownloadFile[] {
  const asr = whisperModelFiles.getQwenAsrFiles(model.id);
  if (!asr) {
    return [{ url: model.url, fileName, destPath, totalBytes: model.size * 1024 * 1024, exactSize: false }];
  }
  return [asr.mmproj, asr.primary].map(file => ({
    url: file.url,
    fileName: file.name,
    destPath: file.path,
    totalBytes: file.sizeBytes,
    exactSize: true,
    ...(file.sha256 ? { sha256: file.sha256 } : {}),
  }));
}

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
  files: ModelDownloadFile[];
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
    const model = findTranscriptionModel(withRemoteCatalog('transcription', WHISPER_MODELS), modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    const destPath = whisperModelFiles.getModelPath(modelId);
    const fileName = whisperModelFiles.getQwenAsrFiles(modelId)?.primary.name ?? `ggml-${modelId}.bin`;
    const modelKey = makeModelKey(`whisper-${modelId}`, fileName);
    const owner = createDownloadOwner(modelKey);
    // Ownership exists before the first asynchronous boundary. A delete that
    // arrives during directory or file checks still waits for this exact start.
    this.activeDownloads.set(modelId, owner);

    try {
      await whisperModelFiles.ensureModelsDirExists();
      if (await whisperModelFiles.isModelDownloaded(modelId)) return destPath;
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
        files: downloadFilesFor(model, fileName, destPath),
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
    files,
    owner,
    onProgress,
  }: MissingModelDownloadInput): Promise<string> {
    const modelId = model.id;

    logger.log(
      `[Whisper] Downloading ${model.name} via background download service...`,
    );
    const totalBytes = files.reduce((sum, file) => sum + file.totalBytes, 0);
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

    // Files fetched earlier count toward the one progress bar, as a model's companion files do.
    let doneBytes = 0;
    for (const file of files) {
      if (file.exactSize && (await RNFS.exists(file.destPath))) {
        doneBytes += file.totalBytes;
        continue;
      }
      if (doneBytes > 0) useDownloadStore.getState().setCompanionBytes(modelKey, doneBytes);
      await this.downloadFile(file, { model, owner, doneBytes, totalBytes, onProgress });
      doneBytes += file.totalBytes;
    }

    logger.log(`[Whisper] Downloaded to ${destPath}`);
    return destPath;
  }

  private async downloadFile(
    file: ModelDownloadFile,
    job: {
      model: MobileWhisperCatalogModel;
      owner: ActiveDownloadOwner;
      doneBytes: number;
      totalBytes: number;
      onProgress?: (progress: number) => void;
    },
  ): Promise<void> {
    const { model, owner, doneBytes, totalBytes, onProgress } = job;
    const modelId = model.id;
    const { modelKey } = owner;
    const { destPath } = file;
    if (owner.cancelRequested) {
      const cancelled = new Error('Download cancelled') as Error & { cancelled?: boolean };
      cancelled.cancelled = true;
      throw cancelled;
    }
    const { downloadIdPromise, promise } =
      backgroundDownloadService.downloadFileTo({
        params: {
          url: file.url,
          fileName: file.fileName,
          modelId: `whisper-${modelId}`,
          modelKey,
          modelType: 'stt',
          totalBytes: file.totalBytes,
          ...(file.sha256 ? { sha256: file.sha256 } : {}),
          // Catalog sizes are rounded MB values, not byte-exact checksums.
          ...(file.exactSize ? {} : { metadataJson: JSON.stringify({ skipSizeValidation: true }) }),
        },
        destPath,
        onProgress: onProgress
          ? (bytesDownloaded, total) => {
              // This file at the size the downloader reports, the files after it at their catalog size.
              const overall = total > 0 ? totalBytes - file.totalBytes + total : 0;
              onProgress(overall > 0 ? (doneBytes + bytesDownloaded) / overall : 0);
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
    // A finished file starts a new native transfer for the next one.
    owner.nativeDownloadId = null;
    owner.nativeCancel = null;

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

    for (const path of whisperModelFiles.getModelFilePaths(modelId)) {
      if (!(await RNFS.exists(path))) continue;
      const replacement = this.activeDownloads.get(modelId);
      if (replacement && replacement !== owner) return;
      await RNFS.unlink(path);
    }
  }
}
