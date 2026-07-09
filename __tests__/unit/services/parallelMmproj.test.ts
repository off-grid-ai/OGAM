/**
 * Parallel mmproj Download Tests
 *
 * Tests for downloading mmproj (vision projection) files in parallel with the
 * main GGUF model, instead of sequentially blocking before the main download.
 *
 * Covers: parallel start, combined progress, dual completion gating,
 * error handling, cancellation, sync after app kill, and restore.
 */

import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';
import {
  performBackgroundDownload,
  watchBackgroundDownload,
  syncCompletedBackgroundDownloads,
} from '../../../src/services/modelManager/download';
import { restoreInProgressDownloads } from '../../../src/services/modelManager/restore';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';
import { BackgroundDownloadContext } from '../../../src/services/modelManager/types';
import { useDownloadStore } from '../../../src/stores/downloadStore';
import { createModelFile, createModelFileWithMmProj } from '../../utils/factories';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: {
    getDownloadUrl: jest.fn((modelId: string, fileName: string) =>
      `https://huggingface.co/${modelId}/resolve/main/${fileName}`
    ),
  },
}));

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: jest.fn(() => true),
    startDownload: jest.fn(),
    cancelDownload: jest.fn(() => Promise.resolve()),
    purgeNativeRecord: jest.fn(() => Promise.resolve()),
    adoptActive: jest.fn(),
    getActiveDownloads: jest.fn(() => Promise.resolve([])),
    moveCompletedDownload: jest.fn(),
    startProgressPolling: jest.fn(),
    stopProgressPolling: jest.fn(),
    onProgress: jest.fn(() => jest.fn()),
    onComplete: jest.fn(() => jest.fn()),
    onError: jest.fn(() => jest.fn()),
    excludeFromBackup: jest.fn(() => Promise.resolve(true)),
  },
}));

const mockService = backgroundDownloadService as jest.Mocked<typeof backgroundDownloadService>;

const MODELS_DIR = '/mock/documents/models';

// Helper: create a vision file with specific sizes
function visionFile(mainSize = 4_000_000_000, mmProjSize = 500_000_000) {
  return createModelFileWithMmProj({
    name: 'vision.gguf',
    size: mainSize,
    quantization: 'Q4_K_M',
    mmProjName: 'mmproj.gguf',
    mmProjSize,
    mmProjDownloadUrl: 'https://huggingface.co/test/model/resolve/main/mmproj.gguf',
  });
}

// Helper: stub startDownload to return download IDs BY ROLE, not call order. The
// sidecar (fileName contains 'mmproj') always gets ids[1]; the main file gets ids[0].
// Keeping the id tied to the role — not the start sequence — makes these tests agnostic
// to whether the main or the sidecar is started first (the sidecar-first ordering that
// closes the finalize-hang window must not require rewriting every assertion).
function stubStartDownload(ids: string[]) {
  let idx = 0;
  mockService.startDownload.mockImplementation(async (params: any) => {
    const isMmProj = /mmproj/i.test(params.fileName ?? '');
    const downloadId = ids.length > 1
      ? (isMmProj ? ids[1] : ids[0])
      : (ids[idx++] ?? ids[ids.length - 1]);
    return {
      downloadId,
      fileName: params.fileName,
      modelId: params.modelId,
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes: params.totalBytes || 0,
      startedAt: Date.now(),
    };
  });
}

// Helper: capture onComplete callbacks keyed by downloadId
function captureCompleteCallbacks(): Record<string, (event: any) => Promise<void>> {
  const cbs: Record<string, any> = {};
  mockService.onComplete.mockImplementation((id: string, cb: any) => {
    cbs[id] = cb;
    return jest.fn();
  });
  return cbs;
}

// Helper: capture onError callbacks keyed by downloadId
function captureErrorCallbacks(): Record<string, (event: any) => void> {
  const cbs: Record<string, any> = {};
  mockService.onError.mockImplementation((id: string, cb: any) => {
    cbs[id] = cb;
    return jest.fn();
  });
  return cbs;
}

// Helper: capture onProgress callbacks keyed by downloadId
function captureProgressCallbacks(): Record<string, (event: any) => void> {
  const cbs: Record<string, any> = {};
  mockService.onProgress.mockImplementation((id: string, cb: any) => {
    cbs[id] = cb;
    return jest.fn();
  });
  return cbs;
}

