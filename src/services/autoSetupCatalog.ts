import { CATALOG, videoPackError } from '@offgrid/models';
import { recommendedModelsForDevice, ramFitScore } from '../utils/recommendedModels';
import { fileExceedsBudget } from './memoryBudget';
import { fetchModelFiles } from './modelCatalogFiles';
import { hardwareService } from './hardware';
import { WHISPER_MODELS } from './whisperModels';
import type { AutoSetupCompatibleCatalog } from './autoSetupPlan';
import { autoSetupImageCatalogProvider } from './autoSetupImageCatalogProvider';
import { BUNDLED_EMBEDDING_MODEL, RECOMMENDED_EMBEDDING_MODELS } from './huggingFaceModelBrowser';

const MB = 1024 * 1024;

type CompatibleTextModel = ReturnType<typeof recommendedModelsForDevice>[number];

export interface AutoSetupCatalogBoundaries {
  totalMemoryGB: () => number | Promise<number>;
  fetchTextFiles: typeof fetchModelFiles;
  imageRecommendation: typeof hardwareService.getImageModelRecommendation;
  imageModels: typeof autoSetupImageCatalogProvider.load;
}

const productionCatalogBoundaries: AutoSetupCatalogBoundaries = {
  totalMemoryGB: async () => {
    await hardwareService.getDeviceInfo();
    return hardwareService.getTotalMemoryGB();
  },
  fetchTextFiles: fetchModelFiles,
  imageRecommendation: () => hardwareService.getImageModelRecommendation(),
  imageModels: () => autoSetupImageCatalogProvider.load(),
};

export function buildAutoSetupTextCandidates(
  models: CompatibleTextModel[],
  files: Record<string, import('../types').ModelFile[]>,
  ramGB: number,
): AutoSetupCompatibleCatalog['text'] {
  return models.filter(model => model.type === 'vision').flatMap(model => {
    const file = files[model.id]?.[0];
    const sizeBytes = file ? file.size + (file.mmProjFile?.size ?? 0) : 0;
    if (!file || fileExceedsBudget(sizeBytes, ramGB)) return [];
    return [{
      id: `${model.id}/${file.name}`,
      name: model.name,
      kind: 'text' as const,
      sizeBytes,
      fitScore: ramFitScore(model.minRam, ramGB),
      parameterCountB: model.params,
      payload: { modelId: model.id, file },
    }];
  });
}

/** Resolve the live catalogs, then admit candidates through the existing device-fit owners. */
export async function loadAutoSetupCompatibleCatalog(
  boundaries: AutoSetupCatalogBoundaries = productionCatalogBoundaries,
): Promise<AutoSetupCompatibleCatalog> {
  const ramGB = await boundaries.totalMemoryGB();
  const textModels = recommendedModelsForDevice(ramGB).filter(model => model.type === 'vision');
  const files = await boundaries.fetchTextFiles(textModels);
  const text = buildAutoSetupTextCandidates(textModels, files, ramGB);

  const imageRecommendation = await boundaries.imageRecommendation();
  const imageModels = await boundaries.imageModels();
  const compatibleImages = imageModels.filter(model =>
    imageRecommendation.compatibleBackends.includes(model.backend) &&
    (!imageRecommendation.qnnVariant || model.backend !== 'qnn' || model.variant === imageRecommendation.qnnVariant) &&
    !fileExceedsBudget(model.size, ramGB),
  );
  const recommendedBackendImages = compatibleImages.filter(
    model => model.backend === imageRecommendation.recommendedBackend,
  );
  const imageCandidates = recommendedBackendImages.length > 0 ? recommendedBackendImages : compatibleImages;
  const image = imageCandidates.map((model, index) => ({
    id: model.id,
    name: model.name,
    kind: 'image' as const,
    sizeBytes: model.size,
    fitScore: imageRecommendation.recommendedModels?.some(label =>
      [model.name, model.repo, model.id].some(value => value?.toLowerCase().includes(label)),
    ) ? 0 : index + 1,
    payload: model,
  }));

  const stt = WHISPER_MODELS.filter(model =>
    model.lang === 'multi' && !fileExceedsBudget(model.size * MB, ramGB),
  ).map(model => ({
    id: model.id,
    name: `${model.name} Speech`,
    kind: 'stt' as const,
    sizeBytes: model.size * MB,
    fitScore: model.id === 'large-v3-turbo'
      ? 0
      : Math.abs(model.size - Math.min(809, ramGB * 100)),
    payload: { modelId: model.id },
  }));

  const completeVideoPacks = CATALOG.filter(model =>
    model.kind === 'video' && model.availability !== 'coming_soon' &&
    !!model.minRamGb && !videoPackError(model.files) &&
    model.files.every(file => !!file.sizeBytes),
  );
  const video = completeVideoPacks.filter(model =>
    model.minRamGb! <= ramGB ||
    (ramGB >= 11 && model.id === 'Comfy-Org/Wan_2.1_ComfyUI_repackaged'),
  ).map(model => {
    const sizeBytes = model.files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
    return {
      id: model.id, name: model.name, kind: 'video' as const, sizeBytes,
      fitScore: ramFitScore(model.minRamGb!, ramGB), payload: model,
    };
  });
  const videoExclusionReason = video.length ? undefined
    : completeVideoPacks.length
      ? "No video model meets Auto Setup's memory limit."
      : 'Auto Setup has no complete video model to download.';
  const embedding = [BUNDLED_EMBEDDING_MODEL, ...RECOMMENDED_EMBEDDING_MODELS]
    .map((model, index) => ({
      id: model.id,
      name: model.name,
      kind: 'embedding' as const,
      sizeBytes: model.size,
      fitScore: index === 1 ? 0 : index,
      payload: model,
    }));
  return { text, image, stt, video, videoExclusionReason, embedding };
}
