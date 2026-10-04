import type { ModelModality, ModelsFailure, Outcome } from '@offgrid/application';
import { applicationFacade } from '../applicationFacade';
import { mobileRouteId, type MobileRouteFacts } from './mobileRoute';

function failureMessage(failure: ModelsFailure): string {
  if ('message' in failure && typeof failure.message === 'string') return failure.message;
  if ('reason' in failure && typeof failure.reason === 'string') return failure.reason;
  return failure.kind;
}

function requireModelOutcome<Value>(outcome: Outcome<Value, ModelsFailure>): Value {
  if (outcome.ok) return outcome.value;
  throw new Error(failureMessage(outcome.failure));
}

/** Select one canonical route through the Shared application owner. */
export async function selectModelRoute(facts: MobileRouteFacts): Promise<void> {
  const models = applicationFacade().models;
  // A catalog/store update can precede its coalesced inventory subscription. The user's tap is an
  // explicit command, so resolve against a fresh inventory instead of racing that background read.
  requireModelOutcome(await models.refresh());
  if (facts.source === 'remote' && facts.modality === 'text') {
    requireModelOutcome(await models.unload({ modality: 'text', keepSelection: true }));
  }
  const modelId = mobileRouteId(facts);
  // Remote routes are inventory identities, not downloadable control-catalog rows.
  if (facts.source === 'remote') {
    requireModelOutcome(await models.select({modality: facts.modality, modelId}));
    return;
  }
  if (facts.modality === 'text' || facts.modality === 'image' || facts.modality === 'transcription') {
    requireModelOutcome(await models.control({
      type: 'select',
      surface: facts.modality,
      modelId,
    }));
    return;
  }
  if (facts.modality === 'voice') {
    requireModelOutcome(await models.control({ type: 'select', surface: 'speech', modelId }));
    return;
  }
  requireModelOutcome(await models.select({ modality: facts.modality, modelId }));
}

/** Unload native memory and clear the canonical selection. */
export async function unloadAndClearModel(modality: ModelModality): Promise<void> {
  const models = applicationFacade().models;
  requireModelOutcome(await models.unload({ modality, keepSelection: true }));
  requireModelOutcome(await models.select({ modality, modelId: null }));
}

export async function reloadLocalTextModel(modelId: string): Promise<void> {
  const models = applicationFacade().models;
  requireModelOutcome(await models.unload({ modality: 'text', keepSelection: true }));
  requireModelOutcome(await models.load({ modality: 'text', modelId }));
}
