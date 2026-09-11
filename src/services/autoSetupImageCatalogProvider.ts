import { Platform } from 'react-native';
import { fetchAvailableCoreMLModels } from './coreMLModelBrowser';
import { fetchAvailableModels } from './huggingFaceModelBrowser';
import { hardwareService } from './hardware';
import type { ImageModelDescriptor } from './imageModelDownloadTypes';
import { imageCatalogStyle } from '@offgrid/models';

interface AutoSetupImageCatalogProvider {
  load(): Promise<ImageModelDescriptor[]>;
}

const iosProvider: AutoSetupImageCatalogProvider = {
  async load() {
    return (await fetchAvailableCoreMLModels()).map(model => ({
      id: model.id, name: model.displayName, description: model.name,
      downloadUrl: model.downloadUrl, size: model.size, style: 'general', backend: 'coreml',
      repo: model.repo, coremlFiles: model.files, attentionVariant: model.attentionVariant,
    }));
  },
};

const androidProvider: AutoSetupImageCatalogProvider = {
  async load() {
    const soc = await hardwareService.getSoCInfo();
    return (await fetchAvailableModels(false, { skipQnn: !soc.hasNPU })).map(model => ({
      id: model.id, name: model.displayName, description: model.name,
      downloadUrl: model.downloadUrl, size: model.size, style: imageCatalogStyle(model.name),
      backend: model.backend, variant: model.variant, repo: model.repo,
    }));
  },
};

/** One platform adapter choice. Consumers only see the common catalog contract. */
export const autoSetupImageCatalogProvider: AutoSetupImageCatalogProvider =
  Platform.select({ ios: iosProvider, android: androidProvider }) ?? androidProvider;
