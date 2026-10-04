import {
  createImageDownloadPlan,
  type ImageDownloadDescriptor,
} from '@offgrid/models';
import type { PublicDownloadRequest } from '@offgrid/application';

/** Translate raw catalog facts into the public facade command. Shared owns plan policy. */
export function publicImageDownloadRequest(
  model: ImageDownloadDescriptor,
): PublicDownloadRequest {
  const plan = createImageDownloadPlan(model);
  return {
    modelType: 'image',
    modelId: plan.modelId,
    modelKey: plan.modelKey,
    fileName: plan.fileName,
    url: model.downloadUrl,
    totalBytes: plan.totalBytes,
    metadataJson: plan.metadataJson,
  };
}
