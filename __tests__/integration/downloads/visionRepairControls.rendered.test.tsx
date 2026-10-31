import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import { withNavigator } from '../../harness/realNavigation';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

describe('vision repair controls in Download Manager', () => {
  it('pauses, resumes, and offers to cancel a projector repair without deleting the model', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const React = require('react');
    const { render, fireEvent, waitFor } = requireRTL();
    const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
    const { useAppStore } = require('../../../src/stores');
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
    registerCoreDownloadProviders();

    const model = createDownloadedModel({
      id: 'test/vision/vision-Q4_K_M.gguf',
      name: 'Vision',
      fileName: 'vision-Q4_K_M.gguf',
      engine: 'llama',
      isVisionModel: true,
      mmProjFileName: 'mmproj-F16.gguf',
    });
    useAppStore.getState().setDownloadedModels([model]);
    boundary.download!.seedActive({
      downloadId: 'repair-vision',
      fileName: 'mmproj-F16.gguf',
      modelId: 'test/vision',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 20 * MB,
      totalBytes: 900 * MB,
    });
    useDownloadStore.getState().add({
      modelKey: model.id,
      downloadId: 'repair-vision',
      modelId: 'test/vision',
      fileName: 'mmproj-F16.gguf',
      quantization: 'F16',
      modelType: 'text',
      status: 'running',
      bytesDownloaded: 20 * MB,
      totalBytes: 900 * MB,
      combinedTotalBytes: 900 * MB,
      progress: 20 / 900,
      createdAt: Date.now(),
    });
    useDownloadStore.getState().setRepairingVision(model.id, true);

    const screen = render(withNavigator(React.createElement(DownloadManagerScreen)));
    fireEvent.press(await waitFor(() => screen.getByLabelText('Pause download')));
    fireEvent.press(await waitFor(() => screen.getByLabelText('Resume download')));
    fireEvent.press(await waitFor(() => screen.getByLabelText('Cancel download')));
    expect(await waitFor(() => screen.getByText('Remove Download'))).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(boundary.download!.active()).toHaveLength(1);
    expect(screen.getByText('vision-Q4_K_M.gguf')).toBeTruthy();
  });
});
