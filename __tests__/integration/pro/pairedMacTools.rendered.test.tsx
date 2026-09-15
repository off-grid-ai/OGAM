import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { McpServersScreen } from '@offgrid/pro/ui/McpServersScreen';
import { McpToolsScreen } from '@offgrid/pro/ui/McpToolsScreen';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { useSyncStore } from '@offgrid/pro/sync/syncStore';

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
const macId = 'paired-mac';
const httpId = 'mac-mcp';
const meshId = `mesh-task-${macId}`;
const tool = (name: string) => ({ name, description: `${name} on the Mac`, inputSchema: { type: 'object', properties: {} } });

describe('paired Mac tools in Pro settings', () => {
  const pairedMac = {
    id: macId,
    name: 'Mac tools',
    platform: 'macos' as const,
    version: '1',
    host: 'mac.local',
    port: 37878,
    status: 'connected' as const,
    pairedAt: 1,
    lastSeenAt: 1,
  };

  afterEach(() => {
    const mcp = useMcpStore.getState();
    mcp.removeServer(httpId);
    mcp.removeServer(meshId);
    useSyncStore.getState().reset();
  });

  it('shows one Mac card when its MCP server already lists both task tools', async () => {
    useSyncStore.getState().setKnownDevices([pairedMac]);
    const mcp = useMcpStore.getState();
    mcp.addServer({ id: httpId, name: 'Mac tools', url: 'http://mac.local/mcp', grantedByDeviceId: macId });
    mcp.setConnectionState(httpId, 'connected');
    mcp.setServerTools(httpId, [tool('web_use'), tool('computer_use'), tool('calendar_list')]);
    mcp.addServer({ id: meshId, name: 'Mac tools', url: `sync://${macId}`, grantedByDeviceId: macId });
    mcp.setConnectionState(meshId, 'connected');
    mcp.setServerTools(meshId, [tool('web_use'), tool('computer_use')]);

    const ui = render(
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="McpServers" component={McpServersScreen} />
          <Stack.Screen name="McpTools" component={McpToolsScreen} />
        </Stack.Navigator>
      </NavigationContainer>,
    );

    expect(ui.getAllByText('Mac tools')).toHaveLength(1);
    expect(ui.getByText('3/3 tools enabled')).toBeTruthy();
    expect(ui.getByText('Edit Tools')).toBeTruthy();
    expect(ui.queryByText('3/3 tools')).toBeNull();
    expect(ui.queryByText('2/2 tools')).toBeNull();
    fireEvent.press(ui.getByText('Edit Tools'));
    expect(await ui.findByText('web_use')).toBeTruthy();
    expect(ui.getByText('calendar_list')).toBeTruthy();
  });

  it('keeps a connecting MCP route behind the active Desktop card', () => {
    useSyncStore.getState().setKnownDevices([pairedMac]);
    const mcp = useMcpStore.getState();
    mcp.addServer({ id: httpId, name: 'Mac tools', url: 'http://mac.local/mcp', grantedByDeviceId: macId });
    mcp.setConnectionState(httpId, 'connecting');
    mcp.addServer({ id: meshId, name: 'Mac tools', url: `sync://${macId}`, grantedByDeviceId: macId });
    mcp.setConnectionState(meshId, 'connected');
    mcp.setServerTools(meshId, [tool('web_use'), tool('computer_use')]);

    const ui = render(
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="McpServers" component={McpServersScreen} />
          <Stack.Screen name="McpTools" component={McpToolsScreen} />
        </Stack.Navigator>
      </NavigationContainer>,
    );

    expect(ui.getAllByText('Mac tools')).toHaveLength(1);
    expect(ui.getByText('2/2 tools enabled')).toBeTruthy();
    expect(ui.queryByText(`sync://${macId}`)).toBeNull();
    expect(ui.queryByText('2/2 tools')).toBeNull();
    expect(ui.queryByText('http://mac.local/mcp')).toBeNull();
  });
});
