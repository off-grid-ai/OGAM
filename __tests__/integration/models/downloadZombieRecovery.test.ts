const mockBackgroundDownloadService = {
  isAvailable: jest.fn(),
  getActiveDownloads: jest.fn(),
};

jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: mockBackgroundDownloadService,
}));

const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
const { useDownloadStore } = require('../../../src/stores/downloadStore');
const { isRetryable } = require('../../../src/utils/downloadErrors');

describe('download zombie recovery integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDownloadStore.setState({
      downloads: {},
      downloadIdIndex: {},
      repairingVisionIds: {},
    });
    mockBackgroundDownloadService.isAvailable.mockReturnValue(true);
  });

  it('hydrates interrupted downloads as failed with a retryable reason code', async () => {
    mockBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
      {
        downloadId: 'dl-zombie-1',
        modelId: 'qwen3-4b',
        modelKey: 'qwen3-4b:Q4_K_M.gguf',
        fileName: 'Q4_K_M.gguf',
        modelType: 'text',
        status: 'failed',
        bytesDownloaded: 0,
        totalBytes: 2_500_000_000,
        reason: 'The download was interrupted.',
        reasonCode: 'download_interrupted',
        createdAt: 1_700_000_000_000,
      },
    ]);

    await hydrateDownloadStore();

    const entry = useDownloadStore.getState().downloads['qwen3-4b:Q4_K_M.gguf'];
    expect(entry).toBeDefined();
    expect(entry.status).toBe('failed');
    expect(entry.errorCode).toBe('download_interrupted');
    expect(entry.errorMessage).toBe('The download was interrupted.');
    expect(isRetryable(entry.errorCode)).toBe(true);
  });

  it('does not drop failed rows so the Download Manager can show retry', async () => {
    mockBackgroundDownloadService.getActiveDownloads.mockResolvedValue([
      {
        downloadId: 'dl-zombie-2',
        modelId: 'whisper-base',
        modelKey: 'whisper-base:ggml-base.en.bin',
        fileName: 'ggml-base.en.bin',
        modelType: 'stt',
        status: 'failed',
        bytesDownloaded: 32,
        totalBytes: 148_000_000,
        reason: 'The download was interrupted.',
        reasonCode: 'download_interrupted',
        createdAt: 1_700_000_000_100,
      },
    ]);

    await hydrateDownloadStore();

    expect(Object.keys(useDownloadStore.getState().downloads)).toHaveLength(1);
    expect(useDownloadStore.getState().downloadIdIndex['dl-zombie-2']).toBe(
      'whisper-base:ggml-base.en.bin',
    );
  });
});
