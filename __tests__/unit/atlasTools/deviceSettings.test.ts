/**
 * Restoring a phone's backup on a tablet keeps the tablet's own hardware settings and model
 * list (a phone's NPU backend restored on a tablet stopped every model loading), while the
 * person's choices (name, appearance, system prompt) come across.
 */
import { keepThisDevice } from '../../../src/atlasTools/deviceSettings';

const app = (state: object) => JSON.stringify({ state, version: 3 });

it('keeps the tablet\'s backend, threads, cache, context and models when restoring the phone\'s settings', () => {
  const phone = app({
    themeMode: 'dark', activeModelId: 'phone-model', downloadedModels: [{ id: 'phone-model' }],
    settings: { userName: 'Alex', systemPrompt: 'Be brief', inferenceBackend: 'npu', nThreads: 8, cacheType: 'q4_0',
      gpuLayers: 40, contextLength: 16384, flashAttn: true, nBatch: 1024 },
  });
  const tablet = app({
    themeMode: 'light', activeModelId: 'tablet-model', downloadedModels: [{ id: 'tablet-model' }],
    settings: { userName: 'old', inferenceBackend: 'auto', nThreads: 0, cacheType: 'q8_0', gpuLayers: 99, contextLength: 4096 },
  });
  const restored = JSON.parse(keepThisDevice(tablet, phone)).state;
  expect(restored.themeMode).toBe('dark');
  expect(restored.settings).toEqual({ userName: 'Alex', systemPrompt: 'Be brief', inferenceBackend: 'auto', nThreads: 0, cacheType: 'q8_0', gpuLayers: 99, contextLength: 4096 });
  expect(restored.activeModelId).toBe('tablet-model');
  expect(restored.downloadedModels).toEqual([{ id: 'tablet-model' }]);
});

it('on a new device with nothing saved, leaves hardware settings to that device\'s defaults', () => {
  const phone = app({ activeModelId: 'phone-model', settings: { userName: 'Alex', inferenceBackend: 'npu', nThreads: 8 } });
  const restored = JSON.parse(keepThisDevice(null, phone)).state;
  expect(restored.settings).toEqual({ userName: 'Alex' });
  expect(restored).not.toHaveProperty('activeModelId');
});
