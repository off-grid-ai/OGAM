/**
 * useDownloadManager, the Download Manager's logic, on the real stack.
 *
 * Only the device boundary is faked: the in-memory disk, the native background downloader (a started
 * download stays running until the test finishes or fails it), async-storage, the Hugging Face API at
 * fetch, and (for voice) ExecuTorch's resource fetcher. The hook, the app-root download listeners,
 * ModelDownloadService with its real providers (text, image, stt and Pro's tts), modelManager, the
 * vision repair service, whisperService, imageDownloadActions and the stores all run for real.
 *
 * Downloads and installed models arrive through the app's own write paths (a real download through
 * the fake downloader, the service's start). Outcomes are read from the items the hook hands the
 * screen, the alert it shows, the store rows, the native downloader's rows and the disk.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';
import { requireRTL } from '../../../harness/nativeBoundary';
import { serveHfModelApi, type HfModelApiServer } from '../../../harness/hfModelApiServer';
import { createModelFile } from '../../../utils/factories';
import type { DownloadedModel, ModelFile } from '../../../../src/types';
import type { UseDownloadManagerResult } from '../../../../src/screens/DownloadManagerScreen/useDownloadManager';
import type { DownloadItem } from '../../../../src/screens/DownloadManagerScreen/items';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const MODEL_SIZE = 400_000_000;

let device: ModelManagerDevice;
let server: HfModelApiServer;
let rtl: ReturnType<typeof requireRTL>;
let result: { current: UseDownloadManagerResult };
let unmount: () => void;
let stores: {
  useAppStore: typeof import('../../../../src/stores').useAppStore;
  useDownloadStore: typeof import('../../../../src/stores/downloadStore').useDownloadStore;
};
let modelDownloadService: typeof import('../../../../src/services/modelDownloadService').modelDownloadService;
let imageActions: typeof import('../../../../src/services/imageDownloadActions');

async function setup(opts: { pro?: boolean } = {}) {
  device = await installModelManagerDevice({ platform: 'android' });
  server = serveHfModelApi();
  if (opts.pro) {
    require('../../../harness/kokoroResourceBoundary').installKokoroResourceBoundary();
    await require('../../../harness/proHarness').installPro();
  }
  rtl = requireRTL();
  require('../../../../src/services/modelDownloadService/registerProviders').registerCoreDownloadProviders();
  ({ modelDownloadService } = require('../../../../src/services/modelDownloadService'));
  imageActions = require('../../../../src/services/imageDownloadActions');
  stores = {
    useAppStore: require('../../../../src/stores').useAppStore,
    useDownloadStore: require('../../../../src/stores/downloadStore').useDownloadStore,
  };
}

/** The Download Manager mounted under the app root's download listeners, as in the app. */
async function mount() {
  const { useDownloadManager } = require('../../../../src/screens/DownloadManagerScreen/useDownloadManager');
  const { useDownloadListeners } = require('../../../../src/hooks/useDownloads');
  const view = rtl.renderHook(() => {
    useDownloadListeners();
    return useDownloadManager();
  });
  result = view.result;
  unmount = view.unmount;
  await settle();
}

async function settle() {
  await rtl.act(async () => { await device.settle(); });
}

afterEach(() => {
  unmount?.();
  server?.restore();
});

/** Download a text model the way the Models screen does (the download service's start), let the
 *  native downloader finish it, and publish the installed list the way boot does. */
async function installText(modelId: string, file: ModelFile): Promise<DownloadedModel> {
  await rtl.act(async () => { await modelDownloadService.start({ modelType: 'text', modelId, file }); });
  const row = device.nativeRows().find(r => r.status === 'running' && r.fileName === file.name);
  if (!row) throw new Error(`${file.name} did not start`);
  await rtl.act(async () => { await device.finishDownload(row.downloadId, file.size); await device.settle(); });
  const installed = (await device.modelManager.getDownloadedModels()).find(m => m.fileName === file.name);
  if (!installed) throw new Error(`${file.name} did not finalize`);
  await rtl.act(async () => {
    stores.useAppStore.getState().setDownloadedModels(await device.modelManager.getDownloadedModels());
  });
  return installed;
}

