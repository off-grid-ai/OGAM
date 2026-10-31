/**
 * useModelDownloads — the reactive hook over ModelDownloadService used by every
 * screen. Verifies it lists on mount, re-lists when the service notifies (rapid ticks
 * coalesce into one refresh), and stops listening on unmount.
 *
 * The phone is the boundary: the native background downloader, the disk and storage are fakes
 * (harness/modelManagerDevice). The download service, its providers and the stores run for real,
 * and a download starts the way the app starts one.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';
import { requireRTL } from '../../harness/nativeBoundary';
import { createModelFile } from '../../utils/factories';

let device: ModelManagerDevice;
let rtl: ReturnType<typeof requireRTL>;
type Row = { id: string; status: string; bytesDownloaded?: number };
let useModelDownloads: () => Row[];
let useDownloadListeners: () => void;

beforeEach(async () => {
  device = await installModelManagerDevice();
  // App boot registers the core download providers with the one download service.
  require('../../../src/services/modelDownloadService/registerProviders').registerCoreDownloadProviders();
  rtl = requireRTL();
  ({ useModelDownloads } = require('../../../src/services/modelDownloadService/useModelDownloads'));
  ({ useDownloadListeners } = require('../../../src/hooks/useDownloads'));
});

/** A screen using the hook, under the app root that listens to the native downloader. */
const useScreen = (): Row[] => {
  useDownloadListeners();
  return useModelDownloads();
};

/** Start a text model download through the app's provider; return its native row. */
async function startDownload() {
  const { textProvider } = require('../../../src/services/modelDownloadService/providers/textProvider');
  await textProvider.start({
    modelType: 'text',
    modelId: 'test/model',
    file: createModelFile({ name: 'model-Q4_K_M.gguf', size: 1_000_000 }),
  });
  await device.settle();
  return device.nativeRows()[0];
}

describe('useModelDownloads', () => {
  it('lists on mount', async () => {
    await startDownload();
    const { result } = rtl.renderHook(useScreen);
    await rtl.waitFor(() => expect(result.current).toHaveLength(1));
    // Started, no bytes yet: it waits in the queue.
    expect(result.current[0]).toEqual(
      expect.objectContaining({ id: 'text:test/model/model-Q4_K_M.gguf', status: 'queued' }),
    );
  });

  it('re-lists when the service notifies, rapid ticks included', async () => {
    const row = await startDownload();
    const { result } = rtl.renderHook(useScreen);
    await rtl.waitFor(() => expect(result.current).toHaveLength(1));

    // Bytes arrive in quick succession; the hook ends up showing the latest.
    await rtl.act(async () => {
      await device.reportProgress(row.downloadId, 250_000, 1_000_000);
      await device.reportProgress(row.downloadId, 500_000, 1_000_000);
      await device.reportProgress(row.downloadId, 750_000, 1_000_000);
    });
    await rtl.waitFor(() => expect(result.current[0].bytesDownloaded).toBe(750_000));
    expect(result.current[0].status).toBe('downloading');
  });

  it('stops listening on unmount', async () => {
    const row = await startDownload();
    const { result, unmount } = rtl.renderHook(useScreen);
    await rtl.waitFor(() => expect(result.current).toHaveLength(1));
    const shown = result.current;
    unmount();

    await rtl.act(async () => {
      await device.reportProgress(row.downloadId, 900_000, 1_000_000);
    });
    // Nothing re-renders an unmounted hook: what it last showed stays as it was.
    expect(result.current).toBe(shown);
  });
});
