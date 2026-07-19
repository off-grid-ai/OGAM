/**
 * RED-FLOW (integration) — V4: deleting a TTS model leaves residency accounting stale.
 *
 * ttsDownloadActions.deleteModels frees the engine's assets (deleteAssets) but never calls
 * modelResidencyManager.release('tts'). So the residency manager keeps a phantom TTS resident (~320MB),
 * which can wrongly refuse or evict a later text/image load. Runs the REAL deleteModels + REAL
 * modelResidencyManager; a minimal fake TTS engine stands in for the native model.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { ttsRegistry } from '../../../pro/audio/engine';
import { deleteModels } from '../../../pro/audio/ttsDownloadActions';

const fakeEngine = {
  id: 'faketts',
  deleteAssets: async () => {},
  checkAssetStatus: async () => [],
  getRequiredAssets: () => [],
  capabilities: { peakRamMB: 320 },
} as unknown as never;

describe('V4 — deleting TTS leaves residency stale (red-flow)', () => {
  it('releases the TTS residency when the TTS model is deleted', async () => {
    modelResidencyManager._reset();
    ttsRegistry.register('faketts', () => fakeEngine);
    await ttsRegistry.setActiveEngine('faketts');

    // TTS is loaded → registered as a resident (~320MB), as pro/audio/index.ts does on init.
    modelResidencyManager.register(
      { key: 'tts', type: 'tts' as never, sizeMB: 320, canEvict: () => true },
      async () => {},
      1,
    );
    expect(modelResidencyManager.isResident('tts')).toBe(true); // precondition

    // User deletes the TTS model in the Download Manager.
    await deleteModels({
      set: () => {},
      get: () => ({ playbackStatus: 'idle', isStreaming: false }),
    } as unknown as never);

    // The residency is released so its RAM stops counting against later loads.
    expect(modelResidencyManager.isResident('tts')).toBe(false);
  });
});
