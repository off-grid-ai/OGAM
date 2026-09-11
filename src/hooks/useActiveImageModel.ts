import type { ActiveImageModel } from '../services/imageGenerationTypes';
import { useAppStore } from '../stores';
import { useActiveMobileModel } from './useActiveMobileModel';

export type ActiveImageModelResult = {
  /** Runtime adapter data. Selection/readiness never depend on this record. */
  model: ActiveImageModel | null;
  modelId: string | null;
  modelName: string;
  isRemote: boolean;
  selected: boolean;
  ready: boolean;
  loading: boolean;
  error: string | null;
};

/**
 * Chat's one image-route projection. Shared owns selection and lifecycle. The
 * local store is read only to recover the native model path required by the
 * image runtime adapter.
 */
export function useActiveImageModel(): ActiveImageModelResult {
  const snapshot = useActiveMobileModel('image');
  const localRecords = useAppStore(state => state.downloadedImageModels);
  const runtime = snapshot.model;
  const model = !runtime
    ? null
    : runtime.source === 'remote'
    ? {
        id: runtime.id,
        name: runtime.name,
        modelPath: runtime.serverId ?? runtime.adapterId,
        backend: 'remote',
      }
    : localRecords.find(candidate => candidate.id === runtime.id) ?? null;

  return {
    model,
    modelId: runtime?.id ?? null,
    modelName: runtime?.name ?? 'Unknown',
    isRemote: runtime?.source === 'remote',
    selected: snapshot.model !== null,
    ready: snapshot.ready,
    loading: runtime?.loading === true,
    error: runtime?.error ?? null,
  };
}
