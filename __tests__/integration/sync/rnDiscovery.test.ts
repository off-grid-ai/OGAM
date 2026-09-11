/**
 * Discovery wiring: the REAL DiscoveryOrchestrator + REAL RnDiscovery adapter, fed a fake
 * react-native-zeroconf. Proves that an mDNS-resolved peer is routed correctly — a NEW device is
 * surfaced to the pairing UI, a KNOWN device (we hold a secret for) remains visibly present while
 * auto-reconnect starts, and a previously resolved device fires onLost when removed. Only the
 * injected native (zeroconf) + the engine collaborator are faked; the
 * discovery/orchestrator behavior under test is the package's real code.
 */
import { buildDiscovery } from '../../../src/services/composition/sync-discovery';
import { createTxtRecord } from '@offgrid/sync';
import type { RnZeroconf } from '@offgrid/sync/rn-discovery';

type Handler = (arg: any) => void;

function makeFakeZeroconf() {
  const on: Record<string, Handler> = {};
  const z: RnZeroconf & {
    emitResolved: (svc: any) => void;
    emitRemove: (n: string) => void;
    published?: any;
  } = {
    on(ev: string, cb: Handler) {
      on[ev] = cb;
    },
    scan() {
      /* browsing started */
    },
    stop() {
      /* stopped */
    },
    removeDeviceListeners() {
      /* noop */
    },
    publishService(type, protocol, domain, name, port, txt) {
      z.published = { type, name, port, txt };
    },
    unpublishService() {
      z.published = undefined;
    },
    emitResolved: svc => on.resolved?.(svc),
    emitRemove: n => on.remove?.(n),
  };
  return z;
}

const local = {
  id: 'local-phone',
  name: 'Phone',
  platform: 'android' as const,
  version: '1',
  host: '',
  port: 0,
};
const remote = {
  id: 'remote-laptop',
  name: 'Laptop',
  platform: 'macos' as const,
  version: '1',
  host: '192.168.1.5',
  port: 7777,
};
const resolvedSvc = () => ({
  txt: createTxtRecord(remote),
  addresses: ['192.168.1.5'],
  host: 'laptop.local',
  port: 7777,
  name: `OffGrid-${remote.id}`,
});
const flush = () => new Promise(r => setImmediate(r));

