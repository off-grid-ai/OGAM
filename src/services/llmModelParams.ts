import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { HTP_ENABLED } from '../config/featureFlags';
import { APP_CONFIG } from '../constants';
import { INFERENCE_BACKENDS } from '../types';
import logger from '../utils/logger';

const DEFAULT_THREADS = 4;
const DEFAULT_BATCH = 512;
const DEFAULT_GPU_LAYERS = Platform.OS === 'ios' ? 99 : 0;
const REPACKABLE_QUANTS = ['q4_0', 'iq4_nl'];

function shouldDisableMmap(modelPath: string): boolean {
  if (Platform.OS !== 'android') return false;
  return REPACKABLE_QUANTS.some(q => modelPath.toLowerCase().includes(q));
}

export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.codePointAt(i) ?? 0;
    // eslint-disable-next-line no-bitwise
    hash = (hash << 5) - hash + char;
    // eslint-disable-next-line no-bitwise
    hash &= hash;
  }
  return hash.toString(16);
}

export async function ensureSessionCacheDir(cacheDir: string): Promise<void> {
  try {
    if (!(await RNFS.exists(cacheDir))) await RNFS.mkdir(cacheDir);
  } catch (error) {
    logger.log('[LLM] Failed to create session cache dir:', error);
  }
}

export function getSessionPath(cacheDir: string, promptHash: string): string {
  return `${cacheDir}/session-${promptHash}.bin`;
}

export interface ModelLoadParams {
  baseParams: object;
  nThreads: number;
  nBatch: number;
  ctxLen: number;
  nGpuLayers: number;
  usesF16Cache: boolean;
}

export function backendForcesF16Cache(backend: string | undefined): boolean {
  return (
    backend === INFERENCE_BACKENDS.OPENCL ||
    (HTP_ENABLED && backend === INFERENCE_BACKENDS.HTP)
  );
}

export function effectiveCacheType(
  backend: string | undefined,
  requested: string | undefined,
): string {
  return backendForcesF16Cache(backend) ? 'f16' : requested || 'q8_0';
}

export function buildModelParams(
  modelPath: string,
  settings: {
    nThreads?: number;
    nBatch?: number;
    contextLength?: number;
    flashAttn?: boolean;
    enableGpu?: boolean;
    gpuLayers?: number;
    cacheType?: string;
    inferenceBackend?: string;
  },
): ModelLoadParams {
  const nThreads = settings.nThreads || DEFAULT_THREADS;
  const nBatch = settings.nBatch || DEFAULT_BATCH;
  const ctxLen = settings.contextLength || APP_CONFIG.maxContextLength;
  const backend = settings.inferenceBackend;
  const gpuBackendIncompatible = backendForcesF16Cache(backend);
  const flashAttnType =
    settings.flashAttn === false || gpuBackendIncompatible ? 'off' : 'auto';
  const gpuEnabled = backend
    ? backend !== INFERENCE_BACKENDS.CPU
    : settings.enableGpu !== false;
  const nGpuLayers = gpuEnabled ? settings.gpuLayers ?? DEFAULT_GPU_LAYERS : 0;
  const requestedCache =
    settings.cacheType || (flashAttnType !== 'off' ? 'q8_0' : 'f16');
  const cacheType = effectiveCacheType(backend, requestedCache);

  return {
    baseParams: {
      model: modelPath,
      use_mlock: false,
      n_batch: nBatch,
      n_ubatch: nBatch,
      n_threads: nThreads,
      use_mmap: !shouldDisableMmap(modelPath),
      vocab_only: false,
      flash_attn_type: flashAttnType,
      no_extra_bufts: false,
      ...(backend === INFERENCE_BACKENDS.OPENCL
        ? {}
        : { cache_type_k: cacheType, cache_type_v: cacheType }),
    },
    nThreads,
    nBatch,
    ctxLen,
    nGpuLayers,
    usesF16Cache: cacheType === 'f16',
  };
}
