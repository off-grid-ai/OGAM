/**
 * The bundled chat model: Play's AI packs land LFM3-VL-2B with the app.
 *
 * The boundary is Play (a fake pack port that reports states and events) and the phone (harness/
 * modelManagerDevice: disk, storage, native downloader). The bundled model service, modelManager, the
 * stores and the regular download path run for real.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';
import type { BundledModelPort, PackState } from '../../../../src/services/bundledModel/port';

const KEY = 'LiquidAI/LFM3-VL-2B-GGUF/LFM3-VL-2B-Q4_K_M.gguf';
const WEIGHTS = 1099627808;
const MMPROJ = 378996032;

function pack(name: string, status: PackState['status'], over: Partial<PackState> = {}): PackState {
  const total = name === 'chat_model' ? WEIGHTS : MMPROJ;
  return {
    name, status, totalBytes: total, errorCode: 0,
    bytesDownloaded: status === 'completed' ? total : 0,
    assetsPath: status === 'completed' ? `/data/assetpacks/${name}/assets` : null,
    ...over,
  };
}

interface FakePlay extends BundledModelPort {
  emit(state: PackState): void;
  removed: string[];
}

function fakePlay(initial: Record<string, PackState>): FakePlay {
  const listeners = new Set<(s: PackState) => void>();
  const removed: string[] = [];
  return {
    canMoveFiles: true,
    removed,
    getPacks: async names => Object.fromEntries(names.map(n => [n, initial[n]])),
    fetch: async names => Object.fromEntries(names.map(n => [n, initial[n]])),
    removePack: async name => { removed.push(name); return true; },
    onPack: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    emit: state => listeners.forEach(l => l(state)),
  };
}

let device: ModelManagerDevice;
let svc: typeof import('../../../../src/services/bundledModel');
const stores = () => require('../../../../src/stores') as typeof import('../../../../src/stores');
const downloads = () => require('../../../../src/stores/downloadStore').useDownloadStore.getState();
const flush = () => new Promise(resolve => setImmediate(resolve));
/** Play has put the packs' files on the phone. */
const landPacks = () => {
  device.fs.seedFile('/data/assetpacks/chat_model/assets/LFM3-VL-2B-Q4_K_M.gguf', WEIGHTS);
  device.fs.seedFile('/data/assetpacks/chat_mmproj/assets/mmproj-LFM3-VL-2B-F16.gguf', MMPROJ);
};

beforeEach(async () => {
  device = await installModelManagerDevice();
  svc = require('../../../../src/services/bundledModel');
  svc.resetBundledModelForTests();
  stores().useAppStore.setState({ activeModelId: null, lastTextModelId: null });
});

describe('bundled model descriptor', () => {
  it('is the catalog row the Android build fetches (one source for file, URL and hash)', () => {
    const catalog = JSON.parse(readFileSync(join(__dirname, '../../../../catalog/models.json'), 'utf8'));
    const entry = catalog.sections.models.find((m: { id: string }) => m.id === svc.BUNDLED_MODEL.modelId);
    const { weights, mmproj } = svc.BUNDLED_MODEL;
    expect(entry.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: weights.name, url: weights.url, sizeBytes: weights.sizeBytes, sha256: weights.sha256, role: 'primary' }),
      expect.objectContaining({ name: mmproj.name, url: mmproj.url, sizeBytes: mmproj.sizeBytes, sha256: mmproj.sha256, role: 'mmproj' }),
    ]));
    expect(entry.quant).toBe(svc.BUNDLED_MODEL.quantization);
    // Play's per-pack cap is 1.5 GB: each file fits its own pack.
    expect(Math.max(weights.sizeBytes, mmproj.sizeBytes)).toBeLessThan(1.5e9);
  });

  it('as a download request carries the projector, so the fallback fetches the whole model', () => {
    expect(svc.bundledModelFile()).toEqual(expect.objectContaining({
      name: 'LFM3-VL-2B-Q4_K_M.gguf', size: WEIGHTS,
      mmProjFile: expect.objectContaining({ name: 'mmproj-LFM3-VL-2B-F16.gguf', size: MMPROJ }),
    }));
  });
});

