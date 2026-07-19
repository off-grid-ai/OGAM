import { effectiveCacheType } from '../../services/llmHelpers';

/** Whether live settings differ from the settings captured when the model loaded. */
export function computePendingSettings(
  engine: string | undefined,
  settings: Record<string, unknown>,
  loadedSettings: Record<string, unknown> | null | undefined,
): boolean {
  if (!loadedSettings) return false;
  const changed = (live: unknown, loaded: unknown) =>
    loaded !== undefined && live !== loaded;
  if (engine === 'litert') {
    const liveTokens = (settings.liteRTMaxTokens as number | undefined) ?? 4096;
    const loadedTokens =
      (loadedSettings.liteRTMaxTokens as number | undefined) ?? 4096;
    return (
      changed(settings.liteRTBackend, loadedSettings.liteRTBackend) ||
      (loadedSettings.liteRTBackend !== undefined &&
        liveTokens !== loadedTokens)
    );
  }
  const effectiveCache = effectiveCacheType(
    settings.inferenceBackend as string | undefined,
    settings.cacheType as string | undefined,
  );
  const loadedEffectiveCache = effectiveCacheType(
    loadedSettings.inferenceBackend as string | undefined,
    loadedSettings.cacheType as string | undefined,
  );
  return (
    changed(settings.nThreads, loadedSettings.nThreads) ||
    changed(settings.nBatch, loadedSettings.nBatch) ||
    changed(settings.contextLength, loadedSettings.contextLength) ||
    changed(settings.enableGpu, loadedSettings.enableGpu) ||
    changed(settings.inferenceBackend, loadedSettings.inferenceBackend) ||
    changed(settings.gpuLayers, loadedSettings.gpuLayers) ||
    changed(settings.flashAttn, loadedSettings.flashAttn) ||
    (loadedSettings.cacheType !== undefined &&
      effectiveCache !== loadedEffectiveCache)
  );
}
