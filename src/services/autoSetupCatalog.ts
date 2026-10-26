import { Platform } from 'react-native';
import { videoSeam } from '../bootstrap/videoSeam';
import { CATALOG, isVideoWeightAvailableOn, videoPackError } from '@offgrid/models';
import { recommendedModelsForDevice, ramFitScore } from '../utils/recommendedModels';
import { fileExceedsBudget, textModelBudget } from './memoryBudget';
import { devicePicks } from './devicePicks';
import { fetchModelFiles } from './modelCatalogFiles';
import { hardwareService } from './hardware';
import { WHISPER_MODELS } from './whisperModels';
import { withRemoteCatalog } from '../stores/modelCatalogStore';
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

/** Setup's chat models are this phone's Fast, Balanced and Best: the shared picking rule over the
 *  catalog pool (bundled plus catalog/models.json), the same three the Models screen offers. */
function buildAutoSetupPickCandidates(ramGB: number): AutoSetupCompatibleCatalog['text'] {
  return devicePicks(ramGB).map(pick => ({
    id: `${pick.model.id}/${pick.file.name}`,
    name: pick.model.name,
    kind: 'text' as const,
    sizeBytes: pick.sizeBytes,
    fitScore: 0,
    parameterCountB: pick.model.paramCount,
    pick: pick.slot,
    payload: { modelId: pick.model.id, file: pick.file },
  }));
}

/** Resolve the live catalogs, then admit candidates through the existing device-fit owners. */
export async function loadAutoSetupCompatibleCatalog(
  boundaries: AutoSetupCatalogBoundaries = productionCatalogBoundaries,
): Promise<AutoSetupCompatibleCatalog> {
  const ramGB = await boundaries.totalMemoryGB();
  const text = buildAutoSetupPickCandidates(ramGB);

  const imageRecommendation = await boundaries.imageRecommendation();
  const imageModels = await boundaries.imageModels();
  // sd.cpp runs on every phone; the fast engine is still preferred below when it has a fit.
  const compatibleImages = imageModels.filter(model =>
    (model.backend === 'sd' || imageRecommendation.compatibleBackends.includes(model.backend)) &&
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
    fitScore: model.id === 'large-v3-turbo'
      ? 0
      : Math.abs(model.size - Math.min(809, ramGB * 100)),
    payload: { modelId: model.id },
  }));

  // Video is Pro: without it Auto Setup offers no video model.
  const videoOn = videoSeam.available();
  const completeVideoPacks = CATALOG.filter(model =>
    videoOn && model.kind === 'video' && model.availability !== 'coming_soon' &&
    !!model.minRamGb && !videoPackError(model.files) &&
    isVideoWeightAvailableOn(model.files.find(file => file.role === 'primary')?.name ?? '', Platform.OS) &&
    model.files.every(file => !!file.sizeBytes),
  );
  const video = completeVideoPacks.filter(model =>
    model.minRamGb! <= ramGB ||
    // 11 GB+ phones also get Off Grid AI's Light builds to try (below the packs' desktop minimum).
    (ramGB >= 11 && (model.id === 'off-grid-ai/Wan2.1-T2V-1.3B-GGUF-Q4' || model.id === 'off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4')),
  ).map(model => {
    const sizeBytes = model.files.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
    return {
      id: model.id, name: model.name, kind: 'video' as const, sizeBytes,
      fitScore: ramFitScore(model.minRamGb!, ramGB), payload: model,
    };
  });
  const videoExclusionReason = video.length ? undefined
    : !videoOn ? 'Video needs Off Grid AI Pro.'
    : completeVideoPacks.length
      ? 'Videos are made on your computer with Off Grid AI Desktop.'
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
  // Too little memory for any pack here: the phone makes videos on a paired computer instead.
  const videoOnComputer = !video.length && videoOn && completeVideoPacks.length > 0;
  return { text, image, stt, video, videoExclusionReason, videoOnComputer, embedding };
}
