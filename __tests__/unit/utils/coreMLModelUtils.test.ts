/**
 * Core ML Model Utilities Unit Tests
 *
 * Tests the helper functions used during Core ML model download & extraction:
 * - resolveCoreMLModelDir: Finds the actual directory containing .mlmodelc bundles
 *   after zip extraction (handles nested subdirectories)
 * - downloadCoreMLTokenizerFiles: Downloads merges.txt and vocab.json from
 *   HuggingFace when not present in the compiled model directory
 *
 * Priority: P0 (Critical) — If these break, Core ML models fail to load after
 * download with "merges.txt couldn't be opened" errors.
 */

import RNFS from 'react-native-fs';
import {
  resolveCoreMLModelDir,
  downloadCoreMLTokenizerFiles,
} from '../../../src/utils/coreMLModelUtils';

// ============================================================================
// Type helpers for RNFS.ReadDirResItemT
// ============================================================================

interface MockReadDirItem {
  name: string;
  path: string;
  size: number;
  isFile: () => boolean;
  isDirectory: () => boolean;
}

function makeFileItem(name: string, parentPath: string, size = 1000): MockReadDirItem {
  return {
    name,
    path: `${parentPath}/${name}`,
    size,
    isFile: () => true,
    isDirectory: () => false,
  };
}

function makeDirItem(name: string, parentPath: string): MockReadDirItem {
  return {
    name,
    path: `${parentPath}/${name}`,
    size: 0,
    isFile: () => false,
    isDirectory: () => true,
  };
}

// ============================================================================
// resolveCoreMLModelDir
// ============================================================================

describe('resolveCoreMLModelDir', () => {
  const mockReadDir = RNFS.readDir as jest.MockedFunction<typeof RNFS.readDir>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the same directory when .mlmodelc bundles are at the top level', async () => {
    const modelDir = '/data/models/sd21';

    mockReadDir.mockResolvedValueOnce([
      makeDirItem('TextEncoder.mlmodelc', modelDir),
      makeDirItem('Unet.mlmodelc', modelDir),
      makeDirItem('VAEDecoder.mlmodelc', modelDir),
      makeFileItem('merges.txt', modelDir),
      makeFileItem('vocab.json', modelDir),
    ] as any);

    const result = await resolveCoreMLModelDir(modelDir);

    expect(result).toBe(modelDir);
    expect(mockReadDir).toHaveBeenCalledTimes(1);
    expect(mockReadDir).toHaveBeenCalledWith(modelDir);
  });

  it('resolves nested subdirectory when .mlmodelc bundles are one level deep', async () => {
    const modelDir = '/data/models/sd21';
    const nestedDir = `${modelDir}/coreml-stable-diffusion-2-1-base-palettized_split_einsum_v2_compiled`;

    // Top level: no .mlmodelc, one subdirectory
    mockReadDir.mockResolvedValueOnce([
      makeDirItem('coreml-stable-diffusion-2-1-base-palettized_split_einsum_v2_compiled', modelDir),
    ] as any);

    // Inside the subdirectory: .mlmodelc bundles found
    mockReadDir.mockResolvedValueOnce([
      makeDirItem('TextEncoder.mlmodelc', nestedDir),
      makeDirItem('Unet.mlmodelc', nestedDir),
      makeDirItem('VAEDecoder.mlmodelc', nestedDir),
      makeFileItem('merges.txt', nestedDir),
      makeFileItem('vocab.json', nestedDir),
    ] as any);

    const result = await resolveCoreMLModelDir(modelDir);

    expect(result).toBe(nestedDir);
    expect(mockReadDir).toHaveBeenCalledTimes(2);
    expect(mockReadDir).toHaveBeenNthCalledWith(1, modelDir);
    expect(mockReadDir).toHaveBeenNthCalledWith(2, nestedDir);
  });

  it('returns original directory when no .mlmodelc bundles found anywhere', async () => {
    const modelDir = '/data/models/empty-model';

    // Top level: only regular files
    mockReadDir.mockResolvedValueOnce([
      makeFileItem('README.md', modelDir),
      makeFileItem('config.json', modelDir),
    ] as any);

    const result = await resolveCoreMLModelDir(modelDir);

    expect(result).toBe(modelDir);
    // Only 1 call — no subdirs to scan
    expect(mockReadDir).toHaveBeenCalledTimes(1);
  });

  it('returns original directory when subdirectories exist but contain no .mlmodelc', async () => {
    const modelDir = '/data/models/wrong-model';

    // Top level: subdirectory without .mlmodelc
    mockReadDir.mockResolvedValueOnce([
      makeDirItem('some-other-dir', modelDir),
      makeFileItem('README.md', modelDir),
    ] as any);

    // Inside subdirectory: no .mlmodelc
    mockReadDir.mockResolvedValueOnce([
      makeFileItem('model.bin', `${modelDir}/some-other-dir`),
      makeFileItem('config.json', `${modelDir}/some-other-dir`),
    ] as any);

    const result = await resolveCoreMLModelDir(modelDir);

    expect(result).toBe(modelDir);
    expect(mockReadDir).toHaveBeenCalledTimes(2);
  });

  it('checks multiple subdirectories and returns the first one with .mlmodelc', async () => {
    const modelDir = '/data/models/multi-sub';

    mockReadDir.mockResolvedValueOnce([
      makeDirItem('metadata', modelDir),
      makeDirItem('compiled_model', modelDir),
    ] as any);

    // First subdir: no .mlmodelc
    mockReadDir.mockResolvedValueOnce([
      makeFileItem('info.json', `${modelDir}/metadata`),
    ] as any);

    // Second subdir: has .mlmodelc
    mockReadDir.mockResolvedValueOnce([
      makeDirItem('Unet.mlmodelc', `${modelDir}/compiled_model`),
      makeDirItem('TextEncoder.mlmodelc', `${modelDir}/compiled_model`),
    ] as any);

    const result = await resolveCoreMLModelDir(modelDir);

    expect(result).toBe(`${modelDir}/compiled_model`);
    expect(mockReadDir).toHaveBeenCalledTimes(3);
  });

  it('handles empty directory gracefully', async () => {
    const modelDir = '/data/models/empty';

    mockReadDir.mockResolvedValueOnce([] as any);

    const result = await resolveCoreMLModelDir(modelDir);

    expect(result).toBe(modelDir);
    expect(mockReadDir).toHaveBeenCalledTimes(1);
  });

  it('ignores files with names partially matching .mlmodelc', async () => {
    const modelDir = '/data/models/tricky';

    // A file (not directory) named something.mlmodelc-backup should not match,
    // but a directory named Foo.mlmodelc should match
    mockReadDir.mockResolvedValueOnce([
      makeFileItem('model.mlmodelc-backup', modelDir),
      makeFileItem('notes.txt', modelDir),
    ] as any);

    const result = await resolveCoreMLModelDir(modelDir);

    // The file "model.mlmodelc-backup" does NOT end with ".mlmodelc" so no match
    expect(result).toBe(modelDir);
  });

  it('matches directory items whose name ends with .mlmodelc', async () => {
    const modelDir = '/data/models/dir-check';

    mockReadDir.mockResolvedValueOnce([
      // A directory named TextEncoder.mlmodelc
      makeDirItem('TextEncoder.mlmodelc', modelDir),
      makeFileItem('merges.txt', modelDir),
    ] as any);

    const result = await resolveCoreMLModelDir(modelDir);

    // .mlmodelc bundle found at top level — returns modelDir
    expect(result).toBe(modelDir);
  });

  it('propagates RNFS.readDir errors', async () => {
    const modelDir = '/data/models/nonexistent';

    mockReadDir.mockRejectedValueOnce(new Error('Directory not found'));

    await expect(resolveCoreMLModelDir(modelDir)).rejects.toThrow('Directory not found');
  });

  it('logs when resolving to a nested directory', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    const modelDir = '/data/models/sd21';
    const nestedDir = `${modelDir}/nested_compiled`;

    mockReadDir.mockResolvedValueOnce([
      makeDirItem('nested_compiled', modelDir),
    ] as any);

    mockReadDir.mockResolvedValueOnce([
      makeDirItem('Unet.mlmodelc', nestedDir),
    ] as any);

    await resolveCoreMLModelDir(modelDir);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CoreML] Resolved nested model dir:'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(nestedDir),
    );

    logSpy.mockRestore();
  });
});

