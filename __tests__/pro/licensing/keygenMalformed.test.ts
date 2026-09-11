/**
 * What the licence client does when the provider answers with something unexpected.
 *
 * This is the code that decides whether a device gets Pro. The happy paths are already covered; these are the
 * answers a real provider gives on a bad day - a truncated body, an HTML error page, a 200 with no data, an
 * error array with no code - and each one has a wrong way to fail:
 *
 *  - treating a malformed body as a VALID licence hands Pro to a device that has not paid for it,
 *  - treating it as INVALID revokes Pro from someone who has paid, mid-flight,
 *  - throwing an unhandled parse error takes down whatever screen asked.
 *
 * The rule the tests pin: `valid` is true only when the provider says `meta.valid === true`, a licence exists
 * only when it came with an id, and everything else is reported as an unknown code rather than guessed at.
 *
 * `fetch` is faked because it is the network. Nothing else is stood in for.
 */
import { proIsPresent, requirePro } from '../helpers/requirePro';

const describePro = proIsPresent() ? describe : describe.skip;

type ClientModule = typeof import('@offgrid/pro/licensing/keygenClient');
let client: ClientModule;

beforeAll(() => {
  const mod = requirePro<ClientModule>('@offgrid/pro/licensing/keygenClient');
  if (mod) client = mod;
});

const originalFetch = global.fetch;

/** One scripted HTTP answer from the licence provider. */
function answer(opts: { status?: number; body?: unknown; notJson?: boolean }): void {
  global.fetch = (async () => ({
    ok: (opts.status ?? 200) < 400,
    status: opts.status ?? 200,
    json: async () => {
      if (opts.notJson) throw new Error('Unexpected token < in JSON');
      return opts.body ?? {};
    },
  })) as never;
}

afterEach(() => {
  global.fetch = originalFetch;
});

const FINGERPRINT = 'device-fingerprint-1';

describePro('validating a key when the provider answers badly', () => {
  it('does not call a licence valid when the body has no meta at all', async () => {
    answer({ body: {} });

    const result = await client.validateKey('OFFGRID-KEY', FINGERPRINT);

    // The default must be "not valid". Defaulting the other way grants Pro on a truncated response.
    expect(result.valid).toBe(false);
    expect(result.code).toBe('UNKNOWN');
    expect(result.license).toBeNull();
  });

  it('does not call a licence valid when meta.valid is merely truthy', async () => {
    answer({ body: { meta: { valid: 'yes', code: 'VALID' } } });

    // `=== true`, not truthiness. A string, a 1, or an object all mean the provider did not say valid.
    expect((await client.validateKey('OFFGRID-KEY', FINGERPRINT)).valid).toBe(false);
  });

  it('reports an unknown code rather than inventing one', async () => {
    answer({ body: { meta: { valid: false } } });

    const result = await client.validateKey('OFFGRID-KEY', FINGERPRINT);

    // The code drives the message the user reads. Guessing at it would show a specific reason that is not the
    // provider's reason.
    expect(result.code).toBe('UNKNOWN');
  });

  it('survives a body that is not JSON at all', async () => {
    // A proxy or captive portal returning an HTML error page, which is what this looks like from here.
    answer({ notJson: true });

    const result = await client.validateKey('OFFGRID-KEY', FINGERPRINT);

    // Reported as not-valid rather than thrown: the caller is a screen, and an unhandled parse error takes it
    // down instead of showing the user anything.
    expect(result.valid).toBe(false);
    expect(result.license).toBeNull();
  });

  it('returns no licence when the data carries no id', async () => {
    answer({ body: { meta: { valid: true, code: 'VALID' }, data: { attributes: { name: 'Pro' } } } });

    const result = await client.validateKey('OFFGRID-KEY', FINGERPRINT);

    // An id-less resource is not a licence we can act on: every later call (activate, list, deactivate) is
    // addressed by that id, so accepting it would produce requests to /licenses/undefined.
    expect(result.license).toBeNull();
  });

  it('reads a licence that does carry an id, defaulting what it omits', async () => {
    answer({
      body: { meta: { valid: true, code: 'VALID' }, data: { id: 'lic-1', attributes: {} } },
    });

    const result = await client.validateKey('OFFGRID-KEY', FINGERPRINT);

    // Present but sparse is normal: a licence with no expiry is perpetual, and absent metadata is an empty
    // object rather than undefined, so callers can read it without guarding every access.
    expect(result.license).toMatchObject({
      id: 'lic-1',
      expiry: null,
      metadata: {},
      name: null,
      maxMachines: 5,
    });
  });

  it('raises a network error, not a validation result, when the request cannot be made', async () => {
    global.fetch = (async () => {
      throw new Error('Network request failed');
    }) as never;

    // The distinction matters: offline is NOT "your licence is invalid". Conflating them would sign a paying
    // user out of Pro whenever their wifi dropped.
    await expect(client.validateKey('OFFGRID-KEY', FINGERPRINT)).rejects.toThrow(
      client.KeygenNetworkError,
    );
  });
});

describePro('addressing a licence by id', () => {
  it.each([
    ['an empty id', ''],
    ['a path traversal', '../../licenses'],
    ['a query injection', 'lic-1?limit=999'],
    ['a slash', 'lic/1'],
    ['whitespace only', '   '],
  ])('refuses to build a request with %s', async (_label, id) => {
    answer({ body: {} });

    // These ids go straight into a URL path. A rejected id is a request never made, which is the point: the
    // client must not be a way to reach arbitrary provider endpoints.
    // Signature is (key, licenseId) - the id is the SECOND argument.
    await expect(
      client.listMachines('OFFGRID-KEY', id as string),
    ).rejects.toThrow(/Invalid Keygen/);
  });

  it('accepts an ordinary provider id', async () => {
    answer({ body: { data: [] } });

    await expect(client.listMachines('OFFGRID-KEY', 'lic_ABC-123')).resolves.toEqual([]);
  });
});
