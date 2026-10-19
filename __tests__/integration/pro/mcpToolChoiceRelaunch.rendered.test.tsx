/**
 * Two MCP servers publish a tool with the same name. The user turns that tool on for Beta. After the
 * app is closed and opened again, the switch is still on under Beta and off under Alpha, and a call
 * still runs on Beta.
 *
 * Real McpServersScreen + McpToolsScreen on a real native stack, real add-server form, real connect
 * switch, real mcpService/McpClient/store with real zustand persist. A relaunch is a fresh module graph
 * (jest.resetModules) over the same AsyncStorage contents, with Pro activated the way boot does it, so
 * the saved servers reconnect on their own. Only the HTTP transport is faked (harness/mcpHttpFake).
 */
import type { McpHttpFake } from '../../harness/mcpHttpFake';

jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const tool = (name: string) => ({ name, description: `${name} things`, inputSchema: { type: 'object', properties: {} } });

const ALPHA = { name: 'Alpha Docs', url: 'https://alpha.example.test/mcp' };
const BETA = { name: 'Beta Wiki', url: 'https://beta.example.test/mcp' };

type RTL = typeof import('@testing-library/react-native');
type Ui = ReturnType<RTL['render']>;

/** One app process: a fresh module graph, the store hydrating from whatever AsyncStorage holds. */
async function launch() {
  jest.resetModules();
  const React = require('react');
  const { requireRTL } = require('../../harness/nativeBoundary');
  const rtl: RTL = requireRTL();
  const { NavigationContainer } = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { Switch } = require('react-native');
  const { McpServersScreen } = require('@offgrid/pro/ui/McpServersScreen');
  const { McpToolsScreen } = require('@offgrid/pro/ui/McpToolsScreen');
  const { useMcpStore } = require('@offgrid/pro/mcp/mcpStore');
  const { McpToolExtension } = require('@offgrid/pro/mcp/McpToolExtension');
  const { installPro } = require('../../harness/proHarness');

  await installPro();
  await rtl.waitFor(() => expect(useMcpStore.persist.hasHydrated()).toBe(true));

  const Stack = createNativeStackNavigator();
  const ui: Ui = rtl.render(
    React.createElement(
      NavigationContainer,
      null,
      React.createElement(
        Stack.Navigator,
        { screenOptions: { headerShown: false } },
        React.createElement(Stack.Screen, { name: 'McpServers', component: McpServersScreen }),
        React.createElement(Stack.Screen, { name: 'McpTools', component: McpToolsScreen }),
      ),
    ),
  );

  /** The switch on the tool card that shows `toolName` on the open Tools screen. */
  const toolSwitch = (toolName: string) => {
    let node = ui.getByText(toolName).parent;
    while (node && node.findAllByType(Switch).length === 0) node = node.parent;
    if (!node) throw new Error(`no switch beside ${toolName}`);
    return node.findAllByType(Switch)[0];
  };

  /** Cards render in the order the user added the servers: Alpha, then Beta. */
  const openTools = async (serverName: string) => {
    const index = [ALPHA.name, BETA.name].indexOf(serverName);
    rtl.fireEvent.press(ui.getAllByText('Edit Tools')[index]);
    await rtl.waitFor(() => expect(ui.getByText(/TOOLS AVAILABLE/)).toBeTruthy());
    // The list behind is hidden from the user, so the visible name is the Tools screen's header.
    expect(ui.getByText(serverName)).toBeTruthy();
  };

  const goBack = async () => {
    rtl.fireEvent.press(ui.getByLabelText('Back'));
    await rtl.waitFor(() => expect(ui.queryByText(/TOOLS AVAILABLE/)).toBeNull());
  };

  const quit = async () => {
    // Closing the app ends Pro's runtime, which drops every live MCP connection.
    await require('@offgrid/pro').deactivate();
    ui.unmount();
    await new Promise(r => setTimeout(r, 0)); // let persist flush its last write
  };

  return { rtl, ui, toolSwitch, openTools, goBack, quit, McpToolExtension };
}

