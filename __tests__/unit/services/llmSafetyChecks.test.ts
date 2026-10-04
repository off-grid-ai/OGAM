import RNFS from 'react-native-fs';
import { validateModelFile, safeCompletion } from '../../../src/services/llmSafetyChecks';
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

  it('returns valid for a proper GGUF file', async () => {
    defaultNativeFileSystemBoundary.seedFile('/models/test.gguf', 1_000_000);

    const result = await validateModelFile('/models/test.gguf');
    expect(result).toEqual({ valid: true });
  });

  it('returns invalid when header is not GGUF', async () => {
    defaultNativeFileSystemBoundary.seedTextFile(
      '/models/test.gguf',
      'NOPE',
      1_000_000,
    );

    const result = await validateModelFile('/models/test.gguf');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not a GGUF file');
  });

  it('fails closed when the native prefix reader cannot verify the file', async () => {
    defaultNativeFileSystemBoundary.seedFile('/models/test.gguf', 1_000_000);
    mockedRNFS.read.mockRejectedValueOnce(new Error('NSInteger bridge error'));

    const result = await validateModelFile('/models/test.gguf');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not a valid GGUF');
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
