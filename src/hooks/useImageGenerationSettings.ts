import { useState, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { useAppStore } from '../stores';
import { setImageParameterOverride } from '@offgrid/models';
import { mobileImageParameterDefaults, mobileImageSizeLimit, resolveMobileImageParameters } from '../services/imageParameterPolicy';
import { localDreamGeneratorService } from '../services/localDreamGenerator';

export function useClearGpuCache() {
  const { downloadedImageModels, activeImageModelId } = useAppStore();
  const [clearing, setClearing] = useState(false);

  const handleClearCache = useCallback(async () => {
    const activeModel = downloadedImageModels.find(m => m.id === activeImageModelId);
    if (!activeModel?.modelPath) {
      Alert.alert('No Model', 'Load an image model first.');
      return;
    }
    setClearing(true);
    try {
      const cleared = await localDreamGeneratorService.clearOpenCLCache(activeModel.modelPath);
      Alert.alert('Cache Cleared', `Removed ${cleared} GPU cache file(s). Next generation will retune GPU kernels (first run may be slower).`);
    } catch (e: any) {
      Alert.alert('Error', `Failed to clear GPU cache: ${e?.message || 'Unknown error'}`);
    } finally {
      setClearing(false);
    }
  }, [downloadedImageModels, activeImageModelId]);

  return { clearing, handleClearCache };
}

/** Both settings surfaces display the same values that generation will use. */
export function useImageParameterSettings() {
  const { settings, updateSettings, activeImageModelId, downloadedImageModels } = useAppStore();
  const model = downloadedImageModels.find(item => item.id === activeImageModelId) ?? { id: 'legacy-image' };
  const defaults = mobileImageParameterDefaults(model, Platform.OS);
  const parameters = resolveMobileImageParameters(model, settings);
  const perModel = 'backend' in model && model.backend === 'sd';
  // An sd.cpp model keeps its own values (the shared per-model store, as on Desktop); the native
  // engines share the global ones.
  const setParameter = (key: 'steps' | 'cfgScale' | 'size', value: number) => {
    if (perModel) {
      updateSettings({ imageParameterOverrides: setImageParameterOverride(settings.imageParameterOverrides, model.id, key, value) });
      return;
    }
    if (key === 'steps') updateSettings({ imageSteps: value });
    else if (key === 'cfgScale') updateSettings({ imageGuidanceScale: value });
    else updateSettings({ imageWidth: value, imageHeight: value });
  };
  return {
    parameters,
    defaults,
    maxSize: mobileImageSizeLimit(model),
    setParameter,
    applyDefaults: () => {
      if (perModel) {
        const { [model.id]: _cleared, ...rest } = settings.imageParameterOverrides ?? {};
        updateSettings({ imageParameterOverrides: rest });
        return;
      }
      updateSettings({
        imageSteps: defaults.steps,
        imageGuidanceScale: defaults.guidanceScale,
        imageWidth: defaults.size,
        imageHeight: defaults.size,
      });
    },
  };
}
