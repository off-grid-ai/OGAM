import type { ModelModality } from '@offgrid/models';
import { selectedLocalModelId, selectedRouteIsRemote } from './modelSelectionProjection';

/**
 * The one answer to "which model is selected for this modality" on the phone: the shared
 * reconciled selection. These are convenience reads for callers that only care about a LOCAL
 * model's id; a remote route reads as null here, exactly as the retired appStore mirrors did.
 * The persisted selection is a fact before the inventory has refreshed, so it is read directly.
 */
export function activeLocalModelId(modality: ModelModality): string | null {
  return selectedLocalModelId(modality);
}

export function activeRouteIsRemote(modality: ModelModality): boolean {
  return selectedRouteIsRemote(modality);
}
