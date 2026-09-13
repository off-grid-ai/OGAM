import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

describe('Home with a saved remote Text selection', () => {
  it('keeps Text active and New Chat available while discovery details reload', async () => {
    installNativeBoundary();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem('remote-servers', JSON.stringify({
      state: {
        servers: [{
          id: 'gateway',
          name: 'Off Grid AI Gateway',
          endpoint: 'http://192.168.1.50:7878',
          providerType: 'openai-compatible',
          createdAt: '2026-09-12T00:00:00.000Z',
          mediaModels: { text: 'qwen/qwen3-8b' },
        }],
        activeServerId: 'gateway',
        activeRemoteTextModelId: 'qwen/qwen3-8b',
        discoveredModels: {},
      },
      version: 2,
    }));

    const React = require('react');
    const rtl = requireRTL();
    const { useRemoteServerStore } = require('../../../src/stores');
    await useRemoteServerStore.persist.rehydrate();
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    const navigation = {
      navigate: () => {},
      goBack: () => {},
      setOptions: () => {},
      addListener: () => () => {},
    };

    const home = rtl.render(React.createElement(HomeScreen, { navigation }));
    await rtl.waitFor(() => {
      expect(home.getByTestId('model-summary-text').props.accessibilityState.selected).toBe(true);
      expect(home.getByTestId('new-chat-button')).toBeTruthy();
    });

    rtl.fireEvent.press(home.getByTestId('models-summary'));
    expect(await home.findByText('qwen/qwen3-8b')).toBeTruthy();
    rtl.fireEvent.press(home.getByTestId('models-row-text'));
    expect(await home.findByTestId('currently-loaded-model')).toBeTruthy();
    home.unmount();
  });
});
