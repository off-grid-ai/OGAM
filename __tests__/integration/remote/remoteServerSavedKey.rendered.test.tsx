/**
 * A remote server saved with an API key, as the user sees it on the Remote Servers screen.
 *
 * The user adds an HTTPS server with its key through the real add-server screen, then lives with it:
 * the list re-checks it each time the screen opens, they tap Test, and they open its editor. Each of
 * those checks must use the saved key, and when the key is refused or cannot be read, the screen must
 * say the check failed - never "Connected", and never a server that simply has no models.
 *
 * Real RemoteServersScreen + RemoteServerEditorScreen on a real native stack; real form, manager,
 * stores, health check, discovery and capability probes. Fakes only at the device boundary: the
 * network (harness/keyedRemoteServer, a server that refuses requests without its key) and the
 * Keychain (a stateful store that can fail reads).
 */
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { RemoteServerEditorScreen } from '../../../src/screens/RemoteServerEditorScreen';
import { remoteServerManager } from '../../../src/services/remoteServerManager';
import {
  installKeyedServer,
  resetKeychain,
  setKeychainUnreadable,
  type KeyedServerHandle,
} from '../../harness/keyedRemoteServer';

jest.unmock('@react-navigation/native');
jest.mock('react-native-keychain', () =>
  require('../../harness/keyedRemoteServer').keychainModule(),
);

const ORIGIN = 'https://studio.example.test';
const API_KEY = 'sk-lm-studio-correct';
const MODEL = 'qwen3-8b';
const SERVER_NAME = 'Studio LM Studio';

const Stack = createNativeStackNavigator();

/** The screen the user comes from (Settings, in the app): one way into Remote Servers. */
const Launcher: React.FC = () => {
  const navigation = useNavigation<any>();
  return (
    <View>
      <TouchableOpacity testID="open-remote-servers" onPress={() => navigation.navigate('RemoteServers')}>
        <Text>Remote Servers</Text>
      </TouchableOpacity>
    </View>
  );
};

