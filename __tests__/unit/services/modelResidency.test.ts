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
    // 8GB: 0.6*8192=4915 vs 8192-1500=6692 → 4915
    expect(Math.round(computeBudgetMB(8192))).toBe(4915);
    // 3GB: 0.6*3072=1843 vs 3072-1500=1572 → 1572 (reserve dominates on low RAM)
    expect(Math.round(computeBudgetMB(3072))).toBe(1572);
  });

  it('never returns negative', () => {
    expect(computeBudgetMB(1000)).toBe(0);
  });
});

describe('planEviction', () => {
  it('evicts the image model when loading text, even if both fit the budget (mutual exclusion)', () => {
    const current = [R('img', 'image', 400, 1)];
    const plan = planEviction(current, { key: 'txt', type: 'text', sizeMB: 800 }, 4000);
    expect(plan.evict.map(e => e.key)).toEqual(['img']); // text & image never co-reside
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
});
