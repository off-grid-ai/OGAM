/**
 * activeModelService.supportsAudioInput — whether the active model takes audio directly, so Audio Mode can
 * skip Whisper without the UI branching on the engine.
 *
 * Each case loads a real model through activeModelService (the residency lock) and reads the answer:
 *  - LiteRT: the model's audio flag goes to native with the load; the engine answers from what it loaded.
 *  - llama: the projector native started reports whether it takes audio.
 *
 * Real: activeModelService, its loaders, llmService, liteRTService, the residency manager, the stores.
 * Faked (device, harness/nativeBoundary): llama.rn (and the projector's reported support), the LiteRT
 * native module, the filesystem, RAM.
 */
import { installNativeBoundary, GB, type NativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

interface Phone {
  boundary: NativeBoundary;
  activeModelService: any;
  useAppStore: any;
}

/** A phone with one downloaded model on disk (and, for llama, an audio/vision projector beside it). */
function phone(model: { engine: 'llama' | 'litert'; liteRTAudio?: boolean; projector?: 'audio' | 'vision' }): Phone {
  const boundary = installNativeBoundary({
    llama: true,
    fs: true,
    llamaVision: model.projector === 'vision',
    llamaAudio: model.projector === 'audio',
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  const dir = `${boundary.fs!.DocumentDirectoryPath}/models`;
  const fileName = model.engine === 'llama' ? 'm.gguf' : 'm.litertlm';
  boundary.fs!.seedFile(`${dir}/${fileName}`, 500 * 1024 * 1024);
  const projector = model.projector ? `${dir}/m-mmproj-f16.gguf` : undefined;
  if (projector) boundary.fs!.seedFile(projector, 80 * 1024 * 1024);
  const { useAppStore } = require('../../../src/stores');
  const { activeModelService } = require('../../../src/services/activeModelService');
  useAppStore.getState().addDownloadedModel(createDownloadedModel({
    id: 'm',
    name: 'Model',
    engine: model.engine,
    filePath: `${dir}/${fileName}`,
    fileName,
    fileSize: 2 * GB,
    liteRTAudio: model.liteRTAudio,
    ...(projector ? { mmProjPath: projector, mmProjFileName: 'm-mmproj-f16.gguf', isVisionModel: true } : {}),
  }));
  activeModelService.selectTextModel('m');
  return { boundary, activeModelService, useAppStore };
}

describe('activeModelService.supportsAudioInput', () => {
  it('is false when no model is chosen', () => {
    const p = phone({ engine: 'llama' });
    p.useAppStore.getState().setActiveModelId(null);

    expect(p.activeModelService.supportsAudioInput()).toBe(false);
  });

  it('is true once a LiteRT model that carries audio has loaded, and native was told it takes audio', async () => {
    const p = phone({ engine: 'litert', liteRTAudio: true });
    expect(p.activeModelService.supportsAudioInput()).toBe(false); // chosen, not loaded yet

    await p.activeModelService.loadTextModel('m');

    expect(p.boundary.litert.calls.loadModel[0][3]).toBe(true);
    expect(p.activeModelService.supportsAudioInput()).toBe(true);
  });

  it('is false for a loaded LiteRT model without audio', async () => {
    const p = phone({ engine: 'litert', liteRTAudio: false });

    await p.activeModelService.loadTextModel('m');

    expect(p.boundary.litert.calls.loadModel[0][3]).toBe(false);
    expect(p.activeModelService.supportsAudioInput()).toBe(false);
  });

  it('is true for a loaded llama model whose projector reports audio', async () => {
    const p = phone({ engine: 'llama', projector: 'audio' });

    await p.activeModelService.loadTextModel('m');

    expect(p.activeModelService.supportsAudioInput()).toBe(true);
  });

  it('is false for a loaded llama model whose projector is vision-only', async () => {
    const p = phone({ engine: 'llama', projector: 'vision' });

    await p.activeModelService.loadTextModel('m');

    expect(p.activeModelService.getActiveModels().text.isLoaded).toBe(true);
    expect(p.activeModelService.supportsAudioInput()).toBe(false);
  });

  it('is false for a llama model with an audio projector that has not loaded yet, and true once it has', async () => {
    const p = phone({ engine: 'llama', projector: 'audio' });

    expect(p.activeModelService.supportsAudioInput()).toBe(false);
    await p.activeModelService.loadTextModel('m');
    expect(p.activeModelService.supportsAudioInput()).toBe(true);
  });
});