const hfFile = (repo: string, name: string, size = MODEL_SIZE) =>
  createModelFile({ name, size, downloadUrl: `https://huggingface.co/${repo}/resolve/${SHA}/${name}` });

/** Image deps the Models screen hands in. */
function imageDeps() {
  const app = stores.useAppStore.getState();
  return {
    addDownloadedImageModel: app.addDownloadedImageModel,
    activeImageModelId: app.activeImageModelId,
    setActiveImageModelId: app.setActiveImageModelId,
    setAlertState: () => {},
    triedImageGen: true,
  };
}

const zipModel = (id: string) => ({
  id, name: `Zip ${id}`, description: 'd', downloadUrl: `https://example.com/${id}.zip`,
  size: 2_000_000, style: 'creative', backend: 'mnn' as const,
});

const multiModel = (id: string) => ({
  id, name: `Multi ${id}`, description: 'd', downloadUrl: '', size: 1_000_000, style: 'creative',
  backend: 'mnn' as const, huggingFaceRepo: 'test/repo',
  huggingFaceFiles: [{ path: 'unet.mnn', size: 500_000 }, { path: 'vae.mnn', size: 500_000 }],
});

const active = (modelType: string, modelId: string) =>
  result.current.activeItems.find(i => i.modelType === modelType && i.modelId === modelId);
const completed = (modelType: string, modelId: string) =>
  result.current.completedItems.find(i => i.modelType === modelType && i.modelId === modelId);
const runningNative = () => device.nativeRows().filter(r => r.status === 'running');

async function press(label: string) {
  const button = result.current.alertState.buttons?.find(b => b.text === label);
  if (!button) throw new Error(`no ${label} button on "${result.current.alertState.title}"`);
  await rtl.act(async () => { button.onPress?.(); await device.settle(); });
}

async function call(fn: (r: UseDownloadManagerResult) => unknown) {
  await rtl.act(async () => { await fn(result.current); await device.settle(); });
}

async function waitUntil(check: () => boolean) {
  await rtl.waitFor(() => expect(check()).toBe(true));
}

// ── retry / cancel route through ModelDownloadService to the owning provider ──────

