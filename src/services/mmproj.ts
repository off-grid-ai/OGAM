/**
 * Single source of truth for matching a multimodal projector (mmproj) to its model.
 *
 * There used to be THREE divergent notions of "does this projector belong to this model": a loose
 * substring matcher in modelManager (findMatchingMmProj), a strict stem matcher on the load path, and
 * huggingface's download-time quant matcher — plus isMMProjFile defined three times. The loose and strict
 * matchers disagreed, so the startup relink kept a projector the loader rejected (E2B model ↔ E4B
 * projector), which is the root of the vision-init failures (device 2026-07-14).
 *
 * The rule, per the product requirement: a projector belongs to a model when the model NAME + VARIANT
 * match. QUANTIZATION does NOT matter — one projector serves every quant of its model — so it is normalized
 * out. Strict by design: a near-name projector (E4B for an E2B model) is the wrong architecture and makes
 * initMultimodal fail, so a non-belonging projector is refused (never "closest"/"only one").
 */

/** Is this filename a multimodal projector (mmproj) rather than a model weights file? */
export function isMMProjFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.gguf')) return false;
  return lower.includes('mmproj') || lower.includes('projector') || lower.includes('clip');
}

/**
 * The model-identity stem of a gguf/mmproj filename: lowercased, with the extension, any `mmproj` marker,
 * and the QUANTIZATION token removed — so name + variant remain and quant is ignored. Both
 * gemma-4-E2B-it-Q4_K_M.gguf and gemma-4-E2B-it-Q8_0-mmproj.gguf reduce to `gemma4e2bit`; E4B reduces to
 * `gemma4e4bit` (distinct). Model-VARIANT tokens (E2B/E4B, instruct, …) are kept, so they must match too;
 * only quant packaging (the `UD-` dynamic-quant prefix) and the `-text-model` role marker are normalized out.
 */
function modelIdentityStem(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/\.gguf$/, '')
    .replace(/[-_.]?mmproj/g, '')
    // moondream ships its LLM weights as `<name>-text-model-<prec>` alongside `<name>-mmproj-<prec>`;
    // drop the `-text-model` role marker so the weights and projector reduce to the same stem.
    .replace(/[-_.]text[-_]?model/g, '')
    // unsloth-DYNAMIC quant packaging is `UD-<quant>` (e.g. `-UD-IQ2_M`). The `UD` is quant packaging,
    // NOT a model variant — strip it (only when it directly precedes a quant token) so a UD-quant model
    // reduces to the same stem as its (non-UD) projector.
    .replace(/[-_.]ud(?=[-_.](?:iq\d|q\d|f\d|fp16|bf16))/gi, '')
    // quant / precision tokens: Q4_K_M, Q8_0, Q5_K_S, Q6_K, IQ4_XS, F16, FP16, F32, BF16, …
    .replace(/[-_.]?(iq\d+[a-z0-9_]*|q\d+[a-z0-9_]*|fp16|f16|f32|bf16)/gi, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** True when a projector filename belongs to a model filename (same quant-stripped name+variant stem). */
export function mmProjBelongsToModel(modelFileName: string, mmProjFileName: string): boolean {
  return modelIdentityStem(modelFileName) === modelIdentityStem(mmProjFileName);
}

/**
 * Pick the projector that BELONGS to this model from candidate filenames, or undefined if none does.
 * NEVER falls back to "closest" or "the only one" — a non-belonging projector is the wrong architecture and
 * would crash the native completion with "Multimodal support not enabled"; undefined lets the model load
 * clean as text-only (and surfaces the "needs repair" path) instead.
 *
 * This is the ON-DISK matcher: by the time files are on disk they've been renamed to the model's own stem
 * (see modelManager download.mmProjLocalName), so a belonging projector shares the model's exact stem.
 */
export function pickMmProjForModel(modelFileName: string, candidateNames: string[]): string | undefined {
  const modelStem = modelIdentityStem(modelFileName);
  return candidateNames.find(name => modelIdentityStem(name) === modelStem);
}

/**
 * Pick the projector to PAIR with a model from a RAW HuggingFace repo file listing (the download-time
 * matcher). Repos name projectors two ways and we must honour both without ever mispairing:
 *
 *   (A) GENERIC projector — the projector filename carries NO model-name token (e.g. a bare
 *       `mmproj-F16.gguf` in ggml-org/gemma-3-*-GGUF, whose identity stem is empty). It serves the repo's
 *       single model, so pair it. This is the case the on-disk strict matcher would wrongly reject (empty
 *       stem ≠ model stem), which is why the download listing needs its own owner rather than reusing
 *       pickMmProjForModel. When a repo ships several generic projectors at different precisions, prefer
 *       F16 (excluding BF16, which some runtimes reject), else take the first.
 *   (B) MODEL-NAMED projector — the filename names a model base+variant (e.g. `gemma-4-E4B-it-mmproj-F16`).
 *       It belongs ONLY to that model. For a DIFFERENT model (an E2B), it is the wrong architecture and
 *       must be REFUSED even at the same quant — the E2B downloads with its correct projector or text-only,
 *       never mispaired.
 *
 * Preference: an exact model-name+variant match wins when present (a repo that ships several named
 * projectors). Otherwise a generic (no-model-token) projector pairs. A candidate that names a DIFFERENT
 * model+variant is never paired; if every candidate does, none pairs (undefined).
 */
export function pickMmProjForDownload(
  modelFileName: string,
  candidateNames: string[]
): string | undefined {
  if (candidateNames.length === 0) return undefined;
  const modelStem = modelIdentityStem(modelFileName);

  // (B, positive) Exact name+variant match — always correct, always preferred.
  const exact = candidateNames.find(name => modelIdentityStem(name) === modelStem);
  if (exact) return exact;

  // (A) GENERIC projectors are generic to the repo's single model: either NO model-name token (empty
  // identity stem, e.g. unsloth `mmproj-F16`) OR the literal placeholder token `model` (ggml-org gemma-3 /
  // openbmb MiniCPM ship `mmproj-model-<prec>`, whose stem reduces to `model` — a placeholder, not a real
  // model name). Prefer F16 (not BF16), else the first. A NAMED-but-different projector is excluded here, so
  // it can never be chosen as the generic fallback (case B refusal).
  const generic = candidateNames.filter(name => {
    const stem = modelIdentityStem(name);
    return stem === '' || stem === 'model';
  });
  if (generic.length > 0) {
    const f16 = generic.find(name => {
      const lower = name.toLowerCase();
      return (lower.includes('f16') || lower.includes('fp16')) && !lower.includes('bf16');
    });
    return f16 ?? generic[0];
  }

  // (B, negative) Every candidate names a DIFFERENT model+variant → wrong architecture, refuse.
  return undefined;
}
