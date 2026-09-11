import { useModelResidencyStore } from '../stores/modelResidencyStore';
import { useAppStore } from '../stores';
import { createGeneratedImageRecord } from '@offgrid/application';
import type { GeneratedImage } from '../types';
import { scheduleImageSharePrompt } from './imageGenerationHelpers';
import { applicationFacade } from './applicationFacade';
import type {
  ActiveImageModel,
  GenerateImageParams,
} from './imageGenerationTypes';

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
): Promise<GeneratedImage> {
  const { params, activeImageModel } = input;
  result.modelId = activeImageModel.id;
  if (params.conversationId) result.conversationId = params.conversationId;
  const appStore = useAppStore.getState();
  const gallery = applicationFacade().generatedImages;
  if (!gallery) throw new Error('Generated image gallery was not composed.');
  const outcome = await gallery.create(
    createGeneratedImageRecord({
      id: result.id,
      ...(result.provenance ? { provenance: result.provenance } : {}),
      ...(result.conversationId !== undefined
        ? { conversationId: result.conversationId }
        : {}),
      prompt: result.prompt,
      ...(result.negativePrompt
        ? { negativePrompt: result.negativePrompt }
        : {}),
      width: result.width,
      height: result.height,
      steps: result.steps,
      seed: result.seed,
      modelId: result.modelId,
      createdAt: result.createdAt,
      local: {
        path: result.imagePath,
        ...(result.fileName ? { fileName: result.fileName } : {}),
      },
    }),
  );
  if (!outcome.ok) throw new Error(outcome.failure.message);
  if (!input.isRemote)
    useModelResidencyStore.getState().markImageModelWarmed(activeImageModel.id);
  appStore.completeChecklistStep('triedImageGen');
  scheduleImageSharePrompt();

  return result;
}
