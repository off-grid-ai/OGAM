/**
 * Reloading the selected text model must project its real Shared loading state onto
 * that model's row. No row tap or local loading flag manufactures this transition.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { createDownloadedModel } from '../../utils/factories';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('model selector loader during an active-model reload', () => {
  it('shows one spinner on the active row until the real reload finishes', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      platform: 'android',
      modelName: 'Model A',
      modelFileName: 'a.gguf',
    });
    const { ModelSelectorModal } =
      require('../../../src/components/ModelSelectorModal') as typeof import('../../../src/components/ModelSelectorModal');
    const { reloadLocalTextModel } =
      require('../../../src/services/modelServices/modelFacadeCommands') as typeof import('../../../src/services/modelServices/modelFacadeCommands');
    const { currentMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');

    const modelB = createDownloadedModel({
      id: 'b',
      name: 'Model B',
      engine: 'llama',
      filePath: '/models/b.gguf',
      fileName: 'b.gguf',
    });
    h.boundary.fs!.seedFile(modelB.filePath, modelB.fileSize);
    h.useAppStore.getState().addDownloadedModel(modelB);
    await currentMobileApplicationFixture()!.refreshModels();

    const view = h.rtl.render(
      h.React.createElement(ModelSelectorModal, {
        visible: true,
        onClose: () => {},
        onSelectModel: () => {},
        onUnloadModel: () => {},
        isLoading: false,
      }),
    );

    await h.rtl.waitFor(() => {
      expect(view.getByTestId('text-model-row-m')).toBeTruthy();
      expect(view.getByTestId('text-model-row-b')).toBeTruthy();
    });
    expect(view.queryByTestId('model-row-loading')).toBeNull();

    let finishNativeLoad: () => void = () => {};
    h.boundary.llama!.module.initLlama.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishNativeLoad = () =>
            resolve({ backend: 'gpu', maxNumTokens: 4096 });
        }),
    );

    const reload = reloadLocalTextModel('m');

    await h.rtl.waitFor(() => {
      expect(
        h.rtl
          .within(view.getByTestId('text-model-row-m'))
          .queryByTestId('model-row-loading'),
      ).not.toBeNull();
    });
    expect(
      h.rtl
        .within(view.getByTestId('text-model-row-b'))
        .queryByTestId('model-row-loading'),
    ).toBeNull();

    await h.rtl.act(async () => {
      finishNativeLoad();
      await reload;
    });
    await h.rtl.waitFor(() =>
      expect(view.queryByTestId('model-row-loading')).toBeNull(),
    );
    view.unmount();
  });
});
