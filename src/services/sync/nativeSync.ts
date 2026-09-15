// The ONE module that binds @offgrid/sync to React Native's real native networking. It injects
// react-native-tcp-socket (transport) and react-native-zeroconf (mDNS) into the package's adapters
// via the tested buildSyncEngine / buildDiscovery factories, and owns start/stop sequencing. Kept
// deliberately thin: all logic worth testing lives in the factories (unit-tested off-device) and in
// @offgrid/sync itself; this file is the app-level wiring that can only run on a device.
import { Platform } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import Zeroconf from 'react-native-zeroconf';
import {
  OFFGRID_SYNC_PORT,
  type DeviceInfo,
  type DiscoveryScanSnapshot,
  type DiscoveredDevice,
  type PairingPersistence,
  type PairedDevice,
  type PairingAttemptSnapshot,
  type MembershipRevocationPersistence,
  type MembershipRevocationSnapshot,
  type Message,
  type DeviceCap,
  type SyncDiscoverabilityHealthInput,
  type SyncEngineOptions,
  type PeerLink,
  type PeerLinkEvent,
} from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import type { RnZeroconf } from '@offgrid/sync/rn-discovery';
import { buildSyncEngine } from './engine';
import { buildDiscovery } from './discovery';
import { IosProximityAdapter } from './nativeProximity';
import { nativeSyncLanAddress } from './nativeBlobChannel';
import logger from '../../utils/logger';

/**
 * How often to check whether this device's own address has changed.
 *
 * One cheap native call, and it does work only when the answer differs. Often enough that walking into
 * a different building settles in seconds, instead of waiting for the user to pull to refresh.
 */
const LOCAL_ADDRESS_POLL_MS = 15_000;

export interface NativeSyncCallbacks {
  /** Passphrase for an INBOUND pairing (UI prompt). Return null to refuse. */
  getPassphrase?: SyncEngineOptions['getPassphrase'];
  /** Stored shared secret for a device (for silent reconnect). */
  getSharedSecret?: (deviceId: string) => string | undefined;
  /** Authenticated endpoints saved by the host for an immediate startup reconnect. */
  listSavedDevices?: () => readonly DeviceInfo[];
  /** Resolve the preferred route for a stable device identity before every reconnect. */
  resolveEndpoint?: (device: DeviceInfo) => DeviceInfo | Promise<DeviceInfo>;
  /** Whether storage HOLDS a credential. Never a judgement about whether to use it. */
  hasCredential?: (deviceId: string) => boolean;
  getMembershipId?: (deviceId: string) => string | undefined;
  pairingEntitlement?: SyncEngineOptions['pairingEntitlement'];
  /** The persisted discoverability choice. Absent means advertise, as it always did. */
  discoverable?: boolean;
  pairingPersistence?: PairingPersistence;
  membershipPersistence?: MembershipRevocationPersistence;
  onMembershipRevocationChanged?: (
    snapshot: MembershipRevocationSnapshot,
  ) => void;
  onMembershipRevoked?: SyncEngineOptions['onMembershipRevoked'];
  onPaired?: (device: PairedDevice) => void;
  onPairingFailed?: (remote: DeviceInfo | undefined, error: string) => void;
  onPairingAttemptChanged?: (attempt: PairingAttemptSnapshot) => void;
  onDisconnected?: (deviceId: string) => void;
  onRouteChanged?: (deviceId: string, routeId: string | undefined) => void;
  onDiscovered?: (device: DiscoveredDevice) => void;
  onLost?: (deviceId: string) => void;
  onDiscoveryStateChanged?: (snapshot: DiscoveryScanSnapshot) => void;
  onReconnectFailed?: (device: DeviceInfo, error: Error) => void;
  onHealthChanged?: (health: SyncDiscoverabilityHealthInput) => void;
  onAppMessage?: (deviceId: string, channel: string, data: unknown) => void;
  onMessage?: (deviceId: string, message: Message) => void;
  /**
   * Silent mesh admission: a device already on this licence pairs with no code and no prompt.
   *
   * ONE resolver drives both halves - the engine answering an inbound request and the orchestrator
   * starting an outbound one - so this device cannot offer a codeless join it would itself refuse.
   */
  resolveMeshAdmission?: SyncEngineOptions['resolveMeshAdmission'];
  deviceCap?: DeviceCap;
}

