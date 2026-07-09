/**
 * restoreInProgressDownloads Unit Tests
 *
 * Tests for the download-restoration logic that re-wires background download
 * context after an app restart. Without this, in-progress downloads would be
 * forgotten and the UI would never receive completion events.
 */

import { restoreInProgressDownloads } from '../../../src/services/modelManager/restore';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';
import { BackgroundDownloadContext } from '../../../src/services/modelManager/types';

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: jest.fn(() => true),
    getActiveDownloads: jest.fn(() => Promise.resolve([])),
    onProgress: jest.fn(() => jest.fn()),
    excludeFromBackup: jest.fn(() => Promise.resolve(true)),
    adoptActive: jest.fn(),
  },
}));

const mockService = backgroundDownloadService as jest.Mocked<typeof backgroundDownloadService>;

const MODELS_DIR = '/mock/documents/models';

function makeActiveDownload(overrides: Partial<{
  downloadId: string;
  status: string;
  fileName: string;
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  combinedTotalBytes: number;
  quantization: string;
  mmProjDownloadId: string;
}> = {}) {
  return {
    downloadId: '42',
    status: 'running',
    fileName: 'model.gguf',
    modelId: 'test/model',
    bytesDownloaded: 0,
    totalBytes: 4_000_000_000,
    combinedTotalBytes: 4_000_000_000,
    quantization: 'Q4_K_M',
    startedAt: Date.now(),
    ...overrides,
  };
}

