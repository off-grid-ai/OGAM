import { DEFAULT_IMAGE_MIME, classifyRuntimeError } from '@offgrid/models';
import {
  GeneratedBinaryArtifact,
  bindGenerationCancellation,
  GenerationAbortedError,
  GenerationCancellationFailedError,
  type GenerationCancellationBinding,
  type GenerationAdapter,
  type GenerationChunk,
  type GenerationRequest,
} from '@offgrid/models';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { localDreamGeneratorService } from '../localDreamGenerator';
import { remoteMediaRuntime } from '../adapters/remote/mediaRuntime';
import { applicationFacade } from '../applicationFacade';
import logger from '../../utils/logger';

export class ImageGenerationCancelError extends GenerationCancellationFailedError {
  readonly code = 'image-generation-cancel-failed' as const;

  constructor(readonly cause: unknown) {
    super('The image runtime did not confirm that generation stopped.', cause);
    this.name = 'ImageGenerationCancelError';
  }
}

/** Native cancel port: false is a refusal, not a successful cancellation. */
export async function cancelImageGenerationAtBoundary(
  cancel: () => Promise<boolean>,
): Promise<void> {
  try {
    const confirmed = await cancel();
    if (!confirmed) throw new Error('The native image runtime refused cancellation.');
  } catch (cause) {
    const failure = cause instanceof ImageGenerationCancelError
      ? cause
      : new ImageGenerationCancelError(cause);
    logger.error('[ImageGenerationAdapter] Image generation cancel failed:', failure);
    throw failure;
  }
}

type PendingChunk = { value?: GenerationChunk; error?: unknown; done?: boolean };
let activeImageCancellation: GenerationCancellationBinding | null = null;

/** Application cancellation port. It joins the adapter's idempotent native operation. */
export function cancelActiveImageGenerationAtBoundary(): Promise<void> {
  return activeImageCancellation?.cancel() ?? Promise.resolve();
}

function imageOperation(request: GenerationRequest) {
  if (request.operation?.type !== 'image') {
    throw new Error(`Image adapter cannot run ${request.operation?.type ?? 'text'} generation`);
  }
  return request.operation;
}

function localArtifact(result: {
  id: string;
  imagePath: string;
  width: number;
  height: number;
  seed: number;
}): GeneratedBinaryArtifact {
  return {
    id: result.id,
    mimeType: DEFAULT_IMAGE_MIME,
    uri: `file://${result.imagePath}`,
    width: result.width,
    height: result.height,
    seed: result.seed,
  };
}

/** Convert native progress callbacks into the shared typed image stream. */
async function* localImageChunks(request: GenerationRequest): AsyncIterable<GenerationChunk> {
  const operation = imageOperation(request);
  const committedUseOpenCL =
    applicationFacade().models.snapshot().settings.imageUseOpenCL;
  if (typeof committedUseOpenCL !== 'boolean') {
    throw new Error('The committed image acceleration setting is unavailable.');
  }
  const pending: PendingChunk[] = [];
  let wake: (() => void) | null = null;
  const push = (item: PendingChunk) => {
    pending.push(item);
    const listener = wake;
    wake = null;
    listener?.();
  };
  if (request.signal?.aborted) throw new GenerationAbortedError();
  const cancellation = bindGenerationCancellation(
    request.signal,
    () => cancelImageGenerationAtBoundary(() => localDreamGeneratorService.cancelGeneration()),
    error => push({ error }),
  );
  const unregisterCancellation = request.cancellation?.register(
    () => cancellation.cancel(),
  );
  activeImageCancellation = cancellation;
  const generation = localDreamGeneratorService.generateImage(
    {
      prompt: operation.prompt,
      negativePrompt: operation.negativePrompt,
      width: operation.width,
      height: operation.height,
      steps: operation.steps,
      guidanceScale: operation.guidanceScale,
      seed: operation.seed,
      previewInterval: operation.previewInterval,
      useOpenCL: committedUseOpenCL,
    },
    progress => push({
      value: { progress: { completed: progress.step, total: progress.totalSteps } },
    }),
    preview => push({
      value: {
        progress: {
          completed: preview.step,
          total: preview.totalSteps,
          preview: { mimeType: DEFAULT_IMAGE_MIME, uri: `file://${preview.previewPath}` },
        },
      },
    }),
  ).then(result => {
    push({
      value: {
        output: { type: 'image', images: [localArtifact(result)] },
        finishReason: 'stop',
      },
    });
    push({ done: true });
  }).catch(error => push({ error }));

  try {
    for (;;) {
      if (!pending.length) await new Promise<void>(resolve => { wake = resolve; });
      const item = pending.shift();
      if (!item) continue;
      if (item.error) throw item.error;
      if (item.done) break;
      if (item.value) yield item.value;
    }
    await generation;
    await cancellation.wait();
  } finally {
    unregisterCancellation?.();
    cancellation.dispose();
    if (activeImageCancellation === cancellation) activeImageCancellation = null;
  }
}

/** Execute the exact image route selected by the shared GenerationService. */
export function mobileImageGenerationAdapter(id: string): GenerationAdapter {
  return {
    id,
    async *generate(model, request): AsyncIterable<GenerationChunk> {
      const operation = imageOperation(request);
      if (model.source === 'local') {
        yield* localImageChunks(request);
        return;
      }
      const server = useRemoteServerStore.getState().servers.find(
        candidate => candidate.id === model.serverId,
      );
      if (!server) throw new Error('The selected remote image server is unavailable');
      const result = await remoteMediaRuntime.generateImage(
        server,
        {
          prompt: operation.prompt,
          width: operation.width ?? 512,
          height: operation.height ?? 512,
          model: model.id,
          allowUnsafeMemoryOverride: operation.allowUnsafeMemoryOverride,
        },
        { signal: request.signal },
      );
      yield {
        output: {
          type: 'image',
          images: [{ mimeType: DEFAULT_IMAGE_MIME, data: result.base64, uri: result.url }],
        },
        finishReason: 'stop',
      };
    },
    classifyError: classifyRuntimeError,
  };
}
