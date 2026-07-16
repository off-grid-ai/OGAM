/**
 * predictGgufCapabilities — the pure name/data-based prediction used ONLY while a llama model is
 * selected-but-not-loaded (models load lazily on first send). Underneath the rendered test
 * (selectedNotLoadedShowsCapabilities): every branch of the rule, driven with real pattern data
 * imported from the single source of truth (never re-hardcoded).
 */
import {
  predictGgufCapabilities,
  GGUF_THINKING_NAME_PATTERNS,
  GGUF_TOOLS_NAME_PATTERNS,
} from '../../../src/utils/ggufCapabilities';

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

  it('every published pattern actually matches (the table is live, not decorative)', () => {
    for (const p of GGUF_THINKING_NAME_PATTERNS) expect(predictGgufCapabilities({ name: p }).thinking).toBe(true);
    for (const p of GGUF_TOOLS_NAME_PATTERNS) expect(predictGgufCapabilities({ name: p }).tools).toBe(true);
  });
});