describe('retry and remove reach the download', () => {
  beforeEach(setup);

  it('retrying a failed text download puts it back in flight', async () => {
    await mount();
    const file = createModelFile({ name: 'm-Q4_K_M.gguf', size: MODEL_SIZE });
    await rtl.act(async () => { await modelDownloadService.start({ modelType: 'text', modelId: 'org/repo', file }); });
    const [row] = runningNative();
    await rtl.act(async () => { await device.failDownload(row.downloadId, 'Connection lost'); });
    await waitUntil(() => active('text', 'org/repo/m-Q4_K_M.gguf')?.status === 'failed');

    await call(r => r.handleRetryDownload(active('text', 'org/repo/m-Q4_K_M.gguf')!));

    expect(active('text', 'org/repo/m-Q4_K_M.gguf')?.status).not.toBe('failed');
    expect(stores.useDownloadStore.getState().downloads['org/repo/m-Q4_K_M.gguf'].status).toBe('pending');
  });

  it('retrying a failed transcription download, which has no download id, starts it again', async () => {
    // The row an interrupted transcription download leaves behind across a relaunch: failed, and its
    // native id gone with the old process.
    stores.useDownloadStore.getState().add({
      modelKey: 'whisper-tiny.en/ggml-tiny.en.bin', downloadId: '', modelId: 'whisper-tiny.en',
      fileName: 'ggml-tiny.en.bin', quantization: '', modelType: 'stt', status: 'failed',
      bytesDownloaded: 0, totalBytes: 78_643_200, combinedTotalBytes: 78_643_200, progress: 0,
      createdAt: Date.now(), errorMessage: 'Interrupted — app closed. Tap retry.',
    });
    await mount();
    const failed = active('stt', 'whisper-tiny.en/ggml-tiny.en.bin') ?? result.current.activeItems.find(i => i.modelType === 'stt')!;
    expect(failed.status).toBe('failed');

    await rtl.act(async () => { result.current.handleRetryDownload({ ...failed, downloadId: undefined } as DownloadItem); await device.settle(); });

    await waitUntil(() => runningNative().some(r => r.fileName === 'ggml-tiny.en.bin'));
    expect(result.current.activeItems.find(i => i.modelType === 'stt')?.status).not.toBe('failed');
  });

  it('retrying an image the device has never seen does nothing and raises nothing', async () => {
    await mount();

    await call(r => r.handleRetryDownload({ modelType: 'image', modelId: 'x' } as DownloadItem));

    expect(stores.useDownloadStore.getState().downloads).toEqual({});
    expect(device.nativeRows()).toEqual([]);
    expect(result.current.alertState.visible).toBe(false);
  });

  it('retrying a failed multi-file image download starts its first part again', async () => {
    await mount();
    const done = imageActions.downloadHuggingFaceModel(multiModel('mf'), imageDeps());
    await waitUntil(() => runningNative().length === 1);
    await rtl.act(async () => { await device.failDownload(runningNative()[0].downloadId, 'Connection lost'); await done; });
    await waitUntil(() => active('image', 'mf')?.status === 'failed');

    // The re-download runs until the native part finishes, so the retry is not awaited here.
    await rtl.act(async () => { result.current.handleRetryDownload(active('image', 'mf')!); await device.settle(); });

    await waitUntil(() => runningNative().length === 1);
    expect(runningNative()[0].modelId).toBe('image:mf');
    expect(active('image', 'mf')?.status).not.toBe('failed');
  });

  it('removing a zip image download (Yes) stops the native download and drops the row', async () => {
    await mount();
    await rtl.act(async () => { await imageActions.proceedWithDownload(zipModel('sdxl'), imageDeps()); });
    expect(runningNative()).toHaveLength(1);
    expect(active('image', 'sdxl')).toBeDefined();

    act(() => result.current.handleRemoveDownload(active('image', 'sdxl')!));
    expect(result.current.alertState.title).toBe('Remove Download');
    await press('Yes');

    expect(device.nativeRows()).toEqual([]);
    expect(stores.useDownloadStore.getState().downloads['image:sdxl']).toBeUndefined();
    expect(active('image', 'sdxl')).toBeUndefined();
  });

  it('removing a multi-file image download stops its running part and drops the row', async () => {
    await mount();
    const done = imageActions.downloadHuggingFaceModel(multiModel('mf'), imageDeps());
    await waitUntil(() => runningNative().length === 1);

    act(() => result.current.handleRemoveDownload(active('image', 'mf')!));
    await press('Yes');
    await done;

    expect(device.nativeRows()).toEqual([]);
    expect(active('image', 'mf')).toBeUndefined();
    expect(await device.fs.exists(`${device.imageModelsDir}/mf`)).toBe(false);
  });
});

function act(fn: () => void) {
  rtl.act(fn);
}

// ── handleDeleteItem ──────────────────────────────────────────────────

