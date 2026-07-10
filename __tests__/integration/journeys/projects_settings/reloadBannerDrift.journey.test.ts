/**
 * Journey (cluster C): cross-surface {settings screen} × {value the running model was
 * loaded with} — the "settings changed, tap to reload" banner. The reload-required
 * settings (LiteRT max tokens/backend; llama threads/ctx/backend/cache) are applied at
 * LOAD time, so changing them in Model Settings / the modal must:
 *   (a) flag a pending reload (shown value now differs from the loaded value), and
 *   (b) NOT falsely flag right after a load or a llama↔litert switch (the false-positive
 *       class the snapshot-undefined guard was added to prevent).
 *
 * Drives the REAL computePendingSettings against the REAL loadedSettings snapshot shape
 * the loaders write (activeModelService/loaders.ts).
 */

import { computePendingSettings } from '../../../../src/screens/ChatScreen/useChatScreen';

/** The snapshot the LiteRT loader writes after a successful load (loaders.ts:151-162). */
function litertLoadedSnapshot(over: Partial<Record<string, unknown>> = {}) {
  return {
    liteRTBackend: 'gpu', liteRTMaxTokens: 4096,
    contextLength: 4096, enableGpu: false, gpuLayers: 99, nThreads: 0, nBatch: 512,
    flashAttn: true, cacheType: 'q8_0',
    ...over,
  };
}

/** A representative llama loaded snapshot (llama loader path). */
function llamaLoadedSnapshot(over: Partial<Record<string, unknown>> = {}) {
  return {
    contextLength: 4096, enableGpu: true, inferenceBackend: 'cpu', gpuLayers: 99,
    nThreads: 0, nBatch: 512, flashAttn: true, cacheType: 'q8_0',
    // llama loader does NOT snapshot the liteRT fields → they are undefined here.
    ...over,
  };
}

function baseSettings(over: Partial<Record<string, unknown>> = {}) {
  return {
    temperature: 0.7, maxTokens: 1024, topP: 0.9, repeatPenalty: 1.1, contextLength: 4096,
    nThreads: 0, nBatch: 512, enableGpu: true, inferenceBackend: 'cpu', gpuLayers: 99,
    flashAttn: true, cacheType: 'q8_0',
    liteRTBackend: 'gpu', liteRTMaxTokens: 4096, liteRTTemperature: 0.7, liteRTTopP: 0.9,
    ...over,
  };
}

describe('Journey C — reload-required settings drift (banner correctness)', () => {
  it('no banner immediately after a LiteRT load (live == loaded)', () => {
    expect(computePendingSettings('litert', baseSettings(), litertLoadedSnapshot())).toBe(false);
  });

  it('changing liteRTMaxTokens in Model Settings while a LiteRT model is loaded FLAGS a reload', () => {
    // User drags LiteRT "Max Tokens" from 4096 → 8192. The running model still uses 4096
    // (configuredMaxTokens is fixed at load), so the value SHOWN now diverges from the value
    // the model CONSUMES until reload — the banner must fire.
    const flagged = computePendingSettings('litert', baseSettings({ liteRTMaxTokens: 8192 }), litertLoadedSnapshot());
    expect(flagged).toBe(true);
  });

  it('changing the LiteRT backend flags a reload', () => {
    expect(
      computePendingSettings('litert', baseSettings({ liteRTBackend: 'cpu' }), litertLoadedSnapshot()),
    ).toBe(true);
  });

  it('no FALSE banner on a llama→LiteRT switch (loaded snapshot lacks liteRT fields)', () => {
    // Previously loaded a llama model (snapshot has liteRTBackend === undefined). The user then
    // selects a LiteRT model. Until the LiteRT snapshot is written, comparing live liteRT values
    // against undefined must NOT pop the banner (regression guard for the snapshot-undefined fix).
    const flagged = computePendingSettings('litert', baseSettings({ liteRTMaxTokens: 8192 }), llamaLoadedSnapshot());
    expect(flagged).toBe(false);
  });

  it('llama: changing context length while loaded flags a reload; unchanged does not', () => {
    expect(computePendingSettings('llama', baseSettings(), llamaLoadedSnapshot())).toBe(false);
    expect(
      computePendingSettings('llama', baseSettings({ contextLength: 8192 }), llamaLoadedSnapshot()),
    ).toBe(true);
  });

  it('llama: an accelerated cache coercion (q8_0 requested, OpenCL→f16 effective) does NOT falsely flag', () => {
    // Live settings request q8_0 with an OpenCL backend; effectiveCacheType coerces both sides to
    // f16, so there is no real change — the banner must stay quiet (false-positive guard).
    const live = baseSettings({ inferenceBackend: 'opencl', cacheType: 'q8_0' });
    const loaded = llamaLoadedSnapshot({ inferenceBackend: 'opencl', cacheType: 'f16' });
    expect(computePendingSettings('llama', live, loaded)).toBe(false);
  });

  it('no banner at all when nothing has been loaded yet (loadedSettings null)', () => {
    expect(computePendingSettings('litert', baseSettings(), null)).toBe(false);
    expect(computePendingSettings('llama', baseSettings(), undefined)).toBe(false);
  });
});
