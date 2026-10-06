/**
 * Two MCP servers publish a tool with the same name. The user turns that tool on for the second
 * server. The switch must stay on that server only, and running the tool must reach that server.
 *
 * Real McpServersScreen + McpToolsScreen on a real native stack, real connect switch, real
 * mcpService/McpClient/store. Only the HTTP transport is faked (harness/mcpHttpFake).
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { McpServersScreen } from '@offgrid/pro/ui/McpServersScreen';
import { McpToolsScreen } from '@offgrid/pro/ui/McpToolsScreen';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { disconnectServer } from '@offgrid/pro/mcp/mcpService';
import { McpToolExtension } from '@offgrid/pro/mcp/McpToolExtension';
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

const ALPHA = { id: 'srv-alpha', name: 'Alpha Docs', url: 'https://alpha.example.test/mcp' };
const BETA = { id: 'srv-beta', name: 'Beta Wiki', url: 'https://beta.example.test/mcp' };

describe('same-named MCP tools stay on the server the user picked', () => {
  let fake: McpHttpFake;

  beforeEach(() => {
    fake = installMcpHttpFake({
      [ALPHA.url]: { label: 'Alpha', tools: [tool('search')] },
      [BETA.url]: { label: 'Beta', tools: [tool('search'), tool('fetch')] },
    });
  });

  afterEach(() => {
    [ALPHA.id, BETA.id].forEach(id => {
      disconnectServer(id);
      useMcpStore.getState().removeServer(id);
    });
    fake.restore();
  });

  it('enabling search on Beta turns it off on Alpha and runs it on Beta', async () => {
    // Saved server configs are the precondition; connecting happens through the real switch.
    useMcpStore.getState().addServer(ALPHA);
    useMcpStore.getState().addServer(BETA);

    const ui = render(
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="McpServers" component={McpServersScreen} />
          <Stack.Screen name="McpTools" component={McpToolsScreen} />
        </Stack.Navigator>
      </NavigationContainer>,
    );

    expect(ui.getByTestId(`mcp-server-status-${ALPHA.id}`)).toHaveTextContent('Inactive');
    fireEvent(ui.getByTestId(`mcp-server-toggle-${ALPHA.id}`), 'valueChange', true);
    await waitFor(() => expect(ui.getByTestId(`mcp-server-status-${ALPHA.id}`)).toHaveTextContent('Active'));
    fireEvent(ui.getByTestId(`mcp-server-toggle-${BETA.id}`), 'valueChange', true);
    await waitFor(() => expect(ui.getByTestId(`mcp-server-status-${BETA.id}`)).toHaveTextContent('Active'));

    // Alpha connected first, so search runs there. Beta's copy is off; its new tool is on.
    expect(ui.getByTestId(`mcp-server-tool-count-${ALPHA.id}`)).toHaveTextContent('1/1 tools');
    expect(ui.getByTestId(`mcp-server-tool-count-${BETA.id}`)).toHaveTextContent('1/2 tools');

    // Open Beta's tools and turn search on there.
    fireEvent.press(ui.getAllByText('Edit Tools')[1]);
    expect(await ui.findByText('Beta Wiki')).toBeTruthy();
    const { Switch } = require('react-native');
    const betaSwitches = () => ui.UNSAFE_getAllByType(Switch).filter(sw => sw.props.testID === undefined);
    expect(betaSwitches().map(sw => sw.props.value)).toEqual([false, true]);
    fireEvent(betaSwitches()[0], 'valueChange', true);
    expect(betaSwitches().map(sw => sw.props.value)).toEqual([true, true]);

    // Back on the list, only Beta claims search now.
    fireEvent.press(ui.getByLabelText('Back'));
    await waitFor(() => expect(ui.getByTestId(`mcp-server-tool-count-${ALPHA.id}`)).toHaveTextContent('0/1 tools'));
    expect(ui.getByTestId(`mcp-server-tool-count-${BETA.id}`)).toHaveTextContent('2/2 tools');

    // The tool loop's call reaches Beta, the server the user picked.
    let result: Awaited<ReturnType<typeof McpToolExtension.execute>> | undefined;
    await act(async () => {
      result = await McpToolExtension.execute({ id: 'call-1', name: 'search', arguments: {} });
    });
    expect(result?.error).toBeUndefined();
    expect(result?.content).toBe('Beta ran search');
    expect(fake.calls).toEqual([{ url: BETA.url, tool: 'search' }]);
  });
});
