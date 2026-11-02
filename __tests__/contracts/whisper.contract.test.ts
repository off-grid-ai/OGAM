/**
 * Contract Tests: whisper.rn Native Module (Speech-to-Text)
 *
 * These tests verify that the whisper.rn native module interface
 * matches our TypeScript expectations for speech transcription.
 */

import { initWhisper, releaseAllWhisper } from 'whisper.rn';

// Define expected interfaces
interface WhisperContextOptions {
  filePath: string;
  coreMLModelAsset?: { filename: string; assets: any[] };
}

interface TranscribeOptions {
  language?: string;
  maxLen?: number;
  onProgress?: (progress: number) => void;
}

interface TranscribeResult {
  result: string;
  language: string;
  segments: Array<{ text: string; t0: number; t1: number }>;
  isAborted: boolean;
}

interface WhisperContext {
  transcribe(
    filePath: string | number,
    options?: TranscribeOptions
  ): { stop: () => void; promise: Promise<TranscribeResult> };

  /** PCM audio (16 kHz mono int16): what whisper.rn's realtime transcriber decodes each slice with. */
  transcribeData(
    data: ArrayBuffer,
    options?: TranscribeOptions
  ): { stop: () => Promise<void>; promise: Promise<TranscribeResult> };

  release(): Promise<void>;
}

// Mock the module
jest.mock('whisper.rn', () => ({
  initWhisper: jest.fn(),
  releaseAllWhisper: jest.fn(),
}));

const mockInitWhisper = initWhisper as jest.MockedFunction<typeof initWhisper>;
const mockReleaseAllWhisper = releaseAllWhisper as jest.MockedFunction<typeof releaseAllWhisper>;

