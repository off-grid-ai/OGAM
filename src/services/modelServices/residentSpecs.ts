import type { ResidentSpec } from '@offgrid/models';
import {
  textResidentSpec,
  transcriptionResidentSpec,
  type ResidencyReads,
} from './modelLifecyclePorts';
import { applicationFacade } from '../applicationFacade';

/**
 * The two resident specs, bound to the residency facts on the models SNAPSHOT.
 *
 * `modelLifecyclePorts` takes its residency reads as an argument so the workspace can hand them
 * over when it composes the lifecycle ports; that is what points the dependency the right way. The
 * callers outside that composition - the lifecycle bootstrap and the residency intents behind it -
 * still want the facts for the residency the app is actually running, and this module is the ONE
 * place that binds them.
 *
 * It used to bind them to the live `ModelResidencyManager` instance, reached through a module-level
 * accessor. That accessor was not a second owner - it re-exported the workspace's own manager - but
 * it let any feature reach the owner directly, which made the fixed call direction
 * (app -> facade -> manager -> native adapter) unenforceable by construction. Both facts are
 * snapshot branches, so nothing here needs the instance: `residents` was already on the snapshot
 * and `sessionOverrides` was added for exactly this reader.
 *
 * Read fresh per call rather than captured: a spec resolved from a stale resident list would key a
 * model against a residency that has since changed underneath it.
 */
const snapshotResidencyReads: ResidencyReads = {
  getResidents: () => applicationFacade().models.snapshot().residents,
  hasSessionOverride: modelId =>
    !!modelId && applicationFacade().models.snapshot().sessionOverrides.includes(modelId),
};

export function resolveTextResidentSpec(
  modelId: string,
): Promise<ResidentSpec> {
  return textResidentSpec(modelId, snapshotResidencyReads);
}

export function resolveTranscriptionResidentSpec(
  modelId: string,
): ResidentSpec {
  return transcriptionResidentSpec(modelId, snapshotResidencyReads);
}
