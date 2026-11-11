import { formatRemoteRuntimeStatus, formatTextRuntimeStatus } from '../../../src/services/modelRuntimeStatus';

describe('formatTextRuntimeStatus', () => {
  it('distinguishes selected from actually loaded', () => {
    const out = formatTextRuntimeStatus({
      state: 'selected',
      modelId: 'm1',
      modelName: 'Qwen 3 4B',
    });
    expect(out.compact).toBe('Selected · not loaded');
    expect(out.detail).toContain('not resident in RAM');
  });

  it('shows loading as not ready yet', () => {
    const out = formatTextRuntimeStatus({
      state: 'loading',
      modelId: 'm1',
      modelName: 'Qwen 3 4B',
    });
    expect(out.compact).toBe('Loading AI…');
    expect(out.detail).toContain('not ready yet');
  });

  it('shows actual GPU backend, offloaded layers, context, quant and load time', () => {
    const out = formatTextRuntimeStatus({
      state: 'loaded',
      modelId: 'm1',
      modelName: 'Qwen 3 4B',
      backend: 'GPU',
      backendDetail: 'OpenCL',
      gpuLayers: 24,
      contextLength: 4096,
      quantization: 'Q4_0',
      loadDurationMs: 3240,
    });
    expect(out.compact).toBe('Loaded · GPU');
    expect(out.detail).toContain('GPU (OpenCL)');
    expect(out.detail).toContain('24 layers offloaded');
    expect(out.detail).toContain('4K context');
    expect(out.detail).toContain('Q4_0');
    expect(out.detail).toContain('loaded in 3.2 s');
  });

  it('shows NPU and fallback notices verbatim', () => {
    const out = formatTextRuntimeStatus({
      state: 'loaded',
      modelId: 'm1',
      backend: 'NPU',
      backendDetail: 'HTP0',
      contextLength: 8192,
      fallbackNotice: 'Requested NPU, but the model loaded on CPU.',
    });
    expect(out.compact).toBe('Loaded · NPU');
    expect(out.detail).toContain('NPU (HTP0)');
    expect(out.detail).toContain('8K context');
    expect(out.detail).toContain('Requested NPU');
  });

  it('explains residency eviction separately from model selection', () => {
    const out = formatTextRuntimeStatus({
      state: 'evicted',
      modelId: 'm1',
      modelName: 'Qwen 3 4B',
    });
    expect(out.compact).toBe('Selected · unloaded');
    expect(out.detail).toContain('reload on the next message');
  });
});

describe('formatRemoteRuntimeStatus', () => {
  it('states that remote models are not resident in local RAM', () => {
    const out = formatRemoteRuntimeStatus('Remote Qwen');
    expect(out.compact).toBe('Remote · connected');
    expect(out.detail).toContain('not in this device');
    expect(out.state).toBe('remote');
  });
});
