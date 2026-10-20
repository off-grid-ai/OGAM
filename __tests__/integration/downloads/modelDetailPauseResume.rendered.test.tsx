import { installNativeBoundary, requireRTL, MB, GB } from '../../harness/nativeBoundary';

// The model is a Hugging Face search result that is NOT in the shared catalog: a catalog model answers a
// search from the catalog itself (its own card and files), so the HF file-detail controls under test
// are reached through a repo the catalog does not carry.
describe('model file download controls', () => {
  it('pauses and resumes the file from its Models card without losing downloaded bytes', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true, ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const originalFetch = global.fetch;
    const modelId = 'ibm-granite/granite-4.0-micro-GGUF';
    const fileName = 'granite-4.0-micro-Q8_0.gguf';
    global.fetch = async input => {
      const url = String(input);
      const body = url.includes(`/api/models/${modelId}?blobs=true`)
        ? { id: modelId, siblings: [{ rfilename: fileName, size: 256 * MB }] }
        : url.includes('search=granite')
          ? [{ id: modelId, author: 'ibm-granite', downloads: 1000, likes: 20, tags: ['gguf'] }]
          : [];
      return { ok: true, status: 200, json: async () => body } as Response;
    };
    try {
      const React = require('react');
      const rtl = requireRTL();
      const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
      const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
      const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
      registerCoreDownloadProviders();
      boundary.download!.seedActive({
        downloadId: 'granite-transfer', modelId, fileName, modelType: 'text',
        status: 'running', bytesDownloaded: 64 * MB, totalBytes: 256 * MB,
      });
      await hydrateDownloadStore();

      const screen = rtl.render(React.createElement(ModelsScreen, {}));
      rtl.fireEvent.changeText(screen.getByTestId('search-input'), 'granite');
      rtl.fireEvent(screen.getByTestId('search-input'), 'submitEditing');
      await rtl.waitFor(() => expect(screen.getByText('granite-4.0-micro-GGUF')).toBeTruthy());
      rtl.fireEvent.press(screen.getByText('granite-4.0-micro-GGUF'));
      await rtl.waitFor(() => expect(screen.getByText('granite-4.0-micro-Q8_0')).toBeTruthy());
      expect(screen.getByLabelText('Cancel download')).toBeTruthy();
      expect(screen.queryByText('Cancel')).toBeNull();
      expect(screen.queryByText('Pause')).toBeNull();

      rtl.fireEvent.press(screen.getByLabelText('Pause download'));
      await rtl.waitFor(() => expect(screen.getByLabelText('Resume download')).toBeTruthy());
      expect(screen.queryByText('Resume')).toBeNull();
      expect(screen.getByText('Paused')).toBeTruthy();
      expect(boundary.download!.active()[0]).toMatchObject({ status: 'paused', bytesDownloaded: 64 * MB });

      rtl.fireEvent.press(screen.getByLabelText('Resume download'));
      await rtl.waitFor(() => expect(screen.getByLabelText('Pause download')).toBeTruthy());
      expect(boundary.download!.active()[0]).toMatchObject({ status: 'running', bytesDownloaded: 64 * MB });
      screen.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('shows failed progress on one line and lets the user remove the failed file', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true, ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const originalFetch = global.fetch;
    const modelId = 'ibm-granite/granite-4.0-micro-GGUF';
    const fileName = 'granite-4.0-micro-Q8_0.gguf';
    global.fetch = async input => {
      const url = String(input);
      const body = url.includes(`/api/models/${modelId}?blobs=true`)
        ? { id: modelId, siblings: [{ rfilename: fileName, size: 256 * MB }] }
        : url.includes('search=granite')
          ? [{ id: modelId, author: 'ibm-granite', downloads: 1000, likes: 20, tags: ['gguf'] }]
          : [];
      return { ok: true, status: 200, json: async () => body } as Response;
    };
    try {
      const React = require('react');
      const rtl = requireRTL();
      const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
      const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
      const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
      registerCoreDownloadProviders();
      boundary.download!.seedActive({
        downloadId: 'failed-transfer', modelId, fileName, modelType: 'text',
        status: 'failed', bytesDownloaded: 10 * MB, totalBytes: 256 * MB,
        reason: 'Download failed',
      });
      await hydrateDownloadStore();

      const screen = rtl.render(React.createElement(ModelsScreen, {}));
      rtl.fireEvent.changeText(screen.getByTestId('search-input'), 'granite');
      rtl.fireEvent(screen.getByTestId('search-input'), 'submitEditing');
      await rtl.waitFor(() => expect(screen.getByText('granite-4.0-micro-GGUF')).toBeTruthy());
      rtl.fireEvent.press(screen.getByText('granite-4.0-micro-GGUF'));
      await rtl.waitFor(() => expect(screen.getByText(/4% · 10 MB \/ 256 MB/)).toBeTruthy());
      expect(screen.getByLabelText('Retry download')).toBeTruthy();
      expect(screen.getByLabelText('Remove download')).toBeTruthy();
      expect(screen.queryByText('Retry')).toBeNull();
      expect(screen.queryByText('Remove')).toBeNull();
      rtl.fireEvent.press(screen.getByLabelText('Remove download'));
      await rtl.waitFor(() => expect(screen.queryByLabelText('Retry download')).toBeNull());
      screen.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
