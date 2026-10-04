/**
 * recommendedModels — the single source for "which curated models fit this device"
 * + the fit-scoring, shared by onboarding (filters + shows the list) and the Models
 * screen (best-fit sort). Uses the real Shared catalog contract.
 */
import {
  RECOMMENDED_MODELS,
  TRENDING_FAMILIES,
  ramFitScore,
  recommendedModelsForDevice,
  trendingModelIdsForDevice,
} from '@offgrid/models';

describe('ramFitScore', () => {
  it('is lowest near ~40% of RAM and penalises heavy models', () => {
    expect(ramFitScore(4, 10)).toBeLessThan(ramFitScore(8, 10)); // 40% beats 80%
    expect(ramFitScore(8, 10)).toBeGreaterThan(0.4);             // >75% incurs the penalty
  });
});

describe('recommendedModelsForDevice', () => {
  it('keeps models within [minRam, maxRam] for the device, in editorial order', () => {
    const models = recommendedModelsForDevice(8);
    expect(models.length).toBeGreaterThan(0);
    expect(models).toEqual(RECOMMENDED_MODELS.filter(model =>
      model.minRam <= 8 && (!model.maxRam || model.maxRam >= 8),
    ));
  });

  it('drops models whose maxRam is below the device RAM', () => {
    expect(recommendedModelsForDevice(8).some(m => m.id === 'QuantFactory/SmolLM2-360M-Instruct-GGUF')).toBe(false);
    expect(recommendedModelsForDevice(4).some(m => m.id === 'QuantFactory/SmolLM2-360M-Instruct-GGUF')).toBe(true);
  });
});

describe('trendingModelIdsForDevice', () => {
  it('picks the single best-fit model per family for the device', () => {
    const ids = [...trendingModelIdsForDevice(8)];
    expect(ids).toHaveLength(Object.keys(TRENDING_FAMILIES).length);
    expect(ids.every(id => Object.values(TRENDING_FAMILIES).some(family => family.includes(id)))).toBe(true);
  });
});
