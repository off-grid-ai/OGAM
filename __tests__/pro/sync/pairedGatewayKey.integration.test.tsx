/**
 * A computer paired through Sync lends this phone its gateway with the phone's own key.
 *
 * SPEC (OGAM user's view): pair the phone with a desktop on the Sync screen. The desktop's gateway
 * (image, video, search) then works from the phone, even when the owner requires API keys: the
 * desktop hands its key over Sync, and nobody types it. The desktop stays one row when a scan finds
 * it at another address.
 *
 * The real app on the real navigation stack, the real sync service, paired-gateway adoption, remote
 * server manager, store and health check. Fakes only at device boundaries: the TCP socket and
 * discovery natives, the licence provider and Keychain (licensedMesh), the
 * LAN (lanProbe: the desktop's gateway, keyed, naming its Sync id on /health) and the desktop
 * itself (a real sync engine on the other end of the socket).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TcpSocket from 'react-native-tcp-socket';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { GATEWAY_ACCESS_CHANNEL, type DeviceInfo } from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import { registerScreen, _clearScreensForTesting } from '../../../src/navigation/screenRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import { useAppStore } from '../../../src/stores/appStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { syncService } from '../../../pro/sync/syncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { startPairedGatewayAdoption } from '../../../pro/sync/pairedGatewayAdoption';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { getDiscoveryBoundaries, resetDiscoveryBoundaries } from '../../utils/nativeSyncBoundaries';
import { pairingCodeOnScreen } from '../../utils/pairFromPeer';
import { createDownloadedModel } from '../../utils/factories';
import { createLicensedMesh, installLicensedPhone, registerThisPhone } from '../../harness/licensedMesh';
import { gatewayModelList, installLanProbe, type LanProbeHandle } from '../../harness/lanProbe';

jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const PHONE_FINGERPRINT = 'fp-this-phone';
const DESKTOP_ID = 'studio-mac';
const GATEWAY_KEY = `ogad_${'a1'.repeat(32)}`;
const GATEWAY = 'http://192.168.1.70:7878'; // NOSONAR - private LAN test fixture

const mesh = createLicensedMesh();

/** The desktop's gateway on the LAN: keys required, its Sync id on /health. */
const desktopGateway = (host: string) => ({
  [`${host}:7878`]: {
    paths: ['/v1/models', '/health'],
    body: gatewayModelList,
    locked: true,
    apiKey: GATEWAY_KEY,
    computerId: DESKTOP_ID,
  },
});

