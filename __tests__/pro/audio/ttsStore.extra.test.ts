/**
 * ttsStore — extra coverage for the uncovered branches.
 *
 * These tests drive the REAL ttsStore actions AND the REAL modelResidencyManager
 * (only the native memory numbers on hardwareService are stubbed) so the
 * residency invariant is asserted as observable STATE (isResident/getResidents),
 * never "a function was called". The only mocked boundaries are:
 *   - the engine registry (a dumb stub engine — the native TTS bridge boundary)
 *   - hardwareService memory readings (native), pinned via setBudgetOverrideMB
 *   - logger (noise)
 * Everything else — the store, the residency manager, the persist migration —
 * runs for real. Deleting the branch under test makes these fail.
 */

// ── Dumb stub engine — the native TTS bridge boundary ───────────────────────
type Voice = { id: string; label: string; metadata: Record<string, unknown> };

function makeEngine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'mock-tts',
    displayName: 'Mock TTS',
    capabilities: {
      streaming: false,
      voiceCloning: false,
      pauseResume: true,
      generateAndSave: true,
      peakRamMB: 100,
    },
    getPhase: jest.fn(() => 'ready' as const),
    on: jest.fn(() => jest.fn()),
    off: jest.fn(),
    once: jest.fn(() => jest.fn()),
    isSupported: jest.fn(() => true),
    initialize: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    hydrateDownloaded: jest.fn(),
    getRequiredAssets: jest.fn(() => [] as Array<{ sizeBytes: number }>),
    checkAssetStatus: jest.fn().mockResolvedValue([]),
    downloadAssets: jest.fn().mockResolvedValue(undefined),
    deleteAssets: jest.fn().mockResolvedValue(undefined),
    getOverallDownloadProgress: jest.fn(() => 1),
    isFullyDownloaded: jest.fn(() => true),
    getBridgeComponent: jest.fn(() => null),
    getVoices: jest.fn(
      () => [{ id: 'default', label: 'Default', metadata: {} }] as Voice[],
    ),
    getActiveVoice: jest.fn(() => ({ id: 'default', label: 'Default', metadata: {} }) as Voice),
    setVoice: jest.fn().mockResolvedValue(undefined),
    speak: jest.fn().mockResolvedValue(undefined),
    generateAndSave: jest.fn().mockResolvedValue({
      filePath: '/cache/c1/m1.pcm',
      durationSeconds: 2.5,
      waveformData: new Array(4).fill(0.1),
    }),
    stop: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    setSpeed: jest.fn(),
    ...overrides,
  };
}

let mockCurrentEngine = makeEngine();

jest.mock('../../../pro/audio/engine', () => ({
  ttsRegistry: {
    register: jest.fn(),
    has: jest.fn(() => true),
    getEngine: jest.fn(() => mockCurrentEngine),
    setActiveEngine: jest.fn(() => Promise.resolve(mockCurrentEngine)),
    getActiveEngine: jest.fn(() => mockCurrentEngine),
    getActiveEngineId: jest.fn(() => 'mock-tts'),
    getRegisteredIds: jest.fn(() => ['mock-tts']),
  },
  // OuteTTSEngine is compared with `instanceof` in refreshCacheSize/clearAudioCache.
  // A real class here means an instance is a genuine OuteTTS and the plain stub is not,
  // so BOTH sides of the instanceof branch are exercised for real. Defined inside the
  // factory (class decls aren't hoisted, so a top-level one is in the TDZ at mock time).
  OuteTTSEngine: class MockOuteTTSEngine {
    getAudioCacheSizeMB = jest.fn().mockResolvedValue(12.5);
    clearAudioCache = jest.fn().mockResolvedValue(undefined);
  },
}));

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { useTTSStore } from '@offgrid/pro/audio/ttsStore';
import { modelResidencyManager } from '@offgrid/core/services/modelResidency';
import { hardwareService } from '@offgrid/core/services/hardware';
import { OuteTTSEngine } from '@offgrid/pro/audio/engine';

const getState = () => useTTSStore.getState();

// Keep the store's own persisted settings coherent between tests.
const baseSettings = {
  interfaceMode: 'chat' as const,
  enabled: true,
  speed: 1.0,
  engineId: 'mock-tts',
  voiceByEngine: {} as Record<string, string>,
  modelDownloaded: {} as Record<string, boolean>,
};