describe('deleting a downloaded model', () => {
  beforeEach(setup);

  async function installImage(id: string) {
    await rtl.act(async () => { await imageActions.proceedWithDownload(zipModel(id), imageDeps()); });
    const zip = runningNative()[0];
    // The finished zip holds the model's files; the app unzips it (native unzip writes them).
    const { unzip } = require('react-native-zip-archive');
    unzip.mockImplementation(async (_zip: string, dest: string) => {
      for (const f of require('../../../harness/imageModelPackage').SD_MNN_PACKAGE_FILES) device.fs.seedFile(`${dest}/${f}`, 1024);
      return dest;
    });
    await rtl.act(async () => { await device.finishDownload(zip.downloadId, 2_000_000); });
    await waitUntil(() => !!completed('image', id));
  }

  it('asks before deleting an image model, then removes it from disk and the list', async () => {
    await mount();
    await installImage('m1');

    act(() => result.current.handleDeleteItem(completed('image', 'm1')!));
    expect(result.current.alertState.title).toBe('Delete Image Model');
    await press('Delete');

    expect(completed('image', 'm1')).toBeUndefined();
    expect(await device.modelManager.getDownloadedImageModels()).toEqual([]);
    expect(await device.fs.exists(`${device.imageModelsDir}/m1`)).toBe(false);
  });

  it('does nothing for an image model the device does not hold', async () => {
    await mount();

    act(() => result.current.handleDeleteItem({ modelType: 'image', modelId: 'missing' } as DownloadItem));

    expect(result.current.alertState.visible).toBe(false);
  });

  it('asks before deleting a text model, then removes it from disk and the list', async () => {
    const model = await installText('org/repo', createModelFile({ name: 't1.gguf', size: MODEL_SIZE }));
    await mount();

    act(() => result.current.handleDeleteItem(completed('text', model.id)!));
    expect(result.current.alertState.title).toBe('Delete Model');
    await press('Delete');

    expect(completed('text', model.id)).toBeUndefined();
    expect(await device.modelManager.getDownloadedModels()).toEqual([]);
    expect(await device.fs.exists(model.filePath)).toBe(false);
  });

  it('says it failed, and keeps the model listed, when the text model cannot be deleted', async () => {
    const model = await installText('org/repo', createModelFile({ name: 't1.gguf', size: MODEL_SIZE }));
    // The model's registry row is gone (an earlier version lost it), so the delete has nothing to remove.
    await device.seedRegistry([]);
    await mount();

    act(() => result.current.handleDeleteItem(completed('text', model.id)!));
    await press('Delete');

    expect(result.current.alertState.title).toBe('Error');
    expect(completed('text', model.id)).toBeDefined();
  });

  it('does nothing for a text model the device does not hold', async () => {
    await mount();

    act(() => result.current.handleDeleteItem({ modelType: 'text', modelId: 'missing' } as DownloadItem));

    expect(result.current.alertState.visible).toBe(false);
  });

  it('asks before deleting a transcription model', async () => {
    device.fs.seedFile('/docs/whisper-models/ggml-tiny.en.bin', 77_000_000);
    await mount();
    await waitUntil(() => !!completed('stt', 'tiny.en'));

    act(() => result.current.handleDeleteItem(completed('stt', 'tiny.en')!));

    expect(result.current.alertState.title).toBe('Delete Transcription Model');
    await press('Delete');
    await waitUntil(() => !completed('stt', 'tiny.en'));
    expect(await device.fs.exists('/docs/whisper-models/ggml-tiny.en.bin')).toBe(false);
  });
});

// ── handleRepairVision ────────────────────────────────────────────────
//
// The service decides where a projector can come from and returns an OUTCOME; one shared rule
// (visionRepairMessage) turns that into words. These drive each outcome from what the device and
// Hugging Face really hold, and read the alert the hook shows.

