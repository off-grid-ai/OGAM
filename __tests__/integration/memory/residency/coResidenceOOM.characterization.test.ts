/**
 * CHARACTERIZATION of the text+image co-residence OOM bug (REAL OPEN BUG).
 *
 * This file does NOT assert desired behavior — it PINS the current, wrong behavior
 * using the exact device numbers from the field log:
 *
 *   12GB Android, residents=[text:5235MB, image:2369MB] availMB=640
 *
 * The intended design (policy.ts top doc comment, MODEL_ROUTING.md §4-5.2) is that
 * two HEAVY generation models (text + image) are MUTUALLY EXCLUSIVE — loading one
 * swaps out the other. The implementation (policy.ts `planEviction` balanced branch,
 * lines ~157-172, "Text + image co-reside when they fit — no forced mutual exclusion")
 * does the OPPOSITE: it co-resides them whenever the PHYSICAL budget allows, and on
 * Android the dirty-RAM gate is defeated because effectiveAvailableMB() clamps the
 * real 640MB availMem UP to the physical budget (~8602MB). So both heavies stay
 * resident with ~640MB free — the near-OOM state the log captured.
 *
 * Because the fix ("Part B", pending) will INVERT these expectations, this test is
 * quarantined from the normal guard file and named `.characterization.` so it is
 * obvious it encodes a defect, not a contract. When the swap fix lands, this file
 * should be DELETED and replaced by a mutual-exclusion guard in coResidence.test.ts.
 *
 * Run: it is GREEN today (documents the bug); it will go RED when the bug is fixed —
 * that red is the signal to swap it for the proper guard.
 */
import { Platform } from 'react-native';
import { modelResidencyManager } from '../../../../src/services/modelResidency';
import { hardwareService } from '../../../../src/services/hardware';

const originalOS = Platform.OS;

/**
 * Model the FULL caller load path: makeRoomFor plans+evicts, and the caller
 * (activeModelService) registers the incoming model only when it fits — exactly
 * what doLoadTextModelLocked / doLoadImageModelLocked do via their onLoaded
 * register callback. makeRoomFor itself does NOT register the incoming model, so
 * getResidents() only reflects the true post-load state after this register step.
 */
async function loadHeavy(spec: {
  key: 'text' | 'image';
  modelId: string;
  sizeMB: number;
  dirtyMemory?: boolean;
}): Promise<{ fits: boolean; evicted: string[] }> {
  const room = await modelResidencyManager.makeRoomFor({
    key: spec.key,
    type: spec.key,
    modelId: spec.modelId,
    sizeMB: spec.sizeMB,
    dirtyMemory: spec.dirtyMemory,
  });
  if (room.fits) {
    modelResidencyManager.register(
      {
        key: spec.key,
        type: spec.key,
        modelId: spec.modelId,
        sizeMB: spec.sizeMB,
        dirtyMemory: spec.dirtyMemory,
      },
      jest.fn().mockResolvedValue(undefined),
    );
  }
  return { fits: room.fits, evicted: room.evicted };
}

describe('co-residence OOM characterization (documents the open bug)', () => {
  beforeEach(() => {
    modelResidencyManager._reset();
    modelResidencyManager.setLoadPolicy('balanced');
    modelResidencyManager.setBudgetOverrideMB(null); // use the REAL device-tiered budget
    jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(12);
    jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(640 / 1024);
    jest
      .spyOn(hardwareService, 'refreshMemoryInfo')
      .mockResolvedValue(undefined as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    modelResidencyManager.setLoadPolicy('balanced');
    Platform.OS = originalOS;
  });

  it('ANDROID balanced: a heavy IMAGE loads alongside a resident 5.2GB TEXT model with only 640MB free (BUG — should have swapped)', async () => {
    Platform.OS = 'android';
    // The 5.2GB GGUF text model is already resident (clean/mmap, dirtyMemory=false).
    modelResidencyManager.register(
      { key: 'text', type: 'text', modelId: 'gemma-text', sizeMB: 5235 },
      jest.fn().mockResolvedValue(undefined),
      1,
    );
    // The 2.37GB image model arrives. Intended design: text↔image are mutually
    // exclusive → text should be evicted. Actual: they co-reside.
    const { fits, evicted } = await loadHeavy({
      key: 'image',
      modelId: 'sd-image',
      sizeMB: 2369,
      dirtyMemory: true,
    });

    // ── CURRENT (BUGGY) OUTCOME ──
    expect(fits).toBe(true);
    expect(evicted).toEqual([]); // BUG: text should be in this list
    // Both heavies are resident at once → the exact log state.
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(modelResidencyManager.isResident('image')).toBe(true);
    const heavies = modelResidencyManager
      .getResidents()
      .filter(r => r.type === 'text' || r.type === 'image');
    expect(heavies.length).toBe(2); // BUG: two heavy generation models co-resident
    const residentMB = heavies.reduce((s, r) => s + r.sizeMB, 0);
    expect(residentMB).toBe(7604); // 5235 + 2369, into a 12GB phone with 640MB free

    // The DESIRED behavior a future fix must produce (documented, not asserted):
    //   expect(evicted).toEqual(['text']);
    //   expect(modelResidencyManager.isResident('text')).toBe(false);
    //   expect(heavies.length).toBe(1);
  });

  it('ANDROID balanced: the Android reclaim-aware clamp is what defeats the dirty-RAM gate here', async () => {
    Platform.OS = 'android';
    // Load the IMAGE first (dirty) so the incoming TEXT hits the dirty-pressure branch,
    // proving the gate is defeated in BOTH orderings, not just image-second.
    modelResidencyManager.register(
      {
        key: 'image',
        type: 'image',
        modelId: 'sd-image',
        sizeMB: 2369,
        dirtyMemory: true,
      },
      jest.fn().mockResolvedValue(undefined),
      1,
    );
    const { fits, evicted } = await loadHeavy({
      key: 'text',
      modelId: 'gemma-text',
      sizeMB: 5235, // clean GGUF
    });
    // Even though real avail is 640MB, effectiveAvailableMB() clamps to the physical
    // budget on Android, so the incoming text co-loads — near-OOM co-residence.
    expect(fits).toBe(true);
    expect(evicted).toEqual([]);
    expect(modelResidencyManager.getResidents().length).toBe(2);
  });

  it('AGGRESSIVE mode DOES swap (single-model) — proving the fix belongs in the balanced branch', async () => {
    Platform.OS = 'android';
    modelResidencyManager.setLoadPolicy('aggressive');
    const unloadText = jest.fn().mockResolvedValue(undefined);
    modelResidencyManager.register(
      { key: 'text', type: 'text', modelId: 'gemma-text', sizeMB: 5235 },
      unloadText,
      1,
    );
    const { fits, evicted } = await loadHeavy({
      key: 'image',
      modelId: 'sd-image',
      sizeMB: 2369,
      dirtyMemory: true,
    });
    // Aggressive keeps ONE model at a time — this is the mutual exclusion balanced lacks.
    expect(fits).toBe(true);
    expect(evicted).toEqual(['text']);
    expect(unloadText).toHaveBeenCalledTimes(1);
    expect(modelResidencyManager.isResident('text')).toBe(false);
    expect(modelResidencyManager.isResident('image')).toBe(true);
    // Only ONE heavy resident — the swap balanced fails to do.
    expect(
      modelResidencyManager
        .getResidents()
        .filter(r => r.type === 'text' || r.type === 'image').length,
    ).toBe(1);
  });
});
