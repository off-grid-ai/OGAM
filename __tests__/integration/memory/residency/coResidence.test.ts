/**
 * Cross-platform model residency & co-residence — integration guards.
 *
 * Drives the REAL modelResidencyManager + REAL policy + REAL memoryBudget with
 * ONLY the native boundary (hardwareService memory numbers + Platform.OS) mocked,
 * then asserts the OUTCOME the user feels: getResidents() / isResident(key) /
 * evict list / fits — never "the gate was called".
 *
 * These are the GREEN guards. The text+image co-residence OOM (balanced mode lets
 * two heavy generation models both stay resident into a near-OOM state) is a REAL
 * OPEN BUG — see the QA report. It is intentionally NOT asserted as passing here;
 * the guards below pin the behavior that IS correct so a future "Part B" fix can be
 * verified against them without regressing the sidecar / veto / override invariants.
 */
import { Platform } from 'react-native';
import { modelResidencyManager } from '../../../../src/services/modelResidency';
import { hardwareService } from '../../../../src/services/hardware';

/** Deterministic device numbers — no reliance on test-env Platform RAM fractions. */
function mockDevice(totalGB: number, availGB: number): void {
  jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(totalGB);
  jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(availGB);
  jest
    .spyOn(hardwareService, 'refreshMemoryInfo')
    .mockResolvedValue(undefined as never);
}

/** Register an already-loaded resident with a flag-flipping native unload. */
function registerResident(
  spec: {
    key: string;
    type: any;
    sizeMB: number;
    modelId?: string;
    pinned?: boolean;
    dirtyMemory?: boolean;
    canEvict?: () => boolean;
  },
  now = 1,
): jest.Mock {
  const unload = jest.fn().mockResolvedValue(undefined);
  modelResidencyManager.register(spec, unload, now);
  return unload;
}

const originalOS = Platform.OS;