describe('repairing a vision model', () => {
  beforeEach(setup);

  async function repair(model: DownloadedModel) {
    const item = completed('text', model.id)!;
    await call(r => r.handleRepairVision(item));
  }

  const title = () => result.current.alertState.title;

  it('does nothing for a model this device does not hold', async () => {
    await mount();

    await call(r => r.handleRepairVision({ modelId: 'not/here' } as DownloadItem));

    expect(result.current.alertState.visible).toBe(false);
    expect(result.current.isRepairingVision('not/here')).toBe(false);
  });

  it('links a projector already on disk next to the weights', async () => {
    const model = await installText('org/vlm', createModelFile({ name: 'SmolVLM-500M-Q4_K_M.gguf', size: MODEL_SIZE }));
    device.fs.seedFile(`${device.modelsDir}/mmproj-SmolVLM-500M-f16.gguf`, 100_000_000);
    await mount();

    await repair(model);

    const { visionRepairMessage } = require('../../../../src/services/modelManager/visionRepairMessage');
    expect(title()).toBe(visionRepairMessage({ kind: 'linked' }, model.fileName)[0]);
    expect((stores.useAppStore.getState().downloadedModels[0] as { mmProjPath?: string }).mmProjPath).toBe(`${device.modelsDir}/mmproj-SmolVLM-500M-f16.gguf`);
    expect(result.current.isRepairingVision(model.id)).toBe(false);
  });

  it('says the copy has no known source when Hugging Face publishes nothing matching', async () => {
    const model = await installText('local', createModelFile({ name: 'mine-Q4_K_M.gguf', size: MODEL_SIZE, downloadUrl: 'https://example.com/mine-Q4_K_M.gguf' }));
    await mount();

    await repair(model);

    expect(title()).toBe(require('../../../../src/services/modelManager/visionRepairMessage').visionRepairMessage({ kind: 'unknown' }, model.fileName)[0]);
    expect(result.current.isRepairingVision(model.id)).toBe(false);
  });

  it('says it cannot choose when two repos publish the same file at the same size', async () => {
    const name = 'shared-Q4_K_M.gguf';
    const model = await installText('local', createModelFile({ name, size: MODEL_SIZE, downloadUrl: `https://example.com/${name}` }));
    server.serve({ repos: { 'a/shared': [{ path: name, size: MODEL_SIZE }], 'b/shared': [{ path: name, size: MODEL_SIZE }] } });
    await mount();

    await repair(model);

    const { visionRepairMessage } = require('../../../../src/services/modelManager/visionRepairMessage');
    expect(title()).toBe(visionRepairMessage({ kind: 'ambiguous', candidates: ['a/shared', 'b/shared'] }, name)[0]);
  });

  it('says the repo publishes no projector', async () => {
    const model = await installText('org/plain', hfFile('org/plain', 'plain-Q4_K_M.gguf'));
    server.serve({ repos: { 'org/plain': [{ path: 'plain-Q4_K_M.gguf', size: MODEL_SIZE }] } });
    await mount();

    await repair(model);

    const { visionRepairMessage } = require('../../../../src/services/modelManager/visionRepairMessage');
    expect(title()).toBe(visionRepairMessage({ kind: 'noProjectorPublished', repoId: 'org/plain' }, model.fileName)[0]);
  });

  it('downloads the projector the repo publishes, marks the model busy meanwhile, and links it', async () => {
    // Installed while the app runs, so the app-root listeners close out the download as they do on device.
    await mount();
    const model = await installText('org/vlm', hfFile('org/vlm', 'vlm-Q4_K_M.gguf'));
    server.serve({ repos: { 'org/vlm': [{ path: 'vlm-Q4_K_M.gguf', size: MODEL_SIZE }, { path: 'mmproj-vlm-f16.gguf', size: 90_000_000 }] } });
    await settle();

    await repair(model);
    await waitUntil(() => runningNative().length === 1);
    expect(result.current.isRepairingVision(model.id)).toBe(true);
    await rtl.act(async () => { await device.finishDownload(runningNative()[0].downloadId, 90_000_000); });
    await waitUntil(() => result.current.alertState.visible);

    const { visionRepairMessage } = require('../../../../src/services/modelManager/visionRepairMessage');
    expect(title()).toBe(visionRepairMessage({ kind: 'repaired', repoId: 'org/vlm' }, model.fileName)[0]);
    const projector = (stores.useAppStore.getState().downloadedModels[0] as { mmProjPath?: string }).mmProjPath!;
    expect(projector).toMatch(/mmproj-f16\.gguf$/);
    expect(await device.fs.exists(projector)).toBe(true);
    expect(result.current.isRepairingVision(model.id)).toBe(false);
  });

  it('says the repair failed when Hugging Face cannot be reached', async () => {
    const model = await installText('org/vlm', hfFile('org/vlm', 'vlm-Q4_K_M.gguf'));
    server.serve({ status: 503 });
    await mount();

    await repair(model);

    expect(title()).toBe('Repair Failed');
    expect(result.current.isRepairingVision(model.id)).toBe(false);
  });

  it('says a model that is not a llama.cpp model cannot be repaired', async () => {
    const model = await installText('org/lite', createModelFile({ name: 'gemma.litertlm', size: MODEL_SIZE }));
    await mount();

    await repair(model);

    const { visionRepairMessage } = require('../../../../src/services/modelManager/visionRepairMessage');
    expect(title()).toBe(visionRepairMessage({ kind: 'unsupported' }, model.fileName)[0]);
  });
});

// ── what the screen lists ─────────────────────────────────────────────

