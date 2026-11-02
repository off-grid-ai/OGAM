/**
 * activeLiteRTContextTokens — the context the loaded LiteRT engine holds, which native may have clamped
 * below the Max Tokens setting.
 *
 * Real: engines, activeModelService, liteRTService, llmService, the stores. Faked (device,
 * harness/generationDevice): the LiteRT and llama.rn native modules, the filesystem, RAM.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';

let d: GenerationDevice;
const activeLiteRTContextTokens = () => require('../../../src/services/engines').activeLiteRTContextTokens();

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

describe('activeLiteRTContextTokens', () => {
  it('is the context native loaded, not the larger setting', async () => {
    d = await launchGeneration({ engine: 'litert', load: false });
    d.useAppStore.getState().updateSettings({ liteRTMaxTokens: 4096 });
    d.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'gpu', maxNumTokens: 1024 });

    await d.activeModelService.loadTextModel('m');

    expect(activeLiteRTContextTokens()).toBe(1024);
  });

  it('is undefined while the LiteRT model is selected but not loaded', async () => {
    d = await launchGeneration({ engine: 'litert', load: false });

    expect(activeLiteRTContextTokens()).toBeUndefined();
  });

  it('is undefined when llama.cpp is the active engine', async () => {
    d = await launchGeneration();

    expect(activeLiteRTContextTokens()).toBeUndefined();
  });
});
