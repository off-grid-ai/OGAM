/**
 * Text download provider — wraps modelManager + downloadStore + appStore under the
 * uniform contract. Verifies list (in-flight + completed), cancel/remove delegate to
 * the working calls, and reconcile RE-QUEUES an interrupted iOS download (resumable
 * false) through the normal start path instead of leaving it failed. (Jest's RN
 * preset reports Platform.OS='ios'.)
 */
jest.mock('../../../src/services/modelManager', () => ({
  modelManager: {
    getDownloadedModels: jest.fn(async () => []),
    cancelBackgroundDownload: jest.fn(async () => {}),
    deleteModel: jest.fn(async () => {}),
    downloadModelBackground: jest.fn(async () => ({ downloadId: 'new-dl' })),
    watchDownload: jest.fn(),
    resetMmProjForRetry: jest.fn(),
  },
}));
jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: { retryDownload: jest.fn(async () => {}), startProgressPolling: jest.fn(), cancelDownload: jest.fn(async () => {}) },
}));
jest.mock('../../../src/services/huggingFace', () => ({ huggingFaceService: { getDownloadUrl: jest.fn(() => 'https://x/f.gguf') } }));
jest.mock('../../../src/services/hardware', () => ({ hardwareService: { getModelTotalSize: jest.fn(() => 4000) } }));
jest.mock('../../../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { Platform } from 'react-native';
import { textProvider } from '../../../src/services/modelDownloadService/providers/textProvider';
import { useDownloadStore } from '../../../src/stores/downloadStore';
import { useAppStore } from '../../../src/stores';
import { modelManager } from '../../../src/services/modelManager';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';

const mockMM = modelManager as unknown as { deleteModel: jest.Mock; cancelBackgroundDownload: jest.Mock; resetMmProjForRetry: jest.Mock; watchDownload: jest.Mock; downloadModelBackground: jest.Mock };
const mockBG = backgroundDownloadService as unknown as { retryDownload: jest.Mock };

const entry = (over: any = {}) => ({
  modelKey: 'author/m.gguf', downloadId: 'dl-1', modelId: 'author/m', fileName: 'm.gguf',
  quantization: 'Q4', modelType: 'text', status: 'running', bytesDownloaded: 40, totalBytes: 100,
  combinedTotalBytes: 100, progress: 0.4, createdAt: 1, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
  useAppStore.setState({ downloadedModels: [] } as any);
  useDownloadStore.getState().add(entry());
});

describe('textProvider', () => {
  // Canonical text id = text:<modelKey> (modelKey = repo/file), the SAME id the finished
  // model carries — so an in-flight row and its completed model resolve to one id.
  it('lists an in-flight text download as downloading (keyed by modelKey)', async () => {
    const d = (await textProvider.list()).find(x => x.id === 'text:author/m.gguf');
    expect(d?.status).toBe('downloading');
    expect(d?.progress).toBe(0.4);
  });

  it('lists completed appStore models, skipping in-flight ones (same modelKey id → deduped)', async () => {
    useAppStore.setState({ downloadedModels: [
      { id: 'author/m.gguf', fileName: 'm.gguf', filePath: '/p' },   // dup of in-flight (model.id IS the modelKey)
      { id: 'other/x.gguf', fileName: 'x.gguf', filePath: '/p2' },
    ] } as any);
    const list = await textProvider.list();
    // Exactly ONE entry for author/m — the in-flight row and the completed model share
    // the canonical text:author/m.gguf id, so the dedup collapses them. Pre-fix the
    // in-flight row was text:author/m (bare repo) and this returned TWO entries for one model.
    expect(list.filter(d => d.id.startsWith('text:author/m'))).toHaveLength(1);
    expect(list.find(d => d.id === 'text:other/x.gguf')?.status).toBe('completed');
  });

  it('cancel cancels the native download and clears the store row', async () => {
    await textProvider.cancel('text:author/m.gguf');
    expect(mockMM.cancelBackgroundDownload).toHaveBeenCalledWith('dl-1');
    expect(useDownloadStore.getState().downloads['author/m.gguf']).toBeUndefined();
  });

  it('remove deletes the model from modelManager + appStore by its modelKey id', async () => {
    const removeSpy = jest.spyOn(useAppStore.getState(), 'removeDownloadedModel');
    await textProvider.remove('text:author/m.gguf');
    expect(mockMM.deleteModel).toHaveBeenCalledWith('author/m.gguf');
    expect(removeSpy).toHaveBeenCalledWith('author/m.gguf');
  });

  it('reconcile re-queues an interrupted iOS download (pending, re-issued) instead of failing it', async () => {
    await textProvider.reconcile!();
    // Marked 'pending' (→ 'queued' in service vocabulary), NOT 'failed'.
    expect(useDownloadStore.getState().downloads['author/m.gguf'].status).toBe('pending');
    // Re-issued through the normal start path (modelManager → backgroundDownloadService
    // → the 3-slot cap), fire-and-forget so launch isn't blocked behind the cap.
    await new Promise((r) => setImmediate(r));
    expect(mockMM.downloadModelBackground).toHaveBeenCalledWith(
      'author/m',
      expect.objectContaining({ name: 'm.gguf' }),
    );
  });

  it('reconcile drops a stale in-flight row when the model is already downloaded (never 2 guys)', async () => {
    // Model is registered as completed AND has a leftover interrupted row.
    useAppStore.setState({ downloadedModels: [{ id: 'author/m.gguf', fileName: 'm.gguf', filePath: '/p' }] } as any);
    await textProvider.reconcile!();
    await new Promise((r) => setImmediate(r));
    // Stale row removed; no re-download of an already-downloaded model.
    expect(useDownloadStore.getState().downloads['author/m.gguf']).toBeUndefined();
    expect(mockMM.downloadModelBackground).not.toHaveBeenCalled();
  });

  // The Android retry MECHANISM that used to live in the Download Manager screen test.
  // It now belongs to the provider (the View only dispatches retry(id)); this guards it.
  describe('retry on Android (in-place WorkManager resume + mmproj reset + reattach)', () => {
    const originalOs = Platform.OS;
    beforeEach(() => {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
      useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
      useDownloadStore.getState().add(entry({
        status: 'failed', mmProjDownloadId: 'dl-mmproj', mmProjStatus: 'failed',
      }));
    });
    afterEach(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOs }));

    it('resets both rows to pending, retries native main + mmproj, resets mmproj, reattaches', async () => {
      await textProvider.retry('text:author/m.gguf');
      // main + mmproj native retried (Android resumes the existing rows in place)
      expect(mockBG.retryDownload).toHaveBeenNthCalledWith(1, 'dl-1');
      expect(mockBG.retryDownload).toHaveBeenNthCalledWith(2, 'dl-mmproj');
      expect(mockMM.resetMmProjForRetry).toHaveBeenCalledWith('dl-1');
      // reattaches the watcher on the main download
      expect(mockMM.watchDownload).toHaveBeenCalledWith('dl-1', expect.any(Function), expect.any(Function));
      // does NOT take the iOS fresh-download path
      expect(mockMM.downloadModelBackground).not.toHaveBeenCalled();
    });
  });
});
