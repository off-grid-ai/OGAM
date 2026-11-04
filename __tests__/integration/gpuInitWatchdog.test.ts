/**
 * GPU context init: a big model that is still loading its weights is NOT a hung GPU, a load that really stalls says where it
 * stalled, and a load that timed out is finished and released before another one starts. Fakes only the native boundary
 * (llama.rn initLlama / releaseContext) and the clock.
 */
import { installNativeBoundary, requireRTL } from '../harness/nativeBoundary';

type Deferred = { resolve: (ctx: unknown) => void; reject: (e: Error) => void; onProgress?: (p: number) => void; params: Record<string, unknown> };

function setup() {
  const boundary = installNativeBoundary({ llama: true, fs: true });
  requireRTL();
  jest.useFakeTimers();
  const llama = require('llama.rn');
  const pending: Deferred[] = [];
  const released: unknown[] = [];
  (llama.initLlama as jest.Mock).mockImplementation((params: Record<string, unknown>, onProgress?: (p: number) => void) =>
    new Promise((resolve, reject) => { pending.push({ resolve, reject, onProgress, params }); }));
  const makeContext = (gpu: boolean) => ({ gpu, devices: gpu ? ['GPUOpenCL'] : [], reasonNoGPU: '', release: jest.fn(async () => { released.push('released'); }) });
  const { initContextWithFallback } = require('../../src/services/llmHelpers');
  const { resetAbandonedInit } = require('../../src/services/nativeInit');
  resetAbandonedInit();
  return { boundary, pending, released, makeContext, initContextWithFallback };
}
const tick = async (ms: number) => { await jest.advanceTimersByTimeAsync(ms); };

afterEach(() => { jest.useRealTimers(); });

it('does not call a slow load hung while its weights are still loading, even past 45 seconds in total', async () => {
  const t = setup();
  const result = t.initContextWithFallback({ model: '/models/gemma.gguf' }, 2048, 24, false);
  // 120 seconds of steady weight loading (a percentage every 10 s): far past the old flat 45 s limit.
  for (let pct = 10; pct <= 100; pct += 10) { await tick(10_000); t.pending[0].onProgress!(pct); }
  const ctx = t.makeContext(true);
  t.pending[0].resolve(ctx);
  const done = await result;
  expect(done.context).toBe(ctx);
  expect(done.gpuAttemptFailed).toBe(false);
  expect(t.pending).toHaveLength(1);
});

it('says the weights stalled, and where, when the percentage stops moving', async () => {
  const t = setup();
  const result = t.initContextWithFallback({ model: '/models/gemma.gguf' }, 2048, 24, false);
  const failure = result.catch((e: Error) => e);
  await tick(5_000); t.pending[0].onProgress!(40);
  await tick(5_000); t.pending[0].onProgress!(63);
  await tick(46_000);
  const error = (await failure) as Error;
  expect(error.message).toMatch(/GPU\/NPU initialization failed: GPU context init timed out after 45000ms/);
  expect(error.message).toMatch(/weights stopped loading at 63%/);
});

it('says GPU setup hung when the weights finished but nothing came after', async () => {
  const t = setup();
  const failure = t.initContextWithFallback({ model: '/models/gemma.gguf' }, 2048, 24, false).catch((e: Error) => e);
  await tick(8_000); t.pending[0].onProgress!(100);
  await tick(91_000);
  const error = (await failure) as Error;
  expect(error.message).toMatch(/timed out after 90000ms/);
  expect(error.message).toMatch(/weights are loaded \(100% after 8\.0s\) but GPU setup has not finished/);
});

it('lets a timed-out load finish and release its context before the next load starts', async () => {
  const t = setup();
  const first = t.initContextWithFallback({ model: '/models/gemma.gguf' }, 2048, 24, false).catch((e: Error) => e);
  await tick(46_000);
  expect(((await first) as Error).message).toMatch(/timed out after 45000ms/);

  // The user retries while the native load is still running: no second native load may start yet.
  const second = t.initContextWithFallback({ model: '/models/gemma.gguf' }, 2048, 0, true);
  await tick(5_000);
  expect(t.pending).toHaveLength(1);

  // The abandoned load finally finishes: its context is released, and only then does the retry load.
  const late = t.makeContext(true);
  t.pending[0].resolve(late);
  await tick(0);
  await jest.advanceTimersByTimeAsync(10);
  expect(late.release).toHaveBeenCalledTimes(1);
  await tick(0);
  expect(t.pending).toHaveLength(2);
  t.pending[1].resolve(t.makeContext(false));
  expect((await second).context.gpu).toBe(false);
});

it('refuses to start another load when the abandoned one never finishes, and tells the person to restart Atlas', async () => {
  const t = setup();
  const first = t.initContextWithFallback({ model: '/models/gemma.gguf' }, 2048, 24, false).catch((e: Error) => e);
  await tick(46_000);
  await first;
  const second = t.initContextWithFallback({ model: '/models/gemma.gguf' }, 2048, 0, true).catch((e: Error) => e);
  await tick(121_000);
  const error = (await second) as Error;
  expect(error.message).toMatch(/Close Atlas completely and open it again/);
  expect(t.pending).toHaveLength(1);
});
