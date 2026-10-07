/**
 * A tool the user turned on for one MCP server must never switch on for a different server (a
 * different account) by itself. Two ways that used to happen:
 *   1. The chosen server stops listing the tool while no other server lists it. When another
 *      server later connects with a tool of the same name, that server's copy came up on.
 *   2. The chosen server is removed while another server lists the tool. The other server's copy
 *      was off, but its next refresh treated it as a brand-new tool and turned it on.
 * In both, the other server's copy must stay off until the user turns it on.
 *
 * Real McpServersScreen on a real native stack, real connect switch, real mcpService/McpClient/store.
 * Only the HTTP transport (harness/mcpHttpFake) and the native confirm dialog are faked.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { McpServersScreen } from '@offgrid/pro/ui/McpServersScreen';
import { McpToolsScreen } from '@offgrid/pro/ui/McpToolsScreen';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { disconnectServer } from '@offgrid/pro/mcp/mcpService';
import { McpToolExtension } from '@offgrid/pro/mcp/McpToolExtension';
import { installMcpHttpFake, type FakeMcpServer, type McpHttpFake } from '../../harness/mcpHttpFake';

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

const ALPHA = { id: 'srv-alpha', name: 'Alpha Docs', url: 'https://alpha.example.test/mcp' };
const BETA = { id: 'srv-beta', name: 'Beta Wiki', url: 'https://beta.example.test/mcp' };

describe('a tool never switches on for another server by itself', () => {
  let fake: McpHttpFake;
  let alpha: FakeMcpServer;
  let beta: FakeMcpServer;

  beforeEach(() => {
    alpha = { label: 'Alpha', tools: [tool('search')] };
    beta = { label: 'Beta', tools: [tool('search')] };
    fake = installMcpHttpFake({ [ALPHA.url]: alpha, [BETA.url]: beta });
    useMcpStore.getState().addServer(ALPHA);
    useMcpStore.getState().addServer(BETA);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    [ALPHA.id, BETA.id].forEach(id => {
      disconnectServer(id);
      useMcpStore.getState().removeServer(id);
    });
    useMcpStore.setState({ enabledTools: [], knownToolNames: [], toolOwners: {} });
    fake.restore();
  });

  const mount = () => render(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="McpServers" component={McpServersScreen} />
        <Stack.Screen name="McpTools" component={McpToolsScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );

  const setActive = async (ui: ReturnType<typeof mount>, id: string, on: boolean) => {
    fireEvent(ui.getByTestId(`mcp-server-toggle-${id}`), 'valueChange', on);
    await waitFor(() => expect(ui.getByTestId(`mcp-server-status-${id}`)).toHaveTextContent(on ? 'Active' : 'Inactive'));
  };
  const toolCount = (ui: ReturnType<typeof mount>, id: string) => ui.getByTestId(`mcp-server-tool-count-${id}`);

  it('keeps Beta search off after Alpha stops listing it and Beta connects later', async () => {
    const ui = mount();

    // Alpha connects first: its search is discovered and on.
    await setActive(ui, ALPHA.id, true);
    expect(toolCount(ui, ALPHA.id)).toHaveTextContent('1/1 tools');

    // Alpha stops listing search while Beta is offline. A reconnect picks up the new list.
    alpha.tools = [];
    await setActive(ui, ALPHA.id, false);
    await setActive(ui, ALPHA.id, true);
    await waitFor(() => expect(toolCount(ui, ALPHA.id)).toHaveTextContent('0/0 tools'));

    // Beta comes online with its own search. The user never chose it, so it is off.
    await setActive(ui, BETA.id, true);
    await waitFor(() => expect(toolCount(ui, BETA.id)).toHaveTextContent('0/1 tools'));

    // And the tool loop cannot reach Beta's account.
    await act(async () => {
      await McpToolExtension.execute({ id: 'call-1', name: 'search', arguments: {} });
    });
    expect(fake.calls.filter(c => c.url === BETA.url)).toEqual([]);
  });

  it('keeps Beta search off after Alpha is removed and Beta refreshes', async () => {
    const ui = mount();
    await setActive(ui, ALPHA.id, true);
    await setActive(ui, BETA.id, true);
    // Alpha connected first, so search is on there and off on Beta.
    expect(toolCount(ui, ALPHA.id)).toHaveTextContent('1/1 tools');
    expect(toolCount(ui, BETA.id)).toHaveTextContent('0/1 tools');

    // Remove Alpha through its delete control and confirm.
    let confirmRemove: (() => void) | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      confirmRemove = buttons?.find(b => b.style === 'destructive')?.onPress as () => void;
    });
    fireEvent.press(ui.getByLabelText(`Remove ${ALPHA.name}`));
    await act(async () => { confirmRemove?.(); });
    await waitFor(() => expect(ui.queryByTestId(`mcp-server-card-${ALPHA.id}`)).toBeNull());
    expect(toolCount(ui, BETA.id)).toHaveTextContent('0/1 tools');

    // Beta refreshes. Its search is the one the user left off, not a new tool.
    await setActive(ui, BETA.id, false);
    await setActive(ui, BETA.id, true);
    await waitFor(() => expect(toolCount(ui, BETA.id)).toHaveTextContent('0/1 tools'));
  });
});
