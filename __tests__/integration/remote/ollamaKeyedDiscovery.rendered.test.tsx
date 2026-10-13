/**
 * Ollama behind HTTPS with an API key: the models it serves reach the model picker.
 *
 * The user starts on Home with no models, taps Add Remote Server, adds their Ollama (an HTTPS address
 * with a key) through the real add-server screen, comes back to Home and opens the model picker. The
 * Ollama answers its model list and capability probe only to requests carrying the key, so its model
 * shows in the picker only if discovery sent the key.
 *
 * Real HomeScreen, RemoteServersScreen and RemoteServerEditorScreen on a real native stack, with the
 * real picker, manager, stores, discovery and probes. Fakes only at the device boundary: native
 * modules (installNativeBoundary), the network (harness/keyedRemoteServer) and the Keychain.
 */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { installKeyedServer, resetKeychain, type KeyedServerHandle } from '../../harness/keyedRemoteServer';

jest.unmock('@react-navigation/native');
jest.mock('react-native-keychain', () =>
  require('../../harness/keyedRemoteServer').keychainModule(),
);

const ORIGIN = 'https://ollama.example.test';
const API_KEY = 'ollama-proxy-key';
const MODEL = 'llama3.2:3b';

describe('Ollama over HTTPS with a saved key', () => {
  let server: KeyedServerHandle | undefined;

  afterEach(async () => {
    server?.restore();
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    await remoteServerManager.clearAllServers();
  });

  it('lists the Ollama models in the model picker once the keyed server is added', async () => {
    installNativeBoundary();
    resetKeychain();
    const React = require('react');
    const rtl = requireRTL();
    const { NavigationContainer } = require('@react-navigation/native');
    const { createNativeStackNavigator } = require('@react-navigation/native-stack');
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    const { RemoteServersScreen } = require('../../../src/screens/RemoteServersScreen');
    const { RemoteServerEditorScreen } = require('../../../src/screens/RemoteServerEditorScreen');
    server = installKeyedServer({ origin: ORIGIN, flavour: 'ollama', apiKey: API_KEY, modelId: MODEL });

    const Stack = createNativeStackNavigator();
    const ui = rtl.render(
      React.createElement(
        NavigationContainer,
        null,
        React.createElement(
          Stack.Navigator,
          { screenOptions: { headerShown: false, animation: 'none' } },
          React.createElement(Stack.Screen, { name: 'Home', component: HomeScreen }),
          React.createElement(Stack.Screen, { name: 'RemoteServers', component: RemoteServersScreen }),
          React.createElement(Stack.Screen, { name: 'RemoteServerEditor', component: RemoteServerEditorScreen }),
        ),
      ),
    );
    const { fireEvent, waitFor } = rtl;

    // Before: Home has no model to offer and nothing from a network server.
    await waitFor(() => expect(ui.getByText('Choose a model here or on your network.')).toBeTruthy());
    expect(ui.queryByText(MODEL)).toBeNull();

    // Add the Ollama through the real screens.
    fireEvent.press(ui.getByTestId('add-server-button'));
    fireEvent.press(await waitFor(() => ui.getByTestId('add-server')));
    await waitFor(() => expect(ui.getByText('Add a server')).toBeTruthy());
    fireEvent.changeText(ui.getByTestId('server-name'), 'Home Ollama');
    fireEvent.changeText(ui.getByTestId('server-endpoint'), ORIGIN);
    fireEvent.changeText(ui.getByTestId('server-api-key'), API_KEY);
    fireEvent.press(ui.getByTestId('test-connection'));
    await waitFor(() => expect(ui.getByText(/Connected \(\d+ms\)\s+1 model available/)).toBeTruthy());
    fireEvent.press(ui.getByTestId('save-server'));
    fireEvent.press(await waitFor(() => ui.getByText('Continue')));
    await waitFor(() => expect(ui.getByText('Home Ollama')).toBeTruthy());
    await waitFor(() => expect(ui.getByText('Connected')).toBeTruthy());

    // Back on Home, the picker lists the Ollama's model.
    fireEvent.press(ui.getByLabelText('Back'));
    await waitFor(() => expect(ui.getByText('Select a text or image model to start')).toBeTruthy());
    fireEvent.press(ui.getByTestId('browse-models-button'));
    await waitFor(() => expect(ui.getByText(MODEL)).toBeTruthy());
  });
});
