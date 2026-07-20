const BYTES_PER_GB = 1024 * 1024 * 1024;

export const MIN_LLAMA_OUTPUT_TOKENS = 64;

/** The largest context this runtime will allocate for a device's physical RAM tier. */
export function getDeviceContextLimit(totalMemoryBytes: number): number {
  const gb = totalMemoryBytes / BYTES_PER_GB;
  if (gb <= 6) return 2048;
  if (gb <= 8) return 4096;
  return 8192;
}

/** A model's trained maximum is capability metadata, not an allocation recommendation. */
export function getSelectableContextLimit(
  modelMaxContext: number | null,
  totalMemoryBytes: number,
): number {
  const deviceLimit = getDeviceContextLimit(totalMemoryBytes);
  return modelMaxContext == null
    ? deviceLimit
    : Math.min(modelMaxContext, deviceLimit);
}

/** Output cannot consume more tokens than the selected, selectable KV context. */
export function getLlamaOutputTokenLimit(
  selectedContextLength: number,
  selectableContextLimit: number = selectedContextLength,
): number {
  return clampLlamaMaxTokens(selectedContextLength, selectableContextLimit);
}

/** Keeps a persisted or runtime Llama output budget valid for its context. */
export function clampLlamaMaxTokens(
  maxTokens: number,
  contextLength: number,
): number {
  return Math.max(MIN_LLAMA_OUTPUT_TOKENS, Math.min(maxTokens, contextLength));
}
