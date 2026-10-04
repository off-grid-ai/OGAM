/**
 * RED-FLOW (integration) — V4: deleting the voice model must not leave residency accounting stale.
 *
 * A loaded voice runtime registers a resident against the REAL residency budget. Deleting the
 * downloaded voice assets frees the native RAM, so the canonical residency entry must go with it.
 * If it survives, the device keeps charging the budget for memory it no longer holds and a later
 * text/image admission is refused by arithmetic alone (phantom pressure).
 *
 * Real composition: the Mobile application root, the Shared voice control plane
 * (`voiceControlService.initialize` / `.removeDownload`), the real residency manager and its
 * RAM-derived budget. The ONLY fake is the native TTS runtime at the device boundary.
 */
import type {
  ModelAssetState,
  TTSEngine,
  TTSEngineEvents,
  TTSVoice,
} from '../../../pro/audio/engine/types';
import { installNativeBoundary } from '../../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

const ENGINE_ID = 'residency-delete-voice';
/** The native runtime's peak footprint — what the budget is charged while it is resident. */
const VOICE_PEAK_RAM_MB = 320;

/** Native TTS runtime boundary fake — it reports state, it never decides residency. */
class NativeVoiceBoundaryFake implements TTSEngine {
  readonly id = ENGINE_ID;
  readonly displayName = 'Residency Delete Voice';
  readonly capabilities = {
    streaming: true, voiceCloning: false, pauseResume: true,
    generateAndSave: false, peakRamMB: VOICE_PEAK_RAM_MB,
  };
  private phase: ReturnType<TTSEngine['getPhase']> = 'idle';
  private downloaded = true;
  private listeners = new Map<keyof TTSEngineEvents, Set<(...args: any[]) => void>>();

  on<K extends keyof TTSEngineEvents>(event: K, listener: TTSEngineEvents[K]) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => this.off(event, listener);
  }
  off<K extends keyof TTSEngineEvents>(event: K, listener: TTSEngineEvents[K]) {
    this.listeners.get(event)?.delete(listener);
  }
  once<K extends keyof TTSEngineEvents>(event: K, listener: TTSEngineEvents[K]) {
    const stop = this.on(event, ((...args: any[]) => {
      stop();
      listener(...args);
    }) as TTSEngineEvents[K]);
    return stop;
  }

  getPhase() { return this.phase; }
  getLastDownloadError() { return null; }
  isSupported() { return true; }
  async initialize() { this.phase = 'ready'; }
  async release() { this.phase = 'idle'; }
  async destroy() { this.phase = 'idle'; this.downloaded = false; }
  getRequiredAssets() {
    return [{ id: 'voice', label: 'Voice', url: 'native://voice', sizeBytes: 1024, filename: 'voice.pte' }];
  }
  async checkAssetStatus(): Promise<ModelAssetState[]> {
    return this.getRequiredAssets().map(asset => ({
      asset, status: this.downloaded ? 'downloaded' : 'not-downloaded', progress: this.downloaded ? 1 : 0,
    }));
  }
  async downloadAssets() { this.downloaded = true; }
  async deleteAssets() { this.downloaded = false; }
  getOverallDownloadProgress() { return this.downloaded ? 1 : 0; }
  isFullyDownloaded() { return this.downloaded; }
  hydrateDownloaded(downloaded: boolean) { this.downloaded = downloaded; }
  getBridgeComponent() { return null; }
  getVoices(): TTSVoice[] {
    return [{ id: 'af_heart', label: 'Heart', metadata: { languageCode: 'en' } }];
  }
  getActiveVoice() { return this.getVoices()[0]; }
  async setVoice() {}
  async speak() {}
  async generateAndSave(): Promise<never> { throw new Error('unsupported'); }
  stop() {}
  pause() {}
  resume() {}
  setSpeed() {}
}

describe('V4 — deleting the voice model must not leave residency stale (red-flow)', () => {
  const native = new NativeVoiceBoundaryFake();
  let fixture: MobileApplicationFixture;
  let ttsRegistry: typeof import('../../../pro/audio/engine')['ttsRegistry'];
  let useTTSStore: typeof import('../../../pro/audio/ttsStore')['useTTSStore'];
  let voiceControlService: typeof import('../../../pro/audio/ttsControlService')['voiceControlService'];
  let residentSpecForVoiceEngine: typeof import('../../../pro/audio/ttsControlService')['residentSpecForVoiceEngine'];

  beforeAll(async () => {
    installNativeBoundary();
    ({ ttsRegistry } = require('../../../pro/audio/engine') as typeof import('../../../pro/audio/engine'));
    ttsRegistry.register(ENGINE_ID, () => native);
    const { startMobileApplicationFixture } = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture({ pro: true });
    ({ useTTSStore } = require('../../../pro/audio/ttsStore') as typeof import('../../../pro/audio/ttsStore'));
    ({ voiceControlService, residentSpecForVoiceEngine } =
      require('../../../pro/audio/ttsControlService') as typeof import('../../../pro/audio/ttsControlService'));
  });

  afterAll(async () => {
    await useTTSStore.getState().releaseEngine();
    await ttsRegistry.unregister(ENGINE_ID);
    await fixture.dispose();
  });

  it('releases the voice residency when the voice model is deleted', async () => {
    const projection = { set: useTTSStore.setState, get: useTTSStore.getState };
    await useTTSStore.getState().setEngine(ENGINE_ID);
    useTTSStore.getState().updateSettings({ enabled: true });
    await voiceControlService.download(projection);

    const residency = fixture.application.models.residency;
    const spec = residentSpecForVoiceEngine(native);
    expect(spec.sizeMB).toBe(VOICE_PEAK_RAM_MB); // the budget is charged the native peak, not a guess

    // The voice runtime loads, exactly as pro/audio does on init → it becomes a resident.
    await voiceControlService.initialize(projection);
    expect(useTTSStore.getState().error).toBeNull();
    expect(residency.isResident(spec.key)).toBe(true); // precondition, proved not assumed

    // The user deletes the downloaded voice model.
    await voiceControlService.removeDownload(projection);

    // The assets are gone AND the budget stops being charged for RAM the device no longer holds.
    expect(useTTSStore.getState().settings.modelDownloaded?.[ENGINE_ID]).toBe(false);
    expect(residency.isResident(spec.key)).toBe(false);
    // No phantom pressure: a later load the size of the freed voice is admissible again.
    expect(residency.canLoadWithoutEviction({ key: 'later-text-load', sizeMB: VOICE_PEAK_RAM_MB }))
      .toBe(true);
  });
});
