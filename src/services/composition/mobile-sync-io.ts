/** React Native I/O for Shared's Sync application. No Sync domain owner is constructed here. */
import { Platform } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import Zeroconf from 'react-native-zeroconf';
import type { SyncPlatformPorts } from '@offgrid/application';
import {
  CompositeDiscoveryService,
  MultiTransportBridge,
  supportsAppleProximity,
  type DeviceInfo,
  type DiscoveredDevice,
  type DiscoveryService,
  type SyncConnection,
  type SyncDiscoveryHealthSnapshot,
  type SyncTransportHealthSnapshot,
  type TransportBridge,
} from '@offgrid/sync';
import { RnTcpTransport, type RnTcpModule } from '@offgrid/sync/rn';
import { RnDiscovery, type RnZeroconf } from '@offgrid/sync/rn-discovery';
import logger from '../../utils/logger';
import { rnByteCodec } from '../sync/byteCodec';
import { nativeSyncLanAddress } from '../sync/nativeBlobChannel';
import { IosProximityAdapter } from '../sync/nativeProximity';

const LOCAL_ADDRESS_POLL_MS = 15_000;

function createRestartableLanDiscovery(): DiscoveryService {
  let current: RnDiscovery | null = null;
  let found: ((device: DiscoveredDevice) => void) | undefined;
  let lost: ((deviceId: string) => void) | undefined;

  const adapter = (): RnDiscovery => {
    if (current) return current;
    current = new RnDiscovery(new Zeroconf() as unknown as RnZeroconf, {
      allowHostname: Platform.OS !== 'android',
      log: message => logger.log(message),
    });
    if (found) current.onDeviceFound(found);
    if (lost) current.onDeviceLost(lost);
    return current;
  };

  return {
    start: () => adapter().start(),
    startBrowsing: () => adapter().startBrowsing(),
    stopBrowsing: async () => current?.stopBrowsing(),
    rescan: () => adapter().rescan(),
    advertise: device => adapter().advertise(device),
    stopAdvertising: async () => current?.stopAdvertising(),
    onDeviceFound(callback) {
      found = callback;
      current?.onDeviceFound(callback);
    },
    onDeviceLost(callback) {
      lost = callback;
      current?.onDeviceLost(callback);
    },
    async stop() {
      const stopped = current;
      current = null;
      await stopped?.stop();
    },
    getDiscoveryHealthSnapshot: () =>
      current?.getDiscoveryHealthSnapshot() ?? {
        routes: [
          {
            id: 'lan',
            browse: { state: 'idle' },
            advertise: { state: 'idle' },
            peerCount: 0,
          },
        ],
      },
  };
}

export type MobileSyncIo = Pick<
  SyncPlatformPorts,
  'transport' | 'discovery' | 'describeLocalDevice'
>;

interface LazyProximity {
  readonly transport: TransportBridge;
  readonly discovery: DiscoveryService;
  current(): IosProximityAdapter | null;
}

function createLazyProximity(localDevice: DeviceInfo): LazyProximity {
  let current: IosProximityAdapter | null = null;
  const adapter = (): IosProximityAdapter => {
    current ??= new IosProximityAdapter(localDevice);
    return current;
  };

  return {
    current: () => current,
    transport: {
      listen: (port, onConnection) => adapter().listen(port, onConnection),
      connect: (host, port, remote) => adapter().connect(host, port, remote),
      stop: async () => current?.stop(),
      getTransportHealthSnapshot: (): SyncTransportHealthSnapshot =>
        current?.getTransportHealthSnapshot() ?? {
          listener: { state: 'idle' },
          routes: [{ id: 'proximity', state: 'idle' }],
        },
    },
    discovery: {
      start: () => adapter().discovery.start(),
      startBrowsing: () => adapter().discovery.startBrowsing!(),
      stopBrowsing: async () => current?.discovery.stopBrowsing?.(),
      rescan: () => adapter().discovery.rescan(),
      stop: async () => current?.discovery.stop(),
      advertise: device => adapter().discovery.advertise(device),
      stopAdvertising: async () => current?.discovery.stopAdvertising(),
      onDeviceFound: listener => adapter().discovery.onDeviceFound(listener),
      onDeviceLost: listener => adapter().discovery.onDeviceLost(listener),
      getDiscoveryHealthSnapshot: (): SyncDiscoveryHealthSnapshot =>
        current?.discovery.getDiscoveryHealthSnapshot?.() ?? {
          routes: [
            {
              id: 'proximity',
              browse: { state: 'idle' },
              advertise: { state: 'idle' },
              peerCount: 0,
            },
          ],
        },
    },
  };
}

