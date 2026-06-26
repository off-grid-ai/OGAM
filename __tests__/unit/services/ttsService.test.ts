/**
 * TTS Service Unit Tests
 *
 * Tests for backbone/vocoder download, model lifecycle, audio generation,
 * file persistence, and playback control.
 * Priority: P1 - Core TTS functionality.
 */

jest.mock('llama.rn', () => ({
  initLlama: jest.fn(),
}));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/docs',
  exists: jest.fn(),
  mkdir: jest.fn(),
  unlink: jest.fn(),
  downloadFile: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
  stat: jest.fn(),
  readDir: jest.fn(),
}));

jest.mock('react-native-audio-api', () => ({
  AudioContext: jest.fn().mockImplementation(() => ({
    createBuffer: jest.fn().mockReturnValue({ copyToChannel: jest.fn() }),
    createBufferSource: jest.fn().mockReturnValue({
      connect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
      playbackRate: { value: 1.0 },
      onended: null,
      buffer: null,
    }),
    destination: {},
    close: jest.fn(),
  })),
}));

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import RNFS from 'react-native-fs';
import { initLlama } from 'llama.rn';
import { ttsService } from '../../../pro/audio/services/ttsService';
import { TTS_BACKBONE_MODEL } from '../../../pro/audio/constants/ttsModels';

const mockRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockInitLlama = initLlama as jest.Mock;

const makeMockContext = (vocoderEnabled = true) => ({
  initVocoder: jest.fn().mockResolvedValue(undefined),
  isVocoderEnabled: jest.fn().mockResolvedValue(vocoderEnabled),
  releaseVocoder: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  getFormattedAudioCompletion: jest.fn().mockResolvedValue({ prompt: 'p', grammar: 'g' }),
  getAudioCompletionGuideTokens: jest.fn().mockResolvedValue([1, 2, 3]),
  completion: jest.fn().mockResolvedValue({ audio_tokens: [10, 20, 30] }),
  decodeAudioTokens: jest.fn().mockResolvedValue(new Array(2400).fill(0.1)),
});

