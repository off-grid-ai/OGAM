import { useAppStore } from '../stores';

/**
 * The filePath of the text model ACTUALLY loaded in native memory right now (engine-agnostic — llama OR
 * litert), or null when nothing is loaded. A reactive projection of ActiveModelService's authoritative
 * loaded state (store.loadedTextModelId). This is the SINGLE source the model sheet reads for "currently
 * loaded", replacing llmService.getLoadedModelPath() — which was llama-only (wrong for LiteRT) and could
 * read stale after an unload, disagreeing with the overview that reads activeModelId (device 2026-07-14).
 */
export function useLoadedTextModelPath(): string | null {
  const loadedId = useAppStore((s) => s.loadedTextModelId);
  const downloadedModels = useAppStore((s) => s.downloadedModels);
  if (!loadedId) return null;
  return downloadedModels.find((m) => m.id === loadedId)?.filePath ?? null;
}
