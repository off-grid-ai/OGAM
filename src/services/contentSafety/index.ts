/**
 * Content safety for generated images (Google Play AI-Generated Content policy): prompts that ask
 * for sexual content are refused before generation, and every finished image is classified on the
 * device before it is shown or saved. Neither step has a setting that turns it off.
 */
import logger from '../../utils/logger';
import { checkGeneratedImage } from './imageSafety';

export {
  checkImagePrompt,
  BLOCKED_IMAGE_MESSAGE,
  BLOCKED_PROMPT_MESSAGE,
  BLOCKED_VIDEO_MESSAGE,
  BLOCKED_VIDEO_PROMPT_MESSAGE,
} from './promptFilter';
export { checkGeneratedImage } from './imageSafety';

/**
 * In-progress previews have not been checked yet, so they show blurred: the shape of the picture
 * coming together, never its detail. (Android caps the radius at 25.)
 */
export const UNCHECKED_PREVIEW_BLUR_RADIUS = 20;

/**
 * The cause of a failure the safety check made on purpose. The failure card says the image was not
 * made and why, and offers no Retry: the same request would be refused again.
 */
export class ContentBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentBlockedError';
  }
}

/**
 * Check a finished image. When it is blocked its file is deleted here, so no caller can publish it.
 * Returns whether the image may be shown.
 */
export async function screenGeneratedImage(
  imagePath: string,
  removeFile: () => Promise<unknown>,
): Promise<boolean> {
  const verdict = await checkGeneratedImage(imagePath);
  if (verdict.allowed) return true;
  logger.warn(`[ContentSafety] image blocked (${verdict.reason}, nsfw=${verdict.nsfw ?? 'n/a'})`);
  await removeFile().catch(error => logger.error('[ContentSafety] could not delete a blocked image', error));
  return false;
}
