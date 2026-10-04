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
import { installNativeBoundary } from '../../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useIsFocused: () => true,
  useFocusEffect: () => {},
}));

describe('T047 (rendered) — empty LAN scan shows the alert AND adds no phantom server (DEV-B8)', () => {
  let fixture: MobileApplicationFixture;
  let React: typeof import('react');
  let rtl: typeof import('@testing-library/react-native');
  let RemoteServersScreen: typeof import('../../../src/screens/RemoteServersScreen').RemoteServersScreen;

  beforeAll(async () => {
    installNativeBoundary();
    await require('@react-native-async-storage/async-storage').clear();
    React = require('react') as typeof import('react');
    const { requireRTL } =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    rtl = requireRTL();
    ({ RemoteServersScreen } =
      require('../../../src/screens/RemoteServersScreen') as typeof import('../../../src/screens/RemoteServersScreen'));
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  it('reports that nothing answered and leaves the list empty when nothing is discovered', async () => {
    // Device boundary: an emulator can't run the concurrent LAN scan → discoverLANServers returns [] (the
    // real "nothing found" outcome). This is a native leaf, not our discovery service.

    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = jest.fn(async () => true);

    const ui = rtl.render(React.createElement(RemoteServersScreen));
    // Precondition: the empty state is showing (no servers yet).
    expect(ui.queryByText('No servers yet')).not.toBeNull();

    // Real gesture: tap "Scan network".
    rtl.fireEvent.press(ui.getByText('Scan network'));

    // The scan reports that nothing answered...
    await rtl.waitFor(
      () => {
        expect(
          ui.queryByText(/Nothing answered on this network/),
        ).not.toBeNull();
      },
      { timeout: 4000 },
    );
    // ...and the list AGREES: the "No servers yet" empty state still renders (a phantom server would have
    // replaced it with a row). B8's report-vs-list desync must not happen. UI-only proof.
    expect(ui.queryByText('No servers yet')).not.toBeNull();
  });
});
