import { modelLayerTotal, effectiveOffloadedLayers, describeOffload } from '../../../src/services/gpuOffload';

describe('gpuOffload', () => {
  it('reads block_count for the model architecture and adds the output layer', () => {
    expect(modelLayerTotal({ 'general.architecture': 'qwen2', 'qwen2.block_count': '28' })).toBe(29);
    expect(modelLayerTotal({ 'general.architecture': 'llama', 'llama.block_count': 32 })).toBe(33);
  });

  it('returns -1 when the metadata does not say', () => {
    expect(modelLayerTotal(undefined)).toBe(-1);
    expect(modelLayerTotal({ 'general.architecture': 'gemma3' })).toBe(-1);
    expect(modelLayerTotal({ 'llama.block_count': 32 })).toBe(-1);
  });

  it('caps the requested 99 layers to what the model has', () => {
    expect(effectiveOffloadedLayers(99, 29)).toBe(29);
    expect(effectiveOffloadedLayers(12, 29)).toBe(12);
    expect(effectiveOffloadedLayers(12, -1)).toBe(12);
    expect(effectiveOffloadedLayers(0, 29)).toBe(0);
  });

  it('describes offload with and without a known total', () => {
    expect(describeOffload(29, 29)).toBe('29 of 29 layers');
    expect(describeOffload(12, -1)).toBe('12 layers');
    expect(describeOffload(0, 29)).toBe('no layers');
  });
});
