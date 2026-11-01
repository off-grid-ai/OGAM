/**
 * UI integration — the model selector warns about RAM but does not block
 * selection from an instantaneous reading. The load owner performs the
 * authoritative memory check when the model is loaded.
 */
import {
  installNativeBoundary,
  requireRTL,
  GB,
} from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import { withNavigator } from '../../harness/realNavigation';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

describe('Model selector — selection is independent of transient free RAM', () => {
  it('keeps both models visible and lets the user select the model that fits the owned budget', async () => {
    const boundary = installNativeBoundary({
      llama: true,
      fs: true,
      ram: {
        platform: 'android',
        totalBytes: 12 * GB,
        availBytes: 4.5 * GB,
      },
    });
    const React = require('react');
    const rtl = requireRTL();
    const { useAppStore } = require('../../../src/stores');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');

    const docs = boundary.fs!.DocumentDirectoryPath;
    const seed = (id: string, fileName: string, size: number) => {
      const filePath = `${docs}/models/${fileName}`;
      boundary.fs!.seedFile(filePath, 1024);
      return createDownloadedModel({
        id,
        name: id,
        engine: 'llama',
        filePath,
        fileName,
        fileSize: size,
      });
    };
    const fittingModel = seed('gemma-e2b-gguf', 'e2b.gguf', 2.89 * GB);
    const oversizedModel = seed('huge-model', 'huge.gguf', 9.6 * GB);
    useAppStore.setState({
      downloadedModels: [fittingModel, oversizedModel],
      activeModelId: null,
    });
    const onSelectModel = jest.fn();

    const view = rtl.render(withNavigator(
      React.createElement(ModelSelectorModal, {
        visible: true,
        onClose: () => {},
        onSelectModel,
        onUnloadModel: () => {},
        isLoading: false,
      })));

    const fittingRow = await rtl.waitFor(
      () => view.getByTestId('text-model-row-gemma-e2b-gguf'),
      { timeout: 4000 },
    );
    expect(view.getByTestId('text-model-row-huge-model')).not.toBeNull();
    expect(view.getAllByText(/may not fit/i).length).toBeGreaterThan(0);

    rtl.fireEvent.press(fittingRow);
    expect(onSelectModel).toHaveBeenCalledWith(fittingModel);
  }, 30000);
});
