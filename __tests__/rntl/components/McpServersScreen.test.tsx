/**
 * McpServersScreen (Pro Tools page) Tests
 *
 * Covers the configured-server card behaviour that recently changed:
 * - While a server is connecting OR authorizing, a loader replaces the toggle so the
 *   user knows work is in flight (OAuth opens a browser, which takes a moment).
 * - A connected server shows the on/off toggle.
 * - Known presets render their bundled brand mark; custom servers fall back to a
 *   monogram.
 *
 * Lives in the private pro/ submodule, loaded via a computed path so the suite skips
 * in open-core CI where pro/ is absent.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

const COLORS = {
  text: '#000', textMuted: '#999', textSecondary: '#666', textDisabled: '#bbb',
  primary: '#1DB954', error: '#E00', trending: '#F90',
  background: '#FFF', surface: '#F5F5F5', surfaceLight: '#EEE', border: '#E0E0E0', overlay: 'rgba(0,0,0,0.4)',
};

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

// Render the bundled SVG mark as something queryable.
jest.mock('react-native-svg', () => {
  const { Text } = require('react-native');
  return { __esModule: true, SvgXml: () => <Text testID="preset-logo-svg">svg</Text> };
});

jest.mock('../../../src/theme', () => ({
  useTheme: () => ({ colors: COLORS, shadows: { small: {} } }),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }) };
});

jest.mock('../../../src/services/tools/extensions', () => ({ getToolExtensions: () => [] }));

const mockAppState = { settings: { enabledTools: [] as string[] }, updateSettings: jest.fn(), activeModelId: undefined, downloadedModels: [] as any[] };
const mockRemoteState = { activeRemoteTextModelId: 'remote-1' };
jest.mock('../../../src/stores', () => ({
  useAppStore: (selector?: any) => (selector ? selector(mockAppState) : mockAppState),
  useRemoteServerStore: (selector?: any) => (selector ? selector(mockRemoteState) : mockRemoteState),
}));

jest.mock('../../../pro/mcp/mcpService', () => ({
  connectServer: jest.fn(), disconnectServer: jest.fn(), signOutServer: jest.fn(),
}));

type ScreenModule = typeof import('../../../pro/ui/McpServersScreen');
type StoreModule = typeof import('../../../pro/mcp/mcpStore');

function load(): { screen: ScreenModule; store: StoreModule } | null {
  try {
    return {
      screen: require(['..', '..', '..', 'pro', 'ui', 'McpServersScreen'].join('/')),
      store: require(['..', '..', '..', 'pro', 'mcp', 'mcpStore'].join('/')),
    };
  } catch {
    return null;
  }
}

const mods = load();
const maybe = mods ? describe : describe.skip;

maybe('McpServersScreen', () => {
  const { McpServersScreen } = mods!.screen;
  const { useMcpStore } = mods!.store;

  const NOTION_URL = 'https://mcp.notion.com/mcp';

  const setServers = (servers: any[], connectionStates: Record<string, string> = {}) =>
    useMcpStore.setState({ servers, connectionStates: connectionStates as any, serverTools: {}, toolOwners: {}, enabledTools: [] });

  beforeEach(() => {
    jest.clearAllMocks();
    setServers([]);
  });

  it('shows a loader (no toggle) while a server is authorizing', () => {
    setServers(
      [{ id: 'mcp-notion-1', name: 'Notion', url: NOTION_URL, authMode: 'oauth' }],
      { 'mcp-notion-1': 'authorizing' },
    );
    const { getByText, queryByRole } = render(<McpServersScreen />);
    expect(getByText('Authorizing')).toBeTruthy();
    expect(queryByRole('switch')).toBeNull();
  });

  it('shows a loader (no toggle) while a server is connecting', () => {
    setServers(
      [{ id: 'mcp-notion-1', name: 'Notion', url: NOTION_URL, authMode: 'oauth' }],
      { 'mcp-notion-1': 'connecting' },
    );
    const { getByText, queryByRole } = render(<McpServersScreen />);
    expect(getByText('Connecting')).toBeTruthy();
    expect(queryByRole('switch')).toBeNull();
  });

  it('shows the toggle once a server is connected', () => {
    setServers(
      [{ id: 'mcp-notion-1', name: 'Notion', url: NOTION_URL, authMode: 'oauth' }],
      { 'mcp-notion-1': 'connected' },
    );
    const { getByText, queryByRole } = render(<McpServersScreen />);
    expect(getByText('Active')).toBeTruthy();
    expect(queryByRole('switch')).toBeTruthy();
  });

  it('renders the bundled logo for a known preset server', () => {
    setServers([{ id: 'mcp-notion-1', name: 'Notion', url: NOTION_URL, authMode: 'oauth' }]);
    const { getAllByTestId } = render(<McpServersScreen />);
    expect(getAllByTestId('preset-logo-svg').length).toBeGreaterThan(0);
  });

  it('falls back to a monogram for a custom server', () => {
    setServers([{ id: 'custom-1', name: 'Acme', url: 'https://acme.example/mcp', authMode: 'none' }]);
    const { getByText, queryByTestId } = render(<McpServersScreen />);
    expect(queryByTestId('preset-logo-svg')).toBeNull();
    expect(getByText('A')).toBeTruthy();
  });
});
