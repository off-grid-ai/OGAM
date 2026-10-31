/**
 * Downloading an image model (imageDownloadActions), on the real stack.
 *
 * Only the device boundary is faked: the in-memory file system, the native download module (each
 * started download finishes, fails or is held, and moving it out writes real bytes to the fake disk),
 * the native unzip, the phone's SoC reading and async-storage. imageDownloadActions,
 * backgroundDownloadService (its slots and queue), the integrity check, modelManager, hardwareService,
 * the alert helpers and the stores all run for real. Outcomes are read from the fake disk, the model
 * list the app stores, the download store row and the alert the user would see.
 */
import { installNativeBoundary, type NativeBoundary } from '../../../harness/nativeBoundary';
import { installImageDownloadDevice, type ImageDownloadDevice, type ZipEntries } from '../../../harness/imageDownloadDevice';
import { SD_MNN_PACKAGE_FILES } from '../../../harness/imageModelPackage';
import type { ImageModelDescriptor } from '../../../../src/screens/ModelsScreen/types';
import type { ImageDownloadDeps } from '../../../../src/services/imageDownloadActions';

const COMPLETE_MNN: ZipEntries = Object.fromEntries(SD_MNN_PACKAGE_FILES.map(name => [name, 1024]));
const HF_KEY = 'image:test-hf-model';
const UNET_URL = 'https://huggingface.co/test/repo/resolve/main/unet/model.onnx';
const VAE_URL = 'https://huggingface.co/test/repo/resolve/main/vae/model.onnx';
const ZIP_URL = 'https://example.com/model.zip';

let boundary: NativeBoundary;
let device: ImageDownloadDevice;
let actions: typeof import('../../../../src/services/imageDownloadActions');
let useDownloadStore: typeof import('../../../../src/stores/downloadStore').useDownloadStore;
let useAppStore: typeof import('../../../../src/stores').useAppStore;
let modelManager: typeof import('../../../../src/services').modelManager;
let imageModelsDir: string;
let alerts: Array<{ title: string; message: string; buttons: Array<{ text: string; onPress?: () => void }> }>;

function setup(opts: { deviceHardware?: string } = {}) {
  boundary = installNativeBoundary({ fs: true, download: true, deviceHardware: opts.deviceHardware });
  device = installImageDownloadDevice(boundary);
  actions = require('../../../../src/services/imageDownloadActions');
  ({ useDownloadStore } = require('../../../../src/stores/downloadStore'));
  ({ useAppStore } = require('../../../../src/stores'));
  ({ modelManager } = require('../../../../src/services'));
  imageModelsDir = modelManager.getImageModelsDirectory();
  alerts = [];
}

/** The deps the Models screen hands in: the app store's own actions and the screen's alert. */
function deps(): ImageDownloadDeps {
  const app = useAppStore.getState();
  return {
    addDownloadedImageModel: app.addDownloadedImageModel,
    activeImageModelId: app.activeImageModelId,
    setActiveImageModelId: app.setActiveImageModelId,
    setAlertState: state => { alerts.push(state as any); },
    triedImageGen: true,
  };
}

function hfModel(overrides: Partial<ImageModelDescriptor> = {}): ImageModelDescriptor {
  return {
    id: 'test-hf-model',
    name: 'Test HF Model',
    description: 'A test model',
    downloadUrl: '',
    size: 1000000,
    style: 'creative',
    backend: 'mnn',
    huggingFaceRepo: 'test/repo',
    huggingFaceFiles: [
      { path: 'unet/model.onnx', size: 500000 },
      { path: 'vae/model.onnx', size: 500000 },
    ],
    ...overrides,
  };
}

function zipModel(overrides: Partial<ImageModelDescriptor> = {}): ImageModelDescriptor {
  return {
    id: 'test-zip-model',
    name: 'Test Zip Model',
    description: 'A zip model',
    downloadUrl: ZIP_URL,
    size: 2000000,
    style: 'creative',
    backend: 'mnn',
    ...overrides,
  };
}

function coreMLModel(): ImageModelDescriptor {
  return {
    id: 'test-coreml-model',
    name: 'Test CoreML Model',
    description: 'A CoreML model',
    downloadUrl: '',
    size: 3000000,
    style: 'photorealistic',
    backend: 'coreml',
    repo: 'apple/coreml-sd',
    coremlFiles: [
      { path: 'unet.mlmodelc', relativePath: 'unet.mlmodelc', size: 2000000, downloadUrl: 'https://example.com/unet' },
      { path: 'vae.mlmodelc', relativePath: 'vae.mlmodelc', size: 1000000, downloadUrl: 'https://example.com/vae' },
    ],
  };
}

