import {useMemo, useSyncExternalStore} from 'react';
import type {GeneratedImageRecord} from '@offgrid/application';
import type {GeneratedImage} from '../../../types';
import {applicationFacade} from '../../applicationFacade';
import {resolveDocumentPath} from '../../../utils/resolveDocumentPath';

export const projectGeneratedImage = (
  record: GeneratedImageRecord,
): GeneratedImage => ({
  id: record.id,
  ...(record.provenance ? {provenance: record.provenance} : {}),
  prompt: record.prompt,
  ...(record.negativePrompt ? {negativePrompt: record.negativePrompt} : {}),
  imagePath: resolveDocumentPath(record.local.path),
  ...(record.local.fileName ? {fileName: record.local.fileName} : {}),
  width: record.width,
  height: record.height,
  steps: record.steps,
  seed: record.seed,
  modelId: record.modelId,
  createdAt: record.createdAt,
  ...(record.conversationId
    ? {conversationId: record.conversationId}
    : {}),
});

export function useGeneratedImageGalleryProjection(): readonly GeneratedImage[] {
  const gallery = applicationFacade().generatedImages;
  if (!gallery) throw new Error('Generated image gallery was not composed.');
  const snapshot = useSyncExternalStore(
    gallery.subscribe,
    gallery.snapshot,
    gallery.snapshot,
  );
  return useMemo(
    () => snapshot.images.map(projectGeneratedImage),
    [snapshot.images],
  );
}
