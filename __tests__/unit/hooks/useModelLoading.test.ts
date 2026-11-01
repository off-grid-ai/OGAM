/**
 * useModelLoading — the Home screen's model picks and unloads.
 *
 * Picking a model only MARKS it active (no load: the first chat message loads it). Unloading frees it at
 * once and the screen shows a loading card meanwhile.
 *
 * Real: the hook, activeModelService (loads and unloads through the residency lock), llmService,
 * localDreamGenerator, the stores, the alert builder. Faked (device, harness/generationDevice): llama.rn,
 * the diffusion native module, the filesystem, RAM. The setters are the screen's own state setters.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { requireRTL } from '../../harness/nativeBoundary';
import { SD_MNN_PACKAGE_FILES } from '../../harness/imageModelPackage';
import { createONNXImageModel } from '../../utils/factories';

let d: GenerationDevice;
let rtl: ReturnType<typeof requireRTL>;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

async function phone(opts: { load?: boolean } = {}) {
  d = await launchGeneration({ load: opts.load });
  rtl = requireRTL();
  const modelPath = `${d.boundary.fs!.DocumentDirectoryPath}/image_models/img-1`;
  for (const f of SD_MNN_PACKAGE_FILES) d.boundary.fs!.seedFile(`${modelPath}/${f}`, 1024);
  const image = createONNXImageModel({ id: 'img-1', name: 'SDXL', modelPath, backend: 'mnn', size: 512 * 1024 * 1024 });
  d.useAppStore.getState().addDownloadedImageModel(image);
  return image;
}

/** The Home screen's state, as the hook sets it. */
function homeScreen() {
  const { useModelLoading } = require('../../../src/screens/HomeScreen/hooks/useModelLoading');
  const screen = { loading: [] as any[], picker: 'unset' as unknown, alert: null as any };
  const view = rtl.renderHook(() => useModelLoading({
    setLoadingState: (s: any) => screen.loading.push(s),
    setPickerType: (t: unknown) => { screen.picker = t; },
    setAlertState: (a: any) => { screen.alert = a; },
  }));
  return { screen, hook: () => view.result.current };
}

describe('useModelLoading', () => {
  it('picking a text model marks it active and closes the picker, without loading it', async () => {
    await phone({ load: false });
    d.useAppStore.getState().addDownloadedModel({ ...d.useAppStore.getState().downloadedModels[0], id: 'other' });
    const { screen, hook } = homeScreen();

    rtl.act(() => hook().handleSelectTextModel({ id: 'other' }));

    expect(d.useAppStore.getState().activeModelId).toBe('other');
    expect(screen.picker).toBeNull();
    expect(d.boundary.llama!.calls.initLlama).toHaveLength(0);
  });

  it('picking an image model marks it active and closes the picker, without loading it', async () => {
    const image = await phone();
    const { screen, hook } = homeScreen();

    rtl.act(() => hook().handleSelectImageModel(image));

    expect(d.useAppStore.getState().activeImageModelId).toBe('img-1');
    expect(screen.picker).toBeNull();
    expect(d.boundary.diffusion.module.loadModel).not.toHaveBeenCalled();
  });

  it('unloading the text model frees it, with the loading card shown meanwhile', async () => {
    await phone();
    expect(d.llmService.isModelLoaded()).toBe(true);
    const { screen, hook } = homeScreen();

    await rtl.act(async () => { await hook().handleUnloadTextModel(); });

    expect(d.llmService.isModelLoaded()).toBe(false);
    expect(d.useAppStore.getState().activeModelId).toBeNull();
    expect(screen.loading).toEqual([
      { isLoading: true, type: 'text', modelName: null },
      { isLoading: false, type: null, modelName: null },
    ]);
    expect(screen.alert).toBeNull();
  });

  it('unloading the image model frees it natively', async () => {
    await phone();
    await d.activeModelService.loadImageModel('img-1');
    const { screen, hook } = homeScreen();

    await rtl.act(async () => { await hook().handleUnloadImageModel(); });

    expect(d.boundary.diffusion.module.unloadModel).toHaveBeenCalled();
    expect(d.activeModelService.getLoadedModelIds().imageModelId).toBeNull();
    expect(screen.loading.at(-1)).toEqual({ isLoading: false, type: null, modelName: null });
    expect(screen.alert).toBeNull();
  });

  it('shows an error alert when the image model cannot be unloaded, and clears the loading card', async () => {
    await phone();
    await d.activeModelService.loadImageModel('img-1');
    d.boundary.diffusion.module.unloadModel.mockResolvedValue(false); // native: still in use
    const { screen, hook } = homeScreen();

    await rtl.act(async () => { await hook().handleUnloadImageModel(); });

    expect(screen.alert).toEqual(expect.objectContaining({ visible: true, title: 'Error', message: 'Failed to unload model' }));
    expect(screen.loading.at(-1)).toEqual({ isLoading: false, type: null, modelName: null });
  });
});
