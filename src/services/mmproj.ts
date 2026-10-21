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
 * The identity rule and the download-time choice are shared with the desktop (@offgrid/models).
 */
import { modelIdentityStem, projectorsFor } from '@offgrid/models';

/** Is this filename a multimodal projector (mmproj) rather than a model weights file? */
export function isMMProjFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith('.gguf')) return false;
  return lower.includes('mmproj') || lower.includes('projector') || lower.includes('clip');
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
  // The rule lives in @offgrid/models (projectorsFor): the exact name+variant match, else the repo's
  // generic projectors, never another model's. Among generic ones, F16 (not BF16) is preferred.
  const candidates = projectorsFor(modelFileName, candidateNames.map(rfilename => ({ rfilename })));
  if (candidates.length === 0) return undefined;
  const modelStem = modelIdentityStem(modelFileName);
  const exact = candidates.find(c => modelIdentityStem(c.rfilename) === modelStem);
  if (exact) return exact.rfilename;
  const f16 = candidates.find(c => {
    const lower = c.rfilename.toLowerCase();
    return (lower.includes('f16') || lower.includes('fp16')) && !lower.includes('bf16');
  });
  return (f16 ?? candidates[0]).rfilename;
}

/** True when an existing projector link is still valid for this model, including a generic repo projector. */
export function canKeepMmProjLink(modelFileName: string, mmProjFileName: string): boolean {
  return pickMmProjForDownload(modelFileName, [mmProjFileName]) === mmProjFileName;
}
