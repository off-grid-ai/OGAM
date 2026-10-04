import { KEYGEN_API_BASE, KEYGEN_PRODUCT_ID } from '../../src/config/keygen';

/**
 * Keygen, in memory, answering at the network boundary.
 *
 * The licence stack is almost entirely ours: validating a key, deciding what a code means, storing a
 * credential, registering an installation, enforcing the device cap, replacing a seat. Only the HTTP
 * call at the very bottom belongs to somebody else, so that is the only thing faked here. Everything
 * above it - the client, the credential store, the mesh registry, the pairing entitlement authority -
 * runs for real against this, which is what lets these tests fail when that code is wrong.
 *
 * It is a FAKE and not a stub: it really holds licences and machines, really enforces the seat limit,
 * really returns Keygen's 422 with a machine-limit code when the cap is reached, really forgets a
 * machine that was deactivated. The outcome a test asserts is emergent, never programmed.
 *
 * Shapes come from Keygen's JSON:API responses, so the client parses the same thing it parses live.
 */

export interface KeygenFakeLicence {
  key: string;
  /** How many installations this licence admits. */
  seats: number;
  expiry?: string | null;
  name?: string | null;
  metadata?: Record<string, unknown>;
}

interface StoredMachine {
  id: string;
  licenseId: string;
  fingerprint: string;
  hostname: string | null;
  platform: string | null;
  name: string | null;
  created: string;
  updated: string;
}

interface StoredLicence extends KeygenFakeLicence {
  id: string;
}

const JSON_API = 'application/vnd.api+json';

export interface KeygenFake {
  /** Add a licence the tests can validate and activate against. Answers its provider id. */
  addLicence(licence: KeygenFakeLicence): string;
  /**
   * Put an installation on a licence directly, without the app having to ask.
   *
   * For a device that was already there when the test starts - the peer that has been paired for weeks.
   * The fingerprint is what the app reads back as the installation's sync device id.
   */
  activate(input: {
    key: string;
    fingerprint: string;
    name?: string;
    platform?: string;
  }): void;
  /**
   * Forget an installation server-side, the way freeing the seat from ANOTHER device does.
   *
   * The local registry keeps its own map of provider records, so this is how a test reaches the state where
   * that map names a machine the provider no longer has.
   */
  forget(fingerprint: string): void;
  /** Every installation currently on a licence, as the provider sees it. */
  machines(key: string): readonly StoredMachine[];
  /** Take the network away, to exercise what the app does offline. */
  setOffline(offline: boolean): void;
  /** Requests seen, for asserting that the app did not call out when it should not have. */
  readonly calls: readonly { method: string; path: string }[];
  reset(): void;
  install(): void;
  restore(): void;
}

