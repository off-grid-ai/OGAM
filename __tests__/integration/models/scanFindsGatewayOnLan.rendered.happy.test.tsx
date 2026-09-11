/**
 * Scanning a network that HAS a server puts it in the list and says so.
 *
 * The product outcome, from the user's side: "I tap Scan network, my Mac is running Off Grid AI
 * Desktop on the same Wi-Fi, so it turns up in my list with its address and the screen tells me it
 * was added." That is the whole point of the screen, and nothing covered it — the file that claimed
 * to (`__tests__/rntl/screens/RemoteServersScreen.test.tsx`) mocked our theme, our modal, our alert,
 * our manager AND our discovery service, so it asserted its own mocks. It stayed green through a
 * screen that used no design token and through a scan that could not find a server at all.
 *
 * Device ground truth (2026-08-10): the Mac at 192.168.1.30 served the gateway on 7878 and the
 * phone at 192.168.1.10 reached it, but the scan reported an empty network. Two faults, both now
 * fixed: the gateway was bound to loopback, and the probe deadline was shorter than the round trip
 * while too many probes ran at once for Android's shared dispatcher. This pins the outcome those
 * fixes exist to produce, on the same addresses and the same port.
 *
 * Fakes sit at the device boundary ONLY — react-native-device-info (which address this phone has,
 * and whether it is an emulator) and `fetch` (the network itself). The subnet maths, the worker
 * pool, the provider table, the aggregation, remoteServerManager, the store and the screen all run
 * for real. Delete discoverLANServers and this test fails.
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

import type { LanProbeHandle } from '../../harness/lanProbe';

/** The addresses the device session actually used. */
const PHONE_IP = '192.168.1.10';
const MAC_IP = '192.168.1.30';
const GATEWAY_PORT = 7878;

describe('scanning a network that has an Off Grid AI Desktop on it', () => {
  let lan: LanProbeHandle;
  let fixture: MobileApplicationFixture;
  let React: typeof import('react');
  let rtl: typeof import('@testing-library/react-native');
  let RemoteServersScreen: typeof import('../../../src/screens/RemoteServersScreen').RemoteServersScreen;
  let installLanProbe: typeof import('../../harness/lanProbe').installLanProbe;
  let gatewayModelList: typeof import('../../harness/lanProbe').gatewayModelList;

  beforeAll(async () => {
    installNativeBoundary();
    await require('@react-native-async-storage/async-storage').clear();
    React = require('react') as typeof import('react');
    const { requireRTL } =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    rtl = requireRTL();
    ({ RemoteServersScreen } =
      require('../../../src/screens/RemoteServersScreen') as typeof import('../../../src/screens/RemoteServersScreen'));
    ({ installLanProbe, gatewayModelList } =
      require('../../harness/lanProbe') as typeof import('../../harness/lanProbe'));
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
  });

  afterAll(async () => {
    await fixture.dispose();
  });

  beforeEach(() => {
    // Device boundary: this phone's own address, and that it is a real handset so the scan runs.

    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = jest.fn(async () => false);
    DeviceInfo.getIpAddress = jest.fn(async () => PHONE_IP);

    // Network boundary: one Mac listening on the gateway port. Every other address refuses.
    lan = installLanProbe({
      [`${MAC_IP}:${GATEWAY_PORT}`]: {
        paths: ['/v1/'],
        body: gatewayModelList,
      },
    });
  });

  afterEach(async () => {
    lan.uninstall();
    for (const server of fixture.application.models.snapshot().servers) {
      await fixture.application.models.removeRemoteServer(server.id);
    }
  });

  it('adds the server it found, shows its address, and says how many it added', async () => {
    const ui = rtl.render(React.createElement(RemoteServersScreen));

    // BEFORE — the list is genuinely empty, so a row appearing later cannot be something that was
    // always on screen.
    expect(ui.queryByText('No servers yet')).not.toBeNull();
    expect(ui.queryByText(`http://${MAC_IP}:${GATEWAY_PORT}`)).toBeNull();

    // The real gesture.
    rtl.fireEvent.press(ui.getByText('Scan network'));

    // AFTER — the server the user actually has is in the list, at the address they can check.
    await rtl.waitFor(
      () => {
        expect(
          ui.queryByText(`http://${MAC_IP}:${GATEWAY_PORT}/v1`),
        ).not.toBeNull();
      },
      { timeout: 8000 },
    );

    // The screen reports what it did, in place.
    expect(ui.queryByText('Added 1 server.')).not.toBeNull();

    // ...and the empty state is gone. A render change has two sides: the row must appear AND the
    // "nothing here" message must stop claiming the opposite.
    expect(ui.queryByText('No servers yet')).toBeNull();
    ui.unmount();
  }, 20000);

  it('asks the gateway port on every address, so a Mac anywhere on the subnet is found', async () => {
    const ui = rtl.render(React.createElement(RemoteServersScreen));
    rtl.fireEvent.press(ui.getByText('Scan network'));

    await rtl.waitFor(
      () => {
        expect(
          ui.queryByText(`http://${MAC_IP}:${GATEWAY_PORT}/v1`),
        ).not.toBeNull();
      },
      { timeout: 8000 },
    );

    // The bug that hid the Mac was a scan that never reached its address. Pin the coverage: the
    // gateway port is asked of the whole /24, not of a lucky handful.
    //
    // Distinct ADDRESSES, not raw calls: once a server is found the app goes back to it to check
    // it and read its models, and those follow-ups use the same port.
    const gatewayHosts = new Set(
      lan.requested
        .filter(url => url.includes(`:${GATEWAY_PORT}/`))
        .map(url => url.split('/')[2]),
    );
    expect(gatewayHosts.size).toBe(254);
    expect(gatewayHosts).toContain(`${MAC_IP}:${GATEWAY_PORT}`);
    expect(gatewayHosts).toContain(`192.168.1.1:${GATEWAY_PORT}`);
    expect(gatewayHosts).toContain(`192.168.1.254:${GATEWAY_PORT}`);
    ui.unmount();
  }, 20000);
});
