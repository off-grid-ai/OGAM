// Composition root: wires @offgrid/sync's DiscoveryOrchestrator to the package's RN mDNS adapter (RnDiscovery), fed
// an injected react-native-zeroconf instance (Android NSD / iOS Bonjour). The orchestrator browses
// for peers advertising `_offgrid._tcp.local` — the same service the desktop Node adapter uses, so
// phone and laptop find each other — and either auto-reconnects a known device or surfaces a new
// one for the pairing UI. The Zeroconf module is injected so this stays testable off-device.
import { Platform } from 'react-native';
import {
  CompositeDiscoveryService,
  DiscoveryOrchestrator,
} from '@offgrid/sync';
import type {
  DeviceInfo,
  DiscoveryScanSnapshot,
  DiscoveredDevice,
  DiscoverySource,
  SyncEngine,
} from '@offgrid/sync';
import { RnDiscovery } from '@offgrid/sync/rn-discovery';
import logger from '../../utils/logger';
import type { RnZeroconf } from '@offgrid/sync/rn-discovery';

export interface BuildDiscoveryArgs {
  /** react-native-zeroconf instance (or an in-memory fake in tests). */
  zeroconf: RnZeroconf;
  /** The SyncEngine — the orchestrator reads isPaired() and drives reconnect(). */
  engine: Pick<SyncEngine, 'isPaired' | 'reconnect'> &
    Partial<Pick<SyncEngine, 'retryMembershipRevocation'>>;
  localDevice: DeviceInfo;
  getSharedSecret: (deviceId: string) => string | undefined;
  /** Resolve the preferred route for a stable device identity before every reconnect. */
  resolveEndpoint?: (device: DeviceInfo) => DeviceInfo | Promise<DeviceInfo>;
  /** Whether storage HOLDS a credential, asked as a plain lookup. */
  hasCredential?: (deviceId: string) => boolean;
  getMembershipId?: (deviceId: string) => string | undefined;
  /** A new (unpaired) device appeared — surface it for the pairing UI. */
  onDiscovered?: (device: DiscoveredDevice) => void;
  onLost?: (deviceId: string) => void;
  onDiscoveryStateChanged?: (snapshot: DiscoveryScanSnapshot) => void;
  additionalSources?: DiscoverySource[];
  onSourceError?: (sourceId: string, error: Error) => void;
  /** A saved device was found but the reconnect could not start. Silence here hides a dead mesh. */
  onReconnectFailed?: (device: DeviceInfo, error: Error) => void;
  /** Pair an UNSAVED discovered device silently when it belongs to this licence. */
  admitSilently?: (device: DiscoveredDevice) => Promise<void>;
  /** Advertise on start. Absent means yes, so an existing install does not go hidden on upgrade. */
  discoverable?: boolean;
  /** Browse on start. Absent means yes. */
  browsing?: boolean;
}

export function buildDiscovery(
  args: BuildDiscoveryArgs,
): DiscoveryOrchestrator {
  // Android's TCP stack cannot resolve an mDNS `.local` name, so a peer that only advertises a
  // hostname is not dialable there and must not be offered as a LAN route. Apple platforms resolve it.
  const lanDiscovery = new RnDiscovery(args.zeroconf, {
    allowHostname: Platform.OS !== 'android',
    log: message => logger.log(message),
  });
  const additionalSources = args.additionalSources ?? [];
  const discovery = new CompositeDiscoveryService({
    sources: [
      {
        id: 'lan',
        service: lanDiscovery,
        required: additionalSources.length === 0,
      },
      ...additionalSources,
    ],
    onSourceError: args.onSourceError,
  });
  return new DiscoveryOrchestrator({
    engine: args.engine,
    discovery,
    localDevice: args.localDevice,
    ...(args.discoverable === undefined
      ? {}
      : { discoverable: args.discoverable }),
    ...(args.browsing === undefined ? {} : { browsing: args.browsing }),
    getSharedSecret: args.getSharedSecret,
    resolveEndpoint: args.resolveEndpoint,
    hasCredential:
      args.hasCredential ??
      (deviceId => args.getSharedSecret(deviceId) !== undefined),
    getMembershipId: args.getMembershipId,
    ...(args.admitSilently ? { admitSilently: args.admitSilently } : {}),
    onDiscovered: args.onDiscovered,
    onLost: args.onLost,
    onDiscoveryStateChanged: args.onDiscoveryStateChanged,
    // Without this, a saved device that is seen but cannot be dialled produces NOTHING - no log, no
    // state, no sign that the mesh is trying and failing. Desktop has always reported it.
    onReconnectFailed: (device, error) => {
      logger.warn(
        `[SYNC] reconnect to ${device.name} (${device.id}) at ${device.host}:${device.port} failed: ${error.message}`,
      );
      args.onReconnectFailed?.(device, error);
    },
  });
}
