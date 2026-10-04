import { useAppStore } from '../stores';
import { useModelResidencyStore } from '../stores/modelResidencyStore';

/**
 * The filePath of the text model ACTUALLY loaded in native memory right now (engine-agnostic), or null
 * when nothing is loaded. Reads the residency projection, never a selection field.
 */
export function useLoadedTextModelPath(): string | null {
  const loadedId = useModelResidencyStore(s => s.loadedTextModelId);
  const downloadedModels = useAppStore(s => s.downloadedModels);
  if (!loadedId) return null;
  return downloadedModels.find(m => m.id === loadedId)?.filePath ?? null;
}
