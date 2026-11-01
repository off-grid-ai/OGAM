/**
 * activeModelService/loaders — loading a text model, end to end through activeModelService.loadTextModel.
 *
 *  - llama (.gguf): the projector lookup on disk, a load that succeeds or fails, a llama → llama switch,
 *    a switch away from a resident LiteRT model.
 *  - LiteRT (.litertlm): routing to the LiteRT engine, a switch away from a resident llama model, a failed
 *    load, and the settings snapshot the pending-settings banner compares against.
 *
 * Real: activeModelService and its loaders, the residency manager's load lock, llmService, liteRTService,
 * the engine set, modelManager, the stores. Faked (device, harness/generationDevice): llama.rn, the LiteRT
 * native module, the filesystem, RAM.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';

let d: GenerationDevice;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

const models = () => d.useAppStore.getState().downloadedModels as any[];
const modelById = (id: string) => models().find(m => m.id === id);
/** Every llama context llama.rn opened for a chat model (the projector is set up on these). */
const llamaContexts = () =>
  d.boundary.llama!.module.initLlama.mock.results
    .filter((_r, i) => !d.boundary.llama!.calls.initLlama[i].embedding)
    .map(r => r.value);

describe('the projector lookup for a llama model', () => {
  it('loads a text-only model without a projector when none is on disk', async () => {
    d = await launchGeneration({ load: false });

    await d.activeModelService.loadTextModel('m');

    const [ctx] = await Promise.all(llamaContexts());
    expect(ctx.initMultimodal).not.toHaveBeenCalled();
    expect(d.llmService.getMultimodalSupport()?.vision ?? false).toBe(false);
    expect(modelById('m').isVisionModel).toBeFalsy();
    expect(modelById('m').mmProjPath).toBeUndefined();
  });

  it('still looks for the projector of a model whose projector download failed (repair case), and loads it text-only', async () => {
    d = await launchGeneration({ load: false });
    // After a failed projector download the model keeps mmProjFileName as a marker, so a repair can
    // find the file later. Until the file is on disk the model loads without vision.
    const m = modelById('m');
    d.useAppStore.getState().setDownloadedModels([
      { ...m, isVisionModel: false, mmProjFileName: 'm-mmproj.gguf' },
    ]);

    await d.activeModelService.loadTextModel('m');

    const [ctx] = await Promise.all(llamaContexts());
    expect(ctx.initMultimodal).not.toHaveBeenCalled();
    expect(modelById('m')).toEqual(expect.objectContaining({ isVisionModel: false, mmProjFileName: 'm-mmproj.gguf' }));
    expect(modelById('m').mmProjPath).toBeUndefined();
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('m');
  });
  it('finds the projector beside the model, hands it to native, and keeps the link off when native reports no vision', async () => {
    d = await launchGeneration({ load: false });
    const m = modelById('m');
    const dir = m.filePath.slice(0, m.filePath.lastIndexOf('/'));
    const projector = `${dir}/m-mmproj-f16.gguf`;
    d.boundary.fs!.seedFile(projector, 80 * 1024 * 1024);
    // The persisted model registry, as a finished download leaves it.
    const storage = require('@react-native-async-storage/async-storage');
    await (storage.default ?? storage).setItem('@local_llm/downloaded_models', JSON.stringify(models()));

    await d.activeModelService.loadTextModel('m');

    const [ctx] = await Promise.all(llamaContexts());
    expect(ctx.initMultimodal).toHaveBeenCalledWith(expect.objectContaining({ path: projector }));
    // This projector did not start (native: no vision): the link is cleared, the vision identity and
    // file name stay so a repair can relink it.
    expect(d.llmService.getMultimodalSupport()?.vision ?? false).toBe(false);
    expect(modelById('m')).toEqual(expect.objectContaining({ isVisionModel: true, mmProjFileName: 'm-mmproj-f16.gguf' }));
    expect(modelById('m').mmProjPath).toBeUndefined();
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('m');
  });
});

