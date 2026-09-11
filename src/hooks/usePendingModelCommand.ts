import type {
  ModelCommandRoute,
  ModelModality,
  ModelsOperationSnapshot,
} from '@offgrid/application';
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

function isDownloadControl(operation: ModelsOperationSnapshot): boolean {
  return operation.kind === 'control' && (
    operation.controlOperation === 'download'
    || operation.controlOperation === 'queue-download'
    || operation.controlOperation === 'pause-download'
    || operation.controlOperation === 'resume-download'
    || operation.controlOperation === 'retry-download'
  );
}

/** Shared operations are the only source for the brief command-in-flight UI state. */
interface DownloadTransitionInput {
  operations: readonly ModelsOperationSnapshot[];
  modelId: string;
  downloadId?: string;
  status?: string;
}

const SETTLING_STATUSES = new Set(['preparing', 'verifying', 'processing']);

export function isDownloadTransitionPending(input: DownloadTransitionInput): boolean {
  if (input.status && SETTLING_STATUSES.has(input.status)) return true;
  return input.operations.some(operation => {
    if (!isDownloadControl(operation)
      || (operation.modelId !== input.modelId && operation.modelId !== input.downloadId)) return false;
    switch (operation.controlOperation) {
      case 'download':
      case 'queue-download':
        return !input.status;
      case 'pause-download':
        return input.status === 'downloading';
      case 'resume-download':
        return input.status === 'paused';
      case 'retry-download':
        return input.status === 'failed' || input.status === 'cancelled' || input.status === 'interrupted';
      default:
        return false;
    }
  });
}

export function usePendingDownloadCommand(
  modelId: string,
  downloadId?: string,
  status?: string,
): boolean {
  return isDownloadTransitionPending({
    operations: useModelsProjection().operations.active, modelId, downloadId, status,
  });
}
