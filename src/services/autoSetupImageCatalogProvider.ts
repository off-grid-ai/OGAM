import { Platform } from 'react-native';
import { fetchAvailableCoreMLModels } from './coreMLModelBrowser';
import { fetchAvailableModels, getRecommendedSDImageModels, guessStyle } from './huggingFaceModelBrowser';
import { hardwareService } from './hardware';
import type { ImageModelDescriptor } from './imageModelDownloadTypes';

interface AutoSetupImageCatalogProvider {
  load(): Promise<ImageModelDescriptor[]>;
}

/** sd.cpp models that fit this phone: Auto Setup's fallback when the fast engine has no fit. */
function sdModels(): ImageModelDescriptor[] {
  return getRecommendedSDImageModels(hardwareService.getTotalMemoryGB()).map(model => ({
    id: model.id, name: model.displayName, description: model.name,
    downloadUrl: model.downloadUrl, size: model.size, style: guessStyle(model.name),
    backend: 'sd' as const, repo: model.repo, huggingFaceRepo: model.repo, huggingFaceFiles: model.huggingFaceFiles,
  }));
}

const iosProvider: AutoSetupImageCatalogProvider = {
  async load() {
    const coreml: ImageModelDescriptor[] = (await fetchAvailableCoreMLModels()).map(model => ({
      id: model.id, name: model.displayName, description: model.name,
      downloadUrl: model.downloadUrl, size: model.size, style: 'general', backend: 'coreml',
      repo: model.repo, coremlFiles: model.files, attentionVariant: model.attentionVariant,
    }));
    return [...coreml, ...sdModels()];
  },
};

const androidProvider: AutoSetupImageCatalogProvider = {
  async load() {
    const soc = await hardwareService.getSoCInfo();
    const native: ImageModelDescriptor[] = (await fetchAvailableModels(false, { skipQnn: !soc.hasNPU })).map(model => ({
      id: model.id, name: model.displayName, description: model.name,
      downloadUrl: model.downloadUrl, size: model.size, style: guessStyle(model.name),
      backend: model.backend, variant: model.variant, repo: model.repo,
    }));
    return [...native, ...sdModels()];
  },
};

/** One platform adapter choice. Consumers only see the common catalog contract. */
export const autoSetupImageCatalogProvider: AutoSetupImageCatalogProvider =
  Platform.select({ ios: iosProvider, android: androidProvider }) ?? androidProvider;
