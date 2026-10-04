import { createHydrationGatedStorage } from '../../../src/utils/hydrationGatedStorage';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: jest.fn(async (name: string) => map.get(name) ?? null),
    setItem: jest.fn(async (name: string, value: string) => void map.set(name, value)),
    removeItem: jest.fn(async (name: string) => void map.delete(name)),
  };
}

describe('createHydrationGatedStorage', () => {
  it('drops writes until hydration finished, then persists every write', async () => {
    const base = memoryStorage();
    base.map.set('tts-store', JSON.stringify({ state: { settings: { saved: true } }, version: 0 }));
    const gated = createHydrationGatedStorage<{ settings: unknown }>(base);

    await gated.storage.setItem('tts-store', { state: { settings: { saved: false } }, version: 0 });
    expect(base.setItem).not.toHaveBeenCalled();
    expect(await gated.storage.getItem('tts-store')).toEqual({ state: { settings: { saved: true } }, version: 0 });

    gated.markHydrated();
    expect(gated.isHydrated()).toBe(true);
    await gated.storage.setItem('tts-store', { state: { settings: { saved: 'after' } }, version: 0 });
    expect(JSON.parse(base.map.get('tts-store')!)).toEqual({ state: { settings: { saved: 'after' } }, version: 0 });
    await gated.storage.removeItem('tts-store');
    expect(base.map.has('tts-store')).toBe(false);
  });
});
