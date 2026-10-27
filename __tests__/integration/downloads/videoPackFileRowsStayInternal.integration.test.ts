/**
 * A video pack is one download to the person, however many files it has.
 *
 * SPEC (OGAM user's view): the Download Manager shows a Wan pack as one row with the pack's size and
 * progress. Each file of the pack is its own native download (key `video-file:<id>/<file>`, model id
 * `video:<id>`), and after a relaunch those native file rows never become rows of their own: a file's
 * row once replaced the pack's row and showed the file's size (100% before the pack was done).
 *
 * The real hydrateDownloadStore and download store. Device boundary only: the native download module
 * (installNativeBoundary({ download: true })), seeded with what is in flight at relaunch.
 */
import { installNativeBoundary, GB } from '../../harness/nativeBoundary';

it('a relaunch hydrates other downloads but never a video pack\'s file as its own row', async () => {
  const boundary = installNativeBoundary({ fs: true, download: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  boundary.download!.seedActive({
    downloadId: 'dl-encoder', modelId: 'video:off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4',
    fileName: 'off-grid-ai%2FWan2.2-TI2V-5B-GGUF-Q4_umt5-xxl-encoder-Q4_K_M.gguf', modelType: 'video',
    bytesDownloaded: 3.3 * GB, totalBytes: 3.4 * GB,
    modelKey: 'video-file:off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4/umt5-xxl-encoder-Q4_K_M.gguf', createdAt: 2,
  });
  boundary.download!.seedActive({
    downloadId: 'dl-text', modelId: 'author/chat-model', fileName: 'chat-Q4_K_M.gguf', modelType: 'text',
    bytesDownloaded: GB, totalBytes: 2 * GB,
    modelKey: 'author/chat-model/chat-Q4_K_M.gguf', combinedTotalBytes: 2 * GB, createdAt: 1,
  });
  const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
  const { useDownloadStore } = require('../../../src/stores/downloadStore');

  await hydrateDownloadStore();

  const keys = Object.keys(useDownloadStore.getState().downloads);
  expect(keys).toContain('author/chat-model/chat-Q4_K_M.gguf');
  expect(keys.filter(key => key.startsWith('video-file:'))).toEqual([]);
  // The file's native row is still there, for the video provider to reconcile by its pack id.
  expect(boundary.download!.active().map(row => row.downloadId)).toContain('dl-encoder');
});
