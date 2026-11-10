/**
 * A failed unzip keeps the downloaded zip, so a retry processes it again instead of downloading it
 * again. Play review on 0.0.122: "fails during processing which for some reason requires a whole new
 * download". The real image download code runs over the device harness: a fake disk, the native
 * downloader and the unzip leaf.
 */
import { installNativeBoundary, type NativeBoundary } from '../../harness/nativeBoundary';
import { installImageDownloadDevice, type ImageDownloadDevice, type ZipEntries } from '../../harness/imageDownloadDevice';
import { SD_MNN_PACKAGE_FILES } from '../../harness/imageModelPackage';

const COMPLETE: ZipEntries = Object.fromEntries(SD_MNN_PACKAGE_FILES.map(name => [name, 1024]));
const ZIP_BYTES = 1000;
const URL = 'https://models.test/test-model.zip';
const MODEL = {
  id: 'test-model', name: 'Test Model', description: 'desc', downloadUrl: URL,
  size: ZIP_BYTES, style: 'realistic', backend: 'mnn' as const,
};

let boundary: NativeBoundary;
let device: ImageDownloadDevice;
let alerts: string[];
let zipPath: string;
let modelDir: string;

beforeEach(async () => {
  boundary = installNativeBoundary({ fs: true, download: true });
  device = installImageDownloadDevice(boundary);
  await require('@react-native-async-storage/async-storage').clear();
  alerts = [];
  const { modelManager } = require('../../../src/services');
  zipPath = `${modelManager.getImageModelsDirectory()}/test-model.zip`;
  modelDir = `${modelManager.getImageModelsDirectory()}/test-model`;
});

async function download() {
  const { proceedWithDownload } = require('../../../src/services/imageDownloadActions');
  const { useAppStore } = require('../../../src/stores');
  const app = useAppStore.getState();
  await proceedWithDownload(MODEL, {
    addDownloadedImageModel: app.addDownloadedImageModel,
    activeImageModelId: app.activeImageModelId,
    setActiveImageModelId: app.setActiveImageModelId,
    setAlertState: (state: { title: string }) => { alerts.push(state.title); },
    triedImageGen: true,
  });
  // Let the download finish and its processing settle.
  for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

const row = () => require('../../../src/stores/downloadStore').useDownloadStore.getState().downloads['image:test-model'];
const installed = () => require('../../../src/stores').useAppStore.getState().downloadedImageModels.map((m: { id: string }) => m.id);

describe('a failed unzip keeps the download', () => {
  it('a retry unzips the kept zip without downloading again', async () => {
    device.serve(URL, { zip: COMPLETE, bytes: ZIP_BYTES });
    // The phone runs out of room while unzipping, once.
    require('react-native-zip-archive').unzip.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));

    await download();
    expect(row()?.status).toBe('failed');
    expect(await boundary.fs!.exists(zipPath)).toBe(true);
    expect(await boundary.fs!.exists(modelDir)).toBe(false); // a half-made model never reads as installed

    await download();
    expect(device.startedUrls()).toEqual([URL]); // one download, not two
    expect(installed()).toEqual(['test-model']);
    expect(await boundary.fs!.exists(zipPath)).toBe(false);
    expect(alerts.at(-1)).toBe('Test Model is ready');
  });

  it('a kept zip that fails again is dropped, so the next retry downloads a fresh one', async () => {
    // The host serves an archive missing files: processing fails on it every time.
    const incomplete = { ...COMPLETE };
    delete incomplete[SD_MNN_PACKAGE_FILES[0]];
    device.serve(URL, { zip: incomplete, bytes: ZIP_BYTES });

    await download();
    expect(await boundary.fs!.exists(zipPath)).toBe(true);

    await download();
    expect(device.startedUrls()).toEqual([URL]);
    expect(row()?.status).toBe('failed');
    expect(await boundary.fs!.exists(zipPath)).toBe(false);

    device.serve(URL, { zip: COMPLETE, bytes: ZIP_BYTES });
    await download();
    expect(device.startedUrls()).toEqual([URL, URL]);
    expect(installed()).toEqual(['test-model']);
  });

  it('removing the failed download removes its kept zip', async () => {
    device.serve(URL, { zip: COMPLETE, bytes: ZIP_BYTES });
    require('react-native-zip-archive').unzip.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));
    await download();
    expect(await boundary.fs!.exists(zipPath)).toBe(true);

    const { imageProvider } = require('../../../src/services/modelDownloadService/providers/imageProvider');
    await imageProvider.remove('image:test-model');
    expect(await boundary.fs!.exists(zipPath)).toBe(false);
  });
});