describe('whisper.rn Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initWhisper', () => {
    it('should accept valid initialization options', async () => {
      const mockContext: Partial<WhisperContext> = {
        transcribe: jest.fn(),
        transcribeData: jest.fn(),
        release: jest.fn(),
      };
      mockInitWhisper.mockResolvedValue(mockContext as WhisperContext);

      const options: WhisperContextOptions = {
        filePath: '/path/to/whisper-model.bin',
      };

      await initWhisper(options);

      expect(mockInitWhisper).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: expect.any(String),
        })
      );
    });

    it('should accept CoreML model asset option', async () => {
      const mockContext: Partial<WhisperContext> = {
        transcribe: jest.fn(),
        transcribeData: jest.fn(),
        release: jest.fn(),
      };
      mockInitWhisper.mockResolvedValue(mockContext as WhisperContext);

      const options: WhisperContextOptions = {
        filePath: '/path/to/whisper-model.bin',
        coreMLModelAsset: {
          filename: 'whisper-encoder.mlmodelc',
          assets: [],
        },
      };

      await initWhisper(options);

      expect(mockInitWhisper).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: expect.any(String),
          coreMLModelAsset: expect.objectContaining({
            filename: expect.any(String),
          }),
        })
      );
    });

    it('should return context with expected methods', async () => {
      const mockContext: Partial<WhisperContext> = {
        transcribe: jest.fn(),
        transcribeData: jest.fn(),
        release: jest.fn(),
      };
      mockInitWhisper.mockResolvedValue(mockContext as WhisperContext);

      const context = await initWhisper({ filePath: '/path/to/model.bin' });

      expect(context).toHaveProperty('transcribe');
      expect(context).toHaveProperty('transcribeData');
      expect(context).toHaveProperty('release');
      expect(typeof context.transcribe).toBe('function');
      expect(typeof context.transcribeData).toBe('function');
      expect(typeof context.release).toBe('function');
    });
  });

  describe('WhisperContext.transcribe', () => {
    it('should accept file path and return stoppable promise', async () => {
      const mockTranscribeResult = { result: 'Hello world' };
      const mockStop = jest.fn();
      const mockTranscribe = jest.fn().mockReturnValue({
        stop: mockStop,
        promise: Promise.resolve(mockTranscribeResult),
      });

      const mockContext: Partial<WhisperContext> = {
        transcribe: mockTranscribe,
        release: jest.fn(),
      };
      mockInitWhisper.mockResolvedValue(mockContext as WhisperContext);

      const context = await initWhisper({ filePath: '/path/to/model.bin' });
      const { stop, promise } = context.transcribe('/path/to/audio.wav');

      expect(typeof stop).toBe('function');
      expect(promise).toBeInstanceOf(Promise);

      const result = await promise;
      expect(result).toHaveProperty('result');
      expect(typeof result.result).toBe('string');
    });

    it('should accept transcribe options', async () => {
      const mockTranscribe = jest.fn().mockReturnValue({
        stop: jest.fn(),
        promise: Promise.resolve({ result: 'Test' }),
      });

      const mockContext: Partial<WhisperContext> = {
        transcribe: mockTranscribe,
        release: jest.fn(),
      };
      mockInitWhisper.mockResolvedValue(mockContext as WhisperContext);

      const context = await initWhisper({ filePath: '/path/to/model.bin' });

      const options: TranscribeOptions = {
        language: 'en',
        maxLen: 100,
        onProgress: jest.fn(),
      };

      context.transcribe('/path/to/audio.wav', options);

      expect(mockTranscribe).toHaveBeenCalledWith(
        '/path/to/audio.wav',
        expect.objectContaining({
          language: 'en',
          maxLen: 100,
          onProgress: expect.any(Function),
        })
      );
    });

    it('should call progress callback during transcription', async () => {
      const progressCallback = jest.fn();
      const mockTranscribe = jest.fn().mockImplementation((path, options) => {
        // Simulate progress callbacks
        if (options?.onProgress) {
          options.onProgress(0.25);
          options.onProgress(0.5);
          options.onProgress(0.75);
          options.onProgress(1.0);
        }
        return {
          stop: jest.fn(),
          promise: Promise.resolve({ result: 'Transcribed text' }),
        };
      });

      const mockContext: Partial<WhisperContext> = {
        transcribe: mockTranscribe,
        release: jest.fn(),
      };
      mockInitWhisper.mockResolvedValue(mockContext as WhisperContext);

      const context = await initWhisper({ filePath: '/path/to/model.bin' });
      context.transcribe('/path/to/audio.wav', { onProgress: progressCallback });

      expect(progressCallback).toHaveBeenCalledWith(0.25);
      expect(progressCallback).toHaveBeenCalledWith(1.0);
      expect(progressCallback).toHaveBeenCalledTimes(4);
    });

    it('should accept file descriptor number', async () => {
      const mockTranscribe = jest.fn().mockReturnValue({
        stop: jest.fn(),
        promise: Promise.resolve({ result: 'Test' }),
      });

      const mockContext: Partial<WhisperContext> = {
        transcribe: mockTranscribe,
        release: jest.fn(),
      };
      mockInitWhisper.mockResolvedValue(mockContext as WhisperContext);

      const context = await initWhisper({ filePath: '/path/to/model.bin' });
      context.transcribe(42); // File descriptor

      expect(mockTranscribe).toHaveBeenCalledWith(42);
    });
  });

  describe('WhisperContext.release', () => {
    it('should be callable for cleanup', async () => {
      const mockRelease = jest.fn().mockResolvedValue(undefined);
      const mockContext: Partial<WhisperContext> = {
        transcribe: jest.fn(),
        transcribeData: jest.fn(),
        release: mockRelease,
      };
      mockInitWhisper.mockResolvedValue(mockContext as WhisperContext);

      const context = await initWhisper({ filePath: '/path/to/model.bin' });
      await context.release();

      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('releaseAllWhisper', () => {
    it('should release all contexts', async () => {
      mockReleaseAllWhisper.mockResolvedValue(undefined);

      await releaseAllWhisper();

      expect(mockReleaseAllWhisper).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should reject on invalid model path', async () => {
      mockInitWhisper.mockRejectedValue(new Error('Failed to load model: file not found'));

      await expect(initWhisper({ filePath: '/invalid/path.bin' }))
        .rejects.toThrow('Failed to load model');
    });

    it('should reject on transcription failure', async () => {
      const mockTranscribe = jest.fn().mockReturnValue({
        stop: jest.fn(),
        promise: Promise.reject(new Error('Transcription failed')),
      });

      const mockContext: Partial<WhisperContext> = {
        transcribe: mockTranscribe,
        release: jest.fn(),
      };
      mockInitWhisper.mockResolvedValue(mockContext as WhisperContext);

      const context = await initWhisper({ filePath: '/path/to/model.bin' });
      const { promise } = context.transcribe('/path/to/audio.wav');

      await expect(promise).rejects.toThrow('Transcription failed');
    });
  });
});
