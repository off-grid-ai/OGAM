/**
 * A download refused for space, retried once space is free.
 *
 * SPEC: I tap Download on a phone without room. The download is refused up front and its row
 * says "Not enough storage. Free up space and retry." with Retry. I free space and tap Retry:
 * the download starts and finishes. Nothing had started before, so there is nothing to resume:
 * Retry starts the download I asked for, the same as my first tap.
 *
 * The phone is the boundary: the disk and its free space, the native background downloader
 * (harness/modelManagerDevice). startModelDownload, modelManager, the download service and its
 * providers, and the stores run for real. Retry goes through the one control every screen uses.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../harness/modelManagerDevice';
import { createModelFile, createModelFileWithMmProj } from '../../utils/factories';

const MB = 1024 * 1024;
const MODEL_ID = 'author/model';
const KEY = 'author/model/model.gguf';
const SIZE = 900 * MB;

let device: ModelManagerDevice;

async function phone(platform: 'ios' | 'android') {
  device = await installModelManagerDevice({ platform });
  const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
  registerCoreDownloadProviders();
  const { modelDownloadService } = require('../../../src/services/modelDownloadService');
  const { uniformDownloadId } = require('../../../src/services/modelDownloadService/uniformId');
  const { startModelDownload } = require('../../../src/services/startModelDownload');
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  const { useAppStore } = require('../../../src/stores');
  const { isRetryable } = require('../../../src/utils/downloadErrors');
  return {
    startModelDownload,
    retry: () => modelDownloadService.retry(uniformDownloadId('text', KEY)),
    row: () => useDownloadStore.getState().downloads[KEY],
    registered: () => (useAppStore.getState().downloadedModels as Array<{ id: string }>).map(m => m.id),
    isRetryable,
  };
}

describe.each(['android', 'ios'] as const)('a download refused for space, on %s', platform => {
  it('offers Retry, and Retry after freeing space downloads the model', async () => {
    const app = await phone(platform);
    device.boundary.fs!.setFreeBytes(200 * MB);
    await app.startModelDownload(MODEL_ID, createModelFile({ name: 'model.gguf', size: SIZE }), {});
    await device.settle();
    expect(device.nativeRows()).toHaveLength(0);
    expect(app.row()).toEqual(expect.objectContaining({ status: 'failed', errorCode: 'disk_full' }));
    expect(app.isRetryable(app.row()!.errorCode)).toBe(true);

    device.boundary.fs!.setFreeBytes(64 * 1024 * MB);
    await app.retry();
    await device.settle();

    const [native] = device.nativeRows();
    expect(native).toEqual(expect.objectContaining({ fileName: 'model.gguf', modelId: MODEL_ID }));
    expect(app.row()).toEqual(expect.objectContaining({ status: expect.not.stringMatching(/failed/) }));
    await device.finishDownload(native.downloadId, SIZE);
    expect(app.registered()).toContain(KEY);
  });

  it('a vision model gets its projector too when Retry starts it', async () => {
    const app = await phone(platform);
    device.boundary.fs!.setFreeBytes(200 * MB);
    const file = createModelFileWithMmProj({ name: 'model.gguf', size: SIZE, mmProjSize: 100 * MB });
    await app.startModelDownload(MODEL_ID, file, {});
    await device.settle();
    expect(app.row()).toEqual(expect.objectContaining({ status: 'failed', errorCode: 'disk_full' }));

    device.boundary.fs!.setFreeBytes(64 * 1024 * MB);
    await app.retry();
    await device.settle();

    expect(device.nativeRows().map(r => r.fileName).sort()).toEqual(
      ['model.gguf', expect.stringMatching(/mmproj/)].sort(),
    );
  });

  it('Retry while the phone is still full says so again and starts nothing', async () => {
    const app = await phone(platform);
    device.boundary.fs!.setFreeBytes(200 * MB);
    await app.startModelDownload(MODEL_ID, createModelFile({ name: 'model.gguf', size: SIZE }), {});
    await device.settle();

    await app.retry().catch(() => undefined);
    await device.settle();

    expect(device.nativeRows()).toHaveLength(0);
    expect(app.row()).toEqual(expect.objectContaining({ status: 'failed', errorCode: 'disk_full' }));
  });
});

const ZIP_URL = 'https://example.com/test-zip-model.zip';
const ZIP_KEY = 'image:test-zip-model';
const HF_KEY = 'image:test-hf-model';

/** The image models the Models screen offers: one zip, one Hugging Face repo of separate files. */
function imageModels() {
  const base = { description: 'An image model', style: 'creative', backend: 'mnn' } as const;
  return {
    zip: { ...base, id: 'test-zip-model', name: 'Test Zip Model', downloadUrl: ZIP_URL, size: SIZE },
    multi: {
      ...base, id: 'test-hf-model', name: 'Test HF Model', downloadUrl: '', size: SIZE,
      huggingFaceRepo: 'test/repo',
      huggingFaceFiles: [{ path: 'unet/model.onnx', size: SIZE / 2 }, { path: 'vae/model.onnx', size: SIZE / 2 }],
    },
  };
}

