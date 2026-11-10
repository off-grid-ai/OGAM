import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import { withNavigator } from '../../harness/realNavigation';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

/**
 * Downloads lists what is stored (size, quant, date). The predicted capability tags (tools, thinks)
 * belong to Models, where you choose a model; on a Downloads row they were cut off (hand test 85).
 */
describe('Download Manager rows', () => {
  it('list downloaded and downloading GGUFs without capability tags', async () => {
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
    // Both rows are there: the stored model and the one still downloading.
    await waitFor(() => expect(screen.getAllByText(/Q4_K_M/)).toHaveLength(2));
    // No tools or thinking tag on either. (The card's own vision mark, from the mmproj on disk, stays.)
    expect(screen.queryAllByLabelText(/^Tool calling/)).toHaveLength(0);
    expect(screen.queryAllByLabelText(/^Thinking/)).toHaveLength(0);
  });
});
