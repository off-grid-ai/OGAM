import {
  bindGenerationCancellation,
  GenerationAbortedError,
  GenerationCancellationFailedError,
  classifyTranscriptionError,
  cleanTranscription,
  type GenerationAdapter,
  type GenerationChunk,
  type GenerationRequest,
  type RuntimeModel,
} from '@offgrid/models';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { remoteMediaRuntime } from '../adapters/remote/mediaRuntime';
import { whisperService } from '../whisperService';
import logger from '../../utils/logger';

export class TranscriptionResetError extends GenerationCancellationFailedError {
  readonly code = 'transcription-reset-failed' as const;

  constructor(readonly cause: unknown) {
    super(
      'The transcription runtime did not confirm that recording stopped.',
      cause,
    );
    this.name = 'TranscriptionResetError';
  }
}

export class TranscriptionFileStopError extends GenerationCancellationFailedError {
  readonly code = 'transcription-file-stop-failed' as const;

  constructor(readonly cause: unknown) {
    super(
      'The transcription runtime did not confirm that file transcription stopped.',
      cause,
    );
    this.name = 'TranscriptionFileStopError';
  }
}

/** Remote file transcription I/O shared by Models generation and Shared Speech adapters. */
export async function transcribeRemoteMobileFile(
  model: RuntimeModel,
  input: { fileUri: string; language?: string; signal?: AbortSignal },
): Promise<string> {
  const server = useRemoteServerStore
    .getState()
    .servers.find(candidate => candidate.id === model.serverId);
  if (!server)
    throw new Error(
      `Remote transcription server is unavailable: ${model.serverId}`,
    );
  return cleanTranscription(
    await remoteMediaRuntime.transcribe(
      server,
      {
        fileUri: input.fileUri,
        model: model.id,
        language: input.language === 'auto' ? undefined : input.language,
      },
      { signal: input.signal },
    ),
  );
}

export async function stopFileTranscriptionAtBoundary(
  stop: () => Promise<void>,
): Promise<void> {
  try {
    await stop();
  } catch (cause) {
    const failure = new TranscriptionFileStopError(cause);
    logger.error(
      '[TranscriptionGenerationAdapter] File transcription stop failed:',
      failure,
    );
    throw failure;
  }
}

/** Native reset port: callers receive a typed failure instead of a false stop. */
export async function resetTranscriptionAtBoundary(
  reset: () => Promise<void>,
): Promise<void> {
  try {
    await reset();
  } catch (cause) {
    const failure = new TranscriptionResetError(cause);
    logger.error(
      '[TranscriptionGenerationAdapter] Transcription reset failed:',
      failure,
    );
    throw failure;
  }
}

function transcriptionInput(request: GenerationRequest) {
  if (request.operation?.type !== 'transcription') {
    throw new TypeError(
      'The transcription adapter requires a transcription operation',
    );
  }
  return request.operation;
}

async function* realtimeTranscriptionChunks(
  model: RuntimeModel,
  request: GenerationRequest,
): AsyncIterable<GenerationChunk> {
  const operation = transcriptionInput(request);
  if (operation.audio.type !== 'microphone') {
    throw new TypeError('Realtime transcription requires a microphone input');
  }
  if (model.source !== 'local') {
    throw new Error(
      'The selected remote transcription route does not support a live microphone',
    );
  }
  const selectedPath = whisperService.getModelPath(model.id);
  if (whisperService.getLoadedModelPath() !== selectedPath) {
    throw new Error(`The selected Whisper model is not loaded: ${model.id}`);
  }

  const pending: GenerationChunk[] = [];
  let wake: (() => void) | null = null;
  let completed = false;
  let resetFailure: unknown;
  const push = (chunk: GenerationChunk) => {
    pending.push(chunk);
    const listener = wake;
    wake = null;
    listener?.();
  };
  const cancellation = bindGenerationCancellation(
    request.signal,
    () => resetTranscriptionAtBoundary(() => whisperService.forceReset()),
    error => {
      resetFailure = error;
    },
    () => {
      completed = true;
      const listener = wake;
      wake = null;
      listener?.();
    },
  );
  const unregisterCancellation = request.cancellation?.register(() =>
    cancellation.cancel(),
  );
  let generationFailure: unknown;
  try {
    try {
      await whisperService.startRealtimeTranscription(
        result => {
          push({
            output: {
              type: 'transcription',
              text: cleanTranscription(result.text),
              language: operation.language,
              partial: result.isCapturing,
              processTime: result.processTime,
              recordingTime: result.recordingTime,
            },
            ...(!result.isCapturing ? { finishReason: 'stop' as const } : {}),
          });
          if (!result.isCapturing) completed = true;
        },
        {
          language: operation.language,
          maxLen: operation.maxLength,
          transcribeFallback: filePath =>
            whisperService.transcribeFileRaw(filePath, {
              language: operation.language,
              signal: request.signal,
            }),
        },
      );
      push({ progress: { completed: 1, total: 1 } });
      while (!completed || pending.length) {
        if (!pending.length && !completed) {
          await new Promise<void>(resolve => {
            wake = resolve;
          });
        }
        const chunk = pending.shift();
        if (chunk) yield chunk;
      }
    } catch (error) {
      generationFailure = error;
    }
  } finally {
    unregisterCancellation?.();
    cancellation.dispose();
    try {
      await cancellation.wait();
    } catch (error) {
      resetFailure ??= error;
    }
  }
  if (resetFailure) throw resetFailure;
  if (generationFailure) throw generationFailure;
}

