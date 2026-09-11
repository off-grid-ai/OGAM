// Composition root: builds a @offgrid/sync SyncEngine wired for React Native: the platform-agnostic engine + the
// package's RN TCP adapter, fed our injected byte codec. The actual socket module
// (react-native-tcp-socket) is passed in by the caller (see nativeSync.ts) so this wiring stays
// pure and unit-testable with an in-memory socket module — the package never imports RN.
import { MultiTransportBridge, SyncEngine } from '@offgrid/sync';
import type {
  SyncEngineOptions,
  DeviceInfo,
  TransportRoute,
} from '@offgrid/sync';
import { RnTcpTransport } from '@offgrid/sync/rn';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { rnByteCodec } from '../sync/byteCodec';

export interface BuildSyncEngineArgs {
  localDevice: DeviceInfo;
  /** react-native-tcp-socket (or an in-memory fake in tests). */
  tcpModule: RnTcpModule;
  getPassphrase?: SyncEngineOptions['getPassphrase'];
  getSharedSecret?: SyncEngineOptions['getSharedSecret'];
  pairingEntitlement?: SyncEngineOptions['pairingEntitlement'];
  /** Admit a device already on this licence with no code. Absent leaves pairing code-only. */
  resolveMeshAdmission?: SyncEngineOptions['resolveMeshAdmission'];
  onPaired?: SyncEngineOptions['onPaired'];
  pairingPersistence?: SyncEngineOptions['pairingPersistence'];
  onPairingFailed?: SyncEngineOptions['onPairingFailed'];
  onPairingAttemptChanged?: SyncEngineOptions['onPairingAttemptChanged'];
  membershipPersistence?: SyncEngineOptions['membershipPersistence'];
  onMembershipRevocationChanged?: SyncEngineOptions['onMembershipRevocationChanged'];
  onMembershipRevoked?: SyncEngineOptions['onMembershipRevoked'];
  onDisconnected?: SyncEngineOptions['onDisconnected'];
  onRouteChanged?: SyncEngineOptions['onRouteChanged'];
  onMessage?: SyncEngineOptions['onMessage'];
  onAppMessage?: SyncEngineOptions['onAppMessage'];
  cap?: SyncEngineOptions['cap'];
  additionalRoutes?: TransportRoute[];
  onRouteError?: (routeId: string, error: Error) => void;
}

/** Construct the RN transport (codec-injected) and the engine over it. Returns both so the caller
 *  can read transport.boundPort after start() to advertise the real listening port over mDNS. */
export function buildSyncEngine(args: BuildSyncEngineArgs): {
  engine: SyncEngine;
  transport: MultiTransportBridge;
} {
  const lanTransport = new RnTcpTransport(args.tcpModule, rnByteCodec);
  const additionalRoutes = args.additionalRoutes ?? [];
  const transport = new MultiTransportBridge({
    routes: [
      {
        id: 'lan',
        bridge: lanTransport,
        canConnect: remote => Boolean(remote.host && remote.port > 0),
        required: additionalRoutes.length === 0,
      },
      ...additionalRoutes,
    ],
    onRouteError: args.onRouteError,
  });
  const engine = new SyncEngine({
    localDevice: args.localDevice,
    transport,
    getPassphrase: args.getPassphrase,
    getSharedSecret: args.getSharedSecret,
    resolveMeshAdmission: args.resolveMeshAdmission,
    pairingEntitlement: args.pairingEntitlement,
    onPaired: args.onPaired,
    pairingPersistence: args.pairingPersistence,
    onPairingFailed: args.onPairingFailed,
    onPairingAttemptChanged: args.onPairingAttemptChanged,
    membershipPersistence: args.membershipPersistence,
    onMembershipRevocationChanged: args.onMembershipRevocationChanged,
    onMembershipRevoked: args.onMembershipRevoked,
    onDisconnected: args.onDisconnected,
    onRouteChanged: args.onRouteChanged,
    onMessage: args.onMessage,
    onAppMessage: args.onAppMessage,
    cap: args.cap,
  });
  return { engine, transport };
}
