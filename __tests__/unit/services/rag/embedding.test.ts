import { initLlama } from 'llama.rn';
import RNFS from 'react-native-fs';

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const mockInitLlama = initLlama as jest.MockedFunction<typeof initLlama>;
const mockExists = RNFS.exists as jest.MockedFunction<typeof RNFS.exists>;
const mockCopyFileAssets = (RNFS as any).copyFileAssets as jest.MockedFunction<any>;
const mockCopyFile = RNFS.copyFile as jest.MockedFunction<typeof RNFS.copyFile>;

// Must import after mocks are set up
import { embeddingService } from '../../../../src/services/rag/embedding';
import { modelResidencyManager } from '../../../../src/services/modelResidency';

const mockEmbedding = jest.fn();
const mockRelease = jest.fn();

describe('EmbeddingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset internal state
    (embeddingService as any).context = null;
    (embeddingService as any).loading = null;
    modelResidencyManager._reset();

    mockEmbedding.mockResolvedValue({ embedding: new Array(384).fill(0.1) });
    mockRelease.mockResolvedValue(undefined);
    mockInitLlama.mockResolvedValue({
      embedding: mockEmbedding,
      release: mockRelease,
    } as any);
    mockExists.mockResolvedValue(false);
  });

  describe('load', () => {
    it('initializes llama context with embedding params', async () => {
      await embeddingService.load();

      expect(mockInitLlama).toHaveBeenCalledWith(expect.objectContaining({
        embedding: true,
        n_gpu_layers: 0,
        n_ctx: 512,
      }));
      expect(embeddingService.isLoaded()).toBe(true);
    });

    it('copies model from assets if not already present', async () => {
      mockExists.mockResolvedValue(false);
      await embeddingService.load();

      // Should have checked existence and copied
      expect(mockExists).toHaveBeenCalled();
    });

    it('skips copy if model already exists', async () => {
      mockExists.mockResolvedValue(true);
      await embeddingService.load();

      expect(mockCopyFileAssets).not.toHaveBeenCalled();
      expect(mockCopyFile).not.toHaveBeenCalled();
    });

    it('is idempotent — second call is a no-op', async () => {
      await embeddingService.load();
      await embeddingService.load();

      expect(mockInitLlama).toHaveBeenCalledTimes(1);
    });

    it('serializes concurrent calls', async () => {
      const p1 = embeddingService.load();
      const p2 = embeddingService.load();
      await Promise.all([p1, p2]);

      expect(mockInitLlama).toHaveBeenCalledTimes(1);
    });

    it('registers with the residency manager so its RAM is budgeted (F2)', async () => {
      await embeddingService.load();
      expect(modelResidencyManager.isResident('embedding')).toBe(true);
      const resident = modelResidencyManager.getResidents().find(r => r.key === 'embedding');
      expect(resident?.type).toBe('embedding');
      expect(resident?.sizeMB).toBeGreaterThan(0);
    });

    it('rejects and does not register if the native load times out (F5)', async () => {
      jest.useFakeTimers();
      // initLlama never resolves → the timeout must fire and release the lock.
      mockInitLlama.mockReturnValue(new Promise(() => {}) as any);
      const loadPromise = embeddingService.load().catch((e: Error) => e);
      await jest.advanceTimersByTimeAsync(31000);
      const result = await loadPromise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch('timed out');
      expect(embeddingService.isLoaded()).toBe(false);
      expect(modelResidencyManager.isResident('embedding')).toBe(false);
      jest.useRealTimers();
    });
  });

  describe('embed', () => {
    it('returns embedding vector', async () => {
      await embeddingService.load();
      const result = await embeddingService.embed('hello world');

      expect(mockEmbedding).toHaveBeenCalledWith('hello world');
      expect(result).toHaveLength(384);
    });

    it('throws if model not loaded', async () => {
      await expect(embeddingService.embed('test')).rejects.toThrow('not loaded');
    });
  });

  describe('embedBatch', () => {
    it('embeds multiple texts sequentially', async () => {
      await embeddingService.load();
      const results = await embeddingService.embedBatch(['hello', 'world']);

      expect(results).toHaveLength(2);
      expect(mockEmbedding).toHaveBeenCalledTimes(2);
    });
  });

  describe('unload', () => {
    it('releases the context', async () => {
      await embeddingService.load();
      await embeddingService.unload();

      expect(mockRelease).toHaveBeenCalled();
      expect(embeddingService.isLoaded()).toBe(false);
    });

    it('releases its residency registration on unload (F2)', async () => {
      await embeddingService.load();
      expect(modelResidencyManager.isResident('embedding')).toBe(true);
      await embeddingService.unload();
      expect(modelResidencyManager.isResident('embedding')).toBe(false);
    });

    it('is safe to call when not loaded', async () => {
      await embeddingService.unload();
      expect(mockRelease).not.toHaveBeenCalled();
    });
  });

  describe('getDimension', () => {
    it('returns 384', () => {
      expect(embeddingService.getDimension()).toBe(384);
    });
  });

  describe('load — Android copyFileAssets branch', () => {
    it('copies from assets on Android when file does not exist', async () => {
      const { Platform } = require('react-native');
      Platform.OS = 'android';
      mockExists.mockResolvedValue(false);
      mockCopyFileAssets.mockResolvedValue(undefined);

      await embeddingService.load();

      expect(mockCopyFileAssets).toHaveBeenCalled();
      Platform.OS = 'ios'; // restore
    });
  });

  describe('embed — error recovery branches', () => {
    it('unloads model and throws wrapped error on ggml native error', async () => {
      await embeddingService.load();
      mockEmbedding.mockRejectedValue(new Error('ggml alloc failed'));
      mockRelease.mockResolvedValue(undefined);

      await expect(embeddingService.embed('test')).rejects.toThrow('Embedding failed (native error)');
      expect(embeddingService.isLoaded()).toBe(false);
    });

    it('uses String(error) fallback when error has no message property', async () => {
      await embeddingService.load();
      // Throw a plain string, not an Error object — error?.message is undefined
      mockEmbedding.mockRejectedValue('OOM string error');

      await expect(embeddingService.embed('test')).rejects.toThrow('Embedding failed (native error)');
    });

    it('re-throws non-recovery errors unchanged', async () => {
      await embeddingService.load();
      mockEmbedding.mockRejectedValue(new Error('unexpected error'));

      await expect(embeddingService.embed('test')).rejects.toThrow('unexpected error');
    });
  });

  describe('unload — release error is swallowed', () => {
    it('sets context to null even when release throws', async () => {
      await embeddingService.load();
      mockRelease.mockRejectedValue(new Error('bridge torn down'));

      await embeddingService.unload();
      expect(embeddingService.isLoaded()).toBe(false);
    });
  });
});
