/**
 * A server that needs the user to sign in, with no tools loaded yet, says so on its Tools screen:
 * "Waiting for you to sign in" with the busy dots, and never "connect it to see its tools" or a
 * Connect button that would start a second sign-in.
 *
 * Real McpServersScreen + McpToolsScreen on a real native stack, real connect switch and buttons,
 * real OAuth client and token store, real mcpService/McpClient/store, Pro activated the way boot
 * does it. Fakes sit only at the boundaries: the network (fetch + XMLHttpRequest), the Keychain,
 * the sign-in browser and the clock (harness/mcpOAuthFake).
 *
 * Why the precondition is an earlier session's sign-in and not the add-server form: a first
 * sign-in runs the MCP SDK's discovery, which the app loads with a dynamic import() of an ESM
 * build (pro/mcp/oauth/metadata.ts:52) that jest cannot execute, so no OAuth server can reach
 * "connected" through the form under jest. A server the user signed in to before (cached OAuth
 * metadata in its saved config, token in the Keychain) connects without discovery, exactly as on
 * the device. The sign-in the user is then waiting on is held at the provider's first answer.
 */
jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});
jest.mock('react-native-keychain', () => require('../../harness/mcpOAuthFake').createKeychainBoundary());
jest.mock('react-native-inappbrowser-reborn', () => ({
  __esModule: true,
  default: require('../../harness/mcpOAuthFake').createSignInBrowserBoundary(),
}));
// Node already provides crypto.getRandomValues; the RN polyfill's native module does not exist here.
jest.mock('react-native-get-random-values', () => ({}), { virtual: true });

import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Keychain from 'react-native-keychain';
import { McpServersScreen } from '@offgrid/pro/ui/McpServersScreen';
import { McpToolsScreen } from '@offgrid/pro/ui/McpToolsScreen';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { disconnectServer } from '@offgrid/pro/mcp/mcpService';
import { installPro } from '../../harness/proHarness';
import { installMcpOAuthFake, type McpOAuthFake } from '../../harness/mcpOAuthFake';

const Stack = createNativeStackNavigator();
const tool = (name: string) => ({ name, description: `${name} things`, inputSchema: { type: 'object', properties: {} } });

const DOCS = { id: 'srv-docs-hub', name: 'Docs Hub', url: 'https://docs-hub.example.test/mcp' };

function mountSettings() {
  return render(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="McpServers" component={McpServersScreen} />
        <Stack.Screen name="McpTools" component={McpToolsScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

describe('tools screen while the server waits for sign-in', () => {
  let fake: McpOAuthFake;
  let clockOffsetMs = 0;
  const realNow = Date.now.bind(Date);

  beforeEach(async () => {
    clockOffsetMs = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffsetMs);
    fake = installMcpOAuthFake(
      { [DOCS.url]: { label: 'Docs', tools: [tool('search'), tool('fetch')] } },
      [DOCS.url],
      Keychain as unknown as Parameters<typeof installMcpOAuthFake>[2],
    );
    await installPro();
  });

  afterEach(async () => {
    fake.restore();
    await require('@offgrid/pro').deactivate();
    useMcpStore.getState().servers.forEach(s => useMcpStore.getState().removeServer(s.id));
    jest.restoreAllMocks();
  });

  it('shows "waiting for you to sign in" with busy dots, not "connect it", while sign-in is under way', async () => {
    // Saved from an earlier session in which the user signed in to Docs Hub.
    const oauth = await fake.signedInEarlier(DOCS.id, DOCS.url);
    useMcpStore.getState().addServer({ ...DOCS, authMode: 'oauth', oauth });

    const ui = mountSettings();
    expect(ui.getByTestId(`mcp-server-status-${DOCS.id}`)).toHaveTextContent('Inactive');
    fireEvent(ui.getByTestId(`mcp-server-toggle-${DOCS.id}`), 'valueChange', true);
    await waitFor(() => expect(ui.getByTestId(`mcp-server-status-${DOCS.id}`)).toHaveTextContent('Active'));
    expect(ui.getByTestId(`mcp-server-tool-count-${DOCS.id}`)).toHaveTextContent('2/2 tools');

    fireEvent.press(ui.getByText('Edit Tools'));
    expect(await ui.findByText('search')).toBeTruthy();
    expect(ui.queryByTestId('mcp-tools-empty')).toBeNull();

    // Two hours later the sign-in has expired, and the connection drops while the user is here
    // (the app disconnects it, as when Pro ends).
    clockOffsetMs = 2 * 60 * 60 * 1000;
    await act(async () => { disconnectServer(DOCS.id); });
    expect(ui.getByText(`${DOCS.name} is not connected. Connect it to see its tools.`)).toBeTruthy();
    expect(ui.getByTestId('mcp-tools-connect')).toBeTruthy();
    expect(ui.queryByText(/Waiting for you to sign in/)).toBeNull();

    // Connect needs a fresh sign-in. While it is under way the screen says it is waiting for the user.
    fake.holdSignInProbe(DOCS.url);
    await act(async () => { fireEvent.press(ui.getByTestId('mcp-tools-connect')); });
    const empty = await ui.findByTestId('mcp-tools-empty');
    await waitFor(() => expect(within(empty).getByText(`Waiting for you to sign in to ${DOCS.name}`)).toBeTruthy());
    expect(within(empty).getByLabelText('Working')).toBeTruthy();
    expect(ui.queryByText(/Connect it to see its tools/)).toBeNull();
    expect(ui.queryByText(/connect the server first/i)).toBeNull();
    expect(ui.queryByTestId('mcp-tools-connect')).toBeNull();
    expect(ui.queryByTestId('mcp-tools-retry')).toBeNull();
    expect(ui.queryByText('search')).toBeNull();
  });
});