/**
 * Construct Mobile transport and discovery adapters for Shared's Sync application.
 *
 * Pro can hydrate the mutable local device before the first start. iOS proximity is therefore
 * resolved lazily, and every advertisement and handshake reads that same current object.
 */
export function createMobileSyncIo(localDevice: DeviceInfo): MobileSyncIo {
  const proximity =
    Platform.OS === 'ios' ? createLazyProximity(localDevice) : null;
  const lanTransport = new RnTcpTransport(
    TcpSocket as unknown as RnTcpModule,
    rnByteCodec,
  );
  const transportBridge = new MultiTransportBridge({
    routes: [
      {
        id: 'lan',
        bridge: lanTransport,
        canConnect: remote => Boolean(remote.host && remote.port > 0),
        required: proximity === null,
      },
      ...(proximity
        ? [
            {
              id: 'proximity',
              bridge: proximity.transport,
              canConnect: (remote: DeviceInfo) =>
                supportsAppleProximity(remote) &&
                (proximity.current()?.canConnect(remote) ?? false),
              connectTimeoutMs: 12_000,
            },
          ]
        : []),
    ],
    onRouteError: (routeId, error) => {
      logger.warn(`[SYNC] ${routeId} transport: ${error.message}`);
    },
  });
  const lanDiscovery = createRestartableLanDiscovery();
  const discoveryService = new CompositeDiscoveryService({
    sources: [
      {
        id: 'lan',
        service: lanDiscovery,
        required: proximity === null,
      },
      ...(proximity ? [{ id: 'proximity', service: proximity.discovery }] : []),
    ],
    onSourceError: (sourceId, error) => {
      logger.warn(`[SYNC] ${sourceId} discovery: ${error.message}`);
    },
  });
  let addressWatch: ReturnType<typeof setInterval> | null = null;
  let advertising = false;

  async function refreshLocalNetworkAddress(): Promise<boolean> {
    let nextHost = '';
    try {
      nextHost = await nativeSyncLanAddress();
    } catch (error) {
      logger.warn(
        `[SYNC] could not read this device's LAN address: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (nextHost === localDevice.host) return false;
    localDevice.host = nextHost;
    logger.log(`[SYNC] local LAN address=${nextHost || 'unavailable'}`);
    return true;
  }

  async function reactToLocalAddress(): Promise<void> {
    if (!(await refreshLocalNetworkAddress())) return;
    await proximity?.current()?.updateLocalDevice();
    if (advertising) await discoveryService.advertise(localDevice);
  }

  function watchLocalAddress(): void {
    if (addressWatch) return;
    addressWatch = setInterval(() => {
      reactToLocalAddress().catch((error: unknown) => {
        logger.warn(
          `[SYNC] could not follow this device's address change: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, LOCAL_ADDRESS_POLL_MS);
  }

  function stopWatchingLocalAddress(): void {
    if (!addressWatch) return;
    clearInterval(addressWatch);
    addressWatch = null;
  }

  const transport: TransportBridge = {
    async listen(port, onConnection) {
      await transportBridge.listen(port, onConnection);
      localDevice.port = transportBridge.boundPort ?? 0;
      await refreshLocalNetworkAddress();
      watchLocalAddress();
    },
    connect: (
      host: string,
      port: number,
      remote?: DeviceInfo,
    ): Promise<SyncConnection> => transportBridge.connect(host, port, remote),
    async stop() {
      stopWatchingLocalAddress();
      await transportBridge.stop();
    },
    getTransportHealthSnapshot: () =>
      transportBridge.getTransportHealthSnapshot(),
  };

  const discovery: DiscoveryService = {
    start: () => discoveryService.start(),
    startBrowsing: () => discoveryService.startBrowsing(),
    stopBrowsing: () => discoveryService.stopBrowsing(),
    async advertise(device) {
      await refreshLocalNetworkAddress();
      await proximity?.current()?.updateLocalDevice();
      await discoveryService.advertise(device);
      advertising = true;
    },
    async stopAdvertising() {
      await discoveryService.stopAdvertising();
      advertising = false;
    },
    async rescan() {
      await reactToLocalAddress();
      await discoveryService.rescan();
    },
    onDeviceFound: listener => discoveryService.onDeviceFound(listener),
    onDeviceLost: listener => discoveryService.onDeviceLost(listener),
    async stop() {
      advertising = false;
      await discoveryService.stop();
    },
    getDiscoveryHealthSnapshot: () =>
      discoveryService.getDiscoveryHealthSnapshot(),
  };

  return {
    transport,
    discovery,
    describeLocalDevice: () => localDevice,
  };
}