describe('active and completed items', () => {
  beforeEach(setup);

  it('lists an image download under its model name, without the image: prefix, with its engine', async () => {
    await mount();
    await rtl.act(async () => {
      await imageActions.proceedWithDownload({ ...zipModel('m1'), name: 'Pretty Name', backend: 'coreml' as any }, imageDeps());
    });

    const item = active('image', 'm1')!;
    expect(item.fileName).toBe('Pretty Name');
    expect(item.author).toBe('Core ML');
    expect(item.quantization).toBe('Core ML');
  });

  it('lists a text download with its author from the repo and its quantization', async () => {
    await mount();
    const file = createModelFile({ name: 'm-Q4_K_M.gguf', size: MODEL_SIZE, quantization: 'Q4_K_M' });
    await rtl.act(async () => { await modelDownloadService.start({ modelType: 'text', modelId: 'org/repo', file }); });

    const item = active('text', 'org/repo/m-Q4_K_M.gguf')!;
    expect(item.author).toBe('org');
    expect(item.quantization).toBe('Q4_K_M');
  });

  it('a finished download leaves Active and shows once, under Downloaded', async () => {
    await mount();
    const model = await installText('org/repo', createModelFile({ name: 'done.gguf', size: MODEL_SIZE }));
    await settle();

    expect(result.current.activeItems).toEqual([]);
    expect(result.current.completedItems.filter(i => i.modelId === model.id)).toHaveLength(1);
  });

  it('keeps polling the downloader while a download ticks progress (one subscription, not one per tick)', async () => {
    await mount();
    const file = createModelFile({ name: 'tick.gguf', size: MODEL_SIZE });
    await rtl.act(async () => { await modelDownloadService.start({ modelType: 'text', modelId: 'org/tick', file }); });
    const [row] = runningNative();
    const reads = () => device.boundary.download!.module.getActiveDownloads.mock.calls.length;
    const before = reads();

    // Progress arrives every 300 ms for 1.5 s; each tick hands the hook a new downloads object. A
    // subscription rebuilt per tick would restart the 1 s reconcile poll each time, so it never fires.
    for (let tick = 1; tick <= 5; tick++) {
      await rtl.act(async () => {
        await device.reportProgress(row.downloadId, tick * 1_000_000, MODEL_SIZE);
        await new Promise(resolve => setTimeout(resolve, 300));
      });
    }

    expect(reads() - before).toBeGreaterThanOrEqual(1);
  });
});

describe('voice models', () => {
  beforeEach(() => setup({ pro: true }));

  const tts = () => require('../../../../pro/audio/ttsStore').useTTSStore;
  const cache = () => require('../../../harness/kokoroResourceBoundary').currentKokoroResourceBoundary();

  it('a voice model that is downloading shows under Active, not Downloaded', async () => {
    await mount();
    const finish = cache().holdNext(0.3);
    let done!: Promise<void>;
    await rtl.act(async () => { done = tts().getState().downloadModels(); await device.settle(); });

    await waitUntil(() => active('tts', 'kokoro')?.status === 'downloading');
    expect(completed('tts', 'kokoro')).toBeUndefined();

    finish();
    await rtl.act(async () => { await done; });
    await waitUntil(() => !!completed('tts', 'kokoro'));
    expect(active('tts', 'kokoro')).toBeUndefined();
  });

  it('a failed voice download shows under Active with its failure, not Downloaded', async () => {
    await mount();
    cache().failFetch(new Error('Download interrupted'));
    await rtl.act(async () => { await tts().getState().downloadModels().catch(() => {}); await device.settle(); });

    await waitUntil(() => active('tts', 'kokoro')?.status === 'failed');
    expect(completed('tts', 'kokoro')).toBeUndefined();
  });

  it('a downloaded transcription model and a downloading voice model land in different sections', async () => {
    device.fs.seedFile('/docs/whisper-models/ggml-base.en.bin', 142_000_000);
    await mount();
    cache().holdNext(0.3);
    await rtl.act(async () => { tts().getState().downloadModels().catch(() => {}); await device.settle(); });

    await waitUntil(() => active('tts', 'kokoro')?.status === 'downloading' && !!completed('stt', 'base.en'));
    expect(completed('tts', 'kokoro')).toBeUndefined();
    expect(active('stt', 'base.en')).toBeUndefined();
  });

  it('asks before deleting a voice model', async () => {
    cache().seedVoice();
    await rtl.act(async () => { await tts().getState().downloadModels(); });
    await mount();
    await waitUntil(() => !!completed('tts', 'kokoro'));

    act(() => result.current.handleDeleteItem(completed('tts', 'kokoro')!));

    expect(result.current.alertState.title).toBe('Delete Voice Model');
  });
});
