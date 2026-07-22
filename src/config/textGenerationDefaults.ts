export const LLAMA_TEXT_GENERATION_DEFAULTS = {
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 4096,
  nThreads: 0,
  nBatch: 512,
} as const;

export const LITERT_TEXT_GENERATION_DEFAULTS = {
  liteRTTemperature: 0.7,
  liteRTTopP: 0.9,
  liteRTMaxTokens: 4096,
} as const;

export const TEXT_GENERATION_DEFAULTS = {
  ...LLAMA_TEXT_GENERATION_DEFAULTS,
  ...LITERT_TEXT_GENERATION_DEFAULTS,
} as const;
