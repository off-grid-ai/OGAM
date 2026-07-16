/**
 * Capability PREDICTION for a llama (GGUF) model that is SELECTED but not yet loaded.
 *
 * The authoritative tools/thinking capability comes from the loaded native context (the gguf's
 * chat template — supportsNativeThinking / chatTemplates.jinja.toolUse). But models load LAZILY
 * (on first send), so between selecting a model and sending, the loaded context does not exist —
 * and deriving "false" hid the Tools/Thinking settings for a Gemma 4 the user had just selected
 * (device-reported 2026-07-13): they only appeared after the first send loaded the model.
 *
 * This predicts from what we know statically — the model's name/id/file (same precedent as
 * looksLikeVisionModel in visionModel.ts) and its on-disk mmproj (vision is DATA: a downloaded
 * projector IS the capability). The prediction is used ONLY while the engine is not loaded; once
 * loaded, the live template-derived capability takes over and is authoritative.
 *
 * Unknown names predict false — an unrecognized model keeps today's behavior (affordances appear
 * on load) rather than promising a capability we cannot honor.
 */

/** Model families whose GGUF chat templates emit native reasoning (thinking). */
export const GGUF_THINKING_NAME_PATTERNS: readonly string[] = [
  'gemma-4', 'gemma4', 'qwen3', 'deepseek-r1', 'smollm3', 'gpt-oss', 'magistral',
];

/** Model families whose GGUF chat templates support tool calling. */
export const GGUF_TOOLS_NAME_PATTERNS: readonly string[] = [
  'gemma-4', 'gemma4', 'qwen', 'llama-3', 'llama3', 'mistral', 'smollm3', 'deepseek', 'gpt-oss', 'hermes',
];

export interface PredictedGgufCapabilities {
  tools: boolean;
  thinking: boolean;
  vision: boolean;
}

export function predictGgufCapabilities(
  model: { id?: string; name?: string; fileName?: string; mmProjPath?: string } | null | undefined,
): PredictedGgufCapabilities {
  if (!model) return { tools: false, thinking: false, vision: false };
  // Normalize separators so a display name ("Gemma 4 E2B"), a repo id ("unsloth/gemma-4-…") and a
  // file name ("gemma-4-…gguf") all reduce to the same hyphenated form the patterns use.
  const hay = `${model.id ?? ''} ${model.name ?? ''} ${model.fileName ?? ''}`
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return {
    tools: GGUF_TOOLS_NAME_PATTERNS.some((p) => hay.includes(p)),
    thinking: GGUF_THINKING_NAME_PATTERNS.some((p) => hay.includes(p)),
    vision: !!model.mmProjPath,
  };
}
