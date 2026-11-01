/**
 * Importing a model file the user picked (Files on iOS, the document picker's content:// URI on
 * Android) into the library.
 *
 * Fakes: the disk (react-native-fs over memfs), the Android content provider behind content:// URIs,
 * async-storage and the clock — see harness/modelManagerDevice. modelManager, the copy-with-progress
 * loop and the registry run for real; the copy really lands bytes in the models folder.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';

describe('modelManager.importLocalModel', () => {
  let device: ModelManagerDevice;

  describe('on iOS', () => {
    beforeEach(async () => {
      device = await installModelManagerDevice({ platform: 'ios' });
    });

    it('copies the picked file into the models folder and registers it as a local import', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile('/picked/My Model.gguf', 2_000_000_000);
      const progress: Array<{ fraction: number; fileName: string }> = [];

      const result = await modelManager.importLocalModel({
        sourceUri: '/picked/My%20Model.gguf',
        fileName: 'MyModel-Q4_K_M.gguf',
        onProgress: p => progress.push(p),
      });

      expect(result).toEqual(expect.objectContaining({
        id: 'local_import/MyModel-Q4_K_M.gguf', author: 'Local Import', quantization: 'Q4_K_M',
        fileName: 'MyModel-Q4_K_M.gguf', fileSize: 2_000_000_000, engine: 'llama', name: 'MyModel',
      }));
      expect((result as any).liteRTVision).toBeUndefined();
      expect(await fs.exists(`${modelsDir}/MyModel-Q4_K_M.gguf`)).toBe(true);
      expect((await device.readRegistry()).map(m => m.id)).toEqual(['local_import/MyModel-Q4_K_M.gguf']);
      expect(progress.at(-1)).toEqual({ fraction: 1, fileName: 'MyModel-Q4_K_M.gguf' });
    });

    it.each([
      ['llama-3.2-3B-Q8_0.gguf', 'Q8_0'],
      ['custom-model.gguf', 'Unknown'],
    ])('reads the quantization of %s as %s', async (fileName, quantization) => {
      device.fs.seedFile('/picked/source.gguf', 1_000_000_000);

      const result = await device.modelManager.importLocalModel({ sourceUri: '/picked/source.gguf', fileName });

      expect(result.quantization).toBe(quantization);
    });

    it('refuses a file that is not a model, and an MTP head that cannot run alone, without copying', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile('/picked/model.bin', 1000);
      fs.seedFile('/picked/head.gguf', 1000);

      await expect(modelManager.importLocalModel({ sourceUri: '/picked/model.bin', fileName: 'model.bin' }))
        .rejects.toThrow('Only .gguf and .litertlm files can be imported');
      await expect(modelManager.importLocalModel({ sourceUri: '/picked/head.gguf', fileName: 'Qwen3.5-9B-MTP-ONLY-Q4_K_M.gguf' }))
        .rejects.toThrow('This file only speeds up another model. It cannot run on its own.');

      expect(fs.listFiles(modelsDir)).toEqual([]);
      expect(await device.readRegistry()).toEqual([]);
    });

    it('refuses to overwrite a model file that is already in the library', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile('/picked/source.gguf', 1000);
      fs.seedFile(`${modelsDir}/existing.gguf`, 4_000_000);

      await expect(modelManager.importLocalModel({ sourceUri: '/picked/source.gguf', fileName: 'existing.gguf' }))
        .rejects.toThrow('already exists');
      expect((await fs.module.stat(`${modelsDir}/existing.gguf`)).size).toBe(4_000_000);
    });

    it('removes the partial copy and registers nothing when the copy fails', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile('/picked/source.gguf', 1_000_000_000);
      device.failNextCopy('Copy failed');

      await expect(modelManager.importLocalModel({ sourceUri: '/picked/source.gguf', fileName: 'fail.gguf' }))
        .rejects.toThrow('Copy failed');

      expect(await fs.exists(`${modelsDir}/fail.gguf`)).toBe(false);
      expect(await device.readRegistry()).toEqual([]);
    });

    it('reports the bytes copied so far while a long copy runs', async () => {
      jest.useFakeTimers();
      try {
        const { modelManager, fs } = device;
        fs.seedFile('/picked/model-Q4_K_M.gguf', 2_000_000_000);
        const copy = device.holdNextCopy();
        const progress: number[] = [];

        const importing = modelManager.importLocalModel({
          sourceUri: '/picked/model-Q4_K_M.gguf',
          fileName: 'model-Q4_K_M.gguf',
          onProgress: p => progress.push(p.fraction),
        });
        await jest.advanceTimersByTimeAsync(600);

        // Half the bytes are on disk and the copy is still running.
        expect(progress).toEqual([0.5]);

        copy.release();
        await jest.advanceTimersByTimeAsync(0);
        await importing;
        expect(progress).toEqual([0.5, 1]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('replaces an earlier row with the same id instead of adding a second one', async () => {
      const { modelManager, modelsDir, fs } = device;
      // A row an earlier version wrote for the same import, its file kept outside the models folder.
      fs.seedFile('/old/model.gguf', 3_000_000_000);
      await device.seedRegistry([{ id: 'local_import/model.gguf', name: 'Old', author: 'Local Import', filePath: '/old/model.gguf', fileName: 'model.gguf', fileSize: 3_000_000_000, quantization: 'Q4', downloadedAt: '' }]);
      fs.seedFile('/external/model.gguf', 4_000_000_000);

      await modelManager.importLocalModel({ sourceUri: '/external/model.gguf', fileName: 'model.gguf' });

      expect((await device.readRegistry()).map(m => [m.id, m.filePath, m.fileSize])).toEqual([
        ['local_import/model.gguf', `${modelsDir}/model.gguf`, 4_000_000_000],
      ]);
    });

    it('imports a vision model with its projector, linked, and progress across both copies', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile('/picked/vision-Q4_K_M.gguf', 2_000_000_000);
      fs.seedFile('/picked/mmproj.gguf', 300_000_000);
      const progress: Array<{ fraction: number; fileName: string }> = [];

      const result = await modelManager.importLocalModel({
        sourceUri: '/picked/vision-Q4_K_M.gguf', fileName: 'vision-Q4_K_M.gguf', sourceSize: 2_000_000_000,
        mmProjSourceUri: '/picked/mmproj.gguf', mmProjFileName: 'vision-mmproj-f16.gguf', mmProjSourceSize: 300_000_000,
        onProgress: p => progress.push(p),
      });

      expect(result).toEqual(expect.objectContaining({
        isVisionModel: true, mmProjPath: `${modelsDir}/vision-mmproj-f16.gguf`, mmProjFileName: 'vision-mmproj-f16.gguf', mmProjFileSize: 300_000_000,
      }));
      expect(fs.listFiles(modelsDir).sort()).toEqual([`${modelsDir}/vision-Q4_K_M.gguf`, `${modelsDir}/vision-mmproj-f16.gguf`]);
      expect(progress).toEqual([
        { fraction: 0.5, fileName: 'vision-Q4_K_M.gguf' },
        { fraction: 1, fileName: 'vision-mmproj-f16.gguf' },
      ]);
    });

    it('refuses to overwrite a projector file already in the library', async () => {
      const { modelManager, modelsDir, fs } = device;
      fs.seedFile('/picked/vision.gguf', 1000);
      fs.seedFile(`${modelsDir}/vision-mmproj.gguf`, 1000);

      await expect(modelManager.importLocalModel({
        sourceUri: '/picked/vision.gguf', fileName: 'vision.gguf', mmProjSourceUri: '/picked/mmproj.gguf', mmProjFileName: 'vision-mmproj.gguf',
      })).rejects.toThrow('A file named "vision-mmproj.gguf" already exists');
      expect(await fs.exists(`${modelsDir}/vision.gguf`)).toBe(false);
    });

    it.each([
      [false, 'gemma-4-E2B-it.litertlm'],
      [true, 'gemma-vision.litertlm'],
    ])('imports a .litertlm file as a LiteRT model (vision %s)', async (liteRTVision, fileName) => {
      device.fs.seedFile('/picked/gemma.litertlm', 500_000_000);

      const result = await device.modelManager.importLocalModel({ sourceUri: '/picked/gemma.litertlm', fileName, engine: 'litert', liteRTVision });

      expect(result).toEqual(expect.objectContaining({ id: `local_import/${fileName}`, engine: 'litert', liteRTVision }));
      expect(await device.readRegistry()).toEqual([expect.objectContaining({ engine: 'litert', liteRTVision })]);
    });
  });

  describe('on Android', () => {
    beforeEach(async () => {
      device = await installModelManagerDevice({ platform: 'android' });
    });

    it('copies a content:// document straight into the models folder', async () => {
      const { modelManager, modelsDir, fs } = device;
      const uri = 'content://com.android.provider/document/model.gguf';
      device.seedContentDocument(uri, 2_000_000_000);

      const result = await modelManager.importLocalModel({ sourceUri: uri, fileName: 'model-Q4_K_M.gguf' });

      expect(result.id).toBe('local_import/model-Q4_K_M.gguf');
      expect((await fs.module.stat(`${modelsDir}/model-Q4_K_M.gguf`)).size).toBe(2_000_000_000);
      // No temp copy is left in the cache.
      expect(fs.listFiles(fs.module.CachesDirectoryPath)).toEqual([]);
    });
  });
});
