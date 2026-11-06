/**
 * A paused or failed download never vanishes when the app comes back to the front.
 *
 * SPEC (OGAM user's view): a download that waits for the person (paused, or failed with Retry) keeps
 * its card until they act on it. If its native task is gone, the card says so (failed, Tap retry),
 * never disappears. Device 2026-11-06: hydrate kept only active rows, so paused and failed cards
 * dropped with no notice.
 *
 * The real hydrate and download store. Device boundary only: the native background downloader.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

const GB = 1024 ** 3;

function boot() {
  const boundary = installNativeBoundary({ download: true, ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 4 * GB } });
  const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  return { boundary, hydrateDownloadStore, store: useDownloadStore };
}

it('a paused download whose native task is gone becomes failed and retriable', async () => {
  const { boundary, hydrateDownloadStore, store } = boot();
  boundary.download!.seedActive({ downloadId: 'dl-txt', fileName: 'gemma-4b.gguf', modelId: 'gemma-4b', modelType: 'text', status: 'paused', bytesDownloaded: GB, totalBytes: 6 * GB });
  await hydrateDownloadStore();
  const [key] = Object.keys(store.getState().downloads);
  expect(store.getState().downloads[key].status).toBe('paused');

  // iOS drops the task with the process; the app comes back to the front.
  boundary.download!.simulateRelaunch();
  await hydrateDownloadStore();

  expect(store.getState().downloads[key]).toMatchObject({ status: 'failed', errorMessage: 'Paused download was lost. Tap retry.' });
});

it('a failed download keeps its card through a hydrate', async () => {
  const { boundary, hydrateDownloadStore, store } = boot();
  boundary.download!.seedActive({ downloadId: 'dl-txt', fileName: 'gemma-4b.gguf', modelId: 'gemma-4b', modelType: 'text', status: 'running', bytesDownloaded: GB, totalBytes: 6 * GB });
  await hydrateDownloadStore();
  const [key] = Object.keys(store.getState().downloads);
  store.getState().setStatus('dl-txt', 'failed', { message: 'Network lost.' });

  boundary.download!.simulateRelaunch();
  await hydrateDownloadStore();

  expect(store.getState().downloads[key]).toMatchObject({ status: 'failed', errorMessage: 'Network lost.' });
});
