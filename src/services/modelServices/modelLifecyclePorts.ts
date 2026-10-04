import {
  modelResidentSpec,
  modelLoadTimeoutMs,
  type ResidentSpec,
  WHISPER_MODELS,
} from '@offgrid/models';
import { decodeModelRouteId } from '@offgrid/models/workspace';
import type {
  ModelLifecycleApplicationService,
  Resident,
} from '@offgrid/models';
import { useAppStore } from '../../stores/appStore';
import { activeLocalModelId } from './activeRoute';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { hardwareService } from '../hardware';
import { estimateTextModelMemoryMB } from '../modelMemory';
import { mobileRouteId } from './mobileRoute';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';
import { nativeReleaseToResidentReclaim } from '../nativeRelease';
import { whisperService } from '../whisperService';

/**
 * The one place mobile's native teardown answer becomes residency's answer.
 *
 * Residency admits the next model into memory it believes was reclaimed, so `reclaimed: true` may
 * only mean the engine actually let go. `reason` is carried for the report and is never matched
 * on - the boolean is the gating fact, and a refusal makes admission answer `unload_failed`
 * instead of overcommitting.
 */
/**
 * The ONLY two things a resident spec needs from residency: what is already resident, and whether
 * this model has a session memory override.
 *
 * It is a parameter rather than an import because residency is created BY the workspace
 * (`createModelWorkspace` builds the manager from the memory source and logger this app supplies),
 * and the workspace composes these ports. Importing the live manager here made that a cycle -
 * lifecycle ports -> residency bootstrap -> workspace -> lifecycle ports - and the bootstrap's
 * `require('./workspace')` was the edge that closed it. Taking the reads as an argument points the
 * dependency the way composition already runs: the workspace has the manager when it builds these
 * ports, so it hands them the two reads and nothing here has to go looking for it.
 */
/**
 * Declared structurally rather than as `Pick<ModelResidencyManager, ...>`, because these two facts
 * are now SNAPSHOT branches (`residents`, `sessionOverrides`) and a caller should be able to answer
 * them from the snapshot without holding the manager. `readonly Resident[]` is the snapshot's own
 * shape; the manager's `Resident[]` still satisfies it, so composition sites are unchanged.
 */
export interface ResidencyReads {
  getResidents(): readonly Resident[];
  hasSessionOverride(modelId?: string): boolean;
}

export async function textResidentSpec(
  modelId: string,
  residency: ResidencyReads,
): Promise<ResidentSpec> {
  const route = decodeModelRouteId(modelId);
  const nativeModelId = route?.modelId ?? modelId;
  const store = useAppStore.getState();
  const model = store.downloadedModels.find(
    candidate => candidate.id === nativeModelId,
  );
  if (!model) throw new Error('Model not found');
  const routeId =
    modelId === nativeModelId
      ? mobileRouteId({
          source: 'local',
          hostId: model.engine,
          modality: 'text',
          modelId: nativeModelId,
        })
      : modelId;
  return modelResidentSpec(
    {
      modality: 'text',
      modelId: nativeModelId,
      routeId,
      sizeMB: await estimateTextModelMemoryMB(model, store.settings),
      dirtyMemory: model.engine === 'litert',
      residencyKey: 'mobile:text-engine',
    },
    residency.getResidents(),
  );
}

async function imageSpec(
  modelId: string,
  residency: ResidencyReads,
): Promise<ResidentSpec> {
  await hardwareService.getDeviceInfo();
  const model = useAppStore
    .getState()
    .downloadedImageModels.find(candidate => candidate.id === modelId);
  if (!model) throw new Error('Model not found');
  const routeId = mobileRouteId({
    source: 'local',
    hostId: model.backend ?? 'image-runtime',
    modality: 'image',
    modelId,
  });
  return modelResidentSpec(
    {
      modality: 'image',
      modelId,
      routeId,
      sizeMB: Math.round(
        (hardwareService.estimateImageModelRam(model) || 0) / (1024 * 1024),
      ),
      dirtyMemory: true,
      residencyKey: 'mobile:image-engine',
    },
    residency.getResidents(),
  );
}

export function transcriptionResidentSpec(
  modelId: string,
  residency: ResidencyReads,
): ResidentSpec {
  const model = WHISPER_MODELS.find(candidate => candidate.id === modelId);
  if (!model) throw new Error(`Unknown transcription model: ${modelId}`);
  const routeId = mobileRouteId({
    source: 'local',
    hostId: 'whisper.rn',
    modality: 'transcription',
    modelId,
  });
  return modelResidentSpec(
    {
      modality: 'transcription',
      modelId,
      routeId,
      sizeMB: model.size,
      residencyKey: 'mobile:transcription-engine',
      lifecycle: 'persistent',
    },
    residency.getResidents(),
  );
}