describe('ttsStore — extra branch coverage', () => {
  let availSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCurrentEngine = makeEngine();
    // Restore the registry default (some tests point getActiveEngine at an OuteTTS
    // instance via mockReturnValue, which clearAllMocks does NOT undo).
    const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
    ttsRegistry.getActiveEngine.mockImplementation(() => mockCurrentEngine);
    useTTSStore.setState({
      phase: 'ready',
      currentMessageId: null,
      currentAudioPath: null,
      currentAmplitude: 0,
      playbackElapsed: 0,
      playbackDuration: 0,
      playSessionId: 0,
      error: null,
      playbackStatus: 'idle',
      isStreaming: false,
      isReady: true,
      isDownloading: false,
      isLoading: false,
      isSpeaking: false,
      isPaused: false,
      isGeneratingAudio: false,
      assets: [],
      overallDownloadProgress: 1,
      voices: [{ id: 'default', label: 'Default', metadata: {} }],
      activeVoiceId: 'default',
      isSwitchingVoice: false,
      audioCacheSizeMB: 0,
      settings: { ...baseSettings, voiceByEngine: {}, modelDownloaded: {} },
    });
    // Plenty of free RAM so the override survival-floor (1200MB) always clears;
    // the budget itself is pinned per-test via setBudgetOverrideMB.
    jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(12);
    availSpy = jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(6);
    jest
      .spyOn(hardwareService, 'refreshMemoryInfo')
      .mockResolvedValue(undefined as unknown as ReturnType<typeof hardwareService.refreshMemoryInfo>);
  });

  afterEach(() => {
    // No pollution: reset the shared residency manager + restore all spies.
    modelResidencyManager._reset();
    modelResidencyManager.setBudgetOverrideMB(null);
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  // ── initializeEngine (residency-gated load) ──────────────────────────────

  describe('initializeEngine', () => {
    it('bails with no active engine — no residency load, no error', async () => {
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      ttsRegistry.getActiveEngine.mockReturnValueOnce(null);

      await getState().initializeEngine();

      expect(mockCurrentEngine.initialize).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('tts')).toBe(false);
      expect(getState().error).toBeNull();
    });

    it('override load: fits → engine initialized AND tts becomes resident', async () => {
      modelResidencyManager.setBudgetOverrideMB(4000); // room for the 100MB voice model
      mockCurrentEngine.capabilities.peakRamMB = 100;

      await getState().initializeEngine({ override: true });

      // The OUTCOME a user feels: the voice model is actually in RAM.
      expect(mockCurrentEngine.initialize).toHaveBeenCalledTimes(1);
      expect(modelResidencyManager.isResident('tts')).toBe(true);
      expect(modelResidencyManager.getResidents().map(r => r.key)).toContain('tts');
      expect(getState().error).toBeNull();
    });

    it('warm/preload: NO room → skips quietly (not resident, no error, engine NOT initialized)', async () => {
      // A resident 3800MB model + a 1024MB budget leaves no room to co-reside 300MB TTS.
      modelResidencyManager.setBudgetOverrideMB(1024);
      modelResidencyManager.register(
        { key: 'llm', type: 'text', sizeMB: 3800 },
        () => Promise.resolve(),
      );
      mockCurrentEngine.capabilities.peakRamMB = 300;

      await getState().initializeEngine(); // override defaults to false

      // The false branch of `fits`: warm must NOT load and must NOT surface an error.
      expect(mockCurrentEngine.initialize).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('tts')).toBe(false);
      expect(modelResidencyManager.isResident('llm')).toBe(true); // resident not evicted for a warm
      expect(getState().error).toBeNull();
    });

    it('override load: bypasses the budget → evicts everything else and initializes (Load Anyway always loads)', async () => {
      // Load Anyway is UNCONDITIONAL: makeRoomFor under override always returns fits=true (no
      // survival floor — the user accepted the risk), so even at ~500MB real free RAM the override
      // load proceeds — evict, initialize, tts becomes resident. (The old "override still refuses
      // below the floor" behavior was removed.)
      modelResidencyManager.setBudgetOverrideMB(4000);
      availSpy.mockReturnValue(0.5); // ~500MB free — tight, but override ignores the budget
      mockCurrentEngine.capabilities.peakRamMB = 100;

      await getState().initializeEngine({ override: true });

      expect(mockCurrentEngine.initialize).toHaveBeenCalled();
      expect(modelResidencyManager.isResident('tts')).toBe(true);
      expect(getState().error).toBeNull();
    });

    it('derives sizeMB from required-asset bytes when peakRamMB is 0', async () => {
      // peakRamMB 0 forces the `|| assets.reduce(...)/MB` fallback (line 249).
      modelResidencyManager.setBudgetOverrideMB(4000);
      mockCurrentEngine.capabilities.peakRamMB = 0;
      mockCurrentEngine.getRequiredAssets.mockReturnValue([
        { sizeBytes: 200 * 1024 * 1024 },
        { sizeBytes: 100 * 1024 * 1024 },
      ]);

      await getState().initializeEngine({ override: true });

      expect(modelResidencyManager.isResident('tts')).toBe(true);
      // The registered resident carries the derived size (~300MB), proving the
      // fallback fed the residency spec — not the 0 peakRamMB.
      const tts = modelResidencyManager.getResidents().find(r => r.key === 'tts');
      expect(tts?.sizeMB).toBe(300);
    });

    it('registered TTS canEvict tracks playbackStatus (veto while playing, evictable when idle)', async () => {
      modelResidencyManager.setBudgetOverrideMB(4000);
      mockCurrentEngine.capabilities.peakRamMB = 100;
      await getState().initializeEngine({ override: true });

      // canEvict is a runtime field on the resident spec that getResidents()'s stripped
      // type omits — narrow it here to assert the real in-use veto behavior.
      const tts = modelResidencyManager.getResidents().find(r => r.key === 'tts') as
        (undefined | { canEvict?: () => boolean });
      // idle → evictable
      useTTSStore.setState({ playbackStatus: 'idle' });
      expect(tts?.canEvict?.()).toBe(true);
      // playing → residency must NOT evict active playback
      useTTSStore.setState({ playbackStatus: 'playing' });
      expect(tts?.canEvict?.()).toBe(false);
    });

    it('registered TTS unload fn releases the engine when residency evicts it', async () => {
      // Load TTS as a resident (idle → evictable), then force a load that needs the
      // room so residency fires the tts unload fn. Asserts the OUTCOME: the engine is
      // released and tts is no longer resident (line 276 — the eviction unload).
      modelResidencyManager.setBudgetOverrideMB(2000);
      mockCurrentEngine.capabilities.peakRamMB = 500;
      useTTSStore.setState({ playbackStatus: 'idle' });
      await getState().initializeEngine({ override: true });
      expect(modelResidencyManager.isResident('tts')).toBe(true);

      // A larger override load evicts every evictable resident (single-model), running
      // tts's registered unload fn (which calls engine.release()).
      await modelResidencyManager.runExclusive('load:llm', async () => {
        await modelResidencyManager.makeRoomFor(
          { key: 'llm', type: 'text', sizeMB: 1800 },
          { override: true },
        );
      });

      expect(modelResidencyManager.isResident('tts')).toBe(false);
      expect(mockCurrentEngine.release).toHaveBeenCalled();
    });
  });

  // ── stopStreaming delegation ─────────────────────────────────────────────

  describe('stopStreaming', () => {
    it('runs the streaming-stop path without throwing (delegates to the playback owner)', () => {
      // Real delegation into ttsPlayback/streamingSpeech (not a native boundary) —
      // line 376. From idle it is a safe no-op; the outcome is a stable idle state.
      expect(() => getState().stopStreaming()).not.toThrow();
      expect(getState().playbackStatus).toBe('idle');
    });
  });

  // ── setEngine: restore a saved voice ─────────────────────────────────────

  describe('setEngine saved-voice restore', () => {
    it('re-applies a persisted voice that exists on the engine', async () => {
      mockCurrentEngine.getVoices.mockReturnValue([
        { id: 'default', label: 'Default', metadata: {} },
        { id: 'nova', label: 'Nova', metadata: {} },
      ]);
      useTTSStore.setState({
        settings: { ...baseSettings, voiceByEngine: { 'mock-tts': 'nova' } },
      });

      await getState().setEngine('mock-tts');

      // Line 224: the saved voice is re-applied on the engine and reflected in state.
      expect(mockCurrentEngine.setVoice).toHaveBeenCalledWith('nova');
      expect(getState().activeVoiceId).toBe('nova');
    });

    it('does NOT re-apply a saved voice the engine no longer offers (falls to engine default)', async () => {
      mockCurrentEngine.getVoices.mockReturnValue([{ id: 'default', label: 'Default', metadata: {} }]);
      useTTSStore.setState({
        settings: { ...baseSettings, voiceByEngine: { 'mock-tts': 'ghost-voice' } },
      });

      await getState().setEngine('mock-tts');

      // The other side of the `voices.some(...)` branch: no re-apply.
      expect(mockCurrentEngine.setVoice).not.toHaveBeenCalled();
      // activeVoiceId still reflects the (now invalid) saved id per the store's `savedVoice ?? ...`.
      expect(getState().activeVoiceId).toBe('ghost-voice');
    });
  });

  // ── checkDownloadStatus backfill ─────────────────────────────────────────

  describe('checkDownloadStatus flag backfill', () => {
    it('backfills modelDownloaded when the disk scan finds the model present', async () => {
      mockCurrentEngine.isFullyDownloaded.mockReturnValue(true);
      useTTSStore.setState({
        settings: { ...baseSettings, modelDownloaded: {} },
      });

      await getState().checkDownloadStatus();

      // Lines 308-315: flag backfilled from a confirmed present model.
      expect(getState().settings.modelDownloaded?.['mock-tts']).toBe(true);
    });

    it('does NOT backfill when the model is not fully downloaded', async () => {
      mockCurrentEngine.isFullyDownloaded.mockReturnValue(false);
      useTTSStore.setState({ settings: { ...baseSettings, modelDownloaded: {} } });

      await getState().checkDownloadStatus();

      expect(getState().settings.modelDownloaded?.['mock-tts']).toBeUndefined();
    });
  });

  // ── downloadModels ───────────────────────────────────────────────────────

  describe('downloadModels', () => {
    it('persists the modelDownloaded flag after a successful download', async () => {
      mockCurrentEngine.isFullyDownloaded.mockReturnValue(true);
      useTTSStore.setState({
        isDownloading: false,
        settings: { ...baseSettings, modelDownloaded: {} },
      });

      await getState().downloadModels();

      expect(mockCurrentEngine.downloadAssets).toHaveBeenCalledTimes(1);
      expect(getState().settings.modelDownloaded?.['mock-tts']).toBe(true);
      expect(getState().error).toBeNull();
    });

    it('does NOT persist the flag when the model is still incomplete after download', async () => {
      mockCurrentEngine.isFullyDownloaded.mockReturnValue(false);
      useTTSStore.setState({ isDownloading: false, settings: { ...baseSettings, modelDownloaded: {} } });

      await getState().downloadModels();

      expect(getState().settings.modelDownloaded?.['mock-tts']).toBeUndefined();
    });

    it('surfaces an error when the download rejects', async () => {
      mockCurrentEngine.downloadAssets.mockRejectedValueOnce(new Error('network down'));
      useTTSStore.setState({ isDownloading: false });

      await getState().downloadModels();

      expect(getState().error).toBe('network down');
    });

    it('is a no-op guard while a download is already in flight', async () => {
      useTTSStore.setState({ isDownloading: true });

      await getState().downloadModels();

      expect(mockCurrentEngine.downloadAssets).not.toHaveBeenCalled();
    });
  });

  // ── deleteModels ─────────────────────────────────────────────────────────

  describe('deleteModels', () => {
    it('clears the downloaded flag, zeroes progress, and drops any voice-switch', async () => {
      useTTSStore.setState({
        isSwitchingVoice: true,
        overallDownloadProgress: 1,
        settings: { ...baseSettings, modelDownloaded: { 'mock-tts': true } },
      });

      await getState().deleteModels();

      expect(mockCurrentEngine.deleteAssets).toHaveBeenCalledTimes(1);
      expect(getState().settings.modelDownloaded?.['mock-tts']).toBe(false);
      expect(getState().overallDownloadProgress).toBe(0);
      expect(getState().isSwitchingVoice).toBe(false);
    });
  });

  // ── releaseEngine ──────────────────────────────────────────────────────────

  describe('releaseEngine', () => {
    it('releases the active engine', async () => {
      await getState().releaseEngine();
      expect(mockCurrentEngine.release).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when there is no active engine', async () => {
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      ttsRegistry.getActiveEngine.mockReturnValueOnce(null);
      await expect(getState().releaseEngine()).resolves.toBeUndefined();
      expect(mockCurrentEngine.release).not.toHaveBeenCalled();
    });
  });

  // ── generateAndSave capability guard ─────────────────────────────────────

  describe('generateAndSave capability guard', () => {
    it('throws when the active engine cannot generateAndSave', async () => {
      mockCurrentEngine.capabilities.generateAndSave = false;

      await expect(getState().generateAndSave('hi', 'c1', 'm1')).rejects.toThrow(
        /does not support audio generation/i,
      );
      expect(mockCurrentEngine.generateAndSave).not.toHaveBeenCalled();
    });

    it('throws when there is no active engine', async () => {
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      ttsRegistry.getActiveEngine.mockReturnValueOnce(null);

      await expect(getState().generateAndSave('hi', 'c1', 'm1')).rejects.toThrow(
        /no active tts engine/i,
      );
    });
  });

  // ── refreshCacheSize / clearAudioCache (OuteTTS-only) ────────────────────

  describe('cache actions gate on OuteTTSEngine', () => {
    it('refreshCacheSize reads the size only for an OuteTTS engine', async () => {
      const oute = new OuteTTSEngine() as unknown as typeof mockCurrentEngine & {
        getAudioCacheSizeMB: jest.Mock;
      };
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      ttsRegistry.getActiveEngine.mockReturnValue(oute);

      await getState().refreshCacheSize();

      expect(oute.getAudioCacheSizeMB).toHaveBeenCalled();
      expect(getState().audioCacheSizeMB).toBe(12.5);
    });

    it('refreshCacheSize is a no-op for a non-OuteTTS engine', async () => {
      useTTSStore.setState({ audioCacheSizeMB: 7 });
      // mockCurrentEngine (mock stub) is NOT an OuteTTSEngine → the instanceof is false.
      await getState().refreshCacheSize();
      expect(getState().audioCacheSizeMB).toBe(7); // untouched
    });

    it('clearAudioCache clears + zeroes size for an OuteTTS engine', async () => {
      const oute = new OuteTTSEngine() as unknown as typeof mockCurrentEngine & {
        clearAudioCache: jest.Mock;
      };
      const { ttsRegistry } = jest.requireMock('../../../pro/audio/engine');
      ttsRegistry.getActiveEngine.mockReturnValue(oute);
      useTTSStore.setState({ audioCacheSizeMB: 42 });

      await getState().clearAudioCache();

      expect(oute.clearAudioCache).toHaveBeenCalled();
      expect(getState().audioCacheSizeMB).toBe(0);
    });

    it('clearAudioCache is a no-op for a non-OuteTTS engine', async () => {
      useTTSStore.setState({ audioCacheSizeMB: 42 });
      await getState().clearAudioCache();
      expect(getState().audioCacheSizeMB).toBe(42); // instanceof false → untouched
    });
  });
});

