import { Platform } from 'react-native';
import { getDeviceContextLimit } from '../config/contextLimits';
import logger from '../utils/logger';
import { LLMPerformanceStats } from './llmTypes';

const RESPONSE_RESERVE = 512;
const STOP_TOKENS = ['</s>', '<|end|>', '<|eot_id|>'];

/** Max safe context length based on device RAM to prevent OOM on low-RAM devices. */
export const BYTES_PER_GB = 1024 * 1024 * 1024;

export function getMaxContextForDevice(totalMemoryBytes: number): number {
  return getDeviceContextLimit(totalMemoryBytes);
}

// Android Adreno GPU caps (≤4GB/≤6GB→0, ≤8GB→12, >8GB→24).
const ANDROID_GPU_LAYER_CAPS: { maxGB: number; layers: number }[] = [
  { maxGB: 4, layers: 0 },
  { maxGB: 6, layers: 0 },
  { maxGB: 8, layers: 12 },
];
const ANDROID_GPU_LAYERS_FALLBACK = 24;

/**
 * iOS Metal uses unified memory, so offloaded weights, the compute graph, KV,
 * the app, and the OS all share the same budget. Keep a reserve before deciding
 * how many layers can be safely offloaded.
 */
const IOS_METAL_RESERVE_BYTES = 1.6 * BYTES_PER_GB;

export function getGpuLayersForDevice(
  totalMemoryBytes: number,
  requestedLayers: number,
  opts?: { modelBytes?: number; availableBytes?: number },
): number {
  const totalGB = totalMemoryBytes / BYTES_PER_GB;
  if (totalGB <= 4) return 0;

  if (Platform.OS === 'android') {
    const tier = ANDROID_GPU_LAYER_CAPS.find(t => totalGB <= t.maxGB);
    const maxLayers = tier ? tier.layers : ANDROID_GPU_LAYERS_FALLBACK;
    return Math.min(requestedLayers, maxLayers);
  }

  if (Platform.OS === 'ios' && opts?.modelBytes && opts?.availableBytes) {
    const weightBudget = opts.availableBytes - IOS_METAL_RESERVE_BYTES;
    if (weightBudget <= 0) return 0;
    if (opts.modelBytes <= weightBudget) return requestedLayers;
    return Math.max(
      0,
      Math.floor(requestedLayers * (weightBudget / opts.modelBytes)),
    );
  }
  return requestedLayers;
}

export function buildCompletionParams(
  settings: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    repeatPenalty?: number;
  },
  options?: { disableCtxShift?: boolean },
): Record<string, any> {
  return {
    n_predict: settings.maxTokens || RESPONSE_RESERVE,
    temperature: settings.temperature ?? 0.7,
    top_k: 40,
    top_p: settings.topP ?? 0.95,
    penalty_repeat: settings.repeatPenalty ?? 1.1,
    stop: STOP_TOKENS,
    ctx_shift: options?.disableCtxShift ? false : true,
  };
}

export function isTruncatedResult(
  result:
    | {
        interrupted?: boolean;
        stopped_limit?: number | boolean;
        truncated?: boolean;
      }
    | null
    | undefined,
): boolean {
  if (!result || result.interrupted === true) return false;
  return (
    result.stopped_limit === 1 ||
    result.stopped_limit === true ||
    result.truncated === true
  );
}

export function recordGenerationStats(
  startTime: number,
  firstTokenMs: number,
  tokenCount: number,
): LLMPerformanceStats {
  const elapsed = (Date.now() - startTime) / 1000;
  const tokensPerSec = elapsed > 0 ? tokenCount / elapsed : 0;
  const ttft = firstTokenMs / 1000;
  const decodeTime = elapsed - ttft;
  const decodeTokensPerSec =
    decodeTime > 0 && tokenCount > 1 ? (tokenCount - 1) / decodeTime : 0;
  logger.log(
    `[LLM] Generated ${tokenCount} tokens in ${elapsed.toFixed(
      1,
    )}s (${tokensPerSec.toFixed(1)} tok/s, TTFT ${ttft.toFixed(2)}s)`,
  );
  return {
    lastTokensPerSecond: tokensPerSec,
    lastDecodeTokensPerSecond: decodeTokensPerSec,
    lastTimeToFirstToken: ttft,
    lastGenerationTime: elapsed,
    lastTokenCount: tokenCount,
  };
}
