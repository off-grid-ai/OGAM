import { slowCause } from '../../src/atlasTools/slowCause';

const base = { gpuOn: false, gpuBackend: '', slowGpu: false, threads: 0, recommendedThreads: 4 };

describe('why replies are slow', () => {
  it('names the GPU when this device runs text slower on it than on the CPU, and offers the CPU', () => {
    const c = slowCause({ ...base, gpuOn: true, gpuBackend: 'Vulkan', slowGpu: true });
    expect(c.kind).toBe('gpu');
    expect(c.text).toMatch(/GPU, which is slower than the CPU/);
    expect(c.action?.patch).toEqual({ inferenceBackend: 'cpu', backendUserChosen: true });
  });

  it('leaves a GPU alone when it is not the slow kind', () => {
    expect(slowCause({ ...base, gpuOn: true, gpuBackend: 'Vulkan', slowGpu: false }).kind).toBe('unknown');
    expect(slowCause({ ...base, gpuOn: true, gpuBackend: 'OpenCL', slowGpu: true }).kind).toBe('unknown');
  });

  it('names too many threads (8 chosen, 4 fast cores) and offers automatic', () => {
    const c = slowCause({ ...base, threads: 8 });
    expect(c.kind).toBe('threads');
    expect(c.text).toMatch(/8 threads but only 4 cores are fast/);
    expect(c.action?.patch).toEqual({ nThreads: 0 });
    expect(slowCause({ ...base, threads: 5 }).kind).toBe('unknown'); // one over is fine
    expect(slowCause({ ...base, threads: 0 }).kind).toBe('unknown'); // automatic
  });
});
