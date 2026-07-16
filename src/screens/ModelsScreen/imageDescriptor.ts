import { ImageModelDescriptor } from './types';

/** Reconstruct an ImageModelDescriptor from a download entry's persisted metadata — the SINGLE
 *  source for "re-download this image model from what we remembered about it". Used by the iOS
 *  retry path (retryHandlers) and by resume's re-download-on-unrecoverable fallback so the two
 *  can't drift. Pure (zero-IO). Safe defaults keep it valid; undefined coreml/hf fields route it
 *  to the zip download path. */
export function imageDescriptorFromMetadata(modelId: string, meta: Record<string, any>): ImageModelDescriptor {
  return {
    id: modelId,
    name: meta.imageModelName,
    description: meta.imageModelDescription ?? '',
    downloadUrl: meta.imageModelDownloadUrl ?? '',
    size: meta.imageModelSize ?? 0,
    style: meta.imageModelStyle ?? '',
    backend: meta.imageModelBackend ?? 'coreml',
    attentionVariant: meta.imageModelAttentionVariant,
    huggingFaceRepo: meta.imageModelRepo,
    huggingFaceFiles: meta.imageModelHuggingFaceFiles,
    coremlFiles: meta.imageModelCoremlFiles,
    repo: meta.imageModelRepo,
  };
}
