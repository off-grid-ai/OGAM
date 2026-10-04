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
