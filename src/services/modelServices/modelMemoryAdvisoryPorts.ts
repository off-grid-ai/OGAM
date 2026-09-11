import { Platform } from 'react-native';
import type {
  ModelMemoryAdvisoryArtifact,
  ModelMemoryAdvisoryService,
} from '@offgrid/models';
import { INFERENCE_BACKENDS } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { applicationFacade } from '../applicationFacade';
import { hardwareService } from '../hardware';
import type { ModelType } from './modelStateTypes';

function observedArtifact(
  modelId: string,
  type: ModelType,
): ModelMemoryAdvisoryArtifact | undefined {
  const state = useAppStore.getState();
  if (type === 'text') {
    const model = state.downloadedModels.find(candidate => candidate.id === modelId);
    if (!model) return undefined;
    const configuredBackend =
      applicationFacade().models.snapshot().settings.inferenceBackend;
    const backend = Object.values(INFERENCE_BACKENDS).find(
      candidate => candidate === configuredBackend,
    );
    return {
      id: model.id,
      name: model.name,
      type,
      artifactBytes: model.fileSize,
      projectorBytes: model.engine === 'llama' ? model.mmProjFileSize : undefined,
      accelerated: !!backend && backend !== INFERENCE_BACKENDS.CPU,
      platform: Platform.OS,
      residencyKey: 'mobile:text-engine',
    };
  }

  const model = state.downloadedImageModels.find(candidate => candidate.id === modelId);
  if (!model) return undefined;
  return {
    id: model.id,
    name: model.name,
    type,
    artifactBytes: model.size,
    nativeEstimatedBytes: hardwareService.estimateImageModelRam?.(model),
    platform: Platform.OS,
    residencyKey: 'mobile:image-engine',
  };
}

/** Device memory and observed artifacts. Shared owns the verdict. */
export function mobileModelMemoryAdvisoryPorts(): ConstructorParameters<typeof ModelMemoryAdvisoryService>[1] {
  return {
  async deviceMemory() {
    const device = await hardwareService.getDeviceInfo();
    return {
      totalMB: device.totalMemory / (1024 * 1024),
      availableMB: hardwareService.getAvailableMemoryGB() * 1024,
      platform: Platform.OS,
    };
  },
  artifact: observedArtifact,
};
}
