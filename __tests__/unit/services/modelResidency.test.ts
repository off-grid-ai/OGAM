import {
  ModelResidencyManager,
  computeBudgetMB,
  planEviction,
  type MemorySource,
  type Resident,
  type ResidentSpec,
} from '@offgrid/models';

const resident = (
  key: string,
  type: ResidentSpec['type'],
  sizeMB: number,
  lastUsedAt: number,
  pinned = false,
): Resident => ({ key, type, sizeMB, lastUsedAt, pinned });

const memory = (totalMB = 8192): MemorySource => ({
  current: () => ({ totalMB, availableMB: totalMB, platform: 'ios' }),
});

describe('residency policy', () => {
  it('uses the smaller RAM fraction or reserve budget and never returns a negative value', () => {
    expect(Math.round(computeBudgetMB(8192))).toBe(4915);
    expect(Math.round(computeBudgetMB(3072))).toBe(1536);
    expect(computeBudgetMB(1000)).toBe(0);
  });

  it('keeps generation models together when both fit', () => {
    const plan = planEviction(
      [resident('image', 'image', 400, 1)],
      { key: 'text', type: 'text', sizeMB: 800 },
      4000,
    );
    expect(plan).toMatchObject({ fits: true, evict: [] });
  });

  it('evicts every unpinned peer in single-model mode', () => {
    const plan = planEviction(
      [
        resident('image', 'image', 400, 3),
        resident('stt', 'transcription', 300, 2),
        resident('voice', 'voice', 200, 1),
        resident('classifier', 'classifier', 100, 0, true),
      ],
      { key: 'text', type: 'text', sizeMB: 500 },
      8000,
      { singleModel: true },
    );
    expect(plan.evict.map(item => item.key).sort()).toEqual([
      'image',
      'stt',
      'voice',
    ]);
    expect(plan.evict.some(item => item.key === 'classifier')).toBe(false);
  });

  it('reclaims canonical sidecar modalities before a generation model', () => {
    const plan = planEviction(
      [
        resident('text', 'text', 1500, 4),
        resident('stt', 'transcription', 1500, 1),
        resident('voice', 'voice', 320, 2),
      ],
      { key: 'image', type: 'image', sizeMB: 1200 },
      3000,
    );
    expect(plan.evict.map(item => item.key)).toEqual(['stt', 'voice']);
    expect(plan.fits).toBe(true);
  });

  it('does not evict a generation model to admit a sidecar that cannot fit', () => {
    const plan = planEviction(
      [resident('text', 'text', 800, 1)],
      { key: 'voice', type: 'voice', sizeMB: 320 },
      700,
    );
    expect(plan.evict).toEqual([]);
    expect(plan.fits).toBe(false);
  });
});

describe('ModelResidencyManager acquire leases', () => {
  let manager: ModelResidencyManager;

  beforeEach(() => {
    manager = new ModelResidencyManager(memory());
    manager.setBudgetOverrideMB(1000);
  });

  it('loads once and retains a persistent resident after release', async () => {
    const load = jest.fn(async () => undefined);
    const unload = jest.fn(async () => ({reclaimed: true as const}));
    const lease = await manager.acquire(
      { key: 'text', type: 'text', sizeMB: 400, lifecycle: 'persistent' },
      { load, unload },
    );

    expect(lease).toMatchObject({ acquired: true, loaded: true, fits: true });
    expect(load).toHaveBeenCalledTimes(1);
    await lease.release();
    expect(manager.isResident('text')).toBe(true);
    expect(unload).not.toHaveBeenCalled();
  });

  it('unloads an operation resident when its final lease is released', async () => {
    const unload = jest.fn(async () => ({reclaimed: true as const}));
    const lease = await manager.acquire(
      { key: 'classifier', type: 'classifier', sizeMB: 100, lifecycle: 'operation' },
      { load: async () => undefined, unload },
    );

    await lease.release();
    expect(unload).toHaveBeenCalledTimes(1);
    expect(manager.isResident('classifier')).toBe(false);
  });

  it('does not load an already resident model twice', async () => {
    const load = jest.fn(async () => undefined);
    const handlers = { load, unload: async () => ({reclaimed: true as const}) };
    const first = await manager.acquire(
      { key: 'text', type: 'text', sizeMB: 400 },
      handlers,
    );
    await first.release();
    const second = await manager.acquire(
      { key: 'text', type: 'text', sizeMB: 400 },
      handlers,
    );

    expect(second).toMatchObject({ acquired: true, loaded: false });
    expect(load).toHaveBeenCalledTimes(1);
    await second.release();
  });

  it('pins an active lease against eviction', async () => {
    const first = await manager.acquire(
      { key: 'text', type: 'text', sizeMB: 700 },
      { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
    );
    const blocked = await manager.acquire(
      { key: 'image', type: 'image', sizeMB: 700 },
      { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
    );

    expect(blocked).toMatchObject({ acquired: false, fits: false });
    expect(manager.isResident('text')).toBe(true);
    await first.release();
  });

  it('evicts an idle resident before loading a replacement', async () => {
    const unloadText = jest.fn(async () => ({reclaimed: true as const}));
    const textLease = await manager.acquire(
      { key: 'text', type: 'text', sizeMB: 700 },
      { load: async () => undefined, unload: unloadText },
    );
    await textLease.release();

    const imageLease = await manager.acquire(
      { key: 'image', type: 'image', sizeMB: 700 },
      { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
    );

    expect(imageLease).toMatchObject({ acquired: true, evicted: ['text'] });
    expect(unloadText).toHaveBeenCalledTimes(1);
    expect(manager.isResident('text')).toBe(false);
    await imageLease.release();
  });

  it('returns a typed unload failure without loading the incoming model', async () => {
    const existing = await manager.acquire(
      { key: 'text', type: 'text', sizeMB: 700 },
      {
        load: async () => undefined,
        unload: async () => { throw new Error('native unload failed'); },
      },
    );
    await existing.release();
    const loadImage = jest.fn(async () => undefined);

    const image = await manager.acquire(
      { key: 'image', type: 'image', sizeMB: 700 },
      { load: loadImage, unload: async () => ({reclaimed: true as const}) },
    );

    expect(image).toMatchObject({ acquired: false, reason: 'unload_failed' });
    expect(loadImage).not.toHaveBeenCalled();
    expect(manager.isResident('text')).toBe(true);
  });

  it('releases operation residents only after the final concurrent lease', async () => {
    const unload = jest.fn(async () => ({reclaimed: true as const}));
    const spec: ResidentSpec = {
      key: 'stt',
      type: 'transcription',
      sizeMB: 150,
      lifecycle: 'operation',
    };
    const handlers = { load: async () => undefined, unload };
    const first = await manager.acquire(spec, handlers);
    const second = await manager.acquire(spec, handlers);

    await first.release();
    expect(manager.isResident('stt')).toBe(true);
    expect(unload).not.toHaveBeenCalled();
    await second.release();
    expect(manager.isResident('stt')).toBe(false);
    expect(unload).toHaveBeenCalledTimes(1);
  });

  it('reclaims idle canonical sidecars through an explicit policy', async () => {
    for (const [key, type] of [
      ['stt', 'transcription'],
      ['voice', 'voice'],
    ] as const) {
      const lease = await manager.acquire(
        { key, type, sizeMB: 100 },
        { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
      );
      await lease.release();
    }

    const reclaimed = await manager.reclaim({
      id: 'mobile-sidecars',
      modalities: ['transcription', 'voice'],
    });
    expect(reclaimed.sort()).toEqual(['stt', 'voice']);
  });
});
