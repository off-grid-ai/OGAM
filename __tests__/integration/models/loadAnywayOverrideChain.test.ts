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
 * The headline scenario is the shipped bug (fixed in 0.0.103): tapping "Load Anyway"
 * on a model that genuinely fits still failed. Root cause was in makeRoomFor's
 * override survival floor — it was computed on a PRE-eviction RAM snapshot that
 * credited 0 MB for evicting a CLEAN (mmap GGUF / whisper) resident, so it
 * under-counted the RAM iOS actually reclaims on unload and refused a load the
 * device could do. The fix evicts FIRST, then re-measures real free RAM.
 *
 * This is a fails-before/passes-after test: the RAM mock is DYNAMIC — free RAM is
 * low BEFORE the eviction unload fires and high AFTER (modelling iOS reclaiming the
 * unloaded clean pages). Against origin/main it goes RED (predictive floor refuses,
 * user sees "Error"); against the fix it goes GREEN (measure-after-evict → loads).
 * A static RAM mock could not distinguish the two orderings — that is exactly the
 * bug class a static mock hides.
 */

import { useAppStore } from '../../../src/stores/appStore';
import { activeModelService } from '../../../src/services/activeModelService';
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { llmService } from '../../../src/services/llm';
import { hardwareService } from '../../../src/services/hardware';
import { loadModelWithOverride } from '../../../src/services/loadModelWithOverride';
import { OVERRIDE_SURVIVAL_FLOOR_MB } from '../../../src/services/memoryBudget';
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

  it('THE BUG: tapping Load Anyway evicts the clean resident, re-measures the reclaimed RAM, and loads the model (fails on origin/main, passes on the fix)', async () => {
    const victimUnload = registerCleanVictim();
    useAppStore.setState({ downloadedModels: [bigGguf()] });
    // Sanity: pre-eviction free RAM is genuinely below the survival floor, so a
    // PRE-eviction snapshot (main) is forced to refuse; only measuring AFTER the
    // clean eviction reclaims RAM can pass. This is the fails-before/passes-after pin.
    expect(mockHardwareService.getAvailableMemoryGB() * 1024).toBeLessThan(
      OVERRIDE_SURVIVAL_FLOOR_MB,
    );

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

  it('hard limit: if real free RAM stays below the survival floor even AFTER eviction, Load Anyway refuses once with an Error (no infinite Load-Anyway loop)', async () => {
    // Eviction happens, but the device still cannot survive the load — physics, not a
    // false refusal. Model dirty footprint alone would jetsam mid-load.
    mockHardwareService.getAvailableMemoryGB.mockImplementation(() =>
      reclaimed ? 1.1 : 1,
    ); // 1.1 GB ≈ 1126 MB, still < 1200 MB floor
    registerCleanVictim();
    useAppStore.setState({ downloadedModels: [bigGguf()] });

    const ui = driveLoad('big-gguf');
    await ui.start();
    await ui.tapLoadAnyway();

    // Refused under override ⇒ hard Error, never loaded.
    expect(mockLlmService.loadModel).not.toHaveBeenCalled();
    expect(getAppState().activeModelId).not.toBe('big-gguf');
    const finalAlert = ui.lastVisible();
    expect(finalAlert?.title).toBe('Error');
    // Exactly one Load-Anyway offer — a refusal UNDER override must not re-offer the
    // same failing action (that was the dead-end loop the typed-error split prevents).
    const overridePrompts = ui.alerts.filter(
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
