/**
 * remoteServerManager: saving a model server, its API key, and choosing its models.
 *
 * Only the device boundary is faked: the network (an LM Studio server behind an HTTPS front that wants
 * an API key, at fetch — see harness/keyedRemoteServer), the Keychain (a stateful store that really
 * keeps credentials and can be made unreadable) and async-storage. remoteServerManager, the remote
 * server store, the provider registry, the OpenAI-compatible provider, discovery and the capability
 * probes all run for real. Outcomes are read from the store, the Keychain, the provider registry and
 * what the server received.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import {
  installKeyedServer,
  keychainState,
  resetKeychain,
  setKeychainUnreadable,
  type KeyedServerHandle,
} from '../../harness/keyedRemoteServer';
import {
  detectVisionCapability,
  detectToolCallingCapability,
} from '../../../src/services/remoteServerManagerUtils';

jest.mock('react-native-keychain', () => require('../../harness/keyedRemoteServer').keychainModule());

const ORIGIN = 'https://studio.example.test';
const KEY = 'studio-key';
const MODEL = 'qwen2.5-7b-instruct';
const SERVICE = (id: string) => `ai.offgridmobile.servers.${id}`;

let server: KeyedServerHandle;
let manager: typeof import('../../../src/services/remoteServerManager').remoteServerManager;
let useRemoteServerStore: typeof import('../../../src/stores/remoteServerStore').useRemoteServerStore;
let providerRegistry: typeof import('../../../src/services/providers/registry').providerRegistry;

beforeEach(async () => {
  installNativeBoundary();
  resetKeychain();
  await require('@react-native-async-storage/async-storage').clear();
  server = installKeyedServer({ origin: ORIGIN, flavour: 'lmstudio', apiKey: KEY, modelId: MODEL });
  ({ remoteServerManager: manager } = require('../../../src/services/remoteServerManager'));
  ({ useRemoteServerStore } = require('../../../src/stores/remoteServerStore'));
  ({ providerRegistry } = require('../../../src/services/providers/registry'));
});

afterEach(() => server.restore());

const store = () => useRemoteServerStore.getState();
const add = (overrides: { apiKey?: string; endpoint?: string; name?: string } = {}) =>
  manager.addServer({ name: 'Studio', endpoint: ORIGIN, providerType: 'openai-compatible', apiKey: KEY, ...overrides });

describe('addServer', () => {
  it('saves a server without a key, and registers its provider', async () => {
    const saved = await add({ apiKey: undefined });

    expect(store().servers.map(s => s.id)).toEqual([saved.id]);
    expect(saved).toEqual(expect.objectContaining({ name: 'Studio', endpoint: ORIGIN }));
    expect(providerRegistry.getProvider(saved.id)).toBeDefined();
    expect(keychainState().items.size).toBe(0);
  });

  it('keeps the key in the Keychain, never in the saved server, and sends it to the server', async () => {
    const saved = await add();

    expect(keychainState().items.get(SERVICE(saved.id))).toEqual({ username: `server_${saved.id}`, password: KEY });
    expect(JSON.stringify(store().servers)).not.toContain(KEY);
    expect((await manager.discoverModels(saved.id)).map(m => m.id)).toEqual([MODEL]);
    expect(server.requests.every(r => r.authorized)).toBe(true);
  });

  it('returns the saved server instead of adding the same endpoint twice', async () => {
    const first = await add();

    const second = await add({ endpoint: `${ORIGIN}/`, name: 'Again' });

    expect(second.id).toBe(first.id);
    expect(store().servers).toHaveLength(1);
  });
});

describe('updateServer', () => {
  it('renames a server and keeps its key', async () => {
    const saved = await add();

    await manager.updateServer(saved.id, { name: 'Renamed' });

    expect(manager.getServer(saved.id)?.name).toBe('Renamed');
    expect(await manager.getApiKey(saved.id)).toBe(KEY);
  });

  it('stores a new key, and the provider sends the new key', async () => {
    const saved = await add({ apiKey: 'old-key' });
    expect((await manager.testConnection(saved.id)).success).toBe(false);

    await manager.updateServer(saved.id, { apiKey: KEY });

    expect(await manager.getApiKey(saved.id)).toBe(KEY);
    expect((await manager.testConnection(saved.id)).success).toBe(true);
  });

  it('removes the key when it is cleared', async () => {
    const saved = await add();

    await manager.updateServer(saved.id, { apiKey: '' });

    expect(await manager.getApiKey(saved.id)).toBeNull();
    expect(keychainState().items.has(SERVICE(saved.id))).toBe(false);
  });

  it('refuses a server that is not saved', async () => {
    await expect(manager.updateServer('nonexistent', { name: 'X' })).rejects.toThrow('Server not found');
  });
});

describe('removeServer', () => {
  it('forgets the server, its provider and its key', async () => {
    const saved = await add();

    await manager.removeServer(saved.id);

    expect(store().servers).toEqual([]);
    expect(providerRegistry.getProvider(saved.id)).toBeUndefined();
    expect(keychainState().items.has(SERVICE(saved.id))).toBe(false);
  });
});

describe('API keys', () => {
  it('reads the saved key, and null when there is none', async () => {
    const keyed = await add();
    const open = await add({ apiKey: undefined, endpoint: 'https://open.example.test' });

    expect(await manager.getApiKey(keyed.id)).toBe(KEY);
    expect(await manager.getApiKey(open.id)).toBeNull();
  });

  it('fails when the Keychain cannot be read', async () => {
    const saved = await add();
    setKeychainUnreadable(true);

    await expect(manager.getApiKey(saved.id)).rejects.toThrow('User interaction is not allowed.');
  });

  it('returns a server with its key, and null for an unknown server', async () => {
    const saved = await add();

    expect(await manager.getServerWithApiKey(saved.id)).toEqual({ ...manager.getServer(saved.id), apiKey: KEY });
    expect(await manager.getServerWithApiKey('nonexistent')).toBeNull();
  });
});

describe('choosing models', () => {
  it('makes a text model active: the server, the model and its provider', async () => {
    const saved = await add();
    await manager.discoverModels(saved.id);

    await manager.setActiveRemoteTextModel(saved.id, MODEL);

    expect(store().activeServerId).toBe(saved.id);
    expect(store().activeRemoteTextModelId).toBe(MODEL);
    expect(providerRegistry.getActiveProviderId()).toBe(saved.id);
    expect(providerRegistry.getProvider(saved.id)?.getLoadedModelId()).toBe(MODEL);
  });

  it('creates the provider when a saved server has none yet, then activates the model', async () => {
    // A server restored from storage before its provider was built.
    const id = store().addServer({ name: 'Studio', endpoint: ORIGIN, providerType: 'openai-compatible' });
    await manager.storeApiKey(id, KEY);
    expect(providerRegistry.getProvider(id)).toBeUndefined();

    await manager.setActiveRemoteTextModel(id, MODEL);

    expect(providerRegistry.getProvider(id)?.getLoadedModelId()).toBe(MODEL);
    expect(store().activeRemoteTextModelId).toBe(MODEL);
  });

  it('puts a picked image model where image generation reads it, and leaves the chat model alone', async () => {
    const saved = await add();
    await manager.setActiveRemoteMediaModel(saved.id, 'video', 'heygen/heygen-video-1');

    await manager.setActiveRemoteImageModel(saved.id, 'llava');

    expect(manager.getServer(saved.id)?.mediaModels).toEqual({ video: 'heygen/heygen-video-1', image: 'llava' });
    expect(store().getActiveRemoteMediaServer('image')?.id).toBe(saved.id);
    expect(store().activeRemoteImageModelId).toBe('llava');
    expect(store().activeRemoteTextModelId).toBeNull();
    expect(providerRegistry.getProvider(saved.id)?.getLoadedModelId()).not.toBe('llava');
  });

  it('clears every remote choice and goes back to the phone', async () => {
    const saved = await add();
    await manager.setActiveRemoteTextModel(saved.id, MODEL);
    for (const category of ['image', 'video', 'transcription', 'voice'] as const) {
      await manager.setActiveRemoteMediaModel(saved.id, category, `${category}-model`);
    }

    manager.clearActiveRemoteModel();

    expect(store().activeServerId).toBeNull();
    expect(store().activeRemoteTextModelId).toBeNull();
    expect(store().activeRemoteImageModelId).toBeNull();
    for (const category of ['image', 'video', 'transcription', 'voice'] as const) {
      expect(store().getActiveRemoteMediaServer(category)).toBeNull();
    }
    expect(providerRegistry.getActiveProviderId()).toBe('local');
  });
});

describe('after a relaunch (initializeProviders)', () => {
  /** A fresh app process over what an earlier launch saved. */
  async function relaunchWith(saved: Record<string, unknown>) {
    server.restore();
    installNativeBoundary();
    await require('@react-native-async-storage/async-storage').setItem('remote-servers', JSON.stringify({ state: saved, version: 2 }));
    server = installKeyedServer({ origin: ORIGIN, flavour: 'lmstudio', apiKey: KEY, modelId: MODEL });
    ({ remoteServerManager: manager } = require('../../../src/services/remoteServerManager'));
    ({ useRemoteServerStore } = require('../../../src/stores/remoteServerStore'));
    ({ providerRegistry } = require('../../../src/services/providers/registry'));
    await useRemoteServerStore.persist.rehydrate();
  }

  const savedServer = { id: 'studio', name: 'Studio', endpoint: ORIGIN, providerType: 'openai-compatible', createdAt: '2026-01-01T00:00:00.000Z' };

  it('moves a key an older build saved in the server record into the Keychain, and rediscovers the models', async () => {
    await relaunchWith({ servers: [{ ...savedServer, apiKey: KEY }] });

    await manager.initializeProviders();

    expect(keychainState().items.get(SERVICE('studio'))?.password).toBe(KEY);
    expect(manager.getServer('studio')?.apiKey).toBeUndefined();
    expect(providerRegistry.getProvider('studio')).toBeDefined();
    expect(store().discoveredModels.studio.map(m => m.id)).toEqual([MODEL]);
  });

  it('restores the text model that was active before the relaunch', async () => {
    resetKeychain();
    await require('../../harness/keyedRemoteServer').keychainModule().setGenericPassword('server_studio', KEY, { service: SERVICE('studio') });
    await relaunchWith({ servers: [savedServer], activeServerId: 'studio', activeRemoteTextModelId: MODEL });

    await manager.initializeProviders();

    expect(providerRegistry.getActiveProviderId()).toBe('studio');
    expect(providerRegistry.getProvider('studio')?.getLoadedModelId()).toBe(MODEL);
  });

  it('still activates the saved model when the server cannot list its models after the relaunch', async () => {
    resetKeychain();
    await require('../../harness/keyedRemoteServer').keychainModule().setGenericPassword('server_studio', KEY, { service: SERVICE('studio') });
    await relaunchWith({ servers: [savedServer], activeServerId: 'studio', activeRemoteTextModelId: MODEL });
    server.failAll(503);

    await manager.initializeProviders();

    expect(providerRegistry.getProvider('studio')?.getLoadedModelId()).toBe(MODEL);
    expect(store().activeRemoteTextModelId).toBe(MODEL);
  });
});

