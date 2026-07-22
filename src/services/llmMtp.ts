import { loadLlamaModelInfo, type LlamaContext } from 'llama.rn';
import logger from '../utils/logger';
import { safeCompletion } from './llmSafetyChecks';

export const MTP_DRAFT_N_MAX = 2;

export interface MtpConfig {
  type: 'draft-mtp';
  n_max: number;
}

type GgufMetadata = Record<string, unknown>;

/**
 * Return the number of embedded Multi-Token Prediction heads advertised by a GGUF.
 * The architecture prefix varies by model, so the stable llama.cpp metadata suffix
 * is the capability contract. A model name or family is not evidence of MTP support.
 */
export function getMtpLayerCount(
  metadata: GgufMetadata | null | undefined,
): number {
  if (!metadata) return 0;

  for (const [key, value] of Object.entries(metadata)) {
    if (!key.endsWith('.nextn_predict_layers')) continue;
    const count = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(count) && count > 0) return Math.floor(count);
  }

  return 0;
}

/** Inspect the real GGUF header before context creation and opt in only when it owns MTP heads. */
async function inspectMtpConfig(modelPath: string): Promise<MtpConfig | null> {
  try {
    const metadata = (await loadLlamaModelInfo(modelPath)) as GgufMetadata;
    const layerCount = getMtpLayerCount(metadata);
    if (layerCount <= 0) return null;

    const config: MtpConfig = {
      type: 'draft-mtp',
      n_max: Math.min(MTP_DRAFT_N_MAX, layerCount),
    };
    logger.log(
      `[LLM][MTP] Detected ${layerCount} embedded draft layer(s); enabling n_max=${config.n_max}`,
    );
    return config;
  } catch (error) {
    // Metadata inspection is an optimization probe. A bridge/version/read failure must
    // never make an otherwise valid model unloadable.
    logger.warn(
      '[LLM][MTP] Could not inspect GGUF metadata; continuing without MTP:',
      error,
    );
    return null;
  }
}

function withMtpInitParams(
  baseParams: object,
  config: MtpConfig | null,
): object {
  if (!config) return baseParams;
  return {
    ...baseParams,
    speculative: config,
    // Recurrent/hybrid architectures need rollback state allocated at context init.
    spec_draft_n_max: config.n_max,
  };
}

function withMtpCompletionParams(
  completionParams: Record<string, unknown>,
  config: MtpConfig | null,
  allowed: boolean,
): Record<string, unknown> {
  if (!allowed) return { ...completionParams, speculative: false };
  return config
    ? { ...completionParams, speculative: config }
    : completionParams;
}

function isMtpRuntimeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /multi[- ]?token|\bmtp\b|speculative|draft[_ -]?head|nextn/i.test(
    message,
  );
}

function getMtpPerformanceStats(
  result:
    | { draft_tokens?: number; draft_tokens_accepted?: number }
    | null
    | undefined,
  enabled: boolean,
): {
  lastMtpEnabled?: boolean;
  lastDraftTokens?: number;
  lastDraftTokensAccepted?: number;
} {
  if (!enabled) return {};
  return {
    lastMtpEnabled: true,
    lastDraftTokens: Number(result?.draft_tokens ?? 0),
    lastDraftTokensAccepted: Number(result?.draft_tokens_accepted ?? 0),
  };
}

type CompletionOptions = {
  params: Record<string, unknown>;
  onToken: (data: any) => void;
  label: string;
  allowed?: boolean;
};

/** Owns the detected MTP capability and applies it consistently for one loaded context. */
export class MtpSession {
  private config: MtpConfig | null = null;
  private lastCompletionEnabled = false;

  async prepare(modelPath: string, enabled: boolean): Promise<void> {
    this.config = enabled ? await inspectMtpConfig(modelPath) : null;
  }

  async initialize<T>(
    baseParams: object,
    init: (params: object) => Promise<T>,
  ): Promise<T> {
    try {
      return await init(withMtpInitParams(baseParams, this.config));
    } catch (error) {
      if (!this.config || !isMtpRuntimeError(error)) throw error;
      logger.warn(
        '[LLM][MTP] Context initialization rejected MTP; retrying without it:',
        error,
      );
      this.config = null;
      return init(baseParams);
    }
  }

  async complete(
    context: LlamaContext,
    options: CompletionOptions,
  ): Promise<any> {
    const allowed = options.allowed !== false;
    const config = allowed ? this.config : null;
    this.lastCompletionEnabled = config !== null;
    let streamedToken = false;
    const onToken = (data: any) => {
      if (data?.token) streamedToken = true;
      options.onToken(data);
    };
    const params = withMtpCompletionParams(options.params, config, allowed);
    try {
      return await safeCompletion(
        context,
        () => context.completion(params as any, onToken),
        options.label,
      );
    } catch (error) {
      if (!config || streamedToken || !isMtpRuntimeError(error)) throw error;
      logger.warn(
        `[LLM][MTP] ${options.label} rejected MTP before streaming; disabling it and retrying once:`,
        error,
      );
      this.config = null;
      this.lastCompletionEnabled = false;
      const fallback = withMtpCompletionParams(options.params, null, false);
      return safeCompletion(
        context,
        () => context.completion(fallback as any, options.onToken),
        `${options.label}.mtpFallback`,
      );
    }
  }

  performanceStats(
    result:
      | { draft_tokens?: number; draft_tokens_accepted?: number }
      | null
      | undefined,
  ) {
    return getMtpPerformanceStats(result, this.lastCompletionEnabled);
  }

  reset(): void {
    this.config = null;
    this.lastCompletionEnabled = false;
  }

  description(): string {
    return this.config ? `n_max=${this.config.n_max}` : 'off';
  }
}
