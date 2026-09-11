import { useModelResidencyStore } from '../../stores/modelResidencyStore';
import {
  IMAGE_MINIMUM_SIZE,
  MAX_IMAGE_STEPS,
  resolveImageGenerationSettings,
  type ImageApplicationRequest,
  type ImageApplicationFailure,
  type ImageGenerationApplicationPorts,
  type RuntimeModel,
} from '@offgrid/models';
import { Platform } from 'react-native';
import { useAppStore } from '../../stores/appStore';
import type { GeneratedImage } from '../../types';
import { generateId } from '../../utils/generateId';
import {
  isImageModelIncompleteError,
  isOverridableMemoryError,
} from '../../utils/modelLoadErrors';
import { mobileTextEngineControl } from './textEngineControl';
import { applicationFacade } from '../applicationFacade';
import { enhanceImagePrompt } from '../imagePromptEnhancement';
import { saveImageGenerationResult } from '../imageGenerationResult';
import type { ActiveImageModel } from '../imageGenerationTypes';
import { localDreamGeneratorService } from '../localDreamGenerator';
import { reportModelFailure } from '../modelFailureHandler';
import { executeMobileImageGeneration } from '../sharedImageGeneration';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';
import { mobileResidencyIntents } from './residencyIntents';
import {
  cancelActiveImageGenerationAtBoundary,
  ImageGenerationCancelError,
} from './imageGenerationAdapter';

/** Read-only Mobile projection of the limits owned by Shared Models. */
export const mobileImageQualityLimits = Object.freeze({
  minimumSize: IMAGE_MINIMUM_SIZE,
  maximumSteps: MAX_IMAGE_STEPS,
});

function localModel(model: RuntimeModel): ActiveImageModel {
  const record = useAppStore
    .getState()
    .downloadedImageModels.find(candidate => candidate.id === model.id);
  if (!record)
    throw new Error(`The selected image model is unavailable: ${model.name}`);
  return record;
}

function presentationModel(model: RuntimeModel): ActiveImageModel {
  return model.source === 'local'
    ? localModel(model)
    : {
        id: model.id,
        name: model.name,
        modelPath: model.serverId ?? model.adapterId,
        backend: 'remote',
      };
}

let executing = false;

/** Project committed Shared Models settings through the one Shared image-settings resolver. */
export function resolvedCommittedImageSettings(
  settings: Readonly<Record<string, unknown>>,
  request?: ImageApplicationRequest,
) {
  const numberSetting = (key: string): number | undefined => {
    const value = settings[key];
    return typeof value === 'number' ? value : undefined;
  };
  const booleanSetting = (key: string): boolean | undefined => {
    const value = settings[key];
    return typeof value === 'boolean' ? value : undefined;
  };
  return {
    ...resolveImageGenerationSettings({
      platform: Platform.OS,
      request: request ?? { prompt: '' },
      settings: {
        steps: numberSetting('imageSteps'),
        guidanceScale: numberSetting('imageGuidanceScale'),
        width: numberSetting('imageWidth'),
        height: numberSetting('imageHeight'),
        threads: numberSetting('imageThreads'),
        useOpenCL: booleanSetting('imageUseOpenCL'),
      },
    }),
    enhancePrompt: booleanSetting('enhanceImagePrompts') ?? false,
  };
}

/** Mobile platform boundary for the Shared image-generation application service. */
export function mobileImageGenerationApplicationPorts(): ImageGenerationApplicationPorts<
  GeneratedImage,
  GeneratedImage
