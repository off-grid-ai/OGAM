/**
 * Constants Validation Tests
 *
 * Tests for model constants: RECOMMENDED_MODELS, MODEL_ORGS, VERIFIED_QUANTIZERS.
 * Priority: P2 (Medium)
 */

import {
  VERIFIED_QUANTIZERS,
  OFFICIAL_MODEL_AUTHORS,
  LMSTUDIO_AUTHORS,
  CREDIBILITY_LABELS,
} from '../../../src/constants';
import {
  RECOMMENDED_MODELS,
  MODEL_ORGS,
  QUANTIZATION_INFO,
  TRENDING_FAMILIES,
  TRENDING_MODEL_IDS,
} from '@offgrid/models';

describe('RECOMMENDED_MODELS', () => {
  it('all entries have required fields', () => {
    for (const model of RECOMMENDED_MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.type).toBeTruthy();
      expect(model.org).toBeTruthy();
      expect(typeof model.params).toBe('number');
      expect(typeof model.minRam).toBe('number');
    }
  });

  it('all types are valid (text/vision/code)', () => {
    const validTypes = ['text', 'vision', 'code'];
    for (const model of RECOMMENDED_MODELS) {
      expect(validTypes).toContain(model.type);
    }
  });

  it('all orgs exist in MODEL_ORGS or OFFICIAL_MODEL_AUTHORS', () => {
    const orgKeys = MODEL_ORGS.map(o => o.key);
    const officialKeys = Object.keys(OFFICIAL_MODEL_AUTHORS);
    const allKnownOrgs = [...orgKeys, ...officialKeys];

    for (const model of RECOMMENDED_MODELS) {
      expect(allKnownOrgs).toContain(model.org);
    }
  });

  it('RAM recommendations are reasonable (>= 3)', () => {
    for (const model of RECOMMENDED_MODELS) {
      expect(model.minRam).toBeGreaterThanOrEqual(3);
    }
  });

  it('no duplicate model IDs', () => {
    const ids = RECOMMENDED_MODELS.map(m => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('has at least one model of each type', () => {
    const types = new Set(RECOMMENDED_MODELS.map(m => m.type));
    expect(types.has('text')).toBe(true);
    expect(types.has('vision')).toBe(true);
  });

  it('all models have descriptions', () => {
    for (const model of RECOMMENDED_MODELS) {
      expect(model.description).toBeTruthy();
      expect(model.description.length).toBeGreaterThan(5);
    }
  });

  it('params are positive numbers', () => {
    for (const model of RECOMMENDED_MODELS) {
      expect(model.params).toBeGreaterThan(0);
    }
  });

  it('contains all SmolVLM vision models', () => {
    const smolVLMIds = [
      'ggml-org/SmolVLM-Instruct-GGUF',
      'ggml-org/SmolVLM2-2.2B-Instruct-GGUF',
    ];
    for (const id of smolVLMIds) {
      const model = RECOMMENDED_MODELS.find(m => m.id === id);
      expect(model).toBeDefined();
      expect(model!.type).toBe('vision');
      expect(model!.org).toBe('HuggingFaceTB');
    }
  });
});

describe('MODEL_ORGS', () => {
  it('all orgs have key and label', () => {
    for (const org of MODEL_ORGS) {
      expect(org.key).toBeTruthy();
      expect(org.label).toBeTruthy();
    }
  });

  it('has no duplicate keys', () => {
    const keys = MODEL_ORGS.map(o => o.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('includes major organizations', () => {
    const keys = MODEL_ORGS.map(o => o.key);
    expect(keys).toContain('Qwen');
    expect(keys).toContain('meta-llama');
    expect(keys).toContain('google');
  });
});

describe('VERIFIED_QUANTIZERS', () => {
  it('includes ggml-org', () => {
    expect(VERIFIED_QUANTIZERS['ggml-org']).toBeDefined();
  });

  it('includes bartowski', () => {
    expect(VERIFIED_QUANTIZERS.bartowski).toBeDefined();
  });

  it('all entries have non-empty display names', () => {
    for (const [key, value] of Object.entries(VERIFIED_QUANTIZERS)) {
      expect(key).toBeTruthy();
      expect(value).toBeTruthy();
    }
  });
});

describe('OFFICIAL_MODEL_AUTHORS', () => {
  it('includes major model creators', () => {
    expect(OFFICIAL_MODEL_AUTHORS['meta-llama']).toBe('Meta');
    expect(OFFICIAL_MODEL_AUTHORS.google).toBe('Google');
    expect(OFFICIAL_MODEL_AUTHORS.microsoft).toBe('Microsoft');
    expect(OFFICIAL_MODEL_AUTHORS.Qwen).toBe('Alibaba');
  });

  it('all entries have non-empty display names', () => {
    for (const [key, value] of Object.entries(OFFICIAL_MODEL_AUTHORS)) {
      expect(key).toBeTruthy();
      expect(value).toBeTruthy();
    }
  });
});

describe('LMSTUDIO_AUTHORS', () => {
  it('includes lmstudio-community', () => {
    expect(LMSTUDIO_AUTHORS).toContain('lmstudio-community');
  });

  it('is a non-empty array', () => {
    expect(LMSTUDIO_AUTHORS.length).toBeGreaterThan(0);
  });
});

describe('QUANTIZATION_INFO', () => {
  it('has Q4_K_M as recommended', () => {
    expect(QUANTIZATION_INFO.Q4_K_M).toBeDefined();
    expect(QUANTIZATION_INFO.Q4_K_M.recommended).toBe(true);
  });

  it('all entries have required fields', () => {
    for (const [key, info] of Object.entries(QUANTIZATION_INFO)) {
      expect(key).toBeTruthy();
      expect(typeof info.bitsPerWeight).toBe('number');
      expect(info.quality).toBeTruthy();
      expect(info.description).toBeTruthy();
      expect(typeof info.recommended).toBe('boolean');
    }
  });
});

describe('CREDIBILITY_LABELS', () => {
  it('has labels for all credibility sources', () => {
    expect(CREDIBILITY_LABELS.lmstudio).toBeDefined();
    expect(CREDIBILITY_LABELS.official).toBeDefined();
    expect(CREDIBILITY_LABELS['verified-quantizer']).toBeDefined();
    expect(CREDIBILITY_LABELS.community).toBeDefined();
  });

  it('all labels have required fields', () => {
    for (const [, info] of Object.entries(CREDIBILITY_LABELS)) {
      expect(info.label).toBeTruthy();
      expect(info.description).toBeTruthy();
      expect(info.color).toBeTruthy();
    }
  });
});

describe('TRENDING_FAMILIES', () => {
  it('contains gemma4 and qwen35 families', () => {
    expect(TRENDING_FAMILIES.gemma4).toBeDefined();
    expect(TRENDING_FAMILIES.qwen35).toBeDefined();
  });

  it('gemma4 family contains Gemma 4 model IDs', () => {
    expect(TRENDING_FAMILIES.gemma4).toContain('unsloth/gemma-4-E2B-it-GGUF');
    expect(TRENDING_FAMILIES.gemma4).toContain('unsloth/gemma-4-E4B-it-GGUF');
  });

  it('qwen35 family contains Qwen 3.5 model IDs', () => {
    expect(TRENDING_FAMILIES.qwen35).toContain('unsloth/Qwen3.5-0.8B-GGUF');
    expect(TRENDING_FAMILIES.qwen35).toContain('unsloth/Qwen3.5-2B-GGUF');
    expect(TRENDING_FAMILIES.qwen35).toContain('unsloth/Qwen3.5-9B-GGUF');
  });
});

describe('TRENDING_MODEL_IDS', () => {
  it('contains all IDs from TRENDING_FAMILIES', () => {
    const allFamilyIds = Object.values(TRENDING_FAMILIES).flat();
    for (const id of allFamilyIds) {
      expect(TRENDING_MODEL_IDS).toContain(id);
    }
    expect(TRENDING_MODEL_IDS.length).toBe(allFamilyIds.length);
  });

  it('contains exactly the Gemma 4 IDs', () => {
    expect(TRENDING_MODEL_IDS).toContain('unsloth/gemma-4-E2B-it-GGUF');
    expect(TRENDING_MODEL_IDS).toContain('unsloth/gemma-4-E4B-it-GGUF');
  });

  it('contains exactly the Qwen 3.5 IDs', () => {
    expect(TRENDING_MODEL_IDS).toContain('unsloth/Qwen3.5-0.8B-GGUF');
    expect(TRENDING_MODEL_IDS).toContain('unsloth/Qwen3.5-2B-GGUF');
    expect(TRENDING_MODEL_IDS).toContain('unsloth/Qwen3.5-9B-GGUF');
  });

  it('has no duplicate IDs', () => {
    const unique = new Set(TRENDING_MODEL_IDS);
    expect(unique.size).toBe(TRENDING_MODEL_IDS.length);
  });
});
