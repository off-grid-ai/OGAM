import { mtpParams } from '../../src/services/llmHelpers';
import { isDraftFile } from '../../src/screens/ModelsScreen/importHelpers';

describe('MTP files', () => {
  it('turns on drafting only when a file is attached and the switch is on', () => {
    expect(mtpParams('/m/x.mtp.gguf', true)).toEqual({ model_draft: '/m/x.mtp.gguf', speculative: { enabled: true, type: 'mtp', n_max: 3 } });
    expect(mtpParams(undefined, true)).toEqual({});
    expect(mtpParams(undefined, true, true)).toEqual({ speculative: { enabled: true, type: 'mtp', n_max: 3 } });
    expect(mtpParams('/m/x.mtp.gguf', true, true)).toEqual({ model_draft: '/m/x.mtp.gguf', speculative: { enabled: true, type: 'mtp', n_max: 3 } });
    expect(mtpParams(undefined, false, true)).toEqual({});
    expect(mtpParams('/m/x.mtp.gguf', false)).toEqual({});
  });
  it('recognises MTP and draft files by name, but not ordinary models', () => {
    for (const n of ['Qwen3-MTP.gguf', 'model-mtp-Q4_0.gguf', 'llama_draft.gguf', 'nextn-layer.gguf']) expect(isDraftFile(n)).toBe(true);
    for (const n of ['Qwen3-8B-Q4_K_M.gguf', 'mmproj-F16.gguf', 'Attempt-7B.gguf']) expect(isDraftFile(n)).toBe(false);
  });
});
