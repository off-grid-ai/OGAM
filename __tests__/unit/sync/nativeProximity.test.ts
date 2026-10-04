import { Buffer } from 'buffer';
import type {
  DeviceInfo,
  DiscoveredDevice,
  SyncConnection,
} from '@offgrid/sync';
import { DiscoveryOrchestrator } from '@offgrid/sync';
import {
  CONNECTION_CLOSED_EVENT,
  CONNECTION_OPENED_EVENT,
  DATA_EVENT,
  PEER_FOUND_EVENT,
  PEER_LOST_EVENT,
  ProximityAir,
  nativeModules,
  platform,
  type ProximityNativeFake,
} from '../../utils/proximityNativeBoundary';
import { IosProximityAdapter } from '../../../src/services/sync/nativeProximity';
import { buildSyncEngine } from '../../../src/services/composition/sync-engine';
import { createNativeTcpBoundary } from '../../utils/nativeSyncBoundaries';

jest.mock('react-native', () => {
  const boundary = require('../../utils/proximityNativeBoundary');
  return {
    Platform: boundary.platform,
    NativeModules: boundary.nativeModules,
    NativeEventEmitter: boundary.ProximityEventEmitter,
  };
});

/**
 * Two iPhones in the same room, with no network between them.
 *
 * This is the transport that makes "it just works" true off-grid: no wifi, no router, no internet - the
 * phones find each other over Multipeer and the same sync engine runs on top. The adapter's only job is to
 * be indistinguishable from the LAN transport, so what is asserted here is what the engine above it relies
 * on: peers appear and disappear, bytes arrive whole and in order, a closed connection tells its owner, and
 * the native layer's failures become health facts instead of crashes.
 *
 * Both devices are the REAL adapter. Only the iOS Multipeer module is stood in for (see
 * utils/proximityNativeBoundary), so a connection opened on one adapter raises the inbound event on the
 * other and bytes sent on one arrive on the other - the same path a phone takes.
 */