const macrotask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Let the native events and the app's async work run until `done` holds (bounded by turns). */
async function until(done: () => boolean | Promise<boolean>) {
  for (let turn = 0; turn < 200; turn++) {
    if (await done()) return;
    await macrotask();
  }
  throw new Error('condition never held');
}

const row = (key: string) => useDownloadStore.getState().downloads[key];
const registeredIds = async () => (await modelManager.getDownloadedImageModels()).map(m => m.id);
const titles = () => alerts.map(a => a.title);

beforeEach(async () => {
  setup();
  await require('@react-native-async-storage/async-storage').clear();
});

describe('a Hugging Face multi-file download', () => {
  it('writes every part to disk, registers the model, activates it and drops the download row', async () => {
    const model = hfModel();

    await actions.downloadHuggingFaceModel(model, deps());

    const modelDir = `${imageModelsDir}/test-hf-model`;
    expect(await boundary.fs!.exists(`${modelDir}/unet/model.onnx`)).toBe(true);
    expect(await boundary.fs!.exists(`${modelDir}/vae/model.onnx`)).toBe(true);
    expect(await boundary.fs!.exists(`${modelDir}/_ready`)).toBe(true);
    expect(device.startedUrls()).toEqual([UNET_URL, VAE_URL]);
    expect(await registeredIds()).toEqual(['test-hf-model']);
    expect(useAppStore.getState().downloadedImageModels.map(m => m.id)).toEqual(['test-hf-model']);
    expect(useAppStore.getState().activeImageModelId).toBe('test-hf-model');
    expect(row(HF_KEY)).toBeUndefined();
    expect(titles()).toEqual(['Test HF Model is ready']);
  });

  it('keeps its file list in the row while running, and each part is an image download natively', async () => {
    const model = hfModel();
    device.serve(UNET_URL, { hold: true });

    const done = actions.downloadHuggingFaceModel(model, deps());
    await until(() => device.running().length === 1);

    expect(JSON.parse(row(HF_KEY).metadataJson!).imageModelHuggingFaceFiles).toEqual(model.huggingFaceFiles);
    expect(boundary.download!.active().map(r => r.modelType)).toEqual(['image']);

    await device.finish(device.running()[0]);
    await done;
    expect(await registeredIds()).toEqual(['test-hf-model']);
  });

  it('marks the row failed with the network reason, removes the partial folder and does not register', async () => {
    device.serve(UNET_URL, { failReason: 'Network failed' });

    await actions.downloadHuggingFaceModel(hfModel(), deps());

    expect(row(HF_KEY).status).toBe('failed');
    expect(row(HF_KEY).errorMessage).toBe('Network failed');
    expect(await boundary.fs!.exists(`${imageModelsDir}/test-hf-model`)).toBe(false);
    expect(await registeredIds()).toEqual([]);
    expect(titles()).toEqual(['Download Failed']);
  });

  it('fails, and does not register, when a part arrives empty', async () => {
    device.serve(VAE_URL, { bytes: 0 });

    await actions.downloadHuggingFaceModel(hfModel(), deps());

    expect(await registeredIds()).toEqual([]);
    expect(row(HF_KEY).status).toBe('failed');
    expect(row(HF_KEY).errorMessage).toContain('missing or empty');
    expect(await boundary.fs!.exists(`${imageModelsDir}/test-hf-model`)).toBe(false);
  });

  it('does not start a second time while its row is already running', async () => {
    device.serve(UNET_URL, { hold: true });
    const first = actions.downloadHuggingFaceModel(hfModel(), deps());
    await until(() => device.running().length === 1);

    await actions.downloadHuggingFaceModel(hfModel(), deps());

    expect(device.startedUrls()).toEqual([UNET_URL]);
    await device.finish(device.running()[0]);
    await first;
  });

  it('a retry after a failure reuses the failed row and completes', async () => {
    device.serve(UNET_URL, { failReason: 'Network failed' });
    await actions.downloadHuggingFaceModel(hfModel(), deps());
    expect(row(HF_KEY).status).toBe('failed');

    device.serve(UNET_URL, { hold: true });
    const retry = actions.downloadHuggingFaceModel(hfModel(), deps());
    await until(() => device.running().length === 1);
    expect(Object.keys(useDownloadStore.getState().downloads)).toEqual([HF_KEY]);
    expect(row(HF_KEY).status).not.toBe('failed');
    expect(row(HF_KEY).errorMessage).toBeUndefined();

    await device.finish(device.running()[0]);
    await retry;
    expect(await registeredIds()).toEqual(['test-hf-model']);
    expect(row(HF_KEY)).toBeUndefined();
  });

  it('stops quietly when the user removes the row mid-download', async () => {
    device.serve(UNET_URL, { hold: true });
    const done = actions.downloadHuggingFaceModel(hfModel(), deps());
    await until(() => device.running().length === 1);

    useDownloadStore.getState().remove(HF_KEY);
    await device.finish(device.running()[0]);
    await done;

    expect(row(HF_KEY)).toBeUndefined();
    expect(device.startedUrls()).toEqual([UNET_URL]);
    expect(await registeredIds()).toEqual([]);
    expect(await boundary.fs!.exists(`${imageModelsDir}/test-hf-model`)).toBe(false);
    expect(alerts).toEqual([]);
  });
});

