/**
 * An image download that the app restored after a relaunch finishes while the Image tab is open.
 *
 * Android WorkManager keeps the native download running across an app kill. On the next launch the
 * app hydrates the download store from the native rows; when the native download then completes,
 * the download listeners move the entry to "processing", and useImageModels must finish it (move the
 * zip, unzip, check, register) because the listener that started it died with the old process.
 *
 * Real: useImageModels, useDownloadListeners, hydrateDownloadStore, imageDownloadResume,
 * imageDownloadActions, backgroundDownloadService, modelManager and the stores. Faked at the device
 * boundary only: the native download module, the file system and the unzip module.
 */
import { installNativeBoundary, requireRTL, GB, type NativeBoundary } from '../../../harness/nativeBoundary';
import { installImageZipPackage } from '../../../harness/imageModelPackage';

const MODEL_ID = 'anythingv5_cpu';
const MODEL_KEY = `image:${MODEL_ID}`;
const ZIP = `${MODEL_ID}.zip`;
const ZIP_BYTES = 400 * 1024 * 1024;

/** The native row WorkManager kept, carrying the metadata the app gave it when the download started. */
function survivingNativeRow(boundary: NativeBoundary) {
  boundary.download!.seedActive({
    downloadId: 'dl-7',
    modelId: MODEL_KEY,
    modelKey: MODEL_KEY,
    modelType: 'image',
    fileName: ZIP,
    status: 'running',
    bytesDownloaded: ZIP_BYTES / 2,
    totalBytes: ZIP_BYTES,
    createdAt: Date.now(),
    metadataJson: JSON.stringify({
      imageDownloadType: 'zip',
      imageModelName: 'Anything V5',
      imageModelDescription: 'GPU',
      imageModelSize: ZIP_BYTES,
      imageModelStyle: 'anime',
      imageModelBackend: 'mnn',
      imageModelDownloadUrl: `https://huggingface.co/xororz/sd-mnn/resolve/main/AnythingV5.zip`,
    }),
  } as Parameters<NonNullable<NativeBoundary['download']>['seedActive']>[0]);
}

async function relaunchWithImageTabOpen() {
  const boundary = installNativeBoundary({
    download: true,
    fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  installImageZipPackage(boundary);
  survivingNativeRow(boundary);
  const rtl = requireRTL();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await (AsyncStorage.default ?? AsyncStorage).clear();

  const { useAppStore } = require('../../../../src/stores');
  const { useDownloadStore } = require('../../../../src/stores/downloadStore');
  const { hydrateDownloadStore } = require('../../../../src/services/downloadHydration');
  const { useDownloadListeners } = require('../../../../src/hooks/useDownloads');
  const { useImageModels } = require('../../../../src/screens/ModelsScreen/useImageModels');

  // The person has generated an image before, so a finished model becomes the active one.
  useAppStore.getState().completeChecklistStep('triedImageGen');
  await hydrateDownloadStore();

  const alerts: string[] = [];
  const view = rtl.renderHook(() => {
    useDownloadListeners();
    return useImageModels((s: { title: string; visible: boolean }) => { if (s.visible) alerts.push(s.title); });
  });

  const completeNatively = () =>
    rtl.act(async () => {
      boundary.download!.events.emit('DownloadComplete', {
        downloadId: 'dl-7', fileName: ZIP, modelId: MODEL_KEY,
        bytesDownloaded: ZIP_BYTES, totalBytes: ZIP_BYTES, status: 'completed', localUri: `/docs/${ZIP}`,
      });
    });

  return { boundary, rtl, view, alerts, useAppStore, useDownloadStore, completeNatively };
}

const registeredIds = (useAppStore: any) =>
  useAppStore.getState().downloadedImageModels.map((model: { id: string }) => model.id);

describe('useImageModels: a restored image download that finishes after mount', () => {
  it('is finished and registered once the native download completes', async () => {
    const app = await relaunchWithImageTabOpen();

    // BEFORE: the restored download is still running; nothing is registered or moved.
    await app.rtl.waitFor(() => expect(app.view.result.current.downloadedImageModels).toEqual([]));
    expect(app.useDownloadStore.getState().downloads[MODEL_KEY]?.status).toBe('running');
    expect(app.boundary.download!.module.moveCompletedDownload).not.toHaveBeenCalled();

    await app.completeNatively();

    await app.rtl.waitFor(() => expect(registeredIds(app.useAppStore)).toEqual([MODEL_ID]));
    const model = app.useAppStore.getState().downloadedImageModels[0];
    expect(model).toMatchObject({ name: 'Anything V5', backend: 'mnn', style: 'anime' });
    expect(app.boundary.fs!.listFiles(model.modelPath)).toEqual(
      expect.arrayContaining([`${model.modelPath}/unet.mnn`, `${model.modelPath}/_ready`]));
    expect(app.useAppStore.getState().activeImageModelId).toBe(MODEL_ID);
    expect(app.useDownloadStore.getState().downloads[MODEL_KEY]).toBeUndefined();
    expect(app.alerts).toEqual(['Anything V5 is ready']);
  });

  it('does not finish the same download twice while the first finish is still running', async () => {
    const app = await relaunchWithImageTabOpen();
    // Hold the native move so the first finish stays in flight.
    let releaseMove!: () => void;
    const move = app.boundary.download!.module.moveCompletedDownload;
    const placeZip = move.getMockImplementation()!;
    move.mockImplementation((id: string, target: string) =>
      new Promise(resolve => { releaseMove = () => resolve(placeZip(id, target)); }));

    await app.completeNatively();
    await app.rtl.waitFor(() => expect(move).toHaveBeenCalledTimes(1));

    // The download list changes while the finish is in flight (another download reports progress):
    // the Image tab looks at its processing entries again and must leave the one in flight alone.
    await app.rtl.act(async () => {
      app.useDownloadStore.getState().add({
        modelKey: 'image:other', downloadId: 'dl-8', modelId: 'image:other', fileName: 'other.zip',
        quantization: '', modelType: 'image', status: 'running', bytesDownloaded: 1, totalBytes: 10,
        combinedTotalBytes: 10, progress: 0.1, createdAt: Date.now(),
      });
    });
    await app.rtl.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(move).toHaveBeenCalledTimes(1);

    await app.rtl.act(async () => { releaseMove(); });
    await app.rtl.waitFor(() => expect(registeredIds(app.useAppStore)).toEqual([MODEL_ID]));
    expect(app.alerts).toEqual(['Anything V5 is ready']);
    expect(move).toHaveBeenCalledTimes(1);
  });
});
