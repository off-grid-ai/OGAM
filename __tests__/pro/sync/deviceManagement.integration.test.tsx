import React from 'react';
import { NativeModules, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import {
  fireEvent,
  act,
  render,
  waitFor,
  within,
  type RenderAPI,
} from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TcpSocket from 'react-native-tcp-socket';
import QRCode from 'react-native-qrcode-svg';
import {
  OFFGRID_SYNC_PORT,
  PAIRING_QR_VALIDITY_MS,
  encodePairingQrPayload,
  parsePairingCode,
  parsePairingQrPayload,
  type DeviceInfo,
} from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import {
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import {
  registerScreen,
  _clearScreensForTesting,
} from '../../../src/navigation/screenRegistry';
import {
  _clearSlotsForTesting,
  registerSlot,
  SLOTS,
} from '../../../src/bootstrap/slotRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import { useAppStore } from '../../../src/stores/appStore';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import { syncService } from '../../../pro/sync/syncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { SyncHomeCard } from '../../../pro/ui/SyncHomeCard';
import { ProRoot } from '../../../pro/ui/ProRoot';
import {
  ADVERTISED_LAN_ADDRESS,
  getDiscoveryBoundaries,
  getTcpDials,
  resetDiscoveryBoundaries,
  resetTcpDials,
  resetTcpPortRoutes,
  routeTcpPort,
} from '../../utils/nativeSyncBoundaries';
import {
  pairingCodeOnScreen,
  TYPED_PAIRING_CODE,
  WRONG_TYPED_PAIRING_CODE,
} from '../../utils/pairFromPeer';
import { createDownloadedModel } from '../../utils/factories';
import { MembershipPersistenceBoundary } from '../../utils/membershipPersistenceBoundary';
import {
  createLicensedMesh,
  installLicensedPhone,
} from '../../harness/licensedMesh';

import { PAIRING_TRUST_FORMAT_VERSION } from '../../../pro/sync/pairingTrustDocument';
import { sheetAction } from '../../utils/sheets';

/**
 * Retry a pairing attempt the way the sheet requires: enter the code, then press Retry.
 *
 * Retry stays disabled until what is typed parses, and the field does not keep the last value - which is
 * the point of retrying rather than reconnecting. The attempt that just failed proved nothing about the
 * code, so the user is asked for it again each time.
 */
function retryPairing(ui: RenderAPI, code: string): void {
  fireEvent.changeText(ui.getByTestId('incoming-pairing-code'), code);
  fireEvent.press(ui.getByTestId('retry-pairing-attempt'));
}

/** This phone's fingerprint, which is also the sync device id its installation registers under. */
const PHONE_FINGERPRINT = 'fp-this-phone';

jest.unmock('@react-navigation/native');

jest.mock('react-native-tcp-socket', () => {
  const {
    createNativeTcpBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const nativeTcpBoundary = TcpSocket as unknown as RnTcpModule;

/** Two devices that can pair: an in-memory licence provider, and a licensed peer to pair with. */
const mesh = createLicensedMesh();

describe('Pro mobile saved-device management journey', () => {
  let remote: ReturnType<typeof buildSyncEngine> | undefined;
  let extraRemotes: ReturnType<typeof buildSyncEngine>[] = [];
  let ui: ReturnType<typeof render> | undefined;
  let secrets: Map<string, string>;
  /** What the pairing store has actually written, read back out of the Keychain the app used. */
  const storedPairings = (): string | undefined =>
    secrets.get('off-grid-sync-pairings');
  let failNextPairingSave = false;

  beforeEach(async () => {
    mesh.reset();
    extraRemotes = [];
    await AsyncStorage.clear();
    resetDiscoveryBoundaries();
    resetTcpPortRoutes();
    _clearScreensForTesting();
    _clearSlotsForTesting();
    _clearSectionsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    registerSlot(SLOTS.homeSyncCard, SyncHomeCard);
    useAppStore.getState().setOnboardingComplete(true);
    // Pro is an entitlement the app is told about, so it is seeded like any other outside fact.
    useAppStore.getState().setProActive(true);
    useAppStore
      .getState()
      .setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    useSyncStore.getState().reset();
    // A licensed phone with a Keychain that really stores. The licence matters as much as the pairing
    // store: without it the phone cannot ask for the installation roster, and a peer that pairs
    // perfectly then has no row to appear in.
    secrets = installLicensedPhone(mesh, {
      fingerprint: PHONE_FINGERPRINT,
      beforeWrite: service => {
        if (service === 'off-grid-sync-pairings' && failNextPairingSave) {
          failNextPairingSave = false;
          throw new Error('Keychain unavailable');
        }
      },
    });
    mesh.register({
      id: PHONE_FINGERPRINT,
      name: 'This phone',
      platform: 'ios',
    });
  });

  afterEach(async () => {
    jest.useRealTimers();
    mesh.restore();
    ui?.unmount();
    await remote?.engine.stop();
    await Promise.all(extraRemotes.map(peer => peer.engine.stop()));
    await syncService.stop();
    _clearScreensForTesting();
    _clearSlotsForTesting();
    _clearSectionsForTesting();
    useAppStore.getState().setThemeMode('system');
    delete (NativeModules as Record<string, unknown>).SyncBlobChannelModule;
    (useCameraDevice as jest.Mock).mockReturnValue(undefined);
    (useCameraPermission as jest.Mock).mockReturnValue({
      hasPermission: false,
      requestPermission: jest.fn(),
    });
    (useCodeScanner as jest.Mock).mockClear();
  });

  it('shows the current pairing QR on demand and updates it after rotation', async () => {
    (NativeModules as Record<string, unknown>).SyncBlobChannelModule = {
      lanAddress: jest.fn(async () => '192.168.1.25'),
      interfaceCandidates: jest.fn(async () => [
        { host: '192.168.1.25', interfaceName: 'en0' },
        { host: '100.70.80.90', interfaceName: 'utun4' },
      ]),
    };
    useAppStore.getState().setThemeMode('dark');
    await syncService.start();
    ui = render(
      <NavigationContainer>
        <SyncScreen />
      </NavigationContainer>,
    );

    const firstCode = await pairingCodeOnScreen(ui);
    expect(ui.getByLabelText('Show pairing QR code')).toBeTruthy();
    expect(ui.queryByTestId('sync-pairing-qr')).toBeNull();
    const codeRow = within(ui.getByTestId('sync-pairing-code-row'));
    const actionRow = within(ui.getByTestId('sync-pairing-code-actions'));
    expect(codeRow.getByTestId('sync-pairing-code-value')).toBeTruthy();
    expect(actionRow.getByTestId('sync-rotate-pairing-code')).toBeTruthy();
    const showQr = ui.getByTestId('sync-show-pairing-qr');
    const scanQr = ui.getByTestId('sync-open-pairing-scanner');
    expect(actionRow.getByTestId('sync-show-pairing-qr')).toBe(showQr);
    expect(actionRow.getByTestId('sync-open-pairing-scanner')).toBe(scanQr);
    expect(StyleSheet.flatten(showQr.props.style)).toEqual(
      expect.objectContaining({ width: 44, height: 44 }),
    );
    expect(StyleSheet.flatten(scanQr.props.style)).toEqual(
      expect.objectContaining({ width: 44, height: 44 }),
    );
    expect(
      (
        NativeModules.SyncBlobChannelModule as {
          interfaceCandidates: jest.Mock;
        }
      ).interfaceCandidates,
    ).not.toHaveBeenCalled();

    fireEvent.press(ui.getByTestId('sync-show-pairing-qr'));
    expect(ui.getByTestId('sync-pairing-qr-loading')).toBeTruthy();
    const firstQr = await waitFor(() => ui!.getByTestId('sync-pairing-qr'));
    expect(firstQr.props.accessibilityRole).toBe('image');
    expect(firstQr.props.accessibilityValue).toBeUndefined();
    const firstQrSvg = ui.UNSAFE_getByType(QRCode);
    const firstValue = firstQrSvg.props.value as string;
    const firstPayload = parsePairingQrPayload(firstValue);
    expect(firstPayload).toEqual(
      expect.objectContaining({
        device: expect.objectContaining({ id: PHONE_FINGERPRINT }),
        pairingCode: parsePairingCode(firstCode),
        routes: [
          { kind: 'lan', host: '192.168.1.25', port: OFFGRID_SYNC_PORT },
          {
            kind: 'tailscale',
            host: '100.70.80.90',
            port: OFFGRID_SYNC_PORT,
          },
        ],
        issuedAt: expect.any(Number),
      }),
    );
    expect(firstQr.props.accessibilityHint).toMatch(/pairing code/i);
    expect(firstQrSvg.props.value).toBe(firstValue);
    expect(firstQrSvg.props.ecl).toBe('H');
    expect(firstQrSvg.props.size).toBe(240);
    expect(firstQrSvg.props.logoSize).toBe(42);
    expect(firstQrSvg.props.color).toBe('#0A0A0A');
    expect(firstQrSvg.props.backgroundColor).toBe('#FFFFFF');
    const darkLogo = firstQrSvg.props.logo;
    expect(darkLogo).toBeTruthy();

    useAppStore.getState().setThemeMode('light');
    expect(
      await waitFor(() => ui!.getByTestId('sync-pairing-qr')),
    ).toBeTruthy();
    expect(ui.UNSAFE_getByType(QRCode).props.logo).not.toBe(darkLogo);
    fireEvent.press(ui.getByText('Close'));
    await waitFor(() =>
      expect(ui!.queryByTestId('sync-pairing-qr')).toBeNull(),
    );

    fireEvent.press(ui.getByTestId('sync-rotate-pairing-code'));
    await waitFor(() =>
      expect(
        ui!.getByTestId('sync-pairing-code-value').props.children,
      ).not.toBe(firstCode),
    );
    const nextCode = await pairingCodeOnScreen(ui);
    jest.useFakeTimers({ now: Date.now() });
    fireEvent.press(ui.getByTestId('sync-show-pairing-qr'));
    expect(ui.getByTestId('sync-pairing-qr-loading')).toBeTruthy();
    const rotatedQr = await waitFor(() => ui!.getByTestId('sync-pairing-qr'));
    expect(rotatedQr.props.accessibilityValue).toBeUndefined();
    const rotatedValue = ui.UNSAFE_getByType(QRCode).props.value as string;
    expect(parsePairingQrPayload(rotatedValue)).toEqual(
      expect.objectContaining({ pairingCode: parsePairingCode(nextCode) }),
    );
    expect(rotatedValue).not.toBe(firstValue);
    expect(nextCode).not.toBe(firstCode);

    const rotatedPayload = parsePairingQrPayload(rotatedValue);
    await act(async () => {
      jest.advanceTimersByTime(PAIRING_QR_VALIDITY_MS - 60_000);
      await Promise.resolve();
    });
    const refreshedValue = ui.UNSAFE_getByType(QRCode).props.value as string;
    const refreshedPayload = parsePairingQrPayload(refreshedValue);
    expect(refreshedValue).not.toBe(rotatedValue);
    expect(refreshedPayload).toEqual(
      expect.objectContaining({
        device: rotatedPayload?.device,
        pairingCode: rotatedPayload?.pairingCode,
        routes: rotatedPayload?.routes,
        issuedAt: expect.any(Number),
      }),
    );
    expect(refreshedPayload!.issuedAt).toBeGreaterThan(
      rotatedPayload!.issuedAt,
    );
    jest.useRealTimers();
  });

  it('keeps the QR action unavailable until the pairing code is ready', () => {
    ui = render(
      <NavigationContainer>
        <SyncScreen />
      </NavigationContainer>,
    );

    expect(ui.getByTestId('sync-pairing-code-value').props.children).toBe(
      'Loading...',
    );
    expect(
      ui.getByTestId('sync-show-pairing-qr').props.accessibilityState.disabled,
    ).toBe(true);
    fireEvent.press(ui.getByTestId('sync-show-pairing-qr'));
    expect(ui.queryByTestId('sync-pairing-qr')).toBeNull();
  });

  it('shows one visible scanner, rejects an expired code, then pairs the exact QR device and route', async () => {
    mesh.register({
      id: 'desktop-qr-peer',
      name: 'QR Desktop',
      platform: 'macos',
    });
    const remoteDevice: DeviceInfo = {
      id: 'desktop-qr-peer',
      name: 'QR Desktop',
      platform: 'macos',
      version: '1',
      host: '192.168.1.90',
      port: 0,
    };
    const persistence = new MembershipPersistenceBoundary();
    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        persistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: persistence,
      membershipPersistence: persistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await syncService.start();
    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <SyncScreen />
        </NavigationContainer>
      </>,
    );

    fireEvent.press(ui.getByTestId('sync-open-pairing-scanner'));
    expect(ui.getByText('Camera access needed')).toBeTruthy();
    expect(
      StyleSheet.flatten(ui.getByTestId('qr-scanner-root').props.style),
    ).toEqual(expect.objectContaining({ zIndex: 2 }));
    expect(ui.getAllByTestId('qr-scanner-close')).toHaveLength(1);
    fireEvent.press(ui.getByTestId('qr-scanner-close'));

    (useCameraDevice as jest.Mock).mockReturnValue({ id: 'back-camera' });
    (useCameraPermission as jest.Mock).mockReturnValue({
      hasPermission: true,
      requestPermission: jest.fn(),
    });
    fireEvent.press(ui.getByTestId('sync-open-pairing-scanner'));
    const scanner = (useCodeScanner as jest.Mock).mock.calls.at(-1)?.[0] as {
      onCodeScanned(codes: { value: string }[]): void;
    };
    const encode = (now: number) =>
      encodePairingQrPayload(
        {
          device: remoteDevice,
          pairingCode: TYPED_PAIRING_CODE,
          routes: [
            {
              kind: 'lan',
              host: remoteDevice.host,
              port: remoteDevice.port,
            },
          ],
        },
        now,
      );

    act(() => {
      scanner.onCodeScanned([
        { value: encode(Date.now() - PAIRING_QR_VALIDITY_MS - 1) },
      ]);
    });
    expect(ui.getByText(/This QR code has expired/)).toBeTruthy();

    act(() => {
      scanner.onCodeScanned([{ value: encode(Date.now()) }]);
    });
    expect(ui.getAllByText('Connecting to QR Desktop').length).toBeGreaterThan(
      0,
    );
    expect(ui.getByTestId('qr-scanner-loading')).toBeTruthy();
    await waitFor(
      () =>
        expect(
          within(ui!.getByTestId('sync-paired-desktop-qr-peer')).getByText(
            /Connected/,
          ),
        ).toBeTruthy(),
      { timeout: 10_000 },
    );
    expect(ui.getByTestId(`sync-send-model-${remoteDevice.id}`).props.accessibilityState.disabled).toBe(false);
    await waitFor(() => {
      const failure = ui!.queryByTestId('qr-scanner-status');
      if (failure) throw new Error(`scanner failed: ${failure.props.children}`);
      expect(ui!.queryByTestId('qr-scanner-close')).toBeNull();
    });
    expect(
      getTcpDials().some(
        dial =>
          dial.host === remoteDevice.host && dial.port === remoteDevice.port,
      ),
    ).toBe(true);

    const pairedRowsBeforeRepeat = useSyncStore
      .getState()
      .knownDevices.filter(device => device.id === remoteDevice.id);
    expect(pairedRowsBeforeRepeat).toHaveLength(1);
    const dialCountBeforeRepeat = getTcpDials().length;

    fireEvent.press(ui.getByTestId('sync-open-pairing-scanner'));
    const repeatedScanner = (useCodeScanner as jest.Mock).mock.calls.at(
      -1,
    )?.[0] as {
      onCodeScanned(codes: { value: string }[]): void;
    };
    act(() => {
      repeatedScanner.onCodeScanned([{ value: encode(Date.now()) }]);
    });

    await waitFor(() =>
      expect(ui!.queryByTestId('qr-scanner-close')).toBeNull(),
    );
    expect(ui.queryByText('Pairing failed')).toBeNull();
    expect(getTcpDials()).toHaveLength(dialCountBeforeRepeat);
    expect(
      useSyncStore
        .getState()
        .knownDevices.filter(device => device.id === remoteDevice.id),
    ).toHaveLength(1);

    const mobileDevice = useSyncStore.getState().thisDevice;
    if (!mobileDevice) throw new Error('Sync did not create the Mobile device');
    persistence.dropActive(mobileDevice.id);
    remote.engine.disconnect(mobileDevice.id);
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Offline|Needs repair/,
        ),
      ).toBeTruthy(),
    );

    const dialCountBeforeRepairScan = getTcpDials().length;
    fireEvent.press(ui.getByTestId('sync-open-pairing-scanner'));
    const repairScanner = (useCodeScanner as jest.Mock).mock.calls.at(
      -1,
    )?.[0] as {
      onCodeScanned(codes: { value: string }[]): void;
    };
    act(() => {
      repairScanner.onCodeScanned([{ value: encode(Date.now()) }]);
    });
    expect(ui.getByTestId('qr-scanner-loading')).toBeTruthy();

    await waitFor(
      () =>
        expect(
          within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
            /Connected/,
          ),
        ).toBeTruthy(),
      { timeout: 10_000 },
    );
    expect(getTcpDials().length).toBeGreaterThan(dialCountBeforeRepairScan);
    expect(persistence.getActive(mobileDevice.id)).toBeTruthy();
    expect(ui.queryByText('unknown_device')).toBeNull();
  }, 20_000);

  it('keeps Rescan running when one saved peer is unreachable and another is reachable', async () => {
    const devices: DeviceInfo[] = [
      {
        id: 'desktop-unreachable',
        name: 'Studio Desktop',
        platform: 'macos',
        version: '1',
        host: '127.0.0.1',
        port: 0,
      },
      {
        id: 'desktop-reachable',
        name: 'Travel Desktop',
        platform: 'macos',
        version: '1',
        host: '127.0.0.1',
        port: 0,
      },
    ];
    for (const device of devices) {
      mesh.register({
        id: device.id,
        name: device.name,
        platform: device.platform,
      });
      const persistence = new MembershipPersistenceBoundary();
      const peer = buildSyncEngine({
        pairingEntitlement: mesh.peer(),
        localDevice: device,
        tcpModule: nativeTcpBoundary,
        getPassphrase: async () => TYPED_PAIRING_CODE,
        getSharedSecret: deviceId =>
          persistence.getActive(deviceId)?.sharedSecret,
        pairingPersistence: persistence,
        membershipPersistence: persistence,
      });
      await peer.engine.start(0);
      device.port = peer.transport.boundPort ?? 0;
      extraRemotes.push(peer);
    }

    await syncService.start();
    ui = render(
      <NavigationContainer>
        <SyncScreen />
      </NavigationContainer>,
    );
    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    const code = await pairingCodeOnScreen(ui);
    for (const peer of extraRemotes) {
      await peer.engine.pair(
        { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
        code,
      );
    }
    await waitFor(() =>
      expect(ui!.getByTestId('sync-paired-desktop-unreachable')).toBeTruthy(),
    );
    await waitFor(() =>
      expect(ui!.getByTestId('sync-paired-desktop-reachable')).toBeTruthy(),
    );

    await extraRemotes[0].engine.stop();
    discovery.lose(devices[0].id);
    await waitFor(() =>
      expect(
        within(ui!.getByTestId('sync-paired-desktop-unreachable')).getByText(
          /Offline/,
        ),
      ).toBeTruthy(),
    );

    await waitFor(() => expect(ui!.queryByTestId('sync-scanning')).toBeNull());
    fireEvent.press(ui.getByTestId('sync-rescan'));
    await waitFor(() => expect(ui!.getByTestId('sync-scanning')).toBeTruthy());
    discovery.resolve(devices[0]);
    discovery.resolve(devices[1]);

    await waitFor(
      () =>
        expect(
          getTcpDials().some(
            dial => dial.port === devices[0].port && dial.refused,
          ),
        ).toBe(true),
      { timeout: 10_000 },
    );
    await waitFor(() =>
      expect(
        useSyncStore.getState().reachabilityErrorByDeviceId[devices[0].id],
      ).toBeTruthy(),
    );
    await waitFor(
      () =>
        expect(
          within(ui!.getByTestId('sync-paired-desktop-unreachable')).getByText(
            /Could not reach/,
          ),
        ).toBeTruthy(),
      { timeout: 10_000 },
    );
    expect(
      within(ui.getByTestId('sync-paired-desktop-reachable')).getByText(
        /Connected/,
      ),
    ).toBeTruthy();
    expect(ui.queryByTestId('sync-rescan-error')).toBeNull();
    expect(ui.getByTestId('sync-reconnect-desktop-unreachable')).toBeTruthy();
  }, 20_000);

  it('removes a desktop from the mesh with X but keeps its license seat', async () => {
    mesh.register({
      id: 'desktop-managed-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
    });
    const remoteDevice: DeviceInfo = {
      id: 'desktop-managed-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const remotePersistence = new MembershipPersistenceBoundary();
    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await syncService.start();
    ui = render(<NavigationContainer><AppNavigator /></NavigationContainer>);
    await waitFor(() => expect(ui!.getByTestId('sync-home-card')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-from-home'));
    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) throw new Error('Sync did not start');
    await remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      await pairingCodeOnScreen(ui),
    );
    await waitFor(() => expect(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).toBeTruthy());
    const licenseSeats = mesh.installations().length;
    expect(ui.getByTestId(`sync-disconnect-${remoteDevice.id}`).props.accessibilityLabel)
      .toBe('Remove Off Grid AI Desktop from mesh');
    fireEvent.press(ui.getByTestId(`sync-disconnect-${remoteDevice.id}`));
    await waitFor(() =>
      expect(JSON.parse(storedPairings() ?? '{}').pairings[remoteDevice.id]).toBeUndefined(),
    );
    await waitFor(() => expect(remotePersistence.getActive(mobile.id)).toBeUndefined());
    expect(mesh.installations()).toHaveLength(licenseSeats);
  });

  it('reconnects after a link drop, pairs again from an offline row, and forgets a paired desktop', async () => {
    // This desktop has been on the licence all along, as a real paired peer would be: the roster is
    // built from installations, so a peer with none is a peer the phone cannot show.
    mesh.register({
      id: 'desktop-managed-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
    });
    const remoteDevice: DeviceInfo = {
      id: 'desktop-managed-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const remotePersistence = new MembershipPersistenceBoundary();
    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await syncService.start();

    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );
    expect(await waitFor(() => ui!.getByTestId('sync-home-card'))).toBeTruthy();
    fireEvent.press(ui.getByTestId('open-sync-from-home'));
    expect(ui.getByTestId('sync-open-sharing')).toBeTruthy();
    expect(ui.getByTestId('sync-open-activity')).toBeTruthy();
    expect(ui.queryByTestId('sync-chats-toggle')).toBeNull();

    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    const pairing = remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      await pairingCodeOnScreen(ui),
    );
    // Nothing to confirm: the peer presented this phone's own code, so pairing completes.
    await pairing;

    const { useSyncStore: probeStore } = require('../../../pro/sync/syncStore');
    process.stderr.write(
      `[probe] registry=${JSON.stringify(
        probeStore.getState().entitlementReconciliation?.registry,
      )} known=${JSON.stringify(
        probeStore.getState().knownDevices.map((d: { id: string }) => d.id),
      )}\n`,
    );
    const connectedRow = await waitFor(() =>
      ui!.getByTestId(`sync-paired-${remoteDevice.id}`),
    );
    expect(within(connectedRow).getByText(/Connected · WiFi/)).toBeTruthy();
    expect(within(connectedRow).queryByLabelText(/Rename/)).toBeNull();
    fireEvent.press(ui.getByTestId('sync-rename-this-device'));
    expect(
      await waitFor(() => ui!.getByText('Rename this device')),
    ).toBeTruthy();
    fireEvent.changeText(
      ui.getByTestId('sync-rename-this-device-input'),
      'Travel Phone',
    );
    fireEvent.press(ui.getByTestId('sync-rename-this-device-save'));
    await waitFor(() =>
      expect(ui!.getByTestId('sync-this-device').props.children).toBe(
        'Travel Phone',
      ),
    );
    expect(within(connectedRow).queryByLabelText(/Rename/)).toBeNull();

    remote.engine.disconnect(mobile.id);
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Offline/,
        ),
      ).toBeTruthy(),
    );
    expect(ui.getByTestId(`sync-reconnect-${remoteDevice.id}`)).toBeTruthy();

    fireEvent.press(ui.getByLabelText('Back'));
    await waitFor(() => expect(ui!.getByTestId('sync-home-card')).toBeTruthy());
    // The card counts the mesh: one saved device, none connected now that it has been disconnected.
    // It said "1 connected - 1 saved" a moment ago, so this is the transition and not a still frame.
    //
    // Not asserted: a "needs attention" line. The card prefers the local discoverability title, so it
    // says "Discoverable" here - true of this device, and silent about the peer that just dropped.
    expect(
      within(ui!.getByTestId('sync-home-card')).getByText(
        /0 connected - 1 saved/,
      ),
    ).toBeTruthy();
    expect(
      within(ui!.getByTestId('sync-home-card')).getByText(/Discoverable/),
    ).toBeTruthy();
    fireEvent.press(ui.getByTestId('open-sync-from-home'));

    fireEvent.press(ui.getByTestId(`sync-reconnect-${remoteDevice.id}`));
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Connected/,
        ),
      ).toBeTruthy(),
    );
    fireEvent.press(ui.getByLabelText('Back'));
    // And back up on the card the count has moved the other way, which is the reconnect seen from
    // outside the Sync screen.
    await waitFor(() =>
      expect(
        within(ui!.getByTestId('sync-home-card')).getByText(
          /1 connected - 1 saved/,
        ),
      ).toBeTruthy(),
    );
    fireEvent.press(ui.getByTestId('open-sync-from-home'));

    const pairingBeforeRepair = JSON.parse(storedPairings() ?? '{}').pairings[
      remoteDevice.id
    ];
    const installationIdsBeforeRepair = mesh
      .installations()
      .map(installation => installation.fingerprint)
      .sort();
    await remote.engine.stop();
    getDiscoveryBoundaries().at(-1)!.lose(remoteDevice.id);
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Offline/,
        ),
      ).toBeTruthy(),
    );
    const offlineRow = ui.getByTestId(`sync-paired-${remoteDevice.id}`);
    expect(
      within(offlineRow).queryByTestId(`sync-disconnect-${remoteDevice.id}`),
    ).toBeNull();
    expect(within(offlineRow).queryByLabelText(/Rename/)).toBeNull();
    // The row is already offline, so it has no second Disconnect. Pair again is a separate key action
    // that asks for the code the desktop shows now.
    fireEvent.press(ui.getByTestId(`sync-repair-${remoteDevice.id}`));
    await waitFor(() =>
      expect(ui!.getByText('Pair with Off Grid AI Desktop')).toBeTruthy(),
    );
    expect(ui.getByTestId('sync-pairing-code-input')).toBeTruthy();
    expect(ui.getByText('Pair again')).toBeTruthy();

    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    getDiscoveryBoundaries().at(-1)!.resolve(remoteDevice);
    fireEvent.changeText(
      ui.getByTestId('sync-pairing-code-input'),
      TYPED_PAIRING_CODE,
    );
    fireEvent.press(ui.getByTestId('sync-pairing-code-confirm'));

    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Connected/,
        ),
      ).toBeTruthy(),
    );
    const pairingAfterRepair = JSON.parse(storedPairings() ?? '{}').pairings[
      remoteDevice.id
    ];
    expect(pairingAfterRepair.secret).not.toBe(pairingBeforeRepair.secret);
    expect(
      mesh
        .installations()
        .map(({ fingerprint }) => fingerprint)
        .sort(),
    ).toEqual(installationIdsBeforeRepair);
    expect(JSON.parse(storedPairings() ?? '{}').tombstones).toEqual({});

    await remote.engine.stop();
    getDiscoveryBoundaries().at(-1)!.lose(remoteDevice.id);
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Offline/,
        ),
      ).toBeTruthy(),
    );
    // Confirmation is an in-app sheet, not a system modal - the app never uses one for this - so the
    // question is read on screen and answered by pressing it. The copy names the licence consequence,
    // because evicting frees a seat as well as ending the trust.
    fireEvent.press(ui.getByTestId(`sync-forget-${remoteDevice.id}`));
    await waitFor(() =>
      expect(ui!.getByText('Evict Off Grid AI Desktop?')).toBeTruthy(),
    );
    expect(
      ui.getByText(/removes Off Grid AI Desktop from your licensed devices/),
    ).toBeTruthy();
    fireEvent.press(ui.getByText('Evict device'));
    await waitFor(() =>
      expect(ui!.queryByTestId(`sync-paired-${remoteDevice.id}`)).toBeNull(),
    );
    // An evicted device is GONE from this phone's lists - not available, not saved, and with no
    // eviction row of its own. It used to keep a synthesised row carrying retry/dismiss, which put a
    // device you had just removed back on screen beside the ones you can still connect to, reading as
    // though the removal had failed. The revocation is still tracked and retried in the background;
    // what is gone is the removed device's presence on this screen.
    await waitFor(() =>
      expect(
        ui!.queryByTestId(`sync-discovered-${remoteDevice.id}`),
      ).toBeNull(),
    );
    expect(ui.queryByText(/Could not reach/)).toBeNull();
    expect(ui.getByText('1 of 3 devices saved')).toBeTruthy();

    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await waitFor(() =>
      expect(getDiscoveryBoundaries().at(-1)!.scanCount).toBeGreaterThan(0),
    );
    getDiscoveryBoundaries().at(-1)!.resolve(remoteDevice);
    await waitFor(() =>
      expect(remotePersistence.getActive(mobile.id)).toBeUndefined(),
    );
    await waitFor(() =>
      expect(JSON.parse(storedPairings() ?? '{}').pendingRevocations).toEqual(
        {},
      ),
    );
    await waitFor(() =>
      expect(
        within(
          ui!.getByTestId(`sync-discovered-${remoteDevice.id}`),
        ).getByTestId(`sync-pair-${remoteDevice.id}`),
      ).toBeTruthy(),
    );
    // Nothing left on disk that could reconnect this device, and a tombstone so the membership it was
    // evicted from stays retired if it ever comes back claiming that generation. The version is read
    // from the app rather than written down here, so a format bump does not read as a failure.
    const persisted = JSON.parse(storedPairings() ?? '{}');
    expect(persisted).toEqual(
      expect.objectContaining({
        version: PAIRING_TRUST_FORMAT_VERSION,
        pairings: {},
        stagedPairings: {},
        pendingRevocations: {},
      }),
    );
    expect(
      Object.values(
        persisted.tombstones as Record<string, { deviceId: string }>,
      ).map(tombstone => tombstone.deviceId),
    ).toEqual([remoteDevice.id]);
  });

  it('reconnects a saved desktop at startup before discovery reports it', async () => {
    mesh.register({
      id: 'desktop-startup-peer',
      name: 'Startup Desktop',
      platform: 'macos',
    });
    const remoteDevice: DeviceInfo = {
      id: 'desktop-startup-peer',
      name: 'Startup Desktop',
      platform: 'macos',
      version: '1',
      host: ADVERTISED_LAN_ADDRESS,
      port: 0,
    };
    const remotePersistence = new MembershipPersistenceBoundary();
    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await syncService.start();
    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );
    await waitFor(() => expect(ui!.getByTestId('sync-home-card')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-from-home'));

    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    await remote.engine.pair(
      { ...mobile, host: ADVERTISED_LAN_ADDRESS, port: discovery.publishedPort },
      await pairingCodeOnScreen(ui),
    );
    await waitFor(() =>
      expect(useSyncStore.getState().connectedDeviceIds).toContain(remoteDevice.id),
    );

    await syncService.stop();
    resetTcpDials();
    await syncService.start();

    await waitFor(() =>
      expect(useSyncStore.getState().connectedDeviceIds).toContain(remoteDevice.id),
    );
    expect(getTcpDials()).toContainEqual({
      host: ADVERTISED_LAN_ADDRESS,
      port: remoteDevice.port,
    });
    // The discovery boundary never reports the desktop after restart. The rendered connection came
    // from the authenticated endpoint that pairing saved, while ordinary startup scans still ran.
  });

  it('saves one private endpoint and reconnects only to that address after restart', async () => {
    mesh.register({
      id: 'desktop-private-peer',
      name: 'Travel Desktop',
      platform: 'macos',
    });
    const remoteDevice: DeviceInfo = {
      id: 'desktop-private-peer',
      name: 'Travel Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const remotePersistence = new MembershipPersistenceBoundary();
    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      getSharedSecret: deviceId =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await syncService.start();

    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );
    await waitFor(() => expect(ui!.getByTestId('sync-home-card')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-from-home'));

    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    await remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      await pairingCodeOnScreen(ui),
    );
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Connected/,
        ),
      ).toBeTruthy(),
    );

    remote.engine.disconnect(mobile.id);
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Offline/,
        ),
      ).toBeTruthy(),
    );

    fireEvent.press(ui.getByTestId(`sync-manual-endpoint-${remoteDevice.id}`));
    expect(
      await waitFor(() => ui!.getByText('Connect by address')),
    ).toBeTruthy();
    expect(ui.getByText(/Only your devices can read it/)).toBeTruthy();
    fireEvent.changeText(
      ui.getByTestId('sync-manual-address-input'),
      '100.100.20.30',
    );
    expect(ui.queryByTestId('sync-manual-port-input')).toBeNull();
    routeTcpPort(OFFGRID_SYNC_PORT, remoteDevice.port);
    const scansBeforeConnect = discovery.scanCount;
    resetTcpDials();
    fireEvent.press(ui.getByTestId('sync-manual-endpoint-connect'));

    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).getByText(
          /Connected/,
        ),
      ).toBeTruthy(),
    );
    expect(getTcpDials()).toContainEqual({
      host: '100.100.20.30',
      port: OFFGRID_SYNC_PORT,
    });
    expect(discovery.scanCount).toBe(scansBeforeConnect);

    fireEvent.press(ui.getByLabelText('Back'));
    await waitFor(() => expect(ui!.getByTestId('sync-home-card')).toBeTruthy());
    await syncService.stop();
    const restarting = syncService.start();
    await waitFor(() =>
      expect(ui!.getByText('Sync devices')).toBeTruthy(),
    );
    expect(ui.getByText('Clipboard')).toBeTruthy();
    expect(ui.queryByText('Set up Sync')).toBeNull();
    await restarting;
    const restartedDiscovery = getDiscoveryBoundaries().at(-1);
    if (!restartedDiscovery) throw new Error('Sync discovery did not restart');
    expect(syncService.manualEndpoint(remoteDevice.id)).toEqual({
      deviceId: remoteDevice.id,
      host: '100.100.20.30',
    });
    resetTcpDials();
    await syncService.reconnectDevice(remoteDevice.id);

    expect(getTcpDials()).toContainEqual({
      host: '100.100.20.30',
      port: OFFGRID_SYNC_PORT,
    });
  });

  it('stops nearby browsing and keeps the saved Sync port after restart', async () => {
    await syncService.start();
    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );
    await waitFor(() => expect(ui!.getByTestId('sync-home-card')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-from-home'));

    const discovery = getDiscoveryBoundaries().at(-1);
    if (!discovery) throw new Error('Sync discovery did not start');
    const stopsBefore = discovery.stopCount;
    expect(ui.queryByTestId('sync-toggle-browsing')).toBeNull();
    const status = ui.getByTestId('sync-discoverability-status');
    expect(status.props.accessibilityLabel).toBe(
      'Sync is discoverable. Open device settings.',
    );
    fireEvent.press(status);
    expect(await waitFor(() => ui!.getByText('Device settings'))).toBeTruthy();
    fireEvent(ui.getByTestId('sync-toggle-browsing'), 'valueChange', false);
    await waitFor(() => {
      expect(discovery.stopCount).toBeGreaterThan(stopsBefore);
      expect(ui!.getByTestId('sync-browsing-off')).toBeTruthy();
    });

    expect(
      await waitFor(() => ui!.getByTestId('sync-port-input')),
    ).toBeTruthy();
    fireEvent.changeText(ui.getByTestId('sync-port-input'), '40123');
    fireEvent.press(ui.getByTestId('sync-port-save'));
    await waitFor(() => {
      expect(ui!.queryByTestId('sync-port-input')).toBeNull();
      expect(useSyncStore.getState().syncPort).toBe(40123);
    });

    await syncService.stop();
    ui.unmount();
    ui = undefined;
    await syncService.start();

    expect(useSyncStore.getState().browsing).toBe(false);
    expect(useSyncStore.getState().syncPort).toBe(40123);
  });

  it('shows Mobile-initiated cancel, code, and persistence failures before a clean retry', async () => {
    // This desktop holds an installation, as any licensed Mac does. Reconciliation RETIRES a device it
    // finds locally trusted but absent from the licence, so an unregistered peer is un-pairable by
    // design: the trust lands and is withdrawn moments later.
    mesh.register({
      id: 'desktop-mismatch-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
    });
    const remoteDevice: DeviceInfo = {
      id: 'desktop-mismatch-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const passphraseResolvers: Array<(passphrase: string | null) => void> = [];
    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: (_device, context) =>
        new Promise(resolve => {
          passphraseResolvers.push(resolve);
          context.signal.addEventListener('abort', () => resolve(null), {
            once: true,
          });
        }),
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await syncService.start();
    const mobile = useSyncStore.getState().thisDevice;
    if (!mobile) throw new Error('Sync did not create the Mobile device');

    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );
    // Wait for the card, not just the button. The button can be on screen before the Sync route is
    // registered, and navigating to a route that does not exist yet does nothing at all - leaving the
    // test pressing on for several seconds while still on Home.
    await waitFor(() => expect(ui!.getByTestId('sync-home-card')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-from-home'));
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!discovery) {
      throw new Error('Sync did not start native discovery');
    }
    // Only once this boundary is browsing: a resolve that lands before the service has registered its
    // listener is dropped, exactly as a real one would be.
    await waitFor(() => expect(discovery.scanCount).toBeGreaterThan(0));
    discovery.resolve(remoteDevice);
    // A Mac on your licence that this phone has never paired with is a SAVED device needing pairing,
    // not a stranger nearby: the roster knows it, only the trust is missing. So it is reached from the
    // saved list, and its action asks for the code because there is no credential to retry.
    await waitFor(() =>
      expect(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).toBeTruthy(),
    );
    fireEvent.press(ui.getByTestId(`sync-repair-${remoteDevice.id}`));
    await waitFor(() => ui!.getByTestId('sync-pairing-code-scan'));
    (useCameraDevice as jest.Mock).mockReturnValue({ id: 'back-camera' });
    (useCameraPermission as jest.Mock).mockReturnValue({
      hasPermission: true,
      requestPermission: jest.fn(),
    });
    fireEvent.press(ui.getByTestId('sync-pairing-code-scan'));
    const rowScanner = (useCodeScanner as jest.Mock).mock.calls.at(-1)?.[0] as {
      onCodeScanned(codes: { value: string }[]): void;
    };
    act(() => {
      rowScanner.onCodeScanned([{
        value: encodePairingQrPayload({
          device: remoteDevice,
          pairingCode: TYPED_PAIRING_CODE,
          routes: [{ kind: 'lan', host: '192.168.1.20', port: remoteDevice.port }],
        }),
      }]);
    });

    await waitFor(() =>
      expect(ui!.getByText('Waiting for confirmation')).toBeTruthy(),
    );
    expect(sheetAction(ui, 'Waiting for confirmation', 'Cancel')).toBeTruthy();
    // Two installations: this phone and the Mac. Both are on the licence throughout - what the pairing
    // adds is the trust between them, not a seat.
    expect(ui.getByText('2 of 3 devices saved')).toBeTruthy();
    await waitFor(() => expect(passphraseResolvers).toHaveLength(1));
    fireEvent.press(sheetAction(ui, 'Waiting for confirmation', 'Cancel'));

    await waitFor(() =>
      expect(ui!.getByText('Pairing cancelled')).toBeTruthy(),
    );
    expect(ui.getByText('Pairing was cancelled.')).toBeTruthy();
    retryPairing(ui, TYPED_PAIRING_CODE);
    await waitFor(() => expect(passphraseResolvers).toHaveLength(2));
    await waitFor(() =>
      expect(ui!.getByText('Waiting for confirmation')).toBeTruthy(),
    );
    passphraseResolvers[1](WRONG_TYPED_PAIRING_CODE);

    await waitFor(() => expect(ui!.getByText('Pairing failed')).toBeTruthy());
    expect(ui.getByText('The pairing codes did not match.')).toBeTruthy();
    expect(ui.getByTestId('retry-pairing-attempt')).toBeTruthy();
    expect(
      useSyncStore
        .getState()
        .knownDevices.some(device => device.id === remoteDevice.id),
    ).toBe(false);

    retryPairing(ui, TYPED_PAIRING_CODE);
    await waitFor(() => expect(passphraseResolvers).toHaveLength(3));
    await waitFor(() =>
      expect(ui!.getByText('Waiting for confirmation')).toBeTruthy(),
    );
    failNextPairingSave = true;
    passphraseResolvers[2](TYPED_PAIRING_CODE);

    await waitFor(() => expect(ui!.getByText('Pairing failed')).toBeTruthy());
    expect(ui.getByText('The pairing could not be saved.')).toBeTruthy();
    expect(remote.engine.isPaired(mobile.id)).toBe(false);
    expect(
      useSyncStore
        .getState()
        .knownDevices.some(device => device.id === remoteDevice.id),
    ).toBe(false);

    // A clean retry after the storage failure gets there, and the trust SURVIVES - which is the part
    // worth asserting, because a pairing whose trust is withdrawn moments later still reports success
    // on its way past.
    retryPairing(ui, TYPED_PAIRING_CODE);
    await waitFor(() => expect(passphraseResolvers).toHaveLength(4));
    await waitFor(() =>
      expect(ui!.getByText('Waiting for confirmation')).toBeTruthy(),
    );
    passphraseResolvers[3](TYPED_PAIRING_CODE);

    await waitFor(() =>
      expect(
        useSyncStore
          .getState()
          .knownDevices.some(device => device.id === remoteDevice.id),
      ).toBe(true),
    );
    expect(ui.queryByTestId('pairing-attempt-sheet')).toBeNull();
    expect(ui.queryByText('Pairing failed')).toBeNull();
  });

  it('shows that pairing needs reconciliation when entitlement setup and rollback both fail', async () => {
    const remoteDevice: DeviceInfo = {
      id: 'desktop-rollback-peer',
      name: 'Rollback Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const peer = mesh.joiner({ name: remoteDevice.name, platform: 'macos' });
    remote = buildSyncEngine({
      pairingEntitlement: {
        ...peer,
        async commitImport() {
          throw new Error('Registration failed at the provider.');
        },
        async rollbackImport() {
          throw new Error('The provider could not remove the partial registration.');
        },
      },
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      getPassphrase: async () => TYPED_PAIRING_CODE,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await syncService.start();
    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <SyncScreen />
        </NavigationContainer>
      </>,
    );

    const discovery = getDiscoveryBoundaries().at(-1);
    if (!discovery) throw new Error('Sync did not start native discovery');
    await waitFor(() => expect(discovery.scanCount).toBeGreaterThan(0));
    discovery.resolve(remoteDevice);
    fireEvent.press(
      await waitFor(() => ui!.getByTestId(`sync-pair-${remoteDevice.id}`)),
    );
    fireEvent.changeText(ui.getByTestId('sync-pairing-code-input'), TYPED_PAIRING_CODE);
    fireEvent.press(ui.getByTestId('sync-pairing-code-confirm'));

    await waitFor(() => expect(ui!.getByText('Pairing failed')).toBeTruthy());
    expect(
      ui.getByText('The device registry needs reconciliation before pairing can continue.'),
    ).toBeTruthy();
    expect(remote.engine.isPaired(PHONE_FINGERPRINT)).toBe(false);
  });
});
