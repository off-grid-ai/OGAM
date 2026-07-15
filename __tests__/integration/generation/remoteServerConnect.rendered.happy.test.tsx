/**
 * T046 (checklist Area 6, full-UI upgrade) — adding a remote server connects it and the connected state
 * renders. Device WORKS. The prior coverage (remoteProviderRouting) mocks the store + manager at the service
 * level; this drives the FULL RemoteServersScreen with the real store + real remoteServerManager over a faked
 * HTTP probe (the network boundary).
 *
 * Real gestures: mount RemoteServersScreen, tap "Add Server", type a name + endpoint into the real modal, tap
 * Save. The real addServer + testConnection run; the /v1/models probe is faked at global.fetch (the LAN
 * boundary). Assert the server row shows "Connected".
 *
 * Falsify: make the probe fail (fetch !ok) → the row shows "Offline", not "Connected" → red.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useIsFocused: () => true, useFocusEffect: () => {},
}));

import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { useRemoteServerStore } from '../../../src/stores';

describe('T046 (rendered) — add a remote server → it connects (connected state renders)', () => {
  beforeEach(() => {
    // Fresh store (no servers) so the added one is the only row.
    useRemoteServerStore.setState({ servers: [], serverHealth: {}, discoveredModels: {} });
    // Fake the LAN probe: a reachable OpenAI-compatible server answering /v1/models.
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
      if (String(url).includes('/v1/models')) {
        return { ok: true, status: 200, json: async () => ({ object: 'list', data: [{ id: 'llama-3-8b', object: 'model', owned_by: 'local' }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });

  it('shows the server as Connected after adding it via the modal', async () => {
    const ui = render(<RemoteServersScreen />);

    // Real gesture: open the Add Server modal (the screen's Add Server button).
    fireEvent.press(ui.getByText('Add Server'));

    // Fill the real modal inputs (targeted by their placeholders).
    fireEvent.changeText(await waitFor(() => ui.getByPlaceholderText('e.g., Off Grid AI Desktop')), 'My LM Studio');
    fireEvent.changeText(ui.getByPlaceholderText('http://192.168.1.50:7878'), 'http://localhost:1234');

    // Tap Test Connection → the real probe runs over the faked /v1/models. The Save button stays disabled
    // until the probe succeeds, so this is a required real step.
    fireEvent.press(ui.getByText('Test Connection'));
    await waitFor(() => { expect(ui.queryByText(/Connected \(/)).not.toBeNull(); }, { timeout: 4000 }); // modal success message

    // Now the modal's save (labelled "Add Server", the 2nd such text) is enabled — tap it.
    const addButtons = ui.getAllByText('Add Server');
    fireEvent.press(addButtons[addButtons.length - 1]);

    // Back on the screen: the server row appears and its status shows Connected (real addServer + testConnection).
    await waitFor(() => { expect(ui.queryByText('My LM Studio')).not.toBeNull(); }, { timeout: 4000 });
    await waitFor(() => { expect(ui.queryByText('Connected')).not.toBeNull(); }, { timeout: 4000 });
  });
});
