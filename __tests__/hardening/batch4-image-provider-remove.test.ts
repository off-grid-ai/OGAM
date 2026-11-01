/**
 * BATCH 4 (Image Generation) — hardening.
 *
 * device case 37: confirming the delete removes the model from the downloaded
 * list. The delete-confirmation ALERT (cases 35/36) is a thin on-device UI
 * interaction (device-owned), but the removal CHAIN that fires on confirm is
 * real, testable logic and was NOT covered by the existing imageProvider suite
 * (its docstring claims "remove" but no test drives it).
 *
 * This drives the REAL `imageProvider.remove` over the REAL modelManager, activeModelService,
 * backgroundDownloadService, residency manager and stores, and asserts the full teardown:
 * cancel the native download row (if any) + drop the store entry + unload the resident image
 * model + delete the model files + remove it from the app store (which also clears
 * activeImageModelId when it was the active model — so image generation is disabled after
 * uninstall, matching case 29/38). Only the phone is faked (modelManagerDevice: the disk, the
 * native downloader, async-storage; installNativeBoundary's image-generation native module).
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../harness/modelManagerDevice';
import { SD_MNN_PACKAGE_FILES } from '../harness/imageModelPackage';

let device: ModelManagerDevice;
let imageProvider: any;
let useDownloadStore: any;
let useAppStore: any;
let activeModelService: any;
let residency: any;

/** A finished image-model download: its files on disk and its record saved, as finalize leaves it. */
async function installImageModel(id: string): Promise<void> {
  const modelPath = `${device.imageModelsDir}/${id}`;
  for (const name of SD_MNN_PACKAGE_FILES) device.fs.seedFile(`${modelPath}/${name}`, 1024 * 1024);
  const model = { id, name: id.toUpperCase(), description: '', size: 500 * 1024 * 1024, modelPath, backend: 'mnn' };
  await device.modelManager.addDownloadedImageModel(model as never);
  useAppStore.getState().addDownloadedImageModel(model);
}

/** The person picks the model for image generation and it loads into memory. */
async function loadImageModel(id: string): Promise<void> {
  useAppStore.getState().setActiveImageModelId(id);
  await activeModelService.loadImageModel(id);
  expect(residency.isResident('image')).toBe(true);
}

const filesOnDisk = (id: string) => device.fs.exists(`${device.imageModelsDir}/${id}`);

beforeEach(async () => {
  device = await installModelManagerDevice({ platform: 'android' });
  ({ imageProvider } = require('../../src/services/modelDownloadService/providers/imageProvider'));
  ({ useDownloadStore } = require('../../src/stores/downloadStore'));
  ({ useAppStore } = require('../../src/stores'));
  ({ activeModelService } = require('../../src/services/activeModelService'));
  ({ modelResidencyManager: residency } = require('../../src/services/modelResidency'));
  await require('../../src/services/hardware').hardwareService.refreshMemoryInfo();
});

describe('imageProvider.remove — uninstall chain (case 37)', () => {
  it('removes a fully-downloaded model from the store and deletes its files', async () => {
    await installImageModel('sdxl');
    await loadImageModel('sdxl');

    await imageProvider.remove('image:sdxl');

    expect(await filesOnDisk('sdxl')).toBe(false);
    expect((await device.readImageRegistry()).some(m => m.id === 'sdxl')).toBe(false);
    expect(useAppStore.getState().downloadedImageModels.find((m: { id: string }) => m.id === 'sdxl')).toBeUndefined();
    // The ejected model does not stay resident.
    expect(residency.isResident('image')).toBe(false);
  });

  it('uninstalling the ACTIVE model clears activeImageModelId (disables image gen — cases 29/38)', async () => {
    await installImageModel('sdxl');
    await loadImageModel('sdxl');

    await imageProvider.remove('image:sdxl');

    expect(useAppStore.getState().activeImageModelId).toBeNull();
    expect(residency.isResident('image')).toBe(false);
  });

  it('cancels the native download row and drops the store entry when a download is still in-flight', async () => {
    await installImageModel('sdxl');
    device.boundary.download!.seedActive({
      downloadId: 'dl-9', modelId: 'image:sdxl', fileName: 'SDXL', modelType: 'image',
      status: 'running', bytesDownloaded: 30, totalBytes: 100,
    });
    useDownloadStore.getState().add({
      modelKey: 'image:sdxl/m', downloadId: 'dl-9', modelId: 'image:sdxl', fileName: 'SDXL',
      quantization: '', modelType: 'image', status: 'running', bytesDownloaded: 30, totalBytes: 100,
      combinedTotalBytes: 100, progress: 0.3, createdAt: 1,
    });

    await imageProvider.remove('image:sdxl');

    expect(device.nativeRows().map(row => row.downloadId)).not.toContain('dl-9');
    expect(useDownloadStore.getState().downloads['image:sdxl/m']).toBeUndefined();
    expect(await filesOnDisk('sdxl')).toBe(false);
  });

  it('still deletes files and removes from store even when the native unload fails (best-effort teardown)', async () => {
    await installImageModel('sdxl');
    await loadImageModel('sdxl');
    // The image engine refuses to unload.
    device.boundary.diffusion.module.unloadModel.mockRejectedValueOnce(new Error('unload boom'));

    // Must not throw — the removal completes despite the unload failure.
    await expect(imageProvider.remove('image:sdxl')).resolves.toBeUndefined();

    expect(await filesOnDisk('sdxl')).toBe(false);
    expect(useAppStore.getState().downloadedImageModels).toHaveLength(0);
    expect(useAppStore.getState().activeImageModelId).toBeNull();
  });
});