describe('bundledModelState', () => {
  const names = ['chat_model', 'chat_mmproj'];
  const sizes = { chat_model: WEIGHTS, chat_mmproj: MMPROJ };
  const state = (a: PackState, b: PackState) => svc.bundledModelState({ chat_model: a, chat_mmproj: b }, names, sizes);

  it('no pack known to Play (sideloaded build) is absent: the regular download serves', () => {
    expect(state(pack('chat_model', 'not_installed'), pack('chat_mmproj', 'not_installed'))).toEqual({ kind: 'absent' });
    expect(svc.bundledModelState({}, names, sizes)).toEqual({ kind: 'absent' });
    expect(state(pack('chat_model', 'unknown'), pack('chat_mmproj', 'downloading'))).toEqual({ kind: 'absent' });
  });

  it('on its way counts an arrived pack whole and the other by its bytes so far', () => {
    expect(state(pack('chat_model', 'downloading', { bytesDownloaded: 500 }), pack('chat_mmproj', 'completed', { assetsPath: null })))
      .toEqual({ kind: 'arriving', bytes: 500 + MMPROJ, total: WEIGHTS + MMPROJ, waitsForWifi: false });
  });

  it('held for Wi-Fi says so; a size Play has not reported yet comes from the catalog', () => {
    expect(state(pack('chat_model', 'waiting_for_wifi', { totalBytes: 0 }), pack('chat_mmproj', 'pending', { totalBytes: 0 })))
      .toEqual({ kind: 'arriving', bytes: 0, total: WEIGHTS + MMPROJ, waitsForWifi: true });
  });

  it('a failed or canceled pack stops the arrival', () => {
    expect(state(pack('chat_model', 'failed', { bytesDownloaded: 7 }), pack('chat_mmproj', 'downloading'))).toEqual(
      { kind: 'stopped', bytes: 7, total: WEIGHTS + MMPROJ });
    expect(state(pack('chat_model', 'canceled', { totalBytes: 0 }), pack('chat_mmproj', 'completed', { totalBytes: 0, assetsPath: null })).kind).toBe('stopped');
  });

  it('arrived only when every pack has landed with its folder', () => {
    expect(state(pack('chat_model', 'completed'), pack('chat_mmproj', 'completed'))).toEqual({
      kind: 'arrived', paths: { chat_model: '/data/assetpacks/chat_model/assets', chat_mmproj: '/data/assetpacks/chat_mmproj/assets' },
    });
  });
});