describe('reading saved servers', () => {
  it('lists servers, finds one by id, and answers null for an unknown id', async () => {
    const a = await add();
    const b = await add({ apiKey: undefined, endpoint: 'https://open.example.test', name: 'Open' });

    expect(manager.getServers().map(s => s.id)).toEqual([a.id, b.id]);
    expect(manager.getServer(b.id)?.name).toBe('Open');
    expect(manager.getServer('nonexistent')).toBeNull();
  });

  it('sets and reads the active server, and null means the phone', async () => {
    const saved = await add();
    expect(manager.getActiveServer()).toBeNull();

    manager.setActiveServer(saved.id);
    expect(manager.getActiveServer()?.id).toBe(saved.id);
    expect(providerRegistry.getActiveProviderId()).toBe(saved.id);

    manager.setActiveServer(null);
    expect(manager.getActiveServer()).toBeNull();
    expect(providerRegistry.getActiveProviderId()).toBe('local');
  });
});

describe('testing a connection', () => {
  it('lists the models with the capabilities the server reports, not ones guessed from names', async () => {
    const saved = await add();

    const result = await manager.testConnection(saved.id);

    expect(result.success).toBe(true);
    expect(result.models?.map(m => m.id)).toEqual([MODEL]);
    // LM Studio reports this model as trained for tools and without vision.
    expect(result.models?.[0].capabilities.supportsToolCalling).toBe(true);
    expect(result.models?.[0].capabilities.supportsVision).toBe(false);
  });

  it('reports a failure, with no models, when the server is down', async () => {
    const saved = await add();
    server.failAll(503);

    const result = await manager.testConnection(saved.id);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.models).toBeUndefined();
  });

  it('marks the server unhealthy and fails when its key cannot be read', async () => {
    const saved = await add();
    setKeychainUnreadable(true);

    await expect(manager.testConnection(saved.id)).rejects.toThrow();

    expect(store().serverHealth[saved.id]?.isHealthy).toBe(false);
  });

  it('tests an endpoint that is not saved yet, with the key given', async () => {
    expect((await manager.testConnectionByEndpoint(ORIGIN, KEY)).success).toBe(true);
    expect((await manager.testConnectionByEndpoint(ORIGIN)).success).toBe(false);
  });
});

