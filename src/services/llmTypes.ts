export interface MultimodalSupport {
  vision: boolean;
  audio: boolean;
}

export interface LLMPerformanceSettings {
  nThreads: number;
  nBatch: number;
  contextLength: number;
}

export interface LLMPerformanceStats {
  lastTokensPerSecond: number;
  lastDecodeTokensPerSecond: number;
  lastTimeToFirstToken: number;
  lastGenerationTime: number;
  lastTokenCount: number;
  /** True when the completion hit the n_predict cap without an EOS token (cut off mid-output, B15). */
  lastTruncated?: boolean;
  /** Whether embedded Multi-Token Prediction was active for the last completion. */
  lastMtpEnabled?: boolean;
  lastDraftTokens?: number;
  lastDraftTokensAccepted?: number;
}
