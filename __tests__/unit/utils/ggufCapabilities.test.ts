/**
 * predictGgufCapabilities — the pure name/data-based prediction used ONLY while a llama model is
 * selected-but-not-loaded (models load lazily on first send). Underneath the rendered test
 * (selectedNotLoadedShowsCapabilities): every branch of the rule, driven with real pattern data
 * imported from the single source of truth (never re-hardcoded).
 */
import {
  predictGgufCapabilities,
} from '../../../src/utils/ggufCapabilities';
import { projectGgufCapabilities } from '@offgrid/models';

describe('predictGgufCapabilities (pure)', () => {
  it('null/undefined model → no capabilities promised', () => {
    expect(predictGgufCapabilities(null)).toEqual({ tools: false, thinking: false, vision: false });
    expect(predictGgufCapabilities(undefined)).toEqual({ tools: false, thinking: false, vision: false });
  });

  it('a Gemma 4 gguf (the device case) predicts tools + thinking from any identity field', () => {
    // id carries the family
    expect(predictGgufCapabilities({ id: 'unsloth/gemma-4-E2B-it-GGUF' })).toMatchObject({ tools: true, thinking: true });
    // display name carries it
    expect(predictGgufCapabilities({ name: 'Gemma 4 E2B' })).toMatchObject({ tools: true, thinking: true });
    // file name carries it
    expect(predictGgufCapabilities({ fileName: 'gemma-4-E2B-it-Q4_K_M.gguf' })).toMatchObject({ tools: true, thinking: true });
  });

  it('a tools-capable family without native reasoning (Mistral) predicts tools but NOT thinking', () => {
    expect(predictGgufCapabilities({ fileName: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf' }))
      .toMatchObject({ tools: true, thinking: false });
  });

  it('an unknown name promises nothing (conservative: affordances appear on load, as today)', () => {
    expect(predictGgufCapabilities({ id: 'm', name: 'Test Model', fileName: 'ggml-small.gguf' }))
      .toEqual({ tools: false, thinking: false, vision: false });
  });

  it('vision is DATA, not a name guess: a downloaded mmproj predicts vision', () => {
    expect(predictGgufCapabilities({ name: 'Test Model', mmProjPath: '/models/mmproj.gguf' }).vision).toBe(true);
    expect(predictGgufCapabilities({ name: 'Test Model' }).vision).toBe(false);
  });

  it('loaded runtime evidence overrides the static prediction in both directions', () => {
    expect(projectGgufCapabilities({
      artifact: { name: 'Mistral 7B', projectorPresent: true },
      runtime: { loaded: true, tools: false, thinking: true, vision: false },
    })).toEqual({ tools: false, thinking: true, vision: false });
  });
});
