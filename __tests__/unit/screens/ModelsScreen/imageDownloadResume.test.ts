/**
 * Resuming an image download after a restart (resumeImageDownload).
 *
 * The real resume code, integrity check, image download actions, model manager and stores run on top
 * of the device boundary only: the in-memory file system, the native download module (a download that
 * finished before the restart) and the native unzip. Outcomes are read from the fake disk, the model
 * list the app stores, the download store row and the alert the user sees.
 */
import { installNativeBoundary, type NativeBoundary } from '../../../harness/nativeBoundary';
import { installImageDownloadDevice, type ImageDownloadDevice, type ZipEntries } from '../../../harness/imageDownloadDevice';
import { SD_MNN_PACKAGE_FILES } from '../../../harness/imageModelPackage';

const COMPLETE_MNN: ZipEntries = Object.fromEntries(SD_MNN_PACKAGE_FILES.map(name => [name, 1024]));
const ZIP_BYTES = 1000;

let boundary: NativeBoundary;
let device: ImageDownloadDevice;
let imageModelsDir: string;
let modelDir: string;
let zipPath: string;
let alertTitle: string | undefined;
let resumeImageDownload: typeof import('../../../../src/screens/ModelsScreen/imageDownloadResume').resumeImageDownload;
let useDownloadStore: typeof import('../../../../src/stores/downloadStore').useDownloadStore;
let useAppStore: typeof import('../../../../src/stores').useAppStore;
let modelManager: typeof import('../../../../src/services').modelManager;

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    modelKey: 'image:test-model',
    downloadId: 'dl-1',
    modelId: 'image:test-model',
    fileName: 'test-model.zip',
    quantization: '',
    modelType: 'image',
    status: 'processing',
    bytesDownloaded: ZIP_BYTES,
    totalBytes: ZIP_BYTES,
    combinedTotalBytes: ZIP_BYTES,
    progress: 1,
    createdAt: Date.now(),
    metadataJson: JSON.stringify({
      imageDownloadType: 'zip',
      imageModelName: 'Test Model',
      imageModelDescription: 'desc',
      imageModelSize: ZIP_BYTES,
      imageModelBackend: 'mnn',
    }),
    ...overrides,
  } as any;
}

/** The persisted download row the app holds after a restart, then the resume over it. */
async function resume(entry = makeEntry()) {
  useDownloadStore.getState().add(entry);
  const app = useAppStore.getState();
  await resumeImageDownload(entry, {
    addDownloadedImageModel: app.addDownloadedImageModel,
    activeImageModelId: app.activeImageModelId,
    setActiveImageModelId: app.setActiveImageModelId,
    setAlertState: state => { alertTitle = state.title; },
    triedImageGen: true,
  });
}

function seedModelDir(entries: ZipEntries) {
  for (const [name, size] of Object.entries(entries)) boundary.fs!.seedFile(`${modelDir}/${name}`, size);
}

async function expectRegistered() {
  expect((await modelManager.getDownloadedImageModels()).map(m => m.id)).toEqual(['test-model']);
  expect(useAppStore.getState().downloadedImageModels.map(m => m.id)).toEqual(['test-model']);
  expect(useAppStore.getState().activeImageModelId).toBe('test-model');
  expect(useDownloadStore.getState().downloads['image:test-model']).toBeUndefined();
  expect(alertTitle).toBe('Test Model is ready');
}

const nativeMoves = () => boundary.download!.module.moveCompletedDownload.mock.calls.length;

beforeEach(async () => {
  boundary = installNativeBoundary({ fs: true, download: true });
  device = installImageDownloadDevice(boundary);
  await require('@react-native-async-storage/async-storage').clear();
  alertTitle = undefined;
  ({ resumeImageDownload } = require('../../../../src/screens/ModelsScreen/imageDownloadResume'));
  ({ useDownloadStore } = require('../../../../src/stores/downloadStore'));
  ({ useAppStore } = require('../../../../src/stores'));
  ({ modelManager } = require('../../../../src/services'));
  imageModelsDir = modelManager.getImageModelsDirectory();
  modelDir = `${imageModelsDir}/test-model`;
  zipPath = `${imageModelsDir}/test-model.zip`;
});

