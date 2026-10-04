/**
 * Load-policy projection — the SINGLE place the persisted "aggressive model
 * loading" setting is mapped to the residency manager's runtime LoadPolicy.
 *
 * Separation of concerns (MVVM-ish):
 *  - Views (the Settings screen AND the in-chat quick settings) only dispatch an
 *    intent through Shared Models settings. They never touch the
 *    residency manager or compute a policy themselves — so the two surfaces can't
 *    drift.
 *  - This module PROJECTS that one setting onto the application facade, which owns
 *    the runtime policy. The boolean→policy mapping lives in Shared.
 *  - The ports this projection runs on live in `modelServices/loadPolicyPorts`, so
 *    the composition root can construct the coordinator without importing a consumer.
 */
import type {ModelSettingsRecord} from '@offgrid/application';
import type {PersistedLoadPolicySettings} from '@offgrid/models';
import {applicationFacade} from './applicationFacade';
import { loadPolicyTransition } from './composition/text-load';

function loadPolicySettings(
  settings: ModelSettingsRecord,
): PersistedLoadPolicySettings {
  const mode = settings.modelLoadingMode;
  if (
    mode === 'conservative' ||
    mode === 'balanced' ||
    mode === 'aggressive'
  ) {
    return {modelLoadingMode: mode};
  }
  const legacy = settings.aggressiveModelLoading;
  if (typeof legacy === 'boolean') return {aggressiveModelLoading: legacy};
  return {modelLoadingMode: 'conservative'};
}

/**
 * Mobile keeps the committed Shared-settings subscription. Shared owns legacy reconciliation,
 * effective-policy diffing, and ejection policy.
 */
export interface LoadPolicySyncCoordinator {
  start(): void;
  dispose(): void;
}

/** Create one explicit app-lifetime projection. Repeated start calls are idempotent. */
export function createLoadPolicySync(): LoadPolicySyncCoordinator {
  let policy: ReturnType<typeof loadPolicyTransition> | null = null;
  let unsubscribe: (() => void) | null = null;
  return {
    start() {
      if (unsubscribe) return;
      policy = loadPolicyTransition();
      const models = applicationFacade().models;
      policy.apply(loadPolicySettings(models.snapshot().settings));
      unsubscribe = models.watch(
        snapshot => snapshot.settings,
        settings => policy?.apply(loadPolicySettings(settings)),
      );
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = null;
      policy?.dispose();
      policy = null;
    },
  };
}

/** Compatibility entry point for tests and non-React composition roots. */
export function startLoadPolicySync(): () => void {
  const coordinator = createLoadPolicySync();
  coordinator.start();
  return () => coordinator.dispose();
}
