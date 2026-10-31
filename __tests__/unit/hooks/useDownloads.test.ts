/**
 * useDownloadListeners — the app root's bridge from the native downloader's events to the download store.
 *
 * The phone is the boundary: the native background downloader (its rows and the events it sends) is a fake
 * (harness/nativeBoundary). The background download service, the hook and the download store run for real.
 * A download is in flight the way the app leaves one: a native row, and the store entry the app added for it
 * through the store's own action. The test reads the store and the downloader, never a call on our code.
 */
import { installNativeBoundary, requireRTL, type NativeBoundary } from '../../harness/nativeBoundary';

type Store = typeof import('../../../src/stores/downloadStore');
type Hooks = typeof import('../../../src/hooks/useDownloads');

let device: NativeBoundary;
let rtl: ReturnType<typeof requireRTL>;
let useDownloadStore: Store['useDownloadStore'];
let hooks: Hooks;

const KEY = 'author/model/model.gguf';

beforeEach(() => {
  device = installNativeBoundary({ fs: true, download: true });
  rtl = requireRTL();
  ({ useDownloadStore } = require('../../../src/stores/downloadStore'));
  hooks = require('../../../src/hooks/useDownloads');
});

/** A download in flight: the native row and the store entry the app added for it. */
function inFlight(
  opts: { downloadId?: string; modelType?: string; mmProjDownloadId?: string; modelKey?: string } = {},
) {
  const downloadId = opts.downloadId ?? 'dl-1';
  const modelKey = opts.modelKey ?? KEY;
  device.download!.seedActive({ downloadId, fileName: 'model.gguf', modelId: 'author/model', totalBytes: 1000 });
  if (opts.mmProjDownloadId) {
    device.download!.seedActive({ downloadId: opts.mmProjDownloadId, fileName: 'model-mmproj.gguf', modelId: 'author/model', totalBytes: 500 });
  }
  useDownloadStore.getState().add({
    modelKey: modelKey as never,
    downloadId,
    modelId: 'author/model',
    fileName: 'model.gguf',
    quantization: 'Q4_K_M',
    modelType: (opts.modelType ?? 'text') as never,
    status: 'running' as never,
    bytesDownloaded: 0,
    totalBytes: 1000,
    combinedTotalBytes: opts.mmProjDownloadId ? 1500 : 1000,
    progress: 0,
    createdAt: Date.now(),
    ...(opts.mmProjDownloadId
      ? { mmProjDownloadId: opts.mmProjDownloadId, mmProjFileName: 'model-mmproj.gguf', mmProjFileSize: 500 }
      : {}),
  });
}

/** The entry for `modelKey` as the store holds it. */
const entry = (modelKey = KEY) => useDownloadStore.getState().downloads[modelKey as never];

/** The native downloader reports an event, as the device does. */
function native(event: 'DownloadProgress' | 'DownloadComplete' | 'DownloadError', payload: Record<string, unknown>) {
  rtl.act(() => {
    device.download!.events.emit(event, payload);
  });
}

