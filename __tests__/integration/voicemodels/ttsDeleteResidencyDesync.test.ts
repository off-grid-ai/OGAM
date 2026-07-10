/**
 * Voice-model BUG HUNT — deleting the active TTS model leaves the residency manager
 * accounting for RAM that was freed (residency ↔ delete desync).
 *
 * deleteModels() (pro/audio/ttsDownloadActions.ts) calls engine.deleteAssets(),
 * which release()s the engine and frees its executorch RAM. But it never tells
 * modelResidencyManager, so the manager keeps `key:'tts'` (sizeMB 320) in its
 * residents map. From then on the budget over-counts: the manager believes 320MB of
 * TTS is resident when the model is gone from both disk AND RAM. A subsequent
 * generation-model load then sees phantom TTS pressure — it may evict a real model
 * or refuse a load that would actually fit.
 *
 * We drive the REAL modelResidencyManager and the REAL deleteModels action (the
 * engine's deleteAssets is best-effort via the mocked executorch fetcher). Terminal
 * artifact asserted: after deleting the TTS model, residency must NOT still report
 * 'tts' as resident.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { deleteModels } from '../../../pro/audio/ttsDownloadActions';
import { ttsRegistry } from '../../../pro/audio/engine';

describe('deleting the active TTS model must not leave residency accounting stale', () => {
  beforeEach(() => {
    modelResidencyManager._reset();
  });
  afterEach(() => {
    modelResidencyManager._reset();
  });

  // BUG: deleteModels frees the engine RAM but never tells residency, so 'tts' stays
  // counted. `it.failing` passes while the desync exists; flips red once deleteModels
  // releases/updates residency (then drop .failing).
  it.failing('after deleteModels, modelResidencyManager no longer reports tts resident', async () => {
    // Make kokoro the active engine so deleteModels has an engine to act on.
    await ttsRegistry.setActiveEngine('kokoro');

    // Model is loaded/resident (as after a speak turn or boot preload).
    let released = false;
    modelResidencyManager.register(
      { key: 'tts', type: 'tts', sizeMB: 320 },
      async () => { released = true; },
    );
    expect(modelResidencyManager.isResident('tts')).toBe(true);

    // Drive the REAL delete action through the store deps shape it expects.
    const state: Record<string, unknown> = { settings: { engineId: 'kokoro', modelDownloaded: { kokoro: true } } };
    await deleteModels({
      get: () => state,
      set: (partial: unknown) => {
        const patch = typeof partial === 'function'
          ? (partial as (s: typeof state) => Partial<typeof state>)(state)
          : (partial as Partial<typeof state>);
        Object.assign(state, patch);
      },
    });

    // TERMINAL ARTIFACT: residency must have dropped 'tts' — the model is gone from
    // disk and RAM, so the manager must not keep accounting for its 320MB.
    expect(modelResidencyManager.isResident('tts')).toBe(false);
    // (released via residency's own unload is one valid mechanism; the invariant is
    // simply that 'tts' is no longer counted.)
    void released;
  });
});
