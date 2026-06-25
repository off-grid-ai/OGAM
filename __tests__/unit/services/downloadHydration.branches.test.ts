/**
 * Branch-coverage tests for downloadHydration.ts.
 * Targets the mapNativeStatus switch arms (retrying/waiting_for_network/default),
 * the image-completed -> 'processing' branch, computeProgress denom fallbacks,
 * and the per-row try/catch that logs and continues on a malformed row.
 */

import { hydrateDownloadStore } from '../../../src/services/downloadHydration';
import { useDownloadStore } from '../../../src/stores/downloadStore';

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    isAvailable: jest.fn(),
    getActiveDownloads: jest.fn(),
  },
}));
jest.mock('../../../src/utils/modelKey', () => ({
  makeModelKey: jest.fn((id: string, fn: string) => `${id}::${fn}`),
}));
jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { backgroundDownloadService } = jest.requireMock('../../../src/services/backgroundDownloadService');
import logger from '../../../src/utils/logger';

beforeEach(() => {
  jest.clearAllMocks();
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} });
  backgroundDownloadService.isAvailable.mockReturnValue(true);
});

describe('mapNativeStatus arms', () => {
  it("maps 'retrying' to 'failed'", async () => {
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      { downloadId: 'r', modelId: 'a/b', fileName: 'b.gguf', status: 'retrying', bytesDownloaded: 1, totalBytes: 10, createdAt: 1 },
    ]);
    await hydrateDownloadStore();
    const entry = Object.values(useDownloadStore.getState().downloads)[0];
    expect(entry.status).toBe('failed');
  });

  it("maps 'waiting_for_network' through unchanged", async () => {
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      { downloadId: 'w', modelId: 'a/b', fileName: 'b.gguf', status: 'waiting_for_network', bytesDownloaded: 0, totalBytes: 10, createdAt: 1 },
    ]);
    await hydrateDownloadStore();
    const entry = Object.values(useDownloadStore.getState().downloads)[0];
    expect(entry.status).toBe('waiting_for_network');
  });

  it('maps an unknown native status to the default "pending"', async () => {
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      { downloadId: 'p', modelId: 'a/b', fileName: 'b.gguf', status: 'bogus' as any, bytesDownloaded: 0, totalBytes: 10, createdAt: 1 },
    ]);
    await hydrateDownloadStore();
    const entry = Object.values(useDownloadStore.getState().downloads)[0];
    expect(entry.status).toBe('pending');
  });
});

describe('image-completed surfaces as processing', () => {
  it("turns a completed image row (modelType image) into 'processing'", async () => {
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      { downloadId: 'img', modelId: 'image:foo', modelType: 'image', fileName: 'foo.zip', status: 'completed', bytesDownloaded: 100, totalBytes: 100, createdAt: 1 },
    ]);
    await hydrateDownloadStore();
    const entry = Object.values(useDownloadStore.getState().downloads)[0];
    expect(entry.status).toBe('processing');
    expect(entry.modelType).toBe('image');
  });

  it("detects an image row via modelId 'image:' prefix even without modelType", async () => {
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      { downloadId: 'img2', modelId: 'image:bar', fileName: 'bar.zip', status: 'completed', bytesDownloaded: 50, totalBytes: 100, createdAt: 1 },
    ]);
    await hydrateDownloadStore();
    const entry = Object.values(useDownloadStore.getState().downloads)[0];
    expect(entry.status).toBe('processing');
  });
});

describe('computeProgress and field fallbacks', () => {
  it('returns 0 progress when denominator is 0', async () => {
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      { downloadId: 'z', modelId: 'a/b', fileName: 'b.gguf', status: 'running', bytesDownloaded: 0, totalBytes: 0, combinedTotalBytes: 0, createdAt: 1 },
    ]);
    await hydrateDownloadStore();
    const entry = Object.values(useDownloadStore.getState().downloads)[0];
    expect(entry.progress).toBe(0);
  });

  it('uses combinedTotalBytes over totalBytes and applies ?? fallbacks for missing fields', async () => {
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      { downloadId: 'c', modelKey: 'k', fileName: 'b.gguf', status: 'running', totalBytes: 200, combinedTotalBytes: 400, createdAt: 1 },
    ]);
    await hydrateDownloadStore();
    const entry = useDownloadStore.getState().downloads.k;
    expect(entry.modelId).toBe('');
    expect(entry.quantization).toBe('Unknown');
    expect(entry.modelType).toBe('text');
    expect(entry.bytesDownloaded).toBe(0);
    expect(entry.combinedTotalBytes).toBe(400);
    expect(entry.createdAt).toBe(1);
  });

  it('resolves mmProj bytes/status onto the parent entry', async () => {
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([
      { downloadId: 'par', modelId: 'a/b', fileName: 'b.gguf', status: 'running', bytesDownloaded: 300, totalBytes: 1000, combinedTotalBytes: 1500, mmProjDownloadId: 'mm', createdAt: 1 },
      { downloadId: 'mm', modelId: 'a/b', fileName: 'b-mmproj.gguf', status: 'completed', bytesDownloaded: 200, totalBytes: 500, createdAt: 1 },
    ]);
    await hydrateDownloadStore();
    const entry = Object.values(useDownloadStore.getState().downloads)[0];
    expect(entry.mmProjDownloadId).toBe('mm');
    expect(entry.mmProjBytesDownloaded).toBe(200);
    expect(entry.mmProjStatus).toBe('completed');
    // progress uses combined denom: (300 + 200) / 1500
    expect(entry.progress).toBeCloseTo(500 / 1500);
  });
});

describe('malformed row try/catch', () => {
  it('logs and skips a row whose toDownloadEntry throws, keeping good rows', async () => {
    // Force toDownloadEntry to throw on the bad row by making fileName access throw.
    // quantization is read inside toDownloadEntry (which is wrapped in try/catch)
    // but NOT in getParentRows/getLatestRowsByKey, so the throw lands in the catch.
    const badRow: any = {
      downloadId: 'bad',
      modelId: 'a/bad',
      modelKey: 'a/bad/x.gguf',
      fileName: 'x.gguf',
      status: 'running',
      createdAt: 1,
      get quantization() { throw new Error('corrupt row'); },
    };
    const goodRow: any = {
      downloadId: 'good', modelId: 'a/good', modelKey: 'a/good/y.gguf', fileName: 'y.gguf',
      status: 'running', bytesDownloaded: 10, totalBytes: 100, createdAt: 1,
    };
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([goodRow, badRow]);

    await hydrateDownloadStore();

    const downloads = useDownloadStore.getState().downloads;
    expect(downloads['a/good/y.gguf']).toBeDefined();
    expect(downloads['a/bad/x.gguf']).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      '[DownloadHydration] Failed to hydrate download row',
      expect.objectContaining({ downloadId: 'bad', error: 'corrupt row' }),
    );
  });

  it('stringifies a non-Error thrown value in the log', async () => {
    const badRow: any = {
      downloadId: 'bad2', modelId: 'a/bad2', modelKey: 'a/bad2/z.gguf', fileName: 'z.gguf',
      status: 'running', createdAt: 1,
      get quantization(): string { throw 'plain string failure'; },
    };
    backgroundDownloadService.getActiveDownloads.mockResolvedValue([badRow]);

    await hydrateDownloadStore();

    expect(logger.error).toHaveBeenCalledWith(
      '[DownloadHydration] Failed to hydrate download row',
      expect.objectContaining({ error: 'plain string failure' }),
    );
  });
});