describe('ttsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset internal state between tests
    (ttsService as any).context = null;
    (ttsService as any).isVocoderReady = false;
    (ttsService as any).isSpeakingFlag = false;
    (ttsService as any).contextLoadPromise = Promise.resolve();
  });

  // ─── Paths ────────────────────────────────────────────────────────────────

  describe('paths', () => {
    it('backbone path uses tts-models directory', () => {
      expect(ttsService.getBackbonePath()).toBe(
        `/mock/docs/tts-models/${TTS_BACKBONE_MODEL.backboneFile}`,
      );
    });

    it('vocoder path uses tts-models directory', () => {
      expect(ttsService.getVocoderPath()).toBe(
        `/mock/docs/tts-models/${TTS_BACKBONE_MODEL.vocoderFile}`,
      );
    });

    it('audio file path scoped to conversationId and messageId', () => {
      expect(ttsService.getAudioFilePath('conv1', 'msg1')).toBe(
        '/mock/docs/audio-cache/conv1/msg1.pcm',
      );
    });
  });

  // ─── Download ────────────────────────────────────────────────────────────

  describe('downloadBackbone', () => {
    it('returns existing path without downloading if already present', async () => {
      mockRNFS.exists.mockResolvedValueOnce(true) // ensureDir
                     .mockResolvedValueOnce(true); // file exists
      const path = await ttsService.downloadBackbone();
      expect(mockRNFS.downloadFile).not.toHaveBeenCalled();
      expect(path).toBe(ttsService.getBackbonePath());
    });

    it('downloads and returns path on success', async () => {
      mockRNFS.exists.mockResolvedValueOnce(false) // dir missing
                     .mockResolvedValueOnce(false); // file missing
      mockRNFS.mkdir.mockResolvedValueOnce(undefined);
      mockRNFS.downloadFile.mockReturnValue({ jobId: 1, promise: Promise.resolve({ statusCode: 200, jobId: 1, bytesWritten: 0 }) });

      const onProgress = jest.fn();
      const path = await ttsService.downloadBackbone(onProgress);

      expect(mockRNFS.downloadFile).toHaveBeenCalledWith(
        expect.objectContaining({ fromUrl: TTS_BACKBONE_MODEL.backboneUrl }),
      );
      expect(path).toBe(ttsService.getBackbonePath());
    });

    it('throws and removes partial file on non-200 response', async () => {
      mockRNFS.exists.mockResolvedValue(false);
      mockRNFS.mkdir.mockResolvedValueOnce(undefined);
      mockRNFS.downloadFile.mockReturnValue({ jobId: 1, promise: Promise.resolve({ statusCode: 404, jobId: 1, bytesWritten: 0 }) });
      mockRNFS.unlink.mockResolvedValue(undefined);

      await expect(ttsService.downloadBackbone()).rejects.toThrow('HTTP 404');
      expect(mockRNFS.unlink).toHaveBeenCalled();
    });
  });

  describe('downloadVocoder', () => {
    it('downloads vocoder to correct path', async () => {
      mockRNFS.exists.mockResolvedValue(false);
      mockRNFS.mkdir.mockResolvedValueOnce(undefined);
      mockRNFS.downloadFile.mockReturnValue({ jobId: 1, promise: Promise.resolve({ statusCode: 200, jobId: 1, bytesWritten: 0 }) });

      const path = await ttsService.downloadVocoder();
      expect(mockRNFS.downloadFile).toHaveBeenCalledWith(
        expect.objectContaining({ fromUrl: TTS_BACKBONE_MODEL.vocoderUrl }),
      );
      expect(path).toBe(ttsService.getVocoderPath());
    });
  });

  // ─── Model Lifecycle ─────────────────────────────────────────────────────

  describe('loadModels', () => {
    it('calls initLlama with backbone path then initVocoder', async () => {
      const ctx = makeMockContext();
      mockInitLlama.mockResolvedValue(ctx);

      await ttsService.loadModels();

      expect(mockInitLlama).toHaveBeenCalledWith(
        expect.objectContaining({ model: ttsService.getBackbonePath() }),
      );
      expect(ctx.initVocoder).toHaveBeenCalledWith(
        expect.objectContaining({ path: ttsService.getVocoderPath() }),
      );
    });

    it('throws if isVocoderEnabled returns false', async () => {
      const ctx = makeMockContext(false);
      mockInitLlama.mockResolvedValue(ctx);

      await expect(ttsService.loadModels()).rejects.toThrow('Vocoder failed to initialize');
    });

    it('is idempotent — does not double-init if already loaded', async () => {
      const ctx = makeMockContext();
      mockInitLlama.mockResolvedValue(ctx);

      await ttsService.loadModels();
      await ttsService.loadModels();

      expect(mockInitLlama).toHaveBeenCalledTimes(1);
    });
  });

  describe('unloadModels', () => {
    it('calls releaseVocoder and release', async () => {
      const ctx = makeMockContext();
      mockInitLlama.mockResolvedValue(ctx);
      await ttsService.loadModels();

      await ttsService.unloadModels();

      expect(ctx.releaseVocoder).toHaveBeenCalled();
      expect(ctx.release).toHaveBeenCalled();
      expect(ttsService.isLoaded()).toBe(false);
    });
  });

  // ─── Generation ──────────────────────────────────────────────────────────

  describe('generate', () => {
    it('calls completion pipeline in correct order and returns GeneratedAudio', async () => {
      const ctx = makeMockContext();
      mockInitLlama.mockResolvedValue(ctx);
      await ttsService.loadModels();

      const audio = await ttsService.generate('hello world');

      expect(ctx.getFormattedAudioCompletion).toHaveBeenCalled();
      expect(ctx.getAudioCompletionGuideTokens).toHaveBeenCalledWith('hello world');
      expect(ctx.completion).toHaveBeenCalled();
      expect(ctx.decodeAudioTokens).toHaveBeenCalled();

      expect(audio.samples).toBeInstanceOf(Float32Array);
      expect(audio.waveformData).toHaveLength(200);
      expect(audio.durationSeconds).toBeGreaterThan(0);
      expect(audio.sampleRate).toBe(TTS_BACKBONE_MODEL.sampleRate);
    });

    it('throws if models not loaded', async () => {
      await expect(ttsService.generate('test')).rejects.toThrow('TTS models not loaded');
    });
  });

  describe('saveToFile', () => {
    it('writes base64-encoded PCM to correct path', async () => {
      mockRNFS.exists.mockResolvedValue(false);
      mockRNFS.mkdir.mockResolvedValueOnce(undefined);
      mockRNFS.writeFile.mockResolvedValueOnce(undefined);

      const audio = {
        samples: new Float32Array([0.1, 0.2, 0.3]),
        durationSeconds: 0.01,
        sampleRate: 24000,
        waveformData: new Array(200).fill(0.1),
      };

      const path = await ttsService.saveToFile(audio, 'conv1', 'msg1');

      expect(path).toBe('/mock/docs/audio-cache/conv1/msg1.pcm');
      expect(mockRNFS.writeFile).toHaveBeenCalledWith(
        '/mock/docs/audio-cache/conv1/msg1.pcm',
        expect.any(String),
        'base64',
      );
    });
  });

  // ─── Stop ────────────────────────────────────────────────────────────────

  describe('stop', () => {
    it('sets isSpeakingFlag to false', () => {
      (ttsService as any).isSpeakingFlag = true;
      ttsService.stop();
      expect(ttsService.isSpeaking()).toBe(false);
    });

    it('calls stop on currentSource', () => {
      const mockSource = { stop: jest.fn() };
      (ttsService as any).currentSource = mockSource;
      ttsService.stop();
      expect(mockSource.stop).toHaveBeenCalled();
    });
  });

  // ─── Cache ────────────────────────────────────────────────────────────────

  describe('getAudioCacheSizeMB', () => {
    it('returns 0 if cache directory does not exist', async () => {
      mockRNFS.exists.mockResolvedValueOnce(false);
      const size = await ttsService.getAudioCacheSizeMB();
      expect(size).toBe(0);
    });

    it('returns size in MB by summing individual file sizes', async () => {
      mockRNFS.exists.mockResolvedValueOnce(true);
      // readDir(cacheRoot) → one conversation directory
      (mockRNFS as any).readDir
        .mockResolvedValueOnce([{ isDirectory: () => true, path: '/mock/docs/audio-cache/conv1' }])
        // readDir(conv1) → two .pcm files, each 2.5 MB
        .mockResolvedValueOnce([
          { isDirectory: () => false, size: 2.5 * 1024 * 1024 },
          { isDirectory: () => false, size: 2.5 * 1024 * 1024 },
        ]);
      const size = await ttsService.getAudioCacheSizeMB();
      expect(size).toBeCloseTo(5);
    });
  });

  describe('clearAudioCache', () => {
    it('unlinks the cache root if it exists', async () => {
      mockRNFS.exists.mockResolvedValueOnce(true);
      mockRNFS.unlink.mockResolvedValueOnce(undefined);
      await ttsService.clearAudioCache();
      expect(mockRNFS.unlink).toHaveBeenCalledWith('/mock/docs/audio-cache');
    });

    it('does nothing if cache does not exist', async () => {
      mockRNFS.exists.mockResolvedValueOnce(false);
      await ttsService.clearAudioCache();
      expect(mockRNFS.unlink).not.toHaveBeenCalled();
    });
  });
});
