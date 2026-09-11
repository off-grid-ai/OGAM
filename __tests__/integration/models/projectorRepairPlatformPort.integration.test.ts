import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import type { PersistedProjectorRepair } from '@offgrid/application';
import { mobileProjectorRepairPlatformPort } from '../../../src/services/modelServices/projectorRepairPlatformPort';

const fs = RNFS as jest.Mocked<typeof RNFS>;
const MODELS_KEY = '@local_llm/downloaded_models';

describe('Mobile projector repair platform transaction', () => {
  let files: Map<string, number>;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    files = new Map();
    fs.exists.mockImplementation(path => Promise.resolve(files.has(String(path))));
    fs.moveFile.mockImplementation(async (source, destination) => {
      const size = files.get(String(source));
      if (size === undefined) throw new Error(`missing: ${String(source)}`);
      files.delete(String(source));
      files.set(String(destination), size);
    });
    fs.unlink.mockImplementation(async path => {
      if (!files.delete(String(path))) throw new Error(`missing: ${String(path)}`);
    });
    fs.stat.mockImplementation(async path => ({
      path: String(path),
      size: files.get(String(path)) ?? 0,
      mode: 0,
      ctime: new Date(),
      mtime: new Date(),
      originalFilepath: String(path),
      isFile: () => true,
      isDirectory: () => false,
    }));
  });

  const repair = (): PersistedProjectorRepair => ({
    version: 1,
    operationId: 'repair-imported-model',
    modelId: 'imported-vision',
    primaryFileName: 'model.gguf',
    primaryLocalName: 'models/model.gguf',
    projector: {
      fileName: 'source-mmproj.gguf',
      url: 'https://example.test/source-mmproj.gguf',
      totalBytes: 900,
    },
    stagingLocalName: 'offgrid-download-staging/projector-repair/repair-imported-model/source-mmproj.gguf',
    installedLocalName: 'models/model-mmproj.gguf',
    phase: 'transferring',
  });

  const priorModel = {
    id: 'imported-vision',
    name: 'Imported Vision',
    author: 'Local',
    filePath: '/mock/documents/models/model.gguf',
    fileName: 'model.gguf',
    fileSize: 1_000,
    quantization: 'Q4_K_M',
    downloadedAt: '2026-09-04T00:00:00.000Z',
    engine: 'llama' as const,
    isVisionModel: true,
    mmProjFileName: 'source-mmproj.gguf',
  };

  it('repairs an imported model without a normal coordinator record and can roll back after restart', async () => {
    await AsyncStorage.setItem(MODELS_KEY, JSON.stringify([priorModel]));
    files.set('/mock/documents/models/model.gguf', 1_000);
    files.set('/mock/documents/models/model-mmproj.gguf', 700);
    files.set(
      '/mock/documents/offgrid-download-staging/projector-repair/repair-imported-model/source-mmproj.gguf',
      900,
    );

    const transaction = await mobileProjectorRepairPlatformPort.finalizer.begin(repair());
    const installed = await transaction.prepare(new AbortController().signal);
    expect(installed).toEqual({ localName: 'models/model-mmproj.gguf' });
    expect(files.get('/mock/documents/models/model-mmproj.gguf')).toBe(900);
    const promoted = JSON.parse((await AsyncStorage.getItem(MODELS_KEY)) ?? '[]');
    expect(promoted[0]).toMatchObject({
      id: 'imported-vision',
      mmProjPath: '/mock/documents/models/model-mmproj.gguf',
      mmProjFileName: 'model-mmproj.gguf',
      mmProjFileSize: 900,
    });

    await mobileProjectorRepairPlatformPort.finalizer.recover({
      repair: repair(),
      state: transaction.recoveryState,
      disposition: 'rollback',
    });

    expect(files.get('/mock/documents/models/model-mmproj.gguf')).toBe(700);
    expect(files.has(
      '/mock/documents/offgrid-download-staging/projector-repair/repair-imported-model/source-mmproj.gguf',
    )).toBe(false);
    expect(JSON.parse((await AsyncStorage.getItem(MODELS_KEY)) ?? '[]')).toEqual([priorModel]);
  });

  it('keeps the promoted projector when Shared has durably taken ownership', async () => {
    await AsyncStorage.setItem(MODELS_KEY, JSON.stringify([priorModel]));
    files.set('/mock/documents/models/model.gguf', 1_000);
    files.set('/mock/documents/models/model-mmproj.gguf', 700);
    files.set(
      '/mock/documents/offgrid-download-staging/projector-repair/repair-imported-model/source-mmproj.gguf',
      900,
    );
    const transaction = await mobileProjectorRepairPlatformPort.finalizer.begin(repair());
    await transaction.prepare(new AbortController().signal);

    await mobileProjectorRepairPlatformPort.finalizer.recover({
      repair: { ...repair(), phase: 'owned', recoveryState: transaction.recoveryState },
      state: transaction.recoveryState,
      disposition: 'commit',
    });

    expect(files.get('/mock/documents/models/model-mmproj.gguf')).toBe(900);
    expect([...files.keys()].some(path => path.includes('.offgrid-replacement-'))).toBe(false);
  });

  it('keeps rollback state retryable when restoring the prior projector fails once', async () => {
    await AsyncStorage.setItem(MODELS_KEY, JSON.stringify([priorModel]));
    files.set('/mock/documents/models/model.gguf', 1_000);
    files.set('/mock/documents/models/model-mmproj.gguf', 700);
    files.set(
      '/mock/documents/offgrid-download-staging/projector-repair/repair-imported-model/source-mmproj.gguf',
      900,
    );
    const transaction = await mobileProjectorRepairPlatformPort.finalizer.begin(repair());
    await transaction.prepare(new AbortController().signal);
    const move = fs.moveFile.getMockImplementation()!;
    let failed = false;
    fs.moveFile.mockImplementation(async (source, destination) => {
      if (!failed && String(source).endsWith('.offgrid-replacement-0')) {
        failed = true;
        throw new Error('filesystem busy');
      }
      await move(source, destination);
    });

    const recovery = {
      repair: repair(),
      state: transaction.recoveryState,
      disposition: 'rollback' as const,
    };
    await expect(mobileProjectorRepairPlatformPort.finalizer.recover(recovery))
      .rejects.toThrow('Model install rollback failed');
    await mobileProjectorRepairPlatformPort.finalizer.recover(recovery);

    expect(files.get('/mock/documents/models/model-mmproj.gguf')).toBe(700);
    expect([...files.keys()].some(path => path.includes('.offgrid-replacement-'))).toBe(false);
    expect(JSON.parse((await AsyncStorage.getItem(MODELS_KEY)) ?? '[]')).toEqual([priorModel]);
  });
});
