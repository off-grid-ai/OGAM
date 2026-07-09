/**
 * Model residency policy + manager tests.
 *
 * The memory-budget / eviction core of model routing: generation models are
 * mutually exclusive, pinned models are never evicted, and LRU eviction frees
 * room for an incoming model. See docs/design/MODEL_ROUTING.md.
 */
import { planEviction, computeBudgetMB, Resident } from '../../../src/services/modelResidency/policy';
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { hardwareService } from '../../../src/services/hardware';

const R = (key: string, type: any, sizeMB: number, lastUsedAt: number, pinned = false): Resident =>
  ({ key, type, sizeMB, lastUsedAt, pinned });

describe('computeBudgetMB', () => {
  it('takes the smaller of fraction-of-RAM and RAM-minus-reserve', () => {
    // 8GB tier (0.60): 0.6*8192=4915 vs 8192-1500=6692 → 4915
    expect(Math.round(computeBudgetMB(8192))).toBe(4915);
    // 3GB tier (≤4GB → 0.50, unified with the pre-load check, not a flat 0.6):
    // 0.50*3072=1536 vs 3072-1500=1572 → 1536 (fraction dominates on low RAM)
    expect(Math.round(computeBudgetMB(3072))).toBe(1536);
  });

  it('never returns negative', () => {
    expect(computeBudgetMB(1000)).toBe(0);
  });

  it('passes the load policy through to the budget owner (aggressive > balanced)', () => {
    expect(computeBudgetMB(24576, { policy: 'aggressive' })).toBeGreaterThan(
      computeBudgetMB(24576, { policy: 'balanced' }),
    );
    // Omitting policy is behaviour-neutral (balanced).
    expect(computeBudgetMB(24576)).toBe(computeBudgetMB(24576, { policy: 'balanced' }));
  });
});

