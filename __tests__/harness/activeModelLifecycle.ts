/** Real shared application root for Mobile model-lifecycle tests. */
import {
  errorFromModelsFailure,
  modelsFailureMessage,
  type OffGridApplication,
} from '@offgrid/application';
import type {
  Resident,
  ResidencyAcquireOptions,
  ResidencyLifecycleHandlers,
  ResidencyReclaimPolicy,
  ResidentSpec,
} from '@offgrid/models';
import {
  refreshMobileModelServices,
  startMobileModelServices,
  stopMobileModelServices,
} from '../../src/services/modelServices';
import { getResourceUsage } from '../../src/services/modelServices/modelStateNativeProjection';
import {
  getMobileApplication,
  resetMobileApplication,
} from '../../src/services/composition/application';

/**
 * Resolved per call, never captured. `resetMobileApplication()` composes a NEW root, so a
 * module-level binding would leave every helper below pointing at the discarded one.
 */
const app = (): OffGridApplication => getMobileApplication();

/** Replace all shared domain state while retaining Mobile's production boundary adapters. */
export async function resetModelApplication(
  options: { readonly budgetMB?: number | null } = {},
): Promise<OffGridApplication> {
  if (options.budgetMB != null) {
    throw new Error(
      'Set deterministic native memory values instead of overriding domain policy.',
    );
  }
  // Recycle through the PUBLIC lifecycle: the composition root disposes the running application and
  // composes a fresh one, so no test leaves residents, session overrides, load policy, or queued
  // residency work for the next. Mobile stores are projections and cannot reset shared state.
  // Drain the Mobile projection subscriptions FIRST. `stopMobileModelServices` runs every
  // registered cleanup (services/modelServices/index.ts:215) and clears the module-level `started`
  // flag (index.ts:78). Without it the re-start below is a no-op, the previous test's store
  // watchers stay live, and each `setState` in the next test fires an un-awaited
  // `refreshMobileModelServices()` that can resolve after teardown.
  stopMobileModelServices();
  await resetMobileApplication();
  startMobileModelServices();
  await refreshMobileModelServices();
  await app().models.refresh();
  return app();
}

export function modelApplication(): OffGridApplication {
  return app();
}

/**
 * Compatibility vocabulary for older memory specifications. It delegates to the public Models
 * facade and reads its immutable projection. It does not own domain state.
 */
export const modelResidencyManager = {
  acquire(
    spec: ResidentSpec,
    handlers: ResidencyLifecycleHandlers,
    options?: ResidencyAcquireOptions,
  ) {
    return app().models.residency.acquire(spec, handlers, options);
  },
  getResidents(): readonly Resident[] {
    return app().models.snapshot().residents;
  },
  isResident(key: string): boolean {
    return app().models.residency.isResident(key);
  },
  hasSessionOverride(modelId?: string): boolean {
    return app().models
      .snapshot()
      .sessionOverrides.includes(modelId ?? '');
  },
  setLoadPolicy(policy: 'conservative' | 'balanced' | 'aggressive'): void {
    app().models.setLoadPolicy(policy);
  },
  getLoadPolicy(): 'conservative' | 'balanced' | 'aggressive' {
    return app().models.snapshot().loadPolicy;
  },
  setBudgetOverrideMB(value: number | null): void {
    if (value != null)
      throw new Error(
        'Set deterministic native memory values instead of overriding domain policy.',
      );
  },
  _reset(): Promise<OffGridApplication> {
    return resetModelApplication();
  },
  async evictByKey(key: string): Promise<boolean> {
    const outcome = await app().models.ejectResident({ key });
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    return outcome.value;
  },
  async reclaim(policy: ResidencyReclaimPolicy): Promise<readonly string[]> {
    const outcome = await app().models.reclaim(policy);
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    return outcome.value;
  },
  unload(
    key: string,
    unloadUntracked: Parameters<
      OffGridApplication['models']['residency']['unload']
    >[1],
  ) {
    return app().models.residency.unload(key, unloadUntracked);
  },
};

type ModelsOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly failure: Parameters<typeof modelsFailureMessage>[0];
    };

async function unwrap<T>(promise: Promise<ModelsOutcome<T>>): Promise<T> {
  const outcome = await promise;
  if (!outcome.ok) throw errorFromModelsFailure(outcome.failure);
  return outcome.value;
}

export const activeModelService = {
  checkMemoryForDualModel: (firstId: string | null, secondId: string | null) =>
    app().models.memoryAdvice.forCombination([
      ...(firstId ? [{ id: firstId, type: 'text' as const }] : []),
      ...(secondId ? [{ id: secondId, type: 'image' as const }] : []),
    ]),
  checkMemoryForModel: (modelId: string, modality: 'text' | 'image') =>
    app().models.memoryAdvice.forSelection(modelId, modality),
  ejectAll: () => unwrap(app().models.eject()),
  getActiveModels: () => app().models.snapshot().active,
  getLoadedModelIds: () => ({
    textModelId:
      app().models.snapshot().residents.find(resident => resident.type === 'text')
        ?.modelId ?? null,
    imageModelId:
      app().models.snapshot().residents.find(resident => resident.type === 'image')
        ?.modelId ?? null,
  }),
  getCurrentlyLoadedMemoryGB: () =>
    app().models
      .snapshot()
      .residents.reduce((total, resident) => total + resident.sizeMB, 0) / 1024,
  // Device telemetry is a native projection, not application-owned model lifecycle state.
  getResourceUsage,
  hasAnyModelLoaded: () => app().models.snapshot().residents.length > 0,
  loadImageModel: (
    modelId: string,
    timeoutMs?: number,
    options?: { override?: boolean },
  ) =>
    unwrap(
      app().models.load({
        modality: 'image',
        modelId,
        timeoutMs,
        override: !!options?.override,
      }),
    ),
  loadTextModel: (
    modelId: string,
    timeoutMs?: number,
    options?: { override?: boolean },
  ) =>
    unwrap(
      app().models.load({
        modality: 'text',
        modelId,
        timeoutMs,
        override: !!options?.override,
      }),
    ),
  resolveSelectedTextModel: () =>
    app().models.snapshot().active.text?.model ?? null,
  selectedTextModelId: () => app().models.activeModelId('text'),
  selectTextModel: (modelId: string | null) =>
    unwrap(app().models.select({ modality: 'text', modelId })),
  subscribe: (
    listener: Parameters<OffGridApplication['models']['subscribe']>[0],
  ) => app().models.subscribe(listener),
  supportsAudioInput: () =>
    app().models.snapshot().active.text?.model?.capabilities.audioInput ??
    false,
  syncWithNativeState: () => app().models.refresh(),
  unloadAllModels: async (keepSelection = false) => ({
    textUnloaded: await unwrap(
      app().models.unload({ modality: 'text', keepSelection }),
    ),
    imageUnloaded: await unwrap(
      app().models.unload({ modality: 'image', keepSelection }),
    ),
  }),
  unloadImageModel: (keepSelection = false) =>
    unwrap(app().models.unload({ modality: 'image', keepSelection })),
  unloadTextModel: (keepSelection = false) =>
    unwrap(app().models.unload({ modality: 'text', keepSelection })),
};
