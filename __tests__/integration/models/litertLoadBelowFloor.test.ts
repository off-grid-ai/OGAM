/**
 * A LiteRT load native had to clamp below a usable context is refused, not kept. Native clamps the context to
 * free RAM and, when RAM cannot even hold the weights, drops it to a token or two and leaves refusing to the
 * caller. A Load Anyway skips the memory gate, so without this every turn on that engine failed as
 * "context full".
 *
 * Real: activeModelService and its loaders, liteRTService, the stores. Faked (device,
 * harness/generationDevice): the LiteRT native module, the filesystem, RAM.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';

let d: GenerationDevice;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
  d = await launchGeneration({ engine: 'litert', load: false });
});

describe('LiteRT load below a usable context', () => {
  it('unloads and reports memory when native clamped the context to almost nothing', async () => {
    d.useAppStore.getState().updateSettings({ liteRTMaxTokens: 4096 });
    d.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'cpu', maxNumTokens: 1 });

    await expect(d.activeModelService.loadTextModel('m')).rejects.toThrow(/Not enough free memory to run this model right now/);

    expect(d.boundary.litert.module.unloadModel).toHaveBeenCalled();
    expect(d.liteRTService.isModelLoaded()).toBe(false);
  });

  it('keeps a small context the user chose', async () => {
    d.useAppStore.getState().updateSettings({ liteRTMaxTokens: 512 });
    d.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'gpu', maxNumTokens: 512 });

    await d.activeModelService.loadTextModel('m');

    expect(d.liteRTService.isModelLoaded()).toBe(true);
    expect(d.liteRTService.getContextUsage().max).toBe(512);
  });

  it('keeps a context native clamped that still reaches its floor', async () => {
    d.useAppStore.getState().updateSettings({ liteRTMaxTokens: 4096 });
    d.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'gpu', maxNumTokens: 1024 });

    await d.activeModelService.loadTextModel('m');

    expect(d.liteRTService.isModelLoaded()).toBe(true);
    expect(d.liteRTService.getContextUsage().max).toBe(1024);
  });
});
