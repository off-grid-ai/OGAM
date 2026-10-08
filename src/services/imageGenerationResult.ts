import { useAppStore, useChatStore } from '../stores';
import type { GeneratedImage } from '../types';
import logger from '../utils/logger';
import { buildImageGenMeta, scheduleImageSharePrompt } from './imageGenerationHelpers';
import { localDreamGeneratorService } from './localDreamGenerator';
import type {
  ActiveImageModel,
  GenerateImageParams,
  ImageGenerationState,
} from './imageGenerationTypes';

export function completedImageGenerationState(
  result: GeneratedImage,
): Partial<ImageGenerationState> {
  return {
    phase: 'done',
    progress: null,
    status: null,
    previewPath: null,
    result,
    error: null,
  };
}

/** True when the image was drawn for a chat that has since been deleted. */
function conversationIsGone(conversationId: string | undefined): boolean {
  if (!conversationId) return false;
  return !useChatStore.getState().conversations.some(c => c.id === conversationId);
}

/**
 * Publish a finished image: Gallery record, and a chat message when it belongs to a chat. A result
 * for a chat that was deleted while it was drawing is not published, and its file is removed.
 */
export async function saveImageGenerationResult(
  result: GeneratedImage,
  input: {
    params: GenerateImageParams;
    activeImageModel: ActiveImageModel;
    messageId: string | null;
    steps: number;
    guidanceScale: number;
    useOpenCL: boolean;
    startTime: number;
    isRemote?: boolean;
  },
): Promise<GeneratedImage | null> {
  const { params, activeImageModel } = input;
  if (conversationIsGone(params.conversationId)) {
    logger.log('[IMG-SM] result for a deleted chat, not saved');
    const removed = await localDreamGeneratorService
      .deleteGeneratedImage(result.id, result.imagePath)
      .catch(() => false);
    if (!removed) {
      result.modelId = activeImageModel.id;
      result.conversationId = params.conversationId;
      useAppStore.getState().addGeneratedImage(result);
      logger.warn('[ImageGen] could not remove the image of a deleted chat; kept in Gallery');
    }
    return null;
  }
  result.modelId = activeImageModel.id;
  if (params.conversationId) result.conversationId = params.conversationId;
  const appStore = useAppStore.getState();
  appStore.addGeneratedImage(result);
  if (!input.isRemote) appStore.markImageModelWarmed(activeImageModel.id);
  appStore.completeChecklistStep('triedImageGen');
  scheduleImageSharePrompt();

  if (params.conversationId) {
    useChatStore.getState().addMessage(params.conversationId, {
      role: 'assistant',
      content: `Generated image for: "${params.prompt}"`,
      ...(input.messageId ? { uuid: input.messageId } : {}),
      attachments: [
        {
          id: result.id,
          type: 'image',
          uri: `file://${result.imagePath}`,
          width: result.width,
          height: result.height,
        },
      ],
      generationTimeMs: Date.now() - input.startTime,
      generationMeta: buildImageGenMeta(activeImageModel, {
        steps: input.steps,
        guidanceScale: input.guidanceScale,
        result,
        useOpenCL: input.useOpenCL,
      }),
    });
  }
  return result;
}
