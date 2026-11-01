/**
 * syncCompletedImageDownloads: image downloads that finished natively while the app was closed.
 *
 * Fakes: the native background downloader and the native unzip (harness/imageDownloadDevice), the disk
 * (react-native-fs in memory, which also answers the tokenizer file downloads) and async-storage
 * (harness/modelManagerDevice). imageSync, backgroundDownloadService and the Core ML helpers run for
 * real. A finished download is a completed row in the native set; moving it out writes the file.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';
import { installImageDownloadDevice, type ImageDownloadDevice } from '../../../harness/imageDownloadDevice';
import type { ONNXImageModel, PersistedDownloadInfo } from '../../../../src/types';

type ImageSyncModule = typeof import('../../../../src/services/modelManager/imageSync');

describe('syncCompletedImageDownloads', () => {
  let device: ModelManagerDevice;
  let images: ImageDownloadDevice;
  let sync: ImageSyncModule['syncCompletedImageDownloads'];

  beforeEach(async () => {
    device = await installModelManagerDevice({ platform: 'android' });
    images = installImageDownloadDevice(device.boundary);
    ({ syncCompletedImageDownloads: sync } = require('../../../../src/services/modelManager/imageSync') as ImageSyncModule);
  });

  const meta = (extra: Partial<PersistedDownloadInfo>): PersistedDownloadInfo => ({
    modelId: 'image:model1', fileName: 'model1', quantization: '', author: 'image', totalBytes: 500, ...extra,
  });

  /** Run the sync against an image registry that starts with `installed`. */
  async function run(persistedDownloads: Record<string, PersistedDownloadInfo>, installed: Array<Partial<ONNXImageModel>> = []) {
    const registry = [...installed] as ONNXImageModel[];
    const cleared: string[] = [];
    const result = await sync({
      imageModelsDir: device.imageModelsDir,
      persistedDownloads,
      clearDownloadCallback: id => cleared.push(id),
      getDownloadedImageModels: async () => registry,
      addDownloadedImageModel: async model => { registry.push(model); },
    });
    return { result, registry, cleared };
  }

  it('returns nothing when no download finished', async () => {
    const { result, cleared } = await run({});
    expect(result).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('skips a download still running, one it has no metadata for, a text model and one with no image type', async () => {
    device.boundary.download!.seedActive({ downloadId: 'running', status: 'running', modelId: 'image:model1' });
    images.seedCompleted({ downloadId: 'unknown' }, { bytes: 10 });
    images.seedCompleted({ downloadId: 'text' }, { bytes: 10 });
    images.seedCompleted({ downloadId: 'untyped' }, { bytes: 10 });

    const { result, registry, cleared } = await run({
      running: meta({ imageDownloadType: 'multifile', imageModelName: 'M1' }),
      text: meta({ modelId: 'text:model1', imageDownloadType: 'multifile' }),
      untyped: meta({}),
    });

    expect(result).toEqual([]);
    expect(registry).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('clears a finished download whose model is already installed, without adding it again', async () => {
    images.seedCompleted({ downloadId: 'one' }, { bytes: 10 });

    const { result, registry, cleared } = await run(
      { one: meta({ imageDownloadType: 'multifile' }) },
      [{ id: 'model1' }],
    );

    expect(result).toEqual([]);
    expect(registry).toHaveLength(1);
    expect(cleared).toEqual(['one']);
  });

  it('recovers a multifile download and registers it', async () => {
    images.seedCompleted({ downloadId: 'one' }, { bytes: 10 });

    const { result, registry, cleared } = await run({
      one: meta({
        imageDownloadType: 'multifile', imageModelName: 'Model One', imageModelDescription: 'A model',
        imageModelSize: 500, imageModelStyle: 'realistic', imageModelBackend: 'mnn',
      }),
    });

    expect(result.map(m => [m.id, m.name, m.description, m.modelPath, m.size, m.style])).toEqual([
      ['model1', 'Model One', 'A model', `${device.imageModelsDir}/model1`, 500, 'realistic'],
    ]);
    expect(registry.map(m => m.id)).toEqual(['model1']);
    expect(cleared).toEqual(['one']);
  });

  it('recovers a zip download: moves the zip in, extracts it, and removes the zip', async () => {
    images.seedCompleted({ downloadId: 'two' }, { zip: { 'unet.mnn': 400, 'clip.mnn': 100 } });
    const dir = device.imageModelsDir;

    const { result } = await run({
      two: meta({
        modelId: 'image:model2', imageDownloadType: 'zip', fileName: 'model2.zip',
        imageModelName: 'Model Two', imageModelSize: 1000, imageModelBackend: 'mnn',
      }),
    });

    expect(result.map(m => m.modelPath)).toEqual([`${dir}/model2`]);
    expect(device.fs.listFiles(`${dir}/model2`).sort()).toEqual([`${dir}/model2/clip.mnn`, `${dir}/model2/unet.mnn`]);
    expect(await device.fs.exists(`${dir}/model2.zip`)).toBe(false);
  });

  it('points a Core ML zip at the folder that holds the compiled models', async () => {
    images.seedCompleted({ downloadId: 'three' }, { zip: { 'resolved/Unet.mlmodelc': 800 } });

    const { result } = await run({
      three: meta({
        modelId: 'image:model3', imageDownloadType: 'zip', fileName: 'model3.zip',
        imageModelName: 'CoreML Model', imageModelBackend: 'coreml', imageModelSize: 800,
      }),
    });

    expect(result.map(m => m.modelPath)).toEqual([`${device.imageModelsDir}/model3/resolved`]);
  });

  it('fetches the tokenizer files for a Core ML multifile download that names its repo', async () => {
    images.seedCompleted({ downloadId: 'four' }, { bytes: 10 });
    device.fs.serveRemoteFile('https://huggingface.co/org/repo/resolve/main/merges.txt', { body: 'merges' });
    device.fs.serveRemoteFile('https://huggingface.co/org/repo/resolve/main/vocab.json', { body: '{}' });
    const dir = `${device.imageModelsDir}/model4`;

    await run({
      four: meta({
        modelId: 'image:model4', imageDownloadType: 'multifile', imageModelName: 'CoreML Multi',
        imageModelBackend: 'coreml', imageModelRepo: 'org/repo', imageModelSize: 600,
      }),
    });

    expect(await device.fs.module.readFile(`${dir}/merges.txt`, 'utf8')).toBe('merges');
    expect(await device.fs.module.readFile(`${dir}/vocab.json`, 'utf8')).toBe('{}');
  });

  it('fetches no tokenizer files when the Core ML download names no repo', async () => {
    images.seedCompleted({ downloadId: 'five' }, { bytes: 10 });
    const dir = `${device.imageModelsDir}/model5`;

    const { result } = await run({
      five: meta({
        modelId: 'image:model5', imageDownloadType: 'multifile', imageModelName: 'CoreML No Repo',
        imageModelBackend: 'coreml', imageModelSize: 600,
      }),
    });

    expect(result).toHaveLength(1);
    expect(await device.fs.exists(`${dir}/merges.txt`)).toBe(false);
    expect(await device.fs.exists(`${dir}/vocab.json`)).toBe(false);
  });

  it('names a model by its id when the metadata has no name', async () => {
    images.seedCompleted({ downloadId: 'six' }, { bytes: 10 });

    const { result } = await run({
      six: meta({ modelId: 'image:unnamed-model', imageDownloadType: 'multifile', imageModelSize: 200, imageModelBackend: 'mnn' }),
    });

    expect(result.map(m => m.name)).toEqual(['unnamed-model']);
  });

  it('keeps the metadata for a later retry when the zip cannot be moved out and is not on disk', async () => {
    // The row says completed, but the native layer has no file to hand over.
    device.boundary.download!.seedActive({ downloadId: 'seven', status: 'completed' });

    const { result, registry, cleared } = await run({
      seven: meta({
        modelId: 'image:broken', imageDownloadType: 'zip', fileName: 'broken.zip',
        imageModelName: 'Broken', imageModelBackend: 'mnn', imageModelSize: 100,
      }),
    });

    expect(result).toEqual([]);
    expect(registry).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('creates the image folder when it does not exist yet (zip path)', async () => {
    images.seedCompleted({ downloadId: 'eight' }, { zip: { 'unet.mnn': 100 } });
    const dir = device.imageModelsDir;
    expect(await device.fs.exists(dir)).toBe(false);

    const { result } = await run({
      eight: meta({
        modelId: 'image:model8', imageDownloadType: 'zip', fileName: 'model8.zip',
        imageModelName: 'Model 8', imageModelBackend: 'mnn', imageModelSize: 100,
      }),
    });

    expect(result).toHaveLength(1);
    expect(await device.fs.exists(`${dir}/model8/unet.mnn`)).toBe(true);
  });
});
