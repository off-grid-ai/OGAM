/**
 * McpServersScreen (Pro Tools page) Tests
 *
 * Covers the configured-server card behaviour:
 * - While a server is connecting OR authorizing, a loader replaces the toggle so the
 *   user knows work is in flight (OAuth opens a browser, which takes a moment).
 * - A connected server shows the on/off toggle.
 * - Known presets render their bundled brand mark; custom servers fall back to a
 *   monogram.
 *
 * Real McpServersScreen on a real native stack, with the real mcpService, McpClient, OAuth client
 * and stores, Pro activated the way boot does it (proHarness). Fakes sit only at the boundaries: the
 * network (XMLHttpRequest + fetch), the Keychain and the sign-in browser (harness/mcpOAuthFake), the
 * Sync sockets, and react-native-svg (so the bundled brand mark is queryable). A server's state is
 * reached by its own switch, with the network held so "Connecting" and "Authorizing" stay on screen.
 */
jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});
jest.mock('react-native-keychain', () => require('../../harness/mcpOAuthFake').createKeychainBoundary());
jest.mock('react-native-inappbrowser-reborn', () => ({
  __esModule: true,
  default: require('../../harness/mcpOAuthFake').createSignInBrowserBoundary(),
}));
// Node already provides crypto.getRandomValues; the RN polyfill's native module does not exist here.
jest.mock('react-native-get-random-values', () => ({}), { virtual: true });
// Render the bundled SVG mark as something queryable.
jest.mock('react-native-svg', () => {
  const { Text } = require('react-native');
  return { __esModule: true, SvgXml: () => <Text testID="preset-logo-svg">svg</Text> };
});

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Keychain from 'react-native-keychain';
import { McpServersScreen } from '@offgrid/pro/ui/McpServersScreen';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { installPro } from '../../harness/proHarness';
import { installMcpOAuthFake, type McpOAuthFake } from '../../harness/mcpOAuthFake';

const Stack = createNativeStackNavigator();
const tool = (name: string) => ({ name, description: `${name} things`, inputSchema: { type: 'object', properties: {} } });

const NOTION = { id: 'mcp-notion-1', name: 'Notion', url: 'https://mcp.notion.com/mcp' };
const ACME = { id: 'custom-1', name: 'Acme', url: 'https://acme.example/mcp' };

function mount() {
  return render(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="McpServers" component={McpServersScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

describe('McpServersScreen', () => {
  let fake: McpOAuthFake;

  beforeEach(async () => {
    fake = installMcpOAuthFake(
      {
        [NOTION.url]: { label: 'Notion', tools: [tool('search')] },
        [ACME.url]: { label: 'Acme', tools: [tool('lookup'), tool('report')] },
      },
      [NOTION.url],
      Keychain as unknown as Parameters<typeof installMcpOAuthFake>[2],
    );
    await installPro();
  });

  afterEach(async () => {
    fake.restore();
    await require('@offgrid/pro').deactivate();
    useMcpStore.getState().servers.forEach(s => useMcpStore.getState().removeServer(s.id));
  });

  /** The card's status label and its switch, found by the server's stable id. */
  const status = (ui: ReturnType<typeof mount>, id: string) => ui.getByTestId(`mcp-server-status-${id}`);

  it('shows a loader (no toggle) while a server is authorizing', async () => {
    useMcpStore.getState().addServer({ ...NOTION, authMode: 'oauth' });
    const ui = mount();
    const cardId = ui.getAllByTestId(/^mcp-server-status-/)[0].props.testID.replace('mcp-server-status-', '');
    const held = fake.holdSignInProbe(NOTION.url);

    await act(async () => { fireEvent(ui.getByTestId(`mcp-server-toggle-${cardId}`), 'valueChange', true); });

    try {
      await waitFor(() => expect(status(ui, cardId)).toHaveTextContent('Authorizing'));
      expect(ui.queryByTestId(`mcp-server-toggle-${cardId}`)).toBeNull();
    } finally {
      held.release();
    }
  });

  it('shows a loader (no toggle) while a server is connecting, then the toggle once connected', async () => {
    useMcpStore.getState().addServer({ ...ACME, authMode: 'none' });
    const ui = mount();
    expect(status(ui, ACME.id)).toHaveTextContent('Inactive');
    const held = fake.holdNext(ACME.url);

    await act(async () => { fireEvent(ui.getByTestId(`mcp-server-toggle-${ACME.id}`), 'valueChange', true); });

    await waitFor(() => expect(status(ui, ACME.id)).toHaveTextContent('Connecting'));
    expect(ui.queryByTestId(`mcp-server-toggle-${ACME.id}`)).toBeNull();

    await act(async () => { held.release(); });

    await waitFor(() => expect(status(ui, ACME.id)).toHaveTextContent('Active'));
    expect(ui.getByTestId(`mcp-server-toggle-${ACME.id}`).props.value).toBe(true);
    expect(ui.getByTestId(`mcp-server-tool-count-${ACME.id}`)).toHaveTextContent('2/2 tools');
  });

  it('renders the bundled logo for a known preset server', () => {
    useMcpStore.getState().addServer({ ...NOTION, authMode: 'oauth' });
    const ui = mount();

    expect(ui.getAllByTestId('preset-logo-svg').length).toBeGreaterThan(0);
    expect(ui.getByText('Notion')).toBeTruthy();
  });

  it('falls back to a monogram for a custom server', () => {
    useMcpStore.getState().addServer({ ...ACME, authMode: 'none' });
    const ui = mount();

    expect(ui.queryByTestId('preset-logo-svg')).toBeNull();
    expect(ui.getByText('A')).toBeTruthy();
  });
});
