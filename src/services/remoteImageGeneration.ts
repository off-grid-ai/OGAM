import RNFS from 'react-native-fs';
import type { GeneratedImage, RemoteServer } from '../types';
import { useAppStore } from '../stores';
import { generateId } from '../utils/generateId';
import logger from '../utils/logger';
import type { GenerateImageParams, ImageGenerationState } from './imageGenerationTypes';
import { resolveMobileImageParameters } from './imageParameterPolicy';
import { remoteMediaRuntime } from './remoteMediaRuntime';
import {
  completedImageGenerationState,
  saveImageGenerationResult,
} from './imageGenerationResult';

interface RemoteImageGenerationDeps {
  updateState: (state: Partial<ImageGenerationState>) => void;
  fail: (message: string, cause?: unknown) => null;
  isCancelled: () => boolean;
  setRequest: (controller: AbortController | null) => void;
}

/** Remove a file this run wrote but did not publish, so a retry starts clean. */
async function removePartialFile(path: string | null): Promise<void> {
  if (!path) return;
  try {
    if (await RNFS.exists(path)) await RNFS.unlink(path);
  } catch (error) {
    logger.warn('[RemoteImage] could not remove an incomplete image file', error);
  }
}

/** Transfer the image file. Cancel stops the transfer instead of letting it finish in the background. */
async function downloadImage(fromUrl: string, toFile: string, signal: AbortSignal) {
  // Cancelled while the folder was being made: an abort listener added now would never fire.
  if (signal.aborted) throw new Error('Image generation cancelled');
  const transfer = RNFS.downloadFile({ fromUrl, toFile });
  const stopTransfer = () => RNFS.stopDownload(transfer.jobId);
  signal.addEventListener('abort', stopTransfer);
  try {
    return await transfer.promise;
  } finally {
    signal.removeEventListener('abort', stopTransfer);
  }
}

/**
 * Write the returned image to disk: decode inline data or transfer it from its URL. `track` is
 * told every path that may hold bytes, so the caller can remove a file it does not publish.
 */
async function storeRemoteImage(
  remote: { url?: string; base64?: string },
  signal: AbortSignal,
  track: (path: string) => void,
): Promise<{ id: string; fileName: string; imagePath: string }> {
  const dataUrl = remote.url?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  const base64 = dataUrl?.[2] ?? remote.base64;
  if (!base64 && !/^https?:\/\//i.test(remote.url ?? '')) {
    throw new Error('Remote server returned no image data');
  }
  const id = generateId();
  const directory = `${RNFS.DocumentDirectoryPath}/generated_images`;
  const urlExtension = remote.url?.match(/\.(png|jpe?g|webp)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  const extension = dataUrl?.[1]?.toLowerCase() === 'image/jpeg'
    ? 'jpg'
    : dataUrl?.[1]?.toLowerCase().replace('image/', '') ?? urlExtension ?? 'png';
  let fileName = `${id}.${extension}`;
  let imagePath = `${directory}/${fileName}`;
  await RNFS.mkdir(directory);
  track(imagePath);
  if (base64) {
    await RNFS.writeFile(imagePath, base64, 'base64');
    return { id, fileName, imagePath };
  }
  const outcome = await downloadImage(remote.url!, imagePath, signal);
  if (outcome.statusCode < 200 || outcome.statusCode >= 300) {
    throw new Error(`Image download returned HTTP ${outcome.statusCode}`);
  }
  const contentType = Object.entries(outcome.headers ?? {})
    .find(([key]) => key.toLowerCase() === 'content-type')?.[1]
    ?.split(';')[0]?.toLowerCase();
  const receivedExtension = contentType === 'image/jpeg' ? 'jpg'
    : contentType === 'image/png' ? 'png'
    : contentType === 'image/webp' ? 'webp'
    : undefined;
  if (contentType && !receivedExtension) {
    throw new Error('Remote server returned an unsupported image format');
  }
  if (receivedExtension && receivedExtension !== extension) {
    fileName = `${id}.${receivedExtension}`;
    const correctedPath = `${directory}/${fileName}`;
    await RNFS.moveFile(imagePath, correctedPath);
    imagePath = correctedPath;
    track(correctedPath);
  }
  return { id, fileName, imagePath };
}

export async function runRemoteImageGeneration(
  params: GenerateImageParams,
  server: RemoteServer,
  deps: RemoteImageGenerationDeps,
  options: { override?: boolean; enhancedPrompt?: string } = {},
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
    progress: null, error: null, result: null,
  });
  const controller = new AbortController();
  deps.setRequest(controller);
  let partialPath: string | null = null;
  try {
    const remote = await remoteMediaRuntime.generateImage(
      server,
      { prompt: options.enhancedPrompt ?? params.prompt, size: `${width}x${height}` },
      {
        signal: controller.signal,
        override: options.override,
        onImageProgress: (step, total) => {
          if (!deps.isCancelled() && total > 0) {
            deps.updateState({
              progress: { step, totalSteps: total },
              status: `Generating image (${step}/${total})...`,
            });
          }
        },
      },
    );
    if (deps.isCancelled()) return null;
    const { id, fileName, imagePath } = await storeRemoteImage(
      remote, controller.signal, path => { partialPath = path; },
    );
    // Cancel may land while the file was being written or moved. Never publish it then.
    if (controller.signal.aborted || deps.isCancelled()) {
      await removePartialFile(partialPath);
      return null;
    }
    partialPath = null;
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
    // A failed or cancelled transfer must not leave an untracked file behind.
    await removePartialFile(partialPath);
    if (controller.signal.aborted || deps.isCancelled()) return null;
    return deps.fail(error instanceof Error ? error.message : 'Remote image generation failed', error);
  } finally {
    deps.setRequest(null);
  }
}
