import {
  effectiveImageParameter,
  resolveImageParameters,
  type ImageParameterStore,
} from '@offgrid/models';
import { SWEET_SPOT_SIZE } from '../utils/imageGenAdvice';

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
  model: { id: string; name?: string },
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
  return {
    steps: effectiveImageParameter(
      positiveFinite(request.steps),
      resolved.steps,
    ),
    guidanceScale: effectiveImageParameter(
      positiveFinite(request.guidanceScale),
      resolved.cfgScale,
    ),
    size: Math.max(SWEET_SPOT_SIZE, resolved.size),
  };
}
