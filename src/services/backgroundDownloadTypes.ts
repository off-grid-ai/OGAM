import { BackgroundDownloadReasonCode, BackgroundDownloadStatus } from '../types';

export interface DownloadParams {
  url: string;
  fileName: string;
  modelId: string;
  modelKey?: string;
  modelType?: 'text' | 'image' | 'stt' | 'tts';
  quantization?: string;
  combinedTotalBytes?: number;
  mmProjDownloadId?: string;
  metadataJson?: string;
  totalBytes?: number;
  sha256?: string;
  hideNotification?: boolean;
  /** A dependent sub-download of a main model file (e.g. a vision model's mmproj
   *  projector). Sidecars do NOT occupy a concurrency slot — the cap governs logical
   *  model downloads (the mains), and each file's sidecar rides alongside its main.
   *  Without this, one vision file consumed two of three slots (main + mmproj), so only
   *  one file could download at a time. */
  isSidecar?: boolean;
}

export interface DownloadProgressEvent {
  downloadId: string;
  fileName: string;
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  status: BackgroundDownloadStatus;
  reason?: string;
  reasonCode?: BackgroundDownloadReasonCode;
}

export interface DownloadCompleteEvent {
  downloadId: string;
  fileName: string;
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  status: 'completed';
  localUri: string;
}

export interface DownloadErrorEvent {
  downloadId: string;
  fileName: string;
  modelId: string;
  status: 'failed';
  reason: string;
  reasonCode?: BackgroundDownloadReasonCode;
}

export type DownloadProgressCallback = (event: DownloadProgressEvent) => void;
export type DownloadCompleteCallback = (event: DownloadCompleteEvent) => void;
export type DownloadErrorCallback = (event: DownloadErrorEvent) => void;
