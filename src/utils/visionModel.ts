/**
 * Vision-model detection — the SINGLE source of truth for "does this model name/tag look like a
 * vision (multimodal) model". Three call sites used to keep their OWN keyword lists (DR2): the
 * remote-capability detector recognised ~18 families (pixtral, moondream, internvl, ...) while the
 * local model-type and HuggingFace-search detectors knew only vision/vlm/llava. So the same model
 * (Pixtral, Moondream, InternVL) reported VISION over a remote endpoint but TEXT-only locally.
 * Everything now derives from these two lists so the verdict can't diverge again.
 */

/** Substrings in a model name/id that mark it as a vision (multimodal) model. */
import {
  hasVisionModelIdentity,
  VISION_MODEL_NAME_PATTERNS,
} from '@offgrid/models';

export const VISION_NAME_PATTERNS = VISION_MODEL_NAME_PATTERNS;

/**
 * Does this model look like a vision model? Case-insensitive. Pass any of the identifiers you have
 * (a remote model has only an id; a local/HF model has name + id + tags) — a match on ANY marks it
 * vision. This is the ONE predicate every caller uses instead of its own keyword list.
 */
export function looksLikeVisionModel(input: { name?: string; id?: string; tags?: string[] }): boolean {
  return hasVisionModelIdentity(input);
}
