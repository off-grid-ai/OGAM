import type { RuntimeModel, WorkspaceGenerationPort } from '@offgrid/models';
import { mobileVoiceGenerationService as voiceGeneration } from '../composition/generation';
import { applicationFacade } from '../applicationFacade';
import type { DownloadedModel, RemoteModel } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { serverDiscoveredModels } from '../../stores/remoteServerProjection';
import { useModelSelectionStore } from '../../stores/modelSelectionStore';
import { useModelResidencyStore } from '../../stores/modelResidencyStore';
import {
  resolveSelectedTextModel,
  subscribeToModelState,
} from './modelState';
import { mobileInventoryAdapters } from './inventoryAdapters';
import { mobileRouteFacts } from './mobileRoute';
import {
  refreshMobileLLMServiceInventory,
  selectMobileRoute,
} from './mobileLLMService';
import { reconcileMobileGenerationAdapters } from './generationAdapters';
import { reconcileMobileTranscriptionAdapters } from './transcriptionGenerationAdapter';
import { reconcileMobileVoiceAdapters } from './voiceGenerationAdapter';
import { reconcileMobileSidecarAdapters } from './sidecarGenerationAdapter';
import { registerLifecycleProjectionPort } from './lifecycleProjectionPort';
import { registerMobileMemoryWarningRecovery } from './memoryWarningRecovery';
import { composeMobileSidecarExecution } from './sidecarExecutionComposition';
import { registerModelSelectionCommandPort } from './modelSelectionCommandPort';
import { removeMobileServerSelection } from './modelSelectionProjection';
import { reportModelFailure } from '../modelFailureHandler';
import logger from '../../utils/logger';
import { registerSharedDownloadProjection } from './downloadProjectionAdapter';

registerLifecycleProjectionPort({
  // The full refresh: an inventory rebuild is only complete once the generation,
  // transcription, voice and sidecar adapters have been reconciled against it.
  refreshInventory: () => refreshMobileModelServices(),
  selectRoute: selectMobileRoute,
});
registerModelSelectionCommandPort({
  select: selectMobileRoute,
  async removeServer(serverId) {
    await Promise.all(
      (['text', 'image', 'transcription', 'voice', 'embedding'] as const).map(
        modality => removeMobileServerSelection(modality, serverId),
      ),
    );
  },
});
// Both members are facade seams now. `mainQueue.generate` is the awaited form of the same
// operation `ModelsFacade.generate` streams - shared already held it, because the stream is a
// projection OVER a promise, so this is not a second implementation of "fold a stream into a
// result". That fold is domain policy (which event is terminal, what happens to partial output,
// how a failure becomes a rejection) and is exactly what this app must not own.
//
// It rejects with `ModelsGenerationError` carrying a CLASSIFIED `ModelsFailure`, never a native
// error, so no caller classifies. Nothing here had to change to accommodate that: every consumer
// of this port - the sidecar text, embedding and classification paths and their six callers -
// lets a rejection propagate, and none of them inspects an error. Verified rather than assumed.
const mobileGenerationService: WorkspaceGenerationPort = {
  generate: (request, events) =>
    applicationFacade().models.mainQueue.generate(request, events),
  registerAdapter: adapter =>
    applicationFacade().models.adapters.registerGeneration(adapter),
};
/**
 * Voice has its own queue so sentence playback can run while text is still streaming.
 *
 * The stable forwarding port resolves the application only when a real operation starts. A Proxy
 * cannot be used here: React Refresh inspects exported object properties during module loading,
 * and that inspection would construct the application before Pro registers its ports.
 */
export const mobileVoiceGenerationService: WorkspaceGenerationPort = {
  generate: (request, events) => voiceGeneration().generate(request, events),
  registerAdapter: adapter => voiceGeneration().registerAdapter(adapter),
};
const generationAdapterRegistrations = new Map<string, () => void>();
const transcriptionAdapterRegistrations = new Map<string, () => void>();
const voiceAdapterRegistrations = new Map<string, () => void>();
const sidecarAdapterRegistrations = new Map<string, () => void>();

let started = false;
let refreshChain = Promise.resolve<RuntimeModel[]>([]);
const cleanups: Array<() => void> = [];

type ModelServiceInitializationStage = 'inventory';

export function projectMobileModelServiceInitializationFailure(
  stage: ModelServiceInitializationStage,
  error: unknown,
): void {
  logger.error(`[ModelServices] ${stage} initialization failed`, error);
  reportModelFailure('text', error, {
    id: `mobile-model-services-${stage}`,
    title: 'Model services are unavailable',
    message: error instanceof Error
      ? error.message
      : 'Off Grid could not initialize the model service.',
  });
}

function consumeAlreadyProjectedFailure(): void {
  // The owner has logged and projected this error. Startup observers consume the
  // rejection only to prevent an unhandled promise rejection.
}

