import RNFS from 'react-native-fs';
import { validateModelFile, checkMemoryForModel, safeCompletion } from '../../../src/services/llmSafetyChecks';
import { defaultNativeFileSystemBoundary } from '../../harness/nativeFileSystem';

jest.mock('react-native-fs', () => {
  const { defaultNativeFileSystemBoundary: boundary } = require('../../harness/nativeFileSystem');
  return { __esModule: true, default: boundary.module, ...boundary.module };
});

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

describe('validateModelFile', () => {
  beforeEach(() => {
    defaultNativeFileSystemBoundary.reset();
  });

  it('returns invalid when file is too small', async () => {
    defaultNativeFileSystemBoundary.seedFile('/models/tiny.gguf', 100);

    const result = await validateModelFile('/models/tiny.gguf');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('too small');
  });

  it.each([
    '/models/Qwen3.5-9B-MTP-ONLY-Q4_K_M.gguf',
    '/models/MTP/mtp-gemma-4-E4B-it-Q8_0.gguf',
    '/models/mtp-Qwen3.8-27B-Q4_0.gguf',
    '/models/Qwen3.5-9B-DFlash-Q4_0.gguf',
  ])('refuses %s, which only speeds up another model, before the engine loads it', async path => {
    defaultNativeFileSystemBoundary.seedFile(path, 1_000_000);

    const result = await validateModelFile(path);
    expect(result).toEqual({
      valid: false,
      reason: 'This file only speeds up another model. It cannot run on its own.',
    });
  });

  it('refuses an importance matrix, which is calibration data and not a model', async () => {
    defaultNativeFileSystemBoundary.seedFile('/models/Spark-X2.6-4B-imatrix.gguf', 7_151_872);

    const result = await validateModelFile('/models/Spark-X2.6-4B-imatrix.gguf');
    expect(result).toEqual({
      valid: false,
      reason: 'This file is calibration data for making a model, not a model. Choose one of the sizes instead.',
    });
  });

  it('refuses a split model with a part missing, and loads it once every part is beside the first', async () => {
    defaultNativeFileSystemBoundary.seedFile('/models/M-Q8_0-00001-of-00003.gguf', 1_000_000);
    defaultNativeFileSystemBoundary.seedFile('/models/M-Q8_0-00003-of-00003.gguf', 1_000_000);
    expect(await validateModelFile('/models/M-Q8_0-00001-of-00003.gguf')).toEqual({
      valid: false,
      reason: 'This model comes in 3 parts and M-Q8_0-00002-of-00003.gguf is missing. Download it again to fetch the missing part.',
    });

    defaultNativeFileSystemBoundary.seedFile('/models/M-Q8_0-00002-of-00003.gguf', 1_000_000);
    expect(await validateModelFile('/models/M-Q8_0-00001-of-00003.gguf')).toEqual({ valid: true });
  });

  it('returns valid for a proper GGUF file', async () => {
    defaultNativeFileSystemBoundary.seedFile('/models/test.gguf', 1_000_000);

    const result = await validateModelFile('/models/test.gguf');
    expect(result).toEqual({ valid: true });
  });

  it('returns invalid when header is not GGUF', async () => {
    defaultNativeFileSystemBoundary.seedTextFile(
      '/models/test.bin',
      'NOPE',
      1_000_000,
    );

    const result = await validateModelFile('/models/test.bin');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not a GGUF file');
  });

  it('returns valid when RNFS.read() throws (iOS bridging workaround)', async () => {
    defaultNativeFileSystemBoundary.seedFile('/models/test.gguf', 1_000_000);
    mockedRNFS.read.mockRejectedValueOnce(new Error('NSInteger bridge error'));

    const result = await validateModelFile('/models/test.gguf');
    expect(result).toEqual({ valid: true });
  });

  it('returns invalid when the safe directory lookup cannot find the file', async () => {
    const result = await validateModelFile('/models/missing.gguf');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('handles string file size from stat', async () => {
    defaultNativeFileSystemBoundary.seedFile('/models/test.gguf', 5_000_000);
    defaultNativeFileSystemBoundary.setReportedFileSize(
      '/models/test.gguf',
      '5000000',
    );

    const result = await validateModelFile('/models/test.gguf');
    expect(result).toEqual({ valid: true });
  });
});

describe('checkMemoryForModel', () => {
  const mockGetMemory = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Measured on a 12 GB iPhone 17 Pro Max: 11.2 GB reported, ~5,984 MB free for the app, and a 9B
  // Q4_K_M (5.6 GB) and Gemma 4 E4B (5.0 GB) both load at a 4K context with their weights mapped.
  const IPHONE_12GB = { available: 5984 * 1024 * 1024, total: 11.2 * 1024 ** 3 };

  it('passes a 9B Q4_K_M on a 12 GB iPhone: mapped weights are not charged against free memory', async () => {
    mockGetMemory.mockResolvedValue(IPHONE_12GB);
    const result = await checkMemoryForModel({
      modelFileSize: 5.63e9, contextLength: 4096, getAvailableMemory: mockGetMemory, quantizedCache: true, weightsMapped: true,
    });
    expect(result.safe).toBe(true);
  });

  it('still refuses the same 9B when its weights are copied into memory', async () => {
    mockGetMemory.mockResolvedValue(IPHONE_12GB);
    const result = await checkMemoryForModel({
      modelFileSize: 5.63e9, contextLength: 4096, getAvailableMemory: mockGetMemory, quantizedCache: true,
    });
    expect(result.safe).toBe(false);
  });

  it('counts a vision projector against free memory: it is copied, not mapped', async () => {
    // 1.5 GB free: the 9B's KV cache and headroom fit, but not with its 0.92 GB projector on top.
    mockGetMemory.mockResolvedValue({ available: 1500 * 1024 * 1024, total: 11.2 * 1024 ** 3 });
    const args = { modelFileSize: 5.63e9, contextLength: 4096, getAvailableMemory: mockGetMemory, quantizedCache: true, weightsMapped: true };
    expect((await checkMemoryForModel(args)).safe).toBe(true);
    expect((await checkMemoryForModel({ ...args, projectorFileSize: 0.92e9 })).safe).toBe(false);
    // With the phone's usual ~6 GB free, the 9B and its projector load (measured on a 12 GB iPhone).
    mockGetMemory.mockResolvedValue(IPHONE_12GB);
    expect((await checkMemoryForModel({ ...args, projectorFileSize: 0.92e9 })).safe).toBe(true);
  });

  it('refuses mapped weights past what the fit rule allows on this RAM (Gemma 4 12B on 12 GB)', async () => {
    mockGetMemory.mockResolvedValue(IPHONE_12GB);
    const result = await checkMemoryForModel({
      modelFileSize: 7.3e9, contextLength: 4096, getAvailableMemory: mockGetMemory, quantizedCache: true, weightsMapped: true,
    });
    expect(result.safe).toBe(false);
  });

  it('returns safe when enough memory is available', async () => {
    mockGetMemory.mockResolvedValue({
      available: 4 * 1024 * 1024 * 1024, // 4 GB
      total: 8 * 1024 * 1024 * 1024,
    });

    const result = await checkMemoryForModel({
      modelFileSize: 500 * 1024 * 1024, // 500 MB model
      contextLength: 2048,
      getAvailableMemory: mockGetMemory,
    });
    expect(result.safe).toBe(true);
  });

  it('returns unsafe when not enough memory', async () => {
    mockGetMemory.mockResolvedValue({
      available: 300 * 1024 * 1024, // 300 MB
      total: 4 * 1024 * 1024 * 1024,
    });

    const result = await checkMemoryForModel({
      modelFileSize: 2 * 1024 * 1024 * 1024, // 2 GB model
      contextLength: 4096,
      getAvailableMemory: mockGetMemory,
    });
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Not enough memory');
  });

  it('returns safe when memory check throws', async () => {
    mockGetMemory.mockRejectedValue(new Error('not supported'));

    const result = await checkMemoryForModel({ modelFileSize: 500 * 1024 * 1024, contextLength: 2048, getAvailableMemory: mockGetMemory });
    expect(result.safe).toBe(true);
  });

  it('scales KV cache with model size — a large model at high context is unsafe', async () => {
    // ~5 GB available; a 4 GB model at 8192 ctx. The old fixed ~2 MB KV estimate
    // wrongly called this safe; the size-scaled estimate flags it.
    mockGetMemory.mockResolvedValue({
      available: 5 * 1024 * 1024 * 1024,
      total: 8 * 1024 * 1024 * 1024,
    });
    const result = await checkMemoryForModel({ modelFileSize: 4 * 1024 * 1024 * 1024, contextLength: 8192, getAvailableMemory: mockGetMemory });
    expect(result.safe).toBe(false);
  });

  it('a quantized KV cache lowers the estimate enough to fit where f16 would not', async () => {
    const mem = { available: 3300 * 1024 * 1024, total: 6 * 1024 * 1024 * 1024 };
    mockGetMemory.mockResolvedValue(mem);
    const args = { modelFileSize: 2 * 1024 * 1024 * 1024, contextLength: 8192, getAvailableMemory: mockGetMemory };
    const f16 = await checkMemoryForModel({ ...args, quantizedCache: false });
    const quant = await checkMemoryForModel({ ...args, quantizedCache: true });
    expect(quant.estimatedMB).toBeLessThan(f16.estimatedMB);
    expect(f16.safe).toBe(false);
    expect(quant.safe).toBe(true);
  });
});

describe('safeCompletion', () => {
  it('returns result of completionFn on success', async () => {
    const mockContext = { clearCache: jest.fn() };
    const result = await safeCompletion(mockContext as any, async () => 'ok');
    expect(result).toBe('ok');
  });

  it('throws wrapped error and clears KV cache on native crash (ggml)', async () => {
    const mockContext = { clearCache: jest.fn().mockResolvedValue(undefined) };
    await expect(
      safeCompletion(mockContext as any, async () => {
        throw new Error('ggml alloc failed');
      }),
    ).rejects.toThrow('Model inference failed (native error)');
    expect(mockContext.clearCache).toHaveBeenCalledWith(true);
  });

  it('throws wrapped error even when clearCache also fails', async () => {
    const mockContext = { clearCache: jest.fn().mockRejectedValue(new Error('cache clear failed')) };
    await expect(
      safeCompletion(mockContext as any, async () => {
        throw new Error('abort detected');
      }),
    ).rejects.toThrow('Model inference failed (native error)');
  });

  it('re-throws non-native errors unchanged', async () => {
    const mockContext = { clearCache: jest.fn() };
    await expect(
      safeCompletion(mockContext as any, async () => {
        throw new Error('unknown error');
      }),
    ).rejects.toThrow('unknown error');
    expect(mockContext.clearCache).not.toHaveBeenCalled();
  });

  it('recognises OOM as native crash keyword', async () => {
    const mockContext = { clearCache: jest.fn().mockResolvedValue(undefined) };
    await expect(
      safeCompletion(mockContext as any, async () => {
        throw new Error('OOM: out of memory');
      }),
    ).rejects.toThrow('Model inference failed (native error)');
    expect(mockContext.clearCache).toHaveBeenCalled();
  });

  it('uses String(error) when thrown value has no message', async () => {
    const mockContext = { clearCache: jest.fn().mockResolvedValue(undefined) };
    await expect(
      safeCompletion(mockContext as any, async () => {
        throw new Error('tensor error string');
      }),
    ).rejects.toThrow('Model inference failed (native error)');
  });
});
