import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import { withNavigator } from '../../harness/realNavigation';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

describe('Download Manager model capabilities', () => {
  it('shows vision, tool calling, and thinking for downloaded and downloading GGUFs', async () => {
    installNativeBoundary({ download: true, fs: true });
    const React = require('react');
    const { render, waitFor } = requireRTL();
    const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
    const { useAppStore } = require('../../../src/stores');
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
    registerCoreDownloadProviders();

    useAppStore.getState().setDownloadedModels([createDownloadedModel({
      id: 'org/qwen3-vl/completed.gguf',
      name: 'Qwen3 VL',
      fileName: 'completed.gguf',
      engine: 'llama',
      isVisionModel: true,
      mmProjPath: '/models/mmproj.gguf',
    })]);
    useDownloadStore.getState().add({
      modelKey: 'org/qwen3-vl/downloading.gguf',
      downloadId: 'dl-capabilities',
      modelId: 'org/qwen3-vl',
      fileName: 'downloading.gguf',
      quantization: 'Q4_K_M',
      modelType: 'text',
      metadataJson: JSON.stringify({ mmProjFileName: 'mmproj.gguf' }),
      status: 'running',
      bytesDownloaded: MB,
      totalBytes: 2 * MB,
      combinedTotalBytes: 3 * MB,
      progress: 1 / 3,
      createdAt: Date.now(),
    });

    const screen = render(withNavigator(React.createElement(DownloadManagerScreen)));
    await waitFor(() => {
      expect(screen.getAllByLabelText('Vision')).toHaveLength(2);
      expect(screen.getAllByLabelText('Tool calling likely')).toHaveLength(2);
      expect(screen.getAllByLabelText('Thinking likely')).toHaveLength(2);
    });
  });
});
