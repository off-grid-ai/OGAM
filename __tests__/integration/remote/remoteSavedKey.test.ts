/**
 * A saved API key on a remote server (backlog items 1a and 1b).
 *
 * The user saves a keyed server, checks it, loads its models, restarts the app and picks a model.
 * Every step must use the saved key, so models keep their tools and context. A wrong key must read
 * as a refused key, not as a server with no models, and must not erase the models already known.
 *
 * The real remote-server manager, stores and capability probes run. The fakes sit only at the true
 * external boundaries: a llama.cpp server that requires its key (at fetch), the device Keychain,
 * and app storage, which persists across the simulated restart.
 */

const ENDPOINT = 'https://llm.example.test/v1';
const GOOD_KEY = 'sk-live-correct';
const MODEL = 'acme-assistant-8b';

type Keychain = Map<string, { username: string; password: string }>;
const keychainHolder = globalThis as unknown as { __remoteKeychain?: Keychain };

jest.mock('react-native-keychain', () => {
  const store = (): Map<string, { username: string; password: string }> => {
    const holder = globalThis as unknown as {
      __remoteKeychain?: Map<string, { username: string; password: string }>;
    };
    holder.__remoteKeychain ??= new Map();
    return holder.__remoteKeychain;
  };
  return {
    ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
    setGenericPassword: async (username: string, password: string, opts: { service: string }) => {
      store().set(opts.service, { username, password });
      return true;
    },
    getGenericPassword: async (opts: { service: string }) => store().get(opts.service) ?? false,
    resetGenericPassword: async (opts: { service: string }) => store().delete(opts.service),
  };
});

const realFetch = globalThis.fetch;
const LAN_ENDPOINT = 'http://192.168.1.40:8080/v1';

/** A llama.cpp server on the LAN over plain HTTP that needs no key to list its models. */
function startOpenLanServer(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/v1/models') {
      return new Response(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
}

/** A llama.cpp server on HTTPS that answers only requests carrying its key. */
function startKeyedServer(): { requests: Array<{ path: string; authorized: boolean }> } {
  const requests: Array<{ path: string; authorized: boolean }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const authorized = headers.get('Authorization') === `Bearer ${GOOD_KEY}`;
    requests.push({ path: url.pathname, authorized });
    if (!authorized) return new Response('{"error":"invalid api key"}', { status: 401 });
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/v1/models') return json({ object: 'list', data: [{ id: MODEL, object: 'model' }] });
    if (url.pathname === '/props') {
      return json({
        default_generation_settings: { n_ctx: 32768 },
        chat_template_caps: { supports_tools: true },
        modalities: { vision: false },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { requests };
}

function loadApp() {
  const { remoteServerManager } = require('../../../src/services/remoteServerManager');
  const { useRemoteServerStore } = require('../../../src/stores/remoteServerStore');
  return { remoteServerManager, useRemoteServerStore };
}

const knownModel = (useRemoteServerStore: { getState: () => any }, serverId: string) =>
  useRemoteServerStore.getState().discoveredModels[serverId]?.find((m: { id: string }) => m.id === MODEL);

beforeEach(async () => {
  keychainHolder.__remoteKeychain = new Map();
  jest.resetModules();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('a saved key on an HTTPS server', () => {
  it('is used for the check, the models and their tools, across a restart and a model pick', async () => {
    const server = startKeyedServer();
    const first = loadApp();

    const saved = await first.remoteServerManager.addServer({
      name: 'Studio llama.cpp',
      endpoint: ENDPOINT,
      providerType: 'openai-compatible',
      apiKey: GOOD_KEY,
    });
    // The key lives in the Keychain, never in the saved server record.
    expect(first.useRemoteServerStore.getState().getServerById(saved.id).apiKey).toBeUndefined();

    await expect(first.remoteServerManager.testConnection(saved.id)).resolves.toMatchObject({ success: true });
    await first.remoteServerManager.discoverModels(saved.id);
    expect(knownModel(first.useRemoteServerStore, saved.id)).toMatchObject({
      capabilities: { supportsToolCalling: true, maxContextLength: 32768 },
    });

    // Restart: fresh modules over the same app storage and Keychain.
    await new Promise(resolve => setTimeout(resolve, 0));
    jest.resetModules();
    const second = loadApp();
    await second.useRemoteServerStore.persist.rehydrate();
    await second.remoteServerManager.initializeProviders();
    expect(knownModel(second.useRemoteServerStore, saved.id)).toMatchObject({
      capabilities: { supportsToolCalling: true, maxContextLength: 32768 },
    });

    await second.remoteServerManager.setActiveRemoteTextModel(saved.id, MODEL);
    expect(second.useRemoteServerStore.getState().activeRemoteTextModelId).toBe(MODEL);
    expect(knownModel(second.useRemoteServerStore, saved.id)).toMatchObject({
      capabilities: { supportsToolCalling: true },
    });

    expect(server.requests.filter(request => !request.authorized)).toEqual([]);
  });

  it('reports a wrong key as a refused key and keeps the models it already knew', async () => {
    startKeyedServer();
    const { remoteServerManager, useRemoteServerStore } = loadApp();
    const saved = await remoteServerManager.addServer({
      name: 'Studio llama.cpp',
      endpoint: ENDPOINT,
      providerType: 'openai-compatible',
      apiKey: GOOD_KEY,
    });
    await remoteServerManager.discoverModels(saved.id);

    await remoteServerManager.updateServer(saved.id, { apiKey: 'sk-live-wrong' });

    const check = await remoteServerManager.testConnection(saved.id);
    expect(check.success).toBe(false);
    expect(check.error).toMatch(/rejected the API key/i);
    await expect(remoteServerManager.discoverModels(saved.id)).rejects.toThrow();
    expect(knownModel(useRemoteServerStore, saved.id)).toMatchObject({
      capabilities: { supportsToolCalling: true },
    });
  });
});

describe('a saved key on a private HTTP server', () => {
  it('explains that keys need HTTPS, keeps the saved models, and a keyless setup still works', async () => {
    const { HTTP_API_KEY_ERROR } = require('../../../src/services/remoteTransportPolicy');
    startOpenLanServer();
    const { remoteServerManager, useRemoteServerStore } = loadApp();
    const saved = await remoteServerManager.addServer({
      name: 'Desk llama.cpp',
      endpoint: LAN_ENDPOINT,
      providerType: 'openai-compatible',
    });
    await expect(remoteServerManager.testConnection(saved.id)).resolves.toMatchObject({ success: true });
    await remoteServerManager.discoverModels(saved.id);
    expect(knownModel(useRemoteServerStore, saved.id)).toBeTruthy();

    await remoteServerManager.updateServer(saved.id, { apiKey: 'sk-lan' });

    await expect(remoteServerManager.testConnection(saved.id)).resolves.toMatchObject({
      success: false,
      error: HTTP_API_KEY_ERROR,
    });
    expect(knownModel(useRemoteServerStore, saved.id)).toBeTruthy();

    await remoteServerManager.updateServer(saved.id, { apiKey: '' });
    await expect(remoteServerManager.testConnection(saved.id)).resolves.toMatchObject({ success: true });
  });
});
