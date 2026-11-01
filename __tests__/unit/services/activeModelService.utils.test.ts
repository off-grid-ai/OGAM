/**
 * activeModelService/utils — syncWithNativeState, which lines the loaded-model ids up with what the engines
 * actually hold (after a JS reload the engines can hold a model the service has no id for).
 *
 * The engines' state is real: the model is loaded through activeModelService (the residency lock) on the
 * native fakes, or nothing is loaded. The target is the plain record the caller hands in, read back after.
 *
 * Real: syncWithNativeState, activeModelService, llmService, liteRTService, localDreamGenerator, the stores.
 * Faked (device, harness/generationDevice): llama.rn, the LiteRT and diffusion native modules, the
 * filesystem, RAM.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { createONNXImageModel } from '../../utils/factories';

let d: GenerationDevice;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

/** The caller's record of loaded ids, as syncWithNativeState writes it. */
function target(ids: { text?: string | null; image?: string | null } = {}) {
  const t = {
    loadedTextModelId: ids.text ?? null,
    loadedImageModelId: ids.image ?? null,
    loadedImageModelThreads: 4 as number | null,
    setLoadedTextModelId: (id: string | null) => { t.loadedTextModelId = id; },
    setLoadedImageModelId: (id: string | null) => { t.loadedImageModelId = id; },
    setLoadedImageModelThreads: (n: number | null) => { t.loadedImageModelThreads = n; },
  };
  return t;
}
const sync = (t: ReturnType<typeof target>) =>
  require('../../../src/services/activeModelService/utils').syncWithNativeState(t);

describe('syncWithNativeState', () => {
  it('takes the chosen model id when a LiteRT model is loaded and the record has none', async () => {
    d = await launchGeneration({ engine: 'litert' });
    expect(d.liteRTService.isModelLoaded()).toBe(true);
    const t = target();

    await sync(t);

    expect(t.loadedTextModelId).toBe('m');
  });

  it('takes the chosen model id when a llama model is loaded and the record has none', async () => {
    d = await launchGeneration();
    expect(d.llmService.isModelLoaded()).toBe(true);
    const t = target();

    await sync(t);

    expect(t.loadedTextModelId).toBe('m');
  });

  it('keeps an id the record already has while a model is loaded', async () => {
    d = await launchGeneration({ engine: 'litert' });
    const t = target({ text: 'already-set' });

    await sync(t);

    expect(t.loadedTextModelId).toBe('already-set');
  });

  it('clears the text and image ids when no engine holds a model', async () => {
    d = await launchGeneration({ load: false });
    d.boundary.diffusion.module.isModelLoaded.mockResolvedValue(false);
    const t = target({ text: 'old-model', image: 'old-image' });

    await sync(t);

    expect(t).toEqual(expect.objectContaining({
      loadedTextModelId: null,
      loadedImageModelId: null,
      loadedImageModelThreads: null,
    }));
  });

  it('takes the chosen image model id when native holds an image model and the record has none', async () => {
    d = await launchGeneration({ load: false });
    d.useAppStore.getState().addDownloadedImageModel(createONNXImageModel({ id: 'img', backend: 'mnn' }));
    d.useAppStore.getState().setActiveImageModelId('img');
    d.boundary.diffusion.module.isModelLoaded.mockResolvedValue(true);
    const t = target();

    await sync(t);

    expect(t.loadedImageModelId).toBe('img');
  });

  it('through activeModelService, leaves a model it loaded itself as loaded', async () => {
    d = await launchGeneration();

    await d.activeModelService.syncWithNativeState();

    expect(d.activeModelService.getLoadedModelIds().textModelId).toBe('m');
    expect(d.useAppStore.getState().loadedTextModelId).toBe('m');
  });
});

describe('getResourceUsage', () => {
  it('reports the device memory and the estimated memory of the chosen text and image models', async () => {
    d = await launchGeneration({ load: false });
    d.useAppStore.getState().addDownloadedImageModel(createONNXImageModel({ id: 'img', size: 1000 }));
    d.useAppStore.getState().setActiveImageModelId('img');
    const textSize = d.useAppStore.getState().downloadedModels[0].fileSize;

    const usage = await d.activeModelService.getResourceUsage();

    expect(usage.memoryTotal).toBeGreaterThan(0);
    expect(usage.memoryUsagePercent).toBeCloseTo((usage.memoryUsed / usage.memoryTotal) * 100);
    expect(usage.estimatedModelMemory).toBeCloseTo(textSize * 1.2 + 1000 * 1.3);
  });
});
