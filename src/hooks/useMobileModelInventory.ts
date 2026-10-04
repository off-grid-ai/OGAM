import type { ModelModality, RuntimeModel } from '@offgrid/application';
import { useModelsProjection } from './useApplicationProjection';

/** Reactive read-only inventory projection from the Shared model service. */
export function useMobileModelInventory(modality?: ModelModality): RuntimeModel[] {
  return useModelsProjection().inventory.filter(
    model => !modality || model.modality === modality,
  );
}
