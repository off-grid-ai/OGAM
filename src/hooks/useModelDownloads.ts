import { useModelDownloadsProjection } from './useModelDownloadsProjection';
import type { ModelsSnapshot } from '@offgrid/application';

/** Temporary Pro TTS projection. Delete with the immutable Kokoro facade adapter cutover. */
export function useModelDownloads(): ModelsSnapshot['control']['downloads'] {
  return useModelDownloadsProjection().filter(row => row.modelType === 'tts');
}
