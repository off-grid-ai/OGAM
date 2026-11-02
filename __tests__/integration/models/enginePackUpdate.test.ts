/**
 * Android engine packs, end to end through the real service, the real residency lock and the real
 * catalog gate. Faked only at the device boundary: the network (manifest, pack download), the disk
 * (memfs, real sha256), the zip native, llama.rn, and the native EnginePack store, which here keeps
 * the state the Kotlin store keeps (EnginePackStoreTest proves its file checks) and plays launches.
 *
 * A newer llama.cpp arrives without an app update: it is downloaded, verified, installed on trial,
 * loaded on the next launch, passes a test prompt and then unlocks models that need it (LFM3). A
 * pack that does not load, fails the prompt, or does not match its signature or hash never sticks.
 */
import nacl from 'tweetnacl';
import { decodeUTF8, encodeBase64 } from 'tweetnacl-util';
import { createHash } from 'node:crypto';
import { NativeModules } from 'react-native';
import { GB, installNativeBoundary, type NativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

const MANIFEST = 'https://mobile-runtime.getoffgridai.co/android/manifest.json';
const PACK_URL = 'https://mobile-runtime.getoffgridai.co/android/0.13.0-b12032/engine-pack-arm64-v8a.zip';
const VERSION = '0.13.0-b12032';
const BUNDLED_BUILD = 11385;
const BUNDLED_VERSION = '0.13.0-b11385';
const PACK_BUILD = 12032;
const LFM3 = { minLlamaBuild: 11938 };
const DAY = 24 * 60 * 60 * 1000;

const keys = nacl.sign.keyPair();
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const ZIP = 'PK engine pack 0.13.0-b12032';
const FILES = { 'librnllama.so': 'core', 'librnllama_jni.so': 'jni' };

function manifestBody(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema: 1, package: '@offgrid/llama.rn', version: VERSION, llamaCpp: 'b12032', llamaBuild: PACK_BUILD,
    bridge: 'bridge-1', reactNative: '0.83.1', createdAt: '2026-11-01T00:00:00.000Z',
    packs: [{
      abi: 'arm64-v8a', url: PACK_URL, sha256: sha(ZIP), size: ZIP.length,
      files: Object.entries(FILES).map(([path, body]) => ({ path, sha256: sha(body), size: body.length })),
    }],
    ...over,
  });
}
const signed = (body: string) => encodeBase64(nacl.sign.detached(decodeUTF8(body), keys.secretKey));

/** The native store as the app sees it across launches (state mirrors EnginePackStore). */
function nativeStore() {
  // A fresh store has written nothing yet: no rejected list, no packs.
  const state: { trial?: { id: string; launches: number }; active?: string; rejected?: Record<string, string>; packs: Record<string, { llamaBuild: number; engineVersion: string }> } = { packs: {} };
  let status = { bootPackId: null as string | null, trial: false, llamaBuild: null as number | null, engineVersion: null as string | null, source: null as string | null, error: null as string | null };
  const installed: Array<{ staging: string; entry: Record<string, unknown> }> = [];
  let relaunches = 0;
  const module = {
    getStatus: jest.fn(async () => ({ ...status, bundledVersion: BUNDLED_VERSION, reactNative: '0.83.1', bridge: 'bridge-1', abis: ['arm64-v8a'], state: JSON.stringify(state) })),
    install: jest.fn(async (staging: string, entryJson: string) => {
      const entry = JSON.parse(entryJson);
      const id = `${entry.engineVersion}-${String(entry.sha256).slice(0, 12)}`;
      installed.push({ staging, entry });
      state.packs[id] = { llamaBuild: entry.llamaBuild, engineVersion: entry.engineVersion };
      state.trial = { id, launches: 0 };
      return id;
    }),
    accept: jest.fn(async (id: string) => { state.active = id; delete state.trial; }),
    keepOnTrial: jest.fn(async (id: string) => { if (state.trial?.id === id) state.trial.launches = 0; }),
    reject: jest.fn(async (id: string, reason: string) => {
      state.rejected = { ...state.rejected, [id]: reason };
      if (state.trial?.id === id) delete state.trial;
      if (state.active === id) delete state.active;
    }),
    relaunch: jest.fn(() => { relaunches += 1; }),
  };
  return {
    module, state, installed,
    relaunches: () => relaunches,
    /** A new process: the boot step loads the trial or active pack (or it fails to load). */
    launch(loads = true, error: string | null = loads ? null : 'dlopen failed: cannot locate symbol') {
      const id = state.trial?.id ?? state.active ?? null;
      if (state.trial) state.trial.launches += 1;
      status = id
        ? { bootPackId: id, trial: !!state.trial, ...state.packs[id], source: loads ? 'pack' : 'bundled', error }
        : { bootPackId: null, trial: false, llamaBuild: null, engineVersion: null, source: 'bundled', error: null };
    },
  };
}

