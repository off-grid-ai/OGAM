import type { ActiveModelSnapshot, ModelModality } from '@offgrid/application';
import { useModelsProjection } from './useApplicationProjection';

/** The selected LOCAL model id for a modality, or null (a remote route reads as null). */
export function useActiveLocalModelId(modality: ModelModality): string | null {
  const model = useActiveMobileModel(modality).model;
  return model && model.source === 'local' ? model.id : null;
}

/** Reactive projection of the shared active route for one modality. */
export function useActiveMobileModel(modality: ModelModality): ActiveModelSnapshot {
  const snapshot = useModelsProjection().active[modality];
  if (!snapshot) throw new Error(`The ${modality} model route is not initialized.`);
  return snapshot;
}
