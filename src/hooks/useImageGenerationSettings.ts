import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useAppStore } from '../stores';
import { mobileImageRuntime } from '../services/modelServices/imageRuntimePort';
import { useActiveMobileModel } from './useActiveMobileModel';

export function useClearGpuCache() {
  const downloadedImageModels = useAppStore(state => state.downloadedImageModels);
  const activeRoute = useActiveMobileModel('image').model;
  const [clearing, setClearing] = useState(false);

  const handleClearCache = useCallback(async () => {
    const activeModel = activeRoute?.source === 'local'
      ? downloadedImageModels.find(m => m.id === activeRoute.id)
      : null;
    if (!activeModel?.modelPath) {
      Alert.alert('No Model', 'Load an image model first.');
      return;
    }
    setClearing(true);
    try {
      const cleared = await mobileImageRuntime.clearGpuCache(activeModel.modelPath);
      Alert.alert('Cache Cleared', `Removed ${cleared} GPU cache file(s). Next generation will retune GPU kernels (first run may be slower).`);
    } catch (e: any) {
      Alert.alert('Error', `Failed to clear GPU cache: ${e?.message || 'Unknown error'}`);
    } finally {
      setClearing(false);
    }
  }, [downloadedImageModels, activeRoute]);

  return { clearing, handleClearCache };
}