describe('startBundledModel', () => {
  it('packs already on the phone move into the library and become the chat model', async () => {
    const play = fakePlay({ chat_model: pack('chat_model', 'completed'), chat_mmproj: pack('chat_mmproj', 'completed') });
    landPacks();
    await svc.startBundledModel(play);

    const app = stores().useAppStore.getState();
    const model = app.downloadedModels.find(m => m.id === KEY) as Record<string, unknown> | undefined;
    expect(model).toEqual(expect.objectContaining({
      filePath: `${device.modelsDir}/LFM3-VL-2B-Q4_K_M.gguf`,
      mmProjPath: expect.stringContaining(`${device.modelsDir}/`),
      fileSize: WEIGHTS,
    }));
    // Moved, not copied: the pack folder no longer holds the weights.
    expect(await device.fs.exists('/data/assetpacks/chat_model/assets/LFM3-VL-2B-Q4_K_M.gguf')).toBe(false);
    expect(app.activeModelId).toBe(KEY);
    expect(downloads().downloads[KEY]).toBeUndefined();
    expect(play.removed.sort()).toEqual(['chat_mmproj', 'chat_model']);
  });

  it('a file left in the models folder by an earlier try is replaced by the arrived one', async () => {
    device.fs.seedFile(`${device.modelsDir}/LFM3-VL-2B-Q4_K_M.gguf`, 12);
    landPacks();
    await svc.startBundledModel(fakePlay({ chat_model: pack('chat_model', 'completed'), chat_mmproj: pack('chat_mmproj', 'completed') }));
    const model = stores().useAppStore.getState().downloadedModels.find(m => m.id === KEY);
    expect(model?.fileSize).toBe(WEIGHTS);
  });

  it('with no port given it asks the platform, which on this test platform has no packs', async () => {
    await expect(svc.startBundledModel()).resolves.toBeUndefined();
    expect(downloads().downloads[KEY]).toBeUndefined();
  });

  it('on iOS the files are copied out of the system storage, then the pack is removed', async () => {
    landPacks();
    const play = { ...fakePlay({ chat_model: pack('chat_model', 'completed'), chat_mmproj: pack('chat_mmproj', 'completed') }), canMoveFiles: false };
    await svc.startBundledModel(play);
    expect(stores().useAppStore.getState().downloadedModels.find(m => m.id === KEY)?.fileSize).toBe(WEIGHTS);
    expect(await device.fs.exists(`${device.modelsDir}/LFM3-VL-2B-Q4_K_M.gguf`)).toBe(true);
  });

  it('keeps the chat model you already chose', async () => {
    stores().useAppStore.setState({ activeModelId: 'other/model.gguf' });
    landPacks();
    await svc.startBundledModel(fakePlay({ chat_model: pack('chat_model', 'completed'), chat_mmproj: pack('chat_mmproj', 'completed') }));
    expect(stores().useAppStore.getState().activeModelId).toBe('other/model.gguf');
    expect(stores().useAppStore.getState().downloadedModels.map(m => m.id)).toContain(KEY);
  });

  it('on its way it is one download row the chat waits on, and it lands when Play finishes', async () => {
    const play = fakePlay({ chat_model: pack('chat_model', 'downloading', { bytesDownloaded: 100 }), chat_mmproj: pack('chat_mmproj', 'pending') });
    const done = svc.startBundledModel(play);
    await flush();

    const row = downloads().downloads[KEY];
    expect(row).toEqual(expect.objectContaining({ modelType: 'text', status: 'running', bytesDownloaded: 100, combinedTotalBytes: WEIGHTS + MMPROJ }));
    // The chat opens with it as the model on its way.
    const { currentArrivingChatModel } = require('../../../../src/services/arrivingChatModel');
    expect(currentArrivingChatModel()).toEqual(expect.objectContaining({ modelId: 'LiquidAI/LFM3-VL-2B-GGUF', failed: false }));

    play.emit(pack('chat_model', 'waiting_for_wifi', { bytesDownloaded: 200 }));
    await flush();
    expect(downloads().downloads[KEY]).toEqual(expect.objectContaining({ status: 'waiting_for_network', bytesDownloaded: 200 }));

    landPacks();
    play.emit(pack('chat_model', 'completed'));
    play.emit(pack('chat_mmproj', 'completed'));
    await done;
    expect(stores().useAppStore.getState().activeModelId).toBe(KEY);
    expect(downloads().downloads[KEY]).toBeUndefined();
  });

  it('a stopped pack shows Retry, and Retry is the regular download of the same model', async () => {
    await svc.startBundledModel(fakePlay({ chat_model: pack('chat_model', 'failed'), chat_mmproj: pack('chat_mmproj', 'completed', { assetsPath: null }) }));
    const row = downloads().downloads[KEY];
    expect(row).toEqual(expect.objectContaining({ status: 'failed', errorCode: 'pack_stopped' }));

    const { restartNeverStarted } = require('../../../../src/services/queuedStarts');
    expect(await restartNeverStarted(row)).toBe(true);
    await device.settle();
    // The regular download starts: the projector first, then the weights, on the one row.
    expect(device.nativeRows()).toContainEqual(expect.objectContaining({ modelId: 'LiquidAI/LFM3-VL-2B-GGUF' }));
  });

  it('with no packs (sideloaded build) nothing changes', async () => {
    await svc.startBundledModel(fakePlay({}));
    expect(downloads().downloads[KEY]).toBeUndefined();
    expect(stores().useAppStore.getState().downloadedModels.map(m => m.id)).not.toContain(KEY);
  });

  it('a regular download of the model already running stays the row to follow', async () => {
    const { startModelDownload } = require('../../../../src/services/startModelDownload');
    await startModelDownload(svc.BUNDLED_MODEL.modelId, svc.bundledModelFile(), { autoSelectIfEmpty: true });
    await device.settle();
    const before = downloads().downloads[KEY].downloadId;
    const play = fakePlay({ chat_model: pack('chat_model', 'downloading'), chat_mmproj: pack('chat_mmproj', 'downloading') });
    svc.startBundledModel(play);
    await flush();
    expect(downloads().downloads[KEY].downloadId).toBe(before);
  });

  it('already in the library: Play forgets the packs, and nothing else happens', async () => {
    stores().useAppStore.getState().addDownloadedModel({
      id: KEY, name: 'LFM3 VL 2B', author: 'LiquidAI', filePath: '/x', fileName: 'LFM3-VL-2B-Q4_K_M.gguf',
      fileSize: WEIGHTS, quantization: 'Q4_K_M', downloadedAt: new Date().toISOString(), engine: 'llama',
    });
    const play = fakePlay({ chat_model: pack('chat_model', 'completed'), chat_mmproj: pack('chat_mmproj', 'completed') });
    await svc.startBundledModel(play);
    expect(play.removed.sort()).toEqual(['chat_mmproj', 'chat_model']);
    expect(stores().useAppStore.getState().activeModelId).toBeNull();
  });

  it('a pack update that fails ends the follow without breaking launch', async () => {
    const play = fakePlay({ chat_model: pack('chat_model', 'downloading'), chat_mmproj: pack('chat_mmproj', 'downloading') });
    const done = svc.startBundledModel(play);
    await flush();
    // Both landed, but the files are not there: the move fails.
    play.emit(pack('chat_model', 'completed'));
    play.emit(pack('chat_mmproj', 'completed'));
    await expect(done).resolves.toBeUndefined();
    expect(stores().useAppStore.getState().downloadedModels.map(m => m.id)).not.toContain(KEY);
  });

  it('runs once per launch, and a failure is logged, never thrown into launch', async () => {
    const play = fakePlay({});
    play.getPacks = jest.fn(async () => { throw new Error('play gone'); });
    await expect(svc.startBundledModel(play)).resolves.toBeUndefined();
    await svc.startBundledModel(play);
    expect(play.getPacks).toHaveBeenCalledTimes(1);
  });
});
