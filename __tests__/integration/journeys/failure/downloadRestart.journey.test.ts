/**
 * FAILURE JOURNEY — a download that drops network near completion, then retries.
 *
 * Cluster D. Drives the REAL downloadStore + REAL imageProvider.retry through a
 * network drop at ~99% and a subsequent retry. The native boundary
 * (backgroundDownloadService) is the ONLY thing faked, and it returns DIFFERENT
 * values across the retry (a static mock could not catch an ordering bug):
 *   - first retryDownload REJECTS ("Download not found" — the extraction-failed /
 *     completed-then-failed case where the native row is gone)
 *   - the injected full re-download path then runs (Android provider falls back to
 *     imageOps.retry when the native resume throws).
 *
 * Terminal artifacts asserted (not "was called"):
 *   - the store entry is RECOVERABLE across the failure: the SAME logical modelKey
 *     survives, progress is reset to 0, status is back to an active state, and the
 *     stale error is cleared (retryEntry contract).
 *   - progress never exceeds 1 even when the last tick lands at 99% then jumps.
 */
import { Platform } from 'react-native';
import { useDownloadStore } from '../../../../src/stores/downloadStore';
import { makeImageModelKey } from '../../../../src/utils/modelKey';

// Force Android so imageProvider.retry takes the native-resume-then-fallback path.
Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });

const mockBackground = {
  retryDownload: jest.fn(),
  startProgressPolling: jest.fn(),
  cancelDownload: jest.fn(async () => {}),
};
jest.mock('../../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: mockBackground,
}));

const mockActiveModelService = { unloadImageModel: jest.fn(async () => {}) };
const mockModelManager = { deleteImageModel: jest.fn(async () => {}) };
jest.mock('../../../../src/services/activeModelService', () => ({
  activeModelService: mockActiveModelService,
}));
jest.mock('../../../../src/services/modelManager', () => ({
  modelManager: mockModelManager,
}));

const { imageProvider, setImageDownloadOps } = require('../../../../src/services/modelDownloadService/providers/imageProvider');
const { uniformDownloadId } = require('../../../../src/services/modelDownloadService/uniformId');

const MODEL_ID = 'anythingv5_npu_min';
const KEY = makeImageModelKey(MODEL_ID);

function seedInflightEntry(downloadId: string) {
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {}, repairingVisionIds: {} } as any);
  useDownloadStore.getState().add({
    modelKey: KEY,
    downloadId,
    modelId: `image:${MODEL_ID}`,
    fileName: 'anythingv5_npu_min.zip',
    quantization: '',
    modelType: 'image',
    status: 'running',
    bytesDownloaded: 990_000_000,
    totalBytes: 1_000_000_000,
    combinedTotalBytes: 1_000_000_000,
    progress: 0.99,
    createdAt: 1,
    metadataJson: JSON.stringify({ imageDownloadType: 'zip', imageModelBackend: 'qnn', imageModelName: 'AnythingV5' }),
  });
}

describe('failure journey — download drops at 99% then retries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setImageDownloadOps({});
  });

  it('progress bar never exceeds 1 when a late tick overshoots the total', () => {
    seedInflightEntry('dl-1');
    // A late progress event reports MORE bytes than the total (a real overshoot
    // seen when combinedTotal is stale). The store must clamp to 1, not show 137%.
    useDownloadStore.getState().updateProgress('dl-1', 1_370_000_000, 1_000_000_000);
    const entry = useDownloadStore.getState().downloads[KEY];
    expect(entry.progress).toBe(1);
    expect(entry.progress).toBeLessThanOrEqual(1);
  });

  it('network drop then the failure event leaves a RETRIABLE store entry (not wiped)', () => {
    seedInflightEntry('dl-1');
    // The transfer failed at 99% — a real terminal failure event from native.
    useDownloadStore.getState().setStatus('dl-1', 'failed', { message: 'connection dropped', code: 'NETWORK' });

    const entry = useDownloadStore.getState().downloads[KEY];
    // Terminal artifact: the entry SURVIVES (product rule: a failed entry persists
    // until explicit user action) and carries the error so the card offers retry.
    expect(entry).toBeDefined();
    expect(entry.status).toBe('failed');
    expect(entry.errorMessage).toBe('connection dropped');

    // And the uniform list surfaces it as retriable + removable (the affordance).
    // (list() reads the store; imageProvider list is async.)
    return imageProvider.list().then((rows: any[]) => {
      const row = rows.find(r => r.id === uniformDownloadId('image', `image:${MODEL_ID}`));
      expect(row).toBeDefined();
      expect(row.capabilities.retry).toBe(true);
      expect(row.capabilities.remove).toBe(true);
      expect(row.status).not.toBe('completed');
    });
  });

  it('retry: native resume THROWS (row gone), falls back to full re-download — same logical entry survives', async () => {
    seedInflightEntry('dl-1');
    useDownloadStore.getState().setStatus('dl-1', 'failed', { message: 'connection dropped' });

    // DYNAMIC boundary: the native retry fails the FIRST time (row gone after a
    // completed-then-dropped transfer), so the provider must fall back to the
    // injected full re-download. A static "resolve" mock would hide this branch.
    mockBackground.retryDownload.mockRejectedValueOnce(new Error('Download not found'));

    let fallbackRan = false;
    setImageDownloadOps({
      retry: async (_modelId: string, entry: any) => {
        fallbackRan = true;
        // The full re-download path re-issues under the same modelKey (retryEntry).
        useDownloadStore.getState().retryEntry(entry.modelKey, 'dl-2-fresh');
      },
    });

    await imageProvider.retry(uniformDownloadId('image', `image:${MODEL_ID}`));

    expect(fallbackRan).toBe(true);
    const entry = useDownloadStore.getState().downloads[KEY];
    // Terminal artifact: recovered under the SAME logical key, fresh downloadId,
    // progress reset to a clean slate, stale error cleared.
    expect(entry).toBeDefined();
    expect(entry.downloadId).toBe('dl-2-fresh');
    expect(entry.status).toBe('pending');
    expect(entry.bytesDownloaded).toBe(0);
    expect(entry.progress).toBe(0);
    expect(entry.errorMessage).toBeUndefined();
    // The downloadIdIndex must point the NEW id at the key and drop the old id.
    expect(useDownloadStore.getState().downloadIdIndex['dl-2-fresh']).toBe(KEY);
    expect(useDownloadStore.getState().downloadIdIndex['dl-1']).toBeUndefined();
  });

  it('retry: native resume SUCCEEDS (row alive, resumes in place) — no re-download fallback', async () => {
    seedInflightEntry('dl-1');
    useDownloadStore.getState().setStatus('dl-1', 'failed', { message: 'connection dropped' });

    // This time the native row is still alive → resumes in place, no fallback.
    mockBackground.retryDownload.mockResolvedValueOnce(undefined);
    let fallbackRan = false;
    setImageDownloadOps({ retry: async () => { fallbackRan = true; } });

    await imageProvider.retry(uniformDownloadId('image', `image:${MODEL_ID}`));

    expect(fallbackRan).toBe(false);
    const entry = useDownloadStore.getState().downloads[KEY];
    // In-place resume marks the SAME downloadId pending (native continues the bytes).
    expect(entry.downloadId).toBe('dl-1');
    expect(entry.status).toBe('pending');
    expect(mockBackground.startProgressPolling).toHaveBeenCalled();
  });
});
