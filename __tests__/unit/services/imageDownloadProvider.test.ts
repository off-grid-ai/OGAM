/**
 * imageProvider — the image models' side of the Download Manager: what it lists, and its cancel, retry and
 * relaunch reconcile. The screen hands the provider its alert-coupled cancel/retry ops; on Android the
 * provider resumes the native row itself.
 *
 * The phone is the boundary: the native background downloader (its rows; it can say a row is gone), the disk,
 * and the platform (harness/nativeBoundary). The provider, the download store and the app store run for real;
 * the in-flight download is the native row plus the store entry the app added for it.
 */
import { installNativeBoundary, GB, type NativeBoundary } from '../../harness/nativeBoundary';

type Provider = typeof import('../../../src/services/modelDownloadService/providers/imageProvider');
let device: NativeBoundary;
let imageProvider: Provider['imageProvider'];
let setImageDownloadOps: Provider['setImageDownloadOps'];
let downloads: () => Record<string, any>;

const entry = (over: any = {}) => ({
  modelKey: 'image:sdxl/m', downloadId: 'dl-img', modelId: 'image:sdxl', fileName: 'SDXL',
  quantization: '', modelType: 'image', status: 'running', bytesDownloaded: 30, totalBytes: 100,
  combinedTotalBytes: 100, progress: 0.3, createdAt: 1, ...over,
});

/** A phone on `platform` with one image download in flight (`over` changes it). */
function phone(platform: 'ios' | 'android' = 'ios', over: any = {}) {
  device = installNativeBoundary({ fs: true, download: true, ram: { platform, totalBytes: 12 * GB, availBytes: 8 * GB } });
  ({ imageProvider, setImageDownloadOps } = require('../../../src/services/modelDownloadService/providers/imageProvider'));
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  const e = entry(over);
  if (!String(e.downloadId).startsWith('image-multi:')) device.download!.seedActive({ downloadId: e.downloadId, fileName: 'SDXL', modelId: 'image:sdxl', totalBytes: 100 });
  useDownloadStore.getState().add(e);
  downloads = () => useDownloadStore.getState().downloads;
}
const nativeIds = () => device.download!.active().map(r => r.downloadId);

describe('imageProvider', () => {
  it('lists an in-flight image download (downloading), id without the image: prefix dup', async () => {
    phone();
    const d = (await imageProvider.list()).find(x => x.id === 'image:sdxl');
    expect(d?.status).toBe('downloading');
    expect(d?.progress).toBe(0.3);
  });

  it('lists completed image models from appStore', async () => {
    phone();
    require('../../../src/stores').useAppStore.getState().addDownloadedImageModel({ id: 'other', name: 'Other', size: 500, modelPath: '/p' });
    const done = (await imageProvider.list()).find(d => d.id === 'image:other');
    expect(done?.status).toBe('completed');
  });

  it('delegates cancel to the injected UI op when registered', async () => {
    phone();
    const cancel = jest.fn(async () => {});
    setImageDownloadOps({ cancel });
    await imageProvider.cancel('image:sdxl');
    expect(cancel).toHaveBeenCalledWith('sdxl', expect.objectContaining({ downloadId: 'dl-img' }));
    expect(nativeIds()).toEqual(['dl-img']);
  });

  it('falls back to a native cancel when no UI op is registered', async () => {
    phone();
    await imageProvider.cancel('image:sdxl');
    expect(nativeIds()).toEqual([]);
  });

  it('iOS retry: delegates to the injected (alert-coupled) UI op', async () => {
    phone('ios');
    const retry = jest.fn(async () => {});
    setImageDownloadOps({ retry });
    await imageProvider.retry('image:sdxl');
    expect(retry).toHaveBeenCalledWith('sdxl', expect.objectContaining({ downloadId: 'dl-img' }));
    expect(device.download!.module.retryDownload).not.toHaveBeenCalled();
  });

  it('Android retry: resumes the native row directly, no UI op needed', async () => {
    phone('android');
    const retry = jest.fn(async () => {});
    setImageDownloadOps({ retry });
    await imageProvider.retry('image:sdxl');
    // Platform decision lives in the provider: Android never touches the injected op.
    expect(retry).not.toHaveBeenCalled();
    expect(device.download!.module.retryDownload).toHaveBeenCalledWith('dl-img');
    expect(downloads()['image:sdxl/m'].status).toBe('pending');
  });

  // B6: bytes finished then EXTRACTION failed (missing model files) → the native row is gone, so
  // retryDownload throws "Download not found". Retry must FALL BACK to the full re-download op, not
  // die every tap.
  it('Android retry: falls back to the full re-download op when the native row is gone', async () => {
    phone('android');
    // The native downloader no longer has the row.
    device.download!.module.retryDownload.mockRejectedValueOnce(new Error('Download not found'));
    const retry = jest.fn(async () => {});
    setImageDownloadOps({ retry });
    await imageProvider.retry('image:sdxl');
    expect(device.download!.module.retryDownload).toHaveBeenCalledWith('dl-img'); // tried native resume first
    expect(retry).toHaveBeenCalledWith('sdxl', expect.objectContaining({ downloadId: 'dl-img' })); // then re-download
  });

  // A multi-file (synthetic `image-multi:` row) download has no resumable native row — go straight
  // to the full re-download op instead of a doomed retryDownload.
  it('Android retry: a multi-file download skips native resume and re-downloads', async () => {
    phone('android', { downloadId: 'image-multi:sdxl' });
    const retry = jest.fn(async () => {});
    setImageDownloadOps({ retry });
    await imageProvider.retry('image:sdxl');
    expect(device.download!.module.retryDownload).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalled();
  });

  it('capability.retry is a STABLE constant (does not depend on injected ops)', async () => {
    phone();
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
    phone('ios', { downloadId: 'image-multi:sdxl', status: 'processing' });
    await imageProvider.reconcile!();
    expect(downloads()['image:sdxl/m'].status).toBe('failed');
  });
});
