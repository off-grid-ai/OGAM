/**
 * Image download recovery: a zip image download finished natively while the app was away, and a
 * broken zip (wrong size, not a zip) sits at the destination from an earlier attempt. On launch the
 * app hydrates the finished row as 'processing'; resuming it must throw the broken zip away, move the
 * finished download into place, extract it and register the model — leaving no download row behind.
 *
 * Real: downloadHydration, imageDownloadResume, imageModelIntegrity, modelManager,
 * backgroundDownloadService, the stores. Faked, because they are the phone: the disk, the native
 * downloader (modelManagerDevice) and react-native-zip-archive's native unzip, which writes an
 * xororz/sd-mnn package into the destination.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';
import { SD_MNN_PACKAGE_FILES } from '../../harness/imageModelPackage';

describe('image download recovery integration', () => {
  let device: ModelManagerDevice;

  beforeEach(async () => {
    device = await installModelManagerDevice({ platform: 'android' });
    const { unzip } = require('react-native-zip-archive') as { unzip: jest.Mock };
    unzip.mockImplementation(async (_zip: string, destination: string) => {
      for (const name of SD_MNN_PACKAGE_FILES) device.fs.seedFile(`${destination}/${name}`, 1024);
      return destination;
    });
  });

  it('hydrates a completed image row as processing and recovers by replacing an invalid destination zip', async () => {
    const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
    const { resumeImageDownload } = require('../../../src/screens/ModelsScreen/imageDownloadResume');
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    const { useAppStore } = require('../../../src/stores');

    const modelDir = `${device.imageModelsDir}/test-model`;
    const zipPath = `${device.imageModelsDir}/test-model.zip`;
    // An earlier attempt left a broken zip at the destination: the wrong size and not a zip.
    device.fs.seedTextFile(zipPath, 'NOPE', 128);
    // The native downloader finished the transfer: a real zip in its staging folder, the row completed.
    const staged = `${device.fs.module.CachesDirectoryPath}/native-downloads/dl-1-test-model.zip`;
    device.fs.seedTextFile(staged, 'PK\u0003\u0004', 1000);
    device.boundary.download!.seedActive({
      downloadId: 'dl-1',
      modelId: 'image:test-model',
      modelKey: 'image:test-model',
      fileName: 'test-model.zip',
      modelType: 'image',
      status: 'completed',
      bytesDownloaded: 1000,
      totalBytes: 1000,
      combinedTotalBytes: 1000,
      createdAt: 1,
      localUri: `file://${staged}`,
      metadataJson: JSON.stringify({
        imageDownloadType: 'zip',
        imageModelName: 'Test Model',
        imageModelDescription: 'desc',
        imageModelSize: 1000,
        imageModelBackend: 'mnn',
      }),
    } as never);

    await hydrateDownloadStore();

    const entry = useDownloadStore.getState().downloads['image:test-model'];
    expect(entry.status).toBe('processing');

    // Resume with the same dependencies the Download Manager hands it.
    const alerts: unknown[] = [];
    const appState = useAppStore.getState();
    await resumeImageDownload(entry, {
      addDownloadedImageModel: appState.addDownloadedImageModel,
      activeImageModelId: appState.activeImageModelId,
      setActiveImageModelId: appState.setActiveImageModelId,
      setAlertState: (state: unknown) => alerts.push(state),
      triedImageGen: true,
    });

    // The finished download replaced the broken zip and was extracted into the model folder.
    expect(await device.fs.exists(`${modelDir}/unet.mnn`)).toBe(true);
    expect(await device.fs.exists(staged)).toBe(false);
    // The model is registered on disk and in the app, and the download row is gone.
    expect(await device.readImageRegistry()).toEqual([
      expect.objectContaining({ id: 'test-model', modelPath: modelDir }),
    ]);
    expect(useAppStore.getState().downloadedImageModels.map((m: { id: string }) => m.id)).toContain('test-model');
    expect(useDownloadStore.getState().downloads['image:test-model']).toBeUndefined();
  });
});
