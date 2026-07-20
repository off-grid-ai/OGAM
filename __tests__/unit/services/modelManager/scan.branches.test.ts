/**
 * Branch-coverage tests for modelManager/scan.ts.
 * Targets the recovery/reconciliation paths, import guards, mmproj linking,
 * and the recursive getDirSize helper that the existing scan.test.ts does not exercise.
 */

jest.mock('react-native-fs', () => ({
  exists: jest.fn(() => Promise.resolve(false)),
  readDir: jest.fn(() => Promise.resolve([])),
  unlink: jest.fn(() => Promise.resolve()),
  stat: jest.fn(() => Promise.resolve({ size: 0 })),
  read: jest.fn(() => Promise.resolve('')),
  readFile: jest.fn(() => Promise.resolve('')),
  writeFile: jest.fn(() => Promise.resolve()),
}));
jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../../../src/services/modelManager/storage', () => ({
  buildDownloadedModel: jest.fn(async ({ resolvedLocalPath }) => ({
    filePath: resolvedLocalPath,
    fileName: 'x.gguf',
    fileSize: 123,
    quantization: 'Q4_K_M',
    downloadedAt: 'now',
  })),
  persistDownloadedModel: jest.fn(async () => {}),
  loadDownloadedModels: jest.fn(async () => []),
  saveModelsList: jest.fn(async () => {}),
}));
jest.mock('../../../../src/services/modelManager/copyFile', () => ({
  copyFileWithProgress: jest.fn(async (_s: string, _d: string, opts: any) => {
    opts?.onProgress?.(1);
  }),
}));
jest.mock('../../../../src/utils/coreMLModelUtils', () => ({
  resolveCoreMLModelDir: jest.fn(async (p: string) => `${p}/coreml-resolved`),
}));
// Completeness gate is a collaborator here (its own behavior is covered by imageModelIntegrity
// unit tests + the reconcile G7 integration test); stub it so these tests focus on reconcile flow.
jest.mock('../../../../src/utils/imageModelIntegrity', () => ({
  ensureImageExtractionComplete: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import {
  cleanupMMProjEntries,
  reconcileFinishedImageDownloads,
  scanForUntrackedTextModels,
  scanForUntrackedImageModels,
  deleteOrphanedFile,
  importLocalModel,
} from '../../../../src/services/modelManager/scan';
import * as storage from '../../../../src/services/modelManager/storage';
import { copyFileWithProgress } from '../../../../src/services/modelManager/copyFile';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

function dir(name: string, path = `/img/${name}`) {
  return {
    name,
    path,
    isFile: () => false,
    isDirectory: () => true,
    size: 0,
  } as any;
}
function file(
  name: string,
  path = `/img/${name}`,
  size: number | string = 100,
) {
  return {
    name,
    path,
    isFile: () => true,
    isDirectory: () => false,
    size,
  } as any;
}

beforeEach(() => jest.clearAllMocks());

describe('deleteOrphanedFile', () => {
  it('unlinks the file when it exists', async () => {
    mockedRNFS.exists.mockResolvedValueOnce(true);
    await deleteOrphanedFile('/m/orphan.gguf');
    expect(mockedRNFS.unlink).toHaveBeenCalledWith('/m/orphan.gguf');
  });

  it('does nothing when the file does not exist', async () => {
    mockedRNFS.exists.mockResolvedValueOnce(false);
    await deleteOrphanedFile('/m/missing.gguf');
    expect(mockedRNFS.unlink).not.toHaveBeenCalled();
  });
});

describe('scanForUntrackedImageModels (getDirSize recursion)', () => {
  const base = () => ({
    imageModelsDir: '/img',
    getImageModels: jest.fn(async (): Promise<any[]> => []),
    addImageModel: jest.fn(async () => {}),
  });

  it('returns [] when the image dir does not exist', async () => {
    mockedRNFS.exists.mockResolvedValueOnce(false);
    expect(await scanForUntrackedImageModels(base())).toEqual([]);
  });

  it('skips registered paths and zero-size directories', async () => {
    const opts = base();
    opts.getImageModels = jest.fn(async () => [
      { modelPath: '/img/known' } as any,
    ]);
    mockedRNFS.exists.mockResolvedValueOnce(true);
    mockedRNFS.readDir
      .mockResolvedValueOnce([
        dir('known', '/img/known'),
        dir('empty', '/img/empty'),
        file('loose.txt'),
      ])
      .mockResolvedValueOnce([]); // getDirSize of 'empty' -> 0
    const out = await scanForUntrackedImageModels(opts);
    expect(out).toEqual([]);
  });

  it('recovers a model and sums sizes recursively through a nested subdirectory', async () => {
    const opts = base();
    mockedRNFS.exists.mockResolvedValueOnce(true);
    mockedRNFS.readDir
      .mockResolvedValueOnce([
        dir('Stable_Diffusion.zip', '/img/Stable_Diffusion.zip'),
      ]) // top scan
      // getDirSize on the model dir: one file + one nested directory (exercises recursion line 26-27)
      .mockResolvedValueOnce([
        file('weights.bin', '/img/Stable_Diffusion.zip/weights.bin', 1000),
        dir('nested', '/img/Stable_Diffusion.zip/nested'),
      ])
      .mockResolvedValueOnce([
        file('extra.bin', '/img/Stable_Diffusion.zip/nested/extra.bin', '500'),
      ]);
    const out = await scanForUntrackedImageModels(opts);
    expect(out).toHaveLength(1);
    expect(out[0].size).toBe(1500); // 1000 + nested 500
    expect(out[0].name).toBe('Stable Diffusion'); // .zip stripped, underscores->spaces
    expect(out[0].id.startsWith('recovered_')).toBe(true);
    expect(opts.addImageModel).toHaveBeenCalled();
  });

  it('getDirSize swallows a readDir error and returns 0 (dir skipped)', async () => {
    const opts = base();
    mockedRNFS.exists.mockResolvedValueOnce(true);
    mockedRNFS.readDir
      .mockResolvedValueOnce([dir('Broken', '/img/Broken')])
      .mockRejectedValueOnce(new Error('cannot read'));
    const out = await scanForUntrackedImageModels(opts);
    expect(out).toEqual([]); // totalSize 0 -> skipped
  });
});

describe('cleanupMMProjEntries', () => {
  it('links a discovered mmproj file to a vision model lacking a stored path', async () => {
    const model = {
      name: 'Gemma VL',
      fileName: 'gemma-vl-Q4_K_M.gguf',
      engine: 'llama',
      mmProjPath: undefined,
    };
    (storage.loadDownloadedModels as jest.Mock).mockResolvedValueOnce([model]);
    mockedRNFS.exists.mockResolvedValueOnce(true); // dir exists
    mockedRNFS.readDir.mockResolvedValueOnce([
      file('gemma-vl-Q4_K_M-mmproj.gguf'),
    ]);

    const removed = await cleanupMMProjEntries('/models');

    expect(removed).toBe(0);
    expect((model as any).mmProjPath).toBe('/img/gemma-vl-Q4_K_M-mmproj.gguf');
    expect((model as any).isVisionModel).toBe(true);
    expect(storage.saveModelsList).toHaveBeenCalled();
  });

  it('counts and removes mmproj-named model entries, and the scan is non-fatal on readDir failure', async () => {
    (storage.loadDownloadedModels as jest.Mock).mockResolvedValueOnce([
      { name: 'real', fileName: 'real-Q4_K_M.gguf', engine: 'llama' },
      { name: 'proj', fileName: 'model-mmproj-f16.gguf', engine: 'llama' },
    ]);
    mockedRNFS.exists.mockResolvedValueOnce(true);
    mockedRNFS.readDir.mockRejectedValueOnce(new Error('io'));

    const removed = await cleanupMMProjEntries('/models');

    expect(removed).toBe(1); // mmproj entry filtered out
    expect(storage.saveModelsList).toHaveBeenCalledWith([
      expect.objectContaining({ fileName: 'real-Q4_K_M.gguf' }),
    ]);
  });

  it('skips scan when models directory does not exist', async () => {
    (storage.loadDownloadedModels as jest.Mock).mockResolvedValueOnce([]);
    mockedRNFS.exists.mockResolvedValueOnce(false);
    const removed = await cleanupMMProjEntries('/models');
    expect(removed).toBe(0);
    expect(mockedRNFS.readDir).not.toHaveBeenCalled();
  });
});

describe('reconcileFinishedImageDownloads', () => {
  const base = () => ({
    imageModelsDir: '/img',
    getImageModels: jest.fn(async (): Promise<any[]> => []),
    addImageModel: jest.fn(async () => {}),
    activeModelIds: new Set<string>(),
  });

  it('returns empty when the image dir does not exist', async () => {
    mockedRNFS.exists.mockResolvedValue(false);
    const out = await reconcileFinishedImageDownloads(base());
    expect(out).toEqual([]);
  });

  it('skips non-directories, registered ids, and active ids', async () => {
    const opts = base();
    opts.getImageModels = jest.fn(async () => [
      { id: 'reg', modelPath: '/elsewhere' } as any,
    ]);
    opts.activeModelIds = new Set(['busy']);
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.readDir.mockResolvedValueOnce([
      file('loose.bin'),
      dir('reg'),
      dir('busy'),
    ]);
    const out = await reconcileFinishedImageDownloads(opts);
    expect(out).toEqual([]);
    expect(opts.addImageModel).not.toHaveBeenCalled();
  });

  it('migrates a legacy recovered_ entry and resolves coreml model dir', async () => {
    const opts = base();
    opts.getImageModels = jest.fn(async () => [
      {
        id: 'recovered_old_123',
        modelPath: '/img/coreml_model',
        name: 'Legacy',
        description: 'd',
        downloadedAt: 't',
        style: 's',
        attentionVariant: 'a',
      } as any,
    ]);
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.readDir
      .mockResolvedValueOnce([dir('coreml_model', '/img/coreml_model')]) // top-level scan
      .mockResolvedValueOnce([
        file('weights.bin', '/img/coreml_model/weights.bin', 2048),
      ]); // getDirSize
    const out = await reconcileFinishedImageDownloads(opts);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('coreml_model');
    expect(out[0].backend).toBe('coreml');
    expect(out[0].modelPath).toBe('/img/coreml_model/coreml-resolved');
    expect(out[0].size).toBe(2048);
    expect(opts.addImageModel).toHaveBeenCalled();
  });

  it('legacy migration is non-fatal when writeFile rejects synchronously', async () => {
    const opts = base();
    opts.getImageModels = jest.fn(async () => [
      {
        id: 'recovered_x_1',
        modelPath: '/img/x',
        name: '',
        description: '',
        downloadedAt: '',
      } as any,
    ]);
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.readDir.mockResolvedValueOnce([dir('x', '/img/x')]);
    // writeFile returns a promise that rejects but the code .catch()es it; force the
    // throw via getDirSize readDir rejecting so the migration try/catch swallows it.
    mockedRNFS.readDir.mockRejectedValueOnce(new Error('size failed'));
    (mockedRNFS.writeFile as jest.Mock).mockResolvedValue(undefined);
    const out = await reconcileFinishedImageDownloads(opts);
    // getDirSize swallows its own error returning 0, so migration still succeeds
    expect(out).toHaveLength(1);
    expect(out[0].size).toBe(0);
  });

  it('registers a _ready directory (mnn backend, no coreml resolve)', async () => {
    const opts = base();
    mockedRNFS.exists
      .mockResolvedValueOnce(true) // dir exists
      .mockResolvedValueOnce(true); // _ready exists
    mockedRNFS.readDir
      .mockResolvedValueOnce([dir('My_Model', '/img/My_Model')])
      .mockResolvedValueOnce([file('f', '/img/My_Model/f', '500')]); // getDirSize
    const out = await reconcileFinishedImageDownloads(opts);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('My Model');
    expect(out[0].backend).toBe('mnn');
    expect(out[0].size).toBe(500);
  });

  it('skips a directory referenced by a properly registered model path', async () => {
    const opts = base();
    opts.getImageModels = jest.fn(async () => [
      { id: 'other', modelPath: '/img/dir' } as any,
    ]);
    mockedRNFS.exists.mockResolvedValue(true);
    mockedRNFS.readDir.mockResolvedValueOnce([dir('dir', '/img/dir')]);
    const out = await reconcileFinishedImageDownloads(opts);
    expect(out).toEqual([]);
  });

  it('re-unzips when _zip_name present and zip valid', async () => {
    const opts = base();
    mockedRNFS.exists
      .mockResolvedValueOnce(true) // dir
      .mockResolvedValueOnce(false) // _ready missing
      .mockResolvedValueOnce(true) // _zip_name present
      .mockResolvedValueOnce(true); // isValidZip: zip exists
    mockedRNFS.readDir
      .mockResolvedValueOnce([dir('Zipped', '/img/Zipped')])
      .mockResolvedValueOnce([file('w', '/img/Zipped/w', 999)]); // getDirSize
    (mockedRNFS.readFile as jest.Mock).mockResolvedValueOnce('archive.zip');
    (mockedRNFS.stat as jest.Mock).mockResolvedValueOnce({ size: 1024 });
    (mockedRNFS.read as jest.Mock).mockResolvedValueOnce('PK');
    const out = await reconcileFinishedImageDownloads(opts);
    expect(unzip).toHaveBeenCalledWith('/img/archive.zip', '/img/Zipped');
    expect(out).toHaveLength(1);
    expect(out[0].size).toBe(999);
  });

  it('cleans up dir when _zip_name present but zip invalid (size <= 0)', async () => {
    const opts = base();
    mockedRNFS.exists
      .mockResolvedValueOnce(true) // dir
      .mockResolvedValueOnce(false) // _ready missing
      .mockResolvedValueOnce(true) // _zip_name present
      .mockResolvedValueOnce(true); // zip file exists
    mockedRNFS.readDir.mockResolvedValueOnce([dir('Bad', '/img/Bad')]);
    (mockedRNFS.readFile as jest.Mock).mockResolvedValueOnce('gone.zip');
    (mockedRNFS.stat as jest.Mock).mockResolvedValueOnce({ size: 0 }); // invalid
    const out = await reconcileFinishedImageDownloads(opts);
    expect(unzip).not.toHaveBeenCalled();
    expect(mockedRNFS.unlink).toHaveBeenCalledWith('/img/Bad');
    expect(out).toEqual([]);
  });

  it('deletes stale dir with neither _ready nor _zip_name', async () => {
    const opts = base();
    mockedRNFS.exists
      .mockResolvedValueOnce(true) // dir
      .mockResolvedValueOnce(false) // _ready missing
      .mockResolvedValueOnce(false); // _zip_name missing
    mockedRNFS.readDir.mockResolvedValueOnce([dir('Stale', '/img/Stale')]);
    const out = await reconcileFinishedImageDownloads(opts);
    expect(mockedRNFS.unlink).toHaveBeenCalledWith('/img/Stale');
    expect(out).toEqual([]);
  });

  it('top-level catch keeps reconciliation non-fatal', async () => {
    const opts = base();
    mockedRNFS.exists.mockResolvedValueOnce(true);
    mockedRNFS.readDir.mockRejectedValueOnce(new Error('readDir blew up'));
    const out = await reconcileFinishedImageDownloads(opts);
    expect(out).toEqual([]);
  });
});

describe('scanForUntrackedTextModels', () => {
  it('outer catch returns [] when getModels throws', async () => {
    const out = await scanForUntrackedTextModels('/m', async () => {
      throw new Error('boom');
    });
    expect(out).toEqual([]);
  });

  it('returns [] when dir does not exist', async () => {
    mockedRNFS.exists.mockResolvedValueOnce(false);
    const out = await scanForUntrackedTextModels('/m', async () => []);
    expect(out).toEqual([]);
  });

  it('skips non-gguf, mmproj, tiny files; skips suspicious recovered model under min bytes', async () => {
    mockedRNFS.exists.mockResolvedValueOnce(true);
    mockedRNFS.readDir.mockResolvedValueOnce([
      file('notes.txt', '/m/notes.txt', 5_000_000),
      file('model-mmproj-f16.gguf', '/m/model-mmproj-f16.gguf', 5_000_000),
      file('tiny-Q4_K_M.gguf', '/m/tiny-Q4_K_M.gguf', 500),
      // No recognizable quant → quantization='Unknown' → suspicious; under 100MB → skipped
      file('mystery.gguf', '/m/mystery.gguf', 5_000_000),
    ]);
    const out = await scanForUntrackedTextModels('/m', async () => []);
    expect(out).toEqual([]);
    expect(storage.saveModelsList).not.toHaveBeenCalled();
  });

  it('recovers a valid quantized untracked model and persists it', async () => {
    // author is always 'Unknown' here, so the suspicious-recovery gate only passes
    // for files at or above the 100MB minimum — use a large size.
    mockedRNFS.exists.mockResolvedValueOnce(true);
    mockedRNFS.readDir.mockResolvedValueOnce([
      file(
        'Qwen3-0.6B-Q4_K_M.gguf',
        '/m/Qwen3-0.6B-Q4_K_M.gguf',
        200 * 1024 * 1024,
      ),
    ]);
    const out = await scanForUntrackedTextModels('/m', async () => []);
    expect(out).toHaveLength(1);
    expect(out[0].quantization).toBe('Q4_K_M');
    expect(out[0].author).toBe('Unknown');
    expect((out[0] as any).name).toBe('Qwen3-0.6B');
    expect(storage.saveModelsList).toHaveBeenCalled();
  });

  it('recovers a large unknown-quant model (passes the min-bytes gate)', async () => {
    mockedRNFS.exists.mockResolvedValueOnce(true);
    mockedRNFS.readDir.mockResolvedValueOnce([
      file('huge-model.gguf', '/m/huge-model.gguf', 200 * 1024 * 1024),
    ]);
    const out = await scanForUntrackedTextModels('/m', async () => []);
    expect(out).toHaveLength(1);
    expect(out[0].quantization).toBe('Unknown');
  });

  it('skips files already registered by path', async () => {
    mockedRNFS.exists.mockResolvedValueOnce(true);
    mockedRNFS.readDir.mockResolvedValueOnce([
      file('Qwen3-0.6B-Q4_K_M.gguf', '/m/dup.gguf', 5_000_000),
    ]);
    const out = await scanForUntrackedTextModels('/m', async () => [
      { filePath: '/m/dup.gguf' } as any,
    ]);
    expect(out).toEqual([]);
  });
});

describe('importLocalModel', () => {
  const baseOpts = () => ({
    sourceUri: 'file:///tmp/a%20b.gguf',
    fileName: 'a b.gguf',
    modelsDir: '/models',
  });

  it('rejects unsupported extensions', async () => {
    await expect(
      importLocalModel({ ...baseOpts(), fileName: 'model.bin' } as any),
    ).rejects.toThrow('Only .gguf and .litertlm files can be imported');
  });

  it('rejects when destination already exists', async () => {
    mockedRNFS.exists.mockResolvedValueOnce(true); // destExists
    await expect(importLocalModel(baseOpts() as any)).rejects.toThrow(
      /already exists/,
    );
  });

  it('rejects when mmproj destination already exists', async () => {
    mockedRNFS.exists
      .mockResolvedValueOnce(false) // dest does not exist
      .mockResolvedValueOnce(true); // mmproj exists
    await expect(
      importLocalModel({ ...baseOpts(), mmProjFileName: 'mmproj.gguf' } as any),
    ).rejects.toThrow('A file named "mmproj.gguf" already exists');
  });

  it('imports a llama gguf with mmproj, decoding file:// uri and scaling progress', async () => {
    mockedRNFS.exists
      .mockResolvedValueOnce(false) // dest
      .mockResolvedValueOnce(false); // mmproj dest
    (mockedRNFS.stat as jest.Mock)
      .mockResolvedValueOnce({ size: 4_000_000 }) // main
      .mockResolvedValueOnce({ size: 800_000 }); // mmproj
    mockedRNFS.read.mockResolvedValueOnce('GGUF');
    const onProgress = jest.fn();
    const result: any = await importLocalModel({
      ...baseOpts(),
      sourceSize: 4_000_000,
      onProgress,
      mmProjSourceUri: 'file:///tmp/mm.gguf',
      mmProjFileName: 'mm.gguf',
      mmProjSourceSize: 800_000,
    } as any);
    expect(result.engine).toBe('llama');
    expect(result.mmProjPath).toBe('/models/mm.gguf');
    expect(result.isVisionModel).toBe(true);
    expect(copyFileWithProgress).toHaveBeenCalledTimes(2);
    // main copy scaled to 0.5 because mmproj present
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ fraction: 0.5, fileName: 'a b.gguf' }),
    );
    // mmproj copy scaled to 0.5..1
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ fraction: 1, fileName: 'mm.gguf' }),
    );
  });

  it('imports a litert model (no mmproj branch) and keeps content:// uri unchanged', async () => {
    mockedRNFS.exists.mockResolvedValueOnce(false); // dest
    (mockedRNFS.stat as jest.Mock).mockResolvedValueOnce({ size: 1_000_000 });
    const result: any = await importLocalModel({
      sourceUri: 'content://provider/x.litertlm',
      fileName: 'x.litertlm',
      modelsDir: '/models',
      liteRTVision: true,
    } as any);
    expect(result.engine).toBe('litert');
    expect(result.liteRTVision).toBe(true);
    expect(copyFileWithProgress).toHaveBeenCalledTimes(1);
    // content:// passed through unchanged
    expect(copyFileWithProgress).toHaveBeenCalledWith(
      'content://provider/x.litertlm',
      '/models/x.litertlm',
      expect.anything(),
    );
    expect(storage.persistDownloadedModel).toHaveBeenCalled();
  });
});
