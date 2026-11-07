/**
 * Remove server lives on the server's own screen (13423b4e8): the Remote Servers list keeps one
 * action per row, which opens the server.
 *
 * Product-correct outcome (the person's view): they open a saved server, tap Remove server and
 * confirm. They land back on the list, the server is gone from it and from the phone, and a server
 * that was in use is no longer in use. Cancel keeps everything as it was.
 *
 * Real RemoteServersScreen + RemoteServerEditorScreen on a real native stack; real form, manager,
 * stores and health check. Fakes only at the device boundary: the network (harness/keyedRemoteServer)
 * and the Keychain (a stateful store).
 */
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { RemoteServerEditorScreen } from '../../../src/screens/RemoteServerEditorScreen';
import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { useRemoteServerStore } from '../../../src/stores';
import {
  installKeyedServer,
  resetKeychain,
  type KeyedServerHandle,
} from '../../harness/keyedRemoteServer';

jest.unmock('@react-navigation/native');
jest.mock('react-native-keychain', () =>
  require('../../harness/keyedRemoteServer').keychainModule(),
);

const ORIGIN = 'https://studio.example.test';
const API_KEY = 'sk-lm-studio-key';
const MODEL = 'qwen3-8b';
const SERVER_NAME = 'Studio LM Studio';

const Stack = createNativeStackNavigator();

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

/** Add the keyed server through the real add-server screen, put it in use, and open it again. */
async function addServerAndOpenIt(ui: Ui): Promise<string> {
  fireEvent.press(ui.getByTestId('open-remote-servers'));
  fireEvent.press(await waitFor(() => ui.getByTestId('add-server')));
  fireEvent.changeText(ui.getByTestId('server-name'), SERVER_NAME);
  fireEvent.changeText(ui.getByTestId('server-endpoint'), ORIGIN);
  fireEvent.changeText(ui.getByTestId('server-api-key'), API_KEY);
  fireEvent.press(ui.getByTestId('test-connection'));
  await waitFor(() => expect(ui.getByText(/Connected \(\d+ms\)/)).toBeTruthy());
  fireEvent.press(ui.getByTestId('save-server'));
  fireEvent.press(await waitFor(() => ui.getByText('Continue')));
  await waitFor(() => expect(ui.getByText(SERVER_NAME)).toBeTruthy());

  const id = useRemoteServerStore.getState().servers[0].id;
  useRemoteServerStore.getState().setActiveServerId(id);

  fireEvent.press(ui.getByLabelText(`Edit ${SERVER_NAME}`));
  await waitFor(() => expect(ui.getByText('Edit server')).toBeTruthy());
  return id;
}

describe('removing a server from its own screen', () => {
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

  it('a new server offers no Remove', async () => {
    const ui = mountApp();
    fireEvent.press(ui.getByTestId('open-remote-servers'));
    fireEvent.press(await waitFor(() => ui.getByTestId('add-server')));
    await waitFor(() => expect(ui.getByText('Add a server')).toBeTruthy());
    expect(ui.queryByTestId('remove-server')).toBeNull();
  });

  it('Remove, confirmed, takes the server off the phone and out of use, and returns to the list', async () => {
    const ui = mountApp();
    const id = await addServerAndOpenIt(ui);
    expect(useRemoteServerStore.getState().activeServerId).toBe(id);

    fireEvent.press(ui.getByTestId('remove-server'));
    expect(ui.getByText('Remove this server')).toBeTruthy();
    fireEvent.press(ui.getByRole('button', { name: 'Remove' }));

    // Back on the list, which now says it has no servers.
    await waitFor(() => expect(ui.queryByText('Edit server')).toBeNull());
    await waitFor(() => expect(ui.getByText('No servers yet')).toBeTruthy());
    expect(ui.queryByText(SERVER_NAME)).toBeNull();
    expect(useRemoteServerStore.getState().servers.find(item => item.id === id)).toBeUndefined();
    expect(useRemoteServerStore.getState().activeServerId).toBeNull();
  });

  it('Cancel keeps the server, still in use, and stays on its screen', async () => {
    const ui = mountApp();
    const id = await addServerAndOpenIt(ui);

    fireEvent.press(ui.getByTestId('remove-server'));
    fireEvent.press(ui.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(ui.queryByText('Remove this server')).toBeNull());
    expect(ui.getByText('Edit server')).toBeTruthy();
    expect(useRemoteServerStore.getState().servers.map(item => item.id)).toContain(id);
    expect(useRemoteServerStore.getState().activeServerId).toBe(id);
  });
});