interface World {
  boundary: NativeBoundary;
  store: ReturnType<typeof nativeStore>;
  fetched: string[];
  start: (now: number, publicKey?: string) => Promise<void>;
  engineLoads: (entry: { minLlamaBuild?: number }) => boolean;
}

async function world(opts: { body?: string; signature?: string; zip?: string; model?: boolean; modelBytes?: number; minBytes?: number; reportsBuild?: boolean; zipStatus?: number; manifestStatus?: number } = {}): Promise<World> {
  const boundary = installNativeBoundary({ fs: true, llama: true, ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB } });
  if (opts.reportsBuild !== false) (boundary.llama!.module as Record<string, unknown>).BuildInfo = { number: String(BUNDLED_BUILD), commit: 'bf9a0cc' };
  const store = nativeStore();
  NativeModules.EnginePack = store.module;
  const body = opts.body ?? manifestBody();
  const fetched: string[] = [];
  global.fetch = jest.fn(async (url: string) => {
    fetched.push(url);
    const text = url === MANIFEST ? body : url === `${MANIFEST}.sig` ? (opts.signature ?? signed(body)) : null;
    return { ok: text !== null && !opts.manifestStatus, status: opts.manifestStatus ?? (text === null ? 404 : 200), text: async () => text ?? '' };
  }) as unknown as typeof fetch;
  boundary.fs!.serveRemoteFile(PACK_URL, { body: opts.zip ?? ZIP, statusCode: opts.zipStatus });
  // The zip native writes the pack's files where it is told.
  require('react-native-zip-archive').unzip.mockImplementation(async (_zip: string, to: string) => {
    for (const [name, text] of Object.entries(FILES)) await boundary.fs!.module.writeFile(`${to}/${name}`, text, 'utf8');
    return to;
  });
  const { useAppStore } = require('../../../src/stores');
  if (opts.model !== false) {
    // The test prompt picks the smallest GGUF; a LiteRT model never runs on llama.cpp.
    const models = [
      createDownloadedModel({ id: 'qwen-4b', engine: 'llama', fileSize: opts.minBytes ?? 2600 * 1024 * 1024, filePath: '/models/qwen-4b.gguf' }),
      createDownloadedModel({ id: 'qwen-0.8b', engine: 'llama', fileSize: opts.modelBytes ?? 500 * 1024 * 1024, filePath: '/models/qwen-0.8b.gguf' }),
      createDownloadedModel({ id: 'gemma-litert', engine: 'litert', fileSize: 100 * 1024 * 1024, filePath: '/models/gemma.litertlm' }),
    ];
    for (const model of models) boundary.fs!.seedFile(model.filePath!, 1024);
    useAppStore.getState().setDownloadedModels(models);
  }
  const { startEnginePacks } = require('../../../src/services/enginePacks');
  const { engineLoadsCatalogModel } = require('../../../src/services/llamaEngineSupport');
  return {
    boundary, store, fetched,
    start: (now, publicKey = encodeBase64(keys.publicKey)) => startEnginePacks({ now, source: { manifestUrl: MANIFEST, publicKey } }),
    engineLoads: entry => engineLoadsCatalogModel(entry),
  };
}

afterEach(() => {
  delete NativeModules.EnginePack;
});

