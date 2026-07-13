/**
 * Integration Tests: STT (Whisper) residency — the single-model invariant.
 *
 * This is the test that WOULD HAVE CAUGHT the shipped bug where the voice
 * pipeline held the Whisper STT model AND the text model in RAM at the same
 * time, OOM-ing the app and forcing the user to resend.
 *
 * Why the old suite missed it: `whisperStore.test.ts` mocks the residency
 * manager's `makeRoomFor` to ALWAYS return `{ fits: true }` and only asserts
 * that `makeRoomFor`/`loadModel` were *called*. That is a false green — it
 * passes whether or not the store RESPECTS the verdict, and the bug was
 * precisely that the store ignored `fits` and loaded anyway.
 *
 * This test instead drives the REAL modelResidencyManager (only the native
 * whisperService.loadModel/unloadModel and the hardware memory probe are
 * mocked at the boundary) and asserts the OUTCOME a user cares about: how many
 * models are resident. Deleting the `if (!fits) return` guard in the store
 * fails these tests.
 */

import { modelResidencyManager } from '../../../src/services/modelResidency';
import { hardwareService } from '../../../src/services/hardware';

// Native boundary: the whisper native model. A dumb stub that just flips a flag
// so the REAL residency bookkeeping and the REAL store logic run on top of it.
let mockWhisperNativeLoaded = false;
jest.mock('../../../src/services', () => ({
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
import { whisperService } from '../../../src/services';

const mockWhisper = whisperService as jest.Mocked<typeof whisperService>;

/** A resident generation (text) model, as activeModelService would register it. */
const registerTextModel = (sizeMB: number) => {
  modelResidencyManager.register(
    { key: 'text', type: 'text', sizeMB },
    async () => { /* text unload */ },
  );
};

describe('STT residency — single-model invariant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWhisperNativeLoaded = false;
    modelResidencyManager._reset();
    useWhisperStore.setState({ downloadedModelId: 'base', isModelLoaded: false, isModelLoading: false, error: null });

    // Device under test: the 12GB phone that OOM'd (11297MB usable → ~7908MB model
    // budget on Android). Pin the budget directly so the invariant is deterministic
    // and platform-independent (the test-env Platform.OS would otherwise pick the
    // iOS fraction and give a roomier budget than the Android device had). The text
    // model (8537MB) alone exceeds this budget — it was force-loaded via override —
    // so a 142MB whisper sidecar CANNOT co-reside without evicting it, and residency
    // won't evict a generation model for a sidecar. That is the exact device state.
    mockHardware.getTotalMemoryGB.mockReturnValue(11.03);
    mockHardware.getAvailableMemoryGB.mockReturnValue(4.5);
    mockHardware.refreshMemoryInfo.mockResolvedValue({} as any);
    modelResidencyManager.setLoadPolicy('balanced');
    modelResidencyManager.setBudgetOverrideMB(7908);
  });

  it('loads whisper when nothing else is resident', async () => {
    await useWhisperStore.getState().loadModel();

    expect(mockWhisper.loadModel).toHaveBeenCalledTimes(1);
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
    expect(useWhisperStore.getState().isModelLoaded).toBe(true);
  });

  it('does NOT load whisper alongside a heavier resident text model (the OOM regression)', async () => {
    // The text model is resident (like right after a voice "Load Anyway"). Residency
    // will NOT evict an 8.5GB generation model to make room for a 142MB sidecar, so
    // makeRoomFor returns fits=false. The store must honor that and stay out.
    registerTextModel(8537);

    await useWhisperStore.getState().loadModel();

    // The invariant: exactly ONE model resident — the text model, not both.
    expect(mockWhisper.loadModel).not.toHaveBeenCalled();
    expect(modelResidencyManager.isResident('whisper')).toBe(false);
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(modelResidencyManager.getResidents()).toHaveLength(1);
    // Not an error — STT just loads on the next record when there's room.
    expect(useWhisperStore.getState().isModelLoaded).toBe(false);
    expect(useWhisperStore.getState().error).toBeNull();
  });

  it('a text load evicts a resident whisper, and whisper does not fight its way back', async () => {
    // 1. Whisper resident (user recorded a voice note).
    await useWhisperStore.getState().loadModel();
    expect(modelResidencyManager.isResident('whisper')).toBe(true);

    // 2. A big text model needs to load. activeModelService asks residency to make
    //    room with override (Load Anyway) — this evicts whisper.
    const { evicted } = await modelResidencyManager.makeRoomFor(
      { key: 'text', type: 'text', modelId: 'gemma-e4b', sizeMB: 8537 },
      { override: true },
    );
    registerTextModel(8537); // text now actually resident
    expect(evicted).toContain('whisper');
    expect(modelResidencyManager.isResident('whisper')).toBe(false);
    // whisper's unload ran → store flag cleared (the eviction path).
    expect(mockWhisper.unloadModel).toHaveBeenCalled();

    // 3. The reactive auto-load effect (or any retry) tries to bring whisper back
    //    while the text model owns memory. It must NOT succeed — otherwise we're
    //    back to whisper+text co-resident.
    await useWhisperStore.getState().loadModel();

    expect(modelResidencyManager.isResident('whisper')).toBe(false);
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(modelResidencyManager.getResidents()).toHaveLength(1);
  });

  it('after the text model unloads, whisper can load again', async () => {
    registerTextModel(8537);
    await useWhisperStore.getState().loadModel();
    expect(modelResidencyManager.isResident('whisper')).toBe(false);

    // Text model goes away (turn finished / model switched).
    modelResidencyManager.release('text');

    await useWhisperStore.getState().loadModel();
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
    expect(useWhisperStore.getState().isModelLoaded).toBe(true);
  });
});
