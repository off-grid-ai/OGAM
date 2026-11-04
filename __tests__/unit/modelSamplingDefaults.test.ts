import { APP_SAMPLING, resolveSampling, samplingDefaultsFor } from '../../src/services/modelSamplingDefaults';
import { buildCompletionParams } from '../../src/services/llmHelpers';
import { DEFAULT_SETTINGS } from '../../src/stores/appStore';

const HAUHAU = { temperature: 0.6, topK: 64, topP: 0.9, minP: 0.05, repeatPenalty: 1.1 };

describe('model sampling defaults', () => {
  it('recognises the HauhauCS Gemma 4 file under its published name or a renamed one, and no other model', () => {
    expect(samplingDefaultsFor('/models/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf')).toEqual(HAUHAU);
    expect(samplingDefaultsFor('/models/Gemma4-12B-QAT-Uncensored-HauhauCS-Q4_K_M.gguf')).toEqual(HAUHAU);
    expect(samplingDefaultsFor('/models/gemma-4-12B-it-Q4_K_M.gguf')).toBeNull();
    expect(samplingDefaultsFor('/models/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf')).toBeNull();
    expect(samplingDefaultsFor(null)).toBeNull();
  });

  it('keeps the app defaults in step with the store, since "the person changed it" means "differs from the default"', () => {
    expect(APP_SAMPLING.temperature).toBe(DEFAULT_SETTINGS.temperature);
    expect(APP_SAMPLING.topP).toBe(DEFAULT_SETTINGS.topP);
    expect(APP_SAMPLING.repeatPenalty).toBe(DEFAULT_SETTINGS.repeatPenalty);
  });

  it('orders agent over the person\'s own setting over the model\'s recommendation over the app default', () => {
    const untouched = { temperature: 0.7, topP: 0.9, repeatPenalty: 1.1 };
    // Nothing set: the model's values.
    expect(resolveSampling({ agent: {}, user: untouched, model: HAUHAU })).toEqual(HAUHAU);
    // The person changed temperature in Settings: theirs wins for that value, the rest stays the model's.
    expect(resolveSampling({ agent: {}, user: { ...untouched, temperature: 0.2 }, model: HAUHAU })).toEqual({ ...HAUHAU, temperature: 0.2 });
    // An agent's value beats both.
    expect(resolveSampling({ agent: { temperature: 1.0, topP: 0.5 }, user: { ...untouched, temperature: 0.2 }, model: HAUHAU }))
      .toEqual({ ...HAUHAU, temperature: 1.0, topP: 0.5 });
    // A model with no recommendation: exactly the app's behaviour as before (top-k 40, no min-p).
    expect(resolveSampling({ agent: {}, user: untouched, model: null })).toEqual({ temperature: 0.7, topK: 40, topP: 0.9, repeatPenalty: 1.1 });
  });

  it('puts the recommendation into the completion parameters for that model only', () => {
    const settings = { maxTokens: 512, temperature: 0.7, topP: 0.9, repeatPenalty: 1.1 };
    expect(buildCompletionParams(settings, { modelPath: '/models/Gemma4-12B-QAT-Uncensored-HauhauCS-Q4_K_M.gguf' }))
      .toMatchObject({ temperature: 0.6, top_k: 64, top_p: 0.9, min_p: 0.05, penalty_repeat: 1.1 });
    const other = buildCompletionParams(settings, { modelPath: '/models/Qwen3.5-4B-Q4_0.gguf' });
    expect(other).toMatchObject({ temperature: 0.7, top_k: 40, top_p: 0.9, penalty_repeat: 1.1 });
    expect(other).not.toHaveProperty('min_p');
    expect(buildCompletionParams(settings)).toMatchObject({ temperature: 0.7, top_k: 40 });
  });
});
