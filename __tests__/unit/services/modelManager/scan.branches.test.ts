/**
 * Branch tests for modelManager/scan.ts: recovery and reconciliation paths, import guards, projector
 * linking, and the recursive folder-size helper.
 *
 * Fakes: the disk (react-native-fs in memory), async-storage and the native unzip, from
 * harness/modelManagerDevice. The scanners, the registry storage, the Core ML resolver, the
 * image-model integrity checks and importLocalModel run for real. Files are put on the disk because
 * the disk is what these paths read.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';
import type { ONNXImageModel } from '../../../../src/types';

type ScanModule = typeof import('../../../../src/services/modelManager/scan');
type ImportModule = typeof import('../../../../src/services/modelManager/importLocalModel');

const MB = 1024 * 1024;

let device: ModelManagerDevice;
let scan: ScanModule;
let importLocalModel: ImportModule['importLocalModel'];

beforeEach(async () => {
  device = await installModelManagerDevice();
  scan = require('../../../../src/services/modelManager/scan');
  ({ importLocalModel } = require('../../../../src/services/modelManager/importLocalModel') as ImportModule);
});

/** An image registry the scanner reads and writes through its injected getters. */
function imageRegistry(initial: Array<Partial<ONNXImageModel>> = []) {
  const rows = [...initial] as ONNXImageModel[];
  return {
    rows,
    getImageModels: async () => rows,
    addImageModel: async (model: ONNXImageModel) => { rows.push(model); },
  };
}

/** The disk refuses to list this one folder. */
function unreadableFolder(path: string) {
  const readDir = device.fs.module.readDir.getMockImplementation()!;
  device.fs.module.readDir.mockImplementation(async (p: string) => {
    if (p === path) throw new Error('cannot read');
    return readDir(p);
  });
}

describe('deleteOrphanedFile', () => {
  it('removes a file that is there, and ignores one that is not', async () => {
    const path = `${device.modelsDir}/orphan.gguf`;
    device.fs.seedFile(path, 1000);
    expect(await device.fs.exists(path)).toBe(true);

    await scan.deleteOrphanedFile(path);
    await scan.deleteOrphanedFile(`${device.modelsDir}/missing.gguf`);

    expect(await device.fs.exists(path)).toBe(false);
  });
});

describe('scanForUntrackedImageModels (folder size recursion)', () => {
  it('returns [] when the image folder does not exist', async () => {
    const registry = imageRegistry();
    const out = await scan.scanForUntrackedImageModels({ imageModelsDir: '/nowhere', ...registry });
    expect(out).toEqual([]);
  });

  it('skips registered folders, empty folders and loose files', async () => {
    const dir = device.imageModelsDir;
    device.fs.seedFile(`${dir}/known/unet.mnn`, 1000);
    device.fs.seedDir(`${dir}/empty`);
    device.fs.seedFile(`${dir}/loose.txt`, 100);
    const registry = imageRegistry([{ id: 'known', modelPath: `${dir}/known` }]);

    expect(await scan.scanForUntrackedImageModels({ imageModelsDir: dir, ...registry })).toEqual([]);
    expect(registry.rows).toHaveLength(1);
  });

  it('recovers a model and sums sizes through a nested folder, a string size included', async () => {
    const dir = device.imageModelsDir;
    device.fs.seedFile(`${dir}/Stable_Diffusion.zip/weights.bin`, 1000);
    device.fs.seedFile(`${dir}/Stable_Diffusion.zip/nested/extra.bin`, 500);
    device.fs.setReportedFileSize(`${dir}/Stable_Diffusion.zip/nested/extra.bin`, '500');
    const registry = imageRegistry();

    const out = await scan.scanForUntrackedImageModels({ imageModelsDir: dir, ...registry });

    expect(out.map(m => [m.id, m.name, m.size])).toEqual([['recovered_Stable_Diffusion.zip', 'Stable Diffusion', 1500]]);
    expect(registry.rows.map(m => m.id)).toEqual(['recovered_Stable_Diffusion.zip']);
  });

  it('skips a folder whose contents cannot be listed (its size reads as 0)', async () => {
    const dir = device.imageModelsDir;
    device.fs.seedFile(`${dir}/Broken/unet.mnn`, 1000);
    unreadableFolder(`${dir}/Broken`);
    const registry = imageRegistry();

    expect(await scan.scanForUntrackedImageModels({ imageModelsDir: dir, ...registry })).toEqual([]);
    expect(registry.rows).toEqual([]);
  });
});

