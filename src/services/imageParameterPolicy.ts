import { Platform } from 'react-native';
import {
  effectiveImageParameter,
  resolveImageParameters,
  type ImageParameterStore,
} from '@offgrid/models';
import { defaultImageSteps, SWEET_SPOT_SIZE } from '../utils/imageGenAdvice';

type ImageParameterModel = { id: string; name?: string; backend?: string };

/** Native legacy packs keep their fixed size limit; SD uses the shared model policy. */
export function mobileImageParameterDefaults(model: ImageParameterModel, platform: string) {
  const defaults = resolveImageParameters(model, undefined);
  return model.backend === 'sd'
    ? { steps: defaults.steps, guidanceScale: defaults.cfgScale, size: defaults.size }
    : { steps: defaultImageSteps(platform), guidanceScale: 7.5, size: 512 };
}

export function mobileImageSizeLimit(model: ImageParameterModel): number {
  return model.backend === 'sd' ? resolveImageParameters(model, undefined).size : 512;
}

export interface MobileImageParameterSettings {
  imageSteps?: number | null;
  imageGuidanceScale?: number | null;
  imageWidth?: number | null;
}

export interface MobileImageParameterRequest {
  steps?: number;
  guidanceScale?: number;
}

const positiveFinite = (value: number | null | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;

/** Adapt Mobile's current settings shape into the shared model-specific policy. */
export function resolveMobileImageParameters(
  model: ImageParameterModel,
  settings: MobileImageParameterSettings,
  request: MobileImageParameterRequest = {},
): { steps: number; guidanceScale: number; size: number } {
  const store: ImageParameterStore = {
    [model.id]: {
      steps: positiveFinite(settings.imageSteps),
      cfgScale: positiveFinite(settings.imageGuidanceScale),
      size: positiveFinite(settings.imageWidth),
    },
  };
  const resolved = resolveImageParameters(model, store);
  if (model.backend !== 'sd') {
    const defaults = mobileImageParameterDefaults(model, Platform.OS);
    resolved.steps = positiveFinite(settings.imageSteps) ?? defaults.steps;
    resolved.cfgScale = positiveFinite(settings.imageGuidanceScale) ?? defaults.guidanceScale;
    resolved.size = positiveFinite(settings.imageWidth) ?? defaults.size;
  }
  return {
    steps: effectiveImageParameter(
      positiveFinite(request.steps),
      resolved.steps,
    ),
    guidanceScale: effectiveImageParameter(
      positiveFinite(request.guidanceScale),
      resolved.cfgScale,
    ),
    size: Math.min(mobileImageSizeLimit(model), Math.max(SWEET_SPOT_SIZE, resolved.size)),
  };
}