it('a newer llama.cpp installs, passes its test prompt on the next launch and unlocks LFM3, with no app update', async () => {
  const w = await world();
  w.store.launch();
  await w.start(1 * DAY);
  expect(w.store.installed).toHaveLength(1);
  expect(w.store.installed[0].entry).toMatchObject({ engineVersion: VERSION, llamaBuild: PACK_BUILD, bridge: 'bridge-1' });
  expect(w.boundary.fs!.listFiles(w.store.installed[0].staging)).toEqual([]); // the store took the files
  expect(await w.boundary.fs!.exists(`${w.boundary.fs!.module.CachesDirectoryPath}/engine-pack-${VERSION}-${sha(ZIP).slice(0, 12)}.zip`)).toBe(false);
  expect(w.engineLoads(LFM3)).toBe(false); // this process still runs the bundled engine

  w.boundary.llama!.scriptCompletion({ text: ' Paris.' });
  w.store.launch();
  await w.start(1 * DAY + 1000);
  expect(w.boundary.llama!.calls.initLlama.at(-1)).toMatchObject({ model: '/models/qwen-0.8b.gguf', n_gpu_layers: 0 });
  expect(w.store.state.active).toBe(`${VERSION}-${sha(ZIP).slice(0, 12)}`);
  expect(w.store.relaunches()).toBe(0);
  expect(w.engineLoads(LFM3)).toBe(true);
});

it('a pack that fails to load is rejected and the bundled engine keeps running, with no relaunch', async () => {
  const w = await world();
  w.store.launch();
  await w.start(1 * DAY);
  w.store.launch(false);
  await w.start(1 * DAY + 1000);
  expect(Object.values(w.store.state.rejected ?? {})[0]).toMatch(/did not load: dlopen failed/);
  expect(w.store.state.active).toBeUndefined();
  expect(w.store.relaunches()).toBe(0);
  expect(w.engineLoads(LFM3)).toBe(false);
});

it.each([
  ['returns nothing', { text: '' }, /returned nothing/],
  ['throws', { throwMessage: 'ggml_abort: bad tensor' }, /failed: ggml_abort: bad tensor/],
])('a pack whose test prompt %s is rejected and the app relaunches on the bundled engine', async (_label, script, reason) => {
  const w = await world();
  w.store.launch();
  await w.start(1 * DAY);
  w.boundary.llama!.scriptCompletion(script);
  w.store.launch();
  await w.start(1 * DAY + 1000);
  expect(Object.values(w.store.state.rejected ?? {})[0]).toMatch(reason);
  expect(w.store.relaunches()).toBe(1);
  w.store.launch();
  expect(w.store.state.active).toBeUndefined();
});

it('a pack that fell back to the bundled engine without saying why is rejected', async () => {
  const w = await world();
  w.store.launch();
  await w.start(1 * DAY);
  w.store.launch(false, null);
  await w.start(1 * DAY + 1000);
  expect(Object.values(w.store.state.rejected ?? {})[0]).toBe('did not load: unknown');
});

it('a half-unzipped pack left by a closed app is cleared before the next attempt', async () => {
  const w = await world();
  const staging = `${w.boundary.fs!.DocumentDirectoryPath}/engine-packs-staging/${VERSION}-${sha(ZIP).slice(0, 12)}`;
  w.boundary.fs!.seedTextFile(`${staging}/librnllama.so`, 'half');
  w.store.launch();
  await w.start(1 * DAY);
  expect(w.store.installed).toHaveLength(1);
  expect(w.boundary.fs!.listFiles(staging)).toEqual([]);
});

it('an engine that reports no build still takes a pack', async () => {
  const w = await world({ reportsBuild: false });
  w.store.launch();
  await w.start(1 * DAY);
  expect(w.store.installed).toHaveLength(1);
});

it('an Android build without the native store does nothing', async () => {
  const w = await world();
  delete NativeModules.EnginePack;
  await w.start(1 * DAY);
  expect(w.fetched).toEqual([]);
});

it('a pack that cannot start its test model is rejected', async () => {
  const w = await world();
  w.store.launch();
  await w.start(1 * DAY);
  w.boundary.llama!.scriptInitFailure(true, 'unknown model architecture');
  w.store.launch();
  await w.start(1 * DAY + 1000);
  expect(Object.values(w.store.state.rejected ?? {})[0]).toMatch(/unknown model architecture/);
});

it.each([
  ['no model downloaded yet', { model: false }],
  ['no room for the test model now', { modelBytes: 40 * GB, minBytes: 40 * GB }],
])('with %s the pack stays on trial without counting the launch', async (_label, opts) => {
  const w = await world(opts);
  w.store.launch();
  await w.start(1 * DAY);
  w.store.launch();
  await w.start(1 * DAY + 1000);
  expect(w.store.state.trial).toMatchObject({ launches: 0 });
  expect(w.store.state.active).toBeUndefined();
  expect(w.store.module.keepOnTrial).toHaveBeenCalled();
});

