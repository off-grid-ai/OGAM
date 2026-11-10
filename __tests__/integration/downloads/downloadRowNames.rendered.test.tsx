/**
 * Downloads names each row the way the Models screen does: the model's name from the shared resolver,
 * never its file name. The row once read "K2-Horizon-4B-Q4_K_M" while Models called the same model
 * "K2 Horizon 3.7B" (review page, Downloads v3).
 *
 * Real DownloadManagerScreen, stores and hydration; only the native downloader is faked.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

it('a running download and a split download read as model names, not file names', async () => {
  const boundary = installNativeBoundary({ download: true, ram: { platform: 'android', totalBytes: 8 * 1024 ** 3, availBytes: 4 * 1024 ** 3 } });
  const React = require('react');
  const { render, waitFor } = requireRTL();
  const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
  const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
  boundary.download!.seedActive({ downloadId: 'dl-1', fileName: 'K2-Horizon-4B-Q4_K_M.gguf', modelId: 'LLM360/K2-Horizon-GGUF', modelType: 'text', status: 'running', bytesDownloaded: 1024 ** 3, totalBytes: 3 * 1024 ** 3 });
  boundary.download!.seedActive({ downloadId: 'dl-2', fileName: 'Bonsai-27B-Q4_K_M-00001-of-00002.gguf', modelId: 'org/Bonsai-27B-GGUF', modelType: 'text', status: 'running', bytesDownloaded: 1024 ** 3, totalBytes: 9 * 1024 ** 3 });
  await hydrateDownloadStore();

  const view = render(React.createElement(DownloadManagerScreen, {}));
  await waitFor(() => expect(view.getByText('K2 Horizon 3.7B')).toBeTruthy());
  expect(view.getByText('Bonsai 27B')).toBeTruthy();
  expect(view.queryByText(/K2-Horizon-4B/)).toBeNull();
  expect(view.queryByText(/Bonsai-27B/)).toBeNull();
});
