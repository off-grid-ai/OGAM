import { videoGenerationService } from './videoGenerationService';
import { activeModelService } from './activeModelService';
import { generationService } from './generationService';
import { imageGenerationService } from './imageGenerationService';

/**
 * One owner for the user-initiated Eject All journey.
 * Stop active work before model memory is released so a compaction or generation
 * retry cannot continue against an unloaded engine.
 */
export async function ejectAllModelsForUser(): Promise<{ count: number }> {
  await Promise.all([
    generationService.stopGeneration(),
    imageGenerationService.cancelGeneration(),
    videoGenerationService.cancelGeneration(),
  ]);
  return activeModelService.ejectAll();
}
