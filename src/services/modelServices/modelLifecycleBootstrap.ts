import { useModelResidencyStore } from '../../stores/modelResidencyStore';
import {
  modelLoadRefusal,
  runIndependentUnloads,
  unloadPersistentResident,
} from '@offgrid/models';
import { modelsFailureMessage, type ModelsFailure } from '@offgrid/application';
import { applicationFacade } from '../applicationFacade';
import logger from '../../utils/logger';
import { OverridableMemoryError } from '../modelLoadErrors';
import { whisperService } from '../whisperService';
import {
  nativeReleaseToResidentReclaim,
  type NativeRelease,
} from '../nativeRelease';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';
import { resolveTextResidentSpec, resolveTranscriptionResidentSpec } from './residentSpecs';

export { resolveTextResidentSpec, resolveTranscriptionResidentSpec };

interface LoadOptions {
  override?: boolean;
}

export type TranscriptionLoadResult = 'loaded' | 'blocked' | 'error';

interface TranscriptionLifecycleObserver {
  onLoaded?(): void;
  onUnloaded?(): void;
}

/**
 * Whisper's teardown, as residency's answer. The observer is told either way - the app's own
 * bookkeeping is invalid whatever the engine did - but residency is told the TRUTH, because it
 * admits the next model into this memory.
 */
async function reclaimFrom(
  release: Promise<NativeRelease>,
  observer: TranscriptionLifecycleObserver,
): Promise<ReturnType<typeof nativeReleaseToResidentReclaim>> {
  const outcome = await release;
  observer.onUnloaded?.();
  return nativeReleaseToResidentReclaim(outcome);
}

function refusedLoad(override: boolean | undefined): Error {
  const refusal = modelLoadRefusal(!!override);
  return refusal.overridable
    ? new OverridableMemoryError(refusal.message)
    : new Error(refusal.message);
}

/**
 * Turn the facade's typed failure back into the ERROR IDENTITY the app's readiness layer depends
 * on. `isOverridableMemoryError` gates the whole "Run anyway" journey - `loadModelWithOverride`,
 * `chatModelReadinessPort.isMemoryRefusal`, `ttsPlayback.isRetryable`, the image ports and the
 * failure handler all branch on it - so a load that used to reject with an
 * `OverridableMemoryError` must still reject with one.
 *
 * It round-trips faithfully: shared classifies an overridable native memory error as
 * `memory_refused` carrying `overridable`, so the flag comes from the failure rather than being
 * guessed. `not_ready` is the ADMISSION refusal - shared throws `NotLoaded` exactly where the old
 * boolean was false - and keeps the shared refusal copy, which is product copy a caller renders.
 */
function loadRejection(
  failure: ModelsFailure,
  override: boolean | undefined,
): Error {
  if (failure.kind === 'memory_refused') {
    return failure.overridable
      ? new OverridableMemoryError(failure.reason)
      : new Error(failure.reason);
  }
  if (failure.kind === 'not_ready') return refusedLoad(override);
  return new Error(modelsFailureMessage(failure));
}

const models = () => applicationFacade().models;

async function loadThrough(command: {
  readonly modality: 'text' | 'image';
  readonly modelId: string;
  readonly timeoutMs?: number;
  readonly override?: boolean;
}): Promise<void> {
  const outcome = await models().load({
    modality: command.modality,
    modelId: command.modelId,
    override: !!command.override,
    timeoutMs: command.timeoutMs,
  });
  if (!outcome.ok) throw loadRejection(outcome.failure, command.override);
}

export function loadTextModel(
  modelId: string,
  timeoutMs?: number,
  options?: LoadOptions,
): Promise<void> {
  return loadThrough({
    modality: 'text',
    modelId,
    timeoutMs,
    override: options?.override,
  });
}

export function loadImageModel(
  modelId: string,
  timeoutMs?: number,
  options?: LoadOptions,
): Promise<void> {
  return loadThrough({
    modality: 'image',
    modelId,
    timeoutMs,
    override: options?.override,
  });
}

/**
 * Load the selected local transcription model through the shared atomic
 * admission and residency lifecycle. Native Whisper remains an I/O adapter.
 */
export async function loadTranscriptionModel(
  modelId: string,
  observer: TranscriptionLifecycleObserver = {},
): Promise<TranscriptionLoadResult> {
  const outcome = await models().load({
    modality: 'transcription',
    modelId,
  });
  if (!outcome.ok) {
    if (
      outcome.failure.kind === 'not_ready' ||
      outcome.failure.kind === 'memory_refused'
    ) return 'blocked';
    throw loadRejection(outcome.failure, false);
  }
  observer.onLoaded?.();
  return whisperService.getLoadedModelPath() === whisperService.getModelPath(modelId)
    ? 'loaded'
    : 'error';
}

/**
 * `false` is a legitimate answer - nothing was loaded - so a FAILED unload must not be reported as
 * one. The typed failure is thrown, which is what the old service did with a real error.
 */
async function unloadThrough(
  modality: 'text' | 'image',
  keepSelection: boolean,
): Promise<boolean> {
  const outcome = await models().unload({modality, keepSelection});
  if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
  return outcome.value;
}

export async function unloadTextModel(keepSelection = false): Promise<boolean> {
  const unloaded = await unloadThrough('text', keepSelection);
  if (!keepSelection) useModelResidencyStore.getState().setTextModelEvicted(false);
  return unloaded;
}

export function unloadImageModel(keepSelection = false): Promise<boolean> {
  return unloadThrough('image', keepSelection);
}

export async function unloadTranscriptionModel(
  modelId?: string | null,
  observer: TranscriptionLifecycleObserver = {},
): Promise<boolean> {
  const selectedModelId = modelId;
  const resident = selectedModelId
    ? resolveTranscriptionResidentSpec(selectedModelId)
    : applicationFacade().models.snapshot().residents.find(
        candidate => candidate.type === 'transcription',
      );
  if (!resident && !whisperService.isModelLoaded()) return false;
  const key = resident?.key ?? 'transcription';
  // `nativeUnload` now ANSWERS, so this path can finally report what the last one could not: the
  // helper's parameter is `() => Promise<ResidentReclaim>` and its result is a
  // `ResidentUnloadOutcome`, so a whisper context the engine refused to release is carried through
  // instead of being flattened into a boolean.
  const outcome = await unloadPersistentResident({
    manager: applicationFacade().models.residency,
    key,
    nativeUnload: () => reclaimFrom(whisperService.unloadModel(), observer),
  });
  observer.onUnloaded?.();
  await lifecycleProjectionPort.refreshInventory();
  if (!outcome.reclaimed) {
    logger.warn(
      `[TranscriptionLifecycle] whisper did not release its context: ${
        outcome.reason ?? 'no reason given'
      }`,
    );
  }
  return outcome.reclaimed;
}

export async function unloadAllModels(
  keepSelection = false,
): Promise<{ textUnloaded: boolean; imageUnloaded: boolean }> {
  return runIndependentUnloads({
    textUnloaded: () => unloadTextModel(keepSelection),
    imageUnloaded: () => unloadImageModel(keepSelection),
  });
}
