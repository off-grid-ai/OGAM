/**
 * recommendedModels — the single source for "which curated models fit this device"
 * + the fit-scoring, shared by onboarding (filters + shows the list) and the Models
 * screen (best-fit sort). The fit rules are checked against a small catalog the test passes
 * (the app passes the bundled plus remote catalog the same way), and trending against the
 * real trending families.
 */
import { RECOMMENDED_MODELS, TRENDING_FAMILIES } from '../../../src/constants';
import { ramFitScore, recommendedModelsForDevice, trendingModelIdsForDevice } from '../../../src/utils/recommendedModels';

type Catalog = Parameters<typeof recommendedModelsForDevice>[1];
const catalog = [
  { id: 'a/small', name: 'Small', minRam: 4, type: 'text' },
  { id: 'a/mid', name: 'Mid', minRam: 8, type: 'text' },
  { id: 'a/big', name: 'Big', minRam: 16, type: 'text' },
  { id: 'a/lowonly', name: 'LowOnly', minRam: 2, maxRam: 4, type: 'text' },
] as unknown as NonNullable<Catalog>;

describe('ramFitScore', () => {
  it('is lowest near ~40% of RAM and penalises heavy models', () => {
    expect(ramFitScore(4, 10)).toBeLessThan(ramFitScore(8, 10)); // 40% beats 80%
    expect(ramFitScore(8, 10)).toBeGreaterThan(0.4);             // >75% incurs the penalty
  });
});

describe('recommendedModelsForDevice', () => {
  it('keeps models within [minRam, maxRam] for the device, in editorial order', () => {
    expect(recommendedModelsForDevice(8, catalog).map(m => m.id)).toEqual(['a/small', 'a/mid']);
    // 4GB: small (4≤4) + lowonly (2≤4≤4); mid/big excluded.
    expect(recommendedModelsForDevice(4, catalog).map(m => m.id)).toEqual(['a/small', 'a/lowonly']);
  });

  it('drops models whose maxRam is below the device RAM', () => {
    expect(recommendedModelsForDevice(8, catalog).some(m => m.id === 'a/lowonly')).toBe(false);
  });

  it('reads the bundled catalog by default, and every pick fits the device', () => {
    const picks = recommendedModelsForDevice(8);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every(m => RECOMMENDED_MODELS.includes(m))).toBe(true);
    expect(picks.every(m => m.minRam <= 8 && (!m.maxRam || m.maxRam >= 8))).toBe(true);
  });
});

describe('trendingModelIdsForDevice', () => {
  it('picks the single best-fit model per family for the device', () => {
    const family = (id: string) => Object.values(TRENDING_FAMILIES).findIndex(ids => ids.includes(id));
    const fits = recommendedModelsForDevice(8);
    const picks = [...trendingModelIdsForDevice(8)];
    expect(picks.length).toBeGreaterThan(0);
    // One pick per family, each from the family, each fitting the device.
    expect(new Set(picks.map(family)).size).toBe(picks.length);
    expect(picks.every(id => family(id) >= 0 && fits.some(m => m.id === id))).toBe(true);
    // And the pick is the best fit of its family: no other fitting member scores lower.
    for (const id of picks) {
      const pick = fits.find(m => m.id === id)!;
      const rivals = fits.filter(m => m.id !== id && family(m.id) === family(id));
      expect(rivals.every(m => ramFitScore(m.minRam, 8) >= ramFitScore(pick.minRam, 8))).toBe(true);
    }
  });

  it('picks from the catalog it is given', () => {
    // family qwen35 lists real ids; a catalog with none of them yields no pick.
    expect([...trendingModelIdsForDevice(8, catalog)]).toEqual([]);
  });
});
