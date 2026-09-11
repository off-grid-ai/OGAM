import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GeneratedImageGalleryFacade } from '@offgrid/application';
import { createGeneratedImageRecord } from '@offgrid/application';
import type { GeneratedImage } from '../../../types';
import { MobileGeneratedImageGalleryRepository } from './mobileGeneratedImageGalleryRepository';

const LEGACY_KEY = 'local-llm-app-storage';

const toRecord = (image: GeneratedImage) =>
  createGeneratedImageRecord({
    id: image.id,
    ...(image.provenance ? { provenance: image.provenance } : {}),
    ...(image.conversationId !== undefined
      ? { conversationId: image.conversationId }
      : {}),
    prompt: image.prompt,
    ...(image.negativePrompt ? { negativePrompt: image.negativePrompt } : {}),
    width: image.width,
    height: image.height,
    steps: image.steps,
    seed: image.seed,
    modelId: image.modelId,
    createdAt: image.createdAt,
    local: {
      path: image.imagePath,
      ...(image.fileName ? { fileName: image.fileName } : {}),
    },
  });

export async function importLegacyGeneratedImages(
  repository: MobileGeneratedImageGalleryRepository,
  facade: GeneratedImageGalleryFacade,
): Promise<void> {
  if (repository.legacyImportCompleted()) return;
  const raw = await AsyncStorage.getItem(LEGACY_KEY);
  const parsed = raw
    ? (JSON.parse(raw) as { state?: { generatedImages?: unknown } })
    : null;
  const legacy = parsed?.state?.generatedImages;
  if (!Array.isArray(legacy)) {
    repository.markLegacyImportCompleted();
    return;
  }
  const outcome = await facade.importLegacy(
    (legacy as GeneratedImage[]).map(toRecord),
  );
  if (!outcome.ok) throw new Error(outcome.failure.message);
  repository.markLegacyImportCompleted();
}
