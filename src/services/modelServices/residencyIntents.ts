import type { ResidencyLoadPolicy } from '@offgrid/models';
import {
  loadImageModel,
  loadTextModel,
  loadTranscriptionModel,
  resolveTextResidentSpec,
  resolveTranscriptionResidentSpec,
  unloadAllModels,
  unloadImageModel,
  unloadTextModel,
  unloadTranscriptionModel,
} from './modelLifecycleBootstrap';
import { modelsFailureMessage } from '@offgrid/application';
import { applicationFacade } from '../applicationFacade';

/** Canonical application intents. Only this model-service boundary invokes native lifecycle APIs. */
export const mobileResidencyIntents = {
  /**
   * The facade's command, not a local re-implementation. `ejectAllModels` used to live in the
   * lifecycle bootstrap and assemble `ejectModelResidency` itself; shared owns that order now, and
   * app code asks for it the same way any other caller does.
   */
  async ejectAll(): Promise<{ count: number }> {
    const outcome = await applicationFacade().models.eject();
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    return outcome.value;
  },
  unloadAll: unloadAllModels,
  unloadImage: unloadImageModel,
  unloadText: unloadTextModel,
  ensureText: loadTextModel,
  ensureImage: loadImageModel,
  ensureTranscription: loadTranscriptionModel,
  unloadTranscription: unloadTranscriptionModel,
  setLoadPolicy(policy: ResidencyLoadPolicy): void {
    applicationFacade().models.setLoadPolicy(policy);
  },
  async canPreloadText(modelId: string): Promise<boolean> {
    return applicationFacade().models.canLoadWithoutEviction(
      await resolveTextResidentSpec(modelId),
    );
  },
  canPreloadTranscription(modelId: string): boolean {
    return applicationFacade().models.canLoadWithoutEviction(
      resolveTranscriptionResidentSpec(modelId),
    );
  },
};
