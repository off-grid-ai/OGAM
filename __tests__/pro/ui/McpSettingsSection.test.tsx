/**
 * ProToolsSettingsSection (Settings row) RNTL tests
 *
 * Drives the REAL useMcpStore and renders the REAL component. Asserts what the user
 * sees (the description line reflecting server count + connected count with correct
 * pluralization) and what pressing the row does (navigates to McpServers).
 *
 * Lives in the private pro/ submodule area; the suite skips when pro/ is absent so
 * open-core CI stays green.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { inStack } from '../../harness/realNavigation';

// Render icons as queryable text (native font module doesn't run in jest).
jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: { name: string }) => <Text>{name}</Text>;
});

// Real navigation: the screen is the top of a real stack (harness/realNavigation inStack).
jest.unmock('@react-navigation/native');

type SectionModule = typeof import('@offgrid/pro/ui/McpSettingsSection');
type StoreModule = typeof import('@offgrid/pro/mcp/mcpStore');

function load(): { section: SectionModule; store: StoreModule } | null {
  try {
    return {
      section: require(['..', '..', '..', 'pro', 'ui', 'McpSettingsSection'].join('/')),
      store: require(['..', '..', '..', 'pro', 'mcp', 'mcpStore'].join('/')),
    };
  } catch {
    return null;
  }
}

const mods = load();
const maybe = mods ? describe : describe.skip;

maybe('ProToolsSettingsSection', () => {
  const { ProToolsSettingsSection } = mods!.section;
  const { useMcpStore } = mods!.store;

  const setState = (
    servers: any[],
    connectionStates: Record<string, string> = {},
  ) =>
    useMcpStore.setState({
      servers,
      connectionStates: connectionStates as any,
      serverTools: {},
      toolOwners: {},
      enabledTools: [],
      knownToolNames: [],
    });

  const server = (id: string) => ({ id, name: id, url: `https://${id}.example/mcp`, authMode: 'none' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Reset the real store so we never leak state into other suites.
    setState([]);
  });

  it('shows the empty-state description when there are no servers', () => {
    setState([]);
    const { getByText } = render(inStack(<ProToolsSettingsSection />, { to: ['McpServers'] }));
    expect(getByText('Pro tools')).toBeTruthy();
    expect(getByText('Email, calendar and MCP servers')).toBeTruthy();
  });

  it('uses the singular "server" and 0 connected for one disconnected server', () => {
    setState([server('a')], { a: 'disconnected' });
    const { getByText } = render(inStack(<ProToolsSettingsSection />, { to: ['McpServers'] }));
    expect(getByText('0/1 MCP server connected')).toBeTruthy();
  });

  it('counts only connected servers and pluralizes for multiple servers', () => {
    setState(
      [server('a'), server('b'), server('c')],
      { a: 'connected', b: 'connecting', c: 'connected' },
    );
    const { getByText } = render(inStack(<ProToolsSettingsSection />, { to: ['McpServers'] }));
    // 2 of the 3 are 'connected'; 'connecting' does not count.
    expect(getByText('2/3 MCP servers connected')).toBeTruthy();
  });

  it('renders the zap and chevron icons', () => {
    setState([]);
    const { getByText } = render(inStack(<ProToolsSettingsSection />, { to: ['McpServers'] }));
    expect(getByText('zap')).toBeTruthy();
    expect(getByText('chevron-right')).toBeTruthy();
  });

  it('navigates to McpServers when the row is pressed', () => {
    setState([server('a')], { a: 'connected' });
    const { getByText, queryByTestId, getByTestId } = render(inStack(<ProToolsSettingsSection />, { to: ['McpServers'] }));
    expect(queryByTestId('route-McpServers')).toBeNull();
    fireEvent.press(getByText('Pro tools'));
    expect(getByTestId('route-McpServers')).toBeTruthy();
  });

  it('reflects a live store update: adding a server changes the description', () => {
    setState([]);
    const first = render(inStack(<ProToolsSettingsSection />, { to: ['McpServers'] }));
    expect(first.getByText('Email, calendar and MCP servers')).toBeTruthy();
    first.unmount();

    // Drive the REAL store action, then a fresh render reads the new selector value.
    useMcpStore.getState().addServer(server('x') as any);
    useMcpStore.getState().setConnectionState('x', 'connected');

    const { getByText, queryByText } = render(inStack(<ProToolsSettingsSection />, { to: ['McpServers'] }));
    expect(getByText('1/1 MCP server connected')).toBeTruthy();
    expect(queryByText('Email, calendar and MCP servers')).toBeNull();
  });
});