describe('useDownloadListeners', () => {
  it('carries native progress into the store while mounted, and stops on unmount', () => {
    inFlight();
    const { unmount } = rtl.renderHook(() => hooks.useDownloadListeners());
    native('DownloadProgress', { downloadId: 'dl-1', bytesDownloaded: 400, totalBytes: 1000, status: 'running' });
    expect(entry().bytesDownloaded).toBe(400);

    unmount();
    native('DownloadProgress', { downloadId: 'dl-1', bytesDownloaded: 800, totalBytes: 1000, status: 'running' });
    expect(entry().bytesDownloaded).toBe(400);
  });

  it('listens to nothing where the platform has no background downloader', () => {
    device = installNativeBoundary({ fs: true, download: false });
    rtl = requireRTL();
    ({ useDownloadStore } = require('../../../src/stores/downloadStore'));
    hooks = require('../../../src/hooks/useDownloads');
    expect(() => rtl.renderHook(() => hooks.useDownloadListeners())).not.toThrow();
  });

  it('ignores events for a download the app did not start', () => {
    inFlight();
    rtl.renderHook(() => hooks.useDownloadListeners());
    native('DownloadProgress', { downloadId: 'stranger', bytesDownloaded: 999, totalBytes: 1000, status: 'running' });
    native('DownloadComplete', { downloadId: 'stranger', bytesDownloaded: 1000, totalBytes: 1000 });
    native('DownloadError', { downloadId: 'stranger', reason: 'boom' });
    expect(entry()).toEqual(expect.objectContaining({ status: 'running', bytesDownloaded: 0 }));
  });

  it.each(['retrying', 'waiting_for_network', 'paused'])(
    'shows a %s status from native, not a byte update',
    status => {
      inFlight();
      rtl.renderHook(() => hooks.useDownloadListeners());
      native('DownloadProgress', { downloadId: 'dl-1', bytesDownloaded: 700, totalBytes: 1000, status });
      expect(entry()).toEqual(expect.objectContaining({ status, bytesDownloaded: 0 }));
    },
  );

  it('routes the projector download progress to the projector bytes', () => {
    inFlight({ mmProjDownloadId: 'mm-1' });
    rtl.renderHook(() => hooks.useDownloadListeners());
    native('DownloadProgress', { downloadId: 'mm-1', bytesDownloaded: 250, totalBytes: 500, status: 'running' });
    expect(entry()).toEqual(expect.objectContaining({ mmProjBytesDownloaded: 250, bytesDownloaded: 0 }));
  });

  it('completes the model when the projector lands after the weights', () => {
    inFlight({ mmProjDownloadId: 'mm-1', modelType: 'image' });
    rtl.renderHook(() => hooks.useDownloadListeners());
    native('DownloadComplete', { downloadId: 'dl-1', bytesDownloaded: 1000, totalBytes: 1000 });
    // The weights are in; the projector is not, so the model is not done yet.
    expect(entry().status).not.toBe('completed');
    expect(entry().mmProjStatus).not.toBe('completed');

    native('DownloadComplete', { downloadId: 'mm-1', bytesDownloaded: 500, totalBytes: 500 });
    expect(entry().mmProjStatus).toBe('completed');
  });

  it('marks the projector done but not the model while the weights are still coming', () => {
    inFlight({ mmProjDownloadId: 'mm-1' });
    rtl.renderHook(() => hooks.useDownloadListeners());
    native('DownloadComplete', { downloadId: 'mm-1', bytesDownloaded: 500, totalBytes: 500 });
    expect(entry().mmProjStatus).toBe('completed');
    expect(entry().status).not.toBe('completed');
  });

  it('moves a finished image download on to processing (unpacking)', () => {
    inFlight({ modelType: 'image' });
    rtl.renderHook(() => hooks.useDownloadListeners());
    native('DownloadComplete', { downloadId: 'dl-1', bytesDownloaded: 1000, totalBytes: 1000 });
    expect(entry().status).toBe('processing');
  });

  it('leaves a finished text download for its initiator to finalize, with all bytes shown', () => {
    inFlight({ modelType: 'text' });
    rtl.renderHook(() => hooks.useDownloadListeners());
    native('DownloadComplete', { downloadId: 'dl-1', bytesDownloaded: 1000, totalBytes: 1000 });
    expect(entry()).toEqual(expect.objectContaining({ bytesDownloaded: 1000 }));
    expect(entry().status).not.toBe('completed');
  });

  it('completes a finished download of any other kind', () => {
    inFlight({ modelType: 'stt' });
    rtl.renderHook(() => hooks.useDownloadListeners());
    native('DownloadComplete', { downloadId: 'dl-1', bytesDownloaded: 1000, totalBytes: 1000 });
    expect(entry().status).toBe('completed');
  });

  it('fails the download with a message the user can read', () => {
    inFlight();
    rtl.renderHook(() => hooks.useDownloadListeners());
    native('DownloadError', { downloadId: 'dl-1', reason: 'Network error', reasonCode: 'network_lost' });
    expect(entry().status).toBe('failed');
    expect(entry().errorMessage).toEqual(expect.any(String));
    expect(entry().errorMessage!.length).toBeGreaterThan(0);
  });
});
