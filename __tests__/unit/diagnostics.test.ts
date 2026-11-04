import { formatDiagnostics, type DiagnosticsInput } from '../../src/atlasTools/diagnostics';

const base: DiagnosticsInput = {
  app: '0.0.114 (build 108)',
  device: { model: 'onn 13 Pro', os: 'Android 14', ramGB: 7.4, freeGB: 3.1, soc: 'mediatek', cores: 8, fastThreads: 4 },
  gpus: ['Mali-G57 MC2 Vulkan'],
  settings: { backend: 'auto', threads: 'auto', context: 4096, gpuLayers: 33, flashAttn: false, cache: 'q8_0', warmUp: false },
  model: { name: 'Qwen 3.5 4B', engine: 'llama', sizeMB: 2480, quant: 'Q4_0', loadSeconds: 12.4 },
  running: { gpu: false, backend: 'CPU', layers: '0/33', threads: 4 },
  speed: { decode: 4.5, prefill: 22, replies: 5 },
  tuned: true,
  lastCall: 'Last turn: sent 0.8 s after you stopped, voice started 3.2 s later',
};

describe('diagnostics summary', () => {
  it('lists the device, GPU, settings, model, speed and last call in plain lines', () => {
    const text = formatDiagnostics(base);
    expect(text).toContain('Atlas 0.0.114 (build 108)');
    expect(text).toContain('Device: onn 13 Pro, Android 14, 7.4 GB RAM (3.1 GB free), mediatek');
    expect(text).toContain('CPU: 8 cores, 4 fast');
    expect(text).toContain('GPU: Mali-G57 MC2 Vulkan');
    expect(text).toContain('backend auto, threads auto, context 4096, GPU layers 33, flash attention off, KV cache q8_0');
    expect(text).toContain('Model: Qwen 3.5 4B (llama, Q4_0, 2480 MB), loaded in 12.4 s');
    expect(text).toContain('Running on: CPU, 4 threads');
    expect(text).toContain('Speed: writes 4.5 tok/s, reads 22 tok/s (5 replies), settings tuned');
    expect(text).toContain('Last call: Last turn: sent 0.8 s');
  });

  it('carries the llama.rn version and what the GPU output checks found, so a report shows whether a GPU setting writes real words', () => {
    const text = formatDiagnostics({ ...base, llamaRn: '0.13.0-rc.9', gpuChecks: ['Gemma4-12B.gguf (7040 MB), opencl, 24 GPU layers, llama.rn 0.13.0-rc.9: FAILED - the reply is made of placeholder tokens'] });
    expect(text).toContain('llama.rn: 0.13.0-rc.9');
    expect(text).toContain('GPU output checks:\n  Gemma4-12B.gguf (7040 MB), opencl, 24 GPU layers');
  });

  it('says so when there is no model, no GPU, nothing measured and no call yet', () => {
    const text = formatDiagnostics({ ...base, gpus: [], model: null, running: null, speed: null, lastCall: null });
    expect(text).toContain('GPU: none found');
    expect(text).toContain('Model: none selected');
    expect(text).toContain('Last call: none yet');
    expect(formatDiagnostics({ ...base, running: null, speed: null })).toContain('Running on: model not loaded');
  });

  it('holds nothing personal: no chat text, paths or keys are part of its inputs', () => {
    const text = formatDiagnostics(base);
    expect(text).not.toMatch(/\/data\/|\/storage\/|sk-|password|api key/i);
  });
});