describe('loading a llama model', () => {
  it('loads it, makes it the active model and snapshots the settings it loaded with', async () => {
    d = await launchGeneration({ load: false });
    expect(d.llmService.isModelLoaded()).toBe(false);

    await d.activeModelService.loadTextModel('m');

    expect(d.llmService.isModelLoaded()).toBe(true);
    expect(d.llmService.getLoadedModelPath()).toBe(modelById('m').filePath);
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('m');
    expect(d.useAppStore.getState().activeModelId).toBe('m');
    expect(d.useAppStore.getState().loadedSettings).toEqual(expect.objectContaining({
      contextLength: d.useAppStore.getState().settings.contextLength,
      nThreads: d.useAppStore.getState().settings.nThreads,
    }));
    expect(d.activeModelService.getActiveModels().text.isLoading).toBe(false);
  });

  it('surfaces a native load failure and leaves no model active', async () => {
    d = await launchGeneration({ load: false });
    d.boundary.llama!.scriptInitFailure(true);

    await expect(d.activeModelService.loadTextModel('m')).rejects.toThrow();

    expect(d.llmService.isModelLoaded()).toBe(false);
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBeNull();
    expect(d.useAppStore.getState().activeModelId).toBeNull();
    expect(d.activeModelService.getActiveModels().text.isLoading).toBe(false);
  });

  // llama.rn hands back one native context object; its release() count is what the device freed.
  it('a llama → llama switch opens the new model, then releases the old one exactly once', async () => {
    d = await launchGeneration({ extraModels: [{ id: 'b', name: 'Model B' }] });
    const [ctx] = await Promise.all(llamaContexts());
    expect(ctx.release).not.toHaveBeenCalled();

    await d.activeModelService.loadTextModel('b');

    expect(d.boundary.llama!.calls.initLlama.map(p => p.model)).toEqual([
      modelById('m').filePath, modelById('b').filePath,
    ]);
    expect(ctx.release).toHaveBeenCalledTimes(1);
    expect(d.llmService.getLoadedModelPath()).toBe(modelById('b').filePath);
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('b');
    expect(d.useAppStore.getState().activeModelId).toBe('b');
  });

  it('a llama → llama switch to a model that does not fit leaves the chat on the model it had', async () => {
    // Releasing the current model before checking the new one fits is what left a refused switch with
    // nothing loaded.
    d = await launchGeneration({ extraModels: [{ id: 'big', name: 'Big', fileSizeBytes: 40 * 1024 ** 3 }] });
    const [ctx] = await Promise.all(llamaContexts());

    await expect(d.activeModelService.loadTextModel('big')).rejects.toThrow(/memory/i);

    expect(ctx.release).not.toHaveBeenCalled();
    expect(d.llmService.getLoadedModelPath()).toBe(modelById('m').filePath);
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('m');
  });

  it('a switch to llama frees a resident LiteRT model first (no two heavy text models at once)', async () => {
    // The OOM: a 5.2 GB LiteRT model was resident, a llama model loaded, and only llama was unloaded, so
    // both stayed resident.
    d = await launchGeneration({ engine: 'litert', extraModels: [{ id: 'g', name: 'Gguf', engine: 'llama' }] });
    expect(d.liteRTService.isModelLoaded()).toBe(true);
    const unloads = d.boundary.litert.module.unloadModel.mock.calls.length;

    await d.activeModelService.loadTextModel('g');

    expect(d.boundary.litert.module.unloadModel.mock.calls.length).toBe(unloads + 1);
    expect(d.liteRTService.isModelLoaded()).toBe(false);
    expect(d.llmService.isModelLoaded()).toBe(true);
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('g');
  });
});

describe('loading a LiteRT model', () => {
  it('routes it to the LiteRT engine, not llama', async () => {
    d = await launchGeneration({ engine: 'litert', load: false });

    await d.activeModelService.loadTextModel('m');

    expect(d.boundary.litert.calls.loadModel).toEqual([
      [modelById('m').filePath, d.useAppStore.getState().settings.liteRTBackend, false, false, 4096],
    ]);
    expect(d.boundary.llama!.calls.initLlama.filter(p => !p.embedding)).toHaveLength(0);
    expect(d.liteRTService.isModelLoaded()).toBe(true);
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('m');
    expect(d.useAppStore.getState().activeModelId).toBe('m');
  });

  it('a switch to LiteRT frees a resident llama model first', async () => {
    d = await launchGeneration({ extraModels: [{ id: 'l', name: 'Lite', engine: 'litert' }] });
    const [llamaCtx] = await Promise.all(llamaContexts());
    expect(d.llmService.isModelLoaded()).toBe(true);

    await d.activeModelService.loadTextModel('l');

    expect(llamaCtx.release).toHaveBeenCalledTimes(1);
    expect(d.llmService.isModelLoaded()).toBe(false);
    expect(d.liteRTService.isModelLoaded()).toBe(true);
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('l');
  });

  it('surfaces a native load failure and leaves no model active', async () => {
    d = await launchGeneration({ engine: 'litert', load: false });
    d.boundary.litert.module.loadModel.mockRejectedValueOnce(new Error('litert failed'));

    await expect(d.activeModelService.loadTextModel('m')).rejects.toThrow('litert failed');

    expect(d.liteRTService.isModelLoaded()).toBe(false);
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBeNull();
    expect(d.useAppStore.getState().activeModelId).toBeNull();
    expect(d.activeModelService.getActiveModels().text.isLoading).toBe(false);
  });

  // The pending-settings banner compares settings.liteRTMaxTokens with loadedSettings.liteRTMaxTokens. The
  // snapshot must hold the RAW setting, not the 4096 sent to native: storing 4096 for an unset setting
  // made undefined !== 4096 and popped the banner the moment a LiteRT model loaded.
  it('snapshots an unset liteRTMaxTokens as unset (no false banner), and still sends native 4096', async () => {
    d = await launchGeneration({ engine: 'litert', load: false });
    d.useAppStore.getState().updateSettings({ liteRTBackend: 'gpu', liteRTMaxTokens: undefined });

    await d.activeModelService.loadTextModel('m');

    const loaded = d.useAppStore.getState().loadedSettings;
    expect(loaded).toEqual(expect.objectContaining({ liteRTBackend: 'gpu' }));
    expect(loaded.liteRTMaxTokens).toBeUndefined();
    expect(d.boundary.litert.calls.loadModel[0]).toEqual([modelById('m').filePath, 'gpu', false, false, 4096]);
  });

  it('snapshots an explicit liteRTMaxTokens as set', async () => {
    d = await launchGeneration({ engine: 'litert', load: false });
    d.useAppStore.getState().updateSettings({ liteRTBackend: 'gpu', liteRTMaxTokens: 8192 });

    await d.activeModelService.loadTextModel('m');

    expect(d.useAppStore.getState().loadedSettings.liteRTMaxTokens).toBe(8192);
    expect(d.boundary.litert.calls.loadModel[0][4]).toBe(8192);
  });
});
