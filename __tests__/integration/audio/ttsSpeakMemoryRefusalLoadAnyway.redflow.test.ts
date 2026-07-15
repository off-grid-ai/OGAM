/**
 * RED-FLOW (integration) — a TTS memory refusal on the SPEAK path must surface a dismissible failure
 * card with a "Load Anyway" affordance, never a silent dead-end.
 *
 * DEVICE: in voice/chat mode, tapping the speaker triggers speakMessage → initializeEngine({override:true}).
 * The override load evicts every evictable resident to free maximum RAM; if a native unload REJECTS, the
 * residency manager returns { fits: false } even under override. Pre-fix, ttsStore.initializeEngine threw a
 * PLAIN Error there, caught it into `state.error` (static red text on the Settings panel only), and the
 * speak path then bailed silently (dispatchPlayback {t:'ended'}) — the speaker icon just stopped. No alert,
 * no card, no Load Anyway. This violates "any memory refusal on any model type offers Load Anyway".
 *
 * This drives the REAL store speak() → REAL ttsPlayback.speakMessage → REAL initializeEngine → REAL
 * modelResidencyManager over the device-memory harness. Fakes ONLY at the device boundary: a fake TTS
 * engine (idle + downloaded), and a resident text model whose native unload() REJECTS (the reason override
 * can't free room). Assert the USER-FACING outcome: a `tts` failure lands in the real failure store, marked
 * overridable with an onLoadAnyway (what the ModelFailureCard renders as "Load Anyway").
 *
 * RED on HEAD: the refusal throws a plain Error → isOverridableMemoryError === false → the failure store is
 * empty (speak bailed silently); no card, no Load Anyway.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { setDeviceMemory, resetDeviceMemory } from '../../harness/deviceMemory';
import { ttsRegistry } from '../../../pro/audio/engine';
import { useTTSStore } from '../../../pro/audio/ttsStore';
import { useModelFailureStore } from '../../../src/stores/modelFailureStore';

// Device boundary: a minimal TTS engine that is idle + fully downloaded, and whose initialize() would
// succeed IF residency let it. The refusal happens in residency (before initialize), so initialize is
// never reached in the refusal case.
function makeFakeEngine() {
  let phase: 'idle' | 'ready' = 'idle';
  return {
    id: 'faketts',
    displayName: 'Fake TTS',
    capabilities: { peakRamMB: 400, generateAndSave: false },
    getPhase: () => phase,
    isSupported: () => true,
    isFullyDownloaded: () => true,
    getRequiredAssets: () => [{ id: 'model', sizeBytes: 400 * 1024 * 1024 }],
    checkAssetStatus: async () => [],
    getOverallDownloadProgress: () => 1,
    getVoices: () => [],
    getActiveVoice: () => null,
    setVoice: async () => {},
    getLastDownloadError: () => null,
    getBridgeComponent: () => null,
    hydrateDownloaded: () => {},
    on: () => () => {},
    off: () => {},
    once: () => () => {},
    initialize: async () => { phase = 'ready'; },
    release: async () => { phase = 'idle'; },
    destroy: async () => { phase = 'idle'; },
    speak: async () => {},
    stop: () => {},
    pause: () => {},
    resume: () => {},
    setSpeed: () => {},
  } as unknown as never;
}

describe('TTS speak-path memory refusal is overridable (Load Anyway) — red-flow', () => {
  afterEach(() => {
    resetDeviceMemory();
    useModelFailureStore.getState().clear();
  });

  it('surfaces a dismissible tts failure card with Load Anyway (not a silent bail)', async () => {
    // 12GB device. The voice model is a sidecar; the evict-everything force (override → singleModel)
    // evicts every evictable PEER sidecar to free maximum RAM before loading.
    setDeviceMemory({ platform: 'ios', totalGB: 12, availGB: 0.2, policy: 'balanced' });
    useModelFailureStore.getState().clear();

    // A resident peer sidecar (whisper) whose NATIVE unload REJECTS — the override force tries to evict it
    // to free room, the native unload fails, so makeRoomFor returns { fits:false } even under override.
    // This is the reachable device refusal on the evict-everything speak-turn force.
    modelResidencyManager.register(
      { key: 'whisper', type: 'whisper' as never, sizeMB: 1500, canEvict: () => true },
      async () => { throw new Error('native unload rejected'); },
      1,
    );

    ttsRegistry.register('faketts', makeFakeEngine);
    await useTTSStore.getState().setEngine('faketts');

    // The user taps the speaker on an assistant message (the real store speak action).
    await useTTSStore.getState().speak('hello there', 'msg-1');

    // USER-FACING artifact: mount the REAL ModelFailureCard (no props, no mocks — it reads the real
    // failure store the speak refusal just populated) and assert the user SEES the "Load Anyway" button
    // on the tts failure card, not a silent bail. RED on HEAD: plain Error → no tts failure in the store
    // → the card renders nothing → the button is absent.
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render } = require('@testing-library/react-native');
    const { ModelFailureCard } = require('../../../src/components/ModelFailureCard');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const view = render(React.createElement(ModelFailureCard));
    expect(view.queryByTestId('model-failure-load-anyway-tts')).not.toBeNull();
    expect(view.queryByTestId('model-failure-tts')).not.toBeNull(); // the tts failure card itself is on screen
  });
});
