/**
 * activeModelService/loaders — the less common turns of a model load, through activeModelService.
 *
 *  - llama: a projector link that cannot be saved, a stored projector that does not start, the OpenCL cache
 *    type, a native unload that fails during an engine switch.
 *  - LiteRT: a GPU request that native runs on the CPU at a long context (the toast), the warmup on an
 *    accelerator, the vision flag handed to native.
 *  - Image: switching image models, reloading for a new thread count, a native load that fails.
 *
 * Real: activeModelService and its loaders, the residency manager's load lock, llmService, liteRTService,
 * localDreamGenerator, modelManager, the stores. Faked (device, harness/generationDevice): llama.rn, the
 * LiteRT and diffusion native modules, the filesystem, async-storage, RAM, the OS toast.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { SD_MNN_PACKAGE_FILES } from '../../harness/imageModelPackage';
import { createONNXImageModel } from '../../utils/factories';

const REGISTRY_KEY = '@local_llm/downloaded_models';
let d: GenerationDevice;

const storage = () => {
  const mod = require('@react-native-async-storage/async-storage');
  return mod.default ?? mod;
};

beforeEach(async () => {
  await storage().clear(); // each test is a fresh install
});

const modelById = (id: string) => d.useAppStore.getState().downloadedModels.find((m: any) => m.id === id);
const llamaContext = () => {
  const i = d.boundary.llama!.calls.initLlama.findIndex(p => !p.embedding);
  return d.boundary.llama!.module.initLlama.mock.results[i].value;
};
/** The models registry on disk, as a finished download leaves it. */
const persistRegistry = () => storage().setItem(REGISTRY_KEY, JSON.stringify(d.useAppStore.getState().downloadedModels));
const projectorBeside = (filePath: string, name: string) => `${filePath.slice(0, filePath.lastIndexOf('/'))}/${name}`;

describe('llama — the projector', () => {
  it('loads the model text-only when the found projector cannot be saved to the registry', async () => {
    d = await launchGeneration({ load: false });
    d.boundary.fs!.seedFile(projectorBeside(modelById('m').filePath, 'm-mmproj-f16.gguf'), 1024);
    await persistRegistry();
    // The disk refuses the registry write.
    const store = storage();
    const setItem = store.setItem.getMockImplementation();
    store.setItem.mockImplementation(async (key: string, value: string) => {
      if (key === REGISTRY_KEY) throw new Error('disk full');
      return setItem(key, value);
    });

    await d.activeModelService.loadTextModel('m');

    expect((await llamaContext()).initMultimodal).not.toHaveBeenCalled();
    expect(d.llmService.isModelLoaded()).toBe(true);
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('m');
  });

  it('clears a stored projector link that native could not start, and keeps the vision identity', async () => {
    d = await launchGeneration({ load: false });
    const m = modelById('m');
    const projector = projectorBeside(m.filePath, 'm-mmproj-f16.gguf');
    d.boundary.fs!.seedFile(projector, 1024);
    d.useAppStore.getState().setDownloadedModels([
      { ...m, mmProjPath: projector, mmProjFileName: 'm-mmproj-f16.gguf', isVisionModel: true },
    ]);
    await persistRegistry();

    await d.activeModelService.loadTextModel('m');

    expect((await llamaContext()).initMultimodal).toHaveBeenCalledWith(expect.objectContaining({ path: projector }));
    expect(modelById('m').mmProjPath).toBeUndefined();
    expect(modelById('m')).toEqual(expect.objectContaining({ isVisionModel: true, mmProjFileName: 'm-mmproj-f16.gguf' }));
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('m');
  });
});

describe('llama — settings and switches', () => {
  it('snapshots the f16 cache type OpenCL forces, so the banner does not show a false change', async () => {
    d = await launchGeneration({ load: false });
    d.useAppStore.getState().updateSettings({ inferenceBackend: 'opencl', cacheType: 'q8_0' });

    await d.activeModelService.loadTextModel('m');

    expect(d.useAppStore.getState().loadedSettings).toEqual(expect.objectContaining({
      inferenceBackend: 'opencl',
      cacheType: 'f16',
    }));
  });

  it('still loads the llama model when the resident LiteRT model fails to unload natively', async () => {
    d = await launchGeneration({ engine: 'litert', extraModels: [{ id: 'g', name: 'Gguf', engine: 'llama' }] });
    d.boundary.litert.module.unloadModel.mockRejectedValueOnce(new Error('unload boom'));

    await d.activeModelService.loadTextModel('g');

    expect(d.liteRTService.isModelLoaded()).toBe(false);
    expect(d.llmService.isModelLoaded()).toBe(true);
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('g');
    expect(d.useAppStore.getState().activeModelId).toBe('g');
  });
});

