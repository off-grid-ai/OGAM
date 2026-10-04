import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import type {
  CommittedModelSettings,
  ModelsFailure,
  Outcome,
} from '@offgrid/application';
import { CacheType, INFERENCE_BACKENDS } from '../types';
import { hardwareService } from '../services/hardware';
import { applicationFacade } from '../services/applicationFacade';
import { backendForcesF16Cache } from '../services/llmHelpers';
import { useModelsProjection } from './useApplicationProjection';

export const CACHE_TYPE_DESCRIPTIONS: Record<CacheType, string> = {
  f16: 'Full precision — best quality, highest memory usage',
  q8_0: '8-bit quantized — good balance of quality and memory',
  q4_0: '4-bit quantized — lowest memory, may reduce quality',
};

export const GPU_LAYERS_MAX = 99;
export const CACHE_TYPE_OPTIONS: CacheType[] = ['f16', 'q8_0', 'q4_0'];

export type TextGenerationAdvancedSettingsSaveOutcome = Outcome<
  CommittedModelSettings,
  ModelsFailure
>;

export function useTextGenerationAdvanced() {
  const settings = useModelsProjection().settings;
  const flashAttn = typeof settings.flashAttn === 'boolean'
    ? settings.flashAttn
    : undefined;
  const cacheType = CACHE_TYPE_OPTIONS.find(value => value === settings.cacheType);
  const gpuLayers = typeof settings.gpuLayers === 'number'
    ? settings.gpuLayers
    : undefined;
  const inferenceBackend = Object.values(INFERENCE_BACKENDS).find(
    value => value === settings.inferenceBackend,
  );
  const nThreads = typeof settings.nThreads === 'number'
    ? settings.nThreads
    : undefined;

  const isFlashAttnOn = flashAttn ?? true;
  const isQuantizedCache = (cacheType ?? 'q8_0') !== 'f16';
  const currentCacheType: CacheType = cacheType ?? 'q8_0';
  const gpuLayersEffective = Math.min(gpuLayers ?? 1, GPU_LAYERS_MAX);
  const defaultBackend = Platform.OS === 'ios' ? INFERENCE_BACKENDS.METAL : INFERENCE_BACKENDS.CPU;
  const isGpuEnabled = (inferenceBackend ?? defaultBackend) !== INFERENCE_BACKENDS.CPU;
  const isAndroid = Platform.OS === 'android';
  const selectedBackend = inferenceBackend ?? INFERENCE_BACKENDS.CPU;
  // OpenCL and HTP force f16 in the native loader, so lock the UI to match — single
  // source in llmHelpers shared with the loader and the generation-details recorder.
  const gpuForcesF16 = backendForcesF16Cache(selectedBackend);
  const cacheDisabled = gpuForcesF16;
  const displayCacheType = cacheDisabled ? 'f16' : currentCacheType;
  const [resolvedThreadCount, setResolvedThreadCount] = useState<number | null>(null);

  useEffect(() => {
    if (nThreads !== 0) return;
    hardwareService.getRecommendedThreadCount().then(setResolvedThreadCount);
  }, [nThreads]);

  const cpuThreadsSliderValue = nThreads && nThreads > 0 ? nThreads : 1;
  const cpuThreadsDisplayValue = nThreads === 0
    ? (resolvedThreadCount != null ? `Auto (${resolvedThreadCount})` : 'Auto')
    : String(cpuThreadsSliderValue);

  const handleFlashAttnToggle = (
    next: boolean,
  ): Promise<TextGenerationAdvancedSettingsSaveOutcome> => {
    const patch = !next && isQuantizedCache
      ? { flashAttn: false, cacheType: 'f16' as const }
      : { flashAttn: next };
    return applicationFacade().models.settings.save({
      origin: 'local',
      patch,
    });
  };

  const handleCacheTypeChange = (
    ct: CacheType,
  ): Promise<TextGenerationAdvancedSettingsSaveOutcome> | undefined => {
    if (cacheDisabled) return undefined;
    const patch = ct !== 'f16' && !isFlashAttnOn
      ? { cacheType: ct, flashAttn: true }
      : { cacheType: ct };
    return applicationFacade().models.settings.save({
      origin: 'local',
      patch,
    });
  };

  return {
    // Derived state only. `settings` and `updateSettings` were re-exported wholesale and NO caller
    // read them from here, so returning them only invited a whole-store read back in.
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
