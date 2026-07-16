import AsyncStorage from '@react-native-async-storage/async-storage';
import { hydrateDownloadStore, isMmProjFileName } from '../../../src/services/downloadHydration';
import { saveActiveDownloads } from '../../../src/services/activeDownloadPersistence';
import { useDownloadStore } from '../../../src/stores/downloadStore';

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: jest.fn(),
    getActiveDownloads: jest.fn(),
  },
}));

const { backgroundDownloadService } = jest.requireMock('../../../src/services/backgroundDownloadService');

beforeEach(async () => {
  jest.clearAllMocks();
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} });
  await AsyncStorage.clear(); // reset the persisted in-flight snapshot between tests
});

describe('isMmProjFileName', () => {
  it('returns true for mmproj filenames', () => {
    expect(isMmProjFileName('llava-v1.5-mmproj.gguf')).toBe(true);
    expect(isMmProjFileName('model-mmproj.gguf')).toBe(true);
  });

  it('returns false for regular filenames', () => {
    expect(isMmProjFileName('model-Q4_K_M.gguf')).toBe(false);
    expect(isMmProjFileName('plain-model.gguf')).toBe(false);
  });
});

describe('hydrateDownloadStore', () => {
  it('does nothing when service is unavailable', async () => {
    backgroundDownloadService.isAvailable.mockReturnValue(false);
    await hydrateDownloadStore();
    expect(backgroundDownloadService.getActiveDownloads).not.toHaveBeenCalled();
  });

  it('hydrates store with active text downloads', async () => {
    backgroundDownloadService.isAvailable.mockReturnValue(true);
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      {
        downloadId: 'dl-1',
        modelId: 'author/model',
        modelKey: 'author/model/model.gguf',
        fileName: 'model.gguf',
        quantization: 'Q4_K_M',
        modelType: 'text',
        status: 'running',
        bytesDownloaded: 500,
        totalBytes: 1000,
        combinedTotalBytes: 1000,
        createdAt: 1000,
      },
    ]);

    await hydrateDownloadStore();

    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry).toBeDefined();
    expect(entry.status).toBe('running');
    expect(entry.bytesDownloaded).toBe(500);
    expect(entry.progress).toBe(0.5);
  });

  it('skips mmproj rows (they appear as child of parent)', async () => {
    backgroundDownloadService.isAvailable.mockReturnValue(true);
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      {
        downloadId: 'dl-parent',
        modelId: 'author/model',
        fileName: 'model.gguf',
        status: 'running',
        bytesDownloaded: 200,
        totalBytes: 1000,
        combinedTotalBytes: 1500,
        mmProjDownloadId: 'dl-mm',
        createdAt: 1000,
      },
      {
        downloadId: 'dl-mm',
        modelId: 'author/model',
        fileName: 'model-mmproj.gguf',
        status: 'running',
        bytesDownloaded: 100,
        totalBytes: 500,
        createdAt: 900,
      },
    ]);

    await hydrateDownloadStore();

    const state = useDownloadStore.getState();
    const keys = Object.keys(state.downloads);
    expect(keys.length).toBe(1);
    const entry = state.downloads[keys[0]];
    expect(entry.mmProjDownloadId).toBe('dl-mm');
    expect(entry.mmProjBytesDownloaded).toBe(100);
  });

  it('skips cancelled and completed downloads', async () => {
    backgroundDownloadService.isAvailable.mockReturnValue(true);
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      {
        downloadId: 'dl-done',
        modelId: 'a/b',
        fileName: 'b.gguf',
        status: 'completed',
        bytesDownloaded: 1000,
        totalBytes: 1000,
        createdAt: 1000,
      },
      {
        downloadId: 'dl-cancel',
        modelId: 'a/c',
        fileName: 'c.gguf',
        status: 'cancelled',
        bytesDownloaded: 0,
        totalBytes: 500,
        createdAt: 1000,
      },
    ]);

    await hydrateDownloadStore();
    expect(Object.keys(useDownloadStore.getState().downloads).length).toBe(0);
  });

  it('keeps latest entry when duplicate keys exist', async () => {
    backgroundDownloadService.isAvailable.mockReturnValue(true);
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      {
        downloadId: 'dl-old',
        modelId: 'author/model',
        modelKey: 'author/model/model.gguf',
        fileName: 'model.gguf',
        status: 'failed',
        bytesDownloaded: 100,
        totalBytes: 1000,
        createdAt: 500,
      },
      {
        downloadId: 'dl-new',
        modelId: 'author/model',
        modelKey: 'author/model/model.gguf',
        fileName: 'model.gguf',
        status: 'running',
        bytesDownloaded: 300,
        totalBytes: 1000,
        createdAt: 1500,
      },
    ]);

    await hydrateDownloadStore();
    const entry = useDownloadStore.getState().downloads['author/model/model.gguf'];
    expect(entry.downloadId).toBe('dl-new');
  });

  // Cold app-kill recovery: an in-flight download persisted to the durable snapshot must be carried
  // forward as a failed/retriable card — NOT vanish — when its native row is gone on relaunch (iOS
  // URLSession drops the task on force-quit). device 2026-07-15.
  const inflight = {
    downloadId: 'dl-inflight',
    modelId: 'author/big-model',
    modelKey: 'author/big-model/model.gguf',
    fileName: 'model.gguf',
    quantization: 'Q4_K_M',
    modelType: 'text' as const,
    status: 'running' as const,
    bytesDownloaded: 1_100_000_000,
    totalBytes: 5_500_000_000,
    combinedTotalBytes: 5_500_000_000,
    progress: 0.2,
    createdAt: 1000,
  };

  it('strands a persisted in-flight download as failed when the native row is gone (cold app-kill)', async () => {
    // Cold kill: in-memory store empty (beforeEach), native snapshot empty (task dropped), but the
    // in-flight download survives in the durable snapshot loadActiveDownloads() reads.
    await saveActiveDownloads([inflight]);
    backgroundDownloadService.isAvailable.mockReturnValue(true);
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([]);

    await hydrateDownloadStore();

    const entry = useDownloadStore.getState().downloads['author/big-model/model.gguf'];
    expect(entry).toBeDefined();               // did NOT vanish
    expect(entry.status).toBe('failed');       // stranded as retriable
    expect(entry.errorMessage).toMatch(/Interrupted/);
  });

  it('does NOT strand when the native snapshot still reports the row (Android survives a kill)', async () => {
    // Android WorkManager survives a kill → the row reappears in the native snapshot → the persisted
    // snapshot must be ignored for that key, never flip a live download to a false "failed".
    await saveActiveDownloads([inflight]);
    backgroundDownloadService.isAvailable.mockReturnValue(true);
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([{ ...inflight, bytesDownloaded: 2_000_000_000 }]);

    await hydrateDownloadStore();

    const entry = useDownloadStore.getState().downloads['author/big-model/model.gguf'];
    expect(entry.status).toBe('running');      // live native row wins — no false strand (no Android regression)
  });
});
