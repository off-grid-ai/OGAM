import { modelsFailureMessage } from '@offgrid/application';
import type { ActiveModelSnapshot } from '@offgrid/models';
import { applicationFacade } from '../applicationFacade';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';
import { mobileRouteId, type MobileRouteFacts } from './mobileRoute';

/**
 * The route-selection commands, kept OUT of the `modelServices` barrel so a port or an adapter
 * can issue one without depending on the composition that the barrel performs. Every command is
 * an `@offgrid/application` call plus the registered inventory projection - no local policy.
 */

type ModelSelectionOutcome = Awaited<
  ReturnType<ReturnType<typeof applicationFacade>['models']['select']>
>;

/** The canonical typed refusal a selection command rejects with. */
type ModelSelectionFailure = Extract<
  ModelSelectionOutcome,
  { ok: false }
>['failure'];

/**
 * A rejected selection carries the owner's typed failure, so a surface can render the canonical
 * message and offer a retry instead of inventing its own error text.
 */
class ModelSelectionFailedError extends Error {
  readonly failure: ModelSelectionFailure;

  constructor(failure: ModelSelectionFailure) {
    super(modelsFailureMessage(failure));
    this.name = 'ModelSelectionFailedError';
    this.failure = failure;
  }
}

/** The one projector from a rejected selection command to display text. */
export function modelSelectionFailureMessage(cause: unknown): string {
  if (cause instanceof ModelSelectionFailedError) return cause.message;
  if (cause instanceof Error && cause.message) return cause.message;
  return 'The model selection could not be applied.';
}

function requireSelected(outcome: ModelSelectionOutcome): void {
  if (outcome.ok) return;
  throw new ModelSelectionFailedError(outcome.failure);
}

/** The user picked a model. The application facade owns remote activation and route selection. */
export async function selectMobileModel(facts: MobileRouteFacts): Promise<void> {
  requireSelected(
    await applicationFacade().models.select({
      modality: facts.modality,
      modelId: mobileRouteId(facts),
    }),
  );
  await lifecycleProjectionPort.refreshInventory();
}

/** Convenience intent for UI surfaces that select a discovered remote route. */
export function selectRemoteMobileModel(
  serverId: string,
  modality: MobileRouteFacts['modality'],
  modelId: string,
): Promise<void> {
  return selectMobileModel({ source: 'remote', hostId: serverId, modality, modelId });
}

export async function clearMobileModel(
  modality: ActiveModelSnapshot['modality'],
): Promise<void> {
  requireSelected(
    await applicationFacade().models.select({ modality, modelId: null }),
  );
  await lifecycleProjectionPort.refreshInventory();
}
