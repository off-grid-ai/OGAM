/**
 * End-to-end proof that Off Grid Mobile's Sync wiring works: two SyncEngines built via our
 * buildSyncEngine factory (RN TCP adapter + injected rnByteCodec) complete the REAL NaCl pairing
 * handshake and exchange an encrypted app-channel message — over an in-memory socket module that
 * delivers inbound data as base64 STRINGS, i.e. the exact react-native-tcp-socket Android path.
 *
 * This drives the real @offgrid/sync engine/protocol/crypto + our real codec + factory (nothing
 * mocked but the OS socket boundary), so a green run means the encrypted frames survive the mobile
 * transport end-to-end — the on-device handshake is then just the same code over real sockets.
 */
import { Buffer } from 'buffer';
import { buildSyncEngine } from '../../../src/services/composition/sync-engine';
import { createLicensedMesh } from '../../harness/licensedMesh';
import { TYPED_PAIRING_CODE } from '../../utils/pairFromPeer';

const mesh = createLicensedMesh();
import type { RnTcpModule } from '@offgrid/sync/rn';

type Handler = (...a: any[]) => void;

// One in-memory socket endpoint. write() delivers to the peer's 'data' listeners AS BASE64 STRINGS
// (Android delivery), exercising rnByteCodec.toBytes' string path against the real engine.
class FakeSocket {
  peer?: FakeSocket;
  remoteAddress = '127.0.0.1';
  private handlers: Record<string, Handler[]> = {};
  on(ev: string, cb: Handler) {
    (this.handlers[ev] ||= []).push(cb);
    return this;
  }
  private emit(ev: string, ...a: any[]) {
    (this.handlers[ev] || []).forEach(h => h(...a));
  }
  write(data: unknown) {
    const buf = data as Buffer;
    const b64 = Buffer.from(buf).toString('base64');
    // async delivery, like a real socket
    setImmediate(() => this.peer?.emit('data', b64 as unknown));
    return true;
  }
  destroy() {
    setImmediate(() => {
      this.emit('close');
      this.peer?.emit('close');
    });
  }
  _deliverOpen() {
    /* no-op */
  }
}

// In-memory RnTcpModule: servers keyed by bound port; connect() wires a socket pair and hands the
// server side to its onConnection.
function makeFakeTcp(): RnTcpModule & {
  _servers: Map<number, (s: FakeSocket) => void>;
} {
  const servers = new Map<number, (s: FakeSocket) => void>();
  let nextPort = 41000;
  return {
    _servers: servers,
    createServer(onConnection: (socket: any) => void) {
      let boundPort = 0;
      const srv: any = {
        on() {
          return srv;
        },
        listen(opts: { port: number }, cb?: () => void) {
          boundPort = opts.port && opts.port > 0 ? opts.port : nextPort++;
          servers.set(boundPort, onConnection as any);
          cb?.();
          return srv;
        },
        address() {
          return { port: boundPort };
        },
        close() {
          servers.delete(boundPort);
        },
      };
      return srv;
    },
    createConnection(opts: { host: string; port: number }, cb?: () => void) {
      const client = new FakeSocket();
      const server = new FakeSocket();
      client.peer = server;
      server.peer = client;
      const onConn = servers.get(opts.port);
      if (!onConn) throw new Error(`no server on port ${opts.port}`);
      setImmediate(() => {
        onConn(server as any);
        cb?.();
      });
      return client as any;
    },
  };
}

const dev = (id: string, port: number) => ({
  id,
  name: id,
  platform: 'android' as const,
  version: '1',
  host: '127.0.0.1',
  port,
});
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

afterEach(() => {
  mesh.restore();
});

describe('mobile Sync wiring — pair + app message over the RN transport (base64 path)', () => {
  it('two engines built by buildSyncEngine pair and exchange an encrypted app message', async () => {
    const tcp = makeFakeTcp();
    let aPaired: any, bPaired: any, appMsg: any;

    // Pairing is a coded, licensed exchange: a code of the shape the parser accepts, and one side
    // sponsoring the other onto a licence. Neither is optional - without the code the handshake never
    // derives a key, and without the licence it fails with entitlement_unavailable.
    mesh.reset();
    const a = buildSyncEngine({
      localDevice: dev('dev-a', 0),
      tcpModule: tcp,
      getPassphrase: () => TYPED_PAIRING_CODE,
      pairingEntitlement: mesh.peer(),
      onPaired: d => {
        aPaired = d;
      },
      onAppMessage: (id, channel, data) => {
        appMsg = { id, channel, data };
      },
    });
    const b = buildSyncEngine({
      localDevice: dev('dev-b', 0),
      tcpModule: tcp,
      pairingEntitlement: mesh.joiner({ name: 'dev-b', platform: 'ios' }),
      onPaired: d => {
        bPaired = d;
      },
    });

    await Promise.all([a.engine.start(0), b.engine.start(0)]);
    const port = a.transport.boundPort!;
    expect(port).toBeGreaterThan(0);

    await b.engine.pair(dev('dev-a', port), TYPED_PAIRING_CODE);
    await delay(200);

    // Real NaCl handshake completed both sides, same derived secret.
    expect(aPaired?.id).toBe('dev-b');
    expect(bPaired?.id).toBe('dev-a');
    expect(aPaired.sharedSecret).toBe(bPaired.sharedSecret);

    // Encrypted app-channel message survives the base64 transport round-trip.
    const ok = b.engine.sendApp('dev-a', 'state', { hello: 'world', n: 42 });
    await delay(120);
    expect(ok).toBe(true);
    expect(appMsg).toEqual({
      id: 'dev-b',
      channel: 'state',
      data: { hello: 'world', n: 42 },
    });

    await a.engine.stop();
    await b.engine.stop();
  }, 15000);
});
