import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { useAppStore } from '../stores';
import { CacheType, INFERENCE_BACKENDS } from '../types';
import { hardwareService } from '../services/hardware';

/** Feature flag: Set to true to enable HTP/Hexagon NPU support. Currently disabled. */
const HTP_ENABLED = false;

export const CACHE_TYPE_DESCRIPTIONS: Record<CacheType, string> = {
  f16: 'Full precision — best quality, highest memory usage',
  q8_0: '8-bit quantized — good balance of quality and memory',
  q4_0: '4-bit quantized — lowest memory, may reduce quality',
};

export const GPU_LAYERS_MAX = 99;
export const CACHE_TYPE_OPTIONS: CacheType[] = ['f16', 'q8_0', 'q4_0'];

export function useTextGenerationAdvanced() {
  const { settings, updateSettings } = useAppStore();

  const isFlashAttnOn = settings?.flashAttn ?? true;
  const isQuantizedCache = (settings?.cacheType ?? 'q8_0') !== 'f16';
  const currentCacheType: CacheType = settings?.cacheType ?? 'q8_0';
  const gpuLayersEffective = Math.min(settings?.gpuLayers ?? 1, GPU_LAYERS_MAX);
  const defaultBackend = Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU;
  const isGpuEnabled = (settings?.inferenceBackend ?? defaultBackend) !== INFERENCE_BACKENDS.CPU;
  const isAndroid = Platform.OS === 'android';
  const selectedBackend = settings?.inferenceBackend ?? INFERENCE_BACKENDS.CPU;
  const gpuForcesF16 =
    selectedBackend === INFERENCE_BACKENDS.OPENCL ||
    (HTP_ENABLED && selectedBackend === INFERENCE_BACKENDS.HTP);
  // OpenCL and HTP force f16 in the native loader, so lock the UI to match.
  const cacheDisabled = gpuForcesF16;
  const displayCacheType = cacheDisabled ? 'f16' : currentCacheType;
  const [resolvedThreadCount, setResolvedThreadCount] = useState<number | null>(null);

  useEffect(() => {
    if (settings?.nThreads !== 0) return;
    hardwareService.getRecommendedThreadCount().then(setResolvedThreadCount);
  }, [settings?.nThreads]);

  const cpuThreadsSliderValue = settings?.nThreads && settings.nThreads > 0 ? settings.nThreads : 1;
  const cpuThreadsDisplayValue = settings?.nThreads === 0
    ? (resolvedThreadCount != null ? `Auto (${resolvedThreadCount})` : 'Auto')
    : String(settings?.nThreads ?? 6);

  const handleFlashAttnToggle = (flashAttn: boolean) => {
    if (!flashAttn && isQuantizedCache) {
      updateSettings({ flashAttn: false, cacheType: 'f16' });
    } else {
      updateSettings({ flashAttn: flashAttn });
    }
  };

  const handleCacheTypeChange = (ct: CacheType) => {
    if (cacheDisabled) return;
    const updates: Partial<typeof settings> = { cacheType: ct };
    if (ct !== 'f16' && !isFlashAttnOn) {
      updates.flashAttn = true;
    }
    updateSettings(updates);
  };

  return {
    // State
    settings,
    updateSettings,
    isFlashAttnOn,
    isQuantizedCache,
    currentCacheType,
    displayCacheType,
    gpuLayersEffective,
    isGpuEnabled,
    isAndroid,
    gpuForcesF16,
    cacheDisabled,
    cpuThreadsSliderValue,
    cpuThreadsDisplayValue,

    // Handlers
    handleFlashAttnToggle,
    handleCacheTypeChange,
  };
}
