/** A key saved for a private HTTP server is sent to it, as Off Grid Desktop's LAN gateway needs. */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { installKeyedServer, resetKeychain } from '../../harness/keyedRemoteServer';

jest.unmock('@react-navigation/native');
jest.mock('react-native-keychain', () => require('../../harness/keyedRemoteServer').keychainModule());

it.each([200, 401, 403])('M7: the HTTP server response (%s) decides the connection result', async status => {
  installNativeBoundary({ fs: true });
  resetKeychain();
  await require('@react-native-async-storage/async-storage').clear();
  const server = installKeyedServer({
    origin: 'http://192.168.1.40:8080', flavour: 'lmstudio', apiKey: 'lan-key', modelId: 'qwen3-8b',
  });
  const React = require('react');
  const rtl = requireRTL();
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { RemoteServersScreen } = require('../../../src/screens/RemoteServersScreen');
  const { RemoteServerEditorScreen } = require('../../../src/screens/RemoteServerEditorScreen');
  const Stack = createNativeStackNavigator();
  const view = rtl.render(React.createElement(NavigationContainer, null,
    React.createElement(Stack.Navigator, { screenOptions: { headerShown: false } },
      React.createElement(Stack.Screen, { name: 'RemoteServers', component: RemoteServersScreen }),
      React.createElement(Stack.Screen, { name: 'RemoteServerEditor', component: RemoteServerEditorScreen }),
    ),
  ));
  try {
    rtl.fireEvent.press(await view.findByTestId('add-server'));
    rtl.fireEvent.changeText(await view.findByTestId('server-name'), 'Private studio');
    rtl.fireEvent.changeText(view.getByTestId('server-endpoint'), 'http://192.168.1.40:8080');
    rtl.fireEvent.changeText(view.getByTestId('server-api-key'), 'lan-key');
    rtl.fireEvent.press(view.getByTestId('test-connection'));
    expect(await view.findByText(/Connected \(\d+ms\)/)).toBeTruthy();
    rtl.fireEvent.press(view.getByTestId('save-server'));
    expect(await view.findByText('Private studio')).toBeTruthy();
    expect(await view.findByText(/^Connected · /)).toBeTruthy();
    if (status !== 200) server.failAll(status);
    rtl.fireEvent.press(view.getByLabelText('Test'));
    if (status === 200) {
      expect(await view.findByText(/^Connected · /)).toBeTruthy();
      expect(view.queryByText('Could not connect')).toBeNull();
    } else {
      expect(await view.findByText(/rejected the API key/)).toBeTruthy();
    }
  } finally {
    view.unmount();
    server.restore();
    await require('../../../src/services/remoteServerManager').remoteServerManager.clearAllServers();
  }
});