describe('restoreInProgressDownloads', () => {
  let bgContext: Map<string, BackgroundDownloadContext>;
  let metadataCallback: jest.Mock;
  let onProgress: jest.Mock;

  /** Helper to call restoreInProgressDownloads with common defaults. */
  function callRestore(overrides: {
    metadataCallback?: jest.Mock | null;
    onProgress?: jest.Mock;
  } = {}) {
    return restoreInProgressDownloads({
      modelsDir: MODELS_DIR,
      backgroundDownloadContext: bgContext,
      backgroundDownloadMetadataCallback: overrides.metadataCallback === undefined
        ? metadataCallback
        : overrides.metadataCallback,
      ...(overrides.onProgress ? { onProgress: overrides.onProgress } : {}),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    bgContext = new Map();
    metadataCallback = jest.fn();
    onProgress = jest.fn();
    mockService.isAvailable.mockReturnValue(true);
    mockService.getActiveDownloads.mockResolvedValue([]);
    mockService.onProgress.mockReturnValue(jest.fn());
  });

  // ========================================================================
  // Guard: service unavailable
  // ========================================================================

  it('returns early without querying when service is unavailable', async () => {
    mockService.isAvailable.mockReturnValue(false);

    await callRestore();

    expect(mockService.getActiveDownloads).not.toHaveBeenCalled();
    expect(bgContext.size).toBe(0);
  });

  // ========================================================================
  // Filtering: status gating
  // ========================================================================

  it.each([
    ['completed', 1],
    ['failed', 0],
    ['unknown', 0],
    ['running', 1],
    ['pending', 1],
    ['paused', 0],
  ])('handles %s downloads (expect size=%i)', async (status, expectedSize) => {
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({ status }) as any]);
    await callRestore();
    expect(bgContext.size).toBe(expectedSize);
  });

  it('adopts ONLY in-flight downloads against the cap — a completed one is not adopted (slot-leak fix)', async () => {
    mockService.getActiveDownloads.mockResolvedValue([
      makeActiveDownload({ status: 'running', downloadId: 'run-1', fileName: 'a.gguf', modelId: 'm/a' }) as any,
      makeActiveDownload({ status: 'completed', downloadId: 'done-1', fileName: 'b.gguf', modelId: 'm/b' }) as any,
    ]);
    await callRestore();
    // Both restore into context, but a completed download never fires another terminal
    // event, so adopting it would leak a concurrency slot forever — only 'running' is adopted.
    expect(mockService.adoptActive).toHaveBeenCalledWith(['run-1']);
  });

  // ========================================================================
  // Filtering: metadata matching
  // ========================================================================

  it('skips download already present in backgroundDownloadContext', async () => {
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({ downloadId: '42' }) as any]);
    bgContext.set('42', { modelId: 'test/model', file: {} as any, localPath: '/x', mmProjLocalPath: null, removeProgressListener: jest.fn(), mmProjCompleted: true, mainCompleted: false });

    await callRestore();

    expect(bgContext.size).toBe(1);
    expect(mockService.onProgress).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Context wiring
  // ========================================================================

  it('sets correct localPath in context', async () => {
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({ downloadId: '55', fileName: 'vision.gguf' }) as any]);
    await callRestore({ metadataCallback: null });

    const ctx = bgContext.get('55') as any;
    expect(ctx.localPath).toBe(`${MODELS_DIR}/vision.gguf`);
  });

  it('sets mmProjLocalPath from persisted metadata', async () => {
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({
      downloadId: '55',
      fileName: 'vision.gguf',
      totalBytes: 4_000_000_000,
      combinedTotalBytes: 4_500_000_000,
      mmProjDownloadId: 'mm-55',
    }) as any]);
    await callRestore({ metadataCallback: null });

    const ctx = bgContext.get('55') as any;
    expect(ctx.mmProjLocalPath).toBe(`${MODELS_DIR}/vision-mmproj.gguf`);
  });

  it('sets mmProjLocalPath to null when not in persisted metadata', async () => {
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({ downloadId: '77' }) as any]);
    await callRestore({ metadataCallback: null });

    const ctx = bgContext.get('77') as any;
    expect(ctx.mmProjLocalPath).toBeNull();
  });

  it('stores modelId and file info in context', async () => {
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({
      downloadId: '42',
      modelId: 'org/specific-model',
      fileName: 'specific.gguf',
      quantization: 'Q5_K_M',
    }) as any]);
    await callRestore({ metadataCallback: null });

    const ctx = bgContext.get('42') as any;
    expect(ctx.modelId).toBe('org/specific-model');
    expect(ctx.file.name).toBe('specific.gguf');
    expect(ctx.file.quantization).toBe('Q5_K_M');
  });

  it('registers progress listener for the download', async () => {
    const removeProgressFn = jest.fn();
    mockService.onProgress.mockReturnValue(removeProgressFn);
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({ downloadId: '42' }) as any]);

    await callRestore({ metadataCallback: null });

    expect(mockService.onProgress).toHaveBeenCalledWith('42', expect.any(Function));
    const ctx = bgContext.get('42') as any;
    expect(ctx.removeProgressListener).toBe(removeProgressFn);
  });

  // ========================================================================
  // Metadata callback
  // ========================================================================

  it('calls metadata callback with derived info', async () => {
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({
      downloadId: '42',
      totalBytes: 4_000_000_000,
      combinedTotalBytes: 5_000_000_000,
    }) as any]);
    await callRestore();

    expect(metadataCallback).toHaveBeenCalledWith('42', expect.objectContaining({
      modelId: 'test/model',
      fileName: 'model.gguf',
      totalBytes: 5_000_000_000,
    }));
  });

  it('does not throw when metadataCallback is null', async () => {
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({ downloadId: '42' }) as any]);
    await expect(callRestore({ metadataCallback: null })).resolves.toEqual(['42']);
  });

  // ========================================================================
  // Progress callback forwarding
  // ========================================================================

  it('forwards progress events to onProgress callback with combined totalBytes', async () => {
    let capturedHandler: ((event: any) => void) | null = null;
    mockService.onProgress.mockImplementation((_id: string, handler: any) => {
      capturedHandler = handler;
      return jest.fn();
    });
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({
      downloadId: '42',
      totalBytes: 4_000_000_000,
      combinedTotalBytes: 4_500_000_000,
    }) as any]);

    await callRestore({
      metadataCallback: null,
      onProgress,
    });

    capturedHandler!({
      downloadId: '42',
      bytesDownloaded: 2_000_000_000,
      totalBytes: 4_000_000_000,
      status: 'running',
      fileName: 'model.gguf',
      modelId: 'test/model',
    });

    expect(onProgress).toHaveBeenLastCalledWith({
      downloadId: '42',
      modelId: 'test/model',
      fileName: 'model.gguf',
      bytesDownloaded: 2_500_000_000,
      totalBytes: 4_500_000_000, // uses combined stored totalBytes
      progress: expect.closeTo(2_500_000_000 / 4_500_000_000, 5),
    });
  });

  it('reports zero progress when totalBytes is zero', async () => {
    let capturedHandler: ((event: any) => void) | null = null;
    mockService.onProgress.mockImplementation((_id: string, handler: any) => {
      capturedHandler = handler;
      return jest.fn();
    });
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({
      downloadId: '42',
      totalBytes: 0,
      combinedTotalBytes: 0,
    }) as any]);

    await callRestore({
      metadataCallback: null,
      onProgress,
    });

    capturedHandler!({
      downloadId: '42', bytesDownloaded: 500, totalBytes: 0,
      status: 'running', fileName: 'model.gguf', modelId: 'test/model',
    });

    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 0 }));
  });

  it('does not throw when onProgress is undefined', async () => {
    mockService.getActiveDownloads.mockResolvedValue([makeActiveDownload({ downloadId: '42' }) as any]);
    await expect(callRestore({ metadataCallback: null })).resolves.toEqual(['42']);
  });

  // ========================================================================
  // Multiple downloads
  // ========================================================================

  it('restores multiple in-progress downloads independently', async () => {
    mockService.getActiveDownloads.mockResolvedValue([
      makeActiveDownload({ downloadId: '10', fileName: 'model-a.gguf' }) as any,
      makeActiveDownload({ downloadId: '20', fileName: 'model-b.gguf' }) as any,
    ]);
    await callRestore();

    expect(bgContext.size).toBe(2);
    expect(bgContext.has('10')).toBe(true);
    expect(bgContext.has('20')).toBe(true);
    expect(mockService.onProgress).toHaveBeenCalledTimes(2);
    expect(metadataCallback).toHaveBeenCalledTimes(2);
  });

  it('restores completed and running entries independently', async () => {
    mockService.getActiveDownloads.mockResolvedValue([
      makeActiveDownload({ downloadId: '10', status: 'completed' }) as any,
      makeActiveDownload({ downloadId: '20', status: 'running' }) as any,
    ]);
    await callRestore();

    expect(bgContext.size).toBe(2);
    expect(bgContext.has('10')).toBe(true);
    expect(bgContext.has('20')).toBe(true);
  });
});
