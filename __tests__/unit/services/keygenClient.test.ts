import {
  validateKey,
  activateMachine,
  listMachines,
  deactivateMachine,
  KeygenNetworkError,
} from '../../../src/services/keygenClient';
import { KEYGEN_PRODUCT_ID } from '../../../src/config/keygen';

const res = (body: any, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
});

describe('keygenClient', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  describe('validateKey', () => {
    it('posts key + product/fingerprint scope and parses a VALID response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        res({
          meta: { valid: true, code: 'VALID' },
          data: { id: 'lic-1', attributes: { expiry: null, metadata: { email: 'a@b.co' }, name: 'n' } },
        }),
      );
      const out = await validateKey('key/abc', 'fp-1');

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/licenses/actions/validate-key');
      const body = JSON.parse(init.body);
      expect(body.meta.key).toBe('key/abc');
      expect(body.meta.scope.product).toBe(KEYGEN_PRODUCT_ID);
      expect(body.meta.scope.fingerprint).toBe('fp-1');

      expect(out).toEqual({
        valid: true,
        code: 'VALID',
        license: { id: 'lic-1', expiry: null, metadata: { email: 'a@b.co' }, name: 'n' },
      });
    });

    it('returns the code and null license when the key is not found', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(res({ meta: { valid: false, code: 'NOT_FOUND' }, data: null }));
      const out = await validateKey('key/nope', 'fp-1');
      expect(out.valid).toBe(false);
      expect(out.code).toBe('NOT_FOUND');
      expect(out.license).toBeNull();
    });

    it('throws KeygenNetworkError when fetch rejects', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
      await expect(validateKey('key/abc', 'fp-1')).rejects.toBeInstanceOf(KeygenNetworkError);
    });
  });

  describe('activateMachine', () => {
    it('authenticates with the license key and succeeds on 201', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(res({}, 201));
      const out = await activateMachine('key/abc', 'lic-1', { fingerprint: 'fp-1', platform: 'ios' });

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/machines');
      expect(init.headers.Authorization).toBe('License key/abc');
      const body = JSON.parse(init.body);
      expect(body.data.attributes.fingerprint).toBe('fp-1');
      expect(body.data.attributes.platform).toBe('ios');
      expect(body.data.relationships.license.data.id).toBe('lic-1');

      expect(out).toEqual({ ok: true, limitReached: false });
    });

    it('flags limitReached on a 422 machine-limit error', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        res({ errors: [{ code: 'MACHINE_LIMIT_EXCEEDED', detail: 'machine limit has been reached' }] }, 422),
      );
      expect(await activateMachine('key/abc', 'lic-1', { fingerprint: 'fp-1', platform: 'ios' })).toEqual({ ok: false, limitReached: true });
    });

    it('returns a plain failure on other errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(res({ errors: [{ code: 'UNPROCESSABLE' }] }, 400));
      expect(await activateMachine('key/abc', 'lic-1', { fingerprint: 'fp-1', platform: 'ios' })).toEqual({ ok: false, limitReached: false });
    });
  });

  describe('listMachines / deactivateMachine', () => {
    it('maps machine records', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        res({ data: [{ id: 'm1', attributes: { fingerprint: 'fp-1', platform: 'ios', name: 'Phone', created: 't' } }] }),
      );
      const machines = await listMachines('key/abc', 'lic-1');
      expect(machines).toEqual([{ id: 'm1', fingerprint: 'fp-1', platform: 'ios', name: 'Phone', lastSeen: 't' }]);
    });

    it('deactivates on 204', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(res(null, 204));
      expect(await deactivateMachine('key/abc', 'm1')).toBe(true);
    });
  });
});
