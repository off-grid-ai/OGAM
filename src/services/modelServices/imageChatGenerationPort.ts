import { imageGenerationService } from '../imageGenerationService';
import type { NativeImageDeleteOutcome } from '../image/nativeImageDeleteOutcome';
import { localDreamGeneratorService } from '../localDreamGenerator';
import { contextCompactionService } from '../contextCompaction';

/** Chat adapter boundary around Mobile's image generation use case. */
export const mobileImageChatGeneration = {
  generate: imageGenerationService.generateImage.bind(imageGenerationService),
  /** The reason the last generate() returned null; the turn shows this, not a generic line. */
  lastError: () => imageGenerationService.getState().error,
  cancel: imageGenerationService.cancelGeneration.bind(imageGenerationService),
  isGenerating: () => imageGenerationService.getState().isGenerating,
  /**
   * Release one generated image's bytes, returning the typed native outcome. `already_missing` is
   * a success - deletion is idempotent - and only `failure` means bytes may still be on disk.
   */
  deleteArtifact: (path: string): Promise<NativeImageDeleteOutcome> =>
    localDreamGeneratorService.deleteGeneratedImage(path),
  /** Returns the clear so the caller can sequence deletion behind the settled durable write. */
  clearConversationSummary: (conversationId: string): Promise<void> =>
    contextCompactionService.clearSummary(conversationId),
};