// ── onRehydrateStorage migration ────────────────────────────────────────────
// The migration mutates the draft state in place; drive it directly via the
// persist option so both the legacy backfills and the flat→per-engine mapping
// are exercised as real transformations.
describe('ttsStore persist migration (onRehydrateStorage)', () => {
  const runMigration = (settings: Record<string, unknown>) => {
    const opts = (useTTSStore as unknown as {
      persist: { getOptions: () => { onRehydrateStorage: () => (s: unknown) => void } };
    }).persist.getOptions();
    const state = { settings } as unknown;
    opts.onRehydrateStorage()(state);
    return (state as { settings: Record<string, unknown> }).settings;
  };

  it('returns early (no throw) when there is no persisted state', () => {
    const opts = (useTTSStore as unknown as {
      persist: { getOptions: () => { onRehydrateStorage: () => (s: unknown) => void } };
    }).persist.getOptions();
    expect(() => opts.onRehydrateStorage()(undefined)).not.toThrow();
  });

  it('backfills voiceByEngine and modelDownloaded when missing', () => {
    const s = runMigration({ engineId: 'kokoro' });
    expect(s.voiceByEngine).toEqual({});
    expect(s.modelDownloaded).toEqual({});
  });

  it('migrates flat kokoroVoiceId and voiceId into voiceByEngine', () => {
    const s = runMigration({
      engineId: 'kokoro',
      kokoroVoiceId: 'af_bella',
      voiceId: 'legacy-oute',
    });
    expect((s.voiceByEngine as Record<string, string>).kokoro).toBe('af_bella');
    expect((s.voiceByEngine as Record<string, string>).outetts).toBe('legacy-oute');
    // The flat keys are deleted after mapping.
    expect(s.kokoroVoiceId).toBeUndefined();
    expect(s.voiceId).toBeUndefined();
  });

  it('does NOT overwrite an existing per-engine voice with the flat legacy key', () => {
    const s = runMigration({
      engineId: 'kokoro',
      voiceByEngine: { kokoro: 'keep-me' },
      kokoroVoiceId: 'af_bella',
    });
    // The `&& !vbe.kokoro` guard: existing per-engine voice wins, flat key untouched.
    expect((s.voiceByEngine as Record<string, string>).kokoro).toBe('keep-me');
    expect(s.kokoroVoiceId).toBe('af_bella');
  });

  it('defaults engineId to kokoro when absent', () => {
    const s = runMigration({ voiceByEngine: {} });
    expect(s.engineId).toBe('kokoro');
  });
});
