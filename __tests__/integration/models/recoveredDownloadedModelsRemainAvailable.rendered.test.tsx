/**
 * A relaunch can rebuild a lost model registry from the GGUF files that remain on disk. Large,
 * complete recovered models must stay available in the model picker, while small partial files stay
 * hidden. This mounts the real Models screen hydration and then the real model picker over only the
 * filesystem and AsyncStorage boundaries.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import { withNavigator } from '../../harness/realNavigation';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

describe('recovered downloaded models', () => {
  it('keeps a complete recovered model available and hides a partial file', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const React = require('react');
    const rtl = requireRTL();
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    const {
      ModelSelectorModal,
    } = require('../../../src/components/ModelSelectorModal');

    const modelsDir = `${boundary.fs!.DocumentDirectoryPath}/models`;
    const completeFile = 'Qwen3.5-0.8B-Q4_K_M.gguf';
    const partialFile = 'partial-Q4_K_M.gguf';
    const completePath = `${modelsDir}/${completeFile}`;
    const partialPath = `${modelsDir}/${partialFile}`;
    boundary.fs!.seedFile(completePath, 508 * 1024 * 1024);
    boundary.fs!.seedFile(partialPath, 14 * 1024 * 1024);

    await AsyncStorage.setItem(
      '@local_llm/downloaded_models',
      JSON.stringify([
        createDownloadedModel({
          id: `recovered_${completeFile}`,
          name: 'Qwen3.5-0.8B',
          author: 'Unknown',
          filePath: completePath,
          fileName: completeFile,
          fileSize: 508 * 1024 * 1024,
          quantization: 'Q4_K_M',
        }),
        createDownloadedModel({
          id: `recovered_${partialFile}`,
          name: 'Partial',
          author: 'Unknown',
          filePath: partialPath,
          fileName: partialFile,
          fileSize: 14 * 1024 * 1024,
          quantization: 'Q4_K_M',
        }),
      ]),
    );

    const models = rtl.render(withNavigator(React.createElement(ModelsScreen)));
    await rtl.waitFor(() =>
      expect(models.getByTestId('models-list')).not.toBeNull(),
    );
    models.unmount();

    const picker = rtl.render(withNavigator(
      React.createElement(ModelSelectorModal, {
        visible: true,
        onClose: () => {},
        onSelectModel: () => {},
        onUnloadModel: () => {},
        isLoading: false,
      })));

    await rtl.waitFor(() => {
      expect(
        picker.getByTestId(`text-model-row-recovered_${completeFile}`),
      ).not.toBeNull();
    });
    expect(
      picker.queryByTestId(`text-model-row-recovered_${partialFile}`),
    ).toBeNull();
  });
});