describe('cancelSyntheticImageDownload', () => {
  it('does nothing when no multi-file download is running for the model', async () => {
    await expect(actions.cancelSyntheticImageDownload('non-existent-model')).resolves.toBeUndefined();
  });

  it('cancels the running native part, and the download ends without a failure', async () => {
    device.serve(UNET_URL, { hold: true });
    const done = actions.downloadHuggingFaceModel(hfModel(), deps());
    await until(() => device.running().length === 1);

    await actions.cancelSyntheticImageDownload('test-hf-model');
    await done;

    expect(boundary.download!.active()).toEqual([]);
    expect(device.startedUrls()).toEqual([UNET_URL]);
    expect(row(HF_KEY).status).not.toBe('failed');
    expect(await registeredIds()).toEqual([]);
    expect(await boundary.fs!.exists(`${imageModelsDir}/test-hf-model`)).toBe(false);
    expect(alerts).toEqual([]);
  });

  it('drops a part still queued for a slot, so it never starts natively', async () => {
    // Three other downloads hold every concurrency slot, so the first part waits in the queue.
    const others = ['a', 'b', 'c'].map(id => {
      const url = `https://example.com/${id}.zip`;
      device.serve(url, { hold: true });
      return actions.proceedWithDownload(zipModel({ id, downloadUrl: url }), deps());
    });
    await Promise.all(others);
    expect(device.running()).toHaveLength(3);

    const done = actions.downloadHuggingFaceModel(hfModel(), deps());
    await macrotask();
    await actions.cancelSyntheticImageDownload('test-hf-model');
    await done;

    expect(device.startedUrls()).not.toContain(UNET_URL);
    expect(device.running()).toHaveLength(3);
    expect(await registeredIds()).toEqual([]);
    expect(row(HF_KEY).status).not.toBe('failed');
    expect(alerts).toEqual([]);
  });
});

describe('a Core ML multi-file download', () => {
  it('writes every bundle, registers the model, fetches the tokenizer and drops the row', async () => {
    const model = coreMLModel();
    const modelDir = `${imageModelsDir}/test-coreml-model`;
    boundary.fs!.serveRemoteFile('https://huggingface.co/apple/coreml-sd/resolve/main/merges.txt', { body: '#version: 0.2' });
    boundary.fs!.serveRemoteFile('https://huggingface.co/apple/coreml-sd/resolve/main/vocab.json', { body: '{}' });

    await actions.downloadCoreMLMultiFile(model, deps());

    expect(await boundary.fs!.exists(`${modelDir}/unet.mlmodelc`)).toBe(true);
    expect(await boundary.fs!.exists(`${modelDir}/vae.mlmodelc`)).toBe(true);
    expect(await registeredIds()).toEqual(['test-coreml-model']);
    expect((await modelManager.getDownloadedImageModels())[0].modelPath).toBe(modelDir);
    expect(row('image:test-coreml-model')).toBeUndefined();
    expect(titles()).toEqual(['Test CoreML Model is ready']);
    await until(() => boundary.fs!.exists(`${modelDir}/vocab.json`));
    expect(await boundary.fs!.exists(`${modelDir}/merges.txt`)).toBe(true);
  });

  it('keeps its bundle list in the row while running', async () => {
    const model = coreMLModel();
    device.serve('https://example.com/unet', { hold: true });

    const done = actions.downloadCoreMLMultiFile(model, deps());
    await until(() => device.running().length === 1);
    expect(JSON.parse(row('image:test-coreml-model').metadataJson!).imageModelCoremlFiles).toEqual(model.coremlFiles);

    await device.finish(device.running()[0]);
    await done;
  });
});