describe.each(['ios', 'android'] as const)(
  'model residency [%s]',
  osUnderTest => {
    beforeEach(() => {
      Platform.OS = osUnderTest;
      modelResidencyManager._reset();
      modelResidencyManager.setLoadPolicy('balanced');
    });
    afterEach(() => {
      jest.restoreAllMocks();
      modelResidencyManager.setLoadPolicy('balanced');
      Platform.OS = originalOS;
    });

    // ── Attack 6: eviction that can't fit even after full eviction must NOT strand ──
    it('never strands the device: an impossible model evicts nothing and reports fits=false', async () => {
      modelResidencyManager.setBudgetOverrideMB(1000);
      const unloadImg = registerResident({
        key: 'image',
        type: 'image',
        sizeMB: 400,
        dirtyMemory: true,
      });
      const { evicted, fits } = await modelResidencyManager.makeRoomFor({
        key: 'text',
        type: 'text',
        sizeMB: 5000,
      });
      expect(fits).toBe(false);
      expect(evicted).toEqual([]);
      expect(unloadImg).not.toHaveBeenCalled();
      // The existing resident is untouched — the device is not left empty.
      expect(modelResidencyManager.isResident('image')).toBe(true);
      expect(modelResidencyManager.getResidents().map(r => r.key)).toEqual([
        'image',
      ]);
    });

    // ── Attack 2: a sidecar load must NEVER evict a generation model mid-answer ──
    it('a whisper (STT) sidecar load never evicts the resident text model — it reports fits=false instead', async () => {
      modelResidencyManager.setBudgetOverrideMB(1000);
      const unloadText = registerResident({
        key: 'text',
        type: 'text',
        sizeMB: 900,
      });
      // 900 (text) + 1500 (whisper) far over the 1000 budget; the ONLY resident is
      // a generation model, which a sidecar may never reclaim.
      const { evicted, fits } = await modelResidencyManager.makeRoomFor({
        key: 'whisper',
        type: 'whisper',
        sizeMB: 1500,
      });
      expect(fits).toBe(false);
      expect(evicted).toEqual([]);
      expect(unloadText).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('text')).toBe(true);
    });

    it('a whisper sidecar load reclaims ONLY a peer sidecar, never the LLM', async () => {
      modelResidencyManager.setBudgetOverrideMB(700);
      const unloadText = registerResident(
        { key: 'text', type: 'text', sizeMB: 500 },
        1,
      );
      const unloadTts = registerResident(
        { key: 'tts', type: 'tts', sizeMB: 150 },
        2,
      );
      // 500 + 150 + 200 = 850 > 700 → reclaim the peer sidecar (tts), keep the LLM.
      const { evicted, fits } = await modelResidencyManager.makeRoomFor({
        key: 'whisper',
        type: 'whisper',
        sizeMB: 200,
      });
      expect(fits).toBe(true);
      expect(evicted).toEqual(['tts']);
      expect(unloadTts).toHaveBeenCalledTimes(1);
      expect(unloadText).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('text')).toBe(true);
      expect(modelResidencyManager.isResident('tts')).toBe(false);
    });

    // ── canEvict veto must hold on the capacity path ──
    it('capacity eviction respects the canEvict veto (a playing TTS is never evicted for an incoming heavy model)', async () => {
      modelResidencyManager.setBudgetOverrideMB(1000);
      mockDevice(4, 3);
      const ttsUnload = registerResident({
        key: 'tts',
        type: 'tts',
        sizeMB: 320,
        canEvict: () => false, // in use — owner vetoes
      });
      const { evicted, fits } = await modelResidencyManager.makeRoomFor({
        key: 'text',
        type: 'text',
        sizeMB: 900,
      });
      // 320 (pinned-by-veto) + 900 = 1220 > 1000, and the only victim vetoes → no evict.
      expect(fits).toBe(false);
      expect(evicted).toEqual([]);
      expect(ttsUnload).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('tts')).toBe(true);
    });

    // ── Attack 5: reclaimSttForGeneration ──
    it('reclaimSttForGeneration frees idle whisper on a tight (≤6GB) device', async () => {
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(4);
      const unload = registerResident({
        key: 'whisper',
        type: 'whisper',
        sizeMB: 466,
      });
      await modelResidencyManager.reclaimSttForGeneration();
      expect(unload).toHaveBeenCalledTimes(1);
      expect(modelResidencyManager.isResident('whisper')).toBe(false);
    });

    it('reclaimSttForGeneration keeps whisper warm on a roomy (>6GB) device', async () => {
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(8);
      const unload = registerResident({
        key: 'whisper',
        type: 'whisper',
        sizeMB: 466,
      });
      await modelResidencyManager.reclaimSttForGeneration();
      expect(unload).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('whisper')).toBe(true);
    });

    it('reclaimSttForGeneration honors the in-use veto and never touches whisper mid-transcription', async () => {
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(4);
      const unload = registerResident({
        key: 'whisper',
        type: 'whisper',
        sizeMB: 466,
        canEvict: () => false,
      });
      await modelResidencyManager.reclaimSttForGeneration();
      expect(unload).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('whisper')).toBe(true);
    });

    it('reclaimSttForGeneration is a no-op when whisper is not resident (tight device)', async () => {
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(4);
      const textUnload = registerResident({
        key: 'text',
        type: 'text',
        sizeMB: 500,
      });
      await modelResidencyManager.reclaimSttForGeneration();
      expect(textUnload).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('text')).toBe(true);
    });

    // ── Attack 7: canLoadWithoutEviction (boot preloader) never kicks anyone ──
    it('canLoadWithoutEviction never kicks a resident: false when it would need eviction, true only when it fits alongside', async () => {
      modelResidencyManager.setBudgetOverrideMB(1000);
      mockDevice(8, 6);
      const unloadText = registerResident({
        key: 'text',
        type: 'text',
        sizeMB: 700,
      });
      // 700 + 200 fits; 700 + 400 does not — and the preloader must NOT evict text.
      expect(
        modelResidencyManager.canLoadWithoutEviction({
          key: 'whisper',
          sizeMB: 200,
        }),
      ).toBe(true);
      expect(
        modelResidencyManager.canLoadWithoutEviction({
          key: 'image',
          sizeMB: 400,
        }),
      ).toBe(false);
      // It is a pure predicate — asserting it did not mutate residency.
      expect(unloadText).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('text')).toBe(true);
    });

    // ── Attack 3: session override is per-model, no leak to a different model ──
    it('session override auto-skips the gate for the SAME model but never leaks to a different model', async () => {
      modelResidencyManager.setBudgetOverrideMB(1000);
      mockDevice(12, 4);
      const modelA = {
        key: 'text',
        type: 'text' as const,
        modelId: 'org/model-A',
        sizeMB: 2000,
      };
      const modelB = {
        key: 'text',
        type: 'text' as const,
        modelId: 'org/model-B',
        sizeMB: 2000,
      };
      // A is refused without override…
      expect((await modelResidencyManager.makeRoomFor(modelA)).fits).toBe(false);
      // …user taps Load Anyway → forced + remembered for the session…
      expect(
        (await modelResidencyManager.makeRoomFor(modelA, { override: true }))
          .fits,
      ).toBe(true);
      expect(modelResidencyManager.hasSessionOverride('org/model-A')).toBe(true);
      // …a later plain load of A auto-overrides (no re-prompt)…
      expect((await modelResidencyManager.makeRoomFor(modelA)).fits).toBe(true);
      // …but B (a DIFFERENT modelId, same 'text' slot key) is still gated.
      expect(modelResidencyManager.hasSessionOverride('org/model-B')).toBe(
        false,
      );
      expect((await modelResidencyManager.makeRoomFor(modelB)).fits).toBe(false);
    });

    // ── Attack 4: FIFO lock keeps concurrent text+image loads from desyncing ──
    it('concurrent text+image loads through the FIFO lock never leave two heavies both registered when the budget forbids it', async () => {
      // Tight budget: only ONE of the two heavies can be resident at a time.
      modelResidencyManager.setBudgetOverrideMB(2000);
      mockDevice(6, 5);

      const runLoad = (key: 'text' | 'image', sizeMB: number) =>
        modelResidencyManager.runExclusive(`load:${key}`, async () => {
          const { fits } = await modelResidencyManager.makeRoomFor({
            key,
            type: key,
            sizeMB,
            dirtyMemory: key === 'image',
          });
          if (!fits) return;
          modelResidencyManager.register(
            { key, type: key, sizeMB, dirtyMemory: key === 'image' },
            jest.fn().mockResolvedValue(undefined),
          );
        });

      // Fire both concurrently; the lock serializes them so the second sees the first.
      await Promise.all([runLoad('text', 1500), runLoad('image', 1500)]);

      const residents = modelResidencyManager.getResidents();
      const heavies = residents.filter(
        r => r.type === 'text' || r.type === 'image',
      );
      // 1500 + 1500 = 3000 > 2000 budget → the two heavies must NOT both be resident.
      expect(heavies.length).toBe(1);
    });
  },
);
