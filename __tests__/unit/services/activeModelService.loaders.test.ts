/**
 * Unit tests for activeModelService/loaders.ts
 * Covers inferenceBackendToLiteRT switch and isMMProjFile branches.
 */

jest.mock('../../../src/stores', () => ({
  useAppStore: { getState: jest.fn() },
}));
jest.mock('../../../src/stores/debugLogsStore', () => ({
  useDebugLogsStore: { getState: jest.fn(() => ({ addLog: jest.fn() })) },
}));
jest.mock('../../../src/services/llm', () => ({
  llmService: { loadModel: jest.fn(), unloadModel: jest.fn(), getMultimodalSupport: jest.fn(() => null) },
}));
jest.mock('../../../src/services/litert', () => ({
  liteRTService: { loadModel: jest.fn(), unloadModel: jest.fn(), getActiveBackend: jest.fn(() => 'cpu') },
}));
jest.mock('../../../src/services/localDreamGenerator', () => ({
  localDreamGeneratorService: { loadModel: jest.fn(), unloadModel: jest.fn() },
}));
jest.mock('../../../src/services/modelManager', () => ({
  modelManager: { saveModelWithMmproj: jest.fn(), clearMmProjLink: jest.fn() },
}));
jest.mock('react-native-fs', () => ({
  exists: jest.fn(() => Promise.resolve(false)),
  readDir: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import RNFS from 'react-native-fs';
import { doLoadTextModel, resolveMmProjPath } from '../../../src/services/activeModelService/loaders';
import { liteRTService } from '../../../src/services/litert';
import { llmService } from '../../../src/services/llm';
import { useAppStore } from '../../../src/stores';

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockedLlm = llmService as jest.Mocked<typeof llmService>;
const mockedGetState = useAppStore.getState as jest.Mock;

function makeStore(overrides: any = {}) {
  return {
    settings: { inferenceBackend: undefined, enableGpu: false, gpuLayers: 0, nThreads: 4, nBatch: 512, contextLength: 2048, flashAttn: false, cacheType: 'ram' },
    downloadedModels: [],
    setDownloadedModels: jest.fn(),
    setActiveModelId: jest.fn(),
    setLoadedSettings: jest.fn(),
    ...overrides,
  };
}

function makeCtx(overrides: any = {}) {
  return {
    model: { id: 'model-1', fileName: 'model.gguf', filePath: '/models/model.gguf', engine: 'ggml', ...overrides.model },
    modelId: 'model-1',
    store: makeStore(overrides.store),
    timeoutMs: 30000,
    loadedTextModelId: null,
    onLoaded: jest.fn(),
    onError: jest.fn(),
    onFinally: jest.fn(),
    ...overrides,
  };
}

describe('resolveMmProjPath', () => {
  beforeEach(() => jest.clearAllMocks());

  // (Removed: asserted a stored mmProjPath is trusted purely because the file exists. The strict
  // model<->projector matching (device 2026-07-14) now validates the projector BELONGS to the model
  // (quant-stripped stem equality) and self-heals otherwise. Toy names 'm.gguf' + 'mmproj.gguf' don't
  // share a stem, so this is correctly rejected now. Belonging is covered by mmProjMatchesModel.test.ts.)

  it('returns undefined when no mmproj file found in directory', async () => {
    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.readDir.mockResolvedValue([]);
    const model = { filePath: '/models/m.gguf' } as any;
    const result = await resolveMmProjPath(model, 'model-1');
    expect(result).toBeUndefined();
  });

  // (Removed: asserted the dir scan returns ANY mmproj found. Strict matching now requires the
  // projector's quant-stripped stem to equal the model's — toy names 'm.gguf' vs 'mmproj-model-f16'
  // ('m' != 'model') are correctly rejected. The belongs-to-model scan is covered by
  // mmProjMatchesModel.test.ts, which uses realistic same-stem names.)

  it('returns undefined for text-only model when no mmproj file exists in the directory', async () => {
    // Text-only model: neither isVisionModel nor mmProjFileName is set,
    // and the models directory contains no mmproj file.
    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.readDir.mockResolvedValue([]);

    const model = { filePath: '/models/SmolLM2-360M-Instruct-Q8_0.gguf' } as any;
    const result = await resolveMmProjPath(model, 'bartowski/SmolLM2-360M-Instruct-GGUF/SmolLM2-360M-Instruct-Q8_0.gguf');

    expect(result).toBeUndefined();
  });

  it('allows scan for model with mmProjFileName sentinel even when isVisionModel is false (repair case)', async () => {
    // After a failed mmproj download buildDownloadedModel sets mmProjFileName as a sentinel
    // so needsVisionRepair can detect the gap. resolveMmProjPath must still scan for
    // this model so that if the user repairs vision the path can be recovered.
    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.readDir.mockResolvedValue([]); // mmproj not on disk yet
    const model = {
      filePath: '/models/SmolVLM2-256M-Video-Instruct-Q8_0.gguf',
      isVisionModel: false,
      mmProjFileName: 'SmolVLM2-256M-Video-Instruct-Q8_0-mmproj.gguf',
    } as any;
    const result = await resolveMmProjPath(model, 'ggml-org/SmolVLM2');

    expect(result).toBeUndefined(); // mmproj not on disk → scan found nothing
    expect(mockedRNFS.readDir).toHaveBeenCalled(); // guard did NOT block the scan
  });
});

describe('doLoadTextModel — llama.cpp path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls llmService.loadModel and onLoaded on success', async () => {
    mockedLlm.loadModel.mockResolvedValue(undefined);
    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.readDir.mockResolvedValue([]);
    const ctx = makeCtx();
    mockedGetState.mockReturnValue(ctx.store);

    await doLoadTextModel(ctx);

    expect(mockedLlm.loadModel).toHaveBeenCalled();
    expect(ctx.onLoaded).toHaveBeenCalledWith('model-1');
    expect(ctx.onFinally).toHaveBeenCalled();
  });

  it('calls onError and rethrows when llmService.loadModel fails', async () => {
    mockedLlm.loadModel.mockRejectedValue(new Error('load failed'));
    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.readDir.mockResolvedValue([]);
    const ctx = makeCtx();
    mockedGetState.mockReturnValue(ctx.store);

    await expect(doLoadTextModel(ctx)).rejects.toThrow('load failed');
    expect(ctx.onError).toHaveBeenCalled();
    expect(ctx.onFinally).toHaveBeenCalled();
  });

  it('unloads previous model when loadedTextModelId differs', async () => {
    mockedLlm.loadModel.mockResolvedValue(undefined);
    mockedLlm.unloadModel.mockResolvedValue(undefined);
    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.readDir.mockResolvedValue([]);
    const ctx = makeCtx({ loadedTextModelId: 'old-model' });
    mockedGetState.mockReturnValue(ctx.store);

    await doLoadTextModel(ctx);
    expect(mockedLlm.unloadModel).toHaveBeenCalled();
  });

  it('CROSS-ENGINE: loading a llama GGUF unloads a previously-resident LiteRT model (co-residence OOM fix)', async () => {
    // The OOM: a 5.2GB LiteRT model was resident, a llama GGUF loaded, but the llama loader only
    // unloaded llmService — the LiteRT stayed resident → two heavy 'text' models → OOM. The
    // switch must unload BOTH engines regardless of which held the previous model.
    mockedLlm.loadModel.mockResolvedValue(undefined);
    mockedLlm.unloadModel.mockResolvedValue(undefined);
    mockedLiteRT.unloadModel.mockResolvedValue(undefined);
    mockedRNFS.exists.mockResolvedValue(false);
    mockedRNFS.readDir.mockResolvedValue([]);
    const ctx = makeCtx({ loadedTextModelId: 'old-litert-model' }); // previous model was on the OTHER engine
    mockedGetState.mockReturnValue(ctx.store);

    await doLoadTextModel(ctx);

    expect(mockedLiteRT.unloadModel).toHaveBeenCalled(); // the resident LiteRT is freed (was the bug)
    expect(mockedLlm.unloadModel).toHaveBeenCalled();
  });
});

describe('doLoadTextModel — LiteRT path', () => {
  beforeEach(() => jest.clearAllMocks());

  it('routes to liteRTService when engine=litert', async () => {
    mockedLiteRT.loadModel.mockResolvedValue(undefined);
    mockedLiteRT.getActiveBackend.mockReturnValue('cpu');
    const ctx = makeCtx({ model: { id: 'model-1', fileName: 'model.litertlm', filePath: '/models/model.litertlm', engine: 'litert' } });
    const { useDebugLogsStore } = require('../../../src/stores/debugLogsStore');
    useDebugLogsStore.getState.mockReturnValue({ addLog: jest.fn() });

    await doLoadTextModel(ctx);

    expect(mockedLiteRT.loadModel).toHaveBeenCalled();
    expect(mockedLlm.loadModel).not.toHaveBeenCalled();
    expect(ctx.onLoaded).toHaveBeenCalledWith('model-1');
  });

  it('CROSS-ENGINE: loading a LiteRT model unloads a previously-resident llama GGUF (co-residence OOM fix)', async () => {
    mockedLiteRT.loadModel.mockResolvedValue(undefined);
    mockedLiteRT.getActiveBackend.mockReturnValue('cpu');
    mockedLiteRT.unloadModel.mockResolvedValue(undefined);
    mockedLlm.unloadModel.mockResolvedValue(undefined);
    const ctx = makeCtx({
      model: { id: 'model-1', fileName: 'model.litertlm', filePath: '/models/model.litertlm', engine: 'litert' },
      loadedTextModelId: 'old-llama-model', // previous model was on the OTHER engine
    });
    const { useDebugLogsStore } = require('../../../src/stores/debugLogsStore');
    useDebugLogsStore.getState.mockReturnValue({ addLog: jest.fn() });

    await doLoadTextModel(ctx);

    expect(mockedLlm.unloadModel).toHaveBeenCalled(); // the resident llama GGUF is freed (was the bug)
    expect(mockedLiteRT.unloadModel).toHaveBeenCalled();
  });

  it('calls onError and rethrows when liteRTService.loadModel fails', async () => {
    mockedLiteRT.loadModel.mockRejectedValue(new Error('litert failed'));
    mockedLiteRT.getActiveBackend.mockReturnValue('cpu');
    const ctx = makeCtx({ model: { id: 'model-1', fileName: 'model.litertlm', filePath: '/models/model.litertlm', engine: 'litert' } });
    const { useDebugLogsStore } = require('../../../src/stores/debugLogsStore');
    useDebugLogsStore.getState.mockReturnValue({ addLog: jest.fn() });

    await expect(doLoadTextModel(ctx)).rejects.toThrow('litert failed');
    expect(ctx.onError).toHaveBeenCalled();
    expect(ctx.onFinally).toHaveBeenCalled();
  });

  // Regression: the pending-settings banner compares `settings.liteRTMaxTokens` against
  // `loadedSettings.liteRTMaxTokens`. The loader must snapshot the RAW setting, not the
  // `?? 4096`-normalized value it passes to native — otherwise an undefined setting is
  // stored as 4096, `undefined !== 4096` is true, and the banner pops the instant a
  // LiteRT model loads with nothing actually changed.
  it('snapshots the RAW liteRTMaxTokens setting (undefined stays undefined, no false banner)', async () => {
    mockedLiteRT.loadModel.mockResolvedValue(undefined);
    mockedLiteRT.getActiveBackend.mockReturnValue('cpu');
    const { useDebugLogsStore } = require('../../../src/stores/debugLogsStore');
    useDebugLogsStore.getState.mockReturnValue({ addLog: jest.fn() });
    const ctx = makeCtx({
      model: { id: 'model-1', fileName: 'model.litertlm', filePath: '/models/model.litertlm', engine: 'litert' },
      store: { settings: { liteRTBackend: 'gpu', liteRTMaxTokens: undefined } },
    });
    // makeCtx spreads overrides last, so pass the pre-built store to preserve the jest.fn()s.
    ctx.store = makeStore({ settings: { liteRTBackend: 'gpu', liteRTMaxTokens: undefined } });

    await doLoadTextModel(ctx);

    expect(ctx.store.setLoadedSettings).toHaveBeenCalledWith(
      expect.objectContaining({ liteRTMaxTokens: undefined, liteRTBackend: 'gpu' }),
    );
    // Native still gets the normalized default so it never loads a bad token count.
    expect(mockedLiteRT.loadModel).toHaveBeenCalledWith(
      '/models/model.litertlm', 'gpu', expect.objectContaining({ maxNumTokens: 4096 }),
    );
  });

  it('snapshots an explicit liteRTMaxTokens verbatim', async () => {
    mockedLiteRT.loadModel.mockResolvedValue(undefined);
    mockedLiteRT.getActiveBackend.mockReturnValue('cpu'); // cpu → skips warmup (not in mock)
    const { useDebugLogsStore } = require('../../../src/stores/debugLogsStore');
    useDebugLogsStore.getState.mockReturnValue({ addLog: jest.fn() });
    const ctx = makeCtx({
      model: { id: 'model-1', fileName: 'model.litertlm', filePath: '/models/model.litertlm', engine: 'litert' },
    });
    ctx.store = makeStore({ settings: { liteRTBackend: 'gpu', liteRTMaxTokens: 8192 } });

    await doLoadTextModel(ctx);

    expect(ctx.store.setLoadedSettings).toHaveBeenCalledWith(
      expect.objectContaining({ liteRTMaxTokens: 8192 }),
    );
  });
});
