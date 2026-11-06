/**
 * McpServersScreen (Pro Tools page) Tests
 *
 * Covers the configured-server row behaviour:
 * - While a server is connecting OR authorizing, a loader replaces the toggle so the
 *   user knows work is in flight (OAuth opens a browser, which takes a moment).
 * - A connected server shows the on/off toggle.
 * - Each server is a row: its name, then one line of status, tools and address.
 *
 * Real McpServersScreen on a real native stack, with the real mcpService, McpClient, OAuth client
 * and stores, Pro activated the way boot does it (proHarness). Fakes sit only at the boundaries: the
 * network (XMLHttpRequest + fetch), the Keychain and the sign-in browser (harness/mcpOAuthFake) and the
 * Sync sockets. A server's state is reached by its own switch, with the network held so "Connecting"
 * and "Authorizing" stay on screen.
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

import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Keychain from 'react-native-keychain';
import { McpServersScreen } from '@offgrid/pro/ui/McpServersScreen';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { installPro } from '../../harness/proHarness';
import { useAppStore, useRemoteServerStore } from '../../../src/stores';
import { createDownloadedModel } from '../../utils/factories';
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
    expect(ui.getByTestId(`mcp-server-tool-count-${ACME.id}`)).toHaveTextContent(/2 of 2 tools/);
  });

  it('lists a preset and a custom server as rows: the name, then one line of status and tools', () => {
    useMcpStore.getState().addServer({ ...NOTION, authMode: 'oauth' });
    useMcpStore.getState().addServer({ ...ACME, authMode: 'none' });
    const ui = mount();

    expect(ui.getByText('Notion')).toBeTruthy();
    expect(ui.getByText('Acme')).toBeTruthy();
    // Neither server is connected yet, so neither offers any tools.
    expect(status(ui, ACME.id)).toHaveTextContent('Inactive');
    expect(ui.getByLabelText('Acme, Inactive, 0 of 0 tools')).toBeTruthy();
    expect(ui.getByLabelText('Notion, Inactive, 0 of 0 tools')).toBeTruthy();
  });

  describe('removing a server from its edit screen', () => {
    /** The person's answer to the native confirm dialog (a device boundary): the button they tap. */
    const answerConfirm = (choice: 'Remove' | 'Cancel') =>
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
        buttons?.find(button => button.text === choice)?.onPress?.();
      });

    afterEach(() => jest.restoreAllMocks());

    it('the row has no trash; tapping the name opens the edit screen, and Remove takes the server away', async () => {
      useMcpStore.getState().addServer({ ...ACME, authMode: 'none' });
      const ui = mount();
      expect(ui.queryByLabelText(/remove|delete/i)).toBeNull();

      fireEvent.press(ui.getByText('Acme'));
      const confirm = answerConfirm('Remove');
      await act(async () => { fireEvent.press(await ui.findByTestId('mcp-server-remove')); });

      expect(confirm).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(ui.queryByText('Acme')).toBeNull());
      expect(ui.queryByTestId('mcp-server-remove')).toBeNull();
      expect(useMcpStore.getState().servers.find(server => server.id === ACME.id)).toBeUndefined();
    });

    it('Cancel keeps the server on the list', async () => {
      useMcpStore.getState().addServer({ ...ACME, authMode: 'none' });
      const ui = mount();

      fireEvent.press(ui.getByText('Acme'));
      answerConfirm('Cancel');
      await act(async () => { fireEvent.press(await ui.findByTestId('mcp-server-remove')); });

      expect(ui.getByText('Acme')).toBeTruthy();
      expect(useMcpStore.getState().servers.map(server => server.id)).toContain(ACME.id);
    });

    it('adding a server offers no Remove', async () => {
      const ui = mount();
      fireEvent.press(ui.getByTestId('mcp-add-server'));
      expect(ui.queryByTestId('mcp-server-remove')).toBeNull();
    });
  });

  describe('the note about a model on this phone', () => {
    const NOTE = 'mcp-local-model-note';

    afterEach(() => {
      useAppStore.getState().setActiveModelId(null);
      useAppStore.getState().setDownloadedModels([]);
      useRemoteServerStore.getState().setActiveRemoteTextModelId(null);
    });

    it('shows as a footnote when a model on this phone is in use', () => {
      const model = createDownloadedModel({ id: 'phone-model' });
      useAppStore.getState().setDownloadedModels([model]);
      useAppStore.getState().setActiveModelId(model.id);
      const ui = mount();
      expect(ui.getByTestId(NOTE)).toHaveTextContent('Tools work best with a model on your computer. A model on this phone may skip them.');
    });

    it('is not shown when a model on a computer is in use', () => {
      const model = createDownloadedModel({ id: 'phone-model' });
      useAppStore.getState().setDownloadedModels([model]);
      useAppStore.getState().setActiveModelId(model.id);
      useRemoteServerStore.getState().setActiveRemoteTextModelId('desk-model');
      const ui = mount();
      expect(ui.queryByTestId(NOTE)).toBeNull();
    });

    it('is not shown when no model is chosen', () => {
      const ui = mount();
      expect(ui.queryByTestId(NOTE)).toBeNull();
    });
  });
});
