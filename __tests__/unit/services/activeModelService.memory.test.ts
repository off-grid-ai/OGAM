import {
  ModelMemoryAdvisoryService,
  ModelResidencyManager,
  type ModelMemoryAdvisoryArtifact,
} from '@offgrid/models';

const memory = { totalMB: 8192, availableMB: 7000, platform: 'ios' as const };
const artifacts = new Map<string, ModelMemoryAdvisoryArtifact>();

function subject(manager = new ModelResidencyManager({ current: () => memory })) {
  return {
    manager,
    service: new ModelMemoryAdvisoryService(manager, {
      deviceMemory: async () => memory,
      artifact: modelId => artifacts.get(modelId),
    }),
  };
}

beforeEach(() => {
  artifacts.clear();
});

describe('ModelMemoryAdvisoryService', () => {
  it.each([
    [2, 'safe', true],
    [3, 'warning', true],
    [4, 'critical', false],
  ] as const)('projects a %s GB CPU text artifact as %s', async (sizeGB, severity, canLoad) => {
    artifacts.set('m', {
      id: 'm', name: 'M', type: 'text', artifactBytes: sizeGB * 1024 ** 3,
      accelerated: false, residencyKey: 'mobile:text-engine',
    });
    const result = await subject().service.forSelection('m', 'text');
    expect(result.severity).toBe(severity);
    expect(result.canLoad).toBe(canLoad);
  });

  it('blocks an unknown artifact', async () => {
    const result = await subject().service.forSelection('missing', 'text');
    expect(result.severity).toBe('blocked');
    expect(result.canLoad).toBe(false);
  });

  it('uses the canonical resident snapshot and excludes the replaced runtime slot', async () => {
    artifacts.set('image', {
      id: 'image', name: 'Image', type: 'image', artifactBytes: 1024 ** 3,
      nativeEstimatedBytes: 1024 ** 3, residencyKey: 'mobile:image-engine',
    });
    const { manager, service } = subject();
    await manager.acquire(
      { key: 'text-route', modelId: 'text', type: 'text', sizeMB: 1024, residencyKey: 'mobile:text-engine' },
      { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
    );
    await manager.acquire(
      { key: 'old-image-route', modelId: 'old-image', type: 'image', sizeMB: 2048, residencyKey: 'mobile:image-engine' },
      { load: async () => undefined, unload: async () => ({reclaimed: true as const}) },
    );

    const result = await service.forSelection('image', 'image');
    expect(result.currentlyLoadedMemoryMB).toBe(1024);
    expect(result.totalRequiredMemoryMB).toBe(2048);
  });

  it('honours the manager session override', async () => {
    artifacts.set('large', {
      id: 'large', name: 'Large', type: 'text', artifactBytes: 4 * 1024 ** 3,
      residencyKey: 'mobile:text-engine',
    });
    const { manager, service } = subject();
    manager.rememberSessionOverride('large');
    const result = await service.forSelection('large', 'text');
    expect(result.canLoad).toBe(true);
    expect(result.severity).toBe('safe');
  });
});
