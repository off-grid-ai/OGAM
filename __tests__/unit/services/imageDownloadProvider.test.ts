/**
 * Image download provider — list/remove/reconcile are service-level; cancel/retry
 * are injected by the UI (imageDownloadActions pulls CustomAlert, so the provider
 * must stay UI-free). Verifies list, injected-op delegation, native cancel fallback,
 * remove, and that a multi-file (no native row) interrupted download is stranded.
 */
jest.mock('../../../src/services/modelManager', () => ({ modelManager: { deleteImageModel: jest.fn(async () => {}) } }));
jest.mock('../../../src/services/activeModelService', () => ({ activeModelService: { unloadImageModel: jest.fn(async () => {}) } }));
jest.mock('../../../src/services/backgroundDownloadService', () => ({ backgroundDownloadService: { cancelDownload: jest.fn(async () => {}), retryDownload: jest.fn(async () => {}), startProgressPolling: jest.fn() } }));
jest.mock('../../../src/utils/logger', () => ({ __esModule: true, default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { Platform } from 'react-native';
import { imageProvider, setImageDownloadOps } from '../../../src/services/modelDownloadService/providers/imageProvider';
import { useDownloadStore } from '../../../src/stores/downloadStore';
import { useAppStore } from '../../../src/stores';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';

const mockBg = backgroundDownloadService as unknown as { cancelDownload: jest.Mock; retryDownload: jest.Mock; startProgressPolling: jest.Mock };
const setPlatform = (os: 'ios' | 'android') => { (Platform as any).OS = os; };

const entry = (over: any = {}) => ({
  modelKey: 'image:sdxl/m', downloadId: 'dl-img', modelId: 'image:sdxl', fileName: 'SDXL',
  quantization: '', modelType: 'image', status: 'running', bytesDownloaded: 30, totalBytes: 100,
  combinedTotalBytes: 100, progress: 0.3, createdAt: 1, ...over,
});

const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  setPlatform(originalOS as 'ios' | 'android');
  setImageDownloadOps({});
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
  useAppStore.setState({ downloadedImageModels: [] } as any);
  useDownloadStore.getState().add(entry());
});
afterAll(() => { setPlatform(originalOS as 'ios' | 'android'); });

describe('imageProvider', () => {
  it('lists an in-flight image download (downloading), id without the image: prefix dup', async () => {
    const d = (await imageProvider.list()).find(x => x.id === 'image:sdxl');
    expect(d?.status).toBe('downloading');
    expect(d?.progress).toBe(0.3);
  });

  it('lists completed image models from appStore', async () => {
    useAppStore.setState({ downloadedImageModels: [{ id: 'other', name: 'Other', size: 500, modelPath: '/p' }] } as any);
    const done = (await imageProvider.list()).find(d => d.id === 'image:other');
    expect(done?.status).toBe('completed');
  });

  it('delegates cancel to the injected UI op when registered', async () => {
    const cancel = jest.fn(async () => {});
    setImageDownloadOps({ cancel });
    await imageProvider.cancel('image:sdxl');
    expect(cancel).toHaveBeenCalledWith('sdxl', expect.objectContaining({ downloadId: 'dl-img' }));
    expect(mockBg.cancelDownload).not.toHaveBeenCalled();
  });

  it('falls back to a native cancel when no UI op is registered', async () => {
    await imageProvider.cancel('image:sdxl');
    expect(mockBg.cancelDownload).toHaveBeenCalledWith('dl-img');
  });

  it('iOS retry: delegates to the injected (alert-coupled) UI op', async () => {
    setPlatform('ios');
    const retry = jest.fn(async () => {});
    setImageDownloadOps({ retry });
    await imageProvider.retry('image:sdxl');
    expect(retry).toHaveBeenCalledWith('sdxl', expect.objectContaining({ downloadId: 'dl-img' }));
    expect(mockBg.retryDownload).not.toHaveBeenCalled();
  });

  it('Android retry: resumes the native row directly, no UI op needed', async () => {
    setPlatform('android');
    const retry = jest.fn(async () => {});
    setImageDownloadOps({ retry });
    await imageProvider.retry('image:sdxl');
    // Platform decision lives in the provider: Android never touches the injected op.
    expect(retry).not.toHaveBeenCalled();
    expect(mockBg.retryDownload).toHaveBeenCalledWith('dl-img');
    expect(useDownloadStore.getState().downloads['image:sdxl/m'].status).toBe('pending');
  });

  // B6: bytes finished then EXTRACTION failed (missing model files) → the native row is gone, so
  // retryDownload throws "Download not found". Retry must FALL BACK to the full re-download op, not
  // die every tap.
  it('Android retry: falls back to the full re-download op when the native row is gone', async () => {
    setPlatform('android');
    mockBg.retryDownload.mockRejectedValueOnce(new Error('Download not found'));
    const retry = jest.fn(async () => {});
    setImageDownloadOps({ retry });
    await imageProvider.retry('image:sdxl');
    expect(mockBg.retryDownload).toHaveBeenCalledWith('dl-img'); // tried native resume first
    expect(retry).toHaveBeenCalledWith('sdxl', expect.objectContaining({ downloadId: 'dl-img' })); // then re-download
  });

  // A multi-file (synthetic `image-multi:` row) download has no resumable native row — go straight
  // to the full re-download op instead of a doomed retryDownload.
  it('Android retry: a multi-file download skips native resume and re-downloads', async () => {
    setPlatform('android');
    useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
    useDownloadStore.getState().add(entry({ downloadId: 'image-multi:sdxl' }));
    const retry = jest.fn(async () => {});
    setImageDownloadOps({ retry });
    await imageProvider.retry('image:sdxl');
    expect(mockBg.retryDownload).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalled();
  });

  it('capability.retry is a STABLE constant (does not depend on injected ops)', async () => {
    // No ops injected at all — capability must still advertise retry: true on both
    // platforms (the flag must not flap when the UI injects ops in a later effect).
    setImageDownloadOps({});
    const d1 = (await imageProvider.list()).find(x => x.id === 'image:sdxl');
    expect(d1?.capabilities.retry).toBe(true);
    setImageDownloadOps({ retry: jest.fn(async () => {}) });
    const d2 = (await imageProvider.list()).find(x => x.id === 'image:sdxl');
    expect(d2?.capabilities.retry).toBe(true);
  });

  it('reconcile strands an interrupted multi-file download (no native row) as failed', async () => {
    useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} } as any);
    useDownloadStore.getState().add(entry({ downloadId: 'image-multi:sdxl', status: 'processing' }));
    await imageProvider.reconcile!();
    expect(useDownloadStore.getState().downloads['image:sdxl/m'].status).toBe('failed');
  });
});
