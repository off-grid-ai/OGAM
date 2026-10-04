import {
  IMAGE_MINIMUM_SIZE,
  IMAGE_QUALITY_STEP_FLOOR,
  MAX_IMAGE_STEPS,
  defaultImageSteps,
  imageGenerationAdvice,
  type ImageGenerationAdvice,
} from '@offgrid/models';

/** Mobile compatibility projection of the shared image settings policy. */
export type ImageGenAdvice = ImageGenerationAdvice;
export const QUALITY_STEP_FLOOR = IMAGE_QUALITY_STEP_FLOOR;
export const SWEET_SPOT_SIZE = IMAGE_MINIMUM_SIZE;
export {  MAX_IMAGE_STEPS, defaultImageSteps };

export function getImageGenAdvice(opts: {
  backend?: string | null;
  steps: number;
  width: number;
}): ImageGenAdvice {
  return imageGenerationAdvice(opts);
}