describe('a paired computer lends this phone its gateway', () => {
  let desktop: ReturnType<typeof buildSyncEngine> | undefined;
  let ui: ReturnType<typeof render> | undefined;
  let lan: LanProbeHandle | undefined;
  let stopAdoption: (() => void) | undefined;

  beforeEach(async () => {
    mesh.reset();
    await syncService.stop();
    await AsyncStorage.clear();
    resetDiscoveryBoundaries();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    useAppStore.getState().setOnboardingComplete(true);
    useAppStore.getState().setProActive(true);
    useAppStore.getState().setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    useSyncStore.getState().reset();
    await remoteServerManager.clearAllServers();
    // The phone's network, at the device boundary: a real handset on the desktop's Wi-Fi subnet.
    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = async () => false;
    DeviceInfo.getIpAddress = async () => '192.168.1.42';
    installLicensedPhone(mesh, { fingerprint: PHONE_FINGERPRINT });
    await registerThisPhone(mesh);
    // What pro/index.ts starts on activation.
    stopAdoption = startPairedGatewayAdoption();
  });

  afterEach(async () => {
    ui?.unmount();
    ui = undefined;
    stopAdoption?.();
    lan?.uninstall();
    lan = undefined;
    mesh.restore();
    await desktop?.engine.stop();
    desktop = undefined;
    await syncService.stop();
    _clearScreensForTesting();
    _clearSectionsForTesting();
  });

  async function pairWithDesktop(): Promise<{ phoneId: string }> {
    const desktopDevice: DeviceInfo = {
      id: DESKTOP_ID, name: 'Studio Mac', platform: 'macos', version: '1', host: '127.0.0.1', port: 0,
    };
    desktop = buildSyncEngine({
      pairingEntitlement: mesh.joiner({ name: desktopDevice.name, platform: desktopDevice.platform }),
      localDevice: desktopDevice,
      tcpModule: TcpSocket as unknown as RnTcpModule,
    });
    await desktop.engine.start(0);
    desktopDevice.port = desktop.transport.boundPort ?? 0;
    await syncService.start();

    ui = render(
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>,
    );
    fireEvent.press(ui.getByTestId('settings-tab'));
    await waitFor(() => expect(ui!.getByText('Model Settings')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-settings'));
    await waitFor(() => expect(ui!.getByTestId('sync-pairing-code-value')).toBeTruthy());
    const phone = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!phone || !discovery?.publishedPort) throw new Error('Sync did not publish this phone');
    await desktop.engine.pair({ ...phone, host: '127.0.0.1', port: discovery.publishedPort }, await pairingCodeOnScreen(ui));
    return { phoneId: phone.id };
  }

  const pairedServer = () => useRemoteServerStore.getState().getServerById(`paired:${DESKTOP_ID}`);

  /** The Remote Servers connection check on the desktop's row passes: the gateway took the key. */
  async function connectsWithItsKey(): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const result = pairedServer()
        ? await remoteServerManager.testConnection(`paired:${DESKTOP_ID}`)
        : { success: false };
      if (result.success) {
        expect(result.models?.map(model => model.id)).toEqual(gatewayModelList.data.map(model => model.id));
        return;
      }
      if (Date.now() > deadline) throw new Error('the desktop gateway never accepted this phone');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  it('uses the key the desktop sends over Sync, and keeps one row when a scan finds it elsewhere', async () => {
    const { phoneId } = await pairWithDesktop();
    // The LAN stands in for every request from here on, so it goes up once the licence has answered.
    lan = installLanProbe(desktopGateway('192.168.1.70'));

    // Without a key the gateway refuses this phone, as it did before pairing gave one.
    expect((await remoteServerManager.testConnectionByEndpoint(GATEWAY)).success).toBe(false);

    desktop!.engine.sendApp(phoneId, GATEWAY_ACCESS_CHANNEL, {
      version: 1, computerId: DESKTOP_ID, name: 'Studio Mac', endpoint: GATEWAY, key: GATEWAY_KEY,
    });

    await connectsWithItsKey();
    expect(pairedServer()).toMatchObject({ endpoint: GATEWAY, computerId: DESKTOP_ID });

    // The desktop's address changed: a scan finds the same computer, not a new server.
    lan.uninstall();
    lan = installLanProbe(desktopGateway('192.168.1.71'));
    const { found } = await remoteServerManager.scanAndReconcile({ kinds: ['gateway'] });
    expect(found).toEqual([]);
    expect(remoteServerManager.getServers()).toHaveLength(1);
  }, 60_000);

  it('ignores a key that names another computer than the one that sent it', async () => {
    const { phoneId } = await pairWithDesktop();
    // The LAN stands in for every request from here on, so it goes up once the licence has answered.
    lan = installLanProbe(desktopGateway('192.168.1.70'));

    desktop!.engine.sendApp(phoneId, GATEWAY_ACCESS_CHANNEL, {
      version: 1, computerId: 'some-other-mac', name: 'Other Mac', endpoint: GATEWAY, key: GATEWAY_KEY,
    });
    // The genuine grant after it is applied, so the wrong one had its chance to land first.
    desktop!.engine.sendApp(phoneId, GATEWAY_ACCESS_CHANNEL, {
      version: 1, computerId: DESKTOP_ID, name: 'Studio Mac', endpoint: GATEWAY, key: GATEWAY_KEY,
    });

    await connectsWithItsKey();
    expect(useRemoteServerStore.getState().getServerById('paired:some-other-mac')).toBeNull();
    expect(remoteServerManager.getServers()).toHaveLength(1);
  }, 60_000);
});