> {
  return {
    async refreshInventory() {
      await lifecycleProjectionPort.refreshInventory();
    },
    createId: generateId,
    resolveSettings(request) {
      return resolvedCommittedImageSettings(
        applicationFacade().models.snapshot().settings,
        request,
      );
    },
    enhancePrompt(request, _signal, onStatus) {
      return enhanceImagePrompt(request, onStatus);
    },
    async inspectRuntime(model, settings) {
      const active = localModel(model);
      const loaded = await localDreamGeneratorService.isModelLoaded();
      const loadedIdentity =
        await localDreamGeneratorService.getLoadedModelPath();
      const loadedThreads = localDreamGeneratorService.getLoadedThreads();
      const wasWarmed = useModelResidencyStore
        .getState()
        .warmedImageModels.includes(active.id);
      let hasKernelCache: boolean | undefined;
      if (settings.useOpenCL) {
        try {
          hasKernelCache = await localDreamGeneratorService.hasKernelCache(
            active.modelPath,
          );
        } catch {
          // A probe failure is unknown, not a false first-run signal.
        }
      }
      return {
        loaded,
        loadedIdentity,
        desiredIdentity: active.modelPath,
        loadedThreads,
        wasWarmed,
        hasKernelCache,
      };
    },
    async ensureLoaded(model, input) {
      try {
        await mobileResidencyIntents.ensureImage(
          model.id,
          undefined,
          input.force ? { override: true } : undefined,
        );
      } catch (error) {
        // Preserve typed recovery errors so the application can offer the correct
        // memory override or re-download action. Give unknown native failures the
        // model-load context that the user needs instead of exposing a bare bridge error.
        if (
          isOverridableMemoryError(error) ||
          isImageModelIncompleteError(error)
        )
          throw error;
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load image model: ${detail}`);
      }
    },
    async execute(input, onProgress) {
      executing = true;
      try {
        return await executeMobileImageGeneration(
          {
            prompt: input.prompt,
            routeId: input.model.routeId,
            negativePrompt: input.request.negativePrompt ?? '',
            steps: input.settings.steps,
            guidanceScale: input.settings.guidanceScale,
            seed: input.request.seed,
            width: input.settings.width,
            height: input.settings.height,
            previewInterval: input.settings.previewInterval,
            allowUnsafeMemoryOverride:
              input.force || input.request.allowUnsafeMemoryOverride === true,
          },
          {
            signal: input.signal,
            onProgress: (completed, total, preview) =>
              onProgress({
                step: completed,
                totalSteps: total,
                previewUri: preview?.uri
                  ? `${preview.uri}?t=${Date.now()}`
                  : undefined,
              }),
          },
        );
      } finally {
        executing = false;
      }
    },
    persist(input) {
      return saveImageGenerationResult(input.output, {
        params: input.request,
        activeImageModel: presentationModel(input.model),
        messageId: input.messageId,
        steps: input.settings.steps,
        guidanceScale: input.settings.guidanceScale,
        useOpenCL: input.settings.useOpenCL,
        startTime: input.startedAt,
        isRemote: input.model.source === 'remote',
      });
    },
    async cancelBoundary() {
      try {
        if (executing) await cancelActiveImageGenerationAtBoundary();
        else await mobileTextEngineControl.stopActive();
      } catch (error) {
        const failure =
          error instanceof ImageGenerationCancelError
            ? error
            : new ImageGenerationCancelError(error);
        reportModelFailure('image', failure, {
          id: 'image-generation-cancel',
          title: 'Image generation could not stop',
          message: failure.message,
        });
        throw failure;
      }
    },
    async ejectForRetry() {
      await mobileResidencyIntents.ejectAll();
    },
    isForceLoadError: isOverridableMemoryError,
    onFailure(failure: ImageApplicationFailure, actions) {
      // The chat turn already shows the reason. The card exists only for the
      // recovery actions the turn cannot offer: free this device's memory or force the load.
      if (!failure.retryAfterEject && !failure.forceLoadAllowed) return;
      reportModelFailure('image', failure.cause, {
        message: failure.message,
        onRetry: actions.retry,
        memoryPressure: failure.retryAfterEject,
        overridable: failure.forceLoadAllowed,
        onLoadAnyway: failure.forceLoadAllowed ? actions.forceLoad : undefined,
      });
    },
  };
}