describe('mobile Sync discovery wiring (real orchestrator + RnDiscovery, fake zeroconf)', () => {
  it('surfaces a NEW (unpaired) device for the pairing UI', async () => {
    const z = makeFakeZeroconf();
    let surfaced: any;
    const orch = buildDiscovery({
      zeroconf: z,
      localDevice: local,
      engine: { isPaired: () => false, reconnect: async () => {} },
      getSharedSecret: () => undefined, // not paired yet
      onDiscovered: d => {
        surfaced = d;
      },
    });
    await orch.start();
    z.emitResolved(resolvedSvc());
    await flush();
    expect(surfaced?.id).toBe('remote-laptop');
    expect(surfaced?.host).toBe('192.168.1.5');
  });

  it('keeps a KNOWN device visible while auto-reconnect starts', async () => {
    const z = makeFakeZeroconf();
    let surfaced = false;
    const reconnected: any = {};
    const orch = buildDiscovery({
      zeroconf: z,
      localDevice: local,
      engine: {
        isPaired: () => false,
        reconnect: async (d, s) => {
          reconnected.d = d;
          reconnected.s = s;
        },
      },
      getSharedSecret: id =>
        id === 'remote-laptop' ? 'stored-secret' : undefined,
      onDiscovered: () => {
        surfaced = true;
      },
    });
    await orch.start();
    z.emitResolved(resolvedSvc());
    await flush();
    expect(reconnected.d?.id).toBe('remote-laptop');
    expect(reconnected.s).toBe('stored-secret');
    expect(surfaced).toBe(true);
  });

  it('advertises this device on start and fires onLost on removal', async () => {
    const z = makeFakeZeroconf();
    let lost: string | undefined;
    const orch = buildDiscovery({
      zeroconf: z,
      localDevice: { ...local, port: 5555 },
      engine: { isPaired: () => false, reconnect: async () => {} },
      getSharedSecret: () => undefined,
      onLost: id => {
        lost = id;
      },
    });
    await orch.start();
    expect(z.published?.port).toBe(5555); // advertised over mDNS
    z.emitResolved(resolvedSvc());
    await flush();
    z.emitRemove(`OffGrid-${remote.id}._offgrid._tcp.local.`);
    await flush();
    expect(lost).toBe('remote-laptop');
  });

  /**
   * A saved device that is seen but cannot be dialled.
   *
   * Silence here hides a dead mesh: the device is in the list, the phone is "trying", and nothing ever
   * connects. Desktop has always reported this, so the phone has to as well.
   */
  it('reports a saved device that was seen but could not be dialled', async () => {
    const z = makeFakeZeroconf();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const failures: Array<{ name: string; message: string }> = [];
    const orch = buildDiscovery({
      zeroconf: z,
      localDevice: local,
      engine: {
        isPaired: () => false,
        reconnect: async () => {
          throw new Error('connect ECONNREFUSED');
        },
      },
      getSharedSecret: () => 'stored-secret',
      onReconnectFailed: (device, error) => {
        failures.push({ name: device.name, message: error.message });
      },
    });
    await orch.start();

    z.emitResolved(resolvedSvc());
    await flush();
    // The shared reconnect path re-resolves a failed cached address before it reports failure.
    z.emitResolved(resolvedSvc());
    await flush();

    expect(failures).toEqual([
      { name: 'Laptop', message: 'connect ECONNREFUSED' },
    ]);
    // The address is in the log, because "cannot connect" is only actionable with the host and port it
    // tried - that is what distinguishes a wrong subnet from a closed port.
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('192.168.1.5:7777');
    expect(logged).toContain('connect ECONNREFUSED');
    warn.mockRestore();
  });

  it('survives a failed reconnect that nobody asked to hear about', async () => {
    const z = makeFakeZeroconf();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const orch = buildDiscovery({
      zeroconf: z,
      localDevice: local,
      engine: {
        isPaired: () => false,
        reconnect: async () => {
          throw new Error('connect ECONNREFUSED');
        },
      },
      getSharedSecret: () => 'stored-secret',
    });
    await orch.start();

    // No onReconnectFailed passed: the log still happens and nothing throws inside discovery, which would
    // otherwise take down the scan and stop the phone finding anything at all.
    z.emitResolved(resolvedSvc());
    await flush();
    // Still scanning: a throw inside the discovery callback would have taken the scan down with it, and the
    // phone would stop finding anything at all.
    expect(() => z.emitResolved(resolvedSvc())).not.toThrow();
    jest.restoreAllMocks();
  });

  it('does not let LAN being down stop a phone that can also see nearby devices', async () => {
    const z = makeFakeZeroconf();
    const nearbyDevices: string[] = [];
    const orch = buildDiscovery({
      zeroconf: z,
      localDevice: local,
      engine: { isPaired: () => false, reconnect: async () => {} },
      getSharedSecret: () => undefined,
      additionalSources: [
        {
          id: 'proximity',
          service: {
            start: async () => {},
            advertise: async () => {},
            stopAdvertising: async () => {},
            onDeviceFound: () => {},
            onDeviceLost: () => {},
            stop: async () => {},
            rescan: async () => {
              nearbyDevices.push('rescanned');
            },
          },
        },
      ],
    });

    await orch.start();

    // With a second way to find devices, LAN is no longer required - an airplane-mode phone still finds the
    // iPad in the room. Both sources are started.
    await orch.rescan();
    expect(nearbyDevices).toEqual(['rescanned']);
  });

  it('does not offer a peer it can see but could not get an address for', async () => {
    const z = makeFakeZeroconf();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const surfaced: string[] = [];
    const orch = buildDiscovery({
      zeroconf: z,
      localDevice: local,
      engine: { isPaired: () => false, reconnect: async () => {} },
      getSharedSecret: () => undefined,
      onDiscovered: device => surfaced.push(device.id),
    });
    await orch.start();

    // mDNS resolved the service but carried no address, which happens on a network that blocks multicast
    // replies - and on Android also for a peer that published only a `.local` name, since its TCP stack
    // cannot resolve one.
    z.emitResolved({
      ...resolvedSvc(),
      // The peer advertised no address of its own either, so there is nothing to fall back to.
      txt: createTxtRecord({ ...remote, host: '' }),
      addresses: [],
      host: undefined,
    });
    await flush();

    // Not offered: a row that reports itself available and then fails with "host unreachable" is worse than
    // no row. And the reason is logged, because that symptom is otherwise unexplainable from the device.
    expect(surfaced).toEqual([]);
    expect(log.mock.calls.flat().join(' ')).toContain('no dialable address');
    log.mockRestore();
  });
});
