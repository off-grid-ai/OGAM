import {
  getMtpLayerCount,
  MTP_DRAFT_N_MAX,
} from '../../../src/services/llmMtp';

describe('GGUF MTP capability metadata', () => {
  it.each([
    [{ 'qwen35.nextn_predict_layers': 3 }, 3],
    [{ 'gemma4.nextn_predict_layers': '2' }, 2],
    [{ 'general.architecture': 'qwen35' }, 0],
    [{ 'qwen35.nextn_predict_layers': 0 }, 0],
    [null, 0],
  ])(
    'derives embedded draft layers from metadata only',
    (metadata, expected) => {
      expect(getMtpLayerCount(metadata)).toBe(expected);
    },
  );

  it('keeps the release draft window conservative', () => {
    expect(MTP_DRAFT_N_MAX).toBe(2);
  });
});
