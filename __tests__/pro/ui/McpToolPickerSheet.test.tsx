/**
 * McpToolPickerSheet (Pro) — REAL RNTL tests.
 *
 * Renders the real component against the real useMcpStore (Zustand). We drive store
 * state via setState and assert what the user sees + what pressing controls does to
 * the real store state — never "a fn was called".
 *
 * Mocks are limited to genuine non-jest boundaries: the vector-icon font shim and the
 * core theme hook. The store under assertion is REAL.
 */

import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent, screen } from '@testing-library/react-native';

const mockColors = {
  text: '#000', textMuted: '#999', textSecondary: '#666', textDisabled: '#bbb',
  primary: '#1DB954', error: '#E00', warning: '#F90',
  background: '#FFF', surface: '#F5F5F5', surfaceLight: '#EEE', border: '#E0E0E0',
  overlay: 'rgba(0,0,0,0.4)',
};

// Font glyph component can't render in jest; shim to a queryable Text of the icon name.
jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text>;
});

jest.mock('@offgrid/core/theme', () => ({
  useTheme: () => ({ colors: mockColors }),
}));

import { McpToolPickerSheet } from '@offgrid/pro/ui/McpToolPickerSheet';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { TOKENS_PER_TOOL } from '@offgrid/pro/mcp/mcpService';
import type { McpTool, McpServerConfig } from '@offgrid/pro/mcp/types';

const tool = (name: string, description = `${name} desc`): McpTool => ({
  name,
  description,
  inputSchema: { type: 'object' },
});

const SERVER: McpServerConfig = { id: 'srv-1', name: 'Notion', url: 'https://x/mcp', authMode: 'oauth' };

const INITIAL = useMcpStore.getState();

const seed = (opts: {
  servers?: McpServerConfig[];
  serverTools?: Record<string, McpTool[]>;
  enabledTools?: string[];
}) =>
  useMcpStore.setState({
    servers: opts.servers ?? [],
    serverTools: opts.serverTools ?? {},
    enabledTools: opts.enabledTools ?? [],
    connectionStates: {},
    toolOwners: {},
    knownToolNames: [],
  });

afterEach(() => {
  // Restore the store to its pristine initial state so we never leak into other suites.
  useMcpStore.setState(INITIAL, true);
});

