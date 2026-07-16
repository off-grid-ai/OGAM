/**
 * T047 / DEV-B8 (GREEN guard) — scanning the LAN with no server present shows "No Servers Found" AND leaves
 * the server list empty: the alert and the list must AGREE (no phantom server added).
 *
 * Device (B8): the scan toast said "no servers found" while a server was simultaneously added to the list —
 * a state desync. The current code returns early on `discovered.length === 0` (RemoteServersScreen.tsx:74),
 * so this guards that fix from regressing: empty discovery → alert shown, zero rows added.
 *
 * Real gestures: mount the real RemoteServersScreen with the real remoteServerStore, tap "Scan Network".
 * The discovery boundary is faked at its device leaves (react-native-device-info isEmulator + the global
 * fetch LAN probe), never at our networkDiscovery service — so the REAL scan/aggregation logic runs.
 * isEmulator()=true is the device-faithful "no scan possible" leaf → discoverLANServers returns []. Falsify:
 * a reachable server on the subnet (probe → 200) → a server row IS added and the empty state disappears.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useIsFocused: () => true, useFocusEffect: () => {},
}));

import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { useRemoteServerStore } from '../../../src/stores';

describe('T047 (rendered) — empty LAN scan shows the alert AND adds no phantom server (DEV-B8)', () => {
  beforeEach(() => {
    useRemoteServerStore.setState({ servers: [], serverHealth: {}, discoveredModels: {} });
  });

  it('shows "No Servers Found" and leaves the list empty when nothing is discovered', async () => {
    // Device boundary: an emulator can't run the concurrent LAN scan → discoverLANServers returns [] (the
    // real "nothing found" outcome). This is a native leaf, not our discovery service.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = jest.fn(async () => true);

    const ui = render(<RemoteServersScreen />);
    // Precondition: the empty state is showing (no servers yet).
    expect(ui.queryByText('No Remote Servers')).not.toBeNull();

    // Real gesture: tap "Scan Network".
    fireEvent.press(ui.getByText('Scan Network'));

    // The alert says nothing was found...
    await waitFor(() => { expect(ui.queryByText('No Servers Found')).not.toBeNull(); }, { timeout: 4000 });
    // ...and the list AGREES: the "No Remote Servers" empty state still renders (a phantom server would have
    // replaced it with a row). B8's alert-vs-list desync must not happen. UI-only proof.
    expect(ui.queryByText('No Remote Servers')).not.toBeNull();
  });
});