describe('two phones talking with no network between them', () => {
  const info = (overrides: Partial<DeviceInfo> = {}): DeviceInfo => ({
    id: 'phone-a',
    name: "Mac's iPhone",
    platform: 'ios',
    version: '1',
    // A phone has no LAN identity in this room. The adapter is expected to ignore both.
    host: '',
    port: 0,
    ...overrides,
  });

  const PHONE_A = info();
  const PHONE_B = info({ id: 'phone-b', name: 'The iPad' });

  let air: ProximityAir;
  let nativeA: ProximityNativeFake;
  let nativeB: ProximityNativeFake;
  let phoneA: IosProximityAdapter;
  let phoneB: IosProximityAdapter;
  /** The live device record each adapter holds, the way the sync service mutates it on a rename. */
  let localB: DeviceInfo;

  /**
   * Health reporting is optional on the discovery contract, so a transport that stopped reporting it would
   * silently blank the Nearby row rather than fail. This adapter must report it.
   */
  const discoveryRoute = (adapter: IosProximityAdapter = phoneA) => {
    const snapshot = adapter.discovery.getDiscoveryHealthSnapshot?.();
    if (!snapshot) throw new Error('the adapter reported no discovery health');
    return snapshot.routes[0];
  };

  const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));
  const text = (data: Uint8Array) => Buffer.from(data).toString('utf8');
  const startVisible = async (
    adapter: IosProximityAdapter,
    device: DeviceInfo,
  ) => {
    await adapter.discovery.start();
    await adapter.discovery.advertise(device);
  };
  const orchestrate = (
    adapter: IosProximityAdapter,
    device: DeviceInfo,
    discoverable: boolean,
  ) => {
    const { engine } = buildSyncEngine({
      localDevice: device,
      tcpModule: createNativeTcpBoundary(),
    });
    return new DiscoveryOrchestrator({
      engine,
      discovery: adapter.discovery,
      localDevice: device,
      discoverable,
      getSharedSecret: () => undefined,
    });
  };

  beforeEach(() => {
    platform.OS = 'ios';
    air = new ProximityAir();
    // Each device's module is installed as the current one immediately before its adapter is built, which
    // is what binds the adapter to its own side of the air.
    nativeA = air.device(PHONE_A);
    phoneA = new IosProximityAdapter(PHONE_A);
    localB = { ...PHONE_B };
    nativeB = air.device(localB);
    phoneB = new IosProximityAdapter(localB);
  });

  describe('finding each other', () => {
    it('surfaces the other phone, with the name its owner gave it', async () => {
      const found: DiscoveredDevice[] = [];
      phoneA.discovery.onDeviceFound(device => found.push(device));

      await startVisible(phoneA, PHONE_A);
      await startVisible(phoneB, PHONE_B);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        id: 'phone-b',
        // The name is what the user picks their device out of a list by.
        name: 'The iPad',
        platform: 'ios',
        version: '1',
      });
      // No host or port: there is no network here. The engine above must not try to dial one.
      expect(found[0]).toMatchObject({ host: '', port: 0 });
    });

    it('replays the phones it already found to a listener that arrives late', async () => {
      await startVisible(phoneA, PHONE_A);
      await startVisible(phoneB, PHONE_B);

      const found: DiscoveredDevice[] = [];
      phoneA.discovery.onDeviceFound(device => found.push(device));

      // The screen mounts after discovery has been running. Without the replay it shows nothing until the
      // next peer event, which off-grid may be minutes away.
      expect(found.map(({ id }) => id)).toEqual(['phone-b']);
    });

    it('never offers the phone itself as a peer', async () => {
      const found: DiscoveredDevice[] = [];
      phoneA.discovery.onDeviceFound(device => found.push(device));
      await startVisible(phoneA, PHONE_A);

      nativeA.emit(PEER_FOUND_EVENT, { device: PHONE_A });

      // Multipeer does echo the local advertisement back. Pairing with yourself is a device list with a
      // second copy of the phone you are holding.
      expect(found).toEqual([]);
      expect(phoneA.canConnect(PHONE_A)).toBe(false);
    });

    it('reports a phone that walked out of range', async () => {
      const lost: string[] = [];
      await startVisible(phoneA, PHONE_A);
      await startVisible(phoneB, PHONE_B);
      phoneA.discovery.onDeviceLost(deviceId => lost.push(deviceId));
      expect(phoneA.canConnect(PHONE_B)).toBe(true);

      air.lose(nativeA, 'phone-b');

      expect(lost).toEqual(['phone-b']);
      // And it stops being connectable, so the UI cannot offer a transfer that would hang.
      expect(phoneA.canConnect(PHONE_B)).toBe(false);
    });

    it('counts the phones in range in the health it reports', async () => {
      await startVisible(phoneA, PHONE_A);
      await startVisible(phoneB, PHONE_B);

      expect(discoveryRoute()).toMatchObject({ id: 'proximity', peerCount: 1 });

      air.lose(nativeA, 'phone-b');

      expect(discoveryRoute().peerCount).toBe(0);
    });

    it.each([
      ['nothing at all', undefined],
      ['a bare string', 'phone-b'],
      ['no device on it', {}],
      ['a device that is not an object', { device: 7 }],
      ['no id', { device: { name: 'The iPad', platform: 'ios' } }],
      ['a blank id', { device: { id: '', name: 'The iPad', platform: 'ios' } }],
      ['no name', { device: { id: 'phone-b', platform: 'ios' } }],
      [
        'a blank name',
        { device: { id: 'phone-b', name: '', platform: 'ios' } },
      ],
      ['no platform', { device: { id: 'phone-b', name: 'The iPad' } }],
      [
        'a platform this build does not know',
        { device: { id: 'phone-b', name: 'The iPad', platform: 'watchos' } },
      ],
    ])('ignores a peer announcement with %s', async (_label, payload) => {
      const found: DiscoveredDevice[] = [];
      phoneA.discovery.onDeviceFound(device => found.push(device));
      await startVisible(phoneA, PHONE_A);

      nativeA.emit(PEER_FOUND_EVENT, payload);

      // A half-described peer in the list is a row that cannot be connected to. Dropping it is the only
      // honest answer, and it must not throw inside a native callback either.
      expect(found).toEqual([]);
    });

    it('accepts a peer that did not say which version it speaks', async () => {
      const found: DiscoveredDevice[] = [];
      phoneA.discovery.onDeviceFound(device => found.push(device));
      await startVisible(phoneA, PHONE_A);

      nativeA.emit(PEER_FOUND_EVENT, {
        device: { id: 'phone-b', name: 'The iPad', platform: 'ios' },
      });

      // Assumed to be the first version rather than dropped: an older build is still a device the user owns.
      expect(found[0].version).toBe('1');
    });

    it.each([
      ['nothing at all', undefined],
      ['no device id', {}],
      ['a device id that is not text', { deviceId: 7 }],
    ])('ignores a peer-lost event with %s', async (_label, payload) => {
      await startVisible(phoneA, PHONE_A);
      await startVisible(phoneB, PHONE_B);
      const lost: string[] = [];
      phoneA.discovery.onDeviceLost(deviceId => lost.push(deviceId));

      nativeA.emit(PEER_LOST_EVENT, payload);

      expect(lost).toEqual([]);
      // The peer it could not name is still there, which is the point: an unparseable event must not drop a
      // device that is actually in range.
      expect(phoneA.canConnect(PHONE_B)).toBe(true);
    });

    it('finds the other phone again after it renames itself', async () => {
      const found: DiscoveredDevice[] = [];
      await startVisible(phoneA, PHONE_A);
      await startVisible(phoneB, PHONE_B);
      phoneA.discovery.onDeviceFound(device => found.push(device));
      found.length = 0;

      localB.name = 'The Kitchen iPad';
      await phoneB.updateLocalDevice();

      expect(found[found.length - 1].name).toBe('The Kitchen iPad');
      expect(nativeB.calls).toContain('updateDevice');
    });
  });

  describe('carrying bytes', () => {
    const connected = async () => {
      const inbound: SyncConnection[] = [];
      await phoneB.listen(0, connection => inbound.push(connection));
      await phoneB.discovery.advertise(PHONE_B);
      await startVisible(phoneA, PHONE_A);
      const outbound = await phoneA.connect('', 0, PHONE_B);
      return { outbound, inbound };
    };

    it('delivers what one phone sends to the other, byte for byte', async () => {
      const { outbound, inbound } = await connected();
      const received: string[] = [];
      inbound[0].onData(data => received.push(text(data)));

      outbound.send(bytes('the first frame'));
      outbound.send(bytes('the second frame'));

      // In order and whole: the sync engine above frames its own messages and will not recover from a
      // reordered or merged stream.
      expect(received).toEqual(['the first frame', 'the second frame']);
    });

    it('carries bytes that are not text', async () => {
      const { outbound, inbound } = await connected();
      const received: Uint8Array[] = [];
      inbound[0].onData(data => received.push(data));

      outbound.send(new Uint8Array([0, 255, 13, 10, 128]));

      // Encrypted payloads and file chunks are arbitrary bytes. A round trip through base64 that mangled
      // a high byte or a newline would corrupt every transfer.
      expect([...received[0]]).toEqual([0, 255, 13, 10, 128]);
    });

    it('sends only part of a larger buffer when asked to', async () => {
      const { outbound, inbound } = await connected();
      const received: Uint8Array[] = [];
      inbound[0].onData(data => received.push(data));
      const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);

      outbound.send(backing.subarray(2, 5));

      // Chunked file sends hand over a window onto one big buffer. Sending the whole buffer would corrupt
      // every transfer larger than a chunk.
      expect([...received[0]]).toEqual([3, 4, 5]);
    });

    it('keeps the frames that arrive before anyone is listening', async () => {
      const { outbound, inbound } = await connected();

      outbound.send(bytes('sent while nobody was listening'));
      const received: string[] = [];
      inbound[0].onData(data => received.push(text(data)));

      // The handshake's first frame can beat the engine's own listener into place. Dropping it is a
      // connection that hangs with both sides waiting.
      expect(received).toEqual(['sent while nobody was listening']);
    });

    it('keeps frames that arrive before the connection object even exists', async () => {
      await startVisible(phoneA, PHONE_A);
      const inbound: SyncConnection[] = [];

      // Native reports data on a connection this side has not been told about yet - the open event and the
      // first frame racing each other out of the same native queue.
      nativeA.emit(DATA_EVENT, {
        connectionId: 'proximity-9',
        deviceId: 'phone-b',
        data: Buffer.from('the earliest frame', 'utf8').toString('base64'),
      });
      await phoneA.listen(0, connection => inbound.push(connection));
      nativeA.emit(CONNECTION_OPENED_EVENT, {
        connectionId: 'proximity-9',
        deviceId: 'phone-b',
      });

      const received: string[] = [];
      inbound[0].onData(data => received.push(text(data)));
      expect(received).toEqual(['the earliest frame']);
    });

    it('names the far end so the engine can tell connections apart', async () => {
      const { outbound, inbound } = await connected();

      expect(outbound.remoteHost).toBe('proximity:phone-b');
      expect(inbound[0].remoteHost).toBe('proximity:phone-a');
    });

    it('hands back the same connection when the same one opens twice', async () => {
      const { outbound } = await connected();

      const again = await phoneA.connect('', 0, PHONE_B);

      // Two objects for one native connection means two sets of listeners and half the frames going to a
      // reader nobody reads.
      expect(again).not.toBe(outbound);
      expect(again.remoteHost).toBe('proximity:phone-b');

      const inboundTwice: SyncConnection[] = [];
      await phoneA.listen(0, connection => inboundTwice.push(connection));
      nativeA.emit(CONNECTION_OPENED_EVENT, {
        connectionId: 'proximity-1',
        deviceId: 'phone-b',
      });
      nativeA.emit(CONNECTION_OPENED_EVENT, {
        connectionId: 'proximity-1',
        deviceId: 'phone-b',
      });
      expect(inboundTwice[0]).toBe(inboundTwice[1]);
    });

    it.each([
      ['no connection id', { deviceId: 'phone-b', data: 'AAA=' }],
      ['a blank connection id', { connectionId: '', deviceId: 'phone-b' }],
      ['no device id', { connectionId: 'proximity-1', data: 'AAA=' }],
      ['a blank device id', { connectionId: 'proximity-1', deviceId: '' }],
      ['nothing at all', undefined],
    ])('ignores a connection event with %s', async (_label, payload) => {
      const inbound: SyncConnection[] = [];
      await phoneA.listen(0, connection => inbound.push(connection));

      nativeA.emit(CONNECTION_OPENED_EVENT, payload);
      nativeA.emit(CONNECTION_CLOSED_EVENT, payload);

      expect(inbound).toEqual([]);
    });

    it('reuses the session when both phones invite each other at once', async () => {
      const inbound: SyncConnection[] = [];
      await phoneA.listen(0, connection => inbound.push(connection));
      await phoneA.discovery.advertise(PHONE_A);
      await startVisible(phoneB, PHONE_B);
      nativeA.emit(CONNECTION_OPENED_EVENT, {
        connectionId: 'proximity-1',
        deviceId: 'phone-b',
      });

      // Multipeer collapses two simultaneous invitations into one session, so native hands back the id this
      // side already knows.
      air.nextConnectionId = 'proximity-1';
      const outbound = await phoneA.connect('', 0, PHONE_B);

      // The same object, so the frames the inbound side is already reading are the frames this side sends
      // and receives - two wrappers over one session is half the traffic going to a reader nobody reads.
      expect(outbound).toBe(inbound[0]);
    });

    it.each([
      ['no payload', { connectionId: 'proximity-1', deviceId: 'phone-b' }],
      [
        'a payload that is not text',
        { connectionId: 'proximity-1', deviceId: 'phone-b', data: 7 },
      ],
      ['no connection to attribute it to', { data: 'AAA=' }],
      ['nothing at all', undefined],
    ])('ignores a data event with %s', async (_label, payload) => {
      const { inbound } = await connected();
      const received: string[] = [];
      inbound[0].onData(data => received.push(text(data)));

      nativeB.emit(DATA_EVENT, payload);

      expect(received).toEqual([]);
    });
  });

  describe('connections ending', () => {
    const connected = async () => {
      const inbound: SyncConnection[] = [];
      await phoneB.listen(0, connection => inbound.push(connection));
      await phoneB.discovery.advertise(PHONE_B);
      await startVisible(phoneA, PHONE_A);
      const outbound = await phoneA.connect('', 0, PHONE_B);
      return { outbound, inbound };
    };

    it('tells the other side when one phone hangs up', async () => {
      const { outbound, inbound } = await connected();
      let closed = false;
      inbound[0].onClose(() => {
        closed = true;
      });
      expect(closed).toBe(false);

      outbound.close();

      // The engine above retries and re-pairs off the back of this. Without it the far side waits for
      // frames that will never come.
      expect(closed).toBe(true);
    });

    it('tells a listener that arrives after the connection already closed', async () => {
      const { outbound, inbound } = await connected();
      outbound.close();

      let closed = false;
      inbound[0].onClose(() => {
        closed = true;
      });

      // Registering into a closed connection is the same race as the first frame. Silence here is a
      // transfer that never reports finishing.
      expect(closed).toBe(true);
    });

    it('stays quiet on a second hang-up', async () => {
      const { outbound, inbound } = await connected();
      let closes = 0;
      inbound[0].onClose(() => {
        closes += 1;
      });

      outbound.close();
      outbound.close();

      expect(closes).toBe(1);
      expect(nativeA.calls.filter(call => call.startsWith('close:'))).toEqual([
        'close:proximity-1',
      ]);
    });

    it('drops what is sent after hanging up instead of throwing', async () => {
      const { outbound, inbound } = await connected();
      const received: string[] = [];
      inbound[0].onData(data => received.push(text(data)));
      outbound.close();

      expect(() => outbound.send(bytes('too late'))).not.toThrow();

      // In-flight writes after a close are normal - the engine finds out asynchronously. They must not
      // arrive and must not crash.
      expect(received).toEqual([]);
    });

    it('forgets frames buffered on a connection that closed before anyone read them', async () => {
      const { outbound, inbound } = await connected();
      outbound.send(bytes('never read'));

      inbound[0].close();
      const received: string[] = [];
      inbound[0].onData(data => received.push(text(data)));

      // Delivering the backlog of a dead connection would replay an old handshake into a new session.
      expect(received).toEqual([]);
    });

    it('drops a frame that arrives after this side hung up', async () => {
      const { inbound } = await connected();
      const received: string[] = [];
      inbound[0].onData(data => received.push(text(data)));
      inbound[0].close();

      // Native has its own queue, so a frame in flight when we closed still gets reported. Handing it to
      // the engine after the connection was torn down replays into a session that no longer exists.
      nativeB.emit(DATA_EVENT, {
        connectionId: 'proximity-1',
        deviceId: 'phone-a',
        data: Buffer.from('in flight', 'utf8').toString('base64'),
      });

      expect(received).toEqual([]);
    });

    it('tells its owner once even when both sides report the hang-up', async () => {
      const { outbound } = await connected();
      let closes = 0;
      outbound.onClose(() => {
        closes += 1;
      });

      outbound.close();
      // Native reports the same close back to the side that asked for it.
      nativeA.emit(CONNECTION_CLOSED_EVENT, {
        connectionId: 'proximity-1',
        deviceId: 'phone-b',
      });

      // Once: the engine's cleanup runs off this, and running it twice retries a transfer that already
      // finished failing.
      expect(closes).toBe(1);
    });

    it('refuses to reach a phone that is no longer nearby', async () => {
      await startVisible(phoneA, PHONE_A);
      await startVisible(phoneB, PHONE_B);
      air.lose(nativeA, 'phone-b');

      await expect(phoneA.connect('', 0, PHONE_B)).rejects.toThrow(
        'The device is not available nearby.',
      );
    });

    it('refuses when it is not told which phone to reach', async () => {
      await startVisible(phoneA, PHONE_A);

      // A LAN host and port mean nothing here, so a call without the device is a caller that thinks this is
      // TCP. Failing loudly beats dialling nothing.
      await expect(phoneA.connect('192.168.1.50', 5555)).rejects.toThrow(
        'The device is not available nearby.',
      );
    });

    it('reports the native failure when the other phone refuses the connection', async () => {
      await startVisible(phoneA, PHONE_A);
      await startVisible(phoneB, PHONE_B);
      nativeA.connectFailure = new Error('Peer declined the invitation.');

      await expect(phoneA.connect('', 0, PHONE_B)).rejects.toThrow(
        'Peer declined the invitation.',
      );
    });
  });

  describe('the state the user is shown', () => {
    it('is idle before anything has been switched on', () => {
      expect(phoneA.getTransportHealthSnapshot()).toEqual({
        listener: { state: 'idle' },
        routes: [{ id: 'proximity', state: 'idle' }],
      });
      expect(discoveryRoute()).toMatchObject({
        browse: { state: 'idle' },
        advertise: { state: 'idle' },
        peerCount: 0,
      });
    });

    it('starts browsing without advertising', async () => {
      const starting = phoneA.discovery.start();
      // Caught mid-flight: a screen that opened during this shows "starting", not a blank state.
      expect(phoneA.getTransportHealthSnapshot().listener.state).toBe(
        'starting',
      );

      await starting;

      expect(nativeA.calls).toEqual(['start']);
      expect(nativeA.advertising).toBe(false);
      expect(discoveryRoute()).toMatchObject({
        browse: { state: 'ready' },
        advertise: { state: 'stopped' },
      });
      expect(phoneA.getTransportHealthSnapshot()).toMatchObject({
        listener: { state: 'ready' },
        routes: [{ id: 'proximity', state: 'ready' }],
      });
    });

    it('honours persisted Hidden through the real startup orchestrator', async () => {
      const startup = orchestrate(phoneA, PHONE_A, false);

      await startup.start();

      expect(startup.isDiscoverable()).toBe(false);
      expect(nativeA.calls).toEqual(['start']);
      expect(nativeA.advertising).toBe(false);
      expect(discoveryRoute()).toMatchObject({
        browse: { state: 'ready' },
        advertise: { state: 'stopped' },
      });
    });

    it('keeps orchestrator truth visible when native cannot stop, then retries', async () => {
      const startup = orchestrate(phoneA, PHONE_A, true);
      await startup.start();
      nativeA.stopAdvertisingFailure = new Error(
        'Multipeer refused to stop advertising.',
      );

      await expect(startup.setDiscoverable(false)).rejects.toThrow(
        'Multipeer refused to stop advertising.',
      );

      expect(startup.isDiscoverable()).toBe(true);
      expect(nativeA.advertising).toBe(true);
      expect(discoveryRoute().advertise.state).toBe('failed');

      nativeA.stopAdvertisingFailure = undefined;
      await startup.setDiscoverable(false);

      expect(startup.isDiscoverable()).toBe(false);
      expect(nativeA.advertising).toBe(false);
      expect(discoveryRoute().advertise.state).toBe('stopped');
    });

    it('reports an advertising failure and retries without restarting browsing', async () => {
      await phoneA.discovery.start();
      nativeA.startAdvertisingFailure = new Error(
        'Advertising needs local network permission.',
      );

      await expect(phoneA.discovery.advertise(PHONE_A)).rejects.toThrow(
        'Advertising needs local network permission.',
      );

      expect(nativeA.advertising).toBe(false);
      expect(discoveryRoute().browse.state).toBe('ready');
      expect(discoveryRoute().advertise).toMatchObject({
        state: 'failed',
        error: 'Advertising needs local network permission.',
      });

      nativeA.startAdvertisingFailure = undefined;
      await phoneA.discovery.advertise(PHONE_A);

      expect(nativeA.advertising).toBe(true);
      expect(discoveryRoute().advertise.state).toBe('ready');
      expect(
        nativeA.calls.filter(call => call === 'startAdvertising'),
      ).toHaveLength(2);
      expect(nativeA.calls.filter(call => call === 'start')).toHaveLength(1);
    });

    it('says why when the phone cannot advertise at all', async () => {
      nativeA.startFailure = new Error(
        'Nearby Sync needs local network permission.',
      );

      await expect(phoneA.discovery.start()).rejects.toThrow(
        'Nearby Sync needs local network permission.',
      );

      // The exact reason, not a generic failure: this is the string that tells the user to open Settings.
      expect(phoneA.getTransportHealthSnapshot().listener).toMatchObject({
        state: 'failed',
        error: 'Nearby Sync needs local network permission.',
      });
      expect(discoveryRoute().browse).toMatchObject({ state: 'failed' });
    });

    it('describes a native failure that was not even an error', async () => {
      // A rejected promise from a native module can carry a plain string.
      nativeA.startFailure = 'the radio is off' as unknown as Error;

      await expect(phoneA.discovery.start()).rejects.toBeDefined();

      expect(phoneA.getTransportHealthSnapshot().listener).toMatchObject({
        error: 'the radio is off',
      });
    });

    it('can be switched on again after a failure', async () => {
      nativeA.startFailure = new Error('the radio is off');
      await expect(phoneA.discovery.start()).rejects.toThrow();
      nativeA.startFailure = undefined;

      await startVisible(phoneA, PHONE_A);

      // The retry has to actually reach native again - a failed attempt left cached is a phone that never
      // recovers without a relaunch.
      expect(nativeA.calls.filter(call => call === 'start')).toHaveLength(2);
      expect(phoneA.getTransportHealthSnapshot().listener.state).toBe('ready');
    });

    it('starts the radio once when several things ask at the same time', async () => {
      await Promise.all([
        phoneA.discovery.start(),
        phoneA.discovery.advertise(PHONE_A),
        phoneA.listen(0, () => {}),
      ]);

      // Discovery, advertising and listening are one native session. Starting it three times would tear
      // down the browser mid-scan.
      expect(nativeA.calls.filter(call => call === 'start')).toHaveLength(1);
    });

    it('reports a rescan that failed without claiming the phone went down with it', async () => {
      await startVisible(phoneA, PHONE_A);
      nativeA.rescanFailure = new Error('Browsing failed to restart.');

      await expect(phoneA.discovery.rescan()).rejects.toThrow(
        'Browsing failed to restart.',
      );

      const route = discoveryRoute();
      expect(route.browse).toMatchObject({
        state: 'failed',
        error: 'Browsing failed to restart.',
      });
      // Still advertising: the phone is findable even though it has stopped looking.
      expect(route.advertise.state).toBe('ready');
    });

    it('describes a rescan failure that was not an error either', async () => {
      await phoneA.discovery.start();
      nativeA.rescanFailure = 'browsing died' as unknown as Error;

      await expect(phoneA.discovery.rescan()).rejects.toBeDefined();

      expect(discoveryRoute().browse).toMatchObject({ error: 'browsing died' });
    });

    it('finds the phones again on a rescan', async () => {
      await startVisible(phoneB, PHONE_B);
      const found: DiscoveredDevice[] = [];
      phoneA.discovery.onDeviceFound(device => found.push(device));
      await phoneA.discovery.start();
      found.length = 0;

      await phoneA.discovery.rescan();

      expect(found.map(({ id }) => id)).toEqual(['phone-b']);
      expect(discoveryRoute().browse.state).toBe('ready');
    });

    it('hands out a copy of its health rather than the live one', async () => {
      await phoneA.discovery.start();
      const snapshot = phoneA.getTransportHealthSnapshot();

      snapshot.listener.state = 'failed';

      // A caller that mutated what it was shown would be editing the phone's own state.
      expect(phoneA.getTransportHealthSnapshot().listener.state).toBe('ready');
    });
  });

  describe('switching it off', () => {
    it('closes the connections it was holding and reports itself stopped', async () => {
      const inbound: SyncConnection[] = [];
      await phoneB.listen(0, connection => inbound.push(connection));
      await phoneB.discovery.advertise(PHONE_B);
      await startVisible(phoneA, PHONE_A);
      const outbound = await phoneA.connect('', 0, PHONE_B);
      let closed = false;
      outbound.onClose(() => {
        closed = true;
      });

      await phoneA.stop();

      // The engine's own bookkeeping hangs off onClose. Dropping the transport without firing it leaves
      // transfers that never end.
      expect(closed).toBe(true);
      expect(phoneA.getTransportHealthSnapshot()).toEqual({
        listener: { state: 'stopped', updatedAt: expect.any(Number) },
        routes: [
          { id: 'proximity', state: 'stopped', updatedAt: expect.any(Number) },
        ],
      });
    });

    it('forgets the phones it had found', async () => {
      await startVisible(phoneA, PHONE_A);
      await startVisible(phoneB, PHONE_B);

      await phoneA.stop();

      expect(phoneA.canConnect(PHONE_B)).toBe(false);
      expect(discoveryRoute().peerCount).toBe(0);
      const found: DiscoveredDevice[] = [];
      phoneA.discovery.onDeviceFound(device => found.push(device));
      expect(found).toEqual([]);
    });

    it('stops reacting to the native layer once it is off', async () => {
      const found: DiscoveredDevice[] = [];
      phoneA.discovery.onDeviceFound(device => found.push(device));
      await phoneA.discovery.start();
      await phoneA.stop();

      nativeA.emit(PEER_FOUND_EVENT, { device: PHONE_B });

      // Late native callbacks after teardown are how a stopped transport comes back to life on its own.
      expect(found).toEqual([]);
    });

    it('does nothing when it was never switched on', async () => {
      await phoneA.stop();

      // No native stop on a session that never started - on iOS that is an exception out of the module.
      expect(nativeA.calls).toEqual([]);
    });

    it('waits for a start that is still in flight before shutting down', async () => {
      const starting = phoneA.discovery.start();

      await phoneA.stop();

      await expect(starting).resolves.toBeUndefined();
      // Ordered: stopping before the start resolved would leave the native session advertising with no
      // adapter listening to it.
      expect(nativeA.calls).toEqual(['start', 'stop']);
    });

    it('shuts down even if the start it was waiting for failed', async () => {
      nativeA.startFailure = new Error('the radio is off');
      const starting = phoneA.discovery.start().catch(() => undefined);

      await expect(phoneA.stop()).resolves.toBeUndefined();
      await starting;

      expect(phoneA.getTransportHealthSnapshot().listener.state).toBe(
        'stopped',
      );
    });

    it('can be switched back on afterwards', async () => {
      await startVisible(phoneA, PHONE_A);
      await phoneA.stop();

      await startVisible(phoneA, PHONE_A);
      await startVisible(phoneB, PHONE_B);

      // A user toggling Nearby off and on is not a relaunch. It has to find the room again.
      expect(phoneA.canConnect(PHONE_B)).toBe(true);
      expect(phoneA.getTransportHealthSnapshot().listener.state).toBe('ready');
    });

    it('stops advertising without stopping nearby browsing or connections', async () => {
      await startVisible(phoneA, PHONE_A);

      await expect(phoneA.discovery.stopAdvertising()).resolves.toBeUndefined();

      expect(nativeA.advertising).toBe(false);
      expect(nativeA.calls).toContain('stopAdvertising');
      expect(phoneA.getTransportHealthSnapshot().listener.state).toBe('ready');
      expect(discoveryRoute().advertise.state).toBe('stopped');
    });

    it('keeps the real advertising state on a native failure and retries cleanly', async () => {
      await startVisible(phoneA, PHONE_A);
      nativeA.stopAdvertisingFailure = new Error(
        'Multipeer refused to stop advertising.',
      );

      await expect(phoneA.discovery.stopAdvertising()).rejects.toThrow(
        'Multipeer refused to stop advertising.',
      );

      expect(nativeA.advertising).toBe(true);
      expect(discoveryRoute().advertise).toMatchObject({
        state: 'failed',
        error: 'Multipeer refused to stop advertising.',
      });

      nativeA.stopAdvertisingFailure = undefined;
      await phoneA.discovery.stopAdvertising();

      expect(nativeA.advertising).toBe(false);
      expect(discoveryRoute().advertise.state).toBe('stopped');
      expect(
        nativeA.calls.filter(call => call === 'stopAdvertising'),
      ).toHaveLength(2);
    });

    it('starts advertising again without restarting the whole nearby session', async () => {
      await startVisible(phoneA, PHONE_A);
      await phoneA.discovery.stopAdvertising();

      await phoneA.discovery.advertise(PHONE_A);

      expect(nativeA.advertising).toBe(true);
      expect(nativeA.calls.filter(call => call === 'start')).toHaveLength(1);
      expect(nativeA.calls).toContain('startAdvertising');
      expect(discoveryRoute().advertise.state).toBe('ready');
    });

    it('honours a hide request that arrives while native advertising starts', async () => {
      let releaseAdvertising: () => void = () => {};
      let markAdvertisingStarted: () => void = () => {};
      nativeA.startAdvertisingBarrier = new Promise<void>(resolve => {
        releaseAdvertising = resolve;
      });
      const advertisingStarted = new Promise<void>(resolve => {
        markAdvertisingStarted = resolve;
      });
      nativeA.onStartAdvertising = markAdvertisingStarted;

      const show = phoneA.discovery.advertise(PHONE_A);
      await advertisingStarted;
      const hide = phoneA.discovery.stopAdvertising();
      releaseAdvertising();

      await Promise.all([show, hide]);

      expect(nativeA.advertising).toBe(false);
      expect(nativeA.calls).toEqual([
        'start',
        'startAdvertising',
        'stopAdvertising',
      ]);
      expect(discoveryRoute().advertise.state).toBe('stopped');
    });

    it('honours a full shutdown requested before queued advertising starts', async () => {
      let releaseAdvertising: () => void = () => {};
      let markAdvertisingStarted: () => void = () => {};
      nativeA.startAdvertisingBarrier = new Promise<void>(resolve => {
        releaseAdvertising = resolve;
      });
      const advertisingStarted = new Promise<void>(resolve => {
        markAdvertisingStarted = resolve;
      });
      nativeA.onStartAdvertising = markAdvertisingStarted;

      const show = phoneA.discovery.advertise(PHONE_A);
      const shutdown = phoneA.stop();
      await advertisingStarted;
      releaseAdvertising();

      await Promise.all([show, shutdown]);

      expect(nativeA.started).toBe(false);
      expect(nativeA.advertising).toBe(false);
      expect(nativeA.calls).toEqual(['start', 'startAdvertising', 'stop']);
      expect(phoneA.getTransportHealthSnapshot().listener.state).toBe(
        'stopped',
      );
    });
  });

  describe('a device that has no Multipeer at all', () => {
    it('says Nearby is unavailable on Android', () => {
      platform.OS = 'android';

      expect(() => new IosProximityAdapter(PHONE_A)).toThrow(
        'Nearby Sync is unavailable on this device.',
      );
    });

    it('says the same when the native module is missing from the build', () => {
      delete nativeModules.SyncProximityModule;

      // A pro build without the native module compiled in. Failing at construction keeps the sync service
      // from offering a transport that cannot carry anything.
      expect(() => new IosProximityAdapter(PHONE_A)).toThrow(
        'Nearby Sync is unavailable on this device.',
      );
    });
  });
});