export function createKeygenFake(): KeygenFake {
  const licences = new Map<string, StoredLicence>();
  const machines = new Map<string, StoredMachine>();
  const calls: { method: string; path: string }[] = [];
  let offline = false;
  let sequence = 0;
  const realFetch = globalThis.fetch;

  const nextId = (prefix: string): string => `${prefix}-${++sequence}`;
  const now = (): string =>
    new Date(1700000000000 + sequence * 1000).toISOString();
  const licenceByKey = (key: string): StoredLicence | undefined =>
    [...licences.values()].find(licence => licence.key === key);
  const licenceFromAuthorization = (
    headers: Headers,
  ): StoredLicence | undefined => {
    const presented = headers.get('authorization') ?? '';
    const key = presented.replace(/^License\s+/i, '').trim();
    return key ? licenceByKey(key) : undefined;
  };

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': JSON_API },
    });

  const machineResource = (machine: StoredMachine): unknown => ({
    id: machine.id,
    type: 'machines',
    attributes: {
      fingerprint: machine.fingerprint,
      hostname: machine.hostname,
      platform: machine.platform,
      name: machine.name,
      created: machine.created,
      updated: machine.updated,
      lastHeartbeat: machine.updated,
    },
    relationships: {
      license: { data: { type: 'licenses', id: machine.licenseId } },
    },
  });

  const licenceResource = (licence: StoredLicence): unknown => ({
    id: licence.id,
    type: 'licenses',
    attributes: {
      expiry: licence.expiry ?? null,
      maxMachines: licence.seats,
      name: licence.name ?? null,
      metadata: licence.metadata ?? {},
    },
  });

  const validate = async (request: Request): Promise<Response> => {
    const body = (await request.json().catch(() => ({}))) as {
      meta?: {
        key?: string;
        scope?: { product?: string; fingerprint?: string };
      };
    };
    const key = body.meta?.key ?? '';
    const fingerprint = body.meta?.scope?.fingerprint ?? '';
    const licence = licenceByKey(key);
    if (!licence) {
      return json(200, {
        meta: { valid: false, code: 'NOT_FOUND' },
        data: null,
      });
    }
    if (
      body.meta?.scope?.product &&
      body.meta.scope.product !== KEYGEN_PRODUCT_ID
    ) {
      return json(200, {
        meta: { valid: false, code: 'PRODUCT_SCOPE_MISMATCH' },
        data: licenceResource(licence),
      });
    }
    const activated = [...machines.values()].filter(
      machine => machine.licenseId === licence.id,
    );
    const mine = activated.find(machine => machine.fingerprint === fingerprint);
    // Keygen's own vocabulary, which the app branches on: a key with no installations yet is valid
    // to import, a fingerprint it does not know is not yet activated, and over the cap it says so.
    const code = mine
      ? 'VALID'
      : activated.length === 0
      ? 'NO_MACHINES'
      : activated.length >= licence.seats
      ? 'TOO_MANY_MACHINES'
      : 'NO_MACHINE';
    return json(200, {
      meta: { valid: code === 'VALID', code },
      data: licenceResource(licence),
    });
  };

  const activate = async (request: Request): Promise<Response> => {
    const licence = licenceFromAuthorization(request.headers);
    if (!licence) return json(401, { errors: [{ code: 'UNAUTHORIZED' }] });
    const body = (await request.json().catch(() => ({}))) as {
      data?: {
        attributes?: {
          fingerprint?: string;
          hostname?: string;
          platform?: string;
          name?: string;
        };
        relationships?: { license?: { data?: { id?: string } } };
      };
    };
    const attributes = body.data?.attributes ?? {};
    const fingerprint = attributes.fingerprint ?? '';
    const existing = [...machines.values()].find(
      machine =>
        machine.licenseId === licence.id && machine.fingerprint === fingerprint,
    );
    // Activating the same installation twice is not a second seat.
    if (existing) return json(201, { data: machineResource(existing) });
    const activated = [...machines.values()].filter(
      machine => machine.licenseId === licence.id,
    );
    if (activated.length >= licence.seats) {
      return json(422, {
        errors: [
          {
            code: 'MACHINE_LIMIT_EXCEEDED',
            detail: 'machine limit has been exceeded for this license',
          },
        ],
      });
    }
    const machine: StoredMachine = {
      id: nextId('machine'),
      licenseId: licence.id,
      fingerprint,
      hostname: attributes.hostname ?? null,
      platform: attributes.platform ?? null,
      name: attributes.name ?? null,
      created: now(),
      updated: now(),
    };
    machines.set(machine.id, machine);
    return json(201, { data: machineResource(machine) });
  };

  const handle = async (request: Request, path: string): Promise<Response> => {
    calls.push({ method: request.method, path });
    if (
      path.startsWith('/licenses/actions/validate-key') &&
      request.method === 'POST'
    ) {
      return validate(request);
    }
    if (path === '/machines' && request.method === 'POST')
      return activate(request);

    const listing = /^\/licenses\/([^/]+)\/machines$/.exec(path);
    if (listing && request.method === 'GET') {
      const licence = licenceFromAuthorization(request.headers);
      if (!licence || licence.id !== listing[1]) {
        return json(401, { errors: [{ code: 'UNAUTHORIZED' }] });
      }
      return json(200, {
        data: [...machines.values()]
          .filter(machine => machine.licenseId === licence.id)
          .map(machineResource),
      });
    }

    const one = /^\/machines\/([^/]+)$/.exec(path);
    if (one && request.method === 'DELETE') {
      const licence = licenceFromAuthorization(request.headers);
      const machine = machines.get(one[1] ?? '');
      if (!licence || !machine || machine.licenseId !== licence.id) {
        return json(404, { errors: [{ code: 'NOT_FOUND' }] });
      }
      machines.delete(machine.id);
      return new Response(null, { status: 204 });
    }
    if (one && request.method === 'PATCH') {
      const licence = licenceFromAuthorization(request.headers);
      const machine = machines.get(one[1] ?? '');
      if (!licence || !machine || machine.licenseId !== licence.id) {
        return json(404, { errors: [{ code: 'NOT_FOUND' }] });
      }
      const body = (await request.json().catch(() => ({}))) as {
        data?: {
          attributes?: { hostname?: string; name?: string; platform?: string };
        };
      };
      const attributes = body.data?.attributes ?? {};
      const updated: StoredMachine = {
        ...machine,
        hostname: attributes.hostname ?? machine.hostname,
        name: attributes.name ?? machine.name,
        platform: attributes.platform ?? machine.platform,
        updated: now(),
      };
      machines.set(updated.id, updated);
      return json(200, { data: machineResource(updated) });
    }
    return json(404, { errors: [{ code: 'NOT_FOUND' }] });
  };

  return {
    calls,
    activate({ key, fingerprint, name, platform }) {
      const licence = licenceByKey(key);
      if (!licence) throw new Error(`no licence for ${key}`);
      const machine: StoredMachine = {
        id: nextId('machine'),
        licenseId: licence.id,
        fingerprint,
        hostname: null,
        platform: platform ?? null,
        name: name ?? null,
        created: now(),
        updated: now(),
      };
      machines.set(machine.id, machine);
    },

    forget(fingerprint) {
      for (const [id, machine] of machines) {
        if (machine.fingerprint === fingerprint) machines.delete(id);
      }
    },

    addLicence(licence) {
      const stored: StoredLicence = { ...licence, id: nextId('licence') };
      licences.set(stored.id, stored);
      return stored.id;
    },
    machines(key) {
      const licence = licenceByKey(key);
      return licence
        ? [...machines.values()].filter(
            machine => machine.licenseId === licence.id,
          )
        : [];
    },
    setOffline(next) {
      offline = next;
    },
    reset() {
      licences.clear();
      machines.clear();
      calls.length = 0;
      offline = false;
      sequence = 0;
    },
    install() {
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
            ? input.href
            : input.url;
        if (!url.startsWith(KEYGEN_API_BASE)) {
          // Anything else is not this fake's business and must not silently succeed.
          throw new Error(`unexpected request to ${url}`);
        }
        // Offline is a transport failure, which is what the app distinguishes from a provider refusal.
        if (offline) throw new TypeError('Network request failed');
        const request = new Request(url, init);
        return handle(request, url.slice(KEYGEN_API_BASE.length));
      }) as typeof globalThis.fetch;
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}
