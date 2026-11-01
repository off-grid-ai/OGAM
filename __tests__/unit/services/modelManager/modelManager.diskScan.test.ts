/**
 * modelManager against what is actually on the disk: image-model registry, orphaned files, models
 * adopted from the models folder after a crash or reinstall, and image downloads that finished while
 * the app was killed.
 *
 * Fakes: the disk (react-native-fs over memfs), async-storage, react-native-zip-archive (native unzip,
 * which writes real files) — see harness/modelManagerDevice. modelManager, the scanners, the Core ML
 * resolver and the integrity checks run for real. Files are put on the disk because files on the disk
 * are what these paths read; registry rows are written through modelManager unless the test is about a
 * row an earlier container left behind.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';

const IMAGE_MODEL = (id: string, modelPath: string, size = 1000) => ({
  id, name: id, description: 'Test', modelPath, size, downloadedAt: '2026-10-01T00:00:00.000Z', backend: 'mnn' as const,
});

describe('modelManager on the disk', () => {
  let device: ModelManagerDevice;

  beforeEach(async () => {
    device = await installModelManagerDevice();
  });

  describe('image-model registry', () => {
    it('adds a model, replaces one with the same id, and reports the space they use', async () => {
      const { modelManager, imageModelsDir, fs } = device;
      fs.seedDir(`${imageModelsDir}/a`);
      fs.seedDir(`${imageModelsDir}/b`);
      expect(await modelManager.getImageModelsStorageUsed()).toBe(0);

      await modelManager.addDownloadedImageModel(IMAGE_MODEL('a', `${imageModelsDir}/a`, 1000));
      await modelManager.addDownloadedImageModel({ ...IMAGE_MODEL('b', `${imageModelsDir}/b`, 1500), name: 'Old Name' });
      await modelManager.addDownloadedImageModel({ ...IMAGE_MODEL('b', `${imageModelsDir}/b`, 2000), name: 'New Name' });

      expect((await device.readImageRegistry()).map(m => [m.id, m.name])).toEqual([['a', 'a'], ['b', 'New Name']]);
      expect(await modelManager.getImageModelsStorageUsed()).toBe(3000);
      expect(await modelManager.getImageModelPath('b')).toBe(`${imageModelsDir}/b`);
      expect(await modelManager.getImageModelPath('nonexistent')).toBeNull();
      expect(modelManager.getImageModelsDirectory()).toBe('/docs/image_models');
    });

    it('drops a model whose folder left the disk', async () => {
      const { modelManager, imageModelsDir, fs } = device;
      fs.seedDir(`${imageModelsDir}/exists`);
      fs.seedDir(`${imageModelsDir}/missing`);
      await modelManager.addDownloadedImageModel(IMAGE_MODEL('exists', `${imageModelsDir}/exists`));
      await modelManager.addDownloadedImageModel(IMAGE_MODEL('missing', `${imageModelsDir}/missing`));

      await fs.module.unlink(`${imageModelsDir}/missing`);

      expect((await modelManager.getDownloadedImageModels()).map(m => m.id)).toEqual(['exists']);
      expect((await device.readImageRegistry()).map(m => m.id)).toEqual(['exists']);
    });

    it('collapses image rows an older version duplicated for one folder', async () => {
      const { modelManager, imageModelsDir, fs } = device;
      fs.seedDir(`${imageModelsDir}/sd`);
      await device.seedImageRegistry([
        { ...IMAGE_MODEL('recovered_sd', `${imageModelsDir}/sd`), downloadedAt: '2026-01-01' },
        { ...IMAGE_MODEL('sd', `${imageModelsDir}/sd`), downloadedAt: '2026-01-02' },
      ]);

      expect((await modelManager.getDownloadedImageModels()).map(m => m.id)).toEqual(['sd']);
      expect((await device.readImageRegistry()).map(m => m.id)).toEqual(['sd']);
    });

    it('finds an image model again after a reinstall moved the app container', async () => {
      const { modelManager, imageModelsDir, fs } = device;
      fs.seedDir(`${imageModelsDir}/sd-turbo`);
      await device.seedImageRegistry([IMAGE_MODEL('img-model-ios', '/old-uuid/Documents/image_models/sd-turbo')]);

      expect((await modelManager.getDownloadedImageModels()).map(m => m.modelPath)).toEqual([`${imageModelsDir}/sd-turbo`]);
    });

    it('deletes the model folder and its row', async () => {
      const { modelManager, imageModelsDir, fs } = device;
      fs.seedFile(`${imageModelsDir}/img-delete/unet.mnn`, 1000);
      await modelManager.addDownloadedImageModel(IMAGE_MODEL('img-delete', `${imageModelsDir}/img-delete`));

      await modelManager.deleteImageModel('img-delete');

      expect(await fs.exists(`${imageModelsDir}/img-delete`)).toBe(false);
      expect(await device.readImageRegistry()).toEqual([]);
    });

    it('removes the row even when its top-level folder is already gone', async () => {
      const { modelManager, imageModelsDir, fs } = device;
      // A row whose model path is a folder other than the id-named one.
      fs.seedFile(`${imageModelsDir}/elsewhere/unet.mnn`, 1000);
      await modelManager.addDownloadedImageModel(IMAGE_MODEL('img-no-file', `${imageModelsDir}/elsewhere`));

      await modelManager.deleteImageModel('img-no-file');

      expect(await device.readImageRegistry()).toEqual([]);
      expect(await fs.exists(`${imageModelsDir}/elsewhere/unet.mnn`)).toBe(true);
    });

    it('throws when the image model is not installed', async () => {
      await expect(device.modelManager.deleteImageModel('nonexistent')).rejects.toThrow('Image model not found');
    });
  });

  describe('getOrphanedFiles', () => {
    it('lists files and image folders no model claims, with their sizes', async () => {
      const { modelManager, modelsDir, imageModelsDir, fs } = device;
      fs.seedFile(`${modelsDir}/orphan.gguf`, 5000);
      fs.seedFile(`${imageModelsDir}/anythingv5_cpu/model.onnx`, 500_000);
      fs.seedFile(`${imageModelsDir}/orphan-model.onnx`, 3_000_000);

      const orphaned = await modelManager.getOrphanedFiles();

      expect(orphaned.map(o => [o.name, o.size]).sort()).toEqual([
        ['anythingv5_cpu', 500_000],
        ['orphan-model.onnx', 3_000_000],
        ['orphan.gguf', 5000],
      ]);
    });

    it('leaves out files an installed model owns', async () => {
      const { modelManager, modelsDir, imageModelsDir, fs } = device;
      fs.seedFile(`${modelsDir}/tracked.gguf`, 5000);
      await device.seedRegistry([{ id: 'm1', name: 'm1', fileName: 'tracked.gguf', filePath: `${modelsDir}/tracked.gguf`, fileSize: 5000 }]);
      fs.seedFile(`${imageModelsDir}/tracked/unet.mnn`, 1000);
      await modelManager.addDownloadedImageModel(IMAGE_MODEL('tracked', `${imageModelsDir}/tracked`));

      expect(await modelManager.getOrphanedFiles()).toEqual([]);
    });

    it('answers empty for empty folders, and when a folder cannot be read', async () => {
      const { modelManager, imageModelsDir, fs } = device;
      expect(await modelManager.getOrphanedFiles()).toEqual([]);

      const readDirOnDisk = fs.module.readDir.getMockImplementation()!;
      fs.module.readDir.mockImplementation(async path => {
        if (path === imageModelsDir) throw new Error('Permission denied');
        return readDirOnDisk(path);
      });
      expect(await modelManager.getOrphanedFiles()).toEqual([]);
    });
  });

  describe('deleteOrphanedFile', () => {
    it('deletes a file that is there, ignores one that is not, and surfaces a refused delete', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile(`${modelsDir}/orphan.gguf`, 1000);
      await modelManager.deleteOrphanedFile(`${modelsDir}/orphan.gguf`);
      expect(await fs.exists(`${modelsDir}/orphan.gguf`)).toBe(false);

      await expect(modelManager.deleteOrphanedFile(`${modelsDir}/missing.gguf`)).resolves.toBeUndefined();

      fs.seedFile(`${modelsDir}/locked.gguf`, 1000);
      fs.module.unlink.mockRejectedValueOnce(new Error('Permission denied'));
      await expect(modelManager.deleteOrphanedFile(`${modelsDir}/locked.gguf`)).rejects.toThrow('Permission denied');
      expect(await fs.exists(`${modelsDir}/locked.gguf`)).toBe(true);
    });
  });

  describe('scanForUntrackedTextModels', () => {
    it('adopts a model file found in the models folder, with its quantization, and saves it', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile(`${modelsDir}/untracked-Q4_K_M.gguf`, 4_000_000_000);
      fs.seedFile(`${modelsDir}/llama-7b-Q8_0.gguf`, 7_000_000_000);

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered.map(m => [m.fileName, m.quantization, m.fileSize]).sort()).toEqual([
        ['llama-7b-Q8_0.gguf', 'Q8_0', 7_000_000_000],
        ['untracked-Q4_K_M.gguf', 'Q4_K_M', 4_000_000_000],
      ]);
      expect((await device.readRegistry()).map(m => m.fileName).sort()).toEqual(['llama-7b-Q8_0.gguf', 'untracked-Q4_K_M.gguf']);
    });

    it('never adopts a projector, an MTP head, a draft model or a tiny file as a model', async () => {
      const { modelManager, modelsDir, fs } = device;
      for (const name of ['Qwen3.5-9B-Q4_K_M.gguf', 'Qwen3.5-9B-MTP-ONLY-Q4_K_M.gguf', 'mtp-gemma-4-E4B-it-Q8_0.gguf', 'Qwen3.5-9B-DFlash-Q4_0.gguf', 'model-mmproj-f16.gguf']) {
        fs.seedFile(`${modelsDir}/${name}`, 1_500_000_000);
      }
      fs.seedFile(`${modelsDir}/tiny-model.gguf`, 500_000);

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered.map(m => m.fileName)).toEqual(['Qwen3.5-9B-Q4_K_M.gguf']);
    });

    it('does not adopt a file the registry already has', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile(`${modelsDir}/existing.gguf`, 4_000_000_000);
      await device.seedRegistry([{ id: 'existing', name: 'Existing', author: 'test', fileName: 'existing.gguf', filePath: `${modelsDir}/existing.gguf`, fileSize: 4_000_000_000, quantization: 'Q4_K_M', downloadedAt: '' }]);

      expect(await modelManager.scanForUntrackedTextModels()).toEqual([]);
      expect((await device.readRegistry()).map(m => m.id)).toEqual(['existing']);
    });

    it('reads a size the platform reports as a string', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile(`${modelsDir}/model-f16.gguf`, 1);
      fs.setReportedFileSize(`${modelsDir}/model-f16.gguf`, '4000000000');

      const discovered = await modelManager.scanForUntrackedTextModels();

      expect(discovered.map(m => m.fileSize)).toEqual([4_000_000_000]);
    });

    it('answers empty for an empty folder and when the folder cannot be read', async () => {
      const { modelManager, modelsDir, fs } = device;
      expect(await modelManager.scanForUntrackedTextModels()).toEqual([]);

      fs.module.readDir.mockImplementation(async path => {
        if (path === modelsDir) throw new Error('Permission denied');
        return [];
      });
      expect(await modelManager.scanForUntrackedTextModels()).toEqual([]);
    });
  });

  describe('scanForUntrackedImageModels', () => {
    it('adopts a model folder, with its size and the backend its name says', async () => {
      const { modelManager, imageModelsDir, fs } = device;
      fs.seedFile(`${imageModelsDir}/sd_v15_mnn/unet.onnx`, 1_500_000_000);
      fs.seedFile(`${imageModelsDir}/sd_v15_mnn/vae.onnx`, 500_000_000);
      fs.seedFile(`${imageModelsDir}/model-qnn-8gen3/model.bin`, 1_000_000_000);
      fs.seedFile(`${imageModelsDir}/sd21-coreml-compiled/model.mlmodelc`, 1_500_000_000);
      fs.seedFile(`${imageModelsDir}/string_size/model.bin`, 1);
      fs.setReportedFileSize(`${imageModelsDir}/string_size/model.bin`, '1500000');

      const discovered = await modelManager.scanForUntrackedImageModels();

      expect(discovered.map(m => [m.id, m.backend, m.size]).sort()).toEqual([
        ['recovered_model-qnn-8gen3', 'qnn', 1_000_000_000],
        ['recovered_sd21-coreml-compiled', 'coreml', 1_500_000_000],
        ['recovered_sd_v15_mnn', 'mnn', 2_000_000_000],
        ['recovered_string_size', 'mnn', 1_500_000],
      ]);
      expect(await device.readImageRegistry()).toHaveLength(4);
    });

    it('skips stray files, empty folders, unreadable folders and folders already registered', async () => {
      const { modelManager, imageModelsDir, fs } = device;
      fs.seedFile(`${imageModelsDir}/stray-file.txt`, 100);
      fs.seedDir(`${imageModelsDir}/empty-model`);
      fs.seedFile(`${imageModelsDir}/unreadable-model/unet.mnn`, 1000);
      fs.seedFile(`${imageModelsDir}/existing-model/unet.mnn`, 1000);
      await modelManager.addDownloadedImageModel(IMAGE_MODEL('existing', `${imageModelsDir}/existing-model`));
      const readDirOnDisk = fs.module.readDir.getMockImplementation()!;
      fs.module.readDir.mockImplementation(async path => {
        if (path === `${imageModelsDir}/unreadable-model`) throw new Error('Permission denied');
        return readDirOnDisk(path);
      });

      expect(await modelManager.scanForUntrackedImageModels()).toEqual([]);
      expect((await device.readImageRegistry()).map(m => m.id)).toEqual(['existing']);
    });

    it('answers empty when the image folder does not exist', async () => {
      const { modelManager, imageModelsDir, fs } = device;
      const existsOnDisk = fs.module.exists.getMockImplementation()!;
      // The folder vanishes between initialize and the scan (the OS cleared it).
      fs.module.exists.mockImplementation(async path => (path === imageModelsDir ? false : existsOnDisk(path)));

      expect(await modelManager.scanForUntrackedImageModels()).toEqual([]);
    });
  });

  describe('refreshModelLists', () => {
    it('adopts what is on disk and answers both lists, installed models included', async () => {
      const { modelManager, modelsDir, imageModelsDir, fs } = device;
      fs.seedFile(`${modelsDir}/m1.gguf`, 1000);
      await device.seedRegistry([{ id: 'm1', name: 'Model 1', fileName: 'm1.gguf', filePath: `${modelsDir}/m1.gguf`, fileSize: 1000 }]);
      fs.seedFile(`${modelsDir}/found-Q4_K_M.gguf`, 2_000_000_000);
      fs.seedFile(`${imageModelsDir}/sd_v15_mnn/unet.mnn`, 1_000_000);

      const result = await modelManager.refreshModelLists();

      expect(result.textModels.map(m => m.id).sort()).toEqual(['m1', 'recovered_found-Q4_K_M.gguf']);
      expect(result.imageModels.map(m => m.id)).toEqual(['recovered_sd_v15_mnn']);
    });

    it('answers empty lists for an empty phone', async () => {
      expect(await device.modelManager.refreshModelLists()).toEqual({ textModels: [], imageModels: [] });
    });
  });

  describe('reconcileFinishedImageDownloads (image downloads the app was killed during)', () => {
    const run = (active: string[] = []) => device.modelManager.reconcileFinishedImageDownloads(new Set(active));

    it('answers empty when the image folder does not exist', async () => {
      const { imageModelsDir, fs } = device;
      const existsOnDisk = fs.module.exists.getMockImplementation()!;
      fs.module.exists.mockImplementation(async path => (path === imageModelsDir ? false : existsOnDisk(path)));

      expect(await run()).toEqual([]);
    });

    it('registers a folder whose extraction finished (_ready) but was never registered', async () => {
      const { imageModelsDir, fs } = device;
      fs.seedTextFile(`${imageModelsDir}/sd_v15_mnn/_ready`, '');
      fs.seedFile(`${imageModelsDir}/sd_v15_mnn/unet.mnn`, 1_000_000_000);

      const result = await run();

      expect(result.map(m => [m.id, m.backend])).toEqual([['sd_v15_mnn', 'mnn']]);
      expect((await device.readImageRegistry()).map(m => m.id)).toEqual(['sd_v15_mnn']);
    });

    it('skips folders already registered and folders still downloading', async () => {
      const { modelManager, imageModelsDir, fs } = device;
      fs.seedTextFile(`${imageModelsDir}/sd_v15_mnn/_ready`, '');
      fs.seedFile(`${imageModelsDir}/sd_v15_mnn/unet.mnn`, 1000);
      await modelManager.addDownloadedImageModel(IMAGE_MODEL('sd_v15_mnn', `${imageModelsDir}/sd_v15_mnn`));
      fs.seedFile(`${imageModelsDir}/sd_v21_mnn/unet.mnn`, 1000);

      expect(await run(['sd_v21_mnn'])).toEqual([]);
      expect(await fs.exists(`${imageModelsDir}/sd_v21_mnn/unet.mnn`)).toBe(true);
    });

    it('re-extracts a valid zip left by a killed unzip, and registers the nested Core ML folder', async () => {
      const { imageModelsDir, fs } = device;
      const dir = `${imageModelsDir}/sd_v15_coreml`;
      fs.seedTextFile(`${dir}/_zip_name`, 'sd_v15_coreml.zip');
      fs.seedTextFile(`${imageModelsDir}/sd_v15_coreml.zip`, 'PK\u0003\u0004 zip bytes', 400_000_000);
      const { unzip } = require('react-native-zip-archive') as { unzip: jest.Mock };
      unzip.mockImplementation(async (_zip: string, destination: string) => {
        fs.seedFile(`${destination}/compiled/Unet.mlmodelc`, 500_000_000);
        fs.seedFile(`${destination}/compiled/TextEncoder.mlmodelc`, 100_000_000);
        return destination;
      });

      const result = await run();

      expect(result.map(m => [m.id, m.backend, m.modelPath])).toEqual([['sd_v15_coreml', 'coreml', `${dir}/compiled`]]);
      expect(await fs.exists(`${dir}/_ready`)).toBe(true);
      expect(await fs.exists(`${imageModelsDir}/sd_v15_coreml.zip`)).toBe(false);
    });

    it('deletes a partial folder whose zip is gone, and a stale folder with neither marker', async () => {
      const { imageModelsDir, fs } = device;
      fs.seedTextFile(`${imageModelsDir}/sd_v15_mnn/_zip_name`, 'sd_v15_mnn.zip');
      fs.seedFile(`${imageModelsDir}/sd_v15_mnn/unet.mnn`, 1000);
      fs.seedFile(`${imageModelsDir}/old_partial_dir/unet.mnn`, 1000);

      expect(await run()).toEqual([]);

      expect(await fs.exists(`${imageModelsDir}/sd_v15_mnn`)).toBe(false);
      expect(await fs.exists(`${imageModelsDir}/old_partial_dir`)).toBe(false);
      expect(await device.readImageRegistry()).toEqual([]);
    });

    it('resolves a ready Core ML folder to the folder that holds the compiled models', async () => {
      const { imageModelsDir, fs } = device;
      const dir = `${imageModelsDir}/sd_coreml_v1`;
      fs.seedTextFile(`${dir}/_ready`, '');
      fs.seedFile(`${dir}/split_einsum/Unet.mlmodelc`, 800_000_000);

      const result = await run();

      expect(result.map(m => [m.modelPath, m.backend, m.size])).toEqual([[`${dir}/split_einsum`, 'coreml', 800_000_000]]);
    });
  });
});
