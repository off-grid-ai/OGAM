import { MOBILE_EMBEDDING_MODEL } from '@offgrid/models';
import { initLlama, LlamaContext } from 'llama.rn';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import logger from '../../../utils/logger';

/** The catalog fact, re-exported for this adapter's callers. */
export const EMBEDDING_MODEL_FILENAME = MOBILE_EMBEDDING_MODEL.fileName;
const EMBEDDING_DIMENSION = 384;
const EMBEDDING_CTX_SIZE = 512;
/** Approx resident footprint: ~25MB Q8 weights + working set + 512-ctx KV. */
export const EMBEDDING_RESIDENT_MB = 90;
/** Bound the native init so a stalled load can't hold the global load lock. */
const EMBEDDING_LOAD_TIMEOUT_MS = 30000;

/**
 * Race `promise` against a timeout. On timeout the returned promise rejects so the
 * caller (and the global load lock it holds) is released; if the underlying promise
 * later resolves, `onOrphan` cleans up the now-orphaned result.
 */
function withTimeout<T>(promise: Promise<T>, opts: { ms: number; message: string; onOrphan: (v: T) => void }): Promise<T> {
  const { ms, message, onOrphan } = opts;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([
    promise.then(v => { clearTimeout(timer); return v; }),
    timeout,
  ]).catch(err => {
    promise.then(onOrphan).catch(() => { /* underlying load failed too — nothing to clean up */ });
    throw err;
  });
}

class EmbeddingService {
  private context: LlamaContext | null = null;
  private loading: Promise<void> | null = null;

  async load(): Promise<void> {
    if (this.context) return;
    if (this.loading !== null) return this.loading;

    this.loading = this.doLoad();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async doLoad(): Promise<void> {
    const modelPath = await this.ensureModelCopied();
    logger.log('[Embedding] Loading embedding model...');
    this.context = await withTimeout(
      initLlama({
          model: modelPath,
          embedding: true,
          n_gpu_layers: 0,
          n_ctx: EMBEDDING_CTX_SIZE,
          n_batch: EMBEDDING_CTX_SIZE,
          n_threads: 2,
          use_mlock: false,
          use_mmap: true,
      } as any),
      {
        ms: EMBEDDING_LOAD_TIMEOUT_MS,
        message: 'Embedding model load timed out',
        onOrphan: (orphan) => { (orphan as LlamaContext)?.release?.().catch(() => {}); },
      },
    );
    logger.log('[Embedding] Model loaded successfully');
  }

  private async ensureModelCopied(): Promise<string> {
    const destPath = `${RNFS.DocumentDirectoryPath}/${EMBEDDING_MODEL_FILENAME}`;
    const exists = await RNFS.exists(destPath);
    if (!exists) {
      if (Platform.OS === 'android') {
        await RNFS.copyFileAssets(`models/${EMBEDDING_MODEL_FILENAME}`, destPath);
      } else {
        const bundlePath = `${RNFS.MainBundlePath}/${EMBEDDING_MODEL_FILENAME}`;
        await RNFS.copyFile(bundlePath, destPath);
      }
      logger.log('[Embedding] Copied embedding model to documents directory');
    }
    return destPath;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.context) throw new Error('Embedding model not loaded. Call load() first.');
    try {
      const result = await (this.context as any).embedding(text);
      // [WIRE] embedding dim + a sample (not the whole vector) so fixtures match the real model's dimensionality.
      logger.log(`[WIRE-EMBED] ${JSON.stringify({ dim: result?.embedding?.length, sample: result?.embedding?.slice?.(0, 8) })}`);
      return result.embedding;
    } catch (error: any) {
      const msg = error?.message || String(error) || '';
      logger.error('[Embedding] Native error during embedding:', msg);
      // Attempt recovery by reloading the embedding model
      if (msg.includes('ggml') || msg.includes('abort') || msg.includes('alloc') || msg.includes('OOM')) {
        try {
          await this.unload();
        } catch { /* ignore cleanup errors */ }
        throw new Error(`Embedding failed (native error). Model has been unloaded for safety. (${msg})`);
      }
      throw error;
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) results.push(await this.embed(text));
    return results;
  }

  async unload(): Promise<void> {
    if (this.context) {
      try {
        await this.context.release();
      } catch (e) {
        logger.warn('[Embedding] Error releasing context (bridge may be torn down):', e);
      }
      this.context = null;
      logger.log('[Embedding] Model unloaded');
    }
  }

  isLoaded(): boolean {
    return this.context !== null;
  }

  getDimension(): number {
    return EMBEDDING_DIMENSION;
  }
}

export const embeddingService = new EmbeddingService();