it.each([
  ['a manifest signed with another key', { signature: encodeBase64(nacl.sign.detached(decodeUTF8(manifestBody()), nacl.sign.keyPair().secretKey)) }],
  ['a zip that does not match its sha256', { zip: 'PK something else' }],
  ['a pack download that fails', { zipStatus: 404 }],
  ['a manifest the host does not serve', { manifestStatus: 503 }],
  ['the bundled engine version itself', { body: manifestBody({ version: BUNDLED_VERSION, llamaBuild: BUNDLED_BUILD }) }],
  ['an older engine version', { body: manifestBody({ version: '0.12.9-b11000', llamaBuild: 11000 }) }],
])('%s installs nothing and the app keeps running', async (_label, opts) => {
  const w = await world(opts);
  w.store.launch();
  await expect(w.start(1 * DAY)).resolves.toBeUndefined();
  expect(w.store.installed).toEqual([]);
  expect(w.boundary.fs!.listFiles(w.boundary.fs!.module.CachesDirectoryPath)).toEqual([]);
});

// A rebuild on the same llama.cpp (.2 after .1) carries fixes to the native glue: it installs.
it('a rebuild on the same llama.cpp installs over the running pack', async () => {
  const w = await world({ body: manifestBody({ version: '0.13.0-b12032.2' }) });
  w.store.state.packs['0.13.0-b12032.1-aaaaaaaaaaaa'] = { llamaBuild: PACK_BUILD, engineVersion: '0.13.0-b12032.1' };
  w.store.state.active = '0.13.0-b12032.1-aaaaaaaaaaaa';
  w.store.launch();
  await w.start(1 * DAY);
  expect(w.store.installed.map(i => i.entry.engineVersion)).toEqual(['0.13.0-b12032.2']);
});

it('the same version as the running pack installs nothing', async () => {
  const w = await world();
  w.store.state.packs['0.13.0-b12032-aaaaaaaaaaaa'] = { llamaBuild: PACK_BUILD, engineVersion: VERSION };
  w.store.state.active = '0.13.0-b12032-aaaaaaaaaaaa';
  w.store.launch();
  await w.start(1 * DAY);
  expect(w.store.installed).toEqual([]);
});

it('looks for a newer pack at most once a day, and not while one is on trial', async () => {
  const w = await world({ model: false });
  w.store.launch();
  await w.start(10 * DAY);
  expect(w.fetched).toHaveLength(2);
  w.store.launch();
  await w.start(10 * DAY + DAY - 1);
  expect(w.fetched).toHaveLength(2);
  await w.start(11 * DAY);
  expect(w.fetched).toHaveLength(2); // a pack is on trial: nothing new until it settles
  expect(w.store.installed).toHaveLength(1);
});

it('does nothing without a pinned key', async () => {
  const w = await world();
  w.store.launch();
  await w.start(1 * DAY, '');
  expect(w.fetched).toEqual([]);
});

it('does nothing on iOS, which cannot load downloaded native code', async () => {
  const w = await world();
  const { Platform } = require('react-native');
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  await require('../../../src/services/enginePacks').startEnginePacks();
  expect(w.store.module.getStatus).not.toHaveBeenCalled();
  expect(w.fetched).toEqual([]);
});

