/**
 * Integration test — the "Load Anyway" memory-override CHAIN, end to end.
 *
 * Exercises the REAL seam a user drives when a big model is memory-blocked:
 *
 *   loadModelWithOverride  (the UI-intent helper every screen calls)
 *      → activeModelService.loadTextModel(..., { override })  (the single load gateway)
 *         → modelResidencyManager.makeRoomFor({ override })    (the memory gate + eviction)
 *
 * Only the two things we physically cannot run in-process are mocked — the `llm`
 * native module and the `hardware` RAM sensor. `loadModelWithOverride`,
 * `activeModelService`, `modelResidencyManager`, the residency policy, the store,
 * and the real `CustomAlert` state helpers all run for real. We assert the OUTCOME
 * the user feels (model loaded / refused, which dialog they see), never
 * `expect(gate).toHaveBeenCalled()`.
 *
 * The ratified contract: "Load Anyway" (override) is UNCONDITIONAL. When the user
 * taps it, makeRoomFor evicts every evictable resident to free the maximum RAM and
 * ALWAYS loads (fits: true) — there is NO survival floor, and it NEVER refuses. The
 * old "override still refuses below a survival floor / when the model is too big"
 * behaviour is gone: the UI frames it as "not recommended, but you can try", and the
 * device — not a predictive guard — decides whether the load survives.
 *
 * The contrast this suite pins: the SAME big model WITHOUT override is refused by the
 * normal memory gate (an overridable "Insufficient Memory" prompt, no eviction); WITH
 * override it evicts and loads. An approved override is then remembered for the
 * session so repeated evict→reload swaps don't re-prompt.
 *
 * The RAM mock is DYNAMIC — free RAM is low BEFORE the eviction unload fires and high
 * AFTER (modelling iOS reclaiming the unloaded clean pages) — so the eviction is a real
 * unload the residency manager observes, not a static number.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { activeModelService } from '../../../src/services/activeModelService';
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { llmService } from '../../../src/services/llm';
import { hardwareService } from '../../../src/services/hardware';
import { loadModelWithOverride } from '../../../src/services/loadModelWithOverride';
import type { AlertState } from '../../../src/components/CustomAlert';
import {
  resetStores,
  flushPromises,
  getAppState,
} from '../../utils/testHelpers';
import { createDownloadedModel, createDeviceInfo } from '../../utils/factories';

// Boundary mocks ONLY — the native LLM engine and the hardware RAM sensor.
jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/litert');
jest.mock('../../../src/services/localDreamGenerator');
jest.mock('../../../src/services/hardware');

const mockLlmService = llmService as jest.Mocked<typeof llmService>;
const mockHardwareService = hardwareService as jest.Mocked<
  typeof hardwareService
>;

/**
 * Drives the exact override chain a screen runs: hand loadModelWithOverride a thunk
 * that loads through the real activeModelService, capture every alert the helper
 * raises, and expose a `tapLoadAnyway()` that presses the real "Load Anyway" button
 * (and awaits the fire-and-forget retry the helper kicks off).
 */
function driveLoad(modelId: string) {
  const alerts: AlertState[] = [];
  let lastLoad: Promise<void> | undefined;
  const load = (opts?: { override?: boolean }) => {
    lastLoad = activeModelService.loadTextModel(modelId, undefined, opts);
    return lastLoad;
  };
  const start = () =>
    loadModelWithOverride(load, { setAlertState: a => alerts.push(a) });

  const lastVisible = () => [...alerts].reverse().find(a => a.visible);

  const tapLoadAnyway = async () => {
    const prompt = lastVisible();
    const btn = prompt?.buttons?.find(b => b.text === 'Load Anyway');
    if (!btn?.onPress) {
      throw new Error(
        `No "Load Anyway" button on the last alert (title=${prompt?.title})`,
      );
    }
    btn.onPress(); // fires `void attempt(true)` — lastLoad is reassigned synchronously
    await flushPromises();
    await lastLoad?.catch(() => {});
    await flushPromises();
  };

  return { alerts, start, tapLoadAnyway, lastVisible };
}

