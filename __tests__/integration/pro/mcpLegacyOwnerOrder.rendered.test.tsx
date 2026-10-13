/** v0.0.111 had no toolOwners. Saved order must decide the owner after upgrade. */
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { installMcpHttpFake } from '../../harness/mcpHttpFake';

jest.unmock('@react-navigation/native');
// RN's preset omits the native switch's checked accessibility state.
jest.mock('react-native/Libraries/Components/Switch/Switch', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: (props: { value: boolean }) => React.createElement(View, {
    ...props, accessible: true, accessibilityRole: 'switch',
    accessibilityState: { checked: props.value },
  }) };
});

const alpha = { id: 'legacy-alpha', name: 'Alpha Docs', url: 'https://alpha.example.test/mcp' };
const beta = { id: 'legacy-beta', name: 'Beta Docs', url: 'https://beta.example.test/mcp' };
const search = { name: 'search', description: 'Search documents', inputSchema: { type: 'object', properties: {} } };

it.each([['Alpha first', alpha, beta], ['Beta first', beta, alpha]] as const)(
  'keeps the saved last server as the tool owner: %s',
  async (_label, first, second) => {
    installNativeBoundary({ fs: true });
    const storage = require('@react-native-async-storage/async-storage');
    await storage.clear();
    await storage.setItem('mcp_servers_v1', JSON.stringify({
      state: { servers: [alpha, beta], enabledTools: ['search'], knownToolNames: ['search'] },
      version: 0,
    }));
    const fake = installMcpHttpFake({
      [alpha.url]: { label: 'Alpha', tools: [search] },
      [beta.url]: { label: 'Beta', tools: [search] },
    });
    const React = require('react');
    const rtl = requireRTL();
    const { NavigationContainer } = require('@react-navigation/native');
    const { createNativeStackNavigator } = require('@react-navigation/native-stack');
    const { McpServersScreen } = require('../../../pro/ui/McpServersScreen');
    const { McpToolsScreen } = require('../../../pro/ui/McpToolsScreen');
    const { useMcpStore } = require('../../../pro/mcp/mcpStore');
    await useMcpStore.persist.rehydrate();
    const Stack = createNativeStackNavigator();
    const ui = rtl.render(React.createElement(NavigationContainer, null,
      React.createElement(Stack.Navigator, { screenOptions: { headerShown: false } },
        React.createElement(Stack.Screen, { name: 'McpServers', component: McpServersScreen }),
        React.createElement(Stack.Screen, { name: 'McpTools', component: McpToolsScreen }),
      ),
    ));
    try {
      rtl.fireEvent(ui.getByTestId(`mcp-server-toggle-${first.id}`), 'valueChange', true);
      await rtl.waitFor(() => expect(ui.getByTestId(`mcp-server-status-${first.id}`)).toHaveTextContent('Active'));
      rtl.fireEvent(ui.getByTestId(`mcp-server-toggle-${second.id}`), 'valueChange', true);
      await rtl.waitFor(() => expect(ui.getByTestId(`mcp-server-status-${second.id}`)).toHaveTextContent('Active'));
      expect(ui.getByTestId(`mcp-server-tool-count-${alpha.id}`)).toHaveTextContent('0/1 tools');
      expect(ui.getByTestId(`mcp-server-tool-count-${beta.id}`)).toHaveTextContent('1/1 tools');
      rtl.fireEvent.press(ui.getAllByText('Edit Tools')[1]);
      expect(await ui.findByText('Beta Docs')).toBeTruthy();
      expect(ui.getByRole('switch', { checked: true })).toBeTruthy();
      expect(ui.getByText('Disable All')).toBeEnabled();
      expect(ui.getByText('Enable All')).toBeDisabled();
    } finally {
      ui.unmount();
      const { disconnectServer } = require('../../../pro/mcp/mcpService');
      disconnectServer(alpha.id);
      disconnectServer(beta.id);
      fake.restore();
    }
  },
);