// Settings → Engine updates. Off: nothing downloads or installs, an engine update already in use stays,
// and a pack already on trial is still tested (it is in this process; a broken one must not stay).
describe('Engine updates setting', () => {
  // The app reads the setting only after the store has hydrated (App.tsx starts engine packs then).
  const setEngineUpdates = async (on: boolean) => {
    const { useAppStore } = require('../../../src/stores');
    if (!useAppStore.persist.hasHydrated()) {
      await new Promise<void>(resolve => { const stop = useAppStore.persist.onFinishHydration(() => { stop(); resolve(); }); });
    }
    useAppStore.getState().updateSettings({ engineUpdates: on });
  };
  const service = () => require('../../../src/services/enginePacks');
  const now = (at: number) => ({ now: at, source: { manifestUrl: MANIFEST, publicKey: encodeBase64(keys.publicKey) } });

  it('is on for a new install', async () => {
    await world();
    expect(require('../../../src/stores').useAppStore.getState().settings.engineUpdates).toBe(true);
  });

  it('off: no download starts, and the engine update already in use stays', async () => {
    const w = await world();
    w.store.state.packs['0.13.0-b12000-aaaaaaaaaaaa'] = { llamaBuild: 12000, engineVersion: '0.13.0-b12000' };
    w.store.state.active = '0.13.0-b12000-aaaaaaaaaaaa';
    await setEngineUpdates(false);
    w.store.launch();
    await w.start(10 * DAY);
    expect(w.fetched).toEqual([]);
    expect(w.store.installed).toEqual([]);
    expect(w.store.state.active).toBe('0.13.0-b12000-aaaaaaaaaaaa');
    expect(await service().getEngineUpdateInfo()).toMatchObject({ path: 'over-the-air', source: 'pack', version: '0.13.0-b12000' });
  });

  it('off: a pack already on trial is still tested and settled', async () => {
    const w = await world();
    w.store.launch();
    await w.start(1 * DAY);
    await setEngineUpdates(false);
    w.boundary.llama!.scriptCompletion({ text: ' Paris.' });
    w.store.launch();
    await w.start(1 * DAY + 1000);
    expect(w.store.state.active).toBe(`${VERSION}-${sha(ZIP).slice(0, 12)}`);
    expect(w.fetched).toHaveLength(2); // only the first, opted-in check
  });

  it('turned back on, the next launch looks for a pack again', async () => {
    const w = await world();
    await setEngineUpdates(false);
    w.store.launch();
    await w.start(1 * DAY);
    await setEngineUpdates(true);
    await w.start(1 * DAY + 1000);
    expect(w.store.installed).toHaveLength(1);
  });

  it('Check now stages a newer pack at once, and says one waits while it is on trial', async () => {
    const w = await world({ model: false });
    w.store.launch();
    await w.start(1 * DAY);
    expect(w.store.installed).toHaveLength(1);
    expect(await service().checkEngineUpdatesNow(now(1 * DAY + 5))).toBe('staged');
    expect(w.store.installed).toHaveLength(1); // nothing new while one waits
    expect((await service().getEngineUpdateInfo()).lastCheck).toBe(1 * DAY + 5);
  });

  it('Check now ignores the once-a-day limit and finds a pack', async () => {
    const w = await world();
    w.store.launch();
    expect(await service().checkEngineUpdatesNow(now(1 * DAY))).toBe('staged');
    expect(w.store.installed).toHaveLength(1);
  });

  it.each([
    ['nothing newer', { body: manifestBody({ version: BUNDLED_VERSION, llamaBuild: BUNDLED_BUILD }) }, 'current'],
    ['the manifest host is down', { manifestStatus: 503 }, 'failed'],
  ])('Check now with %s says so', async (_label, opts, outcome) => {
    const w = await world(opts);
    w.store.launch();
    expect(await service().checkEngineUpdatesNow(now(1 * DAY))).toBe(outcome);
    expect(w.store.installed).toEqual([]);
  });

  it('Check now with engine updates off downloads nothing', async () => {
    const w = await world();
    await setEngineUpdates(false);
    w.store.launch();
    expect(await service().checkEngineUpdatesNow(now(1 * DAY))).toBe('off');
    expect(w.fetched).toEqual([]);
  });

  it('reports the bundled engine and when it last looked', async () => {
    const w = await world();
    w.store.launch();
    expect(await service().getEngineUpdateInfo()).toEqual({
      path: 'over-the-air', llamaBuild: BUNDLED_BUILD, version: BUNDLED_VERSION, source: 'bundled', lastCheck: null,
    });
    await w.start(3 * DAY);
    expect((await service().getEngineUpdateInfo()).lastCheck).toBe(3 * DAY);
  });

  it('reads as the bundled engine when the native store cannot answer', async () => {
    const w = await world();
    w.store.module.getStatus.mockRejectedValueOnce(new Error('store unreadable'));
    expect(await service().getEngineUpdateInfo()).toMatchObject({ path: 'over-the-air', source: 'bundled', version: null });
  });

  it('on iOS the engine updates with the app, and Check now has nothing to do', async () => {
    await world();
    const { Platform } = require('react-native');
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    expect(await service().getEngineUpdateInfo()).toEqual({
      path: 'with-app', llamaBuild: BUNDLED_BUILD, version: null, source: 'bundled', lastCheck: null,
    });
    expect(await service().checkEngineUpdatesNow()).toBe('unsupported');
  });
});
