/**
 * A LiteRT file compiled for a Google Tensor TPU runs only on that generation's TPU, so the
 * curated list shows it only there (Models tab + onboarding share liteRTFileRunsOnDevice).
 * The target generation comes from Google's file naming, read by liteRTTensorTarget.
 */
import { CURATED_LITERT_ENTRIES, liteRTFileRunsOnDevice } from '../../../src/services/curatedLiteRTRegistry';
import { liteRTTensorTarget } from '../../../src/utils/modelHelpers';

const tensorEntry = CURATED_LITERT_ENTRIES.find(e => liteRTTensorTarget(e.fileName) !== null);

describe('Tensor TPU LiteRT builds', () => {
  it('reads the Tensor generation from Google’s file naming', () => {
    expect(liteRTTensorTarget('gemma-4-E2B-it_Google_Tensor_G5.litertlm')).toBe(5);
    expect(liteRTTensorTarget('Gemma3-1B-IT_google_tensor_g4.litertlm')).toBe(4);
    expect(liteRTTensorTarget('gemma-4-E2B-it.litertlm')).toBeNull();
    expect(liteRTTensorTarget('gemma-4-E2B-it_Google_Tensor_G5.gguf')).toBeNull();
  });

  it('curates a Tensor G5 build (fixture ground-truth)', () => {
    expect(tensorEntry?.fileName).toBe('gemma-4-E2B-it_Google_Tensor_G5.litertlm');
  });

  it('lists the Tensor G5 build only on a phone whose TPU is Tensor G5', () => {
    const name = tensorEntry!.fileName;
    expect(liteRTFileRunsOnDevice(name, 5)).toBe(true);
    expect(liteRTFileRunsOnDevice(name, 4)).toBe(false);
    expect(liteRTFileRunsOnDevice(name, null)).toBe(false);
  });

  it('lists portable builds on every phone', () => {
    for (const entry of CURATED_LITERT_ENTRIES.filter(e => e !== tensorEntry)) {
      expect(liteRTFileRunsOnDevice(entry.fileName, null)).toBe(true);
      expect(liteRTFileRunsOnDevice(entry.fileName, 5)).toBe(true);
    }
  });
});