describe('resumeImageDownload', () => {
  it('registers immediately when modelDir already holds a complete model', async () => {
    seedModelDir(COMPLETE_MNN);

    await resume();

    await expectRegistered();
    expect(nativeMoves()).toBe(0);
    expect(boundary.fs!.listFiles(modelDir).sort()).toEqual(SD_MNN_PACKAGE_FILES.map(f => `${modelDir}/${f}`).sort());
  });

  it('deletes an invalid destination zip and recovers the finished download from the native module', async () => {
    boundary.fs!.seedTextFile(zipPath, 'NOPE', 128);
    device.seedCompleted({ downloadId: 'dl-1', fileName: 'test-model.zip' }, { zip: COMPLETE_MNN, bytes: ZIP_BYTES });

    await resume();

    await expectRegistered();
    expect(nativeMoves()).toBe(1);
    expect(await boundary.fs!.exists(zipPath)).toBe(false); // the extracted zip is cleaned up
    expect(await boundary.fs!.exists(`${modelDir}/unet.mnn`)).toBe(true);
    expect(await boundary.fs!.exists(`${modelDir}/_ready`)).toBe(true);
  });

  it('cleans an empty modelDir and a failed zip before recovering', async () => {
    boundary.fs!.seedDir(modelDir);
    boundary.fs!.seedTextFile(zipPath, 'BAD!', 64);
    device.seedCompleted({ downloadId: 'dl-1', fileName: 'test-model.zip' }, { zip: COMPLETE_MNN, bytes: ZIP_BYTES });

    await resume();

    await expectRegistered();
    expect(nativeMoves()).toBe(1);
    expect(await boundary.fs!.exists(zipPath)).toBe(false);
    expect((await modelManager.getDownloadedImageModels())[0].modelPath).toBe(modelDir);
  });

  it('marks the entry failed and removes the partial modelDir when unzip fails after move recovery', async () => {
    // The native module hands back a file with a zip header whose body is not a readable archive.
    device.seedCompleted({ downloadId: 'dl-1', fileName: 'test-model.zip' }, { text: 'PK\u0003\u0004garbage', bytes: ZIP_BYTES });

    await resume();

    expect(await boundary.fs!.exists(modelDir)).toBe(false);
    const row = useDownloadStore.getState().downloads['image:test-model'];
    expect(row.status).toBe('failed');
    expect(row.errorMessage).toBe('corrupt zip');
    expect(await modelManager.getDownloadedImageModels()).toEqual([]);
    expect(alertTitle).toBeUndefined();
  });

  it('unzips a valid zip already on disk without asking the native module', async () => {
    device.seedZip(zipPath, COMPLETE_MNN, ZIP_BYTES);

    await resume();

    await expectRegistered();
    expect(nativeMoves()).toBe(0);
    expect(await boundary.fs!.exists(zipPath)).toBe(false);
    expect(await boundary.fs!.exists(`${modelDir}/vae_decoder.mnn.weight`)).toBe(true);
  });

  it('registers a multifile model whose files are all on disk', async () => {
    const entry = makeEntry({
      metadataJson: JSON.stringify({
        imageDownloadType: 'multifile',
        imageModelName: 'Test Model',
        imageModelDescription: 'desc',
        imageModelSize: ZIP_BYTES,
        imageModelBackend: 'mnn',
        imageModelHuggingFaceFiles: [{ path: 'unet.mnn', size: ZIP_BYTES }],
      }),
    });
    boundary.fs!.seedFile(`${modelDir}/unet.mnn`, ZIP_BYTES);

    await resume(entry);

    await expectRegistered();
    expect(nativeMoves()).toBe(0);
    expect(await boundary.fs!.exists(`${modelDir}/_ready`)).toBe(true);
  });
});