describe('planEviction', () => {
  it('keeps text and image co-resident when both fit (no forced mutual exclusion)', () => {
    // Smart routing: if there is budget, keep fitting models — image-gen with
    // prompt enhancement keeps BOTH the image model and the text model warm.
    const current = [R('img', 'image', 400, 1)];
    const plan = planEviction(current, { key: 'txt', type: 'text', sizeMB: 800 }, 4000);
    expect(plan.evict).toEqual([]); // 400 + 800 = 1200 ≤ 4000 → keep both
    expect(plan.fits).toBe(true);
  });

  describe('singleModel (aggressive / no co-residency)', () => {
    it('evicts an already-fitting co-resident so only one model remains', () => {
      // Same inputs as the co-residency test above (both fit in 4000), but singleModel
      // forces eviction — keep ONE model at a time.
      const current = [R('img', 'image', 400, 1)];
      const plan = planEviction(current, { key: 'txt', type: 'text', sizeMB: 800 }, 4000, { singleModel: true });
      expect(plan.evict.map(e => e.key)).toEqual(['img']);
      expect(plan.fits).toBe(true);
    });

    it('evicts EVERY evictable resident, keeping only the incoming', () => {
      const current = [R('img', 'image', 400, 3), R('stt', 'whisper', 300, 2), R('tts', 'tts', 200, 1)];
      const plan = planEviction(current, { key: 'txt', type: 'text', sizeMB: 500 }, 8000, { singleModel: true });
      expect(plan.evict.map(e => e.key).sort()).toEqual(['img', 'stt', 'tts']);
      expect(plan.fits).toBe(true);
    });

    it('still never evicts a pinned resident (classifier survives)', () => {
      const current = [R('smol', 'classifier', 100, 2, true), R('img', 'image', 400, 1)];
      const plan = planEviction(current, { key: 'txt', type: 'text', sizeMB: 500 }, 8000, { singleModel: true });
      expect(plan.evict.map(e => e.key)).toEqual(['img']); // pinned classifier kept
      expect(plan.evict.some(e => e.key === 'smol')).toBe(false);
    });

    it('re-loading the already-resident model evicts the others (no-op cost for self)', () => {
      const current = [R('txt', 'text', 800, 2), R('img', 'image', 400, 1)];
      const plan = planEviction(current, { key: 'txt', type: 'text', sizeMB: 800 }, 8000, { singleModel: true });
      expect(plan.evict.map(e => e.key)).toEqual(['img']);
      expect(plan.fits).toBe(true);
    });
  });

  it('evicts by priority (sidecar < image < text), lowest first, one at a time', () => {
    // Over budget: free the lowest-priority resident first. text is highest and
    // must survive; the sidecar goes before the image model.
    const current = [
      R('txt', 'text', 800, 3),
      R('img', 'image', 800, 2),
      R('stt', 'whisper', 300, 1),
    ];
    // Incoming text (already-style heavy) needs 800; budget 1900.
    // used = img800 + stt300 = 1100 (txt is the incoming key, excluded). +800 = 1900 ≤ 1900? evict nothing.
    // Tighten budget to force exactly one eviction of the lowest-priority victim.
    const plan = planEviction(current, { key: 'txt2', type: 'text', sizeMB: 800 }, 1800);
    // used initially = 800+800+300 = 1900; +800 = 2700 > 1800. Evict lowest first:
    // stt(300)→1600+800=2400>1800; img(800)→ used 800, +800=1600 ≤1800. Stop.
    expect(plan.evict.map(e => e.key)).toEqual(['stt', 'img']); // sidecar then image; text kept
    expect(plan.evict.some(e => e.key === 'txt')).toBe(false);
    expect(plan.fits).toBe(true);
  });

  it('swaps out a single LRU victim for a 4th model rather than clearing all', () => {
    const current = [
      R('txt', 'text', 600, 5),
      R('sttA', 'whisper', 300, 1), // least-recently-used sidecar
      R('ttsB', 'tts', 300, 4),
    ];
    // Incoming sidecar (embedding) 300; budget 1300. used=1200, +300=1500>1300.
    // Sidecar may only reclaim peer sidecars; evict the LRU one (sttA): used drops
    // to 900, +300=1200 ≤ 1300 → stop. One victim, not a clear.
    const plan = planEviction(current, { key: 'emb', type: 'embedding', sizeMB: 300 }, 1300);
    expect(plan.evict.map(e => e.key)).toEqual(['sttA']); // one victim, LRU peer; text untouched
    expect(plan.evict.some(e => e.key === 'txt')).toBe(false);
    expect(plan.fits).toBe(true);
  });

  it('keeps a small whisper model resident alongside a generation model', () => {
    const current = [R('whisper', 'whisper', 200, 1)];
    const plan = planEviction(current, { key: 'txt', type: 'text', sizeMB: 800 }, 4000);
    expect(plan.evict).toEqual([]); // whisper is not a generation model → not evicted
    expect(plan.fits).toBe(true);
  });

  it('never evicts a pinned resident (e.g. the classifier)', () => {
    const current = [R('classifier', 'classifier', 100, 1, true), R('img', 'image', 800, 2)];
    // Loading text swaps out the image model (mutual exclusion); the pinned
    // classifier survives.
    const plan = planEviction(current, { key: 'txt', type: 'text', sizeMB: 800 }, 900);
    expect(plan.evict.map(e => e.key)).toEqual(['img']);
    expect(plan.evict.some(e => e.key === 'classifier')).toBe(false);
  });

  it('keeps whisper/tts sidecars resident when the generation model fits alongside them', () => {
    const current = [
      R('whisper', 'whisper', 150, 30),
      R('tts', 'tts', 120, 10),
    ];
    // 270 (sidecars) + 600 (text) = 870 <= 900 → everything fits, nothing evicted.
    const plan = planEviction(current, { key: 'txt', type: 'text', sizeMB: 600 }, 900);
    expect(plan.evict).toEqual([]);
    expect(plan.fits).toBe(true);
  });

  it('evicts sidecars only as a last resort, after non-sidecars, to fit a generation model', () => {
    const current = [
      R('cls', 'classifier', 100, 5),   // non-sidecar, unpinned → evicted first
      R('whisper', 'whisper', 150, 30),
      R('tts', 'tts', 120, 10),          // sidecar, oldest → evicted before whisper
    ];
    // used 370 + text 800 = 1170 > 900. Evict non-sidecar (cls) first, then
    // sidecars LRU (tts then whisper) until it fits.
    const plan = planEviction(current, { key: 'txt', type: 'text', sizeMB: 800 }, 900);
    expect(plan.evict.map(e => e.key)).toEqual(['cls', 'tts', 'whisper']);
    expect(plan.fits).toBe(true);
  });

  it('does not evict anything when loading a small sidecar', () => {
    const current = [R('txt', 'text', 800, 1)];
    const plan = planEviction(current, { key: 'whisper', type: 'whisper', sizeMB: 150 }, 900);
    // Loading whisper coexists with the text model rather than swapping it out,
    // even though it overshoots the budget (only PEER sidecars are reclaimable).
    expect(plan.evict).toEqual([]);
  });

  it('loading TTS evicts the idle STT (peer sidecar) to fit, never the LLM', () => {
    const current = [R('txt', 'text', 500, 1), R('whisper', 'whisper', 150, 5)];
    // used 650 + tts 200 = 850 > 700; evict the peer sidecar (whisper) → 500+200=700 fits.
    const plan = planEviction(current, { key: 'tts', type: 'tts', sizeMB: 200 }, 700);
    expect(plan.evict.map(e => e.key)).toEqual(['whisper']);
    expect(plan.fits).toBe(true);
  });

  it('loading TTS never evicts the LLM — reports fits=false so the caller bails (no OOM)', () => {
    const current = [R('txt', 'text', 800, 1)];
    // No peer sidecar to reclaim; the LLM is off-limits → don't evict it, just say
    // it doesn't fit so TTS degrades gracefully instead of loading into a jetsam kill.
    const plan = planEviction(current, { key: 'tts', type: 'tts', sizeMB: 320 }, 700);
    expect(plan.evict).toEqual([]);
    expect(plan.fits).toBe(false);
  });

  it('charges no cost for a model that is already resident', () => {
    const current = [R('txt', 'text', 800, 1)];
    const plan = planEviction(current, { key: 'txt', type: 'text', sizeMB: 800 }, 900);
    expect(plan.evict).toEqual([]);
    expect(plan.fits).toBe(true);
  });

  it('reports fits=false when even full eviction is not enough', () => {
    const current = [R('classifier', 'classifier', 100, 1, true)];
    const plan = planEviction(current, { key: 'huge', type: 'text', sizeMB: 5000 }, 1000);
    expect(plan.fits).toBe(false);
  });

  // The litmus test: image-gen with prompt-enhance IN AUDIO MODE — text (LLM) +
  // Whisper (STT) + Kokoro (TTS) all resident, then a heavy image model arrives.
  describe('image-gen-in-audio scenario (STT/TTS resident)', () => {
    const audioResidents = () => [
      R('txt', 'text', 1500, 4),     // LLM (highest priority — evicted last)
      R('stt', 'whisper', 1500, 1),  // Whisper — sidecar, least-recently-used
      R('tts', 'tts', 320, 2),       // Kokoro — sidecar
    ];

    it('frees ONLY the sidecars (STT then TTS) when that fits the image, keeping the LLM', () => {
      // used = 1500+1500+320 = 3320; image 1200 → after freeing both sidecars:
      // 1500 (txt) + 1200 = 2700 ≤ 3000 budget → text survives.
      const plan = planEviction(audioResidents(), { key: 'img', type: 'image', sizeMB: 1200 }, 3000);
      expect(plan.evict.map(e => e.key)).toEqual(['stt', 'tts']); // sidecars first, LRU order
      expect(plan.evict.some(e => e.key === 'txt')).toBe(false);  // LLM kept
      expect(plan.fits).toBe(true);                               // no OOM
    });

    it('evicts sidecars THEN the LLM (last resort) for a heavy image, and still fits', () => {
      const plan = planEviction(audioResidents(), { key: 'img', type: 'image', sizeMB: 2500 }, 3000);
      expect(plan.evict.map(e => e.key)).toEqual(['stt', 'tts', 'txt']); // sidecars first, text last
      expect(plan.fits).toBe(true);                                      // swapped to fit, not OOM
    });

    it('an incoming sidecar (TTS) never evicts the LLM or image — only peer sidecars', () => {
      const current = [R('txt', 'text', 1500, 4), R('img', 'image', 1200, 3), R('stt', 'whisper', 1500, 1)];
      // Loading TTS over budget may only reclaim from the peer sidecar (STT), never
      // the generation models — so an in-flight answer/image is never killed for a speaker.
      const plan = planEviction(current, { key: 'tts', type: 'tts', sizeMB: 320 }, 3200);
      expect(plan.evict.map(e => e.key)).toEqual(['stt']);
      expect(plan.evict.some(e => e.key === 'txt' || e.key === 'img')).toBe(false);
    });
  });
});