describe('cleanupMMProjEntries', () => {
  it('links a projector found in the models folder to a model that has none', async () => {
    const dir = device.modelsDir;
    device.fs.seedFile(`${dir}/gemma-vl-Q4_K_M.gguf`, 2000 * MB);
    device.fs.seedFile(`${dir}/gemma-vl-Q4_K_M-mmproj.gguf`, 300 * MB);
    await device.seedRegistry([{
      id: 'g/gemma-vl-Q4_K_M.gguf', name: 'Gemma VL', author: 'g', fileName: 'gemma-vl-Q4_K_M.gguf',
      filePath: `${dir}/gemma-vl-Q4_K_M.gguf`, fileSize: 2000 * MB, quantization: 'Q4_K_M',
      downloadedAt: '2026-10-01T00:00:00.000Z', engine: 'llama',
    }]);

    const removed = await scan.cleanupMMProjEntries(dir);

    expect(removed).toBe(0);
    expect(await device.readRegistry()).toEqual([expect.objectContaining({
      fileName: 'gemma-vl-Q4_K_M.gguf',
      mmProjPath: `${dir}/gemma-vl-Q4_K_M-mmproj.gguf`,
      mmProjFileSize: 300 * MB,
      isVisionModel: true,
    })]);
  });

  it('removes projector rows an older version saved as models, even when the folder cannot be listed', async () => {
    const dir = device.modelsDir;
    device.fs.seedFile(`${dir}/real-Q4_K_M.gguf`, 1000 * MB);
    device.fs.seedFile(`${dir}/model-mmproj-f16.gguf`, 300 * MB);
    const row = (fileName: string) => ({
      id: `a/${fileName}`, name: fileName, author: 'a', fileName, filePath: `${dir}/${fileName}`,
      fileSize: 1, quantization: 'Q4_K_M', downloadedAt: '2026-10-01T00:00:00.000Z', engine: 'llama',
    });
    await device.seedRegistry([row('real-Q4_K_M.gguf'), row('model-mmproj-f16.gguf')]);
    unreadableFolder(dir);

    const removed = await scan.cleanupMMProjEntries(dir);

    expect(removed).toBe(1);
    expect((await device.readRegistry()).map(m => m.fileName)).toEqual(['real-Q4_K_M.gguf']);
  });

  it('finds nothing to remove when the models folder does not exist', async () => {
    expect(await scan.cleanupMMProjEntries('/no/models')).toBe(0);
    expect(await device.readRegistry()).toEqual([]);
  });
});

describe('reconcileFinishedImageDownloads', () => {
  const run = (registry = imageRegistry(), active: string[] = []) =>
    scan.reconcileFinishedImageDownloads({ imageModelsDir: device.imageModelsDir, ...registry, activeModelIds: new Set(active) });

  it('skips loose files, registered ids and downloads still running', async () => {
    const dir = device.imageModelsDir;
    device.fs.seedFile(`${dir}/loose.bin`, 10);
    device.fs.seedTextFile(`${dir}/reg/_ready`, '');
    device.fs.seedTextFile(`${dir}/busy/_ready`, '');
    const registry = imageRegistry([{ id: 'reg', modelPath: '/elsewhere' }]);

    expect(await run(registry, ['busy'])).toEqual([]);
    expect(registry.rows).toHaveLength(1);
    expect(await device.fs.exists(`${dir}/busy/_ready`)).toBe(true);
  });

  it('migrates a legacy recovered_ row to the folder id, and resolves the Core ML folder', async () => {
    const dir = `${device.imageModelsDir}/coreml_model`;
    device.fs.seedFile(`${dir}/compiled/Unet.mlmodelc`, 2048);
    const registry = imageRegistry([{
      id: 'recovered_old_123', modelPath: dir, name: 'Legacy', description: 'd',
      downloadedAt: 't', style: 's' as ONNXImageModel['style'], attentionVariant: 'a' as ONNXImageModel['attentionVariant'],
    }]);

    const out = await run(registry);

    expect(out.map(m => [m.id, m.name, m.backend, m.modelPath, m.size])).toEqual([
      ['coreml_model', 'Legacy', 'coreml', `${dir}/compiled`, 2048],
    ]);
    expect(await device.fs.exists(`${dir}/_ready`)).toBe(true);
  });

  it('a legacy migration whose folder cannot be listed still migrates, with size 0', async () => {
    const dir = `${device.imageModelsDir}/x`;
    device.fs.seedFile(`${dir}/unet.mnn`, 1000);
    unreadableFolder(dir);
    const registry = imageRegistry([{ id: 'recovered_x_1', modelPath: dir, name: '', description: '', downloadedAt: '' }]);

    const out = await run(registry);

    expect(out.map(m => [m.id, m.name, m.size])).toEqual([['x', 'x', 0]]);
  });

  it('registers a _ready folder as mnn with its size', async () => {
    const dir = `${device.imageModelsDir}/My_Model`;
    device.fs.seedTextFile(`${dir}/_ready`, '');
    device.fs.seedFile(`${dir}/f`, 500);

    const out = await run();

    expect(out.map(m => [m.name, m.backend, m.size])).toEqual([['My Model', 'mnn', 500]]);
  });

  it('skips a folder a registered model points at under another id', async () => {
    const dir = `${device.imageModelsDir}/dir`;
    device.fs.seedFile(`${dir}/unet.mnn`, 1000);

    expect(await run(imageRegistry([{ id: 'other', modelPath: dir }]))).toEqual([]);
    expect(await device.fs.exists(`${dir}/unet.mnn`)).toBe(true);
  });

  it('cleans up a folder whose zip is empty, without extracting', async () => {
    const images = device.imageModelsDir;
    device.fs.seedTextFile(`${images}/Bad/_zip_name`, 'gone.zip');
    device.fs.seedFile(`${images}/gone.zip`, 0);

    expect(await run()).toEqual([]);

    expect(await device.fs.exists(`${images}/Bad`)).toBe(false);
    // An extraction that failed its completeness check removes the zip too; an invalid zip is left alone.
    expect(await device.fs.exists(`${images}/gone.zip`)).toBe(true);
  });

  it('keeps reconciliation non-fatal when the image folder cannot be listed', async () => {
    device.fs.seedTextFile(`${device.imageModelsDir}/My_Model/_ready`, '');
    unreadableFolder(device.imageModelsDir);

    expect(await run()).toEqual([]);
  });
});

