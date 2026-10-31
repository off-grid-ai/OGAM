/**
 * useEjectAllModels — the Eject All affordance on Home and in Chat.
 *
 * Two things matter to a user. Whether the button is offered at all: it must be offered exactly when something is
 * LOADED - a local text model, a local image model, or a model in use on a remote server - and not merely selected.
 * Eject keeps the selection by design (the rows still show the chosen models, which reload on demand), so an offer
 * derived from the selection stayed after everything was ejected, and a second tap ejected nothing. And that pressing
 * it unloads what is loaded and reports how many were ejected.
 *
 * The phone is the boundary: models load through activeModelService on the fake native engines (llama.rn and the
 * diffusion module, harness/generationDevice), under the residency lock as in the app. The remote pair is set through
 * the remote store's own actions, the path remoteServerManager takes when a server model is picked.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { requireRTL } from '../../harness/nativeBoundary';
import { SD_MNN_PACKAGE_FILES } from '../../harness/imageModelPackage';
import { createONNXImageModel } from '../../utils/factories';

let device: GenerationDevice;
let rtl: ReturnType<typeof requireRTL>;

/** A phone with a downloaded, selected text model; `load` loads it. */
async function phone(load: boolean) {
  device = await launchGeneration({ load });
  rtl = requireRTL();
}

/** The Eject All control as Home and Chat use it. */
function ejectControl() {
  const { useEjectAllModels } = require('../../../src/hooks/useEjectAllModels');
  return rtl.renderHook(() => useEjectAllModels()).result as {
    current: { hasActiveModel: boolean; ejectAll: () => Promise<number> };
  };
}

/** Download an image model to the phone and load it through the app's load path. */
async function loadImageModel(id = 'img-1') {
  const modelPath = `${device.boundary.fs!.DocumentDirectoryPath}/image_models/${id}`;
  for (const f of SD_MNN_PACKAGE_FILES) device.boundary.fs!.seedFile(`${modelPath}/${f}`, 1024);
  device.useAppStore
    .getState()
    .addDownloadedImageModel(createONNXImageModel({ id, name: id, modelPath, backend: 'mnn', size: 1024 * 1024 * 1024 }));
  await rtl.act(async () => {
    await device.activeModelService.loadImageModel(id);
  });
}

async function press(control: ReturnType<typeof ejectControl>) {
  let count = -1;
  await rtl.act(async () => {
    count = await control.current.ejectAll();
  });
  return count;
}

describe('useEjectAllModels', () => {
  it('offers nothing to eject when a model is chosen but nothing is loaded', async () => {
    await phone(false);
    expect(device.useAppStore.getState().activeModelId).toBeTruthy();
    expect(ejectControl().current.hasActiveModel).toBe(false);
  });

  it('offers the eject when a local text model is loaded', async () => {
    await phone(true);
    expect(ejectControl().current.hasActiveModel).toBe(true);
  });

  it('offers the eject when the only thing loaded is a local image model', async () => {
    await phone(false);
    const control = ejectControl();
    await loadImageModel();
    expect(control.current.hasActiveModel).toBe(true);
  });

  it.each([
    ['a remote text model', 'setActiveRemoteTextModelId'],
    ['a remote image model', 'setActiveRemoteImageModelId'],
  ])('offers the eject when the only thing in use is %s', async (_what, action) => {
    await phone(false);
    const control = ejectControl();
    rtl.act(() => {
      device.useRemoteServerStore.getState()[action]('srv/model');
    });
    expect(control.current.hasActiveModel).toBe(true);
  });

  it('ejects what is loaded, stops offering itself, and comes back when a model loads again', async () => {
    await phone(true);
    const control = ejectControl();
    await loadImageModel();
    expect(control.current.hasActiveModel).toBe(true);

    // The count shown to the user is the number the owner of the unload actually ejected.
    expect(await press(control)).toBe(2);
    expect(device.llmService.isModelLoaded()).toBe(false);
    // Nothing is loaded now, so there is nothing to offer, while the choice of models stays.
    expect(control.current.hasActiveModel).toBe(false);
    expect(device.useAppStore.getState().activeModelId).toBeTruthy();

    await rtl.act(async () => {
      await device.activeModelService.loadTextModel(device.modelId);
    });
    expect(control.current.hasActiveModel).toBe(true);
  });
});
