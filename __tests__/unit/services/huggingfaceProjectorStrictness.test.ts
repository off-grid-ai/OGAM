/**
 * Download-time projector matching (#510 "one strict model<->projector rule").
 *
 * These drive the REAL huggingFaceService.getModelFiles over a FAKED HuggingFace network boundary
 * (only global.fetch is faked — the whole huggingface service + mmproj rule run for real). The
 * observable is the projector paired onto the downloadable ModelFile (file.mmProjFile): the thing the
 * download flow then fetches and hands the loader, which decides whether vision works.
 *
 * Two behaviors must BOTH hold:
 *   (A) GENERIC single projector (bare `mmproj-F16.gguf`, no model-name token, e.g. ggml-org/gemma-3-*)
 *       must STILL pair → vision works. This is the anti-regression guard.
 *   (B) A projector whose filename names a DIFFERENT model+variant (an E4B projector for an E2B model,
 *       even at the same quant) must be REFUSED → the E2B never gets mispaired to the wrong architecture.
 *
 * Real repo shapes: unsloth/gemma-4-E2B-it-GGUF and unsloth/gemma-4-E4B-it-GGUF (src/constants/models.ts);
 * ggml-org/gemma-3-*-GGUF ships a bare `mmproj-F16.gguf` (src/services/modelManager/download.ts comments).
 */
import { huggingFaceService } from '../../../src/services/huggingface';

const originalFetch = global.fetch;

function fakeTreeListing(files: Array<{ path: string; size: number }>) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(files.map(f => ({ type: 'file', path: f.path, size: f.size }))),
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('download-time projector matching (#510)', () => {
  // (A) ANTI-REGRESSION: a repo shipping ONE generic projector with no model-name token must still pair
  // it with the model, or vision silently breaks for ggml-org/gemma-3-*-GGUF (and unsloth gemma-4, which
  // also ships a bare mmproj-F16.gguf). MUST stay green before AND after the fix.
  it('(A) pairs a generic single projector (no model-name token) with the model', async () => {
    fakeTreeListing([
      { path: 'gemma-3-4b-it-Q4_K_M.gguf', size: 4_000_000_000 },
      { path: 'mmproj-F16.gguf', size: 800_000_000 },
    ]);

    const files = await huggingFaceService.getModelFiles('ggml-org/gemma-3-4b-it-GGUF');

    const model = files.find(f => f.name === 'gemma-3-4b-it-Q4_K_M.gguf');
    expect(model?.mmProjFile?.name).toBe('mmproj-F16.gguf');
  });

  // (B) WRONG-ARCHITECTURE REFUSAL: an E2B model listing that (mispackaged / user-mixed) contains a
  // projector whose filename names E4B must NOT pair it — even though it is the same quant. Pairing it
  // would crash initMultimodal ("Multimodal support not enabled") on device. The E2B must come back
  // text-only (undefined mmProjFile) so it loads clean or takes the repair path.
  it('(B) refuses a projector that names a DIFFERENT model+variant (E4B projector, E2B model)', async () => {
    fakeTreeListing([
      { path: 'gemma-4-E2B-it-Q4_K_M.gguf', size: 2_000_000_000 },
      { path: 'gemma-4-E4B-it-mmproj-F16.gguf', size: 800_000_000 },
    ]);

    const files = await huggingFaceService.getModelFiles('unsloth/gemma-4-E2B-it-GGUF');

    const e2b = files.find(f => f.name === 'gemma-4-E2B-it-Q4_K_M.gguf');
    expect(e2b?.mmProjFile).toBeUndefined();
  });

  // (B, positive) When the correct E2B-named projector IS present alongside a wrong E4B one, the exact
  // model+variant match is chosen — vision works, mispairing is avoided.
  it('(B) prefers the exact model+variant projector over a wrong-arch one', async () => {
    fakeTreeListing([
      { path: 'gemma-4-E2B-it-Q4_K_M.gguf', size: 2_000_000_000 },
      { path: 'gemma-4-E2B-it-mmproj-F16.gguf', size: 800_000_000 },
      { path: 'gemma-4-E4B-it-mmproj-F16.gguf', size: 900_000_000 },
    ]);

    const files = await huggingFaceService.getModelFiles('unsloth/gemma-4-E2B-it-GGUF');

    const e2b = files.find(f => f.name === 'gemma-4-E2B-it-Q4_K_M.gguf');
    expect(e2b?.mmProjFile?.name).toBe('gemma-4-E2B-it-mmproj-F16.gguf');
  });
});
