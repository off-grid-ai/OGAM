/**
 * modelManager's model registry: what is installed, where it lives, what it costs on disk, and how it
 * is removed.
 *
 * Fakes: the disk (react-native-fs over memfs), async-storage and the native background downloader —
 * see harness/modelManagerDevice. Installed models arrive through a real download (the app's own
 * write path). Rows are written into storage directly only where the test is about data an earlier
 * app version or an earlier iOS container left behind, which no current write path produces.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';
import { createModelFile, createModelFileWithMmProj } from '../../../utils/factories';
import type { DownloadedModel, ModelFile } from '../../../../src/types';

describe('modelManager registry', () => {
  let device: ModelManagerDevice;

  beforeEach(async () => {
    device = await installModelManagerDevice();
  });

  /** Download a model the way the app does and wait until finalize registered it. */
  async function install(modelId: string, file: ModelFile, sizes: { main?: number; mmproj?: number } = {}): Promise<DownloadedModel> {
    const { modelManager } = device;
    const info = await modelManager.downloadModelBackground(modelId, file);
    let installed: DownloadedModel | undefined;
    modelManager.watchDownload(info.downloadId, model => { installed = model; });
    const sidecar = device.nativeRows().find(r => r.downloadId !== info.downloadId && r.status === 'running');
    if (sidecar) await device.finishDownload(sidecar.downloadId, sizes.mmproj ?? file.mmProjFile?.size);
    await device.finishDownload(info.downloadId, sizes.main ?? file.size);
    if (!installed) throw new Error(`${file.name} did not finalize`);
    return installed;
  }

  describe('initialize', () => {
    it('creates the model folders and excludes every model folder from iCloud backup', async () => {
      const { modelManager, modelsDir, imageModelsDir, fs } = device;
      expect(await fs.exists(modelsDir)).toBe(false);

      await modelManager.initialize();

      expect(await fs.exists(modelsDir)).toBe(true);
      expect(await fs.exists(imageModelsDir)).toBe(true);
      const excluded = device.boundary.download!.module.excludePathFromBackup.mock.calls.map(([p]) => p);
      expect(excluded.sort()).toEqual(
        [modelsDir, imageModelsDir, '/docs/video-models', '/docs/whisper-models'].sort(),
      );
    });

    it('keeps what is already in existing folders', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile(`${modelsDir}/kept.gguf`, 2_000_000);

      await modelManager.initialize();

      expect(fs.listFiles(modelsDir)).toEqual([`${modelsDir}/kept.gguf`]);
    });
  });

  describe('getDownloadedModels', () => {
    it('is empty before anything is installed', async () => {
      expect(await device.modelManager.getDownloadedModels()).toEqual([]);
    });

    it('lists an installed model', async () => {
      await install('test/model1', createModelFile({ name: 'm1-Q4_K_M.gguf', size: 100_000_000 }));

      const models = await device.modelManager.getDownloadedModels();

      expect(models.map(m => m.id)).toEqual(['test/model1/m1-Q4_K_M.gguf']);
    });

    it('drops a model whose file left the disk, and saves the pruned list', async () => {
      const { modelManager, modelsDir, fs } = device;
      await install('test/exists', createModelFile({ name: 'exists.gguf', size: 100_000_000 }));
      await install('test/gone', createModelFile({ name: 'gone.gguf', size: 100_000_000 }));
      expect((await device.readRegistry()).map(m => m.id)).toHaveLength(2);

      await fs.module.unlink(`${modelsDir}/gone.gguf`);
      const models = await modelManager.getDownloadedModels();

      expect(models.map(m => m.id)).toEqual(['test/exists/exists.gguf']);
      expect((await device.readRegistry()).map(m => m.id)).toEqual(['test/exists/exists.gguf']);
    });

    it('answers empty instead of crashing when the stored list is corrupt', async () => {
      await device.seedRegistry('invalid json{{{');

      expect(await device.modelManager.getDownloadedModels()).toEqual([]);
    });

    it('finds a model again after a reinstall moved the app container', async () => {
      const { modelManager, modelsDir, fs } = device;
      // The row an earlier install wrote, under that install's container path.
      fs.seedFile(`${modelsDir}/model.gguf`, 4_000_000_000);
      fs.seedFile(`${modelsDir}/mmproj.gguf`, 300_000_000);
      await device.seedRegistry([
        { id: 'model-ios', name: 'iOS Model', fileName: 'model.gguf', filePath: '/old-uuid/Documents/models/model.gguf', fileSize: 4_000_000_000 },
        { id: 'model-mm', name: 'Vision', fileName: 'vision.gguf', filePath: `${modelsDir}/model.gguf`, fileSize: 1, mmProjPath: '/old-uuid/Documents/models/mmproj.gguf' },
      ]);

      const models = await modelManager.getDownloadedModels();

      expect(models.map(m => [m.id, m.filePath, (m as any).mmProjPath])).toEqual([
        ['model-ios', `${modelsDir}/model.gguf`, undefined],
        ['model-mm', `${modelsDir}/model.gguf`, `${modelsDir}/mmproj.gguf`],
      ]);
      // The repaired paths are saved, so the next launch starts from them.
      expect((await device.readRegistry()).map(m => m.filePath)).toEqual([`${modelsDir}/model.gguf`, `${modelsDir}/model.gguf`]);
    });
    it('collapses rows an older version duplicated for one file, and keeps a row without a file name', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile(`${modelsDir}/a.gguf`, 1000);
      fs.seedFile(`${modelsDir}/b.gguf`, 1000);
      const row = (id: string, fileName: string | undefined, downloadedAt: string) => ({
        id, name: id, fileName, filePath: `${modelsDir}/${fileName ?? 'a.gguf'}`, fileSize: 1000, downloadedAt,
      });
      await device.seedRegistry([
        row('recovered_a.gguf', 'a.gguf', '2026-01-01'),
        row('test/a/a.gguf', 'a.gguf', '2026-01-03'),
        row('test/b-late/b.gguf', 'b.gguf', '2026-01-05'),
        row('test/b-early/b.gguf', 'b.gguf', '2026-01-02'),
        row('legacy-no-name', undefined, '2025-01-01'),
      ]);

      const models = await modelManager.getDownloadedModels();

      // A recovered row yields to the real one; between two real rows the earliest stays.
      expect(models.map(m => m.id)).toEqual(['test/a/a.gguf', 'test/b-early/b.gguf', 'legacy-no-name']);
      expect((await device.readRegistry()).map(m => m.id)).toEqual(['test/a/a.gguf', 'test/b-early/b.gguf', 'legacy-no-name']);
    });

    it('keeps a model when the disk cannot answer whether its file is there', async () => {
      const { modelManager, modelsDir, fs } = device;
      const installed = await install('test/model1', createModelFile({ name: 'm1.gguf', size: 1000 }));
      await device.seedRegistry([
        ...(await device.readRegistry()),
        { id: 'moved', name: 'moved', fileName: 'x.gguf', filePath: '/old-uuid/Documents/models/x.gguf', fileSize: 1000 },
      ]);
      const existsOnDisk = fs.module.exists.getMockImplementation()!;
      // A transient I/O error: the container is not mounted yet.
      fs.module.exists.mockImplementation(async path => {
        if (path === installed.filePath || path === `${modelsDir}/x.gguf`) throw new Error('EIO');
        return existsOnDisk(path);
      });

      const models = await modelManager.getDownloadedModels();

      expect(models.map(m => m.id)).toEqual([installed.id, 'moved']);
      expect((await device.readRegistry()).map(m => m.id)).toEqual([installed.id, 'moved']);
    });
  });

  describe('deleteModel', () => {
    it('deletes the model file and removes it from the registry', async () => {
      const { modelManager, modelsDir, fs } = device;
      await install('test/model1', createModelFile({ name: 'm1.gguf', size: 100_000_000 }));
      expect(await fs.exists(`${modelsDir}/m1.gguf`)).toBe(true);

      await modelManager.deleteModel('test/model1/m1.gguf');

      expect(await fs.exists(`${modelsDir}/m1.gguf`)).toBe(false);
      expect(await device.readRegistry()).toEqual([]);
    });

    it('deletes the vision projector with the model', async () => {
      const { modelManager, modelsDir, fs } = device;
      const model = await install('test/vision', createModelFileWithMmProj({ name: 'vision-Q4_K_M.gguf', size: 100_000_000, mmProjName: 'mmproj-f16.gguf', mmProjSize: 10_000_000 }));
      const mmProjPath = (model as any).mmProjPath as string;
      expect(await fs.exists(mmProjPath)).toBe(true);

      await modelManager.deleteModel(model.id);

      expect(fs.listFiles(modelsDir)).toEqual([]);
    });

    it('still removes the model when the projector cannot be deleted', async () => {
      const { modelManager, modelsDir, fs } = device;
      const model = await install('test/vision', createModelFileWithMmProj({ name: 'vision-Q4_K_M.gguf', size: 100_000_000, mmProjName: 'mmproj-f16.gguf', mmProjSize: 10_000_000 }));
      const mmProjPath = (model as any).mmProjPath as string;
      const unlinkOnDisk = fs.module.unlink.getMockImplementation()!;
      fs.module.unlink.mockImplementation(async path => {
        if (path === mmProjPath) throw new Error('Permission denied');
        return unlinkOnDisk(path);
      });

      await modelManager.deleteModel(model.id);

      expect(await fs.exists(`${modelsDir}/vision-Q4_K_M.gguf`)).toBe(false);
      expect(await device.readRegistry()).toEqual([]);
    });

    it('deletes an iOS model stored with the /private/var spelling of the container', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile(`${modelsDir}/qwen.gguf`, 4_000_000);
      // iOS reports the same container as /private/var/... and /var/...; the file is reachable at both.
      const privatePath = '/private/var/mobile/Containers/Data/Application/OLD/Documents/models/qwen.gguf';
      fs.seedFile(privatePath, 4_000_000);
      await device.seedRegistry([{ id: 'model-ios-private', name: 'iOS Model', fileName: 'qwen.gguf', filePath: privatePath, fileSize: 100 }]);

      await modelManager.deleteModel('model-ios-private');

      expect(await fs.exists(`${modelsDir}/qwen.gguf`)).toBe(false);
      expect(await device.readRegistry()).toEqual([]);
    });

    it('keeps the registry when the disk refuses to delete the model bytes', async () => {
      const { modelManager, modelsDir, fs } = device;
      await install('test/stays', createModelFile({ name: 'stays.gguf', size: 100_000_000 }));
      fs.module.unlink.mockRejectedValueOnce(new Error('disk refused deletion'));

      await expect(modelManager.deleteModel('test/stays/stays.gguf')).rejects.toThrow('disk refused deletion');

      expect(await fs.exists(`${modelsDir}/stays.gguf`)).toBe(true);
      expect((await device.readRegistry()).map(m => m.id)).toEqual(['test/stays/stays.gguf']);
    });

    it('keeps the visible model when the download provider cannot delete it', async () => {
      const model = await install('test/visible', createModelFile({ name: 'visible.gguf', size: 100_000_000 }));
      const { useAppStore } = require('../../../../src/stores');
      const { textProvider } = require('../../../../src/services/modelDownloadService/providers/textProvider');
      useAppStore.getState().setDownloadedModels(await device.modelManager.getDownloadedModels());
      device.fs.module.unlink.mockRejectedValueOnce(new Error('disk refused deletion'));

      await expect(textProvider.remove(`text:${model.id}`)).rejects.toThrow('disk refused deletion');

      expect(useAppStore.getState().downloadedModels.map((m: DownloadedModel) => m.id)).toEqual([model.id]);
    });

    it('throws when the model is not installed', async () => {
      await expect(device.modelManager.deleteModel('nonexistent')).rejects.toThrow('Model not found');
    });
  });

  describe('paths and space', () => {
    it('getModelPath answers the installed file, or null', async () => {
      await install('test/model1', createModelFile({ name: 'm1.gguf', size: 100_000_000 }));

      expect(await device.modelManager.getModelPath('test/model1/m1.gguf')).toBe(`${device.modelsDir}/m1.gguf`);
      expect(await device.modelManager.getModelPath('nonexistent')).toBeNull();
    });

    it('getStorageUsed sums every model and its projector', async () => {
      expect(await device.modelManager.getStorageUsed()).toBe(0);
      await install('test/vision', createModelFileWithMmProj({ name: 'm1-Q4_K_M.gguf', size: 1000, mmProjName: 'mmproj-f16.gguf', mmProjSize: 200 }));
      await install('test/text', createModelFile({ name: 'm2.gguf', size: 2000 }));

      expect(await device.modelManager.getStorageUsed()).toBe(3200);
    });

    it('getAvailableStorage answers the free space the disk reports', async () => {
      device.fs.setFreeBytes(50 * 1024 * 1024 * 1024);

      expect(await device.modelManager.getAvailableStorage()).toBe(50 * 1024 * 1024 * 1024);
    });
  });

  describe('credibility of the author', () => {
    it.each([
      ['lmstudio-community', { source: 'lmstudio', isVerifiedQuantizer: true }],
      ['meta-llama', { source: 'official', isOfficial: true }],
      ['TheBloke', { source: 'verified-quantizer', isVerifiedQuantizer: true }],
      ['random-user', { source: 'community', isOfficial: false, isVerifiedQuantizer: false }],
    ])('a model from %s is recorded with that credibility', async (author, expected) => {
      const model = await install(`${author}/model`, createModelFile({ name: 'model.gguf', size: 1000 }));

      expect(model.credibility).toEqual(expect.objectContaining(expected));
    });
  });

  describe('saveModelWithMmproj', () => {
    it('links a projector on disk to the model, with its size, and publishes the change', async () => {
      const { modelManager, modelsDir, fs } = device;
      const model = await install('test/model1', createModelFile({ name: 'm1.gguf', size: 1000 }));
      fs.seedFile(`${modelsDir}/mmproj.gguf`, 300_000_000);

      await modelManager.saveModelWithMmproj(model.id, `${modelsDir}/mmproj.gguf`);

      const expected = expect.objectContaining({
        mmProjPath: `${modelsDir}/mmproj.gguf`, mmProjFileName: 'mmproj.gguf', mmProjFileSize: 300_000_000, isVisionModel: true,
      });
      expect(await device.readRegistry()).toEqual([expected]);
      const { useAppStore } = require('../../../../src/stores');
      expect(useAppStore.getState().downloadedModels).toEqual([expected]);
    });
  });

  describe('cleanupMMProjEntries (rows an older version registered for projector files)', () => {
    it('removes projector rows, counts them, and links a belonging projector to its vision model', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile(`${modelsDir}/Qwen3VL-2B-Instruct-Q4_K_M.gguf`, 2_000_000_000);
      fs.seedFile(`${modelsDir}/Qwen3VL-2B-Instruct-mmproj-f16.gguf`, 300_000_000);
      fs.seedFile(`${modelsDir}/proj-mmproj.gguf`, 100);
      fs.seedFile(`${modelsDir}/clip-model.gguf`, 100);
      await device.seedRegistry([
        { id: 'vision1', name: 'Qwen3VL-2B-Instruct', fileName: 'Qwen3VL-2B-Instruct-Q4_K_M.gguf', filePath: `${modelsDir}/Qwen3VL-2B-Instruct-Q4_K_M.gguf`, fileSize: 2_000_000_000, isVisionModel: false },
        { id: 'p1', name: 'Proj1', fileName: 'proj-mmproj.gguf', filePath: `${modelsDir}/proj-mmproj.gguf`, fileSize: 100 },
        { id: 'p2', name: 'Proj2', fileName: 'clip-model.gguf', filePath: `${modelsDir}/clip-model.gguf`, fileSize: 100 },
      ]);

      const removed = await modelManager.cleanupMMProjEntries();

      expect(removed).toBe(2);
      expect(await device.readRegistry()).toEqual([
        expect.objectContaining({
          id: 'vision1',
          isVisionModel: true,
          mmProjFileName: 'Qwen3VL-2B-Instruct-mmproj-f16.gguf',
          mmProjPath: `${modelsDir}/Qwen3VL-2B-Instruct-mmproj-f16.gguf`,
          mmProjFileSize: 300_000_000,
        }),
      ]);
    });

    it('answers 0 for an empty registry', async () => {
      expect(await device.modelManager.cleanupMMProjEntries()).toBe(0);
    });
  });

  describe('buildDownloadedModel', () => {
    const build = (opts: Parameters<typeof import('../../../../src/services/modelManager/storage').buildDownloadedModel>[0]) =>
      (require('../../../../src/services/modelManager/storage') as typeof import('../../../../src/services/modelManager/storage')).buildDownloadedModel(opts);

    it('records the projector name and path when the projector is on disk', async () => {
      const file = createModelFileWithMmProj();
      device.fs.seedFile('/docs/models/llama-3.2-11b.gguf', 4_000_000_000);
      device.fs.seedFile('/docs/models/model-mmproj.gguf', 500_000_000);

      const model = await build({ modelId: 'meta/llama-3.2-11b', file, resolvedLocalPath: '/docs/models/llama-3.2-11b.gguf', mmProjPath: '/docs/models/model-mmproj.gguf' });

      expect(model).toEqual(expect.objectContaining({
        engine: 'llama', mmProjFileName: file.mmProjFile?.name, mmProjPath: '/docs/models/model-mmproj.gguf', isVisionModel: true, fileSize: 4_000_000_000, mmProjFileSize: 500_000_000,
      }));
    });

    it('keeps the expected projector name when the projector download failed, so repair can find the gap', async () => {
      const file = createModelFileWithMmProj();

      const model = await build({ modelId: 'meta/llama-3.2-11b', file, resolvedLocalPath: '/docs/models/llama-3.2-11b.gguf', expectedMmProjFileName: file.mmProjFile?.name });

      expect(model).toEqual(expect.objectContaining({ engine: 'llama', mmProjFileName: file.mmProjFile?.name, mmProjPath: undefined, isVisionModel: false }));
    });

    it('records no projector for a text-only model', async () => {
      const model = await build({ modelId: 'meta/llama-3.2-1b', file: createModelFile(), resolvedLocalPath: '/docs/models/llama-3.2-1b.gguf' });

      expect(model).toEqual(expect.objectContaining({ engine: 'llama', mmProjFileName: undefined, mmProjPath: undefined, isVisionModel: false }));
    });
  });

  describe('path helpers', () => {
    const { resolveStoredPath } = require('../../../../src/services/modelManager/storage') as typeof import('../../../../src/services/modelManager/storage');
    const { isMMProjFile } = require('../../../../src/services/modelManager/scan') as typeof import('../../../../src/services/modelManager/scan');

    it('rebases a stored path onto the current container, or answers null', () => {
      expect(resolveStoredPath('/old-uuid/Documents/models/mymodel.gguf', '/new-uuid/Documents/models')).toBe('/new-uuid/Documents/models/mymodel.gguf');
      expect(resolveStoredPath('/old-uuid/Documents/image_models/sd-turbo/model.onnx', '/new-uuid/Documents/image_models')).toBe('/new-uuid/Documents/image_models/sd-turbo/model.onnx');
      expect(resolveStoredPath('/completely/different/path/model.gguf', '/new-uuid/Documents/models')).toBeNull();
      expect(resolveStoredPath('/old-uuid/Documents/models/', '/new-uuid/Documents/models')).toBeNull();
    });

    it('tells projector files from model files, ignoring case', () => {
      for (const name of ['model-mmproj-f16.gguf', 'Qwen3VL-2B-mmproj-Q4_0.gguf', 'model-projector-f16.gguf', 'clip-vit-large.gguf', 'Model-MMPROJ-F16.GGUF', 'CLIP-model.gguf']) {
        expect([name, isMMProjFile(name)]).toEqual([name, true]);
      }
      for (const name of ['llama-3.2-3B-Q4_K_M.gguf', 'Qwen3-8B-Instruct-Q4_K_M.gguf', 'phi-3-mini.gguf']) {
        expect([name, isMMProjFile(name)]).toEqual([name, false]);
      }
    });
  });
});