async function imagePhone(platform: 'ios' | 'android') {
  const app = await phone(platform);
  const { installImageDownloadDevice } = require('../../harness/imageDownloadDevice');
  const images = installImageDownloadDevice(device.boundary);
  const actions = require('../../../src/services/imageDownloadActions');
  const { modelDownloadService } = require('../../../src/services/modelDownloadService');
  const { uniformDownloadId } = require('../../../src/services/modelDownloadService/uniformId');
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  const { useAppStore } = require('../../../src/stores');
  const deps = () => {
    const state = useAppStore.getState();
    return {
      addDownloadedImageModel: state.addDownloadedImageModel,
      activeImageModelId: state.activeImageModelId,
      setActiveImageModelId: state.setActiveImageModelId,
      setAlertState: () => undefined,
      triedImageGen: true,
    };
  };
  return {
    ...app,
    images,
    start: (model: unknown) => actions.proceedWithDownload(model, deps()),
    retryImage: (id: string) => modelDownloadService.retry(uniformDownloadId('image', id)),
    imageRow: (key: string) => useDownloadStore.getState().downloads[key],
  };
}

describe.each(['android', 'ios'] as const)('an image download refused for space, on %s', platform => {
  it('a zip: Retry after freeing space starts its download', async () => {
    const app = await imagePhone(platform);
    app.images.serve(ZIP_URL, { hold: true });
    device.boundary.fs!.setFreeBytes(200 * MB);
    await app.start(imageModels().zip);
    await device.settle();
    expect(app.images.startedUrls()).toEqual([]);
    expect(app.imageRow(ZIP_KEY)).toEqual(expect.objectContaining({ status: 'failed', errorCode: 'disk_full' }));
    expect(app.isRetryable(app.imageRow(ZIP_KEY)!.errorCode)).toBe(true);

    device.boundary.fs!.setFreeBytes(64 * 1024 * MB);
    await app.retryImage('test-zip-model');
    await device.settle();

    expect(app.images.startedUrls()).toEqual([ZIP_URL]);
    expect(app.imageRow(ZIP_KEY)).toEqual(expect.objectContaining({ status: expect.not.stringMatching(/failed/) }));
  });

  it('separate files: Retry after freeing space starts their download', async () => {
    const app = await imagePhone(platform);
    device.boundary.fs!.setFreeBytes(200 * MB);
    await app.start(imageModels().multi);
    await device.settle();
    expect(app.imageRow(HF_KEY)).toEqual(expect.objectContaining({ status: 'failed', errorCode: 'disk_full' }));
    expect(app.isRetryable(app.imageRow(HF_KEY)!.errorCode)).toBe(true);

    device.boundary.fs!.setFreeBytes(64 * 1024 * MB);
    for (const path of ['unet/model.onnx', 'vae/model.onnx']) {
      app.images.serve(`https://huggingface.co/test/repo/resolve/main/${path}`, { hold: true });
    }
    await app.retryImage('test-hf-model');
    await device.settle();

    expect(app.images.startedUrls()).toEqual([expect.stringContaining('test/repo/resolve/main/')]);
    expect(app.imageRow(HF_KEY)).toEqual(expect.objectContaining({ status: expect.not.stringMatching(/failed/) }));
  });
});

describe.each(['android', 'ios'] as const)('a transcription download refused for space, on %s', platform => {
  it('Retry after freeing space downloads it', async () => {
    const app = await phone(platform);
    const { whisperService } = require('../../../src/services/whisperService');
    const { modelDownloadService } = require('../../../src/services/modelDownloadService');
    const { useDownloadStore } = require('../../../src/stores/downloadStore');
    const sttRow = () => Object.values(useDownloadStore.getState().downloads).find((e: any) => e.modelType === 'stt') as any;
    device.boundary.fs!.setFreeBytes(20 * MB);
    await whisperService.downloadModel('tiny.en').catch(() => undefined);
    await device.settle();
    expect(device.nativeRows()).toHaveLength(0);
    expect(sttRow()).toEqual(expect.objectContaining({ status: 'failed', errorCode: 'disk_full' }));
    expect(app.isRetryable(sttRow().errorCode)).toBe(true);

    device.boundary.fs!.setFreeBytes(64 * 1024 * MB);
    await modelDownloadService.retry('stt:tiny.en');
    await device.settle();

    const native = device.nativeRows().find(r => r.modelId === 'whisper-tiny.en');
    expect(native).toBeDefined();
    await device.finishDownload(native!.downloadId, 75 * MB);
    await device.settle();
    expect(await whisperService.isModelDownloaded('tiny.en')).toBe(true);
  });
});