function mountApp() {
  return render(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Screen name="Launcher" component={Launcher} />
        <Stack.Screen name="RemoteServers" component={RemoteServersScreen} />
        <Stack.Screen name="RemoteServerEditor" component={RemoteServerEditorScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

type Ui = ReturnType<typeof mountApp>;

async function openRemoteServers(ui: Ui) {
  fireEvent.press(ui.getByTestId('open-remote-servers'));
  await waitFor(() => expect(ui.getByTestId('add-server')).toBeTruthy());
}

/** Leave Remote Servers with the header back button, then open it again. */
async function reopenRemoteServers(ui: Ui) {
  fireEvent.press(ui.getByLabelText('Back'));
  await waitFor(() => expect(ui.queryByTestId('add-server')).toBeNull());
  await openRemoteServers(ui);
}

/** The status line on the saved server's row. */
function serverRow(ui: Ui) {
  const { useRemoteServerStore } = require('../../../src/stores');
  const id = useRemoteServerStore.getState().servers[0].id;
  return within(ui.getByTestId(`server-${id}`));
}

/** Add the keyed HTTPS server through the real add-server screen and land back on the list. */
async function addKeyedServerViaUI(ui: Ui) {
  await openRemoteServers(ui);
  expect(ui.getByText('No servers yet')).toBeTruthy();

  fireEvent.press(ui.getByTestId('add-server'));
  await waitFor(() => expect(ui.getByText('Add a server')).toBeTruthy());
  fireEvent.changeText(ui.getByTestId('server-name'), SERVER_NAME);
  fireEvent.changeText(ui.getByTestId('server-endpoint'), ORIGIN);
  fireEvent.changeText(ui.getByTestId('server-api-key'), API_KEY);
  fireEvent.press(ui.getByTestId('test-connection'));
  await waitFor(() => expect(ui.getByText(/Connected \(\d+ms\)/)).toBeTruthy());

  fireEvent.press(ui.getByTestId('save-server'));
  // An HTTPS address on the public internet asks before saving.
  fireEvent.press(await waitFor(() => ui.getByText('Continue')));

  await waitFor(() => expect(ui.queryByText('Add a server')).toBeNull());
  await waitFor(() => expect(ui.getByText(SERVER_NAME)).toBeTruthy());
  await waitFor(() => expect(serverRow(ui).getByText('Connected')).toBeTruthy());
  expect(ui.queryByText('No servers yet')).toBeNull();
}

describe('a saved API key on the Remote Servers screen', () => {
  let server: KeyedServerHandle;

  beforeEach(async () => {
    resetKeychain();
    await remoteServerManager.clearAllServers();
    server = installKeyedServer({ origin: ORIGIN, flavour: 'lmstudio', apiKey: API_KEY, modelId: MODEL });
  });

  afterEach(async () => {
    server.restore();
    await remoteServerManager.clearAllServers();
  });

  it('opening the screen checks the server with its saved key and shows it connected', async () => {
    const ui = mountApp();
    await addKeyedServerViaUI(ui);

    // The server goes down for a moment: the user's Test shows it is not answering.
    server.failAll(503);
    fireEvent.press(serverRow(ui).getByText('Test'));
    await waitFor(() => expect(ui.getByText('Could not connect')).toBeTruthy());
    fireEvent.press(ui.getByText('OK'));
    await waitFor(() => expect(serverRow(ui).getByText('Not answering')).toBeTruthy());

    // It comes back. Reopening the screen re-checks it; the server refuses any request without the
    // key, so the row only reads Connected if that check carried the saved key.
    server.failAll(null);
    await reopenRemoteServers(ui);
    await waitFor(() => expect(serverRow(ui).getByText('Connected')).toBeTruthy());
    expect(serverRow(ui).queryByText('Not answering')).toBeNull();
  });

  it('an LM Studio that refuses the key on its model probe reads as a refused key, not a healthy server', async () => {
    const ui = mountApp();
    await addKeyedServerViaUI(ui);

    // The key loses its inference rights: LM Studio still lists models with it, but refuses the
    // chat request the app uses to learn whether the model thinks.
    server.refusePaths(['/v1/chat/completions']);

    fireEvent.press(serverRow(ui).getByText('Test'));
    await waitFor(() => expect(ui.getByText('Could not connect')).toBeTruthy());
    expect(ui.getByText(/rejected the saved API key \(HTTP 401\)/)).toBeTruthy();
    fireEvent.press(ui.getByText('OK'));
    await waitFor(() => expect(serverRow(ui).getByText('Not answering')).toBeTruthy());
    expect(serverRow(ui).queryByText('Connected')).toBeNull();

    // The editor's own check, run with the key it loads from the Keychain, says the same thing
    // rather than "Connected" with no models.
    fireEvent.press(serverRow(ui).getByText('Edit'));
    await waitFor(() => expect(ui.getByText('Edit server')).toBeTruthy());
    fireEvent.press(ui.getByLabelText('Show API key'));
    await waitFor(() => expect(ui.getByDisplayValue(API_KEY)).toBeTruthy());
    fireEvent.press(ui.getByTestId('test-connection'));
    await waitFor(() => expect(ui.getByText(/rejected the saved API key \(HTTP 401\)/)).toBeTruthy());
    expect(ui.queryByText(/Connected \(/)).toBeNull();
    expect(ui.queryByText(/model(s)? available/)).toBeNull();
  });

  it('a saved key that cannot be read makes the check fail on screen instead of keeping Connected', async () => {
    const ui = mountApp();
    await addKeyedServerViaUI(ui);

    // The Keychain stops answering for this server's key (the device is locked, or the item is damaged).
    setKeychainUnreadable(true);

    // Opening the screen runs its check, which cannot read the key: the earlier Connected must go.
    await reopenRemoteServers(ui);
    await waitFor(() => expect(serverRow(ui).getByText('Not answering')).toBeTruthy());
    expect(serverRow(ui).queryByText('Connected')).toBeNull();

    // Tapping Test says the check could not run.
    fireEvent.press(serverRow(ui).getByText('Test'));
    await waitFor(() => expect(ui.getByText('Could not connect')).toBeTruthy());
    fireEvent.press(ui.getByText('OK'));
    await waitFor(() => expect(ui.queryByText('Could not connect')).toBeNull());
    expect(serverRow(ui).getByText('Not answering')).toBeTruthy();
    expect(serverRow(ui).queryByText('Connected')).toBeNull();
  });
});
