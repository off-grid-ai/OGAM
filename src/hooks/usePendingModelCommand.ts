import type { ModelCommandRoute, ModelModality } from '@offgrid/application';
import { useModelsProjection } from './useApplicationProjection';
import { applicationFacade } from '../services/applicationFacade';
import { mobileRouteFacts } from '../services/modelServices/mobileRoute';

/** The route the shared command owner is switching this modality to, or null. */
export function usePendingModelCommand(modality: ModelModality): ModelCommandRoute | null {
  const active = useModelsProjection().operations.active.find(operation => {
    return operation.kind === 'control'
      && operation.controlOperation === 'select'
      && (operation.controlSurface === modality
        || (operation.controlSurface === 'speech' && modality === 'voice'));
  });
  if (!active?.modelId) return null;
  const model = applicationFacade().models.lookup(active.modelId);
  const facts = model ? mobileRouteFacts(model) : null;
  return facts?.modality === modality ? facts : null;
}
