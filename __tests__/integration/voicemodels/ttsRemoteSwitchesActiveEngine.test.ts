/**
 * Voice-model BUG HUNT — deleting/retrying a NON-active TTS engine's model from the
 * Download Manager silently switches the user's active TTS engine.
 *
 * ttsProvider.remove()/retry() and the downloads.deleteVoiceModel hook all do:
 *   if (engineId !== active) await setEngine(engineId); then delete/download.
 * So a management op on engine B (from the DM) makes B the ACTIVE engine — and after
 * a delete, B now has no model on disk. The user's previously-selected, working
 * engine A is silently deselected, and the active engine points at an unusable one.
 *
 * This is LATENT today because engine/index.ts registers only 'kokoro'. It becomes
 * reachable the instant a second engine is registered (outetts/qwen3 are in the tree,
 * intentionally deferred). To prove the seam without editing source, we register a
 * second engine into the REAL ttsRegistry for this test and drive the REAL
 * ttsProvider.remove(). Terminal artifact asserted: removing the non-active engine's
 * model must NOT change which engine is active.
 */
import { ttsRegistry, KokoroEngine, OuteTTSEngine } from '../../../pro/audio/engine';
import { ttsProvider } from '../../../pro/audio/ttsDownloadProvider';
import { useTTSStore } from '../../../pro/audio/ttsStore';

describe('removing a non-active voice model must not switch the active engine', () => {
  const hadOute = ttsRegistry.has('outetts');

  beforeAll(() => {
    if (!hadOute) ttsRegistry.register('outetts', () => new OuteTTSEngine());
    if (!ttsRegistry.has('kokoro')) ttsRegistry.register('kokoro', () => new KokoroEngine());
  });
  afterAll(async () => {
    if (!hadOute) await ttsRegistry.unregister('outetts');
  });

  it('precondition: two engines registered and active engine is kokoro', async () => {
    expect(ttsRegistry.getRegisteredIds()).toEqual(
      expect.arrayContaining(['kokoro', 'outetts']),
    );
    await useTTSStore.getState().setEngine('kokoro');
    expect(useTTSStore.getState().settings.engineId).toBe('kokoro');
  });

  // BUG (latent until a 2nd engine ships): remove() switches the active engine.
  // `it.failing` passes while the bug exists; flips red once remove/retry act on the
  // target engine WITHOUT hijacking the active selection (then drop .failing).
  it.failing('active engine stays kokoro after removing the outetts model via the DM', async () => {
    await useTTSStore.getState().setEngine('kokoro');
    // Delete the OTHER engine's (outetts) model from the Download Manager.
    await ttsProvider.remove('tts:outetts').catch(() => { /* delete best-effort */ });
    // TERMINAL ARTIFACT: the user's active engine must remain kokoro. A DM management
    // op on a different engine must never hijack the active-engine selection.
    expect(useTTSStore.getState().settings.engineId).toBe('kokoro');
  });
});
