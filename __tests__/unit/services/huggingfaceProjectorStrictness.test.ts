/**
 * DEFECT 2a — DOCUMENTED RED (intentionally NOT fixed; see the agent report).
 *
 * huggingface.findMatchingMMProj (the DOWNLOAD-time projector matcher, reached via getModelFiles) is still
 * the LOOSE quant-based matcher with the "closest/only one" fallback. #510 c815752f claimed to replace every
 * projector matcher with the ONE strict rule (mmproj.pickMmProjForModel — name+variant stem, quant ignored,
 * NO "closest" fallback), but it only migrated isMMProjFile here and left findMatchingMMProj on the loose
 * path. So the download-time matcher will pair a WRONG-ARCHITECTURE projector when it shares the model's
 * quant (E2B model Q4 ↔ E4B projector Q4) — the exact E2B↔E4B mispairing the strict rule exists to refuse.
 *
 * This test asserts the STRICT-correct product outcome (the E4B projector must NOT be paired to an E2B model)
 * and is RED on HEAD because the loose matcher accepts it via the exact-quant branch. It is filed as
 * evidence of the drift, NOT wired to a fix: migrating findMatchingMMProj to the strict rule would REGRESS a
 * legitimate, currently-working path — the majority repo shape where a single GENERIC projector (bare
 * `mmproj-F16.gguf`, no model name) is the only projector. The strict stem match returns undefined for that
 * (no name overlap), so vision models with a generic projector would download text-only. The existing test
 * `huggingface.test.ts › getModelFiles › separates mmproj files from model files` (model-Q4_K_M.gguf paired
 * with mmproj-f16.gguf) encodes that working path and would break. See the report for the recommended fix
 * (a download-time matcher that keeps the generic-single-projector case AND refuses a name-mismatched one).
 */
import { huggingFaceService } from '../../../src/services/huggingface';

describe('DEFECT 2a (documented, unfixed): download-time projector matching is still the loose rule', () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it.failing('refuses to pair an E4B projector with an E2B model even at the same quant (strict rule)', async () => {
    // Raw HF listing: an E2B model and a WRONG-ARCH E4B projector that shares the model's Q4_K_M quant.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { type: 'file', path: 'gemma-4-E2B-it-Q4_K_M.gguf', size: 2_000_000_000 },
        { type: 'file', path: 'gemma-4-E4B-it-Q4_K_M-mmproj.gguf', size: 800_000_000 },
      ]),
    }) as unknown as typeof fetch;

    const files = await huggingFaceService.getModelFiles('google/gemma');
    const e2b = files.find(f => f.name === 'gemma-4-E2B-it-Q4_K_M.gguf')!;

    // STRICT/product-correct: an E4B projector is the wrong architecture for an E2B model → refuse it (undefined).
    // HEAD (loose): the exact-quant branch accepts 'gemma-4-E4B-it-Q4_K_M-mmproj.gguf' → this fails (RED).
    expect(e2b.mmProjFile?.name).toBeUndefined();
  });
});
