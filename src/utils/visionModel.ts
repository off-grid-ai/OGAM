/**
 * Vision-model detection — the SINGLE source of truth for "does this model name/tag look like a
 * vision (multimodal) model". Three call sites used to keep their OWN keyword lists (DR2): the
 * remote-capability detector recognised ~18 families (pixtral, moondream, internvl, ...) while the
 * local model-type and HuggingFace-search detectors knew only vision/vlm/llava. So the same model
 * (Pixtral, Moondream, InternVL) reported VISION over a remote endpoint but TEXT-only locally.
 * Everything now derives from these two lists so the verdict can't diverge again.
 */

/** Substrings in a model name/id that mark it as a vision (multimodal) model. */
export const VISION_NAME_PATTERNS: readonly string[] = [
  '-vl', 'vl-', ':vl', 'vlm', // common VL naming (qwen3-vl, llava, *-vlm)
  'vision', 'llava', 'bakllava', 'moondream', 'cogvlm',
  'cogagent', 'fuyu', 'idefics', 'qwen-vl', 'gpt-4-vision',
  'gpt-4o', 'claude-3', 'gemini', 'pixtral', 'phi-3.5-vision',
  'minicpm-v', 'internvl', 'yi-vl', 'smolvlm', 'llama-3.2-vision',
];

/** Tag values (HuggingFace / registry tags) that mark a model as vision. */
const VISION_TAG_PATTERNS: readonly string[] = ['vision', 'multimodal', 'image-text'];

const includesAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some(n => haystack.includes(n));

/**
 * Does this model look like a vision model? Case-insensitive. Pass any of the identifiers you have
 * (a remote model has only an id; a local/HF model has name + id + tags) — a match on ANY marks it
 * vision. This is the ONE predicate every caller uses instead of its own keyword list.
 */
export function looksLikeVisionModel(input: { name?: string; id?: string; tags?: string[] }): boolean {
  const name = (input.name ?? '').toLowerCase();
  const id = (input.id ?? '').toLowerCase();
  const tags = (input.tags ?? []).map(t => t.toLowerCase());
  return (
    tags.some(t => includesAny(t, VISION_TAG_PATTERNS)) ||
    includesAny(name, VISION_NAME_PATTERNS) ||
    includesAny(id, VISION_NAME_PATTERNS)
  );
}
