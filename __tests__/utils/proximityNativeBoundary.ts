/**
 * The iOS MultipeerConnectivity stack, in memory.
 *
 * `IosProximityAdapter` talks to exactly one thing: a native module that advertises, browses, opens
 * connections and hands back base64 frames. This stands in for that module and nothing else - the adapter,
 * its parsing, its buffering and its health accounting are the real code under test.
 *
 * Devices share one `ProximityAir`, so two adapters can genuinely find each other and exchange bytes: a
 * connection opened on one side raises the inbound event on the other, and a frame sent on one side arrives
 * on the other. Each device gets its OWN module object, which is what lets two adapters coexist in one test
 * - the adapter captures both the module and its event emitter at construction, so swapping
 * `NativeModules.SyncProximityModule` before each `new IosProximityAdapter(...)` binds them separately.
 */

import { NativeEventBus } from './nativeEventBus';

interface Device {
  id: string;
  name: string;
  platform: string;
  version?: string;
}

export const PEER_FOUND_EVENT = 'SyncProximityPeerFound';
export const PEER_LOST_EVENT = 'SyncProximityPeerLost';
export const CONNECTION_OPENED_EVENT = 'SyncProximityConnectionOpened';
export const DATA_EVENT = 'SyncProximityData';
export const CONNECTION_CLOSED_EVENT = 'SyncProximityConnectionClosed';

/** Mutable so a test can be the device that has no Multipeer at all. */
export const platform = { OS: 'ios' };

export const nativeModules: { SyncProximityModule?: ProximityNativeFake } = {};

/** RN's emitter, bound per device module so two phones' events never cross. */
export { FakeNativeEventEmitter as ProximityEventEmitter } from './nativeEventBus';

export class ProximityNativeFake extends NativeEventBus {
  /** Set by a test to make the native layer refuse, the way a device with Bluetooth off does. */
  startFailure: Error | undefined;
  startAdvertisingFailure: Error | undefined;
  startAdvertisingBarrier: Promise<void> | undefined;
  onStartAdvertising: (() => void) | undefined;
  stopAdvertisingFailure: Error | undefined;
  rescanFailure: Error | undefined;
  connectFailure: Error | undefined;
  readonly calls: string[] = [];
  started = false;
  browsing = false;
  advertising = false;
  device: Device;

  constructor(private readonly air: ProximityAir, device: Device) {
    super();
    this.device = device;
  }

  async start(device: Device): Promise<void> {
    this.calls.push('start');
    if (this.startFailure) throw this.startFailure;
    this.device = device;
    this.started = true;
    this.browsing = true;
    this.advertising = false;
    this.air.announce(this);
  }

  async startAdvertising(): Promise<void> {
    this.calls.push('startAdvertising');
    this.onStartAdvertising?.();
    if (this.startAdvertisingFailure) throw this.startAdvertisingFailure;
    await this.startAdvertisingBarrier;
    this.advertising = true;
    this.air.announce(this);
  }

  async stopAdvertising(): Promise<void> {
    this.calls.push('stopAdvertising');
    if (this.stopAdvertisingFailure) throw this.stopAdvertisingFailure;
    this.advertising = false;
    this.air.withdraw(this);
  }

  async rescan(): Promise<void> {
    this.calls.push('rescan');
    if (this.rescanFailure) throw this.rescanFailure;
    this.browsing = true;
    this.air.announce(this);
  }

  async stopBrowsing(): Promise<void> {
    this.calls.push('stopBrowsing');
    this.browsing = false;
  }

  async stop(): Promise<void> {
    this.calls.push('stop');
    this.started = false;
    this.browsing = false;
    this.advertising = false;
    this.air.withdraw(this);
  }

  async updateDevice(device: Device): Promise<void> {
    this.calls.push('updateDevice');
    this.device = device;
    this.air.announce(this);
  }

  async connect(deviceId: string): Promise<string> {
    this.calls.push(`connect:${deviceId}`);
    if (this.connectFailure) throw this.connectFailure;
    return this.air.open(this, deviceId);
  }

  send(connectionId: string, data: string): void {
    this.calls.push(`send:${connectionId}`);
    this.air.deliver(this, connectionId, data);
  }

  close(connectionId: string): void {
    this.calls.push(`close:${connectionId}`);
    this.air.shut(this, connectionId);
  }

  addListener(): void {}
  removeListeners(): void {}
}

export class ProximityAir {
  private readonly devices = new Set<ProximityNativeFake>();
  private readonly links = new Map<
    string,
    { a: ProximityNativeFake; b: ProximityNativeFake }
  >();
  private opened = 0;
  /**
   * The id native will hand back for the next connection, consumed once. Multipeer collapses two sides
   * inviting each other at the same moment into ONE session, so a `connect` can legitimately return the id
   * of a session this device already knows about.
   */
  nextConnectionId: string | undefined;

  /** Registers a device and installs its module as the one the next adapter will capture. */
  device(device: Device): ProximityNativeFake {
    const fake = new ProximityNativeFake(this, device);
    this.devices.add(fake);
    nativeModules.SyncProximityModule = fake;
    return fake;
  }

  announce(source: ProximityNativeFake): void {
    for (const peer of this.devices) {
      if (peer === source || !peer.started) continue;
      // Both directions, the way browsing and advertising each surface the other side.
      if (source.advertising && peer.browsing) {
        peer.emit(PEER_FOUND_EVENT, { device: source.device });
      }
      if (peer.advertising && source.browsing) {
        source.emit(PEER_FOUND_EVENT, { device: peer.device });
      }
    }
  }

  withdraw(source: ProximityNativeFake): void {
    for (const peer of this.devices) {
      if (peer === source) continue;
      peer.emit(PEER_LOST_EVENT, { deviceId: source.device.id });
    }
  }

  /** A peer going out of range, without it having stopped politely. */
  lose(source: ProximityNativeFake, deviceId: string): void {
    source.emit(PEER_LOST_EVENT, { deviceId });
  }

  open(source: ProximityNativeFake, deviceId: string): string {
    const peer = [...this.devices].find(
      candidate => candidate.device.id === deviceId && candidate.started,
    );
    if (!peer) throw new Error('Peer is not reachable.');
    this.opened += 1;
    const reused = this.nextConnectionId;
    this.nextConnectionId = undefined;
    const connectionId = reused ?? `proximity-${this.opened}`;
    this.links.set(connectionId, { a: source, b: peer });
    if (!reused) {
      peer.emit(CONNECTION_OPENED_EVENT, {
        connectionId,
        deviceId: source.device.id,
      });
    }
    return connectionId;
  }

  deliver(
    source: ProximityNativeFake,
    connectionId: string,
    data: string,
  ): void {
    const link = this.links.get(connectionId);
    if (!link) return;
    const peer = link.a === source ? link.b : link.a;
    peer.emit(DATA_EVENT, {
      connectionId,
      deviceId: source.device.id,
      data,
    });
  }

  shut(source: ProximityNativeFake, connectionId: string): void {
    const link = this.links.get(connectionId);
    if (!link) return;
    this.links.delete(connectionId);
    const peer = link.a === source ? link.b : link.a;
    peer.emit(CONNECTION_CLOSED_EVENT, {
      connectionId,
      deviceId: source.device.id,
    });
  }
}
