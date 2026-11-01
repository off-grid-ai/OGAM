/**
 * Integration test — the "Load Anyway" memory-override CHAIN, end to end.
 *
 * Exercises the REAL seam a user drives when a big model is memory-blocked:
 *
 *   loadModelWithOverride  (the UI-intent helper every screen calls)
 *      → activeModelService.loadTextModel(..., { override })  (the single load gateway)
 *         → modelResidencyManager.makeRoomFor({ override })    (the memory gate + eviction)
 *
 * Only the phone is faked (installNativeBoundary): llama.rn and whisper.rn (the native engines),
 * the disk and the RAM sensor. `loadModelWithOverride`, `activeModelService`, llmService,
 * whisperStore and whisperService, `modelResidencyManager`, the residency policy, hardwareService,
 * the stores, and the real alert state helpers all run for real. We assert the OUTCOME the user
 * feels (model loaded / refused, which dialog they see) and what the native engines were asked to
 * open and release, never `expect(gate).toHaveBeenCalled()`.
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
 * The RAM sensor is DYNAMIC — free RAM is low BEFORE the eviction unload fires and (in the
 * reclaim case) high AFTER, the way iOS reclaims an unloaded model's pages — so the eviction is a
 * real native release the residency manager observes, not a static number.
 */
import { installNativeBoundary, GB, MB, type NativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

interface AlertState {
  visible: boolean;
  title: string;
  buttons?: Array<{ text: string; onPress?: () => void }>;
}

const LOW_RAM = { platform: 'ios' as const, totalBytes: 12 * GB, availBytes: 1 * GB };

let boundary: NativeBoundary;
let activeModelService: any;
let residency: any;
let useAppStore: any;
let loadModelWithOverride: any;

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
/** How many times llama.rn was asked to open a text model. */
const textLoads = () => boundary.llama!.calls.initLlama.filter(p => !p.embedding).length;

/**
 * Drives the exact override chain a screen runs: hand loadModelWithOverride a thunk that loads
 * through the real activeModelService, capture every alert the helper raises, and expose a
 * `tapLoadAnyway()` that presses the real "Load Anyway" button (and awaits the fire-and-forget
 * retry the helper kicks off).
 */
function driveLoad(modelId: string) {
  const alerts: AlertState[] = [];
  let lastLoad: Promise<void> | undefined;
  const load = (opts?: { override?: boolean }) => {
    lastLoad = activeModelService.loadTextModel(modelId, undefined, opts);
    return lastLoad;
  };
  const start = () => loadModelWithOverride(load, { setAlertState: (a: AlertState) => alerts.push(a) });
  const lastVisible = () => [...alerts].reverse().find(a => a.visible);
  const tapLoadAnyway = async () => {
    const prompt = lastVisible();
    const btn = prompt?.buttons?.find(b => b.text === 'Load Anyway');
    if (!btn?.onPress) throw new Error(`No "Load Anyway" button on the last alert (title=${prompt?.title})`);
    btn.onPress(); // fires `void attempt(true)` — lastLoad is reassigned synchronously
    await flush();
    await lastLoad?.catch(() => {});
    await flush();
  };
  return { alerts, start, tapLoadAnyway, lastVisible };
}

/**
 * A speech-to-text model is resident — the evictable victim. When the native whisper context is
 * released, the phone's free RAM becomes `afterReleaseGB` (iOS reclaiming its pages).
 */
async function loadWhisperVictim(afterReleaseGB: number): Promise<{ released: () => boolean }> {
  const { useWhisperStore } = require('../../../src/stores/whisperStore');
  const { whisperService } = require('../../../src/services/whisperService');
  boundary.fs!.seedFile(whisperService.getModelPath('small'), 466 * MB);
  await useWhisperStore.getState().selectModel('small');
  expect(residency.isResident('whisper')).toBe(true);

  const context = await boundary.whisper!.module.initWhisper.mock.results[0].value;
  const release = context.release.getMockImplementation();
  let released = false;
  context.release.mockImplementation(async () => {
    await release?.();
    released = true;
    boundary.setRam({ ...LOW_RAM, availBytes: afterReleaseGB * GB });
  });
  return { released: () => released };
}

beforeEach(async () => {
  boundary = installNativeBoundary({ llama: true, whisper: true, fs: true, ram: LOW_RAM });
  ({ activeModelService } = require('../../../src/services/activeModelService'));
  ({ modelResidencyManager: residency } = require('../../../src/services/modelResidency'));
  ({ useAppStore } = require('../../../src/stores'));
  ({ loadModelWithOverride } = require('../../../src/services/loadModelWithOverride'));
  await require('../../../src/services/hardware').hardwareService.refreshMemoryInfo();

  // A GGUF (clean) text model whose estimated RAM (~3 GB) exceeds the forced budget, downloaded.
  const filePath = `${boundary.fs!.DocumentDirectoryPath}/models/big.gguf`;
  boundary.fs!.seedFile(filePath, 500 * MB);
  useAppStore.getState().addDownloadedModel(createDownloadedModel({
    id: 'big-gguf', engine: 'llama', fileName: 'big.gguf', filePath, fileSize: 2 * GB,
  }));

  // Force a small residency budget so the ~3 GB model can't fit without eviction —
  // deterministic, independent of the device-RAM heuristics under test elsewhere.
  residency.setBudgetOverrideMB(2000);
});

afterEach(() => {
  residency.setBudgetOverrideMB(null);
});

describe('Load Anyway override chain (UI helper → service → residency)', () => {
  it('first load (no override) surfaces an overridable "Insufficient Memory" prompt with a Load Anyway button, and does NOT touch native or evict', async () => {
    await loadWhisperVictim(6);

    const ui = driveLoad('big-gguf');
    await ui.start();

    const prompt = ui.lastVisible();
    expect(prompt?.title).toBe('Insufficient Memory');
    expect(prompt?.buttons?.map(b => b.text)).toEqual(['Cancel', 'Load Anyway']);
    // A refusal is NOT a load and NOT an eviction — the victim must survive so the
    // user's Load-Anyway retry still has room to reclaim.
    expect(textLoads()).toBe(0);
    expect(residency.isResident('whisper')).toBe(true);
    expect(useAppStore.getState().activeModelId).not.toBe('big-gguf');
  });

  it('tapping Load Anyway evicts the clean resident and unconditionally loads the model, even with pre-eviction free RAM very low', async () => {
    const victim = await loadWhisperVictim(6);

    const ui = driveLoad('big-gguf');
    await ui.start(); // → "Insufficient Memory"
    await ui.tapLoadAnyway();

    // OUTCOME: the victim was actually evicted (its native context released, freeing real RAM)...
    expect(victim.released()).toBe(true);
    expect(residency.isResident('whisper')).toBe(false);
    // ...and the model loaded through the native engine and became active.
    expect(textLoads()).toBe(1);
    expect(useAppStore.getState().activeModelId).toBe('big-gguf');
    // The user never saw an "Error" dialog — the retry succeeded.
    expect(ui.alerts.map(a => a.title)).not.toContain('Error');
  });

  it('unconditional override: even when real free RAM stays extremely low AFTER eviction, Load Anyway still loads (no survival floor, no refusal) — while WITHOUT override the same model is refused', async () => {
    // Free RAM stays very low even after the eviction unload fires. Under the OLD
    // survival-floor behaviour this was a hard Error; the ratified behaviour is that
    // "Load Anyway" is UNCONDITIONAL — it evicts everything and loads regardless.
    const victim = await loadWhisperVictim(1.1);

    // CONTRAST — WITHOUT override the normal memory gate refuses: an overridable
    // "Insufficient Memory" prompt, native never touched, the victim survives.
    const gated = driveLoad('big-gguf');
    await gated.start();
    expect(gated.lastVisible()?.title).toBe('Insufficient Memory');
    expect(textLoads()).toBe(0);
    expect(residency.isResident('whisper')).toBe(true);
    expect(useAppStore.getState().activeModelId).not.toBe('big-gguf');

    // WITH override (tapping Load Anyway) it evicts the victim and loads unconditionally.
    await gated.tapLoadAnyway();

    expect(victim.released()).toBe(true);
    expect(residency.isResident('whisper')).toBe(false);
    expect(textLoads()).toBe(1);
    expect(useAppStore.getState().activeModelId).toBe('big-gguf');
    // The override never dead-ends in an Error, and it only offered Load Anyway once.
    expect(gated.alerts.map(a => a.title)).not.toContain('Error');
    expect(gated.alerts.filter(a => a.title === 'Insufficient Memory')).toHaveLength(1);
  });

  it('session memory: after a Load-Anyway succeeds for a model, re-loading the SAME model skips the gate entirely (no second prompt)', async () => {
    await loadWhisperVictim(6);

    // First run: prompt → Load Anyway → loads.
    const first = driveLoad('big-gguf');
    await first.start();
    await first.tapLoadAnyway();
    expect(useAppStore.getState().activeModelId).toBe('big-gguf');
    expect(residency.hasSessionOverride('big-gguf')).toBe(true);

    // The model is later ejected from memory (it stays selected), so a reload is a real load.
    await activeModelService.ejectAll();
    boundary.setRam(LOW_RAM);

    // Second run: the session override is remembered → NO "Insufficient Memory" prompt,
    // it just loads. The user is not re-interrogated every swap.
    const second = driveLoad('big-gguf');
    await second.start();
    await flush();

    expect(second.alerts.some(a => a.title === 'Insufficient Memory')).toBe(false);
    expect(textLoads()).toBe(2);
    expect(useAppStore.getState().activeModelId).toBe('big-gguf');
  });
});
