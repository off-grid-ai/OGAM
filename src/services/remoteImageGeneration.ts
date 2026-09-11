import RNFS from 'react-native-fs';
import type { GeneratedImage, RemoteServer } from '../types';
import { useAppStore } from '../stores';
import { generateId } from '../utils/generateId';
import type { GenerateImageParams, ImageGenerationState } from './imageGenerationTypes';
import { resolveMobileImageParameters } from './imageParameterPolicy';
import { remoteMediaRuntime } from './remoteMediaRuntime';
import {
  completedImageGenerationState,
  saveImageGenerationResult,
} from './imageGenerationResult';

interface RemoteImageGenerationDeps {
  updateState: (state: Partial<ImageGenerationState>) => void;
  fail: (message: string) => null;
  isCancelled: () => boolean;
  setRequest: (controller: AbortController | null) => void;
}

export async function runRemoteImageGeneration(
  params: GenerateImageParams,
  server: RemoteServer,
  deps: RemoteImageGenerationDeps,
): Promise<GeneratedImage | null> {
  const modelId = server.mediaModels?.image;
  if (!modelId) return deps.fail('No remote image model is configured');
  const settings = useAppStore.getState().settings;
  const imageParameters = resolveMobileImageParameters(
    { id: modelId, name: modelId }, settings, params,
  );
  const width = imageParameters.size;
  const height = imageParameters.size;
  const { steps, guidanceScale } = imageParameters;
  const messageId = params.conversationId ? generateId() : null;
  const startTime = Date.now();
  deps.updateState({
    phase: 'generating', prompt: params.prompt, conversationId: params.conversationId || null,
    messageId, status: `Creating image on ${server.name}...`, previewPath: null,
    progress: { step: 0, totalSteps: 1 }, error: null, result: null,
  });
  const controller = new AbortController();
  deps.setRequest(controller);
  try {
    const remote = await remoteMediaRuntime.generateImage(
      server,
      { prompt: params.prompt, size: `${width}x${height}` },
      { signal: controller.signal },
    );
    if (!remote.base64) throw new Error('Remote server returned no image data');
    if (deps.isCancelled()) return null;
    const id = generateId();
    const directory = `${RNFS.DocumentDirectoryPath}/generated_images`;
    const fileName = `${id}.png`;
    const imagePath = `${directory}/${fileName}`;
    await RNFS.mkdir(directory);
    await RNFS.writeFile(imagePath, remote.base64, 'base64');
    const result: GeneratedImage = {
      id, prompt: params.prompt, negativePrompt: params.negativePrompt, imagePath, fileName,
      width, height, steps, seed: params.seed ?? 0, modelId, createdAt: new Date().toISOString(),
    };
    deps.updateState(completedImageGenerationState(result));
    return saveImageGenerationResult(result, {
      params,
      activeImageModel: {
        id: modelId, name: `${server.name} / ${modelId}`, modelPath: server.endpoint, backend: 'remote',
      },
      messageId, steps, guidanceScale, useOpenCL: false, startTime, isRemote: true,
    });
  } catch (error) {
    if (controller.signal.aborted || deps.isCancelled()) return null;
    return deps.fail(error instanceof Error ? error.message : 'Remote image generation failed');
  } finally {
    deps.setRequest(null);
  }
}
