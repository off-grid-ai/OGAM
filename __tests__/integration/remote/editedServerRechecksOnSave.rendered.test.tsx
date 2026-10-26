/**
 * Saving an edited remote server checks it again, so the Remote Servers list shows its new status
 * (commit b47b2253c).
 *
 * Product-correct outcome (the person's view): a server's key changed on the server, so its row on
 * Remote Servers reads "Not answering". The person opens Edit, types the new key, checks it and saves. Back on
 * the list, without tapping Test, the row reads "Connected". The list screen stays mounted under the
 * editor, so only the save itself can bring the new status.
 *
 * Real RemoteServersScreen + RemoteServerEditorScreen on a real native stack; real form, manager,
 * stores and health check. Fakes only at the device boundary: the network (harness/keyedRemoteServer,
 * a server that refuses requests without its current key) and the Keychain (a stateful store).
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
  type KeyedServerHandle,
} from '../../harness/keyedRemoteServer';

jest.unmock('@react-navigation/native');
jest.mock('react-native-keychain', () =>
  require('../../harness/keyedRemoteServer').keychainModule(),
);

const ORIGIN = 'https://studio.example.test';
const OLD_KEY = 'sk-lm-studio-before';
const NEW_KEY = 'sk-lm-studio-rotated';
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

function serverRow(ui: Ui) {
  const { useRemoteServerStore } = require('../../../src/stores');
  const id = useRemoteServerStore.getState().servers[0].id;
  return within(ui.getByTestId(`server-${id}`));
}

describe('saving an edited remote server', () => {
  let server: KeyedServerHandle;

  beforeEach(async () => {
    resetKeychain();
    await remoteServerManager.clearAllServers();
    server = installKeyedServer({ origin: ORIGIN, flavour: 'lmstudio', apiKey: OLD_KEY, modelId: MODEL });
  });

  afterEach(async () => {
    server.restore();
    await remoteServerManager.clearAllServers();
  });

  it('a new key saved in the editor shows the server Connected on the list, without tapping Test', async () => {
    const ui = mountApp();

    // Add the server with its key through the real add-server screen.
    fireEvent.press(ui.getByTestId('open-remote-servers'));
    await waitFor(() => expect(ui.getByTestId('add-server')).toBeTruthy());
    fireEvent.press(ui.getByTestId('add-server'));
    await waitFor(() => expect(ui.getByText('Add a server')).toBeTruthy());
    fireEvent.changeText(ui.getByTestId('server-name'), SERVER_NAME);
    fireEvent.changeText(ui.getByTestId('server-endpoint'), ORIGIN);
    fireEvent.changeText(ui.getByTestId('server-api-key'), OLD_KEY);
    fireEvent.press(ui.getByTestId('test-connection'));
    await waitFor(() => expect(ui.getByText(/Connected \(\d+ms\)/)).toBeTruthy());
    fireEvent.press(ui.getByTestId('save-server'));
    fireEvent.press(await waitFor(() => ui.getByText('Continue')));
    await waitFor(() => expect(serverRow(ui).getByText('Connected')).toBeTruthy());

    // The key is rotated on the server: the old one is refused, and Test says so on the row.
    server.restore();
    server = installKeyedServer({ origin: ORIGIN, flavour: 'lmstudio', apiKey: NEW_KEY, modelId: MODEL });
    fireEvent.press(serverRow(ui).getByText('Test'));
    await waitFor(() => expect(ui.getByText('Could not connect')).toBeTruthy());
    fireEvent.press(ui.getByText('OK'));
    // BEFORE: the row reads Not answering.
    await waitFor(() => expect(serverRow(ui).getByText('Not answering')).toBeTruthy());
    expect(serverRow(ui).queryByText('Connected')).toBeNull();

    // The person types the new key in the editor and saves.
    fireEvent.press(serverRow(ui).getByText('Edit'));
    await waitFor(() => expect(ui.getByText('Edit server')).toBeTruthy());
    fireEvent.changeText(ui.getByTestId('server-api-key'), NEW_KEY);
    // The editor saves only after its own check of the values typed in it.
    fireEvent.press(ui.getByTestId('test-connection'));
    await waitFor(() => expect(ui.getByText(/Connected \(\d+ms\)/)).toBeTruthy());
    fireEvent.press(ui.getByTestId('save-server'));
    fireEvent.press(await waitFor(() => ui.getByText('Continue')));
    await waitFor(() => expect(ui.queryByText('Edit server')).toBeNull());

    // AFTER: back on the list, the row shows the status of the server as it is now.
    await waitFor(() => expect(serverRow(ui).getByText('Connected')).toBeTruthy());
    expect(serverRow(ui).queryByText('Not answering')).toBeNull();
    expect(ui.queryByText('Could not connect')).toBeNull();
  });
});