describe('scanForUntrackedTextModels', () => {
  it('returns [] when reading the registry throws', async () => {
    const out = await scan.scanForUntrackedTextModels(device.modelsDir, async () => { throw new Error('boom'); });
    expect(out).toEqual([]);
  });

  it('returns [] when the folder does not exist', async () => {
    expect(await scan.scanForUntrackedTextModels('/no/models', async () => [])).toEqual([]);
  });

  it('skips non-gguf, projector and tiny files, and a small file with no quantization in its name', async () => {
    const dir = device.modelsDir;
    device.fs.seedFile(`${dir}/notes.txt`, 5_000_000);
    device.fs.seedFile(`${dir}/model-mmproj-f16.gguf`, 5_000_000);
    device.fs.seedFile(`${dir}/tiny-Q4_K_M.gguf`, 500);
    device.fs.seedFile(`${dir}/mystery.gguf`, 5_000_000);

    expect(await scan.scanForUntrackedTextModels(dir, async () => [])).toEqual([]);
    expect(await device.readRegistry()).toEqual([]);
  });

  it('adopts a quantized model and a large unknown-quant one, and saves them', async () => {
    const dir = device.modelsDir;
    device.fs.seedFile(`${dir}/Qwen3-0.6B-Q4_K_M.gguf`, 200 * MB);
    device.fs.seedFile(`${dir}/huge-model.gguf`, 200 * MB);

    const out = await scan.scanForUntrackedTextModels(dir, async () => []);

    expect(out.map(m => [m.fileName, m.quantization, m.author, m.name]).sort()).toEqual([
      ['Qwen3-0.6B-Q4_K_M.gguf', 'Q4_K_M', 'Unknown', 'Qwen3-0.6B'],
      ['huge-model.gguf', 'Unknown', 'Unknown', 'huge-model'],
    ]);
    expect((await device.readRegistry()).map(m => m.fileName).sort()).toEqual(['Qwen3-0.6B-Q4_K_M.gguf', 'huge-model.gguf']);
  });
});

describe('importLocalModel', () => {
  it('refuses a file that is not a model', async () => {
    await expect(importLocalModel({ sourceUri: 'file:///tmp/model.bin', fileName: 'model.bin', modelsDir: device.modelsDir }))
      .rejects.toThrow('Only .gguf and .litertlm files can be imported');
  });

  it('imports a LiteRT model with vision from a content:// document, registered as litert', async () => {
    device.seedContentDocument('content://provider/x.litertlm', 1_000_000);

    const result = await importLocalModel({
      sourceUri: 'content://provider/x.litertlm',
      fileName: 'x.litertlm',
      modelsDir: device.modelsDir,
      liteRTVision: true,
    });

    expect(result).toEqual(expect.objectContaining({ engine: 'litert', liteRTVision: true, fileSize: 1_000_000 }));
    expect(await device.fs.exists(`${device.modelsDir}/x.litertlm`)).toBe(true);
    expect(await device.readRegistry()).toEqual([expect.objectContaining({ fileName: 'x.litertlm', engine: 'litert' })]);
  });
});
