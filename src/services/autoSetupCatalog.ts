import { Platform } from 'react-native';
import {
  buildGuidedSetupCatalog,
  guidedSetupTextDiscoveryModels,
  WHISPER_MODELS,
  type GuidedSetupCatalog,
} from '@offgrid/models';
import { fetchModelFiles } from './modelCatalogFiles';
import { huggingFaceService } from './huggingface';
import { hardwareService } from './hardware';
import { autoSetupImageCatalogProvider } from './autoSetupImageCatalogProvider';
import type { ModelFile } from '../types';
import type { ImageModelDescriptor } from './imageModelDownloadTypes';

export type AutoSetupTextPayload = { modelId: string; file: ModelFile };
export type AutoSetupImagePayload = ImageModelDescriptor;
export type AutoSetupSttPayload = { modelId: string };
export type AutoSetupCompatibleCatalog = GuidedSetupCatalog<
  AutoSetupTextPayload,
  AutoSetupImagePayload,
  AutoSetupSttPayload,
  never
>;

export interface AutoSetupCatalogBoundaries {
  totalMemoryGB: () => number;
  fetchTextFiles: (
    models: { id: string }[],
  ) => ReturnType<typeof fetchModelFiles>;
  imageRecommendation: typeof hardwareService.getImageModelRecommendation;
  imageModels: typeof autoSetupImageCatalogProvider.load;
}

const productionCatalogBoundaries: AutoSetupCatalogBoundaries = {
  totalMemoryGB: () => hardwareService.getTotalMemoryGB(),
  fetchTextFiles: models => fetchModelFiles(models, huggingFaceService),
  imageRecommendation: () => hardwareService.getImageModelRecommendation(),
  imageModels: () => autoSetupImageCatalogProvider.load(),
};

/** Native/network catalog adapter. Shared owns admission, costs, compatibility, and tiers. */
export async function loadAutoSetupCompatibleCatalog(
  boundaries: AutoSetupCatalogBoundaries = productionCatalogBoundaries,
): Promise<AutoSetupCompatibleCatalog> {
  const ramGB = boundaries.totalMemoryGB();
  const textModels = guidedSetupTextDiscoveryModels(ramGB);
  const [files, imageRecommendation, imageModels] = await Promise.all([
    boundaries.fetchTextFiles(textModels),
    boundaries.imageRecommendation(),
    boundaries.imageModels(),
  ]);
  return buildGuidedSetupCatalog({
    ramGb: ramGB,
    platform: Platform.OS,
    imageRecommendation,
    text: textModels.map(model => ({
      ...model,
      files: (files[model.id] ?? []).map(file => ({
        name: file.name,
        size: file.size,
        mmProjFile: file.mmProjFile
          ? { size: file.mmProjFile.size }
          : undefined,
        payload: { modelId: model.id, file },
      })),
    })),
    image: imageModels.map(model => {
      const id = model.repo ?? model.huggingFaceRepo ?? model.id;
      const payload = id === model.id ? model : { ...model, id };
      return {
        id,
        name: model.name,
        backend: model.backend,
        variant: model.variant,
        size: model.size,
        artifacts: model.coremlFiles ?? model.huggingFaceFiles,
        payload,
      };
    }),
    stt: WHISPER_MODELS.map(model => ({
      id: model.id,
      name: model.name,
      sizeMb: model.size,
      language: model.lang,
      payload: { modelId: model.id },
    })),
  });
}
