import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

// Funnel: the first chat model is still downloading. Home offers New chat, and the tap must open the
// chat (it answers when the model arrives). The button and its tap read one rule; a tap that did
// nothing was found on Android on 2026-11-19.
describe('Home New chat while the first chat model downloads', () => {
  const arriving = {
    modelKey: 'unsloth/Qwen3.5-0.8B-GGUF/Qwen3.5-0.8B-Q4_K_M.gguf',
    downloadId: 'd1',
    modelId: 'unsloth/Qwen3.5-0.8B-GGUF',
    fileName: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    quantization: 'Q4_K_M',
    modelType: 'text',
    status: 'running',
    bytesDownloaded: 100,
    totalBytes: 1000,
    combinedTotalBytes: 1000,
    progress: 0.1,
    createdAt: 1,
  };

  async function renderHome(downloads: Record<string, unknown>) {
    installNativeBoundary();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const React = require('react');
    const rtl = requireRTL();
    const { useAppStore } = require('../../../src/stores');
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    useAppStore.setState({ activeModelId: null, activeImageModelId: null, activeVideoModelId: null });
    useDownloadStore.setState({ downloads });
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    const navigate = jest.fn();
    const navigation = { navigate, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} };
    const home = rtl.render(React.createElement(HomeScreen, { navigation }));
    return { home, navigate, rtl };
  }

  it('opens the chat when New chat is tapped', async () => {
    const { home, navigate, rtl } = await renderHome({ [arriving.modelKey]: arriving });
    const button = await home.findByTestId('new-chat-button');
    rtl.fireEvent.press(button);
    expect(navigate).toHaveBeenCalledWith('Chat', {});
    home.unmount();
  });

  it('offers no New chat with no model chosen and none on its way', async () => {
    const { home, rtl } = await renderHome({});
    await rtl.waitFor(() => expect(home.getByText('Your chats and files never leave your device.')).toBeTruthy());
    expect(home.queryByTestId('new-chat-button')).toBeNull();
    home.unmount();
  });
});