describe('McpToolPickerSheet', () => {
  it('shows the server name and pluralized tool count when tools exist', () => {
    seed({ servers: [SERVER], serverTools: { 'srv-1': [tool('a'), tool('b')] } });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    expect(screen.getByText('Notion')).toBeTruthy();
    expect(screen.getByText('2 tools available')).toBeTruthy();
  });

  it('uses singular "tool" for exactly one tool', () => {
    seed({ servers: [SERVER], serverTools: { 'srv-1': [tool('only')] } });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    expect(screen.getByText('1 tool available')).toBeTruthy();
  });

  it('falls back to "Tools" title and hides the bulk row when the server has no tools', () => {
    // Unknown serverId -> server undefined, rawTools undefined -> tools=[]
    seed({ servers: [], serverTools: {} });
    render(<McpToolPickerSheet serverId="missing" onClose={jest.fn()} />);
    expect(screen.getByText('Tools')).toBeTruthy();
    expect(screen.getByText('0 tools available')).toBeTruthy();
    // Bulk row is gated on tools.length > 0
    expect(screen.queryByText('Enable all')).toBeNull();
    expect(screen.queryByText('Disable all')).toBeNull();
    // Empty list, no active search -> "No tools available."
    expect(screen.getByText('No tools available.')).toBeTruthy();
  });

  it('renders a checkbox check icon only for enabled tools', () => {
    seed({
      servers: [SERVER],
      serverTools: { 'srv-1': [tool('alpha'), tool('beta')] },
      enabledTools: ['alpha'],
    });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    // One tool enabled -> exactly one check glyph.
    expect(screen.getAllByText('icon:check')).toHaveLength(1);
  });

  it('toggling a tool row flips its enabled state in the real store', () => {
    seed({ servers: [SERVER], serverTools: { 'srv-1': [tool('alpha')] }, enabledTools: [] });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    expect(useMcpStore.getState().enabledTools).toEqual([]);

    fireEvent.press(screen.getByText('alpha'));
    expect(useMcpStore.getState().enabledTools).toEqual(['alpha']);

    fireEvent.press(screen.getByText('alpha'));
    expect(useMcpStore.getState().enabledTools).toEqual([]);
  });

  it('shows the token budget for the count of enabled tools', () => {
    seed({
      servers: [SERVER],
      serverTools: { 'srv-1': [tool('a'), tool('b'), tool('c')] },
      enabledTools: ['a', 'b'],
    });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    expect(
      screen.getByText(`2 tools enabled, ~${2 * TOKENS_PER_TOOL} tokens/message`),
    ).toBeTruthy();
  });

  it('does not show a cost warning below the yellow threshold', () => {
    seed({ servers: [SERVER], serverTools: { 'srv-1': [tool('a')] }, enabledTools: ['a'] });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    expect(screen.queryByText('Moderate token cost')).toBeNull();
    expect(screen.queryByText('High token cost')).toBeNull();
  });

  it('shows "Moderate token cost" at the yellow threshold (15) but below red', () => {
    const names = Array.from({ length: 15 }, (_, i) => `t${i}`);
    seed({
      servers: [SERVER],
      serverTools: { 'srv-1': names.map(n => tool(n)) },
      enabledTools: names,
    });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    expect(screen.getByText('Moderate token cost')).toBeTruthy();
    expect(screen.queryByText('High token cost')).toBeNull();
  });

  it('shows "High token cost" at the red threshold (30)', () => {
    const names = Array.from({ length: 30 }, (_, i) => `t${i}`);
    seed({
      servers: [SERVER],
      serverTools: { 'srv-1': names.map(n => tool(n)) },
      enabledTools: names,
    });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    expect(screen.getByText('High token cost')).toBeTruthy();
    expect(screen.queryByText('Moderate token cost')).toBeNull();
  });

  it('filters the list by name and shows the no-match message when a search matches nothing', () => {
    seed({
      servers: [SERVER],
      serverTools: { 'srv-1': [tool('alpha', 'first'), tool('beta', 'second')] },
    });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('beta')).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('Search tools'), 'alph');
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.queryByText('beta')).toBeNull();

    fireEvent.changeText(screen.getByPlaceholderText('Search tools'), 'zzz');
    expect(screen.getByText('No tools match that search.')).toBeTruthy();
  });

  it('filters by description text too', () => {
    seed({
      servers: [SERVER],
      serverTools: { 'srv-1': [tool('alpha', 'read the calendar'), tool('beta', 'send mail')] },
    });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    fireEvent.changeText(screen.getByPlaceholderText('Search tools'), 'calendar');
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.queryByText('beta')).toBeNull();
  });

  it('clear-search button appears only with text and empties the query when pressed', () => {
    seed({ servers: [SERVER], serverTools: { 'srv-1': [tool('alpha'), tool('beta')] } });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    const input = screen.getByPlaceholderText('Search tools');

    // No query -> only the header close "x" icon (the inline clear button is hidden).
    expect(screen.getAllByText('icon:x')).toHaveLength(1);

    fireEvent.changeText(input, 'beta');
    expect(screen.getByText('beta')).toBeTruthy();
    expect(screen.queryByText('alpha')).toBeNull();
    // Now two "x" icons: header close + the inline clear button.
    const xIcons = screen.getAllByText('icon:x');
    expect(xIcons).toHaveLength(2);

    // The clear button is the second "x" (header close is rendered first).
    fireEvent.press(xIcons[1]);
    // Query cleared -> both rows visible again and the inline clear button is gone.
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('beta')).toBeTruthy();
    expect(screen.getAllByText('icon:x')).toHaveLength(1);
  });

  it('"Enable all" enables every tool on this server (merged with existing) via the real store', () => {
    seed({
      servers: [SERVER],
      serverTools: { 'srv-1': [tool('a'), tool('b')] },
      enabledTools: ['other'],
    });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    // All disabled for this server -> label reads "Enable all".
    fireEvent.press(screen.getByText('Enable all'));
    expect(useMcpStore.getState().enabledTools).toEqual(['other', 'a', 'b']);
  });

  it('"Disable all" removes only this server\'s tools when all are enabled', () => {
    seed({
      servers: [SERVER],
      serverTools: { 'srv-1': [tool('a'), tool('b')] },
      enabledTools: ['a', 'b', 'keep'],
    });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    // Every tool enabled -> label reads "Disable all".
    fireEvent.press(screen.getByText('Disable all'));
    expect(useMcpStore.getState().enabledTools).toEqual(['keep']);
  });

  it('bulk label reads "Enable all" when only some tools are enabled', () => {
    seed({
      servers: [SERVER],
      serverTools: { 'srv-1': [tool('a'), tool('b')] },
      enabledTools: ['a'],
    });
    render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
    expect(screen.getByText('Enable all')).toBeTruthy();
    expect(screen.queryByText('Disable all')).toBeNull();
  });

  it('renders on Android too (covers the Platform-branched sheet insets)', () => {
    const orig = Platform.OS;
    Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
    try {
      seed({ servers: [SERVER], serverTools: { 'srv-1': [tool('a')] } });
      render(<McpToolPickerSheet serverId="srv-1" onClose={jest.fn()} />);
      expect(screen.getByText('Notion')).toBeTruthy();
      expect(screen.getByText('a')).toBeTruthy();
    } finally {
      Object.defineProperty(Platform, 'OS', { get: () => orig, configurable: true });
    }
  });

  it('the Done button invokes onClose', () => {
    const onClose = jest.fn();
    seed({ servers: [SERVER], serverTools: { 'srv-1': [tool('a')] } });
    render(<McpToolPickerSheet serverId="srv-1" onClose={onClose} />);
    fireEvent.press(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