async function* transcriptionChunks(
  model: RuntimeModel,
  request: GenerationRequest,
): AsyncIterable<GenerationChunk> {
  const input = transcriptionInput(request);
  if (input.audio.type === 'microphone') {
    yield* realtimeTranscriptionChunks(model, request);
    return;
  }
  const fileUri = input.audio.uri;
  if (!fileUri)
    throw new TypeError('The transcription adapter requires an audio file URI');
  let text: string;
  if (model.source === 'local') {
    const selectedPath = whisperService.getModelPath(model.id);
    if (whisperService.getLoadedModelPath() !== selectedPath) {
      throw new Error(`The selected Whisper model is not loaded: ${model.id}`);
    }
    if (request.signal?.aborted) throw new GenerationAbortedError();
    const pending: GenerationChunk[] = [];
    let wake: (() => void) | null = null;
    let completed = false;
    let failure: unknown;
    let transcript = '';
    let cancellationSettled = false;
    const native = whisperService.startFileTranscriptionRaw(fileUri, {
      language: input.language,
      onProgress: progress => {
        pending.push({ progress: { completed: progress, total: 100 } });
        const listener = wake;
        wake = null;
        listener?.();
      },
    });
    const cancellation = bindGenerationCancellation(
      request.signal,
      () => stopFileTranscriptionAtBoundary(native.stop),
      error => {
        failure = error;
      },
      () => {
        cancellationSettled = true;
        completed = true;
        const listener = wake;
        wake = null;
        listener?.();
      },
    );
    const unregisterCancellation = request.cancellation?.register(() =>
      cancellation.cancel(),
    );
    const operation = native.promise
      .then(result => {
        transcript = result;
      })
      .catch(error => {
        failure = error;
      })
      .finally(() => {
        completed = true;
        const listener = wake;
        wake = null;
        listener?.();
      });
    try {
      while (!completed || pending.length) {
        if (!pending.length && !completed) {
          await new Promise<void>(resolve => {
            wake = resolve;
          });
        }
        const chunk = pending.shift();
        if (chunk) yield chunk;
      }
      if (!cancellationSettled) await operation;
      await cancellation.wait();
    } finally {
      unregisterCancellation?.();
      cancellation.dispose();
    }
    if (failure) throw failure;
    if (request.signal?.aborted) throw new GenerationAbortedError();
    text = transcript;
  } else {
    text = await transcribeRemoteMobileFile(model, {
      fileUri,
      language: input.language,
      signal: request.signal,
    });
  }
  yield {
    output: {
      type: 'transcription',
      text,
      language: input.language,
    },
    finishReason: 'stop',
  };
}

function adapter(id: string): GenerationAdapter {
  return {
    id,
    generate: transcriptionChunks,
    classifyError(error) {
      return classifyTranscriptionError(error);
    },
  };
}

/** Register only the concrete transcription routes currently published by Mobile inventory. */
export function reconcileMobileTranscriptionAdapters(
  service: { registerAdapter(adapter: GenerationAdapter): () => void },
  inventory: readonly RuntimeModel[],
  registrations: Map<string, () => void>,
): void {
  const supported = new Set(
    inventory
      .filter(model => model.modality === 'transcription')
      .map(model => model.adapterId),
  );
  for (const [id, unregister] of registrations) {
    if (supported.has(id)) continue;
    unregister();
    registrations.delete(id);
  }
  for (const id of supported) {
    if (registrations.has(id)) continue;
    registrations.set(id, service.registerAdapter(adapter(id)));
  }
}
