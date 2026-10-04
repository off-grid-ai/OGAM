import {
  stopTextGenerationAtBoundary,
  TextGenerationStopError,
} from '../../../src/services/modelServices/generationAdapters';
import {
  cancelImageGenerationAtBoundary,
  ImageGenerationCancelError,
} from '../../../src/services/modelServices/imageGenerationAdapter';
import {
  resetTranscriptionAtBoundary,
  stopFileTranscriptionAtBoundary,
  TranscriptionFileStopError,
  TranscriptionResetError,
} from '../../../src/services/modelServices/transcriptionGenerationAdapter';
import { llmService } from '../../../src/services/llm';
import { whisperService } from '../../../src/services/whisperService';
import {
  ClassifierStopError,
  stopClassifierAtBoundary,
} from '../../../src/services/adapters/native/classifierExecutionAdapter';

describe('native cancellation boundaries', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns only after a text runtime confirms stop', async () => {
    await expect(
      stopTextGenerationAtBoundary('llama.rn', async () => undefined),
    ).resolves.toBeUndefined();
  });

  it('preserves a classifier native stop rejection as a typed failure', async () => {
    const nativeFailure = new Error('classifier stop failed');
    await expect(
      stopClassifierAtBoundary(async () => { throw nativeFailure; }),
    ).rejects.toMatchObject({
      name: ClassifierStopError.name,
      code: 'classifier-stop-failed',
      cause: nativeFailure,
    });
  });

  it('rejects with a typed text stop failure without projecting presentation state', async () => {
    const nativeFailure = new Error('native stop failed');

    await expect(
      stopTextGenerationAtBoundary('llama.rn', async () => {
        throw nativeFailure;
      }),
    ).rejects.toMatchObject({
      name: TextGenerationStopError.name,
      code: 'text-generation-stop-failed',
      engineId: 'llama.rn',
      cause: nativeFailure,
    });
  });

  it('treats a refused image cancellation as a typed failure', async () => {
    await expect(
      cancelImageGenerationAtBoundary(async () => false),
    ).rejects.toBeInstanceOf(ImageGenerationCancelError);
  });

  it('rejects with a typed transcription reset failure', async () => {
    const nativeFailure = new Error('native reset failed');

    await expect(
      resetTranscriptionAtBoundary(async () => {
        throw nativeFailure;
      }),
    ).rejects.toMatchObject({
      name: TranscriptionResetError.name,
      code: 'transcription-reset-failed',
      cause: nativeFailure,
    });
  });

  it('rejects a native file-transcription stop failure with its typed boundary error', async () => {
    const nativeFailure = new Error('Whisper file stop failed');

    await expect(
      stopFileTranscriptionAtBoundary(async () => { throw nativeFailure; }),
    ).rejects.toMatchObject({
      name: TranscriptionFileStopError.name,
      code: 'transcription-file-stop-failed',
      cause: nativeFailure,
    });
  });

  it('preserves a real LiteRT native stop rejection', async () => {
    const nativeFailure = new Error('LiteRT native stop failed');
    const nativeModule = {
      addListener: jest.fn(),
      removeListeners: jest.fn(),
      stopGeneration: jest.fn().mockRejectedValueOnce(nativeFailure),
    };
    jest.resetModules();
    const { NativeModules } = require('react-native') as typeof import('react-native');
    (NativeModules as Record<string, unknown>).LiteRTModule = nativeModule;
    const { liteRTService } = require('../../../src/services/litert') as typeof import('../../../src/services/litert');

    await expect(liteRTService.stopGeneration()).rejects.toBe(nativeFailure);
  });

  it('cleans up llama state and then preserves a real native stop rejection', async () => {
    const nativeFailure = new Error('llama native stop failed');
    (llmService as any).context = {
      stopCompletion: jest.fn(async () => { throw nativeFailure; }),
    };
    (llmService as any).activeCompletionPromise = Promise.resolve();
    (llmService as any).isGenerating = true;

    await expect(llmService.stopGeneration()).rejects.toBe(nativeFailure);
    expect((llmService as any).isGenerating).toBe(false);
    expect((llmService as any).activeCompletionPromise).toBeNull();
  });

  it('waits for Whisper teardown and preserves its real stop rejection', async () => {
    const nativeFailure = new Error('Whisper native stop failed');
    (whisperService as any).context = {};
    (whisperService as any).stopFn = jest.fn(async () => { throw nativeFailure; });
    (whisperService as any).transcriptionFullyStopped = Promise.resolve();

    await expect(whisperService.forceReset()).rejects.toBe(nativeFailure);
  });
});