export interface NativeSync {
  readonly localDevice: DeviceInfo;
  readonly availableRouteIds: readonly string[];
  getRuntimeHealth(): SyncDiscoverabilityHealthInput;
  start(): Promise<void>;
  stop(): Promise<void>;
  rescan(): Promise<void>;
  renameLocalDevice(name: string): Promise<void>;
  /** Advertise this device, or stop. Returns the value actually in effect. */
  setDiscoverable(next: boolean): Promise<boolean>;
  isDiscoverable(): boolean;
  setBrowsing(next: boolean): Promise<boolean>;
  isBrowsing(): boolean;
  pair(device: DeviceInfo, passphrase: string): Promise<PairedDevice>;
  cancelPairing(deviceId: string): Promise<boolean>;
  listPairingAttempts(): PairingAttemptSnapshot[];
  dismissPairingAttempt(attemptId: string): boolean;
  forget(
    deviceId: string,
    expectedMembershipId?: string,
  ): Promise<MembershipRevocationSnapshot | undefined>;
  retryMembershipRevocation(device: DeviceInfo): Promise<boolean>;
  dismissMembershipRevocation(revocationId: string): Promise<boolean>;
  listMembershipRevocations(): MembershipRevocationSnapshot[];
  reconnect(device: DeviceInfo, sharedSecret: string): Promise<void>;
  disconnect(deviceId: string): boolean;
  send(deviceId: string, message: Message): boolean;
  sendApp(deviceId: string, channel: string, data: unknown): boolean;
  isPaired(deviceId: string): boolean;
  /** What this device believes about one peer. The host renders it; it never derives it. */
  peerLink(deviceId: string): PeerLink;
  /** Report a fact about a peer. The host never decides what it means. */
  notePeerLink(deviceId: string, event: PeerLinkEvent): void;
  /** Reconsider visible peers after Keygen supplies a fresh personal-mesh roster. */
  noteRosterChanged(): void;
}

const DEFAULT_SYNC_NETWORK = {
  port: OFFGRID_SYNC_PORT,
  browsing: true,
} as const;

function formatSilentJoinError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown error';
}

