/**
 * McpToolsScreen (Pro) Tests
 *
 * Drives the REAL McpToolsScreen against the REAL useMcpStore. Only genuine boundaries
 * are mocked: the Feather icon shim and navigation; the real theme runs. Everything the tests assert
 * (the enabled-tools set, per-tool toggle, Turn all on/off, search filter, empty
 * states, header/back) exercises the real component + real store state.
 *
 * Lives in the private pro/ submodule, loaded via a computed path so the suite skips in
 * open-core CI where pro/ is absent.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { withNavigatorRoutes } from '../../harness/realNavigation';
import type { McpTool } from '@offgrid/pro/mcp/types';

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});


let routeParams: { serverId: string } = { serverId: 'srv-1' };
// Real navigation: the screen is the top of a real stack (harness/realNavigation withNavigatorRoutes).
jest.unmock('@react-navigation/native');

type ScreenModule = typeof import('@offgrid/pro/ui/McpToolsScreen');
type StoreModule = typeof import('@offgrid/pro/mcp/mcpStore');

function load(): { screen: ScreenModule; store: StoreModule } | null {
  try {
    return {
      screen: require(['..', '..', '..', 'pro', 'ui', 'McpToolsScreen'].join('/')),
      store: require(['..', '..', '..', 'pro', 'mcp', 'mcpStore'].join('/')),
    };
  } catch {
    return null;
  }
}

const mods = load();
const maybe = mods ? describe : describe.skip;

maybe('McpToolsScreen', () => {
  const { McpToolsScreen } = mods!.screen;
  const { useMcpStore } = mods!.store;

  const tool = (name: string, description = 'does a thing', props: Record<string, any> = {}): McpTool => ({
    name,
    description,
    inputSchema: { type: 'object', properties: props },
  });

  const initial = useMcpStore.getState();

  // A connected server owns the tools it lists (the first server to list a name keeps it).
  const ownersOf = (serverTools: Record<string, McpTool[]> = {}): Record<string, string> => {
    const owners: Record<string, string> = {};
    Object.entries(serverTools).forEach(([id, list]) => list.forEach(t => { owners[t.name] ??= id; }));
    return owners;
  };

const seed = (opts: {
    serverId?: string;
    servers?: any[];
    serverTools?: Record<string, McpTool[]>;
    enabledTools?: string[];
  }) => {
    routeParams = { serverId: opts.serverId ?? 'srv-1' };
    useMcpStore.setState({
      servers: opts.servers ?? [],
      serverTools: opts.serverTools ?? {},
      enabledTools: opts.enabledTools ?? [],
      connectionStates: {},
      toolOwners: ownersOf(opts.serverTools),
      knownToolNames: [],
    });
  };

  afterEach(() => {
    jest.clearAllMocks();
    useMcpStore.setState(initial, true);
  });

  it('renders the server name in the header and back navigates', () => {
    seed({
      serverId: 'srv-1',
      servers: [{ id: 'srv-1', name: 'Notion', url: 'https://x/mcp' }],
      serverTools: { 'srv-1': [tool('find')] },
    });
    render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    expect(require('@testing-library/react-native').screen.getByText('Notion')).toBeTruthy();
    fireEvent.press(require('@testing-library/react-native').screen.getByText('arrow-left'));
    expect(require('@testing-library/react-native').screen.getByTestId('route-Previous')).toBeTruthy();
  });

  it('falls back to "Tools" when the server is not found', () => {
    seed({ serverId: 'missing', servers: [], serverTools: {} });
    const { getByText } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    expect(getByText('Tools')).toBeTruthy();
  });

  it('says a missing server was removed and offers Go back', () => {
    seed({ serverId: 'srv-1', serverTools: {} });
    const { getByText, getByTestId } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    expect(getByText('This server was removed.')).toBeTruthy();
    expect(getByTestId('mcp-tools-summary')).toHaveTextContent('0 of 0 on · ~0 tokens');
    fireEvent.press(getByTestId('mcp-tools-go-back'));
    expect(getByTestId('route-Previous')).toBeTruthy();
  });

  it('a paired device route that is not connected asks to keep the device online, not to connect', () => {
    seed({
      serverId: 'mesh-task-mac-1',
      servers: [{ id: 'mesh-task-mac-1', name: 'My Mac', url: 'sync://mac-1' }],
    });
    const { getByText, queryByTestId, getByTestId } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    expect(getByText('My Mac is not reachable. Keep the paired device online, then come back.')).toBeTruthy();
    expect(queryByTestId('mcp-tools-connect')).toBeNull();
    expect(getByTestId('mcp-tools-go-back')).toBeTruthy();
  });

  it('lists tools with how many are on and a quiet token line under each', () => {
    seed({
      serverId: 'srv-1',
      serverTools: { 'srv-1': [tool('lookup', 'find things'), tool('create', 'make things')] },
    });
    const { getByText, getAllByText, getByTestId } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    expect(getByTestId('mcp-tools-summary')).toHaveTextContent('0 of 2 on · ~0 tokens');
    expect(getByText('Lookup')).toBeTruthy();
    expect(getByText('Create')).toBeTruthy();
    // Each tool says what it would cost.
    expect(getAllByText(/^~\d+ tokens$/).length).toBe(2);
  });

  it('reflects enabled state per tool and toggling one tool updates the store (not the other)', () => {
    seed({
      serverId: 'srv-1',
      serverTools: { 'srv-1': [tool('lookup'), tool('create')] },
      enabledTools: ['lookup'],
    });
    const { UNSAFE_getAllByType } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    const { Switch } = require('react-native');
    const switches = UNSAFE_getAllByType(Switch);
    expect(switches[0].props.value).toBe(true);   // lookup enabled
    expect(switches[1].props.value).toBe(false);  // create disabled

    // Toggle the disabled one on -> real store action.
    fireEvent(switches[1], 'valueChange', true);
    expect(useMcpStore.getState().enabledTools.sort()).toEqual(['create', 'lookup']);

    // Toggle the enabled one off.
    fireEvent(switches[0], 'valueChange', false);
    expect(useMcpStore.getState().enabledTools).toEqual(['create']);
  });

  it('offers synced desktop tools off until the user enables one', () => {
    seed({
      serverId: 'mesh-task-mac-1',
      servers: [{ id: 'mesh-task-mac-1', name: 'My Mac', url: 'sync://mac-1' }],
    });
    useMcpStore.getState().setServerTools('mesh-task-mac-1', [tool('web_use'), tool('computer_use')]);

    const { UNSAFE_getAllByType } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    const { Switch } = require('react-native');
    const switches = UNSAFE_getAllByType(Switch);
    expect(switches.map(item => item.props.value)).toEqual([false, false]);

    fireEvent(switches[0], 'valueChange', true);
    useMcpStore.getState().setServerTools('mesh-task-mac-1', [tool('web_use'), tool('computer_use')]);
    expect(UNSAFE_getAllByType(Switch).map(item => item.props.value)).toEqual([true, false]);
  });

  it('shows a granted desktop connection with every newly discovered tool off', () => {
    seed({
      serverId: 'desktop-mcp',
      servers: [{ id: 'desktop-mcp', name: 'My Mac', url: 'http://mac.local/mcp', grantedByDeviceId: 'mac-1' }],
    });
    useMcpStore.getState().setServerTools('desktop-mcp', [tool('search'), tool('edit')]);

    const { UNSAFE_getAllByType } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    const { Switch } = require('react-native');
    const switches = UNSAFE_getAllByType(Switch);
    expect(switches.map(item => item.props.value)).toEqual([false, false]);

    fireEvent(switches[0], 'valueChange', true);
    useMcpStore.getState().setServerTools('desktop-mcp', [tool('search'), tool('edit')]);
    expect(UNSAFE_getAllByType(Switch).map(item => item.props.value)).toEqual([true, false]);
  });

  it('Turn all on adds every server tool, then the one action offers Turn all off', () => {
    seed({
      serverId: 'srv-1',
      serverTools: { 'srv-1': [tool('a'), tool('b')] },
      enabledTools: ['a'],
    });
    const { getByTestId, queryByText } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    expect(getByTestId('mcp-tools-toggle-all')).toHaveTextContent('Turn all on');
    fireEvent.press(getByTestId('mcp-tools-toggle-all'));
    expect(useMcpStore.getState().enabledTools.sort()).toEqual(['a', 'b']);

    // All on: the same action now turns them off, and the summary counts both.
    expect(getByTestId('mcp-tools-toggle-all')).toHaveTextContent('Turn all off');
    expect(queryByText('Turn all on')).toBeNull();
    expect(getByTestId('mcp-tools-summary')).toHaveTextContent(/^2 of 2 on · /);
  });

  it('Turn all off removes only this server tools', () => {
    seed({
      serverId: 'srv-1',
      serverTools: { 'srv-1': [tool('a'), tool('b')] },
      enabledTools: ['a', 'b', 'other-server-tool'],
    });
    const { getByText } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    fireEvent.press(getByText('Turn all off'));
    // Foreign tool survives; this server's tools are removed.
    expect(useMcpStore.getState().enabledTools).toEqual(['other-server-tool']);
  });

  it('offers Turn all on, not off, when none of this server tools are on', () => {
    seed({
      serverId: 'srv-1',
      serverTools: { 'srv-1': [tool('a')] },
      enabledTools: [],
    });
    const { getByTestId, queryByText } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    expect(getByTestId('mcp-tools-toggle-all')).toHaveTextContent('Turn all on');
    expect(queryByText('Turn all off')).toBeNull();
  });

  it('offers no Turn all action when the server has no tools', () => {
    seed({ serverId: 'srv-1', servers: [{ id: 'srv-1', name: 'Notion', url: 'https://x/mcp' }], serverTools: { 'srv-1': [] } });
    const { queryByTestId } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    expect(queryByTestId('mcp-tools-toggle-all')).toBeNull();
  });

  it('filters tools by query and shows a clear button that resets the filter', () => {
    seed({
      serverId: 'srv-1',
      serverTools: { 'srv-1': [tool('lookup', 'find'), tool('create', 'make')] },
    });
    const { getByPlaceholderText, getByText, queryByText, getByLabelText } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    const input = getByPlaceholderText('Find a tool');
    fireEvent.changeText(input, 'look');
    expect(getByText('Lookup')).toBeTruthy();
    expect(queryByText('Create')).toBeNull();

    // The clear button appears and resets.
    fireEvent.press(getByLabelText('Clear search'));
    expect(getByText('Create')).toBeTruthy();
  });

  it('filters by description too, and shows the no-match empty message', () => {
    seed({
      serverId: 'srv-1',
      serverTools: { 'srv-1': [tool('lookup', 'find things'), tool('create', 'make things')] },
    });
    const { getByPlaceholderText, getByText, queryByText } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    const input = getByPlaceholderText('Find a tool');

    // Matches by description.
    fireEvent.changeText(input, 'make');
    expect(getByText('Create')).toBeTruthy();
    expect(queryByText('Lookup')).toBeNull();

    // No match -> the filter message, not the server state.
    fireEvent.changeText(input, 'zzzz');
    expect(getByText('No tools match that filter.')).toBeTruthy();
  });

  it('estimates tokens for a tool whose inputSchema has no properties', () => {
    // Exercises the `properties ?? {}` fallback in estimateToolTokens.
    const noProps: McpTool = { name: 'bare', description: 'x', inputSchema: { type: 'object' } };
    seed({ serverId: 'srv-1', serverTools: { 'srv-1': [noProps] } });
    const { getByText } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    // description len 1 -> descTokens 1, propCount 0 -> round((1+0+15)/5)*5 = 15 tokens.
    expect(getByText('~15 tokens')).toBeTruthy();
  });

  it('does not render the clear button while the query is empty', () => {
    seed({ serverId: 'srv-1', serverTools: { 'srv-1': [tool('lookup')] } });
    const { queryByLabelText } = render(withNavigatorRoutes(<McpToolsScreen />, { params: routeParams, openedFrom: 'Previous' }));
    expect(queryByLabelText('Clear search')).toBeNull();
  });
});
