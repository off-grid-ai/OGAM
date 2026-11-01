/**
 * T053 (GREEN guard) — a remote model is visually distinguished from a local one in the model selector.
 *
 * Device UX finding: "No remote indicator in the model modality selector — a remote model looks identical to
 * a local one." The selector marks remote models with a wifi section header and a cloud icon on each row.
 *
 * Real gestures: add a remote server through the real RemoteServersScreen modal (name + endpoint + Test
 * Connection + Add Server), faking only the /v1/models LAN probe at global.fetch. The real addServer +
 * testConnection populate the remoteServerStore (serverHealth + discoveredModels). Then open the real
 * ModelSelectorModal (which reads that store) and assert the remote model renders with its cloud icon
 * under the server's wifi header. Falsify: with no remote server added, no cloud icon / server header
 * appears in the selector.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

import { RemoteServerEditorScreen } from '../../../src/screens/RemoteServerEditorScreen';
import { ModelSelectorModal } from '../../../src/components/ModelSelectorModal';
import { useRemoteServerStore } from '../../../src/stores';
import { withNavigator } from '../../harness/realNavigation';

const openSelector = () => render(withNavigator(
  <ModelSelectorModal visible onClose={() => {}} onSelectModel={() => {}} onUnloadModel={() => {}} isLoading={false} />));

describe('T053 (rendered) — remote model is marked in the selector (cloud indicator)', () => {
  beforeEach(() => {
    useRemoteServerStore.setState({ servers: [], serverHealth: {}, discoveredModels: {} });
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
      if (String(url).includes('/v1/models')) {
        return { ok: true, status: 200, json: async () => ({ object: 'list', data: [{ id: 'llama-3-8b', object: 'model', owned_by: 'local' }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });

  it('shows the remote model with a cloud icon under its server header', async () => {
    // Precondition (UI): before adding a server, the selector shows no remote indicator.
    const pre = openSelector();
    expect(pre.queryByLabelText('Remote model')).toBeNull();
    expect(pre.queryByText('My LM Studio')).toBeNull();
    pre.unmount();

    // Real gesture: add a remote server via the modal (T046 flow) → real addServer + testConnection
    // populate the store (serverHealth healthy + discoveredModels from /v1/models).
    const servers = render(withNavigator(<RemoteServerEditorScreen />));
    fireEvent.changeText(await waitFor(() => servers.getByPlaceholderText('Off Grid AI Desktop')), 'My LM Studio');
    fireEvent.changeText(servers.getByPlaceholderText('http://192.168.1.50:7878'), 'http://localhost:1234');
    fireEvent.press(servers.getByTestId('test-connection'));
    await waitFor(() => { expect(servers.queryByText(/Connected \(/)).not.toBeNull(); }, { timeout: 4000 });
    fireEvent.press(servers.getByTestId('save-server'));
    await waitFor(() => { expect(useRemoteServerStore.getState().servers).toHaveLength(1); }, { timeout: 4000 });
    servers.unmount();

    // Open the real selector → it reads the store → the remote model is listed and MARKED as remote.
    const sel = openSelector();
    await waitFor(() => { expect(sel.queryByText('llama-3-8b')).not.toBeNull(); }, { timeout: 4000 });
    expect(sel.queryByText('My LM Studio')).not.toBeNull(); // wifi server-name section header
    expect(sel.queryByLabelText('Remote model')).not.toBeNull(); // per-row cloud indicator
  });
});