async function addServerThroughForm(app: Awaited<ReturnType<typeof launch>>, server: { name: string; url: string }) {
  const { rtl, ui } = app;
  rtl.fireEvent.press(ui.getByTestId('mcp-add-server'));
  rtl.fireEvent.press(await ui.findByTestId('add-custom-server'));
  rtl.fireEvent.changeText(await ui.findByPlaceholderText('e.g. Slack'), server.name);
  rtl.fireEvent.changeText(ui.getByPlaceholderText('https://api.example.com/mcp'), server.url);
  rtl.fireEvent.press(ui.getByText('Add'));
  await rtl.waitFor(() => expect(ui.getByLabelText(`${server.name}, Active`)).toBeTruthy());
  // Server ids are minted from the clock; a person never adds two inside one millisecond.
  await new Promise(r => setTimeout(r, 5));
}

describe('the per-server tool choice survives a relaunch', () => {
  let fake: McpHttpFake;

  beforeEach(() => {
    const { installMcpHttpFake } = require('../../harness/mcpHttpFake');
    fake = installMcpHttpFake({
      [ALPHA.url]: { label: 'Alpha', tools: [tool('search')] },
      [BETA.url]: { label: 'Beta', tools: [tool('search'), tool('fetch')] },
    });
  });

  afterEach(() => fake.restore());

  it('search stays on under Beta and off under Alpha after the app restarts, and still runs on Beta', async () => {
    // --- First launch: the user adds both servers and picks Beta for search. ---
    const first = await launch();
    expect(first.ui.getByText('No servers configured')).toBeTruthy();
    await addServerThroughForm(first, ALPHA);
    await addServerThroughForm(first, BETA);

    // Alpha connected first, so search is on there and off on Beta.
    expect(first.ui.getByLabelText(`${ALPHA.name}, 1/1 tools`)).toBeTruthy();
    expect(first.ui.getByLabelText(`${BETA.name}, 1/2 tools`)).toBeTruthy();

    await first.openTools(BETA.name);
    expect(first.toolSwitch('search').props.value).toBe(false);
    expect(first.toolSwitch('fetch').props.value).toBe(true);
    first.rtl.fireEvent(first.toolSwitch('search'), 'valueChange', true);
    expect(first.toolSwitch('search').props.value).toBe(true);
    await first.goBack();

    await first.openTools(ALPHA.name);
    expect(first.toolSwitch('search').props.value).toBe(false);
    await first.goBack();
    expect(first.ui.getByLabelText(`${ALPHA.name}, 0/1 tools`)).toBeTruthy();
    expect(first.ui.getByLabelText(`${BETA.name}, 2/2 tools`)).toBeTruthy();
    await first.quit();

    // --- Relaunch: same storage, fresh process. Boot reconnects both saved servers. ---
    const second = await launch();
    await second.rtl.waitFor(() => expect(second.ui.getByLabelText(`${ALPHA.name}, Active`)).toBeTruthy());
    await second.rtl.waitFor(() => expect(second.ui.getByLabelText(`${BETA.name}, Active`)).toBeTruthy());
    expect(second.ui.getByLabelText(`${ALPHA.name}, 0/1 tools`)).toBeTruthy();
    expect(second.ui.getByLabelText(`${BETA.name}, 2/2 tools`)).toBeTruthy();

    await second.openTools(BETA.name);
    expect(second.toolSwitch('search').props.value).toBe(true);
    expect(second.toolSwitch('fetch').props.value).toBe(true);
    await second.goBack();

    await second.openTools(ALPHA.name);
    expect(second.toolSwitch('search').props.value).toBe(false);
    await second.goBack();

    // The tool loop's call still reaches Beta, the server the user picked before the restart.
    let result: { content?: string; error?: string } | undefined;
    await second.rtl.act(async () => {
      result = await second.McpToolExtension.execute({ id: 'call-1', name: 'search', arguments: {} });
    });
    expect(result?.error).toBeUndefined();
    expect(result?.content).toBe('Beta ran search');
    expect(fake.calls).toEqual([{ url: BETA.url, tool: 'search' }]);
    await second.quit();
  });
});
