import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import { withNavigator } from '../../harness/realNavigation';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { View } = require('react-native');
    return <View {...props} />;
  },
}));

it('uses the selected GGUF header for context before loading and updates on selection', async () => {
  const boundary = installNativeBoundary({ llama: true, fs: true });
  const React = require('react');
  const { render, fireEvent, waitFor } = requireRTL();
  const AsyncStorage = require('@react-native-async-storage/async-storage').default
    ?? require('@react-native-async-storage/async-storage');
  const { HomeScreen } = require('../../../src/screens/HomeScreen');
  const { GenerationSettingsModal } = require('../../../src/components/GenerationSettingsModal');
  const { useAppStore } = require('../../../src/stores');

  const docs = boundary.fs!.DocumentDirectoryPath;
  const models = [
    { id: 'ling', name: 'Ling 3.0 Tiny', fileName: 'ling.gguf', max: 131072 },
    { id: 'small', name: 'Small model', fileName: 'small.gguf', max: 4096 },
  ];
  for (const model of models) boundary.fs!.seedFile(`${docs}/models/${model.fileName}`, 500 * MB);
  await AsyncStorage.setItem('@local_llm/downloaded_models', JSON.stringify(models.map(model =>
    createDownloadedModel({ id: model.id, name: model.name, engine: 'llama', filePath: `${docs}/models/${model.fileName}`, fileName: model.fileName }),
  )));
  boundary.llama!.module.loadLlamaModelInfo.mockImplementation(
    async (path: string) =>
      path.endsWith('ling.gguf')
        ? {
            'general.architecture': 'bailingmoe3',
            'bailingmoe3.context_length': '131072',
          }
        : {
            'general.architecture': 'qwen3',
            'qwen3.context_length': '4096',
          },
  );

  const nav = { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} };
  const home = render(withNavigator(React.createElement(HomeScreen, { navigation: nav })));
  await waitFor(() => expect(useAppStore.getState().downloadedModels).toHaveLength(2));
  fireEvent.press(home.getByTestId('browse-models-button'));
  fireEvent.press(await waitFor(() => home.getByTestId('text-model-row-ling')));
  await waitFor(() => expect(useAppStore.getState().activeModelId).toBe('ling'));

  const settings = render(withNavigator(React.createElement(GenerationSettingsModal, { visible: true, onClose: () => {} })));
  fireEvent.press(settings.getByText('TEXT GENERATION'));
  await waitFor(() => expect(settings.getByTestId('setting-contextLength-slider').props.maximumValue).toBe(131072));
  expect(useAppStore.getState().loadedTextModelId).toBeNull();
  settings.unmount();
  home.unmount();

  const nextHome = render(withNavigator(React.createElement(HomeScreen, { navigation: nav })));
  fireEvent.press(await waitFor(() => nextHome.getByTestId('models-summary')));
  fireEvent.press(await waitFor(() => nextHome.getByTestId('models-row-text')));
  fireEvent.press(await waitFor(() => nextHome.getByTestId('text-model-row-small')));
  const nextSettings = render(withNavigator(React.createElement(GenerationSettingsModal, { visible: true, onClose: () => {} })));
  fireEvent.press(nextSettings.getByText('TEXT GENERATION'));
  await waitFor(() => expect(nextSettings.getByTestId('setting-contextLength-slider').props.maximumValue).toBe(4096));
  expect(useAppStore.getState().loadedTextModelId).toBeNull();
  nextSettings.unmount();
  nextHome.unmount();
});