describe('discoverModels', () => {
  it('refuses a server that is not saved', async () => {
    await expect(manager.discoverModels('nonexistent')).rejects.toThrow('Server not found');
  });

  it('finds the models with the saved key', async () => {
    const saved = await add();

    expect((await manager.discoverModels(saved.id)).map(m => m.id)).toEqual([MODEL]);
    expect(store().discoveredModels[saved.id].map(m => m.id)).toEqual([MODEL]);
  });

  it('finds nothing a keyed server keeps behind its key when no key is saved', async () => {
    const saved = await add({ apiKey: undefined });

    await expect(manager.discoverModels(saved.id)).rejects.toThrow();
    expect(server.requests.some(r => !r.authorized)).toBe(true);
  });
});

// ── capability detection from a model name (pure) ────────────────────

describe('detectVisionCapability', () => {
  it('detects vision models from the model name', () => {
    for (const id of [
      'llava-v1.6-mistral-7b', 'bakllava-7b', 'moondream-1', 'cogvlm-7b', 'cogagent-9b', 'fuyu-8b',
      'idefics-9b', 'qwen-vl-chat', 'gpt-4-vision-preview', 'gpt-4o', 'claude-3-opus', 'gemini-pro-vision',
      'pixtral-8b', 'phi-3.5-vision', 'minicpm-v', 'internvl-7b', 'yi-vl-6b',
    ]) expect(detectVisionCapability(id)).toBe(true);
  });

  it('returns false for models without vision', () => {
    for (const id of ['llama-2-7b', 'mistral-7b-instruct', 'codellama-34b', 'phi-2', 'gpt-3.5-turbo']) {
      expect(detectVisionCapability(id)).toBe(false);
    }
  });
});

describe('detectToolCallingCapability', () => {
  it('detects tool-capable model families', () => {
    for (const id of ['gpt-4-turbo', 'gpt-3.5-turbo', 'claude-3-sonnet', 'mistral-7b', 'llama-3-70b', 'qwen-72b']) {
      expect(detectToolCallingCapability(id)).toBe(true);
    }
  });

  it('returns false for models without tools', () => {
    for (const id of ['phi-2', 'tinyllama']) expect(detectToolCallingCapability(id)).toBe(false);
  });

  it('detects tool and function keywords', () => {
    for (const id of ['llama-2-70b-tool', 'mistral-function-call', 'firefunction-v1', 'dbrx-instruct', 'command-r']) {
      expect(detectToolCallingCapability(id)).toBe(true);
    }
  });
});
