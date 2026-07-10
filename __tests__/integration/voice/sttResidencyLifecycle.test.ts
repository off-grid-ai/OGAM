/**
 * ADVERSARIAL STT (Whisper) residency LIFECYCLE at the intersections.
 *
 * sttResidency.test.ts proves the single-model invariant on a fixed 12GB budget. This
 * file crosses the OTHER residency dimensions the voice pipeline breaks at (docs/
 * TEST_MATRIX.md §3.3 residency × feature, §3.6 lifecycle):
 *
 *  1. STT evicted MID-TURN must RELOAD on the next record — not desync (the store flag
 *     and the residents map must agree after evict→reload).
 *  2. reclaimSttForGeneration: the generation hot path frees idle STT on a TIGHT device
 *     but MUST honor the canEvict veto when whisper is finalizing a transcription
 *     (never evict a model mid-use), and MUST keep STT warm on a ROOMY device.
 *  3. A concurrent reclaim + reload does not strand a phantom resident.
 *
 * These drive the REAL modelResidencyManager and the REAL whisperStore. Only the native
 * boundaries are mocked: whisperService (flag-flip stub) + hardwareService (memory
 * numbers). Deleting the `if (!fits) return` guard, the canEvict veto, or the
 * `totalGB > 6` roomy short-circuit MUST fail a test here.
 */
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { hardwareService } from '../../../src/services/hardware';

let mockWhisperNativeLoaded = false;
jest.mock('../../../src/services/whisperService', () => ({
  whisperService: {
    getModelPath: (id: string) => `/models/ggml-${id}.bin`,
    loadModel: jest.fn(async () => { mockWhisperNativeLoaded = true; }),
    unloadModel: jest.fn(async () => { mockWhisperNativeLoaded = false; }),
    isModelLoaded: () => mockWhisperNativeLoaded,
    isModelDownloaded: jest.fn(async () => true),
    deleteModel: jest.fn(async () => {}),
    downloadModel: jest.fn(async () => '/models/x'),
  },
  WHISPER_MODELS: [{ id: 'base', size: 142 }],
}));

jest.mock('../../../src/services/hardware');
const mockHardware = hardwareService as jest.Mocked<typeof hardwareService>;

import { useWhisperStore } from '../../../src/stores/whisperStore';
import { whisperService } from '../../../src/services/whisperService';

const mockWhisper = whisperService as jest.Mocked<typeof whisperService>;

/** Register a resident generation (text) model as activeModelService would. */
const registerTextModel = (sizeMB: number) =>
  modelResidencyManager.register({ key: 'text', type: 'text', sizeMB }, async () => {});

