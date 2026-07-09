import { imageBackendLabel } from '../../../src/utils/imageBackend';

describe('imageBackendLabel', () => {
  it('maps known backends to their canonical label', () => {
    expect(imageBackendLabel('coreml')).toBe('Core ML');
    expect(imageBackendLabel('qnn')).toBe('NPU');
    expect(imageBackendLabel('mnn')).toBe('GPU');
  });

  it('returns the default fallback for unknown/absent backends', () => {
    expect(imageBackendLabel(undefined)).toBe('GPU');
    expect(imageBackendLabel(null)).toBe('GPU');
    expect(imageBackendLabel('')).toBe('GPU');
    expect(imageBackendLabel('something-new')).toBe('GPU');
  });

  it('honours a per-surface fallback for unknown/absent backends', () => {
    expect(imageBackendLabel('all', 'Backend')).toBe('Backend');
    expect(imageBackendLabel(undefined, 'Image Generation')).toBe('Image Generation');
    // a known backend always wins over the fallback
    expect(imageBackendLabel('qnn', 'Backend')).toBe('NPU');
  });

  it('normalises the qnn label so no surface can drift back to "Qualcomm NPU"', () => {
    // Storage Settings previously showed "Qualcomm NPU" while every other surface
    // showed "NPU"; the single source of truth prevents that divergence.
    expect(imageBackendLabel('qnn', 'GPU')).toBe('NPU');
  });
});
