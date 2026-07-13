/**
 * recommendedModels — the single source for "which curated models fit this device"
 * + the fit-scoring, shared by onboarding (filters + shows the list) and the Models
 * screen (best-fit sort). Mocks the catalog for deterministic assertions.
 */
jest.mock('../../../src/constants', () => ({
  RECOMMENDED_MODELS: [
    { id: 'a/small', name: 'Small', minRam: 4, type: 'text' },
    { id: 'a/mid', name: 'Mid', minRam: 8, type: 'text' },
    { id: 'a/big', name: 'Big', minRam: 16, type: 'text' },
    { id: 'a/lowonly', name: 'LowOnly', minRam: 2, maxRam: 4, type: 'text' },
  ],
  TRENDING_FAMILIES: { fam1: ['a/small', 'a/mid'] },
}));

import { ramFitScore, recommendedModelsForDevice, trendingModelIdsForDevice } from '../../../src/utils/recommendedModels';

describe('ramFitScore', () => {
  it('is lowest near ~40% of RAM and penalises heavy models', () => {
    expect(ramFitScore(4, 10)).toBeLessThan(ramFitScore(8, 10)); // 40% beats 80%
    expect(ramFitScore(8, 10)).toBeGreaterThan(0.4);             // >75% incurs the penalty
  });
});

describe('recommendedModelsForDevice', () => {
  it('keeps models within [minRam, maxRam] for the device, in editorial order', () => {
    expect(recommendedModelsForDevice(8).map(m => m.id)).toEqual(['a/small', 'a/mid']);
    // 4GB: small (4≤4) + lowonly (2≤4≤4); mid/big excluded.
    expect(recommendedModelsForDevice(4).map(m => m.id)).toEqual(['a/small', 'a/lowonly']);
  });

  it('drops models whose maxRam is below the device RAM', () => {
    expect(recommendedModelsForDevice(8).some(m => m.id === 'a/lowonly')).toBe(false);
  });
});

describe('trendingModelIdsForDevice', () => {
  it('picks the single best-fit model per family for the device', () => {
    // family [small(4), mid(8)] on 8GB → small fits better (0.5 ratio vs 1.0).
    expect([...trendingModelIdsForDevice(8)]).toEqual(['a/small']);
  });
});
