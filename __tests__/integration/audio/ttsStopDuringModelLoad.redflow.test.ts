/**
 * Stop pressed while the voice model is still loading must stop the playback for good. The voice
 * model is downloaded but not in memory, so tapping play on a message first loads it. If the person
 * presses Stop during that load, nothing may be synthesized or played once the load finishes.
 *
 * Real ttsStore + playback orchestration + residency, driven by the same store actions the message's
 * play and stop controls call. The TTS engine is the device boundary: idle and fully downloaded, its
 * initialize() (the native model load) held open until the test releases it, and every speak()
 * recorded.
 */
import { ttsRegistry } from '../../../pro/audio/engine';
import { useTTSStore } from '../../../pro/audio/ttsStore';

function makeHeldLoadEngine() {
  let phase: 'idle' | 'loading' | 'ready' = 'idle';
  let releaseLoad: () => void = () => {};
  const spoken: string[] = [];
  const engine = {
    id: 'heldtts',
    displayName: 'Held TTS',
    capabilities: { peakRamMB: 300, generateAndSave: false },
    getPhase: () => phase,
    isSupported: () => true,
    isFullyDownloaded: () => true,
    getRequiredAssets: () => [{ id: 'model', sizeBytes: 300 * 1024 * 1024 }],
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
    // The native load: in flight until the test releases it, then the model is ready.
    initialize: () => {
      phase = 'loading';
      return new Promise<void>(resolve => {
        releaseLoad = () => { phase = 'ready'; resolve(); };
      });
    },
    release: async () => { phase = 'idle'; },
    destroy: async () => { phase = 'idle'; },
    speak: async (text: string) => { spoken.push(text); },
    stop: () => {},
    pause: () => {},
    resume: () => {},
    setSpeed: () => {},
  };
  return { engine, spoken, releaseLoad: () => releaseLoad() };
}

describe('TTS: Stop during the voice model load', () => {
  it('synthesizes and plays nothing once the load finishes', async () => {
    const held = makeHeldLoadEngine();
    ttsRegistry.register('heldtts', () => held.engine as never);
    await useTTSStore.getState().setEngine('heldtts');

    // The person taps play on a message: the voice model starts loading.
    const playing = useTTSStore.getState().speak('Here is the summary you asked for.', 'msg-1');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(held.engine.getPhase()).toBe('loading');
    expect(useTTSStore.getState().playbackStatus).toBe('preparing');

    // They press Stop while it is still loading.
    useTTSStore.getState().stop();
    expect(useTTSStore.getState().playbackStatus).toBe('idle');

    // The load finishes. Nothing is spoken and playback stays stopped.
    held.releaseLoad();
    await playing;
    expect(held.spoken).toEqual([]);
    expect(useTTSStore.getState().playbackStatus).toBe('idle');
    expect(useTTSStore.getState().currentMessageId).toBeNull();
  });
});
