import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import type { NativeBoundary } from '../../harness/nativeBoundary';

let fixture: MobileApplicationFixture | null = null;
let boundary: NativeBoundary;
const modelIds = new Set<string>();
let originalFetch: typeof global.fetch;
let importSequence = 0;

describe('Home local model lifecycle', () => {
  beforeAll(async () => {
    boundary = installNativeBoundary({ download: true, fs: true, llama: true, whisper: true });
    originalFetch = global.fetch;
    jest.doMock('react-native-zip-archive', () => ({
      unzip: jest.fn(async (_source: string, destination: string) => {
        for (const fileName of [
          'unet.mnn',
          'unet.mnn.weight',
          'pos_emb.bin',
          'token_emb.bin',
          'tokenizer.json',
          'clip_v2.mnn',
          'clip_v2.mnn.weight',
          'vae_decoder.mnn',
          'vae_decoder.mnn.weight',
        ]) {
          boundary.fs!.seedFile(`${destination}/${fileName}`, 100);
        }
        return destination;
      }),
    }));
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
  });

  afterEach(async () => {
    requireRTL().cleanup();
    boundary.litert.module.unloadModel.mockReset().mockResolvedValue(undefined);
    boundary.diffusion.module.unloadModel.mockReset().mockResolvedValue(true);
    for (const modelId of modelIds) {
      await fixture!.application.models.remove(modelId);
    }
    modelIds.clear();
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    await fixture?.dispose();
    fixture = null;
  });

  const renderHome = () => {
    const React = require('react');
    const rtl = requireRTL();
    const { NavigationContainer } = require('@react-navigation/native');
    const { createNativeStackNavigator } = require('@react-navigation/native-stack');
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    const Stack = createNativeStackNavigator();
    const view = rtl.render(React.createElement(
      NavigationContainer,
      null,
      React.createElement(
        Stack.Navigator,
        { initialRouteName: 'Home', screenOptions: { headerShown: false } },
        React.createElement(Stack.Screen, { name: 'Home', component: HomeScreen }),
      ),
    ));
    return { rtl, view };
  };

  const importText = async () => {
    importSequence += 1;
    const fileName = `home-text-${importSequence}.litertlm`;
    const repositoryId = `offgrid/home-${importSequence}`;
    global.fetch = jest.fn(async () => new Response(JSON.stringify({
      siblings: [{ rfilename: fileName, lfs: { size: 500 * 1024 * 1024 } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const { startModelDownload } =
      require('../../../src/services/startModelDownload') as typeof import('../../../src/services/startModelDownload');
    await startModelDownload(
      repositoryId,
      {
        name: fileName,
        size: 500 * 1024 * 1024,
        quantization: 'Q4_K_M',
        downloadUrl: `https://example.test/${fileName}`,
      },
      { onError: error => { throw error; } },
    );
    const transfer = [...boundary.download!.active()].reverse().find(item => item.status === 'running');
    if (!transfer) throw new Error('Native text download did not start.');
    boundary.download!.complete(transfer.downloadId);
    const rtl = requireRTL();
    let model: ReturnType<MobileApplicationFixture['application']['models']['snapshot']>['inventory'][number] | undefined;
    await rtl.waitFor(async () => {
      const snapshot = await fixture!.refreshModels();
      model = snapshot.inventory.find(item => item.id.includes(repositoryId));
      expect(model).toBeDefined();
    });
    if (!model) throw new Error('Downloaded text model did not enter the public inventory.');
    modelIds.add(model.id);
    const activated = await fixture!.application.models.activate({
      modelId: model.id,
      requestedKind: 'text',
    });
    if (!activated.ok) throw new Error(JSON.stringify(activated.failure));
    const loaded = await fixture!.application.models.load({ modality: 'text', modelId: model.id });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure));
    return model;
  };

  const importImage = async (activate = true) => {
    const archive = `${boundary.fs!.DocumentDirectoryPath}/incoming/SDXL-Turbo-${Date.now()}-${modelIds.size}.zip`;
    boundary.fs!.seedFile(archive, 300);
    const { importMobileImageArchive } =
      require('../../../src/services/adapters/models/library/imageArchiveImportAdapter') as
        typeof import('../../../src/services/adapters/models/library/imageArchiveImportAdapter');
    const imported = await importMobileImageArchive({ sourceUri: archive, fileName: 'SDXL-Turbo.zip' });
    if (imported.status !== 'imported') throw new Error(imported.error);
    modelIds.add(imported.model.id);
    await fixture!.refreshModels();
    if (activate) {
      const activated = await fixture!.application.models.activate({
        modelId: imported.model.id,
        requestedKind: 'image',
      });
      if (!activated.ok) throw new Error(JSON.stringify(activated.failure));
    }
    return imported.model;
  };

  const openTextPicker = async () => {
    const model = await importText();
    const rendered = renderHome();
    rendered.rtl.fireEvent.press(rendered.view.getByTestId('models-summary'));
    rendered.rtl.fireEvent.press(await rendered.view.findByTestId('models-row-text'));
    await rendered.view.findByText('Unload');
    return { ...rendered, model };
  };

  const openImagePicker = async () => {
    const model = await importImage();
    const rendered = renderHome();
    rendered.rtl.fireEvent.press(rendered.view.getByTestId('models-summary'));
    rendered.rtl.fireEvent.press(await rendered.view.findByTestId('models-row-image'));
    return { ...rendered, model };
  };

  it('marks an imported image active without an eager runtime load', async () => {
    const model = await importImage(false);
    const { rtl, view } = renderHome();
    rtl.fireEvent.press(view.getByTestId('models-summary'));
    rtl.fireEvent.press(await view.findByTestId('models-row-image'));
    rtl.fireEvent.press(await view.findByTestId(`image-model-row-${model.id}`));
    await rtl.waitFor(() => expect(fixture!.application.models.activeModelId('image')).toBe(model.id));
    expect(fixture!.application.models.snapshot().residents.some(item => item.type === 'image')).toBe(false);
  });

  it('unloads a resident text model through the application', async () => {
    const { rtl, view } = await openTextPicker();
    rtl.fireEvent.press(view.getByText('Unload'));
    await rtl.waitFor(() => expect(fixture!.application.models.activeModelId('text')).toBeNull());
    expect(fixture!.application.models.snapshot().residents.some(item => item.type === 'text')).toBe(false);
  });

  it('shows an error and keeps text selected when native unload fails', async () => {
    const { rtl, view, model } = await openTextPicker();
    boundary.litert.module.unloadModel.mockRejectedValueOnce(new Error('Native text unload failed.'));
    rtl.fireEvent.press(view.getByText('Unload'));
    expect(await view.findByText('Failed to unload model')).toBeTruthy();
    expect(fixture!.application.models.activeModelId('text')).toBe(model.id);
  });

  it('keeps the image selected when native unload fails', async () => {
    const { rtl, view, model } = await openImagePicker();
    boundary.diffusion.module.unloadModel.mockRejectedValueOnce(new Error('Native image unload failed.'));
    rtl.fireEvent.press(await view.findByText('Unload'));
    await view.findByTestId('currently-loaded-image-model');
    expect(fixture!.application.models.activeModelId('image')).toBe(model.id);
  });

  it('shows the native eject-all failure', async () => {
    const model = await importImage();
    const loaded = await fixture!.application.models.load({
      modality: 'image',
      modelId: model.id,
    });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure));
    const residentIdentity = fixture!.application.models.snapshot().residents
      .find(resident => resident.type === 'image')?.key;
    if (!residentIdentity) throw new Error('The loaded image has no public resident identity.');
    boundary.diffusion.module.unloadModel.mockRejectedValueOnce(new Error('Native image unload failed.'));
    const { rtl, view } = renderHome();
    rtl.fireEvent.press(view.getByTestId('models-summary'));
    rtl.fireEvent.press(await view.findByText('Eject All Models'));
    rtl.fireEvent.press(await view.findByText('Eject All'));
    expect(await view.findByText(
      `Model ejection was incomplete. Still loaded: ${residentIdentity}. ` +
      `Cleanup failed: resident ${residentIdentity}: the image engine did not release its model.`,
    )).toBeTruthy();
  });

  it('shows loading while native text unload is in progress', async () => {
    const { rtl, view } = await openTextPicker();
    let releaseUnload!: () => void;
    boundary.litert.module.unloadModel.mockImplementationOnce(
      () => new Promise<void>(resolve => { releaseUnload = resolve; }),
    );
    rtl.fireEvent.press(view.getByText('Unload'));
    rtl.fireEvent.press(view.getByTestId('models-summary'));
    expect(await view.findByText('Loading...')).toBeTruthy();
    releaseUnload();
    await rtl.waitFor(() => expect(fixture!.application.models.activeModelId('text')).toBeNull());
  });

  it('shows eject all when an image model is active', async () => {
    await importImage();
    const { rtl, view } = renderHome();
    rtl.fireEvent.press(view.getByTestId('models-summary'));
    expect(await view.findByText('Eject All Models')).toBeTruthy();
  });

  it('shows the unload control for an active image model', async () => {
    const { view } = await openImagePicker();
    expect(await view.findByTestId('currently-loaded-image-model')).toBeTruthy();
    expect(view.getByText('Unload')).toBeTruthy();
  });

  it('unloads the active image model from the picker', async () => {
    const { rtl, view } = await openImagePicker();
    rtl.fireEvent.press(await view.findByText('Unload'));
    await rtl.waitFor(() => expect(fixture!.application.models.activeModelId('image')).toBeNull());
    expect(view.queryByTestId('currently-loaded-image-model')).toBeNull();
  });
});
