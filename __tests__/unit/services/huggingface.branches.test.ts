declare const global: any;

/**
 * Branch-coverage tests for huggingface.ts.
 * Targets the extractQuantization underscore-stripped match branch (line 121),
 * and transformFileInfo's lfs.size fallbacks.
 */

import { huggingFaceService } from '../../../src/services/huggingface';

const service = huggingFaceService as any;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('extractQuantization underscore-stripped match branch', () => {
  it('matches a known quant when its single underscore is stripped from the filename', () => {
    // quant.replace('_','') strips the FIRST underscore only: Q8_0 -> "Q80".
    // A filename containing "Q80" must hit the underscore-stripped branch (line 119-121).
    expect(service.extractQuantization('modelQ80.gguf')).toBe('Q8_0');
  });

  it('falls through to the regex extractor for an unlisted Q pattern', () => {
    // No QUANTIZATION_INFO key matches -> regex /[QqFf]\d+.../ kicks in.
    const result = service.extractQuantization('model-Q9_xyz.gguf');
    expect(result.startsWith('Q9')).toBe(true);
  });
});

describe('transformFileInfo size fallbacks', () => {
  it('uses lfs.size and carries sha256 through', () => {
    const out = service.transformFileInfo('org/model', {
      rfilename: 'm-Q4_K_M.gguf', size: 1, lfs: { size: 999, sha256: 'abc' },
    });
    expect(out.size).toBe(999);
    expect(out.sha256).toBe('abc');
  });

  it('falls back to plain size, then to 0 when both missing', () => {
    expect(service.transformFileInfo('org/model', { rfilename: 'm.gguf', size: 50 }).size).toBe(50);
    expect(service.transformFileInfo('org/model', { rfilename: 'm.gguf' }).size).toBe(0);
  });
});

describe('getModelDetails delegates to transformModelResult', () => {
  it('uses id split fallback for name when no slash present', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'soloname', downloads: 0, likes: 0, tags: [], siblings: [] }),
    });
    const result = await huggingFaceService.getModelDetails('soloname');
    expect(result.name).toBe('soloname');
    expect(result.author).toBe('soloname'); // id.split('/')[0]
  });
});