describe('ModelResidencyManager', () => {
  beforeEach(() => {
    modelResidencyManager._reset();
    modelResidencyManager.setBudgetOverrideMB(1000);
  });

  it('loads a model and tracks it as resident', async () => {
    const load = jest.fn(async () => {});
    const res = await modelResidencyManager.ensureResident({ key: 'txt', type: 'text', sizeMB: 800 }, { load: load, unload: async () => {} }, 1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(res.loaded).toBe(true);
    expect(modelResidencyManager.isResident('txt')).toBe(true);
  });

  it('does not reload an already-resident model', async () => {
    const load = jest.fn(async () => {});
    await modelResidencyManager.ensureResident({ key: 'txt', type: 'text', sizeMB: 800 }, { load: load, unload: async () => {} }, 1);
    const res = await modelResidencyManager.ensureResident({ key: 'txt', type: 'text', sizeMB: 800 }, { load: load, unload: async () => {} }, 2);
    expect(load).toHaveBeenCalledTimes(1);
    expect(res.loaded).toBe(false);
  });

  it('evicts (and unloads) the previous generation model when switching text→image', async () => {
    const unloadText = jest.fn(async () => {});
    await modelResidencyManager.ensureResident({ key: 'txt', type: 'text', sizeMB: 800 }, { load: async () => {}, unload: unloadText }, 1);
    const res = await modelResidencyManager.ensureResident({ key: 'img', type: 'image', sizeMB: 400 }, { load: async () => {}, unload: async () => {} }, 2);
    expect(unloadText).toHaveBeenCalledTimes(1);
    expect(res.evicted).toContain('txt');
    expect(modelResidencyManager.isResident('txt')).toBe(false);
    expect(modelResidencyManager.isResident('img')).toBe(true);
  });

  it('canLoadWithoutEviction is true only when the model fits alongside residents', async () => {
    await modelResidencyManager.ensureResident({ key: 'text', type: 'text', sizeMB: 700 }, { load: async () => {}, unload: async () => {} }, 1);
    // budget 1000: 700 + 200 fits, 700 + 400 does not.
    expect(modelResidencyManager.canLoadWithoutEviction({ key: 'whisper', sizeMB: 200 })).toBe(true);
    expect(modelResidencyManager.canLoadWithoutEviction({ key: 'image', sizeMB: 400 })).toBe(false);
    // An already-resident model always "fits".
    expect(modelResidencyManager.canLoadWithoutEviction({ key: 'text', sizeMB: 700 })).toBe(true);
  });

  it('keeps a pinned classifier resident across a generation-model swap', async () => {
    const unloadClassifier = jest.fn(async () => {});
    modelResidencyManager.register({ key: 'smol', type: 'classifier', sizeMB: 100, pinned: true }, unloadClassifier, 1);
    await modelResidencyManager.ensureResident({ key: 'txt', type: 'text', sizeMB: 800 }, { load: async () => {}, unload: async () => {} }, 2);
    expect(unloadClassifier).not.toHaveBeenCalled();
    expect(modelResidencyManager.isResident('smol')).toBe(true);
  });

  describe('runExclusive (global model lock)', () => {
    it('serializes operations — a second op waits for the first to finish', async () => {
      const order: string[] = [];
      let releaseFirst: () => void = () => {};
      const first = modelResidencyManager.runExclusive('first', async () => {
        order.push('first:start');
        await new Promise<void>(r => { releaseFirst = r; });
        order.push('first:end');
      });
      const second = modelResidencyManager.runExclusive('second', async () => {
        order.push('second:start');
      });
      // Second must not start while first holds the lock.
      await new Promise(r => setImmediate(r));
      expect(order).toEqual(['first:start']);
      releaseFirst();
      await Promise.all([first, second]);
      expect(order).toEqual(['first:start', 'first:end', 'second:start']);
    });

    it('releases the lock even when the operation throws', async () => {
      await expect(
        modelResidencyManager.runExclusive('boom', async () => { throw new Error('boom'); }),
      ).rejects.toThrow('boom');
      // A following op still runs (lock was released).
      const ran = await modelResidencyManager.runExclusive('after', async () => 'ok');
      expect(ran).toBe('ok');
    });

    it('returns the operation result', async () => {
      const res = await modelResidencyManager.runExclusive('val', async () => 42);
      expect(res).toBe(42);
    });
  });

  describe('reclaimSttForGeneration (memory-tight sequencing)', () => {
    beforeEach(() => modelResidencyManager._reset());
    afterEach(() => jest.restoreAllMocks());

    it('frees the idle Whisper model before generation on a tight (≤6GB) device', async () => {
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(4);
      const unload = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'whisper', type: 'whisper', sizeMB: 466 }, unload, 1);
      await modelResidencyManager.reclaimSttForGeneration();
      expect(unload).toHaveBeenCalled();
      expect(modelResidencyManager.isResident('whisper')).toBe(false);
    });

    it('keeps Whisper warm on a roomy (>6GB) device', async () => {
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(8);
      const unload = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'whisper', type: 'whisper', sizeMB: 466 }, unload, 1);
      await modelResidencyManager.reclaimSttForGeneration();
      expect(unload).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('whisper')).toBe(true);
    });

    it('is a no-op when Whisper is not resident', async () => {
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(4);
      await expect(modelResidencyManager.reclaimSttForGeneration()).resolves.toBeUndefined();
    });

    it('honors the canEvict veto — does NOT unload Whisper while it is in use', async () => {
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(4);
      const unload = jest.fn().mockResolvedValue(undefined);
      // canEvict returns false → the owner vetoes (e.g. still finalizing a transcription).
      modelResidencyManager.register({ key: 'whisper', type: 'whisper', sizeMB: 466, canEvict: () => false }, unload, 1);
      await modelResidencyManager.reclaimSttForGeneration();
      expect(unload).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('whisper')).toBe(true);
    });

    it('serializes the reclaim behind an in-flight load (F3: no unload while the lock is held)', async () => {
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(4);
      const order: string[] = [];
      const unload = jest.fn().mockImplementation(async () => { order.push('reclaim:unload'); });
      modelResidencyManager.register({ key: 'whisper', type: 'whisper', sizeMB: 466 }, unload, 1);

      // A load holds the global lock.
      let releaseLoad: () => void = () => {};
      const load = modelResidencyManager.runExclusive('load:text', async () => {
        order.push('load:start');
        await new Promise<void>(r => { releaseLoad = r; });
        order.push('load:end');
      });
      // Fire the reclaim while the load is still holding the lock.
      const reclaim = modelResidencyManager.reclaimSttForGeneration();
      await new Promise(r => setImmediate(r));
      // The reclaim's native unload must NOT run mid-load — that's the race the lock closes.
      expect(order).toEqual(['load:start']);

      releaseLoad();
      await Promise.all([load, reclaim]);
      expect(order).toEqual(['load:start', 'load:end', 'reclaim:unload']);
      expect(modelResidencyManager.isResident('whisper')).toBe(false);
    });
  });

  describe('makeRoomFor (predictive — credits evictable residents)', () => {
    beforeEach(() => { modelResidencyManager._reset(); });
    afterEach(() => jest.restoreAllMocks());

    it('budgets against PHYSICAL RAM, not os_proc dirty headroom — a big mmap GGUF loads on a high-RAM phone even when instantaneous available is low', async () => {
      modelResidencyManager.setBudgetOverrideMB(null);
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(12);
      jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(2); // low DIRTY headroom (os_proc)
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      // An 8GB GGUF fits a 12GB phone's physical cap (0.78*12 ≈ 9.6GB). Its mmap'd
      // weights are clean/file-backed, so the low instantaneous os_proc available
      // (dirty headroom) must NOT refuse it — the bug that broke E2B/E4B on a 12GB phone.
      const { fits, evicted } = await modelResidencyManager.makeRoomFor({ key: 'text', type: 'text', sizeMB: 8000 });
      expect(fits).toBe(true);
      expect(evicted).toEqual([]);
    });

    it('REGRESSION: under dirty pressure, a clean sidecar is REFUSED when live RAM is low (the jetsam fix)', async () => {
      modelResidencyManager.setBudgetOverrideMB(null);
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(12);
      jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(0.3); // ~300MB free during the image compile spike
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      // A 7GB dirty image model is resident and generating (vetoes its own eviction).
      modelResidencyManager.register(
        { key: 'image', type: 'image', sizeMB: 7279, dirtyMemory: true, canEvict: () => false },
        jest.fn().mockResolvedValue(undefined), 1);
      // The static budget (7279+142 ≤ 0.78*12GB) would say fits, but the live os_proc
      // available is near-zero from the CoreML compile — the sidecar must be refused,
      // not stacked onto the spike (the device OOM/jetsam).
      const { fits, evicted } = await modelResidencyManager.makeRoomFor({ key: 'whisper', type: 'whisper', sizeMB: 142 });
      expect(fits).toBe(false);
      expect(evicted).toEqual([]);
    });

    it('the same sidecar co-loads under dirty pressure when live RAM is healthy (no false refusal)', async () => {
      modelResidencyManager.setBudgetOverrideMB(null);
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(12);
      jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(3); // healthy free RAM
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      modelResidencyManager.register(
        { key: 'image', type: 'image', sizeMB: 7279, dirtyMemory: true, canEvict: () => false },
        jest.fn().mockResolvedValue(undefined), 1);
      const { fits } = await modelResidencyManager.makeRoomFor({ key: 'whisper', type: 'whisper', sizeMB: 142 });
      expect(fits).toBe(true);
    });

    it("does NOT evict (don't strand) when the model can't fit even after full eviction", async () => {
      modelResidencyManager.setBudgetOverrideMB(1000);
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      const unloadImg = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'image', type: 'image', sizeMB: 400 }, unloadImg, 1);
      const { evicted, fits } = await modelResidencyManager.makeRoomFor({ key: 'huge', type: 'text', sizeMB: 1500 });
      expect(fits).toBe(false);
      expect(evicted).toEqual([]);
      expect(unloadImg).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('image')).toBe(true);
    });

    it('keeps both co-resident (no eviction) when the incoming fits the budget', async () => {
      modelResidencyManager.setBudgetOverrideMB(2000);
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      const unloadImg = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'image', type: 'image', sizeMB: 500 }, unloadImg, 1);
      const { evicted, fits } = await modelResidencyManager.makeRoomFor({ key: 'text', type: 'text', sizeMB: 1000 });
      expect(fits).toBe(true);
      expect(evicted).toEqual([]);
      expect(unloadImg).not.toHaveBeenCalled();
    });
  });

  describe('override survival floor (never force a load into a jetsam SIGKILL)', () => {
    beforeEach(() => { modelResidencyManager._reset(); });
    afterEach(() => jest.restoreAllMocks());

    it('REFUSES an override load when live free RAM is below the survival floor (background apps case)', async () => {
      modelResidencyManager.setBudgetOverrideMB(null);
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(12);
      jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(0.8); // ~820MB free — starved
      const { fits, evicted } = await modelResidencyManager.makeRoomFor(
        { key: 'text', type: 'text', sizeMB: 5000 }, { override: true });
      expect(fits).toBe(false);   // even override won't cross the floor → graceful refuse, no crash
      expect(evicted).toEqual([]); // and we didn't strand the device by evicting
    });

    it('ALLOWS the same override load when there is survival headroom', async () => {
      modelResidencyManager.setBudgetOverrideMB(null);
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(12);
      jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(4); // 4GB free — safe
      const { fits } = await modelResidencyManager.makeRoomFor(
        { key: 'text', type: 'text', sizeMB: 8000 }, { override: true });
      expect(fits).toBe(true);  // clean GGUF, plenty of live headroom → override proceeds
    });
  });

  describe('session override memory (approve Load Anyway once per model)', () => {
    beforeEach(() => { modelResidencyManager._reset(); });
    afterEach(() => jest.restoreAllMocks());

    const tooBig = { key: 'text', type: 'text' as const, modelId: 'org/big-model', sizeMB: 2000 };

    it('remembers an explicit override so the SAME model auto-overrides next time (no re-prompt)', async () => {
      modelResidencyManager.setBudgetOverrideMB(1000); // 2000MB model can never fit the budget
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);

      // Fails-before: without override the oversized model is refused.
      expect((await modelResidencyManager.makeRoomFor(tooBig)).fits).toBe(false);
      expect(modelResidencyManager.hasSessionOverride('org/big-model')).toBe(false);

      // User taps "Load Anyway" once → forced load, and it's remembered for the session.
      expect((await modelResidencyManager.makeRoomFor(tooBig, { override: true })).fits).toBe(true);
      expect(modelResidencyManager.hasSessionOverride('org/big-model')).toBe(true);

      // Passes-after: a later load of the SAME model (no override flag) auto-overrides.
      expect((await modelResidencyManager.makeRoomFor(tooBig)).fits).toBe(true);
    });

    it('does NOT leak the override to a different model', async () => {
      modelResidencyManager.setBudgetOverrideMB(1000);
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      await modelResidencyManager.makeRoomFor(tooBig, { override: true });
      // A different oversized model is still gated (its own approval required).
      const other = { key: 'text', type: 'text' as const, modelId: 'org/other-model', sizeMB: 2000 };
      expect((await modelResidencyManager.makeRoomFor(other)).fits).toBe(false);
    });

    it('_reset clears session overrides (relaunch asks again)', async () => {
      modelResidencyManager.setBudgetOverrideMB(1000);
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      await modelResidencyManager.makeRoomFor(tooBig, { override: true });
      expect(modelResidencyManager.hasSessionOverride('org/big-model')).toBe(true);
      modelResidencyManager._reset();
      expect(modelResidencyManager.hasSessionOverride('org/big-model')).toBe(false);
    });
  });

  describe('canEvict veto (residency ↔ audio seam)', () => {
    beforeEach(() => modelResidencyManager._reset());
    afterEach(() => jest.restoreAllMocks());

    it('memory warning reclaims an idle sidecar but spares one vetoing via canEvict', async () => {
      const idleUnload = jest.fn().mockResolvedValue(undefined);
      const busyUnload = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'whisper', type: 'whisper', sizeMB: 466 }, idleUnload, 1);
      modelResidencyManager.register({ key: 'tts', type: 'tts', sizeMB: 320, canEvict: () => false }, busyUnload, 2);
      await modelResidencyManager.handleMemoryWarning();
      expect(idleUnload).toHaveBeenCalled();
      expect(modelResidencyManager.isResident('whisper')).toBe(false);
      expect(busyUnload).not.toHaveBeenCalled(); // TTS playing → owner vetoes
      expect(modelResidencyManager.isResident('tts')).toBe(true);
    });

    it('memory warning leaves generation models alone (only reclaims sidecars)', async () => {
      const textUnload = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'text', type: 'text', sizeMB: 1500 }, textUnload, 1);
      await modelResidencyManager.handleMemoryWarning();
      expect(textUnload).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('text')).toBe(true);
    });

    it('capacity eviction never unloads a model vetoing via canEvict', async () => {
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      modelResidencyManager.setBudgetOverrideMB(1000);
      const ttsUnload = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'tts', type: 'tts', sizeMB: 320, canEvict: () => false }, ttsUnload, 1);
      // A big incoming text model needs room, but the only resident (TTS) is playing.
      const { evicted } = await modelResidencyManager.makeRoomFor({ key: 'text', type: 'text', sizeMB: 900 });
      expect(ttsUnload).not.toHaveBeenCalled();
      expect(evicted).toEqual([]);
      expect(modelResidencyManager.isResident('tts')).toBe(true);
    });
  });

  describe('load policy (aggressive) + override', () => {
    beforeEach(() => {
      modelResidencyManager._reset();
      modelResidencyManager.setLoadPolicy('balanced');
    });
    afterEach(() => {
      jest.restoreAllMocks();
      modelResidencyManager.setLoadPolicy('balanced'); // never leak policy across suites
    });

    it('defaults to balanced and round-trips setLoadPolicy/getLoadPolicy', () => {
      expect(modelResidencyManager.getLoadPolicy()).toBe('balanced');
      modelResidencyManager.setLoadPolicy('aggressive');
      expect(modelResidencyManager.getLoadPolicy()).toBe('aggressive');
    });

    it('aggressive keeps ONE model at a time — evicts a co-resident that would otherwise fit', async () => {
      modelResidencyManager.setBudgetOverrideMB(8000); // roomy: both would co-reside under balanced
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      const unloadImg = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'image', type: 'image', sizeMB: 400 }, unloadImg, 1);

      // Balanced would keep both (400 + 800 ≤ 8000). Aggressive evicts the image so
      // only the incoming text model remains.
      modelResidencyManager.setLoadPolicy('aggressive');
      const room = await modelResidencyManager.makeRoomFor({ key: 'text', type: 'text', sizeMB: 800 });
      expect(room.fits).toBe(true);
      expect(room.evicted).toContain('image');
      expect(unloadImg).toHaveBeenCalledTimes(1);
      expect(modelResidencyManager.isResident('image')).toBe(false);
    });

    it('balanced keeps co-residency for the same inputs (no forced eviction)', async () => {
      modelResidencyManager.setBudgetOverrideMB(8000);
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      const unloadImg = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'image', type: 'image', sizeMB: 400 }, unloadImg, 1);
      modelResidencyManager.setLoadPolicy('balanced');
      const room = await modelResidencyManager.makeRoomFor({ key: 'text', type: 'text', sizeMB: 800 });
      expect(room.fits).toBe(true);
      expect(room.evicted).toEqual([]); // co-resident kept
      expect(unloadImg).not.toHaveBeenCalled();
    });

    it('aggressive single-model still spares a pinned classifier', async () => {
      modelResidencyManager.setBudgetOverrideMB(8000);
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      modelResidencyManager.register({ key: 'smol', type: 'classifier', sizeMB: 100, pinned: true }, jest.fn().mockResolvedValue(undefined), 1);
      const unloadImg = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'image', type: 'image', sizeMB: 400 }, unloadImg, 2);
      modelResidencyManager.setLoadPolicy('aggressive');
      const room = await modelResidencyManager.makeRoomFor({ key: 'text', type: 'text', sizeMB: 800 });
      expect(room.evicted).toContain('image');
      expect(room.evicted).not.toContain('smol');
      expect(modelResidencyManager.isResident('smol')).toBe(true);
    });

    it('fails-before/passes-after: a 21GB GGUF is refused on a 24GB phone under balanced, fits under aggressive', async () => {
      modelResidencyManager.setBudgetOverrideMB(null);
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(24);
      jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(8);
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      const spec = { key: 'text', type: 'text' as const, sizeMB: 21 * 1024 };

      // Balanced: 24GB * 0.70 ≈ 16.8GB budget → 21GB does not fit (Nico's Qwen3 MoE).
      const balanced = await modelResidencyManager.makeRoomFor(spec);
      expect(balanced.fits).toBe(false);

      // Aggressive: pushes near the physical ceiling → the same model now fits.
      modelResidencyManager.setLoadPolicy('aggressive');
      const aggressive = await modelResidencyManager.makeRoomFor(spec);
      expect(aggressive.fits).toBe(true);
    });

    it('override forces a load that still will not fit, evicting everything evictable first', async () => {
      modelResidencyManager.setBudgetOverrideMB(1000); // tiny budget so nothing big fits
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      const unloadImg = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'image', type: 'image', sizeMB: 400 }, unloadImg, 1);

      // Without override: refuse and DON'T evict (never strand the device).
      const blocked = await modelResidencyManager.makeRoomFor({ key: 'huge', type: 'text', sizeMB: 5000 });
      expect(blocked.fits).toBe(false);
      expect(unloadImg).not.toHaveBeenCalled();
      expect(modelResidencyManager.isResident('image')).toBe(true);

      // With override ("Load Anyway"): force fits=true AND free max room (evict image).
      const forced = await modelResidencyManager.makeRoomFor(
        { key: 'huge', type: 'text', sizeMB: 5000 },
        { override: true },
      );
      expect(forced.fits).toBe(true);
      expect(forced.evicted).toContain('image');
      expect(unloadImg).toHaveBeenCalledTimes(1);
      expect(modelResidencyManager.isResident('image')).toBe(false);
    });

    it('override keeps ONE model at a time — evicts a co-resident even when it would fit', async () => {
      // Extreme mode is single-model by design: even though 500 + 1000 fits in 2000,
      // override evicts the co-resident so the incoming model gets the whole budget.
      modelResidencyManager.setBudgetOverrideMB(2000);
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      const unloadImg = jest.fn().mockResolvedValue(undefined);
      modelResidencyManager.register({ key: 'image', type: 'image', sizeMB: 500 }, unloadImg, 1);
      const { fits, evicted } = await modelResidencyManager.makeRoomFor(
        { key: 'text', type: 'text', sizeMB: 1000 },
        { override: true },
      );
      expect(fits).toBe(true);
      expect(evicted).toContain('image'); // single-model: co-resident evicted
      expect(unloadImg).toHaveBeenCalledTimes(1);
    });

    it('aggressive holds a leaner dirty headroom so a dirty load the balanced guard refuses is allowed', async () => {
      modelResidencyManager.setBudgetOverrideMB(null);
      jest.spyOn(hardwareService, 'getTotalMemoryGB').mockReturnValue(12);
      // ~3.4GB free: balanced dirty headroom (1024) → budget ≈ 2.4GB; aggressive (512) → ≈ 2.9GB.
      jest.spyOn(hardwareService, 'getAvailableMemoryGB').mockReturnValue(3.4);
      jest.spyOn(hardwareService, 'refreshMemoryInfo').mockResolvedValue(undefined as never);
      // A resident dirty model creates dirty pressure so the live-RAM branch is used.
      modelResidencyManager.register(
        { key: 'image', type: 'image', sizeMB: 100, dirtyMemory: true, canEvict: () => false },
        jest.fn().mockResolvedValue(undefined), 1);
      const spec = { key: 'litert', type: 'text' as const, sizeMB: 2700, dirtyMemory: true };

      const balanced = await modelResidencyManager.makeRoomFor(spec);
      expect(balanced.fits).toBe(false);

      modelResidencyManager.setLoadPolicy('aggressive');
      const aggressive = await modelResidencyManager.makeRoomFor(spec);
      expect(aggressive.fits).toBe(true);
    });
  });
});
