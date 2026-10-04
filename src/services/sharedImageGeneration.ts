import RNFS from 'react-native-fs';
import { modelsFailureMessage, type GenerationResult } from '@offgrid/application';
import type { GeneratedBinaryArtifact } from '@offgrid/models';
import type { GeneratedImage } from '../types';
import { generateId } from '../utils/generateId';
import { applicationFacade } from './applicationFacade';

export interface SharedImageGenerationInput {
  prompt: string;
  routeId?: string;
  negativePrompt?: string;
  steps: number;
  guidanceScale: number;
  seed?: number;
  width: number;
  height: number;
  previewInterval: number;
  /** Explicit approval for a load above the server's or device's memory comfort limit. */
  allowUnsafeMemoryOverride?: boolean;
}

interface SharedImageGenerationOptions {
  onProgress?: (
    completed: number,
    total: number,
    preview?: GeneratedBinaryArtifact,
  ) => void;
  signal: AbortSignal;
}

/** Adapt one shared typed image result to Mobile's persisted GeneratedImage record. */
export async function executeMobileImageGeneration(
  input: SharedImageGenerationInput,
  options: SharedImageGenerationOptions,
): Promise<GeneratedImage> {
  const models = applicationFacade().models;
  const refreshed = await models.refresh();
  if (!refreshed.ok) throw new Error(modelsFailureMessage(refreshed.failure));
  const { routeId, ...operation } = input;
  let result: GenerationResult | null = null;
  for await (const event of models.generate({
    request: {
        operation: { type: 'image', ...operation },
        routeId,
        profile: 'image-generation',
        signal: options.signal,
    },
  })) {
    if (event.type === 'chunk' && event.chunk.progress) {
      options.onProgress?.(
        event.chunk.progress.completed,
        event.chunk.progress.total,
        event.chunk.progress.preview,
      );
    } else if (event.type === 'failed') {
      throw new Error(modelsFailureMessage(event.failure));
    } else if (event.type === 'result') {
      result = event.result;
    }
  }
  if (!result || result.output.type !== 'image' || !result.output.images.length) {
    throw new Error('Image generation returned no image');
  }
  const artifact = result.output.images[0];
  const imageId = artifact.id ?? generateId();
  let imagePath: string;
  let fileName: string | undefined;
  if (artifact.data) {
    fileName = `${imageId}.png`;
    const directory = `${RNFS.DocumentDirectoryPath}/generated_images`;
    imagePath = `${directory}/${fileName}`;
    await RNFS.mkdir(directory);
    await RNFS.writeFile(imagePath, artifact.data, 'base64');
  } else if (artifact.uri?.startsWith('file://')) {
    imagePath = artifact.uri.slice('file://'.length);
  } else {
    throw new Error('Image generation returned no local image data');
  }
  return {
      id: imageId,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt,
      imagePath,
      fileName,
      width: artifact.width ?? input.width,
      height: artifact.height ?? input.height,
      steps: input.steps,
      seed: artifact.seed ?? input.seed ?? 0,
      modelId: result.model.id,
      createdAt: new Date().toISOString(),
  };
}