/** Put the device in a roomy state (STT stays warm) or a tight state. */
const setDeviceMemory = (totalGB: number, availGB = totalGB / 2) => {
  mockHardware.getTotalMemoryGB.mockReturnValue(totalGB);
  mockHardware.getAvailableMemoryGB.mockReturnValue(availGB);
  mockHardware.refreshMemoryInfo.mockResolvedValue({} as never);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWhisperNativeLoaded = false;
  modelResidencyManager._reset();
  modelResidencyManager.setLoadPolicy('balanced');
  useWhisperStore.setState({ downloadedModelId: 'base', isModelLoaded: false, isModelLoading: false, error: null });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('STT evicted mid-turn reloads on next record (no desync)', () => {
  beforeEach(() => {
    // Roomy budget so a reload can succeed once the text model is gone.
    setDeviceMemory(16, 10);
    modelResidencyManager.setBudgetOverrideMB(12000);
  });

  it('after a text model evicts whisper, the NEXT record reloads it and the store agrees', async () => {
    // 1. User recorded a note → whisper resident.
    expect(await useWhisperStore.getState().loadModel()).toBe('loaded');
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
    expect(useWhisperStore.getState().isModelLoaded).toBe(true);

    // 2. A big text model loads mid-turn with override → evicts whisper (the exact
    //    device sequence: transcribe → LLM loads → whisper kicked out).
    const { evicted } = await modelResidencyManager.makeRoomFor(
      { key: 'text', type: 'text', modelId: 'gemma', sizeMB: 8000 },
      { override: true },
    );
    registerTextModel(8000);
    expect(evicted).toContain('whisper');
    // The eviction ran whisper's registered unload → native unloaded.
    expect(mockWhisper.unloadModel).toHaveBeenCalled();
    // DESYNC GUARD: the store flag must NOT still claim "loaded" once the whisper
    // resident is gone. (whisperStore.unloadModel clears it via the eviction path.)
    expect(useWhisperStore.getState().isModelLoaded).toBe(false);
    expect(modelResidencyManager.isResident('whisper')).toBe(false);

    // 3. Turn ends: text model released. User taps record again → whisper reloads.
    modelResidencyManager.release('text');
    expect(await useWhisperStore.getState().loadModel()).toBe('loaded');

    // TERMINAL: exactly one model resident (whisper), store and manager agree.
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
    expect(modelResidencyManager.getResidents()).toHaveLength(1);
    expect(useWhisperStore.getState().isModelLoaded).toBe(true);
    expect(mockWhisper.loadModel).toHaveBeenCalledTimes(2); // initial + reload
  });

  it('while the text model still owns RAM, the retry is BLOCKED not desynced', async () => {
    // Reproduce the tight state where the sidecar cannot co-reside: pin the budget so
    // the 8GB text model alone exceeds it (force-loaded via override earlier).
    modelResidencyManager.setBudgetOverrideMB(7908);
    registerTextModel(8537);

    // The reactive auto-load retry fires while text owns memory → single-model rule
    // returns 'blocked'. It must NOT load anyway (the OOM regression).
    expect(await useWhisperStore.getState().loadModel()).toBe('blocked');
    expect(mockWhisper.loadModel).not.toHaveBeenCalled();
    expect(modelResidencyManager.isResident('whisper')).toBe(false);
    expect(useWhisperStore.getState().isModelLoaded).toBe(false);
    expect(useWhisperStore.getState().error).toBeNull(); // blocked is not an error
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('reclaimSttForGeneration — the generation hot path', () => {
  it('TIGHT device: frees idle whisper before the LLM turn', async () => {
    setDeviceMemory(4, 2); // <=6GB → tight
    modelResidencyManager.setBudgetOverrideMB(3000);
    expect(await useWhisperStore.getState().loadModel()).toBe('loaded');
    expect(modelResidencyManager.isResident('whisper')).toBe(true);

    await modelResidencyManager.reclaimSttForGeneration();

    // TERMINAL: idle STT is gone so the LLM working set has the RAM.
    expect(modelResidencyManager.isResident('whisper')).toBe(false);
    expect(mockWhisper.unloadModel).toHaveBeenCalled();
  });

  it('TIGHT device but whisper VETOES (finalizing a transcription): stays resident', async () => {
    setDeviceMemory(4, 2);
    modelResidencyManager.setBudgetOverrideMB(3000);
    // Register whisper with a canEvict veto that reports "in use right now" — the exact
    // state when a transcription is being finalized as the send fires.
    modelResidencyManager.register(
      { key: 'whisper', type: 'whisper', sizeMB: 142, canEvict: () => false },
      async () => { await useWhisperStore.getState().unloadModel(); },
    );
    mockWhisperNativeLoaded = true;

    await modelResidencyManager.reclaimSttForGeneration();

    // TERMINAL: the veto held — whisper NOT evicted mid-transcription.
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
    expect(mockWhisper.unloadModel).not.toHaveBeenCalled();
  });

  it('ROOMY device: keeps whisper warm across the turn (no reclaim)', async () => {
    setDeviceMemory(12, 8); // >6GB → roomy
    modelResidencyManager.setBudgetOverrideMB(9000);
    expect(await useWhisperStore.getState().loadModel()).toBe('loaded');
    expect(modelResidencyManager.isResident('whisper')).toBe(true);

    await modelResidencyManager.reclaimSttForGeneration();

    // TERMINAL: warm STT preserved on a roomy device → instant next record.
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
    expect(mockWhisper.unloadModel).not.toHaveBeenCalled();
  });

  it('no whisper resident: reclaim is a safe no-op', async () => {
    setDeviceMemory(4, 2);
    await expect(modelResidencyManager.reclaimSttForGeneration()).resolves.toBeUndefined();
    expect(mockWhisper.unloadModel).not.toHaveBeenCalled();
  });
});