describe('Load Anyway override chain (UI helper → service → residency)', () => {
  /** A clean (mmap, dirtyMemory:false) resident to be evicted — the crux of the bug:
   *  the old predictive floor credited 0 MB for evicting a clean model. Its unload
   *  flips `reclaimed` so the RAM sensor reports the memory iOS frees on unload. */
  let reclaimed = false;
  const registerCleanVictim = (sizeMB = 4000) => {
    const unload = jest.fn(async () => {
      reclaimed = true;
    });
    modelResidencyManager.register(
      {
        key: 'whisper',
        type: 'whisper',
        modelId: 'stt-1',
        sizeMB,
        dirtyMemory: false,
      },
      unload,
    );
    return unload;
  };

  // A GGUF (clean) text model whose estimated RAM (~3 GB) exceeds the forced budget.
  const bigGguf = () =>
    createDownloadedModel({
      id: 'big-gguf',
      engine: 'llama' as any,
      fileName: 'big.gguf',
      filePath: '/big.gguf',
      fileSize: 2 * 1024 * 1024 * 1024, // ×1.5 estimate ⇒ ~3072 MB
    });

  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    modelResidencyManager._reset();
    reclaimed = false;

    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.getLoadedModelPath.mockReturnValue(null);
    mockLlmService.loadModel.mockResolvedValue(undefined);
    mockLlmService.unloadModel.mockResolvedValue(undefined);

    mockHardwareService.getDeviceInfo.mockResolvedValue(
      createDeviceInfo({ totalMemory: 12 * 1024 * 1024 * 1024 }),
    );
    mockHardwareService.refreshMemoryInfo.mockResolvedValue({
      totalMemory: 12 * 1024 * 1024 * 1024,
      usedMemory: 11 * 1024 * 1024 * 1024,
      availableMemory: 1 * 1024 * 1024 * 1024,
    } as any);
    mockHardwareService.getModelTotalSize.mockImplementation(
      (m: any) => (m?.fileSize || m?.size || 0) + (m?.mmProjFileSize || 0),
    );
    mockHardwareService.estimateModelRam.mockImplementation(
      (m: any, mult = 1.5) =>
        ((m?.fileSize || m?.size || 0) + (m?.mmProjFileSize || 0)) * mult,
    );
    mockHardwareService.getTotalMemoryGB.mockReturnValue(12);
    // DYNAMIC: low free RAM until the clean victim's unload fires, then the memory
    // iOS reclaims. This is what a static mock cannot express — and what makes the
    // pre-evict-vs-post-evict ordering observable.
    mockHardwareService.getAvailableMemoryGB.mockImplementation(() =>
      reclaimed ? 6 : 1,
    );

    // Force a small residency budget so the ~3 GB model can't fit without eviction —
    // deterministic, independent of the device-RAM heuristics under test elsewhere.
    modelResidencyManager.setBudgetOverrideMB(2000);

    await activeModelService.syncWithNativeState();
  });

  afterEach(() => {
    modelResidencyManager.setBudgetOverrideMB(null);
  });

  it('first load (no override) surfaces an overridable "Insufficient Memory" prompt with a Load Anyway button, and does NOT touch native or evict', async () => {
    registerCleanVictim();
    useAppStore.setState({ downloadedModels: [bigGguf()] });

    const ui = driveLoad('big-gguf');
    await ui.start();

    const prompt = ui.lastVisible();
    expect(prompt?.title).toBe('Insufficient Memory');
    expect(prompt?.buttons?.map(b => b.text)).toEqual([
      'Cancel',
      'Load Anyway',
    ]);
    // A refusal is NOT a load and NOT an eviction — the victim must survive so the
    // user's Load-Anyway retry still has room to reclaim.
    expect(mockLlmService.loadModel).not.toHaveBeenCalled();
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
    expect(getAppState().activeModelId).not.toBe('big-gguf');
  });

  it('tapping Load Anyway evicts the clean resident and unconditionally loads the model, even with pre-eviction free RAM very low', async () => {
    const victimUnload = registerCleanVictim();
    useAppStore.setState({ downloadedModels: [bigGguf()] });

    const ui = driveLoad('big-gguf');
    await ui.start(); // → "Insufficient Memory"
    mockLlmService.isModelLoaded.mockReturnValue(true); // native reports loaded after the forced load
    await ui.tapLoadAnyway();

    // OUTCOME: the clean victim was actually evicted (freeing real RAM)...
    expect(victimUnload).toHaveBeenCalledTimes(1);
    expect(modelResidencyManager.isResident('whisper')).toBe(false);
    // ...and the model loaded through the native engine and became active.
    expect(mockLlmService.loadModel).toHaveBeenCalledTimes(1);
    expect(getAppState().activeModelId).toBe('big-gguf');
    // The user never saw an "Error" dialog — the retry succeeded.
    expect(ui.alerts.map(a => a.title)).not.toContain('Error');
  });

  it('unconditional override: even when real free RAM stays extremely low AFTER eviction, Load Anyway still loads (no survival floor, no refusal) — while WITHOUT override the same model is refused', async () => {
    // Free RAM stays very low even after the eviction unload fires. Under the OLD
    // survival-floor behaviour this was a hard Error; the ratified behaviour is that
    // "Load Anyway" is UNCONDITIONAL — it evicts everything and loads regardless.
    mockHardwareService.getAvailableMemoryGB.mockImplementation(() =>
      reclaimed ? 1.1 : 1,
    );
    const victimUnload = registerCleanVictim();
    useAppStore.setState({ downloadedModels: [bigGguf()] });

    // CONTRAST — WITHOUT override the normal memory gate refuses: an overridable
    // "Insufficient Memory" prompt, native never touched, the victim survives.
    const gated = driveLoad('big-gguf');
    await gated.start();
    expect(gated.lastVisible()?.title).toBe('Insufficient Memory');
    expect(mockLlmService.loadModel).not.toHaveBeenCalled();
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
    expect(getAppState().activeModelId).not.toBe('big-gguf');

    // WITH override (tapping Load Anyway) it evicts the victim and loads unconditionally.
    mockLlmService.isModelLoaded.mockReturnValue(true); // native reports loaded after the forced load
    await gated.tapLoadAnyway();

    expect(victimUnload).toHaveBeenCalledTimes(1);
    expect(modelResidencyManager.isResident('whisper')).toBe(false);
    expect(mockLlmService.loadModel).toHaveBeenCalledTimes(1);
    expect(getAppState().activeModelId).toBe('big-gguf');
    // The override never dead-ends in an Error, and it only offered Load Anyway once.
    expect(gated.alerts.map(a => a.title)).not.toContain('Error');
    const overridePrompts = gated.alerts.filter(
      a => a.title === 'Insufficient Memory',
    );
    expect(overridePrompts).toHaveLength(1);
  });

  it('session memory: after a Load-Anyway succeeds for a model, re-loading the SAME model skips the gate entirely (no second prompt)', async () => {
    registerCleanVictim();
    useAppStore.setState({ downloadedModels: [bigGguf()] });

    // First run: prompt → Load Anyway → loads.
    const first = driveLoad('big-gguf');
    await first.start();
    mockLlmService.isModelLoaded.mockReturnValue(true);
    await first.tapLoadAnyway();
    expect(getAppState().activeModelId).toBe('big-gguf');
    expect(modelResidencyManager.hasSessionOverride('big-gguf')).toBe(true);

    // Simulate the model later being evicted (RAM pressure) so a reload is a real load.
    mockLlmService.isModelLoaded.mockReturnValue(false);
    mockLlmService.loadModel.mockClear();

    // Second run: the session override is remembered → NO "Insufficient Memory" prompt,
    // it just loads. The user is not re-interrogated every swap.
    const second = driveLoad('big-gguf');
    await second.start();
    mockLlmService.isModelLoaded.mockReturnValue(true);
    await flushPromises();

    expect(second.alerts.some(a => a.title === 'Insufficient Memory')).toBe(
      false,
    );
    expect(mockLlmService.loadModel).toHaveBeenCalledTimes(1);
    expect(getAppState().activeModelId).toBe('big-gguf');
  });
});