describe('a zip download (proceedWithDownload)', () => {
  it('downloads natively, unzips into the model folder, registers it and cleans up the zip', async () => {
    device.serve(ZIP_URL, { zip: COMPLETE_MNN });

    await actions.proceedWithDownload(zipModel(), deps());
    await until(async () => (await registeredIds()).length === 1);

    const modelDir = `${imageModelsDir}/test-zip-model`;
    expect(device.startedUrls()).toEqual([ZIP_URL]);
    expect(await registeredIds()).toEqual(['test-zip-model']);
    expect(await boundary.fs!.exists(`${modelDir}/unet.mnn`)).toBe(true);
    expect(await boundary.fs!.exists(`${modelDir}/_ready`)).toBe(true);
    expect(await boundary.fs!.exists(`${imageModelsDir}/test-zip-model.zip`)).toBe(false);
    expect(row('image:test-zip-model')).toBeUndefined();
    expect(titles()).toEqual(['Test Zip Model is ready']);
  });

  it('keeps the source URL in the row and the native row, under the real download id', async () => {
    device.serve(ZIP_URL, { hold: true });

    await actions.proceedWithDownload(zipModel(), deps());

    const [nativeId] = device.running();
    const entry = row('image:test-zip-model');
    expect(entry.downloadId).toBe(nativeId);
    expect(JSON.parse(entry.metadataJson!).imageModelDownloadUrl).toBe(ZIP_URL);
    expect(boundary.download!.active().map(r => r.fileName)).toEqual(['test-zip-model.zip']);
  });

  it('keeps the row visible and tells the user when the native download fails', async () => {
    device.serve(ZIP_URL, { failReason: 'Connection lost' });

    await actions.proceedWithDownload(zipModel(), deps());
    await until(() => titles().length > 0);

    expect(titles()).toEqual(['Download Failed']);
    expect(row('image:test-zip-model')).toBeDefined();
    expect(await registeredIds()).toEqual([]);
  });

  it('a retry after a failure reuses the failed row under the new download id', async () => {
    device.serve(ZIP_URL, { failReason: 'Connection lost' });
    await actions.proceedWithDownload(zipModel(), deps());
    await until(() => titles().length > 0);
    useDownloadStore.getState().setStatus(row('image:test-zip-model').downloadId, 'failed', { message: 'Connection lost' });
    const failedId = row('image:test-zip-model').downloadId;

    device.serve(ZIP_URL, { zip: COMPLETE_MNN, hold: true });
    await actions.proceedWithDownload(zipModel(), deps());

    expect(Object.keys(useDownloadStore.getState().downloads)).toEqual(['image:test-zip-model']);
    expect(row('image:test-zip-model').downloadId).not.toBe(failedId);
    expect(row('image:test-zip-model').status).not.toBe('failed');
    await device.finish(row('image:test-zip-model').downloadId);
    await until(async () => (await registeredIds()).length === 1);
    expect(row('image:test-zip-model')).toBeUndefined();
  });
});

describe('handleDownloadImageModel', () => {
  it('refuses an NPU model on an Android phone with no compatible NPU', async () => {
    setup({ deviceHardware: 'mt6789' });

    await actions.handleDownloadImageModel(zipModel({ backend: 'qnn' }), deps());

    expect(titles()).toEqual(['Incompatible Model']);
    expect(alerts[0].buttons.map(b => b.text)).toEqual(['OK']);
    expect(device.startedUrls()).toEqual([]);
    expect(row('image:test-zip-model')).toBeUndefined();
  });

  it('starts a GPU model straight away', async () => {
    device.serve(ZIP_URL, { hold: true });

    await actions.handleDownloadImageModel(zipModel({ backend: 'mnn' }), deps());

    expect(device.startedUrls()).toEqual([ZIP_URL]);
    expect(row('image:test-zip-model').status).not.toBe('failed');
  });
});

describe('registerAndNotify', () => {
  it('registers the model, makes it active, drops its download row and says it is ready', async () => {
    device.serve(ZIP_URL, { hold: true });
    await actions.proceedWithDownload(zipModel({ id: 'img-1' }), deps());
    expect(row('image:img-1')).toBeDefined();
    for (const name of SD_MNN_PACKAGE_FILES) boundary.fs!.seedFile(`${imageModelsDir}/img-1/${name}`, 1024);

    await actions.registerAndNotify(deps(), {
      imageModel: {
        id: 'img-1',
        name: 'Img 1',
        description: 'desc',
        modelPath: `${imageModelsDir}/img-1`,
        downloadedAt: new Date().toISOString(),
        size: 123,
        style: 'creative',
        backend: 'mnn',
      },
      modelName: 'Img 1',
    });

    expect(await registeredIds()).toEqual(['img-1']);
    expect(useAppStore.getState().activeImageModelId).toBe('img-1');
    expect(row('image:img-1')).toBeUndefined();
    expect(titles()).toEqual(['Img 1 is ready']);
  });
});
