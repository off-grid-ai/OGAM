/**
 * T047 / DEV-B8 (GREEN guard) — scanning the LAN with no server present reports that nothing answered AND
 * leaves the server list empty: what the scan SAYS and what the list SHOWS must AGREE (no phantom server).
 *
 * Device (B8): the scan toast said "no servers found" while a server was simultaneously added to the list —
 * a state desync. The current code returns early on `discovered.length === 0` (RemoteServersScreen.tsx:74),
 * so this guards that fix from regressing: empty discovery → the report shown, zero rows added.
 *
 * The report is now an inline line rather than a dialog, and it names the ports that were tried, so a user
 * left with "nothing found" has something to act on. The guard is unchanged: the report and the list agree.
 *
 * Real gestures: mount the real RemoteServersScreen with the real remoteServerStore, tap "Scan network".
 * The discovery boundary is faked at its device leaves (react-native-device-info isEmulator + the global
 * fetch LAN probe), never at our networkDiscovery service — so the REAL scan/aggregation logic runs.
 * isEmulator()=true is the device-faithful "no scan possible" leaf → discoverLANServers returns []. Falsify:
 * a reachable server on the subnet (probe → 200) → a server row IS added and the empty state disappears.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { useRemoteServerStore } from '../../../src/stores';
import { withNavigator } from '../../harness/realNavigation';

describe('T047 (rendered) — empty LAN scan shows the alert AND adds no phantom server (DEV-B8)', () => {
  beforeEach(() => {
    useRemoteServerStore.setState({ servers: [], serverHealth: {}, discoveredModels: {} });
  });

  it('reports that nothing answered and leaves the list empty when nothing is discovered', async () => {
    // Device boundary: an emulator can't run the concurrent LAN scan → discoverLANServers returns [] (the
    // real "nothing found" outcome). This is a native leaf, not our discovery service.
     
    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = jest.fn(async () => true);

    const ui = render(withNavigator(<RemoteServersScreen />));
    // Precondition: the empty state is showing (no servers yet).
    expect(ui.queryByText('No servers yet')).not.toBeNull();

    // Real gesture: tap "Scan network".
    fireEvent.press(ui.getByText('Scan network'));

    // The scan reports that nothing answered...
    await waitFor(
      () => { expect(ui.queryByText(/No new servers answered/)).not.toBeNull(); },
      { timeout: 4000 },
    );
    // ...and the list AGREES: the "No servers yet" empty state still renders (a phantom server would have
    // replaced it with a row). B8's report-vs-list desync must not happen. UI-only proof.
    expect(ui.queryByText('No servers yet')).not.toBeNull();
  });
});
