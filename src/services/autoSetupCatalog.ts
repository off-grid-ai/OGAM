import { recommendedModelsForDevice, ramFitScore } from '../utils/recommendedModels';
import { fileExceedsBudget, textModelBudget } from './memoryBudget';
import { fetchModelFiles } from './modelCatalogFiles';
import { hardwareService } from './hardware';
import { WHISPER_MODELS } from './whisperModels';
import { withRemoteCatalog } from '../stores/modelCatalogStore';
import { RECOMMENDED_MODELS } from '../constants';
import type { AutoSetupCompatibleCatalog } from './autoSetupPlan';
import { autoSetupImageCatalogProvider } from './autoSetupImageCatalogProvider';

const MB = 1024 * 1024;

type CompatibleTextModel = ReturnType<typeof recommendedModelsForDevice>[number];

export interface AutoSetupCatalogBoundaries {
  totalMemoryGB: () => number;
  fetchTextFiles: typeof fetchModelFiles;
  imageRecommendation: typeof hardwareService.getImageModelRecommendation;
  imageModels: typeof autoSetupImageCatalogProvider.load;
}

const productionCatalogBoundaries: AutoSetupCatalogBoundaries = {
  totalMemoryGB: () => hardwareService.getTotalMemoryGB(),
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
    if (!file || fileExceedsBudget(sizeBytes, ramGB, textModelBudget())) return [];
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
  const ramGB = boundaries.totalMemoryGB();
  const textModels = recommendedModelsForDevice(ramGB, withRemoteCatalog('text', RECOMMENDED_MODELS)).filter(model => model.type === 'vision');
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

  const stt = withRemoteCatalog('transcription', WHISPER_MODELS).filter(model =>
    model.lang === 'multi' && !fileExceedsBudget(model.size * MB, ramGB),
  ).map(model => ({
    id: model.id,
    name: `${model.name} Speech`,
    kind: 'stt' as const,
    sizeBytes: model.size * MB,
    fitScore: Math.abs(model.size - Math.min(809, ramGB * 100)),
    payload: { modelId: model.id },
  }));

  return { text, image, stt };
}
