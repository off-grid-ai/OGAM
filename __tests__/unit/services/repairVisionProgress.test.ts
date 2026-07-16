/**
 * Repair-Vision Progress Tests
 *
 * BUG OD2: the "Repair Vision" action re-downloads a model's missing mmproj
 * (~900MB) but showed only an indeterminate spinner. It must drive the SAME
 * determinate-progress store the normal download uses, so the existing
 * progress-bar UI (ActiveDownloadCard) lights up.
 *
 * These tests drive the REAL useDownloadStore and assert the store entry's
 * `progress` advances incrementally (0 -> mid -> complete), mocking only the
 * boundaries (backgroundDownloadService + RNFS). The onProgress callback is
 * captured DYNAMICALLY so we can fire per-byte events and prove the store
 * updates between them, not just a terminal done.
 */

import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';
import { useDownloadStore } from '../../../src/stores/downloadStore';
import { createModelFileWithMmProj } from '../../utils/factories';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: jest.fn(() => true),
    startDownload: jest.fn(),
    cancelDownload: jest.fn(() => Promise.resolve()),
    moveCompletedDownload: jest.fn(),
    startProgressPolling: jest.fn(),
    stopProgressPolling: jest.fn(),
    onProgress: jest.fn(() => jest.fn()),
    onComplete: jest.fn(() => jest.fn()),
    onError: jest.fn(() => jest.fn()),
    excludeFromBackup: jest.fn(() => Promise.resolve(true)),
  },
}));

const mockService = backgroundDownloadService as jest.Mocked<
  typeof backgroundDownloadService
>;

// DYNAMIC mocks: capture the callbacks the service hands back so the test can
// fire progress/complete events on demand and observe the store react between them.
function captureCallbacks() {
  const progress: Record<string, (e: any) => void> = {};
  const complete: Record<string, (e: any) => Promise<void> | void> = {};
  const error: Record<string, (e: any) => void> = {};
  mockService.onProgress.mockImplementation((id: string, cb: any) => {
    progress[id] = cb;
    return jest.fn();
  });
  mockService.onComplete.mockImplementation((id: string, cb: any) => {
    complete[id] = cb;
    return jest.fn();
  });
  mockService.onError.mockImplementation((id: string, cb: any) => {
    error[id] = cb;
    return jest.fn();
  });
  return { progress, complete, error };
}

const REPO = 'test/model';
const MODEL_NAME = 'vision-Q4_K_M.gguf';
const MMPROJ_SIZE = 900_000_000; // ~900MB, the OD2 case

function visionFile() {
  return createModelFileWithMmProj({
    name: MODEL_NAME,
    size: 4_000_000_000,
    quantization: 'Q4_K_M',
    mmProjName: 'mmproj-model-f16.gguf',
    mmProjSize: MMPROJ_SIZE,
    mmProjDownloadUrl:
      'https://huggingface.co/test/model/resolve/main/mmproj-model-f16.gguf',
  });
}

describe('repairMmProj — determinate progress (BUG OD2)', () => {
  // The modelKey the completed model carries and the store keys on.
  const MODEL_KEY = `${REPO}/${MODEL_NAME}`;

  beforeEach(() => {
    jest.clearAllMocks();
    // Fresh store between tests.
    useDownloadStore.setState({
      downloads: {},
      downloadIdIndex: {},
      repairingVisionIds: {},
    });

    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.stat.mockResolvedValue({ size: MMPROJ_SIZE } as any);
    mockedRNFS.unlink.mockResolvedValue(undefined as any);
    mockedAsyncStorage.getItem.mockResolvedValue(
      JSON.stringify([
        { id: MODEL_KEY, engine: 'llama', fileName: MODEL_NAME },
      ]),
    );
    mockedAsyncStorage.setItem.mockResolvedValue(undefined as any);

    mockService.startDownload.mockResolvedValue({
      downloadId: 'repair-1',
      fileName: 'mmproj-model-f16.gguf',
      modelId: REPO,
      status: 'pending',
      bytesDownloaded: 0,
      totalBytes: MMPROJ_SIZE,
      startedAt: Date.now(),
    } as any);
    mockService.moveCompletedDownload.mockResolvedValue(
      `/models/${MODEL_NAME.replace('.gguf', '')}-mmproj-model-f16.gguf`,
    );
  });

  it('drives the download store incrementally (0 -> mid -> complete), not just a terminal done', async () => {
    const cbs = captureCallbacks();
    const { modelManager } = require('../../../src/services/modelManager');

    const repairPromise = modelManager.repairMmProj(REPO, visionFile(), {});

    // Give startDownload + listener registration a tick.
    await new Promise(r => setImmediate(r));

    // The store must now hold an active entry for this model so the UI's
    // ActiveDownloadCard progress bar can render.
    const started = useDownloadStore.getState().downloads[MODEL_KEY];
    expect(started).toBeDefined();
    expect(started.progress).toBe(0);

    // Fire a MID progress event over the boundary.
    cbs.progress['repair-1']?.({
      downloadId: 'repair-1',
      bytesDownloaded: MMPROJ_SIZE / 2,
      totalBytes: MMPROJ_SIZE,
      status: 'running',
      fileName: 'mmproj-model-f16.gguf',
      modelId: REPO,
    });
    const mid = useDownloadStore.getState().downloads[MODEL_KEY];
    expect(mid.progress).toBeCloseTo(0.5, 2);

    // Fire a near-complete progress event.
    cbs.progress['repair-1']?.({
      downloadId: 'repair-1',
      bytesDownloaded: MMPROJ_SIZE * 0.9,
      totalBytes: MMPROJ_SIZE,
      status: 'running',
      fileName: 'mmproj-model-f16.gguf',
      modelId: REPO,
    });
    expect(
      useDownloadStore.getState().downloads[MODEL_KEY].progress,
    ).toBeCloseTo(0.9, 2);

    // Completion.
    mockedRNFS.exists.mockResolvedValue(true);
    await cbs.complete['repair-1']?.({
      downloadId: 'repair-1',
      fileName: 'mmproj-model-f16.gguf',
    });
    await repairPromise;
  });

  it('reports failure through the store when the download errors', async () => {
    const cbs = captureCallbacks();
    const { modelManager } = require('../../../src/services/modelManager');

    const repairPromise = modelManager.repairMmProj(REPO, visionFile(), {});
    await new Promise(r => setImmediate(r));

    expect(useDownloadStore.getState().downloads[MODEL_KEY]).toBeDefined();

    cbs.error['repair-1']?.({
      downloadId: 'repair-1',
      reason: 'Network error',
    });

    await expect(repairPromise).rejects.toThrow('Network error');
  });
});