/** Construct (but don't start) the mobile Sync stack for a given local device. */
export function createNativeSync(
  localDevice: DeviceInfo,
  cbs: NativeSyncCallbacks,
  network?: { port: number; browsing: boolean },
): NativeSync {
  const networkConfig = network ?? DEFAULT_SYNC_NETWORK;
  const discoveredDeviceIds = new Set<string>();
  let proximity: IosProximityAdapter | null = null;
  if (Platform.OS === 'ios') {
    try {
      proximity = new IosProximityAdapter(localDevice);
    } catch (error) {
      logger.warn(
        `[SYNC] proximity unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const { engine, transport } = buildSyncEngine({
    localDevice,
    tcpModule: TcpSocket as unknown as RnTcpModule,
    getPassphrase: cbs.getPassphrase,
    getSharedSecret: cbs.getSharedSecret,
    pairingEntitlement: cbs.pairingEntitlement,
    pairingPersistence: cbs.pairingPersistence,
    onPaired: cbs.onPaired,
    onPairingFailed: cbs.onPairingFailed,
    onPairingAttemptChanged: cbs.onPairingAttemptChanged,
    membershipPersistence: cbs.membershipPersistence,
    onMembershipRevocationChanged: cbs.onMembershipRevocationChanged,
    onMembershipRevoked: cbs.onMembershipRevoked,
    onDisconnected: (deviceId, reason) => {
      // Hand the drop to the orchestrator FIRST so a saved peer heals itself. Auto-reconnect used to
      // run only when discovery ANNOUNCED a device, so a peer already in the list was never retried
      // and stayed disconnected until someone tapped Reconnect. The reason rides along so a
      // disconnect the user asked for is left alone. Declared below and captured by this closure -
      // it is only ever called once a session has existed, long after both are built.
      orchestrator.handleDisconnected(deviceId, reason);
      cbs.onDisconnected?.(deviceId);
    },
    onRouteChanged: cbs.onRouteChanged,
    onMessage: cbs.onMessage,
    onAppMessage: cbs.onAppMessage,
    cap: cbs.deviceCap,
    additionalRoutes: proximity
      ? [
          {
            id: 'proximity',
            bridge: proximity,
            canConnect: remote => proximity?.canConnect(remote) ?? false,
            connectTimeoutMs: 12_000,
          },
        ]
      : undefined,
    onRouteError: (routeId, error) => {
      logger.warn(`[SYNC] ${routeId} transport: ${error.message}`);
      publishHealth();
    },
  });
  const zeroconf = new Zeroconf() as unknown as RnZeroconf;
  const orchestrator = buildDiscovery({
    zeroconf,
    engine,
    localDevice,
    ...(cbs.discoverable === undefined
      ? {}
      : { discoverable: cbs.discoverable }),
    browsing: networkConfig.browsing,
    getSharedSecret: cbs.getSharedSecret ?? (() => undefined),
    listSavedDevices: cbs.listSavedDevices,
    resolveEndpoint: cbs.resolveEndpoint,
    ...(cbs.hasCredential ? { hasCredential: cbs.hasCredential } : {}),
    getMembershipId: cbs.getMembershipId,
    // The initiator half. Same resolver the engine answers with.
    ...(cbs.resolveMeshAdmission
      ? {
          admitSilently: async (device: DiscoveredDevice) => {
            const authenticator = await cbs.resolveMeshAdmission?.(device);
            if (!authenticator) return;
            await engine.pairWith(device, authenticator);
          },
          // The outcome of that attempt, in words. Without it the log recorded an admission and then
          // nothing, for every one of 150 attempts between a phone and a laptop that never connected.
          onSilentJoinSettled: (device: DiscoveredDevice, error?: unknown) => {
            const outcome = error === undefined ? 'succeeded' : 'failed';
            const detail =
              error === undefined ? '' : `: ${formatSilentJoinError(error)}`;
            logger.log(
              `[SYNC] silent join ${outcome} for ${
                device.name ?? device.id
              }${detail}`,
            );
          },
        }
      : {}),
    onDiscovered: device => {
      discoveredDeviceIds.add(device.id);
      cbs.onDiscovered?.(device);
      publishHealth();
    },
    onLost: deviceId => {
      discoveredDeviceIds.delete(deviceId);
      cbs.onLost?.(deviceId);
      publishHealth();
    },
    onDiscoveryStateChanged: snapshot => {
      cbs.onDiscoveryStateChanged?.(snapshot);
      publishHealth();
    },
    onReconnectFailed: cbs.onReconnectFailed,
    additionalSources: proximity
      ? [{ id: 'proximity', service: proximity.discovery }]
      : undefined,
    onSourceError: (sourceId, error) => {
      logger.warn(`[SYNC] ${sourceId} discovery: ${error.message}`);
      publishHealth();
    },
  });
  let active = false;
  let rescanTask: Promise<void> | null = null;
  let addressWatch: ReturnType<typeof setInterval> | null = null;

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

  /**
   * The one response to "this device's address may have changed": ask, and re-advertise if it did.
   *
   * Written once because it was written twice - a rescan did both, a rename did only half - and the
   * half that gets forgotten is the re-advertisement, which is the one peers depend on.
   */
  async function reactToLocalAddress(): Promise<void> {
    if (await refreshLocalNetworkAddress()) {
      await orchestrator.refreshAdvertisement();
    }
  }

  /**
   * Notice a network change without being told.
   *
   * The address was only ever re-read when the USER did something - a pull to refresh, a rename, a
   * discoverability toggle - so carrying a phone from one network to another left it advertising the
   * address it used to have, and peers dialling a house it had moved out of. A phone that moved from
   * 192.168.1.38 to 192.168.1.26 kept being dialled at .38, which by then belonged to somebody else,
   * so the dial was refused and the pair stayed down with nothing reporting why.
   *
   * A poll rather than a platform network event: reading this device's own address is one cheap native
   * call, and every platform already answers it, so there is nothing to add per platform and nothing
   * to keep in step. Only the CHANGE does any work.
   */
  function watchLocalAddress(): void {
    if (addressWatch) return;
    addressWatch = setInterval(() => {
      if (!active) return;
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

  function healthSnapshot(): SyncDiscoverabilityHealthInput {
    return {
      transport: transport.getTransportHealthSnapshot?.(),
      discovery: orchestrator.getDiscoveryHealthSnapshot(),
      scan: orchestrator.getDiscoveryState(),
      peerCount: discoveredDeviceIds.size,
    };
  }

  function publishHealth(): void {
    cbs.onHealthChanged?.(healthSnapshot());
  }

  return {
    localDevice,
    availableRouteIds: proximity ? ['lan', 'proximity'] : ['lan'],
    getRuntimeHealth: healthSnapshot,
    async start() {
      publishHealth();
      try {
        await engine.start(networkConfig.port);
        localDevice.port = transport.boundPort ?? 0; // advertise the real bound port
        await refreshLocalNetworkAddress();
        await orchestrator.start();
        active = true;
        watchLocalAddress();
        publishHealth();
        logger.log(
          `[SYNC] started id=${localDevice.id} port=${localDevice.port} platform=${localDevice.platform}`,
        );
      } catch (error) {
        publishHealth();
        throw error;
      }
    },
    async stop() {
      active = false;
      await rescanTask?.catch(() => undefined);
      await orchestrator.stop();
      stopWatchingLocalAddress();
      await engine.stop();
      discoveredDeviceIds.clear();
      publishHealth();
      logger.log('[SYNC] stopped');
    },
    async rescan() {
      if (!active) throw new Error('Sync is not running.');
      if (rescanTask) return rescanTask;
      rescanTask = (async () => {
        await reactToLocalAddress();
        await orchestrator.rescan();
        logger.log('[SYNC] discovery rescanned');
      })();
      try {
        await rescanTask;
      } finally {
        rescanTask = null;
        publishHealth();
      }
    },
    async renameLocalDevice(name: string) {
      localDevice.name = name;
      if (!active) return;
      await refreshLocalNetworkAddress();
      await proximity?.updateLocalDevice();
      await orchestrator.refreshAdvertisement();
    },
    /** Advertising on/off while sync keeps running. Idempotence is the orchestrator's. */
    async setDiscoverable(next: boolean) {
      if (next) await refreshLocalNetworkAddress();
      await orchestrator.setDiscoverable(next);
      publishHealth();
      return orchestrator.isDiscoverable();
    },
    isDiscoverable: () => orchestrator.isDiscoverable(),
    async setBrowsing(next: boolean) {
      await orchestrator.setBrowsing(next);
      publishHealth();
      return orchestrator.isBrowsing();
    },
    isBrowsing: () => orchestrator.isBrowsing(),
    pair: (device, passphrase) => engine.pair(device, passphrase),
    cancelPairing: deviceId => engine.cancelPairing(deviceId),
    listPairingAttempts: () => engine.listPairingAttempts(),
    dismissPairingAttempt: attemptId => engine.dismissPairingAttempt(attemptId),
    forget: (deviceId, expectedMembershipId) =>
      engine.forget(deviceId, expectedMembershipId),
    retryMembershipRevocation: device =>
      engine.retryMembershipRevocation(device),
    dismissMembershipRevocation: revocationId =>
      engine.dismissMembershipRevocation(revocationId),
    listMembershipRevocations: () => engine.listMembershipRevocations(),
    reconnect: (device, sharedSecret) =>
      engine.reconnect(device, sharedSecret, cbs.getMembershipId?.(device.id)),
    disconnect: deviceId => engine.disconnect(deviceId),
    send: (deviceId, message) => engine.send(deviceId, message),
    sendApp: (deviceId, channel, data) =>
      engine.sendApp(deviceId, channel, data),
    isPaired: deviceId => engine.isPaired(deviceId),
    peerLink: deviceId => orchestrator.peerLink(deviceId),
    notePeerLink: (deviceId, event) =>
      orchestrator.notePeerLink(deviceId, event),
    noteRosterChanged: () => orchestrator.noteRosterChanged(),
  };
}

/** Best-effort platform tag for DeviceInfo. */
export function currentPlatform(): DeviceInfo['platform'] {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}