/** Native load/unload handlers and route projection. Shared owns the lifecycle. */
export function mobileModelLifecyclePorts(
  residency: ResidencyReads,
): ConstructorParameters<typeof ModelLifecycleApplicationService>[1] {
  return {
    async resolveLoad(modality, modelId, command) {
      if (modality === 'text') {
        const nativeModelId = decodeModelRouteId(modelId)?.modelId ?? modelId;
        const model = useAppStore
          .getState()
          .downloadedModels.find(candidate => candidate.id === nativeModelId);
        if (!model) throw new Error('Model not found');
        return {
          spec: await textResidentSpec(modelId, residency),
          routeId:
            modelId === nativeModelId
              ? mobileRouteId({
                  source: 'local',
                  hostId: model.engine,
                  modality,
                  modelId: nativeModelId,
                })
              : modelId,
          handlers: {
            load: () =>
              nativeModelLifecycle.loadTextModel(
                nativeModelId,
                command.timeoutMs ?? modelLoadTimeoutMs('text'),
                command.override || residency.hasSessionOverride(nativeModelId),
              ),
            unload: async () =>
              nativeReleaseToResidentReclaim(
                await nativeModelLifecycle.unloadTextModel(true),
              ),
          },
        };
      }
      if (modality === 'image') {
        const model = useAppStore
          .getState()
          .downloadedImageModels.find(candidate => candidate.id === modelId);
        if (!model) throw new Error('Model not found');
        return {
          spec: await imageSpec(modelId, residency),
          routeId: mobileRouteId({
            source: 'local',
            hostId: model.backend ?? 'image-runtime',
            modality,
            modelId,
          }),
          handlers: {
            load: () =>
              nativeModelLifecycle.loadImageModel(
                modelId,
                command.timeoutMs ?? modelLoadTimeoutMs('image'),
              ),
            unload: async () =>
              nativeReleaseToResidentReclaim(
                await nativeModelLifecycle.unloadImageModel(true),
              ),
          },
          forceReload: nativeModelLifecycle.imageNeedsReload(modelId),
        };
      }
      if (modality === 'transcription') {
        const nativeModelId = decodeModelRouteId(modelId)?.modelId ?? modelId;
        const routeId = mobileRouteId({
          source: 'local',
          hostId: 'whisper.rn',
          modality,
          modelId: nativeModelId,
        });
        return {
          spec: transcriptionResidentSpec(nativeModelId, residency),
          routeId,
          handlers: {
            load: () =>
              whisperService.loadModel(
                whisperService.getModelPath(nativeModelId),
              ),
            unload: async () =>
              nativeReleaseToResidentReclaim(
                await whisperService.unloadModel(),
              ),
          },
        };
      }
      throw new Error(`Unsupported persistent lifecycle modality: ${modality}`);
    },
    async resolveUnload(modality) {
      if (modality === 'transcription') {
        const resident = residency
          .getResidents()
          .find(candidate => candidate.type === 'transcription');
        return {
          key: resident?.key ?? 'mobile:transcription-engine',
          hadRuntime: whisperService.isModelLoaded(),
          unload: async () =>
            nativeReleaseToResidentReclaim(
              await whisperService.unloadModel(),
            ),
        };
      }
      const text = modality === 'text';
      const nativeModelId = text
        ? nativeModelLifecycle.getState().loadedTextModelId
        : nativeModelLifecycle.getState().loadedImageModelId;
      const modelId =
        nativeModelId ?? activeLocalModelId(text ? 'text' : 'image');
      const spec = modelId
        ? text
          ? await textResidentSpec(modelId, residency)
          : await imageSpec(modelId, residency)
        : modelResidentSpec(
            {
              modality,
              modelId: 'untracked',
              routeId: 'untracked',
              sizeMB: 0,
              residencyKey: text ? 'mobile:text-engine' : 'mobile:image-engine',
            },
            residency.getResidents(),
          );
      return {
        key: spec.key,
        // A selected route is application state, not proof that the native runtime holds memory.
        // Shared uses this answer to count what the user actually ejected.
        hadRuntime: !!nativeModelId,
        unload: async () =>
          nativeReleaseToResidentReclaim(
            await (text
              ? nativeModelLifecycle.unloadTextModel(true)
              : nativeModelLifecycle.unloadImageModel(true)),
          ),
      };
    },
    selectRoute: (modality, routeId) =>
      lifecycleProjectionPort.selectRoute(modality, routeId),
    refreshInventory: async () => {
      await lifecycleProjectionPort.refreshInventory();
    },
  };
}