describe('LiteRT — backends', () => {
  it('switching LiteRT models when native runs a GPU request on the CPU at a long context shows the toast', async () => {
    d = await launchGeneration({ engine: 'litert', extraModels: [{ id: 'l2', name: 'Lite 2', engine: 'litert' }] });
    d.useAppStore.getState().updateSettings({ liteRTBackend: 'gpu', liteRTMaxTokens: 16384 });
    d.boundary.litert.module.unloadModel.mockRejectedValueOnce(new Error('lt unload'));
    d.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'cpu', maxNumTokens: 16384 });
    const toasts: string[] = [];
    require('react-native').ToastAndroid.showWithGravity = (message: string) => toasts.push(message);

    await d.activeModelService.loadTextModel('l2');

    expect(toasts).toEqual([expect.stringMatching(/GPU unavailable at 16,384 token context\. Running on CPU/)]);
    expect(d.liteRTService.getActiveBackend()).toBe('cpu');
    expect(d.liteRTService.getLoadedModelPath()).toBe(modelById('l2').filePath);
    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('l2');
  });

  it('warms an NPU load up with one native turn, and skips the warmup on the CPU', async () => {
    d = await launchGeneration({ engine: 'litert', load: false, extraModels: [{ id: 'c', name: 'Cpu', engine: 'litert' }] });
    d.useAppStore.getState().updateSettings({ liteRTBackend: 'npu' });
    d.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'npu', maxNumTokens: 4096 });

    await d.activeModelService.loadTextModel('m');
    expect(d.liteRTService.getActiveBackend()).toBe('npu');
    expect(d.boundary.litert.calls.sendMessage.map(args => args[0])).toEqual(['Hi']);

    d.useAppStore.getState().updateSettings({ liteRTBackend: 'cpu' });
    d.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'cpu', maxNumTokens: 4096 });
    await d.activeModelService.loadTextModel('c');

    expect(d.liteRTService.getActiveBackend()).toBe('cpu');
    expect(d.boundary.litert.calls.sendMessage).toHaveLength(1); // no second warmup
  });

  it('hands native the vision flag of a model that carries vision', async () => {
    d = await launchGeneration({ engine: 'litert', load: false, liteRTVision: true });

    await d.activeModelService.loadTextModel('m');

    const [, , supportsVision, supportsAudio] = d.boundary.litert.calls.loadModel[0];
    expect({ supportsVision, supportsAudio }).toEqual({ supportsVision: true, supportsAudio: false });
  });
});

describe('image models', () => {
  const addImageModel = (id: string) => {
    const modelPath = `${d.boundary.fs!.DocumentDirectoryPath}/image_models/${id}`;
    for (const f of SD_MNN_PACKAGE_FILES) d.boundary.fs!.seedFile(`${modelPath}/${f}`, 1024);
    d.useAppStore.getState().addDownloadedImageModel(
      createONNXImageModel({ id, name: id, modelPath, backend: 'mnn', size: 1024 * 1024 * 1024 }),
    );
    return modelPath;
  };
  const native = () => d.boundary.diffusion.module;

  it('the first load opens the model without unloading anything', async () => {
    d = await launchGeneration({ load: false });
    const path = addImageModel('img-1');

    await d.activeModelService.loadImageModel('img-1');

    expect(native().unloadModel).not.toHaveBeenCalled();
    expect(native().loadModel).toHaveBeenCalledTimes(1);
    expect(native().loadModel.mock.calls[0][0]).toEqual(expect.objectContaining({ modelPath: path, threads: 4 }));
    expect(d.activeModelService.getLoadedModelIds().imageModelId).toBe('img-1');
    expect(d.useAppStore.getState().activeImageModelId).toBe('img-1');
    expect(d.activeModelService.getActiveModels().image.isLoading).toBe(false);
  });

  it('switching image models unloads the first natively and makes the second active', async () => {
    d = await launchGeneration({ load: false });
    addImageModel('img-1');
    const second = addImageModel('img-2');
    await d.activeModelService.loadImageModel('img-1');

    await d.activeModelService.loadImageModel('img-2');

    expect(native().unloadModel).toHaveBeenCalledTimes(1);
    expect(native().loadModel.mock.calls[1][0]).toEqual(expect.objectContaining({ modelPath: second }));
    expect(d.activeModelService.getLoadedModelIds().imageModelId).toBe('img-2');
    expect(d.useAppStore.getState().activeImageModelId).toBe('img-2');
  });

  it('reloads the same image model when the thread count changed', async () => {
    d = await launchGeneration({ load: false });
    addImageModel('img-1');
    await d.activeModelService.loadImageModel('img-1');
    d.useAppStore.getState().updateSettings({ imageThreads: 6 });

    await d.activeModelService.loadImageModel('img-1');

    expect(native().unloadModel).toHaveBeenCalledTimes(1);
    expect(native().loadModel).toHaveBeenCalledTimes(2);
    expect(native().loadModel.mock.calls[1][0]).toEqual(expect.objectContaining({ threads: 6 }));
    expect(d.activeModelService.getLoadedModelIds().imageModelId).toBe('img-1');
  });

  it('surfaces a native load failure and leaves no image model loaded', async () => {
    d = await launchGeneration({ load: false });
    addImageModel('img-1');
    native().loadModel.mockRejectedValueOnce(new Error('img load fail'));

    await expect(d.activeModelService.loadImageModel('img-1')).rejects.toThrow('img load fail');

    expect(d.activeModelService.getLoadedModelIds().imageModelId).toBeNull();
    expect(d.activeModelService.getActiveModels().image.isLoading).toBe(false);
  });
});
