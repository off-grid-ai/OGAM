import { CATALOG } from '@offgrid/models';
import type { DownloadedModel, GeneratedVideo, GenerationMeta } from '../types';

export const getMmProjFileSize = (m?: DownloadedModel): number =>
  m?.engine === 'llama' ? (m.mmProjFileSize ?? 0) : 0;

/**
 * The ONE test for "is this a LiteRT model file".
 *
 * Five call sites each spelled the extension out — the import guard, the import display name, the
 * registry row builder, the multi-file picker and the acceleration check. A format is one fact
 * about a file, so it gets one answer; adding a second LiteRT extension used to mean finding all
 * five.
 */
export const isLiteRTFileName = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith('.litertlm');

/** Use the catalog label without changing the repository ID or file names. */
export const videoModelDisplayName = (id: string, fallback: string = id): string =>
  CATALOG.find(model => model.kind === 'video' && model.id === id)?.name ?? fallback;

/** Generation facts shared by new messages and older saved video attachments. */
export const videoGenerationMeta = (video: GeneratedVideo): GenerationMeta => ({
  modelName: videoModelDisplayName(video.modelId),
  resolution: `${video.width} × ${video.height}`,
  steps: video.steps,
  guidanceScale: video.guidance,
  frames: video.frames,
  fps: video.fps,
  seed: video.seed,
});

/**
 * The Google Tensor generation a LiteRT file was compiled for, read from Google's naming
 * (`gemma-4-E2B-it_Google_Tensor_G5.litertlm` → 5), or null for a portable CPU/GPU build. Such a
 * file runs only on that generation's TPU.
 */
export const liteRTTensorTarget = (fileName: string): number | null => {
  const match = /_google_tensor_g(\d+)\.litertlm$/i.exec(fileName);
  return match ? Number(match[1]) : null;
};