describe('Parallel mmproj download', () => {
  let bgContext: Map<string, BackgroundDownloadContext>;
  let metadataCallback: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    bgContext = new Map();
    metadataCallback = jest.fn();

    mockedRNFS.exists.mockResolvedValue(false);
    mockedAsyncStorage.getItem.mockResolvedValue('[]');
    mockedAsyncStorage.setItem.mockResolvedValue(undefined as any);
  });

  // ========================================================================
  // performBackgroundDownload — parallel start
  // ========================================================================

  describe('performBackgroundDownload', () => {
    it('starts both main and mmproj downloads in parallel', async () => {
      stubStartDownload(['42', '43']);

      const info = await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      expect(info.downloadId).toBe('42');
      expect(mockService.startDownload).toHaveBeenCalledTimes(2);
      expect(mockService.startDownload).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'vision.gguf' }),
      );
      expect(mockService.startDownload).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'vision-mmproj.gguf' }),
      );
    });

    it('starts the mmproj sidecar BEFORE the main (so the main is last-started → watcher attaches before it can complete)', async () => {
      // Regression: the main used to be started first, then this function blocked
      // awaiting the sidecar's queued start; during that wait the main could complete
      // with no listener yet (lost event → finalize hang at 100%). Sidecar-first means
      // nothing long is awaited after the main starts.
      stubStartDownload(['42', '43']);
      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });
      const order = mockService.startDownload.mock.calls.map((c: any[]) => c[0].fileName);
      expect(order).toEqual(['vision-mmproj.gguf', 'vision.gguf']);
    });

    it('persists mmProjDownloadId in metadata callback', async () => {
      stubStartDownload(['42', '43']);

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      expect(metadataCallback).toHaveBeenCalledWith('42', expect.objectContaining({
        mmProjDownloadId: '43',
        mmProjFileName: 'vision-mmproj.gguf',
      }));
    });

    it('sets mmProjCompleted=false and mainCompleted=false in context', async () => {
      stubStartDownload(['42', '43']);

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      const ctx = bgContext.get('42') as any;
      expect(ctx.mmProjCompleted).toBe(false);
      expect(ctx.mainCompleted).toBe(false);
      expect(ctx.mmProjDownloadId).toBe('43');
    });

    it('skips mmproj download when mmproj already exists', async () => {
      stubStartDownload(['42']);
      mockedRNFS.exists
        .mockResolvedValueOnce(false) // main doesn't exist
        .mockResolvedValueOnce(true); // mmproj exists
      mockedRNFS.stat.mockResolvedValue({ size: 500_000_000 } as any);

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      // Only main download started
      expect(mockService.startDownload).toHaveBeenCalledTimes(1);
      const ctx = bgContext.get('42') as any;
      expect(ctx.mmProjCompleted).toBe(true);
    });

    it('only starts main download for non-vision models', async () => {
      stubStartDownload(['42']);
      const file = createModelFile({ name: 'model.gguf', size: 4_000_000_000 });

      await performBackgroundDownload({
        modelId: 'test/model',
        file,
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      expect(mockService.startDownload).toHaveBeenCalledTimes(1);
      const ctx = bgContext.get('42') as any;
      expect(ctx.mmProjCompleted).toBe(true);
      expect(ctx.mmProjDownloadId).toBeUndefined();
    });

    it('returns immediately when both files already exist', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 500_000_000 } as any);
      mockedAsyncStorage.getItem.mockResolvedValue('[]');

      const info = await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      expect(info.downloadId).toBe('already-downloaded:test/model/vision.gguf');
      expect(info.status).toBe('completed');
      expect(mockService.startDownload).not.toHaveBeenCalled();
    });

    it('re-downloads mmproj when an existing sidecar is only partially written', async () => {
      stubStartDownload(['42', '43']);
      mockedRNFS.exists
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockedRNFS.stat.mockResolvedValue({ size: '123' } as any);
      mockedRNFS.unlink.mockResolvedValue(undefined as any);

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(4_000_000_000, 500_000_000),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      expect(mockedRNFS.unlink).toHaveBeenCalledWith(`${MODELS_DIR}/vision-mmproj.gguf`);
      expect(mockService.startDownload).toHaveBeenCalledTimes(2);
    });

    it('re-downloads mmproj when stat fails for an existing sidecar', async () => {
      stubStartDownload(['42', '43']);
      mockedRNFS.exists
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockedRNFS.stat.mockRejectedValue(new Error('stat failed'));
      mockedRNFS.unlink.mockResolvedValue(undefined as any);

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(4_000_000_000, 500_000_000),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      expect(mockedRNFS.unlink).toHaveBeenCalledWith(`${MODELS_DIR}/vision-mmproj.gguf`);
      expect(mockService.startDownload).toHaveBeenCalledTimes(2);
    });

    it('reuses an existing failed entry by cancelling old downloads and retrying the store entry', async () => {
      stubStartDownload(['42', '43']);
      const retryEntry = jest.fn();
      const add = jest.fn();
      const setMmProjDownloadId = jest.fn();
      const getStateSpy = jest.spyOn(useDownloadStore, 'getState').mockReturnValue({
        downloads: {
          'test/model/vision.gguf': {
            downloadId: 'old-main',
            mmProjDownloadId: 'old-mmproj',
          },
        },
        retryEntry,
        add,
        setMmProjDownloadId,
      } as any);

      try {
        await performBackgroundDownload({
          modelId: 'test/model',
          file: visionFile(),
          modelsDir: MODELS_DIR,
          backgroundDownloadContext: bgContext,
          backgroundDownloadMetadataCallback: metadataCallback,
        });

        expect(mockService.cancelDownload).toHaveBeenCalledWith('old-main');
        expect(mockService.cancelDownload).toHaveBeenCalledWith('old-mmproj');
        expect(retryEntry).toHaveBeenCalledWith('test/model/vision.gguf', '42');
        expect(add).not.toHaveBeenCalled();
        expect(setMmProjDownloadId).toHaveBeenCalledWith('test/model/vision.gguf', '43');
      } finally {
        getStateSpy.mockRestore();
      }
    });
  });

  // ========================================================================
  // Combined progress
  // ========================================================================

  describe('combined progress', () => {
    it('reports combined progress from both downloads', async () => {
      const progressCbs = captureProgressCallbacks();
      stubStartDownload(['42', '43']);
      const onProgress = jest.fn();

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(4_000_000_000, 1_000_000_000), // 4GB main + 1GB mmproj
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onProgress,
      });

      // Simulate main progress: 2GB downloaded
      progressCbs['42']?.({ downloadId: '42', bytesDownloaded: 2_000_000_000, totalBytes: 4_000_000_000, status: 'running', fileName: 'vision.gguf', modelId: 'test/model' });
      expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
        bytesDownloaded: 2_000_000_000, // main only so far
        totalBytes: 5_000_000_000, // combined
      }));

      // Simulate mmproj progress: 500MB downloaded
      progressCbs['43']?.({ downloadId: '43', bytesDownloaded: 500_000_000, totalBytes: 1_000_000_000, status: 'running', fileName: 'mmproj.gguf', modelId: 'test/model' });
      expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
        bytesDownloaded: 2_500_000_000, // 2GB main + 500MB mmproj
        totalBytes: 5_000_000_000,
        progress: expect.closeTo(0.5, 5),
      }));
    });

    it('includes pre-existing mmproj size in progress when mmproj already downloaded', async () => {
      const progressCbs = captureProgressCallbacks();
      stubStartDownload(['42']);
      mockedRNFS.exists
        .mockResolvedValueOnce(false) // main
        .mockResolvedValueOnce(true); // mmproj exists
      mockedRNFS.stat.mockResolvedValue({ size: 1_000_000_000 } as any);
      const onProgress = jest.fn();

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(4_000_000_000, 1_000_000_000),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onProgress,
      });

      // Main progress: 2GB
      progressCbs['42']?.({ downloadId: '42', bytesDownloaded: 2_000_000_000, totalBytes: 4_000_000_000, status: 'running', fileName: 'vision.gguf', modelId: 'test/model' });
      expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
        bytesDownloaded: 3_000_000_000, // 2GB main + 1GB existing mmproj
        totalBytes: 5_000_000_000,
      }));
    });

    it('updates the native combined-progress notification when supported', async () => {
      const progressCbs = captureProgressCallbacks();
      stubStartDownload(['42', '43']);
      NativeModules.DownloadManagerModule = {
        updateCombinedProgress: jest.fn(),
      };

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(4_000_000_000, 1_000_000_000),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onProgress: jest.fn(),
      });

      progressCbs['42']?.({ downloadId: '42', bytesDownloaded: 1_000_000_000, totalBytes: 4_000_000_000, status: 'running', fileName: 'vision.gguf', modelId: 'test/model' });

      expect(NativeModules.DownloadManagerModule.updateCombinedProgress).toHaveBeenCalledWith(
        'test/model',
        'vision.gguf',
        'mmproj.gguf',
        1_000_000_000,
        4_000_000_000,
        0,
        1_000_000_000,
      );
    });

    it('swallows native combined-progress update failures', async () => {
      const progressCbs = captureProgressCallbacks();
      stubStartDownload(['42', '43']);
      NativeModules.DownloadManagerModule = {
        updateCombinedProgress: jest.fn(() => {
          throw new Error('native failure');
        }),
      };

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(4_000_000_000, 1_000_000_000),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onProgress: jest.fn(),
      });

      expect(() => {
        progressCbs['42']?.({ downloadId: '42', bytesDownloaded: 1_000_000_000, totalBytes: 4_000_000_000, status: 'running', fileName: 'vision.gguf', modelId: 'test/model' });
      }).not.toThrow();
    });
  });

  // ========================================================================
  // watchBackgroundDownload — dual completion gating
  // ========================================================================

  describe('watchBackgroundDownload — completion gating', () => {
    async function setupVisionDownload() {
      stubStartDownload(['42', '43']);
      const completeCbs = captureCompleteCallbacks();

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      return completeCbs;
    }

    it('does not fire onComplete until both downloads finish (mmproj first)', async () => {
      const completeCbs = await setupVisionDownload();
      const onComplete = jest.fn();

      mockService.moveCompletedDownload.mockResolvedValue('/models/vision.gguf');
      mockedRNFS.exists.mockResolvedValue(true);

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete,
      });

      // mmproj completes first
      await completeCbs['43']?.({ downloadId: '43', fileName: 'mmproj.gguf' });
      expect(onComplete).not.toHaveBeenCalled();

      // main completes
      await completeCbs['42']?.({ downloadId: '42', fileName: 'vision.gguf' });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('does not fire onComplete until both downloads finish (main first)', async () => {
      const completeCbs = await setupVisionDownload();
      const onComplete = jest.fn();

      mockService.moveCompletedDownload.mockResolvedValue('/models/vision.gguf');
      mockedRNFS.exists.mockResolvedValue(true);

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete,
      });

      // main completes first
      await completeCbs['42']?.({ downloadId: '42', fileName: 'vision.gguf' });
      expect(onComplete).not.toHaveBeenCalled();

      // mmproj completes
      await completeCbs['43']?.({ downloadId: '43', fileName: 'mmproj.gguf' });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('fires onComplete immediately for non-vision model (no mmproj)', async () => {
      stubStartDownload(['42']);
      const completeCbs = captureCompleteCallbacks();
      const file = createModelFile({ name: 'model.gguf', size: 4_000_000_000 });

      await performBackgroundDownload({
        modelId: 'test/model',
        file,
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      const onComplete = jest.fn();
      mockService.moveCompletedDownload.mockResolvedValue('/models/model.gguf');
      mockedRNFS.exists.mockResolvedValue(true);

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete,
      });

      await completeCbs['42']?.({ downloadId: '42', fileName: 'model.gguf' });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('finalizes idempotently when the native move rejects but the file is already on disk (no re-finalize loop)', async () => {
      // Device case: a record reports completed across relaunch but its localUri was
      // cleared (moved in a prior session), so moveCompletedDownload rejects NOT_COMPLETED.
      // The file is already at localPath — finalize from it, and purge the stale native
      // record so restore can't re-adopt + re-fail it every foreground.
      stubStartDownload(['42']);
      const completeCbs = captureCompleteCallbacks();
      await performBackgroundDownload({
        modelId: 'test/model',
        file: createModelFile({ name: 'model.gguf', size: 4_000_000_000 }),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      const onComplete = jest.fn();
      const onError = jest.fn();
      mockService.moveCompletedDownload.mockRejectedValue(new Error('Download 42 not completed yet'));
      mockedRNFS.exists.mockResolvedValue(true); // the final file IS on disk
      mockService.purgeNativeRecord.mockResolvedValue(undefined);

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete,
        onError,
      });

      await completeCbs['42']?.({ downloadId: '42', fileName: 'model.gguf' });
      await new Promise(resolve => setImmediate(resolve));

      expect(onComplete).toHaveBeenCalledTimes(1); // finalized from disk, not an error
      expect(onError).not.toHaveBeenCalled();
      // Purged via the listener-free path (NOT the finalize-path cancelDownload, which
      // would synthesize a spurious DownloadError and flash the just-finalized model as
      // failed — see F2). cancelDownload may still be called by the re-adopt path above.
      expect(mockService.purgeNativeRecord).toHaveBeenCalledWith('42');
    });

    it('fails (not loops) when the native move rejects AND the file is genuinely absent', async () => {
      stubStartDownload(['42']);
      const completeCbs = captureCompleteCallbacks();
      await performBackgroundDownload({
        modelId: 'test/model',
        file: createModelFile({ name: 'model.gguf', size: 4_000_000_000 }),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      const onComplete = jest.fn();
      const onError = jest.fn();
      mockService.moveCompletedDownload.mockRejectedValue(new Error('Download 42 not completed yet'));
      mockedRNFS.exists.mockResolvedValue(false); // file NOT on disk → genuine failure

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete,
        onError,
      });

      await completeCbs['42']?.({ downloadId: '42', fileName: 'model.gguf' });
      await new Promise(resolve => setImmediate(resolve));

      expect(onComplete).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalled();
    });

    it('moves mmproj file on mmproj completion', async () => {
      const completeCbs = await setupVisionDownload();

      mockService.moveCompletedDownload.mockResolvedValue('/models/vision.gguf');
      mockedRNFS.exists.mockResolvedValue(true);

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      await completeCbs['43']?.({ downloadId: '43', fileName: 'mmproj.gguf' });

      expect(mockService.moveCompletedDownload).toHaveBeenCalledWith(
        '43', `${MODELS_DIR}/vision-mmproj.gguf`,
      );
    });

    it('clears metadata callback when both complete', async () => {
      const completeCbs = await setupVisionDownload();
      mockService.moveCompletedDownload.mockResolvedValue('/models/vision.gguf');
      mockedRNFS.exists.mockResolvedValue(true);

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      metadataCallback.mockClear();
      await completeCbs['43']?.({ downloadId: '43' });
      await completeCbs['42']?.({ downloadId: '42' });

      expect(metadataCallback).toHaveBeenCalledWith('42', null);
    });

    it('ignores duplicate main completion events after the first one', async () => {
      const completeCbs = await setupVisionDownload();
      mockedRNFS.exists.mockResolvedValue(true);
      mockService.moveCompletedDownload.mockResolvedValue('/models/vision.gguf');

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete: jest.fn(),
      });

      await completeCbs['42']?.({ downloadId: '42', fileName: 'vision.gguf' });
      await completeCbs['42']?.({ downloadId: '42', fileName: 'vision.gguf' });

      expect(mockService.moveCompletedDownload).not.toHaveBeenCalledWith('42', `${MODELS_DIR}/vision.gguf`);
    });

    it('drops vision when mmproj move fails and the target file is missing', async () => {
      const completeCbs = await setupVisionDownload();
      mockedRNFS.exists.mockResolvedValue(false);
      mockService.moveCompletedDownload
        .mockRejectedValueOnce(new Error('move failed'))
        .mockResolvedValueOnce('/models/vision.gguf');
      const onComplete = jest.fn();

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete,
      });

      await completeCbs['43']?.({ downloadId: '43', fileName: 'mmproj.gguf' });
      await completeCbs['42']?.({ downloadId: '42', fileName: 'vision.gguf' });

      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
        mmProjPath: undefined,
        mmProjFileName: 'mmproj.gguf',
        isVisionModel: false,
      }));
    });
  });

  // ========================================================================
  // watchBackgroundDownload — error handling
  // ========================================================================

  describe('watchBackgroundDownload — error handling', () => {
    it('cancels mmproj when main download fails', async () => {
      stubStartDownload(['42', '43']);
      const errorCbs = captureErrorCallbacks();
      captureCompleteCallbacks();

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      const onError = jest.fn();
      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onError,
      });

      errorCbs['42']?.({ downloadId: '42', fileName: 'vision.gguf', modelId: 'test/model', status: 'failed', reason: 'Network error' });

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Network error' }));
      expect(mockService.cancelDownload).toHaveBeenCalledWith('43');
    });

    it('preserves retry context and resets main finalization flags when main download fails', async () => {
      stubStartDownload(['42', '43']);
      const errorCbs = captureErrorCallbacks();

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      const ctx = bgContext.get('42') as any;
      ctx.mainCompleted = true;
      ctx.mainCompleteHandled = true;
      ctx.isFinalizing = true;

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onError: jest.fn(),
      });

      errorCbs['42']?.({ downloadId: '42', fileName: 'vision.gguf', modelId: 'test/model', status: 'failed', reason: 'Network error' });

      expect(bgContext.get('42')).toBe(ctx);
      expect(ctx.mainCompleted).toBe(false);
      expect(ctx.mainCompleteHandled).toBe(false);
      expect(ctx.isFinalizing).toBe(false);
      expect(ctx.mmProjDownloadId).toBe('43');
    });

    it('continues as text-only when mmproj download fails', async () => {
      stubStartDownload(['42', '43']);
      const errorCbs = captureErrorCallbacks();
      captureCompleteCallbacks();

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      const onError = jest.fn();
      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onError,
      });

      errorCbs['43']?.({ downloadId: '43', fileName: 'mmproj.gguf', modelId: 'test/model', status: 'failed', reason: 'Storage full' });

      expect(onError).not.toHaveBeenCalled();
      const ctx = bgContext.get('42') as any;
      expect(ctx.mmProjCompleted).toBe(true);
      expect(ctx.mmProjLocalPath).toBeNull();
    });
  });

  describe('watchBackgroundDownload — already-downloaded recovery', () => {
    it('persists already-downloaded models before firing onComplete', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 4_500_000_000, isFile: () => true } as any);

      const info = await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });
      const onComplete = jest.fn();

      watchBackgroundDownload({
        downloadId: info.downloadId,
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(
        '@local_llm/downloaded_models',
        expect.stringContaining('"id":"test/model/vision.gguf"'),
      );
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
        id: 'test/model/vision.gguf',
        filePath: `${MODELS_DIR}/vision.gguf`,
        mmProjPath: `${MODELS_DIR}/vision-mmproj.gguf`,
      }));
      expect(bgContext.has(info.downloadId)).toBe(false);
    });

    it('still fires onComplete when persistence fails for already-downloaded models', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      mockedRNFS.stat.mockResolvedValue({ size: 4_500_000_000, isFile: () => true } as any);
      mockedAsyncStorage.setItem.mockRejectedValueOnce(new Error('storage write failed'));

      const info = await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });
      const onComplete = jest.fn();

      watchBackgroundDownload({
        downloadId: info.downloadId,
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete,
      });

      await new Promise(resolve => setImmediate(resolve));

      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
        id: 'test/model/vision.gguf',
      }));
      expect(bgContext.has(info.downloadId)).toBe(false);
    });

    it('surfaces an already-downloaded context error via onError', () => {
      const onError = jest.fn();
      bgContext.set('already-downloaded:test/model/vision.gguf', {
        model: null,
        error: new Error('persist failed'),
      } as any);

      watchBackgroundDownload({
        downloadId: 'already-downloaded:test/model/vision.gguf',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onError,
      });

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'persist failed' }));
      expect(bgContext.has('already-downloaded:test/model/vision.gguf')).toBe(false);
    });
  });

  // ========================================================================
  // syncCompletedBackgroundDownloads — mmproj handling
  // ========================================================================

  describe('syncCompletedBackgroundDownloads', () => {
    it('syncs completed model with mmproj download', async () => {
      mockService.getActiveDownloads.mockResolvedValue([
        { downloadId: '42', status: 'completed', fileName: 'vision.gguf', modelId: 'test/model', bytesDownloaded: 4_000_000_000, totalBytes: 4_000_000_000, startedAt: 0 } as any,
        { downloadId: '43', status: 'completed', fileName: 'mmproj.gguf', modelId: 'test/model', bytesDownloaded: 500_000_000, totalBytes: 500_000_000, startedAt: 0 } as any,
      ]);
      mockService.moveCompletedDownload.mockResolvedValue(`${MODELS_DIR}/vision.gguf`);
      mockedRNFS.exists.mockResolvedValue(true);

      const clearCb = jest.fn();
      const models = await syncCompletedBackgroundDownloads({
        persistedDownloads: {
          '42': {
            modelId: 'test/model',
            fileName: 'vision.gguf',
            quantization: 'Q4_K_M',
            author: 'test',
            totalBytes: 4_500_000_000,
            mmProjFileName: 'vision-mmproj.gguf',
            mmProjLocalPath: `${MODELS_DIR}/vision-mmproj.gguf`,
            mmProjDownloadId: '43',
          },
        },
        modelsDir: MODELS_DIR,
        clearDownloadCallback: clearCb,
      });

      expect(models.length).toBe(1);
      // Should move both files
      expect(mockService.moveCompletedDownload).toHaveBeenCalledWith('42', `${MODELS_DIR}/vision.gguf`);
      expect(mockService.moveCompletedDownload).toHaveBeenCalledWith('43', `${MODELS_DIR}/vision-mmproj.gguf`);
      expect(clearCb).toHaveBeenCalledWith('42');
    });

    it('skips sync when mmproj download is still running', async () => {
      mockService.getActiveDownloads.mockResolvedValue([
        { downloadId: '42', status: 'completed', fileName: 'vision.gguf', modelId: 'test/model', bytesDownloaded: 4_000_000_000, totalBytes: 4_000_000_000, startedAt: 0 } as any,
        { downloadId: '43', status: 'running', fileName: 'mmproj.gguf', modelId: 'test/model', bytesDownloaded: 200_000_000, totalBytes: 500_000_000, startedAt: 0 } as any,
      ]);

      const clearCb = jest.fn();
      const models = await syncCompletedBackgroundDownloads({
        persistedDownloads: {
          '42': {
            modelId: 'test/model',
            fileName: 'vision.gguf',
            quantization: 'Q4_K_M',
            author: 'test',
            totalBytes: 4_500_000_000,
            mmProjDownloadId: '43',
          },
        },
        modelsDir: MODELS_DIR,
        clearDownloadCallback: clearCb,
      });

      // Should skip — mmproj still running
      expect(models.length).toBe(0);
      expect(clearCb).not.toHaveBeenCalled();
    });

    it('cancels mmproj when main download failed', async () => {
      mockService.getActiveDownloads.mockResolvedValue([
        { downloadId: '42', status: 'failed', fileName: 'vision.gguf', modelId: 'test/model', bytesDownloaded: 0, totalBytes: 4_000_000_000, startedAt: 0 } as any,
        { downloadId: '43', status: 'running', fileName: 'mmproj.gguf', modelId: 'test/model', bytesDownloaded: 200_000_000, totalBytes: 500_000_000, startedAt: 0 } as any,
      ]);

      const clearCb = jest.fn();
      await syncCompletedBackgroundDownloads({
        persistedDownloads: {
          '42': {
            modelId: 'test/model',
            fileName: 'vision.gguf',
            quantization: 'Q4_K_M',
            author: 'test',
            totalBytes: 4_500_000_000,
            mmProjDownloadId: '43',
          },
        },
        modelsDir: MODELS_DIR,
        clearDownloadCallback: clearCb,
      });

      expect(mockService.cancelDownload).toHaveBeenCalledWith('43');
      expect(clearCb).toHaveBeenCalledWith('42');
    });
  });

  // ========================================================================
  // restoreInProgressDownloads — mmproj recovery
  // ========================================================================

  describe('restoreInProgressDownloads — mmproj recovery', () => {
    it('restores both main and mmproj progress listeners', async () => {
      mockService.getActiveDownloads.mockResolvedValue([
        { downloadId: '42', status: 'running', fileName: 'vision.gguf', modelId: 'test/model', bytesDownloaded: 1_000_000_000, totalBytes: 4_000_000_000, combinedTotalBytes: 4_500_000_000, quantization: 'Q4_K_M', mmProjDownloadId: '43', startedAt: 0 } as any,
        { downloadId: '43', status: 'running', fileName: 'mmproj.gguf', modelId: 'test/model', bytesDownloaded: 100_000_000, totalBytes: 500_000_000, startedAt: 0 } as any,
      ]);

      await restoreInProgressDownloads({
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      expect(bgContext.size).toBe(1);
      const ctx = bgContext.get('42') as any;
      expect(ctx.mmProjDownloadId).toBe('43');
      expect(ctx.mmProjCompleted).toBe(false);
      expect(ctx.mainCompleted).toBe(false);
      // Progress listeners for both
      expect(mockService.onProgress).toHaveBeenCalledWith('42', expect.any(Function));
      expect(mockService.onProgress).toHaveBeenCalledWith('43', expect.any(Function));
    });

    it('handles mmproj completed while app was dead', async () => {
      mockService.getActiveDownloads.mockResolvedValue([
        { downloadId: '42', status: 'running', fileName: 'vision.gguf', modelId: 'test/model', bytesDownloaded: 2_000_000_000, totalBytes: 4_000_000_000, combinedTotalBytes: 4_500_000_000, quantization: 'Q4_K_M', mmProjDownloadId: '43', startedAt: 0 } as any,
        { downloadId: '43', status: 'completed', fileName: 'mmproj.gguf', modelId: 'test/model', bytesDownloaded: 500_000_000, totalBytes: 500_000_000, startedAt: 0 } as any,
      ]);
      mockedRNFS.exists.mockResolvedValue(true);

      await restoreInProgressDownloads({
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      const ctx = bgContext.get('42') as any;
      expect(ctx.mmProjCompleted).toBe(true);
      // File already on disk — move is deferred to watchBackgroundDownload, not called here
      expect(mockService.moveCompletedDownload).not.toHaveBeenCalled();
      // Should NOT register mmproj progress listener (already complete)
      expect(mockService.onProgress).not.toHaveBeenCalledWith('43', expect.any(Function));
    });

    it('marks mmproj as completed when it failed while app was dead', async () => {
      mockService.getActiveDownloads.mockResolvedValue([
        { downloadId: '42', status: 'running', fileName: 'vision.gguf', modelId: 'test/model', bytesDownloaded: 2_000_000_000, totalBytes: 4_000_000_000, combinedTotalBytes: 4_500_000_000, quantization: 'Q4_K_M', mmProjDownloadId: '43', startedAt: 0 } as any,
        { downloadId: '43', status: 'failed', fileName: 'mmproj.gguf', modelId: 'test/model', bytesDownloaded: 0, totalBytes: 500_000_000, startedAt: 0 } as any,
      ]);

      await restoreInProgressDownloads({
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      const ctx = bgContext.get('42') as any;
      // mmproj failed but treated as done (vision just won't work)
      expect(ctx.mmProjCompleted).toBe(true);
    });

    it('defers mmproj move to watchBackgroundDownload when file not yet on disk', async () => {
      mockService.getActiveDownloads.mockResolvedValue([
        { downloadId: '42', status: 'running', fileName: 'vision.gguf', modelId: 'test/model', bytesDownloaded: 0, totalBytes: 4_000_000_000, combinedTotalBytes: 4_500_000_000, quantization: 'Q4_K_M', mmProjDownloadId: '43', startedAt: 0 } as any,
        { downloadId: '43', status: 'completed', fileName: 'mmproj.gguf', modelId: 'test/model', bytesDownloaded: 500_000_000, totalBytes: 500_000_000, startedAt: 0 } as any,
      ]);
      // File not yet on disk — watchBackgroundDownload must do the move
      mockedRNFS.exists.mockResolvedValue(false);

      await restoreInProgressDownloads({
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      const ctx = bgContext.get('42') as any;
      // mmProjCompleted=false so watchBackgroundDownload registers the onComplete listener
      expect(ctx.mmProjCompleted).toBe(false);
      expect(mockService.moveCompletedDownload).not.toHaveBeenCalled();
      // Progress listener NOT registered (mmproj is already at completed status, no bytes left)
      // but onComplete listener WILL be registered by watchBackgroundDownload
    });

    it('does not create duplicate context for mmproj download ID', async () => {
      mockService.getActiveDownloads.mockResolvedValue([
        { downloadId: '42', status: 'running', fileName: 'vision.gguf', modelId: 'test/model', bytesDownloaded: 0, totalBytes: 4_000_000_000, combinedTotalBytes: 4_500_000_000, quantization: 'Q4_K_M', mmProjDownloadId: '43', startedAt: 0 } as any,
        { downloadId: '43', status: 'running', fileName: 'mmproj.gguf', modelId: 'test/model', bytesDownloaded: 0, totalBytes: 500_000_000, startedAt: 0 } as any,
      ]);

      await restoreInProgressDownloads({
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      // Only the main download ID should be in the context, not the mmproj
      expect(bgContext.size).toBe(1);
      expect(bgContext.has('42')).toBe(true);
      expect(bgContext.has('43')).toBe(false);
    });
  });

  describe('watchBackgroundDownload — catch-up paths', () => {
    it('finalizes after mmproj was already completed before listener registration', async () => {
      stubStartDownload(['42', '43']);
      const completeCbs = captureCompleteCallbacks();
      mockService.getActiveDownloads.mockResolvedValue([
        { downloadId: '43', status: 'completed' } as any,
      ]);
      mockService.moveCompletedDownload
        .mockResolvedValueOnce(`${MODELS_DIR}/vision-mmproj.gguf`)
        .mockResolvedValueOnce(`${MODELS_DIR}/vision.gguf`);
      mockedRNFS.exists
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      const onComplete = jest.fn();

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete,
      });

      await new Promise(resolve => setImmediate(resolve));
      await completeCbs['42']?.({ downloadId: '42', fileName: 'vision.gguf' });
      await new Promise(resolve => setImmediate(resolve));

      expect(mockService.moveCompletedDownload).toHaveBeenCalledWith('43', `${MODELS_DIR}/vision-mmproj.gguf`);
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
        mmProjPath: `${MODELS_DIR}/vision-mmproj.gguf`,
        isVisionModel: true,
      }));
    });

    it('continues without vision when catch-up mmproj move fails and target is missing', async () => {
      stubStartDownload(['42', '43']);
      const completeCbs = captureCompleteCallbacks();
      mockService.getActiveDownloads.mockResolvedValue([
        { downloadId: '43', status: 'completed' } as any,
      ]);
      mockService.moveCompletedDownload
        .mockRejectedValueOnce(new Error('catch-up move failed'))
        .mockResolvedValueOnce(`${MODELS_DIR}/vision.gguf`);
      mockedRNFS.exists.mockResolvedValue(false);
      const onComplete = jest.fn();

      await performBackgroundDownload({
        modelId: 'test/model',
        file: visionFile(),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete,
      });

      await new Promise(resolve => setImmediate(resolve));
      await completeCbs['42']?.({ downloadId: '42', fileName: 'vision.gguf' });
      await new Promise(resolve => setImmediate(resolve));

      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
        mmProjPath: undefined,
        mmProjFileName: 'mmproj.gguf',
      }));
    });

    it('finalizes a non-vision main that completed before listener registration (main catch-up, no live event)', async () => {
      // Under the 3-concurrent cap, the main GGUF can finish in native before
      // watchBackgroundDownload subscribes (listener setup delayed behind an
      // awaited-queued start). The DownloadComplete event fires once with no
      // subscriber and is lost. The reconcile must query native and drive
      // handleMainComplete itself — WITHOUT any manually-fired complete event.
      stubStartDownload(['42']);
      captureCompleteCallbacks();
      const onComplete = jest.fn();

      // exists=false during the start so it actually queues a download (ctx under '42'),
      // not the already-on-disk path.
      await performBackgroundDownload({
        modelId: 'test/model',
        file: createModelFile({ name: 'model.gguf', size: 4_000_000_000 }),
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
      });

      // Native already reports the main as completed before we subscribe.
      mockService.getActiveDownloads.mockResolvedValue([
        { downloadId: '42', status: 'completed' } as any,
      ]);
      mockService.moveCompletedDownload.mockResolvedValue(`${MODELS_DIR}/model.gguf`);
      mockedRNFS.exists.mockResolvedValue(true);

      watchBackgroundDownload({
        downloadId: '42',
        modelsDir: MODELS_DIR,
        backgroundDownloadContext: bgContext,
        backgroundDownloadMetadataCallback: metadataCallback,
        onComplete,
      });

      // No completeCbs['42'] call — the reconcile alone must finalize.
      // The reconcile is fire-and-forget; drain the microtask/macrotask chain.
      for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));

      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });
});
