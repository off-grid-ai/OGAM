/**
 * The tools screen with no tools tells the user the server's real state and offers the one thing
 * they can do: wait, connect, try again, or go back. It never claims "connect first" while the
 * server is connected, connecting, or gone.
 *
 * Real McpServersScreen + McpToolsScreen on a real native stack, real connect switch and buttons,
 * real mcpService/McpClient/store. Only the HTTP transport is faked (harness/mcpHttpFake).
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { McpServersScreen } from '@offgrid/pro/ui/McpServersScreen';
import { McpToolsScreen } from '@offgrid/pro/ui/McpToolsScreen';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { disconnectServer } from '@offgrid/pro/mcp/mcpService';
import { installMcpHttpFake, type McpHttpFake } from '../../harness/mcpHttpFake';

jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const Stack = createNativeStackNavigator();
const tool = (name: string) => ({ name, description: `${name} things`, inputSchema: { type: 'object', properties: {} } });

const DOCS = { id: 'srv-docs', name: 'Team Docs', url: 'https://docs.example.test/mcp' };
const EMPTY = { id: 'srv-empty', name: 'Blank Server', url: 'https://blank.example.test/mcp' };

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

async function connectFromList(ui: ReturnType<typeof render>, id: string) {
  fireEvent(ui.getByTestId(`mcp-server-toggle-${id}`), 'valueChange', true);
  await waitFor(() => expect(ui.getByTestId(`mcp-server-status-${id}`)).toHaveTextContent('Active'));
}

describe('tools screen empty states', () => {
  let fake: McpHttpFake;

  beforeEach(() => {
    fake = installMcpHttpFake({
      [DOCS.url]: { label: 'Docs', tools: [tool('search'), tool('fetch')] },
      [EMPTY.url]: { label: 'Blank', tools: [] },
    });
  });

  afterEach(() => {
    [DOCS.id, EMPTY.id].forEach(id => {
      disconnectServer(id);
      useMcpStore.getState().removeServer(id);
    });
    fake.restore();
  });

  it('a connected server with no tools says so and Go back returns to the list', async () => {
    useMcpStore.getState().addServer(EMPTY);
    const ui = mountSettings();
    await connectFromList(ui, EMPTY.id);

    fireEvent.press(ui.getByText('Edit Tools'));
    expect(await ui.findByText('Blank Server is connected but has no tools to offer.')).toBeTruthy();
    expect(ui.queryByText(/connect the server first/)).toBeNull();
    expect(ui.queryByTestId('mcp-tools-connect')).toBeNull();

    fireEvent.press(ui.getByTestId('mcp-tools-go-back'));
    await waitFor(() => expect(ui.queryByTestId('mcp-tools-empty')).toBeNull());
    expect(ui.getByTestId(`mcp-server-status-${EMPTY.id}`)).toHaveTextContent('Active');
  });

  it('a dropped connection offers Connect, a failed connect offers Try again, and a held connect shows it is connecting', async () => {
    useMcpStore.getState().addServer(DOCS);
    const ui = mountSettings();
    await connectFromList(ui, DOCS.id);
    fireEvent.press(ui.getByText('Edit Tools'));
    expect(await ui.findByText('search')).toBeTruthy();
    expect(ui.queryByTestId('mcp-tools-empty')).toBeNull();

    // The connection drops while the user is on the screen (the app disconnects it, as when Pro ends).
    await act(async () => { disconnectServer(DOCS.id); });
    expect(ui.getByText('Team Docs is not connected. Connect it to see its tools.')).toBeTruthy();
    expect(ui.queryByText('search')).toBeNull();

    // Connect while the server is unreachable: the screen says it failed and offers Try again.
    fake.setDown(DOCS.url, true);
    await act(async () => { fireEvent.press(ui.getByTestId('mcp-tools-connect')); });
    expect(await ui.findByText('Could not connect to Team Docs.')).toBeTruthy();
    expect(ui.queryByTestId('mcp-tools-connect')).toBeNull();

    // Try again while the server is slow to answer: the user sees it connecting, with no button.
    fake.setDown(DOCS.url, false);
    const slow = fake.holdNext(DOCS.url);
    await act(async () => { fireEvent.press(ui.getByTestId('mcp-tools-retry')); });
    expect(await ui.findByText('Connecting to Team Docs')).toBeTruthy();
    expect(ui.queryByTestId('mcp-tools-retry')).toBeNull();

    await act(async () => { slow.release(); });
    expect(await ui.findByText('search')).toBeTruthy();
    expect(ui.getByText('fetch')).toBeTruthy();
    expect(ui.queryByTestId('mcp-tools-empty')).toBeNull();
  });

  it('a server removed while its tools are open offers Go back', async () => {
    useMcpStore.getState().addServer(DOCS);
    const ui = mountSettings();
    await connectFromList(ui, DOCS.id);
    fireEvent.press(ui.getByText('Edit Tools'));
    expect(await ui.findByText('search')).toBeTruthy();

    // A paired device's tool route, for example, goes away when the device is unpaired.
    await act(async () => {
      disconnectServer(DOCS.id);
      useMcpStore.getState().removeServer(DOCS.id);
    });
    expect(ui.getByText('This server was removed.')).toBeTruthy();

    fireEvent.press(ui.getByTestId('mcp-tools-go-back'));
    await waitFor(() => expect(ui.queryByTestId('mcp-tools-empty')).toBeNull());
    expect(ui.queryByText('Team Docs')).toBeNull();
  });
});
