/**
 * useModelsScreen, the Models screen's orchestrator, on the real stack.
 *
 * Only the device boundary is faked: the in-memory disk, the native background downloader (a started
 * download stays running), the native unzip (a fake zip on disk unpacks into its files), the system
 * file picker, async-storage, the phone's platform and RAM, and the Hugging Face image catalog at
 * fetch. The hook runs on the real navigation stack with the real useTextModels / useImageModels,
 * modelManager, backgroundDownloadService, the stores and the alert queue.
 *
 * Outcomes are read from what the hook hands the screen (tab, alert, import progress, counts, lists),
 * the model registry on disk, the download store and the native downloader's rows.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';
import { installImageDownloadDevice, type ImageDownloadDevice } from '../../../harness/imageDownloadDevice';
import { serveHfImageCatalog, lfsFile, type HfImageCatalogServer } from '../../../harness/hfImageCatalogServer';
import { renderHookInNavigator, type NavigatorHook } from '../../../harness/navigatorHook';
import { createModelFile, createModelInfo } from '../../../utils/factories';

jest.unmock('@react-navigation/native');

type ModelsScreen = ReturnType<typeof import('../../../../src/screens/ModelsScreen/useModelsScreen').useModelsScreen>;
type Picked = { uri: string; name: string; size?: number };

const GB = 1024 * 1024 * 1024;

let device: ModelManagerDevice;
let image: ImageDownloadDevice;
let catalog: HfImageCatalogServer;
let view: NavigatorHook<ModelsScreen>;
let picker: { pick: jest.Mock; isErrorWithCode: jest.Mock };
let useAppStore: typeof import('../../../../src/stores').useAppStore;
let useDownloadStore: typeof import('../../../../src/stores/downloadStore').useDownloadStore;

async function mount(platform: 'ios' | 'android' = 'ios') {
  device = await installModelManagerDevice({ platform });
  image = installImageDownloadDevice(device.boundary);
  catalog = serveHfImageCatalog({ mnn: [lfsFile('AnythingV5.zip', 1.2 * GB)] });
  // The system document picker: it answers what the person picked. Its error type carries a `code`,
  // as @react-native-documents/picker's own errors do.
  picker = require('@react-native-documents/picker');
  picker.pick.mockReset();
  picker.isErrorWithCode.mockImplementation((error: unknown) => !!error && typeof error === 'object' && 'code' in error);
  ({ useAppStore } = require('../../../../src/stores'));
  ({ useDownloadStore } = require('../../../../src/stores/downloadStore'));
  await require('../../../../src/services').hardwareService.getDeviceInfo();
  const { useModelsScreen } = require('../../../../src/screens/ModelsScreen/useModelsScreen');
  view = await renderHookInNavigator<ModelsScreen>(() => useModelsScreen(), { screen: 'Models', otherRoutes: ['Chat'] });
  await settle();
}

afterEach(() => {
  view?.unmount();
  catalog?.restore();
});

const current = () => view.result.current;

async function settle() {
  await view.rtl.act(async () => { await device.settle(); });
}

async function act(fn: (screen: ModelsScreen) => unknown) {
  await view.rtl.act(async () => { await fn(current()); await device.settle(); });
}

function picks(files: Picked[]) {
  picker.pick.mockResolvedValueOnce(files);
}

async function importPicked(files: Picked[]) {
  picks(files);
  await act(screen => screen.handleImportLocalModel());
}

const imageModels = () => device.modelManager.getDownloadedImageModels();

// ── the screen's state ───────────────────────────────────────────────

describe('tabs', () => {
  it('opens on the text tab, not importing', async () => {
    await mount();

    expect(current().activeTab).toBe('text');
    expect(current().isImporting).toBe(false);
    expect(current().importProgress).toBeNull();
  });

  it('switches tab and closes the open filters', async () => {
    await mount();
    await act(screen => screen.setTextFiltersVisible(true));

    await act(screen => screen.setActiveTab('image'));

    expect(current().activeTab).toBe('image');
    expect(current().textFiltersVisible).toBe(false);
  });
});

// ── importing a model file ───────────────────────────────────────────

describe('importing from Files', () => {
  it('does nothing when the person picks nothing', async () => {
    await mount();

    await importPicked([]);

    expect(current().isImporting).toBe(false);
    expect(current().alertState.visible).toBe(false);
  });

  it.each([
    ['one file of the wrong type', [{ uri: '/picked/doc.pdf', name: 'doc.pdf', size: 100 }]],
    ['a model with a non-model file', [{ uri: '/picked/a.gguf', name: 'a.gguf', size: 4000 }, { uri: '/picked/b.pdf', name: 'b.pdf', size: 100 }]],
  ])('refuses %s as an invalid file', async (_case, files) => {
    await mount();

    await importPicked(files);

    expect(current().alertState.title).toBe('Invalid File');
    expect(current().isImporting).toBe(false);
    expect(await device.modelManager.getDownloadedModels()).toEqual([]);
  });

  it('refuses more than two model files', async () => {
    await mount();

    await importPicked([
      { uri: '/picked/a.gguf', name: 'a.gguf', size: 4000 },
      { uri: '/picked/b.gguf', name: 'b.gguf', size: 300 },
      { uri: '/picked/c.gguf', name: 'c.gguf', size: 200 },
    ]);

    expect(current().alertState.title).toBe('Too Many Files');
    expect(current().isImporting).toBe(false);
  });

  it('stays quiet when the person cancels the picker', async () => {
    await mount();
    picker.pick.mockRejectedValueOnce({ code: 'OPERATION_CANCELED' });

    await act(screen => screen.handleImportLocalModel());

    expect(current().alertState.visible).toBe(false);
    expect(current().isImporting).toBe(false);
  });

  it('says the import failed when the picker fails', async () => {
    await mount();
    picker.pick.mockRejectedValueOnce(new Error('Pick failed'));

    await act(screen => screen.handleImportLocalModel());

    expect(current().alertState.title).toBe('Import Failed');
  });

  it('copies a picked GGUF into the library and lists it', async () => {
    await mount();
    device.fs.seedFile('/picked/test.gguf', 4000);

    await importPicked([{ uri: '/picked/test.gguf', name: 'test.gguf', size: 4000 }]);

    expect(current().alertState.title).toBe('Success');
    expect(current().isImporting).toBe(false);
    expect(current().importProgress).toBeNull();
    expect(await device.fs.exists(`${device.modelsDir}/test.gguf`)).toBe(true);
    expect(current().downloadedModels.map(m => m.fileName)).toEqual(['test.gguf']);
  });

  it('opens the picker once while an import is still copying', async () => {
    await mount();
    device.fs.seedFile('/picked/test.gguf', 4000);
    const copy = device.holdNextCopy();
    picks([{ uri: '/picked/test.gguf', name: 'test.gguf', size: 4000 }]);
    let first!: Promise<void>;
    await view.rtl.act(async () => { first = current().handleImportLocalModel(); await device.settle(); });
    expect(current().isImporting).toBe(true);

    await act(screen => screen.handleImportLocalModel());

    expect(picker.pick).toHaveBeenCalledTimes(1);
    copy.release();
    await view.rtl.act(async () => { await first; await device.settle(); });
    expect(current().downloadedModels.map(m => m.fileName)).toEqual(['test.gguf']);
  });
});

describe('importing an image model zip', () => {
  async function importZip(name: string, entries: Record<string, number>) {
    image.seedZip(`/picked/${name}`, entries, 1000);
    await importPicked([{ uri: `/picked/${name}`, name, size: 1000 }]);
    const [model] = await imageModels();
    return model;
  }

  it('moves the zip in on iOS, unpacks it and registers a GPU model', async () => {
    await mount('ios');

    const model = await importZip('TestModel.zip', { 'unet.mnn': 1024, 'vae.mnn': 512 });

    expect(current().alertState.title).toBe('Success');
    expect(model).toEqual(expect.objectContaining({ name: 'TestModel', backend: 'mnn', size: 1536 }));
    expect(await device.fs.exists('/picked/TestModel.zip')).toBe(false);
    expect(await device.fs.exists(`${model.modelPath}/unet.mnn`)).toBe(true);
  });

  it('copies the zip on Android and reads an NPU model from its .bin files', async () => {
    await mount('android');

    const model = await importZip('QNNModel.zip', { 'model.bin': 2048 });

    expect(model.backend).toBe('qnn');
    expect(await device.fs.exists('/picked/QNNModel.zip')).toBe(true);
  });

  it('reads a Core ML model from its .mlmodelc bundle', async () => {
    await mount('ios');

    const model = await importZip('CoreMLModel.zip', { 'Unet.mlmodelc/weights.bin': 4096 });

    expect(model.backend).toBe('coreml');
    expect(model.modelPath).toMatch(/local_CoreMLModel_\d+$/);
  });

  it('finds a Core ML model nested one folder down', async () => {
    await mount('ios');

    const model = await importZip('NestedCoreML.zip', { 'compiled/Unet.mlmodelc/weights.bin': 4096 });

    expect(model.backend).toBe('coreml');
    expect(model.modelPath).toMatch(/\/compiled$/);
  });

  it('makes the imported model active when none is', async () => {
    await mount();

    const model = await importZip('Test.zip', { 'unet.mnn': 1024 });

    expect(useAppStore.getState().activeImageModelId).toBe(model.id);
  });

  it('keeps the active image model when one is already chosen', async () => {
    await mount();
    const first = await importZip('First.zip', { 'unet.mnn': 1024 });

    await importZip('Second.zip', { 'unet.mnn': 1024 });

    expect((await imageModels()).length).toBe(2);
    expect(useAppStore.getState().activeImageModelId).toBe(first.id);
  });
});

// ── refresh, counts, downloads ───────────────────────────────────────

describe('refresh and counts', () => {
  it('pull-to-refresh picks up a model added outside the screen and ends refreshing', async () => {
    await mount();
    device.fs.seedFile('/picked/other.gguf', 4000);
    await device.modelManager.importLocalModel({ sourceUri: '/picked/other.gguf', fileName: 'other.gguf' });
    expect(current().downloadedModels).toEqual([]);

    await act(screen => screen.handleRefresh());

    expect(current().downloadedModels.map(m => m.fileName)).toEqual(['other.gguf']);
    expect(current().isRefreshing).toBe(false);
  });

  it('counts text models, image models and downloads in flight', async () => {
    await mount();
    for (const name of ['a.gguf', 'b.gguf']) {
      device.fs.seedFile(`/picked/${name}`, 4000);
      await importPicked([{ uri: `/picked/${name}`, name, size: 4000 }]);
    }
    image.seedZip('/picked/Img.zip', { 'unet.mnn': 1024 }, 1000);
    await importPicked([{ uri: '/picked/Img.zip', name: 'Img.zip', size: 1000 }]);
    const file = createModelFile({ name: 'c-Q4_K_M.gguf', size: 100_000_000 });
    image.serve(file.downloadUrl, { hold: true });
    await act(screen => screen.handleDownload(createModelInfo({ id: 'org/c', name: 'C' }), file));

    // 2 text + 1 image + 1 in flight
    expect(current().totalModelCount).toBe(4);
    expect(current().activeDownloadCount).toBe(1);
  });

  it('starts a text download even with two already running, without a "too many" warning', async () => {
    await mount();
    const files = ['a', 'b', 'c'].map(n => createModelFile({ name: `${n}-Q4_K_M.gguf`, size: 100_000_000, downloadUrl: `https://huggingface.co/org/${n}/resolve/main/${n}-Q4_K_M.gguf` }));
    files.forEach(f => image.serve(f.downloadUrl, { hold: true }));

    for (const [i, f] of files.entries()) {
      await act(screen => screen.handleDownload(createModelInfo({ id: `org/${'abc'[i]}`, name: f.name }), f));
    }

    expect(image.startedUrls()).toEqual(files.map(f => f.downloadUrl));
    expect(Object.keys(useDownloadStore.getState().downloads)).toHaveLength(3);
    expect(current().alertState.visible).toBe(false);
  });

  it('starts an image download from the image list', async () => {
    await mount('android');
    const url = 'https://example.com/img-model.zip';
    image.serve(url, { hold: true });

    await act(screen => screen.handleDownloadImageModel({
      id: 'img-model', name: 'Test Model', description: 'Test', downloadUrl: url, size: 100, style: 'default', backend: 'mnn',
    }));

    expect(image.startedUrls()).toEqual([url]);
    expect(useDownloadStore.getState().downloads['image:img-model']).toBeDefined();
  });
});

// ── the image catalog loads when the image tab opens ─────────────────

describe('the image catalog', () => {
  const treeRequests = () => catalog.requests.filter(url => url.includes('/tree/'));

  it('is not fetched on the text tab, and is fetched when the image tab opens', async () => {
    await mount('android');
    expect(treeRequests()).toEqual([]);

    await act(screen => screen.setActiveTab('image'));
    await view.rtl.waitFor(() => expect(current().availableHFModels.some(m => m.id === 'anythingv5_cpu')).toBe(true));

    expect(treeRequests().length).toBeGreaterThan(0);
  });

  it('is not fetched again while it is still loading', async () => {
    await mount('android');
    view.rtl.act(() => { current().setActiveTab('image'); });
    expect(current().hfModelsLoading).toBe(true);

    view.rtl.act(() => { current().setActiveTab('text'); });
    view.rtl.act(() => { current().setActiveTab('image'); });
    await view.rtl.waitFor(() => expect(current().hfModelsLoading).toBe(false));

    // One load: the GPU pack listing was asked for once.
    expect(treeRequests().filter(url => url.includes('xororz/sd-mnn'))).toHaveLength(1);
  });

  it('is not fetched again once loaded', async () => {
    await mount('android');
    await act(screen => screen.setActiveTab('image'));
    await view.rtl.waitFor(() => expect(current().hfModelsLoading).toBe(false));
    const loaded = treeRequests().length;

    await act(screen => screen.setActiveTab('text'));
    await act(screen => screen.setActiveTab('image'));

    expect(treeRequests().length).toBe(loaded);
  });
});
