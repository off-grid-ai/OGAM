import type { ModelsSnapshot } from '@offgrid/application';
import { useModelsProjection } from '../../hooks/useApplicationProjection';

const RESIDENCY_OPERATION_KINDS = new Set(['load', 'unload', 'prepare', 'eject']);

function isResidencyBusy(snapshot: ModelsSnapshot, modality: string): boolean {
  return snapshot.operations.active.some(operation =>
    RESIDENCY_OPERATION_KINDS.has(operation.kind)
    && (operation.kind === 'eject' || operation.modality === modality),
  );
}

/** Shared knows when a model of this modality is loading or unloading; this only subscribes. */
export function useModelResidencyBusy(modality: string): boolean {
  return isResidencyBusy(useModelsProjection(), modality);
}