/**
 * Run `refresh` when one of `slices` MOVED, and not otherwise.
 *
 * `!==` is the whole comparison, deliberately: for the collections here it is reference identity,
 * which every one of these stores already replaces on a real change, so identity IS the revision
 * and no counter has to be introduced or kept in step. For a primitive it is the value.
 *
 * `watch(selector)` is the equivalent on the application FACADE and is the right tool for a
 * snapshot slice. These five are app STORES, not the facade, so this is the store-side form of the
 * same rule rather than a second mechanism.
 */
function whenChanged<State>(
  store: {
    subscribe(listener: (state: State, previous: State) => void): () => void;
  },
  run: () => void,
  slices: ReadonlyArray<(state: State) => unknown>,
): () => void {
  return store.subscribe((state, previous) => {
    if (slices.some(read => read(state) !== read(previous))) run();
  });
}

/** Serialize inventory rebuilds so an older store snapshot cannot win a race. */
export function refreshMobileModelServices(): Promise<RuntimeModel[]> {
  const refreshInventory = () => refreshMobileLLMServiceInventory();
  refreshChain = refreshChain
    .then(refreshInventory, refreshInventory)
    .then(inventory => {
      // The reconcilers now take the INVENTORY ROWS the refresh just produced, not a routing
      // port. They only ever asked "which adapter ids does the inventory publish", and this is
      // the answer the refresh already has in hand - so no second listing, and no re-copy of
      // every row, which `llm.list()` did on every call.
      reconcileMobileGenerationAdapters(
        mobileGenerationService,
        inventory,
        generationAdapterRegistrations,
      );
      reconcileMobileTranscriptionAdapters(
        mobileGenerationService,
        inventory,
        transcriptionAdapterRegistrations,
      );
      reconcileMobileVoiceAdapters(
        mobileVoiceGenerationService,
        inventory,
        voiceAdapterRegistrations,
      );
      reconcileMobileSidecarAdapters(
        mobileGenerationService,
        inventory,
        sidecarAdapterRegistrations,
      );
      return inventory;
    })
    .catch(error => {
      projectMobileModelServiceInitializationFailure('inventory', error);
      throw error;
    });
  return refreshChain;
}

composeMobileSidecarExecution(mobileGenerationService, refreshMobileModelServices);

/** Connect persisted and native Mobile projections to the shared service once. */
export function startMobileModelServices(): () => void {
  if (!started) {
    started = true;
    // Inventory adapters register HERE rather than at module scope, for two reasons: the facade is
    // not configured during this module's import, and each registration now returns its own
    // unregister - so `stopMobileModelServices` actually unregisters them, which the old
    // module-scope `forEach` never did.
    const adapters = applicationFacade().models.adapters;
    for (const adapter of mobileInventoryAdapters) {
      cleanups.push(adapters.registerInventory(adapter));
    }
    cleanups.push(registerSharedDownloadProjection());
    const refresh = () => {
      refreshMobileModelServices().catch(consumeAlreadyProjectedFailure);
    };
    // A full inventory rebuild per store WRITE was the worst subscription in the app: five
    // whole-store listeners, so typing one character into any settings field - or a transfer
    // progress tick, or a health poll - relisted every inventory adapter, reconciled four adapter
    // sets, and republished the snapshot. Now each store is watched for only the facts the
    // inventory is actually BUILT from, compared by identity, which is the revision. The classifier
    // pick is no longer among them: it lives in the selection store, watched just below.
    cleanups.push(whenChanged(useAppStore, refresh, [
      state => state.downloadedModels,
      state => state.downloadedImageModels,
    ]));
    cleanups.push(whenChanged(useRemoteServerStore, refresh, [
      state => state.servers,
      state => state.serverHealth,
    ]));
    cleanups.push(whenChanged(useModelSelectionStore, refresh, [
      state => state.entries,
    ]));
    cleanups.push(whenChanged(useModelResidencyStore, refresh, [
      state => state.loadedTextModelId,
    ]));
    // Purpose-built for exactly this: it already fires only on the model-state facts that matter.
    cleanups.push(subscribeToModelState(refresh));
    cleanups.push(registerMobileMemoryWarningRecovery());
    refreshMobileModelServices().catch(consumeAlreadyProjectedFailure);
  }
  return stopMobileModelServices;
}

export function stopMobileModelServices(): void {
  if (!started) return;
  started = false;
  for (const cleanup of cleanups.splice(0)) cleanup();
}

/** Presentation adapter: recover the rich Mobile record after shared routing selected it. */
export function mobileTextModelRecord(
  model: RuntimeModel | null,
): DownloadedModel | RemoteModel | null {
  if (!model) return null;
  const identity = mobileRouteFacts(model);
  if (!identity || identity.modality !== 'text') return null;
  if (identity.source === 'local') {
    return useAppStore.getState().downloadedModels.find(
      candidate => candidate.id === identity.modelId && candidate.engine === identity.hostId,
    ) ?? resolveSelectedTextModel();
  }
  const server = useRemoteServerStore.getState().servers.find(item => item.id === identity.hostId);
  return server
    ? serverDiscoveredModels(server).find(candidate => candidate.id === identity.modelId) ?? null
    : null;
}

export {
  clearMobileModel,
  modelSelectionFailureMessage,
  selectMobileModel,
  selectRemoteMobileModel,
} from './selectionCommands';
