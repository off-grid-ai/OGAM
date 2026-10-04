/**
 * Standalone utility helpers for ActiveModelService.
 */

import { useAppStore } from '../../stores/appStore';
import { activeLocalModelId } from './activeRoute';
import { hardwareService } from '../hardware';
import { ResourceUsage } from './modelStateTypes';

export async function getResourceUsage(): Promise<ResourceUsage> {
  const info = await hardwareService.refreshMemoryInfo();
  const store = useAppStore.getState();
  let estimatedModelMemory = 0;

  const activeTextId = activeLocalModelId('text');
  const activeImageId = activeLocalModelId('image');
  if (activeTextId) {
    const tm = store.downloadedModels.find(m => m.id === activeTextId);
    if (tm?.fileSize) {
      estimatedModelMemory += tm.fileSize * 1.2;
    }
  }
  if (activeImageId) {
    const im = store.downloadedImageModels.find(m => m.id === activeImageId);
    if (im?.size) {
      estimatedModelMemory += im.size * 1.3;
    }
  }

  return {
    memoryUsed: info.usedMemory,
    memoryTotal: info.totalMemory,
    memoryAvailable: info.availableMemory,
    memoryUsagePercent: (info.usedMemory / info.totalMemory) * 100,
    estimatedModelMemory,
  };
}
