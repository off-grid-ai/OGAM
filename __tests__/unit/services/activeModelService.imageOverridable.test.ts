/**
 * The image-model load gate (checkImageModelCanLoad), through activeModelService.loadImageModel.
 *
 * A first memory refusal is OVERRIDABLE (the app offers "Load Anyway"); "Load Anyway" then evicts what it
 * can and loads. A missing NPU is a hardware gap, never overridable.
 *
 * Real: activeModelService, checkImageModelCanLoad, the residency manager's budget and eviction,
 * hardwareService's RAM estimate and SoC read, localDreamGenerator, the stores. Faked (device,
 * harness/generationDevice): the diffusion native module, the filesystem, RAM, the SoC the device reports.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { GB } from '../../harness/nativeBoundary';
import { SD_MNN_PACKAGE_FILES } from '../../harness/imageModelPackage';
import { createONNXImageModel } from '../../utils/factories';

let d: GenerationDevice;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

/** An 8 GB phone with 3 GB free and no chat model; one image model of the given size on disk. */
async function phoneWithImageModel(sizeGB: number, backend: 'mnn' | 'qnn' = 'mnn') {
  d = await launchGeneration({ localModel: false, ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 3 * GB } });
  const modelPath = `${d.boundary.fs!.DocumentDirectoryPath}/image_models/img`;
  for (const f of SD_MNN_PACKAGE_FILES) d.boundary.fs!.seedFile(`${modelPath}/${f}`, 1024);
  if (backend === 'qnn') for (const f of ['unet.bin', 'vae_decoder.bin']) d.boundary.fs!.seedFile(`${modelPath}/${f}`, 1024);
  d.useAppStore.getState().addDownloadedImageModel(
    createONNXImageModel({ id: 'img', name: 'Test Image Model', modelPath, backend, size: sizeGB * GB }),
  );
}
const loaded = () => d.activeModelService.getLoadedModelIds().imageModelId;

describe('image load gate — overridability', () => {
  it('loads an image model that fits', async () => {
    await phoneWithImageModel(0.5);

    await d.activeModelService.loadImageModel('img');

    expect(loaded()).toBe('img');
    expect(d.boundary.diffusion.module.loadModel).toHaveBeenCalledTimes(1);
  });

  it('a first refusal is overridable, and nothing reaches native', async () => {
    await phoneWithImageModel(2);

    const error = await d.activeModelService.loadImageModel('img').catch((e: Error) => e);

    const { OverridableMemoryError } = require('../../../src/services/modelLoadErrors');
    expect(error).toBeInstanceOf(OverridableMemoryError);
    expect(error.message).toBe('Not enough memory to load Test Image Model. Free up space or choose a smaller model.');
    expect(d.boundary.diffusion.module.loadModel).not.toHaveBeenCalled();
    expect(loaded()).toBeNull();
  });

  it('"Load Anyway" after that refusal loads the model', async () => {
    await phoneWithImageModel(2);
    await expect(d.activeModelService.loadImageModel('img')).rejects.toThrow(/Not enough memory/);

    await d.activeModelService.loadImageModel('img', undefined, { override: true });

    expect(loaded()).toBe('img');
    expect(d.boundary.diffusion.module.loadModel).toHaveBeenCalledTimes(1);
  });

  it('an NPU model on a phone without a Snapdragon NPU is refused, and the refusal is not overridable', async () => {
    await phoneWithImageModel(0.5, 'qnn');

    const error = await d.activeModelService.loadImageModel('img').catch((e: Error) => e);

    const { OverridableMemoryError } = require('../../../src/services/modelLoadErrors');
    expect(error).not.toBeInstanceOf(OverridableMemoryError);
    expect(error.message).toMatch(/NPU models require a Qualcomm Snapdragon processor/);
    expect(d.boundary.diffusion.module.loadModel).not.toHaveBeenCalled();
  });
});