// ============================================================================
// downloadCoreMLTokenizerFiles
// ============================================================================

describe('downloadCoreMLTokenizerFiles', () => {
  const mockExists = RNFS.exists as jest.MockedFunction<typeof RNFS.exists>;
  const mockDownloadFile = RNFS.downloadFile as jest.MockedFunction<typeof RNFS.downloadFile>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('downloads both merges.txt and vocab.json when neither exists', async () => {
    const modelDir = '/data/models/sd21/compiled';
    const repo = 'apple/coreml-stable-diffusion-2-1-base';

    // Neither file exists
    mockExists.mockResolvedValue(false);

    mockDownloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 5000 }),
    } as any);

    await downloadCoreMLTokenizerFiles(modelDir, repo);

    // Should check existence of both files
    expect(mockExists).toHaveBeenCalledWith(`${modelDir}/merges.txt`);
    expect(mockExists).toHaveBeenCalledWith(`${modelDir}/vocab.json`);

    // Should download both files
    expect(mockDownloadFile).toHaveBeenCalledTimes(2);
    expect(mockDownloadFile).toHaveBeenCalledWith({
      fromUrl: `https://huggingface.co/${repo}/resolve/main/merges.txt`,
      toFile: `${modelDir}/merges.txt`,
    });
    expect(mockDownloadFile).toHaveBeenCalledWith({
      fromUrl: `https://huggingface.co/${repo}/resolve/main/vocab.json`,
      toFile: `${modelDir}/vocab.json`,
    });
  });

  it('skips download when files already exist', async () => {
    const modelDir = '/data/models/sd21/compiled';
    const repo = 'apple/coreml-stable-diffusion-2-1-base';

    // Both files exist
    mockExists.mockResolvedValue(true);

    await downloadCoreMLTokenizerFiles(modelDir, repo);

    expect(mockExists).toHaveBeenCalledTimes(2);
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it('only downloads missing file when one already exists', async () => {
    const modelDir = '/data/models/sd21/compiled';
    const repo = 'apple/coreml-stable-diffusion-2-1-base';

    // merges.txt exists, vocab.json does not
    mockExists
      .mockResolvedValueOnce(true)   // merges.txt exists
      .mockResolvedValueOnce(false); // vocab.json does not

    mockDownloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 800 }),
    } as any);

    await downloadCoreMLTokenizerFiles(modelDir, repo);

    expect(mockDownloadFile).toHaveBeenCalledTimes(1);
    expect(mockDownloadFile).toHaveBeenCalledWith({
      fromUrl: `https://huggingface.co/${repo}/resolve/main/vocab.json`,
      toFile: `${modelDir}/vocab.json`,
    });
  });

  it('constructs correct HuggingFace URLs for different repos', async () => {
    const modelDir = '/data/models/sdxl';
    const repo = 'apple/coreml-stable-diffusion-xl-base-ios';

    mockExists.mockResolvedValue(false);

    mockDownloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 5000 }),
    } as any);

    await downloadCoreMLTokenizerFiles(modelDir, repo);

    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fromUrl: `https://huggingface.co/apple/coreml-stable-diffusion-xl-base-ios/resolve/main/merges.txt`,
      }),
    );
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fromUrl: `https://huggingface.co/apple/coreml-stable-diffusion-xl-base-ios/resolve/main/vocab.json`,
      }),
    );
  });

  it('warns on non-200 HTTP status but does not throw', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const modelDir = '/data/models/sd21/compiled';
    const repo = 'apple/coreml-stable-diffusion-2-1-base';

    mockExists.mockResolvedValue(false);

    mockDownloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 404, bytesWritten: 0 }),
    } as any);

    // Should not throw
    await downloadCoreMLTokenizerFiles(modelDir, repo);

    // Should warn for each failed file
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CoreML] Failed to download merges.txt: HTTP 404'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CoreML] Failed to download vocab.json: HTTP 404'),
    );

    warnSpy.mockRestore();
  });

  it('warns on 500 server errors', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const modelDir = '/data/models/sd21';
    const repo = 'apple/coreml-stable-diffusion-2-1-base';

    mockExists.mockResolvedValue(false);

    mockDownloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 500, bytesWritten: 0 }),
    } as any);

    await downloadCoreMLTokenizerFiles(modelDir, repo);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('HTTP 500'),
    );

    warnSpy.mockRestore();
  });

  it('logs each file download', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    const modelDir = '/data/models/sd21';
    const repo = 'apple/coreml-stable-diffusion-2-1-base';

    mockExists.mockResolvedValue(false);

    mockDownloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.resolve({ statusCode: 200, bytesWritten: 5000 }),
    } as any);

    await downloadCoreMLTokenizerFiles(modelDir, repo);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CoreML] Downloading tokenizer file: merges.txt'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CoreML] Downloading tokenizer file: vocab.json'),
    );

    logSpy.mockRestore();
  });

  it('does not log for files that already exist', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    const modelDir = '/data/models/sd21';
    const repo = 'apple/coreml-stable-diffusion-2-1-base';

    mockExists.mockResolvedValue(true);

    await downloadCoreMLTokenizerFiles(modelDir, repo);

    const coreMLLogs = logSpy.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('[CoreML] Downloading'),
    );
    expect(coreMLLogs).toHaveLength(0);

    logSpy.mockRestore();
  });

  it('handles downloadFile promise rejection gracefully', async () => {
    const modelDir = '/data/models/sd21';
    const repo = 'apple/coreml-stable-diffusion-2-1-base';

    mockExists.mockResolvedValue(false);

    mockDownloadFile.mockReturnValue({
      jobId: 1,
      promise: Promise.reject(new Error('Network error')),
    } as any);

    // Per-file errors are caught — function resolves without throwing
    await expect(
      downloadCoreMLTokenizerFiles(modelDir, repo),
    ).resolves.toBeUndefined();
  });

  it('downloads files sequentially (merges.txt first, then vocab.json)', async () => {
    const modelDir = '/data/models/sd21';
    const repo = 'apple/coreml-stable-diffusion-2-1-base';
    const downloadOrder: string[] = [];

    mockExists.mockResolvedValue(false);

    mockDownloadFile.mockImplementation(({ toFile }: any) => {
      downloadOrder.push(toFile);
      return {
        jobId: 1,
        promise: Promise.resolve({ statusCode: 200, bytesWritten: 5000 }),
      } as any;
    });

    await downloadCoreMLTokenizerFiles(modelDir, repo);

    expect(downloadOrder).toEqual([
      `${modelDir}/merges.txt`,
      `${modelDir}/vocab.json`,
    ]);
  });
});
