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
