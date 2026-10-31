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
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');

import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { useRemoteServerStore } from '../../../src/stores';
import { installLanProbe, gatewayModelList, type LanProbeHandle } from '../../harness/lanProbe';
import { withNavigator } from '../../harness/realNavigation';

/** The addresses the device session actually used. */
const PHONE_IP = '192.168.1.10';
const MAC_IP = '192.168.1.30';
const GATEWAY_PORT = 7878;

describe('scanning a network that has an Off Grid AI Desktop on it', () => {
  let lan: LanProbeHandle;

  beforeEach(() => {
    useRemoteServerStore.setState({ servers: [], serverHealth: {}, discoveredModels: {} });

    // Device boundary: this phone's own address, and that it is a real handset so the scan runs.
     
    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = jest.fn(async () => false);
    DeviceInfo.getIpAddress = jest.fn(async () => PHONE_IP);

    // Network boundary: one Mac listening on the gateway port. Every other address refuses.
    lan = installLanProbe({
      [`${MAC_IP}:${GATEWAY_PORT}`]: { paths: ['/v1/'], body: gatewayModelList },
    });
  });

  afterEach(() => {
    lan.uninstall();
  });

  it('adds the server it found, shows its address, and says how many it added', async () => {
    const ui = render(withNavigator(<RemoteServersScreen />));

    // BEFORE — the list is genuinely empty, so a row appearing later cannot be something that was
    // always on screen.
    expect(ui.queryByText('No servers yet')).not.toBeNull();
    expect(ui.queryByText(`http://${MAC_IP}:${GATEWAY_PORT}`)).toBeNull();

    // The real gesture.
    fireEvent.press(ui.getByText('Scan network'));

    // AFTER — the server the user actually has is in the list, at the address they can check.
    await waitFor(
      () => { expect(ui.queryByText(`http://${MAC_IP}:${GATEWAY_PORT}`)).not.toBeNull(); },
      { timeout: 8000 },
    );

    // The screen reports what it did, in place.
    expect(ui.queryByText('Added 1 server.')).not.toBeNull();

    // ...and the empty state is gone. A render change has two sides: the row must appear AND the
    // "nothing here" message must stop claiming the opposite.
    expect(ui.queryByText('No servers yet')).toBeNull();
  }, 20000);

  it('asks the gateway port on every address, so a Mac anywhere on the subnet is found', async () => {
    const ui = render(withNavigator(<RemoteServersScreen />));
    fireEvent.press(ui.getByText('Scan network'));

    await waitFor(
      () => { expect(ui.queryByText(`http://${MAC_IP}:${GATEWAY_PORT}`)).not.toBeNull(); },
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
  }, 20000);
});
