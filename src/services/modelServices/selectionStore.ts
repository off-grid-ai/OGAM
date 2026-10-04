import {
  decodeModelRouteId,
  reconcileModelSelection,
  selectionProjectionForIntent,
  type ModelSelectionStore,
} from '@offgrid/models';
import { mobileModelSelectionProjection } from './modelSelectionProjection';

/**
 * Shared LLMService calls this single persisted-selection adapter. It is a pure write: the Mac's own
 * selection is the Mac's to change, and only an explicit pick in this app's UI (selectMobileModel)
 * asks it to. A write here used to activate the route on the paired Desktop as a side effect, so
 * every hydrate, refresh, or recovery that re-wrote the phone's selection silently moved the Mac's.
 */
export const mobileModelSelectionStore: ModelSelectionStore = {
  read: modality => reconcileModelSelection(
    modality,
    mobileModelSelectionProjection.read(modality),
  ).selectedRouteId,
  async write(modality, canonicalId) {
    const route = canonicalId ? decodeModelRouteId(canonicalId) : null;
    if (canonicalId && !route) throw new Error('The selected model route is invalid');
    await mobileModelSelectionProjection.write(
      modality,
      selectionProjectionForIntent(canonicalId),
    );
  },
};
